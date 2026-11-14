/**
 * Double-entry ledger — pure posting + report math (v1.0.22).
 *
 * Everything in this file is pure: builders take plain numbers and
 * return draft journal lines, so the math is verifiable on fixtures
 * without a database (tests/v1022-ledger.test.ts). The service layer
 * (src/services/ledger.service.ts) resolves account codes to ids,
 * reads the operational rows, and writes inside the caller's
 * transaction.
 *
 * BALANCE RULE: every entry must satisfy Σ debits == Σ credits after
 * rounding to 2 decimals. Builders run through `balanceDraft`, which
 * assigns a cent-residue of ≤ 0.01 to the largest line of the short
 * side (same residue convention as the tax engine in tax.util.ts)
 * and THROWS LedgerUnbalancedError for anything larger. The service
 * never writes an unbalanced entry; a failed posting is recorded as a
 * LedgerException and the source operation still commits.
 *
 * NOTHING HERE INVENTS A NUMBER: where a leg cannot be constructed
 * (unknown batch cost, inconsistent tender figures) the builder
 * either throws (service → exception record) or returns the gap in
 * `exceptions` for the service to record alongside a partial-but-
 * balanced entry. Partial entries are always balanced on their own.
 */

import { round2 } from './accounting.util';

// ─── System chart ────────────────────────────────────────────────────

export type LedgerAccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';

export interface SystemAccountDef {
  code: string;
  name: string;
  type: LedgerAccountType;
  subtype?: string;
}

/**
 * The 15 system accounts created lazily per business (branchId null —
 * the chart is business-wide; journal entries carry the branch).
 * No Retained Earnings account: the balance sheet computes retained
 * profit from income − expense journals directly, so it can never
 * drift from the journals.
 */
export const SYSTEM_CHART: SystemAccountDef[] = [
  { code: '1000', name: 'Cash', type: 'ASSET', subtype: 'CURRENT' },
  { code: '1010', name: 'Bank', type: 'ASSET', subtype: 'CURRENT' },
  { code: '1100', name: 'Accounts Receivable', type: 'ASSET', subtype: 'CURRENT' },
  { code: '1200', name: 'Inventory', type: 'ASSET', subtype: 'CURRENT' },
  { code: '2000', name: 'Accounts Payable', type: 'LIABILITY', subtype: 'CURRENT' },
  { code: '2100', name: 'Tax Payable', type: 'LIABILITY', subtype: 'CURRENT' },
  { code: '2200', name: 'Gift Card Liability', type: 'LIABILITY', subtype: 'CURRENT' },
  { code: '2210', name: 'Customer Advances', type: 'LIABILITY', subtype: 'CURRENT' },
  { code: '3000', name: "Owner's Equity (opening)", type: 'EQUITY', subtype: 'OPENING' },
  { code: '4000', name: 'Sales Income', type: 'INCOME', subtype: 'REVENUE' },
  { code: '4010', name: 'Sales Returns', type: 'INCOME', subtype: 'CONTRA_REVENUE' },
  { code: '4100', name: 'Service Charge Income', type: 'INCOME', subtype: 'REVENUE' },
  { code: '5000', name: 'Cost of Goods Sold', type: 'EXPENSE', subtype: 'COGS' },
  { code: '5100', name: 'Wastage Loss', type: 'EXPENSE', subtype: 'SHRINKAGE' },
  { code: '6000', name: 'Operating Expenses', type: 'EXPENSE', subtype: 'OPERATING' },
];

export const ACCOUNT_CODES = {
  CASH: '1000',
  BANK: '1010',
  RECEIVABLES: '1100',
  INVENTORY: '1200',
  PAYABLES: '2000',
  TAX_PAYABLE: '2100',
  GIFT_CARD_LIABILITY: '2200',
  CUSTOMER_ADVANCES: '2210',
  OWNERS_EQUITY: '3000',
  SALES_INCOME: '4000',
  SALES_RETURNS: '4010',
  SERVICE_CHARGE_INCOME: '4100',
  COGS: '5000',
  WASTAGE_LOSS: '5100',
  OPERATING_EXPENSES: '6000',
} as const;

