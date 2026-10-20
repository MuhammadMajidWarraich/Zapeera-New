import { getPrisma } from './db.util';

const isMissingTableError = (error: any): boolean => {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('no such table') ||
    (message.includes('relation') && message.includes('does not exist')) ||
    message.includes('p2021')
  );
};

const STANDARD_MODULES = [
  { name: 'sales',               displayName: 'Sales',                description: 'Point of sale, invoices, refunds and customers' },
  { name: 'inventory',           displayName: 'Inventory',            description: 'Products, categories, manufacturers, shelves and batches' },
  { name: 'purchases',           displayName: 'Purchases',            description: 'Suppliers and purchase orders' },
  { name: 'reports',             displayName: 'Reports & Analytics',  description: 'Basic and advanced business reports' },
  { name: 'prescriptions',       displayName: 'Prescriptions',        description: 'Prescription management' },
  { name: 'business_management', displayName: 'Business Management',  description: 'Branches, staff and shifts management' },
  { name: 'expenses',            displayName: 'Expenses',             description: 'Track and manage business expenses' },
  { name: 'subscription',        displayName: 'Subscription',         description: 'Billing and subscription management' },
  { name: 'employee_portal',     displayName: 'Employee Portal',      description: 'Self-service portal for employees (attendance, shifts, profile, notifications)' },
];

// Built-in business types seeded at boot (id = UPPER_SNAKE_CASE name).
const DEFAULT_BUSINESS_TYPES = [
  { id: 'PHARMACY',           name: 'PHARMACY',           description: 'Pharmacy and medical stores' },
  { id: 'DEPARTMENTAL_STORE', name: 'DEPARTMENTAL_STORE', description: 'General retail and departmental stores' },
  { id: 'RETAIL_STORE',       name: 'RETAIL_STORE',       description: 'General retail stores' },
  { id: 'HOTEL',              name: 'HOTEL',              description: 'Hotels and hospitality' },
  { id: 'CLINIC',             name: 'CLINIC',             description: 'Medical clinics' },
];

// Runtime plan ids (src/config/constants.ts + ensureDefaultPlansExist).
const RUNTIME_PLAN_IDS = ['single-trial', 'single-starter', 'single-growth', 'single-scale'];

/**
 * QA A-06: plan_module_permissions / role_module_permissions (and the
 * sub-module tables) are created lazily by module-permissions.controller on
 * first backoffice use — but boot code in this file queries them before
 * that, producing 42P01 "relation does not exist" on every fresh boot.
 * Create them up-front with DDL identical to the controller's, so the first
 * query (boot or request) always finds them. Idempotent (IF NOT EXISTS).
 */
let _modulePermissionTablesEnsured = false;
export async function ensureModulePermissionTablesExist(): Promise<void> {
  if (_modulePermissionTablesEnsured) return;
  const prisma = await getPrisma();
  const ddl = [
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
    try {
      await prisma.$executeRawUnsafe(stmt);
    } catch (e: any) {
      if (isMissingTableError(e)) return;
      console.error('[Modules] ❌ Failed to ensure module permission table:', e?.message || e);
    }
  }
  _modulePermissionTablesEnsured = true;
}

export async function ensureModulesExist(): Promise<void> {
  const prisma = await getPrisma();
  try {
    for (const mod of STANDARD_MODULES) {
      await (prisma.module as any).upsert({
        where: { name: mod.name },
        update: {
          displayName: mod.displayName,
          description: mod.description,
          updatedAt: new Date()
        } as any,
        create: {
          name: mod.name,
          displayName: mod.displayName,
          description: mod.description
        }
      });
      console.log(`[Modules] ✅ Ensured module: ${mod.name}`);
    }
    console.log(`[Modules] ✅ All ${STANDARD_MODULES.length} standard modules ensured`);
  } catch (error: any) {
    if (isMissingTableError(error)) return;
    throw error;
  }
}

