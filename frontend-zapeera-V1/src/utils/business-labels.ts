// Per-business-type UI labels — the ONE place that decides what a
// sellable item is CALLED for each industry (business-type labels fix,
// 2026-11-11). Before this helper, the product form and several other
// surfaces hardcoded the pharmacy noun ("Add New Medicine", "Medicine
// Name", "Formula/Composition") for every business type, so a retail
// store, hotel or clinic read pharmacy language throughout.
//
// Owner terminology ruling (Muhammad, 2026-11-11 15:41): the item noun
// is "Product" for EVERY business type, PHARMACY included — pharmacies
// also sell non-medical products, so generic phrases are used
// everywhere. The one label that stays type-specific is the stored
// `formula` field (owner correction, 2026-11-11 15:44): PHARMACY calls
// it "Formula"; every other type calls it "Ingredients / Composition".
// Pharmacy wording that is NOT the item noun stays untouched (the
// tablets base-unit word in utils/units.ts, the PCT 3004 example).
//
// Type resolution goes through resolveCanonicalBusinessTypeKey so the
// legacy retail aliases (DEPARTMENTAL_STORE etc.) resolve to
// RETAIL_STORE, matching utils/category-types.ts and the backend's
// module-applicability.util.ts.

import { resolveCanonicalBusinessTypeKey } from "./category-types";

export const CANONICAL_BUSINESS_TYPE_KEYS = ["PHARMACY", "RETAIL_STORE", "HOTEL", "CLINIC"] as const;

/** True for one of the four canonical types (after alias resolution). */
export function isCanonicalBusinessTypeKey(businessType: unknown): boolean {
  return (CANONICAL_BUSINESS_TYPE_KEYS as readonly string[]).includes(
    resolveCanonicalBusinessTypeKey(businessType),
  );
}

/** True when the business is a pharmacy (canonical key === PHARMACY). */
export function isPharmacyBusinessType(businessType: unknown): boolean {
  return resolveCanonicalBusinessTypeKey(businessType) === "PHARMACY";
}

export interface BusinessTypeLabels {
  /** Singular capitalised noun for one sellable item: "Product" for every type (owner ruling, 2026-11-11). */
  itemNoun: string;
  /** Plural capitalised: "Products" for every type. */
  itemNounPlural: string;
  /** Lower-case singular: "product" for every type. */
  itemNounLower: string;
  /** Lower-case plural: "products" for every type. */
  itemNounPluralLower: string;
  /** Placeholder example for the product-name field. */
  nameExample: string;
  /** Label of the stored `formula` field. */
  compositionLabel: string;
  /** Placeholder for the stored `formula` field. */
  compositionPlaceholder: string;
}

/** The item noun is "Product" for EVERY business type (owner ruling,
 * 2026-11-11 15:41 — pharmacies also sell non-medical products). */
const ITEM_NOUNS: Pick<BusinessTypeLabels, "itemNoun" | "itemNounPlural" | "itemNounLower" | "itemNounPluralLower"> = {
  itemNoun: "Product",
  itemNounPlural: "Products",
  itemNounLower: "product",
  itemNounPluralLower: "products",
};

/**
 * The standardised per-type label set. Only the composition label and
 * the name example differ per type:
 *   PHARMACY     → "Formula" (owner correction, 2026-11-11 15:44),
 *                  "e.g., Paracetamol 500mg" example (a product name)
 *   RETAIL_STORE → "Ingredients / Composition", "Sugar 1kg" example
 *   HOTEL        → "Ingredients / Composition", minibar-style example
 *   CLINIC       → "Ingredients / Composition", consumables example
 *   custom/other → "Ingredients / Composition", neutral example
 */
export function businessTypeLabels(businessType: unknown): BusinessTypeLabels {
  const canonical = resolveCanonicalBusinessTypeKey(businessType);
  switch (canonical) {
    case "PHARMACY":
      return {
        ...ITEM_NOUNS,
        nameExample: "e.g., Paracetamol 500mg",
        compositionLabel: "Formula",
        compositionPlaceholder:
          "Enter product formula or composition (e.g., Paracetamol 500mg, Lactose, Starch)",
      };
    case "RETAIL_STORE":
      return {
        ...ITEM_NOUNS,
        nameExample: "e.g., Sugar 1kg",
        compositionLabel: "Ingredients / Composition",
        compositionPlaceholder: "Enter ingredients or composition (e.g., Sugar, Wheat Flour, Salt)",
      };
    case "HOTEL":
      return {
        ...ITEM_NOUNS,
        nameExample: "e.g., Mineral Water 1.5L",
        compositionLabel: "Ingredients / Composition",
        compositionPlaceholder: "Enter ingredients or composition",
      };
    case "CLINIC":
      return {
        ...ITEM_NOUNS,
        nameExample: "e.g., Surgical Gloves (Box of 100)",
        compositionLabel: "Ingredients / Composition",
        compositionPlaceholder: "Enter ingredients or composition",
      };
    default:
      return {
        ...ITEM_NOUNS,
        nameExample: "Enter product name",
        compositionLabel: "Ingredients / Composition",
        compositionPlaceholder: "Enter ingredients or composition",
      };
  }
}
