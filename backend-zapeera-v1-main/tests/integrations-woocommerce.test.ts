// WooCommerce integration tests (feature/integration-woocommerce).
// The vendor HTTP layer is fully mocked (global.fetch stub) — no live
// store, no real credentials anywhere; fixtures only. The sale engine is
// stubbed at the sale-invoker seam: these tests prove the handler maps,
// tags and counts correctly, NOT that createSale works (that is the
// existing sale engine's own suite).
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as crypto from 'crypto';
import { encryptIntegrationCredentials } from '../src/utils/integration-encryption.util';
import {
  getIntegrationHandler,
  getProviderEntry,
  isProviderConnectable
} from '../src/integrations/registry';
import { IntegrationError } from '../src/integrations/vendor-client';
import { normalizeStoreUrl, parseWooCredentials } from '../src/integrations/woocommerce/client';
import {
  buildSalePayloadFromWooOrder,
  buildWooProductPayload,
  buildWooVariationPayload,
  isImportableWooOrder,
  mapWooPaymentMethod,
  parseWooMoney,
  parseWooOrderId,
  wooOrderReference,
  type WcOrder,
  type ZapeeraProductForPush
} from '../src/integrations/woocommerce/mapping';
import {
  resolveBoundBranch,
  woocommerceHandler
} from '../src/integrations/woocommerce/handler';
import { verifyWooCommerceWebhookSignature, handleWooCommerceWebhook } from '../src/integrations/woocommerce/webhook';
import * as saleInvoker from '../src/integrations/woocommerce/sale-invoker';

const BIZ = 'biz-woo-test';
const BRANCH = 'branch-1';
const CREDS = { storeUrl: 'https://store.example', consumerKey: 'ck_test', consumerSecret: 'cs_test' };
const CONFIG = { syncProducts: true, syncStock: true, syncOrders: true, syncCustomers: false, direction: 'both' as const };

// ─── fetch stub ─────────────────────────────────────────────────────────────

type FetchRoute = (url: string, init: any) => { status: number; body: any } | null;

let fetchCalls: Array<{ url: string; init: any }> = [];
let fetchRoutes: FetchRoute[] = [];

function jsonResponse(status: number, body: any) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'x-wp-totalpages' ? '1' : null) },
    json: async () => body
  };
}

function installFetch(routes: FetchRoute[]) {
  fetchCalls = [];
  fetchRoutes = routes;
  (global as any).fetch = jest.fn(async (url: string, init: any = {}) => {
    fetchCalls.push({ url, init });
    for (const route of fetchRoutes) {
      const hit = route(url, init);
      if (hit) return jsonResponse(hit.status, hit.body);
    }
    return jsonResponse(404, { code: 'woocommerce_rest_not_found', message: 'not found' });
  });
}

// ─── Fake prisma (only the delegates the handler touches) ───────────────────

class WooFakePrisma {
  branches: any[] = [
    { id: BRANCH, name: 'Main Branch', companyId: BIZ, isActive: true, createdAt: new Date('2026-01-01') }
  ];
  products: any[] = [];
  batches: any[] = [];
  customers: any[] = [];
  sales: any[] = [];
  logs: any[] = [];
  businessRow: any = { id: BIZ, createdBy: 'user-owner' };
  users: any[] = [{ id: 'user-owner' }];
  memberships: any[] = [
    { id: 'mem-1', businessId: BIZ, userId: 'user-owner', status: 'ACTIVE', createdAt: new Date('2026-01-01') }
  ];
  connectionRow: any = null;
  private seq = 0;

