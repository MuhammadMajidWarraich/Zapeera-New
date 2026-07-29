import { NextFunction, Response } from 'express';
import { AuthRequest } from './auth.middleware';
import { getPrisma } from '../utils/db.util';
import { getBusinessEntitlementsSummary, SupportedBusinessType } from '../utils/subscription-entitlements.util';
import { hasPermission as hasConfiguredPermission } from '../config/permissions';

const ALWAYS_ALLOWED_MODULES = new Set(['subscription']);

const STANDARD_MEMBERSHIP_ROLES = new Set(['OWNER', 'USER', 'MANAGER', 'CASHIER']);

interface EntitlementsCacheEntry {
  entitlements: any;
  expiresAt: number;
}
const entitlementsCache = new Map<string, EntitlementsCacheEntry>();
const ENTITLEMENTS_CACHE_TTL = 60_000;

function getCachedEntitlements(businessId: string): any | undefined {
  const entry = entitlementsCache.get(businessId);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    entitlementsCache.delete(businessId);
    return undefined;
  }
  return entry.entitlements;
}

function setCachedEntitlements(businessId: string, entitlements: any): void {
  if (entitlementsCache.size > 1000) {
    const firstKey = entitlementsCache.keys().next().value;
    if (typeof firstKey === 'string') entitlementsCache.delete(firstKey);
  }
  entitlementsCache.set(businessId, {
    entitlements,
    expiresAt: Date.now() + ENTITLEMENTS_CACHE_TTL,
  });
}

export function invalidateEntitlementsCache(businessId: string): void {
  entitlementsCache.delete(businessId);
}

const permissionNameToResourceAction = (permissionName: string): { resource: string; action: string } | null => {
  const normalized = String(permissionName || '').trim().toLowerCase();
  if (!normalized) return null;

  if (normalized.includes('.')) {
    const [resource, action] = normalized.split('.');
    if (!resource || !action) return null;
    return { resource, action };
  }

  const firstUnderscore = normalized.indexOf('_');
  if (firstUnderscore <= 0) return null;

  const action = normalized.slice(0, firstUnderscore);
  let resource = normalized.slice(firstUnderscore + 1);
  if (!action || !resource) return null;

  const pluralResources: Record<string, string> = {
    sale: 'sales',
    product: 'products',
    category: 'categories',
    supplier: 'suppliers',
    user: 'users',
    employee: 'employees',
    branch: 'branches',
    customer: 'customers',
    refund: 'refunds',
    invoice: 'invoices',
    receipt: 'receipts',
    setting: 'settings',
    report: 'reports',
    batch: 'batches',
    purchase: 'purchases',
    shelf: 'shelves',
    manufacturer: 'manufacturers',
  };

  resource = pluralResources[resource] || resource;
  return { resource, action };
};

const isMissingTableError = (error: any): boolean => {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('no such table') ||
    message.includes('relation') && message.includes('does not exist') ||
    message.includes('p2021')
  );
};

const normalizeHeaderValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

export const resolveBusiness = (options?: { required?: boolean }) => {
  const required = options?.required ?? true;

  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const fromHeader = normalizeHeaderValue(req.header('X-Business-ID'));
    const fallback = req.user?.selectedCompanyId;
    let businessId = fromHeader || fallback;
    const branchHeader = normalizeHeaderValue(req.header('X-Branch-ID'));

    if (branchHeader) {
      try {
        const prisma = await getPrisma();
        const branch = await prisma.branch.findUnique({
          where: { id: branchHeader },
          select: { companyId: true }
        });
        const branchCompanyId = branch?.companyId ? String(branch.companyId) : undefined;

        if (branchCompanyId) {
          if (!businessId) {
            businessId = branchCompanyId;
          } else if (businessId !== branchCompanyId) {
            // SECURITY FIX: Validate user has membership in the branch's company before overriding
            const hasMembership = await prisma.membership.findFirst({
              where: {
                userId: req.user?.id,
                businessId: branchCompanyId,
                status: 'ACTIVE'
              },
              select: { id: true }
            });
            
            if (hasMembership) {
              console.warn(
                `[resolveBusiness] Branch ${branchHeader} belongs to company ${branchCompanyId} but request business is ${businessId}. Overriding business context to branch company (user has membership).`
              );
              businessId = branchCompanyId;
            } else {
              console.error(
                `[resolveBusiness] ❌ SECURITY: User ${req.user?.id} attempted to access branch ${branchHeader} from company ${branchCompanyId} without membership. Blocking.`
              );
              return res.status(403).json({
                success: false,
                message: 'Access denied: You do not have access to this branch.',
                error: 'BRANCH_ACCESS_DENIED'
              });
            }
          }
        }
      } catch (error) {
        console.warn('[resolveBusiness] Could not derive company from branch:', error);
      }
    }

    if (!businessId && required) {
      return res.status(400).json({
        success: false,
        message: 'Business context is required (X-Business-ID).',
      });
    }

    req.business_id = businessId;
    return next();
  };
};

