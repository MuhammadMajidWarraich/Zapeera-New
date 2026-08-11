import { Response } from 'express';
import { AdminAuthRequest } from '../middleware/admin-auth.middleware';
import { getPrisma } from '../utils/db.util';
import { loadPricingPlans } from '../utils/subscription-entitlements.util';
import { invalidateModuleCache, moduleAccessCache, clearModuleCache } from '../utils/modules-v2.util';
import { invalidateEntitlementsCache } from '../middleware/multitenancy.middleware';
import crypto from 'crypto';

const ALL_ROLES = ['OWNER', 'MANAGER', 'CASHIER'];

// ─── Module permission tables bootstrap ──────────────────────────────────
let _modulePermissionTablesEnsured = false;
async function ensureModulePermissionTables(prisma: any): Promise<void> {
  if (_modulePermissionTablesEnsured) return;
  const ddl = [
    // Main module permission tables
    `CREATE TABLE IF NOT EXISTS plan_module_permissions (
       id TEXT PRIMARY KEY,
       "planId" TEXT NOT NULL,
       "moduleName" TEXT NOT NULL,
       "enabled" BOOLEAN NOT NULL DEFAULT false,
       "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       UNIQUE("planId", "moduleName")
     )`,
    `CREATE TABLE IF NOT EXISTS role_module_permissions (
       id TEXT PRIMARY KEY,
       "roleName" TEXT NOT NULL,
       "moduleName" TEXT NOT NULL,
       "enabled" BOOLEAN NOT NULL DEFAULT false,
       "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       UNIQUE("roleName", "moduleName")
     )`,
    // Sub-module permission tables
    `CREATE TABLE IF NOT EXISTS business_type_sub_module_permissions (
       id TEXT PRIMARY KEY,
       "businessTypeId" TEXT NOT NULL,
       "moduleName" TEXT NOT NULL,
       "subModuleKey" TEXT NOT NULL,
       "enabled" BOOLEAN NOT NULL DEFAULT true,
       "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       UNIQUE("businessTypeId", "moduleName", "subModuleKey")
     )`,
    `CREATE TABLE IF NOT EXISTS plan_sub_module_permissions (
       id TEXT PRIMARY KEY,
       "planId" TEXT NOT NULL,
       "moduleName" TEXT NOT NULL,
       "subModuleKey" TEXT NOT NULL,
       "enabled" BOOLEAN NOT NULL DEFAULT true,
       "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       UNIQUE("planId", "moduleName", "subModuleKey")
     )`,
    `CREATE TABLE IF NOT EXISTS role_sub_module_permissions (
       id TEXT PRIMARY KEY,
       "roleName" TEXT NOT NULL,
       "moduleName" TEXT NOT NULL,
       "subModuleKey" TEXT NOT NULL,
       "enabled" BOOLEAN NOT NULL DEFAULT true,
       "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       UNIQUE("roleName", "moduleName", "subModuleKey")
     )`,
  ];
  for (const stmt of ddl) {
    try { await prisma.$executeRawUnsafe(stmt); } catch (e: any) {
      console.warn('[ModulePerms DDL] failed:', e.message);
    }
  }
  _modulePermissionTablesEnsured = true;
}

async function upsertModulePermission(
  prisma: any,
  table: 'plan_module_permissions' | 'role_module_permissions',
  scopeCol: 'planId' | 'roleName',
  scopeVal: string,
  moduleName: string,
  enabled: boolean
): Promise<void> {
  const scopeQuoted = scopeCol === 'planId' ? '"planId"' : '"roleName"';
  const id = crypto.randomUUID();
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${table} (id, ${scopeQuoted}, "moduleName", "enabled", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      id, scopeVal, moduleName, enabled
    );
  } catch (insertErr: any) {
    const message = String(insertErr?.message || '').toLowerCase();
    if (message.includes('unique') || message.includes('constraint')) {
      await prisma.$executeRawUnsafe(
        `UPDATE ${table} SET "enabled" = $1, "updatedAt" = CURRENT_TIMESTAMP
         WHERE ${scopeQuoted} = $2 AND "moduleName" = $3`,
        enabled, scopeVal, moduleName
      );
    } else {
      throw insertErr;
    }
  }
}

// ─── Sub-module table bootstrap (deprecated, use ensureModulePermissionTables) ────────────────────────────────────────────
let _subModuleTablesEnsured = false;
async function ensureSubModuleTables(prisma: any): Promise<void> {
  if (_subModuleTablesEnsured) return;
  // Delegate to the main function that creates all tables
  await ensureModulePermissionTables(prisma);
  _subModuleTablesEnsured = true;
}