  branch = {
    findMany: async ({ where }: any) =>
      this.branches.filter(
        (b) => (!where?.companyId || b.companyId === where.companyId) && (!where?.isActive || b.isActive === where.isActive)
      )
  };
  business = {
    findUnique: async () => this.businessRow
  };
  zapeeraUser = {
    findUnique: async ({ where }: any) => this.users.find((u) => u.id === where.id) ?? null
  };
  membership = {
    findFirst: async ({ where }: any) =>
      this.memberships.find(
        (m) =>
          (!where?.businessId || m.businessId === where.businessId) &&
          (!where?.userId || m.userId === where.userId) &&
          (!where?.status || m.status === where.status)
      ) ?? null
  };
  product = {
    findMany: async ({ where }: any) =>
      this.products.filter(
        (p) =>
          (!where?.companyId || p.companyId === where.companyId) &&
          (!where?.branchId || p.branchId === where.branchId) &&
          (where?.isActive === undefined || p.isActive === where.isActive)
      ),
    findUnique: async ({ where }: any) => this.products.find((p) => p.sku === where.sku) ?? null
  };
  productVariant = {
    findFirst: async ({ where }: any) => {
      for (const p of this.products) {
        for (const v of p.variants ?? []) {
          if (v.productId === where.productId && v.sku === where.sku) return v;
        }
      }
      return null;
    }
  };
  batch = {
    findMany: async ({ where, orderBy, take }: any) => {
      let rows = this.batches.filter(
        (b) =>
          (!where?.productId || b.productId === where.productId) &&
          (!where?.branchId || b.branchId === where.branchId) &&
          (where?.isActive === undefined || b.isActive === where.isActive) &&
          (where?.variantId === undefined || b.variantId === where.variantId) &&
          (!where?.quantity?.gt || b.quantity > where.quantity.gt)
      );
      if (orderBy?.createdAt === 'desc') rows = [...rows].sort((a, b) => +b.createdAt - +a.createdAt);
      return take ? rows.slice(0, take) : rows;
    }
  };
  customer = {
    findFirst: async ({ where }: any) =>
      this.customers.find(
        (c) =>
          (!where?.companyId || c.companyId === where.companyId) &&
          ((where?.phone && c.phone === where.phone) || (where?.email && c.email === where.email))
      ) ?? null,
    create: async ({ data }: any) => {
      if (this.customers.some((c) => c.phone === data.phone)) {
        const error: any = new Error('Unique constraint failed on the fields: (`phone`)');
        error.code = 'P2002';
        throw error;
      }
      const row = { id: `cust-${++this.seq}`, ...data };
      this.customers.push(row);
      return row;
    }
  };
  sale = {
    // Mirrors the (companyId, channel, externalOrderId) unique index:
    // a second sale with the same triple collides (P2002), exactly as
    // the real createSale transaction would reject it.
    findFirst: async ({ where }: any) =>
      this.sales.find(
        (s) =>
          (!where?.companyId || s.companyId === where.companyId) &&
          (!where?.channel || s.channel === where.channel) &&
          (where?.externalOrderId === undefined || s.externalOrderId === where.externalOrderId)
      ) ?? null,
    create: async ({ data }: any) => {
      if (
        data.externalOrderId &&
        this.sales.some(
          (s) =>
            s.companyId === data.companyId &&
            s.channel === data.channel &&
            s.externalOrderId === data.externalOrderId
        )
      ) {
        const error: any = new Error(
          'Unique constraint failed on the fields: (`companyId`, `channel`, `externalOrderId`)'
        );
        error.code = 'P2002';
        throw error;
      }
      const row = { id: `sale-${++this.seq}`, ...data };
      this.sales.push(row);
      return row;
    }
  };
  integrationConnection = {
    findUnique: async () => this.connectionRow
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
    }
  };
}

function productFixture(overrides: any = {}): any {
  return {
    id: 'prod-a',
    name: 'Paracetamol 500mg',
    description: 'Pain relief tablets',
    sku: 'PARA-500',
    companyId: BIZ,
    branchId: BRANCH,
    isActive: true,
    variants: [],
    ...overrides
  };
}

