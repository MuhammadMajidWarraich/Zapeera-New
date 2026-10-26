import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { getPrisma } from '../utils/db.util';


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
const ENTITY_DEPENDENCY_RANK: Record<string, number> = {
  category: 40, manufacturer: 50, supplier: 60, shelf: 70,
  product: 80, productVariant: 85, batch: 90,
  customer: 100, employee: 110,
  sale: 120, saleItem: 130, salePayment: 135, salePromotion: 136, saleTaxLine: 137,
  purchase: 140, purchaseItem: 150,
  stockMovement: 160, receipt: 170, refund: 180, refundItem: 190,
  attendance: 200, shift: 210, scheduledShift: 220, scheduledShiftUser: 230,
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

function staleVerdict(payload: any, existing: any): StaleVerdict {
  const incomingMs = parseTimestampMs(payload ? payload.updatedAt : null);
  const serverMs = parseTimestampMs(existing ? (existing.updatedAt ?? existing.createdAt) : null);
  if (incomingMs === null || serverMs === null || incomingMs >= serverMs) return 'fresh';
  return payloadMatchesExisting(payload, existing) ? 'replay' : 'conflict';
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
      where: { companyId_opKey: { companyId: businessId, opKey } },
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

async function applyPushCreate(prisma: any, businessId: string, opId: any, entityType: string, entityId: string, payload: any) {
  const model = (prisma as any)[entityType];
  if (!model?.create || !payload) return { id: opId, status: 'ACCEPTED' };

  const existing = entityId && model.findUnique
    ? await model.findUnique({ where: { id: entityId } })
    : null;

  if (!existing) {
    await model.create({ data: { ...payload, id: entityId, companyId: businessId } });
    return { id: opId, status: 'ACCEPTED' };
  }

  // Create against an id that already exists = replay or duplicate create.
  const owner = existing.companyId ?? existing.businessId;
  if (owner !== undefined && owner !== businessId) {
    return { id: opId, status: 'FAILED', message: 'Entity does not belong to this business' };
  }
  const verdict = staleVerdict(payload, existing);
  if (verdict === 'conflict') return conflictResult(opId, entityType, entityId, existing);
  if (verdict === 'replay') {
    return { id: opId, status: 'ACCEPTED', message: 'Idempotent replay — server row already reflects this create' };
  }
  if (model.update) {
    const data = stripServerManagedFields(payload);
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
  const owner = existing.companyId ?? existing.businessId;
  if (owner !== undefined && owner !== businessId) {
    return { id: opId, status: 'FAILED', message: 'Entity does not belong to this business' };
  }
  const verdict = staleVerdict(payload, existing);
  if (verdict === 'conflict') return conflictResult(opId, entityType, entityId, existing);
  if (verdict === 'replay') {
    return { id: opId, status: 'ACCEPTED', message: 'Idempotent replay — payload already reflected on the server' };
  }
  await model.update({ where: { id: entityId }, data: stripServerManagedFields(payload) });
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
  const owner = existing.companyId ?? existing.businessId;
  if (owner !== undefined && owner !== businessId) {
    return { id: opId, status: 'FAILED', message: 'Entity does not belong to this business' };
  }
  if (payload && staleVerdict(payload, existing) === 'conflict') {
    return conflictResult(opId, entityType, entityId, existing);
  }
  await model.delete({ where: { id: entityId } });
  return { id: opId, status: 'ACCEPTED' };
}

async function applyPushOperation(prisma: any, store: any, businessId: string, rawOp: any) {
  const op = rawOp || {};
  const opId = op.id != null ? op.id : null;
  try {
    const { entityType, entityId, payload } = op;
    const operation = String(op.operation || '').toUpperCase();
    const opKey = op.idempotencyKey || op.id || null;

    if (opKey && store) {
      let prior: any = null;
      try {
        prior = await store.findUnique({
          where: { companyId_opKey: { companyId: businessId, opKey: String(opKey) } }
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
      result = await applyPushCreate(prisma, businessId, opId, entityType, entityId, payload);
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
      results[index] = await applyPushOperation(prisma, store, businessId, op);
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
    // Child tables without companyId (purchaseItem — and the maturity-program
    // children stockTransferItem, prescriptionItem, salePromotion, saleTaxLine,
    // folioCharge, folioPayment, stockTakeLine, salePayment) are NOT
    // cursor-pulled, by the same precedent: they move with their parents via
    // operations push and the full-table replication in sync.service.ts.
    // EXCEPTION — saleItem (2026-10-26): the desktop dashboard aggregates
    // most-selling products from local sale_items, and the cursor pull is
    // the only download path, so sale_items stayed empty on every desktop
    // (see ZAPEERA_DESKTOP_SYNC_DIAGNOSIS_2026-10-26.md, RC-D3). saleItem
    // rows are served below, keyed on the parent sale's updatedAt +
    // companyId (SaleItem has no timestamp or companyId of its own).
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
    const CREATED_AT_CURSOR_TABLES = new Set(['customerLedgerEntry', 'loyaltyTransaction']);
    const tables = [
      'product', 'customer', 'sale', 'purchase', 'batch', 'category', 'supplier', 'manufacturer', 'shelf', 'stockMovement',
      'stockTransfer', 'promotion', 'taxClass', 'prescription',
      'patient', 'doctor', 'appointment', 'doctorSettlement',
      'roomType', 'room', 'reservation', 'folio',
      'productVariant', 'stockTake',
      'customerLedgerEntry', 'loyaltyTransaction'
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
        const records = await model.findMany({
          where: {
            companyId: businessId,
            ...tsCondition
          },
          orderBy: [{ [tsField]: 'asc' }, { id: 'asc' }],
          take: PULL_PAGE_SIZE
        });
        if (records.length === PULL_PAGE_SIZE) {
          const last = records[records.length - 1];
          truncatedFrontiers.push({ ms: new Date(last[tsField]).getTime(), id: String(last.id) });
        }
        for (const record of records) {
          changes.push({
            entityType: table,
            entityId: record.id,
            operation: 'UPSERT',
            data: record,
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
        include: { items: true }
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
        // Cursor id namespace: the parent sale's id (not the item id), so
        // the (ts, id) frontier stays comparable with the sale table.
        if (!maxSeen || saleMs > maxSeen.ms || (saleMs === maxSeen.ms && String(sale.id) > maxSeen.id)) {
          maxSeen = { ms: saleMs, id: String(sale.id) };
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
