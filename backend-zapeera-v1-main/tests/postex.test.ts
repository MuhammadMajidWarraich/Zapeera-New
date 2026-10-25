// ─── PostEx integration tests (feature/integration-postex) ───────────────
// Handler-level tests with a stubbed PostEx HTTP layer — NEVER hits live
// PostEx, no real credentials anywhere (fixtures only). Covers the OAuth
// token flow (acquire/cache/refresh-on-401), shipment-create mapping
// (incl. COD math), tracking lookup, cancel/return, the webhook receiver,
// and the fail-closed behaviour when no API base URL is configured.
//
// NOTE on endpoints: PostEx publishes no public docs, so the paths the
// client calls are UNVERIFIED placeholders (see src/integrations/postex/
// client.ts). These tests assert the client/handler *logic* against those
// placeholder paths via the mock — they do NOT prove the paths are the
// real PostEx paths. That proof needs a live merchant account.
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as crypto from 'crypto';
import { clearIntegrationHandlers, registerIntegrationHandler } from '../src/integrations/registry';
import { IntegrationError } from '../src/integrations/vendor-client';
import {
  cancelShipment,
  connectProvider,
  getConnectionStatus,
  getShipmentTracking,
  returnShipment,
  triggerSync
} from '../src/services/integration.service';
import { createPostExHandler, processPostExWebhook } from '../src/integrations/postex/handler';
import { buildPostExOrderPayload } from '../src/integrations/postex/handler';
import { clearPostExTokenCache } from '../src/integrations/postex/client';

const TEST_KEY = crypto.randomBytes(32).toString('hex');
const BUSINESS_ID = 'biz-postex-test';
const CREDS = { clientId: 'postex-client-1', clientSecret: 'postex-secret-1', companyCode: 'CMP-1' };
const BASE_URL = 'https://postex.test';

// ─── Mock PostEx HTTP layer ───────────────────────────────────────────────
// Records every call; answers from canned fixtures keyed by URL suffix.
// Token grants rotate tok-1 -> tok-2 so the 401-refresh test can force a
// refresh; /orders rejects Bearer tok-1 with 401 when `failFirstOrder` is set.
interface MockCall {
  url: string;
  method: string;
  auth?: string;
  body?: any;
}

function createMockFetch(opts: { failFirstOrder?: boolean; createWithoutLabel?: boolean } = {}) {
  const calls: MockCall[] = [];
  let tokenGrants = 0;
  const fetchImpl = async (url: string, init: RequestInit = {}): Promise<Response> => {
    let body: any;
    try {
      body = init.body ? JSON.parse(String(init.body)) : undefined;
    } catch {
      body = undefined;
    }
    calls.push({
      url,
      method: String(init.method ?? 'GET'),
      auth: (init.headers as any)?.Authorization,
      body
    });
    const json = (status: number, payload: any) =>
      new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.endsWith('/oauth/token')) {
      tokenGrants += 1;
      return json(200, { access_token: tokenGrants === 1 ? 'tok-1' : 'tok-2', expires_in: 3600 });
    }
    if (url.endsWith('/orders') && String(init.method) === 'POST') {
      if (opts.failFirstOrder && (init.headers as any)?.Authorization === 'Bearer tok-1') {
        return json(401, { error: 'invalid_token' });
      }
      return json(200, {
        data: {
          trackingNumber: '20140450012345',
          shipmentId: 'SHIP-1',
          ...(opts.createWithoutLabel
            ? {}
            : { labelUrl: 'https://postex.test/labels/20140450012345.pdf' }),
          status: 'BOOKED'
        }
      });
    }
    if (url.includes('/track')) {
      return json(200, {
        data: {
          status: 'IN_TRANSIT',
          history: [
            { status: 'BOOKED', location: 'Lahore Hub', timestamp: '2026-10-24T10:00:00Z' },
            { status: 'IN_TRANSIT', location: 'Lahore Hub', timestamp: '2026-10-24T12:00:00Z', description: 'Departed hub' }
          ]
        }
      });
    }
    if (url.includes('/label')) {
      return json(200, { data: { labelUrl: 'https://postex.test/labels/20140450012345.pdf' } });
    }
    if (url.includes('/cancel')) {
      return json(200, { data: { status: 'CANCELLED', success: true } });
    }
    if (url.includes('/return')) {
      return json(200, {
        data: { trackingNumber: '20140450099999', shipmentId: 'SHIP-R1', status: 'RETURN_BOOKED' }
      });
    }
    return json(404, { error: 'not_found' });
  };
  return { fetchImpl, calls, tokenGrants: () => tokenGrants };
}

