// ─── WooCommerce REST client (feature/integration-woocommerce) ────────────
// Thin wrapper over the WooCommerce WP REST API v3
// (https://developer.woocommerce.com/docs/apis/rest-api/).
//
// Auth: HTTP Basic Auth — consumer key as username, consumer secret as
// password — on every request. The vendor docs RECOMMEND HTTPS; Basic
// Auth over plain HTTP sends the secret in the clear, so this client
// refuses non-HTTPS store URLs except loopback hosts (local staging).
// No OAuth 1.0a: the vendor's own docs present Basic Auth over HTTPS as
// the normal path, and the registry records authType 'basic-auth'.
//
// Every request goes through withVendorRetry + mapVendorError (framework
// §6): 429/5xx/network errors retry, 401/403 never retry. Nothing here
// logs credentials or raw vendor payloads.

import { IntegrationError, mapVendorError, withVendorRetry } from '../vendor-client';

export interface WooCommerceCredentials {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
  /** Per-webhook signing secret (optional). Set to the Secret of each webhook in WooCommerce. */
  webhookSecret?: string;
}

/** Credentials as the framework hands them over (decrypted, server-side only). */
export function parseWooCredentials(
  credentials: Record<string, unknown>
): WooCommerceCredentials {
  const storeUrl = String(credentials.storeUrl ?? '').trim();
  const consumerKey = String(credentials.consumerKey ?? '').trim();
  const consumerSecret = String(credentials.consumerSecret ?? '').trim();
  const webhookSecretRaw = credentials.webhookSecret;
  const webhookSecret =
    typeof webhookSecretRaw === 'string' && webhookSecretRaw.trim() !== ''
      ? webhookSecretRaw
      : undefined;
  if (!storeUrl || !consumerKey || !consumerSecret) {
    throw new IntegrationError(
      'VENDOR_AUTH',
      'woocommerce: the stored WooCommerce credentials are incomplete (store URL, consumer key and consumer secret are all required). Reconnect the store.'
    );
  }
  return { storeUrl, consumerKey, consumerSecret, webhookSecret };
}

/**
 * Normalise a merchant-typed store URL to its origin (no path, no trailing
 * slash). Throws VENDOR_AUTH when the URL is malformed, and VENDOR_ERROR
 * when it is plain HTTP on a non-loopback host (Basic Auth would leak the
 * consumer secret — the vendor docs recommend HTTPS).
 */
export function normalizeStoreUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new IntegrationError(
      'VENDOR_ERROR',
      'woocommerce: the store URL is not a valid URL (expected e.g. https://mystore.com).'
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new IntegrationError(
      'VENDOR_ERROR',
      'woocommerce: the store URL must start with https:// (or http:// for a local staging site).'
    );
  }
  const host = url.hostname.toLowerCase();
  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  if (url.protocol === 'http:' && !isLoopback) {
    throw new IntegrationError(
      'VENDOR_ERROR',
      'woocommerce: the store URL must use HTTPS — Basic Auth over plain HTTP would send the consumer secret in the clear. (http:// is allowed only for localhost staging.)'
    );
  }
  return `${url.protocol}//${url.host}`;
}

export class WooCommerceClient {
  readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(credentials: WooCommerceCredentials) {
    this.baseUrl = `${normalizeStoreUrl(credentials.storeUrl)}/wp-json/wc/v3`;
    // Basic Auth per the vendor docs: consumer key = username, consumer
    // secret = password. Built once; never logged.
    this.authHeader = `Basic ${Buffer.from(
      `${credentials.consumerKey}:${credentials.consumerSecret}`,
      'utf8'
    ).toString('base64')}`;
  }

  /**
   * One vendor call with the framework retry policy. Non-2xx responses
   * throw an axios-shaped error so mapVendorError turns them into a
   * user-facing IntegrationError (401/403 → VENDOR_AUTH, 429 →
   * VENDOR_RATE_LIMIT, 5xx → retryable VENDOR_ERROR).
   */
  async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    return withVendorRetry('woocommerce', async (signal) => {
      let response: Response;
      try {
        response = await fetch(url, {
          method,
          signal,
          headers: {
            Authorization: this.authHeader,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          body: body === undefined ? undefined : JSON.stringify(body)
        });
      } catch (error) {
        throw mapVendorError(error, 'woocommerce');
      }
      if (!response.ok) {
        let vendorCode: string | undefined;
        try {
          const data: any = await response.json();
          if (typeof data?.code === 'string') vendorCode = data.code;
        } catch {
          // Non-JSON error body — the status alone is enough to map.
        }
        throw mapVendorError(
          { response: { status: response.status, data: vendorCode ? { code: vendorCode } : {} } },
          'woocommerce'
        );
      }
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    });
  }

  /**
   * Paginated list helper. The vendor returns X-WP-TotalPages; this
   * follows pages 1..N until a page comes back short or the header says
   * to stop. Caps at 50 pages so a misbehaving store cannot loop us.
   */
  async listAll<T>(path: string, params: Record<string, string> = {}): Promise<T[]> {
    const out: T[] = [];
    for (let page = 1; page <= 50; page++) {
      const query = new URLSearchParams({ ...params, per_page: '100', page: String(page) });
      const url = `${this.baseUrl}${path}?${query.toString()}`;
      const pageItems = await withVendorRetry('woocommerce', async (signal) => {
        let response: Response;
        try {
          response = await fetch(url, {
            method: 'GET',
            signal,
            headers: { Authorization: this.authHeader, Accept: 'application/json' }
          });
        } catch (error) {
          throw mapVendorError(error, 'woocommerce');
        }
        if (!response.ok) {
          throw mapVendorError({ response: { status: response.status, data: {} } }, 'woocommerce');
        }
        const totalPages = Number(response.headers.get('X-WP-TotalPages') || '1');
        const items = (await response.json()) as T[];
        return { items, totalPages: Number.isFinite(totalPages) && totalPages > 0 ? totalPages : 1 };
      });
      out.push(...pageItems.items);
      if (page >= pageItems.totalPages || pageItems.items.length < 100) break;
    }
    return out;
  }
}
