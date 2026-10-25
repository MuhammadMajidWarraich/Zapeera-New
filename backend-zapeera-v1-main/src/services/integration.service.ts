// ─── Integrations framework — service (feature/integration-framework) ─────
// Business logic for IntegrationConnection / IntegrationSyncLog. Thin
// controllers call these; tests call these directly with a stub prisma.
//
// Tenancy: every function is scoped to (businessId, provider) — the
// composite unique key. Credentials are encrypted before storage and
// decrypted only here, inside the backend process, for handler calls.
// NOTHING in this file returns credentials to a caller: serialized views
// expose hasCredentials only (same write-only precedent as FBR).
import {
  decryptIntegrationCredentials,
  encryptIntegrationCredentials,
  isIntegrationEncryptionConfigured
} from '../utils/integration-encryption.util';
import {
  getIntegrationHandler,
  getProviderEntry,
  isKnownProvider,
  isProviderConnectable,
  listProviders
} from '../integrations/registry';
import { IntegrationError } from '../integrations/vendor-client';
import type {
  CreateShipmentInput,
  IntegrationConnectionStatus,
  IntegrationConnectionView,
  IntegrationPaymentInquiryResult,
  IntegrationPaymentRequest,
  IntegrationPaymentResult,
  IntegrationProviderId,
  IntegrationProviderWithStatus,
  IntegrationRefundRequest,
  IntegrationRefundResult,
  IntegrationSyncConfig,
  IntegrationSyncDirection,
  IntegrationSyncEntity,
  IntegrationSyncResult,
  TrackingResult
} from '../integrations/types';
import { DEFAULT_SYNC_CONFIG } from '../integrations/types';

export function normalizeSyncConfig(input: unknown): IntegrationSyncConfig {
  const raw = (input ?? {}) as Partial<IntegrationSyncConfig>;
  const bool = (v: unknown): boolean => v === true;
  const direction: IntegrationSyncDirection =
    raw.direction === 'in' || raw.direction === 'out' || raw.direction === 'both'
      ? raw.direction
      : DEFAULT_SYNC_CONFIG.direction;
  // WooCommerce branch binding (feature/integration-woocommerce): kept
  // only when it is a non-empty string; anything else drops to unset
  // (the handler then auto-picks a sole branch or fails loudly).
  // Optional provider extras pass through verbatim (undefined = unset).
  // Unknown keys are still dropped — only the typed extras survive.
  const branchId = typeof raw.branchId === 'string' && raw.branchId.trim() !== '' ? raw.branchId.trim() : undefined;
  const darazCategoryId =
    typeof raw.darazCategoryId === 'string' && raw.darazCategoryId.trim()
      ? raw.darazCategoryId.trim()
      : undefined;
  const spreadsheetId =
    typeof raw.spreadsheetId === 'string' && raw.spreadsheetId.trim()
      ? raw.spreadsheetId.trim()
      : undefined;
  const normalized: IntegrationSyncConfig = {
    syncProducts: bool(raw.syncProducts),
    syncStock: bool(raw.syncStock),
    syncOrders: bool(raw.syncOrders),
    syncCustomers: bool(raw.syncCustomers),
    direction,
    ...(branchId ? { branchId } : {}),
    ...(darazCategoryId ? { darazCategoryId } : {}),
    ...(spreadsheetId ? { spreadsheetId } : {})
  };
  // Branch mapping (feature/integration-shopify): carried through only
  // when set, so stored configs without a branch keep their exact shape.
  if (typeof raw.branchId === 'string' && raw.branchId.trim() !== '') {
    normalized.branchId = raw.branchId.trim();
  }
  return normalized;
}

function parseStoredConfig(stored: string | null | undefined): IntegrationSyncConfig {
  if (!stored) return { ...DEFAULT_SYNC_CONFIG };
  try {
    return normalizeSyncConfig(JSON.parse(stored));
  } catch {
    return { ...DEFAULT_SYNC_CONFIG };
  }
}

