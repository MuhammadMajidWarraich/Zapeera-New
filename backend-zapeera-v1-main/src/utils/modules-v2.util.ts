/**
 * Module Access Control V2 — frontend-facing resolver.
 *
 * This module keeps the LEGACY exported surface used by the module controller,
 * the module-access middleware and the frontend /modules/enabled payload, but
 * ALL decisions now delegate to the canonical authorization service
 * (src/services/authorization.service.ts).
 *
 * Security changes baked in:
 *  - No owner synthesis from business.createdBy — an explicit ACTIVE
 *    membership is required (NO_ACTIVE_MEMBERSHIP otherwise).
 *  - No "empty permission set = allowed" fallback: plans/roles default deny
 *    until a policy is published (permissionState CONFIGURED). Zero grants in
 *    a CONFIGURED policy deny everything non-core.
 *  - No FULL_OPERATION_SET fallback for roles without V2 rows — removed.
 *    getFallbackOperationGrantCount() is retained (always 0) for API
 *    compatibility and is asserted by tests.
 *  - Subscription state is part of the decision (SUBSCRIPTION_INACTIVE).
 *  - Operations are per page/resource; never merged across pages.
 *  - Dependencies are evaluated against effective access for the same
 *    business/user, with cycle detection.
 */

import { PrismaClient } from '@prisma/client';
import MODULE_HIERARCHY from '../config/module-hierarchy';
import { MODULE_PAGES } from '../config/module-route-protection.config';
import {
  loadAuthContext,
  evaluateModuleLayers,
  checkPlanEntitlesResource,
  FULL_OPERATION_SET,
  type AuthContext,
} from '../services/authorization.service';
import { authPolicyCache } from './auth-policy-cache';

export { FULL_OPERATION_SET };

// ====================================
// Types & Interfaces
// ====================================

export interface ModulePageOperations {
  allowedOperations: string[];
  blockedOperations: string[];
}

export interface ModuleAccessResultV2 {
  moduleKey: string;
  moduleName: string;
  icon: string;
  enabled: boolean;
  reason: AccessReason;
  typeAllowed: boolean;
  planAllowed: boolean;
  businessOverrideDisabled: boolean;
  roleAllowed: boolean;
  dependencyBlocked: boolean;
  allowedOperations: string[];     // module-wide union (sidebar/UX)
  blockedOperations: string[];     // module-wide union (sidebar/UX)
  pageOperations: Record<string, ModulePageOperations>;  // per-page ops (API enforcement)
  fallbackFullOps: boolean;        // always false — legacy fallback removed
}

export type AccessReason =
  | 'ALLOWED'
  | 'BUSINESS_TYPE_RESTRICTED'     // legacy reason name for BUSINESS_TYPE_DENIED
  | 'SUBSCRIPTION_NOT_ENTITLED'    // legacy reason name for PLAN_NOT_ENTITLED
  | 'SUBSCRIPTION_INACTIVE'
  | 'BUSINESS_OWNER_DISABLED'      // legacy reason name for BUSINESS_OVERRIDE_DENIED
  | 'ROLE_NO_ACCESS'               // legacy reason name for ROLE_DENIED
  | 'OPERATION_NOT_PERMITTED'      // legacy reason name for OPERATION_DENIED
  | 'MODULE_DEPENDENCY_MISSING'    // legacy reason name for DEPENDENCY_DENIED
  | 'PARENT_MODULE_DENIED'         // Parent module is denied (cascade)
  | 'UNKNOWN_ERROR';

export interface SubModuleAccessResult {
  key: string;                      // sub-module key (e.g. "pos")
  module: string;                   // parent module key (e.g. "sales")
  label: string;                    // display label
  enabled: boolean;                 // effective access
  parentAccessible: boolean;        // is the parent module itself accessible?
  businessTypeAllowed: boolean;     // business type allows this sub-module
  planEntitled: boolean;            // subscription plan includes this sub-module
  roleAllowed: boolean;             // user's role permits this sub-module
  primaryDenialReason: 'BUSINESS_TYPE' | 'SUBSCRIPTION_PLAN' | 'ROLE' | 'PARENT_MODULE' | null;
}

export interface ModuleAccessPayloadV2 {
  businessId: string;
  userId: string;
  roleName: string;
  modules: ModuleAccessResultV2[];
  subModuleResults: SubModuleAccessResult[];
  disabledSubModules: string[];     // computed from subModuleResults for backward compat
  computedAt: Date;
  cacheKey: string;
  cacheExpiresIn: number;           // milliseconds
}

