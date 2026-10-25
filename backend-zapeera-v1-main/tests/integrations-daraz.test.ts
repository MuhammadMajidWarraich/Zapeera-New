import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as crypto from 'crypto';
import { DarazClient, buildDarazSign } from '../src/integrations/daraz/client';
import {
  darazHandler,
  setDarazFetch,
  setDarazSaleCreator
} from '../src/integrations/daraz/handler';
// Importing the module registers the handler (the providers barrel line).
import '../src/integrations/daraz';
import {
  getProviderEntry,
  isProviderConnectable,
  clearIntegrationHandlers,
  registerIntegrationHandler
} from '../src/integrations/registry';
import { DEFAULT_SYNC_CONFIG } from '../src/integrations/types';
import type { IntegrationSyncContext } from '../src/integrations/types';

const CREDS = {
  appKey: 'test-app-key',
  appSecret: 'test-app-secret',
  accessToken: 'test-access-token',
  refreshToken: 'test-refresh-token'
};
const BUSINESS_ID = 'biz-daraz-test';
const BRANCH_ID = 'branch-1';

// ─── Mock Daraz HTTP layer ──────────────────────────────────────────────────
// Records every request; routes by API path; never touches live Daraz.

interface CapturedRequest {
  url: string;
  apiPath: string;
  params: Record<string, string>;
}

type RouteHandler = (params: Record<string, string>) => any;

class DarazFetchMock {
  calls: CapturedRequest[] = [];
  routes = new Map<string, RouteHandler>();

  on(apiPath: string, handler: RouteHandler): void {
    this.routes.set(apiPath, handler);
  }

  fetch = (async (url: string, init?: any): Promise<any> => {
    const body = typeof init?.body === 'string' ? init.body : '';
    const params: Record<string, string> = {};
    new URLSearchParams(body).forEach((value, key) => {
      params[key] = value;
    });
    const apiPath = String(url).replace(/^.*\/rest/, '');
    this.calls.push({ url: String(url), apiPath, params });
    const handler = this.routes.get(apiPath);
    if (!handler) {
      return { ok: false, status: 404, json: async () => ({ code: '404', message: 'no mock route' }) };
    }
    const envelope = handler(params);
    if (envelope?.__httpStatus) {
      return {
        ok: false,
        status: envelope.__httpStatus,
        json: async () => ({ code: String(envelope.__httpStatus), message: 'http error' })
      };
    }
    return { ok: true, status: 200, json: async () => envelope };
  }) as unknown as typeof fetch;

  callsTo(apiPath: string): CapturedRequest[] {
    return this.calls.filter((c) => c.apiPath === apiPath);
  }

  lastCallTo(apiPath: string): CapturedRequest | undefined {
    const list = this.callsTo(apiPath);
    return list[list.length - 1];
  }
}

/** Independent re-implementation of the signing rule (test-side oracle). */
function oracleSign(apiPath: string, params: Record<string, string>, secret: string): string {
  const keys = Object.keys(params)
    .filter((k) => k !== 'sign')
    .sort();
  let s = apiPath;
  for (const k of keys) s += k + params[k];
  return crypto.createHmac('sha256', secret).update(s, 'utf8').digest('hex').toUpperCase();
}

// ─── Fake Prisma (in-memory stand-in for the calls the handler makes) ──────

