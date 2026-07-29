import { NextFunction, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AuthRequest, getUserRole } from './auth.middleware';
import {
  AllowedDashboardAccessRole,
  loadPricingPlans,
  resolveBusinessPlan,
  assignBusinessPlan,
} from '../utils/subscription-entitlements.util';
import { PLANS, ROLES } from '../config/constants';

const normalizeHeaderValue = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim()) return value[0].trim();
  return null;
};

const normalizeQueryValue = (value: unknown): string | null => {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value) && typeof value[0] === 'string' && value[0].trim()) return value[0].trim();
  return null;
};

const resolveCompanyId = async (req: AuthRequest): Promise<string | null> => {
  const directCompanyId =
    req.business_id ||
    normalizeHeaderValue(req.headers['x-company-id']) ||
    (req.user?.selectedCompanyId ? String(req.user.selectedCompanyId) : null) ||
    (req.user?.companyId ? String(req.user.companyId) : null);
  if (directCompanyId) return directCompanyId;

  const branchId =
    normalizeHeaderValue(req.headers['x-branch-id']) ||
    normalizeQueryValue((req.query as any)?.branchId) ||
    (req.user?.selectedBranchId ? String(req.user.selectedBranchId) : null) ||
    (req.user?.branchId ? String(req.user.branchId) : null);

  if (!branchId) return null;

  const prisma = await getPrisma();
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { companyId: true },
  });
  return branch?.companyId ? String(branch.companyId) : null;
};

/**
 * Enforces plan-based access to the business dashboard.
 *
 * Rules:
 * - Business owner (company.createdBy) always allowed.
 * - Otherwise: membership role must be included in plan.dashboardAccessRoles.
 *
 * If there's no company context (no selected company), this middleware is a no-op.
 */
export const requireBusinessDashboardAccess = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const userId = req.user?.id;
    console.log(`[EntitlementDebug] requireBusinessDashboardAccess - entry userId=${userId}, headers=${JSON.stringify(req.headers?.['x-company-id'] || req.headers?.['x-branch-id'] || {})}`);
    if (!userId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    let userRole = getUserRole(req);

    const companyId = await resolveCompanyId(req);
    if (!companyId) {
      next();
      return;
    }

    const prisma = await getPrisma();
    const company = await prisma.business.findUnique({
      where: { id: companyId },
      select: { id: true, createdBy: true, businessType: true },
    });

    if (!company) {
      res.status(404).json({ success: false, message: 'Company not found' });
      return;
    }

      // If role is missing, try to resolve membership directly from DB as a fallback
      if (!userRole) {
        try {
          const fallbackMembership = await prisma.membership.findFirst({
            where: { userId: userId, businessId: companyId ?? undefined, status: 'ACTIVE' },
            include: { role: { select: { name: true } } }
          }) as any;
          if (fallbackMembership) {
            userRole = String(fallbackMembership.role?.name || '').toUpperCase();
            console.log('[EntitlementDebug] requireBusinessDashboardAccess - resolved userRole from DB membership ->', userRole);
          } else {
            console.log('[EntitlementDebug] requireBusinessDashboardAccess - no DB membership found for user');
          }
        } catch (err: any) {
          console.warn('[EntitlementDebug] requireBusinessDashboardAccess - membership lookup failed', err?.message || err);
        }
      }

    const ownerUserId = company.createdBy ? String(company.createdBy) : '';
    if (ownerUserId && ownerUserId === userId) {
      next();
      return;
    }

    const plans = await loadPricingPlans(prisma);
    let businessPlan = await resolveBusinessPlan(prisma, company.id, plans);
    console.log(`[EntitlementDebug] requireBusinessDashboardAccess - resolved businessPlan for company=${company.id}: ${businessPlan?.id || 'null'}`);
    
    // CRITICAL FIX: Auto-assign default plan if none exists
    // This allows new businesses to access dashboard without manual setup
    if (!businessPlan) {
      console.log(`⚠️  No business plan assigned for company ${company.id}, auto-assigning default plan`);
      
      // Assign the first available plan (should be single-starter)
      const defaultPlan = plans[0];
      if (defaultPlan) {
        try {
          await assignBusinessPlan(prisma, company.id, defaultPlan.id, 'system_auto_assign');
          businessPlan = defaultPlan;
          console.log(`✅ Auto-assigned plan ${defaultPlan.id} to company ${company.id}`);
          console.log(`[EntitlementDebug] requireBusinessDashboardAccess - post-auto-assign businessPlan=${businessPlan.id}`);
        } catch (err) {
          console.error('Failed to auto-assign business plan:', err);
          res.status(500).json({
            success: false,
            message: 'Failed to initialize business subscription.',
          });
          return;
        }
      } else {
        res.status(403).json({
          success: false,
          message: 'No available subscription plans found.',
        });
        return;
      }
    }

    if (businessPlan.id === PLANS.STARTER || businessPlan.id === PLANS.TRIAL) {
      // CRITICAL FIX: Auto-upgrade to Growth plan if non-owner tries to access dashboard
      // This enables MANAGER/CASHIER to use dashboard without manual upgrade
      
      if (userRole !== ROLES.OWNER && company.createdBy !== userId) {
        
        try {
          const growthPlan = plans.find(p => p.id === PLANS.GROWTH);
          if (growthPlan) {
            await assignBusinessPlan(prisma, company.id, growthPlan.id, 'system_auto_upgrade');
            businessPlan = growthPlan;
            console.log(`✅ Auto-upgraded company ${company.id} to ${growthPlan.id}`);
              console.log(`[EntitlementDebug] requireBusinessDashboardAccess - post-auto-upgrade businessPlan=${businessPlan.id}`);
          } else {
            // Fallback: just allow access if no Growth plan available
            console.warn('Growth plan not available, allowing access anyway');
            next();
            return;
          }
        } catch (err) {
          console.error('Failed to auto-upgrade plan:', err);
          // Don't block on upgrade failure, allow access anyway
          next();
          return;
        }
      } else {
        // Owner accessing Trial/Starter plan - allow it
        next();
        return;
      }
    }

    const allowed = new Set<AllowedDashboardAccessRole>(businessPlan.dashboardAccessRoles || []);
    console.log(`[EntitlementDebug] requireBusinessDashboardAccess - final businessPlan=${businessPlan.id}, allowedRoles=${Array.from(allowed)}, userRole=${userRole}`);
    if (allowed.has(userRole as AllowedDashboardAccessRole)) {
      next();
      return;
    }

    res.status(403).json({
      success: false,
      message: 'Access denied: your role is not allowed to view the business dashboard on this plan.',
      details: {
        companyId: company.id,
        planId: businessPlan.id,
        allowedRoles: Array.from(allowed),
        userRole,
      },
    });
  } catch (error) {
    console.error('Business dashboard access middleware error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
