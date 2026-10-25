import { describe, it, expect } from '@jest/globals';
import {
  ageBucket,
  ageDays,
  bucketOutstandingByAge,
  computeSuggestion,
  canApprove,
  canReject,
  assertTransition,
  stockAgeBucket,
  classifyMovement,
  productProfitability,
  customerRiskBand,
} from '../src/utils/purchase-suggestion.util';

describe('aging buckets', () => {
  it('ageBucket boundaries are inclusive at the top (30/60/90)', () => {
    expect(ageBucket(0)).toBe('days0to30');
    expect(ageBucket(30)).toBe('days0to30');
    expect(ageBucket(31)).toBe('days31to60');
    expect(ageBucket(60)).toBe('days31to60');
    expect(ageBucket(61)).toBe('days61to90');
    expect(ageBucket(90)).toBe('days61to90');
    expect(ageBucket(91)).toBe('over90');
  });

  it('ageDays never goes negative (future dates age 0)', () => {
    const asOf = new Date('2026-10-25T00:00:00Z');
    expect(ageDays(new Date('2026-10-26T00:00:00Z'), asOf)).toBe(0);
    expect(ageDays(new Date('2026-10-25T00:00:00Z'), asOf)).toBe(0);
    expect(ageDays(new Date('2026-09-25T00:00:00Z'), asOf)).toBe(30);
  });

  it('bucketOutstandingByAge sums per bucket and skips settled/zero rows', () => {
    const asOf = new Date('2026-10-25T00:00:00Z');
    const day = 86400000;
    const result = bucketOutstandingByAge(
      [
        { date: new Date(asOf.getTime() - 10 * day), outstanding: 100 },
        { date: new Date(asOf.getTime() - 45 * day), outstanding: 200.5 },
        { date: new Date(asOf.getTime() - 100 * day), outstanding: 50 },
        { date: new Date(asOf.getTime() - 5 * day), outstanding: 0 },
        { date: new Date(asOf.getTime() - 5 * day), outstanding: -10 },
      ],
      asOf
    );
    expect(result.buckets).toEqual({
      days0to30: 100,
      days31to60: 200.5,
      days61to90: 0,
      over90: 50,
    });
    expect(result.total).toBe(350.5);
  });
});

describe('suggestion thresholds', () => {
  const base = {
    currentStock: 0,
    sellableStock: 0,
    expiringStock: 0,
    reorderLevel: null as number | null,
    reorderQuantity: null as number | null,
    minStock: 10,
    maxStock: null as number | null,
  };

  it('no suggestion when stock is healthy on both rules', () => {
    expect(computeSuggestion({ ...base, sellableStock: 50, currentStock: 50 })).toBeNull();
    expect(
      computeSuggestion({ ...base, sellableStock: 25, currentStock: 25, reorderLevel: 20 })
    ).toBeNull();
  });

  it('opted-in product at/below reorder level suggests top-up (C3 formula)', () => {
    // level 20, stock 5 -> 2*20-5 = 35
    expect(
      computeSuggestion({ ...base, sellableStock: 5, currentStock: 5, reorderLevel: 20 })
    ).toEqual({ reason: 'BELOW_REORDER_LEVEL', suggestedQty: 35 });
    // exactly at the level still triggers
    expect(
      computeSuggestion({ ...base, sellableStock: 20, currentStock: 20, reorderLevel: 20 })
    ).toEqual({ reason: 'BELOW_REORDER_LEVEL', suggestedQty: 20 });
    // one above does not
    expect(
      computeSuggestion({ ...base, sellableStock: 21, currentStock: 21, reorderLevel: 20 })
    ).toBeNull();
  });

  it('fixed reorderQuantity wins over the top-up formula', () => {
    expect(
      computeSuggestion({
        ...base,
        sellableStock: 5,
        currentStock: 5,
        reorderLevel: 20,
        reorderQuantity: 100,
      })
    ).toEqual({ reason: 'BELOW_REORDER_LEVEL', suggestedQty: 100 });
  });

  it('non-opted-in product below minStock suggests a top-up to 2x minStock', () => {
    expect(computeSuggestion({ ...base, sellableStock: 4, currentStock: 4 })).toEqual({
      reason: 'BELOW_MIN_STOCK',
      suggestedQty: 16,
    });
    // at minStock exactly: not below, no suggestion
    expect(computeSuggestion({ ...base, sellableStock: 10, currentStock: 10 })).toBeNull();
  });

  it('expired stock does not count: raw stock above the level but sellable below it still suggests', () => {
    // 50 units on the shelf, 45 of them expired -> sellable 5, level 20
    expect(
      computeSuggestion({
        ...base,
        currentStock: 50,
        sellableStock: 5,
        reorderLevel: 20,
      })
    ).toEqual({ reason: 'BELOW_REORDER_LEVEL', suggestedQty: 35 });
  });

  it('expiring-stock modifier upgrades the reason and covers the cliff', () => {
    // level 20, sellable 8, 6 of them expire within 30d (> half) -> EXPIRING_STOCK, qty max(32, 6) = 32
    expect(
      computeSuggestion({
        ...base,
        sellableStock: 8,
        currentStock: 8,
        reorderLevel: 20,
        expiringStock: 6,
      })
    ).toEqual({ reason: 'EXPIRING_STOCK', suggestedQty: 32 });
    // expiring share <= half: reason stays, qty unchanged
    expect(
      computeSuggestion({
        ...base,
        sellableStock: 10,
        currentStock: 10,
        reorderLevel: 20,
        expiringStock: 4,
      })
    ).toEqual({ reason: 'BELOW_REORDER_LEVEL', suggestedQty: 30 });
  });

  it('suggested qty is at least 1 and capped by maxStock', () => {
    expect(
      computeSuggestion({
        ...base,
        sellableStock: 19,
        currentStock: 19,
        reorderLevel: 20,
        maxStock: 25,
      })
    ).toEqual({ reason: 'BELOW_REORDER_LEVEL', suggestedQty: 6 }); // min(21, 25-19)
    expect(
      computeSuggestion({
        ...base,
        sellableStock: 0,
        currentStock: 0,
        reorderLevel: 0,
        maxStock: 0,
      })
    ).toEqual({ reason: 'BELOW_REORDER_LEVEL', suggestedQty: 1 });
  });
});

