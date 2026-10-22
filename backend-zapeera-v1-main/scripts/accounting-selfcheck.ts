/**
 * Wave B8 accounting-lite self-check.
 *
 * Runs the pure functions of src/utils/accounting.util.ts over a small
 * hand-worked fixture set and asserts the expected figures. Run with:
 *   npx ts-node --transpile-only scripts/accounting-selfcheck.ts
 * Exits non-zero on the first mismatch.
 */
import {
  summarizeCogs,
  computePnl,
  ageLedgerEntries,
  mergeTenderRows,
  sumTenderRows,
} from '../src/utils/accounting.util';

let checks = 0;
function expect<T>(label: string, actual: T, expected: T) {
  checks += 1;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    console.error(`FAIL ${label}: expected ${e}, got ${a}`);
    process.exit(1);
  }
  console.log(`ok   ${label} = ${a}`);
}

// ─── P&L worked example ──────────────────────────────────────────────
// S1 total 10,000: items 10×@400 + 5×@200 → COGS 5,000
// S2 total  3,000: items 2×@500 + 3 units with NO batch (cost unknown)
// Refund in period: amount 1,200; items: 2× product A (orig cost 400)
//   → reversal 800; 1× product Z not on the original sale → unknown.
// Expenses in period: 2,500.
const cogsGross = summarizeCogs([
  { quantity: 10, batchPurchasePrice: 400 },
  { quantity: 5, batchPurchasePrice: 200 },
  { quantity: 2, batchPurchasePrice: 500 },
  { quantity: 3, batchPurchasePrice: null },
]);
expect('COGS gross', cogsGross.cogs, 6000);
expect('COGS unknown lines', cogsGross.unknownCostLines, 1);
expect('COGS unknown units', cogsGross.unknownCostUnits, 3);

const refundCost = summarizeCogs([
  { quantity: 2, batchPurchasePrice: 400 },
  { quantity: 1, batchPurchasePrice: null },
]);
expect('refund COGS reversal', refundCost.cogs, 800);
expect('refund unknown lines', refundCost.unknownCostLines, 1);

const pnl = computePnl({
  grossRevenue: 13000,
  refundsTotal: 1200,
  cogsGross: cogsGross.cogs,
  cogsReversal: refundCost.cogs,
  expensesTotal: 2500,
});
expect('P&L net revenue', pnl.revenue.net, 11800);
expect('P&L net COGS', pnl.cogs.net, 5200);
expect('P&L gross profit', pnl.grossProfit, 6600);
expect('P&L net profit', pnl.netProfit, 4100);

// ─── Receivables ageing worked example (as of 2026-10-21) ───────────
// +5,000 due 2026-07-01 (112d) · +4,000 due 2026-08-15 (67d)
// −3,000 paid 2026-09-10 → FIFO settles July first (2,000 left)
// +1,500 due 2026-10-05 (16d) · −500 adj 2026-10-20 → July 2,000→1,500
const aged = ageLedgerEntries(
  [
    { amount: 5000, createdAt: '2026-07-01T09:00:00' },
    { amount: 4000, createdAt: '2026-08-15T09:00:00' },
    { amount: -3000, createdAt: '2026-09-10T09:00:00' },
    { amount: 1500, createdAt: '2026-10-05T09:00:00' },
    { amount: -500, createdAt: '2026-10-20T09:00:00' },
  ],
  new Date('2026-10-21T12:00:00')
);
expect('ageing balance', aged.balance, 7000);
expect('ageing open due', aged.openDue, 7000);
expect('ageing advance', aged.advance, 0);
expect('ageing bucket 0-30', aged.buckets.days0to30, 1500);
expect('ageing bucket 31-60', aged.buckets.days31to60, 0);
expect('ageing bucket 61-90', aged.buckets.days61to90, 4000);
expect('ageing bucket 90+', aged.buckets.over90, 1500);

// Advance case: overpay, then a new due absorbs the advance first.
const adv = ageLedgerEntries(
  [
    { amount: 1000, createdAt: '2026-10-01T09:00:00' },
    { amount: -1400, createdAt: '2026-10-03T09:00:00' },
    { amount: 300, createdAt: '2026-10-15T09:00:00' },
  ],
  new Date('2026-10-21T12:00:00')
);
expect('advance balance', adv.balance, -100);
expect('advance open due', adv.openDue, 0);
expect('advance held', adv.advance, 100);

// ─── Cashbook tender merge ───────────────────────────────────────────
const merged = mergeTenderRows(
  [{ method: 'CASH', amount: 100, count: 2 }],
  [
    { method: 'CASH', amount: 50, count: 1 },
    { method: 'JAZZCASH', amount: 200, count: 1 },
  ]
);
expect('tender merge', merged, [
  { method: 'JAZZCASH', amount: 200, count: 1 },
  { method: 'CASH', amount: 150, count: 3 },
]);
expect('tender total', sumTenderRows(merged), 350);

console.log(`\nACCOUNTING SELF-CHECK: ${checks}/${checks} passed`);
