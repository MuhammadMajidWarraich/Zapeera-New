// ─── Shopify integration tests (feature/integration-shopify) ─────────────
// Handler-level tests: the Shopify HTTP layer is stubbed (global.fetch),
// the database is an in-memory FakePrisma, and sale creation is an
// injected stub — NO live store, NO real credentials, fixtures only.
// The framework's own suite (tests/integrations.test.ts) still covers
// connect/disconnect/status/sync flow with its stub handler.
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as crypto from 'crypto';
import {
  clearIntegrationHandlers,
  isProviderConnectable,
  registerIntegrationHandler
} from '../src/integrations/registry';
import { IntegrationError } from '../src/integrations/vendor-client';
import { connectProvider } from '../src/services/integration.service';
import {
  attributesToOptionValues,
  mapOrderFinancials,
  mapPaymentMethod,
  normalizeCustomerPhone,
  shopifyCustomerName
} from '../src/integrations/shopify/mapping';
import {
  normalizeShopDomain,
  shopifyGidToId,
  SHOPIFY_API_VERSION
} from '../src/integrations/shopify/client';
import {
  signOAuthState,
  verifyOAuthState,
  verifyCallbackHmac,
  buildAuthorizeUrl,
  type ShopifyOAuthConfig
} from '../src/integrations/shopify/oauth';
import { verifyShopifyWebhook, handleShopifyWebhook } from '../src/integrations/shopify/webhooks';
import { encryptIntegrationCredentials } from '../src/utils/integration-encryption.util';
import shopifyHandler from '../src/integrations/shopify';
import {
  __setTestSaleCreator,
  loadBranchCatalog,
  poolPrice,
  poolStock,
  resolveBranchId
} from '../src/integrations/shopify/sync-core';
import type { ShopifyOrder } from '../src/integrations/shopify/client';
import type { IntegrationSyncContext } from '../src/integrations/types';

const TEST_KEY = crypto.randomBytes(32).toString('hex');
const BUSINESS_ID = 'biz-shopify-test';
const BRANCH_ID = 'branch-main';
const BRANCH_2_ID = 'branch-second';
const OWNER_ID = 'owner-1';
const CREDS = { shopDomain: 'test-store.myshopify.com', accessToken: 'shpat_test_123' };
const WEBHOOK_SECRET = 'test-api-secret';

// ─── Fixture catalog (branch-scoped) ──────────────────────────────────────
// p1 Paracetamol: base pool 100 @ 12.50 (older) + 50 @ 13.00 (newer)
//   -> price 13.00, stock 150. p2 T-Shirt: two variants with pools.
// p3 lives in BRANCH_2 and must NEVER sync. p4 has no priced batch.
// p5 has a variant with no SKU.
const PRODUCTS = [
  { id: 'p1', name: 'Paracetamol 500mg', description: 'Pain relief', sku: 'PARA-500', barcode: '111', categoryId: 'cat-med', companyId: BUSINESS_ID, branchId: BRANCH_ID, isActive: true },
  { id: 'p2', name: 'T-Shirt', description: null, sku: 'TSHIRT', barcode: null, categoryId: 'cat-app', companyId: BUSINESS_ID, branchId: BRANCH_ID, isActive: true },
  { id: 'p3', name: 'Other Branch Item', description: null, sku: 'OTHER-1', barcode: null, categoryId: 'cat-app', companyId: BUSINESS_ID, branchId: BRANCH_2_ID, isActive: true },
  { id: 'p4', name: 'Unpriced Item', description: null, sku: 'NOPRICE-1', barcode: null, categoryId: 'cat-app', companyId: BUSINESS_ID, branchId: BRANCH_ID, isActive: true },
  { id: 'p5', name: 'No Sku Variant Item', description: null, sku: 'NOSKU-1', barcode: null, categoryId: 'cat-app', companyId: BUSINESS_ID, branchId: BRANCH_ID, isActive: true }
];
const VARIANTS = [
  { id: 'v1', productId: 'p2', name: 'Small / Red', sku: 'TSH-S-RED', barcode: '201', attributes: { size: 'S', color: 'Red' }, priceDelta: 0, companyId: BUSINESS_ID, isActive: true },
  { id: 'v2', productId: 'p2', name: 'Large / Blue', sku: 'TSH-L-BLU', barcode: '202', attributes: { size: 'L', color: 'Blue', material: 'Cotton', fit: 'Slim' }, priceDelta: 100, companyId: BUSINESS_ID, isActive: true },
  { id: 'v3', productId: 'p5', name: 'Mystery', sku: null, barcode: null, attributes: null, priceDelta: 0, companyId: BUSINESS_ID, isActive: true }
];
const BATCHES = [
  { id: 'b1', productId: 'p1', variantId: null, quantity: 100, sellingPrice: 12.5, createdAt: new Date('2026-01-01'), companyId: BUSINESS_ID, branchId: BRANCH_ID, isActive: true },
  { id: 'b2', productId: 'p1', variantId: null, quantity: 50, sellingPrice: 13.0, createdAt: new Date('2026-02-01'), companyId: BUSINESS_ID, branchId: BRANCH_ID, isActive: true },
  { id: 'b3', productId: 'p2', variantId: 'v1', quantity: 10, sellingPrice: 500, createdAt: new Date('2026-01-15'), companyId: BUSINESS_ID, branchId: BRANCH_ID, isActive: true },
  { id: 'b4', productId: 'p2', variantId: 'v2', quantity: 5, sellingPrice: 600, createdAt: new Date('2026-01-15'), companyId: BUSINESS_ID, branchId: BRANCH_ID, isActive: true },
  { id: 'b5', productId: 'p3', variantId: null, quantity: 99, sellingPrice: 1, createdAt: new Date('2026-01-01'), companyId: BUSINESS_ID, branchId: BRANCH_2_ID, isActive: true }
];
const CATEGORIES = [
  { id: 'cat-med', name: 'Medicine', companyId: BUSINESS_ID },
  { id: 'cat-app', name: 'Apparel', companyId: BUSINESS_ID }
];
const BRANCHES = [
  { id: BRANCH_ID, name: 'Main Branch', companyId: BUSINESS_ID, isActive: true, createdAt: new Date('2026-01-01') },
  { id: BRANCH_2_ID, name: 'Second Branch', companyId: BUSINESS_ID, isActive: true, createdAt: new Date('2026-02-01') }
];