class FakePrisma {
  branches: any[] = [{ id: BRANCH_ID, name: 'Main', companyId: BUSINESS_ID, isActive: true, createdAt: new Date('2026-01-01') }];
  businessRow: any = { id: BUSINESS_ID, createdBy: 'user-owner' };
  users: Record<string, any> = { 'user-owner': { id: 'user-owner' } };
  memberships: any[] = [];
  products: any[] = [
    { id: 'prod-a', sku: 'SKU-A', name: 'Product A', description: 'A desc', companyId: BUSINESS_ID, branchId: BRANCH_ID, isActive: true },
    { id: 'prod-b', sku: 'SKU-B', name: 'Product B', description: null, companyId: BUSINESS_ID, branchId: BRANCH_ID, isActive: true }
  ];
  batches: any[] = [
    { productId: 'prod-a', quantity: 10, sellingPrice: 100, expireDate: null, createdAt: new Date('2026-10-20'), branchId: BRANCH_ID, isActive: true },
    { productId: 'prod-a', quantity: 5, sellingPrice: 100, expireDate: new Date('2020-01-01'), createdAt: new Date('2026-10-19'), branchId: BRANCH_ID, isActive: true },
    { productId: 'prod-b', quantity: 3, sellingPrice: 250, expireDate: null, createdAt: new Date('2026-10-20'), branchId: BRANCH_ID, isActive: true }
  ];
  // Imported sales, keyed by Daraz order number.
  importedSales = new Map<string, any>();
  // Sales by id (for the service's shipment input builder).
  salesById = new Map<string, any>();
  saleItems: any[] = [];
  syncLogs: any[] = [];
  private logSeq = 0;
  customers: any[] = [];
  connection: any = {
    businessId: BUSINESS_ID,
    provider: 'daraz',
    status: 'connected',
    config: JSON.stringify({ syncProducts: true, syncStock: true, syncOrders: true, direction: 'both' }),
    encryptedCredentials: 'encrypted-stub'
  };
  saleUpdates: any[] = [];
  customerCreates: any[] = [];

  branch = {
    findFirst: async ({ where }: any) =>
      this.branches.find((b) => b.id === where.id && b.companyId === where.companyId) ?? null,
    findMany: async ({ where }: any) =>
      this.branches.filter(
        (b) => b.companyId === where.companyId && (where.isActive === undefined || b.isActive === where.isActive)
      )
  };
  business = {
    findUnique: async ({ where }: any) => (where.id === this.businessRow.id ? this.businessRow : null)
  };
  zapeeraUser = {
    findUnique: async ({ where }: any) => this.users[where.id] ?? null
  };
  membership = {
    findMany: async () => this.memberships
  };
  product = {
    findMany: async ({ where }: any) => {
      if (where?.id?.in) {
        return this.products.filter((p) => where.id.in.includes(p.id));
      }
      return this.products.filter(
        (p) =>
          p.companyId === where.companyId &&
          (where.branchId === undefined || p.branchId === where.branchId) &&
          (where.isActive === undefined || p.isActive === where.isActive)
      );
    },
    findFirst: async ({ where }: any) =>
      this.products.find(
        (p) =>
          p.sku === where.sku && p.companyId === where.companyId && p.branchId === where.branchId
      ) ?? null
  };
  batch = {
    findMany: async ({ where }: any) =>
      this.batches.filter(
        (b) =>
          b.branchId === where.branchId &&
          b.isActive === where.isActive &&
          b.quantity > (where.quantity?.gt ?? 0)
      )
  };
  sale = {
    findUnique: async ({ where }: any) => this.salesById.get(where.id) ?? null,
    findFirst: async ({ where }: any) => {
      if (where.externalOrderId) return this.importedSales.get(where.externalOrderId) ?? null;
      if (where.invoiceNumber) {
        return (
          [...this.salesById.values()].find(
            (s) => s.invoiceNumber === where.invoiceNumber && s.companyId === where.companyId
          ) ?? null
        );
      }
      return null;
    },
    update: async ({ where, data }: any) => {
      this.saleUpdates.push({ where, data });
      const sale = [...this.importedSales.values()].find((s) => s.id === where.id);
      if (sale) {
        Object.assign(sale, data);
        if (data.externalOrderId) this.importedSales.set(data.externalOrderId, sale);
        return sale;
      }
      // The fake sale creator pre-registers the sale under its id; the
      // stamp moves it under the Daraz order number.
      const created = (this as any)._pendingSale;
      if (created && created.id === where.id) {
        Object.assign(created, data);
        if (data.externalOrderId) this.importedSales.set(data.externalOrderId, created);
        return created;
      }
      throw new Error('Record to update not found.');
    }
  };
  customer = {
    findUnique: async ({ where }: any) => this.customers.find((c) => c.id === where.id) ?? null,
    findFirst: async ({ where }: any) =>
      this.customers.find((c) => c.phone === where.phone && c.companyId === where.companyId) ?? null,
    create: async ({ data }: any) => {
      const row = { id: `cust-${this.customers.length + 1}`, ...data };
      this.customers.push(row);
      this.customerCreates.push(row);
      return row;
    }
  };
  saleItem = {
    findMany: async ({ where }: any) => this.saleItems.filter((i) => i.saleId === where.saleId)
  };
  integrationSyncLog = {
    create: async ({ data }: any) => {
      const row = { id: `log-${++this.logSeq}`, ...data };
      this.syncLogs.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = this.syncLogs.find((l) => l.id === where.id);
      if (!row) throw new Error('Record to update not found.');
      Object.assign(row, data);
      return row;
    }
  };
  integrationConnection = {
    findUnique: async () => this.connection,
    update: async ({ data }: any) => {
      Object.assign(this.connection, data);
      return this.connection;
    }
  };
}

