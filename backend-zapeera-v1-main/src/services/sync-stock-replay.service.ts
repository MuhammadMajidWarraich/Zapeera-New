// Server-side stock replay for desktop-pushed sales (R1, 2026-10-26).
//
// THE PROBLEM: a desktop sale deducts stock only in its own SQLite
// (electron/routes/sales.routes.js) and pushes the sale + saleItems to
// the cloud, where applyPushCreate used to be a raw Prisma create — no
// availability check, no batch deduction. Two counters could each sell
// the last units of the same batch and the cloud would never notice.
//
// THE FIX: after a pushed sale (and its items) lands, replay the batch
// deduction here, in a transaction, with the same conditional-decrement
// guard the web sale endpoint uses (sale.controller.ts, A-16):
//   batch.updateMany({ where: { id, quantity: { gte: qty } },
//                      data: { quantity: { decrement: qty } } })
// A batch can therefore never go negative, even when two replays race.
//
// A pushed sale already happened — the customer walked out with the
// goods — so a shortfall can never refuse the sale the way the web
// endpoint refuses with 422. Instead the replay deducts what the
// batches actually hold (down to 0), writes the real draws as
// SaleItemBatch rows + StockMovement OUT rows (so refunds restock the
// right batches), and flags the sale oversold with a per-line shortfall
// detail for the R3 review list. Oversold sales are never silently
// dropped and never silently negative.
//
// IDEMPOTENCY: the replay claims the sale with an atomic
// updateMany({ where: { id, stockReplayedAt: null, syncOrigin:
// 'DESKTOP_PUSH' } }) inside the same transaction as the deductions.
// A second trigger (retried push, late-arriving items, concurrent
// replay) sees the claim and skips — one sale deducts exactly once.
// syncOrigin pins the replay to desktop-pushed sales only, so a web
// sale (which already deducted in createSale) can never be
// double-deducted through this path.

import { allocateFefo, planRefundRestock } from '../utils/fefo.util';

// Base units a sale line draws from stock. unitsDeducted is the
// authority when present (C2 lines store base units in BOTH quantity
// and unitsDeducted; legacy BOX lines store boxes in quantity and base
// units in unitsDeducted; KG lines store grams in both). The BOX
// fallback covers legacy lines with no unitsDeducted snapshot.
// Service lines (Wave C4) carry unitsDeducted 0 and draw nothing.
export function saleLineUnits(item: any): number {
  if (item.unitsDeducted !== null && item.unitsDeducted !== undefined) {
    const u = Math.floor(Number(item.unitsDeducted));
    return Number.isFinite(u) ? Math.max(0, u) : 0;
  }
  const qty = Math.floor(Number(item.quantity) || 0);
  if (item.unitLevel === 'BOX' && item.unitsPerBox) {
    return Math.max(0, qty * Math.floor(Number(item.unitsPerBox)));
  }
  return Math.max(0, qty);
}

export interface ReplayShortfall {
  saleItemId: string;
  productId: string;
  required: number;
  drawn: number;
  shortfall: number;
}

export interface ReplayOutcome {
  replayed: boolean;
  oversold: boolean;
  drawnTotal: number;
  shortfall: ReplayShortfall[];
  reason?: string;
}

// Draw `required` base units for one sale line from the branch's
// batches, FEFO (nearest expiry first), honouring the pinned batch
// first when the line carries one. Returns what was actually drawn
// per batch plus the uncovered remainder. Each draw is a conditional
// decrement, so a batch that moved under us (concurrent web sale or
// replay) simply yields less — never a negative quantity. One re-plan
// pass covers the race: if any conditional decrement fails, the
// remainder is re-planned from freshly-read batches.
async function drawLine(tx: any, sale: any, item: any, required: number): Promise<{ allocations: Array<{ batchId: string; qty: number }>; shortfall: number }> {
  const allocations: Array<{ batchId: string; qty: number }> = [];
  let remaining = required;

  for (let attempt = 0; attempt < 2 && remaining > 0; attempt++) {
    // Fresh FEFO pool for this attempt: active, unexpired, unreported
    // batches of this product in the sale's branch. Variant lines draw
    // only from their variant's pool; variant-less lines only from the
    // base pool — the same rule sale.controller enforces.
    const pool = await tx.batch.findMany({
      where: {
        productId: item.productId,
        branchId: sale.branchId,
        isActive: true,
        isReported: { not: true },
        quantity: { gt: 0 },
        ...(item.variantId ? { variantId: item.variantId } : { variantId: null }),
        OR: [{ expireDate: null }, { expireDate: { gte: new Date() } }]
      },
      orderBy: { expireDate: 'asc' },
      select: { id: true, quantity: true, expireDate: true }
    });
    // The pinned batch goes first even when it is not the
    // nearest-expiry one — the terminal sold from that batch.
    const ordered = [...pool].sort((a: any, b: any) => {
      if (item.batchId) {
        if (a.id === item.batchId) return -1;
        if (b.id === item.batchId) return 1;
      }
      const ae = a.expireDate ? new Date(a.expireDate).getTime() : Number.POSITIVE_INFINITY;
      const be = b.expireDate ? new Date(b.expireDate).getTime() : Number.POSITIVE_INFINITY;
      return ae - be;
    });
    // Subtract what this replay already drew from the pool snapshot so
    // the re-plan pass does not double-count its own draws.
    const drawnByBatch = new Map<string, number>();
    for (const a of allocations) drawnByBatch.set(a.batchId, (drawnByBatch.get(a.batchId) || 0) + a.qty);
    const plan = allocateFefo(
      ordered.map((b: any) => ({ id: b.id, quantity: Math.max(0, (b.quantity || 0) - (drawnByBatch.get(b.id) || 0)) })),
      remaining
    );
    let progressed = false;
    for (const alloc of plan.allocations) {
      const result = await tx.batch.updateMany({
        where: { id: alloc.batchId, quantity: { gte: alloc.qty } },
        data: { quantity: { decrement: alloc.qty } }
      });
      if (result.count === 1) {
        allocations.push({ batchId: alloc.batchId, qty: alloc.qty });
        remaining -= alloc.qty;
        progressed = true;
      }
      // count 0 = the batch moved under us; the remainder is re-planned
      // on the next attempt (or reported as shortfall after attempt 2).
    }
    if (!progressed) break;
  }

  return { allocations, shortfall: remaining };
}

