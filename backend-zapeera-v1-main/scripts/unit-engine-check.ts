// Numeric self-check for the Wave C2 unit engine (src/utils/unit.util.ts).
// Run: npx ts-node --transpile-only scripts/unit-engine-check.ts
// Exits non-zero on the first failed invariant.
//
// Cases:
//  1. Conversions — toBase across PACK / STRIP / UNIT.
//  2. Breakdown — greedy packs → strips → tablets display.
//  3. Price derivation incl. the brief's rounding edges:
//     pack 100/strip 10 @ Rs 550 → strip 55.00, tablet 5.50;
//     pack 30/strip 10 @ Rs 100 → strip 33.33, tablet 3.33;
//     and the per-base-unit entry point (Batch.sellingPrice) agreeing.
//  4. Sale math — 2 strips of the 100/10 product = 20 base units and
//     a line total of 110 at the derived strip price.
//  5. Structure validation — whole-multiple rule.
//  6. Line resolution — STRIP without a strip size, fractional base
//     quantities, and the receipt phrasing.
import {
  toBase,
  breakdownStock,
  deriveLevelPrices,
  deriveLevelPricesFromUnitPrice,
  validateUnitStructure,
  resolveSaleLineUnits,
  describeLevelQuantity
} from '../src/utils/unit.util';