function makeCtx(prisma: FakePrisma, configOverrides: Record<string, any> = {}): IntegrationSyncContext {
  return {
    prisma: prisma as any,
    businessId: BUSINESS_ID,
    credentials: { ...CREDS },
    config: { ...DEFAULT_SYNC_CONFIG, ...configOverrides },
    logId: 'log-1'
  };
}

function darazProductEnvelope(products: Array<{ itemId: string; skus: Array<{ SellerSku: string; price: number; quantity: number }> }>) {
  return {
    code: '0',
    data: {
      total_products: products.length,
      products: products.map((p) => ({
        item_id: p.itemId,
        status: 'active',
        attributes: { name: `Daraz ${p.itemId}` },
        skus: p.skus.map((s) => ({ SellerSku: s.SellerSku, price: s.price, quantity: s.quantity }))
      }))
    }
  };
}

const ORDER_A = {
  order_number: 'DZ-1001',
  created_at: '2026-10-24T10:00:00Z',
  updated_at: '2026-10-24T10:05:00Z',
  status: 'pending',
  price: 200,
  payment_method: 'COD',
  customer_first_name: 'Test',
  customer_last_name: 'Buyer'
};
const ORDER_B = {
  order_number: 'DZ-1002',
  created_at: '2026-10-24T11:00:00Z',
  updated_at: '2026-10-24T11:05:00Z',
  status: 'canceled',
  price: 100,
  payment_method: 'COD'
};
const ORDER_C = {
  order_number: 'DZ-1003',
  created_at: '2026-10-24T12:00:00Z',
  updated_at: '2026-10-24T12:05:00Z',
  status: 'pending',
  price: 250,
  payment_method: 'COD',
  customer_first_name: 'Second',
  customer_last_name: 'Buyer'
};

describe('daraz HMAC signing', () => {
  it('matches the fixed vectors (api path + sorted key+value, HMAC-SHA256, uppercase hex)', () => {
    expect(
      buildDarazSign(
        '/orders/get',
        { access_token: 'tok_abc', app_key: '123456', sign_method: 'sha256', timestamp: '1700000000000' },
        'my-app-secret'
      )
    ).toBe('195D73420255C6BC4E7964358B113B240C5BF1FD6167AA59C37FB804C5126E3F');
    expect(
      buildDarazSign(
        '/products/get',
        { app_key: 'K', filter: 'all', limit: '1', offset: '0', sign_method: 'sha256', timestamp: '1700000000000' },
        's3cr3t'
      )
    ).toBe('20145B526E29B9E3DD7DF12C517823E6FA1F08947142487F2AD7F80651056874');
  });

  it('excludes `sign` itself and sorts keys before concatenating', () => {
    const params = { b: '2', a: '1', sign: 'STALE' };
    const signed = buildDarazSign('/x', params, 'secret');
    expect(signed).toBe(oracleSign('/x', params, 'secret'));
    expect(signed).toBe(
      crypto.createHmac('sha256', 'secret').update('/xa1b2', 'utf8').digest('hex').toUpperCase()
    );
  });
});

