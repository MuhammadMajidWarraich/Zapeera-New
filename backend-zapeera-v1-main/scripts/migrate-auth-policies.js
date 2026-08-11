#!/usr/bin/env node
/**
 * Idempotent migration from the legacy raw permission tables
 * (plan_module_permissions / role_module_permissions / *_sub_module_permissions)
 * to the canonical policy models (PlanEntitlement, RolePermissionV2,
 * BusinessTypePage + BusinessTypeModule).
 *
 * What it does:
 *   1. Backs up the database (SQLite file copy, or JSON dump of the legacy
 *      tables when running against PostgreSQL).
 *   2. Migrates plan_module_permissions  -> PlanEntitlement (module level).
 *      plan_sub_module_permissions      -> PlanEntitlement (page level).
 *   3. Migrates role_module_permissions -> RolePermissionV2 (all operations on
 *      every page of every enabled module) + role_sub_module_permissions
 *      (explicit page exclusions).
 *   4. Migrates business_type_sub_module_permissions -> BusinessTypePage and
 *      missing BusinessTypeModule rows.
 *   5. Ensures every business has an ACTIVE OWNER membership (created by its
 *      creator — never synthesized when no creator can be found).
 *   6. Marks migrated plans/roles permissionState=CONFIGURED, bumps
 *      policyVersion, writes PolicyAuditLog rows and bumps
 *      Business.policyVersion for affected businesses.
 *
 * Safe to re-run: completed entities are skipped. Legacy tables are left in
 * place (read-only from now on).
 *
 * Usage: node scripts/migrate-auth-policies.js
 */

'use strict';

require('dotenv').config({ override: false });

const fs = require('fs');
const path = require('path');
const { resolveModeFromEnv, modeLabel } = require('./db-mode');

const ROOT = path.join(__dirname, '..');
const LEGACY_TABLES = [
  'plan_module_permissions',
  'plan_sub_module_permissions',
  'role_module_permissions',
  'role_sub_module_permissions',
  'business_type_sub_module_permissions',
];
const DEFAULT_OPERATIONS = ['read', 'create', 'update', 'delete', 'export', 'import', 'approve', 'print'];
const SYSTEM_ROLE_NAMES = ['OWNER', 'MANAGER', 'CASHIER'];

function sqliteFilePath() {
  const url = process.env.DATABASE_URL || 'file:./prisma/dev.db';
  const m = /^file:(.+)$/.exec(url.trim());
  if (m) {
    const p = path.isAbsolute(m[1]) ? m[1] : path.join(ROOT, m[1]);
    return path.resolve(p);
  }
  return path.join(ROOT, 'prisma', 'dev.db');
}

function backupPath(ext) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(ROOT, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `auth-policies-${stamp}${ext}`);
}

async function dumpLegacyTables(prisma, dest) {
  const dump = {};
  for (const table of LEGACY_TABLES) {
    try {
      const rows = await prisma.$queryRawUnsafe(`SELECT * FROM ${table}`);
      dump[table] = rows.map((r) => ({ ...r }));
    } catch (e) {
      dump[table] = null;
    }
  }
  fs.writeFileSync(dest, JSON.stringify(dump, null, 2));
  return dump;
}

async function rawAll(prisma, sql) {
  try {
    return await prisma.$queryRawUnsafe(sql);
  } catch (e) {
    return [];
  }
}

async function loadCatalog(prisma) {
  const modules = new Map();
  try {
    const moduleRows = await prisma.moduleDefinition.findMany({ where: { isActive: true } });
    for (const m of moduleRows) {
      modules.set(String(m.key).toLowerCase(), { id: m.id, key: String(m.key).toLowerCase(), pages: new Map() });
    }
    const pageRows = await prisma.modulePage.findMany({ where: { isActive: true } });
    for (const p of pageRows) {
      const mod = modules.get(String(p.moduleId));
      if (mod) mod.pages.set(String(p.key).toLowerCase(), p.id);
    }
  } catch (e) {
    throw new Error(`Cannot load module catalog — is the canonical schema applied (db push / db deploy)? ${e.message}`);
  }

  let operations = DEFAULT_OPERATIONS;
  try {
    const opRows = await prisma.operation.findMany({ where: { isActive: true } });
    if (opRows.length > 0) operations = opRows.map((o) => String(o.key).toLowerCase());
  } catch (e) {
    /* keep defaults */
  }

  return { modules, operations };
}