/** Upsert a single sub-module permission row. enabled=true means allow, false means deny. */
async function upsertSubModulePermission(
  prisma: any,
  table: 'business_type_sub_module_permissions' | 'plan_sub_module_permissions' | 'role_sub_module_permissions',
  scopeCol: 'businessTypeId' | 'planId' | 'roleName',
  scopeVal: string,
  moduleName: string,
  subModuleKey: string,
  enabled: boolean
): Promise<void> {
  const scopeQuoted =
    scopeCol === 'businessTypeId' ? '"businessTypeId"' : scopeCol === 'planId' ? '"planId"' : '"roleName"';
  await prisma.$executeRawUnsafe(
    `DELETE FROM ${table} WHERE ${scopeQuoted} = $1 AND "moduleName" = $2 AND "subModuleKey" = $3`,
    scopeVal, moduleName, subModuleKey
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO ${table} (id, ${scopeQuoted}, "moduleName", "subModuleKey", "enabled", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    crypto.randomUUID(), scopeVal, moduleName, subModuleKey, enabled
  );
}

export const getModulePermissionMatrix = async (req: AdminAuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    await ensureModulePermissionTables(prisma);

    const roles = await prisma.$queryRaw<any[]>`SELECT "roleName", "moduleName", "enabled" FROM role_module_permissions ORDER BY "roleName", "moduleName"`;
    const plans = await prisma.$queryRaw<any[]>`SELECT "planId", "moduleName", "enabled" FROM plan_module_permissions ORDER BY "planId", "moduleName"`;
    const allModRows = await prisma.$queryRaw<any[]>`SELECT name FROM modules`;
    const allModules = allModRows.map((row) => String(row.name).toLowerCase());

    const roleMap = new Map<string, Set<string>>();
    for (const row of roles) {
      const roleName = String(row.roleName);
      if (!roleMap.has(roleName)) roleMap.set(roleName, new Set());
      if (row.enabled) roleMap.get(roleName)!.add(String(row.moduleName).toLowerCase());
    }

    const planMap = new Map<string, Set<string>>();
    for (const row of plans) {
      const planId = String(row.planId);
      if (!planMap.has(planId)) planMap.set(planId, new Set());
      if (row.enabled) planMap.get(planId)!.add(String(row.moduleName).toLowerCase());
    }

    return res.json({
      success: true,
      data: {
        modules: allModules,
        roles: Array.from(roleMap.entries()).map(([roleName, enabledModules]) => ({
          roleName,
          modules: Array.from(enabledModules),
        })),
        plans: Array.from(planMap.entries()).map(([planId, enabledModules]) => ({
          planId,
          modules: Array.from(enabledModules),
        })),
      },
    });
  } catch (error: any) {
    console.error('[ModulePermissionMatrix] Error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to load module permission matrix' });
  }
};

