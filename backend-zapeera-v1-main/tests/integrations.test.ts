import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as crypto from 'crypto';
import {
  decryptIntegrationCredentials,
  decryptIntegrationSecret,
  encryptIntegrationCredentials,
  encryptIntegrationSecret,
  isIntegrationEncryptionConfigured
} from '../src/utils/integration-encryption.util';
import {
  EXCLUDED_TIER_3_PROVIDERS,
  TIER_1_PROVIDERS,
  TIER_2_PROVIDERS,
  clearIntegrationHandlers,
  getProviderEntry,
  isProviderConnectable,
  listProviders,
  registerIntegrationHandler
} from '../src/integrations/registry';
import { IntegrationError } from '../src/integrations/vendor-client';
import {
  connectProvider,
  disconnectProvider,
  getConnectionStatus,
  listProvidersWithStatus,
  listSyncLogs,
  triggerSync
} from '../src/services/integration.service';
import type { IntegrationSyncHandler } from '../src/integrations/types';

const TEST_KEY = crypto.randomBytes(32).toString('hex');
const OTHER_KEY = crypto.randomBytes(32).toString('hex');
const BUSINESS_ID = 'biz-framework-test';
const CREDS = { accessToken: 'shpat_test_123', shopDomain: 'test-store.myshopify.com' };

// ─── Minimal in-memory Prisma stand-in ────────────────────────────────────
// Implements only the calls integration.service.ts makes, with the same
// argument shapes (composite-unique where: { businessId_provider: {...} }).
class FakePrisma {
  connections = new Map<string, any>();
  logs: any[] = [];
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

  // Minimal sale/business stand-ins for the generic shipment dispatch
  // (feature/integration-postex): buildShipmentInput reads one sale.
  sales = new Map<string, any>([
    [
      'sale-1',
      {
        id: 'sale-1',
        invoiceNumber: 'INV-1001',
        companyId: BUSINESS_ID,
        totalAmount: 5000,
        paidAmount: 0,
        returnedAmount: 0,
        postexTrackingNumber: null,
        customer: { name: 'Ayesha Khan', phone: '03001234567', address: '12 Main Street, Lahore' },
        items: [{ quantity: 2, product: { name: 'Honey 500g' } }]
      }
    ]
  ]);

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
    findUnique: async ({ where }: any) =>
      where.id === BUSINESS_ID
        ? { id: BUSINESS_ID, name: 'Test Business', phone: '03009876543', address: '1 Bazaar Road, Lahore' }
        : null
  };
}

const stubHandler: IntegrationSyncHandler = {
  provider: 'shopify',
  connect: async () => ({ ok: true }),
  disconnect: async () => undefined,
  getStatus: async () => ({ ok: true, message: 'Shopify reachable' }),
  syncProducts: async () => ({ recordsProcessed: 5, recordsFailed: 0 }),
  syncStock: async () => ({ recordsProcessed: 2, recordsFailed: 1 })
};

describe('integration credential encryption (AES-256-GCM)', () => {
  const originalKey = process.env.INTEGRATION_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.INTEGRATION_ENCRYPTION_KEY = TEST_KEY;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
    else process.env.INTEGRATION_ENCRYPTION_KEY = originalKey;
  });

  it('round-trips a credentials object', () => {
    const bundle = encryptIntegrationCredentials(CREDS);
    expect(bundle.startsWith('v1.')).toBe(true);
    expect(bundle).not.toContain('shpat_test_123');
    expect(decryptIntegrationCredentials(bundle)).toEqual(CREDS);
  });

  it('round-trips a raw string and never reuses the IV', () => {
    const a = encryptIntegrationSecret('hello-integrations');
    const b = encryptIntegrationSecret('hello-integrations');
    expect(a).not.toBe(b); // fresh random IV per encryption
    expect(decryptIntegrationSecret(a)).toBe('hello-integrations');
    expect(decryptIntegrationSecret(b)).toBe('hello-integrations');
  });

  it('fails closed when the key is unset (never stores plaintext)', () => {
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    expect(isIntegrationEncryptionConfigured()).toBe(false);
    expect(() => encryptIntegrationSecret('x')).toThrow('INTEGRATION_ENCRYPTION_KEY is not set');
    expect(() => decryptIntegrationSecret('v1.a.b.c')).toThrow('INTEGRATION_ENCRYPTION_KEY is not set');
  });

  it('rejects a malformed key', () => {
    process.env.INTEGRATION_ENCRYPTION_KEY = 'too-short';
    expect(isIntegrationEncryptionConfigured()).toBe(false);
    expect(() => encryptIntegrationSecret('x')).toThrow('INTEGRATION_ENCRYPTION_KEY is invalid');
  });

  it('rejects decryption with the wrong key and tampered ciphertext', () => {
    const bundle = encryptIntegrationSecret('secret-value');
    process.env.INTEGRATION_ENCRYPTION_KEY = OTHER_KEY;
    expect(() => decryptIntegrationSecret(bundle)).toThrow();
    process.env.INTEGRATION_ENCRYPTION_KEY = TEST_KEY;
    const parts = bundle.split('.');
    const tampered = [parts[0], parts[1], parts[2], `${parts[3].slice(0, -2)}AA`].join('.');
    expect(() => decryptIntegrationSecret(tampered)).toThrow();
    expect(() => decryptIntegrationSecret('not-a-bundle')).toThrow('Invalid encrypted credential format');
  });
});