export function mapAccessReasonToDisabledReason(
  reason: AccessReason | string
): 'BUSINESS_TYPE' | 'SUBSCRIPTION_PLAN' | 'ROLE' | 'PARENT_MODULE' | null {
  switch (reason) {
    case 'BUSINESS_TYPE_RESTRICTED':
    case 'BUSINESS_OWNER_DISABLED':
      return 'BUSINESS_TYPE';
    case 'SUBSCRIPTION_NOT_ENTITLED':
    case 'SUBSCRIPTION_INACTIVE':
    case 'MODULE_DEPENDENCY_MISSING':
      return 'SUBSCRIPTION_PLAN';
    case 'ROLE_NO_ACCESS':
    case 'OPERATION_NOT_PERMITTED':
      return 'ROLE';
    case 'PARENT_MODULE_DENIED':
      return 'PARENT_MODULE';
    default:
      return null;
  }
}

export interface LegacyModulePayloadItem {
  name: string;
  enabled: boolean;
  sortOrder: number;
  typeAllowed: boolean;
  planAllowed: boolean;
  roleAllowed: boolean;
  disabledReason: 'BUSINESS_TYPE' | 'SUBSCRIPTION_PLAN' | 'ROLE' | 'PARENT_MODULE' | null;
}

export function toLegacyModuleAccessPayload(payload: Pick<ModuleAccessPayloadV2, 'modules'>): {
  success: true;
  data: LegacyModulePayloadItem[];
  enabledModuleNames: string[];
} {
  const data: LegacyModulePayloadItem[] = payload.modules.map((m) => ({
    name: m.moduleKey,
    enabled: m.enabled,
    sortOrder: 0,
    typeAllowed: m.typeAllowed,
    planAllowed: m.planAllowed,
    roleAllowed: m.roleAllowed,
    disabledReason: m.enabled ? null : mapAccessReasonToDisabledReason(m.reason),
  }));
  const enabledModuleNames = data.filter((item) => item.enabled).map((item) => item.name);
  return { success: true, data, enabledModuleNames };
}

export interface DependencyCheckResult {
  satisfied: boolean;
  missingDependencies: string[];
  blockedByModules: string[];
}

// ====================================
// Cache (legacy shim over the shared versioned cache)
// ====================================

/**
 * Legacy cache facade retained for API compatibility. All new resolution goes
 * through the shared versioned cache in auth-policy-cache.ts (via
 * loadAuthContext). Clearing the facade clears the shared cache too, so the
 * two enforcement layers can never diverge (Issue 10).
 */
class ModuleAccessCacheFacade {
  getCacheKey(businessId: string, userId: string): string {
    return `${businessId}:${userId}`;
  }

  invalidate(key: string): void {
    authPolicyCache.clear();
  }

  invalidateByBusinessId(businessId: string): void {
    authPolicyCache.clear();
  }

  invalidateByUserId(userId: string): void {
    authPolicyCache.clear();
  }

  clear(): void {
    authPolicyCache.clear();
  }

  getStats() {
    return authPolicyCache.getStats();
  }
}

export const moduleAccessCache = new ModuleAccessCacheFacade();

// ====================================
// Seed data (module definitions + pages + operations)
// ====================================

let _seedDataEnsured = false;

function getDefaultModuleIcon(moduleKey: string): string {
  const iconMap: Record<string, string> = {
    sales: 'ShoppingCart',
    inventory: 'Package',
    customers: 'Users',
    suppliers: 'Truck',
    purchases: 'Receipt',
    business_management: 'Building',
    expenses: 'DollarSign',
    reports: 'BarChart3',
    subscription: 'CreditCard',
    dashboard: 'LayoutDashboard',
    employee_portal: 'Briefcase',
  };

  return iconMap[moduleKey] || 'Box';
}

