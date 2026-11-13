// v1.0.22 calculation tests — pure money math, no database.
// Quotation totals, service-charge rules, and the derived
// trial-balance / balance-sheet summary (utils/accounting.util.ts).

import { describe, it, expect } from '@jest/globals';
import { computeQuotationLineTotal, computeQuotationTotals } from '../src/utils/quotation.util';
import { computeServiceCharge, resolveServiceChargeConfig } from '../src/utils/service-charge.util';
import { buildPositionSummary, POSITION_GAPS, PnlStatement } from '../src/utils/accounting.util';

describe('quotation totals', () => {
  it('prices a line as level quantity x unit price', () => {
    // 20 tablets, strip factor 10, PKR 50 per strip → 2 strips = 100.
    expect(computeQuotationLineTotal({ quantity: 20, unitFactor: 10, unitPrice: 50 })).toEqual({
      lineTotal: 100,
      levelQuantity: 2,
    });
  });

  it('treats a missing factor as whole base units', () => {
    expect(computeQuotationLineTotal({ quantity: 3, unitPrice: 25 }).lineTotal).toBe(75);
  });

  it('caps a line discount at the line gross', () => {
    expect(computeQuotationLineTotal({ quantity: 2, unitPrice: 50, discountAmount: 500 }).lineTotal).toBe(0);
  });

  it('ignores a negative line discount', () => {
    expect(computeQuotationLineTotal({ quantity: 2, unitPrice: 50, discountAmount: -10 }).lineTotal).toBe(100);
  });

  it('sums lines into the subtotal and adds caller tax', () => {
    const totals = computeQuotationTotals({
      lines: [
        { quantity: 2, unitPrice: 100 },
        { quantity: 3, unitPrice: 50, discountAmount: 10 },
      ],
      taxAmount: 17,
    });
    expect(totals.subtotal).toBe(340);
    expect(totals.discountAmount).toBe(0);
    expect(totals.taxAmount).toBe(17);
    expect(totals.totalAmount).toBe(357);
    expect(totals.lineTotals).toEqual([200, 140]);
  });

  it('gives the sale percentage precedence over a flat amount (the sale rule)', () => {
    const totals = computeQuotationTotals({
      lines: [{ quantity: 4, unitPrice: 100 }],
      discountPercentage: 10,
      discountAmount: 5,
    });
    expect(totals.discountAmount).toBe(40);
    expect(totals.totalAmount).toBe(360);
  });

  it('caps a flat sale discount at the subtotal', () => {
    const totals = computeQuotationTotals({
      lines: [{ quantity: 1, unitPrice: 100 }],
      discountAmount: 999,
    });
    expect(totals.discountAmount).toBe(100);
    expect(totals.totalAmount).toBe(0);
  });

  it('handles empty lines', () => {
    expect(computeQuotationTotals({ lines: [] })).toEqual({
      subtotal: 0,
      discountAmount: 0,
      taxAmount: 0,
      totalAmount: 0,
      lineTotals: [],
    });
  });
});

describe('service charge', () => {
  const percentConfig = { enabled: true, chargeType: 'PERCENT', percentage: 5, fixedAmount: null, applyByDefault: true };
  const fixedConfig = { enabled: true, chargeType: 'FIXED', percentage: null, fixedAmount: 50, applyByDefault: true };

  it('charges nothing without a config', () => {
    expect(computeServiceCharge(1000, null)).toEqual({ amount: 0, type: null, percentage: null });
    expect(computeServiceCharge(1000, undefined)).toEqual({ amount: 0, type: null, percentage: null });
  });

  it('charges nothing when disabled', () => {
    expect(computeServiceCharge(1000, { ...percentConfig, enabled: false }).amount).toBe(0);
  });

  it('takes the percentage of the post-discount base', () => {
    expect(computeServiceCharge(1000, percentConfig)).toEqual({ amount: 50, type: 'PERCENT', percentage: 5 });
    expect(computeServiceCharge(333, percentConfig).amount).toBe(16.65);
  });

  it('takes the fixed amount', () => {
    expect(computeServiceCharge(1000, fixedConfig)).toEqual({ amount: 50, type: 'FIXED', percentage: null });
  });

  it('lets an opt-out always win', () => {
    expect(computeServiceCharge(1000, percentConfig, { optOut: true }).amount).toBe(0);
    expect(computeServiceCharge(1000, percentConfig, { applied: true, optOut: true }).amount).toBe(0);
  });

  it('requires an explicit opt-in when applyByDefault is off', () => {
    const manual = { ...percentConfig, applyByDefault: false };
    expect(computeServiceCharge(1000, manual).amount).toBe(0);
    expect(computeServiceCharge(1000, manual, { applied: true }).amount).toBe(50);
  });

  it('never invents a charge for an unknown charge type', () => {
    expect(computeServiceCharge(1000, { ...percentConfig, chargeType: 'MYSTERY' }).amount).toBe(0);
  });

  it('charges nothing for a zero or missing rate', () => {
    expect(computeServiceCharge(1000, { ...percentConfig, percentage: 0 }).amount).toBe(0);
    expect(computeServiceCharge(1000, { ...percentConfig, percentage: null }).amount).toBe(0);
    expect(computeServiceCharge(1000, { ...fixedConfig, fixedAmount: 0 }).amount).toBe(0);
  });

  it('treats a negative base as zero', () => {
    expect(computeServiceCharge(-500, percentConfig).amount).toBe(0);
  });

  it('resolves the branch row over the business row', () => {
    const businessRow = { branchId: null, enabled: true, chargeType: 'PERCENT', percentage: 5, fixedAmount: null, applyByDefault: true };
    const branchRow = { branchId: 'b1', enabled: true, chargeType: 'FIXED', percentage: null, fixedAmount: 25, applyByDefault: true };
    expect(resolveServiceChargeConfig([businessRow, branchRow], 'b1')).toBe(branchRow);
    expect(resolveServiceChargeConfig([businessRow, branchRow], 'b2')).toBe(businessRow);
    expect(resolveServiceChargeConfig([businessRow, branchRow], null)).toBe(businessRow);
    expect(resolveServiceChargeConfig([], 'b1')).toBeNull();
    expect(resolveServiceChargeConfig([branchRow], 'b2')).toBeNull();
  });
});

