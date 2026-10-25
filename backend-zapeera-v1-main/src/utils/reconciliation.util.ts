// Bank reconciliation engine (Wave B — Item 8: fuller accounting).
//
// Pure functions only: the matcher scores statement lines against
// ledger candidates, the summariser freezes a period's reconciliation
// state, and the CSV parser turns a pasted bank export into lines.
// The controller fetches rows and persists results; nothing here
// touches the database, so the money math is verifiable on fixtures
// (tests/reconciliation.util.test.ts).
//
// SIGN CONVENTION: every amount is from the BANK's perspective —
// positive = money IN to the account, negative = money OUT. Ledger
// rows are converted to that sign by the controller:
//   · SalePayment (bank-settled tender) → +amount
//   · Khata PAYMENT (customer paid what they owed) → +amount
//   · Expense paid by bank transfer/card → −amount
//   · Refund returned through a bank tender → −amount
//
// MATCHING: amount equality (to the cent) is the anchor — a line
// never matches a ledger row of a different amount. On top of that:
//   · exact reference (case-insensitive, trimmed) is the strongest
//     signal, then a same-day date, then description token overlap.
//   · AUTO_EXACT (confidence ≥ 90): amount + reference + close date.
//   · AUTO_FUZZY (confidence ≥ 70): amount + same-day date +
//     description overlap, or amount + reference with a distant date.
//   · Below 70 the line stays UNMATCHED for a human to decide.
// Matching is one-to-one: each ledger row can settle at most one
// statement line (greedy, highest confidence first), so a duplicated
// bank line can never silently consume the same sale twice.

import { round2 } from './accounting.util';

// ─── Types ───────────────────────────────────────────────────────────

export type LedgerKind = 'SALE_PAYMENT' | 'EXPENSE' | 'REFUND' | 'KHATA_PAYMENT';

export interface LedgerCandidate {
  kind: LedgerKind;
  id: string;
  /** Signed, bank perspective: + in, − out. */
  amount: number;
  date: Date | string;
  reference?: string | null;
  description?: string | null;
}

export interface StatementLineInput {
  id: string;
  amount: number;
  date: Date | string;
  reference?: string | null;
  description?: string | null;
}

export interface MatchResult {
  lineId: string;
  candidateKind: LedgerKind;
  candidateId: string;
  confidence: number;
  method: 'AUTO_EXACT' | 'AUTO_FUZZY';
  reasons: string[];
}

export interface AutoMatchResult {
  matches: MatchResult[];
  unmatchedLineIds: string[];
}

// ─── Scoring ─────────────────────────────────────────────────────────

const AMOUNT_POINTS = 35;
const DATE_SAME_DAY_POINTS = 25;
const DATE_WITHIN_1_DAY_POINTS = 20;
const DATE_WITHIN_3_DAYS_POINTS = 15;
const DATE_WITHIN_7_DAYS_POINTS = 8;
const REFERENCE_EXACT_POINTS = 40;
const REFERENCE_CONTAINS_POINTS = 25;
const DESCRIPTION_TOKEN_POINTS = 10;

export const AUTO_EXACT_THRESHOLD = 90;
export const AUTO_FUZZY_THRESHOLD = 70;

function dayDiff(a: Date, b: Date): number {
  const dayMs = 86400000;
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.abs(startOf(a) - startOf(b)) / dayMs;
}

function normalizeRef(ref?: string | null): string {
  return (ref || '').trim().toUpperCase().replace(/[\s\-_]+/g, '');
}

