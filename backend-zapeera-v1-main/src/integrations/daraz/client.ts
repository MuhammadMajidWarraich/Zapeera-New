// ─── Daraz Open Platform client (feature/integration-daraz) ───────────────
// Lazada-compatible REST API served at https://api.daraz.pk/rest for
// Pakistani sellers. Evidence: ~/workspace/zapeera/integrations/
// API_RESEARCH_2026-10-24.md + open.daraz.com (Getting Started).
//
// Auth: App Key + HMAC-SHA256 request signing + seller OAuth access
// token. Signing (verified against the Lazada/Daraz signing doc and an
// independent integration write-up): every request is POST,
// application/x-www-form-urlencoded, with system params app_key,
// timestamp (ms), sign_method=sha256 and sign. The signature is
//
//   sign = UPPERCASE_HEX(HMAC-SHA256(appSecret,
//            apiPath + concat(sorted(key + value) for every param
//            except `sign` itself)))
//
// i.e. the API path prefixes the sorted parameter string. The seller
// access_token rides as an ordinary parameter on authorized calls.
//
// ⚠️ LIVE-VERIFICATION FLAG: no live Daraz call has ever been made from
// this codebase (no seller account exists yet). The endpoint NAMES
// (/products/get, /product/create, /product/update/price/quantity,
// /orders/get, /order/get, /order/items/get, /order/set_status,
// /auth/token/create, /auth/token/refresh) are the Lazada Open Platform
// names the Daraz Open Platform mirrors, and the request/response
// shapes below are the Lazada-compatible shapes. The first run against
// a real seller account MUST confirm each shape in the Daraz API
// Explorer (which runs against production data — there is no true
// sandbox) before the sync is trusted. See ./README.md § "Live
// verification checklist".

import * as crypto from 'crypto';
import { IntegrationError, mapVendorError, withVendorRetry } from '../vendor-client';

/** Pakistan gateway. Other Daraz countries use their own api.daraz.* host. */
export const DARAZ_API_BASE_URL = 'https://api.daraz.pk/rest';

/** Daraz docs home (also the registry docsUrl). */
export const DARAZ_DOCS_URL = 'https://open.daraz.com/';

// ─── Credentials ────────────────────────────────────────────────────────────

export interface DarazCredentials {
  appKey: string;
  appSecret: string;
  /** Seller OAuth access token (obtained via the authorization flow, README §1). */
  accessToken: string;
  /** Seller OAuth refresh token — enables automatic token rotation. */
  refreshToken?: string;
}

export interface DarazRefreshedTokens {
  accessToken: string;
  refreshToken?: string;
}

export interface DarazClientOptions {
  /** Override the base URL (tests / a future per-country gateway). */
  baseUrl?: string;
  /** Injectable fetch (tests stub the HTTP layer — never hit live Daraz). */
  fetchFn?: typeof fetch;
  /**
   * Called after a successful token refresh with the rotated tokens.
   * The handler persists them (encrypted) to the connection row so the
   * next run does not re-use the expired token.
   */
  onTokensRefreshed?: (tokens: DarazRefreshedTokens) => Promise<void>;
}

// ─── Signing ────────────────────────────────────────────────────────────────

/**
 * Daraz/Lazada request signature. `params` are ALL request parameters
 * except `sign` itself (system + business params, including the JSON
 * `payload` string when present). Pure function — unit-tested against a
 * fixed vector in tests/integrations-daraz.test.ts.
 */
export function buildDarazSign(
  apiPath: string,
  params: Record<string, string>,
  appSecret: string
): string {
  const keys = Object.keys(params)
    .filter((k) => k !== 'sign')
    .sort();
  let stringToSign = apiPath;
  for (const key of keys) stringToSign += key + params[key];
  return crypto.createHmac('sha256', appSecret).update(stringToSign, 'utf8').digest('hex').toUpperCase();
}

// ─── Response envelope ──────────────────────────────────────────────────────

/** Lazada-compatible envelope: code "0" is success, anything else an error. */
export interface DarazEnvelope<T = any> {
  code: string;
  message?: string;
  request_id?: string;
  data?: T;
}

