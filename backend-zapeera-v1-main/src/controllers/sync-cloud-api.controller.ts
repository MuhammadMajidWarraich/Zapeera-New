import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { getPrisma } from '../utils/db.util';
import { replaySaleStock, restockRefundStock, saleLineUnits } from '../services/sync-stock-replay.service';
import { runReconciliation, createStockTakesFromReconciliation, resolveReconciliation } from '../services/stock-reconciliation.service';


// C-14: the cloud-sync endpoints must only ever serve businesses the
// caller actually belongs to (ACTIVE membership) or owns. Previously any
// authenticated user could pull or push ANY business's data by id.
async function requireBusinessAccess(prisma: any, userId: string, businessId: string): Promise<boolean> {
  const membership = await prisma.membership.findFirst({
    where: { userId, businessId, status: 'ACTIVE' },
    select: { id: true }
  });
  if (membership) return true;
  const owned = await prisma.business.findFirst({
    where: { id: businessId, createdBy: userId },
    select: { id: true }
  });
  return !!owned;
}

export const cloudSyncAccount = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const userId = req.user!.id;

    const user = await prisma.zapeeraUser.findUnique({
      where: { id: userId },
      select: { id: true, username: true, email: true, name: true, isActive: true, createdAt: true }
    });
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    const memberships = await (prisma.membership.findMany as any)({
      where: { userId, status: 'ACTIVE' },
      include: {
        business: {
          select: {
            id: true,
            name: true,
            slug: true,
            businessType: true,
            businessSubscription: {
              select: {
                planId: true,
                status: true
              }
            }
          }
        },
        branches: { include: { branch: { select: { id: true, name: true } } } },
        role: { select: { name: true } }
      }
    }) as any[];

    // Include businesses the user owns (createdBy) even when their membership
    // is not ACTIVE, so desktop shows the exact same list as the web dashboard.
    const ownedBusinesses = await prisma.business.findMany({
      where: { isActive: true, createdBy: userId },
      select: { id: true, name: true, slug: true, businessType: true }
    });

    const membershipBusinessIds = new Set(memberships.map((m: any) => m.businessId));
    const mergedBusinesses = [
      ...memberships.map((m: any) => m.business),
      ...ownedBusinesses.filter((b) => !membershipBusinessIds.has(b.id))
    ];

    const data = {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        displayName: user.name,
        isActive: user.isActive,
        createdAt: user.createdAt
      },
      memberships: memberships.map(m => ({
        id: m.id,
        userId: m.userId,
        businessId: m.businessId,
        role: m.role?.name || 'OWNER',
        businessName: m.business.name,
        businessSlug: m.business.slug || '',
        businessType: m.business.businessType || '',
        status: m.status,
        subscriptionPlan: m.business?.businessSubscription?.planId || '',
        subscriptionStatus: m.business?.businessSubscription?.status || '',
        branchIds: m.branches.map((b: any) => b.branch.id),
        branches: m.branches.map((b: any) => ({ id: b.branch.id, name: b.branch.name }))
      })),
      businesses: mergedBusinesses.map(b => ({
        id: b.id,
        name: b.name,
        slug: b.slug || '',
        businessType: b.businessType || ''
      }))
    };

    res.json({ success: true, data });
  } catch (error: any) {
    console.error('[CloudSync] Account error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const cloudProvisionBusiness = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { businessId } = req.body;

    if (!businessId) {
      res.status(400).json({ success: false, message: 'businessId is required' });
      return;
    }

    const business = await (prisma.business.findUnique as any)({
      where: { id: businessId },
      include: {
        branches: {
          where: { isActive: true },
          include: {
            categories: true, // Category has no isActive column — the old { isActive: { not: false } } filter made Prisma reject the whole provision query (P5-1: /sync/business/provision 400 for everyone)
            manufacturers: { where: { isActive: true } },
            suppliers: { where: { isActive: true } },
            shelves: true,
            products: {
              where: { isActive: true },
              include: {
                category: true,
                supplier: true,
                batches: { where: { isActive: true } }
              }
            },
            customers: { where: { isActive: true } }
          }
        },
        memberships: {
          where: { userId: req.user!.id, status: 'ACTIVE' },
          include: { role: { select: { name: true } } }
        },
        businessSubscription: true,
        businessModules: { include: { module: true } },
        roles: true
      }
    }) as any;

    if (!business) {
      res.status(404).json({ success: false, message: 'Business not found' });
      return;
    }

    if (!(await requireBusinessAccess(prisma, req.user!.id, businessId))) {
      res.status(404).json({ success: false, message: 'Business not found' });
      return;
    }

    res.json({
      success: true,
      data: {
        business: {
          id: business.id,
          name: business.name,
          slug: business.slug,
          description: business.description,
          address: business.address,
          phone: business.phone,
          email: business.email,
          businessType: business.businessType,
          isActive: business.isActive,
          createdAt: business.createdAt
        },
        branches: business.branches.map((b: any) => ({
          id: b.id,
          name: b.name,
          address: b.address,
          phone: b.phone,
          email: b.email,
          isActive: b.isActive
        })),
        roles: business.roles.map((r: any) => ({
          id: r.id,
          name: r.name
        })),
        subscription: business.businessSubscription ? {
          planId: business.businessSubscription.planId,
          status: business.businessSubscription.status,
          trialEndsAt: business.businessSubscription.trialEndsAt
        } : null,
        modules: business.businessModules.map((bm: any) => ({
          moduleId: bm.moduleId,
          key: bm.module.key,
          enabled: bm.enabled
        })),
        memberships: business.memberships.map((m: any) => ({
          id: m.id,
          userId: m.userId,
          role: m.role?.name || 'OWNER'
        }))
      }
    });
  } catch (error: any) {
    console.error('[CloudSync] Provision error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── Sync hardening (Path B — cloud sync API) ─────────────────────────────
// Guarantees enforced by cloudPushOperations / cloudPullChanges:
//  1. IDEMPOTENCY — creates upsert by client-supplied id, deletes are
//     delete-if-present, updates are naturally idempotent, and every op
//     carrying an idempotencyKey (or an op id) is recorded in
//     sync_processed_operations. A replayed batch (client timeout →
//     resend of the SAME batch) gets DUPLICATE + the recorded status
//     back instead of re-applying the write.
//  2. STALE-WRITE PROTECTION — an op whose payload.updatedAt is older
//     than the server row's updatedAt is refused per-op as CONFLICT
//     (server copy attached) so the client can pull and resolve —
//     unless the payload is content-identical to the server row, which
//     is an idempotent replay and is ACCEPTED as a no-op.
//  3. ORDERING — ops are applied in dependency order (parents before
//     children, mirroring the desktop SYNC_TABLES priorities) whatever
//     order the client sent them in; results are reported in the
//     client's original order, one result per op, and a failed op never
//     aborts the batch.
//  4. CURSOR INTEGRITY — see cloudPullChanges: composite (timestamp, id)
//     cursor with >= semantics.
// Path A (sync.service.ts full-table replication) is assessed separately:
// it is deployment-scoped (the desktop backend's own SQLite ↔ its own
// cloud PG) and already resolves per-record by updatedAt last-writer-wins
// on pull (pullTableFromPostgreSQL only overwrites when the PG row is
// newer), so the per-op conflict contract above is a Path B concern.

// Entity types the desktop may never push:
// - customerLedgerEntry / loyaltyTransaction (B2/B3): server-derived
//   ledgers (PULL-ONLY) — accepting a client copy would double-post the
//   khata/loyalty entry the server already wrote inside its transaction.
// - fbrConfig / fbrInvoiceQueue (B7): excluded from sync by design — the
//   config holds a write-only PRAL API token; the queue is server-side
//   worker state.
const PUSH_BLOCKED_ENTITY_TYPES = new Set([
  'customerLedgerEntry', 'loyaltyTransaction', 'fbrConfig', 'fbrInvoiceQueue'
]);

// Dependency rank for in-batch ordering (lower applies first). Mirrors the
// desktop's SYNC_TABLES priorities (electron/services/sync.service.js).
// Unknown entity types apply last, in client order.
//
// Shift fix (2026-10-27, B2/B5): staffProfile (112) and shift (115) rank
// BEFORE sale (120) — a sale pushed in the same batch as the shift it
// was rung under must not land before its shift row, or the sale's
// shiftId FK (P2003) fails the create. A staffProfile is created on the
// server (admin/web) and only pulled down, never pushed — its rank is
// for the same parent-before-child guarantee in any batch that carries
// one.
const ENTITY_DEPENDENCY_RANK: Record<string, number> = {
  category: 40, manufacturer: 50, supplier: 60, shelf: 70,
  product: 80, productVariant: 85, batch: 90,
  customer: 100, employee: 110, staffProfile: 112, shift: 115,
  sale: 120, saleItem: 130, salePayment: 135, salePromotion: 136, saleTaxLine: 137,
  purchase: 140, purchaseItem: 150,
  stockMovement: 160, receipt: 170, refund: 180, refundItem: 190,
  attendance: 200, scheduledShift: 220, scheduledShiftUser: 230,
  commission: 240, settings: 250, cardDetails: 260, subscription: 270,
  stockTransfer: 300, stockTransferItem: 310,
  stockTake: 320, stockTakeLine: 330,
  promotion: 340, taxClass: 350,
  prescription: 410, prescriptionItem: 420,
  patient: 430, doctor: 440, appointment: 450, doctorSettlement: 460,
  roomType: 470, room: 480, reservation: 490, folio: 500, folioCharge: 510, folioPayment: 520
};
const DEFAULT_DEPENDENCY_RANK = 9999;

// Only deterministic outcomes are written to the dedupe store. A FAILED
// op (transient DB error, …) stays unrecorded so a later retry can still
// succeed instead of being answered DUPLICATE/FAILED forever.
const RECORDED_OP_STATUSES = new Set(['ACCEPTED', 'CONFLICT', 'REJECTED']);
const OP_KEY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function parseTimestampMs(value: any): number | null {
  if (value === null || value === undefined) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function normalizeForCompare(value: any): any {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : value;
  }
  if (typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return String(value); }
  }
  return value;
}

// Identity, tenancy and timestamps never take part in the content
// comparison: identity/tenancy are server-managed and updatedAt is what
// the stale check itself compares.
const COMPARE_SKIP_FIELDS = new Set(['id', 'companyId', 'businessId', 'createdAt', 'updatedAt']);

function payloadMatchesExisting(payload: any, existing: any): boolean {
  for (const key of Object.keys(payload || {})) {
    if (COMPARE_SKIP_FIELDS.has(key)) continue;
    const a = normalizeForCompare(payload[key]);
    const b = normalizeForCompare(existing ? existing[key] : undefined);
    if (a === b) continue;
    // Tolerate scalar type drift from JSON transports (5 vs "5", true vs 1).
    if (a !== null && b !== null && String(a) === String(b)) continue;
    return false;
  }
  return true;
}

type StaleVerdict = 'fresh' | 'replay' | 'conflict';

// R6b: a payload timestamped more than this far ahead of the server
// clock is a skewed terminal clock, not a fresh write. It must not
// outrank the server row on time alone (see staleVerdict).
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

// R3: a push op that sat queued longer than this before landing was
// made while the terminal was offline.
const OFFLINE_SALE_DELAY_MS = 2 * 60 * 1000;

function staleVerdict(payload: any, existing: any, serverNowMs: number = Date.now()): StaleVerdict {
  const incomingMs = parseTimestampMs(payload ? payload.updatedAt : null);
  const serverMs = parseTimestampMs(existing ? (existing.updatedAt ?? existing.createdAt) : null);
  if (incomingMs === null || serverMs === null || incomingMs >= serverMs) {
    // R6b — future-skew guard: the incoming timestamp is ahead of the
    // server row, but if it is ALSO far ahead of the server's own clock
    // the terminal's clock is skewed, not the write fresh. A
    // content-identical payload is still an idempotent replay; anything
    // else is a conflict (server wins, client pulls to resolve) rather
    // than a stale write silently overwriting newer server data.
    if (incomingMs !== null && incomingMs > serverNowMs + CLOCK_SKEW_TOLERANCE_MS) {
      return payloadMatchesExisting(payload, existing) ? 'replay' : 'conflict';
    }
    return 'fresh';
  }
  return payloadMatchesExisting(payload, existing) ? 'replay' : 'conflict';
}

// ── Push-payload sanitizer (R1 prerequisite, 2026-10-26) ───────────────
// The desktop pushes raw local SQLite rows. Local rows carry columns the
// cloud model does not have, and Prisma rejects unknown arguments — so
// before this change EVERY desktop sale push failed validation
// (sales.grandTotal/discount/tax/notes/employeeId/receiptNumber;
// sale_items.total + a nested `product` object + no saleId/batchId in
// the enqueued shape) and parked FAILED after 5 retries, while the sale
// itself looked synced locally. The allowlist below drops unknown fields
// per model; models without an entry keep today's pass-through
// behaviour. Server-managed fields (syncOrigin, stockReplayedAt,
// oversold, ...) are never taken from a payload — the server sets them.
// Field renames the desktop's local naming needs:
// - sale: local totalAmount holds the SUBTOTAL and grandTotal the real
//   total (sales.routes.js INSERT); cloud totalAmount is the real total.
//   local tax/discount map to taxAmount/discountAmount.
// - saleItem / purchaseItem: local money column is `total`; cloud is
//   totalPrice.
// - refund: local saleId/amount/reason -> originalSaleId/refundAmount/
//   refundReason; createdBy (the desktop stores the refunder there) ->
//   refundedBy.
// - refundItem: local `amount` is the LINE TOTAL; cloud unitPrice is
//   per-unit, so it is divided by quantity.
// - stockMovement: local referenceId -> cloud reference.
const PUSH_FIELD_ALLOWLIST: Record<string, Set<string>> = {
  sale: new Set(['id', 'invoiceNumber', 'customerId', 'userId', 'branchId', 'companyId', 'createdBy', 'subtotal', 'taxAmount', 'provincialTaxAmount', 'discountAmount', 'discountPercentage', 'loyaltyPointsRedeemed', 'loyaltyDiscount', 'loyaltyPointsEarned', 'promotionDiscount', 'fbrInvoiceNumber', 'fbrStatus', 'postexTrackingNumber', 'postexShipmentStatus', 'prescriptionId', 'folioId', 'salespersonId', 'shiftId', 'channel', 'externalOrderId', 'deliveryAddress', 'deliveryPhone', 'deliveryNotes', 'giftCardAmount', 'walletAmount', 'totalAmount', 'paidAmount', 'returnedAmount', 'paymentMethod', 'paymentStatus', 'status', 'saleDate', 'membershipId', 'uuid', 'syncStatus', 'createdAt', 'updatedAt']),
  saleItem: new Set(['id', 'saleId', 'productId', 'batchId', 'createdBy', 'quantity', 'unitsDeducted', 'unitsPerBox', 'saleType', 'unitLevel', 'unitFactor', 'variantId', 'variantName', 'unitPrice', 'totalPrice', 'batchNumber', 'expiryDate']),
  // Shift fix (2026-10-27, B2): the desktop pushes real shift rows now.
  // Deliberately NO companyId in this set: the Shift model has no
  // companyId field (tenancy runs through membershipId), and
  // applyPushCreate injects companyId before sanitizing — the sanitizer
  // strips it here, so the create never sees an unknown argument. The
  // desktop must send only cloud Shift fields (no legacy name/isActive).
  shift: new Set(['id', 'staffProfileId', 'membershipId', 'branchId', 'shiftDate', 'startTime', 'endTime', 'openingBalance', 'cashIn', 'cashOut', 'expectedBalance', 'actualBalance', 'difference', 'status', 'notes', 'createdAt', 'updatedAt']),
  purchase: new Set(['id', 'supplierId', 'branchId', 'companyId', 'invoiceNo', 'purchaseDate', 'totalAmount', 'paidAmount', 'outstanding', 'status', 'notes', 'createdBy', 'createdAt', 'updatedAt']),
  purchaseItem: new Set(['id', 'purchaseId', 'productId', 'batchId', 'quantity', 'unitPrice', 'totalPrice', 'createdAt', 'updatedAt']),
  refund: new Set(['id', 'originalSaleId', 'refundReason', 'refundAmount', 'refundMethod', 'refundReference', 'refundedBy', 'createdBy', 'status', 'processedAt', 'createdAt', 'updatedAt']),
  refundItem: new Set(['id', 'refundId', 'productId', 'createdBy', 'quantity', 'unitPrice', 'reason']),
  stockMovement: new Set(['id', 'productId', 'type', 'quantity', 'reason', 'reference', 'createdAt', 'createdBy'])
};

function sanitizePushData(entityType: string, data: any): Record<string, any> {
  const raw = data || {};
  const allow = PUSH_FIELD_ALLOWLIST[entityType];
  if (!allow) return { ...raw };
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (allow.has(k)) out[k] = v;
  }
  if (entityType === 'sale') {
    // Local money naming (see header): grandTotal is the real total,
    // totalAmount is the subtotal, tax/discount are the tax/discount
    // amounts. The local subtotal/taxAmount/discountAmount columns are
    // written as 0 by the desktop INSERT, so fall back to the local
    // names whenever the cloud-named value is absent or zero.
    if (raw.grandTotal !== undefined && raw.grandTotal !== null) out.totalAmount = raw.grandTotal;
    if ((out.subtotal === undefined || out.subtotal === null || out.subtotal === 0) && raw.totalAmount !== undefined) out.subtotal = raw.totalAmount;
    if ((out.taxAmount === undefined || out.taxAmount === null || out.taxAmount === 0) && raw.tax !== undefined) out.taxAmount = raw.tax;
    if ((out.discountAmount === undefined || out.discountAmount === null || out.discountAmount === 0) && raw.discount !== undefined) out.discountAmount = raw.discount;
  }
  if (entityType === 'saleItem' && out.totalPrice === undefined && raw.total !== undefined) {
    out.totalPrice = raw.total;
  }
  if (entityType === 'purchaseItem' && out.totalPrice === undefined && raw.total !== undefined) {
    out.totalPrice = raw.total;
  }
  if (entityType === 'refund') {
    if (out.originalSaleId === undefined && raw.saleId !== undefined) out.originalSaleId = raw.saleId;
    if (out.refundAmount === undefined && raw.amount !== undefined) out.refundAmount = raw.amount;
    if (out.refundReason === undefined && raw.reason !== undefined) out.refundReason = raw.reason;
    if (out.refundedBy === undefined && raw.createdBy !== undefined) out.refundedBy = raw.createdBy;
  }
  if (entityType === 'refundItem' && out.unitPrice === undefined && raw.amount !== undefined) {
    const qty = Math.floor(Number(raw.quantity) || 0);
    out.unitPrice = qty > 0 ? Number(raw.amount) / qty : Number(raw.amount) || 0;
  }
  if (entityType === 'stockMovement' && out.reference === undefined && raw.referenceId !== undefined) {
    out.reference = raw.referenceId;
  }
  return out;
}

// R4: server-issued invoice number. Mirrors the web generator in
// sale.controller.ts (global last-number + 1 with retry, timestamp
// fallback) because invoiceNumber is globally @unique — two terminals
// that both minted INV-10345 locally collide on the same sequence.
async function generateServerInvoiceNumber(prisma: any): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const lastSale = await prisma.sale.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { invoiceNumber: true }
    });
    let baseNumber = 10000;
    if (lastSale?.invoiceNumber) {
      const match = lastSale.invoiceNumber.match(/INV-(\d+)/);
      if (match) baseNumber = parseInt(match[1], 10);
    }
    const nextNumber = ((baseNumber + 1 + attempt) % 99999) || 10000;
    const candidate = `INV-${String(nextNumber).padStart(5, '0')}`;
    const clash = await prisma.sale.findUnique({ where: { invoiceNumber: candidate }, select: { id: true } });
    if (!clash) return candidate;
  }
  return `INV-${Date.now().toString().slice(-8)}`;
}

