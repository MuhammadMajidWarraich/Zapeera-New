import { describe, it, expect } from '@jest/globals';
import {
  PLAN_INCLUSIONS,
  HR_PACK_INCLUDED_SEATS,
  getEffectiveLimits,
} from '../src/services/addon-limits.service';
import { PLANS } from '../src/config/constants';

// ── Plan staff seats, approved 2026-10-24 ────────────────────────────────
// Growth 6 / Scale 20 (owner excluded): owner + one manager + one cashier
// per branch (Growth 1+3+3 = 7 total accounts; Scale 1+10+10 = 21).
// Trial + Starter stay owner-only (0). HR Pack (+5) and Extra Staff Seat
// (+N) stack on top of the new bases. Fake Prisma — no DB needed.

function fakePrisma(planId: string, addons: Array<{ type: string; quantity: number }>) {
  return {
    businessSubscription: {
      findUnique: async () => ({
        planId,
        status: 'ACTIVE',
        currentPeriodEnd: null,
        trialEndsAt: null,
      }),
    },
    subscriptionAddon: {
      findMany: async () =>
        addons.map((a) => ({ type: a.type, quantity: a.quantity, status: 'ACTIVE', periodEnd: null })),
    },
    settings: { findMany: async () => [] },
  };
}

describe('plan staff-seat bases', () => {
  it('PLAN_INCLUSIONS: Trial 0 / Starter 0 / Growth 6 / Scale 20, owner excluded', () => {
    expect(PLAN_INCLUSIONS[PLANS.TRIAL].staffSeats).toBe(0);
    expect(PLAN_INCLUSIONS[PLANS.TRIAL].staff).toBe(false);
    expect(PLAN_INCLUSIONS[PLANS.STARTER].staffSeats).toBe(0);
    expect(PLAN_INCLUSIONS[PLANS.STARTER].staff).toBe(false);
    expect(PLAN_INCLUSIONS[PLANS.GROWTH].staffSeats).toBe(6);
    expect(PLAN_INCLUSIONS[PLANS.GROWTH].staff).toBe(true);
    expect(PLAN_INCLUSIONS[PLANS.SCALE].staffSeats).toBe(20);
    expect(PLAN_INCLUSIONS[PLANS.SCALE].staff).toBe(true);
    expect(HR_PACK_INCLUDED_SEATS).toBe(5);
  });

  it('getEffectiveLimits: plan-only bases', async () => {
    const growth = await getEffectiveLimits(fakePrisma(PLANS.GROWTH, []) as any, 'biz-1');
    expect(growth.maxStaffSeats).toBe(6);
    expect(growth.staffAllowed).toBe(true);

    const scale = await getEffectiveLimits(fakePrisma(PLANS.SCALE, []) as any, 'biz-1');
    expect(scale.maxStaffSeats).toBe(20);
    expect(scale.staffAllowed).toBe(true);

    const trial = await getEffectiveLimits(fakePrisma(PLANS.TRIAL, []) as any, 'biz-1');
    expect(trial.maxStaffSeats).toBe(0);
    expect(trial.staffAllowed).toBe(false);

    const starter = await getEffectiveLimits(fakePrisma(PLANS.STARTER, []) as any, 'biz-1');
    expect(starter.maxStaffSeats).toBe(0);
    expect(starter.staffAllowed).toBe(false);
  });

  it('HR Pack + Extra Staff Seats stack on the new bases', async () => {
    const growthHr = await getEffectiveLimits(
      fakePrisma(PLANS.GROWTH, [{ type: 'HR_PACK', quantity: 1 }]) as any,
      'biz-1',
    );
    expect(growthHr.maxStaffSeats).toBe(11); // 6 + 5

    const scaleHr = await getEffectiveLimits(
      fakePrisma(PLANS.SCALE, [{ type: 'HR_PACK', quantity: 1 }]) as any,
      'biz-1',
    );
    expect(scaleHr.maxStaffSeats).toBe(25); // 20 + 5

    const growthFull = await getEffectiveLimits(
      fakePrisma(PLANS.GROWTH, [
        { type: 'HR_PACK', quantity: 1 },
        { type: 'EXTRA_SEAT', quantity: 2 },
      ]) as any,
      'biz-1',
    );
    expect(growthFull.maxStaffSeats).toBe(13); // 6 + 5 + 2

    const scaleExtra = await getEffectiveLimits(
      fakePrisma(PLANS.SCALE, [{ type: 'EXTRA_SEAT', quantity: 3 }]) as any,
      'biz-1',
    );
    expect(scaleExtra.maxStaffSeats).toBe(23); // 20 + 3
  });

  it('HR Pack still unlocks staff on owner-only Starter (5 seats)', async () => {
    const starterHr = await getEffectiveLimits(
      fakePrisma(PLANS.STARTER, [{ type: 'HR_PACK', quantity: 1 }]) as any,
      'biz-1',
    );
    expect(starterHr.staffAllowed).toBe(true);
    expect(starterHr.maxStaffSeats).toBe(5);
  });
});
