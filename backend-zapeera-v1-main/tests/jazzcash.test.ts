// ─── JazzCash payment rail (feature/integration-jazzcash) ────────────────
// Fixtures only — global.fetch is mocked in every test; nothing here ever
// hits live JazzCash and no real credentials exist anywhere in this file.
//
// Mocked vendor responses carry a REAL pp_SecureHash computed with the
// fixture salt (computeJazzCashSecureHash): the handler verifies response
// hashes, so a fixture signed with the wrong salt would fail the very
// behavior under test. The fixture credentials below are the vendor's
// own PUBLISHED sandbox test values (Integration Guide v4.2 / ApiReferences
// worked examples: merchant MC25041, password sz1v4agvyf, salt
// 3vv9wu3a18) — public test data, not a real merchant account.
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import * as crypto from 'crypto';
import {
  buildJazzCashHashString,
  computeJazzCashSecureHash,
  verifyJazzCashSecureHash
} from '../src/integrations/jazzcash/secure-hash';
import {
  handleJazzCashIpn,
  handleJazzCashReturn,
  jazzCashHandler
} from '../src/integrations/jazzcash';
import { IntegrationError } from '../src/integrations/vendor-client';
import { encryptIntegrationCredentials } from '../src/utils/integration-encryption.util';
import {
  clearIntegrationHandlers,
  getProviderEntry,
  isProviderConnectable,
  registerIntegrationHandler
} from '../src/integrations/registry';
import { connectProvider, triggerSync } from '../src/services/integration.service';
import { DEFAULT_SYNC_CONFIG } from '../src/integrations/types';
import '../src/integrations/providers'; // side effect: registers the jazzcash handler

const TEST_KEY = crypto.randomBytes(32).toString('hex');
process.env.INTEGRATION_ENCRYPTION_KEY = TEST_KEY;
// Card redirect needs a Return URL; fixture value, never a real host.
process.env.JAZZCASH_RETURN_URL = 'https://example.test/api/v1/integrations/jazzcash/return';

const BUSINESS_ID = 'biz-jazzcash-test';
const CREDS = { merchantId: 'MC25041', password: 'sz1v4agvyf', salt: '3vv9wu3a18' };
const CTX = {
  prisma: null as any,
  businessId: BUSINESS_ID,
  credentials: CREDS,
  config: DEFAULT_SYNC_CONFIG,
  logId: 'log-test'
};

// ─── Minimal in-memory Prisma stand-in ────────────────────────────────────
// Implements only the calls the JazzCash handler + integration.service
// make, with the same argument shapes (composite-unique where:
// { businessId_provider: {...} }).
class FakePrisma {
  connections = new Map<string, any>();
  sales = new Map<string, any>();
  payments: any[] = [];
  logs: any[] = [];
  private seq = 0;

  private connKey(businessId: string, provider: string) {
    return `${businessId}::${provider}`;
  }

  integrationConnection = {
    findUnique: async ({ where }: any) =>
      this.connections.get(
        this.connKey(where.businessId_provider.businessId, where.businessId_provider.provider)
      ) ?? null,
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
      const row = this.connections.get(
        this.connKey(where.businessId_provider.businessId, where.businessId_provider.provider)
      );
      if (!row) throw new Error('Connection not found in FakePrisma.');
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }
  };

  integrationSyncLog = {
    create: async ({ data }: any) => {
      const row = { id: `log-${++this.seq}`, ...data, finishedAt: null };
      this.logs.push(row);
      return row;
    },
    update: async ({ where, data }: any) => {
      const row = this.logs.find((l) => l.id === where.id);
      if (!row) throw new Error('Log not found in FakePrisma.');
      Object.assign(row, data);
      return row;
    },
    findMany: async () => [...this.logs],
    count: async () => this.logs.length
  };

  sale = {
    findFirst: async ({ where }: any) => {
      const found = [...this.sales.values()].find(
        (s) =>
          (!where.id || s.id === where.id) &&
          (!where.companyId || s.companyId === where.companyId) &&
          (!where.invoiceNumber || s.invoiceNumber === where.invoiceNumber)
      );
      if (!found) return null;
      return { ...found, payments: this.payments.filter((p) => p.saleId === found.id) };
    },
    update: async ({ where, data }: any) => {
      const row = this.sales.get(where.id);
      if (!row) throw new Error('Sale not found in FakePrisma.');
      Object.assign(row, data);
      return row;
    }
  };

  salePayment = {
    findFirst: async ({ where }: any) =>
      this.payments.find(
        (p) =>
          p.saleId === where.saleId &&
          (!where.method || p.method === where.method) &&
          (!where.reference || p.reference === where.reference)
      ) ?? null,
    findMany: async ({ where }: any = {}) =>
      this.payments.filter(
        (p) => (!where.saleId || p.saleId === where.saleId) && (!where.method || p.method === where.method)
      ),
    create: async ({ data }: any) => {
      const row = { id: `sp-${++this.seq}`, ...data };
      this.payments.push(row);
      return row;
    }
  };

  $transaction = async (fn: any) => fn(this);
}

