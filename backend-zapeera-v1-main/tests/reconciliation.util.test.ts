/**
 * Bank reconciliation engine tests (Wave B — Item 8).
 * Pure functions only — no database, no mocks needed.
 */

import {
  scoreMatch,
  autoMatchLines,
  summarizeReconciliation,
  parseStatementCsv,
  LedgerCandidate,
  StatementLineInput,
} from '../src/utils/reconciliation.util';
import { computePnl, comparePnl } from '../src/utils/accounting.util';

const line = (over: Partial<StatementLineInput> = {}): StatementLineInput => ({
  id: 'line-1',
  amount: 5000,
  date: '2026-10-10',
  reference: 'TXN-1001',
  description: 'JazzCash settlement Oct 10',
  ...over,
});

const candidate = (over: Partial<LedgerCandidate> = {}): LedgerCandidate => ({
  kind: 'SALE_PAYMENT',
  id: 'pay-1',
  amount: 5000,
  date: '2026-10-10',
  reference: 'TXN-1001',
  description: 'JazzCash settlement',
  ...over,
});

describe('scoreMatch', () => {
  it('scores 100 for amount + same day + exact reference + shared tokens', () => {
    const { confidence } = scoreMatch(line(), candidate());
    expect(confidence).toBe(100);
  });

  it('scores 0 when the amounts differ, whatever else matches', () => {
    const { confidence } = scoreMatch(line(), candidate({ amount: 4999.99 }));
    expect(confidence).toBe(0);
  });

  it('scores amount + same day only below the fuzzy threshold', () => {
    const { confidence } = scoreMatch(
      line({ reference: null, description: 'zzz qqq' }),
      candidate({ reference: null, description: 'aaa bbb' })
    );
    // 35 amount + 25 same-day = 60 < 70
    expect(confidence).toBe(60);
  });

  it('scores amount + same day + shared description token as fuzzy', () => {
    const { confidence } = scoreMatch(
      line({ reference: null, description: 'JazzCash settlement' }),
      candidate({ reference: null, description: 'JazzCash payout' })
    );
    // 35 + 25 + 10 = 70
    expect(confidence).toBe(70);
  });

  it('scores amount + exact reference with a distant date as fuzzy', () => {
    const { confidence } = scoreMatch(line(), candidate({ date: '2026-10-25' }));
    // 35 + 0 date + 40 ref + 10 tokens = 85
    expect(confidence).toBe(85);
  });

  it('rewards a containing reference, not only an exact one', () => {
    const { confidence } = scoreMatch(line(), candidate({ reference: 'BANK-TXN-1001-SETTLE' }));
    // 35 + 25 + 25 + 10 = 95
    expect(confidence).toBe(95);
  });

  it('is case- and separator-insensitive on references', () => {
    const { confidence } = scoreMatch(
      line({ reference: 'txn 1001' }),
      candidate({ reference: 'TXN-1001' })
    );
    expect(confidence).toBe(100);
  });
});

describe('autoMatchLines', () => {
  it('matches exact lines and leaves the rest unmatched', () => {
    const lines = [
      line({ id: 'l1' }),
      line({ id: 'l2', amount: -2500, date: '2026-10-11', reference: 'EXP-9', description: 'Rent' }),
      line({ id: 'l3', amount: 999, date: '2026-10-12', reference: null, description: 'Unknown' }),
    ];
    const candidates = [
      candidate({ id: 'p1' }),
      candidate({ kind: 'EXPENSE', id: 'e1', amount: -2500, date: '2026-10-11', reference: 'EXP-9', description: 'Rent payment' }),
    ];
    const result = autoMatchLines(lines, candidates);
    expect(result.matches).toHaveLength(2);
    expect(result.matches.find((m) => m.lineId === 'l1')?.method).toBe('AUTO_EXACT');
    expect(result.matches.find((m) => m.lineId === 'l2')?.candidateKind).toBe('EXPENSE');
    expect(result.unmatchedLineIds).toEqual(['l3']);
  });

  it('never consumes one ledger row for two statement lines', () => {
    const lines = [
      line({ id: 'l1' }),
      line({ id: 'l2' }), // identical twin line
    ];
    const result = autoMatchLines(lines, [candidate({ id: 'p1' })]);
    expect(result.matches).toHaveLength(1);
    expect(result.unmatchedLineIds).toHaveLength(1);
  });

  it('prefers the highest-confidence candidate when several fit', () => {
    const lines = [line({ id: 'l1', reference: 'TXN-1001' })];
    const candidates = [
      candidate({ id: 'p-weak', reference: null, description: 'JazzCash settlement' }), // 70
      candidate({ id: 'p-strong', reference: 'TXN-1001' }), // 100
    ];
    const result = autoMatchLines(lines, candidates);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].candidateId).toBe('p-strong');
  });

  it('returns no matches when nothing reaches the fuzzy threshold', () => {
    const result = autoMatchLines(
      [line({ reference: null, description: 'zzz' })],
      [candidate({ reference: null, description: 'aaa', date: '2026-09-01' })]
    );
    expect(result.matches).toHaveLength(0);
    expect(result.unmatchedLineIds).toEqual(['line-1']);
  });
});

