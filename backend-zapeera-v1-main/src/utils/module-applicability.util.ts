/**
 * Industry applicability — the canonical module → business-type map.
 *
 * WHY THIS EXISTS (2026-10-22): module applicability used to live ONLY in
 * the `business_type_modules` table, and the boot seeders filled that
 * table with EVERY catalog module enabled for EVERY business type. Each
 * industry pack that shipped (Wave C4 clinic, C5 hotel) therefore lit up
 * in pharmacies and stores too — sidebar, /modules/enabled payload and
 * API alike (verified live: a PHARMACY business answered GET /rooms and
 * GET /patients with 200). Plan entitlements are deliberately wide (the
 * plan axis trusts the type axis), so nothing downstream caught it.
 *
 * This map is the code-level authority. It is enforced as a HARD DENY in
 * the authorization resolver (evaluateModuleLayers +
 * authorizeBusinessAction Layer 2) and in the legacy checkModule
 * middleware — independent of business_type_modules rows, plan
 * entitlements and business_modules rows — and the boot seeders seed /
 * gap-fill business_type_modules PER this map (and disable wrong-industry
 * rows left over from the poisoned seeding).
 *
 * RULES:
 * - A module NOT listed here applies to ALL business types (the shared
 *   core: dashboard, sales, inventory, purchases, reports,
 *   business_management, expenses, subscription, employee_portal,
 *   stock_takes, and everything inside the sales/inventory families —
 *   khata, loyalty, promotions, tax classes, FBR, accounting ride those
 *   families and have no separate restricted key).
 * - A module listed here applies ONLY to the listed canonical types.
 *   Product variants have no module key (they live inside inventory).
 * - Enforcement applies to the four canonical business types. A custom /
 *   unknown type key falls through to the DB-driven gates, preserving
 *   legacy behaviour for backoffice-defined types.
 */

export const CANONICAL_BUSINESS_TYPES = [
  'PHARMACY',
  'RETAIL_STORE',
  'HOTEL',
  'CLINIC',
] as const;

/**
 * Legacy business-type values that resolve to a canonical type
 * (business-types overhaul, 2026-10-31): DEPARTMENTAL_STORE was merged
 * into RETAIL_STORE — Muhammad's decision, backed by competitor research
 * (0 of 8 competitors in Zapeera's comparison set treat "departmental
 * store" as a separate industry; all use one Retail bucket). The boot
 * seeder (modules.util ensureBusinessTypesExist) rewrites stored
 * business rows to RETAIL_STORE; these aliases keep any not-yet-migrated
 * or externally supplied value behaving as retail in the meantime.
 * Marketing keeps BOTH names — this merge is system-side only.
 */
export const LEGACY_BUSINESS_TYPE_ALIASES: Readonly<Record<string, string>> = {
  STORE: 'RETAIL_STORE',
  DEPARTMENT_STORE: 'RETAIL_STORE',
  DEPARTMENTAL_STORE: 'RETAIL_STORE',
  SUPERMARKET: 'RETAIL_STORE',
  GROCERY_STORE: 'RETAIL_STORE',
};

/** Normalize a business-type value and resolve legacy aliases to canonical. */
export function resolveCanonicalBusinessTypeKey(value: unknown): string {
  const key = normalizeBusinessTypeKey(value);
  return LEGACY_BUSINESS_TYPE_ALIASES[key] || key;
}

/** module key (normalized) → the ONLY canonical business types it belongs to. */
export const MODULE_BUSINESS_TYPE_APPLICABILITY: Readonly<Record<string, readonly string[]>> = {
  // Pharmacy pack
  prescriptions: ['PHARMACY'],
  // Clinic pack
  patients: ['CLINIC'],
  doctors: ['CLINIC'],
  appointments: ['CLINIC'],
  // Hotel pack
  rooms: ['HOTEL'],
  reservations: ['HOTEL'],
  folios: ['HOTEL'],
  front_desk: ['HOTEL'],
};

export function normalizeModuleKey(value: unknown): string {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function normalizeBusinessTypeKey(value: unknown): string {
  return String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

export function isCanonicalBusinessType(value: unknown): boolean {
  return (CANONICAL_BUSINESS_TYPES as readonly string[]).includes(resolveCanonicalBusinessTypeKey(value));
}

/**
 * True when `moduleKey` may be used by a business of type `businessType`.
 * Unlisted modules → all types. Listed modules → only the listed canonical
 * types; non-canonical/unknown types are NOT decided here (returns true so
 * the DB-driven gates keep their legacy say for custom types).
 */
export function isModuleApplicableToBusinessType(moduleKey: unknown, businessType: unknown): boolean {
  const allowed = MODULE_BUSINESS_TYPE_APPLICABILITY[normalizeModuleKey(moduleKey)];
  if (!allowed) return true;
  const typeKey = resolveCanonicalBusinessTypeKey(businessType);
  if (!(CANONICAL_BUSINESS_TYPES as readonly string[]).includes(typeKey)) return true;
  return allowed.includes(typeKey);
}

// Loose / by-weight selling (Stage 1, 2026-10-26) — Muhammad's standing
// rule (2026-10-26): "Harr business type me uss business type ke related
// sb kuch hona chahiye" — a business type gets only its own features.
// Weight selling belongs to general retail only: RETAIL_STORE (which
// since the 2026-10-31 overhaul also covers former departmental
// stores). PHARMACY, HOTEL, CLINIC and anything else must never see it
// and must never be able to sell by weight.
//
// NOTE on the map above: it is the registry for whole MODULES, and its
// contract lets unknown/custom types fall through to the DB-driven gates.
// Weight selling is a SUB-feature inside the shared sales/inventory core
// (no module key, no Layer-2 hook), so it is gated here instead — and
// FAIL-CLOSED, because there is no DB-driven gate behind this check:
// an unknown type is denied, not allowed. The frontend mirrors this
// list (src/utils/units.ts) so the UI never offers KG where the API
// would refuse it.
export const WEIGHT_SELLING_BUSINESS_TYPES = ['RETAIL_STORE'] as const;

export function isWeightSellingAllowedForBusinessType(businessType: unknown): boolean {
  // Legacy aliases resolve to the canonical retail type (the boot
  // seeder migrates stored values; the entitlement map agrees).
  const canonical = resolveCanonicalBusinessTypeKey(businessType);
  return (WEIGHT_SELLING_BUSINESS_TYPES as readonly string[]).includes(canonical);
}
