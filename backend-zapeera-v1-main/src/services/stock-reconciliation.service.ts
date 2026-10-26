// Nightly stock reconciliation (R7, 2026-10-26).
//
// Recomputes each batch's EXPECTED quantity from the ledger and compares
// it with the live batch quantity:
//   expected = baseline + receipts − sale draws + refund returns
//              + transfer in − transfer out
// - baseline: the latest COMPLETED stock take for the batch (countedQty
//   at completion; only events after the take count), or — when the batch
//   was never counted — the sum of its purchase receipts (all time).
//   A batch with neither anchor is UNVERIFIABLE: counted, never guessed.
// - receipts: purchaseItem.quantity linked to the batch.
// - sale draws: SaleItemBatch allocations (web sales + R1-replayed
//   desktop sales) plus desktop sale lines that carry no allocations
//   (batchId + unitsDeducted). A line is counted once, from exactly one
//   of the two sources.
// - refund returns: the refund controller's own attribution
//   (planRefundRestock over the sale line's allocations, FEFO-first,
//   earlier refunds of the same line attributed first), read-only.
// - transfers: COMPLETED stock transfers only.
// Only refunds with status PROCESSED (web) or COMPLETED (desktop) have
// restocked, so only those count. A run is created on every sweep;
// lines exist only for batches whose expected and actual quantities
// differ (variance = expectedQty − actualQty) plus a best-effort reason
// hint. Resolving a run can spawn per-branch stock takes pre-filled
// with the variance lines, so the existing stock-take flow applies the
// correction — the reconciliation itself never writes stock.

import { planRefundRestock } from '../utils/fefo.util';
import { saleLineUnits } from './sync-stock-replay.service';

const RECONCILABLE_REFUND_STATUSES = ['PROCESSED', 'COMPLETED'];

export interface ReconciliationLineInput {
  productId: string;
  batchId: string;
  branchId: string;
  expectedQty: number;
  actualQty: number;
  variance: number;
  reason: string | null;
}

export interface ReconciliationRunResult {
  id: string;
  batchesChecked: number;
  varianceCount: number;
  unverifiableCount: number;
  lines: ReconciliationLineInput[];
}

