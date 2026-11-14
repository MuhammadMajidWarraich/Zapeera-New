/**
 * Double-entry ledger — database operations (v1.0.22).
 *
 * All functions take the CALLER'S transaction (`tx: any`) and run
 * inside it, so a journal entry commits or rolls back with the source
 * operation. New-model access uses the `(tx as any).model` bridge
 * (same precedent as saleItemBatch) so the code typechecks against
 * any generated client; the deploy/test flows regenerate the client
 * from the schema, which carries the ledger models.
 *
 * NEVER-BLOCK RULE: posting helpers are invoked through
 * `postWithGuard` at every wiring point. A posting that cannot be
 * constructed (unbalanced source figures, missing data, a missing
 * ledger table on an unmigrated desktop DB) is recorded as a
 * LedgerException in the same transaction and the source operation
 * still commits. An unbalanced entry is NEVER written.
 *
 * IDEMPOTENCY: JournalEntry (sourceType, sourceId, isReversal) is
 * unique — isReversal is a NON-NULL Boolean because NULLs are
 * distinct in UNIQUE indexes under both PostgreSQL and SQLite, so a
 * nullable key column would constrain nothing (recon F1). Re-posting
 * the same source is a no-op that returns the existing entry id —
 * safe for retries and sync replays. Concurrent creators never rely
 * on catching a unique violation inside the transaction (a failed
 * statement aborts a PostgreSQL transaction — recon F10): chart and
 * entry writes use createMany with skipDuplicates, which conflicts
 * silently instead of erroring.
 */

import { round2 } from '../utils/accounting.util';
import {
  ACCOUNT_CODES,
  SYSTEM_CHART,
  buildBalanceSheet,
  buildExpensePosting,
  buildGiftCardSalePosting,
  buildKhataPaymentPosting,
  buildOpeningPosting,
  buildPurchasePosting,
  buildRefundPosting,
  buildReversalLines,
  buildSalePosting,
  buildTrialBalance,
  buildWalletTopUpPosting,
  buildWastagePosting,
  balanceDraft,
  type BalanceSheetResult,
  type DraftLine,
  type LedgerAccountRow,
  type TrialBalanceResult,
} from '../utils/ledger.util';

type Tx = any;

// ─── Chart ───────────────────────────────────────────────────────────

/**
 * Lazily create the 16 system accounts for a business (branchId null
 * — the chart is business-wide; entries carry the branch). Idempotent
 * and race-safe WITHOUT catching a unique violation: createMany with
 * skipDuplicates conflicts silently (a failed statement would abort
 * a PostgreSQL transaction — recon F10), and the re-read below
 * verifies completeness. Returns code → account id.
 */
export async function ensureSystemAccounts(tx: Tx, companyId: string): Promise<Map<string, string>> {
  const existing = await (tx as any).chartOfAccount.findMany({
    where: { companyId, branchId: null },
    select: { id: true, code: true },
  });
  const have = new Set((existing as any[]).map((a) => a.code));
  const missing = SYSTEM_CHART.filter((d) => !have.has(d.code));
  if (missing.length > 0) {
    await (tx as any).chartOfAccount.createMany({
      data: missing.map((def) => ({
        companyId,
        branchId: null,
        code: def.code,
        name: def.name,
        type: def.type,
        subtype: def.subtype || null,
        isSystem: true,
      })),
      skipDuplicates: true,
    });
  }
  const rows = await (tx as any).chartOfAccount.findMany({
    where: { companyId, branchId: null },
    select: { id: true, code: true },
  });
  const map = new Map<string, string>();
  for (const r of rows as any[]) map.set(r.code, r.id);
  const stillMissing = SYSTEM_CHART.filter((d) => !map.has(d.code));
  if (stillMissing.length > 0) {
    throw new Error(`System chart incomplete for ${companyId}: missing ${stillMissing.map((d) => d.code).join(', ')}`);
  }
  return map;
}

// ─── Entry writing ───────────────────────────────────────────────────

export interface PostEntryInput {
  companyId: string;
  branchId: string | null;
  /** Business date of the entry (source transaction date); posting time when absent. */
  entryDate?: Date | null;
  sourceType: string;
  sourceId: string;
  memo?: string | null;
  isOpening?: boolean;
  reversalOfId?: string | null;
  createdBy?: string | null;
  lines: DraftLine[];
  accounts: Map<string, string>;
}

/**
 * Validate + write one balanced entry. Returns the entry id, or null
 * when there are no lines to post. Re-posting the same source returns
 * the existing entry id (no duplicate). Concurrent creation uses
 * createMany + skipDuplicates, so the loser never sees a unique
 * violation (which would abort a PostgreSQL transaction — recon
 * F10); the entry row is then re-read to obtain its id for the lines.
 */