export const resolveMembership = (options?: { strict?: boolean }) => {
  const strict = options?.strict ?? false;

  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user?.id || !req.business_id) {
      return next();
    }

    const prisma = await getPrisma();

    try {
      const membership = await prisma.membership.findFirst({
        where: {
          userId: req.user.id,
          businessId: req.business_id,
          status: 'ACTIVE'
        },
        include: {
          role: { select: { name: true } },
          branches: { select: { branchId: true } }
        }
      });

      if (membership) {
        let roleName = membership.role?.name ? String(membership.role.name) : null;
        if (roleName === 'ADMIN') roleName = 'OWNER';
        req.membership = {
          id: String(membership.id),
          user_id: String(membership.userId),
          business_id: String(membership.businessId),
          role_id: membership.roleId ? String(membership.roleId) : null,
          role_name: roleName,
          status: String(membership.status || 'ACTIVE'),
          branch_ids: Array.isArray(membership.branches)
            ? membership.branches.filter((b) => b.branchId != null).map((b) => String(b.branchId))
            : []
        };

        // DO NOT overwrite req.user.role here.
        return next();
      }

      // If no membership, check if user is the business creator — treat as OWNER
      try {
        const business = await prisma.business.findUnique({
          where: { id: req.business_id },
          select: { createdBy: true }
        });
        if (business?.createdBy && String(business.createdBy) === String(req.user.id)) {
          req.membership = {
            id: `creator:${req.user.id}:${req.business_id}`,
            user_id: String(req.user.id),
            business_id: String(req.business_id),
            role_id: null,
            role_name: 'OWNER',
            status: 'ACTIVE',
            branch_ids: []
          };
          return next();
        }
      } catch (_) {
        // fall through
      }

      if (strict) {
        return res.status(403).json({
          success: false,
          message: 'No active membership found for selected business.',
        });
      }

      return next();
    } catch (error: any) {
      if (isMissingTableError(error)) {
        // SECURITY FIX: Fail-secure - do not grant access when tables are missing
        console.error('[resolveMembership] ❌ CRITICAL: Required tables missing, denying access');
        return res.status(503).json({
          success: false,
          message: 'Service temporarily unavailable. Please contact support.',
          error: 'SCHEMA_MIGRATION_REQUIRED'
        });
      }
      return next(error);
    }
  };
};