function isUniqueViolation(error: any): boolean {
  return error && (error.code === 'P2002' || /Unique constraint failed/i.test(String(error.message || '')));
}

// Server-managed fields are never taken from a pushed payload: identity is
// pinned to the op's entityId, tenancy to the authenticated business, and
// timestamps to the server's own clock. (Previously an UPDATE payload
// carrying a foreign companyId could move a row across tenants.)
function stripServerManagedFields(payload: any): Record<string, any> {
  const data = { ...(payload || {}) };
  delete data.id;
  delete data.companyId;
  delete data.businessId;
  delete data.createdAt;
  delete data.updatedAt;
  return data;
}

function conflictResult(opId: any, entityType: string, entityId: string, existing: any) {
  return {
    id: opId,
    status: 'CONFLICT',
    message: 'Stale write rejected: the server row is newer than the pushed payload. Pull to resolve.',
    entityType,
    entityId,
    serverUpdatedAt: existing ? (existing.updatedAt ?? existing.createdAt ?? null) : null,
    serverData: existing
  };
}

// ── Processed-op dedupe store (sync_processed_operations) ───────────────
let opStoreWarned = false;
function getProcessedOpStore(prisma: any): any | null {
  const store = (prisma as any).syncProcessedOperation;
  if (!store || typeof store.findUnique !== 'function') {
    if (!opStoreWarned) {
      opStoreWarned = true;
      console.warn('[CloudSync] syncProcessedOperation delegate unavailable — op-id dedupe disabled (natural idempotency + stale-write protection still apply)');
    }
    return null;
  }
  return store;
}

