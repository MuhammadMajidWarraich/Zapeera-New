import { PrismaClient } from '@prisma/client';
import { isMissingTableError } from './membership-bridge.util';
import { PLANS, PLAN_LIMITS as CENTRALIZED_PLAN_LIMITS } from '../config/constants';

type PlanLimits = {
  maxBranches: number | null;
  maxMembers: number | null;
};

// Using centralized constants - keeping this local mapping for the v2 subscription system
const PLAN_LIMITS: Record<string, PlanLimits> = {
  [PLANS.STARTER]: { maxBranches: 1, maxMembers: 1 },
  [PLANS.GROWTH]: { maxBranches: 3, maxMembers: 3 },
  [PLANS.SCALE]: { maxBranches: 10, maxMembers: null },
};

const resolvePlanLimits = (planId?: string | null): PlanLimits | null => {
  if (!planId) return null;
  return PLAN_LIMITS[String(planId).trim()] || null;
};

const getEffectiveBusinessPlanId = async (
  prisma: PrismaClient,
  params: { businessId: string; ownerUserId: string }
): Promise<string | null> => {
  try {
    const businessSub = await prisma.$queryRaw<any[]>`
      SELECT "planId"
      FROM business_subscriptions
      WHERE "businessId" = ${params.businessId}
      LIMIT 1
    `;

    const businessPlanId = businessSub[0]?.planId ? String(businessSub[0].planId) : null;
    return businessPlanId;
  } catch (error: any) {
    if (isMissingTableError(error)) {
      console.error('[getEffectiveBusinessPlanId] ❌ CRITICAL: Required tables missing');
      return null;
    }
    throw error;
  }
};

export const validateBusinessCreationAllowanceV2 = async (
  prisma: PrismaClient,
  ownerUserId: string
): Promise<{ allowed: true; v2SubFound?: boolean } | { allowed: false; statusCode: number; message: string; details: Record<string, unknown> }> => {
  // Business creation is now unlimited per user.
  // Each new business will automatically be assigned a 15-day Trial plan.
  return { allowed: true, v2SubFound: true };
};

export const validateBranchCreationAllowanceV2 = async (
  prisma: PrismaClient,
  params: { businessId: string; ownerUserId: string }
): Promise<{ allowed: true } | { allowed: false; statusCode: number; message: string; details: Record<string, unknown> }> => {
  const planId = await getEffectiveBusinessPlanId(prisma, params);
  const limits = resolvePlanLimits(planId);
  if (!limits || limits.maxBranches === null) return { allowed: true };

  const activeBranches = await prisma.branch.count({
    where: { companyId: params.businessId, isActive: true },
  });
  if (activeBranches >= limits.maxBranches) {
    return {
      allowed: false,
      statusCode: 403,
      message: `Branch limit reached (${limits.maxBranches}) for effective plan ${planId}.`,
      details: {
        code: 'BRANCH_LIMIT_REACHED_V2',
        maxBranches: limits.maxBranches,
        activeBranches,
        planId,
      },
    };
  }

  return { allowed: true };
};

export const validateMembershipInviteAllowanceV2 = async (
  prisma: PrismaClient,
  params: { businessId: string; ownerUserId: string }
): Promise<{ allowed: true } | { allowed: false; statusCode: number; message: string; details: Record<string, unknown> }> => {
  const planId = await getEffectiveBusinessPlanId(prisma, params);
  const limits = resolvePlanLimits(planId);
  if (!limits || limits.maxMembers === null) return { allowed: true };

  try {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT COUNT(1) as total
      FROM memberships
      WHERE businessId = ${params.businessId}
        AND status = 'ACTIVE'
    `;
    const activeMembers = Number(rows[0]?.total || 0);
    if (activeMembers >= limits.maxMembers) {
      return {
        allowed: false,
        statusCode: 403,
        message: `Membership limit reached (${limits.maxMembers}) for effective plan ${planId}.`,
        details: {
          code: 'MEMBERSHIP_LIMIT_REACHED_V2',
          maxMembers: limits.maxMembers,
          activeMembers,
          planId,
        },
      };
    }
  } catch (error: any) {
    if (isMissingTableError(error)) {
      // SECURITY FIX: Fail-secure - deny access when tables are missing
      console.error('[validateMembershipInviteAllowanceV2] ❌ CRITICAL: Required tables missing, denying invite');
      return { 
        allowed: false,
        statusCode: 503,
        message: 'Service temporarily unavailable. Please contact support.',
        details: { code: 'SCHEMA_MIGRATION_REQUIRED' }
      };
    }
    throw error;
  }

  return { allowed: true };
};

