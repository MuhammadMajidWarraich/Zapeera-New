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

// ─── Generic shipments (added by feature/integration-postex, contract §10) ──
// The v1 handler interface had no shipment method, but logistics providers
// (PostEx first; Daraz pack/ready-to-ship and future couriers next) need
// one. These types are deliberately vendor-neutral: the service builds a
// CreateShipmentInput from a Zapeera sale (recipient from the customer,
// COD from the unpaid balance, parcel from the sale lines) and the
// provider handler maps it to the vendor's own payload. No vendor field
// names leak into this file — see the provider module for those.

/** Who the parcel goes to (from the sale's customer). */
export interface ShipmentRecipient {
  name: string;
  phone: string;
  address: string;
  /** City, when known (Customer has no city field — usually part of address). */
  city?: string;
}

/** What is being shipped (from the sale lines). */
export interface ShipmentParcel {
  /** Number of pieces/parcels. */
  pieces?: number;
  /** Total weight in kg, when known (Zapeera products carry no weight). */
  weightKg?: number;
  /** Short contents description for the label (product names). */
  description?: string;
}

/** Vendor-neutral shipment-booking input, built by integration.service.ts. */
export interface CreateShipmentInput {
  /** Zapeera sale id (when booked from a sale). */
  saleId?: string;
  /** Merchant-facing order reference (sale invoice number). */
  orderRef: string;
  recipient: ShipmentRecipient;
  /** 'COD' when an unpaid balance is collected on delivery, else 'PREPAID'. */
  paymentMethod: 'COD' | 'PREPAID';
  /** Cash to collect on delivery (0 for prepaid). */
  codAmount: number;
  parcel?: ShipmentParcel;
  /** Sender/warehouse details (from the Business row), when available. */
  sender?: { name?: string; phone?: string; address?: string };
}

/** What a booked shipment looks like, whatever the courier. */
export interface ShipmentResult {
  trackingNumber: string;
  shipmentId?: string;
  /** AWB label URL when the vendor returns one (null = fetch it via getTracking/label). */
  labelUrl?: string | null;
  /** Vendor status string, normalised to upper-snake where possible. */
  status: string;
  codAmount: number;
}

export interface TrackingEvent {
  status: string;
  location?: string;
  timestamp?: string;
  description?: string;
}

export interface TrackingResult {
  trackingNumber: string;
  status: string;
  events: TrackingEvent[];
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
 * - createShipment / getTracking / cancelShipment / createReturnShipment:
 *   optional logistics methods (added by feature/integration-postex,
 *   contract §10). `createShipment` is dispatched by triggerSync with
 *   entity 'shipment' (the service builds the CreateShipmentInput from a
 *   sale — see integration.service.ts); the other three are dispatched by
 *   the dedicated shipment routes in integrations.routes.ts.
 */
export interface IntegrationSyncHandler {
  provider: IntegrationProviderId;
  connect(credentials: Record<string, unknown>): Promise<{ ok: boolean; message?: string }>;
  disconnect(credentials: Record<string, unknown>): Promise<void>;
  getStatus(credentials: Record<string, unknown>): Promise<{ ok: boolean; message?: string }>;
  syncProducts?(ctx: IntegrationSyncContext): Promise<IntegrationSyncResult>;
  syncStock?(ctx: IntegrationSyncContext): Promise<IntegrationSyncResult>;
  importOrders?(ctx: IntegrationSyncContext): Promise<IntegrationSyncResult>;
  createShipment?(ctx: IntegrationSyncContext, input: CreateShipmentInput): Promise<IntegrationSyncResult>;
  getTracking?(ctx: IntegrationSyncContext, trackingNumber: string): Promise<TrackingResult>;
  cancelShipment?(ctx: IntegrationSyncContext, trackingNumber: string): Promise<IntegrationSyncResult>;
  createReturnShipment?(ctx: IntegrationSyncContext, trackingNumber: string): Promise<ShipmentResult>;
}