export async function postJournalEntry(tx: Tx, input: PostEntryInput): Promise<string | null> {
  const lines = balanceDraft(input.lines, `${input.sourceType}:${input.sourceId}`);
  if (lines.length === 0) return null;
  const isReversal = Boolean(input.reversalOfId);
  const key = { sourceType: input.sourceType, sourceId: input.sourceId, isReversal };
  const existing = await (tx as any).journalEntry.findFirst({
    where: key,
    select: { id: true },
  });
  if (existing) return existing.id;
  const lineData = lines.map((l) => {
    const accountId = input.accounts.get(l.code);
    if (!accountId) throw new Error(`No account for code ${l.code} in business ${input.companyId}`);
    return { accountId, debit: l.debit, credit: l.credit, memo: l.memo || null };
  });
  const created = await (tx as any).journalEntry.createMany({
    data: [
      {
        companyId: input.companyId,
        branchId: input.branchId || null,
        entryDate: input.entryDate || new Date(),
        memo: input.memo || null,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        status: 'POSTED',
        isOpening: input.isOpening || false,
        isReversal,
        reversalOfId: input.reversalOfId || null,
        createdBy: input.createdBy || null,
      },
    ],
    skipDuplicates: true,
  });
  if (created.count === 0) {
    // A concurrent creator won the race — return its entry.
    const raced = await (tx as any).journalEntry.findFirst({ where: key, select: { id: true } });
    return raced ? raced.id : null;
  }
  const entry = await (tx as any).journalEntry.findFirst({ where: key, select: { id: true } });
  if (!entry) return null;
  try {
    await (tx as any).journalLine.createMany({
      data: lineData.map((l) => ({ ...l, entryId: entry.id })),
    });
  } catch (e: any) {
    // Best-effort cleanup: a lineless entry would block every future
    // re-post of this source. If the transaction is already aborted
    // the delete fails too and the guard records the failure.
    try {
      await (tx as any).journalEntry.delete({ where: { id: entry.id } });
    } catch {
      /* the guard records the original failure */
    }
    throw e;
  }
  return entry.id;
}

export async function recordLedgerException(
  tx: Tx,
  input: {
    companyId: string;
    branchId?: string | null;
    sourceType: string;
    sourceId: string;
    reason: string;
    detail?: Record<string, unknown> | null;
  },
): Promise<void> {
  try {
    await (tx as any).ledgerException.create({
      data: {
        companyId: input.companyId,
        branchId: input.branchId || null,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        reason: input.reason,
        detail: input.detail || null,
      },
    });
  } catch (e: any) {
    // The exception record itself must never break the operation —
    // e.g. an unmigrated desktop DB has no ledger_exceptions table.
    console.error('[Ledger] Failed to record exception:', e?.message);
  }
}

/**
 * Never-block wrapper for every wiring point: run the posting; on ANY
 * failure, record the gap as a LedgerException in the same
 * transaction and let the source operation commit.
 */
export async function postWithGuard(
  tx: Tx,
  ctx: { companyId: string; branchId?: string | null; sourceType: string; sourceId: string },
  fn: () => Promise<unknown>,
): Promise<void> {
  try {
    await fn();
  } catch (e: any) {
    console.error(`[Ledger] Posting failed for ${ctx.sourceType}:${ctx.sourceId}:`, e?.message);
    await recordLedgerException(tx, {
      ...ctx,
      reason: `Posting failed: ${e?.message || 'unknown error'}`,
      detail: { errorName: e?.name || 'Error' },
    });
  }
}

// ─── COGS ────────────────────────────────────────────────────────────

export interface CogsResult {
  knownCost: number;
  unknownLines: number;
  unknownUnits: number;
}

/**
 * Sale COGS from the FEFO allocation rows (exact per-batch cost), with
 * the header-batch + unitsDeducted fallback for lines without
 * allocations (legacy / desktop-pushed lines). Service lines cost 0
 * (knowable, not unknown). Batch purchasePrice is immutable, so
 * reading it at posting time in-transaction is exact.
 *
 * Two silences are guarded (recon F5): when allocations cover FEWER
 * units than the line deducted (oversold / partially-drawn pushed
 * sales — replaySaleStock records the remainder as shortfall), the
 * undrawn remainder is costed at the header batch or counted unknown;
 * and an allocation whose batch row is missing costs at unknown,
 * never at 0.
 */
export async function computeSaleCogs(tx: Tx, saleId: string): Promise<CogsResult> {
  const items = await tx.saleItem.findMany({
    where: { saleId },
    include: {
      allocations: { include: { batch: { select: { purchasePrice: true } } } },
      product: { select: { isService: true } },
      batch: { select: { purchasePrice: true } },
    },
  });
  let knownCost = 0;
  let unknownLines = 0;
  let unknownUnits = 0;
  for (const item of items as any[]) {
    if (item.product?.isService) continue;
    const expectedUnits = Number(item.unitsDeducted ?? item.quantity ?? 0);
    const allocs = item.allocations || [];
    if (allocs.length > 0) {
      let drawnUnits = 0;
      let lineUnknown = false;
      for (const a of allocs) {
        const qty = Number(a.quantity) || 0;
        drawnUnits += qty;
        const price = a.batch?.purchasePrice;
        if (price === null || price === undefined) {
          lineUnknown = true;
          unknownUnits += qty;
        } else {
          knownCost += qty * Number(price);
        }
      }
      if (lineUnknown) unknownLines += 1;
      // Undrawn remainder: header batch if it has a price, else unknown.
      const remainder = round2(expectedUnits - drawnUnits);
      if (remainder > 0) {
        const headerPrice = item.batch?.purchasePrice;
        if (headerPrice === null || headerPrice === undefined) {
          unknownLines += 1;
          unknownUnits += remainder;
        } else {
          knownCost += remainder * Number(headerPrice);
        }
      }
    } else {
      const price = item.batch?.purchasePrice;
      if (price === null || price === undefined) {
        unknownLines += 1;
        unknownUnits += expectedUnits;
      } else {
        knownCost += expectedUnits * Number(price);
      }
    }
  }
  return { knownCost: round2(knownCost), unknownLines, unknownUnits };
}

