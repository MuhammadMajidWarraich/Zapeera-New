// ─── Integrations framework — provider registry (feature/integration-framework) ─
// Static registry of every provider the framework knows about, plus the
// runtime handler registry provider modules plug into.
//
// EVIDENCE BASE: ~/workspace/zapeera/integrations/API_RESEARCH_2026-10-24.md
// (checked against public vendor docs 2026-10-24). Every capability,
// auth type, docs URL, sandbox flag and limitation below comes from that
// file. Do NOT invent vendor capabilities — if the research says "not
// verified", the limitation says so.
//
// Tier 3 is deliberately ABSENT: tiktok-shop (PK sellers cannot register),
// stripe (Pakistan not supported), paypal (no receiving payments in PK),
// bykea (no public API), trax (no public docs, weakest evidence).
// Those ids must never appear here; the registry test enforces it.
//
// A provider is CONNECTABLE only when a sync-handler module has been
// registered for it (registerIntegrationHandler). The framework ships
// ZERO handlers, so every card renders "Coming soon" until its builder
// lands. connectable is computed live — never stored.
import type {
  IntegrationProviderEntry,
  IntegrationProviderId,
  IntegrationSyncHandler
} from './types';

export const TIER_1_PROVIDERS: IntegrationProviderId[] = [
  'shopify',
  'woocommerce',
  'daraz',
  'jazzcash',
  'postex',
  'google-sheets'
];

export const TIER_2_PROVIDERS: IntegrationProviderId[] = [
  'easypaisa',
  'meta-commerce',
  'foodpanda',
  'mulphilog',
  'quickbooks',
  'xero',
  'twilio',
  'smsala',
  'tcs',
  'leopards'
];

/** Tier 3 — NOT feasible in Pakistan. Never register these. Enforced by test. */
export const EXCLUDED_TIER_3_PROVIDERS: string[] = [
  'tiktok-shop',
  'stripe',
  'paypal',
  'bykea',
  'trax'
];