describe('integration provider registry', () => {
  beforeEach(() => {
    clearIntegrationHandlers();
  });

  afterEach(() => {
    clearIntegrationHandlers();
  });

  it('registers every Tier 1 provider from the API research', () => {
    expect(TIER_1_PROVIDERS).toEqual([
      'shopify',
      'woocommerce',
      'daraz',
      'jazzcash',
      'postex',
      'google-sheets'
    ]);
    for (const id of TIER_1_PROVIDERS) {
      expect(getProviderEntry(id)).toBeDefined();
      expect(getProviderEntry(id)?.tier).toBe(1);
    }
  });

  it('registers every Tier 2 provider from the API research', () => {
    expect(TIER_2_PROVIDERS).toEqual([
      'easypaisa',
      'meta-commerce',
      'foodpanda',
      'mulphilog',
      'quickbooks',
      'xero',
      'twilio',
      'smsala',
      'tcs',
      'leopards'
    ]);
    for (const id of TIER_2_PROVIDERS) {
      expect(getProviderEntry(id)).toBeDefined();
      expect(getProviderEntry(id)?.tier).toBe(2);
    }
  });

  it('excludes every Tier 3 provider (not feasible in Pakistan)', () => {
    expect(EXCLUDED_TIER_3_PROVIDERS).toEqual(['tiktok-shop', 'stripe', 'paypal', 'bykea', 'trax']);
    const ids = listProviders().map((p) => p.id);
    for (const excluded of EXCLUDED_TIER_3_PROVIDERS) {
      expect(ids).not.toContain(excluded);
      expect(getProviderEntry(excluded)).toBeUndefined();
    }
  });

  it('gives every entry a valid category, capabilities, auth type and docs shape', () => {
    const categories = new Set(['sales-channel', 'payments', 'logistics', 'accounting', 'productivity', 'messaging']);
    expect(listProviders()).toHaveLength(16);
    for (const entry of listProviders()) {
      expect(categories.has(entry.category)).toBe(true);
      expect(entry.capabilities.length).toBeGreaterThan(0);
      expect(entry.displayName.length).toBeGreaterThan(0);
      expect(entry.docsUrl === null || entry.docsUrl.startsWith('https://')).toBe(true);
      expect(Array.isArray(entry.credentialFields)).toBe(true);
    }
    // Research-grounded spot checks.
    expect(getProviderEntry('daraz')?.limitation).toMatch(/polling only/i);
    expect(getProviderEntry('meta-commerce')?.limitation).toMatch(/no order import/i);
    expect(getProviderEntry('easypaisa')?.docsUrl).toBeNull();
  });

  it('marks no provider connectable until its handler is registered', () => {
    for (const entry of listProviders()) {
      expect(isProviderConnectable(entry.id)).toBe(false);
    }
    registerIntegrationHandler(stubHandler);
    expect(isProviderConnectable('shopify')).toBe(true);
    expect(isProviderConnectable('woocommerce')).toBe(false);
  });

  it('refuses a handler for an unknown provider', () => {
    expect(() =>
      registerIntegrationHandler({ ...stubHandler, provider: 'stripe' as any })
    ).toThrow('unknown provider');
  });
});