function orderFixture(overrides: any = {}): WcOrder {
  return {
    id: 55,
    number: '55',
    status: 'processing',
    date_created: '2026-10-24T10:00:00',
    date_paid: null,
    total: '200.00',
    payment_method: 'cod',
    payment_method_title: 'Cash on delivery',
    billing: { first_name: 'Ahmed', last_name: 'Khan', email: 'ahmed@example.com', phone: '03001234567' },
    line_items: [
      { id: 1, name: 'Paracetamol 500mg', product_id: 9, variation_id: 0, quantity: 2, sku: 'PARA-500', price: '100.00', total: '200.00' }
    ],
    ...overrides
  };
}

const TEST_KEY = crypto.randomBytes(32).toString('hex');

describe('woocommerce client (URL + credentials)', () => {
  it('normalises the store URL to its origin', () => {
    expect(normalizeStoreUrl('https://mystore.com/')).toBe('https://mystore.com');
    expect(normalizeStoreUrl('https://mystore.com/shop/')).toBe('https://mystore.com');
    expect(normalizeStoreUrl('http://localhost:8080/')).toBe('http://localhost:8080');
  });

  it('refuses plain HTTP on a public host (Basic Auth would leak the secret)', () => {
    expect(() => normalizeStoreUrl('http://mystore.com')).toThrow(IntegrationError);
    expect(() => normalizeStoreUrl('not-a-url')).toThrow(IntegrationError);
    expect(() => normalizeStoreUrl('ftp://mystore.com')).toThrow(IntegrationError);
  });

  it('rejects incomplete credentials and treats an empty webhook secret as absent', () => {
    expect(() => parseWooCredentials({ storeUrl: 'https://x.com', consumerKey: 'ck' })).toThrow(IntegrationError);
    expect(parseWooCredentials({ ...CREDS, webhookSecret: '  ' }).webhookSecret).toBeUndefined();
    expect(parseWooCredentials({ ...CREDS, webhookSecret: 'whsec_1' }).webhookSecret).toBe('whsec_1');
  });
});