describe('daraz client (mocked HTTP)', () => {
  let mock: DarazFetchMock;

  beforeEach(() => {
    mock = new DarazFetchMock();
  });

  it('signs every request and posts form-encoded params to the PK gateway', async () => {
    mock.on('/products/get', () => darazProductEnvelope([]));
    const client = new DarazClient(CREDS, { fetchFn: mock.fetch, baseUrl: 'https://api.daraz.pk/rest' });
    await client.getProducts({ filter: 'all', offset: 0, limit: 1 });

    expect(mock.calls).toHaveLength(1);
    const call = mock.calls[0];
    expect(call.url).toBe('https://api.daraz.pk/rest/products/get');
    expect(call.params.app_key).toBe('test-app-key');
    expect(call.params.sign_method).toBe('sha256');
    expect(call.params.access_token).toBe('test-access-token');
    expect(call.params.timestamp).toMatch(/^\d{13}$/);
    expect(call.params.sign).toMatch(/^[0-9A-F]{64}$/);
    expect(call.params.sign).toBe(oracleSign('/products/get', call.params, 'test-app-secret'));
  });

  it('maps a non-zero vendor code to VENDOR_ERROR', async () => {
    mock.on('/products/get', () => ({ code: 'InvalidParameter', message: 'bad filter' }));
    const client = new DarazClient(CREDS, { fetchFn: mock.fetch });
    await expect(client.getProducts()).rejects.toMatchObject({ code: 'VENDOR_ERROR' });
  });

  it('refreshes an expired access token once and retries with the new token', async () => {
    let productsCalls = 0;
    mock.on('/products/get', (params) => {
      productsCalls += 1;
      if (productsCalls === 1) return { code: 'InvalidAccessToken', message: 'token expired' };
      return darazProductEnvelope([]);
    });
    mock.on('/auth/token/refresh', () => ({
      code: '0',
      data: { access_token: 'new-access-token', refresh_token: 'new-refresh-token', expires_in: 604800 }
    }));
    const refreshed: any[] = [];
    const client = new DarazClient(CREDS, {
      fetchFn: mock.fetch,
      onTokensRefreshed: async (tokens) => {
        refreshed.push(tokens);
      }
    });
    const result = await client.getProducts();
    expect(result.products).toEqual([]);
    expect(productsCalls).toBe(2);
    expect(mock.lastCallTo('/products/get')?.params.access_token).toBe('new-access-token');
    expect(refreshed).toEqual([{ accessToken: 'new-access-token', refreshToken: 'new-refresh-token' }]);
    expect(client.accessToken).toBe('new-access-token');
  });

  it('fails closed with VENDOR_AUTH when there is no refresh token', async () => {
    mock.on('/products/get', () => ({ code: 'InvalidAccessToken', message: 'token expired' }));
    const client = new DarazClient(
      { appKey: 'k', appSecret: 's', accessToken: 'stale' },
      { fetchFn: mock.fetch }
    );
    await expect(client.getProducts()).rejects.toMatchObject({ code: 'VENDOR_AUTH' });
  });
});

