import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { syncAfterOperation, pullLatestFromLive } from '../utils/sync-helper';
import Joi from 'joi';
import { AuthRequest } from '../middleware/auth.middleware';
import {
  assignBusinessAddOns,
  assignBusinessPlan,
  getBusinessEntitlementsSummary,
  loadPricingPlans,
  normalizeBusinessType,
  normalizePricingPlans,
  normalizeAddOnQuantities,
  SubscriptionAddOnCode,
  SupportedBusinessType
} from '../utils/subscription-entitlements.util';
import { reconcileLatestApprovedPaymentProofSubscription } from '../utils/manual-payment-subscription.util';
import { invalidateModuleCache } from '../utils/modules-v2.util';
import { invalidateEntitlementsCache } from '../middleware/multitenancy.middleware';
import { clearModuleAccessCache } from '../middleware/universal-module-protection.middleware';
import crypto from 'crypto';
import { createNotification } from './notification.controller';

const PRICING_PLANS_SETTINGS_OWNER = 'global_pricing';
const PRICING_PLANS_SETTINGS_KEY = 'plans';
const ANNUAL_DISCOUNT_SETTINGS_OWNER = 'global_pricing';
const ANNUAL_DISCOUNT_SETTINGS_KEY = 'annual_discount_percent';

const isPlatformAdmin = (req: Request): boolean => {
  const role = String((req as any).adminRole || (req as any).user?.role || '').toUpperCase();
  return role === 'ADMIN' || role === 'SUPER_ADMIN';
};

const allowDirectSubscriptionMutation = (): boolean =>
  process.env.NODE_ENV !== 'production' && process.env.ALLOW_DIRECT_SUBSCRIPTION_MUTATIONS === 'true';

const invalidateBusinessAccess = (businessId: string): void => {
  invalidateModuleCache({ type: 'PLAN_CHANGED', businessId });
  invalidateEntitlementsCache(businessId);
  clearModuleAccessCache(undefined, businessId);
};

const requireBusinessOwner = async (prisma: any, userId: string, businessId: string): Promise<boolean> => {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { createdBy: true },
  });
  if (!business) return false;
  if (String(business.createdBy || '') === String(userId)) return true;

  const membership = await prisma.membership.findFirst({
    where: { userId, businessId, status: 'ACTIVE' },
    include: { role: { select: { name: true } } },
  });
  return String(membership?.role?.name || '').toUpperCase() === 'OWNER';
};

const annualDiscountSchema = Joi.object({
  percent: Joi.number().min(0).max(100).required(),
});

const updatePricingPlansSchema = Joi.object({
  plans: Joi.array()
    .items(
      Joi.object({
        id: Joi.string().required(),
        segment: Joi.string().valid('single', 'multi').required(),
        name: Joi.string().required(),
        subtitle: Joi.string().allow('', null).optional(),
        price: Joi.number().min(0).required(),
        priceUnit: Joi.string().required(),
        badge: Joi.string().allow('', null).optional(),
        ctaLabel: Joi.string().required(),
        features: Joi.array().items(Joi.string()).required(),
        dashboardAccessRoles: Joi.array()
          .items(Joi.string().valid('OWNER', 'USER', 'MANAGER', 'CASHIER', 'ADMIN'))
          .optional(),
        businessTypes: Joi.array()
          .items(Joi.string().valid('PHARMACY', 'STORE', 'HOTEL', 'CLINIC'))
          .optional(),
        limits: Joi.object({
          maxBranches: Joi.number().integer().min(0).allow(null).optional(),
          maxCountersPerBranch: Joi.number().integer().min(0).allow(null).optional(),
          maxConcurrentUsers: Joi.number().integer().min(0).allow(null).optional(),
          maxConcurrentSessions: Joi.number().integer().min(0).allow(null).optional(),
        }).optional(),
        pricingModel: Joi.object({
          includedBranchesPerBusiness: Joi.number().integer().min(0).allow(null).optional(),
          includedCountersPerBranch: Joi.number().integer().min(0).allow(null).optional(),
          extraBranchPrice: Joi.number().integer().min(0).allow(null).optional(),
          extraCounterPrice: Joi.number().integer().min(0).allow(null).optional(),
        }).optional(),
      })
    )
    .required()
});

const assignBusinessPlanSchema = Joi.object({
  planId: Joi.string().required(),
  addOns: Joi.object().pattern(
    Joi.string().valid(
      'extra_branch',
      'extra_user',
      'feature_pos',
      'feature_analytics',
      'feature_ai_tools',
      'type_pharmacy',
      'type_store',
      'type_hotel',
      'type_clinic'
    ),
    Joi.number().integer().min(0)
  ).optional(),
});

// Validation schemas
const updateSubscriptionSchema = Joi.object({
  subscriptionId: Joi.string().optional(),  // If provided, update this specific subscription
  plan: Joi.string().required(),
  amount: Joi.number().min(0).optional(),  // If not provided, calculate based on plan
  autoRenew: Joi.boolean().optional(),
  status: Joi.string().valid('ACTIVE', 'EXPIRED', 'CANCELLED').optional(), // Subscription Status
  billingStatus: Joi.string().valid('PAID', 'PENDING').optional() // Billing Status
});

