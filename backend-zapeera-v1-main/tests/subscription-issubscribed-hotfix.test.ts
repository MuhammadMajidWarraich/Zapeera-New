import { describe, it, expect } from '@jest/globals';
import {
  computeSubscriptionVerdict,
  getBusinessEntitlementsSummary,
  assignBusinessPlan,
} from '../src/utils/subscription-entitlements.util';

// ── Hotfix 2026-11-11 ─ isSubscribed must not demand a live trial from a
// paid ACTIVE subscription. Businesses converted from trial to a paid plan
// kept their original trialEndsAt (assignBusinessPlan never cleared it), and
// the old formula flipped them to isSubscribed=false the day that stale date
// passed — mid-paid-period (C4 Probe Clinic, Seikho Medicos, QA2 Pharmacy,
// C5 Probe Hotel, Affiliate Probe Store). Fake Prisma — no DB needed.

const DAY = 24 * 60 * 60 * 1000;
const daysFromNow = (n: number) => new Date(Date.now() + n * DAY);

describe('computeSubscriptionVerdict (hotfix 2026-11-11)', () => {
  it('(a) ACTIVE paid + past trialEndsAt + valid period → subscribed', () => {
    const v = computeSubscriptionVerdict({
      status: 'ACTIVE',
      trialEndsAt: daysFromNow(-6),
      currentPeriodEnd: daysFromNow(10),
    });
    expect(v.isSubscribed).toBe(true);
    expect(v.isExpired).toBe(false);
  });

  it('(b) TRIAL + expired trial → not subscribed', () => {
    const v = computeSubscriptionVerdict({
      status: 'TRIAL',
      trialEndsAt: daysFromNow(-1),
      currentPeriodEnd: daysFromNow(-1),
    });
    expect(v.isSubscribed).toBe(false);
  });

  it('(b2) TRIAL + expired trialEndsAt even with a later period end → not subscribed', () => {
    const v = computeSubscriptionVerdict({
      status: 'TRIAL',
      trialEndsAt: daysFromNow(-1),
      currentPeriodEnd: daysFromNow(5),
    });
    expect(v.isSubscribed).toBe(false);
    expect(v.isExpired).toBe(false);
  });

  it('(c) TRIAL + valid trial → subscribed', () => {
    const v = computeSubscriptionVerdict({
      status: 'TRIAL',
      trialEndsAt: daysFromNow(9),
      currentPeriodEnd: daysFromNow(9),
    });
    expect(v.isSubscribed).toBe(true);
    expect(v.isExpired).toBe(false);
  });

  it('(d) ACTIVE + expired period → not subscribed, flagged expired', () => {
    const v = computeSubscriptionVerdict({
      status: 'ACTIVE',
      trialEndsAt: null,
      currentPeriodEnd: daysFromNow(-2),
    });
    expect(v.isSubscribed).toBe(false);
    expect(v.isExpired).toBe(true);
  });

  it('GRACE semantics preserved: past trial date never gates a GRACE row', () => {
    const v = computeSubscriptionVerdict({
      status: 'GRACE',
      trialEndsAt: daysFromNow(-3),
      currentPeriodEnd: daysFromNow(2),
    });
    expect(v.isSubscribed).toBe(true);
  });

  it('no subscription row → not subscribed', () => {
    const v = computeSubscriptionVerdict({ status: null, trialEndsAt: null, currentPeriodEnd: null });
    expect(v.isSubscribed).toBe(false);
    expect(v.isExpired).toBe(false);
  });

  it('ACTIVE with no dates at all → subscribed (legacy NULL-date rows stay immune)', () => {
    const v = computeSubscriptionVerdict({ status: 'ACTIVE', trialEndsAt: null, currentPeriodEnd: null });
    expect(v.isSubscribed).toBe(true);
  });
});

// ── Full summary through a fake Prisma ────────────────────────────────────