function serializeConnection(row: any): IntegrationConnectionView {
  const config = parseStoredConfig(row?.config);
  return {
    provider: row.provider as IntegrationProviderId,
    status: (row.status as IntegrationConnectionStatus) || 'disconnected',
    hasCredentials: Boolean(row?.encryptedCredentials),
    config,
    lastSyncAt: row?.lastSyncAt ? new Date(row.lastSyncAt).toISOString() : null,
    lastError: row?.lastError ?? null,
    updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null
  };
}

/** All registry providers + this business's connection state. */
export async function listProvidersWithStatus(
  prisma: any,
  businessId: string
): Promise<IntegrationProviderWithStatus[]> {
  const rows: any[] = await prisma.integrationConnection.findMany({ where: { businessId } });
  const byProvider = new Map<string, any>(rows.map((row) => [String(row.provider), row]));
  return listProviders().map((entry) => {
    const row = byProvider.get(entry.id);
    return {
      ...entry,
      connectable: isProviderConnectable(entry.id),
      status: ((row?.status as IntegrationConnectionStatus) || 'disconnected') as IntegrationConnectionStatus,
      hasCredentials: Boolean(row?.encryptedCredentials),
      config: row ? parseStoredConfig(row.config) : null,
      lastSyncAt: row?.lastSyncAt ? new Date(row.lastSyncAt).toISOString() : null,
      lastError: row?.lastError ?? null
    };
  });
}

function requireKnownProvider(provider: string): IntegrationProviderId {
  if (!isKnownProvider(provider)) {
    throw new IntegrationError(
      'UNKNOWN_PROVIDER',
      `Unknown integration provider "${provider}".`
    );
  }
  return provider as IntegrationProviderId;
}

function requireHandler(provider: IntegrationProviderId) {
  const handler = getIntegrationHandler(provider);
  if (!handler) {
    throw new IntegrationError(
      'NOT_IMPLEMENTED',
      `${getProviderEntry(provider)?.displayName ?? provider} is not built yet — its sync handler is not registered.`
    );
  }
  return handler;
}

/**
 * Connect (or reconnect) a provider. Verifies the credentials against
 * the vendor FIRST via handler.connect — nothing is stored until the
 * vendor accepts them. A failed verification stores status 'error'
 * (without credentials) and throws.
 */
export async function connectProvider(
  prisma: any,
  businessId: string,
  provider: string,
  credentials: Record<string, unknown>,
  configInput?: unknown
): Promise<IntegrationConnectionView> {
  const id = requireKnownProvider(provider);
  const handler = requireHandler(id);
  if (!isIntegrationEncryptionConfigured()) {
    throw new IntegrationError(
      'ENCRYPTION_NOT_CONFIGURED',
      'INTEGRATION_ENCRYPTION_KEY is not set — integration credentials cannot be stored. Set it on the server (64 hex characters) and try again.'
    );
  }
  if (!credentials || typeof credentials !== 'object' || Object.keys(credentials).length === 0) {
    throw new IntegrationError('VENDOR_ERROR', 'Credentials are required to connect.');
  }
  const config = normalizeSyncConfig(configInput);

  let verified: { ok: boolean; message?: string };
  try {
    verified = await handler.connect(credentials);
  } catch (error) {
    const message =
      error instanceof IntegrationError ? error.message : 'The vendor could not be reached.';
    await prisma.integrationConnection.upsert({
      where: { businessId_provider: { businessId, provider: id } },
      create: {
        businessId,
        provider: id,
        status: 'error',
        encryptedCredentials: null,
        config: JSON.stringify(config),
        lastError: message
      },
      update: { status: 'error', encryptedCredentials: null, config: JSON.stringify(config), lastError: message }
    });
    if (error instanceof IntegrationError) throw error;
    throw new IntegrationError('VENDOR_UNREACHABLE', message);
  }
  if (!verified.ok) {
    const message = verified.message || 'The vendor rejected these credentials.';
    await prisma.integrationConnection.upsert({
      where: { businessId_provider: { businessId, provider: id } },
      create: {
        businessId,
        provider: id,
        status: 'error',
        encryptedCredentials: null,
        config: JSON.stringify(config),
        lastError: message
      },
      update: { status: 'error', encryptedCredentials: null, config: JSON.stringify(config), lastError: message }
    });
    throw new IntegrationError('VENDOR_AUTH', message);
  }

  const encrypted = encryptIntegrationCredentials(credentials);
  const row = await prisma.integrationConnection.upsert({
    where: { businessId_provider: { businessId, provider: id } },
    create: {
      businessId,
      provider: id,
      status: 'connected',
      encryptedCredentials: encrypted,
      config: JSON.stringify(config),
      lastError: null
    },
    update: {
      status: 'connected',
      encryptedCredentials: encrypted,
      config: JSON.stringify(config),
      lastError: null
    }
  });
  return serializeConnection(row);
}