let lastOpPruneAt = 0;
async function pruneProcessedOps(store: any): Promise<void> {
  const nowMs = Date.now();
  if (nowMs - lastOpPruneAt < 10 * 60 * 1000) return; // at most once / 10 min / process
  lastOpPruneAt = nowMs;
  try {
    await store.deleteMany({ where: { createdAt: { lt: new Date(nowMs - OP_KEY_TTL_MS) } } });
  } catch { /* best-effort housekeeping */ }
}

async function recordProcessedOp(store: any, businessId: string, op: any, opKey: string, result: any): Promise<void> {
  try {
    await store.upsert({
      where: { uq_sync_processed_op_key: { companyId: businessId, opKey } },
      create: {
        companyId: businessId,
        opKey,
        opId: op.id != null ? String(op.id) : null,
        entityType: String(op.entityType || ''),
        entityId: op.entityId != null ? String(op.entityId) : null,
        operation: String(op.operation || ''),
        status: result.status,
        message: result.message != null ? String(result.message).slice(0, 500) : null
      },
      update: { status: result.status, message: result.message != null ? String(result.message).slice(0, 500) : null }
    });
  } catch { /* dedupe recording must never fail the push itself */ }
}

// Shift fix (2026-10-27, B2/L-5): shift + staffProfile carry no
// companyId — their tenancy runs through membershipId. The create-replay
// / update / delete paths below resolve the owning business through the
// membership, so a pushed op for another business's shift is rejected
// exactly like a companyId mismatch. For every other entity type this
// returns companyId/businessId with no extra query.
async function resolveRowBusinessId(prisma: any, entityType: string, row: any): Promise<string | undefined> {
  if (!row) return undefined;
  if (row.companyId !== undefined) return row.companyId;
  if (row.businessId !== undefined) return row.businessId;
  if ((entityType === 'shift' || entityType === 'staffProfile') && row.membershipId) {
    const membership = await prisma.membership.findUnique({ where: { id: row.membershipId }, select: { businessId: true } });
    return membership?.businessId;
  }
  return undefined;
}