// ─── Minimal in-memory Prisma stand-in (framework FakePrisma + sales) ────
function makeSale(overrides: any = {}) {
  return {
    id: 'sale-1',
    invoiceNumber: 'INV-1001',
    companyId: BUSINESS_ID,
    totalAmount: 5000,
    paidAmount: 0,
    returnedAmount: 0,
    paymentStatus: 'PENDING',
    postexTrackingNumber: null,
    postexShipmentStatus: null,
    customer: { name: 'Ayesha Khan', phone: '03001234567', address: '12 Main Street, Lahore' },
    items: [
      { quantity: 2, product: { name: 'Honey 500g' } },
      { quantity: 1, product: { name: 'Desi Ghee 1kg' } }
    ],
    ...overrides
  };
}

class FakePrisma {
  connections = new Map<string, any>();
  logs: any[] = [];
  sales = new Map<string, any>([['sale-1', makeSale()]]);
  businessRow: any = { id: BUSINESS_ID, name: 'Seikho Medicos', phone: '03009876543', address: '1 Bazaar Road, Lahore' };
  private seq = 0;

  private connKey(businessId: string, provider: string) {
    return `${businessId}::${provider}`;
  }

  integrationConnection = {
    findMany: async ({ where }: any) =>
      [...this.connections.values()].filter((r) => r.businessId === where.businessId),
    findUnique: async ({ where }: any) =>
      this.connections.get(this.connKey(where.businessId_provider.businessId, where.businessId_provider.provider)) ?? null,
    upsert: async ({ where, create, update }: any) => {
      const key = this.connKey(where.businessId_provider.businessId, where.businessId_provider.provider);
      const existing = this.connections.get(key);
      const row = existing
        ? { ...existing, ...update, updatedAt: new Date() }
        : { id: `conn-${++this.seq}`, ...create, createdAt: new Date(), updatedAt: new Date() };
      this.connections.set(key, row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const key = this.connKey(where.businessId_provider.businessId, where.businessId_provider.provider);
      const existing = this.connections.get(key);
      if (!existing) throw new Error('Record to update not found.');
      const row = { ...existing, ...data, updatedAt: new Date() };
      this.connections.set(key, row);
      return row;
    }
  };

  integrationSyncLog = {
    create: async ({ data }: any) => {
      const row = { id: `log-${++this.seq}`, ...data };
      this.logs.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = this.logs.find((l) => l.id === where.id);
      if (!row) throw new Error('Record to update not found.');
      Object.assign(row, data);
      return row;
    },
    findMany: async ({ where, orderBy, take, skip }: any) => {
      let rows = this.logs.filter((l) => l.businessId === where.businessId && l.provider === where.provider);
      if (orderBy?.startedAt === 'desc') rows = [...rows].sort((a, b) => +b.startedAt - +a.startedAt);
      return rows.slice(skip || 0, (skip || 0) + (take ?? rows.length));
    },
    count: async ({ where }: any) =>
      this.logs.filter((l) => l.businessId === where.businessId && l.provider === where.provider).length
  };

  sale = {
    findUnique: async ({ where }: any) => this.sales.get(where.id) ?? null,
    findFirst: async ({ where }: any) => {
      for (const sale of this.sales.values()) {
        const matches = Object.entries(where ?? {}).every(([k, v]) => (sale as any)[k] === v);
        if (matches) return sale;
      }
      return null;
    },
    update: async ({ where, data }: any) => {
      const sale = this.sales.get(where.id);
      if (!sale) throw new Error('Record to update not found.');
      Object.assign(sale, data);
      return sale;
    }
  };

  business = {
    findUnique: async ({ where }: any) => (where.id === BUSINESS_ID ? this.businessRow : null)
  };
}

describe('PostEx handler', () => {
  const originalKey = process.env.INTEGRATION_ENCRYPTION_KEY;
  const originalBaseUrl = process.env.POSTEX_API_BASE_URL;
  const originalSandboxUrl = process.env.POSTEX_SANDBOX_API_BASE_URL;
  let prisma: FakePrisma;
  let mock: ReturnType<typeof createMockFetch>;

  const register = (fetchImpl: any, baseUrl: string | undefined = BASE_URL) => {
    clearIntegrationHandlers();
    registerIntegrationHandler(createPostExHandler({ fetchImpl, baseUrl }));
  };

  beforeEach(() => {
    process.env.INTEGRATION_ENCRYPTION_KEY = TEST_KEY;
    delete process.env.POSTEX_API_BASE_URL;
    delete process.env.POSTEX_SANDBOX_API_BASE_URL;
    clearIntegrationHandlers();
    clearPostExTokenCache();
    prisma = new FakePrisma();
    mock = createMockFetch();
    register(mock.fetchImpl);
  });

  afterEach(() => {
    clearIntegrationHandlers();
    if (originalKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
    else process.env.INTEGRATION_ENCRYPTION_KEY = originalKey;
    if (originalBaseUrl === undefined) delete process.env.POSTEX_API_BASE_URL;
    else process.env.POSTEX_API_BASE_URL = originalBaseUrl;
    if (originalSandboxUrl === undefined) delete process.env.POSTEX_SANDBOX_API_BASE_URL;
    else process.env.POSTEX_SANDBOX_API_BASE_URL = originalSandboxUrl;
  });

  const connect = () => connectProvider(prisma as any, BUSINESS_ID, 'postex', CREDS);

  it('connects via the OAuth token grant and caches the token', async () => {
    const view = await connect();
    expect(view).toMatchObject({ provider: 'postex', status: 'connected', hasCredentials: true });
    // Token endpoint called once for the connect …
    expect(mock.calls.filter((c) => c.url.endsWith('/oauth/token'))).toHaveLength(1);
    const tokenCall = mock.calls.find((c) => c.url.endsWith('/oauth/token'))!;
    expect(tokenCall.body).toMatchObject({
      grant_type: 'client_credentials',
      client_id: 'postex-client-1',
      client_secret: 'postex-secret-1',
      company_code: 'CMP-1'
    });
    // … and NOT again for a status check (in-memory cache reused).
    const status = await getConnectionStatus(prisma as any, BUSINESS_ID, 'postex');
    expect(status.remoteOk).toBe(true);
    expect(mock.calls.filter((c) => c.url.endsWith('/oauth/token'))).toHaveLength(1);
  });

  it('fails closed when no API base URL is configured (never pretends to verify)', async () => {
    register(mock.fetchImpl, undefined);
    const handler = createPostExHandler({ fetchImpl: mock.fetchImpl });
    const result = await handler.connect(CREDS);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/base URL is not configured/i);
    expect(mock.calls).toHaveLength(0); // no vendor call was even attempted
  });

  it('returns ok:false (not a throw) when the vendor rejects the credentials', async () => {
    const failingFetch = async (): Promise<Response> =>
      new Response(JSON.stringify({ error: 'invalid_client' }), { status: 401 });
    register(failingFetch);
    const handler = createPostExHandler({ fetchImpl: failingFetch, baseUrl: BASE_URL });
    await expect(handler.connect(CREDS)).resolves.toMatchObject({ ok: false });
  });

  it('maps a sale to a PostEx order: recipient from the customer, COD from the unpaid balance', () => {
    const payload = buildPostExOrderPayload({
      saleId: 'sale-1',
      orderRef: 'INV-1001',
      recipient: { name: 'Ayesha Khan', phone: '03001234567', address: '12 Main Street, Lahore' },
      paymentMethod: 'COD',
      codAmount: 5000,
      parcel: { pieces: 3, description: 'Honey 500g, Desi Ghee 1kg' },
      sender: { name: 'Seikho Medicos', phone: '03009876543', address: '1 Bazaar Road, Lahore' }
    });
    expect(payload).toMatchObject({
      orderRef: 'INV-1001',
      recipientName: 'Ayesha Khan',
      recipientPhone: '03001234567',
      paymentMethod: 'COD',
      codAmount: 5000,
      pieces: 3,
      senderName: 'Seikho Medicos'
    });
  });

  it('books a shipment from an unpaid sale: COD = full balance, tracking stored on the sale', async () => {
    await connect();
    const { log, result } = await triggerSync(prisma as any, BUSINESS_ID, 'postex', {
      entity: 'shipment',
      saleRef: 'INV-1001'
    });
    expect(log.status).toBe('success');
    expect(result.recordsProcessed).toBe(1);
    expect(result.message).toMatch(/tracking 20140450012345/);
    expect(result.message).toMatch(/COD Rs 5000/);
    expect(result.message).toMatch(/AWB label: https:\/\/postex\.test\/labels\/20140450012345\.pdf/);
    const createCall = mock.calls.find((c) => c.url.endsWith('/orders'));
    expect(createCall?.body).toMatchObject({
      recipientName: 'Ayesha Khan',
      paymentMethod: 'COD',
      codAmount: 5000,
      pieces: 3
    });
    expect(prisma.sales.get('sale-1')).toMatchObject({
      postexTrackingNumber: '20140450012345',
      postexShipmentStatus: 'BOOKED'
    });
  });

  it('books by sale id, charges only the unpaid balance, and books prepaid when fully paid', async () => {
    await connect();
    prisma.sales.get('sale-1').paidAmount = 2000;
    const partial = await triggerSync(prisma as any, BUSINESS_ID, 'postex', {
      entity: 'shipment',
      saleRef: 'sale-1'
    });
    expect(partial.result.message).toMatch(/COD Rs 3000/);
    expect(mock.calls.find((c) => c.url.endsWith('/orders'))?.body).toMatchObject({
      paymentMethod: 'COD',
      codAmount: 3000
    });

    // Fully-paid sale books as PREPAID with COD 0.
    prisma.sales.set('sale-2', makeSale({ id: 'sale-2', invoiceNumber: 'INV-1002', paidAmount: 5000 }));
    const prepaid = await triggerSync(prisma as any, BUSINESS_ID, 'postex', {
      entity: 'shipment',
      saleRef: 'INV-1002'
    });
    expect(prepaid.result.message).toMatch(/prepaid/);
    const prepaidCall = mock.calls.filter((c) => c.url.endsWith('/orders')).pop();
    expect(prepaidCall?.body).toMatchObject({ paymentMethod: 'PREPAID', codAmount: 0 });
  });

  it('fetches the AWB label when the create response carries no label URL', async () => {
    mock = createMockFetch({ createWithoutLabel: true });
    register(mock.fetchImpl);
    await connect();
    const { result } = await triggerSync(prisma as any, BUSINESS_ID, 'postex', {
      entity: 'shipment',
      saleRef: 'sale-1'
    });
    expect(result.message).toMatch(/AWB label: https:\/\/postex\.test\/labels\/20140450012345\.pdf/);
    expect(mock.calls.some((c) => c.url.includes('/label'))).toBe(true);
  });

  it('refuses to book the same sale twice (and writes no second log row)', async () => {
    await connect();
    await triggerSync(prisma as any, BUSINESS_ID, 'postex', { entity: 'shipment', saleRef: 'sale-1' });
    await expect(
      triggerSync(prisma as any, BUSINESS_ID, 'postex', { entity: 'shipment', saleRef: 'sale-1' })
    ).rejects.toMatchObject({ code: 'SYNC_FAILED' });
    expect(prisma.logs).toHaveLength(1);
  });

  it('rejects a shipment sync with no saleRef (no log row)', async () => {
    await connect();
    await expect(
      triggerSync(prisma as any, BUSINESS_ID, 'postex', { entity: 'shipment' })
    ).rejects.toMatchObject({ code: 'SYNC_FAILED' });
    expect(prisma.logs).toHaveLength(0);
  });

  it('refreshes the token once after a 401 and retries the booking', async () => {
    mock = createMockFetch({ failFirstOrder: true });
    register(mock.fetchImpl);
    await connect();
    const { result } = await triggerSync(prisma as any, BUSINESS_ID, 'postex', {
      entity: 'shipment',
      saleRef: 'sale-1'
    });
    expect(result.recordsProcessed).toBe(1);
    expect(mock.tokenGrants()).toBe(2); // connect grant + refreshed grant
    const orderCalls = mock.calls.filter((c) => c.url.endsWith('/orders'));
    expect(orderCalls).toHaveLength(2);
    expect(orderCalls[1].auth).toBe('Bearer tok-2');
  });

  it('looks up tracking + history and refreshes the stored carrier status', async () => {
    await connect();
    await triggerSync(prisma as any, BUSINESS_ID, 'postex', { entity: 'shipment', saleRef: 'sale-1' });
    const tracking = await getShipmentTracking(prisma as any, BUSINESS_ID, 'postex', '20140450012345');
    expect(tracking).toMatchObject({ trackingNumber: '20140450012345', status: 'IN_TRANSIT' });
    expect(tracking.events).toHaveLength(2);
    expect(tracking.events[1]).toMatchObject({ status: 'IN_TRANSIT', location: 'Lahore Hub' });
    expect(prisma.sales.get('sale-1').postexShipmentStatus).toBe('IN_TRANSIT');
  });

  it('cancels a shipment and marks the sale CANCELLED', async () => {
    await connect();
    await triggerSync(prisma as any, BUSINESS_ID, 'postex', { entity: 'shipment', saleRef: 'sale-1' });
    const result = await cancelShipment(prisma as any, BUSINESS_ID, 'postex', '20140450012345');
    expect(result.recordsProcessed).toBe(1);
    expect(result.message).toMatch(/cancelled/i);
    expect(prisma.sales.get('sale-1').postexShipmentStatus).toBe('CANCELLED');
  });

  it('books a return leg with a NEW tracking number and leaves the outbound one on the sale', async () => {
    await connect();
    await triggerSync(prisma as any, BUSINESS_ID, 'postex', { entity: 'shipment', saleRef: 'sale-1' });
    const ret = await returnShipment(prisma as any, BUSINESS_ID, 'postex', '20140450012345');
    expect(ret.trackingNumber).toBe('20140450099999');
    expect(ret.status).toBe('RETURN_BOOKED');
    expect(ret.codAmount).toBe(0);
    expect(prisma.sales.get('sale-1').postexTrackingNumber).toBe('20140450012345');
  });

  it('returns 501 for tracking/cancel when the provider is not connected', async () => {
    await expect(
      getShipmentTracking(prisma as any, BUSINESS_ID, 'postex', '20140450012345')
    ).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  });

  describe('webhook receiver (no signature verification — none is published)', () => {
    it('updates the sale status from a push payload and reports matched:true', async () => {
      prisma.sales.get('sale-1').postexTrackingNumber = '20140450012345';
      prisma.sales.get('sale-1').postexShipmentStatus = 'BOOKED';
      const outcome = await processPostExWebhook(prisma as any, {
        data: { trackingNumber: '20140450012345', status: 'delivered' }
      });
      expect(outcome).toMatchObject({ received: true, matched: true, status: 'DELIVERED' });
      expect(prisma.sales.get('sale-1').postexShipmentStatus).toBe('DELIVERED');
    });

    it('reports matched:false for an unknown tracking number (and writes nothing)', async () => {
      const outcome = await processPostExWebhook(prisma as any, {
        trackingNumber: '20140000000000',
        status: 'DELIVERED'
      });
      expect(outcome).toEqual({ received: true, matched: false, trackingNumber: '20140000000000', status: 'DELIVERED' });
    });

    it('accepts a payload with no tracking number without throwing', async () => {
      await expect(processPostExWebhook(prisma as any, { status: 'DELIVERED' })).resolves.toEqual({
        received: true,
        matched: false
      });
    });
  });
});
