// Accounting-lite engine (Wave B8).
//
// This is NOT a double-entry ledger and posts nothing: every figure is
// computed on read from rows that already exist (sales, sale items,
// refunds, expenses, purchases, khata ledger entries, sale payments).
// The functions here are pure so the math can be verified on fixtures
// (scripts/accounting-selfcheck.ts); the controller only fetches rows
// and resolves names.
//
// DEFINITIONS (kept in lockstep with the house reports — the dashboard
// profit fix in report.controller.ts, E2E P4-6, is the reference):
//   · Revenue (gross)  = Σ Sale.totalAmount for sales in the period
//     with status != 'REFUNDED' (the exclusion every report uses).
//   · Refunds          = Σ Refund.refundAmount for refunds CREATED in
//     the period whose original sale belongs to the tenant (any sale
//     status/date — a refund is money out of the period it happened in,
//     exactly how the dashboard nets its revenue).
//   · Net revenue      = gross revenue − refunds.
//   · COGS (gross)     = Σ over the in-scope sale items of
//     batch.purchasePrice × quantity — the real batch-cost basis, NOT
//     purchases and NOT a margin guess. Items whose sale line has no
//     batch (batchId null — pre-batch/legacy lines) have no knowable
//     cost: they contribute 0 AND are counted in unknownCostLines /
//     unknownCostUnits so the gap is visible instead of silent.
//   · COGS reversal    = for refunds in the period, Σ original batch
//     cost × refunded quantity, the original cost resolved per product
//     from the original sale's items (the dashboard's method). Refund
//     items whose product is not on the original sale, or whose
//     original line has no batch, are counted as unknown refund cost.
//   · Net COGS         = COGS gross − COGS reversal.
//   · Gross profit     = net revenue − net COGS.
//   · Expenses         = Σ Expense.amount with expenseDate in the
//     period, all statuses — the same basis as the advanced expense
//     report (an expense is a cost when incurred, whatever its
//     approval state in this codebase's usage).
//   · Net profit       = gross profit − expenses.
//
// Money is Float throughout the schema; statement outputs are rounded
// to cents here so a printed P&L never shows 0.30000000000000004.

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

// ─── COGS ────────────────────────────────────────────────────────────

export interface CogsLineInput {
  quantity: number;
  /** Batch purchase price per unit, or null when the line has no batch. */
  batchPurchasePrice: number | null;
}

export interface CogsSummary {
  /** Σ batchPurchasePrice × quantity over lines with a known cost. */
  cogs: number;
  knownLines: number;
  /** Lines with no batch → cost unknowable (contribute 0, but counted). */
  unknownCostLines: number;
  unknownCostUnits: number;
}

export function summarizeCogs(lines: CogsLineInput[]): CogsSummary {
  let cogs = 0;
  let knownLines = 0;
  let unknownCostLines = 0;
  let unknownCostUnits = 0;
  for (const line of lines) {
    const qty = Number(line.quantity || 0);
    if (line.batchPurchasePrice === null || line.batchPurchasePrice === undefined) {
      unknownCostLines += 1;
      unknownCostUnits += qty;
    } else {
      knownLines += 1;
      cogs += Number(line.batchPurchasePrice) * qty;
    }
  }
  return { cogs: round2(cogs), knownLines, unknownCostLines, unknownCostUnits };
}

// ─── P&L ─────────────────────────────────────────────────────────────

export interface PnlInputs {
  grossRevenue: number;
  refundsTotal: number;
  cogsGross: number;
  cogsReversal: number;
  expensesTotal: number;
}

export interface PnlStatement {
  revenue: { gross: number; refunds: number; net: number };
  cogs: { gross: number; refundReversal: number; net: number };
  grossProfit: number;
  expenses: number;
  netProfit: number;
}

export function computePnl(i: PnlInputs): PnlStatement {
  const revenueNet = round2(i.grossRevenue - i.refundsTotal);
  const cogsNet = round2(i.cogsGross - i.cogsReversal);
  const grossProfit = round2(revenueNet - cogsNet);
  return {
    revenue: { gross: round2(i.grossRevenue), refunds: round2(i.refundsTotal), net: revenueNet },
    cogs: { gross: round2(i.cogsGross), refundReversal: round2(i.cogsReversal), net: cogsNet },
    grossProfit,
    expenses: round2(i.expensesTotal),
    netProfit: round2(grossProfit - i.expensesTotal),
  };
}