/**
 * Refund COGS reversal in BASE units at the original lines' FEFO
 * cost, so it reverses the sale leg the ledger actually posted
 * (recon F4). RefundItem.quantity is in SOLD units (boxes for a BOX
 * line); the base units are derived from each original line's own
 * unitsDeducted ÷ quantity ratio — the same derivation the refund
 * flow uses for restock units. Per product, the original lines'
 * total base units and total cost (FEFO allocations preferred,
 * header batch fallback, service 0) give a blended unit cost, which
 * the refunded base units are priced at. This is deliberately MORE
 * precise than the house P&L method (first line per product, header
 * batch, sold units), which under-reverses BOX lines; the difference
 * is expected and shows in the reconciliation note.
 */
export async function computeRefundCogsReversal(
  tx: Tx,
  refundId: string,
  originalSaleId: string,
): Promise<CogsResult> {
  const refundItems = await tx.refundItem.findMany({
    where: { refundId },
    select: { productId: true, quantity: true },
  });
  if ((refundItems as any[]).length === 0) return { knownCost: 0, unknownLines: 0, unknownUnits: 0 };
  const originalItems = await tx.saleItem.findMany({
    where: { saleId: originalSaleId },
    include: {
      allocations: { include: { batch: { select: { purchasePrice: true } } } },
      product: { select: { isService: true } },
      batch: { select: { purchasePrice: true } },
    },
  });
  // Per product: sold qty, base units, total cost, known?
  const basisByProduct = new Map<string, { soldQty: number; baseUnits: number; cost: number; known: boolean }>();
  for (const oi of originalItems as any[]) {
    const soldQty = Number(oi.quantity) || 0;
    const baseUnits = Number(oi.unitsDeducted ?? oi.quantity ?? 0);
    let entry = basisByProduct.get(oi.productId);
    if (!entry) {
      entry = { soldQty: 0, baseUnits: 0, cost: 0, known: true };
      basisByProduct.set(oi.productId, entry);
    }
    entry.soldQty += soldQty;
    entry.baseUnits += baseUnits;
    if (oi.product?.isService) continue; // cost 0, known
    const allocs = oi.allocations || [];
    if (allocs.length > 0) {
      for (const a of allocs) {
        const price = a.batch?.purchasePrice;
        if (price === null || price === undefined) entry.known = false;
        else entry.cost += (Number(a.quantity) || 0) * Number(price);
      }
      // Undrawn remainder at the header batch, mirroring computeSaleCogs.
      const drawn = allocs.reduce((s: number, a: any) => s + (Number(a.quantity) || 0), 0);
      const remainder = round2(baseUnits - drawn);
      if (remainder > 0) {
        const headerPrice = oi.batch?.purchasePrice;
        if (headerPrice === null || headerPrice === undefined) entry.known = false;
        else entry.cost += remainder * Number(headerPrice);
      }
    } else {
      const price = oi.batch?.purchasePrice;
      if (price === null || price === undefined) entry.known = false;
      else entry.cost += baseUnits * Number(price);
    }
  }
  let knownCost = 0;
  let unknownLines = 0;
  let unknownUnits = 0;
  for (const ri of refundItems as any[]) {
    const entry = basisByProduct.get(ri.productId);
    const soldQty = Number(ri.quantity) || 0;
    if (!entry || entry.soldQty <= 0) {
      // No original line to price from — unknown, never invented.
      unknownLines += 1;
      unknownUnits += soldQty;
      continue;
    }
    const refundBaseUnits = round2((soldQty * entry.baseUnits) / entry.soldQty);
    if (!entry.known || entry.baseUnits <= 0) {
      unknownLines += 1;
      unknownUnits += refundBaseUnits;
    } else {
      knownCost += refundBaseUnits * (entry.cost / entry.baseUnits);
    }
  }
  return { knownCost: round2(knownCost), unknownLines, unknownUnits };
}

// ─── Posting helpers (one per source type) ───────────────────────────

async function recordBuildExceptions(
  tx: Tx,
  companyId: string,
  branchId: string | null,
  sourceType: string,
  sourceId: string,
  entryId: string | null,
  exceptions: string[],
): Promise<void> {
  for (const reason of exceptions) {
    await recordLedgerException(tx, {
      companyId,
      branchId,
      sourceType,
      sourceId,
      reason,
      detail: entryId ? { entryId, partial: true } : { partial: true },
    });
  }
}

export async function postSaleJournal(tx: Tx, saleId: string, createdBy?: string | null): Promise<string | null> {
  const sale = await tx.sale.findUnique({
    where: { id: saleId },
    include: { payments: { select: { method: true, amount: true } } },
  });
  if (!sale) throw new Error(`Sale ${saleId} not found for ledger posting`);
  const cogs = await computeSaleCogs(tx, saleId);
  const accounts = await ensureSystemAccounts(tx, sale.companyId);
  const build = buildSalePosting({
    subtotal: Number(sale.subtotal) || 0,
    discountAmount: Number(sale.discountAmount) || 0,
    promotionDiscount: Number(sale.promotionDiscount) || 0,
    loyaltyDiscount: Number(sale.loyaltyDiscount) || 0,
    taxAmount: Number(sale.taxAmount) || 0,
    provincialTaxAmount: Number(sale.provincialTaxAmount) || 0,
    serviceChargeAmount: Number(sale.serviceChargeAmount) || 0,
    totalAmount: Number(sale.totalAmount) || 0,
    paidAmount: Number(sale.paidAmount) || 0,
    returnedAmount: Number(sale.returnedAmount) || 0,
    paymentMethod: sale.paymentMethod || null,
    giftCardAmount: Number(sale.giftCardAmount) || 0,
    walletAmount: Number(sale.walletAmount) || 0,
    allocations: (sale.payments || []).map((p: any) => ({ method: p.method, amount: Number(p.amount) || 0 })),
    cogs,
    invoiceNumber: sale.invoiceNumber || undefined,
  });
  const entryId = await postJournalEntry(tx, {
    companyId: sale.companyId,
    branchId: sale.branchId || null,
    entryDate: sale.saleDate || sale.createdAt || null,
    sourceType: 'SALE',
    sourceId: saleId,
    memo: `Sale ${sale.invoiceNumber || saleId}`,
    createdBy: createdBy || sale.createdBy || null,
    lines: build.lines,
    accounts,
  });
  await recordBuildExceptions(tx, sale.companyId, sale.branchId || null, 'SALE', saleId, entryId, build.exceptions);
  return entryId;
}