export async function ensureModuleAccessV2SeedData(prisma: PrismaClient): Promise<void> {
  if (_seedDataEnsured) return;
  const moduleDefinitionModel = (prisma as any).moduleDefinition;
  const modulePageModel = (prisma as any).modulePage;
  const operationModel = (prisma as any).operation;
  const legacyModuleModel = (prisma as any).module;

  if (!moduleDefinitionModel?.findMany || !modulePageModel?.upsert || !operationModel?.upsert || !legacyModuleModel?.findMany) {
    return;
  }

  const operations = [
    { key: 'read', name: 'Read', sortOrder: 1 },
    { key: 'create', name: 'Create', sortOrder: 2 },
    { key: 'update', name: 'Update', sortOrder: 3 },
    { key: 'delete', name: 'Delete', sortOrder: 4 },
    { key: 'export', name: 'Export', sortOrder: 5 },
    { key: 'approve', name: 'Approve', sortOrder: 6 },
    { key: 'print', name: 'Print', sortOrder: 7 },
  ];

  for (const operation of operations) {
    await operationModel.upsert({
      where: { key: operation.key },
      update: {},
      create: {
        key: operation.key,
        name: operation.name,
        sortOrder: operation.sortOrder,
      },
    });
  }

  const legacyModules = await legacyModuleModel.findMany({
    select: { id: true, name: true, displayName: true, description: true },
  });

  const legacyModuleKeys = new Set<string>();

  const ensurePages = async (moduleId: string, moduleKey: string, fallbackName: string) => {
    const pageKeys = MODULE_PAGES[moduleKey] || ['overview'];
    for (const pageKey of pageKeys) {
      await modulePageModel.upsert({
        where: { moduleId_key: { moduleId, key: pageKey } },
        update: {},
        create: {
          moduleId,
          key: pageKey,
          name: pageKey === 'overview' ? `${fallbackName} Overview` : fallbackName,
          route: pageKey === 'overview' ? `/${moduleKey}` : null,
          sortOrder: 0,
          isActive: true,
        },
      });
    }
  };

  const CORE_MODULES = new Set(['dashboard', 'subscription']);

  const upsertDefinition = async (moduleKey: string, displayName: string, icon: string, description: string) => {
    const createdDefinition = await moduleDefinitionModel.upsert({
      where: { key: moduleKey },
      update: {
        name: displayName,
        icon,
        description,
        route: `/${moduleKey}`,
        isActive: true,
        isCore: CORE_MODULES.has(moduleKey),
      },
      create: {
        key: moduleKey,
        name: displayName,
        icon,
        description,
        route: `/${moduleKey}`,
        isActive: true,
        sortOrder: 0,
        isCore: CORE_MODULES.has(moduleKey),
      },
    });
    await ensurePages(createdDefinition.id, moduleKey, displayName);
  };

  for (const legacyModule of legacyModules) {
    const moduleKey = normalizeModuleKey(legacyModule.name);
    legacyModuleKeys.add(moduleKey);
    await upsertDefinition(
      moduleKey,
      legacyModule.displayName || legacyModule.name,
      getDefaultModuleIcon(moduleKey),
      legacyModule.description || `${legacyModule.displayName || legacyModule.name} module`
    );
  }

  for (const hierMod of MODULE_HIERARCHY) {
    const moduleKey = normalizeModuleKey(hierMod.module);
    if (legacyModuleKeys.has(moduleKey)) continue;
    await upsertDefinition(moduleKey, hierMod.label, hierMod.icon || getDefaultModuleIcon(moduleKey), `${hierMod.label} module`);
  }

  _seedDataEnsured = true;
}

// ====================================
// Per-page operation resolution (no legacy fallback)
// ====================================