const addPaymentMethodSchema = Joi.object({
  type: Joi.string().valid('card', 'bank', 'mobile').required(),
  last4: Joi.string().length(4).required(),
  brand: Joi.string().required(),
  expiryMonth: Joi.number().min(1).max(12).required(),
  expiryYear: Joi.number().min(new Date().getFullYear()).required(),
  holderName: Joi.string().required(),
  isDefault: Joi.boolean().default(false)
});

// Get subscription details
export const getSubscription = async (req: Request, res: Response): Promise<void> => {
  const prisma = await getPrisma();
  try {
    const userId = (req as any).user?.id;
    const selectedCompanyId = (req as any).user?.selectedCompanyId || (req as any).business_id;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized',
      });
      return;
    }

    if (!selectedCompanyId) {
      res.status(400).json({
        success: false,
        message: 'No business selected. X-Business-ID header is required.',
      });
      return;
    }

    const company = await prisma.business.findUnique({
      where: { id: String(selectedCompanyId) },
      select: {
        id: true,
        createdBy: true,
        businessType: true,
      },
    });

    if (!company) {
      res.status(404).json({
        success: false,
        message: 'Company not found',
      });
      return;
    }

    const businessType =
      (normalizeBusinessType(company.businessType) || 'PHARMACY') as SupportedBusinessType;

    try {
      await reconcileLatestApprovedPaymentProofSubscription(prisma, company.id);
    } catch (reconcileError) {
      console.warn('[Subscription] Approved payment proof reconciliation failed:', reconcileError);
    }

    const entitlements = await getBusinessEntitlementsSummary(prisma, {
      companyId: company.id,
      ownerUserId: String(company.createdBy || userId),
      businessType,
    });

    if (!entitlements) {
      res.status(404).json({
        success: false,
        message: 'No subscription found for business',
      });
      return;
    }

    const now = new Date();
    const end = entitlements.currentPeriodEnd ? new Date(entitlements.currentPeriodEnd) : null;
    const remainingDays = end
      ? Math.max(0, Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    res.json({
      success: true,
      data: {
        businessId: company.id,
        planId: entitlements.planId,
        planName: entitlements.plan?.name || entitlements.planId,
        status: (entitlements.subscriptionStatus || (entitlements.isSubscribed ? 'ACTIVE' : 'INACTIVE')).toLowerCase(),
        trialEndsAt: entitlements.trialEndsAt,
        currentPeriodEnd: entitlements.currentPeriodEnd,
        remainingDays,
        isSubscribed: entitlements.isSubscribed,
      },
    });
  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getAnnualDiscount = async (req: Request, res: Response): Promise<void> => {
  const prisma = await getPrisma();
  try {
    const setting = await prisma.settings.findUnique({
      where: {
        createdBy_key: {
          createdBy: ANNUAL_DISCOUNT_SETTINGS_OWNER,
          key: ANNUAL_DISCOUNT_SETTINGS_KEY,
        },
      },
    });

    const parsed = setting?.value ? Number(setting.value) : NaN;
    const percent = Number.isFinite(parsed) ? Math.max(0, Math.min(100, Math.floor(parsed))) : 20;

    res.json({
      success: true,
      data: { percent },
    });
  } catch (error) {
    console.error('Get annual discount error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const updateAnnualDiscount = async (req: Request, res: Response): Promise<void> => {
  const prisma = await getPrisma();
  try {
    if (!isPlatformAdmin(req)) {
      res.status(403).json({
        success: false,
        message: 'Only platform admin can update annual discount',
      });
      return;
    }

    const { error } = annualDiscountSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map((detail) => detail.message),
      });
      return;
    }

    const percent = Math.max(0, Math.min(100, Math.floor(Number(req.body.percent))));

    await prisma.settings.upsert({
      where: {
        createdBy_key: {
          createdBy: ANNUAL_DISCOUNT_SETTINGS_OWNER,
          key: ANNUAL_DISCOUNT_SETTINGS_KEY,
        },
      },
      update: {
        value: String(percent),
        updatedAt: new Date(),
      },
      create: {
        createdBy: ANNUAL_DISCOUNT_SETTINGS_OWNER,
        key: ANNUAL_DISCOUNT_SETTINGS_KEY,
        value: String(percent),
        description: 'Annual billing discount percentage applied to pricing plans',
      },
    });

    res.json({
      success: true,
      message: 'Annual discount updated successfully',
      data: { percent },
    });
  } catch (error) {
    console.error('Update annual discount error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update subscription
export const updateSubscription = async (req: Request, res: Response): Promise<void> => {
  const prisma = await getPrisma();
  try {
    if (!allowDirectSubscriptionMutation()) {
      res.status(403).json({
        success: false,
        message: 'Direct subscription activation is disabled. Submit a payment proof for approval instead.',
      });
      return;
    }
    const { error } = updateSubscriptionSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
      return;
    }

    const userId = (req as any).user?.id;
    const selectedCompanyId = (req as any).user?.selectedCompanyId || (req as any).business_id;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'User not authenticated'
      });
      return;
    }

    if (!selectedCompanyId) {
      res.status(400).json({
        success: false,
        message: 'No business selected. X-Business-ID header is required.',
      });
      return;
    }

    if (!(await requireBusinessOwner(prisma, String(userId), String(selectedCompanyId)))) {
      res.status(403).json({ success: false, message: 'Only the business owner can change a subscription.' });
      return;
    }

    const { plan, status, billingStatus } = req.body;

    const company = await prisma.business.findUnique({
      where: { id: String(selectedCompanyId) },
      select: { id: true, createdBy: true, businessType: true },
    });

    if (!company) {
      res.status(404).json({
        success: false,
        message: 'Company not found',
      });
      return;
    }

    const plans = await loadPricingPlans(prisma);
    const normalizedPlan = String(plan || '').toLowerCase().trim();
    const targetPlan = plans.find((p) => {
      const pid = p.id.toLowerCase();
      const pname = p.name.toLowerCase();
      return (
        pid === normalizedPlan ||
        pname === normalizedPlan ||
        pid.includes(normalizedPlan) ||
        pname.includes(normalizedPlan)
      );
    });

    if (!targetPlan) {
      res.status(400).json({
        success: false,
        message: 'Selected plan does not exist',
      });
      return;
    }

    const companyBusinessType =
      (normalizeBusinessType(company.businessType) || 'PHARMACY') as SupportedBusinessType;
    if (!targetPlan.businessTypes.includes(companyBusinessType)) {
      res.status(400).json({
        success: false,
        message: `The selected plan is not available for business type ${companyBusinessType}`,
      });
      return;
    }

    await assignBusinessPlan(prisma, company.id, targetPlan.id, userId);
    invalidateBusinessAccess(company.id);

    if (typeof status === 'string' && status.trim()) {
      try {
        await prisma.businessSubscription.update({
          where: { businessId: company.id },
          data: { status: status.trim().toUpperCase() },
        });
      } catch {
        // ignore
      }
    }

    if (typeof billingStatus === 'string' && billingStatus.trim()) {
      try {
        await prisma.businessSubscription.update({
          where: { businessId: company.id },
          data: { billingStatus: billingStatus.trim().toUpperCase() },
        });
      } catch {
        // ignore
      }
    }

    // Sync the change to PostgreSQL if online
    try {
      await syncAfterOperation('subscription', 'update', { businessId: company.id, planId: targetPlan.id });
    } catch (syncErr) {
      console.warn('Could not sync subscription update:', syncErr);
    }

    createNotification({
      userId: userId || '',
      businessId: selectedCompanyId || '',
      type: 'subscription_updated',
      title: 'Subscription Updated',
      body: `Your subscription plan has been updated successfully.`,
      actionUrl: `/business/${selectedCompanyId}/subscription`,
    }).catch(() => {});

    res.json({
      success: true,
      message: 'Subscription updated successfully',
      data: {
        businessId: company.id,
        planId: targetPlan.id,
        status: (status || 'ACTIVE').toString().toUpperCase(),
      }
    });
  } catch (error) {
    console.error('Update subscription error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get global pricing plans
export const getPricingPlans = async (req: Request, res: Response): Promise<void> => {
  const prisma = await getPrisma();
  try {
    const plans = await loadPricingPlans(prisma);

    // Load module restrictions from database settings
    const settings = await prisma.settings.findUnique({
      where: {
        createdBy_key: {
          createdBy: PRICING_PLANS_SETTINGS_OWNER,
          key: PRICING_PLANS_SETTINGS_KEY
        }
      }
    });

    const savedPlans = settings ? JSON.parse(settings.value as string) : [];

    // Transform plans to include moduleRestrictions object from database
    const transformedPlans = plans.map((plan: any) => {
      // Find the corresponding saved plan to get its moduleRestrictions
      const savedPlan = savedPlans.find((sp: any) => sp.id === plan.id);
      const savedRestrictions = savedPlan?.moduleRestrictions || {};

      // Initialize moduleRestrictions with saved data, or default from plan.modules
      const moduleRestrictions: Record<string, any> = {};
      (plan.modules || []).forEach((moduleId: string) => {
        moduleRestrictions[moduleId] = savedRestrictions[moduleId] || {
          enabled: true,
          disabledSubModules: []
        };
      });

      // Also include any modules in savedRestrictions that might not be in plan.modules
      Object.keys(savedRestrictions).forEach((moduleId: string) => {
        if (!moduleRestrictions[moduleId]) {
          moduleRestrictions[moduleId] = savedRestrictions[moduleId];
        }
      });

      return {
        ...plan,
        moduleRestrictions
      };
    });

    res.json({
      success: true,
      data: transformedPlans
    });
  } catch (error) {
    console.error('Get pricing plans error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update global pricing plans (super admin only)
export const updatePricingPlans = async (req: Request, res: Response): Promise<void> => {
  const prisma = await getPrisma();
  try {
    if (!isPlatformAdmin(req)) {
      res.status(403).json({
        success: false,
        message: 'Only platform admin can update pricing plans'
      });
      return;
    }

    const { error } = updatePricingPlansSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
      return;
    }

    const plans = normalizePricingPlans(req.body.plans);

    await prisma.settings.upsert({
      where: {
        createdBy_key: {
          createdBy: PRICING_PLANS_SETTINGS_OWNER,
          key: PRICING_PLANS_SETTINGS_KEY
        }
      },
      update: {
        value: JSON.stringify(plans),
        updatedAt: new Date()
      },
      create: {
        createdBy: PRICING_PLANS_SETTINGS_OWNER,
        key: PRICING_PLANS_SETTINGS_KEY,
        value: JSON.stringify(plans),
        description: 'Global pricing plans managed by super admin'
      }
    });

    res.json({
      success: true,
      message: 'Pricing plans updated successfully',
      data: plans
    });
  } catch (error) {
    console.error('Update pricing plans error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Update a single module for a subscription plan
 */
export const updatePlanModule = async (req: Request, res: Response): Promise<void> => {
  const prisma = await getPrisma();
  try {
    if (!isPlatformAdmin(req)) {
      res.status(403).json({ success: false, message: 'Only platform admins can update plan modules.' });
      return;
    }
    const { planId, moduleId } = req.params;
    const { enabled } = req.body;

    // Get current pricing plans from settings
    const settings = await prisma.settings.findUnique({
      where: {
        createdBy_key: {
          createdBy: PRICING_PLANS_SETTINGS_OWNER,
          key: PRICING_PLANS_SETTINGS_KEY
        }
      }
    });

    if (!settings) {
      res.status(404).json({
        success: false,
        message: 'Pricing plans not found'
      });
      return;
    }

    const plans = JSON.parse(settings.value as string);
    console.log('[updatePlanModule] Looking for plan with planId:', planId);
    console.log('[updatePlanModule] Available plans:', plans.map((p: any) => ({ id: p.id, name: p.name })));
    const plan = plans.find((p: any) => p.id === planId || p.name === planId);

    if (!plan) {
      console.log('[updatePlanModule] Plan not found for planId:', planId);
      res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
      return;
    }

    // Initialize moduleRestrictions if not exists
    if (!plan.moduleRestrictions) {
      plan.moduleRestrictions = {};
    }

    // Update the module restriction
    plan.moduleRestrictions[moduleId] = {
      ...(plan.moduleRestrictions[moduleId] || {}),
      enabled
    };

    // Save updated plans
    await prisma.settings.upsert({
      where: {
        createdBy_key: {
          createdBy: PRICING_PLANS_SETTINGS_OWNER,
          key: PRICING_PLANS_SETTINGS_KEY
        }
      },
      update: {
        value: JSON.stringify(plans)
      },
      create: {
        createdBy: PRICING_PLANS_SETTINGS_OWNER,
        key: PRICING_PLANS_SETTINGS_KEY,
        value: JSON.stringify(plans),
        description: 'Global pricing plans managed by super admin'
      }
    });

    const normalizedModuleId = String(moduleId).toLowerCase().trim();
    const normalizedPlanId = plan.id || planId;
    try {
      await prisma.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS plan_module_permissions (
          id TEXT PRIMARY KEY,
          "planId" TEXT NOT NULL,
          "moduleName" TEXT NOT NULL,
          enabled BOOLEAN NOT NULL DEFAULT false,
          "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE("planId", "moduleName")
        )`
      );
      const existing = await prisma.$queryRawUnsafe(
        `SELECT id FROM plan_module_permissions WHERE "planId" = $1 AND "moduleName" = $2`,
        normalizedPlanId, normalizedModuleId
      ) as Array<{ id: string }>;
      if (existing.length > 0) {
        await prisma.$executeRawUnsafe(
          `UPDATE plan_module_permissions SET enabled = $1, "updatedAt" = CURRENT_TIMESTAMP WHERE id = $2`,
          Boolean(enabled), existing[0].id
        );
      } else {
        await prisma.$executeRawUnsafe(
          `INSERT INTO plan_module_permissions (id, "planId", "moduleName", enabled, "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          crypto.randomUUID(), normalizedPlanId, normalizedModuleId, Boolean(enabled)
        );
      }
    } catch (permErr: any) {
      console.warn('[updatePlanModule] Failed to sync plan_module_permissions:', permErr.message);
    }

    // A plan affects every subscribed business, so both entitlement caches
    // must be cleared before the success response is sent.
    invalidateModuleCache({ type: 'PLAN_CHANGED', businessId: normalizedPlanId });
    clearModuleAccessCache();

    res.json({
      success: true,
      message: `Module ${enabled ? 'enabled' : 'disabled'} for plan ${plan.name}`,
      data: { planId, moduleId, enabled }
    });
  } catch (error) {
    console.error('Update plan module error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getBusinessEntitlements = async (req: AuthRequest, res: Response): Promise<void> => {
  const prisma = await getPrisma();
  try {
    const { companyId } = req.params;
    if (!companyId) {
      res.status(400).json({
        success: false,
        message: 'companyId is required',
      });
      return;
    }

    const company = await prisma.business.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        createdBy: true,
        businessType: true,
      },
    });

    if (!company) {
      res.status(404).json({
        success: false,
        message: 'Company not found',
      });
      return;
    }

    const businessType =
      (normalizeBusinessType(company.businessType) || 'PHARMACY') as SupportedBusinessType;
    const ownerUserId = String(company.createdBy || req.user?.id || '');

    try {
      await reconcileLatestApprovedPaymentProofSubscription(prisma, company.id);
    } catch (reconcileError) {
      console.warn('[Subscription] Approved payment proof reconciliation failed:', reconcileError);
    }

    const summary = await getBusinessEntitlementsSummary(prisma, {
      companyId: company.id,
      ownerUserId,
      businessType,
    });

    res.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    console.error('Get business entitlements error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const updateBusinessEntitlements = async (req: AuthRequest, res: Response): Promise<void> => {
  const prisma = await getPrisma();
  try {
    if (!allowDirectSubscriptionMutation()) {
      res.status(403).json({
        success: false,
        message: 'Direct entitlement changes are disabled. Submit a payment proof for approval instead.',
      });
      return;
    }
    const { error } = assignBusinessPlanSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map((detail) => detail.message),
      });
      return;
    }

    const requesterId = req.user?.id;
    if (!requesterId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized',
      });
      return;
    }

    const { companyId } = req.params;
    const company = await prisma.business.findUnique({
      where: { id: companyId },
      select: {
        id: true,
        createdBy: true,
        businessType: true,
      },
    });

    if (!company) {
      res.status(404).json({
        success: false,
        message: 'Company not found',
      });
      return;
    }

    if (!(await requireBusinessOwner(prisma, String(requesterId), company.id))) {
      res.status(403).json({ success: false, message: 'Only the business owner can change a subscription.' });
      return;
    }

    const plans = await loadPricingPlans(prisma);
    const targetPlan = plans.find((entry) => entry.id === req.body.planId);
    if (!targetPlan) {
      res.status(400).json({
        success: false,
        message: 'Selected plan does not exist',
      });
      return;
    }

    if (targetPlan.id === 'single-trial') {
      res.status(400).json({
        success: false,
        message: 'Trial plan is auto-assigned for 15 days on new business creation and cannot be re-subscribed.',
      });
      return;
    }

    const companyBusinessType =
      (normalizeBusinessType(company.businessType) || 'PHARMACY') as SupportedBusinessType;
    if (!targetPlan.businessTypes.includes(companyBusinessType)) {
      res.status(400).json({
        success: false,
        message: `The selected plan is not available for business type ${companyBusinessType}`,
      });
      return;
    }

    await assignBusinessPlan(prisma, company.id, targetPlan.id, requesterId);
    invalidateBusinessAccess(company.id);
    if (req.body.addOns && typeof req.body.addOns === 'object') {
      await assignBusinessAddOns(
        prisma,
        company.id,
        normalizeAddOnQuantities(req.body.addOns as Partial<Record<SubscriptionAddOnCode, number>>),
        requesterId
      );
    }
    const summary = await getBusinessEntitlementsSummary(prisma, {
      companyId: company.id,
      ownerUserId: String(company.createdBy || requesterId),
      businessType: companyBusinessType,
    });

    res.json({
      success: true,
      message: 'Business plan updated successfully',
      data: summary,
    });
  } catch (error) {
    console.error('Update business entitlements error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};


const updatePaymentMethodSchema = Joi.object({
  last4: Joi.string().length(4).optional(),
  brand: Joi.string().optional(),
  expiryMonth: Joi.number().min(1).max(12).optional(),
  expiryYear: Joi.number().min(new Date().getFullYear()).optional(),
  holderName: Joi.string().optional(), // accepted for client compatibility; not persisted (no column)
  isDefault: Joi.boolean().optional()
});

// Shape a persisted card_details row for API responses. Only fields that are
// actually stored are returned — nothing is fabricated.
const toPaymentMethodResponse = (card: any) => ({
  id: card.id,
  type: 'card' as const,
  last4: card.last4,
  brand: card.brand,
  expiryMonth: card.expiryMonth,
  expiryYear: card.expiryYear,
  isDefault: card.isDefault,
  createdAt: card.createdAt instanceof Date ? card.createdAt.toISOString() : card.createdAt
});

// Add payment method — persisted to the card_details table (the same store
// billing profiles reference). Only card methods can be saved: there is no
// storage model for bank/mobile wallets, and no card gateway is integrated,
// so this records card metadata (last4/brand/expiry) only, never PAN data.
export const addPaymentMethod = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { error, value } = addPaymentMethodSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
      return;
    }

    const userId = (req as any).user?.id;
    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
      return;
    }

    if (value.type !== 'card') {
      res.status(400).json({
        success: false,
        message: 'Only card payment methods can be saved. Bank transfer, EasyPaisa and JazzCash payments are made per invoice via the payment-proof flow.',
        code: 'UNSUPPORTED_PAYMENT_METHOD_TYPE'
      });
      return;
    }

    if (value.isDefault) {
      await prisma.cardDetails.updateMany({
        where: { userId },
        data: { isDefault: false, updatedAt: new Date() }
      });
    }

    const now = new Date();
    const card = await prisma.cardDetails.create({
      data: {
        id: `card_${crypto.randomUUID()}`,
        userId,
        last4: value.last4,
        brand: value.brand,
        expiryMonth: value.expiryMonth,
        expiryYear: value.expiryYear,
        isDefault: Boolean(value.isDefault),
        createdAt: now,
        updatedAt: now
      }
    });

    await syncAfterOperation('cardDetails', 'create', card).catch(err =>
      console.warn('[Sync] CardDetails create sync failed:', err.message)
    );

    res.status(201).json({
      success: true,
      message: 'Payment method added successfully',
      data: toPaymentMethodResponse(card)
    });
  } catch (error) {
    console.error('Add payment method error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update payment method — persisted to card_details (owner only)
export const updatePaymentMethod = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { methodId } = req.params;
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
      return;
    }

    const { error, value } = updatePaymentMethodSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
      return;
    }

    const existing = await prisma.cardDetails.findFirst({
      where: { id: methodId, userId }
    });
    if (!existing) {
      res.status(404).json({
        success: false,
        message: 'Payment method not found'
      });
      return;
    }

    if (value.isDefault) {
      await prisma.cardDetails.updateMany({
        where: { userId, id: { not: methodId } },
        data: { isDefault: false, updatedAt: new Date() }
      });
    }

    const card = await prisma.cardDetails.update({
      where: { id: methodId },
      data: {
        ...(value.last4 !== undefined ? { last4: value.last4 } : {}),
        ...(value.brand !== undefined ? { brand: value.brand } : {}),
        ...(value.expiryMonth !== undefined ? { expiryMonth: value.expiryMonth } : {}),
        ...(value.expiryYear !== undefined ? { expiryYear: value.expiryYear } : {}),
        ...(value.isDefault !== undefined ? { isDefault: Boolean(value.isDefault) } : {}),
        updatedAt: new Date()
      }
    });

    await syncAfterOperation('cardDetails', 'update', card).catch(err =>
      console.warn('[Sync] CardDetails update sync failed:', err.message)
    );

    res.json({
      success: true,
      message: 'Payment method updated successfully',
      data: toPaymentMethodResponse(card)
    });
  } catch (error) {
    console.error('Update payment method error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Set default payment method — persisted to card_details (owner only)
export const setDefaultPaymentMethod = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { methodId } = req.params;
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
      return;
    }

    const existing = await prisma.cardDetails.findFirst({
      where: { id: methodId, userId }
    });
    if (!existing) {
      res.status(404).json({
        success: false,
        message: 'Payment method not found'
      });
      return;
    }

    await prisma.cardDetails.updateMany({
      where: { userId, id: { not: methodId } },
      data: { isDefault: false, updatedAt: new Date() }
    });

    const card = await prisma.cardDetails.update({
      where: { id: methodId },
      data: { isDefault: true, updatedAt: new Date() }
    });

    await syncAfterOperation('cardDetails', 'update', card).catch(err =>
      console.warn('[Sync] CardDetails default sync failed:', err.message)
    );

    res.json({
      success: true,
      message: 'Default payment method updated successfully',
      data: toPaymentMethodResponse(card)
    });
  } catch (error) {
    console.error('Set default payment method error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Delete payment method — removes the card_details row (owner only)
export const deletePaymentMethod = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { methodId } = req.params;
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
      return;
    }

    const existing = await prisma.cardDetails.findFirst({
      where: { id: methodId, userId }
    });
    if (!existing) {
      res.status(404).json({
        success: false,
        message: 'Payment method not found'
      });
      return;
    }

    await prisma.cardDetails.delete({
      where: { id: methodId }
    });

    await syncAfterOperation('cardDetails', 'delete', { id: methodId }).catch(err =>
      console.warn('[Sync] CardDetails delete sync failed:', err.message)
    );

    res.json({
      success: true,
      message: 'Payment method deleted successfully'
    });
  } catch (error) {
    console.error('Delete payment method error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get billing history
export const getBillingHistory = async (req: Request, res: Response): Promise<void> => {
  const prisma = await getPrisma();
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
      return;
    }

    // Use selected company from auth context (set via X-Business-ID header)
    const companyId = (req as any).user?.selectedCompanyId || (req as any).user?.companyId;

    const billingHistory: Array<{
      id: string;
      amount: number;
      status: 'success' | 'failed' | 'pending';
      method: string;
      date: string;
      invoiceNumber: string;
      description: string;
    }> = [];

    // Require company context for security (prevent cross-business data leakage)
    if (companyId) {
      // 1. Query approved payment proofs as successful payments
      try {
        const paymentProofs = await prisma.paymentProof.findMany({
          where: { businessId: companyId },
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: {
            plan: { select: { name: true } }
          }
        });

        for (const proof of paymentProofs) {
          const status: 'success' | 'failed' | 'pending' =
            proof.status === 'APPROVED' ? 'success' :
            proof.status === 'REJECTED' ? 'failed' : 'pending';

          billingHistory.push({
            id: proof.id,
            amount: proof.amount,
            status,
            method: proof.method || 'BANK_TRANSFER',
            date: proof.createdAt.toISOString().split('T')[0],
            invoiceNumber: `INV-${proof.id.slice(-8).toUpperCase()}`,
            description: `${proof.plan?.name || 'Subscription'} - ${proof.method || 'Bank Transfer'}`
          });
        }
      } catch (err) {
        console.warn('[BillingHistory] PaymentProof query failed:', (err as Error).message);
      }

      // 2. Query subscription ledger records (now using BusinessSubscription)
      try {
        const subscriptions = await prisma.businessSubscription.findMany({
          where: { businessId: companyId },
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: {
            plan: { select: { name: true, price: true } }
          }
        });

        for (const sub of subscriptions) {
          // Only add if not already from payment proof
          if (!billingHistory.some((b) => b.id === sub.id)) {
            billingHistory.push({
              id: sub.id,
              amount: sub.plan?.price ? Number(sub.plan.price) : 0,
              status: 'success',
              method: 'System',
              date: sub.createdAt.toISOString().split('T')[0],
              invoiceNumber: `SUB-${sub.id.slice(-8).toUpperCase()}`,
              description: `${sub.plan?.name || 'Subscription'} - ${sub.status}`
            });
          }
        }
      } catch (err) {
        console.warn('[BillingHistory] Subscription query failed:', (err as Error).message);
      }

      // Sort by date descending
      billingHistory.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }

    res.json({
      success: true,
      data: billingHistory
    });
  } catch (error) {
    console.error('Get billing history error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Process payment
//
// No online payment gateway (card / EasyPaisa / JazzCash API) is integrated
// with this platform. Subscriptions are paid manually: the customer transfers
// the amount and uploads a receipt through the payment-proof flow
// (POST /api/payments/manual/submit), and an admin approves it. This endpoint
// previously fabricated a "completed" payment and a premium subscription out
// of thin air; it now refuses honestly instead of returning fake success.
export const processPayment = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
      return;
    }

    res.status(501).json({
      success: false,
      code: 'PAYMENTS_NOT_CONFIGURED',
      message: 'Online payment processing is not configured on this platform. Please pay by bank transfer, EasyPaisa or JazzCash and upload your payment proof for verification — your subscription is activated once an admin approves the proof.'
    });
  } catch (error) {
    console.error('Process payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get the caller's saved payment methods (card_details rows).
// This previously returned a hardcoded catalog of payment "options"
// (EasyPaisa/JazzCash/Bank) dressed up as saved methods; it now returns only
// methods the user actually saved.
export const getPaymentMethods = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
      return;
    }

    const cards = await prisma.cardDetails.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }]
    });

    res.json({
      success: true,
      data: cards.map(toPaymentMethodResponse)
    });
  } catch (error) {
    console.error('Get payment methods error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

const escapeHtml = (value: unknown): string =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Access rule mirrors the payment-proof flow: an ACTIVE membership in the
// business, or being the business creator.
const hasBusinessAccess = async (prisma: any, userId: string, businessId: string): Promise<boolean> => {
  const membership = await prisma.membership.findFirst({
    where: { userId, businessId, status: 'ACTIVE' },
    select: { id: true }
  });
  if (membership) return true;
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { createdBy: true }
  });
  return !!business?.createdBy && String(business.createdBy) === String(userId);
};