// ─── Minimal in-memory Prisma stand-in ────────────────────────────────────
function matchesWhere(row: any, where: any): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]: [string, any]) => {
    if (key === 'businessId_provider' && cond) {
      return row.businessId === cond.businessId && row.provider === cond.provider;
    }
    const value = row[key];
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('in' in cond) return (cond.in as any[]).includes(value);
      if ('gt' in cond) return value > cond.gt;
      if ('gte' in cond) return value >= cond.gte;
      return false;
    }
    return value === cond;
  });
}

class FakePrisma {
  products = structuredClone(PRODUCTS);
  variants = structuredClone(VARIANTS);
  batches = structuredClone(BATCHES);
  categories = structuredClone(CATEGORIES);
  branches = structuredClone(BRANCHES);
  customers: any[] = [
    { id: 'cust-1', name: 'Existing Customer', phone: '+923001234567', email: 'existing@example.com', branchId: BRANCH_ID, companyId: BUSINESS_ID, totalPurchases: 0, loyaltyPoints: 0 }
  ];
  sales: any[] = [
    { id: 'sale-old', invoiceNumber: 'INV-10000', companyId: BUSINESS_ID, branchId: BRANCH_ID, channel: 'shopify', externalOrderId: '1002', totalAmount: 526, returnedAmount: 0, paymentStatus: 'COMPLETED', status: 'COMPLETED' }
  ];
  connections = new Map<string, any>();
  logs: any[] = [];
  saleCalls: any[] = [];
  private seq = 100;

  private findIn(rows: any[], args: any) {
    let out = rows.filter((r) => matchesWhere(r, args?.where));
    const orderBy = args?.orderBy;
    if (orderBy) {
      const [[key, dir]] = Object.entries(orderBy) as Array<[string, string]>;
      out = [...out].sort((a, b) => {
        const av = a[key] instanceof Date ? +a[key] : a[key];
        const bv = b[key] instanceof Date ? +b[key] : b[key];
        return dir === 'desc' ? (bv > av ? 1 : bv < av ? -1 : 0) : (av > bv ? 1 : av < bv ? -1 : 0);
      });
    }
    if (typeof args?.take === 'number') out = out.slice(0, args.take);
    return out;
  }

  business = {
    findUnique: async ({ where }: any) =>
      where.id === BUSINESS_ID ? { id: BUSINESS_ID, createdBy: OWNER_ID } : null
  };
  branch = {
    findFirst: async (args: any) => this.findIn(this.branches, args)[0] ?? null,
    findMany: async (args: any) => this.findIn(this.branches, args)
  };
  product = { findMany: async (args: any) => this.findIn(this.products, args) };
  productVariant = { findMany: async (args: any) => this.findIn(this.variants, args) };
  batch = { findMany: async (args: any) => this.findIn(this.batches, args) };
  category = { findMany: async (args: any) => this.findIn(this.categories, args) };
  customer = {
    findFirst: async (args: any) => this.findIn(this.customers, args)[0] ?? null,
    create: async ({ data }: any) => {
      const row = { id: `cust-${++this.seq}`, totalPurchases: 0, loyaltyPoints: 0, ...data };
      this.customers.push(row);
      return row;
    }
  };
  sale = {
    findFirst: async (args: any) => this.findIn(this.sales, args)[0] ?? null,
    update: async ({ where, data }: any) => {
      const row = this.sales.find((s) => s.id === where.id);
      if (!row) throw new Error('Record to update not found.');
      Object.assign(row, data);
      return row;
    }
  };
  integrationConnection = {
    findUnique: async ({ where }: any) =>
      this.connections.get(`${where.businessId_provider.businessId}::${where.businessId_provider.provider}`) ?? null,
    upsert: async ({ where, create, update }: any) => {
      const key = `${where.businessId_provider.businessId}::${where.businessId_provider.provider}`;
      const existing = this.connections.get(key);
      const row = existing ? { ...existing, ...update } : { id: `conn-${++this.seq}`, ...create };
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
    }
  };
}

