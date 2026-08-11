/**
 * Module Access Control Middleware
 * Enforces that users can only access modules enabled for their business
 *
 * SECURITY PRINCIPLE: Backend is the single source of truth for access control.
 * Frontend visibility is UX only - backend MUST block unauthorized access.
 */

import { Request, Response, NextFunction } from 'express';
import { getPrisma } from '../utils/db.util';
import { getModuleAccessV2 } from '../utils/modules-v2.util';

// Extend Express Request to include module access info
declare global {
  namespace Express {
    interface Request {
      moduleAccess?: {
        allowedModules: string[];
        hasAccess: (moduleKey: string) => boolean;
      };
    }
  }
}

export interface AuthRequest extends Request {
  user?: {
    id: string;
    selectedCompanyId?: string;
    companyId?: string;
    role?: string;
  };
  membership?: {
    business_id: string;
    role?: string;
    role_name?: string;
  };
  business_id?: string;
}

interface ModuleAccessResult {
  allowed: boolean;
  module?: string;
  error?: string;
  allowedModules?: string[];
  allowedOperations?: string[];
  blockedOperations?: string[];
  page?: string;
  fallbackFullOps?: boolean;
}

/**
 * Check if a user has access to a specific module page for their business.
 * This is the core authorization logic - used by middleware and can be called
 * directly.
 *
 * SECURITY (Issue 4): when `pageKey` is provided, `allowedOperations` is
 * resolved per page — a permission on another page of the same module grants
 * nothing here. When the role has no role_permissions_v2 rows at all, the
 * documented migration fallback grants the full operation set and
 * `fallbackFullOps` is true (measurable via getFallbackOperationGrantCount).
 */
export async function checkModuleAccess(
  userId: string,
  businessId: string,
  moduleKey: string,
  membershipRole?: string,
  pageKey?: string
): Promise<ModuleAccessResult> {
  const prisma = await getPrisma();

  try {
    const { modules } = await getModuleAccessV2(prisma, businessId, userId, {
      skipCache: false,
      roleName: membershipRole,
    });

    const normalizedModuleKey = String(moduleKey).trim().toLowerCase();
    const moduleEntry = modules.find((m) => String(m.moduleKey).toLowerCase() === normalizedModuleKey);

    if (!moduleEntry) {
      return {
        allowed: false,
        error: 'MODULE_NOT_FOUND',
        module: moduleKey,
      };
    }

    if (!moduleEntry.enabled) {
      return {
        allowed: false,
        error: 'MODULE_NOT_ALLOWED',
        module: moduleKey,
        allowedModules: modules.filter((m) => m.enabled).map((m) => String(m.moduleKey).toLowerCase()),
      };
    }

    // Resolve per-page operations when a page is required for this endpoint.
    const requestedPage = pageKey ? String(pageKey).trim().toLowerCase() : null;
    let allowedOperations = Array.isArray(moduleEntry.allowedOperations) ? moduleEntry.allowedOperations : [];
    let blockedOperations = Array.isArray(moduleEntry.blockedOperations) ? moduleEntry.blockedOperations : [];

    if (requestedPage && moduleEntry.pageOperations) {
      const pageOps = moduleEntry.pageOperations[requestedPage];
      if (pageOps) {
        allowedOperations = Array.isArray(pageOps.allowedOperations) ? pageOps.allowedOperations : [];
        blockedOperations = Array.isArray(pageOps.blockedOperations) ? pageOps.blockedOperations : [];
      } else {
        // Page not present in the resolved access payload — no implicit grants.
        allowedOperations = [];
        blockedOperations = [];
      }
    }

    return {
      allowed: true,
      module: moduleKey,
      allowedModules: modules.filter((m) => m.enabled).map((m) => String(m.moduleKey).toLowerCase()),
      allowedOperations,
      blockedOperations,
      page: requestedPage || undefined,
      fallbackFullOps: !!(moduleEntry as any).fallbackFullOps,
    };
  } catch (error: any) {
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('user not member of business')) {
      return {
        allowed: false,
        error: 'NO_MEMBERSHIP',
        module: moduleKey,
      };
    }

    console.error('[Module Access] Database error:', error);
    return {
      allowed: false,
      error: 'DATABASE_ERROR',
      module: moduleKey,
    };
  }
}

/**
 * Middleware factory: Creates middleware for a specific module
 * Usage: router.use('/inventory', requireModule('inventory'), inventoryRoutes)
 */
