// ─── Google Sheets provider tests (feature/integration-google-sheets) ─
// The Google HTTP layer is stubbed (global.fetch) — these tests NEVER hit
// a live Google account. Tokens, keys and spreadsheet ids below are
// fixtures only. An RSA key pair is generated in-process for the
// service-account JWT test.
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as crypto from 'crypto';
import {
  decryptIntegrationCredentials,
  encryptIntegrationCredentials
} from '../src/utils/integration-encryption.util';
import { clearIntegrationHandlers, registerIntegrationHandler } from '../src/integrations/registry';
import { connectProvider, triggerSync } from '../src/services/integration.service';
import { googleSheetsHandler } from '../src/integrations/google-sheets/handler';
import { GoogleSheetsClient } from '../src/integrations/google-sheets/client';
import {
  buildAuthorizationUrl,
  buildOAuthState,
  exchangeAuthorizationCode,
  mintServiceAccountAccessToken,
  parseOAuthState
} from '../src/integrations/google-sheets/oauth';
import {
  CUSTOMER_HEADERS,
  KHATA_HEADERS,
  SALES_HEADERS,
  STOCK_HEADERS,
  mapCustomerRow,
  mapKhataRow,
  mapSaleRow,
  mapStockRow
} from '../src/integrations/google-sheets/mapping';
import type { IntegrationSyncContext } from '../src/integrations/types';

const TEST_KEY = crypto.randomBytes(32).toString('hex');
const BUSINESS_ID = 'biz-sheets-test';
const BRANCH_1 = 'br-main';
const BRANCH_2 = 'br-second';

const OAUTH_CREDS = {
  accessToken: 'ya29.fixture-access',
  refreshToken: '1//fixture-refresh',
  expiresAt: Date.now() + 3_600_000,
  tokenType: 'Bearer'
};

const { privateKey: SA_PRIVATE_KEY, publicKey: SA_PUBLIC_KEY } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
const SA_CREDS = {
  serviceAccountEmail: 'zapeera-export@fixture-project.iam.gserviceaccount.com',
  serviceAccountPrivateKey: SA_PRIVATE_KEY
};

// ─── Stub fetch ─────────────────────────────────────────────────────────

type StubResponse = { status: number; body: any };
type StubHandler = (url: string, init: any) => StubResponse;

class StubFetch {
  calls: Array<{ url: string; init: any }> = [];
  private handlers: Array<{ test: (url: string) => boolean; respond: StubHandler }> = [];

  when(test: RegExp | ((url: string) => boolean), respond: StubHandler | StubResponse): this {
    const predicate = typeof test === 'function' ? test : (url: string) => test.test(url);
    const responder: StubHandler =
      typeof respond === 'function' ? respond : () => respond as StubResponse;
    this.handlers.push({ test: predicate, respond: responder });
    return this;
  }

  fetch = async (url: string, init: any = {}): Promise<any> => {
    this.calls.push({ url, init });
    // Last registered handler wins, so a test can override a happy-path
    // route (e.g. force one tab's append to 500) after googleHappyPath.
    const handler = [...this.handlers].reverse().find((h) => h.test(url));
    if (!handler) throw new Error(`StubFetch: no handler for ${init?.method ?? 'GET'} ${url}`);
    const { status, body } = handler.respond(url, init);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body
    };
  };

  callsTo(pattern: RegExp): Array<{ url: string; init: any }> {
    return this.calls.filter((c) => pattern.test(c.url));
  }

  methodCalls(method: string): Array<{ url: string; init: any }> {
    return this.calls.filter((c) => (c.init?.method ?? 'GET') === method);
  }
}

