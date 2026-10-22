// Unit engine (Wave C2) — box → strip → tablet selling for
// pack-structured pharmacy products.
//
// THE MODEL (and how it maps onto what already existed before C2):
//   • Stock is counted in BASE units (tablets). `Batch.quantity` has
//     always been a base-unit count: batch creation takes
//     totalBoxes × unitsPerBox, and the sale engine decrements it by
//     `SaleItem.unitsDeducted`.
//   • `Batch.purchasePrice` / `Batch.sellingPrice` are per BASE unit
//     (the Batches form edits per-unit prices and derives per-box;
//     the POS derives a box price as sellingPrice × unitsPerBox).
//   • A product's pack structure is `unitsPerPack` (tablets per pack,
//     pre-C2) plus `unitsPerStrip` (tablets per strip, C2). A product
//     is "structured" when unitsPerPack > 1.
//   • Pre-C2 sale lines store `quantity` AS ENTERED (boxes for API
//     BOX lines; pieces for the web POS, which converts before it
//     submits) and `unitsDeducted` as the base units deducted. Every
//     stock-side consumer (availability, decrement, stock movements,
//     the promotions engine's `units`, refund restock via the
//     unitsDeducted/quantity ratio) already keys off unitsDeducted.
//
// C2 lines (the client sent `unitLevel`) store BOTH `quantity` and
// `unitsDeducted` as BASE units, plus the `unitLevel` + `unitFactor`
// snapshot. The entered level quantity is quantity / unitFactor, and
// the stored `unitPrice` is the price per LEVEL unit, so the stored
// `totalPrice` (level qty × unitPrice, computed by the sale engine
// from the request values exactly as before) remains the money
// truth, while every quantity-keyed consumer — stock, COGS
// (batch.purchasePrice × quantity in the reports/accounting), refund
// caps and amounts, khata/tax (money- and value-based) — reads base
// units with no changes of its own. Clients that send no unitLevel
// (voice, desktop, legacy BOX flows) keep the historical path
// byte-for-byte.
//
// PRICES: the engine works from the PACK price (the price of one
// whole pack). Per-level defaults are derived by division and
// rounded half-up to 2dp (paise). They are DEFAULTS only — the
// cashier can override a line's unitPrice at the POS, exactly as
// unitPrice has always been client-sent on sale lines. Note the POS
// batches carry a per-BASE-unit sellingPrice, so the POS derives the
// pack price first (sellingPrice × unitsPerPack) and then uses this
// same division; the two routes agree to the paisa.

export type UnitLevel = 'PACK' | 'STRIP' | 'UNIT';

export interface UnitStructure {
  unitsPerPack?: number | null;
  unitsPerStrip?: number | null;
}

export const UNIT_LEVELS: readonly UnitLevel[] = ['PACK', 'STRIP', 'UNIT'];

/** Half-up rounding to 2 decimal places (money in this codebase). */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** A product is pack-structured when one pack holds more than 1 base unit. */
export function isStructured(structure: UnitStructure): boolean {
  return !!structure.unitsPerPack && structure.unitsPerPack > 1;
}

/** Normalize a client-sent level ('pack', 'Strip', …) or return null. */
export function normalizeUnitLevel(raw: unknown): UnitLevel | null {
  if (typeof raw !== 'string') return null;
  const upper = raw.toUpperCase();
  return (UNIT_LEVELS as readonly string[]).includes(upper) ? (upper as UnitLevel) : null;
}

/**
 * Base units per one unit of `level` for this structure, or null when
 * the level does not exist for the product (STRIP with no
 * unitsPerStrip configured).
 */
export function unitFactor(level: UnitLevel, structure: UnitStructure): number | null {
  switch (level) {
    case 'UNIT':
      return 1;
    case 'PACK':
      return structure.unitsPerPack && structure.unitsPerPack > 0 ? structure.unitsPerPack : 1;
    case 'STRIP':
      return structure.unitsPerStrip && structure.unitsPerStrip > 0 ? structure.unitsPerStrip : null;
  }
}

/** Base units for `qty` units of `level`; null when the level is unavailable. */
export function toBase(qty: number, level: UnitLevel, structure: UnitStructure): number | null {
  const factor = unitFactor(level, structure);
  return factor === null ? null : qty * factor;
}

export interface StockBreakdown {
  packs: number;
  strips: number;
  units: number;
  /** e.g. "2 packs · 3 strips · 4 tablets"; "120 tablets" when unstructured. */
  text: string;
}

/**
 * Greedy display breakdown of a base-unit quantity into whole packs,
 * then whole strips, then loose base units. Unstructured products (or
 * quantities below one pack) degrade gracefully.
 */
export function breakdownStock(baseQty: number, structure: UnitStructure): StockBreakdown {
  const qty = Math.max(0, Math.floor(baseQty || 0));
  const perPack = structure.unitsPerPack && structure.unitsPerPack > 0 ? structure.unitsPerPack : 0;
  const perStrip = structure.unitsPerStrip && structure.unitsPerStrip > 0 ? structure.unitsPerStrip : 0;
  let packs = 0;
  let strips = 0;
  let rest = qty;
  if (perPack > 1) {
    packs = Math.floor(rest / perPack);
    rest -= packs * perPack;
    if (perStrip > 1 && perStrip < perPack) {
      strips = Math.floor(rest / perStrip);
      rest -= strips * perStrip;
    }
  }
  const parts: string[] = [];
  if (packs > 0) parts.push(`${packs} pack${packs === 1 ? '' : 's'}`);
  if (strips > 0) parts.push(`${strips} strip${strips === 1 ? '' : 's'}`);
  if (rest > 0 || parts.length === 0) parts.push(`${rest} tablet${rest === 1 ? '' : 's'}`);
  return { packs, strips, units: rest, text: parts.join(' · ') };
}