let failures = 0;
const check = (label: string, cond: boolean, detail?: string) => {
  if (cond) {
    console.log(`  PASS ${label}`);
  } else {
    failures++;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};

const S100 = { unitsPerPack: 100, unitsPerStrip: 10 }; // 100 tablets = 10 strips of 10
const S30 = { unitsPerPack: 30, unitsPerStrip: 10 }; // 30 tablets = 3 strips of 10

// ── Case 1: conversions ─────────────────────────────────────────────
console.log('Case 1: toBase conversions (pack 100 / strip 10)');
check('2 packs = 200', toBase(2, 'PACK', S100) === 200);
check('3 strips = 30', toBase(3, 'STRIP', S100) === 30);
check('7 tablets = 7', toBase(7, 'UNIT', S100) === 7);
check('strip without strip size = null', toBase(1, 'STRIP', { unitsPerPack: 100 }) === null);
check('unstructured pack factor is 1', toBase(5, 'PACK', { unitsPerPack: 1 }) === 5);

// ── Case 2: breakdown ───────────────────────────────────────────────
console.log('Case 2: stock breakdown');
{
  const b = breakdownStock(234, S100);
  check('234 → 2 packs · 3 strips · 4 tablets', b.text === '2 packs · 3 strips · 4 tablets', b.text);
  check('234 parts', b.packs === 2 && b.strips === 3 && b.units === 4);
  check('100 → 1 pack', breakdownStock(100, S100).text === '1 pack', breakdownStock(100, S100).text);
  check('20 → 2 strips', breakdownStock(20, S100).text === '2 strips', breakdownStock(20, S100).text);
  check('5 → 5 tablets', breakdownStock(5, S100).text === '5 tablets', breakdownStock(5, S100).text);
  check('unstructured 120 → 120 tablets', breakdownStock(120, { unitsPerPack: 1 }).text === '120 tablets');
  check('no-strip structure 250 → 2 packs · 50 tablets', breakdownStock(250, { unitsPerPack: 100 }).text === '2 packs · 50 tablets', breakdownStock(250, { unitsPerPack: 100 }).text);
  check('0 → 0 tablets', breakdownStock(0, S100).text === '0 tablets');
}

// ── Case 3: price derivation ────────────────────────────────────────
console.log('Case 3: price derivation (brief rounding edges)');
{
  const p550 = deriveLevelPrices(550, S100);
  check('pack 550 stays 550', p550.pack === 550);
  check('strip = 55', p550.strip === 55, String(p550.strip));
  check('tablet = 5.50', p550.unit === 5.5, String(p550.unit));

  const p100 = deriveLevelPrices(100, S30);
  check('pack 100 stays 100', p100.pack === 100);
  check('strip = 33.33', p100.strip === 33.33, String(p100.strip));
  check('tablet = 3.33', p100.unit === 3.33, String(p100.unit));

  // The POS entry point: Batch.sellingPrice is per BASE unit, so a
  // 5.50/tablet batch of the 100/10 product must derive the same
  // level prices as a Rs 550 pack.
  const fromUnit = deriveLevelPricesFromUnitPrice(5.5, S100);
  check('from unit price: pack = 550', fromUnit.pack === 550, String(fromUnit.pack));
  check('from unit price: strip = 55', fromUnit.strip === 55, String(fromUnit.strip));
  check('from unit price: tablet = 5.50', fromUnit.unit === 5.5, String(fromUnit.unit));

  check('no strip size → strip price null', deriveLevelPrices(550, { unitsPerPack: 100 }).strip === null);
}

// ── Case 4: sale math ───────────────────────────────────────────────
console.log('Case 4: sale math — 2 strips of the 100/10 product');
{
  const resolved = resolveSaleLineUnits({ quantity: 2, unitLevel: 'STRIP' }, S100, 'Probe');
  check('resolves', 'baseQty' in resolved, JSON.stringify(resolved));
  if ('baseQty' in resolved) {
    check('factor = 10', resolved.factor === 10);
    check('base qty = 20 tablets', resolved.baseQty === 20, String(resolved.baseQty));
    const stripPrice = deriveLevelPrices(550, S100).strip!;
    check('line total = 2 × 55 = 110', 2 * stripPrice === 110, String(2 * stripPrice));
  }
  const packLine = resolveSaleLineUnits({ quantity: 1, unitLevel: 'PACK' }, S100);
  check('1 pack = 100 base', 'baseQty' in packLine && packLine.baseQty === 100);
  const unitLine = resolveSaleLineUnits({ quantity: 13, unitLevel: 'UNIT' }, S100);
  check('13 tablets = 13 base', 'baseQty' in unitLine && unitLine.baseQty === 13 && unitLine.factor === 1);
  const lower = resolveSaleLineUnits({ quantity: 2, unitLevel: 'strip' }, S100);
  check('lowercase level accepted', 'baseQty' in lower && lower.baseQty === 20);
}

// ── Case 5: structure validation ────────────────────────────────────
console.log('Case 5: structure validation');
check('100/10 valid', validateUnitStructure(S100) === null);
check('30/10 valid', validateUnitStructure(S30) === null);
check('no strip valid', validateUnitStructure({ unitsPerPack: 100 }) === null);
check('unstructured valid', validateUnitStructure({ unitsPerPack: 1 }) === null);
check('100/7 rejected', validateUnitStructure({ unitsPerPack: 100, unitsPerStrip: 7 }) !== null);
check('strip 0 rejected', validateUnitStructure({ unitsPerPack: 100, unitsPerStrip: 0 }) !== null);
check('pack 1 with strip 10 rejected', validateUnitStructure({ unitsPerPack: 1, unitsPerStrip: 10 }) !== null);

// ── Case 6: line resolution errors + receipt phrasing ───────────────
console.log('Case 6: resolution errors + receipt phrasing');
{
  const noStrip = resolveSaleLineUnits({ quantity: 1, unitLevel: 'STRIP' }, { unitsPerPack: 100 }, 'NoStrip');
  check('STRIP without strip size errors', 'error' in noStrip, JSON.stringify(noStrip));
  const fractional = resolveSaleLineUnits({ quantity: 0.05, unitLevel: 'STRIP' }, S100);
  check('fractional base qty errors', 'error' in fractional, JSON.stringify(fractional));
  const badLevel = resolveSaleLineUnits({ quantity: 1, unitLevel: 'CRATE' }, S100);
  check('unknown level errors', 'error' in badLevel);
  check('receipt: 2 strips (20 tablets)', describeLevelQuantity(20, 'STRIP', 10) === '2 strips (20 tablets)', String(describeLevelQuantity(20, 'STRIP', 10)));
  check('receipt: 1 pack (100 tablets)', describeLevelQuantity(100, 'PACK', 100) === '1 pack (100 tablets)');
  check('receipt: UNIT lines stay plain', describeLevelQuantity(20, 'UNIT', 1) === null);
}

console.log(failures === 0 ? '\nUNIT ENGINE CHECK: ALL PASS' : `\nUNIT ENGINE CHECK: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
