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
    const defaultTypes = [
      { id: 'PHARMACY',           name: 'PHARMACY',           description: 'Pharmacy and medical stores' },
      { id: 'DEPARTMENTAL_STORE', name: 'DEPARTMENTAL_STORE', description: 'General retail and departmental stores' },
      { id: 'RETAIL_STORE',       name: 'RETAIL_STORE',       description: 'General retail stores' },
      { id: 'HOTEL',              name: 'HOTEL',              description: 'Hotels and hospitality' },
      { id: 'CLINIC',             name: 'CLINIC',             description: 'Medical clinics' },
    ];

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
    try {
      let allLegacyModules: any[] = [];
      try {
        allLegacyModules = await (prisma.moduleDefinition as any).findMany({ select: { id: true, key: true } });
      } catch {
        // module_definitions may not exist yet — fall back to legacy modules table below
      }
      if (allLegacyModules.length === 0) {
        allLegacyModules = await prisma.module.findMany({ select: { id: true, name: true } });
      }
      if (allLegacyModules.length > 0) {
        for (const type of defaultTypes) {
          const rowCount = await prisma.$queryRaw<{ cnt: number }[]>`SELECT COUNT(*) as cnt FROM business_type_modules WHERE "businessTypeId" = ${type.id}`;
          if (Number(rowCount?.[0]?.cnt ?? 0) > 0) continue;

          const now = new Date();
          for (const mod of allLegacyModules) {
            try {
              await prisma.$executeRaw`
                INSERT INTO business_type_modules ("businessTypeId", "moduleId", "isEnabled", "sortOrder", "createdAt", "updatedAt")
                VALUES (${type.id}, ${mod.id}, true, 0, ${now}, ${now})
                ON CONFLICT ("businessTypeId", "moduleId") DO NOTHING
              `;
            } catch {
              // ignore individual insert errors (table may not exist yet)
            }
          }
          console.log(`[Modules] Auto-seeded ${allLegacyModules.length} module entries for business type ${type.name}`);
        }
      }
    } catch {
      // business_type_modules table may not exist yet — that's fine
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
        features: JSON.stringify([
          "Core Features",
          "Sales & invoicing",
          "Inventory management",
          "Basic reporting",
          "1 business, 1 branch, 1 POS counter included"
        ])
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
        features: JSON.stringify([
          "Core Features",
          "1 Business",
          "1 Branch",
          "1 POS Counter",
          "Single-user mode",
          "Sales & invoicing",
          "Inventory management",
          "Basic reports"
        ])
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
        features: JSON.stringify([
          "Core + Growth Features",
          "Includes all Core features",
          "Staff roles (Owner, Manager, Cashier)",
          "Advanced reports",
          "Multi-branch dashboard"
        ])
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
        features: JSON.stringify([
          "Core + Growth + Scale Features",
          "Includes all Core and Growth features",
          "API access",
          "Advanced analytics",
          "Priority support"
        ])
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
      for (const type of typeRows || []) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO business_type_modules ("businessTypeId", "moduleId", "isEnabled", "sortOrder", "createdAt", "updatedAt")
           VALUES ($1, $2, true, 0, $3, $3)
           ON CONFLICT ("businessTypeId", "moduleId") DO NOTHING`,
          type.id, moduleId, now
        );
      }
      console.log(`[Modules] ✅ Employee Portal enabled for ${(typeRows || []).length} business types`);
    }

    // 2) Plans: for every plan that has an explicit config, ensure employee_portal is enabled.
    try {
      const planRows = await prisma.$queryRawUnsafe<Array<{ planId: string }>>(
        `SELECT DISTINCT "planId" FROM plan_module_permissions`
      );
      for (const plan of planRows || []) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO plan_module_permissions (id, "planId", "moduleName", enabled, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT ("planId", "moduleName") DO NOTHING`,
          `${plan.planId}:${MODULE_NAME}`, plan.planId, MODULE_NAME
        );
      }
      if ((planRows || []).length > 0) {
        console.log(`[Modules] ✅ Employee Portal enabled for ${planRows.length} plans`);
      }
    } catch {
      // plan_module_permissions may not exist yet — ignore
    }

    // 3) Roles: for every role that has an explicit config, ensure employee_portal is enabled.
    try {
      const roleRows = await prisma.$queryRawUnsafe<Array<{ roleName: string }>>(
        `SELECT DISTINCT "roleName" FROM role_module_permissions`
      );
      for (const role of roleRows || []) {
        await prisma.$executeRawUnsafe(
          `INSERT INTO role_module_permissions (id, "roleName", "moduleName", enabled, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           ON CONFLICT ("roleName", "moduleName") DO NOTHING`,
          `${role.roleName}:${MODULE_NAME}`, role.roleName, MODULE_NAME
        );
      }
      if ((roleRows || []).length > 0) {
        console.log(`[Modules] ✅ Employee Portal enabled for ${roleRows.length} roles`);
      }
    } catch {
      // role_module_permissions may not exist yet — ignore
    }
  } catch (error: any) {
    if (isMissingTableError(error)) return;
    console.error('[ensureEmployeePortalEnabled] Error:', error.message);
  }
}

export default {
  ensureModulesExist,
  ensureBusinessTypesExist,
  ensureDefaultPlansExist,
  ensureEmployeePortalEnabled,
  enableDefaultModulesForBusiness,
};
