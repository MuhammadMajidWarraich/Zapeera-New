import { Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { getPrisma } from '../utils/db.util';
import { getModuleAccessV2, toLegacyModuleAccessPayload, type SubModuleAccessResult } from '../utils/modules-v2.util';
import { normalizeModuleKey } from '../utils/module-applicability.util';
import MODULE_HIERARCHY, { ModuleConfig, SubModuleConfig } from '../config/module-hierarchy';

const isMissingTableError = (error: any): boolean => {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('no such table') ||
    (message.includes('relation') && message.includes('does not exist')) ||
    message.includes('p2021')
  );
};

export const getEnabledModules = async (req: AuthRequest, res: Response) => {
  const businessId = req.business_id || req.user?.selectedCompanyId || req.user?.companyId;

  if (!businessId) {
    return res.status(400).json({
      success: false,
      message: 'Business context is required (X-Business-ID).',
    });
  }

  const prisma = await getPrisma();

  try {
    const businessExists = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true } });
    if (!businessExists) {
      return res.status(404).json({ success: false, message: 'Business not found' });
    }

    const rawRoleName = req.membership?.role_name || req.user?.role;
    const roleName = rawRoleName ? String(rawRoleName).toUpperCase() : undefined;
    
    const v2Payload = await getModuleAccessV2(prisma, businessId, req.user?.id || '', {
      skipCache: false,
      roleName,
    });

    const legacyPayload = toLegacyModuleAccessPayload(v2Payload);

    return res.json({
      success: true,
      data: legacyPayload.data,
      disabledSubModules: v2Payload.disabledSubModules || [],
      subModuleResults: v2Payload.subModuleResults || [],
      enabledModuleNames: legacyPayload.enabledModuleNames,
    });
  } catch (error: any) {
    if (isMissingTableError(error)) {
      return res.status(503).json({ success: false, message: 'Module service unavailable' });
    }
    if (/not member of business/i.test(String(error?.message || ''))) {
      return res.status(403).json({
        success: false,
        message: 'No active membership found for the selected business.',
        error: 'NO_ACTIVE_MEMBERSHIP',
        data: { enabledModuleNames: [], disabledSubModules: [] },
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Failed to load business modules.',
      error: error?.message || 'Unknown error',
    });
  }
};

/**
 * Get full module hierarchy with pages dynamically
 * This serves the complete sidebar configuration from backend
 * allowing Super Admin changes to reflect immediately without frontend rebuild
 */