/**
 * Disconnect a provider. The local credential wipe is authoritative and
 * always happens, even if the vendor-side revoke fails — a failed revoke
 * never leaves credentials stored.
 */
export async function disconnectProvider(
  prisma: any,
  businessId: string,
  provider: string
): Promise<IntegrationConnectionView> {
  const id = requireKnownProvider(provider);
  const row = await prisma.integrationConnection.findUnique({
    where: { businessId_provider: { businessId, provider: id } }
  });
  if (row?.encryptedCredentials) {
    const handler = getIntegrationHandler(id);
    if (handler) {
      try {
        await handler.disconnect(decryptIntegrationCredentials(row.encryptedCredentials));
      } catch {
        // Vendor revoke is best-effort; the local wipe below is what matters.
      }
    }
  }
  const updated = row
    ? await prisma.integrationConnection.update({
        where: { businessId_provider: { businessId, provider: id } },
        data: { status: 'disconnected', encryptedCredentials: null, lastError: null }
      })
    : null;
  if (!updated) {
    return {
      provider: id,
      status: 'disconnected',
      hasCredentials: false,
      config: { ...DEFAULT_SYNC_CONFIG },
      lastSyncAt: null,
      lastError: null,
      updatedAt: null
    };
  }
  return serializeConnection(updated);
}

/** Stored status + a live vendor liveness check when connected. */
export async function getConnectionStatus(
  prisma: any,
  businessId: string,
  provider: string
): Promise<IntegrationConnectionView & { remoteOk: boolean | null; remoteMessage: string | null }> {
  const id = requireKnownProvider(provider);
  const row = await prisma.integrationConnection.findUnique({
    where: { businessId_provider: { businessId, provider: id } }
  });
  const base: IntegrationConnectionView = row
    ? serializeConnection(row)
    : {
        provider: id,
        status: 'disconnected',
        hasCredentials: false,
        config: { ...DEFAULT_SYNC_CONFIG },
        lastSyncAt: null,
        lastError: null,
        updatedAt: null
      };
  let remoteOk: boolean | null = null;
  let remoteMessage: string | null = null;
  if (row?.status === 'connected' && row.encryptedCredentials) {
    const handler = getIntegrationHandler(id);
    if (handler) {
      try {
        const remote = await handler.getStatus(decryptIntegrationCredentials(row.encryptedCredentials));
        remoteOk = remote.ok;
        remoteMessage = remote.message ?? null;
      } catch (error) {
        remoteOk = false;
        remoteMessage =
          error instanceof IntegrationError ? error.message : 'The vendor could not be reached.';
      }
    }
  }
  return { ...base, remoteOk, remoteMessage };
}

export interface TriggerSyncOptions {
  entity?: IntegrationSyncEntity;
  direction?: IntegrationSyncDirection;
  /** Sale id for entity 'shipment' (or use saleRef). */
  saleId?: string;
  /** Sale id OR invoice number for entity 'shipment'. */
  saleRef?: string;
  /** Payment initiation payload — required when entity is 'payment'. */
  payment?: IntegrationPaymentRequest;
}

/**
 * Build the vendor-neutral shipment input from a Zapeera sale — the ONE
 * builder for all couriers (Daraz pack reads channel / externalOrderId /
 * saleInvoiceNumber; PostEx booking reads orderRef / recipient /
 * paymentMethod / parcel / sender). Recipient from the sale's customer
 * (walk-in sale → placeholder name, no phone / address); COD = unpaid
 * balance (total − paid − returned, never negative); parcel from the
 * sale lines. A missing/unknown sale fails with NOT_IMPLEMENTED before
 * any log row is created — exactly like an unimplemented entity. A sale
 * that already has a PostEx tracking number is refused here (never book
 * the same sale twice — the PostEx handler itself does not re-check).
 * Daraz checks the live Daraz order status instead — see the Daraz handler.
 */