function makeSale(overrides: Record<string, any> = {}): any {
  return {
    id: 'sale-1',
    companyId: BUSINESS_ID,
    invoiceNumber: 'INV-1001',
    totalAmount: 1000,
    paidAmount: 0,
    paymentStatus: 'PENDING',
    paymentMethod: null,
    status: 'COMPLETED',
    ...overrides
  };
}

function seedConnected(prisma: FakePrisma) {
  prisma.connections.set(`${BUSINESS_ID}::jazzcash`, {
    id: 'conn-jc',
    businessId: BUSINESS_ID,
    provider: 'jazzcash',
    status: 'connected',
    encryptedCredentials: encryptIntegrationCredentials(CREDS),
    config: '{}',
    lastError: null,
    lastSyncAt: null
  });
}

// ─── Mocked fetch ─────────────────────────────────────────────────────────
// The handler posts JSON via the global fetch (through withVendorRetry).
// Each test queues the vendor responses it needs, in call order.
const fetchMock = jest.fn();
const realFetch = global.fetch;

function mockVendorResponses(...bodies: any[]) {
  fetchMock.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => bodies.shift()
  }));
}

/** A vendor response body signed with the fixture salt, like the real gateway. */
function signedResponse(fields: Record<string, string>): Record<string, string> {
  return { ...fields, pp_SecureHash: computeJazzCashSecureHash(fields, CREDS.salt) };
}

function ctxFor(prisma: FakePrisma) {
  return { ...CTX, prisma };
}

beforeEach(() => {
  fetchMock.mockReset();
  global.fetch = fetchMock as any;
});

afterEach(() => {
  global.fetch = realFetch;
});

// ─── SecureHash: the four published vendor test vectors ───────────────────
describe('JazzCash SecureHash (vendor test vectors, Integration Guide v4.2 §14.2)', () => {
  it('matches vector 1 — salt 9208s6wx05, MWALLET-ish field set', () => {
    const fields = {
      pp_Amount: '100',
      pp_BillReference: 'billRef3781',
      pp_CNIC: '345678',
      pp_Description: 'Test case description',
      pp_Language: 'EN',
      pp_MerchantID: 'MC32084',
      pp_MobileNumber: '03123456789',
      pp_Password: 'yy41w5f10e',
      pp_TxnCurrency: 'PKR',
      pp_TxnDateTime: '20220124224204',
      pp_TxnExpiryDateTime: '20220125224204',
      pp_TxnRefNo: 'T71608120'
    };
    expect(buildJazzCashHashString(fields, '9208s6wx05')).toBe(
      '9208s6wx05&100&billRef3781&345678&Test case description&EN&MC32084&03123456789&yy41w5f10e&PKR&20220124224204&20220125224204&T71608120'
    );
    expect(computeJazzCashSecureHash(fields, '9208s6wx05')).toBe(
      '39ECAACFC30F9AFA1763B7E61EA33AC75977FB2E849A5EE1EDC4016791F3438F'
    );
  });

  it('matches vector 2 — status inquiry {MC25041, sz1v4agvyf, T20220203110109}', () => {
    expect(
      computeJazzCashSecureHash(
        { pp_MerchantID: 'MC25041', pp_Password: 'sz1v4agvyf', pp_TxnRefNo: 'T20220203110109' },
        '3vv9wu3a18'
      )
    ).toBe('18494EE9B220CA4ADBE3ED5B597CCBF26E8C6F8BA205A9199A2EC8B87A2C0673');
  });

  it('matches vector 3 — card refund {10000, MC18746, a880tb6hat, PKR, TREF2022051812564132}', () => {
    expect(
      computeJazzCashSecureHash(
        {
          pp_Amount: '10000',
          pp_MerchantID: 'MC18746',
          pp_Password: 'a880tb6hat',
          pp_TxnCurrency: 'PKR',
          pp_TxnRefNo: 'TREF2022051812564132'
        },
        'yxxsz9104y'
      )
    ).toBe('EC7D0A8D704E0E0652BF69838FD3DB156C2C6D2F8AEB082A65D64E2EAC139865');
  });

  it('matches vector 4 — MWALLET refund {25000, MC25041, MPIN 1234, password sz1v4agvyf, PKR, T20220518150213}', () => {
    expect(
      computeJazzCashSecureHash(
        {
          pp_Amount: '25000',
          pp_MerchantID: 'MC25041',
          pp_MerchantMPIN: '1234',
          pp_Password: 'sz1v4agvyf',
          pp_TxnCurrency: 'PKR',
          pp_TxnRefNo: 'T20220518150213'
        },
        '3vv9wu3a18'
      )
    ).toBe('2C595361C2DA0E502D18BFBAA92CF4740330215E5E8AD0CF4489A64E7400B117');
  });

  it('skips empty values and sorts ppmpf_* last, in numeric order', () => {
    const fields = {
      pp_Amount: '100',
      pp_BankID: '',
      pp_MerchantID: 'MC25041',
      pp_ProductID: '',
      pp_TxnRefNo: 'T1',
      ppmpf_2: 'second',
      ppmpf_1: 'first'
    };
    expect(buildJazzCashHashString(fields, 'salt')).toBe('salt&100&MC25041&T1&first&second');
  });

  it('verify: true on a round-trip, false on a tampered value', () => {
    const fields = { pp_Amount: '10000', pp_MerchantID: 'MC25041', pp_TxnRefNo: 'T1' };
    const hash = computeJazzCashSecureHash(fields, CREDS.salt);
    expect(verifyJazzCashSecureHash({ ...fields, pp_SecureHash: hash }, CREDS.salt, hash)).toBe(true);
    expect(
      verifyJazzCashSecureHash({ ...fields, pp_Amount: '99999', pp_SecureHash: hash }, CREDS.salt, hash)
    ).toBe(false);
    expect(verifyJazzCashSecureHash(fields, CREDS.salt, '')).toBe(false);
  });
});

