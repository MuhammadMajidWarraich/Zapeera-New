import { Response } from 'express';
import { AdminAuthRequest } from '../middleware/admin-auth.middleware';
import { getPrisma } from '../utils/db.util';
import { loadPricingPlans } from '../utils/subscription-entitlements.util';
import { invalidateModuleCache, moduleAccessCache } from '../utils/modules-v2.util';
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
       planId TEXT NOT NULL,
       moduleName TEXT NOT NULL,
       enabled INTEGER NOT NULL DEFAULT 0,
       createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
       updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
       UNIQUE(planId, moduleName)
     )`,
    `CREATE TABLE IF NOT EXISTS role_module_permissions (
       id TEXT PRIMARY KEY,
       roleName TEXT NOT NULL,
       moduleName TEXT NOT NULL,
       enabled INTEGER NOT NULL DEFAULT 0,
       createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
       updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
       UNIQUE(roleName, moduleName)
     )`,
    // Sub-module permission tables
    `CREATE TABLE IF NOT EXISTS business_type_sub_module_permissions (
       id TEXT PRIMARY KEY,
       businessTypeId TEXT NOT NULL,
       moduleName TEXT NOT NULL,
       subModuleKey TEXT NOT NULL,
       enabled INTEGER NOT NULL DEFAULT 1,
       createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
       updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
       UNIQUE(businessTypeId, moduleName, subModuleKey)
     )`,
    `CREATE TABLE IF NOT EXISTS plan_sub_module_permissions (
       id TEXT PRIMARY KEY,
       planId TEXT NOT NULL,
       moduleName TEXT NOT NULL,
       subModuleKey TEXT NOT NULL,
       enabled INTEGER NOT NULL DEFAULT 1,
       createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
       updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
       UNIQUE(planId, moduleName, subModuleKey)
     )`,
    `CREATE TABLE IF NOT EXISTS role_sub_module_permissions (
       id TEXT PRIMARY KEY,
       roleName TEXT NOT NULL,
       moduleName TEXT NOT NULL,
       subModuleKey TEXT NOT NULL,
       enabled INTEGER NOT NULL DEFAULT 1,
       createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
       updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
       UNIQUE(roleName, moduleName, subModuleKey)
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
  const enabledVal = enabled ? 1 : 0;
  const id = crypto.randomUUID();
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO ${table} (id, ${scopeCol}, moduleName, enabled, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      id, scopeVal, moduleName, enabledVal
    );
  } catch (insertErr: any) {
    const message = String(insertErr?.message || '').toLowerCase();
    if (message.includes('unique') || message.includes('constraint')) {
      await prisma.$executeRawUnsafe(
        `UPDATE ${table} SET enabled = ?, updatedAt = CURRENT_TIMESTAMP
         WHERE ${scopeCol} = ? AND moduleName = ?`,
        enabledVal, scopeVal, moduleName
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
  await prisma.$executeRawUnsafe(
    `DELETE FROM ${table} WHERE ${scopeCol} = ? AND moduleName = ? AND subModuleKey = ?`,
    scopeVal, moduleName, subModuleKey
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO ${table} (id, ${scopeCol}, moduleName, subModuleKey, enabled, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    crypto.randomUUID(), scopeVal, moduleName, subModuleKey, enabled ? 1 : 0
  );
}

export const getModulePermissionMatrix = async (req: AdminAuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    await ensureModulePermissionTables(prisma);

    const roles = await prisma.$queryRawUnsafe<any[]>(
      `SELECT roleName, moduleName, enabled FROM role_module_permissions ORDER BY roleName, moduleName`
    );
    const plans = await prisma.$queryRawUnsafe<any[]>(
      `SELECT planId, moduleName, enabled FROM plan_module_permissions ORDER BY planId, moduleName`
    );
    const allModRows = await prisma.$queryRawUnsafe<any[]>('SELECT name FROM modules');
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
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT ${scopeCol} AS scope, moduleName, subModuleKey, enabled FROM ${table}`
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

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT planId, moduleName, enabled FROM plan_module_permissions ORDER BY planId, moduleName`
    );

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
    await prisma.$executeRawUnsafe(`DELETE FROM plan_module_permissions WHERE planId = ?`, planId);

    for (const mod of allMods) {
      const enabled = normalizedModules.includes(mod) ? 1 : 0;
      const id = crypto.randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO plan_module_permissions (id, planId, moduleName, enabled, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        id, planId, mod, enabled
      );
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

    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT roleName, moduleName, enabled FROM role_module_permissions ORDER BY roleName, moduleName`
    );

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

    await prisma.$executeRawUnsafe(`DELETE FROM role_module_permissions WHERE roleName = ?`, normalized);

    for (const mod of allMods) {
      const enabled = normalizedModules.includes(mod) ? 1 : 0;
      const id = crypto.randomUUID();
      await prisma.$executeRawUnsafe(
        `INSERT INTO role_module_permissions (id, roleName, moduleName, enabled, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        id, normalized, mod, enabled
      );
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
      await prisma.$executeRawUnsafe(
        `DELETE FROM business_type_sub_module_permissions WHERE businessTypeId = ?`, id
      );

      // Insert all entries
      for (const [composite, isEnabled] of Object.entries(subModules)) {
        const parts = composite.split('::');
        if (parts.length !== 2) continue;
        const [modKey, subKey] = parts;
        await prisma.$executeRawUnsafe(
          `INSERT INTO business_type_sub_module_permissions (id, businessTypeId, moduleName, subModuleKey, enabled, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          crypto.randomUUID(), id, modKey.toLowerCase(), subKey.toLowerCase(), isEnabled ? 1 : 0
        );
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
      await prisma.$executeRawUnsafe(
        `DELETE FROM plan_sub_module_permissions WHERE planId = ?`, planId
      );
      for (const [composite, isEnabled] of Object.entries(subModules)) {
        const parts = composite.split('::');
        if (parts.length !== 2) continue;
        const [modKey, subKey] = parts;
        await prisma.$executeRawUnsafe(
          `INSERT INTO plan_sub_module_permissions (id, planId, moduleName, subModuleKey, enabled, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          crypto.randomUUID(), planId, modKey.toLowerCase(), subKey.toLowerCase(), isEnabled ? 1 : 0
        );
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
      await prisma.$executeRawUnsafe(
        `DELETE FROM role_sub_module_permissions WHERE roleName = ?`, normalized
      );
      for (const [composite, isEnabled] of Object.entries(subModules)) {
        const parts = composite.split('::');
        if (parts.length !== 2) continue;
        const [modKey, subKey] = parts;
        await prisma.$executeRawUnsafe(
          `INSERT INTO role_sub_module_permissions (id, roleName, moduleName, subModuleKey, enabled, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          crypto.randomUUID(), normalized, modKey.toLowerCase(), subKey.toLowerCase(), isEnabled ? 1 : 0
        );
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