export async function buildCreateShipmentInput(
  prisma: any,
  businessId: string,
  saleRef: string
): Promise<CreateShipmentInput> {
  const sale =
    (await prisma.sale.findUnique({ where: { id: saleRef } })) ??
    (await prisma.sale.findFirst({ where: { invoiceNumber: saleRef, companyId: businessId } }));
  if (!sale || sale.companyId !== businessId) {
    throw new IntegrationError(
      'NOT_IMPLEMENTED',
      `No sale "${saleRef}" exists in this business — pass a sale id or invoice number for a shipment.`
    );
  }
  if (sale.postexTrackingNumber) {
    throw new IntegrationError(
      'SYNC_FAILED',
      `Sale ${sale.invoiceNumber ?? sale.id} already has a PostEx shipment (tracking ${sale.postexTrackingNumber}). Cancel it first if you need to re-book.`
    );
  }
  const [customer, items, business] = await Promise.all([
    sale.customerId
      ? prisma.customer.findUnique({ where: { id: sale.customerId } })
      : Promise.resolve(null),
    prisma.saleItem.findMany({ where: { saleId: sale.id } }),
    prisma.business?.findUnique ? prisma.business.findUnique({ where: { id: businessId } }) : Promise.resolve(null)
  ]);
  const productIds = [...new Set(items.map((i: any) => i.productId))];
  const products =
    productIds.length > 0
      ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
      : [];
  const nameById = new Map<string, string>(products.map((p: any) => [p.id, p.name]));
  const codAmount = Math.max(
    0,
    Math.round(
      (Number(sale.totalAmount || 0) - Number(sale.paidAmount || 0) - Number(sale.returnedAmount || 0)) * 100
    ) / 100
  );
  const parcelItems = items.map((i: any) => ({
    productId: i.productId,
    quantity: Number(i.quantity) || 0,
    name: nameById.get(i.productId) ?? null
  }));
  return {
    saleId: sale.id,
    saleInvoiceNumber: sale.invoiceNumber ?? null,
    channel: sale.channel ?? null,
    externalOrderId: sale.externalOrderId ?? null,
    orderRef: String(sale.invoiceNumber ?? sale.id),
    recipient: {
      name: customer?.name ?? 'Walk-in Customer',
      phone: customer?.phone ?? null,
      address: customer?.address ?? null
    },
    paymentMethod: codAmount > 0 ? 'COD' : 'PREPAID',
    codAmount,
    parcel: {
      pieces: parcelItems.reduce((sum: number, i: any) => sum + (i.quantity || 0), 0) || undefined,
      description:
        [...new Set(parcelItems.map((i: any) => String(i.name ?? '').trim()).filter(Boolean))]
          .slice(0, 5)
          .join(', ') || undefined
    },
    ...(business
      ? {
          sender: {
            ...(business.name ? { name: String(business.name) } : {}),
            ...(business.phone ? { phone: String(business.phone) } : {}),
            ...(business.address ? { address: String(business.address) } : {})
          }
        }
      : {}),
    items: parcelItems
  };
}

const ENTITY_TO_METHOD: Record<
  IntegrationSyncEntity,
  'syncProducts' | 'syncStock' | 'importOrders' | 'createShipment' | 'processPayment' | 'exportData' | null
> = {
  product: 'syncProducts',
  stock: 'syncStock',
  order: 'importOrders',
  customer: null, // No handler method in the v1 interface — a builder adds it.
  // Payment rails (JazzCash, 2026-10-24): entity 'payment' routes to
  // the generic processPayment handler method — money moves at checkout,
  // not on a schedule, but the attempt gets the same audit log row.
  payment: 'processPayment',
  shipment: 'createShipment', // Generic fulfilment step (PostEx shape): triggerSync builds CreateShipmentInput from opts.saleId/saleRef.
  // Generic export run (added 2026-10-24, google-sheets): dispatches to
  // IntegrationSyncHandler.exportData. Direction defaults to 'out'
  // (see triggerSync below — every non-'order' entity defaults 'out').
  export: 'exportData'
};

