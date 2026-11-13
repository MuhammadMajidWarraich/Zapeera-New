// Quotation totals (v1.0.22) — pure, so the math can be verified on
// fixtures without a database (tests/v1022-calculations.test.ts).
//
// DEFINITIONS (mirrors the sale totals pipeline, minus the parts a
// quotation cannot have — no promotions, no loyalty, no payments):
//   · Each line: levelQty × unitPrice − line discount. `quantity` is
//     BASE units and `unitPrice` is per LEVEL unit (the SaleItem C2
//     contract), so the level quantity is quantity / unitFactor and
//     the line total is levelQty × unitPrice − discount.
//   · A line discount is a flat amount (discountAmount). A percentage
//     on a line is NOT supported — the editor sends amounts only.
//   · subtotal = Σ line totals (after line discounts).
//   · Sale-level discount: discountPercentage (against the subtotal)
//     takes precedence over a flat discountAmount — the same rule
//     createSale applies.
//   · taxAmount is computed by the caller (tax engine over the
//     post-discount base) and passed in; this module only assembles
//     the totals. Quotations carry the tax snapshot so the offered
//     price matches what the converted sale will charge.
//   · total = subtotal − sale discount + tax.

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface QuotationLineInput {
  /** Base units (tablets/pieces/grams). */
  quantity: number;
  /** Base units per selling level (1 when no level applies). */
  unitFactor?: number | null;
  /** Price per LEVEL unit. */
  unitPrice: number;
  /** Flat line discount, PKR. */
  discountAmount?: number | null;
}

export interface QuotationLineTotal {
  lineTotal: number;
  levelQuantity: number;
}

export function computeQuotationLineTotal(line: QuotationLineInput): QuotationLineTotal {
  const factor = Math.max(1, Number(line.unitFactor) || 1);
  const levelQuantity = (Number(line.quantity) || 0) / factor;
  const gross = levelQuantity * (Number(line.unitPrice) || 0);
  const discount = Math.min(Math.max(0, Number(line.discountAmount) || 0), gross);
  return { lineTotal: round2(gross - discount), levelQuantity };
}

export interface QuotationTotalsInput {
  lines: QuotationLineInput[];
  discountPercentage?: number | null;
  discountAmount?: number | null;
  /** Tax on the post-discount base, computed by the caller. */
  taxAmount?: number | null;
}

export interface QuotationTotals {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  lineTotals: number[];
}

export function computeQuotationTotals(input: QuotationTotalsInput): QuotationTotals {
  const lineTotals = input.lines.map((l) => computeQuotationLineTotal(l).lineTotal);
  const subtotal = round2(lineTotals.reduce((sum, t) => sum + t, 0));
  const pct = Number(input.discountPercentage) || 0;
  const discountAmount =
    pct > 0
      ? round2((subtotal * pct) / 100)
      : round2(Math.min(Math.max(0, Number(input.discountAmount) || 0), subtotal));
  const taxAmount = round2(Math.max(0, Number(input.taxAmount) || 0));
  return {
    subtotal,
    discountAmount,
    taxAmount,
    totalAmount: round2(subtotal - discountAmount + taxAmount),
    lineTotals,
  };
}