const AUTH_ERROR_CODES = new Set([
  'InvalidAccessToken',
  'IllegalAccessToken',
  'AccessTokenExpired',
  'InvalidToken',
  'TokenExpired'
]);

function isDarazAuthFailure(code: string, message: string): boolean {
  if (AUTH_ERROR_CODES.has(code)) return true;
  const haystack = `${code} ${message}`.toLowerCase();
  return (
    haystack.includes('access token') &&
    (haystack.includes('invalid') || haystack.includes('expired'))
  );
}

// ─── Client ─────────────────────────────────────────────────────────────────

export class DarazClient {
  private readonly creds: DarazCredentials;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly onTokensRefreshed?: (tokens: DarazRefreshedTokens) => Promise<void>;
  private refreshInFlight: Promise<DarazRefreshedTokens> | null = null;

  constructor(credentials: DarazCredentials, opts: DarazClientOptions = {}) {
    this.creds = { ...credentials };
    this.baseUrl = (opts.baseUrl ?? DARAZ_API_BASE_URL).replace(/\/$/, '');
    this.fetchFn = opts.fetchFn ?? fetch;
    this.onTokensRefreshed = opts.onTokensRefreshed;
  }

  get accessToken(): string {
    return this.creds.accessToken;
  }

  get refreshToken(): string | undefined {
    return this.creds.refreshToken;
  }

  /** Expose the (possibly refreshed) credentials for the caller to persist. */
  currentCredentials(): DarazCredentials {
    return { ...this.creds };
  }

  private systemParams(extra: Record<string, string>): Record<string, string> {
    return {
      app_key: this.creds.appKey,
      timestamp: String(Date.now()),
      sign_method: 'sha256',
      ...extra
    };
  }