function moduleKeyOf(catalog, legacyModuleName) {
  return catalog.modules.get(String(legacyModuleName || '').toLowerCase().trim());
}

async function writeAudit(prisma, entry) {
  try {
    await prisma.policyAuditLog.create({
      data: {
        entityType: entry.entityType,
        entityId: entry.entityId,
        actorId: null,
        action: 'MIGRATED_FROM_LEGACY',
        before: entry.before,
        after: entry.after,
        policyVersion: entry.policyVersion,
      },
    });
  } catch (e) {
    console.warn(`[MigrateAuthPolicies] ⚠️ Audit log write skipped for ${entry.entityType} ${entry.entityId}: ${e.message}`);
  }
}

async function migratePlans(prisma, catalog) {
  const planRows = await rawAll(prisma, 'SELECT "planId", "moduleName", "enabled" FROM plan_module_permissions');
  const planSubRows = await rawAll(prisma, 'SELECT "planId", "moduleName", "subModuleKey", "enabled" FROM plan_sub_module_permissions');
  const planIds = [...new Set([...planRows, ...planSubRows].map((r) => String(r.planId)))];

  const stats = { plans: 0, entitlementRows: 0 };
  for (const planId of planIds) {
    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) continue;

    const existingCount = await prisma.planEntitlement.count({ where: { planId } });
    if (existingCount > 0 && String(plan.permissionState || '').toUpperCase() === 'CONFIGURED') continue;

    const entitlements = [];
    for (const r of planRows) {
      if (String(r.planId) !== planId || !r.enabled) continue;
      const mod = moduleKeyOf(catalog, r.moduleName);
      if (mod) entitlements.push({ planId, moduleKey: mod.key, pageKey: null, entitlementLevel: 'FULL' });
    }
    for (const r of planSubRows) {
      if (String(r.planId) !== planId) continue;
      const mod = moduleKeyOf(catalog, r.moduleName);
      const pageId = mod && mod.pages.get(String(r.subModuleKey).toLowerCase());
      if (!mod || !pageId) continue;
      entitlements.push({
        planId,
        moduleKey: mod.key,
        pageKey: String(r.subModuleKey).toLowerCase(),
        entitlementLevel: r.enabled ? 'FULL' : 'NONE',
      });
    }
    if (entitlements.length === 0) continue;

    const nextVersion = plan.policyVersion + 1;
    await prisma.$transaction([
      prisma.planEntitlement.createMany({ data: entitlements }),
      prisma.plan.update({
        where: { id: planId },
        data: { permissionState: 'CONFIGURED', policyVersion: { increment: 1 } },
      }),
    ]);
    await writeAudit(prisma, {
      entityType: 'PLAN',
      entityId: planId,
      before: { legacyModuleRows: planRows.filter((r) => String(r.planId) === planId).length },
      after: { entitlements },
      policyVersion: nextVersion,
    });
    stats.plans++;
    stats.entitlementRows += entitlements.length;
  }
  return stats;
}