// ─── Receivables ageing (FIFO over the khata ledger) ────────────────

export interface LedgerEntryInput {
  /** Signed: + increases what the customer owes, − settles it. */
  amount: number;
  createdAt: Date | string;
}

export interface AgeingBuckets {
  /** Open due whose originating entry is 0–30 days old. */
  days0to30: number;
  days31to60: number;
  days61to90: number;
  /** Open due older than 90 days. */
  over90: number;
}

export interface AgeingResult {
  /** Σ of all signed entries (what the customer owes; < 0 = advance). */
  balance: number;
  /** Still-open due after FIFO settlement (= Σ buckets). */
  openDue: number;
  /** Overpayment held as store credit (settlements beyond open dues). */
  advance: number;
  buckets: AgeingBuckets;
}

/**
 * FIFO ageing of one customer's khata ledger.
 *
 * Entries are consumed oldest → newest (the caller passes them in
 * createdAt order; they are re-sorted defensively on a copy):
 *   · a POSITIVE entry (SALE_DUE, positive ADJUSTMENT) first absorbs
 *     any outstanding advance, then opens a due tranche dated at the
 *     entry;
 *   · a NEGATIVE entry (PAYMENT, REFUND, negative ADJUSTMENT) settles
 *     the OLDEST open tranche first; any excess becomes advance.
 * Invariant: openDue − advance === balance. The age of an open tranche
 * is measured from its originating entry's date to `asOf`.
 */
export function ageLedgerEntries(entries: LedgerEntryInput[], asOf: Date): AgeingResult {
  const sorted = [...entries].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
  const tranches: Array<{ date: Date; remaining: number }> = [];
  let credit = 0;
  let balance = 0;

  for (const entry of sorted) {
    const amount = Number(entry.amount || 0);
    if (amount === 0) continue;
    balance += amount;
    if (amount > 0) {
      let rest = amount;
      const absorbed = Math.min(credit, rest);
      credit -= absorbed;
      rest -= absorbed;
      if (rest > 0) tranches.push({ date: new Date(entry.createdAt), remaining: rest });
    } else {
      let settle = -amount;
      while (settle > 0 && tranches.length > 0) {
        const head = tranches[0];
        const take = Math.min(head.remaining, settle);
        head.remaining -= take;
        settle -= take;
        if (head.remaining <= 0.000001) tranches.shift();
      }
      if (settle > 0) credit += settle;
    }
  }

  const buckets: AgeingBuckets = { days0to30: 0, days31to60: 0, days61to90: 0, over90: 0 };
  let openDue = 0;
  for (const t of tranches) {
    openDue += t.remaining;
    const ageDays = Math.floor((asOf.getTime() - t.date.getTime()) / 86400000);
    if (ageDays <= 30) buckets.days0to30 += t.remaining;
    else if (ageDays <= 60) buckets.days31to60 += t.remaining;
    else if (ageDays <= 90) buckets.days61to90 += t.remaining;
    else buckets.over90 += t.remaining;
  }

  return {
    balance: round2(balance),
    openDue: round2(openDue),
    advance: round2(credit),
    buckets: {
      days0to30: round2(buckets.days0to30),
      days31to60: round2(buckets.days31to60),
      days61to90: round2(buckets.days61to90),
      over90: round2(buckets.over90),
    },
  };
}

// ─── Cashbook tender merge ───────────────────────────────────────────

export interface TenderRow {
  method: string;
  amount: number;
  count: number;
}

/** Merge tender rows from several sources by method (amounts summed). */
export function mergeTenderRows(...lists: TenderRow[][]): TenderRow[] {
  const byMethod = new Map<string, TenderRow>();
  for (const list of lists) {
    for (const row of list) {
      const method = row.method || 'UNSPECIFIED';
      const existing = byMethod.get(method);
      if (existing) {
        existing.amount = round2(existing.amount + Number(row.amount || 0));
        existing.count += Number(row.count || 0);
      } else {
        byMethod.set(method, { method, amount: round2(Number(row.amount || 0)), count: Number(row.count || 0) });
      }
    }
  }
  return [...byMethod.values()].sort((a, b) => b.amount - a.amount);
}