export async function postRefundJournal(tx: Tx, refundId: string, createdBy?: string | null): Promise<string | null> {
  const refund = await tx.refund.findUnique({ where: { id: refundId } });
  if (!refund) throw new Error(`Refund ${refundId} not found for ledger posting`);
  const originalSale = await tx.sale.findUnique({
    where: { id: refund.originalSaleId },
    select: {
      totalAmount: true,
      taxAmount: true,
      provincialTaxAmount: true,
      serviceChargeAmount: true,
      paidAmount: true,
      invoiceNumber: true,
      companyId: true,
      branchId: true,
    },
  });
  if (!originalSale) throw new Error(`Original sale ${refund.originalSaleId} not found for refund posting`);
  // Prior refunds = every other refund on this sale (same semantics as
  // createRefund's pre-transaction priorRefunds read).
  const priors = await tx.refund.findMany({
    where: { originalSaleId: refund.originalSaleId, id: { not: refundId } },
    select: { refundAmount: true },
  });
  const priorRefundTotal = round2(
    (priors as any[]).reduce((s: number, r: any) => s + (Number(r.refundAmount) || 0), 0),
  );
  const cogsReversal = await computeRefundCogsReversal(tx, refundId, refund.originalSaleId);
  const accounts = await ensureSystemAccounts(tx, originalSale.companyId);
  const build = buildRefundPosting({
    refundAmount: Number(refund.refundAmount) || 0,
    refundMethod: refund.refundMethod || null,
    saleTotalAmount: Number(originalSale.totalAmount) || 0,
    saleTaxAmount: Number(originalSale.taxAmount) || 0,
    saleProvincialTaxAmount: Number(originalSale.provincialTaxAmount) || 0,
    saleServiceChargeAmount: Number(originalSale.serviceChargeAmount) || 0,
    salePaidAmount: Number(originalSale.paidAmount) || 0,
    priorRefundTotal,
    cogsReversal,
    invoiceNumber: originalSale.invoiceNumber || undefined,
  });
  const entryId = await postJournalEntry(tx, {
    companyId: originalSale.companyId,
    branchId: originalSale.branchId || null,
    entryDate: refund.createdAt || null,
    sourceType: 'REFUND',
    sourceId: refundId,
    memo: `Refund against ${originalSale.invoiceNumber || originalSale.id}`,
    createdBy: createdBy || refund.createdBy || null,
    lines: build.lines,
    accounts,
  });
  await recordBuildExceptions(tx, originalSale.companyId, originalSale.branchId || null, 'REFUND', refundId, entryId, build.exceptions);
  return entryId;
}

export async function postPurchaseJournal(tx: Tx, purchaseId: string, createdBy?: string | null): Promise<string | null> {
  const purchase = await tx.purchase.findUnique({ where: { id: purchaseId } });
  if (!purchase) throw new Error(`Purchase ${purchaseId} not found for ledger posting`);
  const accounts = await ensureSystemAccounts(tx, purchase.companyId);
  const build = buildPurchasePosting({
    totalAmount: Number(purchase.totalAmount) || 0,
    paidAmount: Number(purchase.paidAmount) || 0,
    invoiceNumber: purchaseId,
  });
  return postJournalEntry(tx, {
    companyId: purchase.companyId,
    branchId: purchase.branchId || null,
    entryDate: purchase.purchaseDate || purchase.createdAt || null,
    sourceType: 'PURCHASE',
    sourceId: purchaseId,
    memo: `Purchase ${purchaseId}`,
    createdBy: createdBy || purchase.createdBy || null,
    lines: build.lines,
    accounts,
  });
}

export async function postExpenseJournal(tx: Tx, expenseId: string, createdBy?: string | null): Promise<string | null> {
  const expense = await tx.expense.findUnique({
    where: { id: expenseId },
    include: { category: { select: { name: true } } },
  });
  if (!expense) throw new Error(`Expense ${expenseId} not found for ledger posting`);
  const accounts = await ensureSystemAccounts(tx, expense.companyId);
  const build = buildExpensePosting({
    amount: Number(expense.amount) || 0,
    paymentMethod: expense.paymentMethod || null,
    categoryName: expense.category?.name || expense.title || undefined,
  });
  return postJournalEntry(tx, {
    companyId: expense.companyId,
    branchId: expense.branchId || null,
    entryDate: expense.expenseDate || expense.createdAt || null,
    sourceType: 'EXPENSE',
    sourceId: expenseId,
    memo: `Expense — ${expense.title || expenseId}`,
    createdBy: createdBy || expense.createdBy || null,
    lines: build.lines,
    accounts,
  });
}