async function migrateRoles(prisma, catalog) {
  const roleRows = await rawAll(prisma, 'SELECT "roleName", "moduleName", "enabled" FROM role_module_permissions');
  const roleSubRows = await rawAll(prisma, 'SELECT "roleName", "moduleName", "subModuleKey", "enabled" FROM role_sub_module_permissions');
  const roleNames = [...new Set([...roleRows, ...roleSubRows].map((r) => String(r.roleName).toUpperCase()))];
  if (roleNames.length === 0) return { roles: 0, grantRows: 0 };

  const allRoles = await prisma.role.findMany({ select: { id: true, name: true, permissionState: true, policyVersion: true } });
  const rolesByName = allRoles.filter((r) => roleNames.includes(String(r.name).toUpperCase()));

  const stats = { roles: 0, grantRows: 0 };
  for (const role of rolesByName) {
    const existingCount = await prisma.rolePermissionV2.count({ where: { roleId: role.id } });
    if (existingCount > 0 && String(role.permissionState || '').toUpperCase() === 'CONFIGURED') continue;

    const enabledMods = roleRows
      .filter((r) => String(r.roleName).toUpperCase() === String(role.name).toUpperCase() && r.enabled)
      .map((r) => String(r.moduleName).toLowerCase());
    const excludedPages = new Set(
      roleSubRows
        .filter((r) => String(r.roleName).toUpperCase() === String(role.name).toUpperCase() && !r.enabled)
        .map((r) => `${String(r.moduleName).toLowerCase()}.${String(r.subModuleKey).toLowerCase()}`)
    );

    const grants = [];
    for (const modKey of enabledMods) {
      const mod = catalog.modules.get(modKey);
      if (!mod) continue;
      for (const [pageKey, pageId] of mod.pages) {
        if (excludedPages.has(`${modKey}.${pageKey}`)) continue;
        for (const operationKey of catalog.operations) {
          grants.push({ roleId: role.id, operationKey, modulePageId: pageId, allowed: true, scope: 'BUSINESS' });
        }
      }
    }
    if (grants.length === 0) continue;

    const nextVersion = role.policyVersion + 1;
    await prisma.$transaction([
      prisma.rolePermissionV2.createMany({ data: grants }),
      prisma.role.update({
        where: { id: role.id },
        data: { permissionState: 'CONFIGURED', policyVersion: { increment: 1 } },
      }),
    ]);
    await writeAudit(prisma, {
      entityType: 'ROLE',
      entityId: role.id,
      before: { legacyModuleRows: roleRows.filter((r) => String(r.roleName).toUpperCase() === String(role.name).toUpperCase()).length },
      after: { grantCount: grants.length, moduleKeys: [...new Set(grants.map((g) => g.modulePageId))].length },
      policyVersion: nextVersion,
    });
    stats.roles++;
    stats.grantRows += grants.length;
  }
  return stats;
}

async function migrateBusinessTypes(prisma, catalog) {
  const btRows = await rawAll(prisma, 'SELECT "businessTypeId", "moduleName", "subModuleKey", "enabled" FROM business_type_sub_module_permissions');
  const btIds = [...new Set(btRows.map((r) => String(r.businessTypeId)))];

  const stats = { businessTypes: 0, pageRows: 0, moduleRows: 0 };
  for (const btId of btIds) {
    const existingPages = await prisma.businessTypePage.count({ where: { businessTypeId: btId } });
    if (existingPages > 0) continue;

    const rows = btRows.filter((r) => String(r.businessTypeId) === btId);
    const pageRows = [];
    const moduleAnyEnabled = new Map();
    const seenPages = new Set();
    for (const r of rows) {
      const mod = moduleKeyOf(catalog, r.moduleName);
      if (!mod) continue;
      moduleAnyEnabled.set(mod.key, (moduleAnyEnabled.get(mod.key) ?? false) || !!r.enabled);
      const pageId = mod.pages.get(String(r.subModuleKey).toLowerCase());
      if (!pageId) continue;
      const composite = `${btId}:${pageId}`;
      if (seenPages.has(composite)) continue;
      seenPages.add(composite);
      pageRows.push({ businessTypeId: btId, pageId, isEnabled: !!r.enabled });
    }

    for (const [modKey, anyEnabled] of moduleAnyEnabled) {
      const mod = catalog.modules.get(modKey);
      if (!mod) continue;
      const existing = await prisma.businessTypeModule.findUnique({
        where: { businessTypeId_moduleId: { businessTypeId: btId, moduleId: mod.id } },
      });
      if (!existing) {
        await prisma.businessTypeModule.create({
          data: { businessTypeId: btId, moduleId: mod.id, isEnabled: anyEnabled },
        });
        stats.moduleRows++;
      }
    }
    if (pageRows.length > 0) {
      await prisma.businessTypePage.createMany({ data: pageRows });
      stats.pageRows += pageRows.length;
    }
    await writeAudit(prisma, {
      entityType: 'BUSINESS_TYPE',
      entityId: btId,
      before: { legacySubModuleRows: rows.length },
      after: { pages: pageRows.map((p) => ({ pageId: p.pageId, isEnabled: p.isEnabled })) },
      policyVersion: 0,
    });
    stats.businessTypes++;
  }
  return stats;
}