describe('summarizeReconciliation', () => {
  it('balances when matched lines explain the whole statement movement', () => {
    const s = summarizeReconciliation({
      statementOpening: 10000,
      statementClosing: 12500,
      lines: [
        { status: 'MATCHED', amount: 5000 },
        { status: 'MATCHED', amount: -2500 },
      ],
    });
    expect(s.ledgerClosingBalance).toBe(12500);
    expect(s.difference).toBe(0);
    expect(s.isBalanced).toBe(true);
    expect(s.matchedIn).toBe(5000);
    expect(s.matchedOut).toBe(2500);
  });

  it('reports the difference and stays unbalanced with unmatched lines', () => {
    const s = summarizeReconciliation({
      statementOpening: 10000,
      statementClosing: 13000,
      lines: [
        { status: 'MATCHED', amount: 2000 },
        { status: 'UNMATCHED', amount: 1000 },
        { status: 'IGNORED', amount: -50 },
      ],
    });
    expect(s.ledgerClosingBalance).toBe(12000);
    expect(s.difference).toBe(1000);
    expect(s.isBalanced).toBe(false);
    expect(s.unmatchedCount).toBe(1);
    expect(s.ignoredCount).toBe(1);
    expect(s.unmatchedIn).toBe(1000);
  });

  it('is unbalanced when the difference is zero but lines are still unmatched', () => {
    const s = summarizeReconciliation({
      statementOpening: 0,
      statementClosing: 0,
      lines: [{ status: 'UNMATCHED', amount: 0 }],
    });
    expect(s.difference).toBe(0);
    expect(s.isBalanced).toBe(false);
  });
});

describe('parseStatementCsv', () => {
  it('parses a headered export with quoted descriptions', () => {
    const csv = [
      'Date,Description,Reference,Amount',
      '2026-10-10,"JazzCash settlement, Oct 10",TXN-1001,"5,000"',
      '2026-10-11,Rent payment,EXP-9,-2500',
      '2026-10-12,Bank charges,,(150)',
    ].join('\n');
    const { lines, errors } = parseStatementCsv(csv);
    expect(errors).toEqual([]);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({ date: '2026-10-10', description: 'JazzCash settlement, Oct 10', reference: 'TXN-1001', amount: 5000 });
    expect(lines[1].amount).toBe(-2500);
    expect(lines[2].amount).toBe(-150);
  });

  it('parses a headerless export positionally', () => {
    const { lines, errors } = parseStatementCsv('2026-10-10,Cash deposit,,10000');
    expect(errors).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0].amount).toBe(10000);
  });

  it('reports bad rows instead of dropping them silently', () => {
    const csv = [
      'Date,Description,Reference,Amount',
      'not-a-date,Bad row,,100',
      '2026-10-10,Bad amount,,abc',
      '2026-10-10,Good row,,500',
    ].join('\n');
    const { lines, errors } = parseStatementCsv(csv);
    expect(lines).toHaveLength(1);
    expect(errors).toHaveLength(2);
    expect(errors[0].row).toBe(2);
    expect(errors[1].row).toBe(3);
  });
});

describe('comparePnl', () => {
  const prev = computePnl({ grossRevenue: 100000, refundsTotal: 5000, cogsGross: 60000, cogsReversal: 3000, expensesTotal: 20000 });
  const curr = computePnl({ grossRevenue: 120000, refundsTotal: 4000, cogsGross: 70000, cogsReversal: 2000, expensesTotal: 22000 });

  it('computes deltas and percent changes per line', () => {
    const c = comparePnl(curr, prev);
    expect(c.revenue.net.change).toBe(21000); // 116000 − 95000
    expect(c.revenue.net.pctChange).toBeCloseTo(22.11, 2);
    expect(c.netProfit.current).toBe(26000);
    expect(c.netProfit.previous).toBe(18000);
    expect(c.netProfit.change).toBe(8000);
    expect(c.netProfit.pctChange).toBeCloseTo(44.44, 2);
    expect(c.expenses.change).toBe(2000);
  });

  it('returns null pctChange when the previous period is zero', () => {
    const zero = computePnl({ grossRevenue: 0, refundsTotal: 0, cogsGross: 0, cogsReversal: 0, expensesTotal: 0 });
    const c = comparePnl(curr, zero);
    expect(c.revenue.gross.pctChange).toBeNull();
    expect(c.revenue.gross.change).toBe(120000);
  });

  it('handles a previous-period loss as the percent basis', () => {
    const lossPrev = computePnl({ grossRevenue: 10000, refundsTotal: 0, cogsGross: 8000, cogsReversal: 0, expensesTotal: 5000 });
    const c = comparePnl(curr, lossPrev);
    expect(lossPrev.netProfit).toBe(-3000);
    expect(c.netProfit.change).toBe(29000);
    expect(c.netProfit.pctChange).toBeCloseTo(966.67, 2);
  });
});
