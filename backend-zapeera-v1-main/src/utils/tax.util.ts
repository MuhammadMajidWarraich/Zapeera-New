// Tax classes engine (Wave B5).
//
// Before B5 a sale carried ONE tax rate: the admin's `defaultTax`
// setting applied to the whole post-discount base. B5 lets a business
// define named TaxClass rows (rate groups) and point products at them,
// so a mixed cart — standard-rated goods next to exempt ones — taxes
// each part at its own rate. This module is the whole engine; the
// sale controller only resolves inputs and persists outputs.
//
// RESOLUTION (per product line):
//   1. The product's taxClassId, when that class exists, belongs to
//      the company and isActive → the class (its CURRENT rate; the
//      applied name/rate are snapshotted onto the sale, so later
//      edits never rewrite history).
//   2. Otherwise — no class, or the class was retired/deleted — the
//      company's DEFAULT handling: its isDefault class when one is
//      active, else the `defaultTax` setting rate under the implicit
//      group name "Default" (taxClassId null).
//
// MATH:
//   · The taxable base is the sale's post-discount subtotal — the
//     amount left after the manual discount, promotions and loyalty
//     (the exact base the legacy single-rate code taxed).
//   · Each line contributes its share of that base pro-rata by line
//     value (lineTotal / subtotal), grouped by resolved class.
//   · INVARIANT: Σ group taxAmount === the sale's stored taxAmount,
//     because the sale's taxAmount IS the sum of the group taxes.
//   · A single group keeps the LEGACY formula byte-for-byte —
//     base × (rate / 100), unrounded — so a company with no classes
//     (every sale to date) computes exactly what it computed before.
//   · With several groups, each group's base is rounded to cents and
//     any residue against the sale base is assigned to the largest
//     group, so Σ taxableAmount === the sale base to the cent; group
//     taxes are rounded to cents and summed into the sale tax.

export interface TaxClassLike {
  id: string;
  name: string;
  rate: number;
  isDefault?: boolean | null;
  isActive?: boolean | null;
}

export interface TaxEngineLine {
  /** Line total after item-level discounts (the sale's subtotal part). */
  lineTotal: number;
  /** The product's stored tax class id, or null. */
  taxClassId?: string | null;
}

export interface TaxGroup {
  /** Null for the implicit default group (defaultTax setting rate). */
  taxClassId: string | null;
  className: string;
  /** Percent snapshot. */
  rate: number;
  taxableAmount: number;
  taxAmount: number;
}

export interface SaleTaxResult {
  taxAmount: number;
  groups: TaxGroup[];
}

export const IMPLICIT_DEFAULT_CLASS_NAME = 'Default';

const round2 = (n: number): number => Math.round(n * 100) / 100;

interface ResolvedRate {
  taxClassId: string | null;
  className: string;
  rate: number;
}

/**
 * The rate a line falls back to when its product has no usable class:
 * the company's active isDefault class, else the defaultTax setting.
 */
export const resolveDefaultRate = (
  classes: TaxClassLike[],
  defaultTaxRate: number
): ResolvedRate => {
  const fallback = classes.find(c => c.isDefault && c.isActive !== false);
  if (fallback) {
    return { taxClassId: fallback.id, className: fallback.name, rate: Number(fallback.rate) || 0 };
  }
  return { taxClassId: null, className: IMPLICIT_DEFAULT_CLASS_NAME, rate: defaultTaxRate };
};

/** The rate one line resolves to (its class, or the default handling). */
export const resolveLineRate = (
  line: TaxEngineLine,
  classesById: Map<string, TaxClassLike>,
  defaultRate: ResolvedRate
): ResolvedRate => {
  if (line.taxClassId) {
    const cls = classesById.get(line.taxClassId);
    if (cls && cls.isActive !== false) {
      return { taxClassId: cls.id, className: cls.name, rate: Number(cls.rate) || 0 };
    }
  }
  return defaultRate;
};