describe('approval gate — a suggestion can never create a PO without approval', () => {
  it('only PENDING can be approved or rejected', () => {
    expect(canApprove('PENDING')).toBe(true);
    expect(canApprove('APPROVED')).toBe(false);
    expect(canApprove('REJECTED')).toBe(false);
    expect(canApprove('EXPIRED')).toBe(false);
    expect(canReject('PENDING')).toBe(true);
    expect(canReject('APPROVED')).toBe(false);
    expect(canReject('EXPIRED')).toBe(false);
  });

  it('assertTransition allows only PENDING -> terminal moves', () => {
    expect(() => assertTransition('PENDING', 'APPROVED')).not.toThrow();
    expect(() => assertTransition('PENDING', 'REJECTED')).not.toThrow();
    expect(() => assertTransition('PENDING', 'EXPIRED')).not.toThrow();
    // No double-approve: an APPROVED suggestion can never transition again,
    // so no second Purchase can ever be minted from it.
    expect(() => assertTransition('APPROVED', 'APPROVED')).toThrow(/Illegal suggestion transition/);
    expect(() => assertTransition('APPROVED', 'REJECTED')).toThrow();
    expect(() => assertTransition('REJECTED', 'APPROVED')).toThrow();
    expect(() => assertTransition('EXPIRED', 'APPROVED')).toThrow();
  });
});

describe('stock aging + movement', () => {
  it('stockAgeBucket boundaries (30/60/90/180)', () => {
    expect(stockAgeBucket(30)).toBe('days0to30');
    expect(stockAgeBucket(31)).toBe('days31to60');
    expect(stockAgeBucket(90)).toBe('days61to90');
    expect(stockAgeBucket(91)).toBe('days91to180');
    expect(stockAgeBucket(180)).toBe('days91to180');
    expect(stockAgeBucket(181)).toBe('over180');
  });

  it('classifyMovement: DEAD with no sales, FAST/SLOW by days of cover', () => {
    expect(
      classifyMovement({ unitsSold: 0, daysInPeriod: 30, currentStock: 100 })
    ).toEqual({ movementClass: 'DEAD', dailyRate: 0, daysOfCover: null });
    // 300 sold in 30d = 10/day; 100 in stock -> 10 days cover -> FAST
    expect(
      classifyMovement({ unitsSold: 300, daysInPeriod: 30, currentStock: 100 })
    ).toEqual({ movementClass: 'FAST', dailyRate: 10, daysOfCover: 10 });
    // 30 sold in 30d = 1/day; 200 in stock -> 200 days cover -> SLOW
    expect(
      classifyMovement({ unitsSold: 30, daysInPeriod: 30, currentStock: 200 })
    ).toEqual({ movementClass: 'SLOW', dailyRate: 1, daysOfCover: 200 });
    // 60 sold in 30d = 2/day; 100 in stock -> 50 days cover -> MEDIUM
    expect(
      classifyMovement({ unitsSold: 60, daysInPeriod: 30, currentStock: 100 })
    ).toEqual({ movementClass: 'MEDIUM', dailyRate: 2, daysOfCover: 50 });
  });
});

describe('medicine-wise profitability', () => {
  it('revenue minus batch-cost COGS; unknown-cost units excluded, never zero-priced', () => {
    const result = productProfitability([
      { totalPrice: 1000, unitsDeducted: 10, quantity: 10, batchPurchasePrice: 60 },
      { totalPrice: 500, unitsDeducted: null, quantity: 5, batchPurchasePrice: 60 },
      { totalPrice: 200, unitsDeducted: 2, quantity: 2, batchPurchasePrice: null },
    ]);
    expect(result.revenue).toBe(1700);
    expect(result.cost).toBe(900); // (10+5) x 60; the 2 unknown-cost units excluded
    expect(result.grossProfit).toBe(800);
    expect(result.unitsSold).toBe(17);
    expect(result.unknownCostUnits).toBe(2);
    expect(result.marginPct).toBeCloseTo(47.06, 1);
  });

  it('zero revenue gives null margin, not a divide-by-zero', () => {
    const result = productProfitability([]);
    expect(result).toEqual({
      revenue: 0,
      cost: 0,
      grossProfit: 0,
      marginPct: null,
      unitsSold: 0,
      unknownCostUnits: 0,
    });
  });
});

describe('customer risk band', () => {
  it('bands by oldest due age', () => {
    expect(customerRiskBand(null)).toBe('CURRENT');
    expect(customerRiskBand(10)).toBe('CURRENT');
    expect(customerRiskBand(45)).toBe('WATCH');
    expect(customerRiskBand(75)).toBe('OVERDUE');
    expect(customerRiskBand(120)).toBe('CRITICAL');
  });
});
