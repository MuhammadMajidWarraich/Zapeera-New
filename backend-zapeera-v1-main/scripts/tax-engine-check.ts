// Numeric self-check for the Wave B5 tax engine (src/utils/tax.util.ts).
// Run: npx ts-node --transpile-only scripts/tax-engine-check.ts
// Exits non-zero on the first failed invariant.
//
// Cases:
//  1. Brief's case — 2 lines (17% class + 0% class) with a promotion:
//     subtotal 1000, order-level discounts 100 → taxable base 900.
//     Groups must be 540 @17% = 91.80 and 360 @0% = 0, and the group
//     taxes must sum to the sale taxAmount.
//  2. Legacy parity — no classes at all: the single implicit group
//     must equal the pre-B5 formula base × (rate/100) BIT-FOR-BIT.
//  3. Residue — three groups whose rounded bases don't sum to the
//     base: the largest group absorbs the cent residue and the bases
//     sum exactly to the taxable base.
//  4. Default-class fallback — a product without a class, and one
//     pointing at a RETIRED class, both land in the isDefault class;
//     with no default class they land on the defaultTax setting.
import { computeSaleTax } from '../src/utils/tax.util';

let failures = 0;
const check = (label: string, cond: boolean, detail?: string) => {
  if (cond) {
    console.log(`  PASS ${label}`);
  } else {
    failures++;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// ── Case 1: two classes + a promotion-shaped discount ───────────────
console.log('Case 1: 17% + 0% classes, subtotal 1000, discounts 100 (base 900)');
{
  const classes = [
    { id: 'std', name: 'Standard', rate: 17, isDefault: true, isActive: true },
    { id: 'exempt', name: 'Exempt', rate: 0, isDefault: false, isActive: true }
  ];
  const result = computeSaleTax({
    lines: [
      { lineTotal: 600, taxClassId: 'std' },
      { lineTotal: 400, taxClassId: 'exempt' }
    ],
    classes,
    defaultTaxRate: 17,
    subtotal: 1000,
    taxableBase: 900
  });
  check('two groups', result.groups.length === 2, JSON.stringify(result.groups));
  const std = result.groups.find(g => g.taxClassId === 'std')!;
  const exempt = result.groups.find(g => g.taxClassId === 'exempt')!;
  check('standard base 540', std.taxableAmount === 540, String(std.taxableAmount));
  check('exempt base 360', exempt.taxableAmount === 360, String(exempt.taxableAmount));
  check('standard tax 91.80', std.taxAmount === 91.8, String(std.taxAmount));
  check('exempt tax 0', exempt.taxAmount === 0, String(exempt.taxAmount));
  check('Σ group taxes === sale taxAmount', sum(result.groups.map(g => g.taxAmount)) === result.taxAmount);
  check('sale taxAmount 91.80', result.taxAmount === 91.8, String(result.taxAmount));
  check('Σ bases === taxable base', sum(result.groups.map(g => g.taxableAmount)) === 900);
}

// ── Case 2: legacy parity, no classes ───────────────────────────────
console.log('Case 2: no classes — byte-identical to base * (defaultTax/100)');
{
  const base = 1234.56;
  const rate = 17;
  const result = computeSaleTax({
    lines: [{ lineTotal: 700, taxClassId: null }, { lineTotal: 534.56, taxClassId: null }],
    classes: [],
    defaultTaxRate: rate,
    subtotal: 1234.56,
    taxableBase: base
  });
  const legacy = base * (rate / 100);
  check('one implicit group', result.groups.length === 1 && result.groups[0].taxClassId === null);
  check('taxAmount === legacy formula (exact float)', result.taxAmount === legacy,
    `${result.taxAmount} vs ${legacy}`);
  check('group name is Default', result.groups[0].className === 'Default');
}

// ── Case 3: rounding residue goes to the largest group ──────────────
console.log('Case 3: three groups, base 100.01 — bases must sum exactly');
{
  const classes = [
    { id: 'a', name: 'A', rate: 17, isActive: true },
    { id: 'b', name: 'B', rate: 5, isActive: true },
    { id: 'c', name: 'C', rate: 1, isActive: true }
  ];
  const result = computeSaleTax({
    lines: [
      { lineTotal: 100, taxClassId: 'a' },
      { lineTotal: 100, taxClassId: 'b' },
      { lineTotal: 100, taxClassId: 'c' }
    ],
    classes,
    defaultTaxRate: 17,
    subtotal: 300,
    taxableBase: 100.01
  });
  check('three groups', result.groups.length === 3);
  check('Σ bases === 100.01', Math.abs(sum(result.groups.map(g => g.taxableAmount)) - 100.01) < 1e-9,
    JSON.stringify(result.groups.map(g => g.taxableAmount)));
  check('Σ group taxes === sale taxAmount', sum(result.groups.map(g => g.taxAmount)) === result.taxAmount);
}

// ── Case 4: fallback resolution ─────────────────────────────────────
console.log('Case 4: no-class + retired-class products fall back to the default class / setting');
{
  const classes = [
    { id: 'std', name: 'Standard', rate: 17, isDefault: true, isActive: true },
    { id: 'old', name: 'Old Rate', rate: 16, isDefault: false, isActive: false }
  ];
  const result = computeSaleTax({
    lines: [
      { lineTotal: 200, taxClassId: null },   // no class → default class
      { lineTotal: 300, taxClassId: 'old' }   // retired class → default class
    ],
    classes,
    defaultTaxRate: 5,
    subtotal: 500,
    taxableBase: 500
  });
  check('single group at the default class', result.groups.length === 1 && result.groups[0].taxClassId === 'std',
    JSON.stringify(result.groups));
  check('taxed at 17%, not the 5% setting', result.taxAmount === 500 * (17 / 100), String(result.taxAmount));

  const noDefault = computeSaleTax({
    lines: [{ lineTotal: 200, taxClassId: null }],
    classes: [{ id: 'x', name: 'Other', rate: 9, isDefault: false, isActive: true }],
    defaultTaxRate: 5,
    subtotal: 200,
    taxableBase: 200
  });
  check('no default class → defaultTax setting group', noDefault.groups.length === 1
    && noDefault.groups[0].taxClassId === null && noDefault.groups[0].rate === 5);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll tax-engine checks passed.');