export async function runReconciliation(
  prisma: any,
  businessId: string,
  trigger: 'NIGHTLY' | 'MANUAL',
  branchId?: string | null
): Promise<ReconciliationRunResult> {
  const batches = await prisma.batch.findMany({
    where: {
      companyId: businessId,
      ...(branchId ? { branchId } : {}),
      isActive: true
    },
    select: { id: true, productId: true, branchId: true, quantity: true, createdAt: true }
  });

  // Latest COMPLETED take line per batch (the ledger baseline).
  const takeLines = await prisma.stockTakeLine.findMany({
    where: {
      batchId: { in: batches.map((b: any) => b.id) },
      countedQty: { not: null },
      stockTake: { companyId: businessId, status: 'COMPLETED' }
    },
    include: { stockTake: { select: { completedAt: true, updatedAt: true } } },
    orderBy: { createdAt: 'desc' }
  });
  const baselineByBatch = new Map<string, { qty: number; since: Date }>();
  for (const line of takeLines) {
    if (baselineByBatch.has(line.batchId)) continue; // ordered desc — first is latest
    const since = new Date(line.stockTake.completedAt ?? line.stockTake.updatedAt ?? line.createdAt);
    baselineByBatch.set(line.batchId, { qty: line.countedQty ?? 0, since });
  }

  // Purchase receipts per batch (the no-take baseline). createdAt is
  // kept so receipts after a take baseline still count.
  const receipts = await prisma.purchaseItem.findMany({
    where: { batchId: { in: batches.map((b: any) => b.id) } },
    select: { batchId: true, quantity: true, createdAt: true }
  });

  // Sale draws, split by source so no line is ever counted twice:
  // (a) allocation rows (web sales + R1 replays), (b) desktop lines
  // with no allocations (batchId + units). Allocation rows are dated by
  // their SALE's createdAt, not by the allocation row itself — an R1
  // replay can write allocations days after an offline sale, and a
  // stock take in between must not see that draw twice.
  const allocations = await prisma.saleItemBatch.findMany({
    where: { batchId: { in: batches.map((b: any) => b.id) } },
    select: {
      batchId: true,
      quantity: true,
      saleItem: { select: { sale: { select: { createdAt: true } } } }
    }
  });
  const saleItemsNoAlloc = await prisma.saleItem.findMany({
    where: {
      batchId: { in: batches.map((b: any) => b.id) },
      allocations: { none: {} }
    },
    select: { id: true, batchId: true, quantity: true, unitsDeducted: true, unitLevel: true, unitsPerBox: true, saleId: true }
  });
  const saleCreatedById = new Map<string, Date>();
  for (const s of await prisma.sale.findMany({
    where: { id: { in: [...new Set(saleItemsNoAlloc.map((i: any) => i.saleId))] } },
    select: { id: true, createdAt: true }
  })) {
    saleCreatedById.set(s.id, new Date(s.createdAt));
  }

  // Refund returns, attributed exactly like the refund controller:
  // per sale line, FEFO-first over its allocations, earlier refunds of
  // the same line attributed first; lines without allocations attribute
  // to their single batchId. Events carry their date so a take baseline
  // excludes returns that predate it.
  const refunds = await prisma.refund.findMany({
    where: {
      originalSale: { companyId: businessId },
      status: { in: RECONCILABLE_REFUND_STATUSES }
    },
    include: {
      items: true,
      originalSale: { include: { items: { include: { allocations: true } } } }
    },
    orderBy: { createdAt: 'asc' }
  });
  const returnEvents: Array<{ batchId: string; qty: number; at: Date }> = [];
  // Prior returns per (saleId, productId), in refund order, so the
  // FEFO-first attribution never credits a batch twice.
  const priorReturned = new Map<string, number>();
  for (const refund of refunds) {
    const refundAt = new Date(refund.createdAt ?? refund.updatedAt ?? 0);
    const saleItems = refund.originalSale?.items ?? [];
    for (const rItem of refund.items ?? []) {
      const saleItem = (rItem as any).saleItemId
        ? saleItems.find((s: any) => s.id === (rItem as any).saleItemId)
        : saleItems.find((s: any) => s.productId === rItem.productId);
      if (!saleItem) continue;
      const ratio = saleItem.quantity > 0
        ? ((saleItem.unitsDeducted ?? saleItem.quantity) / saleItem.quantity)
        : 1;
      const unitsToReturn = Math.round(rItem.quantity * ratio);
      if (unitsToReturn <= 0) continue;
      const key = `${refund.originalSaleId}:${saleItem.productId}`;
      const prior = priorReturned.get(key) || 0;
      const lineAllocations = (saleItem.allocations ?? []).map((a: any) => ({ batchId: a.batchId, qty: a.quantity }));
      if (lineAllocations.length > 0) {
        for (const restock of planRefundRestock(lineAllocations, unitsToReturn, prior)) {
          returnEvents.push({ batchId: restock.batchId, qty: restock.qty, at: refundAt });
        }
      } else if (saleItem.batchId) {
        returnEvents.push({ batchId: saleItem.batchId, qty: unitsToReturn, at: refundAt });
      }
      priorReturned.set(key, prior + unitsToReturn);
    }
  }

  // COMPLETED transfers per batch, dated by the transfer's completion.
  const transferItems = await prisma.stockTransferItem.findMany({
    where: {
      OR: [
        { sourceBatchId: { in: batches.map((b: any) => b.id) } },
        { destBatchId: { in: batches.map((b: any) => b.id) } }
      ],
      transfer: { companyId: businessId, status: 'COMPLETED' }
    },
    select: {
      sourceBatchId: true,
      destBatchId: true,
      quantity: true,
      transfer: { select: { completedAt: true, updatedAt: true } }
    }
  });
  const transferEvents: Array<{ batchId: string; qty: number; at: Date }> = [];
  for (const t of transferItems) {
    const at = new Date(t.transfer?.completedAt ?? t.transfer?.updatedAt ?? 0);
    if (t.destBatchId) transferEvents.push({ batchId: t.destBatchId, qty: t.quantity || 0, at });
    if (t.sourceBatchId) transferEvents.push({ batchId: t.sourceBatchId, qty: -(t.quantity || 0), at });
  }

  // Desktop-pushed sales never replayed (their stock effect is missing
  // on the cloud) — the reason hint for their batches.
  const unreplayed = await prisma.sale.findMany({
    where: { companyId: businessId, syncOrigin: 'DESKTOP_PUSH', stockReplayedAt: null },
    include: { items: { select: { batchId: true } } }
  });
  const unreplayedBatches = new Set<string>();
  for (const s of unreplayed) {
    for (const it of s.items ?? []) if (it.batchId) unreplayedBatches.add(it.batchId);
  }

  const lines: ReconciliationLineInput[] = [];
  let unverifiableCount = 0;
  for (const batch of batches) {
    const baseline = baselineByBatch.get(batch.id);
    const hasReceipts = receipts.some((r: any) => r.batchId === batch.id);
    if (!baseline && !hasReceipts) {
      // No take and no purchase link: the batch's history starts before
      // the ledger does (seed / manual batch). Never guess — count it.
      unverifiableCount++;
      continue;
    }
    // Every event counts only after the baseline instant (a take
    // re-bases the ledger); with no take, since is the epoch, so all
    // events count.
    const since = baseline ? baseline.since : new Date(0);
    const baseQty = baseline ? baseline.qty : 0;
    const receiptQty = receipts
      .filter((r: any) => r.batchId === batch.id && new Date(r.createdAt) > since)
      .reduce((s: number, r: any) => s + (r.quantity || 0), 0);
    const draws = allocations
      .filter((a: any) => a.batchId === batch.id && new Date(a.saleItem?.sale?.createdAt ?? 0) > since)
      .reduce((s: number, a: any) => s + (a.quantity || 0), 0)
      + saleItemsNoAlloc
        .filter((i: any) => i.batchId === batch.id && (saleCreatedById.get(i.saleId) ?? new Date(0)) > since)
        .reduce((s: number, i: any) => s + saleLineUnits(i), 0);
    const returns = returnEvents
      .filter((e) => e.batchId === batch.id && e.at > since)
      .reduce((s, e) => s + e.qty, 0);
    const transferNet = transferEvents
      .filter((e) => e.batchId === batch.id && e.at > since)
      .reduce((s, e) => s + e.qty, 0);
    const expected = baseQty + receiptQty - draws + returns + transferNet;
    const actual = batch.quantity || 0;
    const variance = expected - actual;
    if (variance !== 0) {
      lines.push({
        productId: batch.productId,
        batchId: batch.id,
        branchId: batch.branchId,
        expectedQty: expected,
        actualQty: actual,
        variance,
        reason: unreplayedBatches.has(batch.id) ? 'UNREPLAYED_SALE' : 'UNEXPLAINED'
      });
    }
  }

  const run = await prisma.$transaction(async (tx: any) => {
    const created = await tx.stockReconciliation.create({
      data: {
        companyId: businessId,
        branchId: branchId ?? null,
        status: 'OPEN',
        trigger,
        batchesChecked: batches.length - unverifiableCount,
        varianceCount: lines.length,
        unverifiableCount
      }
    });
    for (const line of lines) {
      await tx.stockReconciliationLine.create({
        data: {
          reconciliationId: created.id,
          productId: line.productId,
          batchId: line.batchId,
          branchId: line.branchId,
          expectedQty: line.expectedQty,
          actualQty: line.actualQty,
          variance: line.variance,
          reason: line.reason,
          status: 'OPEN'
        }
      });
    }
    return created;
  });

  return {
    id: run.id,
    batchesChecked: batches.length - unverifiableCount,
    varianceCount: lines.length,
    unverifiableCount,
    lines
  };
}