export const resolveBranch = (options?: { required?: boolean }) => {
  const required = options?.required ?? false;

  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const fromHeader = normalizeHeaderValue(req.header('X-Branch-ID'));
    const fromBody = normalizeHeaderValue(req.body?.branchId);
    const fromQuery = normalizeHeaderValue(req.query?.branchId);
    const fallback = req.user?.selectedBranchId;
    const branchId = fromHeader || fromBody || fromQuery || fallback;

    if (!branchId && required) {
      return res.status(400).json({
        success: false,
        message: 'Branch context is required (X-Branch-ID).',
      });
    }

    if (!branchId) {
      return next();
    }

    req.branch_id = branchId;

    const prisma = await getPrisma();
    // Infer business context from branch if missing, and validate branch belongs to selected business.
    try {
      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        select: { companyId: true },
      });
      if (!branch) {
        return res.status(404).json({
          success: false,
          message: 'Branch not found for selected business.',
        });
      }
      if (req.business_id && String(branch.companyId) !== String(req.business_id)) {
        return res.status(404).json({
          success: false,
          message: 'Branch not found for selected business.',
        });
      }
      if (!req.business_id) {
        req.business_id = String(branch.companyId);
      }
    } catch (error: any) {
      return next(error);
    }

    // No legacy fallback for roles. Role resolution requires Membership record.

    // Get the user's role from membership (business-scoped)
    const membershipRole = req.membership?.role_name ? String(req.membership.role_name).toUpperCase() : '';

    // OWNER and ADMIN roles have full branch access within that business
    if (membershipRole === 'OWNER' || membershipRole === 'ADMIN') {
      console.log(`[resolveBranch] ✅ OWNER/ADMIN access granted for ${req.user?.id} to branch ${branchId}`);
      return next();
    }

    if (!req.membership?.id) {
      console.log(`[resolveBranch] ⚠️ No membership ID for ${req.user?.id}, skipping branch check`);
      return next();
    }

    console.log(`[resolveBranch] 🔍 Checking branch access for ${req.user?.id}: membership=${req.membership.id}, branchId=${branchId}, role=${membershipRole}, branch_ids=${JSON.stringify(req.membership.branch_ids)}`);

    try {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT id
        FROM membership_branches
        WHERE membershipId = ${req.membership.id}
          AND branchId = ${branchId}
        LIMIT 1
      `;

      if (!rows[0]) {
        console.log(`[resolveBranch] ❌ DENIED: ${req.user?.id} not allowed for branch ${branchId} on membership ${req.membership.id}`);
        return res.status(403).json({
          success: false,
          message: 'Membership is not allowed to access this branch.',
        });
      }

      console.log(`[resolveBranch] ✅ ALLOWED: ${req.user?.id} for branch ${branchId} on membership ${req.membership.id}`);
      return next();
    } catch (error: any) {
      if (isMissingTableError(error)) {
        // SECURITY FIX: Fail-secure - do not skip branch check when tables are missing
        console.error(`[resolveBranch] ❌ CRITICAL: Required tables missing, denying access`);
        return res.status(503).json({
          success: false,
          message: 'Service temporarily unavailable. Please contact support.',
          error: 'SCHEMA_MIGRATION_REQUIRED'
        });
      }
      console.error(`[resolveBranch] ❌ Error checking branch access:`, error.message);
      return next(error);
    }
  };
};

export const checkPermission = (permissionName: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const compatibilityRole = String(req.user?.role || '').toUpperCase();

    if (!req.membership || req.membership.id.startsWith('legacy:')) {
      // Backward compatible mode until membership/role migration is fully complete.
      return next();
    }

    // OWNER and ADMIN roles have full access within their business — no per-permission check needed
    const membershipRoleName = String(req.membership.role_name || '').toUpperCase();
    if (membershipRoleName === 'OWNER' || membershipRoleName === 'ADMIN') return next();

    // If the requesting user is the business creator, treat as OWNER
    if (req.business_id && req.user?.id) {
      try {
        const prisma = await getPrisma();
        const company = await prisma.business.findUnique({
          where: { id: req.business_id },
          select: { createdBy: true },
        });
        if (company?.createdBy && String(company.createdBy) === String(req.user.id)) {
          return next();
        }
      } catch (_) {
        // fall through to normal check
      }
    }

    if (!req.membership.role_id) {
      return res.status(403).json({
        success: false,
        message: `Permission denied: ${permissionName}`,
      });
    }

    const prisma = await getPrisma();
    try {
      const rows = await prisma.$queryRaw<any[]>`
        SELECT 1 as allowed
        FROM role_permissions rp
        INNER JOIN permissions p ON p.id = rp.permissionId
        WHERE rp.roleId = ${req.membership.role_id}
          AND p.name = ${permissionName}
        LIMIT 1
      `;

      if (!rows[0]) {
        const configuredPermission = permissionNameToResourceAction(permissionName);
        if (
          configuredPermission &&
          STANDARD_MEMBERSHIP_ROLES.has(membershipRoleName)
        ) {
          // CRITICAL FIX: Check if user has access to the target branch
          // For branch-scoped permissions, verify the target branch is in user's assigned branches
          const targetBranchId = req.branch_id;
          const userBranchIds = req.membership.branch_ids || [];

          // If there's a target branch, verify user has access to it
          if (targetBranchId && userBranchIds.length > 0 && !userBranchIds.includes(targetBranchId)) {
            console.log(`[checkPermission] ❌ DENIED: ${req.user?.id} accessing branch ${targetBranchId} not in assigned branches:`, userBranchIds);
            return res.status(403).json({
              success: false,
              message: `Permission denied: ${permissionName} - branch access not allowed`,
            });
          }

          // Check if role has the configured permission
          // CRITICAL FIX: For MANAGER/CASHIER, check if target branch is in their assigned branches
          const hasPermission = (() => {
            // First check basic permission without branch constraint
            const basicCheck = hasConfiguredPermission(
              membershipRoleName,
              configuredPermission.resource,
              configuredPermission.action
            );
            if (!basicCheck) return false;

            // For branch-scoped permissions, verify target branch is in user's allowed branches
            if (targetBranchId && userBranchIds.length > 0) {
              return userBranchIds.includes(targetBranchId);
            }

            return true;
          })();

          if (hasPermission) {
            return next();
          }
        }

        return res.status(403).json({
          success: false,
          message: `Permission denied: ${permissionName}`,
        });
      }

      return next();
    } catch (error: any) {
      if (isMissingTableError(error)) {
        // SECURITY FIX: Fail-secure - do not grant access when tables are missing
        console.error('[resolveMembership] ❌ CRITICAL: Required tables missing, denying access');
        return res.status(503).json({
          success: false,
          message: 'Service temporarily unavailable. Please contact support.',
          error: 'SCHEMA_MIGRATION_REQUIRED'
        });
      }
      return next(error);
    }
  };
};

export const checkModule = (moduleName: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const businessId = req.business_id;
      if (!businessId) {
        return next();
      }

      if (ALWAYS_ALLOWED_MODULES.has(moduleName.toLowerCase())) {
        return next();
      }

      const prisma = await getPrisma();

      const company = await prisma.business.findUnique({
        where: { id: businessId },
        select: { id: true, createdBy: true, businessType: true }
      });

      if (!company) return next();

      console.log(`[checkModule:${moduleName}] Starting check for businessId=${businessId}, businessType=${company.businessType}`);

      // NEW: Plan-based entitlement check
      const businessType = (String(company.businessType || '').toUpperCase() || 'PHARMACY') as SupportedBusinessType;
      // Resolve the true owner of the business to check THEIR subscription
      let ownerUserId = company.createdBy ? String(company.createdBy) : '';
      
      if (!ownerUserId) {
        // Fallback: Find the first member with OWNER role
        const ownerMembership = await prisma.$queryRaw<any[]>`
          SELECT m.userId 
          FROM memberships m
          INNER JOIN roles r ON r.id = m.roleId
          WHERE m.businessId = ${businessId} 
            AND r.name = 'OWNER'
            AND m.status = 'ACTIVE'
          ORDER BY m.createdAt ASC 
          LIMIT 1
        `;
        if (ownerMembership && ownerMembership.length > 0) {
          ownerUserId = String(ownerMembership[0].userId);
        } else {
          // Last resort: use the current user (might be correct if they are the owner but createdBy is null)
          ownerUserId = req.user?.id || '';
        }
      }

      const entitlements = getCachedEntitlements(businessId) ?? await (async () => {
        const result = await getBusinessEntitlementsSummary(prisma, {
          companyId: businessId,
          ownerUserId: ownerUserId,
          businessType
        });
        setCachedEntitlements(businessId, result);
        return result;
      })();

      // Resolve the business type ID for this company (used in all type checks below)
      const btIdRows = await prisma.$queryRaw<any[]>`
        SELECT businessType as btId FROM businesses WHERE id = ${businessId} LIMIT 1
      `;
      const resolvedBtId: string | null = btIdRows?.[0]?.btId || null;
      console.log(`[checkModule:${moduleName}] businessId=${businessId} resolvedBtId=${resolvedBtId}`);

      // If no business type is set, or the business type has NO module rows configured at all,
      // skip the type gate entirely and fall through to plan/business-level checks.
      if (resolvedBtId) {
        const typeRowCount = await prisma.$queryRaw<any[]>`
          SELECT COUNT(*) as cnt FROM business_type_modules WHERE businessTypeId = ${resolvedBtId}
        `;
        const totalTypeRows = Number(typeRowCount?.[0]?.cnt ?? 0);
        console.log(`[checkModule:${moduleName}] totalTypeRows for btId=${resolvedBtId}: ${totalTypeRows}`);
        if (totalTypeRows === 0) {
          // Business type exists but has no module configuration — allow all (unconfigured)
          console.log(`[checkModule:${moduleName}] No type config → skipping type gate`);
          return next();
        }
      }

      // If entitlements are null, the business has no valid subscription — deny.
      if (!entitlements || !entitlements.modules) {
        return res.status(403).json({
          success: false,
          message: `Module '${moduleName}' is not available. No active subscription found.`,
          details: { module: moduleName }
        });
      }

      // If we have entitlements, the plan allows this module —
      // but ALSO verify the business type template allows it (business type is the authority).
      if (entitlements && entitlements.modules) {
        const planAllows = entitlements.modules[moduleName.toLowerCase()];
        console.log(`[checkModule:${moduleName}] planAllows=${planAllows}`);
        if (planAllows) {
          // Check if business type also allows this module
          const typeCheck = resolvedBtId ? await prisma.$queryRaw<any[]>`
            SELECT 1
            FROM business_type_modules btm
            INNER JOIN modules m ON m.id = btm.moduleId
            WHERE btm.businessTypeId = ${resolvedBtId}
              AND LOWER(m.name) = LOWER(${moduleName})
              AND btm.isEnabled = 1
            LIMIT 1
          ` : [];
          console.log(`[checkModule:${moduleName}] typeCheck rows=${typeCheck?.length} (plan path)`);
          if (typeCheck && typeCheck.length > 0) {
            return next();
          }

          const businessEnabled = await prisma.$queryRaw<any[]>`
            SELECT bm.id
            FROM business_modules bm
            INNER JOIN modules m ON m.id = bm.moduleId
            WHERE bm.businessId = ${businessId}
              AND LOWER(m.name) = LOWER(${moduleName})
              AND bm.enabled = 1
            LIMIT 1
          `;
          if (businessEnabled && businessEnabled.length > 0) {
            console.log(`[checkModule:${moduleName}] business override enabled`);
            return next();
          }

          // Plan allows it but business type does not — deny
          return res.status(403).json({
            success: false,
            message: `Module '${moduleName}' is not enabled for this business type.`,
            details: { module: moduleName, planId: entitlements.planId }
          });
        }
      }

      // FALLBACK: Database-based check.
      // Module must be enabled at BOTH the business-type level AND the business level.
      // This prevents stale business_modules rows from bypassing the type gate.
      const typeEnabledCheck = resolvedBtId ? await prisma.$queryRaw<any[]>`
        SELECT 1
        FROM business_type_modules btm
        INNER JOIN modules m ON m.id = btm.moduleId
        WHERE btm.businessTypeId = ${resolvedBtId}
          AND LOWER(m.name) = LOWER(${moduleName})
          AND btm.isEnabled = 1
        LIMIT 1
      ` : [];
      console.log(`[checkModule:${moduleName}] typeEnabledCheck rows=${typeEnabledCheck?.length} (fallback path)`);

      if (!typeEnabledCheck || typeEnabledCheck.length === 0) {
        // Business type does not allow this module — deny regardless of business_modules row
        return res.status(403).json({
          success: false,
          message: `Module '${moduleName}' is not enabled for this business type.`,
          details: { module: moduleName, planId: entitlements?.planId || 'unknown' }
        });
      }

      // Type allows it — check if business has explicitly disabled it via override
      const businessDisabled = await prisma.$queryRaw<any[]>`
        SELECT bm.id
        FROM business_modules bm
        INNER JOIN modules m ON m.id = bm.moduleId
        WHERE bm.businessId = ${businessId}
          AND m.name = ${moduleName}
          AND bm.enabled = 0
        LIMIT 1
      `;

      if (businessDisabled && businessDisabled.length > 0) {
        return res.status(403).json({
          success: false,
          message: `Module '${moduleName}' is disabled for this business.`,
          details: { module: moduleName, planId: entitlements?.planId || 'unknown' }
        });
      }

      // Type allows it and no business-level disable — grant access
      return next();
    } catch (error: any) {
      console.error(`[checkModule] Error checking module ${moduleName}:`, error);
      if (isMissingTableError(error)) {
        // SECURITY FIX: Fail-closed - deny access when tables are missing
        console.error(`[checkModule:${moduleName}] ❌ CRITICAL: Required tables missing, denying access`);
        return res.status(503).json({ 
          success: false, 
          message: 'Service temporarily unavailable. Please contact support.',
          error: 'SCHEMA_MIGRATION_REQUIRED'
        });
      }
      return next(error);
    }
  };
};