/**
 * Map a payment result to the sync-result shape triggerSync returns.
 * A declined payment is recordsFailed 1 (the attempt is logged, the
 * connection is NOT marked error — a decline is not a vendor outage).
 * The vendor transaction id + RRN ride in the message; the full
 * payment result is returned alongside (see triggerSync).
 */
function paymentToSyncResult(providerName: string, payment: IntegrationPaymentResult): IntegrationSyncResult {
  const failed = payment.status === 'failed';
  const reference = payment.retrievalReferenceNo
    ? `, RRN ${payment.retrievalReferenceNo}`
    : '';
  return {
    recordsProcessed: failed ? 0 : 1,
    recordsFailed: failed ? 1 : 0,
    message:
      `${providerName} ${payment.method} payment ${payment.status}: txn ${payment.txnRefNo}${reference}` +
      (payment.responseMessage ? ` — ${payment.responseMessage}` : '')
  };
}

/** Shared "connected + handler implements method" guard for on-demand shipment calls. */
async function requireConnectedShipmentHandler(
  prisma: any,
  businessId: string,
  provider: string,
  method: 'getTracking' | 'cancelShipment' | 'createReturnShipment'
): Promise<{ handler: any; ctx: any }> {
  const id = requireKnownProvider(provider);
  const handler = requireHandler(id);
  const row = await prisma.integrationConnection.findUnique({
    where: { businessId_provider: { businessId, provider: id } }
  });
  if (!row || row.status !== 'connected' || !row.encryptedCredentials) {
    throw new IntegrationError(
      'NOT_CONNECTED',
      `${getProviderEntry(id)?.displayName ?? id} is not connected. Connect it first.`
    );
  }
  if (typeof (handler as any)[method] !== 'function') {
    throw new IntegrationError(
      'NOT_IMPLEMENTED',
      `${getProviderEntry(id)?.displayName ?? id} does not implement "${method}" yet.`
    );
  }
  return {
    handler,
    ctx: {
      prisma,
      businessId,
      credentials: decryptIntegrationCredentials(row.encryptedCredentials),
      config: parseStoredConfig(row.config),
      logId: ''
    }
  };
}

/** On-demand tracking lookup (read-only — writes no sync-log row). */
export async function getShipmentTracking(
  prisma: any,
  businessId: string,
  provider: string,
  trackingNumber: string
): Promise<TrackingResult> {
  const clean = String(trackingNumber ?? '').trim();
  if (!clean) {
    throw new IntegrationError('SYNC_FAILED', 'A tracking number is required.');
  }
  const { handler, ctx } = await requireConnectedShipmentHandler(prisma, businessId, provider, 'getTracking');
  return handler.getTracking(ctx, clean);
}

/** On-demand shipment cancel (read-only w.r.t. sync logs). */
export async function cancelShipment(
  prisma: any,
  businessId: string,
  provider: string,
  trackingNumber: string
): Promise<IntegrationSyncResult> {
  const clean = String(trackingNumber ?? '').trim();
  if (!clean) {
    throw new IntegrationError('SYNC_FAILED', 'A tracking number is required to cancel a shipment.');
  }
  const { handler, ctx } = await requireConnectedShipmentHandler(prisma, businessId, provider, 'cancelShipment');
  return handler.cancelShipment(ctx, clean);
}

/** On-demand return-leg booking. Returns the new (return-leg) tracking number. */
export async function returnShipment(
  prisma: any,
  businessId: string,
  provider: string,
  trackingNumber: string
): Promise<{ trackingNumber: string; shipmentId?: string; labelUrl?: string | null; status: string; codAmount: number }> {
  const clean = String(trackingNumber ?? '').trim();
  if (!clean) {
    throw new IntegrationError('SYNC_FAILED', 'A tracking number is required to book a return.');
  }
  const { handler, ctx } = await requireConnectedShipmentHandler(
    prisma,
    businessId,
    provider,
    'createReturnShipment'
  );
  return handler.createReturnShipment(ctx, clean);
}
/**
 * Manual sync trigger. Dispatches to the provider's handler method for
 * the requested entity and writes an IntegrationSyncLog row for the run
 * (created as 'failed' first, then updated — a crashed run stays failed,
 * never silently successful).
 */
