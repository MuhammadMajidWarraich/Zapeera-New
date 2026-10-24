// Unit conversion at POS (gap-features item 3) — harness proving
// the unit math on the base-unit engine + FEFO (Wave C2's
// utils/unit.util.ts) and the new multi-batch FEFO allocator
// (utils/fefo.util.ts).
//
// The worked example throughout: box/pack = 10 strips, strip = 10
// tablets (unitsPerPack 100, unitsPerStrip 10). Stock is always
// counted in base units (tablets); a strip is 10 base units and a
// pack is 100.
//
// What is NOT tested here (and why): the sale/refund controllers
// need a live Prisma database — `prisma db push` / `prisma generate`
// cannot fetch their engines in this sandbox (egress proxy resets
// the connection), so no DB-backed sale test can run here. The
// controller wiring is the thin application of these exact pure
// functions (allocateFefo over the FEFO-ordered batch list,
// planRefundRestock over the stored SaleItemBatch rows); the
// deploy-time migration + client regen makes the delegates real.
// The SQL migration for the new table is in the report.
import { allocateFefo, planRefundRestock } from '../src/utils/fefo.util';
import {
  resolveSaleLineUnits,
  toBase,
  unitFactor,
  breakdownStock,
  deriveLevelPrices,
  deriveLevelPricesFromUnitPrice,
  validateUnitStructure,
  isStructured
} from '../src/utils/unit.util';

const PACK = { unitsPerPack: 100, unitsPerStrip: 10 }; // box 10 strips x 10 tabs
const UNSTRUCTURED = { unitsPerPack: 1, unitsPerStrip: null };

describe('unit math — box/strip/loose (box=10 strips, strip=10 tabs)', () => {
  it('selling 1 strip deducts 10 base units', () => {
    expect(toBase(1, 'STRIP', PACK)).toBe(10);
    expect(resolveSaleLineUnits({ quantity: 1, unitLevel: 'STRIP' }, PACK, 'Paracetamol')).toEqual({
      level: 'STRIP',
      factor: 10,
      baseQty: 10
    });
  });

  it('selling 15 loose tablets deducts 15 base units', () => {
    expect(toBase(15, 'UNIT', PACK)).toBe(15);
    expect(resolveSaleLineUnits({ quantity: 15, unitLevel: 'UNIT' }, PACK, 'Paracetamol')).toEqual({
      level: 'UNIT',
      factor: 1,
      baseQty: 15
    });
  });

  it('selling 2 boxes deducts 200 base units', () => {
    expect(toBase(2, 'PACK', PACK)).toBe(200);
    expect(unitFactor('PACK', PACK)).toBe(100);
    expect(unitFactor('STRIP', PACK)).toBe(10);
    expect(unitFactor('UNIT', PACK)).toBe(1);
  });

  it('a strip level needs a strip size configured', () => {
    const res = resolveSaleLineUnits({ quantity: 1, unitLevel: 'STRIP' }, UNSTRUCTURED, 'Vitamin C');
    expect(res).toEqual({ error: expect.stringContaining('not sold by the strip') });
    expect(unitFactor('STRIP', UNSTRUCTURED)).toBeNull();
  });

  it('price = unit price x qty with half-up 2dp rounding', () => {
    // Pack PKR 1000 -> strip 100, tablet 10 (exact division).
    expect(deriveLevelPrices(1000, PACK)).toEqual({ pack: 1000, strip: 100, unit: 10 });
    expect(deriveLevelPricesFromUnitPrice(10, PACK)).toEqual({ pack: 1000, strip: 100, unit: 10 });
    // Pack PKR 999 -> tablet 9.99, strip 99.90 (half-up, no paisa lost).
    expect(deriveLevelPrices(999, PACK)).toEqual({ pack: 999, strip: 99.9, unit: 9.99 });
    // 3 strips at the derived strip price: 3 x 100 = 300.
    const stripPrice = deriveLevelPrices(1000, PACK).strip!;
    expect(Math.round(3 * stripPrice * 100) / 100).toBe(300);
  });

  it('pack must hold a whole number of strips', () => {
    expect(validateUnitStructure(PACK)).toBeNull();
    expect(validateUnitStructure({ unitsPerPack: 100, unitsPerStrip: 30 })).toMatch(/whole multiple/);
    expect(validateUnitStructure({ unitsPerPack: 0, unitsPerStrip: null })).toMatch(/at least 1/);
  });
});

describe('stock display in all units', () => {
  it('breaks 234 tablets into packs, strips and loose tablets', () => {
    expect(breakdownStock(234, PACK)).toEqual({
      packs: 2,
      strips: 3,
      units: 4,
      text: '2 packs · 3 strips · 4 tablets'
    });
  });

  it('a partial box breaks into strips + loose tablets', () => {
    // 15 tablets left of a broken box: 1 strip + 5 loose.
    expect(breakdownStock(15, PACK)).toEqual({
      packs: 0,
      strips: 1,
      units: 5,
      text: '1 strip · 5 tablets'
    });
  });

  it('unstructured products stay plain tablet counts', () => {
    expect(breakdownStock(120, UNSTRUCTURED)).toEqual({
      packs: 0,
      strips: 0,
      units: 120,
      text: '120 tablets'
    });
  });
});