export interface LevelPrices {
  pack: number;
  strip: number | null; // null when the product has no strip level
  unit: number;
}

/**
 * Derive per-level selling prices from the price of ONE pack.
 * strip = pack / (strips per pack), unit = pack / unitsPerPack,
 * each rounded half-up to 2dp.
 */
export function deriveLevelPrices(packPrice: number, structure: UnitStructure): LevelPrices {
  const perPack = structure.unitsPerPack && structure.unitsPerPack > 0 ? structure.unitsPerPack : 1;
  const perStrip = structure.unitsPerStrip && structure.unitsPerStrip > 0 ? structure.unitsPerStrip : null;
  return {
    pack: round2(packPrice),
    // A pack holds (perPack / perStrip) strips, so one strip costs
    // packPrice / (perPack / perStrip) = packPrice × perStrip/perPack.
    strip: perStrip !== null ? round2((packPrice * perStrip) / perPack) : null,
    unit: round2(packPrice / perPack)
  };
}

/**
 * Same derivation starting from a per-BASE-unit price (the form
 * `Batch.sellingPrice` takes): pack = unit × unitsPerPack,
 * strip = unit × unitsPerStrip. Agrees with deriveLevelPrices
 * whenever packPrice = unitPrice × unitsPerPack.
 */
export function deriveLevelPricesFromUnitPrice(unitPrice: number, structure: UnitStructure): LevelPrices {
  const perPack = structure.unitsPerPack && structure.unitsPerPack > 0 ? structure.unitsPerPack : 1;
  return deriveLevelPrices(round2(unitPrice * perPack), structure);
}

/**
 * Validate a product's pack structure. Returns an error message, or
 * null when valid. Rule: when unitsPerStrip is set, unitsPerPack must
 * be a whole multiple of it (a pack must hold a whole number of
 * strips) — anything else makes strip pricing/stock ambiguous.
 */
export function validateUnitStructure(structure: UnitStructure): string | null {
  const perPack = structure.unitsPerPack ?? 1;
  const perStrip = structure.unitsPerStrip ?? null;
  if (!Number.isInteger(perPack) || perPack < 1) {
    return 'unitsPerPack must be a whole number of at least 1';
  }
  if (perStrip === null || perStrip === undefined) return null;
  if (!Number.isInteger(perStrip) || perStrip < 1) {
    return 'unitsPerStrip must be a whole number of at least 1';
  }
  if (perPack % perStrip !== 0) {
    return `unitsPerPack (${perPack}) must be a whole multiple of unitsPerStrip (${perStrip}) — a pack must hold a whole number of strips`;
  }
  return null;
}

export type ResolvedLineUnits =
  | { level: UnitLevel; factor: number; baseQty: number }
  | { error: string };

/**
 * Resolve a sale line that carries `unitLevel` against the product's
 * structure: the factor comes from the PRODUCT (server-authoritative;
 * any client-sent unitsDeducted/unitsPerBox is ignored for C2 lines),
 * and the base quantity must land on a whole number of base units.
 */
export function resolveSaleLineUnits(
  item: { quantity: number; unitLevel?: unknown },
  structure: UnitStructure,
  productName?: string
): ResolvedLineUnits {
  const level = normalizeUnitLevel(item.unitLevel);
  if (!level) {
    return { error: `Invalid unitLevel "${String(item.unitLevel)}" — expected PACK, STRIP or UNIT` };
  }
  const factor = unitFactor(level, structure);
  if (factor === null) {
    return {
      error: `${productName || 'Product'} is not sold by the ${level.toLowerCase()} — it has no strip size configured`
    };
  }
  const baseQty = item.quantity * factor;
  if (!Number.isFinite(baseQty) || baseQty <= 0 || !Number.isInteger(baseQty)) {
    return {
      error: `Quantity ${item.quantity} × ${factor} units per ${level.toLowerCase()} must be a whole number of base units`
    };
  }
  return { level, factor, baseQty };
}

/** Singular/plural display label for a level ("tablet" for UNIT). */
export function levelLabel(level: UnitLevel, qty?: number): string {
  const plural = qty !== undefined && qty !== 1;
  switch (level) {
    case 'PACK':
      return plural ? 'packs' : 'pack';
    case 'STRIP':
      return plural ? 'strips' : 'strip';
    case 'UNIT':
      return plural ? 'tablets' : 'tablet';
  }
}

/**
 * Receipt phrasing for a C2 line: "2 strips (20 tablets)". Returns
 * null for UNIT lines / factor 1, where the plain quantity already
 * says everything.
 */
export function describeLevelQuantity(baseQty: number, level: UnitLevel | null, factor: number | null): string | null {
  if (!level || level === 'UNIT' || !factor || factor <= 1) return null;
  const levelQty = baseQty / factor;
  return `${levelQty} ${levelLabel(level, levelQty)} (${baseQty} tablets)`;
}
