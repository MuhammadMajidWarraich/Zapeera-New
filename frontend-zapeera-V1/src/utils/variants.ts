// Product variants (Wave C6 — Retail pack): frontend mirror of the
// backend src/utils/variant.util.ts rules. The shapes must agree —
// the sale engine enforces the same isolation server-side; these
// helpers only drive POS display and the Variants manager.

export interface ProductVariantLite {
  id: string;
  name: string;
  sku?: string | null;
  barcode?: string | null;
  attributes?: Record<string, string> | null;
  priceDelta: number;
  isActive: boolean;
  stock?: number;
}

/** Trim + dedupe a free-text axis list (sizes or colours). */
export function normalizeAxisList(values: Array<string | null | undefined> | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values || []) {
    const text = String(raw ?? '').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

/** Display name for a variant's attribute set (size first, then color, then the rest alphabetically). */
export function buildVariantName(attributes: Record<string, string> | null | undefined): string {
  if (!attributes) return '';
  const entries = Object.entries(attributes)
    .map(([k, v]) => [k.trim(), String(v ?? '').trim()] as const)
    .filter(([k, v]) => k && v);
  const priority = (key: string) => {
    const lower = key.toLowerCase();
    if (lower === 'size') return 0;
    if (lower === 'color' || lower === 'colour') return 1;
    return 2;
  };
  entries.sort((a, b) => priority(a[0]) - priority(b[0]) || a[0].localeCompare(b[0]));
  return entries.map(([, v]) => v).join(' / ');
}

/** The size x colour matrix as name+attributes pairs (one axis may be empty). */
export function buildVariantMatrix(
  sizes: Array<string | null | undefined> | undefined,
  colors: Array<string | null | undefined> | undefined,
): Array<{ name: string; attributes: Record<string, string> }> {
  const sizeList = normalizeAxisList(sizes);
  const colorList = normalizeAxisList(colors);
  const out: Array<{ name: string; attributes: Record<string, string> }> = [];
  if (sizeList.length > 0 && colorList.length > 0) {
    for (const size of sizeList) {
      for (const color of colorList) {
        const attributes = { size, color };
        out.push({ attributes, name: buildVariantName(attributes) });
      }
    }
  } else if (sizeList.length > 0) {
    for (const size of sizeList) {
      const attributes = { size };
      out.push({ attributes, name: buildVariantName(attributes) });
    }
  } else if (colorList.length > 0) {
    for (const color of colorList) {
      const attributes = { color };
      out.push({ attributes, name: buildVariantName(attributes) });
    }
  }
  return out;
}

/**
 * THE STOCK-POOL RULE (mirrors the server): a batch belongs to a
 * cart line's pool when —
 *   line has a variant  → batch.variantId === that variant
 *   line has no variant → batch.variantId is null IF the product has
 *                          active variants; unconstrained otherwise.
 */
export function batchInLinePool(
  batchVariantId: string | null | undefined,
  lineVariantId: string | null | undefined,
  productHasActiveVariants: boolean,
): boolean {
  if (lineVariantId) return (batchVariantId ?? null) === lineVariantId;
  if (productHasActiveVariants) return (batchVariantId ?? null) === null;
  return true;
}

/** Per-unit price of a variant line: batch price + the variant's delta, never negative. */
export function variantUnitPrice(batchPrice: number, priceDelta: number | null | undefined): number {
  const total = (Number(batchPrice) || 0) + (Number(priceDelta) || 0);
  return Math.round(Math.max(0, total) * 100) / 100;
}