export async function triggerSync(
  prisma: any,
  businessId: string,
  provider: string,
  opts: TriggerSyncOptions = {}
): Promise<{ log: any; result: IntegrationSyncResult; payment?: IntegrationPaymentResult }> {
  const id = requireKnownProvider(provider);
  const handler = requireHandler(id);
  const row = await prisma.integrationConnection.findUnique({
    where: { businessId_provider: { businessId, provider: id } }
  });
  if (!row || row.status !== 'connected' || !row.encryptedCredentials) {
    throw new IntegrationError(
      'NOT_CONNECTED',
      `${getProviderEntry(id)?.displayName ?? id} is not connected. Connect it first.`
    );
  }
  const entity: IntegrationSyncEntity = opts.entity ?? 'product';
  const method = ENTITY_TO_METHOD[entity];
  if (!method || typeof (handler as any)[method] !== 'function') {
    throw new IntegrationError(
      'NOT_IMPLEMENTED',
      `${getProviderEntry(id)?.displayName ?? id} does not implement sync for "${entity}" yet.`
    );
  }
  const config = parseStoredConfig(row.config);
  const direction: IntegrationSyncDirection =
    opts.direction ?? (entity === 'order' ? 'in' : 'out');
  const credentials = decryptIntegrationCredentials(row.encryptedCredentials);

  // Shipment is per-sale: resolve the sale and build the vendor-neutral
  // input BEFORE the log row is created, so a missing/unknown sale
  // fails with no log row (exactly like an unimplemented entity).
  let shipmentInput: CreateShipmentInput | undefined;
  if (entity === 'shipment') {
    const saleRef = opts.saleId ?? opts.saleRef;
    if (!saleRef) {
      throw new IntegrationError(
        'NOT_IMPLEMENTED',
        'A shipment needs a sale — pass saleId or saleRef (sale id or invoice number).'
      );
    }
    shipmentInput = await buildCreateShipmentInput(prisma, businessId, saleRef);
  }

  const startedAt = new Date();
  const log = await prisma.integrationSyncLog.create({
    data: {
      businessId,
      provider: id,
      direction,
      entity,
      status: 'failed', // placeholder — updated below; a crashed run stays failed.
      recordsProcessed: 0,
      recordsFailed: 0,
      errorMessage: null,
      startedAt
    }
  });

  try {
    // Payment rails take a second argument (the payment request); sync
    // methods take only the context.
    let result: IntegrationSyncResult;
    let payment: IntegrationPaymentResult | undefined;
    if (method === 'processPayment') {
      // A payment initiation needs its payload (sale, amount, method) —
      // without it there is nothing to charge.
      const paymentRequest = opts.payment;
      if (!paymentRequest) {
        throw new IntegrationError(
          'VENDOR_ERROR',
          'Payment details (saleId, amount, method) are required to take a payment.'
        );
      }
      const paymentResult: IntegrationPaymentResult = await (handler as any)[method](
        { prisma, businessId, credentials, config, logId: log.id },
        paymentRequest
      );
      payment = paymentResult;
      result = paymentToSyncResult(getProviderEntry(id)?.displayName ?? id, paymentResult);
    } else {
      result = await (handler as any)[method]({
        prisma,
        businessId,
        credentials,
        config,
        logId: log.id
      },
      // Only createShipment takes a second argument; the other methods
      // receive `undefined` here and ignore it.
      shipmentInput
    );
    }
    const finishedAt = new Date();
    const status = result.recordsFailed > 0 ? 'partial' : 'success';
    const updatedLog = await prisma.integrationSyncLog.update({
      where: { id: log.id },
      data: {
        status,
        recordsProcessed: result.recordsProcessed,
        recordsFailed: result.recordsFailed,
        errorMessage: null,
        finishedAt
      }
    });
    await prisma.integrationConnection.update({
      where: { businessId_provider: { businessId, provider: id } },
      data: { lastSyncAt: finishedAt, lastError: null }
    });
    return { log: updatedLog, result, ...(payment ? { payment } : {}) };
  } catch (error) {
    const message =
      error instanceof IntegrationError
        ? error.message
        : `Sync failed (${error instanceof Error ? error.message : 'unknown error'}).`;
    const failedLog = await prisma.integrationSyncLog.update({
      where: { id: log.id },
      data: { status: 'failed', errorMessage: message.slice(0, 1000), finishedAt: new Date() }
    });
    await prisma.integrationConnection.update({
      where: { businessId_provider: { businessId, provider: id } },
      data: { status: 'error', lastError: message.slice(0, 1000) }
    });
    if (error instanceof IntegrationError) throw error;
    throw new IntegrationError('SYNC_FAILED', message);
  }
}