function descriptionTokens(text?: string | null): Set<string> {
  return new Set(
    (text || '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4)
  );
}

/** Score one line against one candidate. 0 when the amounts differ. */
export function scoreMatch(line: StatementLineInput, candidate: LedgerCandidate): { confidence: number; reasons: string[] } {
  const reasons: string[] = [];
  if (round2(Number(line.amount || 0)) !== round2(Number(candidate.amount || 0))) {
    return { confidence: 0, reasons: ['amount differs'] };
  }
  let confidence = AMOUNT_POINTS;
  reasons.push('amount matches');

  const lineDate = new Date(line.date);
  const candDate = new Date(candidate.date);
  const diff = dayDiff(lineDate, candDate);
  if (diff === 0) {
    confidence += DATE_SAME_DAY_POINTS;
    reasons.push('same-day');
  } else if (diff <= 1) {
    confidence += DATE_WITHIN_1_DAY_POINTS;
    reasons.push('within 1 day');
  } else if (diff <= 3) {
    confidence += DATE_WITHIN_3_DAYS_POINTS;
    reasons.push('within 3 days');
  } else if (diff <= 7) {
    confidence += DATE_WITHIN_7_DAYS_POINTS;
    reasons.push('within 7 days');
  }

  const lineRef = normalizeRef(line.reference);
  const candRef = normalizeRef(candidate.reference);
  if (lineRef && candRef) {
    if (lineRef === candRef) {
      confidence += REFERENCE_EXACT_POINTS;
      reasons.push('reference exact');
    } else if (
      (lineRef.length >= 4 && candRef.includes(lineRef)) ||
      (candRef.length >= 4 && lineRef.includes(candRef))
    ) {
      confidence += REFERENCE_CONTAINS_POINTS;
      reasons.push('reference contains');
    }
  }

  const lineTokens = descriptionTokens(line.description);
  const candTokens = descriptionTokens(candidate.description);
  let shared = 0;
  for (const t of lineTokens) if (candTokens.has(t)) shared += 1;
  if (shared > 0) {
    confidence += DESCRIPTION_TOKEN_POINTS;
    reasons.push(`${shared} description token(s) shared`);
  }

  return { confidence: Math.min(100, confidence), reasons };
}

/**
 * Greedy one-to-one auto-match: every line takes its best-scoring
 * candidate; ties/conflicts resolve highest-confidence-first so a
 * ledger row is never consumed twice.
 */
export function autoMatchLines(
  lines: StatementLineInput[],
  candidates: LedgerCandidate[]
): AutoMatchResult {
  const scored: Array<{ line: StatementLineInput; candidate: LedgerCandidate; confidence: number; reasons: string[] }> = [];
  for (const line of lines) {
    for (const candidate of candidates) {
      const { confidence, reasons } = scoreMatch(line, candidate);
      if (confidence >= AUTO_FUZZY_THRESHOLD) {
        scored.push({ line, candidate, confidence, reasons });
      }
    }
  }
  scored.sort((a, b) => b.confidence - a.confidence);

  const usedLines = new Set<string>();
  const usedCandidates = new Set<string>();
  const matches: MatchResult[] = [];
  for (const s of scored) {
    const candidateKey = `${s.candidate.kind}::${s.candidate.id}`;
    if (usedLines.has(s.line.id) || usedCandidates.has(candidateKey)) continue;
    usedLines.add(s.line.id);
    usedCandidates.add(candidateKey);
    matches.push({
      lineId: s.line.id,
      candidateKind: s.candidate.kind,
      candidateId: s.candidate.id,
      confidence: s.confidence,
      method: s.confidence >= AUTO_EXACT_THRESHOLD ? 'AUTO_EXACT' : 'AUTO_FUZZY',
      reasons: s.reasons,
    });
  }

  return {
    matches,
    unmatchedLineIds: lines.filter((l) => !usedLines.has(l.id)).map((l) => l.id),
  };
}

// ─── Period summary ──────────────────────────────────────────────────

export type ReconLineStatus = 'MATCHED' | 'UNMATCHED' | 'IGNORED';

export interface ReconciliationSummaryInput {
  statementOpening: number;
  statementClosing: number;
  lines: Array<{ status: ReconLineStatus; amount: number }>;
}

export interface ReconciliationSummary {
  matchedCount: number;
  unmatchedCount: number;
  ignoredCount: number;
  matchedIn: number;
  matchedOut: number;
  unmatchedIn: number;
  unmatchedOut: number;
  /** Opening + Σ matched amounts (bank perspective). */
  ledgerClosingBalance: number;
  /** statementClosing − ledgerClosing. 0 = fully reconciled. */
  difference: number;
  isBalanced: boolean;
}

export function summarizeReconciliation(input: ReconciliationSummaryInput): ReconciliationSummary {
  let matchedCount = 0;
  let unmatchedCount = 0;
  let ignoredCount = 0;
  let matchedIn = 0;
  let matchedOut = 0;
  let unmatchedIn = 0;
  let unmatchedOut = 0;
  let matchedNet = 0;

  for (const line of input.lines) {
    const amount = Number(line.amount || 0);
    if (line.status === 'MATCHED') {
      matchedCount += 1;
      matchedNet += amount;
      if (amount >= 0) matchedIn += amount;
      else matchedOut += -amount;
    } else if (line.status === 'IGNORED') {
      ignoredCount += 1;
    } else {
      unmatchedCount += 1;
      if (amount >= 0) unmatchedIn += amount;
      else unmatchedOut += -amount;
    }
  }

  const ledgerClosingBalance = round2(input.statementOpening + matchedNet);
  const difference = round2(input.statementClosing - ledgerClosingBalance);

  return {
    matchedCount,
    unmatchedCount,
    ignoredCount,
    matchedIn: round2(matchedIn),
    matchedOut: round2(matchedOut),
    unmatchedIn: round2(unmatchedIn),
    unmatchedOut: round2(unmatchedOut),
    ledgerClosingBalance,
    difference,
    isBalanced: difference === 0 && unmatchedCount === 0,
  };
}

// ─── CSV import ──────────────────────────────────────────────────────

/**
 * Parse a pasted bank CSV export into statement lines. Expected
 * columns (header row optional, case-insensitive): date, description,
 * reference, amount. Amounts may carry commas, a PKR/Rs prefix, or
 * parentheses for negatives; a separate debit/credit pair of columns
 * is NOT supported — the export must give one signed amount column.
 * Lines that fail to parse are reported, never silently dropped.
 */
export interface ParsedCsvLine {
  date: string;
  description: string;
  reference: string | null;
  amount: number;
}

export interface ParsedCsv {
  lines: ParsedCsvLine[];
  errors: Array<{ row: number; reason: string }>;
}

function splitCsvRow(row: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < row.length; i += 1) {
    const ch = row[i];
    if (ch === '"') {
      if (quoted && row[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === ',' && !quoted) {
      out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

function parseAmount(raw: string): number | null {
  let s = raw.trim();
  if (!s) return null;
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/^(PKR|Rs\.?|PKR\.?)\s*/i, '').replace(/,/g, '').trim();
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

export function parseStatementCsv(text: string): ParsedCsv {
  const rows = text.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
  const lines: ParsedCsvLine[] = [];
  const errors: Array<{ row: number; reason: string }> = [];
  if (rows.length === 0) return { lines, errors };

  // Detect a header row: first cell mentions "date".
  let start = 0;
  let colDate = 0;
  let colDesc = 1;
  let colRef = -1;
  // -1 = last cell (headerless rows: amount is the trailing column).
  let colAmount = -1;
  const firstCells = splitCsvRow(rows[0]).map((c) => c.toLowerCase());
  if (firstCells.some((c) => c.includes('date'))) {
    start = 1;
    colDate = firstCells.findIndex((c) => c.includes('date'));
    colDesc = firstCells.findIndex((c) => c.includes('desc') || c.includes('narrat') || c.includes('detail'));
    colRef = firstCells.findIndex((c) => c.includes('ref') || c.includes('cheque') || c.includes('check') || c.includes('txn'));
    colAmount = firstCells.findIndex((c) => c.includes('amount') || c.includes('debit') || c.includes('credit') || c.includes('value'));
    if (colDesc < 0) colDesc = 1;
    if (colAmount < 0) colAmount = firstCells.length - 1;
  }

  for (let i = start; i < rows.length; i += 1) {
    const cells = splitCsvRow(rows[i]);
    const dateRaw = cells[colDate] || '';
    const descRaw = colDesc >= 0 ? cells[colDesc] || '' : '';
    const refRaw = colRef >= 0 ? cells[colRef] || '' : '';
    const amountRaw = colAmount >= 0 ? cells[colAmount] || '' : cells[cells.length - 1] || '';
    const date = new Date(dateRaw);
    const amount = parseAmount(amountRaw);
    if (!dateRaw || Number.isNaN(date.getTime())) {
      errors.push({ row: i + 1, reason: `unparseable date "${dateRaw}"` });
      continue;
    }
    if (amount === null) {
      errors.push({ row: i + 1, reason: `unparseable amount "${amountRaw}"` });
      continue;
    }
    lines.push({
      date: date.toISOString().slice(0, 10),
      description: descRaw || '(no description)',
      reference: refRaw || null,
      amount: round2(amount),
    });
  }

  return { lines, errors };
}