export async function postKhataPaymentJournal(tx: Tx, entryId: string, createdBy?: string | null): Promise<string | null> {
  const entry = await tx.customerLedgerEntry.findUnique({ where: { id: entryId } });
  if (!entry) throw new Error(`Ledger entry ${entryId} not found for ledger posting`);
  if (entry.type !== 'PAYMENT') throw new Error(`Ledger entry ${entryId} is ${entry.type}, not a PAYMENT`);
  const customer = await tx.customer.findUnique({ where: { id: entry.customerId }, select: { branchId: true } });
  if (!customer) throw new Error(`Customer ${entry.customerId} not found for khata payment posting`);
  // Post-entry balance (this entry was created before the hook runs in
  // the same transaction, so the sum includes this payment). A
  // negative balance is an advance — the overpaid portion credits
  // Customer Advances instead of Receivables.
  const agg = await tx.customerLedgerEntry.aggregate({
    where: { customerId: entry.customerId, companyId: entry.companyId },
    _sum: { amount: true },
  });
  const balance = round2(Number(agg._sum?.amount) || 0);
  const amount = round2(Math.abs(Number(entry.amount) || 0));
  const advancePortion = balance < 0 ? Math.min(round2(-balance), amount) : 0;
  const accounts = await ensureSystemAccounts(tx, entry.companyId);
  const build = buildKhataPaymentPosting({ amount, method: entry.method || null, advancePortion });
  return postJournalEntry(tx, {
    companyId: entry.companyId,
    branchId: customer.branchId || null,
    entryDate: entry.createdAt || null,
    sourceType: 'KHATA_PAYMENT',
    sourceId: entryId,
    memo: `Khata payment — customer ${entry.customerId}`,
    createdBy: createdBy || entry.createdBy || null,
    lines: build.lines,
    accounts,
  });
}

export async function postGiftCardSaleJournal(tx: Tx, giftCardId: string, createdBy?: string | null): Promise<string | null> {
  const card = await tx.giftCard.findUnique({ where: { id: giftCardId } });
  if (!card) throw new Error(`Gift card ${giftCardId} not found for ledger posting`);
  const accounts = await ensureSystemAccounts(tx, card.companyId);
  const build = buildGiftCardSalePosting({
    value: Number(card.initialValue) || 0,
    paymentMethod: card.paymentMethod || null,
  });
  return postJournalEntry(tx, {
    companyId: card.companyId,
    branchId: card.branchId || null,
    entryDate: card.createdAt || null,
    sourceType: 'GIFT_CARD_SALE',
    sourceId: giftCardId,
    memo: `Gift card ${card.code || giftCardId} sold`,
    createdBy: createdBy || card.createdBy || null,
    lines: build.lines,
    accounts,
  });
}

export async function postWalletTopUpJournal(tx: Tx, transactionId: string, createdBy?: string | null): Promise<string | null> {
  const txnRow = await tx.walletTransaction.findUnique({ where: { id: transactionId } });
  if (!txnRow) throw new Error(`Wallet transaction ${transactionId} not found for ledger posting`);
  if (txnRow.type !== 'TOPUP') throw new Error(`Wallet transaction ${transactionId} is ${txnRow.type}, not a TOPUP`);
  const customer = await tx.customer.findUnique({ where: { id: txnRow.customerId }, select: { branchId: true } });
  if (!customer) throw new Error(`Customer ${txnRow.customerId} not found for wallet top-up posting`);
  const accounts = await ensureSystemAccounts(tx, txnRow.companyId);
  const build = buildWalletTopUpPosting({
    amount: round2(Math.abs(Number(txnRow.amount) || 0)),
    method: txnRow.method || null,
  });
  return postJournalEntry(tx, {
    companyId: txnRow.companyId,
    branchId: customer.branchId || null,
    entryDate: txnRow.createdAt || null,
    sourceType: 'WALLET_TOPUP',
    sourceId: transactionId,
    memo: `Wallet top-up — customer ${txnRow.customerId}`,
    createdBy: createdBy || txnRow.createdBy || null,
    lines: build.lines,
    accounts,
  });
}

export async function postWastageJournal(tx: Tx, wastageRecordId: string, createdBy?: string | null): Promise<string | null> {
  const record = await tx.wastageRecord.findUnique({ where: { id: wastageRecordId } });
  if (!record) throw new Error(`Wastage record ${wastageRecordId} not found for ledger posting`);
  if (record.unitCost === null || record.unitCost === undefined) {
    await recordLedgerException(tx, {
      companyId: record.companyId,
      branchId: record.branchId || null,
      sourceType: 'WASTAGE',
      sourceId: wastageRecordId,
      reason: 'Wastage record has no snapshotted batch cost; no inventory leg posted.',
      detail: { quantity: record.quantity },
    });
    return null;
  }
  const accounts = await ensureSystemAccounts(tx, record.companyId);
  const build = buildWastagePosting({ value: round2((Number(record.quantity) || 0) * Number(record.unitCost)) });
  return postJournalEntry(tx, {
    companyId: record.companyId,
    branchId: record.branchId || null,
    entryDate: record.recordedAt || record.createdAt || null,
    sourceType: 'WASTAGE',
    sourceId: wastageRecordId,
    memo: `Wastage (${record.reason || 'write-off'}) — product ${record.productId}`,
    createdBy: createdBy || record.recordedBy || null,
    lines: build.lines,
    accounts,
  });
}

/**
 * Reverse a sale's journal on sale deletion. Mirrors the original
 * entry's lines. A no-op when no original entry exists (pre-cutover
 * sales never posted). Idempotent: the reversal is keyed by the
 * original entry id.
 */