describe('woocommerce mapping (pure)', () => {
  const simpleProduct: ZapeeraProductForPush = {
    id: 'p1',
    name: 'Paracetamol 500mg',
    description: 'Pain relief',
    sku: 'PARA-500',
    unitPrice: 90,
    stockQuantity: 7,
    variants: []
  };

  it('builds a simple product payload (price as a decimal string, stock managed)', () => {
    const payload = buildWooProductPayload(simpleProduct);
    expect(payload).toMatchObject({
      name: 'Paracetamol 500mg',
      type: 'simple',
      status: 'publish',
      sku: 'PARA-500',
      regular_price: '90.00',
      manage_stock: true,
      stock_quantity: 7
    });
  });

  it('builds a variable product payload with attributes and variation prices from variant batches', () => {
    const variable: ZapeeraProductForPush = {
      ...simpleProduct,
      sku: 'TSHIRT',
      unitPrice: 500,
      variants: [
        { id: 'v1', name: 'Large / Red', sku: 'TSHIRT-L-R', priceDelta: 50, attributes: { size: 'Large', color: 'Red' }, stockQuantity: 3, unitPrice: 480 },
        { id: 'v2', name: 'Large / Blue', sku: 'TSHIRT-L-B', priceDelta: 50, attributes: { size: 'Large', color: 'Blue' }, stockQuantity: 0, unitPrice: 480 }
      ]
    };
    const payload = buildWooProductPayload(variable);
    expect(payload.type).toBe('variable');
    expect(payload.manage_stock).toBe(false);
    expect(payload.attributes).toEqual([
      { name: 'size', options: ['Large'], visible: true, variation: true },
      { name: 'color', options: ['Red', 'Blue'], visible: true, variation: true }
    ]);
    expect(buildWooVariationPayload(variable, variable.variants[0])).toMatchObject({
      sku: 'TSHIRT-L-R',
      regular_price: '530.00',
      manage_stock: true,
      stock_quantity: 3,
      attributes: [
        { name: 'size', option: 'Large' },
        { name: 'color', option: 'Red' }
      ]
    });
  });

  it('maps payment methods to Zapeera tenders, unknown methods to MOBILE', () => {
    expect(mapWooPaymentMethod('cod')).toBe('CASH');
    expect(mapWooPaymentMethod('bacs')).toBe('BANK_TRANSFER');
    expect(mapWooPaymentMethod('stripe')).toBe('CARD');
    expect(mapWooPaymentMethod('jazzcash')).toBe('JAZZCASH');
    expect(mapWooPaymentMethod('easypaisa')).toBe('EASYPAISA');
    expect(mapWooPaymentMethod('some-new-gateway')).toBe('MOBILE');
  });

  it('parses WooCommerce decimal-string money', () => {
    expect(parseWooMoney('21.99')).toBe(21.99);
    expect(parseWooMoney('21,99')).toBe(21.99);
    expect(parseWooMoney('not-money')).toBeNull();
    expect(parseWooMoney(null)).toBeNull();
  });

  it('only imports processing/completed orders', () => {
    expect(isImportableWooOrder(orderFixture({ status: 'processing' }))).toBe(true);
    expect(isImportableWooOrder(orderFixture({ status: 'completed' }))).toBe(true);
    for (const status of ['pending', 'on-hold', 'cancelled', 'refunded', 'failed']) {
      expect(isImportableWooOrder(orderFixture({ status }))).toBe(false);
    }
  });

  it('builds the sale payload from date_paid, not status (COD processing is UNPAID)', () => {
    const cod = buildSalePayloadFromWooOrder(orderFixture({ status: 'processing', date_paid: null }), [
      { productId: 'prod-a', variantId: null, quantity: 2, unitPrice: 100 }
    ]);
    expect(cod).toMatchObject({ paymentMethod: 'CASH', paymentStatus: 'PENDING', saleDate: '2026-10-24T10:00:00' });
    expect(cod.items).toEqual([{ productId: 'prod-a', quantity: 2, unitPrice: 100, saleType: 'UNIT', variantId: null }]);

    const paid = buildSalePayloadFromWooOrder(
      orderFixture({ status: 'processing', date_paid: '2026-10-24T10:05:00', payment_method: 'stripe' }),
      [{ productId: 'prod-a', variantId: null, quantity: 1, unitPrice: 100 }]
    );
    expect(paid).toMatchObject({ paymentMethod: 'CARD', paymentStatus: 'COMPLETED' });
  });

  it('round-trips the import tag', () => {
    expect(wooOrderReference(55)).toBe('woocommerce:55');
    expect(parseWooOrderId('woocommerce:55')).toBe(55);
    expect(parseWooOrderId('INV-10001')).toBeNull();
  });
});

describe('woocommerce webhook signature', () => {
  const secret = 'whsec_test_secret';
  const body = Buffer.from(JSON.stringify({ id: 55, status: 'processing' }), 'utf8');
  const good = crypto.createHmac('sha256', secret).update(body).digest('base64');

  it('accepts a valid signature', () => {
    expect(verifyWooCommerceWebhookSignature(body, good, secret)).toBe(true);
  });

  it('rejects a tampered body, a wrong secret and a missing signature', () => {
    const tampered = Buffer.from(JSON.stringify({ id: 56, status: 'processing' }), 'utf8');
    expect(verifyWooCommerceWebhookSignature(tampered, good, secret)).toBe(false);
    expect(verifyWooCommerceWebhookSignature(body, good, 'another-secret')).toBe(false);
    expect(verifyWooCommerceWebhookSignature(body, undefined, secret)).toBe(false);
    expect(verifyWooCommerceWebhookSignature(body, good, '')).toBe(false);
    expect(verifyWooCommerceWebhookSignature(Buffer.alloc(0), good, secret)).toBe(false);
  });
});