export async function replaySaleStock(prisma: any, saleId: string): Promise<ReplayOutcome> {
  return prisma.$transaction(async (tx: any) => {
    // Claim the replay. Only a desktop-pushed sale with no replay yet
    // proceeds; web sales (syncOrigin null) and already-replayed sales
    // are never touched, and a concurrent replay loses the claim.
    const claimed = await tx.sale.updateMany({
      where: { id: saleId, stockReplayedAt: null, syncOrigin: 'DESKTOP_PUSH' },
      data: { stockReplayedAt: new Date() }
    });
    if (claimed.count !== 1) {
      return { replayed: false, oversold: false, drawnTotal: 0, shortfall: [], reason: 'already-replayed-or-not-desktop-push' };
    }

    const sale = await tx.sale.findUnique({
      where: { id: saleId },
      include: { items: { include: { allocations: true } } }
    });
    if (!sale) {
      // Claimed a row that is gone inside this transaction — cannot
      // happen on PostgreSQL; the claim rolls back with the tx.
      return { replayed: false, oversold: false, drawnTotal: 0, shortfall: [], reason: 'sale-vanished' };
    }

    let drawnTotal = 0;
    const shortfall: ReplayShortfall[] = [];
    for (const item of sale.items ?? []) {
      const required = saleLineUnits(item);
      if (required <= 0) continue;
      const { allocations, shortfall: uncovered } = await drawLine(tx, sale, item, required);
      for (const alloc of allocations) {
        drawnTotal += alloc.qty;
        await tx.saleItemBatch.create({
          data: { saleItemId: item.id, batchId: alloc.batchId, quantity: alloc.qty }
        });
      }
      if (allocations.length > 0) {
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            type: 'OUT',
            quantity: allocations.reduce((s: number, a: any) => s + a.qty, 0),
            reason: 'Sale (sync replay)',
            reference: sale.id,
            createdBy: sale.createdBy || sale.userId || null
          }
        });
      }
      if (uncovered > 0) {
        shortfall.push({
          saleItemId: item.id,
          productId: item.productId,
          required,
          drawn: required - uncovered,
          shortfall: uncovered
        });
      }
    }

    const oversold = shortfall.length > 0;
    await tx.sale.update({
      where: { id: saleId },
      data: {
        oversold,
        oversellDetail: oversold ? (shortfall as any) : null
      }
    });
    return { replayed: true, oversold, drawnTotal, shortfall };
  });
}

// ── Refund restock replay (R1 symmetric half) ───────────────────────────
// A desktop refund restores stock only in its own SQLite and pushes the
// refund + refundItems. Without a server-side restock the cloud batch
// would stay low forever (the sale deducted, the refund never returned)
// and every desktop refund would surface as a permanent R7 variance.
// The replay mirrors refund.controller.ts exactly: units to return come
// from the SALE line's own ratio (unitsDeducted/quantity), never from
// client figures; FEFO allocation rows are restocked first (attributing
// earlier refunds of the same line to the FEFO-first allocations so no
// batch is ever credited twice); lines without allocations fall back to
// the single batchId the desktop sale drew from, then to the branch's
// earliest-expiring active batch. Service lines never moved stock and
// restock nothing. The claim (stockRestockedAt) makes the replay
// once-only; a refund whose sale items have not landed yet is NOT
// claimed — it is left for a later trigger (and surfaced by the R3
// review summary as pending restock) instead of being silently lost.
export interface RestockOutcome {
  restocked: boolean;
  returnedTotal: number;
  reason?: string;
}