export const INTEGRATION_REGISTRY: IntegrationProviderEntry[] = [
  // ── Tier 1 ──────────────────────────────────────────────────────────────
  {
    id: 'shopify',
    displayName: 'Shopify',
    category: 'sales-channel',
    capabilities: ['products', 'stock', 'orders', 'customers'],
    authType: 'oauth2',
    docsUrl: 'https://shopify.dev/docs/api',
    sandboxAvailable: true,
    limitation:
      'Stripe/PayPal checkout does not work in Pakistan — PK merchants use COD or local gateways.',
    tier: 1,
    credentialFields: [
      { key: 'shopDomain', label: 'Shop domain', secret: false, placeholder: 'mystore.myshopify.com' },
      { key: 'accessToken', label: 'Admin API access token', secret: true }
    ]
  },
  {
    id: 'woocommerce',
    displayName: 'WooCommerce',
    category: 'sales-channel',
    capabilities: ['products', 'stock', 'orders', 'customers'],
    authType: 'basic-auth',
    docsUrl: 'https://developer.woocommerce.com/docs/apis/rest-api/',
    sandboxAvailable: false,
    limitation: 'No hosted sandbox — a staging WordPress site is the test environment.',
    tier: 1,
    credentialFields: [
      { key: 'storeUrl', label: 'Store URL', secret: false, placeholder: 'https://mystore.com' },
      { key: 'consumerKey', label: 'Consumer key', secret: true },
      { key: 'consumerSecret', label: 'Consumer secret', secret: true },
      // Webhook signing secret (feature/integration-woocommerce): the
      // Secret set on each webhook in WooCommerce — NOT the consumer
      // secret (WooCommerce signs deliveries with the per-webhook
      // secret). Optional at connect time; required before webhook
      // deliveries are accepted. Add it later by reconnecting.
      {
        key: 'webhookSecret',
        label: 'Webhook secret',
        secret: true,
        optional: true,
        placeholder: 'Same secret as on the WooCommerce webhook'
      }
    ]
  },
  {
    id: 'daraz',
    displayName: 'Daraz',
    category: 'sales-channel',
    capabilities: ['products', 'stock', 'orders', 'shipments'],
    authType: 'hmac-signing',
    docsUrl: 'https://open.daraz.com/',
    sandboxAvailable: false,
    limitation:
      'No webhooks — polling only (orders every 15 min, hourly stock push). No true sandbox: the API Explorer runs against production data. Requires a Daraz seller account (CNIC/NTN + bank, verification 24–48h).',
    tier: 1,
    // Auth material (updated by feature/integration-daraz): the App Key
    // + Secret alone cannot call ANY Daraz business API — every call
    // needs a seller OAuth access token too (Lazada-compatible flow:
    // seller authorizes the app → code → /auth/token/create → tokens;
    // see src/integrations/daraz/README.md §1). The seller pastes the
    // tokens from that exchange into the connect dialog; the handler
    // auto-refreshes with the refresh token and persists rotations.
    credentialFields: [
      { key: 'appKey', label: 'App Key', secret: false },
      { key: 'appSecret', label: 'App Secret', secret: true },
      {
        key: 'accessToken',
        label: 'Seller Access Token',
        secret: true,
        placeholder: 'Paste the seller access token from the Daraz authorization exchange'
      },
      {
        key: 'refreshToken',
        label: 'Seller Refresh Token',
        secret: true,
        placeholder: 'Paste the seller refresh token (enables automatic token renewal)'
      }
    ]
  },
  {
    id: 'jazzcash',
    displayName: 'JazzCash',
    category: 'payments',
    capabilities: ['payments'],
    authType: 'hmac-signing',
    docsUrl: 'https://sandbox.jazzcash.com.pk/SandboxDocumentation/v4.2/index.html',
    sandboxAvailable: true,
    limitation: 'Payments only (no products/orders/stock). PKR only. Requires a JazzCash merchant account.',
    tier: 1,
    credentialFields: [
      { key: 'merchantId', label: 'Merchant ID', secret: false },
      { key: 'password', label: 'Password', secret: true },
      { key: 'salt', label: 'Integrity salt', secret: true }
    ]
  },
  {
    id: 'postex',
    displayName: 'PostEx',
    category: 'logistics',
    capabilities: ['shipments'],
    authType: 'oauth2',
    // No public docs page on postex.pk — API confirmed via merchant-issued
    // credentials + the Odoo integration listing (research §12).
    docsUrl: 'https://apps.odoo.com/apps/modules/16.0/ol_postex_courier',
    sandboxAvailable: true,
    limitation: 'Public API docs are merchant-gated — credentials and docs come from PostEx after onboarding.',
    tier: 1,
    credentialFields: [
      { key: 'clientId', label: 'Client ID', secret: false },
      { key: 'clientSecret', label: 'Client secret', secret: true },
      { key: 'companyCode', label: 'Company code', secret: false }
    ]
  },
  {
    id: 'google-sheets',
    displayName: 'Google Sheets',
    category: 'productivity',
    capabilities: ['export'],
    authType: 'oauth2',
    docsUrl: 'https://developers.google.com/workspace/sheets/api',
    sandboxAvailable: true,
    limitation: 'No native Sheets webhooks — export/sync only. Use a test spreadsheet as the sandbox.',
    tier: 1,
    credentialFields: [] // OAuth-only: no manual fields.
  },
  // ── Tier 2 ──────────────────────────────────────────────────────────────
  {
    id: 'easypaisa',
    displayName: 'Easypaisa',
    category: 'payments',
    capabilities: ['payments'],
    authType: 'basic-auth',
    docsUrl: null, // No public docs — integration PDF is issued with merchant credentials after approval.
    sandboxAvailable: false,
    limitation:
      'Docs are merchant-gated (PDF issued post-approval) and the staging env is gated behind merchant onboarding. PKR only.',
    tier: 2,
    credentialFields: [
      { key: 'username', label: 'Partner username', secret: false },
      { key: 'password', label: 'Partner password', secret: true },
      { key: 'storeId', label: 'Store ID', secret: false }
    ]
  },
  {
    id: 'meta-commerce',
    displayName: 'Meta Commerce (Facebook Shop + Instagram Shopping)',
    category: 'sales-channel',
    capabilities: ['products', 'stock'],
    authType: 'oauth2',
    docsUrl: 'https://developers.facebook.com/docs/marketing-api/catalog/reference',
    sandboxAvailable: true,
    limitation:
      'Product push only in Pakistan — native FB/IG checkout is NOT available in PK, so no order import. Catalog is a showcase + ads surface. App review required for catalog_management.',
    tier: 2,
    credentialFields: [
      { key: 'catalogId', label: 'Product catalog ID', secret: false }
    ]
  },
  {
    id: 'foodpanda',
    displayName: 'foodpanda',
    category: 'sales-channel',
    capabilities: ['products', 'stock', 'orders'],
    authType: 'oauth2',
    docsUrl: 'https://developer.foodpanda.com/',
    sandboxAvailable: false,
    limitation:
      'Partner-only — requires a foodpanda vendor account + account-manager-issued credentials. Sandbox not verified.',
    tier: 2,
    credentialFields: [
      { key: 'clientId', label: 'Client ID', secret: false },
      { key: 'clientSecret', label: 'Client secret', secret: true }
    ]
  },
  {
    id: 'mulphilog',
    displayName: 'M&P (Muller & Phipps)',
    category: 'logistics',
    capabilities: ['shipments'],
    authType: 'merchant-credentials',
    // No official public docs — API surface proven via the open-source client (research §10).
    docsUrl: 'https://jsr.io/@bine/mulphilog',
    sandboxAvailable: false,
    limitation: 'No official public docs — API surface proven via an open-source client. Credentials are issued by M&P.',
    tier: 2,
    credentialFields: [
      { key: 'username', label: 'Username', secret: false },
      { key: 'password', label: 'Password', secret: true },
      { key: 'accountNo', label: 'Account number', secret: false }
    ]
  },
  {
    id: 'quickbooks',
    displayName: 'QuickBooks Online',
    category: 'accounting',
    capabilities: ['customers', 'export'],
    authType: 'oauth2',
    docsUrl: 'https://developer.intuit.com/',
    sandboxAvailable: true,
    limitation:
      'Export-only. QBO subscription availability/sales in Pakistan not verified; low PK SME demand — Zapeera already has accounting.',
    tier: 2,
    credentialFields: [] // OAuth-only: no manual fields.
  },
  {
    id: 'xero',
    displayName: 'Xero',
    category: 'accounting',
    capabilities: ['customers', 'export'],
    authType: 'oauth2',
    docsUrl: 'https://developer.xero.com/',
    sandboxAvailable: true,
    limitation:
      'Export-only. Xero sales/availability in Pakistan not verified; low PK SME demand — Zapeera already has accounting.',
    tier: 2,
    credentialFields: [] // OAuth-only: no manual fields.
  },
  {
    id: 'twilio',
    displayName: 'Twilio (SMS)',
    category: 'messaging',
    capabilities: ['sms'],
    authType: 'basic-auth',
    docsUrl: 'https://www.twilio.com/docs',
    sandboxAvailable: true,
    limitation:
      'SMS only. USD-priced (~$0.0083/segment + carrier fees) — expensive vs local PKR gateways. PK sender-ID / PTA registration not verified.',
    tier: 2,
    credentialFields: [
      { key: 'accountSid', label: 'Account SID', secret: false },
      { key: 'authToken', label: 'Auth token', secret: true }
    ]
  },
  {
    id: 'smsala',
    displayName: 'SMSALA',
    category: 'messaging',
    capabilities: ['sms'],
    authType: 'api-key',
    docsUrl: 'https://smsala.com/en/developers/sms-api/',
    sandboxAvailable: true,
    limitation: 'SMS only. Global gateway (HQ UAE) with verified public docs — the low-cost PK route.',
    tier: 2,
    credentialFields: [
      { key: 'apiToken', label: 'API token', secret: true }
    ]
  },
  {
    id: 'tcs',
    displayName: 'TCS',
    category: 'logistics',
    capabilities: ['shipments'],
    authType: 'merchant-credentials',
    docsUrl: null, // No public developer docs on tcsexpress.com.
    sandboxAvailable: false,
    limitation:
      'No public docs — API access is requested from the TCS business team. Consider the Logistaan aggregator instead of one-by-one courier builds.',
    tier: 2,
    credentialFields: [
      { key: 'username', label: 'Username', secret: false },
      { key: 'password', label: 'Password', secret: true }
    ]
  },
  {
    id: 'leopards',
    displayName: 'Leopards Courier',
    category: 'logistics',
    capabilities: ['shipments'],
    authType: 'merchant-credentials',
    docsUrl: null, // No public docs; 17TRACK confirms no current public official tracking API.
    sandboxAvailable: false,
    limitation: 'No public docs and no confirmed public tracking API — API access via the Leopards business team.',
    tier: 2,
    credentialFields: [
      { key: 'username', label: 'Username', secret: false },
      { key: 'password', label: 'Password', secret: true }
    ]
  }
];