export async function getPermittedOperationsByPage(
  prisma: PrismaClient,
  module: any,
  membership: any
): Promise<{
  allowedOperations: string[];
  blockedOperations: string[];
  pageOperations: Record<string, ModulePageOperations>;
  fallbackFullOps: boolean;
}> {
  const empty: ModulePageOperations = { allowedOperations: [], blockedOperations: [] };

  if (!membership?.role) {
    return { allowedOperations: [], blockedOperations: [], pageOperations: {}, fallbackFullOps: false };
  }

  const roleName = String(membership.role.name || '').toUpperCase();

  // Owner is a protected system role: full operations on every page (still
  // subject to business type / subscription / plan / override layers).
  if (roleName === 'OWNER') {
    const pages = (await (prisma as any).modulePage?.findMany?.({ where: { moduleId: module.id } })) || [];
    const pageOperations: Record<string, ModulePageOperations> = {};
    for (const page of pages) {
      pageOperations[page.key] = { allowedOperations: [...FULL_OPERATION_SET], blockedOperations: [] };
    }
    return {
      allowedOperations: [...FULL_OPERATION_SET],
      blockedOperations: [],
      pageOperations,
      fallbackFullOps: false,
    };
  }

  // No published role policy → default deny (no operation grants at all).
  if (String(membership.role.permissionState || 'UNCONFIGURED').toUpperCase() !== 'CONFIGURED') {
    const pages = (await (prisma as any).modulePage?.findMany?.({ where: { moduleId: module.id } })) || [];
    const pageOperations: Record<string, ModulePageOperations> = {};
    for (const page of pages) {
      pageOperations[page.key] = { allowedOperations: [], blockedOperations: [] };
    }
    return { allowedOperations: [], blockedOperations: [], pageOperations, fallbackFullOps: false };
  }

  const pages = (await (prisma as any).modulePage?.findMany?.({ where: { moduleId: module.id } })) || [];
  const rolePermissions = Array.isArray((membership as any)?.role?.permissionsV2)
    ? (membership as any).role.permissionsV2
    : [];

  const allowed: Set<string> = new Set();
  const blocked: Set<string> = new Set();
  const pageOperations: Record<string, ModulePageOperations> = {};

  for (const page of pages) {
    const pageAllowed: Set<string> = new Set();
    const pageBlocked: Set<string> = new Set();

    for (const permission of rolePermissions) {
      if (String(permission.modulePageId) === String(page.id)) {
        if (permission.allowed) {
          pageAllowed.add(permission.operationKey);
          allowed.add(permission.operationKey);
        } else {
          pageBlocked.add(permission.operationKey);
          blocked.add(permission.operationKey);
        }
      }
    }

    pageOperations[page.key] = {
      allowedOperations: Array.from(pageAllowed),
      blockedOperations: Array.from(pageBlocked),
    };
  }

  return {
    allowedOperations: Array.from(allowed),
    blockedOperations: Array.from(blocked),
    pageOperations,
    fallbackFullOps: false,
  };
}

// ── Fallback measurement (legacy API, always zero — fallback removed) ────

export function getFallbackOperationGrantCount(): number {
  return 0;
}

export function resetFallbackOperationGrantCount(): void {
  /* no-op: the migration fallback was removed in the canonical rewrite */
}

// ====================================
// Main Resolver (delegates to the canonical service)
// ====================================