describe('multi-batch FEFO allocation (smallest-unit picking)', () => {
  const soon = { id: 'batch-soon', quantity: 10 }; // expires first
  const later = { id: 'batch-later', quantity: 10 };
  const big = { id: 'batch-big', quantity: 100 };

  it('FEFO picks the nearest-expiry batch first', () => {
    expect(allocateFefo([soon, later], 5)).toEqual({
      allocations: [{ batchId: 'batch-soon', qty: 5 }],
      shortfall: 0
    });
  });

  it('selling 15 loose tablets splits 10 + 5 across two batches', () => {
    expect(allocateFefo([soon, later], 15)).toEqual({
      allocations: [
        { batchId: 'batch-soon', qty: 10 },
        { batchId: 'batch-later', qty: 5 }
      ],
      shortfall: 0
    });
  });

  it('selling 1 strip (10 base) from a batch holding 8 spills 2 into the next', () => {
    const shortBatch = { id: 'batch-short', quantity: 8 };
    expect(allocateFefo([shortBatch, later], 10)).toEqual({
      allocations: [
        { batchId: 'batch-short', qty: 8 },
        { batchId: 'batch-later', qty: 2 }
      ],
      shortfall: 0
    });
  });

  it('a partial-box break takes exactly the base units from one batch', () => {
    expect(allocateFefo([big], 15)).toEqual({
      allocations: [{ batchId: 'batch-big', qty: 15 }],
      shortfall: 0
    });
  });

  it('reports a shortfall instead of over-deducting when stock is short', () => {
    expect(allocateFefo([soon, later], 25)).toEqual({
      allocations: [
        { batchId: 'batch-soon', qty: 10 },
        { batchId: 'batch-later', qty: 10 }
      ],
      shortfall: 5
    });
  });

  it('skips empty batches and takes nothing when nothing is required', () => {
    expect(allocateFefo([{ id: 'empty', quantity: 0 }, soon], 4)).toEqual({
      allocations: [{ batchId: 'batch-soon', qty: 4 }],
      shortfall: 0
    });
    expect(allocateFefo([soon], 0)).toEqual({ allocations: [], shortfall: 0 });
  });

  it('does not mutate its input', () => {
    const batches = [{ ...soon }, { ...later }];
    allocateFefo(batches, 15);
    expect(batches).toEqual([soon, later]);
  });
});

describe('refund restock across FEFO allocations', () => {
  const allocs = [
    { batchId: 'batch-soon', qty: 10 },
    { batchId: 'batch-later', qty: 5 }
  ];

  it('returns each batch only its own units', () => {
    // Returning 10 of the 15 sold comes entirely from batch-soon,
    // which supplied 10; batch-later keeps its 5 out.
    expect(planRefundRestock(allocs, 10, 0)).toEqual([
      { batchId: 'batch-soon', qty: 10 }
    ]);
    expect(planRefundRestock(allocs, 12, 0)).toEqual([
      { batchId: 'batch-soon', qty: 10 },
      { batchId: 'batch-later', qty: 2 }
    ]);
  });

  it('a second refund never credits a batch twice', () => {
    // 10 already returned (all of batch-soon); returning 5 more must
    // come entirely from batch-later, which still holds 5 out.
    expect(planRefundRestock(allocs, 5, 10)).toEqual([{ batchId: 'batch-later', qty: 5 }]);
    // Returning more than is still out caps at what remains.
    expect(planRefundRestock(allocs, 99, 10)).toEqual([{ batchId: 'batch-later', qty: 5 }]);
    // Fully refunded: nothing left to return.
    expect(planRefundRestock(allocs, 5, 15)).toEqual([]);
  });

  it('never returns more than the refund asks for', () => {
    expect(planRefundRestock(allocs, 3, 0)).toEqual([{ batchId: 'batch-soon', qty: 3 }]);
  });
});

describe('backward compatibility — products without unit config', () => {
  it('behave exactly as today: factor 1, no strip level, plain counts', () => {
    expect(isStructured(UNSTRUCTURED)).toBe(false);
    expect(isStructured(PACK)).toBe(true);
    expect(toBase(7, 'UNIT', UNSTRUCTURED)).toBe(7);
    expect(toBase(7, 'PACK', UNSTRUCTURED)).toBe(7);
    expect(deriveLevelPrices(50, UNSTRUCTURED)).toEqual({ pack: 50, strip: null, unit: 50 });
    expect(validateUnitStructure(UNSTRUCTURED)).toBeNull();
    expect(allocateFefo([{ id: 'only', quantity: 20 }], 7)).toEqual({
      allocations: [{ batchId: 'only', qty: 7 }],
      shortfall: 0
    });
  });
});