describe('woocommerce handler (mocked vendor + fake prisma)', () => {
  const originalFetch = (global as any).fetch;
  const originalKey = process.env.INTEGRATION_ENCRYPTION_KEY;
  let prisma: WooFakePrisma;
  let invokeSpy: any;

  beforeEach(() => {
    process.env.INTEGRATION_ENCRYPTION_KEY = TEST_KEY;
    prisma = new WooFakePrisma();
    invokeSpy = jest
      .spyOn(saleInvoker, 'invokeCreateSale')
      .mockImplementation(async (_actor: any, _biz: string, _branch: string, _payload: any) => {
        // Simulates the real createSale: the channel tag travels inside
        // the payload and lands in the same transaction as the sale, so
        // a second create with the same triple collides (P2002).
        if (
          _payload.externalOrderId &&
          prisma.sales.some(
            (s: any) =>
              s.companyId === _biz &&
              s.channel === _payload.channel &&
              s.externalOrderId === _payload.externalOrderId
          )
        ) {
          return { status: 500, body: { success: false, message: 'Unique constraint failed on the fields: (`companyId`, `channel`, `externalOrderId`)' } };
        }
        const sale = {
          id: `sale-${prisma.sales.length + 1}`,
          channel: _payload.channel ?? 'POS',
          externalOrderId: _payload.externalOrderId ?? null,
          branchId: BRANCH,
          companyId: BIZ
        };
        prisma.sales.push(sale);
        return { status: 201, body: { success: true, data: { id: sale.id, invoiceNumber: 'INV-10001' } } };
      });
  });

  afterEach(() => {
    (global as any).fetch = originalFetch;
    invokeSpy.mockRestore();
    if (originalKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
    else process.env.INTEGRATION_ENCRYPTION_KEY = originalKey;
  });

  it('registers as connectable (the card flips from "Coming soon")', () => {
    expect(isProviderConnectable('woocommerce')).toBe(true);
    expect(getIntegrationHandler('woocommerce')).toBe(woocommerceHandler);
    const entry = getProviderEntry('woocommerce');
    expect(entry?.credentialFields.find((f) => f.key === 'webhookSecret')?.optional).toBe(true);
  });

  it('connect() verifies with a cheap product read; a 401 becomes VENDOR_AUTH', async () => {
    installFetch([(url) => (url.includes('/products?per_page=1') ? { status: 200, body: [] } : null)]);
    await expect(woocommerceHandler.connect(CREDS)).resolves.toEqual({ ok: true, message: 'WooCommerce store reachable.' });

    installFetch([(url) => (url.includes('/products?per_page=1') ? { status: 401, body: { code: 'woocommerce_rest_cannot_view' } } : null)]);
    await expect(woocommerceHandler.connect(CREDS)).rejects.toMatchObject({ code: 'VENDOR_AUTH' });
  });

  describe('resolveBoundBranch', () => {
    it('auto-binds the sole branch; honours an explicit branchId', async () => {
      await expect(resolveBoundBranch(prisma as any, BIZ, { ...CONFIG })).resolves.toMatchObject({ id: BRANCH, name: 'Main Branch' });
      await expect(resolveBoundBranch(prisma as any, BIZ, { ...CONFIG, branchId: BRANCH })).resolves.toMatchObject({
        id: BRANCH,
        name: 'Main Branch'
      });
    });

    it('refuses to guess when several branches exist, and rejects a dead binding', async () => {
      prisma.branches.push({ id: 'branch-2', name: 'Second Branch', companyId: BIZ, isActive: true, createdAt: new Date('2026-02-01') });
      await expect(resolveBoundBranch(prisma as any, BIZ, { ...CONFIG })).rejects.toMatchObject({ code: 'SYNC_FAILED' });
      await expect(resolveBoundBranch(prisma as any, BIZ, { ...CONFIG, branchId: 'branch-9' })).rejects.toMatchObject({
        code: 'SYNC_FAILED'
      });
    });
  });

  describe('syncProducts (out)', () => {
    beforeEach(() => {
      prisma.products = [
        productFixture(),
        productFixture({
          id: 'prod-b',
          name: 'T-Shirt',
          sku: 'TSHIRT',
          variants: [
            { id: 'v1', productId: 'prod-b', name: 'Large / Red', sku: 'TSHIRT-L-R', priceDelta: 50, attributes: { size: 'Large', color: 'Red' }, isActive: true }
          ]
        }),
        productFixture({ id: 'prod-c', name: 'Unpriced Item', sku: 'NOPRICE' })
      ];
      prisma.batches = [
        { productId: 'prod-a', branchId: BRANCH, isActive: true, variantId: null, quantity: 5, sellingPrice: 100, expireDate: new Date('2027-01-01'), createdAt: new Date('2026-01-01') },
        { productId: 'prod-a', branchId: BRANCH, isActive: true, variantId: null, quantity: 2, sellingPrice: 90, expireDate: new Date('2026-06-01'), createdAt: new Date('2026-01-02') },
        { productId: 'prod-b', branchId: BRANCH, isActive: true, variantId: 'v1', quantity: 3, sellingPrice: 480, expireDate: null, createdAt: new Date('2026-01-01') }
      ];
    });

    it('creates missing products, updates existing ones, pushes variations, and fails the unpriced product', async () => {
      installFetch([
        (url, init) => {
          if (url.includes('/products?sku=PARA-500')) return { status: 200, body: [] };
          if (url.includes('/products?sku=TSHIRT')) return { status: 200, body: [{ id: 102, sku: 'TSHIRT', type: 'variable' }] };
          if (url.includes('/products?sku=NOPRICE')) return { status: 200, body: [] };
          if (url.endsWith('/products') && init.method === 'POST') return { status: 201, body: { id: 101, sku: 'PARA-500' } };
          if (url.endsWith('/products/102') && init.method === 'PUT') return { status: 200, body: { id: 102, sku: 'TSHIRT' } };
          if (url.includes('/products/102/variations') && init.method === 'GET') return { status: 200, body: [] };
          if (url.includes('/products/102/variations') && init.method === 'POST') return { status: 201, body: { id: 201, sku: 'TSHIRT-L-R' } };
          return null;
        }
      ]);
      const ctx: any = { prisma: prisma as any, businessId: BIZ, credentials: CREDS, config: CONFIG, logId: 'log-1' };
      const result = await woocommerceHandler.syncProducts!(ctx);
      expect(result.recordsProcessed).toBe(2);
      expect(result.recordsFailed).toBe(1);
      expect(result.message).toContain('Unpriced Item');
      // FEFO price: the earliest-expiry batch (90) wins over the 100 batch.
      const createCall = fetchCalls.find((c) => c.url.endsWith('/products') && c.init.method === 'POST');
      expect(JSON.parse(createCall!.init.body)).toMatchObject({ sku: 'PARA-500', regular_price: '90.00', stock_quantity: 7 });
      const variationCall = fetchCalls.find((c) => c.url.includes('/variations') && c.init.method === 'POST');
      expect(JSON.parse(variationCall!.init.body)).toMatchObject({ sku: 'TSHIRT-L-R', regular_price: '530.00', stock_quantity: 3 });
    });
  });

  describe('syncStock (out)', () => {
    beforeEach(() => {
      prisma.products = [productFixture()];
      prisma.batches = [
        { productId: 'prod-a', branchId: BRANCH, isActive: true, variantId: null, quantity: 4, sellingPrice: 90, expireDate: null, createdAt: new Date('2026-01-01') }
      ];
    });

    it('pushes base-unit batch stock to the matched product', async () => {
      installFetch([
        (url, init) => {
          if (url.includes('/products?sku=PARA-500')) return { status: 200, body: [{ id: 101, sku: 'PARA-500' }] };
          if (url.endsWith('/products/101') && init.method === 'PUT') return { status: 200, body: { id: 101 } };
          return null;
        }
      ]);
      const ctx: any = { prisma: prisma as any, businessId: BIZ, credentials: CREDS, config: CONFIG, logId: 'log-1' };
      const result = await woocommerceHandler.syncStock!(ctx);
      expect(result).toMatchObject({ recordsProcessed: 1, recordsFailed: 0 });
      const put = fetchCalls.find((c) => c.init.method === 'PUT');
      expect(JSON.parse(put!.init.body)).toEqual({ manage_stock: true, stock_quantity: 4 });
    });

    it('fails (does not invent) a product that does not exist in WooCommerce yet', async () => {
      installFetch([(url) => (url.includes('/products?sku=PARA-500') ? { status: 200, body: [] } : null)]);
      const ctx: any = { prisma: prisma as any, businessId: BIZ, credentials: CREDS, config: CONFIG, logId: 'log-1' };
      const result = await woocommerceHandler.syncStock!(ctx);
      expect(result).toMatchObject({ recordsProcessed: 0, recordsFailed: 1 });
    });
  });

  describe('importOrders (in)', () => {
    beforeEach(() => {
      prisma.products = [productFixture()];
      prisma.batches = [
        { productId: 'prod-a', branchId: BRANCH, isActive: true, variantId: null, quantity: 10, sellingPrice: 100, expireDate: null, createdAt: new Date('2026-01-01') }
      ];
    });

    function listOrdersRoute(orders: WcOrder[]): FetchRoute {
      return (url) => (url.includes('/orders') ? { status: 200, body: orders } : null);
    }

    it('imports a COD order as an UNPAID sale via the sale engine and tags it', async () => {
      installFetch([listOrdersRoute([orderFixture()])]);
      const ctx: any = { prisma: prisma as any, businessId: BIZ, credentials: CREDS, config: CONFIG, logId: 'log-1' };
      const result = await woocommerceHandler.importOrders!(ctx);
      expect(result).toMatchObject({ recordsProcessed: 1, recordsFailed: 0 });
      expect(invokeSpy).toHaveBeenCalledTimes(1);
      const [_actor, biz, branch, payload] = invokeSpy.mock.calls[0];
      expect(biz).toBe(BIZ);
      expect(branch).toBe(BRANCH);
      expect(payload).toMatchObject({
        paymentMethod: 'CASH',
        paymentStatus: 'PENDING',
        channel: 'woocommerce',
        externalOrderId: '55',
        items: [{ productId: 'prod-a', quantity: 2, unitPrice: 100, saleType: 'UNIT', variantId: null }]
      });
      expect(typeof payload.customerId).toBe('string');
      expect(prisma.sales[0]).toMatchObject({ channel: 'woocommerce', externalOrderId: '55' });
      expect(prisma.customers[0]).toMatchObject({ phone: '03001234567', email: 'ahmed@example.com' });
    });

    it('is idempotent: re-importing the same order creates no second sale', async () => {
      installFetch([listOrdersRoute([orderFixture()])]);
      const ctx: any = { prisma: prisma as any, businessId: BIZ, credentials: CREDS, config: CONFIG, logId: 'log-1' };
      await woocommerceHandler.importOrders!(ctx);
      const second = await woocommerceHandler.importOrders!(ctx);
      expect(second.recordsProcessed).toBe(0);
      expect(invokeSpy).toHaveBeenCalledTimes(1);
      expect(prisma.sales).toHaveLength(1);
    });

    it('fails the whole order when a line SKU cannot be matched (no partial sale)', async () => {
      installFetch([listOrdersRoute([orderFixture({ line_items: [{ id: 1, name: 'Mystery Item', product_id: 99, variation_id: 0, quantity: 1, sku: 'NOPE', price: '50.00', total: '50.00' }] })])]);
      const ctx: any = { prisma: prisma as any, businessId: BIZ, credentials: CREDS, config: CONFIG, logId: 'log-1' };
      const result = await woocommerceHandler.importOrders!(ctx);
      expect(result).toMatchObject({ recordsProcessed: 0, recordsFailed: 1 });
      expect(invokeSpy).not.toHaveBeenCalled();
      expect(prisma.sales).toHaveLength(0);
    });

    it('skips (does not fail) non-importable statuses', async () => {
      installFetch([listOrdersRoute([orderFixture({ id: 60, status: 'cancelled' }), orderFixture({ id: 61, status: 'pending' })])]);
      const ctx: any = { prisma: prisma as any, businessId: BIZ, credentials: CREDS, config: CONFIG, logId: 'log-1' };
      const result = await woocommerceHandler.importOrders!(ctx);
      expect(result).toMatchObject({ recordsProcessed: 0, recordsFailed: 0 });
      expect(result.message).toContain('2 skipped');
      expect(invokeSpy).not.toHaveBeenCalled();
    });

    it('matches the customer by phone on the second order instead of creating a duplicate', async () => {
      installFetch([listOrdersRoute([orderFixture(), orderFixture({ id: 56 })])]);
      const ctx: any = { prisma: prisma as any, businessId: BIZ, credentials: CREDS, config: CONFIG, logId: 'log-1' };
      const result = await woocommerceHandler.importOrders!(ctx);
      expect(result.recordsProcessed).toBe(2);
      expect(prisma.customers).toHaveLength(1);
    });
  });

  describe('webhook dispatch (verified deliveries only)', () => {
    beforeEach(() => {
      prisma.products = [productFixture()];
      prisma.batches = [
        { productId: 'prod-a', branchId: BRANCH, isActive: true, variantId: null, quantity: 10, sellingPrice: 100, expireDate: null, createdAt: new Date('2026-01-01') }
      ];
      prisma.connectionRow = {
        businessId: BIZ,
        provider: 'woocommerce',
        status: 'connected',
        encryptedCredentials: encryptIntegrationCredentials({ ...CREDS, webhookSecret: 'whsec_1' }),
        config: JSON.stringify(CONFIG)
      };
    });

    it('order.created re-fetches the order and imports it (and logs the run)', async () => {
      installFetch([(url) => (url.endsWith('/orders/55') ? { status: 200, body: orderFixture() } : null)]);
      const result = await handleWooCommerceWebhook(prisma as any, BIZ, 'order.created', { id: 55 });
      expect(result.action).toBe('order-imported');
      expect(result.saleId).toBeTruthy();
      expect(invokeSpy).toHaveBeenCalledTimes(1);
      expect(prisma.logs).toHaveLength(1);
      expect(prisma.logs[0]).toMatchObject({ direction: 'in', entity: 'order', status: 'success' });
    });

    it('a repeated order.updated delivery imports nothing (idempotent)', async () => {
      installFetch([(url) => (url.endsWith('/orders/55') ? { status: 200, body: orderFixture() } : null)]);
      await handleWooCommerceWebhook(prisma as any, BIZ, 'order.created', { id: 55 });
      const second = await handleWooCommerceWebhook(prisma as any, BIZ, 'order.updated', { id: 55 });
      expect(second.action).toBe('order-already-imported');
      expect(invokeSpy).toHaveBeenCalledTimes(1);
    });

    it('product.updated re-pushes the product from Zapeera', async () => {
      installFetch([
        (url, init) => {
          if (url.includes('/products?sku=PARA-500')) return { status: 200, body: [{ id: 101, sku: 'PARA-500' }] };
          if (url.endsWith('/products/101') && init.method === 'PUT') return { status: 200, body: { id: 101 } };
          return null;
        }
      ]);
      const result = await handleWooCommerceWebhook(prisma as any, BIZ, 'product.updated', { id: 101, sku: 'PARA-500' });
      expect(result.action).toBe('product-pushed');
      expect(prisma.logs[0]).toMatchObject({ direction: 'out', entity: 'product', status: 'success' });
    });

    it('ignores unknown topics and respects a disabled order sync', async () => {
      const ignored = await handleWooCommerceWebhook(prisma as any, BIZ, 'customer.created', { id: 7 });
      expect(ignored.action).toBe('ignored');
      prisma.connectionRow.config = JSON.stringify({ ...CONFIG, syncOrders: false });
      installFetch([(url) => (url.endsWith('/orders/55') ? { status: 200, body: orderFixture() } : null)]);
      const disabled = await handleWooCommerceWebhook(prisma as any, BIZ, 'order.created', { id: 55 });
      expect(disabled.action).toBe('ignored');
      expect(invokeSpy).not.toHaveBeenCalled();
    });
  });
});