describe('derived financial position (trial balance / balance sheet)', () => {
  const cumulative: PnlStatement = {
    revenue: { gross: 1000, refunds: 100, net: 900 },
    cogs: { gross: 400, refundReversal: 40, net: 360 },
    grossProfit: 540,
    expenses: 140,
    netProfit: 400,
  };

  it('totals assets and liabilities from the derived lines', () => {
    const s = buildPositionSummary({
      inventoryAtCost: 500,
      receivables: 200,
      bankStatementBacked: 300,
      bankOpeningOnly: 50,
      payables: 150,
      customerAdvances: 20,
      giftCardLiability: 30,
      walletLiability: 10,
      cumulative,
    });
    expect(s.assets.total).toBe(1050);
    expect(s.liabilities.total).toBe(210);
    expect(s.assets.lines.map((l) => l.label)).toEqual([
      'Inventory at cost',
      'Trade receivables (khata dues)',
      'Bank balances (per latest statement)',
      'Bank balances (opening balance only, no statement)',
    ]);
  });

  it('states retained profit as cumulative net profit and never plugs the difference', () => {
    const s = buildPositionSummary({
      inventoryAtCost: 500,
      receivables: 200,
      bankStatementBacked: 300,
      bankOpeningOnly: 50,
      payables: 150,
      customerAdvances: 20,
      giftCardLiability: 30,
      walletLiability: 10,
      cumulative,
    });
    expect(s.retainedProfit).toBe(400);
    expect(s.unreconciledDifference).toBe(1050 - 210 - 400);
  });

  it('keeps the trial-balance difference equal to the unreconciled difference (identity)', () => {
    const s = buildPositionSummary({
      inventoryAtCost: 500,
      receivables: 200,
      bankStatementBacked: 300,
      bankOpeningOnly: 50,
      payables: 150,
      customerAdvances: 20,
      giftCardLiability: 30,
      walletLiability: 10,
      cumulative,
    });
    expect(s.trialBalance.difference).toBe(s.unreconciledDifference);
    expect(s.trialBalance.totalDebits).toBe(1050 + 360 + 140);
    expect(s.trialBalance.totalCredits).toBe(210 + 900);
    expect(s.trialBalance.rows).toHaveLength(10);
  });

  it('lists the untracked areas instead of hiding them', () => {
    const s = buildPositionSummary({
      inventoryAtCost: 0,
      receivables: 0,
      bankStatementBacked: 0,
      bankOpeningOnly: 0,
      payables: 0,
      customerAdvances: 0,
      giftCardLiability: 0,
      walletLiability: 0,
      cumulative: { revenue: { gross: 0, refunds: 0, net: 0 }, cogs: { gross: 0, refundReversal: 0, net: 0 }, grossProfit: 0, expenses: 0, netProfit: 0 },
    });
    expect(s.gaps).toEqual(POSITION_GAPS);
    expect(s.gaps.length).toBe(6);
    expect(s.unreconciledDifference).toBe(0);
    expect(s.trialBalance.difference).toBe(0);
  });
});
