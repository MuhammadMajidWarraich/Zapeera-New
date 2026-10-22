// Product variants (Wave C6 — Retail pack): the size x colour matrix.
//
// THE MODEL:
//   • A ProductVariant is a purchasable flavour of a product ("Large /
//     Red"). It carries no stock of its own: stock lives on batches,
//     and a batch either belongs to one variant (Batch.variantId) or
//     to the product's BASE pool (variantId null).
//   • THE ISOLATION RULE (the only non-confusing one, enforced by the
//     sale engine through variantBatchWhere below):
//       - a sale line naming a variant consumes ONLY that variant's
//         batches (FEFO within the pool);
//       - a sale line naming no variant, on a product that HAS active
//         variants, consumes ONLY base-pool batches;
//       - a sale line on a product with NO variants sees every batch
//         exactly as before C6 (they are all base-pool by construction)
//         — the legacy path is untouched.
//   • Price: a variant's priceDelta adjusts its batches' sellingPrice.
//     The POS pre-fills the line unitPrice as batch price + delta
//     (variantUnitPrice); the server never forces it — unitPrice has
//     always been client-sent and server-totalled.
//   • Reports/COGS need no variant awareness: a variant is a dimension
//     on the sale line (variantId + variantName snapshot), never a new
//     quantity basis — quantity/unitsDeducted mean what they meant.

/** Half-up rounding to 2 decimal places (money in this codebase). */
const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface VariantAttributes {
  size?: string | null;
  color?: string | null;
  [key: string]: string | null | undefined;
}

/** Normalize one attribute value: trim, empty → null. */
export const normalizeAttrValue = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
};

/**
 * Normalize an attributes object: known keys first (size, color),
 * values trimmed, empties dropped. Unknown keys are kept (the matrix
 * is free-form pairs) but an object with no usable values → null.
 */
export function normalizeAttributes(input: unknown): Record<string, string> | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    const value = normalizeAttrValue(raw);
    if (value) out[String(key).trim().toLowerCase()] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * The display name built from attributes: size first, then color,
 * then any remaining keys alphabetically — "Large / Red". Falls back
 * to the provided fallback (or "Variant") when attributes are empty.
 */
export function buildVariantName(attributes: Record<string, string> | null, fallback?: string | null): string {
  if (attributes) {
    const parts: string[] = [];
    const used = new Set<string>();
    for (const key of ['size', 'color']) {
      if (attributes[key]) {
        parts.push(attributes[key]);
        used.add(key);
      }
    }
    for (const key of Object.keys(attributes).sort()) {
      if (!used.has(key) && attributes[key]) parts.push(attributes[key]);
    }
    if (parts.length > 0) return parts.join(' / ');
  }
  const fb = normalizeAttrValue(fallback);
  return fb || 'Variant';
}

export interface VariantMatrixEntry {
  name: string;
  attributes: Record<string, string>;
}

/**
 * The size x colour matrix: every size paired with every colour.
 * With only one axis present the matrix is that axis alone. Inputs
 * are trimmed and de-duplicated case-insensitively (first spelling
 * wins). An empty axis list yields no entries — a matrix needs at
 * least one axis value.
 */
export function buildVariantMatrix(sizes: unknown, colors: unknown): VariantMatrixEntry[] {
  const cleanAxis = (values: unknown): string[] => {
    if (!Array.isArray(values)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of values) {
      const value = normalizeAttrValue(raw);
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
    }
    return out;
  };

  const sizeList = cleanAxis(sizes);
  const colorList = cleanAxis(colors);
  const entries: VariantMatrixEntry[] = [];

  if (sizeList.length > 0 && colorList.length > 0) {
    for (const size of sizeList) {
      for (const color of colorList) {
        const attributes = { size, color };
        entries.push({ name: buildVariantName(attributes), attributes });
      }
    }
  } else {
    for (const size of sizeList) {
      const attributes = { size };
      entries.push({ name: buildVariantName(attributes), attributes });
    }
    for (const color of colorList) {
      const attributes = { color };
      entries.push({ name: buildVariantName(attributes), attributes });
    }
  }
  return entries;
}

/**
 * The batch-pool filter for one sale line — THE isolation rule as a
 * Prisma where fragment:
 *   line names a variant        → { variantId: <that variant> }
 *   no variant, product has some → { variantId: null } (base pool)
 *   no variant, product has none → {} (legacy: no constraint at all)
 */
export function variantBatchWhere(
  lineVariantId: string | null | undefined,
  productHasActiveVariants: boolean
): { variantId: string } | { variantId: null } | Record<string, never> {
  if (lineVariantId) return { variantId: lineVariantId };
  if (productHasActiveVariants) return { variantId: null };
  return {};
}

/**
 * Predicate form of the same rule, for in-memory batch lists (and the
 * self-check): may a line draw from a batch whose variantId is
 * `batchVariantId`?
 */
export function batchBelongsToLinePool(
  batchVariantId: string | null | undefined,
  lineVariantId: string | null | undefined,
  productHasActiveVariants: boolean
): boolean {
  if (lineVariantId) return (batchVariantId ?? null) === lineVariantId;
  if (productHasActiveVariants) return (batchVariantId ?? null) === null;
  return true;
}

/** The unit price the POS pre-fills for a variant line. */
export function variantUnitPrice(batchSellingPrice: number, priceDelta: number | null | undefined): number {
  const base = Number(batchSellingPrice) || 0;
  const delta = Number(priceDelta) || 0;
  return Math.max(0, round2(base + delta));
}