export async function reverseSaleJournal(tx: Tx, saleId: string, createdBy?: string | null): Promise<string | null> {
  const original = await (tx as any).journalEntry.findFirst({
    where: { sourceType: 'SALE', sourceId: saleId, isReversal: false },
    include: { lines: { include: { account: { select: { code: true } } } } },
  });
  if (!original) return null;
  const accounts = await ensureSystemAccounts(tx, original.companyId);
  const reversalLines = buildReversalLines(
    (original.lines as any[]).map((l: any) => ({
      code: l.account.code,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
      memo: l.memo || undefined,
    })),
  );
  return postJournalEntry(tx, {
    companyId: original.companyId,
    branchId: original.branchId || null,
    sourceType: 'SALE',
    sourceId: saleId,
    memo: `Reversal — sale ${saleId} deleted`,
    reversalOfId: original.id,
    createdBy,
    lines: reversalLines,
    accounts,
  });
}

// ─── Opening balances ────────────────────────────────────────────────

/**
 * Post a journal for a sale that arrived via the cloud sync-push API
 * (desktop → cloud). This is the sale's ONLY posting: the desktop
 * posts nothing locally (it has no ledger tables — posting there
 * degrades gracefully inside postWithGuard) and journals do NOT sync,
 * so no double-post is possible. Idempotent via the (sourceType,
 * sourceId, isReversal) key. Never throws: a failure is logged and
 * recorded as an exception inside the transaction where possible.
 * Sales arriving via full-table replication (sync.service.ts bulk
 * sync) do NOT pass through here — see the honest-limits note in the
 * v1.0.22 report.
 *
 * SPLIT-BATCH GUARD (recon F6): a sale whose op lands in one push
 * batch and whose items land in a later one must NOT post yet — a
 * revenue entry written before the items arrive would freeze COGS at
 * 0 forever (the later posting is a no-op because the entry exists).
 * With no items on file the posting is skipped; the batch that
 * delivers the items re-triggers the replay loop, which posts then.
 */
export async function postPushedSaleJournal(prisma: Tx, saleId: string): Promise<void> {
  try {
    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      select: { companyId: true, branchId: true },
    });
    if (!sale) return;
    const itemCount = await prisma.saleItem.count({ where: { saleId } });
    if (itemCount === 0) {
      console.info(`[Ledger] Pushed sale ${saleId} has no items yet; posting deferred to the batch that delivers them.`);
      return;
    }
    await prisma.$transaction(async (tx: Tx) => {
      await postWithGuard(
        tx,
        { companyId: sale.companyId, branchId: sale.branchId || null, sourceType: 'SALE', sourceId: saleId },
        () => postSaleJournal(tx, saleId, null),
      );
    });
  } catch (e: any) {
    console.error(`[Ledger] Pushed-sale posting failed for ${saleId}:`, e?.message);
  }
}

/**
 * Same as postPushedSaleJournal, for refunds restocked via the push
 * API — with the same split-batch guard on refund items.
 */
export async function postPushedRefundJournal(prisma: Tx, refundId: string): Promise<void> {
  try {
    const refund = await prisma.refund.findUnique({
      where: { id: refundId },
      select: { originalSaleId: true },
    });
    if (!refund) return;
    const originalSale = await prisma.sale.findUnique({
      where: { id: refund.originalSaleId },
      select: { companyId: true, branchId: true },
    });
    if (!originalSale) return;
    const itemCount = await prisma.refundItem.count({ where: { refundId } });
    if (itemCount === 0) {
      console.info(`[Ledger] Pushed refund ${refundId} has no items yet; posting deferred to the batch that delivers them.`);
      return;
    }
    await prisma.$transaction(async (tx: Tx) => {
      await postWithGuard(
        tx,
        { companyId: originalSale.companyId, branchId: originalSale.branchId || null, sourceType: 'REFUND', sourceId: refundId },
        () => postRefundJournal(tx, refundId, null),
      );
    });
  } catch (e: any) {
    console.error(`[Ledger] Pushed-refund posting failed for ${refundId}:`, e?.message);
  }
}

export interface OpeningScopeResult {
  branchId: string | null;
  status: 'created' | 'skipped-existing' | 'created-zero';
  entryId: string | null;
  totals: {
    inventory: number;
    receivables: number;
    bank: number;
    supplierAdvances: number;
    payables: number;
    advances: number;
    giftCardLiability: number;
    plug: number;
  };
}

export const openingSourceId = (companyId: string, branchId: string | null): string =>
  `opening:${companyId}:${branchId || 'all'}`;

/**
 * Derive opening balances from LIVE operational data at cutover — the
 * same queries as the derived /position endpoint, scoped per branch.
 * One entry per branch (branch-scoped rows only) plus one
 * business-level entry (branchId null) holding ONLY branchId-null
 * items (bank accounts with no branch) — so the all-branches trial
 * balance sums without double-counting.
 *
 * IDEMPOTENT: a scope with an existing OPENING entry is skipped, and
 * concurrent runs are guarded by the (sourceType, sourceId,
 * isReversal) unique key written via createMany + skipDuplicates —
 * the loser re-reads instead of erroring. NEVER rewrites existing
 * sales/purchases/ledger data. NO HISTORICAL BACKFILL: only new
 * postings get journals from cutover forward; this routine carries
 * the prior position.
 */