export function requireModule(moduleKey: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    try {
      // Extract user ID from JWT (set by auth middleware)
      const userId = req.user?.id;
      if (!userId) {
        console.warn('[Module Access] ❌ No user ID in request - auth middleware not applied?');
        return res.status(401).json({
          success: false,
          error: 'UNAUTHORIZED',
          message: 'Authentication required',
        });
      }

      // Extract business ID from multiple sources (priority order)
      const businessId =
        req.business_id ||
        req.membership?.business_id ||
        req.headers['x-business-id'] as string ||
        req.user?.selectedCompanyId ||
        req.user?.companyId;

      if (!businessId) {
        console.warn('[Module Access] ❌ No business context - X-Business-ID header missing');
        return res.status(400).json({
          success: false,
          error: 'NO_BUSINESS_CONTEXT',
          message: 'Business context required (X-Business-ID header)',
        });
      }

      // Check module access
      const accessResult = await checkModuleAccess(
        userId,
        businessId,
        moduleKey,
        req.membership?.role_name || req.membership?.role
      );

      // Log access attempt for security auditing
      const duration = Date.now() - startTime;
      console.log(`[Module Access] ${accessResult.allowed ? '✅' : '❌'} ${moduleKey} | User: ${userId} | Business: ${businessId} | ${duration}ms`);

      if (!accessResult.allowed) {
        // Security: Log unauthorized access attempts
        if (accessResult.error === 'NO_MEMBERSHIP') {
          console.warn(`[Module Access] 🚨 UNAUTHORIZED: User ${userId} has no membership with business ${businessId}`);
          return res.status(401).json({
            success: false,
            error: 'NO_MEMBERSHIP',
            message: 'You are not a member of this business',
          });
        }

        if (accessResult.error === 'MODULE_NOT_ALLOWED') {
          console.warn(`[Module Access] 🚨 FORBIDDEN: User ${userId} attempted to access disabled module '${moduleKey}' for business ${businessId}`);
          console.warn(`[Module Access] ℹ️ Allowed modules for this business: ${accessResult.allowedModules?.join(', ') || 'none'}`);

          return res.status(403).json({
            success: false,
            error: 'MODULE_NOT_ALLOWED',
            message: 'This module is not enabled in your subscription',
            module: moduleKey,
            allowedModules: accessResult.allowedModules || [],
          });
        }

        // Unknown error
        return res.status(500).json({
          success: false,
          error: accessResult.error || 'ACCESS_CHECK_FAILED',
          message: 'Unable to verify module access',
        });
      }

      // Attach module access info to request for downstream use
      req.moduleAccess = {
        allowedModules: accessResult.allowedModules || [],
        hasAccess: (key: string) => accessResult.allowedModules?.includes(key) || false,
      };
      (req as any).moduleOperations = {
        allowedOperations: accessResult.allowedOperations || [],
        blockedOperations: accessResult.blockedOperations || [],
        hasOperation: (op: string) => accessResult.allowedOperations?.includes(op) || false,
      };

      return next();
    } catch (error) {
      console.error('[Module Access] Middleware error:', error);
      return res.status(500).json({
        success: false,
        error: 'MODULE_ACCESS_ERROR',
        message: 'Error checking module access',
      });
    }
  };
}

/**
 * Middleware: Loads module access without blocking
 * Use for routes that need to know what's available but don't require specific module
 */
export async function loadModuleAccess(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const userId = req.user?.id;
    const businessId =
      req.business_id ||
      req.membership?.business_id ||
      req.headers['x-company-id'] as string ||
      req.user?.selectedCompanyId;

    if (!userId || !businessId) {
      req.moduleAccess = { allowedModules: [], hasAccess: () => false };
      return next();
    }

    const prisma = await getPrisma();
    const { modules } = await getModuleAccessV2(prisma, businessId, userId, {
      skipCache: false,
      roleName: req.membership?.role_name || req.membership?.role,
    });
    const enabledModuleNames = modules.filter((m) => m.enabled).map((m) => String(m.moduleKey).toLowerCase());

    req.moduleAccess = {
      allowedModules: enabledModuleNames,
      hasAccess: (key: string) => enabledModuleNames.includes(String(key).toLowerCase()),
    };

    next();
  } catch (error) {
    console.error('[Module Access] Error loading module access:', error);
    req.moduleAccess = { allowedModules: [], hasAccess: () => false };
    next();
  }
}

/**
 * Batch check multiple modules at once
 * Useful for dashboard or navigation endpoints
 */
export async function checkMultipleModules(
  userId: string,
  businessId: string,
  moduleKeys: string[]
): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};

  for (const key of moduleKeys) {
    const access = await checkModuleAccess(userId, businessId, key);
    results[key] = access.allowed;
  }

  return results;
}

/**
 * Get all enabled modules for a business
 * Used by frontend to build navigation
 */
async function resolveBusinessUserIdForModuleAccess(prisma: any, businessId: string): Promise<string | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { createdBy: true },
  });

  if (business?.createdBy) {
    return String(business.createdBy);
  }

  const membership = await prisma.membership.findFirst({
    where: { businessId, status: 'ACTIVE' },
    select: { userId: true },
  });

  return membership?.userId || null;
}

export async function getEnabledModulesForBusiness(
  businessId: string
): Promise<string[]> {
  const prisma = await getPrisma();
  const userId = await resolveBusinessUserIdForModuleAccess(prisma, businessId);

  if (!userId) {
    return [];
  }

  const payload = await getModuleAccessV2(prisma, businessId, userId, { skipCache: false });
  return payload.modules.filter((m) => m.enabled).map((m) => String(m.moduleKey).toLowerCase());
}
