// Per-business-type UI labels — the ONE place that decides what a
// sellable item is CALLED for each industry (business-type labels fix,
// 2026-11-11). Before this helper, the product form and several other
// surfaces hardcoded the pharmacy noun ("Add New Medicine", "Medicine
// Name", "Formula/Composition") for every business type, so a retail
// store, hotel or clinic read pharmacy language throughout.
//
// The rule mirrors baseUnitWordForBusinessType (utils/units.ts): only
// PHARMACY counts "medicines / tablets"; every other type sells
// PRODUCTS counted in pieces. Pharmacy strings here are the EXACT
// strings the UI shipped with — a pharmacy must see no wording change.
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
  /** Singular capitalised noun for one sellable item: "Medicine" | "Product". */
  itemNoun: string;
  /** Plural capitalised: "Medicines" | "Products". */
  itemNounPlural: string;
  /** Lower-case singular: "medicine" | "product". */
  itemNounLower: string;
  /** Lower-case plural: "medicines" | "products". */
  itemNounPluralLower: string;
  /** Placeholder example for the product-name field. */
  nameExample: string;
  /** Label of the stored `formula` field. */
  compositionLabel: string;
  /** Placeholder for the stored `formula` field. */
  compositionPlaceholder: string;
}

const PHARMACY_LABELS: BusinessTypeLabels = {
  itemNoun: "Medicine",
  itemNounPlural: "Medicines",
  itemNounLower: "medicine",
  itemNounPluralLower: "medicines",
  nameExample: "e.g., Paracetamol 500mg",
  compositionLabel: "Formula/Composition",
  compositionPlaceholder:
    "Enter product formula or composition (e.g., Paracetamol 500mg, Lactose, Starch)",
};

const PRODUCT_LABELS: Omit<BusinessTypeLabels, "nameExample" | "compositionLabel" | "compositionPlaceholder"> = {
  itemNoun: "Product",
  itemNounPlural: "Products",
  itemNounLower: "product",
  itemNounPluralLower: "products",
};

/**
 * The standardised per-type label set:
 *   PHARMACY     → Medicine / Formula/Composition (unchanged legacy wording)
 *   RETAIL_STORE → Product / Ingredients / Composition, "Sugar 1kg" example
 *   HOTEL        → Product / Composition / Details, minibar-style example
 *   CLINIC       → Product / Composition / Details, consumables example
 *   custom/other → Product with neutral examples (legacy fall-through)
 */
export function businessTypeLabels(businessType: unknown): BusinessTypeLabels {
  const canonical = resolveCanonicalBusinessTypeKey(businessType);
  switch (canonical) {
    case "PHARMACY":
      return PHARMACY_LABELS;
    case "RETAIL_STORE":
      return {
        ...PRODUCT_LABELS,
        nameExample: "e.g., Sugar 1kg",
        compositionLabel: "Ingredients / Composition",
        compositionPlaceholder: "Enter ingredients or composition (e.g., Sugar, Wheat Flour, Salt)",
      };
    case "HOTEL":
      return {
        ...PRODUCT_LABELS,
        nameExample: "e.g., Mineral Water 1.5L",
        compositionLabel: "Composition / Details",
        compositionPlaceholder: "Enter composition or item details",
      };
    case "CLINIC":
      return {
        ...PRODUCT_LABELS,
        nameExample: "e.g., Surgical Gloves (Box of 100)",
        compositionLabel: "Composition / Details",
        compositionPlaceholder: "Enter composition or item details",
      };
    default:
      return {
        ...PRODUCT_LABELS,
        nameExample: "Enter product name",
        compositionLabel: "Composition",
        compositionPlaceholder: "Enter composition or item details",
      };
  }
}