async function applyPushCreate(prisma: any, businessId: string, opId: any, entityType: string, entityId: string, payload: any, opts: { actorUserId?: string | null; queuedAtMs?: number | null } = {}) {
  const model = (prisma as any)[entityType];
  if (!model?.create || !payload) return { id: opId, status: 'ACCEPTED' };

  const existing = entityId && model.findUnique
    ? await model.findUnique({ where: { id: entityId } })
    : null;

  if (!existing) {
    const data = sanitizePushData(entityType, { ...payload, id: entityId, companyId: businessId });
    // R1: mark desktop-pushed sales/refunds at the server so the stock
    // replay can find them (and can never touch a web sale).
    if (entityType === 'sale') {
      data.syncOrigin = 'DESKTOP_PUSH';
      if (opts.queuedAtMs && Date.now() - opts.queuedAtMs > OFFLINE_SALE_DELAY_MS) data.offlineSale = true;
      // The desktop sale INSERT never sets userId (only createdBy) and
      // the cloud requires it. Prefer the authenticated actor: it is
      // always a real cloud user, while createdBy is a LOCAL id that
      // need not exist on the cloud (a stale/local-only id trips the
      // sales_userId_fkey). createdBy is still stored on the row, so
      // attribution is preserved.
      if (!data.userId && opts.actorUserId) data.userId = opts.actorUserId;
      if (!data.userId && data.createdBy) data.userId = data.createdBy;
    }
    if (entityType === 'refund') {
      data.syncOrigin = 'DESKTOP_PUSH';
      // The sanitizer maps createdBy -> refundedBy, but createdBy is a
      // LOCAL id that need not exist on the cloud (same FK trap as the
      // sale userId above) — the authenticated actor always wins.
      if (opts.actorUserId) data.refundedBy = opts.actorUserId;
      if (!data.refundedBy && data.createdBy) data.refundedBy = data.createdBy;
    }
    try {
      await model.create({ data });
    } catch (createError: any) {
      // R4: the terminal's invoice number already exists on the cloud
      // (two terminals minted the same INV-xxxxx from local data). The
      // sale must NOT be lost to a P2002 -> FAILED -> parked-forever
      // hole: reassign a server-issued number, preserve the terminal's
      // number for traceability, and accept the sale.
      if (entityType === 'sale' && isUniqueViolation(createError) && data.invoiceNumber) {
        const terminalInvoiceNumber = data.invoiceNumber;
        for (let attempt = 0; attempt < 3; attempt++) {
          data.invoiceNumber = await generateServerInvoiceNumber(prisma);
          data.terminalInvoiceNumber = terminalInvoiceNumber;
          try {
            const created = await model.create({ data });
            return {
              id: opId,
              status: 'ACCEPTED',
              message: `Invoice number ${terminalInvoiceNumber} already existed on the cloud; reassigned to ${created.invoiceNumber}`,
              serverInvoiceNumber: created.invoiceNumber,
              terminalInvoiceNumber
            };
          } catch (retryError: any) {
            if (!isUniqueViolation(retryError)) throw retryError;
          }
        }
      }
      throw createError;
    }
    return { id: opId, status: 'ACCEPTED' };
  }

  // Create against an id that already exists = replay or duplicate create.
  const owner = await resolveRowBusinessId(prisma, entityType, existing);
  if (owner !== undefined && owner !== businessId) {
    return { id: opId, status: 'FAILED', message: 'Entity does not belong to this business' };
  }
  const verdict = staleVerdict(payload, existing);
  if (verdict === 'conflict') return conflictResult(opId, entityType, entityId, existing);
  if (verdict === 'replay') {
    return { id: opId, status: 'ACCEPTED', message: 'Idempotent replay — server row already reflects this create' };
  }
  if (model.update) {
    const data = sanitizePushData(entityType, stripServerManagedFields(payload));
    if (Object.keys(data).length > 0) {
      await model.update({ where: { id: entityId }, data });
    }
  }
  return { id: opId, status: 'ACCEPTED' };
}

async function applyPushUpdate(prisma: any, businessId: string, opId: any, entityType: string, entityId: string, payload: any) {
  const model = (prisma as any)[entityType];
  if (!model?.update || !payload) return { id: opId, status: 'ACCEPTED' };

  const existing = model.findUnique
    ? await model.findUnique({ where: { id: entityId } })
    : null;
  if (!existing) {
    return { id: opId, status: 'FAILED', message: 'Entity not found on server' };
  }
  const owner = await resolveRowBusinessId(prisma, entityType, existing);
  if (owner !== undefined && owner !== businessId) {
    return { id: opId, status: 'FAILED', message: 'Entity does not belong to this business' };
  }
  const verdict = staleVerdict(payload, existing);
  if (verdict === 'conflict') return conflictResult(opId, entityType, entityId, existing);
  if (verdict === 'replay') {
    return { id: opId, status: 'ACCEPTED', message: 'Idempotent replay — payload already reflected on the server' };
  }
  await model.update({ where: { id: entityId }, data: sanitizePushData(entityType, stripServerManagedFields(payload)) });
  return { id: opId, status: 'ACCEPTED' };
}

async function applyPushDelete(prisma: any, businessId: string, opId: any, entityType: string, entityId: string, payload: any) {
  const model = (prisma as any)[entityType];
  if (!model?.delete) return { id: opId, status: 'ACCEPTED' };

  const existing = model.findUnique
    ? await model.findUnique({ where: { id: entityId } })
    : null;
  // Delete is idempotent: replaying a delete of an already-absent row is
  // the desired end state, not an error (previously it threw P2025 and
  // the op was reported FAILED on every retry).
  if (!existing) {
    return { id: opId, status: 'ACCEPTED', message: 'Already absent on the server' };
  }
  const owner = await resolveRowBusinessId(prisma, entityType, existing);
  if (owner !== undefined && owner !== businessId) {
    return { id: opId, status: 'FAILED', message: 'Entity does not belong to this business' };
  }
  if (payload && staleVerdict(payload, existing) === 'conflict') {
    return conflictResult(opId, entityType, entityId, existing);
  }
  await model.delete({ where: { id: entityId } });
  return { id: opId, status: 'ACCEPTED' };
}

async function applyPushOperation(prisma: any, store: any, businessId: string, rawOp: any, actorUserId?: string | null) {
  const op = rawOp || {};
  const opId = op.id != null ? op.id : null;
  try {
    const { entityType, entityId, payload } = op;
    const operation = String(op.operation || '').toUpperCase();
    const opKey = op.idempotencyKey || op.id || null;
    // queuedAt is the desktop's sync_operations.createdAt for this op
    // (sent by buildPushOperation) — the server uses it to mark sales
    // that were made while the terminal was offline (R3).
    const queuedAtMs = op.queuedAt ? Date.parse(op.queuedAt) : null;

    if (opKey && store) {
      let prior: any = null;
      try {
        prior = await store.findUnique({
          where: { uq_sync_processed_op_key: { companyId: businessId, opKey: String(opKey) } }
        });
      } catch { prior = null; }
      if (prior) {
        return {
          id: opId,
          status: 'DUPLICATE',
          originalStatus: prior.status,
          message: 'Operation already processed — recorded result returned without re-applying'
        };
      }
    }

    let result: any;
    if (PUSH_BLOCKED_ENTITY_TYPES.has(entityType)) {
      result = { id: opId, status: 'REJECTED', message: `Entity type ${entityType} is not pushable (server-managed)` };
    } else if (operation === 'DELETE') {
      result = await applyPushDelete(prisma, businessId, opId, entityType, entityId, payload);
    } else if (operation === 'CREATE') {
      result = await applyPushCreate(prisma, businessId, opId, entityType, entityId, payload, {
        actorUserId: actorUserId ?? null,
        queuedAtMs: Number.isFinite(queuedAtMs) ? queuedAtMs : null
      });
    } else if (operation === 'UPDATE') {
      result = await applyPushUpdate(prisma, businessId, opId, entityType, entityId, payload);
    } else {
      result = { id: opId, status: 'REJECTED', message: `Unknown operation: ${op.operation}` };
    }

    if (opKey && store && RECORDED_OP_STATUSES.has(result.status)) {
      await recordProcessedOp(store, businessId, op, String(opKey), result);
    }
    return result;
  } catch (opError: any) {
    return { id: opId, status: 'FAILED', message: opError.message };
  }
}

