import { describe, it, expect, jest, beforeEach } from '@jest/globals';

// ── v1.0.19.1 — subscription/entitlement state is CLOUD-AUTHORITATIVE ──
// A device must never be able to push billing state over the cloud row.
// Incident (2026-11-11): after a cloud-side restore set the General
// Store's currentPeriodEnd to 2026-12-11, the row flipped back to the
// exact stale value 2026-11-19 minutes later. Investigation findings:
// the op-push channel had NEVER actually carried a subscription op
// (sync_processed_operations holds zero, and no local route writes the
// subscriptions mirror through the queue), and the generic apply only
// no-opped them BY ACCIDENT (prisma['subscription'] does not exist in
// the PG schema — the model is BusinessSubscription). This test pins
// the now-EXPLICIT guarantee: a stale subscription push attempt is
// REJECTED and the cloud row is never written, under every plausible
// entity spelling, for CREATE and UPDATE alike — while ordinary
// operational entities still push normally.

const writes: Record<string, any[]> = { businessSubscription: [], subscriptionAddon: [], category: [] };
const cloudRow: any = {
  id: 'sub-row-1',
  businessId: 'biz-1',
  planId: 'single-growth',
  status: 'ACTIVE',
  billingStatus: 'PAID',
  trialEndsAt: null,
  currentPeriodEnd: new Date('2026-12-11T11:39:00.000Z'),
  updatedAt: new Date('2026-11-11T11:39:00.000Z'),
};

const fakePrisma: any = {
  membership: {
    findFirst: async () => ({ id: 'mem-1' }),
  },
  business: {
    findFirst: async () => null,
  },
  // Deliberately NO syncProcessedOperation delegate: the controller
  // treats a missing dedupe store as "dedupe disabled" and proceeds.
  businessSubscription: {
    findUnique: async () => ({ ...cloudRow }),
    create: async (args: any) => { writes.businessSubscription.push(['create', args]); return args.data; },
    update: async (args: any) => { writes.businessSubscription.push(['update', args]); return args.data; },
    upsert: async (args: any) => { writes.businessSubscription.push(['upsert', args]); return args.update; },
    delete: async (args: any) => { writes.businessSubscription.push(['delete', args]); return {}; },
  },
  subscriptionAddon: {
    findUnique: async () => null,
    create: async (args: any) => { writes.subscriptionAddon.push(['create', args]); return args.data; },
    update: async (args: any) => { writes.subscriptionAddon.push(['update', args]); return args.data; },
  },
  category: {
    findUnique: async () => null,
    create: async (args: any) => { writes.category.push(['create', args]); return args.data; },
    update: async (args: any) => { writes.category.push(['update', args]); return args.data; },
  },
};

jest.mock('../src/utils/db.util', () => ({
  getPrisma: async () => fakePrisma,
}));
jest.mock('../src/services/sync-stock-replay.service', () => ({
  replaySaleStock: async () => ({}),
  restockRefundStock: async () => ({}),
  saleLineUnits: () => 0,
}));
jest.mock('../src/services/stock-reconciliation.service', () => ({
  runReconciliation: async () => ({}),
  createStockTakesFromReconciliation: async () => ({}),
  resolveReconciliation: async () => ({}),
}));
jest.mock('../src/services/license.service', () => ({
  issueLicenseForBusiness: async () => ({}),
  readDeviceBinding: async () => null,
}));

import { cloudPushOperations } from '../src/controllers/sync-cloud-api.controller';

function mockRes() {
  const res: any = { statusCode: 200, body: null };
  res.status = (code: number) => { res.statusCode = code; return res; };
  res.json = (body: any) => { res.body = body; return res; };
  return res;
}

async function push(operations: any[]) {
  const req: any = {
    user: { id: 'user-1' },
    body: { businessId: 'biz-1', operations },
  };
  const res = mockRes();
  await cloudPushOperations(req, res);
  return res;
}

const STALE_PERIOD_END = '2026-11-19T02:32:37.811Z'; // the incident's stale value

beforeEach(() => {
  writes.businessSubscription.length = 0;
  writes.subscriptionAddon.length = 0;
  writes.category.length = 0;
});

describe('cloud-authoritative subscription state (v1.0.19.1)', () => {
  it('a stale subscription UPDATE cannot change cloud subscription fields', async () => {
    const res = await push([{
      id: 'op-1',
      idempotencyKey: 'op-1',
      entityType: 'subscription',
      entityId: 'sub-row-1',
      operation: 'UPDATE',
      payload: {
        id: 'sub-row-1',
        businessId: 'biz-1',
        planId: 'starter',
        status: 'ACTIVE',
        currentPeriodEnd: STALE_PERIOD_END,
        updatedAt: STALE_PERIOD_END,
      },
    }]);
    expect(res.statusCode).toBe(200);
    const result = res.body.data.results[0];
    expect(result.status).toBe('REJECTED');
    expect(writes.businessSubscription).toHaveLength(0);
    expect(cloudRow.currentPeriodEnd.toISOString()).toBe('2026-12-11T11:39:00.000Z');
  });

  it('a subscription CREATE is rejected under the businessSubscription spelling too', async () => {
    const res = await push([{
      id: 'op-2',
      idempotencyKey: 'op-2',
      entityType: 'businessSubscription',
      entityId: 'sub-row-2',
      operation: 'CREATE',
      payload: { id: 'sub-row-2', businessId: 'biz-1', planId: 'starter', status: 'ACTIVE', currentPeriodEnd: STALE_PERIOD_END },
    }]);
    expect(res.body.data.results[0].status).toBe('REJECTED');
    expect(writes.businessSubscription).toHaveLength(0);
  });

  it('subscriptionAddon pushes are rejected as entitlement state', async () => {
    const res = await push([{
      id: 'op-3',
      idempotencyKey: 'op-3',
      entityType: 'subscriptionAddon',
      entityId: 'addon-1',
      operation: 'CREATE',
      payload: { id: 'addon-1', businessId: 'biz-1', type: 'EXTRA_BRANCH', quantity: 5, status: 'ACTIVE' },
    }]);
    expect(res.body.data.results[0].status).toBe('REJECTED');
    expect(writes.subscriptionAddon).toHaveLength(0);
  });

  it('control: an ordinary operational entity still pushes normally', async () => {
    const res = await push([{
      id: 'op-4',
      idempotencyKey: 'op-4',
      entityType: 'category',
      entityId: 'cat-1',
      operation: 'CREATE',
      payload: { id: 'cat-1', companyId: 'biz-1', name: 'Syrups' },
    }]);
    expect(res.body.data.results[0].status).toBe('ACCEPTED');
    expect(writes.category).toHaveLength(1);
  });
});