export const sumTenderRows = (rows: TenderRow[]): number =>
  round2(rows.reduce((sum, r) => sum + r.amount, 0));

// ─── P&L comparison (Item 8: deeper P&L) ─────────────────────────────

export interface PnlDelta {
  current: number;
  previous: number;
  /** Current − previous, in PKR. */
  change: number;
  /** Percent change vs previous; null when previous is 0 (no basis). */
  pctChange: number | null;
}

export interface PnlComparison {
  revenue: { gross: PnlDelta; refunds: PnlDelta; net: PnlDelta };
  cogs: { gross: PnlDelta; refundReversal: PnlDelta; net: PnlDelta };
  grossProfit: PnlDelta;
  expenses: PnlDelta;
  netProfit: PnlDelta;
}

function delta(current: number, previous: number): PnlDelta {
  const change = round2(current - previous);
  const pctChange =
    previous === 0 ? null : round2((change / Math.abs(previous)) * 100);
  return { current: round2(current), previous: round2(previous), change, pctChange };
}

/**
 * Period-over-period P&L comparison. Both statements must be built
 * with the same definitions (computePnl) over equal-length periods;
 * the caller (controller) resolves the previous period. A zero
 * previous value yields pctChange null rather than an invented
 * infinite percent.
 */
export function comparePnl(current: PnlStatement, previous: PnlStatement): PnlComparison {
  return {
    revenue: {
      gross: delta(current.revenue.gross, previous.revenue.gross),
      refunds: delta(current.revenue.refunds, previous.revenue.refunds),
      net: delta(current.revenue.net, previous.revenue.net),
    },
    cogs: {
      gross: delta(current.cogs.gross, previous.cogs.gross),
      refundReversal: delta(current.cogs.refundReversal, previous.cogs.refundReversal),
      net: delta(current.cogs.net, previous.cogs.net),
    },
    grossProfit: delta(current.grossProfit, previous.grossProfit),
    expenses: delta(current.expenses, previous.expenses),
    netProfit: delta(current.netProfit, previous.netProfit),
  };
}

// ─── Financial position (v1.0.22 — derived, NOT a double-entry GL) ───
// Zapeera has no chart of accounts and no debit/credit postings, so a
// true trial balance / balance sheet cannot be built from real data.
// What CAN be built honestly is a position summary whose every line
// traces to an operational aggregate (batches, khata ledger,
// purchases, gift-card/wallet ledgers, bank statements, cumulative
// P&L). The summary NEVER plugs equity: the unreconciled difference
// (assets − liabilities − system-era retained profit) is shown
// explicitly, with the list of untracked areas, so the reader sees
// exactly what is missing instead of a forced balance. The
// trial-balance presentation below lists the same derived accounts
// debit/credit-style over ALL history (cumulative flows + as-of
// stocks); its difference equals the unreconciled difference by
// construction, and it is labelled as derived everywhere it renders.

export interface PositionInputs {
  /** Σ active Batch.quantity × Batch.purchasePrice. */
  inventoryAtCost: number;
  /** Σ positive per-customer khata balances. */
  receivables: number;
  /** Σ latest statement closing balances (accounts with a statement). */
  bankStatementBacked: number;
  /** Σ opening balances (accounts with NO statement on file). */
  bankOpeningOnly: number;
  /** Σ Purchase.outstanding (> 0, not CANCELLED). */
  payables: number;
  /** Σ |negative per-customer khata balances| (store credit owed). */
  customerAdvances: number;
  /** Σ ACTIVE GiftCard.balance. */
  giftCardLiability: number;
  /** Σ CustomerWallet.balance. */
  walletLiability: number;
  /** Cumulative P&L over all history (same definitions as computePnl). */
  cumulative: PnlStatement;
}

export interface PositionLine {
  label: string;
  amount: number;
  /** Where the figure comes from, in plain words. */
  source: string;
}

export interface TrialBalanceRow {
  account: string;
  debit: number;
  credit: number;
  source: string;
}

export interface PositionSummary {
  assets: { lines: PositionLine[]; total: number };
  liabilities: { lines: PositionLine[]; total: number };
  /** System-era retained profit = cumulative net profit. Excludes all pre-system history. */
  retainedProfit: number;
  /** Assets − liabilities − retained profit. Shown, never plugged. */
  unreconciledDifference: number;
  trialBalance: { rows: TrialBalanceRow[]; totalDebits: number; totalCredits: number; difference: number };
  /** Areas Zapeera does not track — the reason the books do not balance. */
  gaps: string[];
}