function googleHappyPath(stub: StubFetch, opts: { existingTabs?: string[]; headerPresent?: boolean } = {}): void {
  const tabs = opts.existingTabs ?? ['Sales', 'Stock', 'Customers', 'Khata'];
  const headerPresent = opts.headerPresent ?? false;
  stub
    .when(/oauth2\.googleapis\.com\/token/, (url, init) => {
      const params = new URLSearchParams(String(init?.body ?? ''));
      const grant = params.get('grant_type');
      if (grant === 'authorization_code') {
        return {
          status: 200,
          body: { access_token: 'ya29.fixture-access', refresh_token: '1//fixture-refresh', expires_in: 3600, token_type: 'Bearer' }
        };
      }
      if (grant === 'refresh_token') {
        return { status: 200, body: { access_token: 'ya29.fixture-refreshed', expires_in: 3600, token_type: 'Bearer' } };
      }
      if (grant === 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
        return { status: 200, body: { access_token: 'ya29.fixture-sa', expires_in: 3600, token_type: 'Bearer' } };
      }
      return { status: 400, body: { error: 'unsupported_grant_type' } };
    })
    .when(/oauth2\.googleapis\.com\/revoke/, { status: 200, body: {} })
    .when(/\/drive\/v3\/files/, { status: 200, body: { files: [] } })
    // Registration order matters with last-wins matching: the generic
    // values handler must come BEFORE :append (it also matches append
    // URLs), and the get-spreadsheet handler BEFORE :batchUpdate.
    .when(/\/v4\/spreadsheets\/[^/]+\/values\//, (url, init) => {
      if ((init?.method ?? 'GET') === 'PUT') return { status: 200, body: {} };
      return {
        status: 200,
        body: headerPresent ? { values: [['Branch', 'x']] } : { values: [] }
      };
    })
    .when(/\/v4\/spreadsheets\/[^/]+\/values\/.*:append/, (url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      const rows = Array.isArray(body.values) ? body.values.length : 0;
      return { status: 200, body: { spreadsheetId: 'sheet-1', updates: { updatedRows: rows } } };
    })
    .when(/\/v4\/spreadsheets\/[^/]+$/, {
      status: 200,
      body: {
        properties: { title: 'Existing Sheet' },
        sheets: tabs.map((t) => ({ properties: { title: t } })),
        spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-1'
      }
    })
    .when(/\/v4\/spreadsheets\/[^/]+:batchUpdate/, { status: 200, body: {} })
    .when(/\/v4\/spreadsheets$/, (url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      return {
        status: 200,
        body: {
          spreadsheetId: 'sheet-created-1',
          properties: { title: body?.properties?.title ?? 'Zapeera Export' },
          sheets: (body?.sheets ?? []).map((s: any) => ({ properties: { title: s?.properties?.title } })),
          spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-created-1'
        }
      };
    });
}

// ─── Stub prisma (data delegates for exportData) ────────────────────────

const SALE_FIXTURES = [
  {
    id: 'sale-1',
    invoiceNumber: 'INV-001',
    branchId: BRANCH_1,
    customerId: 'cust-1',
    customer: { name: 'Ayesha Khan', phone: '03001234567' },
    subtotal: 1000,
    discountAmount: 100,
    taxAmount: 50,
    totalAmount: 950,
    paidAmount: 950,
    paymentMethod: 'CASH',
    paymentStatus: 'PAID',
    status: 'COMPLETED',
    saleDate: new Date('2026-10-20T10:00:00Z'),
    createdAt: new Date('2026-10-20T10:00:00Z')
  },
  {
    id: 'sale-2',
    invoiceNumber: 'INV-002',
    branchId: BRANCH_2,
    customerId: null,
    customer: null,
    subtotal: 500,
    discountAmount: 0,
    taxAmount: 0,
    totalAmount: 500,
    paidAmount: 200,
    paymentMethod: 'JAZZCASH',
    paymentStatus: 'PARTIAL',
    status: 'COMPLETED',
    saleDate: new Date('2026-10-21T10:00:00Z'),
    createdAt: new Date('2026-10-21T10:00:00Z')
  }
];