export function getProviderEntry(provider: string): IntegrationProviderEntry | undefined {
  return INTEGRATION_REGISTRY.find((entry) => entry.id === provider);
}

export function isKnownProvider(provider: string): provider is IntegrationProviderId {
  return getProviderEntry(provider) !== undefined;
}

export function listProviders(): IntegrationProviderEntry[] {
  return [...INTEGRATION_REGISTRY];
}

// ─── Runtime handler registry ─────────────────────────────────────────────
// Provider modules register exactly one handler each (usually from their
// module's index, imported once at server startup). The framework ships
// zero handlers — registration is what makes a provider connectable.
const handlers = new Map<IntegrationProviderId, IntegrationSyncHandler>();

export function registerIntegrationHandler(handler: IntegrationSyncHandler): void {
  if (!isKnownProvider(handler.provider)) {
    throw new Error(
      `Cannot register handler for unknown provider "${handler.provider}" — add it to INTEGRATION_REGISTRY first.`
    );
  }
  handlers.set(handler.provider, handler);
}

export function getIntegrationHandler(provider: string): IntegrationSyncHandler | undefined {
  return handlers.get(provider as IntegrationProviderId);
}

export function hasIntegrationHandler(provider: string): boolean {
  return handlers.has(provider as IntegrationProviderId);
}

/** A provider is connectable only once its builder has registered a handler. */
export function isProviderConnectable(provider: string): boolean {
  return isKnownProvider(provider) && hasIntegrationHandler(provider);
}

/** TEST-ONLY: clears the handler registry between tests. Never call in production code. */
export function clearIntegrationHandlers(): void {
  handlers.clear();
}