function normalizeModuleKey(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export async function getModuleAccessV2(
  prisma: PrismaClient,
  businessId: string,
  userId: string,
  options?: {
    skipCache?: boolean;
    skipDependencyCheck?: boolean;
    roleName?: string;
  }
): Promise<ModuleAccessPayloadV2> {
  const context = await loadAuthContext(prisma, businessId, userId);

  if (!context.membership || String(context.membership.status).toUpperCase() !== 'ACTIVE') {
    throw new Error(`User not member of business: ${userId} in ${businessId}`);
  }

  await ensureModuleAccessV2SeedData(prisma);

  const roleName = String(context.role?.name || options?.roleName || 'GUEST').toUpperCase();

  const modules: ModuleAccessResultV2[] = [];
  for (const moduleDef of context.moduleDefs.values()) {
    modules.push(await evaluateModuleForPayload(prisma, context, moduleDef, options));
  }

  // ── Parent-child cascade ─────────────────────────────────────────────
  const parentChildMap = new Map<string, string[]>();
  for (const hierMod of MODULE_HIERARCHY) {
    const children = hierMod.subModules
      .filter((s) => s.key !== hierMod.module)
      .map((s) => normalizeModuleKey(s.key));
    if (children.length > 0) {
      parentChildMap.set(normalizeModuleKey(hierMod.module), children);
    }
  }

  const moduleResultMap = new Map(modules.map((m) => [m.moduleKey, m]));

  for (const [parentKey, childKeys] of parentChildMap.entries()) {
    const parentResult = moduleResultMap.get(parentKey);
    if (parentResult && !parentResult.enabled) {
      for (const childKey of childKeys) {
        const childResult = moduleResultMap.get(childKey);
        if (childResult && childResult.enabled) {
          childResult.enabled = false;
          childResult.reason = 'PARENT_MODULE_DENIED';
        }
      }
    }
  }

  // ── Sub-module evaluation (canonical page-level gates) ────────────────
  const subModuleResults: SubModuleAccessResult[] = [];

  for (const hierMod of MODULE_HIERARCHY) {
    const parentKey = normalizeModuleKey(hierMod.module);
    const parentResult = moduleResultMap.get(parentKey);
    const parentAccessible = parentResult?.enabled ?? false;
    const parentModuleDef = context.moduleDefs.get(parentKey);

    for (const sub of hierMod.subModules) {
      const subKey = normalizeModuleKey(sub.key);
      const compositeKey = `${parentKey}::${subKey}`;
      const label = sub.label || subKey;

      if (!parentAccessible) {
        subModuleResults.push({
          key: subKey,
          module: parentKey,
          label,
          enabled: false,
          parentAccessible: false,
          businessTypeAllowed: true,
          planEntitled: true,
          roleAllowed: true,
          primaryDenialReason: 'PARENT_MODULE',
        });
        continue;
      }

      let page: any = null;
      if (parentModuleDef) {
        page = (context.pagesByModule.get(String(parentModuleDef.id)) || []).find((p) => normalizeModuleKey(p.key) === subKey) || null;
      }

      const businessTypeAllowed = page ? !context.businessTypeDisabledPages.has(String(page.id)) : true;
      const planEntitled = checkPlanEntitlesResource(context, parentKey, subKey) !== 'DENIED';
      const roleAllowed = subModuleRoleAllows(context, page);

      const enabled = businessTypeAllowed && planEntitled && roleAllowed;

      let primaryDenialReason: SubModuleAccessResult['primaryDenialReason'] = null;
      if (!businessTypeAllowed) {
        primaryDenialReason = 'BUSINESS_TYPE';
      } else if (!planEntitled) {
        primaryDenialReason = 'SUBSCRIPTION_PLAN';
      } else if (!roleAllowed) {
        primaryDenialReason = 'ROLE';
      }

      subModuleResults.push({
        key: subKey,
        module: parentKey,
        label,
        enabled,
        parentAccessible: true,
        businessTypeAllowed,
        planEntitled,
        roleAllowed,
        primaryDenialReason,
      });
    }
  }

  const disabledSubModules = subModuleResults
    .filter((s) => !s.enabled)
    .map((s) => `${s.module}::${s.key}`);

  const payload: ModuleAccessPayloadV2 = {
    businessId,
    userId,
    roleName,
    modules,
    subModuleResults,
    disabledSubModules,
    computedAt: new Date(),
    cacheKey: moduleAccessCache.getCacheKey(businessId, userId),
    cacheExpiresIn: 60 * 1000, // shared versioned cache hard TTL
  };

  return payload;
}

function subModuleRoleAllows(context: AuthContext, page: any | null): boolean {
  const roleName = String(context.role?.name || '').toUpperCase();
  if (roleName === 'OWNER') return true;
  if (!context.role) return false;
  if (String(context.role.permissionState || 'UNCONFIGURED').toUpperCase() !== 'CONFIGURED') return false;
  if (!page) return false;
  return context.rolePermissions.some((p) => String(p.modulePageId) === String(page.id) && !!p.allowed);
}

async function evaluateModuleForPayload(
  prisma: PrismaClient,
  context: AuthContext,
  moduleDef: any,
  options?: { skipDependencyCheck?: boolean }
): Promise<ModuleAccessResultV2> {
  const moduleKey = normalizeModuleKey(moduleDef.key || moduleDef.name || moduleDef.id);

  const layer = await evaluateModuleLayers(prisma, context, moduleDef, 'read', {
    skipDependencyCheck: options?.skipDependencyCheck,
  });

  if (!layer.allowed) {
    const reason = toLegacyReason(layer.reason);
    const typeAllowed = layer.reason !== 'BUSINESS_TYPE_DENIED';
    const planAllowed = layer.reason === 'ALLOWED' || layer.reason === 'BUSINESS_OVERRIDE_DENIED' || layer.reason === 'ROLE_DENIED' || layer.reason === 'OPERATION_DENIED' || layer.reason === 'DEPENDENCY_DENIED' || layer.reason === 'NO_ACTIVE_MEMBERSHIP';
    return {
      moduleKey,
      moduleName: moduleDef.name,
      icon: moduleDef.icon,
      enabled: false,
      reason,
      typeAllowed,
      planAllowed,
      businessOverrideDisabled: layer.reason === 'BUSINESS_OVERRIDE_DENIED',
      roleAllowed: false,
      dependencyBlocked: layer.reason === 'DEPENDENCY_DENIED',
      allowedOperations: [],
      blockedOperations: [],
      pageOperations: {},
      fallbackFullOps: false,
    };
  }

  // Role gate (module level)
  const roleName = String(context.role?.name || '').toUpperCase();
  let roleAllowed = true;
  if (roleName !== 'OWNER') {
    roleAllowed =
      !!context.role &&
      String(context.role.permissionState || 'UNCONFIGURED').toUpperCase() === 'CONFIGURED' &&
      context.rolePermissions.some((p) => {
        const page = context.pageById.get(String(p.modulePageId));
        return page && String(page.moduleId) === String(moduleDef.id) && !!p.allowed;
      });
  }

  if (!roleAllowed) {
    return {
      moduleKey,
      moduleName: moduleDef.name,
      icon: moduleDef.icon,
      enabled: false,
      reason: 'ROLE_NO_ACCESS',
      typeAllowed: true,
      planAllowed: true,
      businessOverrideDisabled: false,
      roleAllowed: false,
      dependencyBlocked: false,
      allowedOperations: [],
      blockedOperations: [],
      pageOperations: {},
      fallbackFullOps: false,
    };
  }

  // Per-page operations (exact — no cross-page merging)
  const membershipWithPerms = {
    ...context.membership,
    role: { ...context.role, permissionsV2: context.rolePermissions },
  };
  const operations = await getPermittedOperationsByPage(prisma, moduleDef, membershipWithPerms);

  if (operations.allowedOperations.length === 0) {
    return {
      moduleKey,
      moduleName: moduleDef.name,
      icon: moduleDef.icon,
      enabled: false,
      reason: 'OPERATION_NOT_PERMITTED',
      typeAllowed: true,
      planAllowed: true,
      businessOverrideDisabled: false,
      roleAllowed: true,
      dependencyBlocked: false,
      allowedOperations: [],
      blockedOperations: operations.blockedOperations,
      pageOperations: operations.pageOperations,
      fallbackFullOps: false,
    };
  }

  return {
    moduleKey,
    moduleName: moduleDef.name,
    icon: moduleDef.icon,
    enabled: true,
    reason: 'ALLOWED',
    typeAllowed: true,
    planAllowed: true,
    businessOverrideDisabled: false,
    roleAllowed: true,
    dependencyBlocked: false,
    allowedOperations: operations.allowedOperations,
    blockedOperations: operations.blockedOperations,
    pageOperations: operations.pageOperations,
    fallbackFullOps: false,
  };
}

function toLegacyReason(reason: string): AccessReason {
  switch (reason) {
    case 'BUSINESS_TYPE_DENIED': return 'BUSINESS_TYPE_RESTRICTED';
    case 'PLAN_NOT_ENTITLED': return 'SUBSCRIPTION_NOT_ENTITLED';
    case 'BUSINESS_OVERRIDE_DENIED': return 'BUSINESS_OWNER_DISABLED';
    case 'ROLE_DENIED': return 'ROLE_NO_ACCESS';
    case 'OPERATION_DENIED': return 'OPERATION_NOT_PERMITTED';
    case 'DEPENDENCY_DENIED': return 'MODULE_DEPENDENCY_MISSING';
    case 'SUBSCRIPTION_INACTIVE': return 'SUBSCRIPTION_INACTIVE';
    case 'NO_ACTIVE_MEMBERSHIP': return 'ROLE_NO_ACCESS';
    case 'SCOPE_DENIED': return 'OPERATION_NOT_PERMITTED';
    case 'UNKNOWN_ERROR': return 'UNKNOWN_ERROR';
    default: return 'UNKNOWN_ERROR';
  }
}

// ====================================
// Cache Invalidation (bumps shared cache)
// ====================================

export type ModuleCacheInvalidationEvent =
  | { type: 'BUSINESS_TYPE_CHANGED'; businessId: string }
  | { type: 'PLAN_CHANGED'; businessId: string }
  | { type: 'ROLE_CHANGED'; userId: string }
  | { type: 'BUSINESS_OVERRIDE_CHANGED'; businessId: string }
  | { type: 'ROLE_PERMISSION_CHANGED'; userId: string }
  | { type: 'MODULE_DEPENDENCY_CHANGED' };

export function invalidateModuleCache(event: ModuleCacheInvalidationEvent) {
  // The shared cache is version-keyed, so explicit invalidation is a
  // belt-and-suspenders measure. Clearing everything is always safe.
  authPolicyCache.clear();
}

// ====================================
// Utility Functions
// ====================================

export async function preloadModuleCache(
  prisma: PrismaClient,
  businessId: string,
  userIds: string[]
): Promise<void> {
  for (const userId of userIds) {
    await getModuleAccessV2(prisma, businessId, userId, { skipCache: true });
  }
}

export function getCacheStats() {
  return moduleAccessCache.getStats();
}

export function clearModuleCache() {
  moduleAccessCache.clear();
}