/** Per-business sync history, newest first. */
export async function listSyncLogs(
  prisma: any,
  businessId: string,
  provider: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<{ logs: any[]; total: number }> {
  const id = requireKnownProvider(provider);
  const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 100);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const [logs, total] = await Promise.all([
    prisma.integrationSyncLog.findMany({
      where: { businessId, provider: id },
      orderBy: { startedAt: 'desc' },
      take: limit,
      skip: offset
    }),
    prisma.integrationSyncLog.count({ where: { businessId, provider: id } })
  ]);
  return { logs, total };
}

// ─── Payment-rail calls (JazzCash; generic so Easypaisa can reuse them) ──
// These are NOT sync runs — no log row, no lastSyncAt — they call the
// handler's payment methods directly. The caller (POS checkout, refund
// flow) owns the sale-side record; the handler owns the vendor call.

async function loadConnectedHandler(
  prisma: any,
  businessId: string,
  provider: string
): Promise<{ handler: any; credentials: Record<string, unknown>; config: IntegrationSyncConfig }> {
  const id = requireKnownProvider(provider);
  const handler = requireHandler(id);
  const row = await prisma.integrationConnection.findUnique({
    where: { businessId_provider: { businessId, provider: id } }
  });
  if (!row || row.status !== 'connected' || !row.encryptedCredentials) {
    throw new IntegrationError(
      'NOT_CONNECTED',
      `${getProviderEntry(id)?.displayName ?? id} is not connected. Connect it first.`
    );
  }
  return {
    handler,
    credentials: decryptIntegrationCredentials(row.encryptedCredentials),
    config: parseStoredConfig(row.config)
  };
}

/** Confirm a payment's final status at the vendor (mandatory after any IPN / missing response). */
export async function inquireIntegrationPayment(
  prisma: any,
  businessId: string,
  provider: string,
  txnRefNo: string
): Promise<IntegrationPaymentInquiryResult> {
  const { handler, credentials, config } = await loadConnectedHandler(prisma, businessId, provider);
  if (typeof handler.inquirePayment !== 'function') {
    throw new IntegrationError(
      'NOT_IMPLEMENTED',
      `${getProviderEntry(provider)?.displayName ?? provider} does not implement payment status inquiry yet.`
    );
  }
  return handler.inquirePayment({ prisma, businessId, credentials, config, logId: '' }, txnRefNo);
}

/**
 * Send money back through the vendor. Creates NO local Refund row —
 * the caller (refund flow) records the refund locally with
 * refundMethod + refundReference from this result. The merchant MPIN
 * (mobile-account refunds) travels in the request only, never stored.
 */
export async function refundIntegrationPayment(
  prisma: any,
  businessId: string,
  provider: string,
  request: IntegrationRefundRequest
): Promise<IntegrationRefundResult> {
  const { handler, credentials, config } = await loadConnectedHandler(prisma, businessId, provider);
  if (typeof handler.refundPayment !== 'function') {
    throw new IntegrationError(
      'NOT_IMPLEMENTED',
      `${getProviderEntry(provider)?.displayName ?? provider} does not implement refunds yet.`
    );
  }
  return handler.refundPayment({ prisma, businessId, credentials, config, logId: '' }, request);
}
