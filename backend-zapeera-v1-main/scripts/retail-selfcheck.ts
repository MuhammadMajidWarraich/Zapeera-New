// Numeric self-check for the Wave C6 retail pack pure functions
// (src/utils/variant.util.ts + src/utils/stock-take.util.ts).
// Run: npx ts-node --transpile-only scripts/retail-selfcheck.ts
// Exits non-zero on the first failed invariant.
//
// Cases:
//  1. Variant names + matrix — size x colour pairing, axis-only
//     matrices, trimming / case-insensitive de-duplication, the
//     documented empty-matrix rule.
//  2. Variant stock isolation — the pool filter and its predicate:
//     a variant line sees only its own batches; a variant-less line
//     on a variant product sees only the base pool; a variant-less
//     line on a plain product sees everything (legacy untouched).
//  3. Variant price pre-fill — batch price + delta, clamped at 0.
//  4. Stock-take variance — per-line variance, the completion
//     adjustment set (counted + non-zero only), and the register
//     summary (shortage / surplus split, totals identity).
import {
  batchBelongsToLinePool,
  buildVariantMatrix,
  buildVariantName,
  normalizeAttributes,
  variantBatchWhere,
  variantUnitPrice,
} from '../src/utils/variant.util';
import {
  completionAdjustments,
  lineVariance,
  summarizeStockTake,
} from '../src/utils/stock-take.util';

let failures = 0;
const check = (label: string, cond: boolean, detail?: string) => {
  if (cond) {
    console.log(`  PASS ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

console.log('1. Variant names + matrix');
check('name from size+color', buildVariantName({ size: 'Large', color: 'Red' }) === 'Large / Red');
check('name from size only', buildVariantName({ size: 'XL' }) === 'XL');
check('name sorts extra keys after size/color', buildVariantName({ material: 'Cotton', color: 'Blue', size: 'M' }) === 'M / Blue / Cotton');
check('empty attributes fall back', buildVariantName(null, 'Base') === 'Base' && buildVariantName(null) === 'Variant');
check('normalizeAttributes trims + drops empties', eq(normalizeAttributes({ Size: ' L ', color: '' }), { size: 'L' }));
check('normalizeAttributes of junk is null', normalizeAttributes('nope') === null && normalizeAttributes({}) === null);

const matrix = buildVariantMatrix(['S', 'M', 'L'], ['Red', 'Blue']);
check('3 sizes x 2 colors = 6 variants', matrix.length === 6, `got ${matrix.length}`);
check('matrix order is size-major', matrix[0].name === 'S / Red' && matrix[1].name === 'S / Blue' && matrix[5].name === 'L / Blue');
check('matrix attributes ride along', eq(matrix[3].attributes, { size: 'M', color: 'Blue' }));
const sizeOnly = buildVariantMatrix([' 42 ', '42', '43'], []);
check('size-only matrix dedupes + trims', sizeOnly.length === 2 && sizeOnly[0].name === '42');
const colorOnly = buildVariantMatrix([], ['Black', ' black ', 'White']);
check('color-only matrix dedupes case-insensitively', colorOnly.length === 2 && colorOnly[0].name === 'Black');
check('no axes = no matrix', buildVariantMatrix([], []).length === 0 && buildVariantMatrix(null, undefined).length === 0);

console.log('2. Variant stock isolation');
check('variant line filters to its variant', eq(variantBatchWhere('v-red', true), { variantId: 'v-red' }));
check('variant line filters even if product flag stale', eq(variantBatchWhere('v-red', false), { variantId: 'v-red' }));
check('plain line on variant product = base pool only', eq(variantBatchWhere(null, true), { variantId: null }));
check('plain line on plain product = no constraint (legacy)', eq(variantBatchWhere(null, false), {}));
check('predicate: variant line takes its own batch', batchBelongsToLinePool('v-red', 'v-red', true));
check('predicate: variant line refuses base batch', !batchBelongsToLinePool(null, 'v-red', true));
check('predicate: variant line refuses sibling variant', !batchBelongsToLinePool('v-blue', 'v-red', true));
check('predicate: plain line on variant product takes base batch', batchBelongsToLinePool(null, null, true));
check('predicate: plain line on variant product refuses variant batch', !batchBelongsToLinePool('v-red', null, true));
check('predicate: plain product line takes any batch (all base by construction)', batchBelongsToLinePool(null, null, false));

console.log('3. Variant price pre-fill');
check('price + positive delta', variantUnitPrice(1000, 150) === 1150);
check('price + negative delta', variantUnitPrice(1000, -200) === 800);
check('delta never drives price negative', variantUnitPrice(100, -250) === 0);
check('null delta = batch price', variantUnitPrice(499.99, null) === 499.99);
check('rounding to the paisa', variantUnitPrice(100.005, 0) === 100.01 || variantUnitPrice(100.005, 0) === 100);

console.log('4. Stock-take variance');
check('shortage variance is negative', lineVariance(50, 47) === -3);
check('surplus variance is positive', lineVariance(50, 53) === 3);
check('exact count variance is zero', lineVariance(50, 50) === 0);
check('uncounted line has no variance', lineVariance(50, null) === null && lineVariance(50, undefined) === null);

const lines = [
  { batchId: 'b1', productId: 'p1', systemQty: 50, countedQty: 47 }, // -3 shortage, adjusts
  { batchId: 'b2', productId: 'p1', systemQty: 20, countedQty: 20 }, // exact, frozen, no movement
  { batchId: 'b3', productId: 'p2', systemQty: 10, countedQty: 14 }, // +4 surplus, adjusts
  { batchId: 'b4', productId: 'p2', systemQty: 99, countedQty: null }, // uncounted, never touched
];
const adjustments = completionAdjustments(lines);
check('completion adjusts counted non-zero lines only', adjustments.length === 2 && adjustments[0].batchId === 'b1' && adjustments[1].batchId === 'b3');
check('adjustment carries the signed variance', adjustments[0].variance === -3 && adjustments[1].variance === 4);
const summary = summarizeStockTake(lines);
check('summary counts', summary.lineCount === 4 && summary.countedLines === 3 && summary.uncountedLines === 1);
check('summary totals identity', summary.totalSystem === 80 && summary.totalCounted === 81 && summary.totalVariance === 1 && summary.totalVariance === summary.totalCounted - summary.totalSystem);
check('summary shortage/surplus split', summary.shortageUnits === 3 && summary.surplusUnits === 4 && summary.adjustedLines === 2);
const empty = summarizeStockTake([]);
check('empty take summarizes to zeros', empty.lineCount === 0 && empty.totalVariance === 0 && empty.adjustedLines === 0);

console.log(failures === 0 ? '\nRETAIL SELF-CHECK: ALL PASS' : `\nRETAIL SELF-CHECK: ${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