// ─── Wiring: the barrel registers the handler ─────────────────────────────
describe('provider wiring (providers.ts barrel)', () => {
  it('jazzcash is connectable once the barrel is imported', () => {
    expect(isProviderConnectable('jazzcash')).toBe(true);
    const entry = getProviderEntry('jazzcash');
    expect(entry?.displayName).toBe('JazzCash');
    expect(entry?.category).toBe('payments');
    expect(entry?.sandboxAvailable).toBe(true);
  });
});

// ─── connect / getStatus: the status-inquiry probe ────────────────────────
describe('connect / getStatus (status-inquiry probe)', () => {
  beforeEach(() => {
    clearIntegrationHandlers();
    registerIntegrationHandler(jazzCashHandler);
  });

  it('connect() returns ok:true when the probe is accepted (000 + payment code 109)', async () => {
    mockVendorResponses(
      signedResponse({
        pp_ResponseCode: '000',
        pp_ResponseMessage: 'Transaction does not exist',
        pp_PaymentResponseCode: '109',
        pp_TxnRefNo: 'ZV000000000000001'
      })
    );
    const result = await jazzCashHandler.connect!(CREDS);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('sandbox.jazzcash.com.pk/ApplicationAPI/API/PaymentInquiry/Inquire');
    const sent = JSON.parse(String(init.body));
    expect(sent.pp_MerchantID).toBe('MC25041');
    expect(sent.pp_TxnRefNo).toMatch(/^ZV/);
    expect(typeof sent.pp_SecureHash).toBe('string');
  });

  it('connect() returns ok:false on code 101 (bad credentials)', async () => {
    mockVendorResponses(
      signedResponse({ pp_ResponseCode: '101', pp_ResponseMessage: 'Invalid merchant credentials' })
    );
    const result = await jazzCashHandler.connect!(CREDS);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/101/);
  });

  it('getStatus() verifies the same way', async () => {
    mockVendorResponses(
      signedResponse({ pp_ResponseCode: '000', pp_PaymentResponseCode: '109', pp_ResponseMessage: 'ok' })
    );
    const result = await jazzCashHandler.getStatus!(CREDS);
    expect(result.ok).toBe(true);
  });

  it('HTTP 500 retries, then surfaces an IntegrationError', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await expect(jazzCashHandler.connect!(CREDS)).rejects.toBeInstanceOf(IntegrationError);
    // withVendorRetry: 3 retries = 4 attempts total.
    expect(fetchMock).toHaveBeenCalledTimes(4);
  }, 20000);

  it('a network failure retries, then surfaces VENDOR_UNREACHABLE', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    await expect(jazzCashHandler.connect!(CREDS)).rejects.toMatchObject({ code: 'VENDOR_UNREACHABLE' });
    expect(fetchMock).toHaveBeenCalledTimes(4);
  }, 20000);
});

