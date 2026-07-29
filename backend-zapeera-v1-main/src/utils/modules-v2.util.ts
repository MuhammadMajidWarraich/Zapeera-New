/**
 * Module Access Control V2 - Enterprise Architecture
 * 
 * 9-Layer Access Decision Tree:
 * 1. Business Type Selection → determines available modules
 * 2. Subscription Entitlements → determines feature access
 * 3. Business Override → owner can disable specific modules
 * 4. Role Assignment → user's role in business
 * 5. Role-Based Module Access → role permits module access
 * 6. Role-Based Operation Permissions → role permits specific CRUD ops
 * 7. Module Dependency Resolution → module A depends on module B
 * 8. Route Guard Enforcement → frontend blocks navigation
 * 9. API Guard Enforcement → backend blocks requests
 * 
 * Replaces current: modules.util.ts (v1)
 * Status: WIP - Ready for Phase 2 implementation
 */

import { PrismaClient } from '@prisma/client';
import MODULE_HIERARCHY from '../config/module-hierarchy';

// ====================================
// Types & Interfaces
// ====================================

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
  allowedOperations: string[];     // ["read", "create"]
  blockedOperations: string[];     // ["delete", "export"]
}

export type AccessReason =
  | 'ALLOWED'
  | 'BUSINESS_TYPE_RESTRICTED'     // Layer 1
  | 'SUBSCRIPTION_NOT_ENTITLED'    // Layer 2
  | 'BUSINESS_OWNER_DISABLED'      // Layer 3
  | 'ROLE_NO_ACCESS'               // Layer 5
  | 'OPERATION_NOT_PERMITTED'      // Layer 6
  | 'MODULE_DEPENDENCY_MISSING'    // Layer 7
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

export interface DependencyCheckResult {
  satisfied: boolean;
  missingDependencies: string[];
  blockedByModules: string[];
}

// ====================================
// Cache Management
// ====================================

interface CacheEntry {
  data: ModuleAccessPayloadV2;
  expiresAt: Date;
}

// In-memory cache with TTL
class ModuleAccessCache {
  private cache = new Map<string, CacheEntry>();
  private readonly TTL_MS = 5 * 60 * 1000;  // 5 minutes
  private readonly MAX_SIZE = 10000;

  getCacheKey(businessId: string, userId: string): string {
    return `${businessId}:${userId}`;
  }

