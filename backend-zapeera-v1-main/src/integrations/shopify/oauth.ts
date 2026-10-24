// ─── Shopify integration — OAuth 2.0 (feature/integration-shopify) ───────
// Authorization-code flow for a standalone/public app (Shopify docs:
// "Authenticate a standalone or API-only app").
//
//   1. Merchant clicks "Connect with Shopify" in Settings (or opens the
//      install URL) with ?shop=<store>.myshopify.com.
//   2. GET /oauth/install (authenticated, OWNER/MANAGER) builds a signed
//      state (businessId + shop + nonce + expiry, HMAC-SHA256 with the
//      app's API secret) and redirects to:
//        https://{shop}/admin/oauth/authorize
//          ?client_id={SHOPIFY_API_KEY}&scope={SCOPES}
//          &redirect_uri={SHOPIFY_APP_URL}/api/v1/integrations/shopify/oauth/callback
//          &state={state}
//      No grant_options[] is sent: the default is an OFFLINE (non-expiring)
//      access token, which is what background sync needs. (per-user /
//      online tokens expire with the merchant's session.)
//   3. Shopify redirects back with ?code&shop&state&hmac&timestamp.
//      The callback verifies Shopify's HMAC over the query params, then
//      the state signature + expiry, then exchanges the code:
//        POST https://{shop}/admin/oauth/access_token
//          { client_id, client_secret, code } -> { access_token, scope }
//   4. The token is stored through the framework's connectProvider —
//      which verifies it with a shop read and encrypts it before
//      storage — exactly like a manual connect. The merchant's existing
//      connection config (branch mapping, sync toggles) is preserved
//      across a reconnect.
//
// ENV (see .env.example): SHOPIFY_API_KEY + SHOPIFY_API_SECRET from the
// Partner Dashboard / Dev Dashboard (app credentials); SHOPIFY_APP_URL =
// the public base URL of THIS backend (the redirect_uri host — must be
// registered in the app's redirect URLs); SHOPIFY_OAUTH_RETURN_URL =
// the frontend Settings URL to send the merchant back to (optional —
// without it the callback answers with a plain HTML notice).
//
// The state is the callback's auth: it is HMAC-signed with the API
// secret, carries the business that initiated the install, and expires
// after 10 minutes. The callback route itself is unauthenticated —
// Shopify's query HMAC + the state signature are what prove the
// request came from a real install the merchant started.
import * as crypto from 'crypto';
import { IntegrationError, mapVendorError, withVendorRetry } from '../vendor-client';
import { connectProvider, normalizeSyncConfig } from '../../services/integration.service';
import { normalizeShopDomain, SHOPIFY_SCOPES } from './client';

export interface ShopifyOAuthConfig {
  apiKey: string;
  apiSecret: string;
  /** Public base URL of this backend, e.g. https://api.zapeera.seikho.online */
  appUrl: string;
  /** Frontend Settings URL to return the merchant to (optional). */
  returnUrl: string | null;
}

export function getShopifyOAuthConfig(): ShopifyOAuthConfig {
  const apiKey = String(process.env.SHOPIFY_API_KEY ?? '').trim();
  const apiSecret = String(process.env.SHOPIFY_API_SECRET ?? '').trim();
  const appUrl = String(process.env.SHOPIFY_APP_URL ?? '').trim().replace(/\/+$/, '');
  if (!apiKey || !apiSecret) {
    throw new IntegrationError(
      'VENDOR_ERROR',
      'shopify: OAuth is not configured on this server (SHOPIFY_API_KEY / SHOPIFY_API_SECRET are missing). Use a custom-app access token instead, or ask the server owner to configure the Shopify app.'
    );
  }
  if (!appUrl) {
    throw new IntegrationError(
      'VENDOR_ERROR',
      'shopify: OAuth is not configured on this server (SHOPIFY_APP_URL is missing — the public URL this backend is reached at).'
    );
  }
  const returnUrl = String(process.env.SHOPIFY_OAUTH_RETURN_URL ?? '').trim() || null;
  return { apiKey, apiSecret, appUrl, returnUrl };
}