describe('integration connect / disconnect / status / sync flow', () => {
  const originalKey = process.env.INTEGRATION_ENCRYPTION_KEY;
  let prisma: FakePrisma;

  beforeEach(() => {
    process.env.INTEGRATION_ENCRYPTION_KEY = TEST_KEY;
    clearIntegrationHandlers();
    registerIntegrationHandler(stubHandler);
    prisma = new FakePrisma();
  });

  afterEach(() => {
    clearIntegrationHandlers();
    if (originalKey === undefined) delete process.env.INTEGRATION_ENCRYPTION_KEY;
    else process.env.INTEGRATION_ENCRYPTION_KEY = originalKey;
  });

  it('lists all providers as disconnected before any connect', async () => {
    const providers = await listProvidersWithStatus(prisma as any, BUSINESS_ID);
    expect(providers).toHaveLength(16);
    expect(providers.find((p) => p.id === 'shopify')).toMatchObject({
      status: 'disconnected',
      hasCredentials: false,
      connectable: true,
      config: null
    });
    expect(providers.find((p) => p.id === 'daraz')?.connectable).toBe(false);
  });

  it('rejects connect for an unknown provider and for a provider with no handler', async () => {
    await expect(
      connectProvider(prisma as any, BUSINESS_ID, 'stripe', CREDS)
    ).rejects.toMatchObject({ code: 'UNKNOWN_PROVIDER' });
    await expect(
      connectProvider(prisma as any, BUSINESS_ID, 'woocommerce', { consumerKey: 'x' })
    ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
  });

  it('fails loudly on connect when the encryption key is unset', async () => {
    delete process.env.INTEGRATION_ENCRYPTION_KEY;
    await expect(
      connectProvider(prisma as any, BUSINESS_ID, 'shopify', CREDS)
    ).rejects.toMatchObject({ code: 'ENCRYPTION_NOT_CONFIGURED' });
    expect(prisma.connections.size).toBe(0); // nothing stored
  });

  it('connects, stores encrypted credentials, and never exposes them', async () => {
    const view = await connectProvider(prisma as any, BUSINESS_ID, 'shopify', CREDS, {
      syncProducts: true,
      direction: 'out'
    });
    expect(view).toMatchObject({
      provider: 'shopify',
      status: 'connected',
      hasCredentials: true,
      config: { syncProducts: true, syncStock: false, syncOrders: false, syncCustomers: false, direction: 'out' }
    });
    expect(JSON.stringify(view)).not.toContain('shpat_test_123');
    expect('encryptedCredentials' in view).toBe(false);

    const stored = prisma.connections.get(`${BUSINESS_ID}::shopify`);
    expect(stored.encryptedCredentials.startsWith('v1.')).toBe(true);
    expect(decryptIntegrationCredentials(stored.encryptedCredentials)).toEqual(CREDS);
  });

  it('records a failed verification as status error without storing credentials', async () => {
    registerIntegrationHandler({
      ...stubHandler,
      connect: async () => ({ ok: false, message: 'Bad token' })
    });
    await expect(
      connectProvider(prisma as any, BUSINESS_ID, 'shopify', { accessToken: 'bad' })
    ).rejects.toMatchObject({ code: 'VENDOR_AUTH' });
    const stored = prisma.connections.get(`${BUSINESS_ID}::shopify`);
    expect(stored.status).toBe('error');
    expect(stored.encryptedCredentials).toBeNull();
    expect(stored.lastError).toBe('Bad token');
  });

  it('reports live status, syncs products/stock with logs, then disconnects', async () => {
    await connectProvider(prisma as any, BUSINESS_ID, 'shopify', CREDS);

    const status = await getConnectionStatus(prisma as any, BUSINESS_ID, 'shopify');
    expect(status.status).toBe('connected');
    expect(status.remoteOk).toBe(true);
    expect(status.remoteMessage).toBe('Shopify reachable');

    const products = await triggerSync(prisma as any, BUSINESS_ID, 'shopify', { entity: 'product' });
    expect(products.log.status).toBe('success');
    expect(products.result).toEqual({ recordsProcessed: 5, recordsFailed: 0 });
    expect(products.log.direction).toBe('out');

    const stock = await triggerSync(prisma as any, BUSINESS_ID, 'shopify', { entity: 'stock' });
    expect(stock.log.status).toBe('partial'); // 1 failed record -> partial
    expect(stock.result.recordsFailed).toBe(1);

    const { logs, total } = await listSyncLogs(prisma as any, BUSINESS_ID, 'shopify');
    expect(total).toBe(2);
    expect(logs[0].entity).toBe('stock'); // newest first

    const disconnected = await disconnectProvider(prisma as any, BUSINESS_ID, 'shopify');
    expect(disconnected).toMatchObject({ status: 'disconnected', hasCredentials: false });
    const stored = prisma.connections.get(`${BUSINESS_ID}::shopify`);
    expect(stored.encryptedCredentials).toBeNull();

    await expect(
      triggerSync(prisma as any, BUSINESS_ID, 'shopify', { entity: 'product' })
    ).rejects.toMatchObject({ code: 'NOT_CONNECTED' });
  });

  it('returns 501 (and no log row) for an entity the handler does not implement', async () => {
    await connectProvider(prisma as any, BUSINESS_ID, 'shopify', CREDS);
    await expect(
      triggerSync(prisma as any, BUSINESS_ID, 'shopify', { entity: 'order' })
    ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
    expect((await listSyncLogs(prisma as any, BUSINESS_ID, 'shopify')).total).toBe(0);
  });

  it('logs a failed sync and marks the connection error when the handler throws', async () => {
    registerIntegrationHandler({
      ...stubHandler,
      syncProducts: async () => {
        throw new IntegrationError('VENDOR_ERROR', 'shopify: the vendor returned HTTP 500.');
      }
    });
    await connectProvider(prisma as any, BUSINESS_ID, 'shopify', CREDS);
    await expect(
      triggerSync(prisma as any, BUSINESS_ID, 'shopify', { entity: 'product' })
    ).rejects.toMatchObject({ code: 'VENDOR_ERROR' });
    const { logs } = await listSyncLogs(prisma as any, BUSINESS_ID, 'shopify');
    expect(logs).toHaveLength(1);
    expect(logs[0].status).toBe('failed');
    expect(logs[0].errorMessage).toMatch(/HTTP 500/);
    const stored = prisma.connections.get(`${BUSINESS_ID}::shopify`);
    expect(stored.status).toBe('error');
  });

  // Generic shipment dispatch (feature/integration-postex, contract §10):
  // entity 'shipment' builds a vendor-neutral input from a sale and calls
  // the handler's createShipment — the shape every courier reuses.
  it('dispatches entity shipment to createShipment with the sale-built input', async () => {
    let receivedInput: any = null;
    registerIntegrationHandler({
      ...stubHandler,
      createShipment: async (_ctx: any, input: any) => {
        receivedInput = input;
        return { recordsProcessed: 1, recordsFailed: 0, message: 'Booked — tracking TEST-1' };
      }
    });
    await connectProvider(prisma as any, BUSINESS_ID, 'shopify', CREDS);
    const { log, result } = await triggerSync(prisma as any, BUSINESS_ID, 'shopify', {
      entity: 'shipment',
      saleRef: 'INV-1001'
    });
    expect(log.status).toBe('success');
    expect(log.entity).toBe('shipment');
    expect(result.message).toMatch(/TEST-1/);
    // Vendor-neutral input: recipient from the customer, COD = unpaid balance.
    expect(receivedInput).toMatchObject({
      saleId: 'sale-1',
      orderRef: 'INV-1001',
      recipient: { name: 'Ayesha Khan', phone: '03001234567', address: '12 Main Street, Lahore' },
      paymentMethod: 'COD',
      codAmount: 5000,
      parcel: { pieces: 2 }
    });
  });

  it('rejects a shipment sync with no saleRef or an unknown sale (no log row)', async () => {
    registerIntegrationHandler({
      ...stubHandler,
      createShipment: async () => ({ recordsProcessed: 1, recordsFailed: 0 })
    });
    await connectProvider(prisma as any, BUSINESS_ID, 'shopify', CREDS);
    await expect(
      triggerSync(prisma as any, BUSINESS_ID, 'shopify', { entity: 'shipment' })
    ).rejects.toMatchObject({ code: 'SYNC_FAILED' });
    await expect(
      triggerSync(prisma as any, BUSINESS_ID, 'shopify', { entity: 'shipment', saleRef: 'INV-9999' })
    ).rejects.toMatchObject({ code: 'SYNC_FAILED' });
    expect((await listSyncLogs(prisma as any, BUSINESS_ID, 'shopify')).total).toBe(0);
  });
});