export async function ensureBusinessTypesExist(): Promise<void> {
  const prisma = await getPrisma();
  try {
    // Seed the built-in default types (id = UPPER_SNAKE_CASE name, same convention for all types).
    // New types created by super admin via the backoffice UI follow the same convention
    // and are already persisted — we never touch those here.
    const defaultTypes = DEFAULT_BUSINESS_TYPES;

    for (const type of defaultTypes) {
      const existing = await prisma.businessType.findUnique({ where: { name: type.name } });
      if (existing) {
        if (existing.description !== type.description) {
          await prisma.businessType.update({ where: { id: existing.id }, data: { description: type.description } });
        }
      } else {
        await prisma.businessType.create({ data: { id: type.id, name: type.name, description: type.description } });
      }
    }

    // Migrate legacy company.businessType values to canonical UPPER_SNAKE_CASE ids
    const legacyMappings: Array<{ from: string; to: string }> = [
      { from: 'STORE',            to: 'DEPARTMENTAL_STORE' },
      { from: 'Pharmacy',         to: 'PHARMACY' },
      { from: 'Departmental Store', to: 'DEPARTMENTAL_STORE' },
      { from: 'Retail store',     to: 'RETAIL_STORE' },
      { from: 'Retail Store',     to: 'RETAIL_STORE' },
      { from: 'Hotel',            to: 'HOTEL' },
      { from: 'Clinic',           to: 'CLINIC' },
    ];
    try {
      for (const { from, to } of legacyMappings) {
        await prisma.business.updateMany({ where: { businessType: from }, data: { businessType: to } });
      }
    } catch {
      // ignore (older DBs may not have this column yet)
    }

    // Auto-seed business_type_modules for default business types that have NO module configuration.
    // Only seeds when zero rows exist — preserves any existing super admin configuration.
    // IMPORTANT: business_type_modules.moduleId has an FK to module_definitions(id), so seed
    // using module_definitions ids (NOT legacy modules ids — they differ for some modules).
    //
    // QA A-06 fixes applied here:
    //  - Ordering: module_definitions are seeded FIRST (they used to be seeded
    //    only by a lazy warm-up that ran after this function, so the lookup
    //    below found nothing on a fresh boot).
    //  - The old fallback to legacy `modules` ids is GONE: those ids violate
    //    the FK (23503) on every insert. If module_definitions is still empty
    //    we skip and log an ERROR instead of failing every insert silently.
    //  - Honest reporting: insert failures are logged as errors and the
    //    summary prints rows actually inserted, not rows attempted.
    try {
      try {
        const { ensureModuleAccessV2SeedData } = await import('./modules-v2.util');
        await ensureModuleAccessV2SeedData(prisma as any);
      } catch (seedErr: any) {
        console.error('[Modules] ❌ Failed to seed module definitions before business-type seeding:', seedErr?.message || seedErr);
      }

      const moduleDefinitions: any[] = await (prisma.moduleDefinition as any).findMany({ select: { id: true, key: true } });

      if (moduleDefinitions.length === 0) {
        console.error('[Modules] ❌ module_definitions is empty — skipping business_type_modules seeding (legacy module ids would violate the FK).');
      } else {
        for (const type of defaultTypes) {
          const rowCount = await prisma.$queryRaw<{ cnt: number }[]>`SELECT COUNT(*) as cnt FROM business_type_modules WHERE "businessTypeId" = ${type.id}`;
          if (Number(rowCount?.[0]?.cnt ?? 0) > 0) continue;

          const now = new Date();
          let inserted = 0;
          let insertErrors = 0;
          for (const mod of moduleDefinitions) {
            try {
              inserted += await prisma.$executeRaw`
                INSERT INTO business_type_modules ("businessTypeId", "moduleId", "isEnabled", "sortOrder", "createdAt", "updatedAt")
                VALUES (${type.id}, ${mod.id}, true, 0, ${now}, ${now})
                ON CONFLICT ("businessTypeId", "moduleId") DO NOTHING
              `;
            } catch (insertErr: any) {
              insertErrors++;
              console.error(`[Modules] ❌ Failed to seed business_type_modules for ${type.name}/${mod.key}:`, insertErr?.message || insertErr);
            }
          }
          if (insertErrors > 0) {
            console.error(`[Modules] ❌ business_type_modules seeding for ${type.name} incomplete: ${inserted} inserted, ${insertErrors} failed`);
          } else if (inserted > 0) {
            console.log(`[Modules] Auto-seeded ${inserted} module entries for business type ${type.name}`);
          }
        }
      }
    } catch (seedBlockErr: any) {
      if (isMissingTableError(seedBlockErr)) {
        console.error('[Modules] ❌ business_type_modules seeding skipped — table missing:', seedBlockErr?.message || seedBlockErr);
      } else {
        console.error('[Modules] ❌ business_type_modules seeding failed:', seedBlockErr?.message || seedBlockErr);
      }
    }

  } catch (error: any) {
    if (isMissingTableError(error)) return;
    console.error('[ensureBusinessTypesExist] Error:', error.message);
  }
}