// ─── Shopify HTTP stub ────────────────────────────────────────────────────
// Matches on the GraphQL operation text / URL and returns canned payloads.
// Every call is recorded for assertions.
interface RecordedCall { url: string; body: any }
let calls: RecordedCall[] = [];
let shopifyProductList: any[] = [];
let shopifyOrderList: any[] = [];
let shopifyOrderById: Record<string, any> = {};
let forceHttpStatus: number | null = null;

function shopifyNode(overrides: any = {}) {
  return {
    id: 'gid://shopify/Shop/1',
    name: 'Test Store',
    myshopifyDomain: 'test-store.myshopify.com',
    ...overrides
  };
}

function productNode(id: string, title: string, variants: any[]) {
  return { id, title, status: 'ACTIVE', variants: { edges: variants.map((v) => ({ node: v })) } };
}

function variantNode(id: string, sku: string, price: string, inventoryItemId: string) {
  return { id, sku, price, barcode: null, inventoryItem: { id: inventoryItemId } };
}

function orderNode(overrides: any = {}) {
  return {
    id: 'gid://shopify/Order/1001',
    name: '#1001',
    createdAt: '2026-10-20T10:00:00Z',
    cancelledAt: null,
    financialStatus: 'PAID',
    fulfillmentStatus: 'UNFULFILLED',
    currencyCode: 'PKR',
    subtotalPriceSet: { shopMoney: { amount: '526.00' } },
    totalDiscountsSet: { shopMoney: { amount: '0.00' } },
    totalTaxSet: { shopMoney: { amount: '0.00' } },
    totalShippingPriceSet: { shopMoney: { amount: '0.00' } },
    totalPriceSet: { shopMoney: { amount: '526.00' } },
    totalOutstandingSet: { shopMoney: { amount: '0.00' } },
    totalRefundedSet: { shopMoney: { amount: '0.00' } },
    paymentGatewayNames: ['Cash on Delivery'],
    email: 'buyer@example.com',
    customer: { id: 'gid://shopify/Customer/1', email: 'buyer@example.com', phone: '+923001234567', firstName: 'Test', lastName: 'Buyer', displayName: 'Test Buyer' },
    lineItems: { edges: [
      { node: { id: 'gid://shopify/LineItem/1', title: 'Paracetamol 500mg', sku: 'PARA-500', quantity: 2, originalUnitPriceSet: { shopMoney: { amount: '13.00' } }, discountedUnitPriceSet: { shopMoney: { amount: '13.00' } }, totalDiscountSet: { shopMoney: { amount: '0.00' } }, variant: { id: 'gid://shopify/ProductVariant/1', sku: 'PARA-500' }, product: { id: 'gid://shopify/Product/1' } } },
      { node: { id: 'gid://shopify/LineItem/2', title: 'T-Shirt', sku: 'TSH-S-RED', quantity: 1, originalUnitPriceSet: { shopMoney: { amount: '500.00' } }, discountedUnitPriceSet: { shopMoney: { amount: '500.00' } }, totalDiscountSet: { shopMoney: { amount: '0.00' } }, variant: { id: 'gid://shopify/ProductVariant/2', sku: 'TSH-S-RED' }, product: { id: 'gid://shopify/Product/2' } } }
    ] },
    fulfillments: [],
    refunds: [],
    ...overrides
  };
}

function installFetchStub() {
  (global as any).fetch = jest.fn(async (url: string, init: any) => {
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    if (forceHttpStatus !== null) {
      return { ok: false, status: forceHttpStatus, json: async () => ({}) };
    }
    const query: string = body?.query ?? '';
    const fail = (message: string) => ({
      ok: true,
      status: 200,
      json: async () => ({ data: null, errors: [{ message }] })
    });
    if (url.includes('/admin/oauth/access_token')) {
      return { ok: true, status: 200, json: async () => ({ access_token: 'shpat_oauth_123', scope: 'read_products' }) };
    }
    if (query.includes('query { shop')) {
      return { ok: true, status: 200, json: async () => ({ data: { shop: shopifyNode() } }) };
    }
    if (query.includes('locations(first:')) {
      return { ok: true, status: 200, json: async () => ({ data: { locations: { edges: [{ node: { id: 'gid://shopify/Location/1', name: 'Main location' } }] } } }) };
    }
    if (query.includes('ListProducts')) {
      return { ok: true, status: 200, json: async () => ({ data: { products: { edges: shopifyProductList.map((p) => ({ node: p })), pageInfo: { hasNextPage: false, endCursor: null } } } }) };
    }
    if (query.includes('ListOrders')) {
      return { ok: true, status: 200, json: async () => ({ data: { orders: { edges: shopifyOrderList.map((o) => ({ node: o })), pageInfo: { hasNextPage: false, endCursor: null } } } }) };
    }
    if (query.includes('FetchOrder')) {
      const order = shopifyOrderById[String(body?.variables?.id)] ?? null;
      return { ok: true, status: 200, json: async () => ({ data: { order } }) };
    }
    if (query.includes('FetchInventoryItem')) {
      return { ok: true, status: 200, json: async () => ({ data: { inventoryItems: { edges: [{ node: { variant: { sku: 'PARA-500' }, inventoryLevel: { quantities: [{ quantity: 999 }] } } }] } } }) };
    }
    if (query.includes('productCreate')) {
      return { ok: true, status: 200, json: async () => ({ data: { productCreate: { product: { id: 'gid://shopify/Product/900', title: body.variables.product.title, status: 'ACTIVE' }, userErrors: [] } } }) };
    }
    if (query.includes('productVariantsBulkCreate')) {
      const variants = (body.variables.variants ?? []).map((v: any, i: number) => ({
        id: `gid://shopify/ProductVariant/90${i}`,
        sku: v.inventoryItem?.sku ?? null,
        price: v.price,
        inventoryItem: { id: `gid://shopify/InventoryItem/90${i}` }
      }));
      return { ok: true, status: 200, json: async () => ({ data: { productVariantsBulkCreate: { productVariants: variants, userErrors: [] } } }) };
    }
    if (query.includes('productUpdate')) {
      return { ok: true, status: 200, json: async () => ({ data: { productUpdate: { product: { id: body.variables.input.id }, userErrors: [] } } }) };
    }
    if (query.includes('productVariantsBulkUpdate')) {
      const variants = (body.variables.variants ?? []).map((v: any) => ({
        id: v.id,
        sku: v.inventoryItem?.sku ?? null,
        price: v.price,
        inventoryItem: { id: 'gid://shopify/InventoryItem/1' }
      }));
      return { ok: true, status: 200, json: async () => ({ data: { productVariantsBulkUpdate: { productVariants: variants, userErrors: [] } } }) };
    }
    if (query.includes('inventorySetQuantities')) {
      return { ok: true, status: 200, json: async () => ({ data: { inventorySetQuantities: { inventoryAdjustmentGroup: { id: 'gid://shopify/InventoryAdjustmentGroup/1' }, userErrors: [] } } }) };
    }
    return fail(`unexpected Shopify call: ${query.slice(0, 80)}`);
  });
}

