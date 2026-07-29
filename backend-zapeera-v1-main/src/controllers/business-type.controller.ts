import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { getPrisma } from '../utils/db.util';
import MODULE_HIERARCHY from '../config/module-hierarchy';
import { moduleAccessCache } from '../utils/modules-v2.util';

/**
 * Get all business types with real business counts
 * Returns business types with count of actual businesses using each type
 */
export const getBusinessTypesWithCounts = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    
    // Get all business types
    const businessTypes = await (prisma.businessType as any).findMany();

    // Fetch modules per business type via raw SQL (Prisma include fails because
    // BusinessTypeModule.module relation points to module_definitions, but the
    // actual data in business_type_modules references the modules table).
    let btmRows: any[] = [];
    try {
      btmRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT btm.businessTypeId, btm.isEnabled, btm.sortOrder,
                m.id as module_id, m.name as module_name, m.description as module_desc
         FROM business_type_modules btm
         JOIN modules m ON m.id = btm.moduleId`
      );
    } catch (btmErr: any) {
      console.warn('[BusinessTypeController] btm raw query failed:', btmErr.message);
    }

    // Group btm rows by businessTypeId
    const btmByType = new Map<string, any[]>();
    for (const row of btmRows) {
      const arr = btmByType.get(row.businessTypeId) || [];
      arr.push(row);
      btmByType.set(row.businessTypeId, arr);
    }

    // Attach modules array to each business type
    for (const bt of businessTypes) {
      (bt as any).modules = (btmByType.get(bt.id) || []).map((r: any) => ({
        isEnabled: Boolean(r.isEnabled),
        sortOrder: Number(r.sortOrder),
        module: {
          id: r.module_id,
          name: r.module_name,
          description: r.module_desc,
        }
      }));
    }

    // Get all companies with their business types for efficient counting
    let allCompanies: any[] = [];
    try {
      allCompanies = await prisma.business.findMany({
        select: { id: true, businessType: true }
      });
      console.log(`[BusinessTypeController] Fetched ${allCompanies.length} companies`);
    } catch (fetchError) {
      console.error('[BusinessTypeController] Error fetching companies:', fetchError);
    }

    // Get real business counts for each business type
    const businessCounts = businessTypes.map((bt: any) => {
      // Normalize the business type name to UPPERCASE_UNDERSCORE format
      const normalizedBtName = bt.name
        .toUpperCase()
        .replace(/[\s-]+/g, '_')
        .replace(/_+/g, '_')
        .trim();
      
      // Also try other variations for matching
      const possibleNames = [
        normalizedBtName,                                           // PHARMACY, CLOTHING_STORE
        bt.name.toUpperCase(),                                      // PHARMACY, CLOTHING STORE
        bt.name.replace(/\s+/g, '_').toUpperCase(),               // PHARMACY, CLOTHING_STORE
        bt.name.toLowerCase(),                                      // pharmacy, clothing store
        bt.name.toLowerCase().replace(/\s+/g, '_'),                // pharmacy, clothing_store
        bt.name,                                                    // Original: Pharmacy, Clothing Store
        bt.name.replace(/\s+/g, ''),                               // No spaces: Pharmacy, ClothingStore
      ];
      
      // Count companies that match any of the possible name variations (case-insensitive)
      const count = allCompanies.filter(company => {
        if (!company.businessType) return false;
        const companyType = String(company.businessType).trim();
        // Check if company type matches any variation (case-insensitive)
        return possibleNames.some(name => 
          companyType.toUpperCase() === name.toUpperCase()
        );
      }).length;
      
      console.log(`[BusinessTypeController] ${bt.name} (normalized: ${normalizedBtName}): found ${count} businesses`);
      return { id: bt.id, count };
    });
    
    // Create a map of business type id to count
    const countMap = new Map(businessCounts.map((bc: any) => [bc.id, bc.count]));

    // Sub-module permissions per business type
    const { getSubModuleStateMap } = await import('./module-permissions.controller');
    const subMap = await getSubModuleStateMap(prisma, 'business_type_sub_module_permissions', 'businessTypeId').catch(() => new Map());

    // Transform the data with real counts
    const transformedTypes = businessTypes.map((bt: any) => {
      const subModulesMap = subMap.get(bt.id) || new Map();
      const subModules: string[] = [];
      const disabledSubModules: string[] = [];
      for (const [composite, enabled] of subModulesMap.entries()) {
        (enabled ? subModules : disabledSubModules).push(composite);
      }

      // Build restrictions object keyed by module ID
      const restrictions: Record<string, any> = {};
      (bt.modules || []).forEach((mtm: any) => {
        const moduleId = mtm.module?.id || mtm.id;
        const moduleName = mtm.module?.name || moduleId;
        if (moduleId) {
          // Filter disabled sub-modules for this specific module
          const moduleDisabledSubs = disabledSubModules
            .filter((s: string) => s.startsWith(moduleName + '::'))
            .map((s: string) => s.split('::')[1]);
          restrictions[moduleId] = {
            enabled: mtm.isEnabled ?? false,
            disabledSubModules: moduleDisabledSubs
          };
        }
      });

      return {
        id: bt.id,
        name: bt.name,
        slug: bt.slug || bt.name.toLowerCase().replace(/\s+/g, '-'),
        description: bt.description,
        isActive: bt.isActive ?? true,
        modulesEnabled: bt.modules?.filter((m: any) => m.isEnabled).length || 0,
        businessCount: countMap.get(bt.id) || 0,
        modules: (bt.modules || [])
          .sort((a: any, b: any) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99))
          .map((mtm: any) => ({
            id: mtm.module?.id || mtm.id,
            name: mtm.module?.name || 'Unknown',
            key: mtm.module?.name || '',
            icon: mtm.module?.icon || 'layout',
            description: mtm.module?.description || '',
            enabled: mtm.isEnabled ?? false,
            sortOrder: mtm.sortOrder ?? 99
          })),
        restrictions,
        subModules,
        disabledSubModules,
        createdAt: bt.createdAt,
        updatedAt: bt.updatedAt
      };
    });

    return res.json({
      success: true,
      data: transformedTypes
    });
  } catch (error: any) {
    console.error('[BusinessTypeController] Critical error fetching business types with counts:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch business types',
      error: error.message
    });
  }
};

/**
 * Get all business types with their associated modules
 */
export const getBusinessTypes = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();

    const businessTypes = await (prisma.businessType as any).findMany();

    // Fetch modules per business type via raw SQL (same reason as getBusinessTypesWithCounts)
    let btmRows: any[] = [];
    try {
      btmRows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT btm.businessTypeId, btm.isEnabled, btm.sortOrder,
                m.id as module_id, m.name as module_name, m.description as module_desc
         FROM business_type_modules btm
         JOIN modules m ON m.id = btm.moduleId`
      );
    } catch (btmErr: any) {
      console.warn('[BusinessTypeController] getBusinessTypes btm raw query failed:', btmErr.message);
    }

    const btmByType = new Map<string, any[]>();
    for (const row of btmRows) {
      const arr = btmByType.get(row.businessTypeId) || [];
      arr.push(row);
      btmByType.set(row.businessTypeId, arr);
    }

    for (const bt of businessTypes) {
      (bt as any).modules = (btmByType.get(bt.id) || []).map((r: any) => ({
        isEnabled: Boolean(r.isEnabled),
        sortOrder: Number(r.sortOrder),
        module: {
          id: r.module_id,
          name: r.module_name,
          description: r.module_desc,
        }
      }));
    }

    // Transform to include restrictions object with sub-module permissions
    const { getSubModuleStateMap } = await import('./module-permissions.controller');
    const subMap = await getSubModuleStateMap(prisma, 'business_type_sub_module_permissions', 'businessTypeId').catch(() => new Map());

    const transformedTypes = await Promise.all(businessTypes.map(async (bt: any) => {
      const subModulesMap = subMap.get(bt.id) || new Map();
      const disabledSubModules: string[] = [];
      for (const [composite, enabled] of subModulesMap.entries()) {
        if (!enabled) disabledSubModules.push(composite);
      }

      const restrictions: Record<string, any> = {};
      (bt.modules || []).forEach((mtm: any) => {
        const moduleId = mtm.module?.id || mtm.id;
        const moduleName = mtm.module?.name || moduleId;
        if (moduleId) {
          // Filter disabled sub-modules for this specific module
          const moduleDisabledSubs = disabledSubModules
            .filter((s: string) => s.startsWith(moduleName + '::'))
            .map((s: string) => s.split('::')[1]);
          restrictions[moduleId] = {
            enabled: mtm.isEnabled ?? false,
            disabledSubModules: moduleDisabledSubs
          };
        }
      });

      return {
        ...bt,
        restrictions
      };
    }));

    return res.json({
      success: true,
      data: transformedTypes
    });
  } catch (error: any) {
    console.error('[BusinessTypeController] Critical error fetching business types:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch business types',
      error: error.message
    });
  }
};