/** Tender method → debit-side balance-sheet account for money received. */
export function tenderAccountCode(method: string | null | undefined): string {
  const m = String(method || '').toUpperCase();
  if (m === 'CASH') return ACCOUNT_CODES.CASH;
  if (m === 'GIFT_CARD') return ACCOUNT_CODES.GIFT_CARD_LIABILITY;
  if (m === 'EWALLET') return ACCOUNT_CODES.CUSTOMER_ADVANCES;
  // CARD, JAZZCASH, EASYPAISA, BANK_TRANSFER, MOBILE — and anything
  // unrecognised — settle through the bank account.
  return ACCOUNT_CODES.BANK;
}

/** Tender method → credit-side account when money is paid OUT (refunds). */
export function refundAccountCode(method: string | null | undefined): string {
  return tenderAccountCode(method);
}

// ─── Draft lines + balance validation ────────────────────────────────

export interface DraftLine {
  code: string;
  debit: number;
  credit: number;
  memo?: string;
}

export class LedgerUnbalancedError extends Error {
  readonly debits: number;
  readonly credits: number;
  constructor(context: string, debits: number, credits: number) {
    super(`Unbalanced journal (${context}): debits ${debits} != credits ${credits}`);
    this.name = 'LedgerUnbalancedError';
    this.debits = debits;
    this.credits = credits;
  }
}

const sumSide = (lines: DraftLine[], side: 'debit' | 'credit'): number =>
  round2(lines.reduce((acc, l) => acc + (l[side] || 0), 0));

/**
 * Validate + cent-residue-fix a draft. Drops zero lines, rejects
 * lines with both sides or a negative side, and assigns a residue of
 * ≤ 0.01 to the largest line of the short side. Throws
 * LedgerUnbalancedError for anything larger, or when the short side
 * has no line to absorb the residue.
 */
export function balanceDraft(lines: DraftLine[], context: string): DraftLine[] {
  const clean = lines
    .map((l) => ({ ...l, debit: round2(l.debit || 0), credit: round2(l.credit || 0) }))
    .filter((l) => l.debit !== 0 || l.credit !== 0);
  for (const l of clean) {
    if (l.debit < 0 || l.credit < 0) {
      throw new LedgerUnbalancedError(`${context}: negative leg on ${l.code}`, sumSide(clean, 'debit'), sumSide(clean, 'credit'));
    }
    if (l.debit > 0 && l.credit > 0) {
      throw new LedgerUnbalancedError(`${context}: both sides on ${l.code}`, sumSide(clean, 'debit'), sumSide(clean, 'credit'));
    }
  }
  const debits = sumSide(clean, 'debit');
  const credits = sumSide(clean, 'credit');
  const diff = round2(debits - credits);
  if (diff === 0) return clean;
  if (Math.abs(diff) > 0.01) throw new LedgerUnbalancedError(context, debits, credits);
  // Residue ≤ 1 cent: largest line of the short side absorbs it.
  const side: 'debit' | 'credit' = diff > 0 ? 'credit' : 'debit';
  let target: DraftLine | null = null;
  for (const l of clean) {
    if (l[side] > 0 && (!target || l[side] > target[side])) target = l;
  }
  if (!target) throw new LedgerUnbalancedError(`${context}: no ${side} line to absorb residue`, debits, credits);
  target[side] = round2(target[side] + Math.abs(diff));
  return clean;
}

export interface PostingBuild {
  lines: DraftLine[];
  /** Human-readable gaps the service must record as LedgerExceptions. */
  exceptions: string[];
}

const dr = (code: string, amount: number, memo?: string): DraftLine => ({ code, debit: round2(amount), credit: 0, memo });
const cr = (code: string, amount: number, memo?: string): DraftLine => ({ code, debit: 0, credit: round2(amount), memo });
const positive = (n: number): boolean => round2(n) > 0;