export async function restockRefundStock(prisma: any, refundId: string): Promise<RestockOutcome> {
  return prisma.$transaction(async (tx: any) => {
    const claimed = await tx.refund.updateMany({
      where: { id: refundId, stockRestockedAt: null, syncOrigin: 'DESKTOP_PUSH' },
      data: { stockRestockedAt: new Date() }
    });
    if (claimed.count !== 1) {
      return { restocked: false, returnedTotal: 0, reason: 'already-restocked-or-not-desktop-push' };
    }

    const refund = await tx.refund.findUnique({
      where: { id: refundId },
      include: { items: true }
    });
    if (!refund) {
      return { restocked: false, returnedTotal: 0, reason: 'refund-vanished' };
    }
    const sale = await tx.sale.findUnique({
      where: { id: refund.originalSaleId },
      include: { items: { include: { allocations: true } } }
    });
    if (!sale || (sale.items ?? []).length === 0) {
      // The sale (or its items) has not landed yet — release the claim
      // by rolling the transaction back is impossible here (the claim
      // is inside this tx), so undo it explicitly: a later trigger
      // retries once the items arrive.
      await tx.refund.update({ where: { id: refundId }, data: { stockRestockedAt: null } });
      return { restocked: false, returnedTotal: 0, reason: 'sale-items-pending' };
    }

    const saleItems = sale.items ?? [];
    // Prior returns per product across earlier refunds of the SAME sale
    // (the refund controller's product-level attribution; exact for
    // every C2 line whose ratio is always 1).
    const priorRefunds = await tx.refund.findMany({
      where: { originalSaleId: sale.id, id: { not: refundId } },
      include: { items: true }
    });
    const priorReturnedByProduct = new Map<string, number>();
    for (const prior of priorRefunds) {
      for (const pi of prior.items ?? []) {
        const line = saleItems.find((s: any) => s.productId === pi.productId);
        const ratio = line && line.quantity > 0
          ? ((line.unitsDeducted ?? line.quantity) / line.quantity)
          : 1;
        priorReturnedByProduct.set(
          pi.productId,
          (priorReturnedByProduct.get(pi.productId) || 0) + Math.round(pi.quantity * ratio)
        );
      }
    }
    const serviceProductIds = new Set<string>(
      (await tx.product.findMany({
        where: { id: { in: saleItems.map((s: any) => s.productId) }, isService: true },
        select: { id: true }
      })).map((p: any) => p.id)
    );

    let returnedTotal = 0;
    for (const rItem of refund.items ?? []) {
      const saleItem = (rItem as any).saleItemId
        ? saleItems.find((s: any) => s.id === (rItem as any).saleItemId)
        : saleItems.find((s: any) => s.productId === rItem.productId);
      if (!saleItem) continue;
      if (serviceProductIds.has(saleItem.productId)) continue;
      const unitsPerSoldUnit = saleItem.quantity > 0
        ? ((saleItem.unitsDeducted ?? saleItem.quantity) / saleItem.quantity)
        : 1;
      const unitsToReturn = Math.round(rItem.quantity * unitsPerSoldUnit);
      if (unitsToReturn <= 0) continue;

      let returnedForItem = 0;
      const lineAllocations = (saleItem.allocations ?? []).map((a: any) => ({ batchId: a.batchId, qty: a.quantity }));
      if (lineAllocations.length > 0) {
        const priorReturnedBase = Math.round(priorReturnedByProduct.get(saleItem.productId) || 0);
        const plan = planRefundRestock(lineAllocations, unitsToReturn, priorReturnedBase);
        for (const restock of plan) {
          await tx.batch.update({ where: { id: restock.batchId }, data: { quantity: { increment: restock.qty } } });
          returnedForItem += restock.qty;
        }
      } else {
        let restockBatchId = saleItem.batchId || null;
        if (!restockBatchId) {
          const activeBatch = await tx.batch.findFirst({
            where: { productId: saleItem.productId, branchId: sale.branchId, isActive: true },
            orderBy: { expireDate: 'asc' }
          });
          if (activeBatch) restockBatchId = activeBatch.id;
        }
        if (restockBatchId) {
          await tx.batch.update({ where: { id: restockBatchId }, data: { quantity: { increment: unitsToReturn } } });
          returnedForItem += unitsToReturn;
        }
      }
      if (returnedForItem > 0) {
        await tx.stockMovement.create({
          data: {
            productId: saleItem.productId,
            type: 'RETURN',
            quantity: returnedForItem,
            reason: `Refund: ${refund.refundReason || ''}`.slice(0, 200),
            reference: `REF-${refund.id}`,
            createdBy: refund.refundedBy || refund.createdBy || null
          }
        });
      }
      returnedTotal += returnedForItem;
      // Book the returned units against this product so a second
      // refund item of the same product in this refund does not
      // re-credit the same allocation slice.
      priorReturnedByProduct.set(
        saleItem.productId,
        (priorReturnedByProduct.get(saleItem.productId) || 0) + unitsToReturn
      );
    }

    return { restocked: true, returnedTotal };
  });
}
