// ─── Integrations framework — shared types (feature/integration-framework) ─
// ONE shared file for the types every provider module implements against.
// Provider builders: import from here (and from ./registry and
// ./vendor-client). Do NOT redefine these locally.
//
// Provider ids are the Tier 1 + Tier 2 vendors verified in
// ~/workspace/zapeera/integrations/API_RESEARCH_2026-10-24.md.
// Tier 3 (tiktok-shop, stripe, paypal, bykea, trax) is deliberately
// NOT in this union — those vendors are not feasible in Pakistan and
// must never be offered as connectable.

/** Every provider the framework knows about (Tier 1 + Tier 2). */
export type IntegrationProviderId =
  | 'shopify'
  | 'woocommerce'
  | 'daraz'
  | 'jazzcash'
  | 'postex'
  | 'google-sheets'
  | 'easypaisa'
  | 'meta-commerce'
  | 'foodpanda'
  | 'mulphilog'
  | 'quickbooks'
  | 'xero'
  | 'twilio'
  | 'smsala'
  | 'tcs'
  | 'leopards';

export type IntegrationCategory =
  | 'sales-channel'
  | 'payments'
  | 'logistics'
  | 'accounting'
  | 'productivity'
  | 'messaging';

export type IntegrationCapability =
  | 'products'
  | 'stock'
  | 'orders'
  | 'customers'
  | 'payments'
  | 'shipments'
  | 'export'
  | 'sms';

export type IntegrationAuthType =
  | 'oauth2'
  | 'api-key'
  | 'basic-auth'
  | 'hmac-signing'
  | 'merchant-credentials';

export type IntegrationConnectionStatus = 'connected' | 'disconnected' | 'error';

/** Inbound (vendor -> Zapeera), outbound (Zapeera -> vendor), or both. */
export type IntegrationSyncDirection = 'in' | 'out' | 'both';

export type IntegrationSyncEntity =
  | 'product'
  | 'stock'
  | 'order'
  | 'customer'
  | 'payment'
  | 'shipment';

/** What syncs for one connection (stored as JSON in IntegrationConnection.config). */
export interface IntegrationSyncConfig {
  syncProducts: boolean;
  syncStock: boolean;
  syncOrders: boolean;
  syncCustomers: boolean;
  direction: IntegrationSyncDirection;
  /**
   * The ONE branch a single-shop provider (Daraz) maps to. Optional and
   * generic: when unset, the provider resolves the business's single
   * active branch and fails loudly on multi-branch businesses instead
   * of guessing. Set via the connect payload's config (the Settings
   * dialog does not collect it yet — wave follow-up: branch picker).
   */
  branchId?: string;
  /**
   * Daraz-only: the Daraz PrimaryCategory id used when syncProducts
   * CREATES a listing for a Zapeera product that is not listed yet.
   * Without it, unlisted products are reported (not created).
   */
  darazCategoryId?: string;
}

export const DEFAULT_SYNC_CONFIG: IntegrationSyncConfig = {
  syncProducts: false,
  syncStock: false,
  syncOrders: false,
  syncCustomers: false,
  direction: 'both'
};

/** One manual credential input rendered by the Settings connect dialog. */
export interface IntegrationCredentialField {
  /** Key inside the credentials object sent to POST /:provider/connect. */
  key: string;
  label: string;
  /** Rendered as a password input; never echoed back by any API. */
  secret: boolean;
  placeholder?: string;
}

/** Static, vendor-neutral registry entry (see ./registry.ts). */
export interface IntegrationProviderEntry {
  id: IntegrationProviderId;
  displayName: string;
  category: IntegrationCategory;
  capabilities: IntegrationCapability[];
  authType: IntegrationAuthType;
  /** null when the vendor publishes no public docs (Easypaisa, TCS, Leopards). */
  docsUrl: string | null;
  /** A test/sandbox environment exists (or a test spreadsheet / staging site is the test env). */
  sandboxAvailable: boolean;
  /** Honest limitation from the API research — shown on the provider card. */
  limitation?: string;
  /** 1 = build now, 2 = build after Tier 1 (research ranking). */
  tier: 1 | 2;
  /** Manual credential inputs; [] means OAuth-only (no manual fields). */
  credentialFields: IntegrationCredentialField[];
}