/**
 * Computes a sale's tax as per-class groups. `subtotal` is the sum of
 * the line totals (pre order-level discounts); `taxableBase` is the
 * post-discount amount actually taxed (subtotal − manual discount −
 * promotions − loyalty). Returns the groups in first-appearance
 * order; the caller stores Σ group taxes as the sale's taxAmount.
 */
export const computeSaleTax = (input: {
  lines: TaxEngineLine[];
  classes: TaxClassLike[];
  defaultTaxRate: number;
  subtotal: number;
  taxableBase: number;
}): SaleTaxResult => {
  const { lines, classes, defaultTaxRate, subtotal, taxableBase } = input;
  const classesById = new Map<string, TaxClassLike>(classes.map(c => [c.id, c]));
  const defaultRate = resolveDefaultRate(classes, defaultTaxRate);

  // Group line value by resolved rate (insertion-ordered).
  const byKey = new Map<string, { resolved: ResolvedRate; lineSum: number }>();
  for (const line of lines) {
    const resolved = resolveLineRate(line, classesById, defaultRate);
    const key = resolved.taxClassId ?? '__default__';
    const entry = byKey.get(key);
    if (entry) {
      entry.lineSum += line.lineTotal;
    } else {
      byKey.set(key, { resolved, lineSum: line.lineTotal });
    }
  }
  // A sale always produces at least the implicit default group, so
  // reporting/FBR always have a row — even for an all-zero cart.
  if (byKey.size === 0) {
    byKey.set('__default__', { resolved: defaultRate, lineSum: 0 });
  }

  const entries = [...byKey.values()];

  // Single group → the legacy formula, unrounded, byte-identical to
  // the pre-B5 computation (base is the whole taxable base).
  if (entries.length === 1) {
    const { resolved } = entries[0];
    const taxAmount = taxableBase * (resolved.rate / 100);
    return {
      taxAmount,
      groups: [{
        taxClassId: resolved.taxClassId,
        className: resolved.className,
        rate: resolved.rate,
        taxableAmount: taxableBase,
        taxAmount
      }]
    };
  }

  // Several groups → pro-rate the base by line value, rounding each
  // group's base to cents; the largest group absorbs the residue so
  // the bases sum exactly to the sale's taxable base.
  const shares = entries.map(({ resolved, lineSum }) => ({
    resolved,
    base: subtotal > 0 ? round2(taxableBase * (lineSum / subtotal)) : 0
  }));
  const roundedSum = shares.reduce((sum, s) => sum + s.base, 0);
  const residue = round2(taxableBase - roundedSum);
  if (residue !== 0) {
    let largest = 0;
    for (let i = 1; i < shares.length; i++) {
      if (shares[i].base > shares[largest].base) largest = i;
    }
    shares[largest].base = round2(shares[largest].base + residue);
  }

  const groups: TaxGroup[] = shares.map(({ resolved, base }) => ({
    taxClassId: resolved.taxClassId,
    className: resolved.className,
    rate: resolved.rate,
    taxableAmount: base,
    taxAmount: round2(base * (resolved.rate / 100))
  }));
  return {
    taxAmount: round2(groups.reduce((sum, g) => sum + g.taxAmount, 0)),
    groups
  };
};

/**
 * Shapes a sale's stored SaleTaxLine rows into the `taxBreakdown`
 * array API responses carry. Accepts a sale object whose `taxLines`
 * relation was included; anything else yields an empty array (pre-B5
 * sales have no rows — their receipts keep the legacy single-rate
 * rendering, which shows no breakdown at all).
 */
export const serializeTaxBreakdown = (sale: any): Array<{
  taxClassId: string | null;
  className: string;
  rate: number;
  taxableAmount: number;
  taxAmount: number;
}> => {
  if (!sale || !Array.isArray(sale.taxLines)) return [];
  return sale.taxLines.map((line: any) => ({
    taxClassId: line.taxClassId ?? null,
    className: line.className,
    rate: Number(line.rate),
    taxableAmount: Number(line.taxableAmount),
    taxAmount: Number(line.taxAmount)
  }));
};