export async function createStockTakesFromReconciliation(
  prisma: any,
  businessId: string,
  reconciliationId: string,
  userId: string
): Promise<Array<{ branchId: string; stockTakeId: string; lines: number }>> {
  const recon = await prisma.stockReconciliation.findFirst({
    where: { id: reconciliationId, companyId: businessId },
    include: { lines: { where: { status: 'OPEN' } } }
  });
  if (!recon) throw new Error('Reconciliation not found');
  if ((recon.lines ?? []).length === 0) return [];

  const byBranch = new Map<string, typeof recon.lines>();
  for (const line of recon.lines) {
    const list = byBranch.get(line.branchId) ?? [];
    list.push(line);
    byBranch.set(line.branchId, list);
  }
  const created: Array<{ branchId: string; stockTakeId: string; lines: number }> = [];
  await prisma.$transaction(async (tx: any) => {
    for (const [branchId, branchLines] of byBranch) {
      const take = await tx.stockTake.create({
        data: {
          companyId: businessId,
          branchId,
          status: 'OPEN',
          startedBy: userId,
          note: `From stock reconciliation ${recon.id} (${recon.createdAt.toISOString().slice(0, 10)}): ${branchLines.length} variance line(s) — countedQty is the ledger-expected quantity.`
        }
      });
      for (const line of branchLines) {
        await tx.stockTakeLine.create({
          data: {
            stockTakeId: take.id,
            productId: line.productId,
            batchId: line.batchId,
            systemQty: line.actualQty,
            countedQty: line.expectedQty,
            variance: line.variance
          }
        });
      }
      created.push({ branchId, stockTakeId: take.id, lines: branchLines.length });
    }
    await tx.stockReconciliation.update({
      where: { id: recon.id },
      data: { status: 'REVIEWED' }
    });
  });
  return created;
}

export async function resolveReconciliation(
  prisma: any,
  businessId: string,
  reconciliationId: string,
  userId: string,
  note?: string | null
): Promise<boolean> {
  const updated = await prisma.stockReconciliation.updateMany({
    where: { id: reconciliationId, companyId: businessId, status: { in: ['OPEN', 'REVIEWED'] } },
    data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedBy: userId, note: note ?? undefined }
  });
  if (updated.count !== 1) return false;
  await prisma.stockReconciliationLine.updateMany({
    where: { reconciliationId, status: 'OPEN' },
    data: { status: 'RESOLVED' }
  });
  return true;
}
