/**
 * Canonical policy READ shaping.
 *
 * The backoffice policy editors (Plans, Roles) are boolean checkbox UIs,
 * while the canonical policy stores are level/operation granular:
 *   - plans:  plan_entitlements (moduleKey, pageKey|null, entitlementLevel)
 *   - roles:  role_permissions_v2 (modulePage -> operation grants)
 *
 * These pure functions translate canonical rows into the editors' long-
 * standing response contract:
 *   modules:            string[]  — enabled module keys (lowercase)
 *   subModules:         string[]  — "module::page" composites explicitly ON
 *   disabledSubModules: string[]  — "module::page" composites explicitly OFF
 *
 * The mapping intentionally matches the semantics the wave-3 publish
 * mirror used when it wrote canonical state into the legacy matrix
 * tables (enabled = level !== 'NONE'), so a read -> republish cycle is a
 * no-op: the editor only ever sends back what the canonical store holds.
 *
 * IMPORTANT (default-deny): for roles, a catalog page of an enabled
 * module that carries NO grant must be reported in disabledSubModules.
 * The editors render any page NOT listed there as enabled, so omitting
 * an ungranted page would silently resurrect it on the next republish.
 */

export interface PlanEntitlementRowLike {
  moduleKey: string;
  pageKey: string | null;
  entitlementLevel: string;
}

export interface RolePermissionRowLike {
  moduleKey: string;
  pageKey: string;
  allowed: boolean;
}

export interface PermissionShape {
  modules: string[];
  subModules: string[];
  disabledSubModules: string[];
}

const norm = (v: string): string => String(v ?? '').trim().toLowerCase();

/**
 * plan_entitlements rows for ONE plan -> editor checkbox state.
 * Module-level row (pageKey = null): module is enabled iff level != NONE
 * (FULL and LIMITED both read as enabled — the boolean editor cannot
 * represent LIMITED, exactly as the legacy mirror encoded it).
 * Page-level row: composite is ON iff level != NONE, OFF iff NONE.
 */
export function planEntitlementsToPermissionShape(
  rows: PlanEntitlementRowLike[]
): PermissionShape {
  const modules = new Set<string>();
  const subModules = new Set<string>();
  const disabledSubModules = new Set<string>();

  for (const row of rows || []) {
    const moduleKey = norm(row.moduleKey);
    if (!moduleKey) continue;
    const enabled = String(row.entitlementLevel ?? '').toUpperCase() !== 'NONE';
    if (row.pageKey == null) {
      if (enabled) modules.add(moduleKey);
    } else {
      const composite = `${moduleKey}::${norm(row.pageKey)}`;
      if (enabled) subModules.add(composite);
      else disabledSubModules.add(composite);
    }
  }

  return {
    modules: Array.from(modules).sort(),
    subModules: Array.from(subModules).sort(),
    disabledSubModules: Array.from(disabledSubModules).sort(),
  };
}

/**
 * role_permissions_v2 rows for ONE role -> editor checkbox state.
 * A module is enabled iff the role holds at least one allowed grant in
 * it; a page is ON iff it holds at least one allowed grant. Every other
 * catalog page of an enabled module is reported disabled (see the
 * default-deny note above). `catalogPagesByModule` maps module key ->
 * its catalog page keys (any case; normalized here).
 */
export function rolePermissionsToPermissionShape(
  rows: RolePermissionRowLike[],
  catalogPagesByModule: Map<string, string[]>
): PermissionShape {
  const grantedPages = new Set<string>();
  const grantedModules = new Set<string>();

  for (const row of rows || []) {
    if (!row.allowed) continue;
    const moduleKey = norm(row.moduleKey);
    const pageKey = norm(row.pageKey);
    if (!moduleKey || !pageKey) continue;
    grantedPages.add(`${moduleKey}::${pageKey}`);
    grantedModules.add(moduleKey);
  }

  const disabledSubModules = new Set<string>();
  for (const moduleKey of grantedModules) {
    for (const rawPage of catalogPagesByModule.get(moduleKey) || []) {
      const composite = `${moduleKey}::${norm(rawPage)}`;
      if (!grantedPages.has(composite)) disabledSubModules.add(composite);
    }
  }

  return {
    modules: Array.from(grantedModules).sort(),
    subModules: Array.from(grantedPages).sort(),
    disabledSubModules: Array.from(disabledSubModules).sort(),
  };
}
