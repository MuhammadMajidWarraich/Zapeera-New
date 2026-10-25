// ─── PostEx vendor client (feature/integration-postex) ────────────────────
// Thin HTTP client over the PostEx courier API: OAuth 2.0 client-credentials
// token acquisition with auto-refresh (in-memory cache, never persisted —
// the framework stores only the merchant's clientId/clientSecret/companyCode,
// encrypted), plus the shipment operations the Odoo listing evidences:
// create, real-time tracking + history, AWB label, cancel, return.
//
// ── HONEST LIMITATION — READ BEFORE "FIXING" THE URLS ──────────────────────
// PostEx publishes NO public API documentation on postex.pk (verified
// 2026-10-24: web search + postex.pk itself; the API is confirmed only via
// merchant-issued credentials and the Odoo listing at
// https://apps.odoo.com/apps/modules/16.0/ol_postex_courier, which names
// the capabilities but prints NO endpoint URLs or field names). Therefore:
//
//  * The API base URL is NOT hard-coded. It comes from the environment
//    (POSTEX_API_BASE_URL, or POSTEX_SANDBOX_API_BASE_URL when
//    POSTEX_API_ENVIRONMENT=sandbox), or from an `apiBaseUrl` credential.
//    Until a merchant supplies it, every vendor call fails closed with a
//    plain-language "base URL is not configured" error — the handler never
//    pretends to have verified credentials it could not reach.
//  * Every path in POSTEX_ENDPOINTS below is an UNVERIFIED PLACEHOLDER.
//    They are conventional REST shapes, kept in this ONE table so a single
//    correction from the merchant-issued docs fixes every call. Do NOT
//    present them as verified PostEx endpoints, and do NOT scatter
//    replacements through the codebase — correct this table only.
//  * Response parsing is deliberately tolerant (many candidate field names
//    for tracking number / status / label URL): the merchant docs, not
//    this file, are the authority on the real payload shape. A response
//    that carries no tracking number is treated as a failure, never
//    papered over.
//
// No live PostEx call is ever made in tests: pass a `fetchImpl` and assert
// against it (see tests/postex.test.ts).

import { IntegrationError, mapVendorError, withVendorRetry } from '../vendor-client';

export interface PostExCredentials {
  clientId: string;
  clientSecret: string;
  companyCode: string;
  /** Optional override for the API base URL (otherwise env — see above). */
  apiBaseUrl?: string;
}

export type PostExEnvironment = 'sandbox' | 'production';

