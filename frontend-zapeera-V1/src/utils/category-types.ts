// Per-industry category types — frontend mirror of the backend's
// src/utils/category-types.util.ts (business-types overhaul,
// 2026-10-31). Keep the two in sync: the API refuses a category type
// outside the owning business's industry set, so the UI must never
// offer one.
//
//   PHARMACY     → MEDICAL / NON_MEDICAL / GENERAL
//   RETAIL_STORE → FOOD / NON_FOOD / GENERAL  (departmental stores
//                  merged into retail; legacy DEPARTMENTAL_STORE values
//                  resolve to RETAIL_STORE)
//   HOTEL        → GENERAL only (selector hidden)
//   CLINIC       → GENERAL only (selector hidden)
//
// Non-canonical / custom business types fall through to the legacy
// (pharmacy) set, mirroring the backend.

export type CategoryTypeValue = 'MEDICAL' | 'NON_MEDICAL' | 'FOOD' | 'NON_FOOD' | 'GENERAL';

export const CATEGORY_TYPE_LABELS: Readonly<Record<string, string>> = {
  MEDICAL: 'Medical',
  NON_MEDICAL: 'Non-Medical',
  FOOD: 'Food',
  NON_FOOD: 'Non-Food',
  GENERAL: 'General',
};

export const PHARMACY_CATEGORY_TYPES: readonly CategoryTypeValue[] = ['MEDICAL', 'NON_MEDICAL', 'GENERAL'];
export const RETAIL_CATEGORY_TYPES: readonly CategoryTypeValue[] = ['FOOD', 'NON_FOOD', 'GENERAL'];
export const GENERAL_ONLY_CATEGORY_TYPES: readonly CategoryTypeValue[] = ['GENERAL'];

/** Pre-overhaul universal set — fall-through for custom/unknown types. */
export const LEGACY_CATEGORY_TYPES = PHARMACY_CATEGORY_TYPES;

export const CATEGORY_TYPES_BY_BUSINESS_TYPE: Readonly<Record<string, readonly CategoryTypeValue[]>> = {
  PHARMACY: PHARMACY_CATEGORY_TYPES,
  RETAIL_STORE: RETAIL_CATEGORY_TYPES,
  HOTEL: GENERAL_ONLY_CATEGORY_TYPES,
  CLINIC: GENERAL_ONLY_CATEGORY_TYPES,
};

const LEGACY_BUSINESS_TYPE_ALIASES: Readonly<Record<string, string>> = {
  STORE: 'RETAIL_STORE',
  DEPARTMENT_STORE: 'RETAIL_STORE',
  DEPARTMENTAL_STORE: 'RETAIL_STORE',
  SUPERMARKET: 'RETAIL_STORE',
  GROCERY_STORE: 'RETAIL_STORE',
};

export function normalizeBusinessTypeKey(value: unknown): string {
  return String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

export function resolveCanonicalBusinessTypeKey(value: unknown): string {
  const key = normalizeBusinessTypeKey(value);
  return LEGACY_BUSINESS_TYPE_ALIASES[key] || key;
}

/** Allowed Category.type values for a business of the given type. */
export function getAllowedCategoryTypes(businessType: unknown): readonly CategoryTypeValue[] {
  const canonical = resolveCanonicalBusinessTypeKey(businessType);
  return CATEGORY_TYPES_BY_BUSINESS_TYPE[canonical] || LEGACY_CATEGORY_TYPES;
}

export interface CategoryTypeOption {
  value: CategoryTypeValue;
  label: string;
}

/** Select options for the category form / filter of this business. */
export function getCategoryTypeOptions(businessType: unknown): CategoryTypeOption[] {
  return getAllowedCategoryTypes(businessType).map((value) => ({
    value,
    label: CATEGORY_TYPE_LABELS[value] || value,
  }));
}

/** Human label for any stored category type value. */
export function categoryTypeLabel(value: unknown): string {
  const key = String(value || '').trim().toUpperCase();
  if (!key) return 'General';
  return CATEGORY_TYPE_LABELS[key] || key.charAt(0) + key.slice(1).toLowerCase().replace(/_/g, ' ');
}