export const POSITION_GAPS: string[] = [
  'Cash on hand is not tracked (no cash account or opening cash) — excluded.',
  'Owner capital, contributions and drawings are not recorded — no equity accounts exist.',
  'Fixed assets, depreciation and loans/borrowings are not recorded.',
  'Tax collected is known, but tax payments/remittances are not recorded — no tax payable is stated.',
  'No opening balances except bank accounts — supplier/customer history starts at go-live.',
  'Inventory and bank figures are as-of now only; past dates cannot be reconstructed.',
];

export function buildPositionSummary(i: PositionInputs): PositionSummary {
  const assetLines: PositionLine[] = [
    { label: 'Inventory at cost', amount: round2(i.inventoryAtCost), source: 'Active batches × purchase price' },
    { label: 'Trade receivables (khata dues)', amount: round2(i.receivables), source: 'Customer ledger balances owed' },
    { label: 'Bank balances (per latest statement)', amount: round2(i.bankStatementBacked), source: 'Latest statement closing balance per account' },
    { label: 'Bank balances (opening balance only, no statement)', amount: round2(i.bankOpeningOnly), source: 'Bank account opening balance — unconfirmed by a statement' },
  ];
  const liabilityLines: PositionLine[] = [
    { label: 'Trade payables (supplier outstanding)', amount: round2(i.payables), source: 'Unpaid purchase balances' },
    { label: 'Customer advances (store credit owed)', amount: round2(i.customerAdvances), source: 'Customer ledger overpayments' },
    { label: 'Outstanding gift cards', amount: round2(i.giftCardLiability), source: 'Active gift-card balances' },
    { label: 'Customer wallet balances', amount: round2(i.walletLiability), source: 'Stored-value wallet balances' },
  ];
  const totalAssets = round2(assetLines.reduce((s, l) => s + l.amount, 0));
  const totalLiabilities = round2(liabilityLines.reduce((s, l) => s + l.amount, 0));
  const retainedProfit = round2(i.cumulative.netProfit);
  const unreconciledDifference = round2(totalAssets - totalLiabilities - retainedProfit);

  const rows: TrialBalanceRow[] = [
    { account: 'Inventory at cost', debit: round2(i.inventoryAtCost), credit: 0, source: 'Active batches × purchase price' },
    { account: 'Trade receivables', debit: round2(i.receivables), credit: 0, source: 'Customer ledger balances owed' },
    { account: 'Bank balances', debit: round2(i.bankStatementBacked + i.bankOpeningOnly), credit: 0, source: 'Statements + opening balances' },
    { account: 'Cost of goods sold (all history)', debit: round2(i.cumulative.cogs.net), credit: 0, source: 'Batch-cost COGS, net of refund reversals' },
    { account: 'Expenses (all history)', debit: round2(i.cumulative.expenses), credit: 0, source: 'Recorded expenses' },
    { account: 'Trade payables', debit: 0, credit: round2(i.payables), source: 'Unpaid purchase balances' },
    { account: 'Customer advances', debit: 0, credit: round2(i.customerAdvances), source: 'Customer ledger overpayments' },
    { account: 'Gift-card liability', debit: 0, credit: round2(i.giftCardLiability), source: 'Active gift-card balances' },
    { account: 'Wallet liability', debit: 0, credit: round2(i.walletLiability), source: 'Stored-value wallet balances' },
    { account: 'Net revenue (all history)', debit: 0, credit: round2(i.cumulative.revenue.net), source: 'Sales net of refunds' },
  ];
  const totalDebits = round2(rows.reduce((s, r) => s + r.debit, 0));
  const totalCredits = round2(rows.reduce((s, r) => s + r.credit, 0));
  return {
    assets: { lines: assetLines, total: totalAssets },
    liabilities: { lines: liabilityLines, total: totalLiabilities },
    retainedProfit,
    unreconciledDifference,
    trialBalance: { rows, totalDebits, totalCredits, difference: round2(totalDebits - totalCredits) },
    gaps: [...POSITION_GAPS],
  };
}