export interface PostExClientOptions {
  credentials: PostExCredentials;
  /** Explicit base URL (tests). Overrides env + credentials.apiBaseUrl. */
  baseUrl?: string;
  environment?: PostExEnvironment;
  /** Injectable fetch (tests stub this — never hits live PostEx). */
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface PostExOrderPayload {
  orderRef: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  recipientCity?: string;
  paymentMethod: 'COD' | 'PREPAID';
  codAmount: number;
  pieces?: number;
  weightKg?: number;
  description?: string;
  senderName?: string;
  senderPhone?: string;
  senderAddress?: string;
}

export interface PostExCreatedShipment {
  trackingNumber: string;
  shipmentId?: string;
  labelUrl?: string | null;
  status: string;
  codAmount: number;
}

export interface PostExTrackingEvent {
  status: string;
  location?: string;
  timestamp?: string;
  description?: string;
}

export interface PostExTracking {
  trackingNumber: string;
  status: string;
  events: PostExTrackingEvent[];
}

/**
 * UNVERIFIED endpoint paths (see the header comment). Correct this table —
 * and only this table — from the merchant-issued PostEx docs at onboarding.
 */
export const POSTEX_ENDPOINTS = {
  /** OAuth 2.0 client-credentials token grant. */
  token: '/oauth/token',
  /** Courier/service list (Odoo "Fetch Couriers"). */
  couriers: '/couriers',
  /** Create a shipment / order. */
  createOrder: '/orders',
  /** Real-time tracking + history for one consignment. */
  trackOrder: (trackingNumber: string) => `/orders/${encodeURIComponent(trackingNumber)}/track`,
  /** AWB label for one consignment. */
  label: (trackingNumber: string) => `/orders/${encodeURIComponent(trackingNumber)}/label`,
  /** Cancel an active shipment. */
  cancelOrder: (trackingNumber: string) => `/orders/${encodeURIComponent(trackingNumber)}/cancel`,
  /** Create a return shipment for a delivered consignment. */
  returnOrder: (trackingNumber: string) => `/orders/${encodeURIComponent(trackingNumber)}/return`
} as const;

const PROVIDER = 'postex';

interface CachedToken {
  accessToken: string;
  expiresAtMs: number;
}

/**
 * Module-level token cache, keyed by base URL + client id + company code.
 * Handler instances are stateless and re-created per call (the framework
 * passes credentials in each time), so a per-instance cache would never
 * survive a single call — the cache has to live here. Tokens are memory
 * only, never persisted, and die with the process; each business's
 * credentials get their own entry.
 */
const TOKEN_CACHE = new Map<string, CachedToken>();

/** TEST-ONLY — clears the in-memory OAuth token cache. Never call in production code. */
export function clearPostExTokenCache(): void {
  TOKEN_CACHE.clear();
}

function readCredentials(input: Record<string, unknown>): PostExCredentials {
  const clientId = String(input.clientId ?? '').trim();
  const clientSecret = String(input.clientSecret ?? '').trim();
  const companyCode = String(input.companyCode ?? '').trim();
  if (!clientId || !clientSecret || !companyCode) {
    throw new IntegrationError(
      'VENDOR_AUTH',
      'postex: Client ID, Client Secret and Company Code are all required.'
    );
  }
  const apiBaseUrl =
    typeof input.apiBaseUrl === 'string' && input.apiBaseUrl.trim()
      ? input.apiBaseUrl.trim()
      : undefined;
  return { clientId, clientSecret, companyCode, apiBaseUrl };
}

export function postExCredentialsFromRecord(input: Record<string, unknown>): PostExCredentials {
  return readCredentials(input);
}

/** Pick the first present, non-empty string value among candidate keys. */
function pickString(obj: any, keys: string[]): string | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function pickNumber(obj: any, keys: string[]): number | undefined {
  if (!obj || typeof obj !== 'object') return undefined;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

/** Most PostEx-style responses wrap the payload in `data` — unwrap one level. */
function unwrap(body: any): any {
  if (body && typeof body === 'object' && 'data' in body && body.data !== undefined) return body.data;
  return body;
}

function normaliseStatus(raw: string | undefined, fallback: string): string {
  if (!raw) return fallback;
  return raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
}

export class PostExClient {
  private readonly credentials: PostExCredentials;
  private readonly baseUrl: string | undefined;
  private readonly fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  private readonly cacheKey: string;

  constructor(options: PostExClientOptions) {
    this.credentials = options.credentials;
    this.fetchImpl =
      options.fetchImpl ??
      ((url: string, init?: RequestInit) => fetch(url, init));
    const environment: PostExEnvironment =
      options.environment ??
      (process.env.POSTEX_API_ENVIRONMENT === 'sandbox' ? 'sandbox' : 'production');
    this.baseUrl =
      options.baseUrl ??
      this.credentials.apiBaseUrl ??
      ((environment === 'sandbox'
        ? process.env.POSTEX_SANDBOX_API_BASE_URL?.trim() || process.env.POSTEX_API_BASE_URL?.trim()
        : process.env.POSTEX_API_BASE_URL?.trim()) ||
        undefined);
    this.cacheKey = `${this.baseUrl ?? ''}|${this.credentials.clientId}|${this.credentials.companyCode}`;
  }

  private get cachedToken(): CachedToken | null {
    const entry = TOKEN_CACHE.get(this.cacheKey);
    return entry && entry.expiresAtMs > Date.now() ? entry : null;
  }

  private set cachedToken(value: CachedToken | null) {
    if (value) TOKEN_CACHE.set(this.cacheKey, value);
    else TOKEN_CACHE.delete(this.cacheKey);
  }

  /** The configured base URL, or undefined when no merchant supplied one. */
  get configuredBaseUrl(): string | undefined {
    return this.baseUrl;
  }

  private requireBaseUrl(): string {
    if (!this.baseUrl) {
      throw new IntegrationError(
        'VENDOR_ERROR',
        'postex: the PostEx API base URL is not configured. Set POSTEX_API_BASE_URL ' +
          '(and POSTEX_API_ENVIRONMENT=sandbox with POSTEX_SANDBOX_API_BASE_URL for the sandbox) ' +
          'from the API details PostEx issued with your merchant account, then reconnect.'
      );
    }
    return this.baseUrl.replace(/\/+$/, '');
  }

  /**
   * OAuth 2.0 client-credentials grant. The returned access token is cached
   * in memory until shortly before expiry; a 401 on any call invalidates
   * the cache and the call is retried once with a fresh token.
   */
  async getAccessToken(): Promise<string> {
    const cached = this.cachedToken;
    if (cached) return cached.accessToken;
    return withVendorRetry(PROVIDER, (signal) => this.fetchTokenOnce(signal));
  }

  /**
   * One token-grant attempt (no retry of its own). `getAccessToken` and
   * `request` each wrap this in their own withVendorRetry loop — a single
   * attempt here keeps the total attempts bounded instead of multiplying
   * nested retry loops.
   */
  private async fetchTokenOnce(signal?: AbortSignal): Promise<string> {
    const baseUrl = this.requireBaseUrl();
    let response: Response;
    try {
      response = await this.fetchImpl(`${baseUrl}${POSTEX_ENDPOINTS.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: this.credentials.clientId,
          client_secret: this.credentials.clientSecret,
          company_code: this.credentials.companyCode
        }),
        ...(signal ? { signal } : {})
      });
    } catch (error) {
      throw mapVendorError(error, PROVIDER);
    }
    if (!response.ok) {
      throw mapVendorError({ response: { status: response.status } }, PROVIDER);
    }
    const body = await this.safeJson(response);
    const data = unwrap(body);
    const accessToken = pickString(data, ['access_token', 'accessToken', 'token']);
    if (!accessToken) {
      throw new IntegrationError(
        'VENDOR_AUTH',
        'postex: the token endpoint did not return an access token. Check the Client ID, Client Secret and Company Code.'
      );
    }
    const expiresInSec = pickNumber(data, ['expires_in', 'expiresIn', 'expires']) ?? 3600;
    // 60s skew so a token never expires mid-call.
    this.cachedToken = {
      accessToken,
      expiresAtMs: Date.now() + Math.max(60, expiresInSec - 60) * 1000
    };
    return accessToken;
  }

  /** Cheap vendor verification: a successful token grant proves the credentials. */
  async verifyConnection(): Promise<boolean> {
    const token = await this.getAccessToken();
    return Boolean(token);
  }

  async createOrder(payload: PostExOrderPayload): Promise<PostExCreatedShipment> {
    const body = await this.request('POST', POSTEX_ENDPOINTS.createOrder, {
      orderRef: payload.orderRef,
      recipientName: payload.recipientName,
      recipientPhone: payload.recipientPhone,
      recipientAddress: payload.recipientAddress,
      ...(payload.recipientCity ? { recipientCity: payload.recipientCity } : {}),
      paymentMethod: payload.paymentMethod,
      codAmount: payload.codAmount,
      ...(payload.pieces !== undefined ? { pieces: payload.pieces } : {}),
      ...(payload.weightKg !== undefined ? { weightKg: payload.weightKg } : {}),
      ...(payload.description ? { description: payload.description } : {}),
      ...(payload.senderName ? { senderName: payload.senderName } : {}),
      ...(payload.senderPhone ? { senderPhone: payload.senderPhone } : {}),
      ...(payload.senderAddress ? { senderAddress: payload.senderAddress } : {})
    });
    const data = unwrap(body);
    const trackingNumber = pickString(data, [
      'trackingNumber',
      'tracking_number',
      'cnNumber',
      'cn_number',
      'consignmentNumber',
      'consignment_number',
      'trackingNo',
      'trackingId',
      'cn'
    ]);
    if (!trackingNumber) {
      throw new IntegrationError(
        'VENDOR_ERROR',
        'postex: PostEx accepted the shipment but returned no tracking number. Check the shipment in the PostEx merchant dashboard before re-booking.'
      );
    }
    return {
      trackingNumber,
      shipmentId: pickString(data, ['shipmentId', 'shipment_id', 'orderId', 'order_id', 'id']),
      labelUrl:
        pickString(data, ['labelUrl', 'label_url', 'awbUrl', 'awb_url', 'pdfUrl', 'pdf_url', 'downloadUrl']) ??
        null,
      status: normaliseStatus(
        pickString(data, ['status', 'orderStatus', 'shipmentStatus']),
        'BOOKED'
      ),
      codAmount: payload.codAmount
    };
  }

  async getTracking(trackingNumber: string): Promise<PostExTracking> {
    const body = await this.request('GET', POSTEX_ENDPOINTS.trackOrder(trackingNumber));
    const data = unwrap(body);
    const status = normaliseStatus(
      pickString(data, ['status', 'orderStatus', 'shipmentStatus', 'currentStatus']),
      'UNKNOWN'
    );
    const rawEvents = Array.isArray(data?.history)
      ? data.history
      : Array.isArray(data?.events)
        ? data.events
        : Array.isArray(data?.trackingHistory)
          ? data.trackingHistory
          : Array.isArray(data?.scans)
            ? data.scans
            : [];
    const events: PostExTrackingEvent[] = rawEvents.map((event: any) => ({
      status: normaliseStatus(
        pickString(event, ['status', 'event', 'description']),
        'UNKNOWN'
      ),
      location: pickString(event, ['location', 'city', 'hub']),
      timestamp: pickString(event, ['timestamp', 'date', 'createdAt', 'time']),
      description: pickString(event, ['description', 'remarks', 'note', 'comment'])
    }));
    return { trackingNumber, status, events };
  }

  /** AWB label URL when the vendor returns one; null when it does not. */
  async getLabelUrl(trackingNumber: string): Promise<string | null> {
    const body = await this.request('GET', POSTEX_ENDPOINTS.label(trackingNumber));
    const data = unwrap(body);
    if (typeof data === 'string' && data.startsWith('http')) return data;
    return (
      pickString(data, ['labelUrl', 'label_url', 'awbUrl', 'awb_url', 'pdfUrl', 'pdf_url', 'downloadUrl']) ??
      null
    );
  }

  async cancelOrder(trackingNumber: string): Promise<{ ok: boolean; status: string }> {
    const body = await this.request('POST', POSTEX_ENDPOINTS.cancelOrder(trackingNumber), {
      trackingNumber
    });
    const data = unwrap(body);
    const status = normaliseStatus(
      pickString(data, ['status', 'orderStatus', 'shipmentStatus']),
      'CANCELLED'
    );
    const ok =
      status === 'CANCELLED' ||
      data?.success === true ||
      data?.cancelled === true;
    return { ok, status };
  }

  async createReturn(trackingNumber: string): Promise<PostExCreatedShipment> {
    const body = await this.request('POST', POSTEX_ENDPOINTS.returnOrder(trackingNumber), {
      trackingNumber
    });
    const data = unwrap(body);
    const newTrackingNumber = pickString(data, [
      'trackingNumber',
      'tracking_number',
      'cnNumber',
      'cn_number',
      'consignmentNumber',
      'consignment_number',
      'trackingNo',
      'trackingId',
      'cn'
    ]);
    if (!newTrackingNumber) {
      throw new IntegrationError(
        'VENDOR_ERROR',
        'postex: PostEx accepted the return but returned no tracking number for the return leg. Check the PostEx merchant dashboard.'
      );
    }
    return {
      trackingNumber: newTrackingNumber,
      shipmentId: pickString(data, ['shipmentId', 'shipment_id', 'orderId', 'order_id', 'id']),
      labelUrl:
        pickString(data, ['labelUrl', 'label_url', 'awbUrl', 'awb_url', 'pdfUrl', 'pdf_url', 'downloadUrl']) ??
        null,
      status: normaliseStatus(
        pickString(data, ['status', 'orderStatus', 'shipmentStatus']),
        'RETURN_BOOKED'
      ),
      codAmount: 0
    };
  }

  // ─── internals ────────────────────────────────────────────────────────────

  private async safeJson(response: Response): Promise<any> {
    try {
      return await response.json();
    } catch {
      return {};
    }
  }

  /**
   * One authenticated vendor call with retry + a single token refresh on
   * 401. Non-2xx responses become IntegrationErrors via mapVendorError —
   * never raw fetch errors, never raw vendor payloads in the message.
   */
  private async request(method: 'GET' | 'POST', path: string, jsonBody?: unknown): Promise<any> {
    const baseUrl = this.requireBaseUrl();
    const attempt = async (token: string, signal?: AbortSignal): Promise<Response> => {
      const init: RequestInit = {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        ...(signal ? { signal } : {})
      };
      if (jsonBody !== undefined) init.body = JSON.stringify(jsonBody);
      return this.fetchImpl(`${baseUrl}${path}`, init);
    };

    return withVendorRetry(PROVIDER, async (signal) => {
      let token = this.cachedToken?.accessToken ?? (await this.fetchTokenOnce(signal));
      let response: Response;
      try {
        response = await attempt(token, signal);
      } catch (error) {
        throw mapVendorError(error, PROVIDER);
      }
      if (response.status === 401) {
        // Token may have expired server-side: drop the cache, re-auth once.
        this.cachedToken = null;
        token = await this.fetchTokenOnce(signal);
        try {
          response = await attempt(token, signal);
        } catch (error) {
          throw mapVendorError(error, PROVIDER);
        }
      }
      if (!response.ok) {
        throw mapVendorError({ response: { status: response.status } }, PROVIDER);
      }
      return this.safeJson(response);
    });
  }
}