async function ensureOwnerMemberships(prisma) {
  const businesses = await prisma.business.findMany({
    select: { id: true, createdBy: true, name: true },
  });

  const stats = { ownerMemberships: 0, businessesBumped: 0 };
  const toBump = new Set();
  for (const business of businesses) {
    const ownerRole = await prisma.role.findFirst({ where: { businessId: business.id, name: 'OWNER' } });
    if (ownerRole) {
      const activeOwner = await prisma.membership.findFirst({
        where: { businessId: business.id, roleId: ownerRole.id, status: 'ACTIVE' },
      });
      if (activeOwner) continue;
    }
    if (!business.createdBy) continue; // no synthesis without a known creator
    const creator = await prisma.zapeeraUser.findUnique({ where: { id: business.createdBy } });
    if (!creator) continue;

    const role =
      ownerRole ||
      (await prisma.role.create({
        data: { businessId: business.id, name: 'OWNER', description: 'Business owner (system role)', isSystem: true },
      }));

    await prisma.membership.upsert({
      where: { unique_user_business: { userId: business.createdBy, businessId: business.id } },
      update: { roleId: role.id, status: 'ACTIVE' },
      create: { userId: business.createdBy, businessId: business.id, roleId: role.id, status: 'ACTIVE' },
    });
    stats.ownerMemberships++;
    toBump.add(business.id);
    console.log(`[MigrateAuthPolicies] 👑 Owner membership ensured for business "${business.name}" (${business.id})`);
  }

  for (const businessId of toBump) {
    await prisma.business.update({
      where: { id: businessId },
      data: { policyVersion: { increment: 1 } },
    });
    stats.businessesBumped++;
  }
  return stats;
}

async function ensureSystemRoles(prisma) {
  let created = 0;
  for (const name of SYSTEM_ROLE_NAMES) {
    const existing = await prisma.role.findFirst({ where: { businessId: null, name } });
    if (!existing) {
      await prisma.role.create({ data: { businessId: null, name, isSystem: true, description: `Platform ${name} preset role` } });
      created++;
    }
  }
  return created;
}

async function main() {
  const mode = resolveModeFromEnv(process.env);
  console.log(`[MigrateAuthPolicies] Mode: ${modeLabel(mode)}`);

  const prisma = new PrismaClient();
  await prisma.$connect();

  try {
    if (mode === 'sqlite') {
      const dbPath = sqliteFilePath();
      if (fs.existsSync(dbPath)) {
        const dest = backupPath('.db');
        fs.copyFileSync(dbPath, dest);
        console.log(`[MigrateAuthPolicies] 📦 SQLite backup → ${dest}`);
      } else {
        console.warn(`[MigrateAuthPolicies] ⚠️ SQLite file not found, skipping file backup: ${dbPath}`);
      }
    } else {
      const dest = backupPath('.legacy-dump.json');
      await dumpLegacyTables(prisma, dest);
      console.log(`[MigrateAuthPolicies] 📦 Legacy table dump → ${dest}`);
    }

    const catalog = await loadCatalog(prisma);
    console.log(
      `[MigrateAuthPolicies] Catalog: ${catalog.modules.size} modules, ${catalog.operations.length} operations`
    );

    const planStats = await migratePlans(prisma, catalog);
    const roleStats = await migrateRoles(prisma, catalog);
    const btStats = await migrateBusinessTypes(prisma, catalog);
    const ownerStats = await ensureOwnerMemberships(prisma);
    const systemRoles = await ensureSystemRoles(prisma);

    console.log('[MigrateAuthPolicies] ✅ Summary:');
    console.log(`   plans migrated:            ${planStats.plans} (${planStats.entitlementRows} entitlement rows)`);
    console.log(`   roles migrated:            ${roleStats.roles} (${roleStats.grantRows} grant rows)`);
    console.log(`   business types migrated:   ${btStats.businessTypes} (${btStats.pageRows} pages, ${btStats.moduleRows} modules)`);
    console.log(`   owner memberships ensured: ${ownerStats.ownerMemberships} (${ownerStats.businessesBumped} businesses bumped)`);
    console.log(`   system roles ensured:      ${systemRoles}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[MigrateAuthPolicies] ❌ Failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