describe('daraz handler', () => {
  let mock: DarazFetchMock;
  let prisma: FakePrisma;
  let saleCreatorCalls: any[];
  let saleSeq = 0;

  beforeEach(() => {
    mock = new DarazFetchMock();
    prisma = new FakePrisma();
    saleCreatorCalls = [];
    saleSeq = 0;
    setDarazFetch(mock.fetch);
    setDarazSaleCreator(async (input) => {
      saleCreatorCalls.push(input);
      const sale = { id: `sale-${++saleSeq}`, ...input };
      (prisma as any)._pendingSale = sale;
      return { saleId: sale.id };
    });
    // Default routes: listings for SKU-A / SKU-B / orphan.
    mock.on('/products/get', () =>
      darazProductEnvelope([
        { itemId: '1001', skus: [{ SellerSku: 'SKU-A', price: 90, quantity: 2 }] },
        { itemId: '1002', skus: [{ SellerSku: 'SKU-B', price: 240, quantity: 1 }] },
        { itemId: '1003', skus: [{ SellerSku: 'SKU-ORPHAN', price: 50, quantity: 7 }] }
      ])
    );
  });

  afterEach(() => {
    setDarazFetch(null);
    setDarazSaleCreator(null);
    clearIntegrationHandlers();
  });

  it('registers as connectable and exposes the token credential fields', () => {
    expect(isProviderConnectable('daraz')).toBe(true);
    const fields = getProviderEntry('daraz')?.credentialFields.map((f) => f.key);
    expect(fields).toEqual(['appKey', 'appSecret', 'accessToken', 'refreshToken']);
  });

  it('connect() verifies with a cheap vendor read and fails closed on auth', async () => {
    const ok = await darazHandler.connect({ ...CREDS });
    expect(ok).toEqual({ ok: true, message: expect.stringContaining('Connected to Daraz') });
    expect(mock.callsTo('/products/get')).toHaveLength(1);

    mock.on('/products/get', () => ({ code: 'InvalidAccessToken', message: 'bad token' }));
    const bad = await darazHandler.connect({ appKey: 'k', appSecret: 's', accessToken: 'bad' });
    expect(bad.ok).toBe(false);
  });

  it('syncStock pushes base-unit stock (expired batches excluded) in branch scope only', async () => {
    mock.on('/product/update/price/quantity', () => ({ code: '0', data: {} }));
    const result = await darazHandler.syncStock!(makeCtx(prisma, { syncStock: true }));

    // SKU-A: 10 sellable (5 expired excluded). SKU-B: 3. Orphan: untouched.
    expect(result.recordsProcessed).toBe(2);
    expect(result.recordsFailed).toBe(0);
    const pushCalls = mock.callsTo('/product/update/price/quantity');
    expect(pushCalls).toHaveLength(1);
    const payload = JSON.parse(pushCalls[0].params.payload);
    const skus = payload.Request.Product.Skus.Sku;
    expect(skus).toContainEqual({ SellerSku: 'SKU-A', price: 100, quantity: 10 });
    expect(skus).toContainEqual({ SellerSku: 'SKU-B', price: 250, quantity: 3 });
    expect(skus.find((s: any) => s.SellerSku === 'SKU-ORPHAN')).toBeUndefined();
  });

  it('syncStock reports a product with no priced batch instead of guessing', async () => {
    prisma.batches = prisma.batches.filter((b) => b.productId !== 'prod-b');
    mock.on('/product/update/price/quantity', () => ({ code: '0', data: {} }));
    const result = await darazHandler.syncStock!(makeCtx(prisma, { syncStock: true }));
    expect(result.recordsProcessed).toBe(1); // SKU-A only
    expect(result.recordsFailed).toBe(1); // SKU-B: no priced batch
    expect(result.message).toMatch(/SKU-B/);
  });

  it('refuses to guess a branch for a multi-branch business', async () => {
    prisma.branches.push({ id: 'branch-2', name: 'Second', companyId: BUSINESS_ID, isActive: true, createdAt: new Date('2026-02-01') });
    await expect(darazHandler.syncStock!(makeCtx(prisma, { syncStock: true }))).rejects.toMatchObject({
      code: 'SYNC_FAILED'
    });
    // Explicit branchId in config resolves it.
    mock.on('/product/update/price/quantity', () => ({ code: '0', data: {} }));
    const result = await darazHandler.syncStock!(makeCtx(prisma, { syncStock: true, branchId: BRANCH_ID }));
    expect(result.recordsProcessed).toBe(2);
  });

  it('syncProducts creates an unlisted product when a Daraz category is configured', async () => {
    // Only SKU-A is listed; SKU-B must be created.
    mock.on('/products/get', () =>
      darazProductEnvelope([{ itemId: '1001', skus: [{ SellerSku: 'SKU-A', price: 90, quantity: 2 }] }])
    );
    mock.on('/product/update/price/quantity', () => ({ code: '0', data: {} }));
    const created: any[] = [];
    mock.on('/product/create', (params) => {
      created.push(JSON.parse(params.payload));
      return { code: '0', data: { item_id: '2002' } };
    });
    const result = await darazHandler.syncProducts!(
      makeCtx(prisma, { syncProducts: true, darazCategoryId: '6614' })
    );
    expect(result.recordsProcessed).toBe(2);
    expect(created).toHaveLength(1);
    expect(created[0].PrimaryCategory).toBe('6614');
    expect(created[0].Skus.Sku[0].SellerSku).toBe('SKU-B');
    expect(created[0].Skus.Sku[0].quantity).toBe(3);
    expect(created[0].Skus.Sku[0].price).toBe(250);
  });

  it('syncProducts reports (does not create) unlisted products without a category', async () => {
    mock.on('/products/get', () =>
      darazProductEnvelope([{ itemId: '1001', skus: [{ SellerSku: 'SKU-A', price: 90, quantity: 2 }] }])
    );
    mock.on('/product/update/price/quantity', () => ({ code: '0', data: {} }));
    const result = await darazHandler.syncProducts!(makeCtx(prisma, { syncProducts: true }));
    expect(result.recordsProcessed).toBe(1);
    expect(result.recordsFailed).toBe(1);
    expect(result.message).toMatch(/SKU-B/);
    expect(mock.callsTo('/product/create')).toHaveLength(0);
  });

  describe('order import (polling)', () => {
    function ordersRoutes(orders: any[], itemsByOrder: Record<string, any[]>) {
      mock.on('/orders/get', (params) => {
        const offset = Number(params.offset ?? 0);
        const limit = Number(params.limit ?? 100);
        const page = orders.slice(offset, offset + limit);
        return { code: '0', data: { count: orders.length, orders: page } };
      });
      mock.on('/order/get', (params) => {
        const header = orders.find((o) => o.order_number === params.order_id) ?? ORDER_A;
        return {
          code: '0',
          data: {
            ...header,
            address_shipping: {
              first_name: header.customer_first_name ?? 'Test',
              last_name: header.customer_last_name ?? 'Buyer',
              phone: '0300 1234567',
              address1: '1 Test St',
              city: 'Lahore',
              country: 'Pakistan'
            }
          }
        };
      });
      mock.on('/order/items/get', (params) => ({
        code: '0',
        data: itemsByOrder[params.order_id] ?? []
      }));
    }

    it('imports a pending order once and is idempotent on the next poll', async () => {
      ordersRoutes([ORDER_A, ORDER_B], {
        'DZ-1001': [
          { order_item_id: '11', order_id: 'DZ-1001', sku: 'SKU-A', item_price: 100, paid_price: 100, quantity: 2 }
        ]
      });
      const first = await darazHandler.importOrders!(makeCtx(prisma, { syncOrders: true }));
      expect(first.recordsProcessed).toBe(1); // DZ-1001; DZ-1002 canceled → skipped
      expect(first.recordsFailed).toBe(0);
      expect(saleCreatorCalls).toHaveLength(1);
      expect(saleCreatorCalls[0].lines).toEqual([{ productId: 'prod-a', quantity: 2, unitPrice: 100 }]);
      expect(saleCreatorCalls[0].branchId).toBe(BRANCH_ID);
      // Sale tagged channel + Daraz order id.
      expect(prisma.saleUpdates).toHaveLength(1);
      expect(prisma.saleUpdates[0].data).toEqual({ channel: 'daraz', externalOrderId: 'DZ-1001' });
      // Buyer matched/created by phone (normalized, spaces stripped).
      expect(prisma.customerCreates).toHaveLength(1);
      expect(prisma.customerCreates[0].phone).toBe('03001234567');

      const second = await darazHandler.importOrders!(makeCtx(prisma, { syncOrders: true }));
      expect(second.recordsProcessed).toBe(0);
      expect(saleCreatorCalls).toHaveLength(1); // no duplicate sale
    });

    it('dedupes an order that appears on two pages of the same poll', async () => {
      ordersRoutes([ORDER_A, ORDER_C, ORDER_A], {
        'DZ-1001': [
          { order_item_id: '11', order_id: 'DZ-1001', sku: 'SKU-A', item_price: 100, paid_price: 100, quantity: 1 }
        ],
        'DZ-1003': [
          { order_item_id: '31', order_id: 'DZ-1003', sku: 'SKU-B', item_price: 250, paid_price: 250, quantity: 1 }
        ]
      });
      // Force pagination: limit 2 per page via a route that honors limit.
      mock.on('/orders/get', (params) => {
        const offset = Number(params.offset ?? 0);
        const limit = 2;
        const all = [ORDER_A, ORDER_C, ORDER_A];
        return { code: '0', data: { count: all.length, orders: all.slice(offset, offset + limit) } };
      });
      const result = await darazHandler.importOrders!(makeCtx(prisma, { syncOrders: true }));
      expect(result.recordsProcessed).toBe(2); // DZ-1001 + DZ-1003, dup skipped
      expect(saleCreatorCalls).toHaveLength(2);
    });

    it('fails the whole order on an unknown SKU and holds the cursor back for retry', async () => {
      ordersRoutes([ORDER_A], {
        'DZ-1001': [
          { order_item_id: '11', order_id: 'DZ-1001', sku: 'SKU-NOPE', item_price: 100, paid_price: 100, quantity: 1 }
        ]
      });
      const result = await darazHandler.importOrders!(makeCtx(prisma, { syncOrders: true }));
      expect(result.recordsProcessed).toBe(0);
      expect(result.recordsFailed).toBe(1);
      expect(result.message).toMatch(/SKU-NOPE/);
      expect(saleCreatorCalls).toHaveLength(0); // no partial sale
      // Cursor held back to just before the failed order (not poll start).
      const stored = JSON.parse(prisma.connection.config);
      expect(new Date(stored.darazLastOrderPollAt).getTime()).toBeLessThan(
        new Date('2026-10-24T10:05:00Z').getTime()
      );
    });

    it('advances the cursor past a clean poll', async () => {
      ordersRoutes([ORDER_A], {
        'DZ-1001': [
          { order_item_id: '11', order_id: 'DZ-1001', sku: 'SKU-A', item_price: 100, paid_price: 100, quantity: 1 }
        ]
      });
      await darazHandler.importOrders!(makeCtx(prisma, { syncOrders: true }));
      const stored = JSON.parse(prisma.connection.config);
      expect(stored.darazLastOrderPollAt).toBeTruthy();
      expect(new Date(stored.darazLastOrderPollAt).getTime()).toBeGreaterThan(
        new Date('2026-10-24T10:05:00Z').getTime()
      );
    });
  });

  describe('shipments (createShipment — generic per-sale shape)', () => {
    const shipmentInput = {
      saleId: 'sale-1',
      saleInvoiceNumber: 'INV-10001',
      channel: 'daraz' as const,
      externalOrderId: 'DZ-1001',
      recipient: { name: 'Test Buyer', phone: '03001234567', address: '1 Test St' },
      codAmount: 200,
      items: [{ productId: 'prod-a', quantity: 2, name: 'Product A' }]
    };

    it('marks a pending Daraz order packed from its Zapeera sale', async () => {
      mock.on('/order/get', () => ({ code: '0', data: { ...ORDER_A, status: 'pending' } }));
      mock.on('/order/items/get', () => ({
        code: '0',
        data: [{ order_item_id: '11', order_id: 'DZ-1001', sku: 'SKU-A' }]
      }));
      const setStatusCalls: any[] = [];
      mock.on('/order/set_status', (params) => {
        setStatusCalls.push(params);
        return { code: '0', data: {} };
      });
      const result = await darazHandler.createShipment!(makeCtx(prisma, {}), shipmentInput);
      expect(result.recordsProcessed).toBe(1);
      expect(setStatusCalls).toHaveLength(1);
      expect(setStatusCalls[0].status).toBe('packed');
      expect(JSON.parse(setStatusCalls[0].order_item_ids)).toEqual(['11']);
      expect(result.message).toMatch(/ready_to_ship/);
    });

    it('is an idempotent no-op when Daraz already shows the order packed', async () => {
      mock.on('/order/get', () => ({ code: '0', data: { ...ORDER_A, status: 'packed' } }));
      const result = await darazHandler.createShipment!(makeCtx(prisma, {}), shipmentInput);
      expect(result.recordsProcessed).toBe(0);
      expect(result.recordsFailed).toBe(0);
      expect(mock.callsTo('/order/set_status')).toHaveLength(0);
    });

    it('refuses a sale that did not come from Daraz', async () => {
      await expect(
        darazHandler.createShipment!(makeCtx(prisma, {}), { ...shipmentInput, channel: null, externalOrderId: null })
      ).rejects.toMatchObject({ code: 'SYNC_FAILED' });
      expect(mock.callsTo('/order/set_status')).toHaveLength(0);
    });
  });

  describe('shipment dispatch through triggerSync (service builds the input)', () => {
    // The parent afterEach clears the handler registry after every
    // test; triggerSync needs the handler registered.
    beforeEach(() => {
      registerIntegrationHandler(darazHandler);
    });

    it('resolves the sale by saleRef, builds CreateShipmentInput, and packs the order', async () => {
      const { encryptIntegrationCredentials } = await import(
        '../src/utils/integration-encryption.util'
      );
      const { triggerSync } = await import('../src/services/integration.service');
      const originalKey = process.env.INTEGRATION_ENCRYPTION_KEY;
      process.env.INTEGRATION_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
      try {
        prisma.salesById.set('sale-1', {
          id: 'sale-1',
          invoiceNumber: 'INV-10001',
          customerId: null,
          totalAmount: 200,
          paidAmount: 0,
          channel: 'daraz',
          externalOrderId: 'DZ-1001',
          companyId: BUSINESS_ID
        });
        prisma.saleItems = [{ saleId: 'sale-1', productId: 'prod-a', quantity: 2 }];
        prisma.connection.encryptedCredentials = encryptIntegrationCredentials({ ...CREDS });
        mock.on('/order/get', () => ({ code: '0', data: { ...ORDER_A, status: 'pending' } }));
        mock.on('/order/items/get', () => ({
          code: '0',
          data: [{ order_item_id: '11', order_id: 'DZ-1001', sku: 'SKU-A' }]
        }));
        mock.on('/order/set_status', () => ({ code: '0', data: {} }));
        const { log, result } = await triggerSync(prisma as any, BUSINESS_ID, 'daraz', {
          entity: 'shipment',
          saleRef: 'INV-10001'
        });
        expect(result.recordsProcessed).toBe(1);
        expect(log.status).toBe('success');
        expect(mock.callsTo('/order/set_status')).toHaveLength(1);
      } finally {
        if (originalKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
        else process.env.INTEGRATION_ENCRYPTION_KEY = originalKey;
      }
    });

    it('fails with no log row for an unknown saleRef', async () => {
      const { triggerSync } = await import('../src/services/integration.service');
      const originalKey = process.env.INTEGRATION_ENCRYPTION_KEY;
      process.env.INTEGRATION_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
      try {
        const { encryptIntegrationCredentials } = await import(
          '../src/utils/integration-encryption.util'
        );
        prisma.connection.encryptedCredentials = encryptIntegrationCredentials({ ...CREDS });
        const logsBefore = prisma.syncLogs.length;
        await expect(
          triggerSync(prisma as any, BUSINESS_ID, 'daraz', { entity: 'shipment', saleRef: 'INV-NOPE' })
        ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
        expect(prisma.syncLogs.length).toBe(logsBefore); // no log row created
      } finally {
        if (originalKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
        else process.env.INTEGRATION_ENCRYPTION_KEY = originalKey;
      }
    });
  });
});
