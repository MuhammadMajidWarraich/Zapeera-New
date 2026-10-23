import { Request, Response, NextFunction } from 'express';
import { getPrisma } from '../utils/db.util';
import { validateBranchCreationAllowanceV2, validateMembershipInviteAllowanceV2 } from '../utils/subscription-v2-limits.util';
import {
  getEffectiveLimits,
  countStaffSeats,
  ADDON_CATALOGUE,
  EffectiveLimits,
} from '../services/addon-limits.service';
import { AuthRequest } from './auth.middleware';

export const checkSubscription = () => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const prisma = await getPrisma();
    const businessId = req.business_id || (req.params && (req.params.businessId || req.params.id));
    // QA A-17: fail CLOSED when the business context cannot be resolved.
    // This middleware is only mounted on tenant routes that always require a
    // business (branch create, company members, invitation send) — public /
    // context-free routes (auth, health, registry-classified public paths)
    // never pass through here, so denying cannot break them. The response
    // shape mirrors the universal module-protection NO_BUSINESS_CONTEXT denial.
    if (!businessId) {
      return res.status(400).json({
        success: false,
        error: 'NO_BUSINESS_CONTEXT',
        message: 'Business context required (X-Business-ID header)',
      });
    }

    try {
      let sub: any = null;
      try {
        sub = await prisma.businessSubscription.findUnique({
          where: { businessId: String(businessId) },
          select: {
            id: true,
            businessId: true,
            planId: true,
            status: true,
            trialEndsAt: true,
            currentPeriodEnd: true,
          },
        });
      } catch {
        sub = null;
      }

      // No subscription record — allow (new business might still be setting up)
      if (!sub) return next();

      const status = String(sub.status || '').toUpperCase();

      // SUSPENDED: hard block
      if (status === 'SUSPENDED') {
        return res.status(403).json({
          success: false,
          message: 'Your business subscription has been suspended. Please contact support or upgrade your plan.',
          subscriptionStatus: 'SUSPENDED'
        });
      }

      // EXPIRED / CANCELLED: block
      if (status === 'EXPIRED' || status === 'CANCELLED') {
        return res.status(402).json({
          success: false,
          message: 'Your subscription has expired. Please renew your plan to continue.',
          subscriptionStatus: status
        });
      }

      // GRACE: allow but signal the UI
      if (status === 'GRACE') {
        res.setHeader('X-Subscription-Status', 'GRACE');
        res.setHeader('X-Subscription-Grace-Ends', sub.currentPeriodEnd ? String(sub.currentPeriodEnd) : '');
        (req as any).businessSubscription = sub;
        return next();
      }

      // TRIAL / ACTIVE: check if dates are actually expired
      if (status === 'TRIAL' || status === 'ACTIVE') {
        const now = new Date();
        const trialExpired = sub.trialEndsAt && new Date(sub.trialEndsAt).getTime() < now.getTime();
        const periodExpired = sub.currentPeriodEnd && new Date(sub.currentPeriodEnd).getTime() < now.getTime();
        if (trialExpired || periodExpired) {
          return res.status(402).json({
            success: false,
            message: 'Your subscription has expired. Please renew your plan to continue.',
            subscriptionStatus: 'EXPIRED'
          });
        }
      }

      // TRIAL / ACTIVE: allow normally
      (req as any).businessSubscription = sub;
      return next();
    } catch (error: any) {
      // If table is missing (old schema), fall through gracefully
      const msg = String(error?.message || '').toLowerCase();
      if (msg.includes('no such table') || msg.includes('does not exist')) return next();
      return next(error);
    }
  };
};

export const enforceBranchLimit = () => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const prisma = await getPrisma();
      const businessId = req.params.id || req.body.companyId || req.body.businessId || req.query.businessId || req.business_id;
      const ownerUserId = String(req.user?.id || '');
      if (!businessId || !ownerUserId) return next();

      const result = await validateBranchCreationAllowanceV2(prisma as any, { businessId: String(businessId), ownerUserId });
      if (!result.allowed) {
        return res.status(result.statusCode || 403).json({ success: false, message: result.message, ...result.details });
      }
      return next();
    } catch (error: any) {
      return next(error);
    }
  };
};

export const enforceMembershipInviteLimit = () => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const prisma = await getPrisma();
      const businessId = req.params.businessId || req.params.id || req.body.businessId || req.body.companyId || req.business_id;
      const ownerUserId = String(req.user?.id || '');
      if (!businessId || !ownerUserId) return next();

      const result = await validateMembershipInviteAllowanceV2(prisma as any, { businessId: String(businessId), ownerUserId });
      if (!result.allowed) {
        return res.status(result.statusCode || 403).json({ success: false, message: result.message, ...result.details });
      }
      return next();
    } catch (error: any) {
      return next(error);
    }
  };
};

// ─── Add-on / plan-capability gates (2026-10-24) ─────────────────────
// All of these resolve the business's EffectiveLimits through the ONE
// function in services/addon-limits.service and refuse with a stable
// machine-readable code + the add-on that would unlock the capability,
// so the frontend can offer the add-on instead of a dead end.

const addonBusinessId = (req: AuthRequest): string | null => {
  const id =
    (req as any).business_id ||
    req.body?.businessId ||
    req.body?.companyId ||
    (req.query?.businessId as string) ||
    (req.query?.companyId as string) ||
    req.params?.businessId ||
    req.params?.id;
  return id ? String(id) : null;
};

const denyCapability = (
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  limits: EffectiveLimits,
  addon: keyof typeof ADDON_CATALOGUE
) => {
  return res.status(statusCode).json({
    success: false,
    code,
    error: code,
    message,
    planId: limits.planId,
    planName: limits.planName,
    addon,
    addonName: ADDON_CATALOGUE[addon].name,
    addonPriceMonthly: ADDON_CATALOGUE[addon].priceMonthly,
  });
};