const PRODUCT_FIXTURES = [
  { id: 'prod-1', name: 'Paracetamol 500mg', sku: 'PARA-500', barcode: '12345', category: { name: 'Medicine' }, branchId: BRANCH_1, minStock: 10, reorderLevel: 20 },
  { id: 'prod-2', name: 'Bandage Roll', sku: 'BAND-1', barcode: null, category: { name: 'Surgical' }, branchId: BRANCH_2, minStock: 5, reorderLevel: null }
];

const BATCH_FIXTURES = [
  { productId: 'prod-1', branchId: BRANCH_1, quantity: 40, sellingPrice: 25, createdAt: new Date('2026-10-19T00:00:00Z') },
  { productId: 'prod-1', branchId: BRANCH_1, quantity: 8, sellingPrice: 30, createdAt: new Date('2026-10-18T00:00:00Z') },
  { productId: 'prod-2', branchId: BRANCH_2, quantity: 3, sellingPrice: 150, createdAt: new Date('2026-10-19T00:00:00Z') }
];

const CUSTOMER_FIXTURES = [
  { id: 'cust-1', name: 'Ayesha Khan', phone: '03001234567', email: 'a@example.com', address: 'Lahore', branchId: BRANCH_1, totalPurchases: 950, loyaltyPoints: 9, isVIP: false, lastVisit: new Date('2026-10-20T10:00:00Z'), createdAt: new Date('2026-09-01T00:00:00Z') }
];

const LEDGER_FIXTURES = [
  { id: 'led-1', customerId: 'cust-1', customer: { name: 'Ayesha Khan', phone: '03001234567', branchId: BRANCH_1 }, type: 'SALE_DUE', amount: 500, method: null, reference: null, note: 'INV-001', createdAt: new Date('2026-10-20T10:00:00Z') },
  { id: 'led-2', customerId: 'cust-1', customer: { name: 'Ayesha Khan', phone: '03001234567', branchId: BRANCH_1 }, type: 'PAYMENT', amount: -200, method: 'CASH', reference: 'RCPT-1', note: null, createdAt: new Date('2026-10-21T10:00:00Z') },
  { id: 'led-3', customerId: 'cust-1', customer: { name: 'Ayesha Khan', phone: '03001234567', branchId: BRANCH_1 }, type: 'ADJUSTMENT', amount: 50, method: null, reference: null, note: 'correction', createdAt: new Date('2026-10-22T10:00:00Z') }
];

function makeDataPrisma(overrides: Record<string, any> = {}): any {
  return {
    business: { findUnique: async () => ({ name: 'Test Pharmacy' }) },
    branch: {
      findUnique: async ({ where }: any) =>
        where.id === BRANCH_1 ? { id: BRANCH_1, name: 'Main Branch' } : where.id === BRANCH_2 ? { id: BRANCH_2, name: 'Second Branch' } : null,
      findMany: async () => [
        { id: BRANCH_1, name: 'Main Branch' },
        { id: BRANCH_2, name: 'Second Branch' }
      ]
    },
    sale: { findMany: async ({ where }: any = {}) => SALE_FIXTURES.filter((s) => !where.branchId || s.branchId === where.branchId) },
    product: { findMany: async ({ where }: any = {}) => PRODUCT_FIXTURES.filter((p) => !where.branchId || p.branchId === where.branchId) },
    batch: { findMany: async ({ where }: any = {}) => BATCH_FIXTURES.filter((b) => !where.branchId || b.branchId === where.branchId) },
    customer: { findMany: async ({ where }: any = {}) => CUSTOMER_FIXTURES.filter((c) => !where.branchId || c.branchId === where.branchId) },
    customerLedgerEntry: { findMany: async () => LEDGER_FIXTURES },
    integrationConnection: {
      findUnique: async () => ({ config: JSON.stringify({}) }),
      update: async () => ({})
    },
    ...overrides
  };
}

// ─── Shared setup ───────────────────────────────────────────────────────

const originalEnv = { ...process.env };
let stub: StubFetch;
let originalFetch: typeof fetch;

