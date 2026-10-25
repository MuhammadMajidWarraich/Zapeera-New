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
   * The ONE Zapeera branch this connection maps to. A sales-channel
   * store maps to exactly one branch: every product/stock read and
   * every imported sale is scoped to it, so another branch's stock can
   * never leak into the store. Optional — when absent the provider
   * resolves the business's first active branch (documented per
   * provider). Only present in the object when set, so existing
   * exact-shape config expectations keep passing. WooCommerce
   * (feature/integration-woocommerce) refuses to sync when this is
   * unset and the business has several active branches. Daraz
   * (single-shop provider) resolves the business's single active
   * branch when unset and fails loudly on multi-branch businesses
   * instead of guessing; set via the connect payload's config (the
   * Settings dialog does not collect it yet — wave follow-up:
   * branch picker).
   */
  branchId?: string | null;
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
  /**
   * The field may be left empty (the connect dialog does not require
   * it). WooCommerce's `webhookSecret` is optional: it is only needed
   * once the merchant registers webhooks, and it can be added later by
   * reconnecting.
   */
  optional?: boolean;
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
  /** Walk-in sale → null (the builder uses a placeholder name, no phone/address). */
  phone: string | null;
  address: string | null;
  /** City, when known (Customer has no city field — usually part of address). */
  city?: string | null;
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

/** Vendor-neutral shipment-booking input, built by integration.service.ts
 * (buildCreateShipmentInput — ONE builder for all couriers). Daraz's pack
 * step reads channel / externalOrderId / saleInvoiceNumber; PostEx's
 * booking reads orderRef / recipient / paymentMethod / parcel / sender. */
export interface CreateShipmentInput {
  /** Zapeera sale id the shipment is for. */
  saleId: string;
  /** Sale invoice number (human reference). */
  saleInvoiceNumber?: string | null;
  /** Channel the sale came from ('daraz', ...) + the channel's order id. */
  channel?: string | null;
  externalOrderId?: string | null;
  /** Merchant-facing order reference (sale invoice number). */
  orderRef: string;
  /** Who the parcel goes to (from the sale's customer; walk-in sale → placeholder name, no phone/address). */
  recipient: ShipmentRecipient;
  /** 'COD' when an unpaid balance is collected on delivery, else 'PREPAID'. */
  paymentMethod: 'COD' | 'PREPAID';
  /** Cash to collect on delivery (0 for prepaid). */
  codAmount: number;
  /** Parcel pieces/description (from the sale lines). */
  parcel?: ShipmentParcel;
  /** Sender/warehouse details (from the Business row), when available. */
  sender?: { name?: string; phone?: string; address?: string };
  /** Parcel lines, in base units. */
  items?: Array<{ productId: string; quantity: number; name?: string | null }>;
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
 * - createShipment: the generic fulfilment step, added by the PostEx
 *   builder and reused by Daraz pack/ready-to-ship (and future
 *   couriers). The service builds the vendor-neutral input from a
 *   Zapeera sale (recipient from the customer, COD = unpaid balance,
 *   parcel from the lines) — handlers never build it themselves.
 *   getTracking / cancelShipment / createReturnShipment are the
 *   on-demand companions, dispatched by the dedicated shipment routes.
 * - processPayment / refundPayment / inquirePayment: optional, generic,
 *   payment-rail methods (added for JazzCash, 2026-10-24 — see the
 *   "Payment rails" note below). A payment provider implements
 *   processPayment; sales-channel / logistics providers do not. The
 *   framework routes entity 'payment' to processPayment via
 *   ENTITY_TO_METHOD in integration.service.ts. Payments are recorded
 *   through the EXISTING sale ledger (SalePayment rows, method
 *   'JAZZCASH'/'EASYPAYSA', reference = vendor transaction id) — a
 *   handler must never build a parallel ledger.
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
  processPayment?(ctx: IntegrationSyncContext, request: IntegrationPaymentRequest): Promise<IntegrationPaymentResult>;
  refundPayment?(ctx: IntegrationSyncContext, request: IntegrationRefundRequest): Promise<IntegrationRefundResult>;
  inquirePayment?(ctx: IntegrationSyncContext, txnRefNo: string): Promise<IntegrationPaymentInquiryResult>;
getTracking?(ctx: IntegrationSyncContext, trackingNumber: string): Promise<TrackingResult>;
  cancelShipment?(ctx: IntegrationSyncContext, trackingNumber: string): Promise<IntegrationSyncResult>;
  createReturnShipment?(ctx: IntegrationSyncContext, trackingNumber: string): Promise<ShipmentResult>;
}

