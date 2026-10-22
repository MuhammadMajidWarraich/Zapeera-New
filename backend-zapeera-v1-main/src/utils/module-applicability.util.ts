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
 * - Enforcement applies to the five canonical business types. A custom /
 *   unknown type key falls through to the DB-driven gates, preserving
 *   legacy behaviour for backoffice-defined types.
 */

export const CANONICAL_BUSINESS_TYPES = [
  'PHARMACY',
  'DEPARTMENTAL_STORE',
  'RETAIL_STORE',
  'HOTEL',
  'CLINIC',
] as const;

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
  return (CANONICAL_BUSINESS_TYPES as readonly string[]).includes(normalizeBusinessTypeKey(value));
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
  const typeKey = normalizeBusinessTypeKey(businessType);
  if (!(CANONICAL_BUSINESS_TYPES as readonly string[]).includes(typeKey)) return true;
  return allowed.includes(typeKey);
}
