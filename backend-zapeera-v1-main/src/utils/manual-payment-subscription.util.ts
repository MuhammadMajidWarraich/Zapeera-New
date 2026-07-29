import { PrismaClient } from '@prisma/client';
import { syncBusinessModulesWithSubscription } from './subscription-entitlements.util';
import { PLANS } from '../config/constants';

const SUBSCRIPTION_DURATION_DAYS = 30;
const BUSINESS_ASSIGNMENT_KEY = 'plan_assignment';

type PlatformPlanLike = {
  id: string;
  name?: string | null;
  durationDays?: number | null;
};

type ApplyApprovedPaymentProofParams = {
  proofId: string;
  businessId: string;
  platformPlan: PlatformPlanLike;
  assignedBy: string;
  activatedAt?: Date | string | null;
};

const businessAssignmentOwner = (businessId: string) => `subscription_business_${businessId}`;

export const pricingPlanIdForPlatformPlan = (plan: PlatformPlanLike): string => {
  const planNameToIdMap: Record<string, string> = {
    Trial: PLANS.TRIAL,
    Starter: PLANS.STARTER,
    Growth: PLANS.GROWTH,
    Scale: PLANS.SCALE,
  };

  return planNameToIdMap[String(plan.name || '').trim()] || plan.id || PLANS.STARTER;
};

const activationDate = (value?: Date | string | null) => {
  const parsed = value ? new Date(value) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
};

export const applyApprovedPaymentProofSubscription = async (
  prisma: PrismaClient,
  params: ApplyApprovedPaymentProofParams
) => {
  const start = activationDate(params.activatedAt);
  const startIso = start.toISOString();
  const durationDays = params.platformPlan.durationDays ?? SUBSCRIPTION_DURATION_DAYS;
  const periodEnd = new Date(start.getTime() + durationDays * 24 * 60 * 60 * 1000);
  const pricingPlanId = pricingPlanIdForPlatformPlan(params.platformPlan);

  let subscriptionId: string;
  const existingSub = await prisma.businessSubscription.findFirst({
    where: { businessId: params.businessId },
    orderBy: { createdAt: 'desc' }
  });

  if (existingSub) {
    subscriptionId = existingSub.id;
  } else {
    subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  await prisma.businessSubscription.upsert({
    where: { businessId: params.businessId },
    create: {
      businessId: params.businessId,
      planId: pricingPlanId,
      status: 'ACTIVE',
      billingStatus: 'PAID',
      trialEndsAt: null,
      currentPeriodEnd: periodEnd,
    },
    update: {
      planId: pricingPlanId,
      status: 'ACTIVE',
      billingStatus: 'PAID',
      trialEndsAt: null,
      currentPeriodEnd: periodEnd,
    },
  });

  await prisma.settings.upsert({
    where: {
      createdBy_key: {
        createdBy: businessAssignmentOwner(params.businessId),
        key: BUSINESS_ASSIGNMENT_KEY,
      },
    },
    create: {
      createdBy: businessAssignmentOwner(params.businessId),
      key: BUSINESS_ASSIGNMENT_KEY,
      value: JSON.stringify({
        planId: pricingPlanId,
        platformPlanId: params.platformPlan.id,
        assignedBy: params.assignedBy,
        assignedAt: startIso,
        paymentProofId: params.proofId,
      }),
      description: 'Business-level subscription plan assignment',
    },
    update: {
      value: JSON.stringify({
        planId: pricingPlanId,
        platformPlanId: params.platformPlan.id,
        assignedBy: params.assignedBy,
        assignedAt: startIso,
        paymentProofId: params.proofId,
      }),
      description: 'Business-level subscription plan assignment',
    },
  });

  const business = await prisma.business.findUnique({
    where: { id: params.businessId },
    select: { id: true, createdBy: true, businessType: true },
  });

  if (business?.createdBy) {
    await syncBusinessModulesWithSubscription(prisma, {
      companyId: business.id,
      ownerUserId: business.createdBy,
      businessType: String(business.businessType || 'PHARMACY').toUpperCase() as any,
    });
  }

  return { subscriptionId, pricingPlanId, periodEnd };
};

export const reconcileLatestApprovedPaymentProofSubscription = async (
  prisma: PrismaClient,
  businessId: string
) => {
  const rows = await prisma.$queryRaw<any[]>`
    SELECT pp.id, pp."businessId", pp."planId", pp."reviewedBy", pp."reviewedAt",
           pp."updatedAt", pp."createdAt",
           p.name as "planName", p."durationDays"
    FROM payment_proofs pp
    JOIN platform_plans p ON p.id = pp."planId"
    WHERE pp."businessId" = ${businessId}
      AND pp.status = 'APPROVED'
    ORDER BY COALESCE(pp."reviewedAt", pp."updatedAt", pp."createdAt") DESC
    LIMIT 1
  `;

  const proof = rows[0];
  if (!proof) return null;

  const expectedPricingPlanId = pricingPlanIdForPlatformPlan({
    id: proof.planId,
    name: proof.planName,
    durationDays: proof.durationDays,
  });

  try {
    const assignment = await prisma.settings.findUnique({
      where: {
        createdBy_key: {
          createdBy: businessAssignmentOwner(businessId),
          key: BUSINESS_ASSIGNMENT_KEY,
        },
      },
    });
    const businessSubscription = await prisma.businessSubscription.findUnique({
      where: { businessId },
      select: { planId: true, status: true, billingStatus: true },
    });
    const parsed = assignment?.value ? JSON.parse(assignment.value) as { planId?: string; paymentProofId?: string } : null;

    if (
      parsed?.planId === expectedPricingPlanId &&
      parsed?.paymentProofId === proof.id &&
      businessSubscription?.planId === expectedPricingPlanId &&
      businessSubscription?.status === 'ACTIVE' &&
      businessSubscription?.billingStatus === 'PAID'
    ) {
      return null;
    }
  } catch {
    // Continue with reconciliation if the existing assignment cannot be read.
  }

  return applyApprovedPaymentProofSubscription(prisma, {
    proofId: proof.id,
    businessId: proof.businessId,
    platformPlan: {
      id: proof.planId,
      name: proof.planName,
      durationDays: proof.durationDays,
    },
    assignedBy: proof.reviewedBy || 'system_payment_reconciliation',
    activatedAt: proof.reviewedAt || proof.updatedAt || proof.createdAt,
  });
};