  get(key: string): ModuleAccessPayloadV2 | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (new Date() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  set(key: string, data: ModuleAccessPayloadV2): void {
    if (this.cache.size >= this.MAX_SIZE) {
      // Simple eviction: remove oldest entries
      const firstKey = this.cache.keys().next().value;
      if (typeof firstKey === 'string') {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      data,
      expiresAt: new Date(Date.now() + this.TTL_MS),
    });
  }

  invalidate(key: string): void {
    this.cache.delete(key);
  }

  invalidateByBusinessId(businessId: string): void {
    const keysToDelete: string[] = [];
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${businessId}:`)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.cache.delete(key));
  }

  invalidateByUserId(userId: string): void {
    const keysToDelete: string[] = [];
    for (const key of this.cache.keys()) {
      if (key.endsWith(`:${userId}`)) {
        keysToDelete.push(key);
      }
    }
    keysToDelete.forEach(key => this.cache.delete(key));
  }

  clear(): void {
    this.cache.clear();
  }

  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.MAX_SIZE,
      ttlMs: this.TTL_MS,
    };
  }
}

export const moduleAccessCache = new ModuleAccessCache();

// ====================================
// Main Resolver Function
// ====================================

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
  const cacheKey = moduleAccessCache.getCacheKey(businessId, userId);

  // Check cache first
  if (!options?.skipCache) {
    const cached = moduleAccessCache.get(cacheKey);
    if (cached) {
      return cached;
    }
  }

  // Start resolution process
  const result = await resolveModuleAccessLayers(
    prisma,
    businessId,
    userId,
    options
  );

  // Cache the result
  moduleAccessCache.set(cacheKey, result);

  return result;
}

// ====================================
// Layer-by-Layer Resolution
// ====================================

function normalizeModuleKey(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

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
  };

  return iconMap[moduleKey] || 'Box';
}

let _seedDataEnsured = false;
async function ensureModuleAccessV2SeedData(prisma: PrismaClient): Promise<void> {
  if (_seedDataEnsured) return;
  const moduleDefinitionModel = (prisma as any).moduleDefinition;
  const modulePageModel = (prisma as any).modulePage;
  const operationModel = (prisma as any).operation;
  const legacyModuleModel = (prisma as any).module;

  if (!moduleDefinitionModel?.findMany || !modulePageModel?.create || !operationModel?.upsert || !legacyModuleModel?.findMany) {
    return;
  }

  const operations = [
    { key: 'read', name: 'Read', sortOrder: 1 },
    { key: 'create', name: 'Create', sortOrder: 2 },
    { key: 'update', name: 'Update', sortOrder: 3 },
    { key: 'delete', name: 'Delete', sortOrder: 4 },
    { key: 'export', name: 'Export', sortOrder: 5 },
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

  for (const legacyModule of legacyModules) {
    const moduleKey = normalizeModuleKey(legacyModule.name);
    legacyModuleKeys.add(moduleKey);
    const displayName = legacyModule.displayName || legacyModule.name;

    const createdDefinition = await moduleDefinitionModel.upsert({
      where: { key: moduleKey },
      update: {
        name: displayName,
        icon: getDefaultModuleIcon(moduleKey),
        description: legacyModule.description || `${displayName} module`,
        route: `/${moduleKey}`,
        isActive: true,
      },
      create: {
        key: moduleKey,
        name: displayName,
        icon: getDefaultModuleIcon(moduleKey),
        description: legacyModule.description || `${displayName} module`,
        route: `/${moduleKey}`,
        isActive: true,
        sortOrder: 0,
      },
    });

    const existingPages = await modulePageModel.findMany({
      where: { moduleId: createdDefinition.id },
    });

    if (!existingPages.length) {
      await modulePageModel.create({
        data: {
          moduleId: createdDefinition.id,
          key: 'overview',
          name: `${displayName} Overview`,
          route: `/${moduleKey}`,
          icon: getDefaultModuleIcon(moduleKey),
          sortOrder: 0,
          isActive: true,
        },
      });
    }
  }

  // Also ensure module_definitions exist for MODULE_HIERARCHY modules not in legacy
  for (const hierMod of MODULE_HIERARCHY) {
    const moduleKey = normalizeModuleKey(hierMod.module);
    if (legacyModuleKeys.has(moduleKey)) continue;

    const createdDefinition = await moduleDefinitionModel.upsert({
      where: { key: moduleKey },
      update: {
        name: hierMod.label,
        icon: hierMod.icon || getDefaultModuleIcon(moduleKey),
        description: `${hierMod.label} module`,
        route: `/${moduleKey}`,
        isActive: true,
      },
      create: {
        key: moduleKey,
        name: hierMod.label,
        icon: hierMod.icon || getDefaultModuleIcon(moduleKey),
        description: `${hierMod.label} module`,
        route: `/${moduleKey}`,
        isActive: true,
        sortOrder: 0,
      },
    });

    const existingPages = await modulePageModel.findMany({
      where: { moduleId: createdDefinition.id },
    });

    if (!existingPages.length) {
      await modulePageModel.create({
        data: {
          moduleId: createdDefinition.id,
          key: 'overview',
          name: `${hierMod.label} Overview`,
          route: `/${moduleKey}`,
          icon: hierMod.icon || getDefaultModuleIcon(moduleKey),
          sortOrder: 0,
          isActive: true,
        },
      });
    }
  }

  _seedDataEnsured = true;
}

async function loadModulePermissionState(
  prisma: PrismaClient,
  business: any,
  roleName?: string
): Promise<{
  planModuleSet: Set<string> | null;
  planDisabledSet: Set<string>;
  roleModuleSet: Set<string> | null;
  roleDisabledSet: Set<string>;
  btSubDisabled: Set<string>;    // "module::sub" keys disabled by business type
  planSubDisabled: Set<string>;  // "module::sub" keys disabled by plan
  roleSubDisabled: Set<string>;  // "module::sub" keys disabled by role
}> {
  const planModuleSet = new Set<string>();
  const planDisabledSet = new Set<string>();
  const roleModuleSet = new Set<string>();
  const roleDisabledSet = new Set<string>();
  const btSubDisabled = new Set<string>();
  const planSubDisabled = new Set<string>();
  const roleSubDisabled = new Set<string>();

  // ── Business Type sub-module denials ──────────────────────────────────
  if (business.businessType) {
    try {
      const btId = String(business.businessType).trim();
      const btSubRows = await (prisma as any).$queryRawUnsafe(
        `SELECT moduleName, subModuleKey FROM business_type_sub_module_permissions WHERE businessTypeId = ? AND enabled = 0`,
        btId
      ) as Array<{ moduleName: string; subModuleKey: string }>;

      for (const row of btSubRows) {
        const moduleKey = normalizeModuleKey(row.moduleName);
        const subKey = String(row.subModuleKey || '').trim().toLowerCase();
        if (moduleKey && subKey) {
          btSubDisabled.add(`${moduleKey}::${subKey}`);
        }
      }
    } catch {
      // Table may not exist yet
    }
  }

  // ── Plan module + sub-module denials ──────────────────────────────────
  if (business?.businessSubscription?.planId) {
    const planRows = await (prisma as any).$queryRawUnsafe(
      `SELECT moduleName, enabled FROM plan_module_permissions WHERE planId = ?`,
      business.businessSubscription.planId
    ) as Array<{ moduleName: string; enabled: number }>;

    for (const row of planRows) {
      const moduleKey = normalizeModuleKey(row.moduleName);
      if (!moduleKey) continue;
      if (Boolean(row.enabled)) {
        planModuleSet.add(moduleKey);
      } else {
        planDisabledSet.add(moduleKey);
      }
    }

    const planSubRows = await (prisma as any).$queryRawUnsafe(
      `SELECT moduleName, subModuleKey FROM plan_sub_module_permissions WHERE planId = ? AND enabled = 0`,
      business.businessSubscription.planId
    ) as Array<{ moduleName: string; subModuleKey: string }>;

    for (const row of planSubRows) {
      const moduleKey = normalizeModuleKey(row.moduleName);
      const subKey = String(row.subModuleKey || '').trim().toLowerCase();
      if (moduleKey && subKey) {
        planSubDisabled.add(`${moduleKey}::${subKey}`);
      }
    }
  }

  // ── Role module + sub-module denials ──────────────────────────────────
  const normalizedRole = String(roleName || '').toUpperCase();
  const effectiveRole = normalizedRole === 'ADMIN' ? 'OWNER' : normalizedRole;

  if (effectiveRole) {
    const roleRows = await (prisma as any).$queryRawUnsafe(
      `SELECT moduleName, enabled FROM role_module_permissions WHERE roleName = ?`,
      effectiveRole
    ) as Array<{ moduleName: string; enabled: number }>;

    for (const row of roleRows) {
      const moduleKey = normalizeModuleKey(row.moduleName);
      if (!moduleKey) continue;
      if (Boolean(row.enabled)) {
        roleModuleSet.add(moduleKey);
      } else {
        roleDisabledSet.add(moduleKey);
      }
    }

    const roleSubRows = await (prisma as any).$queryRawUnsafe(
      `SELECT moduleName, subModuleKey FROM role_sub_module_permissions WHERE roleName = ? AND enabled = 0`,
      effectiveRole
    ) as Array<{ moduleName: string; subModuleKey: string }>;

    for (const row of roleSubRows) {
      const moduleKey = normalizeModuleKey(row.moduleName);
      const subKey = String(row.subModuleKey || '').trim().toLowerCase();
      if (moduleKey && subKey) {
        roleSubDisabled.add(`${moduleKey}::${subKey}`);
      }
    }
  }

  return {
    planModuleSet: planModuleSet.size > 0 ? planModuleSet : null,
    planDisabledSet,
    roleModuleSet: roleModuleSet.size > 0 ? roleModuleSet : null,
    roleDisabledSet,
    btSubDisabled,
    planSubDisabled,
    roleSubDisabled,
  };
}

async function resolveModuleAccessLayers(
  prisma: PrismaClient,
  businessId: string,
  userId: string,
  options?: { skipDependencyCheck?: boolean; roleName?: string }
): Promise<ModuleAccessPayloadV2> {
  // Get base business info
  const business = await (prisma as any).business.findUnique({
    where: { id: businessId },
    include: {
      businessSubscription: { include: { plan: true } },
    },
  });

  if (!business) {
    throw new Error(`Business not found: ${businessId}`);
  }

  // Get user's membership and role
  let membership = await (prisma as any).membership.findUnique({
    where: {
      unique_user_business: {
        userId,
        businessId,
      },
    },
    include: {
      role: true,
    },
  });

  // Fetch role permissions separately to avoid relying on generated Prisma include
  if (membership && (membership as any).role && (membership as any).role.id) {
    try {
      const rolePerms = (await (prisma as any).rolePermissionV2.findMany({
        where: { roleId: (membership as any).role.id },
        include: { operation: true, modulePage: { include: { module: true } } },
      })) || [];
      (membership as any).role.permissionsV2 = rolePerms;
    } catch {
      (membership as any).role.permissionsV2 = [];
    }
  }

  if (!membership) {
    const businessOwnerId = String(business.createdBy || '');
    if (businessOwnerId && businessOwnerId === String(userId)) {
      membership = {
        role: {
          name: options?.roleName ? String(options.roleName).toUpperCase() : 'OWNER',
          permissionsV2: [],
        },
      } as any;
    }
  }

  if (!membership) {
    throw new Error(`User not member of business: ${userId} in ${businessId}`);
  }

  const roleName = String((membership as any)?.role?.name || options?.roleName || 'GUEST').toUpperCase();

  await ensureModuleAccessV2SeedData(prisma);
  const permissionState = await loadModulePermissionState(prisma, business, roleName);

  // Get all available modules for business type
  // NOTE: business.businessType stores the ID (e.g. "PHARMACY") but business_types.name
  // may differ (e.g. "Pharmacy"). We use raw SQL with case-insensitive matching on both
  // id and name to handle inconsistencies across the data.
  let businessType: any = null;
  if (business.businessType) {
    try {
      const btValue = String(business.businessType).trim();

      // Raw SQL lookup: match by id (exact), then by name (case-insensitive)
      const btRows = await prisma.$queryRaw<any[]>`
        SELECT id, name FROM business_types
        WHERE id = ${btValue} OR LOWER(name) = LOWER(${btValue})
        LIMIT 1
      `;

      if (btRows && btRows.length > 0) {
        const btRecord = btRows[0];

        // Load modules for this business type via raw SQL (avoids Prisma relation issues)
        const rawBtModules = await prisma.$queryRaw<any[]>`
          SELECT btm.businessTypeId, btm.moduleId, btm.isEnabled, btm.sortOrder,
                 m.name as moduleName, m.displayName as moduleDisplayName
          FROM business_type_modules btm
          LEFT JOIN modules m ON m.id = btm.moduleId
          WHERE btm.businessTypeId = ${btRecord.id}
        `;

        businessType = {
          id: btRecord.id,
          name: btRecord.name,
          modules: rawBtModules.map((row: any) => ({
            businessTypeId: row.businessTypeId,
            moduleId: row.moduleId,
            isEnabled: !!row.isEnabled,
            sortOrder: row.sortOrder,
            module: {
              id: row.moduleId,
              key: normalizeModuleKey(row.moduleName || ''),
              name: row.moduleDisplayName || row.moduleName || '',
            },
          })),
        };
      }
    } catch {
      businessType = null;
    }
  }

  // Get all module definitions (fallback to config if DB table missing/empty)
  let allModules = (await (prisma as any).moduleDefinition?.findMany?.({
    where: { isActive: true },
  })) || [];

  if (!allModules || allModules.length === 0) {
    allModules = MODULE_HIERARCHY.map((m: any) => ({
      id: String(m.module),
      key: normalizeModuleKey(m.module),
      name: m.label || m.module,
      icon: m.icon || getDefaultModuleIcon(m.module),
      isActive: true,
    }));
  }

  // Get business overrides
  const overrides = (await (prisma as any).businessModuleOverride?.findMany?.({
    where: { businessId },
  })) || [];

  // Get plan entitlements
  const planEntitlements = business.businessSubscription
    ? await (prisma as any).planEntitlement?.findMany?.({
        where: { planId: business.businessSubscription.planId },
      })
    : [];

  // Get module dependencies
  const dependencies = (await (prisma as any).moduleDependency?.findMany?.({
    where: { isHardDependency: true },
  })) || [];

  // Evaluate each module through all 9 layers
  const modules: ModuleAccessResultV2[] = [];

  for (const moduleDef of allModules) {
    const access = await evaluateModuleAccess(
      prisma,
      {
        moduleDef,
        business,
        businessType,
        membership,
        roleName,
        overrides,
        planEntitlements,
        dependencies,
        planModuleSet: permissionState.planModuleSet,
        planDisabledSet: permissionState.planDisabledSet,
        roleModuleSet: permissionState.roleModuleSet,
        roleDisabledSet: permissionState.roleDisabledSet,
      },
      options
    );

    modules.push(access);
  }

  // ── Parent-child cascade ─────────────────────────────────────────────
  // If a parent module is denied, all its children must also be denied.
  // This prevents, e.g., POS and Invoices from being accessible when Sales is disabled.
  const parentChildMap = new Map<string, string[]>();  // parentKey → childKeys
  for (const hierMod of MODULE_HIERARCHY) {
    const children = hierMod.subModules
      .filter(s => s.key !== hierMod.module)
      .map(s => normalizeModuleKey(s.key));
    if (children.length > 0) {
      parentChildMap.set(normalizeModuleKey(hierMod.module), children);
    }
  }

  const moduleResultMap = new Map(modules.map(m => [m.moduleKey, m]));

  for (const [parentKey, childKeys] of parentChildMap.entries()) {
    const parentResult = moduleResultMap.get(parentKey);
    if (parentResult && !parentResult.enabled) {
      // Parent is denied — cascade to all children
      for (const childKey of childKeys) {
        const childResult = moduleResultMap.get(childKey);
        if (childResult && childResult.enabled) {
          // Child was individually allowed, but parent is denied
          childResult.enabled = false;
          childResult.reason = 'PARENT_MODULE_DENIED';
        }
      }
    }
  }

  // ── Sub-module evaluation ─────────────────────────────────────────────
  // For each parent module that is accessible, evaluate each sub-module
  // through the same intersection model: businessType AND plan AND role.
  // Parent denial cascades DOWN. Child denial does NOT cascade UP or SIDEWAYS.
  const subModuleResults: SubModuleAccessResult[] = [];

  for (const hierMod of MODULE_HIERARCHY) {
    const parentKey = normalizeModuleKey(hierMod.module);
    const parentResult = moduleResultMap.get(parentKey);
    const parentAccessible = parentResult?.enabled ?? false;

    for (const sub of hierMod.subModules) {
      const subKey = normalizeModuleKey(sub.key);
      const compositeKey = `${parentKey}::${subKey}`;
      const label = sub.label || subKey;

      if (!parentAccessible) {
        // Parent denied — this sub-module is unavailable regardless of its own settings
        subModuleResults.push({
          key: subKey,
          module: parentKey,
          label,
          enabled: false,
          parentAccessible: false,
          businessTypeAllowed: true,  // own settings irrelevant when parent is denied
          planEntitled: true,
          roleAllowed: true,
          primaryDenialReason: 'PARENT_MODULE',
        });
        continue;
      }

      // Parent is accessible — evaluate this sub-module through the 3 gates
      const businessTypeAllowed = !permissionState.btSubDisabled.has(compositeKey);
      const planEntitled = !permissionState.planSubDisabled.has(compositeKey);
      const roleAllowed = !permissionState.roleSubDisabled.has(compositeKey);

      const enabled = businessTypeAllowed && planEntitled && roleAllowed;

      // Determine primary denial reason (first denied gate wins)
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

  // Build backward-compatible disabledSubModules list from subModuleResults
  const disabledSubModules = subModuleResults
    .filter(s => !s.enabled)
    .map(s => `${s.module}::${s.key}`);

  const payload: ModuleAccessPayloadV2 = {
    businessId,
    userId,
    roleName,
    modules,
    subModuleResults,
    disabledSubModules,
    computedAt: new Date(),
    cacheKey: moduleAccessCache.getCacheKey(businessId, userId),
    cacheExpiresIn: 5 * 60 * 1000,  // 5 minutes
  };

  return payload;
}

// ====================================
// Individual Module Evaluation
// ====================================

async function evaluateModuleAccess(
  prisma: PrismaClient,
  context: {
    moduleDef: any;
    business: any;
    businessType: any;
    membership: any;
    roleName: string;
    overrides: any[];
    planEntitlements: any[];
    dependencies: any[];
    planModuleSet: Set<string> | null;
    planDisabledSet: Set<string>;
    roleModuleSet: Set<string> | null;
    roleDisabledSet: Set<string>;
  },
  options?: { skipDependencyCheck?: boolean }
): Promise<ModuleAccessResultV2> {
  const { moduleDef } = context;

  // Layer 1: Business Type Check
  const typeAllowed = checkBusinessTypeAllows(
    context.moduleDef,
    context.businessType
  );

  if (!typeAllowed) {
    return {
      moduleKey: moduleDef.key,
      moduleName: moduleDef.name,
      icon: moduleDef.icon,
      enabled: false,
      reason: 'BUSINESS_TYPE_RESTRICTED',
      typeAllowed: false,
      planAllowed: false,
      businessOverrideDisabled: false,
      roleAllowed: false,
      dependencyBlocked: false,
      allowedOperations: [],
      blockedOperations: [],
    };
  }

  // Layer 2: Subscription Entitlement Check
  const planAllowed = checkPlanEntitles(
    context.moduleDef,
    context.planEntitlements,
    context.planModuleSet,
    context.planDisabledSet
  );

  if (!planAllowed) {
    return {
      moduleKey: moduleDef.key,
      moduleName: moduleDef.name,
      icon: moduleDef.icon,
      enabled: false,
      reason: 'SUBSCRIPTION_NOT_ENTITLED',
      typeAllowed: true,
      planAllowed: false,
      businessOverrideDisabled: false,
      roleAllowed: false,
      dependencyBlocked: false,
      allowedOperations: [],
      blockedOperations: [],
    };
  }

  // Layer 3: Business Override Check
  const override = context.overrides.find(o => o.moduleId === moduleDef.id);
  const businessOverrideDisabled = override && !override.enabled;

  if (businessOverrideDisabled) {
    return {
      moduleKey: moduleDef.key,
      moduleName: moduleDef.name,
      icon: moduleDef.icon,
      enabled: false,
      reason: 'BUSINESS_OWNER_DISABLED',
      typeAllowed: true,
      planAllowed: true,
      businessOverrideDisabled: true,
      roleAllowed: false,
      dependencyBlocked: false,
      allowedOperations: [],
      blockedOperations: [],
    };
  }

  // Layer 5: Role-Based Module Access
  const roleAllowed = checkRoleHasModuleAccess(
    context.moduleDef,
    context.membership,
    context.roleModuleSet,
    context.roleDisabledSet
  );

  if (!roleAllowed) {
    return {
      moduleKey: moduleDef.key,
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
    };
  }

  // Layer 6: Role-Based Operation Permissions
  const operations = await getPermittedOperations(
    prisma,
    context.moduleDef,
    context.membership
  );

  if (operations.allowedOperations.length === 0) {
    return {
      moduleKey: moduleDef.key,
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
    };
  }

  // Layer 7: Module Dependency Check
  if (!options?.skipDependencyCheck) {
    const depCheck = await checkModuleDependencies(
      prisma,
      moduleDef,
      context.dependencies
    );

    if (!depCheck.satisfied) {
      return {
        moduleKey: moduleDef.key,
        moduleName: moduleDef.name,
        icon: moduleDef.icon,
        enabled: false,
        reason: 'MODULE_DEPENDENCY_MISSING',
        typeAllowed: true,
        planAllowed: true,
        businessOverrideDisabled: false,
        roleAllowed: true,
        dependencyBlocked: true,
        allowedOperations: operations.allowedOperations,
        blockedOperations: operations.blockedOperations,
      };
    }
  }

  // All layers passed - module is accessible
  return {
    moduleKey: moduleDef.key,
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
  };
}

// ====================================
// Individual Layer Checks
// ====================================

function checkBusinessTypeAllows(module: any, businessType: any): boolean {
  // If business type is null (lookup failed) or has no modules configured,
  // DENY access. This is the secure default — unknown business types should
  // not automatically get access to all modules.
  if (!businessType || !Array.isArray(businessType.modules) || businessType.modules.length === 0) {
    return false;
  }

  return businessType.modules.some((btm: any) => {
    // Normalize module entry (could be relation object or simple record)
    const modEntry = btm.module || btm;

    // Direct ID match (DB-backed modules)
    if (btm.moduleId && String(btm.moduleId) === String(module.id)) {
      return !!btm.isEnabled;
    }

    // Fallback: match by key or name
    const btmKey = normalizeModuleKey(modEntry.key || modEntry.name || modEntry);
    const moduleKey = normalizeModuleKey(module.key || module.name || module.id);
    return btmKey === moduleKey && !!btm.isEnabled;
  });
}

function checkPlanEntitles(
  module: any,
  planEntitlements: any[],
  planModuleSet?: Set<string> | null,
  planDisabledSet?: Set<string>
): boolean {
  const moduleKey = normalizeModuleKey(module.key);

  if (planModuleSet) {
    if (planDisabledSet?.has(moduleKey)) {
      return false;
    }
    return planModuleSet.has(moduleKey);
  }

  if (!Array.isArray(planEntitlements) || planEntitlements.length === 0) {
    return true;
  }

  return planEntitlements.some(
    (pe: any) => pe.moduleKey === module.key && pe.entitlementLevel !== 'NONE'
  );
}

function checkRoleHasModuleAccess(
  module: any,
  membership: any,
  roleModuleSet?: Set<string> | null,
  roleDisabledSet?: Set<string>
): boolean {
  if (!membership.role) return false;

  const moduleKey = normalizeModuleKey(module.key);
  if (roleModuleSet) {
    if (roleDisabledSet?.has(moduleKey)) {
      return false;
    }
    return roleModuleSet.has(moduleKey);
  }

  return true;
}

async function getPermittedOperations(
  prisma: PrismaClient,
  module: any,
  membership: any
): Promise<{ allowedOperations: string[]; blockedOperations: string[] }> {
  if (!membership.role) {
    return { allowedOperations: [], blockedOperations: [] };
  }

  // Get pages within this module
  const pages = (await (prisma as any).modulePage?.findMany?.({
    where: { moduleId: module.id },
  })) || [];

  const allowed: Set<string> = new Set();
  const blocked: Set<string> = new Set();

  const rolePermissions = Array.isArray((membership as any)?.role?.permissionsV2)
    ? (membership as any).role.permissionsV2
    : [];

  if (!rolePermissions.length) {
    return { allowedOperations: ['read'], blockedOperations: [] };
  }

  for (const permission of rolePermissions) {
    if (pages.some((p: any) => p.id === permission.modulePageId)) {
      if (permission.allowed) {
        allowed.add(permission.operationKey);
      } else {
        blocked.add(permission.operationKey);
      }
    }
  }

  return {
    allowedOperations: Array.from(allowed),
    blockedOperations: Array.from(blocked),
  };
}

async function checkModuleDependencies(
  prisma: PrismaClient,
  module: any,
  dependencies: any[]
): Promise<DependencyCheckResult> {
  const moduleDeps = dependencies.filter(d => d.moduleId === module.id);

  if (moduleDeps.length === 0) {
    return {
      satisfied: true,
      missingDependencies: [],
      blockedByModules: [],
    };
  }

  // Check if all dependencies are accessible
  const missingDeps = moduleDeps.filter(d => !d.dependsOn.isActive);

  return {
    satisfied: missingDeps.length === 0,
    missingDependencies: missingDeps.map(d => d.dependsOnModuleId),
    blockedByModules: missingDeps.map(d => d.dependsOn.key),
  };
}

// ====================================
// Cache Invalidation Triggers
// ====================================

export function invalidateModuleCache(event: ModuleCacheInvalidationEvent) {
  switch (event.type) {
    case 'BUSINESS_TYPE_CHANGED':
      // Business type changes affect ALL businesses of that type.
      // We don't know which businesses use this type, so clear all.
      moduleAccessCache.clear();
      break;

    case 'PLAN_CHANGED':
      // Plan changes affect ALL businesses on that plan.
      // We don't track which businesses are on which plan in the cache,
      // so clear all to be safe.
      moduleAccessCache.clear();
      break;

    case 'ROLE_CHANGED':
      // Role changes are global (roles apply across all businesses).
      moduleAccessCache.clear();
      break;

    case 'BUSINESS_OVERRIDE_CHANGED':
      // Business overrides are business-specific — clear only that business.
      moduleAccessCache.invalidateByBusinessId(event.businessId);
      break;

    case 'ROLE_PERMISSION_CHANGED':
      // Role permission changes are global (roles apply across all businesses).
      moduleAccessCache.clear();
      break;

    case 'MODULE_DEPENDENCY_CHANGED':
      moduleAccessCache.clear();
      break;

    default:
      console.warn('Unknown cache invalidation event:', event);
      moduleAccessCache.clear();
  }
}

export type ModuleCacheInvalidationEvent =
  | { type: 'BUSINESS_TYPE_CHANGED'; businessId: string }
  | { type: 'PLAN_CHANGED'; businessId: string }
  | { type: 'ROLE_CHANGED'; userId: string }
  | { type: 'BUSINESS_OVERRIDE_CHANGED'; businessId: string }
  | { type: 'ROLE_PERMISSION_CHANGED'; userId: string }
  | { type: 'MODULE_DEPENDENCY_CHANGED' };

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
