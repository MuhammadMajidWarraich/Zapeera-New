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

/** Greedy packs → strips → loose tablets breakdown of a base-unit qty. */
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
  if (packs > 0) parts.push(`${packs} pack${packs === 1 ? "" : "s"}`);
  if (strips > 0) parts.push(`${strips} strip${strips === 1 ? "" : "s"}`);
  if (rest > 0 || parts.length === 0) parts.push(`${rest} tablet${rest === 1 ? "" : "s"}`);
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

export function levelLabel(level: UnitLevel, qty?: number): string {
  const plural = qty !== undefined && qty !== 1;
  switch (level) {
    case "PACK":
      return plural ? "packs" : "pack";
    case "STRIP":
      return plural ? "strips" : "strip";
    case "UNIT":
      return plural ? "tablets" : "tablet";
  }
}

/**
 * Receipt phrasing for a stored C2 sale line: "2 strips (20 tablets)".
 * Stored C2 lines keep quantity in BASE units, so the entered level
 * quantity is quantity / unitFactor. Returns null for UNIT lines.
 */
export function describeStoredLine(item: {
  quantity: number;
  unitLevel?: string | null;
  unitFactor?: number | null;
}): string | null {
  const level = (item.unitLevel || "").toUpperCase();
  const factor = item.unitFactor || 0;
  if ((level !== "PACK" && level !== "STRIP") || factor <= 1) return null;
  const levelQty = item.quantity / factor;
  return `${levelQty} ${levelLabel(level as UnitLevel, levelQty)} (${item.quantity} tablets)`;
}