export async function enableDefaultModulesForBusiness(businessId: string): Promise<void> {
  const prisma = await getPrisma();
  try {
    // Get the business to find its business type
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { businessType: true }
    });

    if (!business || !business.businessType) {
      console.warn(`[Modules] Business ${businessId} has no business type, using default modules`);
      // Fall back to standard modules if no business type
      await enableStandardModules(businessId);
      return;
    }

    // Normalize business type name for matching
    const businessTypeName = business.businessType.toUpperCase().replace(/[\s-]+/g, '_');
    
    // Find the business type template (use raw SQL — SQLite does not support Prisma mode:'insensitive')
    const btRows = await prisma.$queryRaw<any[]>`
      SELECT id FROM business_types
      WHERE UPPER(name) = UPPER(${businessTypeName})
         OR UPPER(name) = UPPER(${business.businessType})
      LIMIT 1
    `;
    const btId = btRows?.[0]?.id;

    const businessType = btId
      ? await (prisma.businessType as any).findUnique({
          where: { id: btId },
          include: { modules: { include: { module: true } } }
        })
      : null;

    if (!businessType) {
      console.warn(`[Modules] Business type "${businessTypeName}" not found, using default modules`);
      await enableStandardModules(businessId);
      return;
    }

    // Build sets of enabled / all module names from the business type template
    // BusinessTypeModule links to ModuleDefinition via moduleId
    const allTypeModuleNames = new Set<string>(
      businessType.modules?.map((mtm: any) => String(mtm.module?.key || mtm.module?.name || '').toLowerCase()).filter(Boolean) || []
    );
    const enabledModuleNames = new Set<string>(
      businessType.modules
        ?.filter((mtm: any) => mtm.isEnabled)
        ?.map((mtm: any) => String(mtm.module?.key || mtm.module?.name || '').toLowerCase())
        ?.filter(Boolean) || []
    );

    // If the business type has no modules configured at all, enable all standard modules
    // (empty modules = no restrictions applied yet by super admin)
    if (enabledModuleNames.size === 0 && allTypeModuleNames.size === 0) {
      console.log(`[Modules] Business type "${businessTypeName}" has no modules configured, enabling all standard modules for business ${businessId}`);
      await enableStandardModules(businessId);
      return;
    }

    if (enabledModuleNames.size === 0) {
      console.warn(`[Modules] Business type "${businessTypeName}" has all modules disabled, disabling all modules for business ${businessId}`);
    } else {
      console.log(`[Modules] Syncing ${enabledModuleNames.size} enabled / ${allTypeModuleNames.size} total modules for business ${businessId} from type ${businessTypeName}`);
    }

    // Get ALL module IDs in the system so we can disable anything outside the type template
    // Module is the old table used by business_modules
    const allModules = await prisma.module.findMany({ select: { id: true, name: true } });

    // Upsert every module: enable if in the type's enabled set or if it is always required
    const now = new Date();
    for (const module of allModules) {
      const moduleKey = String(module.name).toLowerCase();
      const shouldEnable =
        moduleKey === 'subscription' || enabledModuleNames.has(moduleKey);
      const existing = await prisma.businessModule.findFirst({ where: { businessId, moduleId: module.id } });
      if (existing) {
        await prisma.businessModule.update({
          where: { id: existing.id },
          data: { enabled: shouldEnable, updatedAt: now } as any
        });
      } else {
        await prisma.businessModule.create({
          data: { businessId, moduleId: module.id, enabled: shouldEnable } as any
        });
      }
    }
  } catch (error: any) {
    if (isMissingTableError(error)) return;
    console.error('[enableDefaultModulesForBusiness] Error:', error.message);
    // Fall back to standard modules on error
    await enableStandardModules(businessId).catch(() => {});
  }
}