/**
 * Get all available system modules (top-level only, from DB)
 */
export const getModules = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    let modules;
    
    try {
      modules = await (prisma.module as any).findMany({
        where: { isActive: true }
      });
    } catch (whereError: any) {
      console.warn('[BusinessTypeController] findMany with where failed, fetching all modules:', whereError.message);
      modules = await (prisma.module as any).findMany();
    }

    return res.json({
      success: true,
      data: modules
    });
  } catch (error: any) {
    console.error('[BusinessTypeController] Error fetching modules:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch modules',
      error: error.message
    });
  }
};

/**
 * Get the full module hierarchy including sub-modules.
 * Returns MODULE_HIERARCHY from config — the canonical source of truth for the sidebar tree.
 * Backoffice admins use this to toggle both parent modules and individual sub-modules.
 */
export const getModuleHierarchyForBackoffice = async (req: AuthRequest, res: Response) => {
  try {
    return res.json({
      success: true,
      data: MODULE_HIERARCHY.map((m) => ({
        module: m.module,
        label: m.label,
        icon: m.icon,
        section: m.section,
        subModules: m.subModules.map((s) => ({
          key: s.key,
          label: s.label,
          module: s.module,
          icon: s.icon,
        })),
      })),
    });
  } catch (error: any) {
    console.error('[BusinessTypeController] Error fetching module hierarchy:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch module hierarchy',
    });
  }
};