export function shopifyCallbackUrl(appUrl: string): string {
  return `${appUrl}/api/v1/integrations/shopify/oauth/callback`;
}

// ─── State (signed install intent) ────────────────────────────────────────

export interface ShopifyOAuthState {
  businessId: string;
  shop: string;
  nonce: string;
  exp: number;
}

const STATE_TTL_MS = 10 * 60 * 1000;

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** Sign { businessId, shop, nonce, exp } — returns "payload.signature". */
export function signOAuthState(payload: ShopifyOAuthState, secret: string): string {
  const encoded = base64url(JSON.stringify(payload));
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('hex');
  return `${encoded}.${signature}`;
}

/** Verify a state string; returns the payload or null (bad/expired). */
export function verifyOAuthState(
  state: string | null | undefined,
  secret: string,
  nowMs: number = Date.now()
): ShopifyOAuthState | null {
  if (!state || typeof state !== 'string') return null;
  const dot = state.lastIndexOf('.');
  if (dot <= 0) return null;
  const encoded = state.slice(0, dot);
  const signature = state.slice(dot + 1);
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest('hex');
  const sigBuf = Buffer.from(signature, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as ShopifyOAuthState;
    if (!payload?.businessId || !payload?.shop || !payload?.exp) return null;
    if (payload.exp < nowMs) return null;
    return payload;
  } catch {
    return null;
  }
}

// ─── Install URL ──────────────────────────────────────────────────────────

export function buildAuthorizeUrl(
  cfg: ShopifyOAuthConfig,
  shopDomain: string,
  businessId: string
): string {
  const state = signOAuthState(
    {
      businessId,
      shop: shopDomain,
      nonce: crypto.randomBytes(16).toString('hex'),
      exp: Date.now() + STATE_TTL_MS
    },
    cfg.apiSecret
  );
  const params = new URLSearchParams({
    client_id: cfg.apiKey,
    scope: SHOPIFY_SCOPES,
    redirect_uri: shopifyCallbackUrl(cfg.appUrl),
    state
  });
  return `https://${shopDomain}/admin/oauth/authorize?${params.toString()}`;
}

// ─── Callback HMAC (Shopify's documented query validation) ───────────────
// Every query param except `hmac` is sorted by key, rendered as
// "key=value" with % -> %25 and & -> %26 inside the value, joined with
// "&"; the HMAC-SHA256 (hex) of that string with the API secret must
// equal the `hmac` param (constant-time compare).

