import { PrismaClient } from '@prisma/client';
import { isMissingTableError } from './membership-bridge.util';
import {
  getEffectiveLimits,
  countStaffSeats,
  ADDON_CATALOGUE,
} from '../services/addon-limits.service';

// NOTE (add-on system, 2026-10-24): branch and staff-seat limits are
// no longer resolved from a local plan map — they come from
// services/addon-limits.service (plan inclusions + purchased add-ons).
// The old local PLAN_LIMITS map (which capped Growth at 3 total
// members, contradicting the published 6 staff seats) is retired.

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
  // Effective limit = plan branches + EXTRA_BRANCH add-ons, computed by
  // the add-on limits service (the single source — see
  // services/addon-limits.service PLAN_INCLUSIONS).
  const limits = await getEffectiveLimits(prisma as any, params.businessId);
  const maxBranches = limits.maxBranches;

  const activeBranches = await prisma.branch.count({
    where: { companyId: params.businessId, isActive: true },
  });
  if (activeBranches >= maxBranches) {
    return {
      allowed: false,
      statusCode: 403,
      message: `Branch limit reached (${maxBranches}) on the ${limits.planName} plan. Add an Extra Branch add-on or upgrade your plan.`,
      details: {
        code: 'BRANCH_LIMIT_REACHED_V2',
        maxBranches,
        activeBranches,
        planId: limits.planId,
        addon: 'EXTRA_BRANCH',
        addonPriceMonthly: ADDON_CATALOGUE.EXTRA_BRANCH.priceMonthly,
      },
    };
  }

  return { allowed: true };
};

export const validateMembershipInviteAllowanceV2 = async (
  prisma: PrismaClient,
  params: { businessId: string; ownerUserId: string }
): Promise<{ allowed: true } | { allowed: false; statusCode: number; message: string; details: Record<string, unknown> }> => {
  // Staff-seat enforcement (add-on system): Trial/Starter are
  // owner-only — inviting ANY staff member is refused with
  // PLAN_STAFF_NOT_INCLUDED. Plans with staff access are capped by
  // staff SEATS (owner excluded): plan seats + HR Pack seats + extra
  // seats, all computed by the add-on limits service.
  try {
    const limits = await getEffectiveLimits(prisma as any, params.businessId);

    if (!limits.staffAllowed) {
      return {
        allowed: false,
        statusCode: 403,
        message: `Staff accounts are not included in the ${limits.planName} plan. Add the HR Pack or upgrade to Growth to invite staff.`,
        details: {
          code: 'PLAN_STAFF_NOT_INCLUDED',
          planId: limits.planId,
          addon: 'HR_PACK',
          addonPriceMonthly: ADDON_CATALOGUE.HR_PACK.priceMonthly,
        },
      };
    }

    const usedSeats = await countStaffSeats(prisma as any, params.businessId);
    if (usedSeats >= limits.maxStaffSeats) {
      return {
        allowed: false,
        statusCode: 403,
        message: `Staff seat limit reached (${limits.maxStaffSeats}) on the ${limits.planName} plan. Add an Extra Staff Seat or upgrade your plan.`,
        details: {
          code: 'SEAT_LIMIT_REACHED',
          legacyCode: 'MEMBERSHIP_LIMIT_REACHED_V2',
          maxStaffSeats: limits.maxStaffSeats,
          usedStaffSeats: usedSeats,
          planId: limits.planId,
          addon: 'EXTRA_SEAT',
          addonPriceMonthly: ADDON_CATALOGUE.EXTRA_SEAT.priceMonthly,
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