/**
 * HR surfaces (staff / attendance / shifts / commissions route groups):
 * the whole surface requires staff access — Trial/Starter are
 * owner-only plans, so even the owner is refused here until the HR
 * Pack (or a Growth+ plan) provides staff access.
 */
export const requireStaffAllowed = () => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const businessId = addonBusinessId(req);
      if (!businessId) return next();
      const prisma = await getPrisma();
      const limits = await getEffectiveLimits(prisma as any, businessId);
      if (!limits.staffAllowed) {
        return denyCapability(
          res,
          403,
          'PLAN_STAFF_NOT_INCLUDED',
          `Staff & HR are not included in the ${limits.planName} plan. Add the HR Pack or upgrade to Growth.`,
          limits,
          'HR_PACK'
        );
      }
      (req as any).effectiveLimits = limits;
      return next();
    } catch (error: any) {
      return next(error);
    }
  };
};

/**
 * Staff creation (POST /staff): requires staff access AND a free staff
 * seat when the creation would consume a new one (a brand-new ACTIVE
 * membership). Re-profiling an existing member consumes nothing.
 */
export const enforceStaffCreation = () => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const businessId = addonBusinessId(req);
      if (!businessId) return next();
      const prisma = await getPrisma();
      const limits = await getEffectiveLimits(prisma as any, businessId);
      if (!limits.staffAllowed) {
        return denyCapability(
          res,
          403,
          'PLAN_STAFF_NOT_INCLUDED',
          `Staff accounts are not included in the ${limits.planName} plan. Add the HR Pack or upgrade to Growth to add staff.`,
          limits,
          'HR_PACK'
        );
      }
      const roleStr = String(req.body?.role || 'STAFF').toUpperCase();
      if (roleStr !== 'OWNER' && roleStr !== 'ADMIN') {
        let targetUserId: string | null = req.body?.userId ? String(req.body.userId) : null;
        if (!targetUserId && req.body?.email) {
          const u = await (prisma as any).zapeeraUser.findFirst({
            where: { email: String(req.body.email) },
            select: { id: true },
          });
          targetUserId = u?.id ? String(u.id) : null;
        }
        let consumesSeat = true;
        if (targetUserId) {
          const existing = await (prisma as any).membership.findFirst({
            where: { userId: targetUserId, businessId, status: 'ACTIVE' },
            select: { id: true },
          });
          if (existing) consumesSeat = false;
        }
        if (consumesSeat) {
          const used = await countStaffSeats(prisma as any, businessId);
          if (used >= limits.maxStaffSeats) {
            return res.status(403).json({
              success: false,
              code: 'SEAT_LIMIT_REACHED',
              error: 'SEAT_LIMIT_REACHED',
              message: `Staff seat limit reached (${limits.maxStaffSeats}) on the ${limits.planName} plan. Add an Extra Staff Seat or upgrade your plan.`,
              planId: limits.planId,
              planName: limits.planName,
              maxStaffSeats: limits.maxStaffSeats,
              usedStaffSeats: used,
              addon: 'EXTRA_SEAT',
              addonName: ADDON_CATALOGUE.EXTRA_SEAT.name,
              addonPriceMonthly: ADDON_CATALOGUE.EXTRA_SEAT.priceMonthly,
            });
          }
        }
      }
      (req as any).effectiveLimits = limits;
      return next();
    } catch (error: any) {
      return next(error);
    }
  };
};

/** Finance toolkit surfaces (expenses, accounting-lite reports). */
export const requireFinanceAllowed = () => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const businessId = addonBusinessId(req);
      if (!businessId) return next();
      const prisma = await getPrisma();
      const limits = await getEffectiveLimits(prisma as any, businessId);
      if (!limits.financeAllowed) {
        return denyCapability(
          res,
          403,
          'PLAN_FINANCE_NOT_INCLUDED',
          `The finance toolkit is not included in the ${limits.planName} plan. Add the Finance Pack or upgrade to Growth.`,
          limits,
          'FINANCE_PACK'
        );
      }
      (req as any).effectiveLimits = limits;
      return next();
    } catch (error: any) {
      return next(error);
    }
  };
};

/** Advanced reports (deep/analytics set incl. real-profit). */
export const requireAdvancedReports = () => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const businessId = addonBusinessId(req);
      if (!businessId) return next();
      const prisma = await getPrisma();
      const limits = await getEffectiveLimits(prisma as any, businessId);
      if (!limits.advancedReportsAllowed) {
        return denyCapability(
          res,
          403,
          'PLAN_REPORTS_NOT_INCLUDED',
          `Advanced reports are not included in the ${limits.planName} plan. Add the Advanced Reports Pack or upgrade to Growth.`,
          limits,
          'REPORTS_PACK'
        );
      }
      (req as any).effectiveLimits = limits;
      return next();
    } catch (error: any) {
      return next(error);
    }
  };
};

/** Multi-branch consolidated reporting (Scale-inherent; Growth via Reports Pack). */
export const requireMultiBranchReports = () => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const businessId = addonBusinessId(req);
      if (!businessId) return next();
      const prisma = await getPrisma();
      const limits = await getEffectiveLimits(prisma as any, businessId);
      if (!limits.multiBranchReportsAllowed) {
        return denyCapability(
          res,
          403,
          'PLAN_REPORTS_NOT_INCLUDED',
          `Multi-branch reporting is not included in the ${limits.planName} plan. Add the Advanced Reports Pack or upgrade to Scale.`,
          limits,
          'REPORTS_PACK'
        );
      }
      (req as any).effectiveLimits = limits;
      return next();
    } catch (error: any) {
      return next(error);
    }
  };
};

export default {};