async function enableStandardModules(businessId: string): Promise<void> {
  const prisma = await getPrisma();
  try {
    const modules = await prisma.module.findMany({ 
      where: { name: { in: STANDARD_MODULES.map(m => m.name) } }, 
      select: { id: true, name: true } 
    });
    const now = new Date();
    for (const mod of modules) {
      const existing = await prisma.businessModule.findFirst({ where: { businessId, moduleId: mod.id } });
      if (existing) {
        await prisma.businessModule.update({ 
          where: { id: existing.id }, 
          data: { enabled: true, updatedAt: now } as any 
        });
      } else {
        await prisma.businessModule.create({ 
          data: { businessId, moduleId: mod.id, enabled: true } as any 
        });
      }
    }
  } catch (error: any) {
    if (isMissingTableError(error)) return;
    throw error;
  }
}

export async function ensureDefaultPlansExist(): Promise<void> {
  const prisma = await getPrisma();
  try {
    const defaultPlans = [
      {
        id: "single-trial",
        name: "Trial",
        price: 0,
        durationDays: 14,
        trialDurationDays: 14,
        isTrial: true,
        maxBranches: 1,
        maxUsers: 5,
        maxCounters: 1,
        features: [
          "Core Features",
          "Sales & invoicing",
          "Inventory management",
          "Basic reporting",
          "1 business, 1 branch, 1 POS counter included"
        ]
      },
      {
        id: "single-starter",
        name: "Starter",
        price: 2500,
        durationDays: 30,
        isTrial: false,
        maxBranches: 1,
        maxUsers: 1,
        maxCounters: 1,
        features: [
          "Core Features",
          "1 Business",
          "1 Branch",
          "1 POS Counter",
          "Single-user mode",
          "Sales & invoicing",
          "Inventory management",
          "Basic reports"
        ]
      },
      {
        id: "single-growth",
        name: "Growth",
        price: 5000,
        durationDays: 30,
        isTrial: false,
        maxBranches: 3,
        maxUsers: 20,
        maxCounters: 3,
        features: [
          "Core + Growth Features",
          "Includes all Core features",
          "Staff roles (Owner, Manager, Cashier)",
          "Advanced reports",
          "Multi-branch dashboard"
        ]
      },
      {
        id: "single-scale",
        name: "Scale",
        price: 10000,
        durationDays: 30,
        isTrial: false,
        maxBranches: 10,
        maxUsers: 100,
        maxCounters: 999,
        features: [
          "Core + Growth + Scale Features",
          "Includes all Core and Growth features",
          "API access",
          "Advanced analytics",
          "Priority support"
        ]
      }
    ];

    for (const plan of defaultPlans) {
      await (prisma.plan as any).upsert({
        where: { id: plan.id },
        update: {
          name: plan.name,
          price: plan.price,
          durationDays: plan.durationDays,
          isTrial: plan.isTrial,
          maxBranches: plan.maxBranches,
          maxUsers: plan.maxUsers,
          maxCounters: plan.maxCounters,
          features: plan.features,
          updatedAt: new Date()
        },
        create: plan
      });
    }
    console.log('[Server] ✅ Default plans ensured');
  } catch (error: any) {
    if (isMissingTableError(error)) return;
    console.error('[ensureDefaultPlansExist] Error:', error.message);
  }
}

/**
 * Enable the Employee Portal module by default for every business type, plan and role.
 * Runs at server startup so the module is available out-of-the-box while remaining
 * fully togglable from the Backoffice (business type / plan / role module config).
 * Uses ON CONFLICT DO NOTHING so existing super admin configuration is preserved
 * (it only inserts missing rows — never flips an existing enabled=false to true).
 */