// ─── processPayment ───────────────────────────────────────────────────────
describe('processPayment', () => {
  beforeEach(() => {
    clearIntegrationHandlers();
    registerIntegrationHandler(jazzCashHandler);
  });

  it('MWALLET success (000) records one SalePayment on the existing sale ledger', async () => {
    const prisma = new FakePrisma();
    prisma.sales.set('sale-1', makeSale());
    mockVendorResponses(
      signedResponse({
        pp_ResponseCode: '000',
        pp_ResponseMessage: 'Success',
        pp_RetrievalReferenceNo: 'RRN-1001',
        pp_AuthCode: 'AUTH-1'
      })
    );
    const result = await jazzCashHandler.processPayment!(ctxFor(prisma), {
      saleId: 'sale-1',
      amount: 1000,
      method: 'mobile-account',
      mobileNumber: '03123456789',
      cnicLast6: '345678'
    });
    expect(result.status).toBe('success');
    expect(result.txnRefNo).toMatch(/^ZAP/);
    expect(result.retrievalReferenceNo).toBe('RRN-1001');
    expect(result.responseCode).toBe('000');
    expect(prisma.payments).toHaveLength(1);
    expect(prisma.payments[0]).toMatchObject({
      saleId: 'sale-1',
      method: 'JAZZCASH',
      amount: 1000,
      reference: 'RRN-1001'
    });
    const sale = prisma.sales.get('sale-1');
    expect(sale.paidAmount).toBe(1000);
    expect(sale.paymentStatus).toBe('COMPLETED');
    expect(sale.paymentMethod).toBe('JAZZCASH');
  });

  it('a partial MWALLET payment leaves the sale PENDING with a JAZZCASH headline', async () => {
    const prisma = new FakePrisma();
    prisma.sales.set('sale-1', makeSale());
    mockVendorResponses(
      signedResponse({ pp_ResponseCode: '000', pp_ResponseMessage: 'Success', pp_RetrievalReferenceNo: 'RRN-1002' })
    );
    const result = await jazzCashHandler.processPayment!(ctxFor(prisma), {
      saleId: 'sale-1',
      amount: 400,
      method: 'mobile-account',
      mobileNumber: '03123456789',
      cnicLast6: '345678'
    });
    expect(result.status).toBe('success');
    const sale = prisma.sales.get('sale-1');
    expect(sale.paidAmount).toBe(400);
    expect(sale.paymentStatus).toBe('PENDING');
    expect(sale.paymentMethod).toBe('JAZZCASH');
  });

  it('a payment above the remaining balance is refused before any vendor call', async () => {
    const prisma = new FakePrisma();
    prisma.sales.set('sale-1', makeSale({ paidAmount: 800 }));
    await expect(
      jazzCashHandler.processPayment!(ctxFor(prisma), {
        saleId: 'sale-1',
        amount: 500,
        method: 'mobile-account',
        mobileNumber: '03123456789',
        cnicLast6: '345678'
      })
    ).rejects.toThrow(/exceeds the sale's remaining balance/);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(prisma.payments).toHaveLength(0);
  });

  it('a declined MWALLET payment (999) is a failed result and records nothing', async () => {
    const prisma = new FakePrisma();
    prisma.sales.set('sale-1', makeSale());
    mockVendorResponses(
      signedResponse({ pp_ResponseCode: '999', pp_ResponseMessage: 'Transaction failed.' })
    );
    const result = await jazzCashHandler.processPayment!(ctxFor(prisma), {
      saleId: 'sale-1',
      amount: 1000,
      method: 'mobile-account',
      mobileNumber: '03123456789',
      cnicLast6: '345678'
    });
    expect(result.status).toBe('failed');
    expect(result.responseCode).toBe('999');
    expect(prisma.payments).toHaveLength(0);
    expect(prisma.sales.get('sale-1').paidAmount).toBe(0);
  });

  it('MWALLET pending (157) records nothing — the IPN / inquiry confirms it later', async () => {
    const prisma = new FakePrisma();
    prisma.sales.set('sale-1', makeSale());
    mockVendorResponses(
      signedResponse({ pp_ResponseCode: '157', pp_ResponseMessage: 'Pending customer approval' })
    );
    const result = await jazzCashHandler.processPayment!(ctxFor(prisma), {
      saleId: 'sale-1',
      amount: 1000,
      method: 'mobile-account',
      mobileNumber: '03123456789',
      cnicLast6: '345678'
    });
    expect(result.status).toBe('pending');
    expect(result.nextStep).toMatch(/approve/);
    expect(prisma.payments).toHaveLength(0);
  });

  it('a success response with a WRONG hash is rejected and records nothing', async () => {
    const prisma = new FakePrisma();
    prisma.sales.set('sale-1', makeSale());
    // Signed with a different salt — the gateway would never produce this.
    const tampered = {
      pp_ResponseCode: '000',
      pp_ResponseMessage: 'Success',
      pp_RetrievalReferenceNo: 'RRN-FAKE',
      pp_SecureHash: computeJazzCashSecureHash(
        { pp_ResponseCode: '000', pp_RetrievalReferenceNo: 'RRN-FAKE' },
        'wrong-salt'
      )
    };
    mockVendorResponses(tampered);
    await expect(
      jazzCashHandler.processPayment!(ctxFor(prisma), {
        saleId: 'sale-1',
        amount: 1000,
        method: 'mobile-account',
        mobileNumber: '03123456789',
        cnicLast6: '345678'
      })
    ).rejects.toMatchObject({ code: 'VENDOR_ERROR' });
    expect(prisma.payments).toHaveLength(0);
  });

  it('OTC (124) is pending with a voucher number and records nothing', async () => {
    const prisma = new FakePrisma();
    prisma.sales.set('sale-1', makeSale());
    mockVendorResponses(
      signedResponse({
        pp_ResponseCode: '124',
        pp_ResponseMessage: 'Order is placed and waiting for financials to be received over the counter.',
        pp_RetrievalReferenceNo: 'VOUCHER-55'
      })
    );
    const result = await jazzCashHandler.processPayment!(ctxFor(prisma), {
      saleId: 'sale-1',
      amount: 1000,
      method: 'otc'
    });
    expect(result.status).toBe('pending');
    expect(result.voucherNo).toBe('VOUCHER-55');
    expect(prisma.payments).toHaveLength(0);
  });

  it('bank-account returns a failed result naming the unpublished-endpoint gap (no vendor call)', async () => {
    const prisma = new FakePrisma();
    prisma.sales.set('sale-1', makeSale());
    const result = await jazzCashHandler.processPayment!(ctxFor(prisma), {
      saleId: 'sale-1',
      amount: 1000,
      method: 'bank-account',
      bankId: 'HBL',
      accountNo: '1234567890',
      cnic: '3520212345678'
    });
    expect(result.status).toBe('failed');
    expect(result.responseMessage).toMatch(/not published|endpoint URLs/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('card returns a redirect with SIGNED form fields and records nothing', async () => {
    const prisma = new FakePrisma();
    prisma.sales.set('sale-1', makeSale());
    const result = await jazzCashHandler.processPayment!(ctxFor(prisma), {
      saleId: 'sale-1',
      amount: 1000,
      method: 'card'
    });
    expect(result.status).toBe('redirect');
    expect(result.redirectUrl).toContain('sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform/');
    const fields = result.redirectFields!;
    expect(fields.pp_MerchantID).toBe('MC25041');
    expect(fields.pp_ReturnURL).toBe('https://example.test/api/v1/integrations/jazzcash/return');
    expect(fields.pp_Amount).toBe('100000'); // PKR 1000 -> paisas
    expect(fields.pp_TxnCurrency).toBe('PKR');
    // The returned hash must verify against the fields with the fixture salt.
    expect(verifyJazzCashSecureHash(fields, CREDS.salt, fields.pp_SecureHash)).toBe(true);
    expect(prisma.payments).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a refunded sale cannot take a payment', async () => {
    const prisma = new FakePrisma();
    prisma.sales.set('sale-1', makeSale({ status: 'REFUNDED', paymentStatus: 'REFUNDED' }));
    await expect(
      jazzCashHandler.processPayment!(ctxFor(prisma), {
        saleId: 'sale-1',
        amount: 100,
        method: 'otc'
      })
    ).rejects.toThrow(/already been refunded/);
  });
});

// ─── inquirePayment ───────────────────────────────────────────────────────
describe('inquirePayment', () => {
  beforeEach(() => {
    clearIntegrationHandlers();
    registerIntegrationHandler(jazzCashHandler);
  });

  it.each([
    ['121', 'completed'],
    ['131', 'refunded'],
    ['157', 'pending'],
    ['124', 'pending'],
    ['109', 'unknown'],
    ['199', 'failed']
  ])('payment code %s maps to %s', async (paymentCode, expected) => {
    const prisma = new FakePrisma();
    mockVendorResponses(
      signedResponse({
        pp_ResponseCode: '000',
        pp_ResponseMessage: 'ok',
        pp_PaymentResponseCode: paymentCode,
        pp_RetrievalReferenceNo: 'RRN-9'
      })
    );
    const result = await jazzCashHandler.inquirePayment!(ctxFor(prisma), 'ZAP202410240001');
    expect(result.status).toBe(expected);
    expect(result.paymentResponseCode).toBe(paymentCode);
    expect(result.txnRefNo).toBe('ZAP202410240001');
  });

  it('a non-000 operation code with bad credentials throws VENDOR_AUTH', async () => {
    const prisma = new FakePrisma();
    mockVendorResponses(
      signedResponse({ pp_ResponseCode: '101', pp_ResponseMessage: 'Invalid merchant credentials' })
    );
    await expect(jazzCashHandler.inquirePayment!(ctxFor(prisma), 'ZAP1')).rejects.toMatchObject({
      code: 'VENDOR_AUTH'
    });
  });
});

// ─── refundPayment ────────────────────────────────────────────────────────
describe('refundPayment', () => {
  beforeEach(() => {
    clearIntegrationHandlers();
    registerIntegrationHandler(jazzCashHandler);
  });

  it('MWALLET refund (000) returns the refunded amounts', async () => {
    const prisma = new FakePrisma();
    prisma.sales.set('sale-1', makeSale({ paidAmount: 1000, paymentStatus: 'COMPLETED' }));
    mockVendorResponses(
      signedResponse({
        pp_ResponseCode: '000',
        pp_ResponseMessage: 'Refund successful',
        pp_RefundAmount: '100000',
        pp_TotalRefundAmount: '100000'
      })
    );
    const result = await jazzCashHandler.refundPayment!(ctxFor(prisma), {
      saleId: 'sale-1',
      txnRefNo: 'ZAP202410240001',
      amount: 1000,
      method: 'mobile-account',
      merchantMpin: '1234'
    });
    expect(result.status).toBe('success');
    expect(result.refundAmount).toBe(1000);
    expect(result.totalRefundAmount).toBe(1000);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('Purchase/domwalletrefundtransaction');
  });

  it('MWALLET refund without a merchant MPIN throws before any vendor call', async () => {
    const prisma = new FakePrisma();
    prisma.sales.set('sale-1', makeSale());
    await expect(
      jazzCashHandler.refundPayment!(ctxFor(prisma), {
        saleId: 'sale-1',
        txnRefNo: 'ZAP1',
        amount: 100,
        method: 'mobile-account'
      })
    ).rejects.toThrow(/Merchant MPIN is required/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a failed MWALLET refund (non-000) is a failed result', async () => {
    const prisma = new FakePrisma();
    prisma.sales.set('sale-1', makeSale());
    mockVendorResponses(
      signedResponse({ pp_ResponseCode: '999', pp_ResponseMessage: 'Refund failed.' })
    );
    const result = await jazzCashHandler.refundPayment!(ctxFor(prisma), {
      saleId: 'sale-1',
      txnRefNo: 'ZAP1',
      amount: 100,
      method: 'mobile-account',
      merchantMpin: '1234'
    });
    expect(result.status).toBe('failed');
    expect(result.refundAmount).toBe(0);
  });

  it('card refund (000, lowercase response fields) succeeds', async () => {
    const prisma = new FakePrisma();
    prisma.sales.set('sale-1', makeSale());
    mockVendorResponses(
      signedResponse({
        responseCode: '000',
        responseMessage: 'Refund successful',
        refundAmount: '50000',
        totalRefundAmount: '50000'
      })
    );
    const result = await jazzCashHandler.refundPayment!(ctxFor(prisma), {
      saleId: 'sale-1',
      txnRefNo: 'TREF1',
      amount: 500,
      method: 'card'
    });
    expect(result.status).toBe('success');
    expect(result.refundAmount).toBe(500);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('authorize/Refund');
  });

  it('OTC refund returns a failed result naming the unpublished-endpoint gap', async () => {
    const prisma = new FakePrisma();
    prisma.sales.set('sale-1', makeSale());
    const result = await jazzCashHandler.refundPayment!(ctxFor(prisma), {
      saleId: 'sale-1',
      txnRefNo: 'ZAP1',
      amount: 100,
      method: 'otc'
    });
    expect(result.status).toBe('failed');
    expect(result.responseMessage).toMatch(/not published/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── IPN ──────────────────────────────────────────────────────────────────
describe('handleJazzCashIpn', () => {
  beforeEach(() => {
    clearIntegrationHandlers();
    registerIntegrationHandler(jazzCashHandler);
  });

  function ipnBody(overrides: Record<string, string> = {}): Record<string, string> {
    const fields = {
      pp_TxnRefNo: 'ZAP202410240001',
      pp_ResponseCode: '121',
      pp_ResponseMessage: 'Payment confirmed',
      pp_TxnType: 'MWALLET',
      pp_MerchantID: 'MC25041',
      pp_Password: 'sz1v4agvyf',
      pp_Amount: '100000',
      pp_BillReference: 'INV-1001',
      pp_RetrievalReferenceNo: 'RRN-IPN-1',
      ppmpf_1: 'sale-1',
      ...overrides
    };
    return signedResponse(fields);
  }

  it('a valid signed IPN (121) records the payment once', async () => {
    const prisma = new FakePrisma();
    prisma.sales.set('sale-1', makeSale());
    seedConnected(prisma);
    mockVendorResponses(
      signedResponse({
        pp_ResponseCode: '000',
        pp_PaymentResponseCode: '121',
        pp_ResponseMessage: 'ok',
        pp_RetrievalReferenceNo: 'RRN-IPN-1',
        pp_Amount: '100000'
      })
    );
    const outcome = await handleJazzCashIpn(prisma, ipnBody());
    expect(outcome.ok).toBe(true);
    expect(outcome.code).toBe('RECORDED');
    expect(outcome.saleId).toBe('sale-1');
    expect(prisma.payments).toHaveLength(1);
    expect(prisma.payments[0]).toMatchObject({
      saleId: 'sale-1',
      method: 'JAZZCASH',
      amount: 1000,
      reference: 'RRN-IPN-1'
    });
    expect(prisma.sales.get('sale-1').paymentStatus).toBe('COMPLETED');
  });

  it('the same IPN delivered twice records a single payment (duplicate ack)', async () => {
    const prisma = new FakePrisma();
    prisma.sales.set('sale-1', makeSale());
    seedConnected(prisma);
    const inquiry = signedResponse({
      pp_ResponseCode: '000',
      pp_PaymentResponseCode: '121',
      pp_ResponseMessage: 'ok',
      pp_RetrievalReferenceNo: 'RRN-IPN-1',
      pp_Amount: '100000'
    });
    mockVendorResponses(inquiry, { ...inquiry });
    const body = ipnBody();
    const first = await handleJazzCashIpn(prisma, body);
    const second = await handleJazzCashIpn(prisma, body);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.code).toBe('DUPLICATE');
    expect(second.duplicate).toBe(true);
    expect(prisma.payments).toHaveLength(1);
  });

  it('a tampered IPN (amount changed after signing) is rejected and records nothing', async () => {
    const prisma = new FakePrisma();
    prisma.sales.set('sale-1', makeSale());
    seedConnected(prisma);
    const body = ipnBody();
    body.pp_Amount = '9999999'; // tampered after signing
    const outcome = await handleJazzCashIpn(prisma, body);
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('BAD_HASH');
    expect(prisma.payments).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled(); // no inquiry on an untrusted callback
  });

  it('an IPN for an unknown sale is rejected', async () => {
    const prisma = new FakePrisma();
    seedConnected(prisma);
    const outcome = await handleJazzCashIpn(prisma, ipnBody({ ppmpf_1: 'sale-missing', pp_BillReference: 'INV-9999' }));
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('UNKNOWN_SALE');
  });

  it('an IPN with no hash at all is rejected', async () => {
    const prisma = new FakePrisma();
    prisma.sales.set('sale-1', makeSale());
    seedConnected(prisma);
    const { pp_SecureHash: _drop, ...unsigned } = ipnBody();
    void _drop;
    const outcome = await handleJazzCashIpn(prisma, unsigned);
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('INVALID_CALLBACK');
    expect(prisma.payments).toHaveLength(0);
  });

  it('a refund IPN (131) is acknowledged without recording a payment', async () => {
    const prisma = new FakePrisma();
    prisma.sales.set('sale-1', makeSale());
    seedConnected(prisma);
    const outcome = await handleJazzCashIpn(prisma, ipnBody({ pp_ResponseCode: '131' }));
    expect(outcome.ok).toBe(true);
    expect(outcome.code).toBe('REFUNDED');
    expect(prisma.payments).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── Return URL ───────────────────────────────────────────────────────────
describe('handleJazzCashReturn', () => {
  beforeEach(() => {
    clearIntegrationHandlers();
    registerIntegrationHandler(jazzCashHandler);
  });

  it('a successful return (000) reconciles via inquiry and reports success', async () => {
    const prisma = new FakePrisma();
    prisma.sales.set('sale-1', makeSale());
    seedConnected(prisma);
    mockVendorResponses(
      signedResponse({
        pp_ResponseCode: '000',
        pp_PaymentResponseCode: '121',
        pp_ResponseMessage: 'ok',
        pp_RetrievalReferenceNo: 'RRN-RET-1',
        pp_Amount: '100000'
      })
    );
    const body = signedResponse({
      pp_TxnRefNo: 'ZAP202410240001',
      pp_ResponseCode: '000',
      pp_ResponseMessage: 'Success',
      pp_MerchantID: 'MC25041',
      pp_Password: 'sz1v4agvyf',
      pp_Amount: '100000',
      pp_BillReference: 'INV-1001',
      pp_RetrievalReferenceNo: 'RRN-RET-1',
      ppmpf_1: 'sale-1'
    });
    const outcome = await handleJazzCashReturn(prisma, body);
    expect(outcome.status).toBe('success');
    expect(outcome.saleId).toBe('sale-1');
    expect(outcome.amountPkr).toBe(1000);
    expect(prisma.payments).toHaveLength(1);
  });

  it('a failed return (non-000) reports failed without recording', async () => {
    const prisma = new FakePrisma();
    prisma.sales.set('sale-1', makeSale());
    seedConnected(prisma);
    const body = signedResponse({
      pp_TxnRefNo: 'ZAP202410240001',
      pp_ResponseCode: '999',
      pp_ResponseMessage: 'Payment failed',
      pp_MerchantID: 'MC25041',
      pp_Password: 'sz1v4agvyf',
      pp_Amount: '100000',
      ppmpf_1: 'sale-1'
    });
    const outcome = await handleJazzCashReturn(prisma, body);
    expect(outcome.status).toBe('failed');
    expect(prisma.payments).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── Service wiring: connect + triggerSync entity 'payment' ───────────────
describe('service wiring (integration.service)', () => {
  beforeEach(() => {
    clearIntegrationHandlers();
    registerIntegrationHandler(jazzCashHandler);
  });

  it('connectProvider verifies against the vendor and stores encrypted credentials', async () => {
    const prisma = new FakePrisma();
    mockVendorResponses(
      signedResponse({ pp_ResponseCode: '000', pp_PaymentResponseCode: '109', pp_ResponseMessage: 'ok' })
    );
    const view = await connectProvider(prisma, BUSINESS_ID, 'jazzcash', CREDS);
    expect(view.status).toBe('connected');
    expect(view.provider).toBe('jazzcash');
    const row = prisma.connections.get(`${BUSINESS_ID}::jazzcash`);
    expect(row.status).toBe('connected');
    expect(row.encryptedCredentials).toMatch(/^v1\./);
    expect(row.encryptedCredentials).not.toContain('sz1v4agvyf');
  });

  it("triggerSync entity 'payment' takes a MWALLET payment and returns the payment result", async () => {
    const prisma = new FakePrisma();
    prisma.sales.set('sale-1', makeSale());
    seedConnected(prisma);
    mockVendorResponses(
      signedResponse({
        pp_ResponseCode: '000',
        pp_ResponseMessage: 'Success',
        pp_RetrievalReferenceNo: 'RRN-SVC-1',
        pp_AuthCode: 'AUTH-SVC'
      })
    );
    const { log, result, payment } = await triggerSync(prisma, BUSINESS_ID, 'jazzcash', {
      entity: 'payment',
      payment: {
        saleId: 'sale-1',
        amount: 1000,
        method: 'mobile-account',
        mobileNumber: '03123456789',
        cnicLast6: '345678'
      }
    });
    expect(log.status).toBe('success');
    expect(result.recordsProcessed).toBe(1);
    expect(result.recordsFailed).toBe(0);
    expect(result.message).toMatch(/RRN-SVC-1/);
    expect(payment?.status).toBe('success');
    expect(payment?.txnRefNo).toMatch(/^ZAP/);
    expect(prisma.payments).toHaveLength(1);
  });

  it("triggerSync entity 'payment' without a payment payload throws", async () => {
    const prisma = new FakePrisma();
    seedConnected(prisma);
    await expect(
      triggerSync(prisma, BUSINESS_ID, 'jazzcash', { entity: 'payment' })
    ).rejects.toMatchObject({ code: 'VENDOR_ERROR' });
  });
});
