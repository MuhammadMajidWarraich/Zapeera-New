import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { adminAuthenticate, adminRoleGuard, logAdminAction, AdminAuthRequest } from '../middleware/admin-auth.middleware';
import {
  assignBusinessPlan,
  syncBusinessModulesWithSubscription,
} from '../utils/subscription-entitlements.util';

/**
 * Get billing/subscription summary stats for the backoffice dashboard
 */
export const getBillingSummary = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const now = new Date();

    const allSubs = await prisma.businessSubscription.findMany({
      include: {
        plan: { select: { price: true, name: true } }
      }
    });

    const activeCount   = allSubs.filter(s => s.status === 'ACTIVE').length;
    const trialCount    = allSubs.filter(s => s.status === 'TRIAL').length;
    const graceCount    = allSubs.filter(s => s.status === 'GRACE').length;
    const suspendedCount = allSubs.filter(s => s.status === 'SUSPENDED').length;
    const expiredCount  = allSubs.filter(s => s.status === 'EXPIRED' || s.status === 'CANCELLED').length;

    const mrr = allSubs
      .filter(s => s.status === 'ACTIVE')
      .reduce((sum, s) => sum + ((s.plan as any)?.price || 0), 0);

    const businessCount = await prisma.business.count();

    return res.json({
      success: true,
      data: {
        totalSubscriptions: allSubs.length,
        activeCount,
        trialCount,
        graceCount,
        suspendedCount,
        expiredCount,
        monthlyRevenue: mrr,
        totalBusinesses: businessCount,
      }
    });
  } catch (error: any) {
    console.error('Get billing summary error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Get all subscriptions with business details
 */
export const getAllSubscriptions = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { status, isTrial } = req.query;
    
    const where: any = {};
    if (status) where.status = status;
    if (isTrial !== undefined) where.isTrial = isTrial === 'true';
    
    const subscriptions = await prisma.businessSubscription.findMany({
      where,
      include: {
        business: {
          select: {
            id: true,
            name: true,
            email: true,
            businessType: true,
            createdAt: true
          }
        },
        plan: {
          select: {
            id: true,
            name: true,
            price: true,
            isTrial: true,
            durationDays: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    return res.json({
      success: true,
      data: subscriptions
    });
  } catch (error: any) {
    console.error('Get all subscriptions error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Get subscription by business ID
 */
export const getSubscriptionByBusinessId = async (req: Request, res: Response) => {
  try {
    const { businessId } = req.params;
    const prisma = await getPrisma();
    
    const subscription = await prisma.businessSubscription.findUnique({
      where: { businessId },
      include: {
        business: {
          select: {
            id: true,
            name: true,
            email: true,
            businessType: true
          }
        },
        plan: {
          select: {
            id: true,
            name: true,
            price: true,
            isTrial: true,
            durationDays: true
          }
        }
      }
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found for this business'
      });
    }

    return res.json({
      success: true,
      data: subscription
    });
  } catch (error: any) {
    console.error('Get subscription error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Assign plan to business (create or update subscription)
 */
export const assignPlanToBusiness = async (req: AdminAuthRequest, res: Response) => {
  try {
    const { businessId, planId, isTrial, trialDays } = req.body;

    if (!businessId || !planId) {
      return res.status(400).json({
        success: false,
        message: 'Business ID and Plan ID are required'
      });
    }

    const prisma = await getPrisma();

    // Verify business exists
    const business = await prisma.business.findUnique({
      where: { id: businessId }
    });

    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    // Verify plan exists
    const plan = await prisma.plan.findUnique({
      where: { id: planId }
    });

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }

    // Calculate end date
    const startDate = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + plan.durationDays);

    // Check if subscription exists
    const existingSubscription = await prisma.businessSubscription.findUnique({
      where: { businessId }
    });

    let subscription;
    if (existingSubscription) {
      // Update existing subscription
      subscription = await prisma.businessSubscription.update({
        where: { businessId },
        data: {
          planId,
          status: isTrial ? 'TRIAL' : 'ACTIVE',
          currentPeriodEnd: endDate
        }
      });
    } else {
      // Create new subscription
      subscription = await prisma.businessSubscription.create({
        data: {
          businessId,
          planId,
          status: isTrial ? 'TRIAL' : 'ACTIVE',
          currentPeriodEnd: endDate
        }
      });
    }

    // Keep business-level subscription state, settings and modules in sync
    try {
      await assignBusinessPlan(prisma, businessId, plan.id, req.admin!.id);
    } catch (syncErr) {
      console.error('Failed to sync business plan after assign:', syncErr);
      // don't fail the request; log and continue
    }

    // Log admin action
    await logAdminAction(
      req.admin!.id,
      'ASSIGN_PLAN',
      'Subscription',
      subscription.id,
      {
        businessId,
        businessName: business.name,
        planId,
        planName: plan.name,
        isTrial
      }
    );

    return res.json({
      success: true,
      message: 'Plan assigned successfully',
      data: subscription
    });
  } catch (error: any) {
    console.error('Assign plan error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Update subscription status
 */
export const updateSubscriptionStatus = async (req: AdminAuthRequest, res: Response) => {
  try {
    const { subscriptionId } = req.params;
    const { status, endDate } = req.body;

    if (!status || !['ACTIVE', 'TRIAL', 'GRACE', 'SUSPENDED', 'EXPIRED', 'CANCELLED'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Valid status is required (ACTIVE, TRIAL, GRACE, SUSPENDED, EXPIRED, CANCELLED)'
      });
    }

    const prisma = await getPrisma();

    const subscription = await prisma.businessSubscription.update({
      where: { id: subscriptionId },
      data: {
        status,
        ...(endDate && { endDate: new Date(endDate) })
      },
      include: {
        business: {
          select: {
            id: true,
            name: true,
            createdBy: true,
            businessType: true,
          }
        }
      }
    });

    // Sync business modules to reflect new subscription status
    try {
      if (subscription.business?.id && subscription.business?.createdBy) {
        await syncBusinessModulesWithSubscription(prisma, {
          companyId: subscription.business.id,
          ownerUserId: String(subscription.business.createdBy),
          businessType: String((subscription.business as any).businessType || 'PHARMACY').toUpperCase() as any,
        });
      }
    } catch (syncErr) {
      console.error('Failed to sync modules after status update:', syncErr);
      // Do not block the response on sync failure
    }

    // Log admin action
    await logAdminAction(
      req.admin!.id,
      'UPDATE_SUBSCRIPTION_STATUS',
      'Subscription',
      subscriptionId,
      {
        status,
        businessId: subscription.business.id,
        businessName: subscription.business.name
      }
    );

    return res.json({
      success: true,
      message: 'Subscription status updated successfully',
      data: subscription
    });
  } catch (error: any) {
    console.error('Update subscription status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Cancel subscription
 */
export const cancelSubscription = async (req: AdminAuthRequest, res: Response) => {
  try {
    const { subscriptionId } = req.params;
    const prisma = await getPrisma();

    const subscription = await prisma.businessSubscription.update({
      where: { id: subscriptionId },
      data: { status: 'CANCELLED' },
      include: {
        business: {
          select: {
            id: true,
            name: true,
            createdBy: true,
            businessType: true,
          }
        }
      }
    });

    // Ensure modules and business-level subscription state are synced after cancellation
    try {
      if (subscription.business?.id && subscription.business?.createdBy) {
        await syncBusinessModulesWithSubscription(prisma, {
          companyId: subscription.business.id,
          ownerUserId: String(subscription.business.createdBy),
          businessType: String((subscription.business as any).businessType || 'PHARMACY').toUpperCase() as any,
        });
      }
    } catch (syncErr) {
      console.error('Failed to sync modules after cancellation:', syncErr);
    }

    // Log admin action
    await logAdminAction(
      req.admin!.id,
      'CANCEL_SUBSCRIPTION',
      'Subscription',
      subscriptionId,
      {
        businessId: subscription.business.id,
        businessName: subscription.business.name
      }
    );

    return res.json({
      success: true,
      message: 'Subscription cancelled successfully',
      data: subscription
    });
  } catch (error: any) {
    console.error('Cancel subscription error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Extend trial
 */
export const extendTrial = async (req: AdminAuthRequest, res: Response) => {
  try {
    const { subscriptionId } = req.params;
    const { additionalDays } = req.body;

    if (!additionalDays || additionalDays <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Valid additionalDays is required'
      });
    }

    const prisma = await getPrisma();

    const subscription = await prisma.businessSubscription.findUnique({
      where: { id: subscriptionId },
      include: {
        business: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    if (!subscription) {
      return res.status(404).json({
        success: false,
        message: 'Subscription not found'
      });
    }

    // Calculate new end date
    const currentTrialEnd = (subscription as any).trialEndsAt
      ? new Date((subscription as any).trialEndsAt)
      : subscription.currentPeriodEnd
        ? new Date(subscription.currentPeriodEnd)
        : new Date();
    const newTrialEnd = new Date(currentTrialEnd);
    newTrialEnd.setDate(newTrialEnd.getDate() + parseInt(additionalDays));

    const updatedSubscription = await prisma.businessSubscription.update({
      where: { id: subscriptionId },
      data: {
        trialEndsAt: newTrialEnd,
        currentPeriodEnd: newTrialEnd,
        status: 'TRIAL'
      },
      include: {
        business: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    // Sync modules after extending trial
    try {
      if (updatedSubscription?.business?.id) {
        await syncBusinessModulesWithSubscription(prisma, {
          companyId: updatedSubscription.business.id,
          ownerUserId: String((updatedSubscription.business as any).createdBy || ''),
          businessType: String((updatedSubscription.business as any).businessType || 'PHARMACY').toUpperCase() as any,
        });
      }
    } catch (syncErr) {
      console.error('Failed to sync modules after extending trial:', syncErr);
    }

    // Log admin action
    await logAdminAction(
      req.admin!.id,
      'EXTEND_TRIAL',
      'Subscription',
      subscriptionId,
      {
        additionalDays,
        businessId: subscription.business.id,
        businessName: subscription.business.name,
        newEndDate: newTrialEnd.toISOString()
      }
    );

    return res.json({
      success: true,
      message: 'Trial extended successfully',
      data: updatedSubscription
    });
  } catch (error: any) {
    console.error('Extend trial error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};