export const getModuleHierarchy = async (req: AuthRequest, res: Response) => {
  const businessId = req.business_id || req.user?.selectedCompanyId || req.user?.companyId;
  const userRole = req.membership?.role_name || req.user?.role || 'CASHIER';
  const adminRole = (req as any).adminRole ? String((req as any).adminRole).toUpperCase() : '';

  const prisma = await getPrisma();

  try {
    // For backoffice admins (SUPER_ADMIN or ADMIN), return full hierarchy without business context
    if (adminRole === 'SUPER_ADMIN' || adminRole === 'ADMIN') {
      const allModuleRowsRaw = await prisma.$queryRawUnsafe('SELECT id, name, "displayName" FROM modules ORDER BY name ASC');
      const allModuleRows = (allModuleRowsRaw as Array<{ name: string; displayName?: string }>) || [];
      const moduleDisplayMap = new Map(allModuleRows.map(m => [m.name.toLowerCase(), m.displayName || m.name]));

      const hierarchyWithDisplayNames = MODULE_HIERARCHY.map(module => ({
        ...module,
        displayName: moduleDisplayMap.get(module.module.toLowerCase()) || module.label,
      }));

      // ── Always include Dashboard at the top for backoffice admins ──────
      const hasDashboard = hierarchyWithDisplayNames.some(
        (m: any) => m.module?.toLowerCase() === 'dashboard'
      );
      if (!hasDashboard) {
        hierarchyWithDisplayNames.unshift({
          module: 'dashboard',
          label: 'Dashboard',
          displayName: 'Dashboard',
          icon: 'LayoutDashboard',
          section: 'main',
          enabled: true,
          disabledReason: null,
          defaultRoles: ['OWNER', 'MANAGER', 'CASHIER'],
          subModules: [
            {
              key: 'dashboard',
              label: 'Dashboard',
              href: '/',
              icon: 'LayoutDashboard',
              module: 'dashboard',
              roles: ['OWNER', 'MANAGER', 'CASHIER'],
            },
          ],
        } as any);
      } else {
        const idx = hierarchyWithDisplayNames.findIndex(
          (m: any) => m.module?.toLowerCase() === 'dashboard'
        );
        if (idx > 0) {
          const [dash] = hierarchyWithDisplayNames.splice(idx, 1);
          hierarchyWithDisplayNames.unshift(dash);
        }
      }

      return res.json({
        success: true,
        data: {
          hierarchy: hierarchyWithDisplayNames,
          userRole: adminRole,
          businessId: null,
          lastUpdated: new Date().toISOString(),
        },
      });
    }

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message: 'Business context is required (X-Business-ID).',
      });
    }

    const businessExists = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true } });
    if (!businessExists) {
      return res.status(404).json({ success: false, message: 'Business not found' });
    }

    // ── Get module enablement status from database ─────────────────────────
    const allModuleRowsRaw = await prisma.$queryRawUnsafe('SELECT id, name, "displayName" FROM modules ORDER BY name ASC');
    const allModuleRows = (allModuleRowsRaw as Array<{ name: string; displayName?: string }>) || [];

    const v2Payload = await getModuleAccessV2(prisma, businessId, req.user?.id || '', {
      skipCache: false,
      roleName: userRole,
    });

    // Build per-sub-module denial reason map from V2 results
    const subModuleReasonMap = new Map<string, SubModuleAccessResult>();
    if (Array.isArray(v2Payload.subModuleResults)) {
      for (const smr of v2Payload.subModuleResults) {
        // L-6 fix (2026-10-26): normalize the key (hyphens → underscores).
        // The V2 resolver returns normalized keys (e.g. sales::tax_classes)
        // while the hierarchy uses hyphens (sales::tax-classes); without
        // normalization the lookup below misses and the fallback marks the
        // page enabled, leaking denied pages into the sidebar.
        subModuleReasonMap.set(normalizeModuleKey(`${smr.module}::${smr.key}`), smr);
      }
    }

    // Backward-compatible flat set (used only as fallback)
    // L-6 fix (2026-10-26): normalize entries the same way as the map and
    // the lookup below, or hyphenated pages miss this set too.
    const disabledSubModulesSet = new Set<string>(
      Array.isArray(v2Payload.disabledSubModules) ? v2Payload.disabledSubModules.map((s: string) => normalizeModuleKey(s)) : []
    );
    const enabledModulesData = toLegacyModuleAccessPayload(v2Payload).data;
    const normalizedRole = userRole === 'ADMIN' ? 'OWNER' : userRole.toUpperCase();
    const moduleStatusMap = new Map(
      enabledModulesData.map((m) => [String(m.name || '').toLowerCase(), m])
    );

    const filteredHierarchy = MODULE_HIERARCHY
      .map((module) => {
        const status = moduleStatusMap.get(module.module.toLowerCase());
        if (!status) {
          // Module not in V2 result — FAIL CLOSED (hide it). This used to
          // include the module as enabled by default, which surfaced
          // modules the resolver never evaluated (or had denied) in the
          // sidebar for every business type.
          return null;
        }

        if (status.disabledReason === 'BUSINESS_TYPE' || status.disabledReason === 'ROLE' || status.disabledReason === 'PARENT_MODULE') {
          return null;
        }

        // Per-sub-module filtering with denial-reason awareness
        const processedSubModules = module.subModules.map((sub) => {
          // L-6 fix (2026-10-26): normalize the lookup key the same way as
          // the map keys above (hyphens → underscores).
          const subKey = normalizeModuleKey(`${sub.module}::${sub.key}`);
          const smr = subModuleReasonMap.get(subKey);
          const effective = smr
            ? { enabled: smr.enabled, disabledReason: smr.enabled ? null : smr.primaryDenialReason }
            : { enabled: !disabledSubModulesSet.has(subKey), disabledReason: disabledSubModulesSet.has(subKey) ? 'SUBSCRIPTION_PLAN' as const : null };
          return { ...sub, ...effective };
        });

        // Split: accessible (enabled + plan-locked) vs hidden (BT/role/parent denied)
        const accessibleSubModules = processedSubModules.filter((sub) => {
          // Show if enabled OR locked by subscription plan (upsell opportunity)
          if (sub.enabled) return true;
          if (sub.disabledReason === 'SUBSCRIPTION_PLAN') return true;
          // Hide: business type denied, role denied, parent denied
          return false;
        });

        if (accessibleSubModules.length === 0) {
          // If the module is locked by subscription plan, preserve the module group so the user can see the locked state.
          if (status.disabledReason === 'SUBSCRIPTION_PLAN') {
            return {
              ...module,
              enabled: false,
              disabledReason: status.disabledReason,
              subModules: processedSubModules,
            };
          }
          return null;
        }

        return {
          ...module,
          enabled: status.enabled,
          disabledReason: status.disabledReason,
          subModules: accessibleSubModules,
        };
      })
      .filter(Boolean);

    // ── Add module display names from database ────────────────────────────
    const moduleDisplayMap = new Map(allModuleRows.map(m => [m.name.toLowerCase(), m.displayName || m.name]));

    const hierarchyWithDisplayNames = filteredHierarchy.map(module => {
      if (!module) return null;
      return {
        ...module,
        displayName: moduleDisplayMap.get(module.module.toLowerCase()) || module.label,
      };
    }).filter(Boolean);

    // ── Always include Dashboard at the top ──────────────────────────────
    const DASHBOARD_GROUP = {
      module: 'dashboard',
      label: 'Dashboard',
      displayName: 'Dashboard',
      icon: 'LayoutDashboard',
      section: 'main' as const,
      enabled: true,
      disabledReason: null as null,
      defaultRoles: ['OWNER', 'MANAGER', 'CASHIER'],
      subModules: [
        {
          key: 'dashboard',
          label: 'Dashboard',
          href: '/',
          icon: 'LayoutDashboard',
          module: 'dashboard',
          roles: ['OWNER', 'MANAGER', 'CASHIER'],
        },
      ],
    };

    const hasDashboard = hierarchyWithDisplayNames.some(
      (m: any) => m.module?.toLowerCase() === 'dashboard'
    );
    if (!hasDashboard) {
      hierarchyWithDisplayNames.unshift(DASHBOARD_GROUP as any);
    } else {
      // Move existing dashboard entry to the top
      const idx = hierarchyWithDisplayNames.findIndex(
        (m: any) => m.module?.toLowerCase() === 'dashboard'
      );
      if (idx > 0) {
        const [dash] = hierarchyWithDisplayNames.splice(idx, 1);
        hierarchyWithDisplayNames.unshift(dash);
      }
    }

    return res.json({
      success: true,
      data: {
        hierarchy: hierarchyWithDisplayNames,
        userRole: normalizedRole,
        businessId,
        subModuleResults: v2Payload.subModuleResults || [],
        lastUpdated: new Date().toISOString(),
      },
    });
  } catch (error: any) {
    console.error('[getModuleHierarchy] Error:', error);
    if (/not member of business/i.test(String(error?.message || ''))) {
      return res.status(403).json({
        success: false,
        message: 'No active membership found for the selected business.',
        error: 'NO_ACTIVE_MEMBERSHIP',
        data: { hierarchy: [] },
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Failed to load module hierarchy.',
      error: error?.message || 'Unknown error',
    });
  }
};