export function verifyCallbackHmac(
  query: Record<string, string | string[] | undefined>,
  secret: string
): boolean {
  const hmac = query.hmac;
  if (typeof hmac !== 'string' || hmac === '') return false;
  const pairs = Object.keys(query)
    .filter((key) => key !== 'hmac' && key !== 'signature')
    .sort()
    .map((key) => {
      const value = String(query[key] ?? '');
      return `${key}=${value.replace(/%/g, '%25').replace(/&/g, '%26')}`;
    });
  const message = pairs.join('&');
  const expected = crypto.createHmac('sha256', secret).update(message).digest('hex');
  const a = Buffer.from(hmac, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ─── Code -> token exchange ───────────────────────────────────────────────

export async function exchangeCodeForToken(
  cfg: ShopifyOAuthConfig,
  shopDomain: string,
  code: string
): Promise<string> {
  const token = await withVendorRetry('shopify', async (signal) => {
    let res: Response;
    try {
      res = await fetch(`https://${shopDomain}/admin/oauth/access_token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: cfg.apiKey,
          client_secret: cfg.apiSecret,
          code
        }),
        signal
      });
    } catch (error) {
      throw mapVendorError(error, 'shopify');
    }
    if (!res.ok) {
      const error = new Error(`Shopify OAuth token exchange HTTP ${res.status}`) as Error & {
        status?: number;
        response?: { status: number };
      };
      error.status = res.status;
      error.response = { status: res.status };
      throw error;
    }
    return (await res.json()) as any;
  });
  const accessToken = String(token?.access_token ?? '').trim();
  if (!accessToken) {
    throw new IntegrationError(
      'VENDOR_ERROR',
      'shopify: the token exchange returned no access token. Try the install again.'
    );
  }
  return accessToken;
}

// ─── Callback orchestration ───────────────────────────────────────────────

export interface OAuthCallbackOutcome {
  ok: boolean;
  businessId: string | null;
  shopDomain: string | null;
  message: string;
}

/**
 * Full callback handling (HMAC -> state -> code exchange -> framework
 * connect). Returns an outcome; the route turns it into a redirect (or
 * a plain page when no return URL is configured). Throws only for
 * server misconfiguration (missing OAuth env).
 */
export async function handleOAuthCallback(
  prisma: any,
  query: Record<string, string | string[] | undefined>
): Promise<OAuthCallbackOutcome> {
  const cfg = getShopifyOAuthConfig();
  const shopParam = typeof query.shop === 'string' ? query.shop : '';
  const code = typeof query.code === 'string' ? query.code : '';
  const stateParam = typeof query.state === 'string' ? query.state : '';

  if (!verifyCallbackHmac(query, cfg.apiSecret)) {
    return {
      ok: false,
      businessId: null,
      shopDomain: null,
      message: 'The callback failed Shopify\u2019s HMAC check — it did not come from Shopify. Try the install again.'
    };
  }
  const state = verifyOAuthState(stateParam, cfg.apiSecret);
  if (!state) {
    return {
      ok: false,
      businessId: null,
      shopDomain: null,
      message: 'The install request expired or was tampered with. Start the Shopify connect again from Settings.'
    };
  }
  let shopDomain: string;
  try {
    shopDomain = normalizeShopDomain(shopParam || state.shop);
  } catch {
    return { ok: false, businessId: state.businessId, shopDomain: null, message: 'The shop domain in the callback is not a valid myshopify.com domain.' };
  }
  if (shopDomain !== state.shop) {
    return {
      ok: false,
      businessId: state.businessId,
      shopDomain,
      message: 'The shop in the callback does not match the shop the install started for.'
    };
  }
  if (!code) {
    return { ok: false, businessId: state.businessId, shopDomain, message: 'Shopify did not return an authorization code.' };
  }

  let accessToken: string;
  try {
    accessToken = await exchangeCodeForToken(cfg, shopDomain, code);
  } catch (error) {
    return {
      ok: false,
      businessId: state.businessId,
      shopDomain,
      message:
        error instanceof IntegrationError
          ? error.message
          : 'The token exchange with Shopify failed. Try the install again.'
    };
  }

  // Preserve the connection's existing config (branch mapping + sync
  // toggles) across a reconnect; a first connect gets all syncs on.
  let configInput: unknown = {
    syncProducts: true,
    syncStock: true,
    syncOrders: true,
    syncCustomers: false,
    direction: 'both'
  };
  try {
    const existing = await prisma.integrationConnection.findUnique({
      where: { businessId_provider: { businessId: state.businessId, provider: 'shopify' } }
    });
    if (existing?.config) {
      const parsed = normalizeSyncConfig(JSON.parse(existing.config));
      configInput = { ...parsed, branchId: (parsed as any).branchId ?? undefined };
    }
  } catch {
    // A stored-config read failure must not block the connect; the
    // defaults above apply and the merchant can re-pick in Settings.
  }

  try {
    await connectProvider(
      prisma,
      state.businessId,
      'shopify',
      { shopDomain, accessToken },
      configInput
    );
  } catch (error) {
    return {
      ok: false,
      businessId: state.businessId,
      shopDomain,
      message:
        error instanceof IntegrationError
          ? error.message
          : 'Shopify accepted the install but the connection could not be saved. Try again from Settings.'
    };
  }
  return {
    ok: true,
    businessId: state.businessId,
    shopDomain,
    message: `Shopify store ${shopDomain} connected.`
  };
}