export const cloudPushOperations = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { businessId, operations } = req.body;

    if (!businessId || !operations || !Array.isArray(operations)) {
      res.status(400).json({
        success: false,
        message: 'businessId and operations[] are required'
      });
      return;
    }

    if (!(await requireBusinessAccess(prisma, req.user!.id, businessId))) {
      res.status(403).json({ success: false, message: 'Forbidden' });
      return;
    }

    const store = getProcessedOpStore(prisma);
    if (store) await pruneProcessedOps(store);

    // Apply in dependency order (parents before children); the sort is
    // stable, so ops of the same entity type keep the client's order.
    // Results are slotted back into the client's original order.
    const ordered = operations
      .map((op: any, index: number) => {
        const typeKey = op && typeof op.entityType === 'string' ? op.entityType : '';
        return { op, index, rank: ENTITY_DEPENDENCY_RANK[typeKey] ?? DEFAULT_DEPENDENCY_RANK };
      })
      .sort((a: any, b: any) => a.rank - b.rank);

    const results: any[] = new Array(operations.length);
    for (const { op, index } of ordered) {
      results[index] = await applyPushOperation(prisma, store, businessId, op, req.user!.id);
    }

    // R1 — server-side stock effect for pushed sales. The ops above
    // land the sale + item rows; the replay runs AFTER the whole batch
    // (items rank after sales, so a sale op alone never sees its lines
    // yet). Sales replay first — the refund restock below reads the
    // SaleItemBatch rows the replay writes. Triggers on ACCEPTED and on
    // DUPLICATE (a retried batch whose first attempt replayed nothing
    // because it threw); the claim inside the replay makes re-triggering
    // safe. A replay failure is logged, never fatal to the push — the
    // sale is already accepted, and the R7 reconciliation will surface
    // the missing stock effect.
    const replaySaleIds = new Set<string>();
    const restockRefundIds = new Set<string>();
    for (let i = 0; i < operations.length; i++) {
      const op = operations[i] || {};
      const r = results[i];
      if (!r || (r.status !== 'ACCEPTED' && r.status !== 'DUPLICATE')) continue;
      const opType = String(op.operation || '').toUpperCase();
      if (op.entityType === 'sale' && opType === 'CREATE' && op.entityId) replaySaleIds.add(String(op.entityId));
      if (op.entityType === 'saleItem' && op.payload && op.payload.saleId) replaySaleIds.add(String(op.payload.saleId));
      if (op.entityType === 'refund' && opType === 'CREATE' && op.entityId) restockRefundIds.add(String(op.entityId));
      if (op.entityType === 'refundItem' && op.payload && op.payload.refundId) restockRefundIds.add(String(op.payload.refundId));
    }
    for (const saleId of replaySaleIds) {
      try {
        await replaySaleStock(prisma, saleId);
      } catch (e: any) {
        console.error(`[CloudSync] Stock replay failed for sale ${saleId}:`, e.message);
      }
    }
    for (const refundId of restockRefundIds) {
      try {
        await restockRefundStock(prisma, refundId);
      } catch (e: any) {
        console.error(`[CloudSync] Refund restock failed for refund ${refundId}:`, e.message);
      }
    }

    res.json({ success: true, data: { results } });
  } catch (error: any) {
    console.error('[CloudSync] Push error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

const PULL_PAGE_SIZE = 100;

interface PullCursor {
  sinceMs: number;
  lastId: string | null;
}

function parsePullCursor(cursor: string | undefined): PullCursor {
  if (!cursor) {
    return { sinceMs: Date.now() - 86400000, lastId: null };
  }
  const sep = cursor.indexOf('|');
  const tsPart = sep >= 0 ? cursor.slice(0, sep) : cursor;
  const idPart = sep >= 0 ? cursor.slice(sep + 1) : null;
  const ms = Date.parse(tsPart);
  if (!Number.isFinite(ms)) {
    return { sinceMs: Date.now() - 86400000, lastId: null };
  }
  return { sinceMs: ms, lastId: idPart ? idPart : null };
}

function encodePullCursor(ms: number, id: string | null): string {
  const iso = new Date(ms).toISOString();
  return id ? `${iso}|${id}` : iso;
}

// Map a cloud SaleItem row to the desktop sale_items shape. The local
// table's money column is `total` (not `totalPrice`); columns the local
// table lacks (createdBy, unitsDeducted, unitsPerBox, saleType,
// batchNumber, expiryDate) are dropped so applyChanges never sees an
// unknown column — an unmapped totalPrice would fail every row, hold the
// cursor, and freeze all later pulls (v1.0.9 lesson).
function mapSaleItemForSQLite(item: any): any {
  return {
    id: item.id,
    saleId: item.saleId,
    productId: item.productId,
    batchId: item.batchId ?? null,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    total: item.totalPrice ?? null,
    unitLevel: item.unitLevel ?? null,
    unitFactor: item.unitFactor ?? null,
    variantId: item.variantId ?? null,
    variantName: item.variantName ?? null
  };
}

// Map a cloud Sale row to the desktop sales shape. The R1/R3/R4
// columns (syncOrigin, stockReplayedAt, oversold, oversellDetail,
// offlineSale, terminalInvoiceNumber, reviewedAt, reviewedBy) do not
// exist in v1.0.10 desktops — an unmapped column fails every row, holds
// the cursor, and freezes all later pulls (v1.0.9 lesson). They are
// dropped here until the v1.0.11 desktop migration lands
// (SYNC_SCHEMA_UPGRADES_V1011); the review page reads them from the
// cloud API, not the local DB, so nothing the desktop shows loses them.
function mapSaleForSQLite(sale: any): any {
  const { syncOrigin, stockReplayedAt, oversold, oversellDetail, offlineSale, terminalInvoiceNumber, reviewedAt, reviewedBy, ...rest } = sale || {};
  return rest;
}

// Map a cloud StockMovement row to the desktop stock_movements shape.
// The cloud column is `reference` (a sale id for OUT, `REF-<id>` for
// RETURN); the local columns are referenceId/referenceType. The parent
// loop used to serve this table raw, so EVERY stockMovement row failed
// applyChanges on the unknown `reference` column.
function mapStockMovementForSQLite(movement: any, businessId: string): any {
  return {
    id: movement.id,
    productId: movement.productId,
    type: movement.type,
    quantity: movement.quantity,
    reason: movement.reason ?? null,
    referenceId: movement.reference ?? null,
    referenceType: movement.type === 'OUT' ? 'SALE' : movement.type === 'RETURN' ? 'REFUND' : null,
    branchId: null,
    companyId: businessId,
    createdBy: movement.createdBy ?? null,
    createdAt: movement.createdAt
  };
}

// Map a cloud Receipt row to the desktop receipts shape. The cloud has
// no amount/paymentMethod/companyId on receipts (those live on the sale
// + salePayments) — the parent sale's totals are used so the desktop
// receipts list does not read Rs 0.
function mapReceiptForSQLite(receipt: any, businessId: string, sale: any): any {
  return {
    id: receipt.id,
    saleId: receipt.saleId,
    receiptNumber: receipt.receiptNumber,
    amount: sale ? (sale.totalAmount ?? 0) : 0,
    paymentMethod: sale ? (sale.paymentMethod ?? null) : null,
    userId: receipt.userId,
    branchId: receipt.branchId,
    companyId: businessId,
    createdAt: receipt.printedAt,
    updatedAt: receipt.printedAt
  };
}

// Map a cloud Refund row to the desktop refunds shape. The cloud names
// are originalSaleId/refundAmount/refundReason; the local names are
// saleId/amount/reason. branchId comes from the parent sale.
function mapRefundForSQLite(refund: any, businessId: string, branchId: string | null): any {
  return {
    id: refund.id,
    saleId: refund.originalSaleId,
    amount: refund.refundAmount,
    reason: refund.refundReason,
    branchId: branchId ?? null,
    companyId: businessId,
    status: refund.status,
    createdBy: refund.createdBy ?? refund.refundedBy ?? null,
    createdAt: refund.createdAt,
    updatedAt: refund.updatedAt ?? refund.createdAt
  };
}

// Map a cloud RefundItem row to the desktop refund_items shape. The
// cloud stores a per-unit price; the local `amount` is the line total.
// saleItemId has no cloud equivalent (the refund flow does not store
// it on the item) — null on pulled rows.
function mapRefundItemForSQLite(item: any): any {
  return {
    id: item.id,
    refundId: item.refundId,
    saleItemId: null,
    productId: item.productId,
    quantity: item.quantity,
    amount: (item.quantity || 0) * (item.unitPrice || 0),
    reason: item.reason
  };
}

// Map a cloud PurchaseItem row to the desktop purchase_items shape.
// The local money column is `total`; the cloud column is totalPrice.
function mapPurchaseItemForSQLite(item: any): any {
  return {
    id: item.id,
    purchaseId: item.purchaseId,
    productId: item.productId,
    batchId: item.batchId ?? null,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    total: item.totalPrice ?? null,
    createdAt: item.createdAt
  };
}

export const cloudPullChanges = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const businessId = req.query.businessId as string;
    const cursor = req.query.cursor as string | undefined;

    if (!businessId) {
      res.status(400).json({ success: false, message: 'businessId is required' });
      return;
    }

    if (!(await requireBusinessAccess(prisma, req.user!.id, businessId))) {
      res.status(403).json({ success: false, message: 'Forbidden' });
      return;
    }

    // Cursor integrity: the cursor is a composite (timestamp, id) pair,
    // encoded as "<ISO timestamp>|<last id>". Rows sharing the exact
    // cursor timestamp are NOT skipped: the per-table filter is
    // (ts > cursorTs) OR (ts = cursorTs AND id > cursorId), ordered by
    // (ts, id), so a page cut mid-timestamp by the 100-row limit resumes
    // exactly after the last returned row. Legacy plain-ISO cursors
    // (written by older desktops) are still accepted and behave as
    // before (>= timestamp). nextCursor only advances to the oldest
    // truncated table's frontier when any table hit the page limit —
    // every other table was fully drained, and rows past the frontier
    // are simply re-fetched (upserts are idempotent).
    const parsedCursor = parsePullCursor(cursor);
    const sinceDate = new Date(parsedCursor.sinceMs);
    const cursorLastId = parsedCursor.lastId;
    const changes: any[] = [];

    // Tables served by the cursor pull. Only companyId-scoped PARENT tables
    // can be served here (the query filters by companyId + a timestamp).
    // Child tables without companyId (stockTransferItem,
    // prescriptionItem, salePromotion, saleTaxLine, folioCharge,
    // folioPayment, stockTakeLine) are NOT cursor-pulled, by the same
    // precedent: they move with their parents via operations push and the
    // full-table replication in sync.service.ts.
    // EXCEPTIONS — children served keyed on their parent (R5, 2026-10-26):
    // saleItem + salePayment + receipt (keyed on the parent sale, see the
    // blocks below — the desktop dashboard aggregates most-selling from
    // local sale_items and a counter must see another counter's tenders
    // and receipts), refund + refundItem (keyed on the parent refund),
    // purchaseItem (keyed on the parent purchase).
    //
    // Maturity-program additions (Waves A2–C6):
    // - Two-way parents: stockTransfer, promotion, taxClass, prescription,
    //   patient, doctor, appointment, doctorSettlement, roomType, room,
    //   reservation, folio, productVariant, stockTake.
    // - customerLedgerEntry + loyaltyTransaction (B2/B3) are PULL-ONLY:
    //   server-derived ledgers the desktop must never push back (the cloud
    //   push endpoint is never fed these by the desktop, and the replication
    //   push lists in sync.service.ts omit them). They are append-only with
    //   no updatedAt column, so their cursor field is createdAt.
    // - fbr_configs / fbr_invoice_queue (B7) are EXCLUDED by design: the
    //   config holds a write-only PRAL API token that must never leave the
    //   server, and the queue is server-side worker state.
    //
    // EXCEPTION — membership-scoped parents (shift fix, 2026-10-27, B2):
    // shift + staffProfile carry no companyId; their tenancy runs through
    // membershipId, so the pull filters by membership.businessId instead.
    // The desktop needs both: staffProfiles so the POS can resolve the
    // signed-in cashier's profile, and shifts so a counter sees the
    // shift another counter opened.
    const CREATED_AT_CURSOR_TABLES = new Set(['customerLedgerEntry', 'loyaltyTransaction']);
    const MEMBERSHIP_SCOPED_PULL_TABLES = new Set(['shift', 'staffProfile']);
    const tables = [
      'product', 'customer', 'sale', 'purchase', 'batch', 'category', 'supplier', 'manufacturer', 'shelf', 'stockMovement',
      'stockTransfer', 'promotion', 'taxClass', 'prescription',
      'patient', 'doctor', 'appointment', 'doctorSettlement',
      'roomType', 'room', 'reservation', 'folio',
      'productVariant', 'stockTake',
      'customerLedgerEntry', 'loyaltyTransaction',
      'shift', 'staffProfile'
    ];
    let maxSeen: { ms: number; id: string } | null = null;
    const truncatedFrontiers: Array<{ ms: number; id: string }> = [];
    for (const table of tables) {
      try {
        const model = (prisma as any)[table];
        if (!model?.findMany) continue;
        const tsField = CREATED_AT_CURSOR_TABLES.has(table) ? 'createdAt' : 'updatedAt';
        const tsCondition = cursorLastId
          ? {
              OR: [
                { [tsField]: { gt: sinceDate } },
                { [tsField]: sinceDate, id: { gt: cursorLastId } }
              ]
            }
          : { [tsField]: { gte: sinceDate } };
        // Membership-scoped tables (shift fix, 2026-10-27, B2) filter by
        // membership.businessId — they carry no companyId.
        const where = MEMBERSHIP_SCOPED_PULL_TABLES.has(table)
          ? { membership: { businessId }, ...tsCondition }
          : { companyId: businessId, ...tsCondition };
        const records = await model.findMany({
          where,
          orderBy: [{ [tsField]: 'asc' }, { id: 'asc' }],
          take: PULL_PAGE_SIZE
        });
        if (records.length === PULL_PAGE_SIZE) {
          const last = records[records.length - 1];
          truncatedFrontiers.push({ ms: new Date(last[tsField]).getTime(), id: String(last.id) });
        }
        for (const record of records) {
          // R5: the sale + stockMovement rows need mapping (new R1
          // columns / reference column) — every other parent table is
          // served raw exactly as before.
          const data = table === 'sale'
            ? mapSaleForSQLite(record)
            : table === 'stockMovement'
              ? mapStockMovementForSQLite(record, businessId)
              : record;
          changes.push({
            entityType: table,
            entityId: record.id,
            operation: 'UPSERT',
            data,
            timestamp: record[tsField]
          });
          const ms = new Date(record[tsField]).getTime();
          if (!maxSeen || ms > maxSeen.ms || (ms === maxSeen.ms && String(record.id) > maxSeen.id)) {
            maxSeen = { ms, id: String(record.id) };
          }
        }
      } catch { }
    }

    // saleItem — child rows keyed on the parent sale. SaleItem has no
    // companyId and no timestamp of its own, so the filter + cursor run on
    // the parent sale's updatedAt/id (the same (ts, id) resume rule as the
    // parent tables; upserts are idempotent, so re-fetches are safe).
    // R5 (2026-10-26): the same sale query also serves the other
    // sale-adjacent children — salePayment (split tender) and receipt —
    // so a counter sees another counter's sale COMPLETELY (lines +
    // tenders + receipt), not just its header.
    try {
      const saleTsCondition = cursorLastId
        ? {
            OR: [
              { updatedAt: { gt: sinceDate } },
              { updatedAt: sinceDate, id: { gt: cursorLastId } }
            ]
          }
        : { updatedAt: { gte: sinceDate } };
      const salesWithItems = await prisma.sale.findMany({
        where: {
          companyId: businessId,
          ...saleTsCondition
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: PULL_PAGE_SIZE,
        include: { items: true, payments: true, receipts: true }
      });
      if (salesWithItems.length === PULL_PAGE_SIZE) {
        const lastSale = salesWithItems[salesWithItems.length - 1];
        truncatedFrontiers.push({ ms: new Date(lastSale.updatedAt).getTime(), id: String(lastSale.id) });
      }
      for (const sale of salesWithItems) {
        const saleMs = new Date(sale.updatedAt).getTime();
        for (const item of sale.items ?? []) {
          changes.push({
            entityType: 'saleItem',
            entityId: item.id,
            operation: 'UPSERT',
            data: mapSaleItemForSQLite(item),
            timestamp: sale.updatedAt
          });
        }
        for (const payment of (sale as any).payments ?? []) {
          changes.push({
            entityType: 'salePayment',
            entityId: payment.id,
            operation: 'UPSERT',
            data: payment,
            timestamp: sale.updatedAt
          });
        }
        for (const receipt of (sale as any).receipts ?? []) {
          changes.push({
            entityType: 'receipt',
            entityId: receipt.id,
            operation: 'UPSERT',
            data: mapReceiptForSQLite(receipt, businessId, sale),
            timestamp: sale.updatedAt
          });
        }
        // Cursor id namespace: the parent sale's id (not the item id), so
        // the (ts, id) frontier stays comparable with the sale table.
        if (!maxSeen || saleMs > maxSeen.ms || (saleMs === maxSeen.ms && String(sale.id) > maxSeen.id)) {
          maxSeen = { ms: saleMs, id: String(sale.id) };
        }
      }
    } catch { }

    // refund + refundItem (R5) — child rows keyed on the parent refund.
    // Refund has no companyId of its own; tenancy comes from the parent
    // sale (originalSale.companyId). The cursor runs on the refund's own
    // (updatedAt, id); refundItems ride the same refund query.
    try {
      const refundTsCondition = cursorLastId
        ? {
            OR: [
              { updatedAt: { gt: sinceDate } },
              { updatedAt: sinceDate, id: { gt: cursorLastId } }
            ]
          }
        : { updatedAt: { gte: sinceDate } };
      const refundsWithItems = await prisma.refund.findMany({
        where: {
          originalSale: { companyId: businessId },
          ...refundTsCondition
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: PULL_PAGE_SIZE,
        include: {
          items: true,
          originalSale: { select: { branchId: true } }
        }
      });
      if (refundsWithItems.length === PULL_PAGE_SIZE) {
        const lastRefund = refundsWithItems[refundsWithItems.length - 1];
        // Refund createdAt/updatedAt are both nullable in the schema —
        // fall back to now so the frontier is always a real timestamp.
        truncatedFrontiers.push({ ms: new Date(lastRefund.updatedAt ?? lastRefund.createdAt ?? new Date()).getTime(), id: String(lastRefund.id) });
      }
      for (const refund of refundsWithItems) {
        const refundMs = new Date(refund.updatedAt ?? refund.createdAt ?? new Date()).getTime();
        changes.push({
          entityType: 'refund',
          entityId: refund.id,
          operation: 'UPSERT',
          data: mapRefundForSQLite(refund, businessId, (refund as any).originalSale?.branchId ?? null),
          timestamp: refund.updatedAt ?? refund.createdAt
        });
        for (const item of (refund as any).items ?? []) {
          changes.push({
            entityType: 'refundItem',
            entityId: item.id,
            operation: 'UPSERT',
            data: mapRefundItemForSQLite(item),
            timestamp: refund.updatedAt ?? refund.createdAt
          });
        }
        if (!maxSeen || refundMs > maxSeen.ms || (refundMs === maxSeen.ms && String(refund.id) > maxSeen.id)) {
          maxSeen = { ms: refundMs, id: String(refund.id) };
        }
      }
    } catch { }

    // purchaseItem (R5) — child rows keyed on the parent purchase, the
    // same pattern as saleItem. A counter that pulls a purchase header
    // now also gets its lines (and the batch link the R7 ledger reads).
    try {
      const purchaseTsCondition = cursorLastId
        ? {
            OR: [
              { updatedAt: { gt: sinceDate } },
              { updatedAt: sinceDate, id: { gt: cursorLastId } }
            ]
          }
        : { updatedAt: { gte: sinceDate } };
      const purchasesWithItems = await prisma.purchase.findMany({
        where: {
          companyId: businessId,
          ...purchaseTsCondition
        },
        orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
        take: PULL_PAGE_SIZE,
        include: { purchaseItems: true }
      });
      if (purchasesWithItems.length === PULL_PAGE_SIZE) {
        const lastPurchase = purchasesWithItems[purchasesWithItems.length - 1];
        truncatedFrontiers.push({ ms: new Date(lastPurchase.updatedAt).getTime(), id: String(lastPurchase.id) });
      }
      for (const purchase of purchasesWithItems) {
        const purchaseMs = new Date(purchase.updatedAt).getTime();
        for (const item of (purchase as any).purchaseItems ?? []) {
          changes.push({
            entityType: 'purchaseItem',
            entityId: item.id,
            operation: 'UPSERT',
            data: mapPurchaseItemForSQLite(item),
            timestamp: purchase.updatedAt
          });
        }
        if (!maxSeen || purchaseMs > maxSeen.ms || (purchaseMs === maxSeen.ms && String(purchase.id) > maxSeen.id)) {
          maxSeen = { ms: purchaseMs, id: String(purchase.id) };
        }
      }
    } catch { }

    // Soft-deleted rows (isActive=false, voided/cancelled statuses) are
    // ordinary updates in this feed — nothing above filters them out, so
    // deactivations propagate to the desktop exactly like any other edit.
    let nextCursor: string | undefined = cursor;
    if (truncatedFrontiers.length > 0) {
      const frontier = truncatedFrontiers.reduce((a, b) =>
        (b.ms < a.ms || (b.ms === a.ms && b.id < a.id)) ? b : a
      );
      nextCursor = encodePullCursor(frontier.ms, frontier.id);
    } else if (maxSeen) {
      nextCursor = encodePullCursor(maxSeen.ms, maxSeen.id);
    }

    res.json({
      success: true,
      data: { changes, nextCursor }
    });
  } catch (error: any) {
    console.error('[CloudSync] Pull error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── R2: cloud-authoritative pre-check ───────────────────────────────────
// POST /api/sync/sales/precheck — the desktop calls this BEFORE completing
// an online sale (sales.routes.js). It answers, from live cloud batches,
// whether each line can be covered — the same availability rule the web
// sale endpoint enforces (FEFO across active, unexpired, unreported
// batches; pinned batchId must cover the whole line). No writes: the
// desktop still completes the sale locally, and the R1 replay is the
// backstop if stock moves between the check and the push. Offline the
// desktop skips the call entirely and sells from local stock as before.
// Routing an online desktop sale THROUGH cloud createSale was considered
// and rejected: the desktop sale flow carries local loyalty / FBR /
// receipt logic createSale does not replicate; pre-check + replay gives
// the same stock safety with far less risk.
export const cloudPrecheckSale = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { businessId, branchId, items } = req.body || {};
    if (!businessId || !branchId || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ success: false, message: 'businessId, branchId and items[] are required' });
      return;
    }
    if (!(await requireBusinessAccess(prisma, req.user!.id, businessId))) {
      res.status(403).json({ success: false, message: 'Forbidden' });
      return;
    }
    const productIds = [...new Set(items.map((i: any) => i.productId).filter(Boolean))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, companyId: businessId },
      select: { id: true, name: true }
    });
    const nameById = new Map(products.map((p: any) => [p.id, p.name]));
    const lines: any[] = [];
    let allOk = true;
    for (const item of items) {
      const required = saleLineUnits(item);
      let available = 0;
      let pinnedBatchId: string | null = null;
      if (item.batchId) {
        const batch = await prisma.batch.findFirst({
          where: {
            id: item.batchId,
            productId: item.productId,
            branchId,
            isActive: true,
            isReported: { not: true },
            OR: [{ expireDate: null }, { expireDate: { gte: new Date() } }]
          },
          select: { id: true, quantity: true }
        });
        available = batch ? (batch.quantity || 0) : 0;
        pinnedBatchId = batch ? batch.id : null;
      } else {
        const batches = await prisma.batch.findMany({
          where: {
            productId: item.productId,
            branchId,
            isActive: true,
            isReported: { not: true },
            quantity: { gt: 0 },
            ...(item.variantId ? { variantId: item.variantId } : { variantId: null }),
            OR: [{ expireDate: null }, { expireDate: { gte: new Date() } }]
          },
          select: { quantity: true }
        });
        available = batches.reduce((s: number, b: any) => s + (b.quantity || 0), 0);
      }
      const ok = available >= required;
      if (!ok) allOk = false;
      lines.push({
        productId: item.productId,
        productName: nameById.get(item.productId) || item.productId,
        required,
        available,
        ok,
        shortfall: Math.max(0, required - available),
        batchId: pinnedBatchId
      });
    }
    res.json({ success: true, data: { ok: allOk, lines } });
  } catch (error: any) {
    console.error('[CloudSync] Precheck error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── R3: offline-sales review list ───────────────────────────────────────
// The cloud's record of desktop-pushed sales that need a human look:
// oversold (replay shortfall), made while offline, or pushed but never
// replayed (items missing). Sales are never silently dropped or silently
// negative — they land, flagged, and wait here until reviewed.
const REVIEW_PENDING_CUTOFF_MS = 10 * 60 * 1000;

export const cloudSyncReviewSummary = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const businessId = req.query.businessId as string;
    if (!businessId) {
      res.status(400).json({ success: false, message: 'businessId is required' });
      return;
    }
    if (!(await requireBusinessAccess(prisma, req.user!.id, businessId))) {
      res.status(403).json({ success: false, message: 'Forbidden' });
      return;
    }
    const pendingSince = new Date(Date.now() - REVIEW_PENDING_CUTOFF_MS);
    const [oversold, offline, pendingReplay, pendingRestock, reviewed, total] = await Promise.all([
      prisma.sale.count({ where: { companyId: businessId, syncOrigin: 'DESKTOP_PUSH', oversold: true, reviewedAt: null } }),
      prisma.sale.count({ where: { companyId: businessId, syncOrigin: 'DESKTOP_PUSH', offlineSale: true, reviewedAt: null } }),
      prisma.sale.count({ where: { companyId: businessId, syncOrigin: 'DESKTOP_PUSH', stockReplayedAt: null, createdAt: { lt: pendingSince }, reviewedAt: null } }),
      prisma.refund.count({ where: { originalSale: { companyId: businessId }, syncOrigin: 'DESKTOP_PUSH', stockRestockedAt: null, createdAt: { lt: pendingSince } } }),
      prisma.sale.count({ where: { companyId: businessId, syncOrigin: 'DESKTOP_PUSH', reviewedAt: { not: null } } }),
      // Distinct sales needing review (a sale can sit in several
      // buckets at once — oversold AND offline — so the total is its
      // own count, not the sum).
      prisma.sale.count({
        where: {
          companyId: businessId,
          syncOrigin: 'DESKTOP_PUSH',
          reviewedAt: null,
          OR: [
            { oversold: true },
            { offlineSale: true },
            { stockReplayedAt: null, createdAt: { lt: pendingSince } }
          ]
        }
      })
    ]);
    res.json({ success: true, data: { open: total, oversold, offline, pendingReplay, pendingRestock, reviewed, total } });
  } catch (error: any) {
    console.error('[CloudSync] Review summary error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const cloudSyncReviewList = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const businessId = req.query.businessId as string;
    const status = String(req.query.status || 'open');
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '50'), 10) || 50, 1), 200);
    if (!businessId) {
      res.status(400).json({ success: false, message: 'businessId is required' });
      return;
    }
    if (!(await requireBusinessAccess(prisma, req.user!.id, businessId))) {
      res.status(403).json({ success: false, message: 'Forbidden' });
      return;
    }
    const pendingSince = new Date(Date.now() - REVIEW_PENDING_CUTOFF_MS);
    const where: any = {
      companyId: businessId,
      syncOrigin: 'DESKTOP_PUSH',
      OR: [
        { oversold: true },
        { offlineSale: true },
        { stockReplayedAt: null, createdAt: { lt: pendingSince } }
      ]
    };
    if (status === 'open') where.reviewedAt = null;
    if (status === 'reviewed') where.reviewedAt = { not: null };
    const sales = await prisma.sale.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        items: { include: { product: { select: { id: true, name: true } } } }
      }
    });
    res.json({
      success: true,
      data: {
        sales: sales.map((s: any) => ({
          id: s.id,
          invoiceNumber: s.invoiceNumber,
          terminalInvoiceNumber: s.terminalInvoiceNumber ?? null,
          branchId: s.branchId,
          totalAmount: s.totalAmount,
          paymentMethod: s.paymentMethod,
          paymentStatus: s.paymentStatus,
          status: s.status,
          saleDate: s.saleDate,
          createdAt: s.createdAt,
          oversold: s.oversold,
          oversellDetail: s.oversellDetail ?? null,
          offlineSale: s.offlineSale,
          stockReplayedAt: s.stockReplayedAt ?? null,
          reviewedAt: s.reviewedAt ?? null,
          reviewedBy: s.reviewedBy ?? null,
          items: (s.items ?? []).map((it: any) => ({
            id: it.id,
            productId: it.productId,
            productName: it.product?.name || it.productId,
            batchId: it.batchId ?? null,
            quantity: it.quantity,
            unitsDeducted: it.unitsDeducted ?? null,
            unitPrice: it.unitPrice,
            totalPrice: it.totalPrice
          }))
        }))
      }
    });
  } catch (error: any) {
    console.error('[CloudSync] Review list error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const cloudSyncReviewResolve = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { businessId } = req.body || {};
    const saleId = req.params.saleId as string;
    if (!businessId || !saleId) {
      res.status(400).json({ success: false, message: 'businessId and saleId are required' });
      return;
    }
    if (!(await requireBusinessAccess(prisma, req.user!.id, businessId))) {
      res.status(403).json({ success: false, message: 'Forbidden' });
      return;
    }
    const updated = await prisma.sale.updateMany({
      where: { id: saleId, companyId: businessId, syncOrigin: 'DESKTOP_PUSH' },
      data: { reviewedAt: new Date(), reviewedBy: req.user!.id }
    });
    if (updated.count !== 1) {
      res.status(404).json({ success: false, message: 'Sale not found in the review list' });
      return;
    }
    res.json({ success: true, data: { saleId, reviewedAt: new Date().toISOString() } });
  } catch (error: any) {
    console.error('[CloudSync] Review resolve error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── R7: nightly stock reconciliation ────────────────────────────────────
export const cloudRunReconciliation = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { businessId, branchId } = req.body || {};
    if (!businessId) {
      res.status(400).json({ success: false, message: 'businessId is required' });
      return;
    }
    if (!(await requireBusinessAccess(prisma, req.user!.id, businessId))) {
      res.status(403).json({ success: false, message: 'Forbidden' });
      return;
    }
    const result = await runReconciliation(prisma, businessId, 'MANUAL', branchId ?? null);
    res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('[CloudSync] Reconciliation run error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const cloudListReconciliations = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const businessId = req.query.businessId as string;
    const status = req.query.status ? String(req.query.status) : undefined;
    const limit = Math.min(Math.max(parseInt(String(req.query.limit || '20'), 10) || 20, 1), 100);
    if (!businessId) {
      res.status(400).json({ success: false, message: 'businessId is required' });
      return;
    }
    if (!(await requireBusinessAccess(prisma, req.user!.id, businessId))) {
      res.status(403).json({ success: false, message: 'Forbidden' });
      return;
    }
    const runs = await prisma.stockReconciliation.findMany({
      where: { companyId: businessId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { lines: { select: { id: true, productId: true, batchId: true, branchId: true, expectedQty: true, actualQty: true, variance: true, reason: true, status: true } } }
    });
    res.json({ success: true, data: { runs } });
  } catch (error: any) {
    console.error('[CloudSync] Reconciliation list error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const cloudCreateStockTakesFromReconciliation = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { businessId } = req.body || {};
    const reconciliationId = req.params.id as string;
    if (!businessId || !reconciliationId) {
      res.status(400).json({ success: false, message: 'businessId and reconciliation id are required' });
      return;
    }
    if (!(await requireBusinessAccess(prisma, req.user!.id, businessId))) {
      res.status(403).json({ success: false, message: 'Forbidden' });
      return;
    }
    const created = await createStockTakesFromReconciliation(prisma, businessId, reconciliationId, req.user!.id);
    res.json({ success: true, data: { stockTakes: created } });
  } catch (error: any) {
    console.error('[CloudSync] Reconciliation stock-take error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const cloudResolveReconciliation = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { businessId, note } = req.body || {};
    const reconciliationId = req.params.id as string;
    if (!businessId || !reconciliationId) {
      res.status(400).json({ success: false, message: 'businessId and reconciliation id are required' });
      return;
    }
    if (!(await requireBusinessAccess(prisma, req.user!.id, businessId))) {
      res.status(403).json({ success: false, message: 'Forbidden' });
      return;
    }
    const ok = await resolveReconciliation(prisma, businessId, reconciliationId, req.user!.id, note ?? null);
    if (!ok) {
      res.status(404).json({ success: false, message: 'Reconciliation not found or already resolved' });
      return;
    }
    res.json({ success: true, data: { reconciliationId, status: 'RESOLVED' } });
  } catch (error: any) {
    console.error('[CloudSync] Reconciliation resolve error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};