  private async postForm(
    apiPath: string,
    params: Record<string, string>,
    signal: AbortSignal
  ): Promise<DarazEnvelope> {
    const signed = { ...params, sign: buildDarazSign(apiPath, params, this.creds.appSecret) };
    const body = new URLSearchParams(signed).toString();
    const res = await this.fetchFn(`${this.baseUrl}${apiPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal
    });
    if (!res.ok) {
      // Surface the HTTP status so mapVendorError classifies it (401/403
      // → VENDOR_AUTH, 429 → VENDOR_RATE_LIMIT, 5xx → retryable).
      const error: any = new Error(`Daraz HTTP ${res.status}`);
      error.response = { status: res.status, data: await safeJson(res) };
      throw error;
    }
    const json = (await safeJson(res)) as DarazEnvelope;
    if (typeof json?.code !== 'string') {
      throw new IntegrationError(
        'VENDOR_ERROR',
        'daraz: the vendor returned a response without a result code.'
      );
    }
    return json;
  }

  /**
   * One signed call, with retry (429/5xx/network) via withVendorRetry and
   * one automatic token refresh + retry on an expired/invalid access
   * token. Throws IntegrationError (never a raw fetch/HTTP error).
   */
  async call<T = any>(
    apiPath: string,
    businessParams: Record<string, string> = {},
    opts: { authorized?: boolean; allowRefresh?: boolean } = {}
  ): Promise<T> {
    const authorized = opts.authorized !== false;
    const allowRefresh = opts.allowRefresh !== false;
    let refreshed = false;
    for (;;) {
      const params = this.systemParams({
        ...(authorized ? { access_token: this.creds.accessToken } : {}),
        ...businessParams
      });
      try {
        const envelope = await withVendorRetry('daraz', (signal) =>
          this.postForm(apiPath, params, signal)
        );
        if (envelope.code === '0') return (envelope.data ?? {}) as T;
        if (isDarazAuthFailure(envelope.code, envelope.message ?? '') && allowRefresh && !refreshed) {
          refreshed = true;
          await this.refreshAccessToken();
          continue;
        }
        if (isDarazAuthFailure(envelope.code, envelope.message ?? '')) {
          throw new IntegrationError(
            'VENDOR_AUTH',
            'daraz: the seller access token was rejected. Reconnect the Daraz account.',
            { vendorCode: envelope.code, retryable: false }
          );
        }
        throw new IntegrationError(
          'VENDOR_ERROR',
          `daraz: the vendor refused this call (${envelope.code}${envelope.message ? `: ${envelope.message}` : ''}).`,
          { vendorCode: envelope.code, retryable: false }
        );
      } catch (error) {
        const mapped = mapVendorError(error, 'daraz');
        // HTTP-level auth failure (401/403): same refresh-and-retry path.
        if (mapped.code === 'VENDOR_AUTH' && allowRefresh && !refreshed) {
          refreshed = true;
          await this.refreshAccessToken();
          continue;
        }
        throw mapped;
      }
    }
  }

  // ─── OAuth: authorization-code exchange + refresh ─────────────────────────

  /**
   * Exchange a seller authorization code for tokens. The code comes from
   * the seller authorizing the app in Daraz Seller Center / Open
   * Platform (response_type=code). Codes are single-use and short-lived.
   * NOTE: the framework stores exactly the credentials submitted at
   * connect time, so this exchange is a documented manual step (README
   * §1) — the seller pastes the resulting tokens into the connect
   * dialog — NOT something connect() can do and persist by itself.
   */
  async exchangeAuthCode(code: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
    account?: string;
  }> {
    const data = await this.call<{
      access_token: string;
      refresh_token: string;
      expires_in: number;
      account?: string;
    }>(
      '/auth/token/create',
      { code },
      { authorized: false, allowRefresh: false }
    );
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      account: data.account
    };
  }

  /**
   * Rotate the access token with the stored refresh token. Single-flight
   * per client so concurrent calls do not mint parallel tokens. The new
   * tokens are handed to onTokensRefreshed (the handler persists them).
   */
  async refreshAccessToken(): Promise<DarazRefreshedTokens> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      if (!this.creds.refreshToken) {
        throw new IntegrationError(
          'VENDOR_AUTH',
          'daraz: the seller access token expired and no refresh token is stored. Reconnect the Daraz account.',
          { retryable: false }
        );
      }
      const data = await this.call<{
        access_token: string;
        refresh_token?: string;
        expires_in: number;
      }>(
        '/auth/token/refresh',
        { refresh_token: this.creds.refreshToken },
        { authorized: false, allowRefresh: false }
      );
      const tokens: DarazRefreshedTokens = {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? this.creds.refreshToken
      };
      this.creds.accessToken = tokens.accessToken;
      if (tokens.refreshToken) this.creds.refreshToken = tokens.refreshToken;
      if (this.onTokensRefreshed) await this.onTokensRefreshed(tokens);
      return tokens;
    })();
    try {
      return await this.refreshInFlight;
    } finally {
      this.refreshInFlight = null;
    }
  }

  // ─── Products ─────────────────────────────────────────────────────────────

  /**
   * List seller products (paginated). `filter`: 'all' | 'active' |
   * 'inactive' | 'deleted' | 'image-missing' | 'sold-out' (Lazada
   * filter values). Response data: { total_products, products: [{
   * item_id, status, attributes: { name, ... }, skus: [{ SellerSku,
   * price, special_price, quantity, ... }] }] }.
   */
  async getProducts(opts: { filter?: string; offset?: number; limit?: number } = {}): Promise<{
    totalProducts: number;
    products: DarazProduct[];
  }> {
    const data = await this.call<any>('/products/get', {
      filter: opts.filter ?? 'all',
      offset: String(opts.offset ?? 0),
      limit: String(opts.limit ?? 100)
    });
    const raw = Array.isArray(data?.products) ? data.products : [];
    return {
      totalProducts: Number(data?.total_products ?? raw.length),
      products: raw.map(normalizeDarazProduct)
    };
  }

  /** Single product by item id (used only for diagnostics, not in sync). */
  async getProduct(itemId: string): Promise<DarazProduct | null> {
    const data = await this.call<any>('/product/get', { item_id: itemId });
    return data ? normalizeDarazProduct(data) : null;
  }

  /**
   * Create a listing. The product payload is sent as the JSON `payload`
   * form field (Lazada REST shape). Returns the created item id.
   */
  async createProduct(payload: DarazCreateProductPayload): Promise<{ itemId: string }> {
    const data = await this.call<any>('/product/create', {
      payload: JSON.stringify(payload)
    });
    const itemId = data?.item_id ?? data?.product_id;
    if (!itemId) {
      throw new IntegrationError(
        'VENDOR_ERROR',
        'daraz: product creation returned no item id.'
      );
    }
    return { itemId: String(itemId) };
  }

  /**
   * Push price + stock for up to 50 SKUs in one call (Lazada batch
   * limit). The handler chunks larger runs. Payload: one `payload`
   * JSON field: { Request: { Product: { Skus: { Sku: [...] } } } }
   * (the Lazada XML-era envelope, still the documented REST shape).
   */
  async updatePriceQuantity(
    skus: Array<{ SellerSku: string; price: number; quantity: number }>
  ): Promise<void> {
    if (skus.length === 0) return;
    await this.call('/product/update/price/quantity', {
      payload: JSON.stringify({
        Request: {
          Product: {
            Skus: {
              Sku: skus.map((s) => ({
                SellerSku: s.SellerSku,
                price: roundMoney(s.price),
                quantity: Math.max(0, Math.floor(s.quantity))
              }))
            }
          }
        }
      })
    });
  }

  // ─── Orders ───────────────────────────────────────────────────────────────

  /**
   * List orders. Either created_after or updated_after is mandatory
   * (Daraz). Pagination is offset/limit (limit ≤ 100, and
   * offset + limit must stay < 5000 — shorten the window instead of
   * paging past it). sort_by: 'created_at' | 'updated_at';
   * sort_direction: 'ASC' | 'DESC'.
   */
  async getOrders(opts: {
    createdAfter?: string;
    updatedAfter?: string;
    createdBefore?: string;
    updatedBefore?: string;
    status?: string;
    sortBy?: string;
    sortDirection?: 'ASC' | 'DESC';
    offset?: number;
    limit?: number;
  }): Promise<{ count: number; orders: DarazOrderHeader[] }> {
    const params: Record<string, string> = {
      sort_by: opts.sortBy ?? 'updated_at',
      sort_direction: opts.sortDirection ?? 'ASC',
      offset: String(opts.offset ?? 0),
      limit: String(opts.limit ?? 100)
    };
    if (opts.createdAfter) params.created_after = opts.createdAfter;
    if (opts.updatedAfter) params.updated_after = opts.updatedAfter;
    if (opts.createdBefore) params.created_before = opts.createdBefore;
    if (opts.updatedBefore) params.updated_before = opts.updatedBefore;
    if (opts.status) params.status = opts.status;
    const data = await this.call<any>('/orders/get', params);
    const raw = Array.isArray(data?.orders) ? data.orders : [];
    return { count: Number(data?.count ?? raw.length), orders: raw.map(normalizeDarazOrderHeader) };
  }

  /** One order header (customer, addresses, totals, statuses). */
  async getOrder(orderId: string): Promise<DarazOrder> {
    const data = await this.call<any>('/order/get', { order_id: orderId });
    return normalizeDarazOrder(data);
  }

  /** Order lines (SellerSku, prices, quantities, per-item statuses). */
  async getOrderItems(orderId: string): Promise<DarazOrderItem[]> {
    const data = await this.call<any>('/order/items/get', { order_id: orderId });
    const raw = Array.isArray(data) ? data : Array.isArray(data?.order_items) ? data.order_items : [];
    return raw.map(normalizeDarazOrderItem);
  }

  /**
   * Set the fulfilment status of an order's items. `status`:
   * 'packed' | 'ready_to_ship' (Daraz's seller fulfilment steps).
   * The Lazada shape takes the order's item ids; the handler resolves
   * them via getOrderItems first.
   */
  async setOrderStatus(orderItemIds: Array<string | number>, status: 'packed' | 'ready_to_ship'): Promise<void> {
    await this.call('/order/set_status', {
      order_item_ids: JSON.stringify(orderItemIds.map(String)),
      status
    });
  }
}

// ─── Daraz API shapes (normalized) ──────────────────────────────────────────

export interface DarazSku {
  sellerSku: string;
  price: number;
  specialPrice?: number;
  quantity: number;
  status?: string;
}

export interface DarazProduct {
  itemId: string;
  status?: string;
  name?: string;
  skus: DarazSku[];
}

export interface DarazCreateProductPayload {
  PrimaryCategory: string;
  Attributes: {
    name: string;
    short_description?: string;
    brand: string;
    [key: string]: unknown;
  };
  Skus: {
    Sku: Array<{
      SellerSku: string;
      quantity: number;
      price: number;
      package_length?: number;
      package_height?: number;
      package_weight?: number;
      package_width?: number;
      package_content?: string;
      Images?: { Image: string[] };
    }>;
  };
}

export interface DarazOrderHeader {
  orderNumber: string;
  orderId: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  statuses?: string[];
  price?: number;
  paymentMethod?: string;
  customerFirstName?: string;
  customerLastName?: string;
}

export interface DarazOrder extends DarazOrderHeader {
  shippingFee?: number;
  voucher?: number;
  addressShipping?: {
    firstName?: string;
    lastName?: string;
    phone?: string;
    phone2?: string;
    address1?: string;
    address2?: string;
    city?: string;
    postCode?: string;
    country?: string;
  };
  addressBilling?: { phone?: string };
}

export interface DarazOrderItem {
  orderItemId: string;
  orderId: string;
  sellerSku: string;
  name?: string;
  itemPrice: number;
  paidPrice: number;
  quantity: number;
  status?: string;
  variation?: string;
}

function normalizeDarazProduct(raw: any): DarazProduct {
  const skusRaw = raw?.skus ?? [];
  const list = Array.isArray(skusRaw) ? skusRaw : [];
  return {
    itemId: String(raw?.item_id ?? raw?.itemId ?? ''),
    status: raw?.status,
    name: raw?.attributes?.name,
    skus: list.map((s: any) => ({
      sellerSku: String(s?.SellerSku ?? s?.seller_sku ?? ''),
      price: Number(s?.price ?? 0),
      specialPrice: s?.special_price !== undefined ? Number(s.special_price) : undefined,
      quantity: Number(s?.quantity ?? 0),
      status: s?.status
    }))
  };
}

function normalizeDarazOrderHeader(raw: any): DarazOrderHeader {
  const orderNumber = String(raw?.order_number ?? raw?.order_id ?? raw?.orderId ?? '');
  return {
    orderNumber,
    orderId: orderNumber,
    createdAt: String(raw?.created_at ?? ''),
    updatedAt: String(raw?.updated_at ?? raw?.created_at ?? ''),
    status: String(raw?.status ?? raw?.order_status ?? ''),
    statuses: Array.isArray(raw?.statuses) ? raw.statuses.map(String) : undefined,
    price: raw?.price !== undefined ? Number(raw.price) : undefined,
    paymentMethod: raw?.payment_method,
    customerFirstName: raw?.customer_first_name,
    customerLastName: raw?.customer_last_name
  };
}

function normalizeDarazOrder(raw: any): DarazOrder {
  const header = normalizeDarazOrderHeader(raw);
  const shipping = raw?.address_shipping ?? {};
  const billing = raw?.address_billing ?? {};
  return {
    ...header,
    shippingFee: raw?.shipping_fee !== undefined ? Number(raw.shipping_fee) : undefined,
    voucher: raw?.voucher !== undefined ? Number(raw.voucher) : undefined,
    addressShipping: {
      firstName: shipping?.first_name,
      lastName: shipping?.last_name,
      phone: shipping?.phone,
      phone2: shipping?.phone2,
      address1: shipping?.address1,
      address2: shipping?.address2,
      city: shipping?.city,
      postCode: shipping?.post_code,
      country: shipping?.country
    },
    addressBilling: { phone: billing?.phone }
  };
}

function normalizeDarazOrderItem(raw: any): DarazOrderItem {
  return {
    orderItemId: String(raw?.order_item_id ?? raw?.orderItemId ?? ''),
    orderId: String(raw?.order_id ?? ''),
    sellerSku: String(raw?.sku ?? raw?.SellerSku ?? raw?.seller_sku ?? ''),
    name: raw?.name,
    itemPrice: Number(raw?.item_price ?? 0),
    paidPrice: Number(raw?.paid_price ?? raw?.item_price ?? 0),
    quantity: Number(raw?.quantity ?? 0),
    status: raw?.status,
    variation: raw?.variation
  };
}

async function safeJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function roundMoney(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}
