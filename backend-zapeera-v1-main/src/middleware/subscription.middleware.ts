import { Request, Response, NextFunction } from 'express';
import { getPrisma } from '../utils/db.util';
import { validateBranchCreationAllowanceV2, validateMembershipInviteAllowanceV2 } from '../utils/subscription-v2-limits.util';
import { AuthRequest } from './auth.middleware';

export const checkSubscription = () => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const prisma = await getPrisma();
    const businessId = req.business_id || (req.params && (req.params.businessId || req.params.id));
    if (!businessId) return next();

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

export default {};
