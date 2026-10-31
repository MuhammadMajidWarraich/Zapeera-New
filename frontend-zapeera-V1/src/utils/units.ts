// Unit engine (Wave C2) — frontend mirror of the backend's
// src/utils/unit.util.ts. Keep the math identical: stock is counted
// in BASE units (tablets); a product's pack structure is unitsPerPack
// (tablets per pack) + unitsPerStrip (tablets per strip). Per-level
// price defaults derive from the pack price by division, rounded
// half-up to 2dp; POS batches carry a per-BASE-unit sellingPrice, so
// the pack price is sellingPrice × unitsPerPack before dividing.

export type UnitLevel = "PACK" | "STRIP" | "UNIT";

export interface UnitStructure {
  unitsPerPack?: number | null;
  unitsPerStrip?: number | null;
  // Loose / by-weight selling (Stage 1): 'KG' = the product sells by
  // the kilo, stock counted in grams. breakdownStock renders it in kg.
  unitType?: string | null;
}

/** Grams in one kilo — the base-unit factor of a KG product. */
export const KG_GRAMS_PER_KG = 1000;

// Loose / by-weight selling (Stage 1) — business-type scoping
// (Muhammad's standing rule, 2026-10-26): a business type gets only
// its own features. Weight selling belongs to general retail only.
// Mirror of the backend's isWeightSellingAllowedForBusinessType
// (module-applicability.util.ts) — keep the two lists identical;
// the API refuses KG where this returns false, so the UI must never
// offer it there either. FAIL-CLOSED: any other/unknown type → false.
export const WEIGHT_SELLING_BUSINESS_TYPES = ["RETAIL_STORE"] as const;

export function normalizeBusinessTypeKey(value: unknown): string {
  return String(value || "").trim().toUpperCase().replace(/[\s-]+/g, "_");
}

export function isWeightSellingAllowedForBusinessType(businessType: unknown): boolean {
  const key = normalizeBusinessTypeKey(businessType);
  // Legacy aliases resolve to the canonical retail type
  // (DEPARTMENTAL_STORE merged into RETAIL_STORE on 2026-10-31).
  const canonical =
    key === "STORE" || key === "DEPARTMENT_STORE" || key === "DEPARTMENTAL_STORE" || key === "SUPERMARKET" || key === "GROCERY_STORE"
      ? "RETAIL_STORE"
      : key;
  return (WEIGHT_SELLING_BUSINESS_TYPES as readonly string[]).includes(canonical);
}

/** True when a product's unit type is the kilo ('KG', any case). */
export function isWeightUnitType(unitType: unknown): boolean {
  return String(unitType || "").trim().toUpperCase() === "KG";
}

// Base-unit word scoping (Muhammad, 2026-10-31): the unit engine counts
// in a nameless BASE unit; what that unit is CALLED is pharmacy language
// ("tablet") that leaked into every other business type — a grocery
// store's Sugar sold "by Tablet" on the POS. Only a pharmacy's base
// unit is a tablet; every other business type counts PIECES. Labels
// only — the stored unitLevel values (PACK / STRIP / UNIT) and all
// stock math are unchanged.
export type BaseUnitWord = "tablet" | "piece";

export function baseUnitWordForBusinessType(businessType: unknown): BaseUnitWord {
  return normalizeBusinessTypeKey(businessType) === "PHARMACY" ? "tablet" : "piece";
}

/** "tablet"/"piece" pluralised for a count (no count → plural form). */
export function baseUnitPlural(word: BaseUnitWord, qty?: number): string {
  return qty === 1 ? word : `${word}s`;
}

/** Grams → "0.500 kg" (3 dp, 1 g resolution). */
export function formatKgFromGrams(grams: number): string {
  return `${(grams / KG_GRAMS_PER_KG).toFixed(3)} kg`;
}

/**
 * POS card unit chip (2026-10-26 unit-label fix): the FULL text of the
 * unit chip on a PosProductCard. There is NO per-product base-unit word
 * in the data — Product carries no unitType column in this tree (the
 * loose-weight branch adds it as nullable 'KG'-only), so the old
 * `unitType || 'tablets'` fallback LIED on every non-medicine product
 * (a 5L oil can, Pampers and Desi Ghee all read "tablets"). Honest
 * rendering from real data only:
 *  - the only defined unitType value renders lowercased: 'KG'
 *    (weight branch) → 'kg'. Anything else is NOT a known unit and
 *    must never be passed through, or a stale 'tablets' value stored
 *    in the column would resurrect the lie;
 *  - otherwise the real pack copy, "Box of N" from unitsPerBox
 *    (unitsPerPack / batch unitsPerBox — genuine pack structure);
 *  - otherwise the neutral word "unit" (no box, no known unit).
 * A per-product word like "tablets"/"capsules" for pharmacy items
 * needs a real unit field + backfill — deliberately NOT guessed here
 * (not from the name, not from the category: categories are
 * therapeutic/departmental, never dosage forms).
 */
export function cardUnitChip(unitType?: string | null, unitsPerBox?: number | null): string {
  if (String(unitType || '').trim().toUpperCase() === 'KG') return 'kg';
  const box = unitsPerBox && unitsPerBox > 1 ? unitsPerBox : 0;
  if (box > 0) return `Box of ${box}`;
  return 'unit';
}

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function isStructured(structure: UnitStructure): boolean {
  return !!structure.unitsPerPack && structure.unitsPerPack > 1;
}