export async function postOpeningBalances(
  tx: Tx,
  companyId: string,
  branchId: string | null | undefined,
  createdBy?: string | null,
): Promise<OpeningScopeResult[]> {
  const scopes: Array<string | null> = branchId
    ? [branchId]
    : [
        ...(await tx.branch.findMany({ where: { companyId }, select: { id: true } })).map((b: any) => b.id as string),
        null,
      ];
  const accounts = await ensureSystemAccounts(tx, companyId);
  const results: OpeningScopeResult[] = [];
  for (const scope of scopes) {
    const sourceId = openingSourceId(companyId, scope);
    const existing = await (tx as any).journalEntry.findFirst({
      where: { sourceType: 'OPENING', sourceId, isReversal: false },
      include: { lines: { include: { account: { select: { code: true } } } } },
    });
    if (existing) {
      // Report the ACTUAL posted figures, not zeros (recon N6).
      const netByCode = new Map<string, number>();
      for (const l of (existing.lines || []) as any[]) {
        const code = l.account?.code;
        if (!code) continue;
        netByCode.set(code, round2((netByCode.get(code) || 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0)));
      }
      const netDebit = (code: string): number => round2(netByCode.get(code) || 0);
      const netCredit = (code: string): number => round2(-(netByCode.get(code) || 0));
      results.push({
        branchId: scope,
        status: 'skipped-existing',
        entryId: existing.id,
        totals: {
          inventory: netDebit(ACCOUNT_CODES.INVENTORY),
          receivables: netDebit(ACCOUNT_CODES.RECEIVABLES),
          bank: netDebit(ACCOUNT_CODES.BANK),
          supplierAdvances: netDebit(ACCOUNT_CODES.SUPPLIER_ADVANCES),
          payables: netCredit(ACCOUNT_CODES.PAYABLES),
          advances: netCredit(ACCOUNT_CODES.CUSTOMER_ADVANCES),
          giftCardLiability: netCredit(ACCOUNT_CODES.GIFT_CARD_LIABILITY),
          plug: netCredit(ACCOUNT_CODES.OWNERS_EQUITY),
        },
      });
      continue;
    }

    // Branch-scoped rows: batches, khata, payables, gift cards and
    // wallets all carry a (non-null) branch — directly or via the
    // customer. The business-level scope (null) holds ONLY bank
    // accounts with no branch; every other figure is zero there.
    let inventory = 0;
    let receivables = 0;
    let advances = 0;
    let payables = 0;
    let supplierAdvances = 0;
    let giftCardLiability = 0;
    if (scope) {
      const batches = await tx.batch.findMany({
        where: { companyId, branchId: scope, isActive: true },
        select: { quantity: true, purchasePrice: true },
      });
      inventory = round2(
        (batches as any[]).reduce((s: number, b: any) => s + (Number(b.quantity) || 0) * (Number(b.purchasePrice) || 0), 0),
      );
      const ledgerSums = await tx.customerLedgerEntry.groupBy({
        by: ['customerId'],
        where: { companyId, customer: { branchId: scope } },
        _sum: { amount: true },
      });
      for (const g of ledgerSums as any[]) {
        const balance = Number(g._sum?.amount) || 0;
        if (balance > 0) receivables = round2(receivables + balance);
        else if (balance < 0) advances = round2(advances + Math.abs(balance));
      }
      const payablesAgg = await tx.purchase.aggregate({
        where: { companyId, branchId: scope, outstanding: { gt: 0 }, status: { not: 'CANCELLED' } },
        _sum: { outstanding: true },
      });
      payables = round2(Number(payablesAgg._sum?.outstanding) || 0);
      // Overpaid purchases (negative outstanding) are supplier
      // advances, not negative payables (recon F9).
      const advancesAgg = await tx.purchase.aggregate({
        where: { companyId, branchId: scope, outstanding: { lt: 0 }, status: { not: 'CANCELLED' } },
        _sum: { outstanding: true },
      });
      supplierAdvances = round2(Math.abs(Number(advancesAgg._sum?.outstanding) || 0));
      const giftAgg = await tx.giftCard.aggregate({
        where: { companyId, branchId: scope, status: 'ACTIVE' },
        _sum: { balance: true },
      });
      giftCardLiability = round2(Number(giftAgg._sum?.balance) || 0);
      const walletAgg = await tx.customerWallet.aggregate({
        where: { companyId, customer: { branchId: scope } },
        _sum: { balance: true },
      });
      advances = round2(advances + (Number(walletAgg._sum?.balance) || 0));
    }

    const bankAccounts = await tx.bankAccount.findMany({
      where: { companyId, branchId: scope, isActive: true },
      select: {
        openingBalance: true,
        statements: {
          orderBy: [{ periodEnd: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          select: { closingBalance: true },
        },
      },
    });
    let bankStatementBacked = 0;
    let bankOpeningOnly = 0;
    for (const a of bankAccounts as any[]) {
      if (a.statements && a.statements.length > 0) {
        bankStatementBacked = round2(bankStatementBacked + (Number(a.statements[0].closingBalance) || 0));
      } else {
        bankOpeningOnly = round2(bankOpeningOnly + (Number(a.openingBalance) || 0));
      }
    }
    const bank = round2(bankStatementBacked + bankOpeningOnly);

    const build = buildOpeningPosting({
      inventoryValue: inventory,
      receivables,
      bankValue: bank,
      bankMemo: `Opening — bank/cash (${bankStatementBacked} statement-backed, ${bankOpeningOnly} opening-only)`,
      supplierAdvances,
      payables,
      advances,
      advancesMemo: 'Opening — customer advances (negative khata) + wallet balances',
      giftCardLiability,
    });
    const plugLine = build.lines.find((l) => l.code === ACCOUNT_CODES.OWNERS_EQUITY);
    const plug = plugLine ? round2(plugLine.credit - plugLine.debit) : 0;

    if (build.lines.length === 0) {
      // Zero-value scope: still write the entry marker (no lines) so
      // the routine stays idempotent and the opening-posted flag
      // reflects that cutover ran for this scope. createMany +
      // skipDuplicates: a concurrent run's marker wins silently and
      // the loser re-reads it (recon F1/F10).
      await (tx as any).journalEntry.createMany({
        data: [
          {
            companyId,
            branchId: scope,
            memo: 'Opening balances — zero opening position at cutover (no inventory, receivables, payables, bank or liabilities)',
            sourceType: 'OPENING',
            sourceId,
            status: 'POSTED',
            isOpening: true,
            isReversal: false,
            createdBy: createdBy || null,
          },
        ],
        skipDuplicates: true,
      });
      const entry = await (tx as any).journalEntry.findFirst({
        where: { sourceType: 'OPENING', sourceId, isReversal: false },
        select: { id: true },
      });
      results.push({
        branchId: scope,
        status: 'created-zero',
        entryId: entry?.id || null,
        totals: { inventory, receivables, bank, supplierAdvances, payables, advances, giftCardLiability, plug: 0 },
      });
      continue;
    }
    const entryId = await postJournalEntry(tx, {
      companyId,
      branchId: scope,
      sourceType: 'OPENING',
      sourceId,
      memo: 'Opening balances derived from live operational data at cutover (no historical backfill)',
      isOpening: true,
      createdBy,
      lines: build.lines,
      accounts,
    });
    results.push({
      branchId: scope,
      status: 'created',
      entryId,
      totals: { inventory, receivables, bank, supplierAdvances, payables, advances, giftCardLiability, plug },
    });
  }
  return results;
}

// ─── Report reads (never mutate) ─────────────────────────────────────

export interface LedgerReportData {
  accounts: LedgerAccountRow[];
  lines: Array<{ accountId: string; debit: number; credit: number }>;
  openingPosted: boolean;
}

async function readLedgerData(tx: Tx, companyId: string, branchId: string | null, asOf: Date): Promise<LedgerReportData> {
  const accounts = await (tx as any).chartOfAccount.findMany({
    where: { companyId, branchId: null },
    select: { id: true, code: true, name: true, type: true, subtype: true },
    orderBy: { code: 'asc' },
  });
  const lines = await (tx as any).journalLine.findMany({
    where: {
      entry: {
        companyId,
        status: 'POSTED',
        entryDate: { lte: asOf },
        ...(branchId ? { branchId } : {}),
      },
    },
    select: { accountId: true, debit: true, credit: true },
  });
  // Opening-complete semantics (recon F7): verify ONE opening entry
  // per EXPECTED sourceId, scoped to the as-of date — counting
  // entries lets a duplicate for one scope mask a missing scope, and
  // ignores entries deleted-branch scopes. A TB as-of before cutover
  // correctly reports openingPosted: false.
  let openingPosted: boolean;
  if (branchId) {
    const found = await (tx as any).journalEntry.findFirst({
      where: {
        companyId,
        isOpening: true,
        sourceId: openingSourceId(companyId, branchId),
        entryDate: { lte: asOf },
      },
      select: { id: true },
    });
    openingPosted = Boolean(found);
  } else {
    const branches = await tx.branch.findMany({ where: { companyId }, select: { id: true } });
    const expected = [...(branches as any[]).map((b) => openingSourceId(companyId, b.id)), openingSourceId(companyId, null)];
    const found = await (tx as any).journalEntry.findMany({
      where: { companyId, isOpening: true, sourceId: { in: expected }, entryDate: { lte: asOf } },
      select: { sourceId: true },
    });
    const foundSet = new Set((found as any[]).map((f) => f.sourceId));
    openingPosted = expected.every((s) => foundSet.has(s));
  }
  return {
    accounts: accounts as LedgerAccountRow[],
    lines: (lines as any[]).map((l) => ({
      accountId: l.accountId,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
    })),
    openingPosted,
  };
}

export async function getTrialBalance(
  tx: Tx,
  companyId: string,
  branchId: string | null,
  asOf: Date,
): Promise<TrialBalanceResult & { openingPosted: boolean }> {
  const data = await readLedgerData(tx, companyId, branchId, asOf);
  return { ...buildTrialBalance(data.accounts, data.lines), openingPosted: data.openingPosted };
}

export async function getBalanceSheet(
  tx: Tx,
  companyId: string,
  branchId: string | null,
  asOf: Date,
): Promise<BalanceSheetResult & { openingPosted: boolean }> {
  const data = await readLedgerData(tx, companyId, branchId, asOf);
  return { ...buildBalanceSheet(data.accounts, data.lines), openingPosted: data.openingPosted };
}

export async function getLedgerExceptions(
  tx: Tx,
  companyId: string,
  branchId: string | null,
): Promise<{ unresolvedCount: number; recent: any[] }> {
  const where: any = { companyId, resolvedAt: null, ...(branchId ? { branchId } : {}) };
  const [unresolvedCount, recent] = await Promise.all([
    (tx as any).ledgerException.count({ where }),
    (tx as any).ledgerException.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, branchId: true, sourceType: true, sourceId: true, reason: true, detail: true, createdAt: true },
    }),
  ]);
  return { unresolvedCount, recent };
}