function fakePrismaForSummary(subRow: {
  planId: string;
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
}) {
  return {
    plan: { findMany: async () => [] },
    settings: { findUnique: async () => null },
    module: { findMany: async () => [] },
    branch: { count: async () => 1 },
    zapeeraUser: { findUnique: async () => ({ id: 'owner-1', isActive: true }) },
    businessSubscription: { findUnique: async () => subRow },
    $queryRaw: async (strings: TemplateStringsArray) => {
      const sql = strings.join(' ');
      if (sql.includes('business_subscriptions')) return [{ planId: subRow.planId }];
      return []; // memberships
    },
  } as any;
}

const summaryFor = (subRow: Parameters<typeof fakePrismaForSummary>[0]) =>
  getBusinessEntitlementsSummary(fakePrismaForSummary(subRow), {
    companyId: 'business-1',
    ownerUserId: 'owner-1',
    businessType: 'PHARMACY',
  });

describe('getBusinessEntitlementsSummary (hotfix 2026-11-11)', () => {
  it('C4 Probe Clinic shape: ACTIVE Growth, stale past trialEndsAt, period valid → isSubscribed true', async () => {
    const summary = await summaryFor({
      planId: 'single-growth',
      status: 'ACTIVE',
      trialEndsAt: daysFromNow(-6),
      currentPeriodEnd: daysFromNow(10),
    });
    expect(summary).not.toBeNull();
    expect(summary!.isSubscribed).toBe(true);
    expect(summary!.subscriptionStatus).toBe('ACTIVE');
    expect(summary!.planId).toBe('single-growth');
  });

  it('TRIAL still valid → isSubscribed true', async () => {
    const summary = await summaryFor({
      planId: 'single-trial',
      status: 'TRIAL',
      trialEndsAt: daysFromNow(9),
      currentPeriodEnd: daysFromNow(9),
    });
    expect(summary!.isSubscribed).toBe(true);
    expect(summary!.subscriptionStatus).toBe('TRIAL');
  });

  it('TRIAL expired → isSubscribed false', async () => {
    const summary = await summaryFor({
      planId: 'single-trial',
      status: 'TRIAL',
      trialEndsAt: daysFromNow(-1),
      currentPeriodEnd: daysFromNow(-1),
    });
    expect(summary!.isSubscribed).toBe(false);
  });

  it('ACTIVE with expired period → isSubscribed false and status EXPIRED', async () => {
    const summary = await summaryFor({
      planId: 'single-growth',
      status: 'ACTIVE',
      trialEndsAt: null,
      currentPeriodEnd: daysFromNow(-2),
    });
    expect(summary!.isSubscribed).toBe(false);
    expect(summary!.subscriptionStatus).toBe('EXPIRED');
  });
});

// ── assignBusinessPlan write side ─────────────────────────────────────────

describe('assignBusinessPlan clears trialEndsAt for paid plans (hotfix 2026-11-11)', () => {
  const makeFake = () => {
    const captured: { upsertArgs?: any } = {};
    const prisma = {
      settings: { upsert: async () => ({}) },
      businessSubscription: {
        upsert: async (args: any) => {
          captured.upsertArgs = args;
          return {};
        },
      },
      business: { findUnique: async () => null },
    } as any;
    return { prisma, captured };
  };

  it('paid plan assignment writes trialEndsAt: null on update and create', async () => {
    const { prisma, captured } = makeFake();
    await assignBusinessPlan(prisma, 'business-1', 'single-growth', 'admin-1');
    expect(captured.upsertArgs.update.status).toBe('ACTIVE');
    expect(captured.upsertArgs.update.trialEndsAt).toBeNull();
    expect(captured.upsertArgs.create.trialEndsAt).toBeNull();
  });

  it('trial plan assignment still sets trialEndsAt to the trial end', async () => {
    const { prisma, captured } = makeFake();
    await assignBusinessPlan(prisma, 'business-1', 'single-trial', 'admin-1');
    expect(captured.upsertArgs.update.status).toBe('TRIAL');
    expect(captured.upsertArgs.update.trialEndsAt).toBeInstanceOf(Date);
    expect(captured.upsertArgs.update.trialEndsAt.getTime()).toBeGreaterThan(Date.now());
  });
});