// ─── Payment rails (generic — added for JazzCash; Easypaisa reuses this
// shape) ─────────────────────────────────────────────────────────────────
// A payment rail is NOT a sync: money moves at checkout, not on a schedule.
// The framework still routes it through triggerSync (entity 'payment') so
// a payment attempt gets the same audit log row as a sync run, and the
// Settings card stays the single place a rail is connected — but the card
// must say so (see IntegrationsSection: payment providers show no
// "Sync now" button). Amounts are ALWAYS in PKR major units (rupees) at
// this layer; the vendor module converts to the vendor's minor units
// (JazzCash takes paisas, amount x 100) at the wire.
/** How the customer pays through the rail. */
export type IntegrationPaymentMethod = 'mobile-account' | 'bank-account' | 'otc' | 'card';

/** Outcome of a payment initiation. */
export type IntegrationPaymentStatus =
  | 'success' // vendor confirmed the debit — recorded on the sale
  | 'pending' // initiated but money not received yet (OTC voucher issued, wallet 157) — NOT recorded
  | 'failed' // vendor declined — nothing recorded
  | 'otp-required' // bank-account step 1 done; caller must collect the OTP and retry with it
  | 'redirect'; // card: caller must POST the customer to redirectUrl with redirectFields

export interface IntegrationPaymentRequest {
  /** Zapeera sale id the payment settles. */
  saleId: string;
  /** PKR, major units (rupees). Must be > 0 and <= the sale's remaining balance. */
  amount: number;
  method: IntegrationPaymentMethod;
  /** Customer's wallet mobile number (mobile-account, otc). */
  mobileNumber?: string;
  /** Last 6 digits of the customer's CNIC (JazzCash MWALLET v2.0). */
  cnicLast6?: string;
  /** Bank-account step 1: bank id, account number, full CNIC, email. */
  bankId?: string;
  accountNo?: string;
  cnic?: string;
  email?: string;
  /** Bank-account step 2: OTP the customer received. */
  otp?: string;
  /** Optional bill/invoice reference override; defaults to the sale's invoice number. */
  billReference?: string;
  description?: string;
}

export interface IntegrationPaymentResult {
  status: IntegrationPaymentStatus;
  /** Merchant-generated transaction reference (pp_TxnRefNo). */
  txnRefNo: string;
  /** Vendor retrieval reference number — stored as SalePayment.reference. */
  retrievalReferenceNo?: string | null;
  authCode?: string | null;
  /** Vendor operation response code (pp_ResponseCode, '000' = success). */
  responseCode: string;
  responseMessage: string;
  /** PKR actually charged/recorded, major units. */
  amount: number;
  method: IntegrationPaymentMethod;
  saleId: string;
  /** Card redirect only: JazzCash merchant-form URL to POST the customer to. */
  redirectUrl?: string;
  /** Card redirect only: signed form fields (incl. pp_SecureHash) to POST. */
  redirectFields?: Record<string, string>;
  /** OTC only: voucher number the customer pays at a retailer, when the vendor returns one. */
  voucherNo?: string | null;
  /** Human next step (e.g. 'Ask the customer for the OTP and retry with it.'). */
  nextStep?: string;
}

export interface IntegrationRefundRequest {
  saleId: string;
  /** Original payment's merchant transaction reference. */
  txnRefNo: string;
  /** PKR, major units. */
  amount: number;
  method: 'mobile-account' | 'card' | 'otc';
  /**
   * Merchant's own JazzCash wallet MPIN — required for a mobile-account
   * refund. Supplied per call, NEVER stored (it is not part of the
   * connection credentials).
   */
  merchantMpin?: string;
  /** OTC voucher refund: the voucher number issued at payment time. */
  voucherId?: string;
  /** OTC voucher refund: customer's CNIC (last 6 per the vendor docs). */
  cnic?: string;
}

export interface IntegrationRefundResult {
  status: 'success' | 'failed';
  responseCode: string;
  responseMessage: string;
  /** PKR refunded by this call, major units. */
  refundAmount: number;
  /** PKR refunded in total against the original transaction, major units. */
  totalRefundAmount: number | null;
  txnRefNo: string;
}

export interface IntegrationPaymentInquiryResult {
  status: 'completed' | 'pending' | 'failed' | 'refunded' | 'unknown';
  /** Inquiry-operation code ('000' = the inquiry itself succeeded). */
  responseCode: string;
  /** Transaction status code ('121' = completed, '131' = refunded, '109' = does not exist). */
  paymentResponseCode: string;
  paymentResponseMessage: string;
  retrievalReferenceNo?: string | null;
  authCode?: string | null;
  txnRefNo: string;
}