function ctxWith(prisma: FakePrisma, config: any = {}, logId = 'log-1'): IntegrationSyncContext {
  return { prisma: prisma as any, businessId: BUSINESS_ID, credentials: CREDS, config: { syncProducts: false, syncStock: false, syncOrders: false, syncCustomers: false, direction: 'both', ...config }, logId };
}

function saleStub(prisma: FakePrisma) {
  return async (input: any) => {
    prisma.saleCalls.push(input);
    const created = {
      id: `sale-${prisma.saleCalls.length}`,
      invoiceNumber: `INV-1000${prisma.saleCalls.length}`,
      totalAmount: input.items.reduce((s: number, i: any) => s + i.quantity * i.unitPrice, 0) - (input.discountAmount ?? 0)
    };
    prisma.sales.push({
      id: created.id,
      invoiceNumber: created.invoiceNumber,
      companyId: BUSINESS_ID,
      branchId: input.branchId,
      channel: input.channel,
      externalOrderId: input.externalOrderId,
      totalAmount: created.totalAmount,
      returnedAmount: input.returnedAmount ?? 0,
      paymentStatus: input.paymentStatus,
      status: 'COMPLETED'
    });
    return created;
  };
}

describe('shopify mapping (pure)', () => {
  it('caps options at 3, title-cases names, keeps order deterministic', () => {
    const { optionValues, dropped } = attributesToOptionValues({ size: 'L', color: 'Blue', material: 'Cotton', fit: 'Slim' });
    expect(optionValues).toEqual([
      { optionName: 'Color', name: 'Blue' },
      { optionName: 'Fit', name: 'Slim' },
      { optionName: 'Material', name: 'Cotton' }
    ]);
    expect(dropped).toEqual(['size']);
  });

  it('maps payment gateways to Zapeera tenders', () => {
    expect(mapPaymentMethod(['Cash on Delivery'], 'PENDING')).toBe('CASH');
    expect(mapPaymentMethod(['JazzCash'], 'PAID')).toBe('JAZZCASH');
    expect(mapPaymentMethod(['Easypaisa'], 'PAID')).toBe('EASYPAISA');
    expect(mapPaymentMethod(['Bank Transfer'], 'PAID')).toBe('BANK_TRANSFER');
    expect(mapPaymentMethod(['Visa'], 'PAID')).toBe('CARD');
    expect(mapPaymentMethod([], 'PENDING')).toBe('CASH');
  });

  it('maps financial statuses to payment state', () => {
    const base: ShopifyOrder = {
      id: 'gid://shopify/Order/1', numericId: '1', name: '#1', createdAt: '2026-10-20T00:00:00Z',
      cancelledAt: null, financialStatus: 'PAID', fulfillmentStatus: 'UNFULFILLED', currencyCode: 'PKR',
      subtotal: 100, totalDiscounts: 0, totalTax: 0, totalShipping: 0, total: 100, totalOutstanding: 0,
      totalRefunded: 0, paymentGatewayNames: [], email: null, customer: null, lineItems: [], fulfillments: [], refundsTotal: 0
    };
    expect(mapOrderFinancials(base)).toMatchObject({ paymentStatus: 'COMPLETED', paidAmount: 100 });
    // A genuinely unpaid order still owes the full total in Shopify.
    expect(mapOrderFinancials({ ...base, financialStatus: 'PENDING', totalOutstanding: 100 })).toMatchObject({ paymentStatus: 'PENDING', paidAmount: 0 });
    expect(mapOrderFinancials({ ...base, financialStatus: 'PARTIALLY_PAID', totalOutstanding: 40 })).toMatchObject({ paymentStatus: 'PENDING', paidAmount: 60 });
    expect(mapOrderFinancials({ ...base, financialStatus: 'REFUNDED', totalRefunded: 100 })).toMatchObject({ paymentStatus: 'REFUNDED', returnedAmount: 100 });
    expect(mapOrderFinancials({ ...base, cancelledAt: '2026-10-21T00:00:00Z' }).skip).toBe(true);
  });

  it('normalizes shop domains and rejects anything else', () => {
    expect(normalizeShopDomain('mystore.myshopify.com')).toBe('mystore.myshopify.com');
    expect(normalizeShopDomain('https://MyStore.myshopify.com/admin')).toBe('mystore.myshopify.com');
    expect(() => normalizeShopDomain('mystore.com')).toThrow('myshopify.com');
    expect(() => normalizeShopDomain('')).toThrow('myshopify.com');
  });

  it('parses GIDs and builds customer names/phones', () => {
    expect(shopifyGidToId('gid://shopify/Order/123')).toBe('123');
    expect(shopifyGidToId(null)).toBeNull();
    expect(normalizeCustomerPhone('+92 300 1234567')).toBe('+923001234567');
    expect(shopifyCustomerName({ id: null, email: 'a@b.c', phone: null, firstName: 'Ali', lastName: 'Khan', displayName: null }, 'fallback')).toBe('Ali Khan');
  });

  it('pins a real Admin API version', () => {
    expect(SHOPIFY_API_VERSION).toBe('2026-04');
  });
});