export function unitFactor(level: UnitLevel, structure: UnitStructure): number | null {
  switch (level) {
    case "UNIT":
      return 1;
    case "PACK":
      return structure.unitsPerPack && structure.unitsPerPack > 0 ? structure.unitsPerPack : 1;
    case "STRIP":
      return structure.unitsPerStrip && structure.unitsPerStrip > 0 ? structure.unitsPerStrip : null;
  }
}

export function toBase(qty: number, level: UnitLevel, structure: UnitStructure): number | null {
  const factor = unitFactor(level, structure);
  return factor === null ? null : qty * factor;
}

export interface StockBreakdown {
  packs: number;
  strips: number;
  units: number;
  text: string;
}

/** Greedy packs → strips → loose units breakdown of a base-unit qty.
 * Loose / by-weight selling (Stage 1): a KG product's stock is grams,
 * so the breakdown reads in kilos ("50.000 kg") — never "50 packs".
 * `looseUnit` names the leftover single units (default "tablet", the
 * pharmacy base unit the engine counts in). Callers that cannot know
 * the base unit — the POS card — pass "unit" so a non-medicine
 * product never reads "tablets" from a stock remainder. */
export function breakdownStock(baseQty: number, structure: UnitStructure, looseUnit = 'tablet'): StockBreakdown {
  const qty = Math.max(0, Math.floor(baseQty || 0));
  if (isWeightUnitType(structure.unitType)) {
    return { packs: 0, strips: 0, units: qty, text: formatKgFromGrams(qty) };
  }
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
  if (packs > 0) parts.push(`${packs} pack${packs === 1 ? "" : "s"}`);
  if (strips > 0) parts.push(`${strips} strip${strips === 1 ? "" : "s"}`);
  if (rest > 0 || parts.length === 0) parts.push(`${rest} ${looseUnit}${rest === 1 ? "" : "s"}`);
  return { packs, strips, units: rest, text: parts.join(" · ") };
}

export interface LevelPrices {
  pack: number;
  strip: number | null;
  unit: number;
}

/** Per-level prices from the price of ONE pack. */
export function deriveLevelPrices(packPrice: number, structure: UnitStructure): LevelPrices {
  const perPack = structure.unitsPerPack && structure.unitsPerPack > 0 ? structure.unitsPerPack : 1;
  const perStrip = structure.unitsPerStrip && structure.unitsPerStrip > 0 ? structure.unitsPerStrip : null;
  return {
    pack: round2(packPrice),
    strip: perStrip !== null ? round2((packPrice * perStrip) / perPack) : null,
    unit: round2(packPrice / perPack),
  };
}

/** Per-level prices from a per-BASE-unit price (Batch.sellingPrice). */
export function deriveLevelPricesFromUnitPrice(unitPrice: number, structure: UnitStructure): LevelPrices {
  const perPack = structure.unitsPerPack && structure.unitsPerPack > 0 ? structure.unitsPerPack : 1;
  return deriveLevelPrices(round2(unitPrice * perPack), structure);
}

/** Price of one unit of `level`, derived from a per-base-unit price. */
export function levelPriceFromUnitPrice(unitPrice: number, level: UnitLevel, structure: UnitStructure): number {
  const prices = deriveLevelPricesFromUnitPrice(unitPrice, structure);
  return level === "PACK" ? prices.pack : level === "STRIP" ? (prices.strip ?? prices.unit) : prices.unit;
}

export function levelLabel(level: UnitLevel, qty?: number, baseUnit: BaseUnitWord = "tablet"): string {
  const plural = qty !== undefined && qty !== 1;
  switch (level) {
    case "PACK":
      return plural ? "packs" : "pack";
    case "STRIP":
      return plural ? "strips" : "strip";
    case "UNIT":
      return plural ? `${baseUnit}s` : baseUnit;
  }
}

/**
 * Receipt phrasing for a stored C2 sale line: "2 strips (20 tablets)".
 * Stored C2 lines keep quantity in BASE units, so the entered level
 * quantity is quantity / unitFactor. Returns null for UNIT lines.
 * Loose / by-weight selling (Stage 1): a kilo line reads in kg
 * ("0.500 kg") — never "packs (N tablets)". The caller passes the
 * product's unitType when it has it (item.product.unitType).
 */
export function describeStoredLine(item: {
  quantity: number;
  unitLevel?: string | null;
  unitFactor?: number | null;
  unitType?: string | null;
}, baseUnit: BaseUnitWord = "tablet"): string | null {
  const level = (item.unitLevel || "").toUpperCase();
  const factor = item.unitFactor || 0;
  if ((level !== "PACK" && level !== "STRIP") || factor <= 1) return null;
  const levelQty = item.quantity / factor;
  if (level === "PACK" && factor === KG_GRAMS_PER_KG && isWeightUnitType(item.unitType)) {
    return `${levelQty.toFixed(3)} kg`;
  }
  return `${levelQty} ${levelLabel(level as UnitLevel, levelQty, baseUnit)} (${item.quantity} ${baseUnit}s)`;
}