// ─── Sale ────────────────────────────────────────────────────────────

export interface SalePostingInput {
  subtotal: number;
  discountAmount: number;
  promotionDiscount: number;
  loyaltyDiscount: number;
  taxAmount: number;
  provincialTaxAmount: number;
  serviceChargeAmount: number;
  totalAmount: number;
  paidAmount: number;
  returnedAmount: number;
  paymentMethod: string | null;
  giftCardAmount: number;
  walletAmount: number;
  /** SalePayment rows, when present. Trusted only if Σ ≈ paidAmount. */
  allocations: Array<{ method: string; amount: number }>;
  /** COGS leg, computed by the service from allocation batches. */
  cogs: { knownCost: number; unknownLines: number };
  invoiceNumber?: string;
}

/**
 * Sale posting. Revenue base = subtotal − all discounts (the same
 * taxable base the tax engine uses); tax + service charge credited
 * separately; tender debited by method; the unpaid remainder debited
 * to Receivables; overpayment credited to Customer Advances. FOLIO
 * sales (paidAmount 0) post as pure credit sales. COGS is an
 * independent balanced pair, so an unknown-cost sale still posts its
 * revenue legs and records the COGS gap as an exception.
 */
export function buildSalePosting(input: SalePostingInput): PostingBuild {
  const exceptions: string[] = [];
  const revenueBase = round2(
    input.subtotal - input.discountAmount - input.promotionDiscount - input.loyaltyDiscount,
  );
  if (revenueBase < 0) {
    throw new LedgerUnbalancedError(
      `sale ${input.invoiceNumber || ''}: discounts exceed subtotal (revenue base ${revenueBase})`,
      0, 0,
    );
  }
  const taxTotal = round2(input.taxAmount + input.provincialTaxAmount);
  const serviceCharge = round2(input.serviceChargeAmount);
  const netPaid = round2(input.paidAmount - input.returnedAmount);
  if (netPaid < 0) {
    throw new LedgerUnbalancedError(
      `sale ${input.invoiceNumber || ''}: change exceeds amount paid (net paid ${netPaid})`,
      0, 0,
    );
  }
  let receivable = round2(input.totalAmount - netPaid);
  let advance = 0;
  if (receivable < 0) {
    // Overpaid beyond change: the excess is a customer advance.
    advance = round2(-receivable);
    receivable = 0;
  }

  const lines: DraftLine[] = [];
  const tenderByAccount = new Map<string, number>();
  const addTender = (code: string, amount: number) => {
    const v = round2(amount);
    if (v > 0) tenderByAccount.set(code, round2((tenderByAccount.get(code) || 0) + v));
  };

  const allocTotal = round2(input.allocations.reduce((a, p) => a + (p.amount || 0), 0));
  const allocationsTrusted =
    input.allocations.length > 0 && Math.abs(allocTotal - round2(input.paidAmount)) <= 0.01;
  if (allocationsTrusted) {
    // Change comes out of cash first, then bank — change is only ever
    // handed over in cash at the till, so a non-cash shortfall means
    // inconsistent source figures.
    let changeLeft = round2(input.returnedAmount);
    const cashAlloc = round2(
      input.allocations.filter((p) => String(p.method).toUpperCase() === 'CASH').reduce((a, p) => a + p.amount, 0),
    );
    const cashAfterChange = Math.max(0, round2(cashAlloc - changeLeft));
    changeLeft = round2(changeLeft - (cashAlloc - cashAfterChange));
    addTender(ACCOUNT_CODES.CASH, cashAfterChange);
    for (const p of input.allocations) {
      if (String(p.method).toUpperCase() === 'CASH') continue;
      let amount = round2(p.amount);
      if (changeLeft > 0 && tenderAccountCode(p.method) === ACCOUNT_CODES.BANK) {
        const taken = Math.min(amount, changeLeft);
        amount = round2(amount - taken);
        changeLeft = round2(changeLeft - taken);
      }
      addTender(tenderAccountCode(p.method), amount);
    }
    if (changeLeft > 0) {
      throw new LedgerUnbalancedError(
        `sale ${input.invoiceNumber || ''}: change ${input.returnedAmount} exceeds cash/bank tender`,
        0, 0,
      );
    }
  } else {
    if (input.allocations.length > 0) {
      exceptions.push(
        `SalePayment allocations total ${allocTotal} but paidAmount is ${input.paidAmount}; headline-method split used instead.`,
      );
    }
    // Headline-method split: gift/wallet legs from their fields, the
    // remainder by the headline method.
    addTender(ACCOUNT_CODES.GIFT_CARD_LIABILITY, input.giftCardAmount);
    addTender(ACCOUNT_CODES.CUSTOMER_ADVANCES, input.walletAmount);
    const remainder = round2(netPaid - input.giftCardAmount - input.walletAmount);
    if (remainder < 0) {
      throw new LedgerUnbalancedError(
        `sale ${input.invoiceNumber || ''}: gift/wallet amounts exceed net paid`,
        0, 0,
      );
    }
    if (remainder > 0) {
      const method = String(input.paymentMethod || '').toUpperCase();
      if (!input.paymentMethod) {
        exceptions.push('Sale has no payment method; remainder posted to Cash.');
      } else if (method === 'MIXED') {
        exceptions.push('Mixed-tender sale without allocation rows; remainder posted to Cash.');
      }
      addTender(tenderAccountCode(input.paymentMethod), remainder);
    }
  }

  for (const [code, amount] of [...tenderByAccount.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(dr(code, amount, input.invoiceNumber ? `Sale ${input.invoiceNumber}` : 'Sale'));
  }
  if (positive(receivable)) lines.push(dr(ACCOUNT_CODES.RECEIVABLES, receivable, 'Unpaid sale balance (khata)'));
  if (positive(revenueBase)) lines.push(cr(ACCOUNT_CODES.SALES_INCOME, revenueBase));
  if (positive(taxTotal)) lines.push(cr(ACCOUNT_CODES.TAX_PAYABLE, taxTotal, 'Sales tax + provincial tax'));
  if (positive(serviceCharge)) lines.push(cr(ACCOUNT_CODES.SERVICE_CHARGE_INCOME, serviceCharge));
  if (positive(advance)) lines.push(cr(ACCOUNT_CODES.CUSTOMER_ADVANCES, advance, 'Overpayment held as advance'));

  if (positive(input.cogs.knownCost)) {
    lines.push(dr(ACCOUNT_CODES.COGS, input.cogs.knownCost, 'Cost of goods sold at batch cost'));
    lines.push(cr(ACCOUNT_CODES.INVENTORY, input.cogs.knownCost, 'Cost of goods sold at batch cost'));
  }
  if (input.cogs.unknownLines > 0) {
    exceptions.push(
      `${input.cogs.unknownLines} sale line(s) have no known batch cost; COGS leg covers known-cost lines only.`,
    );
  }

  return { lines: balanceDraft(lines, `sale ${input.invoiceNumber || ''}`), exceptions };
}

// ─── Refund ──────────────────────────────────────────────────────────

export interface RefundPostingInput {
  refundAmount: number;
  refundMethod: string | null;
  saleTotalAmount: number;
  saleTaxAmount: number;
  saleProvincialTaxAmount: number;
  salePaidAmount: number;
  /** Σ refunds already recorded against this sale, excluding this one. */
  priorRefundTotal: number;
  cogsReversal: { knownCost: number; unknownLines: number };
  invoiceNumber?: string;
}

/**
 * Refund posting. The refund first reduces any outstanding khata due
 * on the original sale; the rest is money out by refund method. The
 * tax portion is PRO-RATA (refund ÷ sale total × sale tax) — the
 * refund flow records no per-line tax, so the memo says so. COGS
 * reversal restocks inventory value at the same batch-cost basis.
 */
export function buildRefundPosting(input: RefundPostingInput): PostingBuild {
  const exceptions: string[] = [];
  const refund = round2(input.refundAmount);
  if (refund <= 0) return { lines: [], exceptions };
  const saleTaxTotal = round2(input.saleTaxAmount + input.saleProvincialTaxAmount);
  const taxPortion =
    input.saleTotalAmount > 0
      ? Math.min(refund, round2((refund * saleTaxTotal) / input.saleTotalAmount))
      : 0;
  const outstandingDue = Math.max(
    0,
    round2(input.saleTotalAmount - input.salePaidAmount - input.priorRefundTotal),
  );
  const dueReduction = Math.min(refund, outstandingDue);
  const moneyOut = round2(refund - dueReduction);

  const lines: DraftLine[] = [];
  lines.push(dr(ACCOUNT_CODES.SALES_RETURNS, round2(refund - taxPortion), 'Refund — sales returns'));
  if (positive(taxPortion)) {
    lines.push(dr(ACCOUNT_CODES.TAX_PAYABLE, taxPortion, 'Refund — tax portion, pro-rata of sale tax'));
  }
  if (positive(dueReduction)) lines.push(cr(ACCOUNT_CODES.RECEIVABLES, dueReduction, 'Refund — reduces outstanding khata due'));
  if (positive(moneyOut)) {
    const code = refundAccountCode(input.refundMethod);
    const memo =
      input.refundMethod == null
        ? 'Refund — no method recorded, posted to Cash'
        : `Refund — ${input.refundMethod}`;
    lines.push(cr(code, moneyOut, memo));
  }
  if (positive(input.cogsReversal.knownCost)) {
    lines.push(dr(ACCOUNT_CODES.INVENTORY, input.cogsReversal.knownCost, 'Refund — inventory restocked at batch cost'));
    lines.push(cr(ACCOUNT_CODES.COGS, input.cogsReversal.knownCost, 'Refund — COGS reversal at batch cost'));
  }
  if (input.cogsReversal.unknownLines > 0) {
    exceptions.push(
      `${input.cogsReversal.unknownLines} refund line(s) have no known batch cost; COGS reversal covers known-cost lines only.`,
    );
  }
  return { lines: balanceDraft(lines, `refund ${input.invoiceNumber || ''}`), exceptions };
}

// ─── Purchase / expense / khata / gift card / wallet / wastage ──────

export interface PurchasePostingInput {
  totalAmount: number;
  paidAmount: number;
  invoiceNumber?: string;
}

/**
 * Purchase posting. Purchases record NO payment method, so the paid
 * leg is posted to Cash and the memo says so — never invent a method.
 */
export function buildPurchasePosting(input: PurchasePostingInput): PostingBuild {
  const total = round2(input.totalAmount);
  const paid = round2(input.paidAmount);
  const outstanding = round2(total - paid);
  if (total < 0 || paid < 0 || outstanding < 0) {
    throw new LedgerUnbalancedError(
      `purchase ${input.invoiceNumber || ''}: inconsistent figures (total ${total}, paid ${paid})`,
      0, 0,
    );
  }
  const lines: DraftLine[] = [];
  if (positive(total)) lines.push(dr(ACCOUNT_CODES.INVENTORY, total, 'Purchase — inventory at cost'));
  if (positive(paid)) lines.push(cr(ACCOUNT_CODES.CASH, paid, 'Purchase — payment method not recorded, posted to Cash'));
  if (positive(outstanding)) lines.push(cr(ACCOUNT_CODES.PAYABLES, outstanding, 'Purchase — unpaid balance'));
  return { lines: balanceDraft(lines, `purchase ${input.invoiceNumber || ''}`), exceptions: [] };
}

export interface ExpensePostingInput {
  amount: number;
  paymentMethod: string | null;
  categoryName?: string;
}

/** Expense posting: one operating-expense account (no per-category sub-accounts yet). */
export function buildExpensePosting(input: ExpensePostingInput): PostingBuild {
  const amount = round2(input.amount);
  if (amount <= 0) return { lines: [], exceptions: [] };
  const memo = `Expense${input.categoryName ? ` — ${input.categoryName}` : ''}${input.paymentMethod ? ` (${input.paymentMethod})` : ''}`;
  const lines = [
    dr(ACCOUNT_CODES.OPERATING_EXPENSES, amount, memo),
    cr(tenderAccountCode(input.paymentMethod), amount, memo),
  ];
  return { lines: balanceDraft(lines, 'expense'), exceptions: [] };
}

export interface KhataPaymentPostingInput {
  amount: number;
  method: string | null;
  /** Portion that overpays the khata balance (computed by the service). */
  advancePortion: number;
}

export function buildKhataPaymentPosting(input: KhataPaymentPostingInput): PostingBuild {
  const amount = round2(input.amount);
  if (amount <= 0) return { lines: [], exceptions: [] };
  const advance = Math.min(amount, Math.max(0, round2(input.advancePortion)));
  const settle = round2(amount - advance);
  const lines = [dr(tenderAccountCode(input.method), amount, 'Khata payment received')];
  if (positive(settle)) lines.push(cr(ACCOUNT_CODES.RECEIVABLES, settle, 'Khata payment — settles receivable'));
  if (positive(advance)) lines.push(cr(ACCOUNT_CODES.CUSTOMER_ADVANCES, advance, 'Khata payment — overpayment held as advance'));
  return { lines: balanceDraft(lines, 'khata payment'), exceptions: [] };
}

export interface GiftCardSalePostingInput {
  value: number;
  paymentMethod: string | null;
}

/** Gift-card sale: a LIABILITY (prepaid value owed), never revenue. */
export function buildGiftCardSalePosting(input: GiftCardSalePostingInput): PostingBuild {
  const value = round2(input.value);
  if (value <= 0) return { lines: [], exceptions: [] };
  const lines = [
    dr(tenderAccountCode(input.paymentMethod), value, 'Gift card sold — cash received'),
    cr(ACCOUNT_CODES.GIFT_CARD_LIABILITY, value, 'Gift card sold — prepaid value owed to holder'),
  ];
  return { lines: balanceDraft(lines, 'gift card sale'), exceptions: [] };
}

export interface WalletTopUpPostingInput {
  amount: number;
  method: string | null;
}

/** Wallet top-up: a LIABILITY (customer advance), never revenue. */
export function buildWalletTopUpPosting(input: WalletTopUpPostingInput): PostingBuild {
  const amount = round2(input.amount);
  if (amount <= 0) return { lines: [], exceptions: [] };
  const lines = [
    dr(tenderAccountCode(input.method), amount, 'Wallet top-up — cash received'),
    cr(ACCOUNT_CODES.CUSTOMER_ADVANCES, amount, 'Wallet top-up — advance owed to customer'),
  ];
  return { lines: balanceDraft(lines, 'wallet top-up'), exceptions: [] };
}

export interface WastagePostingInput {
  value: number;
}

/** Wastage: stock written off at its snapshotted batch cost. */
export function buildWastagePosting(input: WastagePostingInput): PostingBuild {
  const value = round2(input.value);
  if (value <= 0) return { lines: [], exceptions: [] };
  const lines = [
    dr(ACCOUNT_CODES.WASTAGE_LOSS, value, 'Wastage/damage write-off at batch cost'),
    cr(ACCOUNT_CODES.INVENTORY, value, 'Wastage/damage write-off at batch cost'),
  ];
  return { lines: balanceDraft(lines, 'wastage'), exceptions: [] };
}

// ─── Opening balances ────────────────────────────────────────────────

export interface OpeningPostingInput {
  inventoryValue: number;
  receivables: number;
  bankValue: number;
  bankMemo?: string;
  payables: number;
  advances: number;
  advancesMemo?: string;
  giftCardLiability: number;
}

/**
 * Opening entry. The plug to Owner's Equity is EXPLICIT and labelled
 * — it is the derived balancing figure from live operational data at
 * cutover, never a hidden number. A zero-value scope still posts an
 * (empty) entry marker so the routine stays idempotent per scope; the
 * service decides whether to write when every figure is zero.
 */
export function buildOpeningPosting(input: OpeningPostingInput): PostingBuild {
  const lines: DraftLine[] = [];
  if (positive(input.inventoryValue)) lines.push(dr(ACCOUNT_CODES.INVENTORY, input.inventoryValue, 'Opening — inventory at batch cost'));
  if (positive(input.receivables)) lines.push(dr(ACCOUNT_CODES.RECEIVABLES, input.receivables, 'Opening — khata receivables'));
  if (positive(input.bankValue)) lines.push(dr(ACCOUNT_CODES.BANK, input.bankValue, input.bankMemo || 'Opening — bank/cash from statements'));
  if (positive(input.payables)) lines.push(cr(ACCOUNT_CODES.PAYABLES, input.payables, 'Opening — supplier payables'));
  if (positive(input.advances)) lines.push(cr(ACCOUNT_CODES.CUSTOMER_ADVANCES, input.advances, input.advancesMemo || 'Opening — customer advances + wallet balances'));
  if (positive(input.giftCardLiability)) lines.push(cr(ACCOUNT_CODES.GIFT_CARD_LIABILITY, input.giftCardLiability, 'Opening — outstanding gift-card balances'));
  const debits = sumSide(lines, 'debit');
  const credits = sumSide(lines, 'credit');
  const plug = round2(debits - credits);
  const plugMemo = "Opening balance plug — derived from live operational data at cutover";
  if (plug > 0) lines.push(cr(ACCOUNT_CODES.OWNERS_EQUITY, plug, plugMemo));
  else if (plug < 0) lines.push(dr(ACCOUNT_CODES.OWNERS_EQUITY, round2(-plug), plugMemo));
  return { lines: balanceDraft(lines, 'opening balances'), exceptions: [] };
}

// ─── Reversal ────────────────────────────────────────────────────────

/** Mirror an entry's lines (debit ↔ credit) for a reversal entry. */
export function buildReversalLines(original: Array<{ code: string; debit: number; credit: number; memo?: string }>): DraftLine[] {
  return original.map((l) => ({
    code: l.code,
    debit: round2(l.credit || 0),
    credit: round2(l.debit || 0),
    memo: l.memo ? `Reversal — ${l.memo}` : 'Reversal',
  }));
}

// ─── Reports ─────────────────────────────────────────────────────────

export interface LedgerAccountRow {
  id: string;
  code: string;
  name: string;
  type: string;
  subtype: string | null;
}

export interface LedgerLineRow {
  accountId: string;
  debit: number;
  credit: number;
}

export interface TrialBalanceRow {
  accountId: string;
  code: string;
  name: string;
  type: string;
  debitTotal: number;
  creditTotal: number;
  /** |debits − credits| for the account. */
  balance: number;
  balanceSide: 'DEBIT' | 'CREDIT';
}

export interface TrialBalanceResult {
  rows: TrialBalanceRow[];
  totalDebits: number;
  totalCredits: number;
  /** Shown explicitly, never plugged. Zero when every entry balances. */
  difference: number;
}

/**
 * Trial balance from journal lines at/before the as-of date. Only
 * accounts with activity appear. Totals balance by construction when
 * every entry was validated; a nonzero difference is reported, never
 * hidden.
 */
export function buildTrialBalance(accounts: LedgerAccountRow[], lines: LedgerLineRow[]): TrialBalanceResult {
  const byAccount = new Map<string, { debit: number; credit: number }>();
  for (const l of lines) {
    const acc = byAccount.get(l.accountId) || { debit: 0, credit: 0 };
    acc.debit = round2(acc.debit + (l.debit || 0));
    acc.credit = round2(acc.credit + (l.credit || 0));
    byAccount.set(l.accountId, acc);
  }
  const rows: TrialBalanceRow[] = [];
  for (const a of [...accounts].sort((x, y) => x.code.localeCompare(y.code))) {
    const t = byAccount.get(a.id);
    if (!t || (t.debit === 0 && t.credit === 0)) continue;
    rows.push({
      accountId: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      debitTotal: t.debit,
      creditTotal: t.credit,
      balance: round2(Math.abs(t.debit - t.credit)),
      balanceSide: t.debit >= t.credit ? 'DEBIT' : 'CREDIT',
    });
  }
  const totalDebits = round2(rows.reduce((s, r) => s + r.debitTotal, 0));
  const totalCredits = round2(rows.reduce((s, r) => s + r.creditTotal, 0));
  return { rows, totalDebits, totalCredits, difference: round2(totalDebits - totalCredits) };
}

export interface BalanceSheetSection {
  code: string;
  name: string;
  /** Signed value on the section's normal side (debit for assets, credit for liabilities/equity). */
  value: number;
}

export interface BalanceSheetResult {
  assets: BalanceSheetSection[];
  totalAssets: number;
  liabilities: BalanceSheetSection[];
  totalLiabilities: number;
  equityAccounts: BalanceSheetSection[];
  /** Σ INCOME (credits − debits) − Σ EXPENSE (debits − credits). */
  netIncome: number;
  totalEquity: number;
  /** assets − liabilities − equity. Shown explicitly, never plugged. */
  difference: number;
}

/**
 * Balance sheet from journal lines at/before the as-of date. Equity
 * = equity accounts + retained profit computed from the income and
 * expense journals directly, so it can never drift from the journals.
 */
export function buildBalanceSheet(accounts: LedgerAccountRow[], lines: LedgerLineRow[]): BalanceSheetResult {
  const byAccount = new Map<string, { debit: number; credit: number }>();
  for (const l of lines) {
    const acc = byAccount.get(l.accountId) || { debit: 0, credit: 0 };
    acc.debit = round2(acc.debit + (l.debit || 0));
    acc.credit = round2(acc.credit + (l.credit || 0));
    byAccount.set(l.accountId, acc);
  }
  const valueOf = (a: LedgerAccountRow): number => {
    const t = byAccount.get(a.id) || { debit: 0, credit: 0 };
    // Debit-normal: ASSET + EXPENSE. Credit-normal: LIABILITY + EQUITY + INCOME.
    return a.type === 'ASSET' || a.type === 'EXPENSE'
      ? round2(t.debit - t.credit)
      : round2(t.credit - t.debit);
  };
  const section = (type: string): BalanceSheetSection[] =>
    [...accounts]
      .filter((a) => a.type === type)
      .sort((x, y) => x.code.localeCompare(y.code))
      .map((a) => ({ code: a.code, name: a.name, value: valueOf(a) }))
      .filter((s) => s.value !== 0);

  const assets = section('ASSET');
  const liabilities = section('LIABILITY');
  const equityAccounts = section('EQUITY');
  const incomeTotal = round2(
    accounts.filter((a) => a.type === 'INCOME').reduce((s, a) => s + valueOf(a), 0),
  );
  const expenseTotal = round2(
    accounts.filter((a) => a.type === 'EXPENSE').reduce((s, a) => s + valueOf(a), 0),
  );
  const netIncome = round2(incomeTotal - expenseTotal);
  const totalAssets = round2(assets.reduce((s, r) => s + r.value, 0));
  const totalLiabilities = round2(liabilities.reduce((s, r) => s + r.value, 0));
  const totalEquity = round2(equityAccounts.reduce((s, r) => s + r.value, 0) + netIncome);
  return {
    assets,
    totalAssets,
    liabilities,
    totalLiabilities,
    equityAccounts,
    netIncome,
    totalEquity,
    difference: round2(totalAssets - totalLiabilities - totalEquity),
  };
}