describe('shopify handler (mocked HTTP)', () => {
  const originalKey = process.env.INTEGRATION_ENCRYPTION_KEY;
  const originalFetch = (global as any).fetch;
  let prisma: FakePrisma;

  beforeEach(() => {
    process.env.INTEGRATION_ENCRYPTION_KEY = TEST_KEY;
    clearIntegrationHandlers();
    registerIntegrationHandler(shopifyHandler);
    calls = [];
    shopifyProductList = [];
    shopifyOrderList = [];
    shopifyOrderById = {};
    forceHttpStatus = null;
    installFetchStub();
    prisma = new FakePrisma();
    __setTestSaleCreator(saleStub(prisma));
  });

  afterEach(() => {
    __setTestSaleCreator(null);
    clearIntegrationHandlers();
    (global as any).fetch = originalFetch;
    if (originalKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
    else process.env.INTEGRATION_ENCRYPTION_KEY = originalKey;
  });

  it('registers as connectable', () => {
    expect(isProviderConnectable('shopify')).toBe(true);
    expect(isProviderConnectable('woocommerce')).toBe(false);
  });

  it('connect() verifies with a real shop read; a 401 maps to VENDOR_AUTH', async () => {
    const ok = await shopifyHandler.connect(CREDS);
    expect(ok.ok).toBe(true);
    expect(ok.message).toMatch(/Test Store/);
    expect(calls.some((c) => c.body.query.includes('query { shop'))).toBe(true);

    forceHttpStatus = 401;
    await expect(shopifyHandler.connect(CREDS)).rejects.toMatchObject({ code: 'VENDOR_AUTH' });
  });

  it('connects through the framework service (encrypted store, verified first)', async () => {
    const view = await connectProvider(prisma as any, BUSINESS_ID, 'shopify', CREDS, {
      syncProducts: true,
      syncStock: true,
      syncOrders: true,
      branchId: BRANCH_ID
    });
    expect(view).toMatchObject({ provider: 'shopify', status: 'connected', hasCredentials: true });
    expect(view.config.branchId).toBe(BRANCH_ID);
    expect(JSON.stringify(view)).not.toContain('shpat_test_123');
  });

  it('syncProducts creates a missing product (latest batch price, summed stock) and never touches the other branch', async () => {
    const result = await shopifyHandler.syncProducts!(ctxWith(prisma, { syncProducts: true }));
    // p1 created (price 13.00 from the newest batch, stock 150), p2 created,
    // p4 fails (no priced batch), p5 fails (variant without SKU). p3 is in
    // branch 2 and must not appear anywhere.
    expect(result.recordsProcessed).toBe(2);
    expect(result.recordsFailed).toBe(2);
    const createCalls = calls.filter((c) => c.body.query.includes('productCreate'));
    expect(createCalls).toHaveLength(2);
    expect(JSON.stringify(calls)).not.toContain('OTHER-1');
    const bulkCreate = calls.find((c) => c.body.query.includes('productVariantsBulkCreate'));
    expect(bulkCreate).toBeDefined();
    const p1Variants = calls
      .filter((c) => c.body.query.includes('productVariantsBulkCreate'))
      .flatMap((c) => c.body.variables.variants);
    const para = p1Variants.find((v: any) => v.inventoryItem?.sku === 'PARA-500');
    expect(para.price).toBe('13.00');
    expect(para.inventoryQuantities).toEqual([{ locationId: 'gid://shopify/Location/1', availableQuantity: 150 }]);
    const tshirts = p1Variants.filter((v: any) => String(v.inventoryItem?.sku ?? '').startsWith('TSH-'));
    expect(tshirts).toHaveLength(2);
    const largeBlue = tshirts.find((v: any) => v.inventoryItem?.sku === 'TSH-L-BLU');
    expect(largeBlue.price).toBe('700.00'); // 600 pool price + 100 delta
    expect(largeBlue.optionValues).toHaveLength(3); // 4th attribute dropped
  });

  it('syncProducts updates a listed product (no inventoryQuantities on bulk update; absolute set with CAS opt-out + idempotency key)', async () => {
    shopifyProductList = [
      productNode('gid://shopify/Product/2', 'T-Shirt', [
        variantNode('gid://shopify/ProductVariant/2', 'TSH-S-RED', '500.00', 'gid://shopify/InventoryItem/201'),
        variantNode('gid://shopify/ProductVariant/3', 'TSH-L-BLU', '700.00', 'gid://shopify/InventoryItem/202')
      ])
    ];
    const result = await shopifyHandler.syncProducts!(ctxWith(prisma, { syncProducts: true }, 'log-99'));
    expect(result.recordsProcessed).toBe(2); // p1 created, p2 updated
    expect(result.recordsFailed).toBe(2);
    expect(calls.some((c) => c.body.query.includes('productUpdate'))).toBe(true);
    const bulkUpdate = calls.find((c) => c.body.query.includes('productVariantsBulkUpdate'));
    expect(bulkUpdate).toBeDefined();
    expect(JSON.stringify(bulkUpdate?.body.variables.variants)).not.toContain('inventoryQuantities');
    const setCalls = calls.filter((c) => c.body.query.includes('inventorySetQuantities'));
    expect(setCalls.length).toBeGreaterThan(0);
    for (const call of setCalls) {
      expect(call.body.variables.idempotencyKey).toContain('log-99');
      for (const q of call.body.variables.input.quantities) {
        expect(q.changeFromQuantity).toBeNull();
      }
      expect(call.body.query).toContain('@idempotent');
    }
  });

  it('syncProducts refuses when the toggle is off', async () => {
    const result = await shopifyHandler.syncProducts!(ctxWith(prisma, { syncProducts: false }));
    expect(result.recordsProcessed).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it('syncStock pushes base-unit sums per pool and fails products not on Shopify', async () => {
    shopifyProductList = [
      productNode('gid://shopify/Product/1', 'Paracetamol 500mg', [
        variantNode('gid://shopify/ProductVariant/1', 'PARA-500', '13.00', 'gid://shopify/InventoryItem/101')
      ])
    ];
    const result = await shopifyHandler.syncStock!(ctxWith(prisma, { syncStock: true }, 'log-7'));
    // PARA-500 set to 150; T-Shirt variants + unpriced + no-sku products fail.
    expect(result.recordsProcessed).toBe(1);
    expect(result.recordsFailed).toBe(4);
    const setCalls = calls.filter((c) => c.body.query.includes('inventorySetQuantities'));
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0].body.variables.input.quantities).toEqual([
      { inventoryItemId: 'gid://shopify/InventoryItem/101', locationId: 'gid://shopify/Location/1', quantity: 150, changeFromQuantity: null }
    ]);
    expect(setCalls[0].body.variables.idempotencyKey).toContain('log-7');
  });

  it('importOrders imports a paid COD order through the sale path with channel + external id', async () => {
    shopifyOrderList = [orderNode()];
    const catalog = await loadBranchCatalog(prisma as any, BUSINESS_ID, BRANCH_ID);
    expect(poolPrice(catalog.find((p) => p.id === 'p1')!.batches, null)).toBe(13);
    expect(poolStock(catalog.find((p) => p.id === 'p1')!.batches, null)).toBe(150);

    const result = await shopifyHandler.importOrders!(ctxWith(prisma, { syncOrders: true }));
    expect(result.recordsProcessed).toBe(1);
    expect(result.recordsFailed).toBe(0);
    expect(result.message).toMatch(/1 order\(s\) imported/);
    expect(prisma.saleCalls).toHaveLength(1);
    const call = prisma.saleCalls[0];
    expect(call).toMatchObject({
      channel: 'shopify',
      externalOrderId: '1001',
      branchId: BRANCH_ID,
      actorUserId: OWNER_ID,
      paymentMethod: 'CASH',
      paymentStatus: 'COMPLETED',
      paidAmount: 526,
      customerId: 'cust-1' // matched by phone, not re-created
    });
    expect(call.items).toEqual([
      { productId: 'p1', variantId: null, quantity: 2, unitPrice: 13 },
      { productId: 'p2', variantId: 'v1', quantity: 1, unitPrice: 500 }
    ]);
    expect(prisma.customers).toHaveLength(1); // no duplicate customer
  });

  it('importOrders is idempotent and skips cancelled + unknown-SKU orders', async () => {
    shopifyOrderList = [
      orderNode({ id: 'gid://shopify/Order/1002', name: '#1002' }), // already imported (fixture sale)
      orderNode({ id: 'gid://shopify/Order/1003', name: '#1003', cancelledAt: '2026-10-21T00:00:00Z' }),
      orderNode({
        id: 'gid://shopify/Order/1004',
        name: '#1004',
        lineItems: { edges: [{ node: { id: 'gid://shopify/LineItem/9', title: 'Unknown', sku: 'NOPE-1', quantity: 1, originalUnitPriceSet: { shopMoney: { amount: '10.00' } }, discountedUnitPriceSet: { shopMoney: { amount: '10.00' } }, totalDiscountSet: { shopMoney: { amount: '0.00' } }, variant: { id: null, sku: 'NOPE-1' }, product: { id: null } } }] }
      })
    ];
    const result = await shopifyHandler.importOrders!(ctxWith(prisma, { syncOrders: true }));
    expect(result.recordsProcessed).toBe(1); // the already-imported one counts as handled
    expect(result.recordsFailed).toBe(1); // unknown SKU
    expect(result.message).toMatch(/1 already imported, 1 skipped, 1 failed/);
    expect(prisma.saleCalls).toHaveLength(0); // no new sale created
  });

  it('importOrders creates a customer when the phone is new, and walks in when there is no phone', async () => {
    const newPhone = orderNode({
      id: 'gid://shopify/Order/1005',
      name: '#1005',
      customer: { id: 'gid://shopify/Customer/2', email: 'new@example.com', phone: '+923009998877', firstName: 'New', lastName: 'Buyer', displayName: 'New Buyer' }
    });
    const noPhone = orderNode({
      id: 'gid://shopify/Order/1006',
      name: '#1006',
      customer: { id: 'gid://shopify/Customer/3', email: null, phone: null, firstName: 'Ghost', lastName: '', displayName: 'Ghost' },
      email: null
    });
    shopifyOrderList = [newPhone, noPhone];
    const result = await shopifyHandler.importOrders!(ctxWith(prisma, { syncOrders: true }));
    expect(result.recordsProcessed).toBe(2);
    expect(prisma.saleCalls[0].customerId).toBe('cust-101');
    expect(prisma.saleCalls[1].customerId).toBeNull();
    expect(prisma.customers.find((c) => c.phone === '+923009998877')?.name).toBe('New Buyer');
  });

  it('resolveBranchId enforces one branch (config branch, else first active; rejects a foreign branch)', async () => {
    expect((await resolveBranchId(prisma as any, BUSINESS_ID, { branchId: BRANCH_2_ID } as any)).id).toBe(BRANCH_2_ID);
    expect((await resolveBranchId(prisma as any, BUSINESS_ID, {} as any)).id).toBe(BRANCH_ID);
    await expect(resolveBranchId(prisma as any, BUSINESS_ID, { branchId: 'branch-nope' } as any)).rejects.toMatchObject({ code: 'SYNC_FAILED' });
  });
});

describe('shopify OAuth', () => {
  const cfg: ShopifyOAuthConfig = {
    apiKey: 'test-key',
    apiSecret: WEBHOOK_SECRET,
    appUrl: 'https://api.example.test',
    returnUrl: 'https://app.example.test/settings'
  };

  it('signs + verifies state; rejects tampered and expired state', () => {
    const state = signOAuthState({ businessId: BUSINESS_ID, shop: 'test-store.myshopify.com', nonce: 'abc', exp: Date.now() + 60000 }, WEBHOOK_SECRET);
    expect(verifyOAuthState(state, WEBHOOK_SECRET)?.businessId).toBe(BUSINESS_ID);
    expect(verifyOAuthState(`${state}x`, WEBHOOK_SECRET)).toBeNull();
    const expired = signOAuthState({ businessId: BUSINESS_ID, shop: 'x.myshopify.com', nonce: 'a', exp: Date.now() - 1000 }, WEBHOOK_SECRET);
    expect(verifyOAuthState(expired, WEBHOOK_SECRET)).toBeNull();
  });

  it('builds a correct authorize URL (offline token: no grant_options)', () => {
    const url = buildAuthorizeUrl(cfg, 'test-store.myshopify.com', BUSINESS_ID);
    expect(url).toContain('https://test-store.myshopify.com/admin/oauth/authorize');
    expect(url).toContain('client_id=test-key');
    expect(url).toContain(`redirect_uri=${encodeURIComponent('https://api.example.test/api/v1/integrations/shopify/oauth/callback')}`);
    expect(url).toContain('scope=read_products');
    expect(url).not.toContain('grant_options');
  });

  it('verifies Shopify callback HMAC per the documented algorithm', () => {
    // Build a valid query the way Shopify does: sorted params, % -> %25,
    // & -> %26, HMAC-SHA256 hex over the joined string.
    const params: Record<string, string> = {
      code: 'auth-code-1',
      shop: 'test-store.myshopify.com',
      state: 's',
      timestamp: '1760000000'
    };
    const message = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k].replace(/%/g, '%25').replace(/&/g, '%26')}`)
      .join('&');
    const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET).update(message).digest('hex');
    expect(verifyCallbackHmac({ ...params, hmac }, WEBHOOK_SECRET)).toBe(true);
    expect(verifyCallbackHmac({ ...params, hmac: 'deadbeef' }, WEBHOOK_SECRET)).toBe(false);
    expect(verifyCallbackHmac({ ...params, code: 'other-code', hmac }, WEBHOOK_SECRET)).toBe(false);
  });
});

describe('shopify webhooks', () => {
  const originalFetch = (global as any).fetch;
  let prisma: FakePrisma;

  beforeEach(() => {
    clearIntegrationHandlers();
    registerIntegrationHandler(shopifyHandler);
    calls = [];
    shopifyProductList = [];
    shopifyOrderList = [];
    shopifyOrderById = {};
    forceHttpStatus = null;
    installFetchStub();
    prisma = new FakePrisma();
  });

  afterEach(() => {
    clearIntegrationHandlers();
    (global as any).fetch = originalFetch;
  });

  const connectedRow = () => {
    // Encrypted credentials for the webhook tests (real encryption util).
    prisma.connections.set(`${BUSINESS_ID}::shopify`, {
      id: 'conn-1',
      businessId: BUSINESS_ID,
      provider: 'shopify',
      status: 'connected',
      encryptedCredentials: encryptIntegrationCredentials(CREDS),
      config: JSON.stringify({ syncProducts: true, syncStock: true, syncOrders: true, syncCustomers: false, direction: 'both', branchId: BRANCH_ID })
    });
  };

  it('verifies HMAC-SHA256 (base64) — valid passes, tampered/missing fail', () => {
    const body = Buffer.from(JSON.stringify({ id: 1001 }), 'utf8');
    const good = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('base64');
    expect(verifyShopifyWebhook(body, good, WEBHOOK_SECRET)).toBe(true);
    expect(verifyShopifyWebhook(Buffer.from(JSON.stringify({ id: 1002 }), 'utf8'), good, WEBHOOK_SECRET)).toBe(false);
    expect(verifyShopifyWebhook(body, null, WEBHOOK_SECRET)).toBe(false);
    expect(verifyShopifyWebhook(body, good, 'wrong-secret')).toBe(false);
  });

  it('rejects an unverifiable delivery with 401 and never touches the DB', async () => {
    const outcome = await handleShopifyWebhook({
      prisma: prisma as any,
      businessId: BUSINESS_ID,
      rawBody: Buffer.from('{}', 'utf8'),
      hmacHeader: 'bogus',
      topic: 'orders/create',
      shopDomainHeader: 'test-store.myshopify.com',
      webhookId: 'wh-1',
      secret: WEBHOOK_SECRET
    });
    expect(outcome.httpStatus).toBe(401);
    expect(prisma.logs).toHaveLength(0);
  });

  it('orders/create imports the order (via the GraphQL fetch) and writes a log row', async () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = TEST_KEY;
    connectedRow();
    // Order 1002 is already imported in the fixture — the pre-check
    // short-circuits before any sale creator is invoked, so this test
    // proves the webhook → fetch → idempotency path end to end.
    shopifyOrderById['gid://shopify/Order/1002'] = orderNode({ id: 'gid://shopify/Order/1002', name: '#1002' });
    const raw2 = Buffer.from(JSON.stringify({ id: 1002 }), 'utf8');
    const hmac2 = crypto.createHmac('sha256', WEBHOOK_SECRET).update(raw2).digest('base64');
    const outcome = await handleShopifyWebhook({
      prisma: prisma as any,
      businessId: BUSINESS_ID,
      rawBody: raw2,
      hmacHeader: hmac2,
      topic: 'orders/create',
      shopDomainHeader: 'test-store.myshopify.com',
      webhookId: 'wh-2',
      secret: WEBHOOK_SECRET
    });
    expect(outcome.httpStatus).toBe(200);
    expect(outcome.message).toMatch(/already imported/);
    expect(prisma.logs).toHaveLength(1);
    expect(prisma.logs[0]).toMatchObject({ entity: 'order', direction: 'in', status: 'success' });
  });

  it('refunds/create marks the imported sale refunded without restocking', async () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = TEST_KEY;
    connectedRow();
    const payload = { id: 55, order_id: 1002, transactions: [{ kind: 'refund', amount: '526.00' }] };
    const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
    const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('base64');
    const outcome = await handleShopifyWebhook({
      prisma: prisma as any,
      businessId: BUSINESS_ID,
      rawBody,
      hmacHeader: hmac,
      topic: 'refunds/create',
      shopDomainHeader: 'test-store.myshopify.com',
      webhookId: 'wh-3',
      secret: WEBHOOK_SECRET
    });
    expect(outcome.httpStatus).toBe(200);
    const sale = prisma.sales.find((s) => s.externalOrderId === '1002');
    expect(sale.paymentStatus).toBe('REFUNDED');
    expect(sale.returnedAmount).toBe(526);
    expect(outcome.message).toMatch(/not restocked/);
  });

  it('inventory_levels/update pushes Zapeera stock when Shopify diverged', async () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = TEST_KEY;
    connectedRow();
    const payload = { inventory_item_id: 101, location_id: 1, available: 999 };
    const rawBody = Buffer.from(JSON.stringify(payload), 'utf8');
    const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('base64');
    const outcome = await handleShopifyWebhook({
      prisma: prisma as any,
      businessId: BUSINESS_ID,
      rawBody,
      hmacHeader: hmac,
      topic: 'inventory_levels/update',
      shopDomainHeader: 'test-store.myshopify.com',
      webhookId: 'wh-9',
      secret: WEBHOOK_SECRET
    });
    expect(outcome.httpStatus).toBe(200);
    expect(outcome.message).toMatch(/diverged/);
    const setCalls = calls.filter((c) => c.body.query.includes('inventorySetQuantities'));
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0].body.variables.input.quantities[0].quantity).toBe(150); // Zapeera wins
    expect(setCalls[0].body.variables.idempotencyKey).toContain('wh-9');
  });
});