beforeEach(() => {
  process.env.INTEGRATION_ENCRYPTION_KEY = TEST_KEY;
  process.env.GOOGLE_SHEETS_CLIENT_ID = 'fixture-client-id.apps.googleusercontent.com';
  process.env.GOOGLE_SHEETS_CLIENT_SECRET = 'fixture-client-secret';
  process.env.GOOGLE_SHEETS_REDIRECT_URI = 'https://api.example.test/api/v1/integrations/google-sheets/oauth/callback';
  clearIntegrationHandlers();
  stub = new StubFetch();
  originalFetch = global.fetch;
  global.fetch = stub.fetch as any;
});

afterEach(() => {
  global.fetch = originalFetch;
  clearIntegrationHandlers();
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key];
  }
  Object.assign(process.env, originalEnv);
});

function exportCtx(prisma: any, config: Record<string, unknown> = {}, credentials: Record<string, unknown> = OAUTH_CREDS): IntegrationSyncContext {
  return {
    prisma,
    businessId: BUSINESS_ID,
    credentials,
    config: {
      syncProducts: false,
      syncStock: false,
      syncOrders: false,
      syncCustomers: false,
      direction: 'out',
      ...config
    } as any,
    logId: 'log-fixture'
  };
}

describe('google-sheets OAuth', () => {
  it('builds an authorization URL with offline access + consent prompt', () => {
    const url = new URL(buildAuthorizationUrl('state-fixture'));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('client_id')).toBe('fixture-client-id.apps.googleusercontent.com');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://api.example.test/api/v1/integrations/google-sheets/oauth/callback'
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/spreadsheets');
    expect(url.searchParams.get('scope')).toContain('https://www.googleapis.com/auth/drive.file');
    expect(url.searchParams.get('state')).toBe('state-fixture');
  });

  it('round-trips the OAuth state and rejects tampered / expired state', () => {
    const state = buildOAuthState({ businessId: BUSINESS_ID, spreadsheetId: 'sheet-9', branchId: BRANCH_1 });
    const parsed = parseOAuthState(state);
    expect(parsed).toMatchObject({ businessId: BUSINESS_ID, spreadsheetId: 'sheet-9', branchId: BRANCH_1 });
    expect(parsed.exp).toBeGreaterThan(Date.now());
    expect(state).not.toContain(BUSINESS_ID); // opaque blob, not plaintext
    expect(() => parseOAuthState(`${state.slice(0, -4)}AAAA`)).toThrow();
    expect(() => parseOAuthState('not-a-state')).toThrow();
  });

  it('exchanges an authorization code for tokens', async () => {
    googleHappyPath(stub);
    const tokens = await exchangeAuthorizationCode('auth-code-fixture');
    expect(tokens).toMatchObject({
      accessToken: 'ya29.fixture-access',
      refreshToken: '1//fixture-refresh',
      tokenType: 'Bearer'
    });
    expect(typeof tokens.expiresAt).toBe('number');
    const tokenCall = stub.callsTo(/oauth2\.googleapis\.com\/token/)[0];
    const params = new URLSearchParams(String(tokenCall.init.body));
    expect(params.get('grant_type')).toBe('authorization_code');
    expect(params.get('code')).toBe('auth-code-fixture');
  });

  it('refreshes an expired access token and keeps the old refresh token when Google does not rotate it', async () => {
    googleHappyPath(stub);
    const expired = { ...OAUTH_CREDS, accessToken: 'ya29.expired', expiresAt: Date.now() - 1000 };
    let persisted: any = null;
    const client = new GoogleSheetsClient();
    const { accessToken, credentials } = await client.resolveAccessToken(expired, async (updated) => {
      persisted = updated;
    });
    expect(accessToken).toBe('ya29.fixture-refreshed');
    expect(persisted).toMatchObject({
      accessToken: 'ya29.fixture-refreshed',
      refreshToken: '1//fixture-refresh' // not rotated by Google -> kept
    });
    expect(credentials).toEqual(persisted);
  });

  it('mints a service-account token with a verifiable RS256 JWT assertion', async () => {
    googleHappyPath(stub);
    const minted = await mintServiceAccountAccessToken(SA_CREDS);
    expect(minted.accessToken).toBe('ya29.fixture-sa');
    const tokenCall = stub.callsTo(/oauth2\.googleapis\.com\/token/)[0];
    const params = new URLSearchParams(String(tokenCall.init.body));
    expect(params.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    const assertion = params.get('assertion') ?? '';
    const [headerB64, claimB64, sigB64] = assertion.split('.');
    expect(JSON.parse(Buffer.from(headerB64, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(claimB64, 'base64url').toString());
    expect(claims).toMatchObject({
      iss: SA_CREDS.serviceAccountEmail,
      aud: 'https://oauth2.googleapis.com/token',
      scope: expect.stringContaining('https://www.googleapis.com/auth/spreadsheets')
    });
    expect(claims.exp - claims.iat).toBe(3600);
    const valid = crypto
      .createVerify('RSA-SHA256')
      .update(`${headerB64}.${claimB64}`)
      .verify(SA_PUBLIC_KEY, Buffer.from(sigB64, 'base64url'));
    expect(valid).toBe(true);
  });

  it('fails loudly when the server-side OAuth client is not configured', () => {
    delete process.env.GOOGLE_SHEETS_CLIENT_ID;
    expect(() => buildAuthorizationUrl('x')).toThrow('GOOGLE_SHEETS_CLIENT_ID');
  });
});

describe('google-sheets connect / status', () => {
  it('verifies with the cheap Drive files.list read and returns ok only after the round-trip', async () => {
    googleHappyPath(stub);
    const result = await googleSheetsHandler.connect(OAUTH_CREDS);
    expect(result).toEqual({ ok: true, message: 'Google Sheets reachable' });
    expect(stub.callsTo(/\/drive\/v3\/files\?pageSize=1/)).toHaveLength(1);
  });

  it('maps a rejected token to VENDOR_AUTH (no retry, no ok:true)', async () => {
    stub.when(/\/drive\/v3\/files/, { status: 401, body: { error: { message: 'Invalid Credentials' } } });
    await expect(googleSheetsHandler.connect(OAUTH_CREDS)).rejects.toMatchObject({ code: 'VENDOR_AUTH' });
    expect(stub.callsTo(/\/drive\/v3\/files/)).toHaveLength(1); // auth failures never retry
  });

  it('getStatus returns ok:false (not a throw) when Google rejects the token', async () => {
    stub.when(/\/drive\/v3\/files/, { status: 401, body: { error: { message: 'Invalid Credentials' } } });
    await expect(googleSheetsHandler.getStatus(OAUTH_CREDS)).resolves.toMatchObject({ ok: false });
  });

  it('connect works for a service account by minting a token first', async () => {
    googleHappyPath(stub);
    const result = await googleSheetsHandler.connect(SA_CREDS);
    expect(result.ok).toBe(true);
    expect(stub.callsTo(/oauth2\.googleapis\.com\/token/)).toHaveLength(1);
    expect(stub.callsTo(/\/drive\/v3\/files/)).toHaveLength(1);
  });
});

describe('google-sheets row mapping', () => {
  const exportedAt = '2026-10-24T12:00:00.000Z';

  it('maps all four entities with the branch column first on every row', () => {
    expect(SALES_HEADERS[0]).toBe('Branch');
    expect(STOCK_HEADERS[0]).toBe('Branch');
    expect(CUSTOMER_HEADERS[0]).toBe('Branch');
    expect(KHATA_HEADERS[0]).toBe('Branch');

    const saleRow = mapSaleRow('Main Branch', SALE_FIXTURES[0], exportedAt);
    expect(saleRow).toHaveLength(SALES_HEADERS.length);
    expect(saleRow[0]).toBe('Main Branch');
    expect(saleRow.slice(1, 5)).toEqual(['INV-001', '2026-10-20', 'Ayesha Khan', '03001234567']);
    expect(saleRow[8]).toBe(950); // total as a number, not a string
    expect(saleRow[saleRow.length - 1]).toBe(exportedAt);

    const stockRow = mapStockRow('Main Branch', PRODUCT_FIXTURES[0], 48, 25, exportedAt);
    expect(stockRow).toHaveLength(STOCK_HEADERS.length);
    expect(stockRow[0]).toBe('Main Branch');
    expect(stockRow[5]).toBe(48);
    expect(stockRow[9]).toBe('No'); // 48 > min stock 10

    const lowRow = mapStockRow('Second Branch', PRODUCT_FIXTURES[1], 3, 150, exportedAt);
    expect(lowRow[9]).toBe('Yes'); // 3 <= min stock 5

    const customerRow = mapCustomerRow('Main Branch', CUSTOMER_FIXTURES[0], exportedAt);
    expect(customerRow).toHaveLength(CUSTOMER_HEADERS.length);
    expect(customerRow[0]).toBe('Main Branch');

    const khataRow = mapKhataRow('Main Branch', LEDGER_FIXTURES[0], 500, exportedAt);
    expect(khataRow).toHaveLength(KHATA_HEADERS.length);
    expect(khataRow[0]).toBe('Main Branch');
    expect(khataRow[4]).toBe(500);
    expect(khataRow[5]).toBe(500); // running balance
  });
});

describe('google-sheets exportData', () => {
  it('creates the spreadsheet when none is configured, writes headers once, and appends all four tabs', async () => {
    googleHappyPath(stub, { headerPresent: false });
    const prisma = makeDataPrisma();
    let persistedConfig: any = null;
    prisma.integrationConnection.update = async ({ data }: any) => {
      persistedConfig = data;
      return {};
    };
    const result = await googleSheetsHandler.exportData!(exportCtx(prisma));

    // Create (one call, four tabs) + record the id back into config.
    const creates = stub.callsTo(/\/v4\/spreadsheets$/);
    expect(creates).toHaveLength(1);
    expect(JSON.parse(String(creates[0].init.body)).sheets.map((s: any) => s.properties.title)).toEqual([
      'Sales',
      'Stock',
      'Customers',
      'Khata'
    ]);
    expect(persistedConfig?.config).toContain('sheet-created-1');

    // Header rows written once per tab (tabs were empty), then appends.
    expect(stub.methodCalls('PUT')).toHaveLength(4);
    const appends = stub.callsTo(/:append/);
    expect(appends).toHaveLength(4);
    for (const call of appends) {
      expect(call.url).toContain('valueInputOption=USER_ENTERED');
      expect(call.url).toContain('insertDataOption=INSERT_ROWS');
    }

    // 2 sales + 2 products + 1 customer + 3 khata rows = 8.
    expect(result.recordsProcessed).toBe(8);
    expect(result.recordsFailed).toBe(0);
    expect(result.message).toContain('Sales 2, Stock 2, Customers 1, Khata 3');
    expect(result.message).toContain('Zapeera Export — Test Pharmacy');

    // Khata running balances: 500, then 300, then 350 (cumulative per customer).
    const khataAppend = appends.find((c) => c.url.includes('Khata'));
    const khataRows = JSON.parse(String(khataAppend!.init.body)).values;
    expect(khataRows.map((r: any[]) => r[5])).toEqual([500, 300, 350]);
    // Every appended row starts with its branch.
    for (const call of appends) {
      const rows = JSON.parse(String(call.init.body)).values as any[][];
      for (const row of rows) expect(['Main Branch', 'Second Branch']).toContain(row[0]);
    }
    // Stock aggregates batches per product: prod-1 = 40 + 8 = 48 @ latest price 25.
    const stockAppend = appends.find((c) => c.url.includes('Stock'));
    const stockRows = JSON.parse(String(stockAppend!.init.body)).values as any[][];
    expect(stockRows.find((r) => r[2] === 'PARA-500')?.[5]).toBe(48);
    expect(stockRows.find((r) => r[2] === 'PARA-500')?.[8]).toBe(25);
  });

  it('appends only (no create, no header rewrite) when the spreadsheet and headers already exist', async () => {
    googleHappyPath(stub, { headerPresent: true });
    const prisma = makeDataPrisma();
    const result = await googleSheetsHandler.exportData!(
      exportCtx(prisma, { spreadsheetId: 'sheet-1' })
    );
    expect(stub.callsTo(/\/v4\/spreadsheets$/)).toHaveLength(0); // no create
    expect(stub.methodCalls('PUT')).toHaveLength(0); // no header rewrite
    expect(stub.callsTo(/:append/)).toHaveLength(4);
    expect(result.recordsProcessed).toBe(8);
  });

  it('adds a missing tab instead of failing the run', async () => {
    googleHappyPath(stub, { existingTabs: ['Sales', 'Stock', 'Customers'], headerPresent: true });
    const prisma = makeDataPrisma();
    const result = await googleSheetsHandler.exportData!(
      exportCtx(prisma, { spreadsheetId: 'sheet-1' })
    );
    const batchUpdates = stub.callsTo(/:batchUpdate/);
    expect(batchUpdates).toHaveLength(1);
    expect(JSON.parse(String(batchUpdates[0].init.body)).requests[0].addSheet.properties.title).toBe('Khata');
    expect(result.recordsProcessed).toBe(8);
  });

  it('never overwrites: no clear/delete calls, appends use INSERT_ROWS', async () => {
    googleHappyPath(stub);
    await googleSheetsHandler.exportData!(exportCtx(makeDataPrisma()));
    const destructive = stub.calls.filter((c) => /clear|delete/i.test(c.url));
    expect(destructive).toHaveLength(0);
    for (const call of stub.callsTo(/:append/)) {
      expect(call.url).toContain('insertDataOption=INSERT_ROWS');
    }
  });

  it('scopes to one branch when config.branchId is set (data + khata filter + branch column)', async () => {
    googleHappyPath(stub);
    const prisma = makeDataPrisma();
    const result = await googleSheetsHandler.exportData!(
      exportCtx(prisma, { spreadsheetId: 'sheet-1', branchId: BRANCH_1 })
    );
    // Only Main Branch rows: 1 sale + 1 product + 1 customer + 3 khata = 6.
    expect(result.recordsProcessed).toBe(6);
    const appends = stub.callsTo(/:append/);
    for (const call of appends) {
      const rows = JSON.parse(String(call.init.body)).values as any[][];
      for (const row of rows) expect(row[0]).toBe('Main Branch');
    }
  });

  it('fails one tab without aborting the others (partial run)', async () => {
    googleHappyPath(stub);
    // Stock append fails with a 500 (retryable — stub returns 500 every time).
    // Note: encodeURIComponent leaves ' unescaped, so the range in the URL
    // carries literal quotes: values/'Stock'!A1:append.
    stub.when(/\/v4\/spreadsheets\/[^/]+\/values\/'Stock'!A1:append/, {
      status: 500,
      body: { error: { message: 'Internal error' } }
    });
    const prisma = makeDataPrisma();
    const result = await googleSheetsHandler.exportData!(
      exportCtx(prisma, { spreadsheetId: 'sheet-1' })
    );
    expect(result.recordsProcessed).toBe(6); // sales 2 + customers 1 + khata 3
    expect(result.recordsFailed).toBe(2); // the 2 stock rows
    expect(result.message).toContain('Stock:');
  });

  it('reports a missing configured spreadsheet as a clear config error', async () => {
    googleHappyPath(stub);
    // No $ anchor: getSpreadsheet appends ?fields=... to the URL.
    stub.when(/\/v4\/spreadsheets\/missing-sheet/, {
      status: 404,
      body: { error: { message: 'Requested entity was not found.' } }
    });
    await expect(
      googleSheetsHandler.exportData!(exportCtx(makeDataPrisma(), { spreadsheetId: 'missing-sheet' }))
    ).rejects.toMatchObject({ code: 'VENDOR_ERROR' });
    await expect(
      googleSheetsHandler.exportData!(exportCtx(makeDataPrisma(), { spreadsheetId: 'missing-sheet' }))
    ).rejects.toThrow(/not found/);
  });

  it('refreshes an expired token during export and persists the new tokens', async () => {
    googleHappyPath(stub);
    const prisma = makeDataPrisma();
    let persistedCreds: any = null;
    prisma.integrationConnection.update = async ({ data }: any) => {
      if (data.encryptedCredentials) persistedCreds = data.encryptedCredentials;
      return {};
    };
    const expired = { ...OAUTH_CREDS, accessToken: 'ya29.expired', expiresAt: Date.now() - 1000 };
    const result = await googleSheetsHandler.exportData!(
      exportCtx(prisma, { spreadsheetId: 'sheet-1' }, expired)
    );
    expect(result.recordsProcessed).toBe(8);
    expect(stub.callsTo(/oauth2\.googleapis\.com\/token/)).toHaveLength(1);
    expect(persistedCreds).toBeTruthy();
    expect(decryptIntegrationCredentials(persistedCreds)).toMatchObject({
      accessToken: 'ya29.fixture-refreshed',
      refreshToken: '1//fixture-refresh'
    });
  });
});

describe('google-sheets through the framework service (entity export)', () => {
  // Minimal in-memory Prisma stand-in for the service layer, extended
  // with the data delegates exportData reads.
  class FakePrisma {
    connections = new Map<string, any>();
    logs: any[] = [];
    private seq = 0;
    data = makeDataPrisma();

    private connKey(businessId: string, provider: string) {
      return `${businessId}::${provider}`;
    }

    integrationConnection = {
      findMany: async ({ where }: any) =>
        [...this.connections.values()].filter((r) => r.businessId === where.businessId),
      findUnique: async ({ where }: any) => {
        if (where.businessId_provider) {
          return this.connections.get(this.connKey(where.businessId_provider.businessId, where.businessId_provider.provider)) ?? null;
        }
        return this.data.integrationConnection.findUnique();
      },
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

    business = this.data.business;
    branch = this.data.branch;
    sale = this.data.sale;
    product = this.data.product;
    batch = this.data.batch;
    customer = this.data.customer;
    customerLedgerEntry = this.data.customerLedgerEntry;
  }

  it('registers as connectable and runs an export via triggerSync (entity export, direction out)', async () => {
    googleHappyPath(stub);
    registerIntegrationHandler(googleSheetsHandler);
    const prisma = new FakePrisma();
    const view = await connectProvider(prisma as any, BUSINESS_ID, 'google-sheets', OAUTH_CREDS, {
      direction: 'out'
    });
    expect(view).toMatchObject({ provider: 'google-sheets', status: 'connected', hasCredentials: true });
    expect(JSON.stringify(view)).not.toContain('ya29.fixture-access');

    const { log, result } = await triggerSync(prisma as any, BUSINESS_ID, 'google-sheets', { entity: 'export' });
    expect(log.status).toBe('success');
    expect(log.entity).toBe('export');
    expect(log.direction).toBe('out');
    expect(result.recordsProcessed).toBe(8);
    expect(result.message).toContain('Sales 2, Stock 2, Customers 1, Khata 3');

    // The created spreadsheet id was recorded into the stored config.
    const stored = prisma.connections.get(`${BUSINESS_ID}::google-sheets`);
    expect(JSON.parse(stored.config).spreadsheetId).toBe('sheet-created-1');
  });

  it('returns 501 (and no log row) for a per-entity sync the export-only handler does not implement', async () => {
    googleHappyPath(stub);
    registerIntegrationHandler(googleSheetsHandler);
    const prisma = new FakePrisma();
    await connectProvider(prisma as any, BUSINESS_ID, 'google-sheets', OAUTH_CREDS);
    await expect(
      triggerSync(prisma as any, BUSINESS_ID, 'google-sheets', { entity: 'product' })
    ).rejects.toMatchObject({ code: 'NOT_IMPLEMENTED' });
    expect(prisma.logs).toHaveLength(0);
  });
});