/**
 * Create a new business type
 */
export const createBusinessType = async (req: AuthRequest, res: Response) => {
  try {
    const { name, description } = req.body;

    if (!name || !String(name).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Business type name is required'
      });
    }

    // Normalize: "Clothing Store" -> "CLOTHING_STORE" (used as both id and canonical key)
    const canonicalId = String(name).trim().toUpperCase().replace(/[\s\-]+/g, '_').replace(/_+/g, '_');

    const prisma = await getPrisma();

    // Check for duplicate by id or name
    const existingById = await prisma.businessType.findUnique({ where: { id: canonicalId } }).catch(() => null);
    const existingByName = await (prisma.businessType as any).findUnique({ where: { name: canonicalId } }).catch(() => null);
    if (existingById || existingByName) {
      return res.status(409).json({
        success: false,
        message: `Business type '${canonicalId}' already exists`
      });
    }

    const businessType = await (prisma.businessType as any).create({
      data: {
        id: canonicalId,   // e.g. "CLOTHING_STORE"
        name: canonicalId, // keep name = id for consistent matching
        description,
      }
    });

    console.log(`[BusinessTypeController] Created business type: ${canonicalId}`);

    return res.json({
      success: true,
      data: { ...businessType, modules: [] }
    });
  } catch (error: any) {
    console.error('[BusinessTypeController] Error creating business type:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to create business type',
      error: error.message
    });
  }
};

/**
 * Update a business type
 */
export const updateBusinessType = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { description } = req.body;

    const prisma = await getPrisma();

    // Check if business type exists
    const existingType = await prisma.businessType.findUnique({
      where: { id }
    });

    if (!existingType) {
      return res.status(404).json({
        success: false,
        message: 'Business type not found'
      });
    }

    // Only description (display label) is editable. name/id are immutable canonical keys.
    const updatedBusinessType = await prisma.businessType.update({
      where: { id },
      data: {
        description: description ?? existingType.description
      },
      include: {
        modules: {
          include: {
            module: true
          }
        }
      }
    });

    return res.json({
      success: true,
      data: updatedBusinessType
    });
  } catch (error: any) {
    console.error('[BusinessTypeController] Error updating business type:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to update business type',
      error: error.message
    });
  }
};