/** Registry entry + live per-business state (GET /api/integrations). */
export interface IntegrationProviderWithStatus extends IntegrationProviderEntry {
  /** True only when a sync-handler module is registered for this provider. */
  connectable: boolean;
  status: IntegrationConnectionStatus;
  hasCredentials: boolean;
  config: IntegrationSyncConfig | null;
  lastSyncAt: string | null;
  lastError: string | null;
}

/** The only connection shape any API ever returns — credentials NEVER included. */
export interface IntegrationConnectionView {
  provider: IntegrationProviderId;
  status: IntegrationConnectionStatus;
  hasCredentials: boolean;
  config: IntegrationSyncConfig;
  lastSyncAt: string | null;
  lastError: string | null;
  updatedAt: string | null;
}

/** Context handed to every sync-handler method. */
export interface IntegrationSyncContext {
  /** Prisma client (repo convention: passed in, never imported globally). */
  prisma: any;
  businessId: string;
  /** Decrypted credentials for this connection (server-side only). */
  credentials: Record<string, unknown>;
  config: IntegrationSyncConfig;
  /** The IntegrationSyncLog row id for this run (handlers may append detail via the service). */
  logId: string;
}

export interface IntegrationSyncResult {
  recordsProcessed: number;
  recordsFailed: number;
  message?: string;
}

/**
 * THE sync-handler interface. Every provider module implements this and
 * registers exactly one instance via registerIntegrationHandler().
 *
 * - connect: verify the credentials against the vendor (a cheap read, e.g.
 *   "list one product" / "get account") and return { ok: true } only when
 *   the vendor accepted them. NEVER return { ok: true } without a vendor
 *   round-trip — the stored status must never lie.
 * - disconnect: revoke/invalidate the vendor-side grant where the vendor
 *   supports it; local credential wipe is done by the framework regardless.
 * - getStatus: cheap vendor liveness check used by GET /:provider/status.
 *   All three take the connection's decrypted credentials: handler
 *   instances are registered once globally and are stateless — they must
 *   never hold one business's credentials.
 * - syncProducts / syncStock / importOrders: optional per provider — a
 *   provider implements only the directions its API supports. The
 *   framework returns 501 NOT_IMPLEMENTED for unimplemented methods.
 * - createShipment: the generic fulfilment step, added by the PostEx
 *   builder and reused by Daraz pack/ready-to-ship (and future
 *   couriers). The service builds the vendor-neutral input from a
 *   Zapeera sale (recipient from the customer, COD = unpaid balance,
 *   parcel from the lines) — handlers never build it themselves.
 *   getTracking / cancelShipment / createReturnShipment are the
 *   on-demand companions, dispatched by the dedicated shipment routes.
 */
export interface CreateShipmentInput {
  /** Zapeera sale id the shipment is for. */
  saleId: string;
  /** Sale invoice number (human reference). */
  saleInvoiceNumber?: string | null;
  /** Channel the sale came from ('daraz', ...) + the channel's order id. */
  channel?: string | null;
  externalOrderId?: string | null;
  /** Recipient, from the sale's customer (walk-in when nulls). */
  recipient: { name: string; phone: string | null; address: string | null };
  /** Cash to collect on delivery = sale total − paid (0 when prepaid). */
  codAmount: number;
  /** Parcel lines, in base units. */
  items: Array<{ productId: string; quantity: number; name?: string | null }>;
}

export interface IntegrationSyncHandler {
  provider: IntegrationProviderId;
  connect(credentials: Record<string, unknown>): Promise<{ ok: boolean; message?: string }>;
  disconnect(credentials: Record<string, unknown>): Promise<void>;
  getStatus(credentials: Record<string, unknown>): Promise<{ ok: boolean; message?: string }>;
  syncProducts?(ctx: IntegrationSyncContext): Promise<IntegrationSyncResult>;
  syncStock?(ctx: IntegrationSyncContext): Promise<IntegrationSyncResult>;
  importOrders?(ctx: IntegrationSyncContext): Promise<IntegrationSyncResult>;
  createShipment?(ctx: IntegrationSyncContext, input: CreateShipmentInput): Promise<IntegrationSyncResult>;
}