export async function ensureEmployeePortalEnabled(): Promise<void> {
  const prisma = await getPrisma();
  const MODULE_NAME = 'employee_portal';

  try {
    // QA A-06: steps 2/3 below query plan_module_permissions /
    // role_module_permissions, which otherwise only exist after the first
    // backoffice request (lazy DDL in module-permissions.controller) — that
    // ordering produced 42P01 on every fresh boot. Create them up-front.
    await ensureModulePermissionTablesExist();

    // Ensure the legacy modules row exists (drives business_type_modules + backoffice lists)
    await (prisma.module as any).upsert({
      where: { name: MODULE_NAME },
      update: { displayName: 'Employee Portal', updatedAt: new Date() } as any,
      create: {
        name: MODULE_NAME,
        displayName: 'Employee Portal',
        description: 'Self-service portal for employees (attendance, shifts, profile, notifications)'
      }
    });

    const moduleRow = await (prisma.module as any).findUnique({ where: { name: MODULE_NAME } });

    // business_type_modules.moduleId has an FK to module_definitions(id), NOT modules(id).
    // The two tables use DIFFERENT ids for employee_portal, so resolve the module_definitions
    // id here (the modules row above only drives the backoffice module list).
    let defRow: any = null;
    try {
      defRow = await (prisma.moduleDefinition as any).findUnique({ where: { key: MODULE_NAME } });
    } catch {
      // module_definitions may not exist yet (pre-migration)
    }
    if (!defRow) {
      try {
        defRow = await (prisma.moduleDefinition as any).create({
          data: {
            key: MODULE_NAME,
            name: 'Employee Portal',
            icon: 'Briefcase',
            description: 'Self-service portal for employees (attendance, shifts, profile, notifications)',
            route: '/employee-portal',
            isSidebar: true,
            isActive: true,
          }
        });
      } catch {
        // ignore — row may already exist from another source
      }
    }
    const moduleId = defRow?.id || moduleRow?.id;

    // 1) Business types: insert an enabled entry for every type missing one.
    if (moduleId) {
      const typeRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM business_types`);
      const now = new Date();
      let typesInserted = 0;
      for (const type of typeRows || []) {
        typesInserted += await prisma.$executeRawUnsafe(
          `INSERT INTO business_type_modules ("businessTypeId", "moduleId", "isEnabled", "sortOrder", "createdAt", "updatedAt")
           VALUES ($1, $2, true, 0, $3, $3)
           ON CONFLICT ("businessTypeId", "moduleId") DO NOTHING`,
          type.id, moduleId, now
        );
      }
      console.log(`[Modules] ✅ Employee Portal business_type_modules: ${typesInserted} row(s) inserted across ${(typeRows || []).length} business types`);
    }

    // 2) Plans: for every plan that has an explicit config, ensure employee_portal is enabled.
    try {
      const planRows = await prisma.$queryRawUnsafe<Array<{ planId: string }>>(
        `SELECT DISTINCT "planId" FROM plan_module_permissions`
      );
      let plansInserted = 0;
      for (const plan of planRows || []) {
        plansInserted += await prisma.$executeRawUnsafe(
          `INSERT INTO plan_module_permissions (id, "planId", "moduleName", enabled, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT ("planId", "moduleName") DO NOTHING`,
          `${plan.planId}:${MODULE_NAME}`, plan.planId, MODULE_NAME
        );
      }
      if ((planRows || []).length > 0) {
        console.log(`[Modules] ✅ Employee Portal plan_module_permissions: ${plansInserted} row(s) inserted across ${planRows.length} plans`);
      }
    } catch (planPermErr: any) {
      console.error('[Modules] ❌ Employee Portal plan_module_permissions seeding failed:', planPermErr?.message || planPermErr);
    }

    // 2b) Plans with entitlements: ensure employee_portal is entitled for EVERY plan.
    //     plan_module_permissions (step 2) only covers plans that have explicit rows there;
    //     plans gated purely via plan_entitlements (e.g. "single-scale") need this row too,
    //     otherwise the module is denied at the subscription layer.
    //     QA A-06: the ON CONFLICT target must match the schema's only unique
    //     constraint on this table, @@unique([planId, moduleKey, pageKey]) —
    //     the old 2-column target raised 42P10 on every boot. Because pageKey
    //     is NULL for module-level rows (and Postgres treats NULLs as
    //     distinct in unique indexes), idempotency is enforced with an
    //     existence check before inserting.
    try {
      const allPlans = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM platform_plans`
      );
      let entitlementsInserted = 0;
      for (const plan of allPlans || []) {
        const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT id FROM plan_entitlements WHERE "planId" = $1 AND "moduleKey" = $2 AND "pageKey" IS NULL LIMIT 1`,
          plan.id, MODULE_NAME
        );
        if (existing && existing.length > 0) continue;
        entitlementsInserted += await prisma.$executeRawUnsafe(
          `INSERT INTO plan_entitlements (id, "planId", "moduleKey", "pageKey", "entitlementLevel", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, NULL, 'FULL', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT ("planId", "moduleKey", "pageKey") DO NOTHING`,
          `ent:${plan.id}:${MODULE_NAME}`, plan.id, MODULE_NAME
        );
      }
      if ((allPlans || []).length > 0) {
        console.log(`[Modules] ✅ Employee Portal plan_entitlements: ${entitlementsInserted} row(s) inserted across ${allPlans.length} plans`);
      }
    } catch (entitlementErr: any) {
      console.error('[Modules] ❌ Employee Portal plan_entitlements seeding failed:', entitlementErr?.message || entitlementErr);
    }

    // 3) Roles: for every role that has an explicit config, ensure employee_portal is enabled.
    try {
      const roleRows = await prisma.$queryRawUnsafe<Array<{ roleName: string }>>(
        `SELECT DISTINCT "roleName" FROM role_module_permissions`
      );
      let rolesInserted = 0;
      for (const role of roleRows || []) {
        rolesInserted += await prisma.$executeRawUnsafe(
          `INSERT INTO role_module_permissions (id, "roleName", "moduleName", enabled, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT ("roleName", "moduleName") DO NOTHING`,
          `${role.roleName}:${MODULE_NAME}`, role.roleName, MODULE_NAME
        );
      }
      if ((roleRows || []).length > 0) {
        console.log(`[Modules] ✅ Employee Portal role_module_permissions: ${rolesInserted} row(s) inserted across ${roleRows.length} roles`);
      }
    } catch (rolePermErr: any) {
      console.error('[Modules] ❌ Employee Portal role_module_permissions seeding failed:', rolePermErr?.message || rolePermErr);
    }
  } catch (error: any) {
    if (isMissingTableError(error)) return;
    console.error('[ensureEmployeePortalEnabled] Error:', error.message);
  }
}

/**
 * QA A-05 — fresh-install policy baseline.
 *
 * On a brand-new database the authorization resolver default-denies EVERY
 * module: business_type_modules had no rows, plan_entitlements was empty,
 * and every plan shipped permissionState=UNCONFIGURED ("no published policy
 * → deny"), so even a company OWNER with an ACTIVE TRIAL subscription got
 * 403 on all core POS flows. This baseline makes a fresh deployment usable
 * with zero manual steps:
 *
 *   1. business_type_modules: fills any missing (seeded business type ×
 *      module_definitions) rows as enabled. Existing rows are never touched
 *      (an admin-disabled module stays disabled — we only fill gaps).
 *   2. plan_entitlements: for each runtime plan (single-*) that is still
 *      UNCONFIGURED, writes a module-level FULL entitlement (pageKey NULL =
 *      whole module, per authorization.service checkPlanEntitles) for every
 *      module in module_definitions, then flips the plan to CONFIGURED once
 *      its entitlements are complete.
 *
 * Safety: plans that are already CONFIGURED (i.e. a BackOffice-published
 * policy exists) are skipped entirely — later boots never overwrite
 * published policy changes. Fully idempotent across restarts.
 */
export async function ensureFreshInstallPolicyBaseline(): Promise<void> {
  const prisma = await getPrisma();
  try {
    // 0) module_definitions must exist first (canonical seed: legacy modules
    //    + module hierarchy config).
    try {
      const { ensureModuleAccessV2SeedData } = await import('./modules-v2.util');
      await ensureModuleAccessV2SeedData(prisma as any);
    } catch (seedErr: any) {
      console.error('[PolicyBaseline] ❌ Module definition seeding failed:', seedErr?.message || seedErr);
    }

    const moduleDefinitions: any[] = await (prisma.moduleDefinition as any).findMany({
      select: { id: true, key: true },
    });
    if (moduleDefinitions.length === 0) {
      console.error('[PolicyBaseline] ❌ module_definitions is empty — cannot seed the policy baseline.');
      return;
    }

    // 1) business_type_modules gap-fill for the seeded (default) types.
    let btmInserted = 0;
    for (const type of DEFAULT_BUSINESS_TYPES) {
      const bt = await prisma.businessType.findUnique({
        where: { id: type.id },
        select: { id: true },
      });
      if (!bt) continue;
      for (const mod of moduleDefinitions) {
        const existing = await (prisma.businessTypeModule as any).findFirst({
          where: { businessTypeId: bt.id, moduleId: mod.id },
          select: { businessTypeId: true },
        });
        if (existing) continue;
        await (prisma.businessTypeModule as any).create({
          data: { businessTypeId: bt.id, moduleId: mod.id, isEnabled: true, sortOrder: 0 },
        });
        btmInserted++;
      }
    }
    if (btmInserted > 0) {
      console.log(`[PolicyBaseline] ✅ business_type_modules: filled ${btmInserted} missing row(s)`);
    }

    // 2) plan_entitlements + permissionState for runtime plans that have no
    //    published policy yet (UNCONFIGURED only — see safety note above).
    const plans: any[] = await (prisma.plan as any).findMany({
      where: { id: { in: RUNTIME_PLAN_IDS } },
      select: { id: true, permissionState: true },
    });
    for (const plan of plans) {
      const state = String(plan.permissionState || 'UNCONFIGURED').toUpperCase();
      if (state === 'CONFIGURED') continue;

      let entInserted = 0;
      for (const mod of moduleDefinitions) {
        const moduleKey = String(mod.key);
        const existing = await (prisma.planEntitlement as any).findFirst({
          where: { planId: plan.id, moduleKey, pageKey: null },
          select: { id: true },
        });
        if (existing) continue;
        await (prisma.planEntitlement as any).create({
          data: { planId: plan.id, moduleKey, pageKey: null, entitlementLevel: 'FULL' },
        });
        entInserted++;
      }

      // Flip to CONFIGURED only once the plan actually entitles every
      // module — an incomplete baseline must not masquerade as published.
      const entitledCount = await (prisma.planEntitlement as any).count({
        where: { planId: plan.id, pageKey: null },
      });
      if (entitledCount >= moduleDefinitions.length) {
        await (prisma.plan as any).update({
          where: { id: plan.id },
          data: { permissionState: 'CONFIGURED', policyVersion: { increment: 1 } },
        });
        console.log(`[PolicyBaseline] ✅ Plan ${plan.id}: ${entInserted} entitlement row(s) added, permissionState → CONFIGURED`);
      } else {
        console.error(`[PolicyBaseline] ❌ Plan ${plan.id}: only ${entitledCount}/${moduleDefinitions.length} module entitlements present — leaving permissionState=${state}`);
      }
    }
  } catch (error: any) {
    if (isMissingTableError(error)) {
      console.error('[PolicyBaseline] ❌ Skipped — a required table is missing:', error?.message || error);
      return;
    }
    console.error('[PolicyBaseline] ❌ Failed:', error?.message || error);
  }
}

export default {
  ensureModulesExist,
  ensureBusinessTypesExist,
  ensureDefaultPlansExist,
  ensureEmployeePortalEnabled,
  ensureModulePermissionTablesExist,
  ensureFreshInstallPolicyBaseline,
  enableDefaultModulesForBusiness,
};