/**
 * Update modules for a business type
 */
export const updateBusinessTypeModules = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    // moduleKeys: string[] — keys to ENABLE (rest disabled)
    // moduleOrder: string[] — ordered list of ALL module keys (enabled+disabled) defining sidebar sort
    const { moduleIds, moduleKeys, moduleOrder } = req.body;

    const prisma = await getPrisma();

    // Get all modules to map keys to IDs
    const allModules = await prisma.module.findMany({
      select: { id: true, name: true }
    });
    
    // Build a map of module name (key) to ID
    const moduleNameToId = new Map<string, string>();
    for (const mod of allModules) {
      moduleNameToId.set(mod.name.toLowerCase(), mod.id);
      moduleNameToId.set(mod.id, mod.id);
    }

    // Build sortOrder map from moduleOrder array (position = sortOrder value)
    const sortOrderMap = new Map<string, number>();
    if (Array.isArray(moduleOrder)) {
      moduleOrder.forEach((key: string, idx: number) => {
        sortOrderMap.set(key.toLowerCase(), idx);
      });
    }

    // Determine which modules to enable
    const keysToEnable = moduleKeys || moduleIds || [];
    if (!Array.isArray(keysToEnable)) {
      return res.status(400).json({
        success: false,
        message: 'moduleIds or moduleKeys must be an array'
      });
    }

    const enabledSet = new Set(keysToEnable.map((k: string) => k.toLowerCase()));

    // All module keys to persist (enabled or disabled) — if moduleOrder provided use it, else all modules
    const allKeys = Array.isArray(moduleOrder) && moduleOrder.length > 0
      ? moduleOrder.map((k: string) => k.toLowerCase())
      : allModules.map((m) => m.name.toLowerCase());

      console.log(`[updateBusinessTypeModules] Business type ${id}: enabling ${keysToEnable.length} modules`);

    // CRITICAL: Invalidate V2 module access cache so businesses of this type
    // get fresh evaluation on next request (intersection of type + plan + role)
    moduleAccessCache.clear();

    // Use raw SQL to avoid Prisma composite-PK issues with deleteMany/createMany on SQLite
    await prisma.$transaction(async (tx) => {
      // 1. Remove all existing module associations for this business type
      await tx.$executeRaw`DELETE FROM business_type_modules WHERE businessTypeId = ${id}`;

      // 2. Re-insert ALL modules with isEnabled + sortOrder
      const now = new Date().toISOString();
      for (const key of allKeys) {
        const moduleId = moduleNameToId.get(key);
        if (!moduleId) continue;
        const isEnabled = enabledSet.has(key) ? 1 : 0;
        const sortOrder = sortOrderMap.has(key) ? sortOrderMap.get(key)! : 99;
        await tx.$executeRawUnsafe(
          `INSERT INTO business_type_modules (businessTypeId, moduleId, isEnabled, sortOrder, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?)`,
          id, moduleId, isEnabled, sortOrder, now, now
        );
      }
    });

    // Fetch updated business type with modules ordered by sortOrder
    const updatedRows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT m.id, m.name, m.description, btm.isEnabled, btm.sortOrder
       FROM business_type_modules btm
       JOIN modules m ON m.id = btm.moduleId
       WHERE btm.businessTypeId = ?
       ORDER BY btm.sortOrder ASC, m.name ASC`,
      id
    );

    const transformedModules = updatedRows.map((row: any) => ({
      id: row.id,
      name: row.name,
      key: row.name,
      icon: row.name,
      description: row.description || '',
      enabled: Boolean(row.isEnabled),
      sortOrder: Number(row.sortOrder)
    }));

    // CRITICAL FIX: Resync all businesses with this business type
    // When business-type modules are updated, all businesses using that type must have their
    // business_modules table regenerated to reflect the new configuration
    try {
      const { enableDefaultModulesForBusiness } = await import('../utils/modules.util');
      
      // Get the business type name for filtering
      const businessType = await prisma.businessType.findUnique({
        where: { id },
        select: { name: true }
      });
      
      if (businessType) {
        const businessesWithType = await prisma.business.findMany({
          where: {
            isActive: true,
            businessType: businessType.name
          },
          select: { id: true, name: true }
        });

        if (businessesWithType.length > 0) {
          console.log(`[BusinessTypeController] Resyncing modules for ${businessesWithType.length} businesses after business-type module update`);
          let successCount = 0;
          for (const biz of businessesWithType) {
            try {
              await enableDefaultModulesForBusiness(biz.id);
              successCount++;
              console.log(`[BusinessTypeController] ✓ Resynced modules for ${biz.name} (${biz.id})`);
            } catch (resyncError) {
              console.error(`[BusinessTypeController] ✗ Failed to resync ${biz.name}:`, resyncError);
            }
          }
          console.log(`[BusinessTypeController] Resync complete: ${successCount}/${businessesWithType.length} succeeded`);
        }
      }
    } catch (resyncError: any) {
      console.error('[BusinessTypeController] Resync operation failed:', resyncError.message);
      // Don't fail the main request if resync fails - already updated type modules successfully
    }

    return res.json({
      success: true,
      data: { id, modules: transformedModules }
    });
  } catch (error: any) {
    console.error('[BusinessTypeController] Error updating business type modules:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to update business type modules',
      error: error.message
    });
  }
};

/**
 * Update a single module for a business type
 */
export const updateBusinessTypeModule = async (req: AuthRequest, res: Response) => {
  try {
    const { id, moduleId } = req.params;
    const { enabled } = req.body;

    const prisma = await getPrisma();

    // Check if business type exists
    const businessType = await prisma.businessType.findUnique({
      where: { id },
      select: { id: true, name: true }
    });

    if (!businessType) {
      return res.status(404).json({
        success: false,
        message: 'Business type not found'
      });
    }

    // Check if module exists
    const module = await prisma.module.findUnique({
      where: { id: moduleId },
      select: { id: true, name: true }
    });

    if (!module) {
      return res.status(404).json({
        success: false,
        message: 'Module not found'
      });
    }

    // Upsert the business type module association
    await prisma.$executeRaw`
      INSERT INTO business_type_modules (businessTypeId, moduleId, isEnabled, sortOrder, updatedAt)
      VALUES (${id}, ${moduleId}, ${enabled}, 0, datetime('now'))
      ON CONFLICT(businessTypeId, moduleId) DO UPDATE SET
        isEnabled = ${enabled},
        updatedAt = datetime('now')
    `;

    return res.json({
      success: true,
      message: `Module ${module.name} ${enabled ? 'enabled' : 'disabled'} for ${businessType.name}`
    });
  } catch (error: any) {
    console.error('[BusinessTypeController] Error updating business type module:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to update business type module',
      error: error.message
    });
  }
};

/**
 * Delete a business type
 */
export const deleteBusinessType = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const prisma = await getPrisma();

    // Check if business type exists
    const businessType = await prisma.businessType.findUnique({
      where: { id },
      include: {
        modules: true
      }
    });

    if (!businessType) {
      return res.status(404).json({
        success: false,
        message: 'Business type not found'
      });
    }

    // Check if any companies are using this business type (match by id OR name for safety)
    const companiesUsingType = await prisma.business.count({
      where: {
        OR: [
          { businessType: businessType.id },
          { businessType: businessType.name }
        ]
      }
    });

    if (companiesUsingType > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete business type. ${companiesUsingType} ${companiesUsingType === 1 ? 'business is' : 'businesses are'} currently using this type. Please reassign them first.`
      });
    }

    // Start a transaction to delete business type and its modules
    await prisma.$transaction(async (tx) => {
      // Delete all module associations for this business type
      await (tx.businessTypeModule as any).deleteMany({
        where: { businessTypeId: id }
      });

      // Delete the business type
      await (tx.businessType as any).delete({
        where: { id }
      });
    });

    return res.json({
      success: true,
      message: `Business type "${businessType.name}" deleted successfully`
    });
  } catch (error: any) {
    console.error('[BusinessTypeController] Error deleting business type:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete business type',
      error: error.message
    });
  }
};