export async function getSubModuleStateMap(
  prisma: any,
  table: 'business_type_sub_module_permissions' | 'plan_sub_module_permissions' | 'role_sub_module_permissions',
  scopeCol: 'businessTypeId' | 'planId' | 'roleName'
): Promise<Map<string, Map<string, boolean>>> {
  await ensureSubModuleTables(prisma);
  const scopeQuoted =
    scopeCol === 'businessTypeId' ? '"businessTypeId"' : scopeCol === 'planId' ? '"planId"' : '"roleName"';
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT ${scopeQuoted} AS scope, "moduleName", "subModuleKey", "enabled" FROM ${table}`
  );
  const map = new Map<string, Map<string, boolean>>();
  for (const r of rows) {
    const scope = String(r.scope);
    if (!map.has(scope)) map.set(scope, new Map());
    map.get(scope)!.set(`${r.moduleName}::${r.subModuleKey}`, !!Number(r.enabled));
  }
  return map;
}

// ─── Plan Module Permissions ───────────────────────────────────────────────

/**
 * GET /backoffice/module-permissions/plans
 * Returns all pricing plans with their enabled modules.
 */
export const getPlanModulePermissions = async (req: AdminAuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    await ensureModulePermissionTables(prisma);
    const plans = await loadPricingPlans(prisma);

    const rows = await prisma.$queryRaw<any[]>`SELECT "planId", "moduleName", "enabled" FROM plan_module_permissions ORDER BY "planId", "moduleName"`;

    // Build map: planId -> Set<moduleName>
    const dbMap = new Map<string, Set<string>>();
    for (const row of rows) {
      const pid = String(row.planId);
      if (!dbMap.has(pid)) dbMap.set(pid, new Set());
      if (row.enabled) dbMap.get(pid)!.add(String(row.moduleName).toLowerCase());
    }

    // Sub-module permissions per plan
    const subMap = await getSubModuleStateMap(prisma, 'plan_sub_module_permissions', 'planId');

    const result = plans.map((plan) => {
      const dbModules = dbMap.get(plan.id);
      const modules = dbModules
        ? Array.from(dbModules)
        : (plan.modules || []).map((m) => m.toLowerCase());

      // Default: all sub-modules enabled if no explicit row exists; only emit explicit overrides
      const subModulesMap = subMap.get(plan.id) || new Map();
      const subModules: string[] = [];
      for (const [composite, enabled] of subModulesMap.entries()) {
        if (enabled) subModules.push(composite); // "moduleName::subModuleKey"
      }
      // Disabled subs (explicit denies)
      const disabledSubModules: string[] = [];
      for (const [composite, enabled] of subModulesMap.entries()) {
        if (!enabled) disabledSubModules.push(composite);
      }

      return {
        planId: plan.id,
        planName: plan.name,
        price: plan.price,
        modules,
        subModules,
        disabledSubModules,
      };
    });

    return res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('[PlanModulePerms] GET error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to load plan module permissions' });
  }
};

/**
 * PUT /backoffice/module-permissions/plans/:planId
 * Body: { modules: string[] } for full replacement OR { moduleId, enabled } for single toggle
 */
export const updatePlanModulePermissions = async (req: AdminAuthRequest, res: Response) => {
  const { planId } = req.params;
  const { modules, moduleId, enabled } = req.body as { modules?: string[]; moduleId?: string; enabled?: boolean };

  // Single module toggle
  if (moduleId !== undefined && enabled !== undefined) {
    try {
      const prisma = await getPrisma();
      await ensureModulePermissionTables(prisma);
      const normalizedModuleId = String(moduleId).toLowerCase().trim();

      // Use upsert helper for SQLite compatibility
      await upsertModulePermission(prisma, 'plan_module_permissions', 'planId', planId, normalizedModuleId, enabled);

      invalidateModuleCache({ type: 'PLAN_CHANGED', businessId: planId });

      return res.json({ success: true, message: `Plan ${planId} module ${moduleId} ${enabled ? 'enabled' : 'disabled'}` });
    } catch (error: any) {
      console.error('[PlanModulePerms] PUT toggle error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to update plan module permission' });
    }
  }

  // Full module list replacement
  if (!planId || !Array.isArray(modules)) {
    return res.status(400).json({ success: false, message: 'planId and modules[] are required' });
  }

  const normalizedModules = modules.map((m) => String(m).toLowerCase().trim()).filter(Boolean);

  try {
    const prisma = await getPrisma();
    await ensureModulePermissionTables(prisma);

    // Get all known module names
    const allModRows = await prisma.$queryRawUnsafe<any[]>('SELECT name FROM modules');
    const allMods = new Set(allModRows.map((r) => String(r.name).toLowerCase()));

    // Delete existing rows for this plan, re-insert fresh
    await prisma.$executeRaw`DELETE FROM plan_module_permissions WHERE "planId" = ${planId}`;

    for (const mod of allMods) {
      const enabled = normalizedModules.includes(mod);
      const id = crypto.randomUUID();
      await prisma.$executeRaw`
        INSERT INTO plan_module_permissions (id, "planId", "moduleName", "enabled", "createdAt", "updatedAt")
        VALUES (${id}, ${planId}, ${mod}, ${enabled}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `;
    }

    invalidateModuleCache({ type: 'PLAN_CHANGED', businessId: planId });

    return res.json({ success: true, message: `Plan ${planId} module permissions updated` });
  } catch (error: any) {
    console.error('[PlanModulePerms] PUT error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to update plan module permissions' });
  }
};

// ─── Role Module Permissions ───────────────────────────────────────────────

/**
 * GET /backoffice/module-permissions/roles
 * Returns all roles with their enabled modules.
 */
export const getRoleModulePermissions = async (req: AdminAuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    await ensureModulePermissionTables(prisma);

    const rows = await prisma.$queryRaw<any[]>`SELECT "roleName", "moduleName", "enabled" FROM role_module_permissions ORDER BY "roleName", "moduleName"`;

    const allModRows = await prisma.$queryRawUnsafe<any[]>('SELECT name FROM modules');
    const allMods = allModRows.map((r) => String(r.name).toLowerCase());

    // Build map: roleName -> Set<moduleName>
    const dbMap = new Map<string, Set<string>>();
    for (const row of rows) {
      const rn = String(row.roleName);
      if (!dbMap.has(rn)) dbMap.set(rn, new Set());
      if (row.enabled) dbMap.get(rn)!.add(String(row.moduleName).toLowerCase());
    }

    // Sub-module permissions per role
    const subMap = await getSubModuleStateMap(prisma, 'role_sub_module_permissions', 'roleName');

    const result = ALL_ROLES.map((role) => {
      const subModulesMap = subMap.get(role) || new Map();
      const subModules: string[] = [];
      const disabledSubModules: string[] = [];
      for (const [composite, enabled] of subModulesMap.entries()) {
        (enabled ? subModules : disabledSubModules).push(composite);
      }
      return {
        roleName: role,
        modules: Array.from(dbMap.get(role) || new Set()),
        allModules: allMods,
        subModules,
        disabledSubModules,
      };
    });

    return res.json({ success: true, data: result });
  } catch (error: any) {
    console.error('[RoleModulePerms] GET error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to load role module permissions' });
  }
};

/**
 * PUT /backoffice/module-permissions/roles/:roleName
 * Body: { modules: string[] } for full replacement OR { moduleId, enabled } for single toggle
 */
export const updateRoleModulePermissions = async (req: AdminAuthRequest, res: Response) => {
  const { roleName } = req.params;
  const { modules, moduleId, enabled } = req.body as { modules?: string[]; moduleId?: string; enabled?: boolean };

  const normalized = String(roleName).toUpperCase();
  if (!ALL_ROLES.includes(normalized)) {
    return res.status(400).json({ success: false, message: `Invalid role: ${roleName}. Must be OWNER, MANAGER, or CASHIER` });
  }

  // Single module toggle
  if (moduleId !== undefined && enabled !== undefined) {
    try {
      const prisma = await getPrisma();
      await ensureModulePermissionTables(prisma);
      const normalizedModuleId = String(moduleId).toLowerCase().trim();

      // Use upsert helper for SQLite compatibility
      await upsertModulePermission(prisma, 'role_module_permissions', 'roleName', normalized, normalizedModuleId, enabled);

      invalidateModuleCache({ type: 'ROLE_PERMISSION_CHANGED', userId: normalized });

      return res.json({ success: true, message: `Role ${normalized} module ${moduleId} ${enabled ? 'enabled' : 'disabled'}` });
    } catch (error: any) {
      console.error('[RoleModulePerms] PUT toggle error:', error.message);
      return res.status(500).json({ success: false, message: 'Failed to update role module permission' });
    }
  }

  // Full module list replacement
  if (!Array.isArray(modules)) {
    return res.status(400).json({ success: false, message: 'modules[] is required' });
  }

  const normalizedModules = modules.map((m) => String(m).toLowerCase().trim()).filter(Boolean);

  try {
    const prisma = await getPrisma();
    await ensureModulePermissionTables(prisma);

    const allModRows = await prisma.$queryRawUnsafe<any[]>('SELECT name FROM modules');
    const allMods = new Set(allModRows.map((r) => String(r.name).toLowerCase()));

    await prisma.$executeRaw`DELETE FROM role_module_permissions WHERE "roleName" = ${normalized}`;

    for (const mod of allMods) {
      const enabled = normalizedModules.includes(mod);
      const id = crypto.randomUUID();
      await prisma.$executeRaw`
        INSERT INTO role_module_permissions (id, "roleName", "moduleName", "enabled", "createdAt", "updatedAt")
        VALUES (${id}, ${normalized}, ${mod}, ${enabled}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `;
    }

    invalidateModuleCache({ type: 'ROLE_PERMISSION_CHANGED', userId: normalized });

    return res.json({ success: true, message: `Role ${normalized} module permissions updated` });
  } catch (error: any) {
    console.error('[RoleModulePerms] PUT error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to update role module permissions' });
  }
};

// ─── Sub-module Permission PUTs ────────────────────────────────────────────

/**
 * PUT /backoffice/business-types/:id/sub-modules
 * Body: { moduleKey, subModuleKey, enabled } for single toggle
 * OR { subModules: Record<string, boolean> } for bulk replacement (composite key = "module::subModule")
 */
export const updateBusinessTypeSubModulePermission = async (req: AdminAuthRequest, res: Response) => {
  const { id } = req.params;
  const { moduleKey, subModuleKey, enabled, subModules } = req.body as {
    moduleKey?: string; subModuleKey?: string; enabled?: boolean;
    subModules?: Record<string, boolean>;
  };

  try {
    const prisma = await getPrisma();
    await ensureSubModuleTables(prisma);

    // Bulk replacement mode
    if (subModules && typeof subModules === 'object') {
      // Delete all existing sub-module permissions for this business type
      await prisma.$executeRaw`DELETE FROM business_type_sub_module_permissions WHERE "businessTypeId" = ${id}`;

      // Insert all entries
      for (const [composite, isEnabled] of Object.entries(subModules)) {
        const parts = composite.split('::');
        if (parts.length !== 2) continue;
        const [modKey, subKey] = parts;
        await prisma.$executeRaw`
          INSERT INTO business_type_sub_module_permissions (id, "businessTypeId", "moduleName", "subModuleKey", "enabled", "createdAt", "updatedAt")
          VALUES (${crypto.randomUUID()}, ${id}, ${modKey.toLowerCase()}, ${subKey.toLowerCase()}, ${isEnabled}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `;
      }

      moduleAccessCache.clear();
      return res.json({ success: true, message: 'Sub-module permissions updated' });
    }

    // Single toggle mode
    if (!moduleKey || !subModuleKey || typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Either subModules{} or moduleKey+subModuleKey+enabled are required' });
    }

    await upsertSubModulePermission(
      prisma,
      'business_type_sub_module_permissions',
      'businessTypeId',
      id,
      String(moduleKey).toLowerCase(),
      String(subModuleKey).toLowerCase(),
      enabled
    );
    moduleAccessCache.clear();
    return res.json({ success: true });
  } catch (error: any) {
    console.error('[BusinessTypeSubModulePerms] PUT error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to update sub-module permission' });
  }
};

/**
 * PUT /backoffice/module-permissions/plans/:planId/sub-modules
 * Body: { moduleKey, subModuleKey, enabled } for single toggle
 * OR { subModules: Record<string, boolean> } for bulk replacement
 */
export const updatePlanSubModulePermission = async (req: AdminAuthRequest, res: Response) => {
  const { planId } = req.params;
  const { moduleKey, subModuleKey, enabled, subModules } = req.body as {
    moduleKey?: string; subModuleKey?: string; enabled?: boolean;
    subModules?: Record<string, boolean>;
  };

  try {
    const prisma = await getPrisma();
    await ensureSubModuleTables(prisma);

    if (subModules && typeof subModules === 'object') {
      await prisma.$executeRaw`DELETE FROM plan_sub_module_permissions WHERE "planId" = ${planId}`;
      for (const [composite, isEnabled] of Object.entries(subModules)) {
        const parts = composite.split('::');
        if (parts.length !== 2) continue;
        const [modKey, subKey] = parts;
        await prisma.$executeRaw`
          INSERT INTO plan_sub_module_permissions (id, "planId", "moduleName", "subModuleKey", "enabled", "createdAt", "updatedAt")
          VALUES (${crypto.randomUUID()}, ${planId}, ${modKey.toLowerCase()}, ${subKey.toLowerCase()}, ${isEnabled}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `;
      }
      moduleAccessCache.clear();
      return res.json({ success: true, message: 'Sub-module permissions updated' });
    }

    if (!moduleKey || !subModuleKey || typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Either subModules{} or moduleKey+subModuleKey+enabled are required' });
    }

    await upsertSubModulePermission(
      prisma,
      'plan_sub_module_permissions',
      'planId',
      planId,
      String(moduleKey).toLowerCase(),
      String(subModuleKey).toLowerCase(),
      enabled
    );
    moduleAccessCache.clear();
    return res.json({ success: true });
  } catch (error: any) {
    console.error('[PlanSubModulePerms] PUT error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to update sub-module permission' });
  }
};

/**
 * PUT /backoffice/module-permissions/roles/:roleName/sub-modules
 * Body: { moduleKey, subModuleKey, enabled } for single toggle
 * OR { subModules: Record<string, boolean> } for bulk replacement
 */
export const updateRoleSubModulePermission = async (req: AdminAuthRequest, res: Response) => {
  const { roleName } = req.params;
  const normalized = String(roleName).toUpperCase();
  if (!ALL_ROLES.includes(normalized)) {
    return res.status(400).json({ success: false, message: `Invalid role: ${roleName}` });
  }
  const { moduleKey, subModuleKey, enabled, subModules } = req.body as {
    moduleKey?: string; subModuleKey?: string; enabled?: boolean;
    subModules?: Record<string, boolean>;
  };

  try {
    const prisma = await getPrisma();
    await ensureSubModuleTables(prisma);

    if (subModules && typeof subModules === 'object') {
      await prisma.$executeRaw`DELETE FROM role_sub_module_permissions WHERE "roleName" = ${normalized}`;
      for (const [composite, isEnabled] of Object.entries(subModules)) {
        const parts = composite.split('::');
        if (parts.length !== 2) continue;
        const [modKey, subKey] = parts;
        await prisma.$executeRaw`
          INSERT INTO role_sub_module_permissions (id, "roleName", "moduleName", "subModuleKey", "enabled", "createdAt", "updatedAt")
          VALUES (${crypto.randomUUID()}, ${normalized}, ${modKey.toLowerCase()}, ${subKey.toLowerCase()}, ${isEnabled}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `;
      }
      moduleAccessCache.clear();
      return res.json({ success: true, message: 'Sub-module permissions updated' });
    }

    if (!moduleKey || !subModuleKey || typeof enabled !== 'boolean') {
      return res.status(400).json({ success: false, message: 'Either subModules{} or moduleKey+subModuleKey+enabled are required' });
    }

    await upsertSubModulePermission(
      prisma,
      'role_sub_module_permissions',
      'roleName',
      normalized,
      String(moduleKey).toLowerCase(),
      String(subModuleKey).toLowerCase(),
      enabled
    );
    moduleAccessCache.clear();
    return res.json({ success: true });
  } catch (error: any) {
    console.error('[RoleSubModulePerms] PUT error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to update sub-module permission' });
  }
};

// ─── Canonical atomic policy endpoints ─────────────────────────────────────
// These are the single source of truth for plan / role / business-type
// policies. Each save replaces the whole policy in one transaction, bumps
// policyVersion, flips permissionState to CONFIGURED and writes an audit log.
// Legacy /module-permissions/* endpoints above are deprecated.

const ENTITLEMENT_LEVELS = new Set(['FULL', 'LIMITED', 'NONE']);
const DATA_SCOPES = new Set(['OWN', 'ASSIGNED_BRANCH', 'ALL_BRANCHES', 'BUSINESS']);

// Resources an OWNER may never lose even read access to.
const MANDATORY_OWNER_RESOURCES: ReadonlyArray<{ moduleKey: string; pageKey: string; operationKey: string }> = [
  { moduleKey: 'business_management', pageKey: 'settings', operationKey: 'read' },
  { moduleKey: 'business_management', pageKey: 'roles', operationKey: 'read' },
  { moduleKey: 'business_management', pageKey: 'billing', operationKey: 'read' },
  { moduleKey: 'staff', pageKey: 'staff', operationKey: 'read' },
];

interface PolicyCatalogModulePage { key: string; id: string; }
interface PolicyCatalogModule { id: string; key: string; pages: Map<string, string>; }

interface PolicyCatalog {
  modules: Map<string, PolicyCatalogModule>;
  operations: Set<string>;
}

async function loadPolicyCatalog(prisma: any): Promise<PolicyCatalog> {
  const moduleRows = await prisma.moduleDefinition.findMany({ where: { isActive: true } });
  const pageRows = await prisma.modulePage.findMany({ where: { isActive: true } });
  const opRows = await prisma.operation.findMany({ where: { isActive: true } });

  const modules = new Map<string, PolicyCatalogModule>();
  for (const m of moduleRows) {
    modules.set(String(m.key).toLowerCase(), { id: m.id, key: String(m.key).toLowerCase(), pages: new Map() });
  }
  for (const p of pageRows) {
    const mod = modules.get(String(p.moduleId));
    if (mod) mod.pages.set(String(p.key).toLowerCase(), p.id);
  }
  return { modules, operations: new Set(opRows.map((o: any) => String(o.key).toLowerCase())) };
}

function auditSafe(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, v) => (v instanceof Date ? v.toISOString() : v)));
}

async function writePolicyAudit(
  tx: any,
  entry: {
    entityType: string;
    entityId: string;
    actorId?: string | null;
    action: string;
    before?: unknown;
    after?: unknown;
    policyVersion: number;
  }
): Promise<void> {
  await tx.policyAuditLog.create({
    data: {
      entityType: entry.entityType,
      entityId: entry.entityId,
      actorId: entry.actorId ?? null,
      action: entry.action,
      before: entry.before === undefined ? undefined : auditSafe(entry.before),
      after: entry.after === undefined ? undefined : auditSafe(entry.after),
      policyVersion: entry.policyVersion,
    },
  });
}

const actorIdOf = (req: AdminAuthRequest): string | null => req.admin?.id ?? null;

/**
 * GET /backoffice/policies/roles
 * Platform (businessId = null) roles with their policy state, used by the
 * backoffice to address the atomic role-policy endpoint by roleId.
 */
export const listPolicyRoles = async (req: AdminAuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const roles = await prisma.role.findMany({
      where: { businessId: null },
      select: { id: true, name: true, description: true, isSystem: true, permissionState: true, policyVersion: true, updatedAt: true },
      orderBy: { name: 'asc' },
    });
    return res.json({ success: true, data: roles });
  } catch (error: any) {
    console.error('[PolicyRoles] GET error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to load platform roles' });
  }
};

/**
 * PUT /backoffice/policies/plans/:planId
 * Body: { modules: [{ key: string; entitlementLevel?: 'FULL'|'LIMITED'|'NONE';
 *                    pages?: [{ key: string; entitlementLevel: 'FULL'|'LIMITED'|'NONE' }] }] }
 * Module absent from payload = no entitlement (deny). Module present = module-level
 * entitlement (default FULL). Page entries override the module level for that page.
 */
export const publishPlanPolicy = async (req: AdminAuthRequest, res: Response) => {
  const { planId } = req.params;
  const { modules } = req.body as {
    modules?: Array<{
      key: string;
      entitlementLevel?: string;
      pages?: Array<{ key: string; entitlementLevel: string }>;
    }>;
  };

  if (!planId || !Array.isArray(modules)) {
    return res.status(400).json({ success: false, message: 'planId and modules[] are required' });
  }

  try {
    const prisma = await getPrisma();
    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) return res.status(404).json({ success: false, message: `Plan ${planId} not found` });

    const catalog = await loadPolicyCatalog(prisma);
    const seenModules = new Set<string>();
    const entitlements: Array<{ planId: string; moduleKey: string; pageKey: string | null; entitlementLevel: string }> = [];

    for (const mod of modules) {
      const moduleKey = String(mod.key ?? '').toLowerCase().trim();
      const moduleDef = catalog.modules.get(moduleKey);
      if (!moduleDef) return res.status(400).json({ success: false, message: `Unknown module key: ${moduleKey}` });
      if (seenModules.has(moduleKey)) return res.status(400).json({ success: false, message: `Duplicate module: ${moduleKey}` });
      seenModules.add(moduleKey);

      const moduleLevel = String(mod.entitlementLevel ?? 'FULL').toUpperCase();
      if (!ENTITLEMENT_LEVELS.has(moduleLevel)) {
        return res.status(400).json({ success: false, message: `Invalid entitlementLevel ${moduleLevel} for module ${moduleKey}` });
      }
      entitlements.push({ planId, moduleKey, pageKey: null, entitlementLevel: moduleLevel });

      if (Array.isArray(mod.pages)) {
        const seenPages = new Set<string>();
        for (const page of mod.pages) {
          const pageKey = String(page.key ?? '').toLowerCase().trim();
          if (!moduleDef.pages.has(pageKey)) {
            return res.status(400).json({ success: false, message: `Unknown page ${moduleKey}.${pageKey}` });
          }
          if (seenPages.has(pageKey)) return res.status(400).json({ success: false, message: `Duplicate page ${moduleKey}.${pageKey}` });
          seenPages.add(pageKey);
          const level = String(page.entitlementLevel ?? 'NONE').toUpperCase();
          if (!ENTITLEMENT_LEVELS.has(level)) {
            return res.status(400).json({ success: false, message: `Invalid entitlementLevel ${level} for page ${moduleKey}.${pageKey}` });
          }
          entitlements.push({ planId, moduleKey, pageKey, entitlementLevel: level });
        }
      }
    }

    const previousRows = await prisma.planEntitlement.findMany({ where: { planId } });
    const before = previousRows.map((r: any) => ({ moduleKey: r.moduleKey, pageKey: r.pageKey, entitlementLevel: r.entitlementLevel }));
    const after = entitlements.map((e) => ({ moduleKey: e.moduleKey, pageKey: e.pageKey, entitlementLevel: e.entitlementLevel }));

    const result = await prisma.$transaction(async (tx: any) => {
      const updated = await tx.plan.update({
        where: { id: planId },
        data: { permissionState: 'CONFIGURED', policyVersion: { increment: 1 } },
      });
      await tx.planEntitlement.deleteMany({ where: { planId } });
      if (entitlements.length > 0) {
        await tx.planEntitlement.createMany({ data: entitlements });
      }
      await writePolicyAudit(tx, {
        entityType: 'PLAN',
        entityId: planId,
        actorId: actorIdOf(req),
        action: 'PUBLISH_POLICY',
        before,
        after,
        policyVersion: updated.policyVersion,
      });
      return updated;
    });

    invalidateModuleCache({ type: 'PLAN_CHANGED', businessId: planId });

    return res.json({
      success: true,
      data: { planId, policyVersion: result.policyVersion, permissionState: result.permissionState, entitlements: after },
    });
  } catch (error: any) {
    console.error('[PlanPolicy] PUT error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to publish plan policy' });
  }
};

/**
 * PUT /backoffice/policies/roles/:roleId
 * Body: { permissions: [{ moduleKey, pageKey, operationKey, allowed: boolean, scope?: string }] }
 * Missing permission entry = denied operation. OWNER role can never lose read
 * access to its mandatory resources.
 */
export const publishRolePolicy = async (req: AdminAuthRequest, res: Response) => {
  const { roleId } = req.params;
  const { permissions } = req.body as {
    permissions?: Array<{ moduleKey: string; pageKey: string; operationKey: string; allowed: boolean; scope?: string }>;
  };

  if (!roleId || !Array.isArray(permissions)) {
    return res.status(400).json({ success: false, message: 'roleId and permissions[] are required' });
  }

  try {
    const prisma = await getPrisma();
    const role = await prisma.role.findUnique({ where: { id: roleId } });
    if (!role) return res.status(404).json({ success: false, message: `Role ${roleId} not found` });

    const catalog = await loadPolicyCatalog(prisma);
    const seen = new Set<string>();
    const pageMetaById = new Map<string, { moduleKey: string; pageKey: string }>();
    const rows: Array<{ roleId: string; operationKey: string; modulePageId: string; allowed: boolean; scope: string }> = [];

    for (const perm of permissions) {
      const moduleKey = String(perm.moduleKey ?? '').toLowerCase().trim();
      const pageKey = String(perm.pageKey ?? '').toLowerCase().trim();
      const operationKey = String(perm.operationKey ?? '').toLowerCase().trim();
      const moduleDef = catalog.modules.get(moduleKey);
      if (!moduleDef) return res.status(400).json({ success: false, message: `Unknown module key: ${moduleKey}` });
      const pageId = moduleDef.pages.get(pageKey);
      if (!pageId) return res.status(400).json({ success: false, message: `Unknown page ${moduleKey}.${pageKey}` });
      if (!catalog.operations.has(operationKey)) {
        return res.status(400).json({ success: false, message: `Unknown operation key: ${operationKey}` });
      }
      const scope = String(perm.scope ?? 'BUSINESS').toUpperCase();
      if (!DATA_SCOPES.has(scope)) return res.status(400).json({ success: false, message: `Invalid scope: ${scope}` });

      const composite = `${moduleKey}.${pageKey}:${operationKey}`;
      if (seen.has(composite)) return res.status(400).json({ success: false, message: `Duplicate permission: ${composite}` });
      seen.add(composite);
      pageMetaById.set(pageId, { moduleKey, pageKey });

      rows.push({ roleId, operationKey, modulePageId: pageId, allowed: !!perm.allowed, scope });
    }

    if (String(role.name).toUpperCase() === 'OWNER') {
      for (const mandatory of MANDATORY_OWNER_RESOURCES) {
        const ok = rows.some(
          (r) =>
            r.allowed &&
            r.operationKey === mandatory.operationKey &&
            (() => {
              const mod = catalog.modules.get(mandatory.moduleKey);
              return !!mod && mod.pages.get(mandatory.pageKey) === r.modulePageId;
            })()
        );
        if (!ok) {
          return res.status(400).json({
            success: false,
            message: `OWNER role must keep ${mandatory.operationKey} on ${mandatory.moduleKey}.${mandatory.pageKey}`,
          });
        }
      }
    }

    const previousRows = await prisma.rolePermissionV2.findMany({ where: { roleId }, include: { modulePage: { include: { module: true } } } });
    const before = previousRows.map((r: any) => ({
      moduleKey: r.modulePage?.module?.key ?? null,
      pageKey: r.modulePage?.key ?? null,
      operationKey: r.operationKey,
      allowed: r.allowed,
      scope: r.scope,
    }));
    const after = rows.map((r) => {
      const meta = pageMetaById.get(r.modulePageId);
      return { moduleKey: meta?.moduleKey ?? null, pageKey: meta?.pageKey ?? null, operationKey: r.operationKey, allowed: r.allowed, scope: r.scope };
    });

    const result = await prisma.$transaction(async (tx: any) => {
      const updated = await tx.role.update({
        where: { id: roleId },
        data: { permissionState: 'CONFIGURED', policyVersion: { increment: 1 } },
      });
      await tx.rolePermissionV2.deleteMany({ where: { roleId } });
      if (rows.length > 0) {
        await tx.rolePermissionV2.createMany({ data: rows });
      }
      await writePolicyAudit(tx, {
        entityType: 'ROLE',
        entityId: roleId,
        actorId: actorIdOf(req),
        action: 'PUBLISH_POLICY',
        before,
        after,
        policyVersion: updated.policyVersion,
      });
      return updated;
    });

    invalidateModuleCache({ type: 'ROLE_PERMISSION_CHANGED', userId: roleId });

    return res.json({
      success: true,
      data: { roleId, name: role.name, policyVersion: result.policyVersion, permissionState: result.permissionState, permissions: after },
    });
  } catch (error: any) {
    console.error('[RolePolicy] PUT error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to publish role policy' });
  }
};

/**
 * PUT /backoffice/policies/business-types/:businessTypeId
 * Body: { modules: [{ key: string; enabled: boolean; pages?: [{ key: string; enabled: boolean }] }] }
 * A page cannot be enabled while its parent module is disabled.
 */
export const publishBusinessTypePolicy = async (req: AdminAuthRequest, res: Response) => {
  const { businessTypeId } = req.params;
  const { modules } = req.body as {
    modules?: Array<{ key: string; enabled: boolean; pages?: Array<{ key: string; enabled: boolean }> }>;
  };

  if (!businessTypeId || !Array.isArray(modules)) {
    return res.status(400).json({ success: false, message: 'businessTypeId and modules[] are required' });
  }

  try {
    const prisma = await getPrisma();
    const businessType = await prisma.businessType.findUnique({ where: { id: businessTypeId } });
    if (!businessType) return res.status(404).json({ success: false, message: `Business type ${businessTypeId} not found` });

    const catalog = await loadPolicyCatalog(prisma);
    const seenModules = new Set<string>();
    const moduleRows: Array<{ businessTypeId: string; moduleId: string; isEnabled: boolean }> = [];
    const pageRows: Array<{ businessTypeId: string; pageId: string; isEnabled: boolean }> = [];

    for (const mod of modules) {
      const moduleKey = String(mod.key ?? '').toLowerCase().trim();
      const moduleDef = catalog.modules.get(moduleKey);
      if (!moduleDef) return res.status(400).json({ success: false, message: `Unknown module key: ${moduleKey}` });
      if (seenModules.has(moduleKey)) return res.status(400).json({ success: false, message: `Duplicate module: ${moduleKey}` });
      seenModules.add(moduleKey);
      moduleRows.push({ businessTypeId, moduleId: moduleDef.id, isEnabled: !!mod.enabled });

      if (Array.isArray(mod.pages)) {
        const seenPages = new Set<string>();
        for (const page of mod.pages) {
          const pageKey = String(page.key ?? '').toLowerCase().trim();
          const pageId = moduleDef.pages.get(pageKey);
          if (!pageId) return res.status(400).json({ success: false, message: `Unknown page ${moduleKey}.${pageKey}` });
          if (seenPages.has(pageKey)) return res.status(400).json({ success: false, message: `Duplicate page ${moduleKey}.${pageKey}` });
          seenPages.add(pageKey);
          if (!!page.enabled && !mod.enabled) {
            return res.status(400).json({
              success: false,
              message: `Page ${moduleKey}.${pageKey} cannot be enabled while module ${moduleKey} is disabled`,
            });
          }
          pageRows.push({ businessTypeId, pageId, isEnabled: !!page.enabled });
        }
      }
    }

    const beforeModules = await prisma.businessTypeModule.findMany({ where: { businessTypeId } });
    const beforePages = await prisma.businessTypePage.findMany({ where: { businessTypeId } });
    const before = {
      modules: beforeModules.map((r: any) => ({ moduleId: r.moduleId, isEnabled: r.isEnabled })),
      pages: beforePages.map((r: any) => ({ pageId: r.pageId, isEnabled: r.isEnabled })),
    };
    const after = {
      modules: moduleRows.map((r) => ({ moduleId: r.moduleId, isEnabled: r.isEnabled })),
      pages: pageRows.map((r) => ({ pageId: r.pageId, isEnabled: r.isEnabled })),
    };

    await prisma.$transaction(async (tx: any) => {
      await tx.businessTypeModule.deleteMany({ where: { businessTypeId } });
      if (moduleRows.length > 0) await tx.businessTypeModule.createMany({ data: moduleRows });
      await tx.businessTypePage.deleteMany({ where: { businessTypeId } });
      if (pageRows.length > 0) await tx.businessTypePage.createMany({ data: pageRows });
      await writePolicyAudit(tx, {
        entityType: 'BUSINESS_TYPE',
        entityId: businessTypeId,
        actorId: actorIdOf(req),
        action: 'PUBLISH_POLICY',
        before,
        after,
        policyVersion: 0,
      });
    });

    clearModuleCache();

    return res.json({ success: true, data: { businessTypeId, modules: after.modules, pages: after.pages } });
  } catch (error: any) {
    console.error('[BusinessTypePolicy] PUT error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to publish business type policy' });
  }
};

/**
 * POST /backoffice/policies/preview
 * Body: { businessTypeId?: string; planId: string; roleId?: string }
 * Read-only evaluation of the three policy layers for every module/page.
 */
export const previewEffectiveAccess = async (req: AdminAuthRequest, res: Response) => {
  const { businessTypeId, planId, roleId } = req.body as { businessTypeId?: string; planId?: string; roleId?: string };

  if (!planId) {
    return res.status(400).json({ success: false, message: 'planId is required' });
  }

  try {
    const prisma = await getPrisma();
    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) return res.status(404).json({ success: false, message: `Plan ${planId} not found` });

    const catalog = await loadPolicyCatalog(prisma);

    const [planEntitlements, businessTypeModules, businessTypePages, rolePermissions] = await Promise.all([
      prisma.planEntitlement.findMany({ where: { planId } }),
      businessTypeId ? prisma.businessTypeModule.findMany({ where: { businessTypeId } }) : Promise.resolve([]),
      businessTypeId ? prisma.businessTypePage.findMany({ where: { businessTypeId } }) : Promise.resolve([]),
      roleId ? prisma.rolePermissionV2.findMany({ where: { roleId } }) : Promise.resolve([]),
    ]);

    const entitlementByKey = new Map<string, string>();
    for (const e of planEntitlements) {
      const key = e.pageKey ? `${e.moduleKey}.${e.pageKey}` : e.moduleKey;
      entitlementByKey.set(key, String(e.entitlementLevel).toUpperCase());
    }

    const btModuleById = new Map(businessTypeModules.map((r: any) => [String(r.moduleId).toLowerCase(), !!r.isEnabled]));
    const btPageById = new Map(businessTypePages.map((r: any) => [String(r.pageId).toLowerCase(), !!r.isEnabled]));
    const roleOpByPage = new Map<string, Array<{ operationKey: string; allowed: boolean; scope: string }>>();
    for (const rp of rolePermissions) {
      const pageId = String(rp.modulePageId).toLowerCase();
      if (!roleOpByPage.has(pageId)) roleOpByPage.set(pageId, []);
      roleOpByPage.get(pageId)!.push({ operationKey: rp.operationKey, allowed: rp.allowed, scope: rp.scope });
    }

    const matrix: Array<Record<string, unknown>> = [];
    for (const mod of catalog.modules.values()) {
      const btModuleAllowed = businessTypeId ? (btModuleById.get(mod.id.toLowerCase()) ?? false) : true;
      for (const [pageKey, pageId] of mod.pages) {
        const moduleEntitlement = entitlementByKey.get(mod.key) ?? 'NONE';
        const pageEntitlement = entitlementByKey.get(`${mod.key}.${pageKey}`) ?? moduleEntitlement;
        const btPageAllowed = businessTypeId ? (btPageById.get(pageId.toLowerCase()) ?? false) : true;

        const operations = (roleOpByPage.get(pageId.toLowerCase()) ?? []).map((op) => ({
          operationKey: op.operationKey,
          allowed: op.allowed,
          scope: op.scope,
        }));

        let allowed = btModuleAllowed && btPageAllowed && pageEntitlement !== 'NONE';
        let reason = 'ALLOWED';
        if (!btModuleAllowed) reason = 'BUSINESS_TYPE_MODULE_DENIED';
        else if (!btPageAllowed) reason = 'BUSINESS_TYPE_PAGE_DENIED';
        else if (pageEntitlement === 'NONE') reason = 'PLAN_NOT_ENTITLED';
        else if (pageEntitlement === 'LIMITED') reason = 'PLAN_READ_ONLY';

        matrix.push({
          moduleKey: mod.key,
          pageKey,
          businessType: businessTypeId ? { enabled: btModuleAllowed && btPageAllowed } : null,
          plan: { entitlementLevel: pageEntitlement },
          role: { operations },
          effective: { allowed, reason },
        });
      }
    }

    return res.json({
      success: true,
      data: {
        planId,
        businessTypeId: businessTypeId ?? null,
        roleId: roleId ?? null,
        planPermissionState: plan.permissionState,
        planPolicyVersion: plan.policyVersion,
        matrix,
      },
    });
  } catch (error: any) {
    console.error('[PolicyPreview] POST error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to preview effective access' });
  }
};