const renderInvoiceHtml = (invoice: {
  invoiceNumber: string;
  businessName: string;
  planName: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  date: Date;
  referenceNote?: string | null;
}): string => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Invoice ${escapeHtml(invoice.invoiceNumber)}</title>
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #1a2233; margin: 40px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1a52c5; padding-bottom: 16px; }
  .brand { font-size: 26px; font-weight: 800; color: #1a52c5; }
  .inv { text-align: right; }
  .inv .num { font-size: 20px; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; margin-top: 24px; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #e5e8f0; font-size: 14px; }
  th { background: #f4f6fb; }
  .total { font-size: 16px; font-weight: 700; }
  .meta { margin-top: 24px; font-size: 13px; color: #4a5578; line-height: 1.7; }
  .status { font-weight: 700; text-transform: uppercase; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <div class="brand">Zapeera</div>
      <div>Subscription Invoice</div>
    </div>
    <div class="inv">
      <div class="num">${escapeHtml(invoice.invoiceNumber)}</div>
      <div>${escapeHtml(invoice.date.toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' }))}</div>
    </div>
  </div>
  <div class="meta">
    <div><strong>Billed to:</strong> ${escapeHtml(invoice.businessName)}</div>
    <div><strong>Status:</strong> <span class="status">${escapeHtml(invoice.status)}</span></div>
    <div><strong>Payment method:</strong> ${escapeHtml(invoice.method)}</div>
    ${invoice.referenceNote ? `<div><strong>Reference:</strong> ${escapeHtml(invoice.referenceNote)}</div>` : ''}
  </div>
  <table>
    <thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>
      <tr><td>${escapeHtml(invoice.planName)} subscription</td><td style="text-align:right">${escapeHtml(invoice.currency)} ${Number(invoice.amount).toLocaleString()}</td></tr>
      <tr><td class="total">Total</td><td class="total" style="text-align:right">${escapeHtml(invoice.currency)} ${Number(invoice.amount).toLocaleString()}</td></tr>
    </tbody>
  </table>
  <p class="meta">This invoice was generated from the payment record stored in Zapeera. Payments are verified manually via the payment-proof flow.</p>
</body>
</html>`;

// Download invoice — returns a real invoice document rendered from the
// stored record. The :invoiceId is the billing-history record id: either a
// PaymentProof id or a BusinessSubscription id (same ids getBillingHistory
// returns). Previously this returned JSON pointing back at itself.
export const downloadInvoice = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { invoiceId } = req.params;
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
      return;
    }

    // 1. Payment-proof backed invoice
    const proof = await prisma.paymentProof.findUnique({
      where: { id: invoiceId },
      include: {
        plan: { select: { name: true } },
        business: { select: { name: true } }
      }
    });

    if (proof) {
      if (!(await hasBusinessAccess(prisma, userId, proof.businessId))) {
        res.status(403).json({ success: false, message: 'You do not have access to this invoice' });
        return;
      }
      const invoiceNumber = `INV-${proof.id.slice(-8).toUpperCase()}`;
      const html = renderInvoiceHtml({
        invoiceNumber,
        businessName: proof.business?.name || 'Business',
        planName: proof.plan?.name || 'Subscription',
        amount: proof.amount,
        currency: proof.currency || 'PKR',
        method: proof.method || 'BANK_TRANSFER',
        status: proof.status,
        date: proof.createdAt,
        referenceNote: proof.referenceNote
      });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceNumber}.html"`);
      res.send(html);
      return;
    }

    // 2. Subscription backed invoice
    const subscription = await prisma.businessSubscription.findUnique({
      where: { id: invoiceId },
      include: {
        plan: { select: { name: true, price: true } },
        business: { select: { name: true } }
      }
    });

    if (subscription) {
      if (!(await hasBusinessAccess(prisma, userId, subscription.businessId))) {
        res.status(403).json({ success: false, message: 'You do not have access to this invoice' });
        return;
      }
      const invoiceNumber = `SUB-${subscription.id.slice(-8).toUpperCase()}`;
      const html = renderInvoiceHtml({
        invoiceNumber,
        businessName: subscription.business?.name || 'Business',
        planName: subscription.plan?.name || 'Subscription',
        amount: subscription.plan?.price ? Number(subscription.plan.price) : 0,
        currency: 'PKR',
        method: 'System',
        status: subscription.status,
        date: subscription.createdAt
      });
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceNumber}.html"`);
      res.send(html);
      return;
    }

    res.status(404).json({
      success: false,
      message: 'Invoice not found'
    });
  } catch (error) {
    console.error('Download invoice error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * POST /subscriptions/activate
 * Fake-payment endpoint for local testing.
 * Upgrades the business subscription to ACTIVE status on the given plan.
 * Body: { businessId, planId }
 */
export const activateSubscription = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { businessId, planId } = req.body;

    if (!allowDirectSubscriptionMutation()) {
      res.status(403).json({
        success: false,
        message: 'Test subscription activation is disabled. Use the payment-proof approval flow.',
      });
      return;
    }

    if (!businessId || !planId) {
      res.status(400).json({ success: false, message: 'businessId and planId are required' });
      return;
    }

    if (!req.user?.id || !(await requireBusinessOwner(prisma, String(req.user.id), String(businessId)))) {
      res.status(403).json({ success: false, message: 'Only the business owner can activate a test subscription.' });
      return;
    }

    // Verify plan exists
    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) {
      res.status(404).json({ success: false, message: `Plan '${planId}' not found` });
      return;
    }

    const now = new Date();
    const endDate = new Date(now.getTime() + plan.durationDays * 24 * 60 * 60 * 1000);

    const existing = await prisma.businessSubscription.findFirst({
      where: { businessId },
      orderBy: { createdAt: 'desc' }
    });

    if (existing) {
      await prisma.businessSubscription.update({
        where: { id: existing.id },
        data: { planId, status: 'ACTIVE', currentPeriodEnd: endDate, trialEndsAt: null, updatedAt: now }
      });
    } else {
      await prisma.businessSubscription.create({
        data: { businessId, planId, status: 'ACTIVE', currentPeriodEnd: endDate, trialEndsAt: null }
      });
    }

    invalidateBusinessAccess(String(businessId));

    console.log(`[FakePayment] ✅ Activated plan '${planId}' for business '${businessId}', ends ${endDate.toISOString()}`);

    // Send subscription confirmation email asynchronously (don't block response)
    try {
      const business = await prisma.business.findUnique({
        where: { id: businessId },
        select: { name: true, createdBy: true }
      });
      if (business?.createdBy) {
        const owner = await prisma.zapeeraUser.findUnique({
          where: { id: business.createdBy },
          select: { email: true, name: true }
        });
        if (owner?.email) {
          const { emailService } = await import('../services/email.service');
          emailService.sendSubscriptionPurchasedEmail(
            owner.email,
            owner.name || 'User',
            business.name,
            plan.name,
            plan.price,
            endDate.toISOString()
          )
            .then((sent: boolean) => {
              if (sent) console.log(`✅ Subscription email sent to ${owner.email}`);
            })
            .catch((err: any) => console.error('❌ Failed to send subscription email:', err.message));
        }
      }
    } catch (emailErr: any) {
      console.warn('[Email] Could not send subscription email:', emailErr.message);
    }

    // Fetch business owner for notification
    try {
      const biz = await prisma.business.findUnique({
        where: { id: businessId },
        select: { createdBy: true }
      });
      if (biz?.createdBy) {
        createNotification({
          userId: biz.createdBy,
          businessId: businessId || '',
          type: 'subscription_activated',
          title: 'Subscription Activated',
          body: `Your subscription on plan '${plan?.name || 'Unknown'}' has been activated.`,
          actionUrl: `/business/${businessId}/subscription`,
        }).catch(() => {});
      }
    } catch (notifErr) {
      console.warn('[Notification] Could not send subscription notification:', notifErr);
    }

    res.json({
      success: true,
      message: `Subscription activated on plan '${plan.name}'`,
      data: {
        businessId,
        planId,
        planName: plan.name,
        status: 'ACTIVE',
        startDate: now.toISOString(),
        endDate: endDate.toISOString()
      }
    });
  } catch (error: any) {
    console.error('activateSubscription error:', error);
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
};
