import { describe, it, expect, beforeEach } from '@jest/globals';

// ── Fake Prisma ────────────────────────────────────────────────────────────

const mockPrismaRef: { current: any } = { current: null };

jest.mock('../src/utils/db.util', () => ({
  getPrisma: async () => mockPrismaRef.current,
  isSQLite: () => true,
  isPostgreSQL: () => false,
  getPrismaSync: () => mockPrismaRef.current,
  disconnectPrisma: async () => undefined,
}));

import {
  getReceiptSettingsHandler,
  updateReceiptSettingsHandler,
} from '../src/controllers/receipt-settings.controller';

function fakePrisma(initialRow: any = null) {
  let row = initialRow;
  return {
    receiptSettings: {
      findUnique: async ({ where }: any) => (row && where.companyId === row.companyId ? row : null),
      upsert: async ({ where, create, update }: any) => {
        row = row && row.companyId === where.companyId ? { ...row, ...update } : { id: 'rs-1', ...create };
        return { ...row, updatedAt: new Date('2026-10-25T23:30:00Z') };
      },
    },
    __getRow: () => row,
  };
}

function mockRes() {
  const res: any = { statusCode: 200, body: null };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: any) => {
    res.body = body;
    return res;
  };
  return res;
}

const reqFor = (role: string, body: any = {}) => ({
  business_id: 'b1',
  membership: { business_id: 'b1', role_name: role },
  user: { id: 'u-1', role },
  headers: {},
  body,
});

describe('receipt settings', () => {
  beforeEach(() => {
    mockPrismaRef.current = fakePrisma();
  });

  it('owner can update settings', async () => {
    const req: any = reqFor('OWNER', { template: 'thermal', footerMessage: 'Thank you!' });
    const res = mockRes();
    await updateReceiptSettingsHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.template).toBe('thermal');
    expect(res.body.data.footerMessage).toBe('Thank you!');
    // Untouched defaults survive the partial update.
    expect(res.body.data.showCashier).toBe(true);
    expect(mockPrismaRef.current.__getRow().template).toBe('thermal');
  });

  it('manager can update settings', async () => {
    const req: any = reqFor('MANAGER', { template: 'a4', showFbr: false });
    const res = mockRes();
    await updateReceiptSettingsHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.template).toBe('a4');
    expect(res.body.data.showFbr).toBe(false);
    expect(res.body.data.showCashier).toBe(true);
  });

  it('cashier gets 403 on PUT', async () => {
    const req: any = reqFor('CASHIER', { template: 'thermal' });
    const res = mockRes();
    await updateReceiptSettingsHandler(req, res);
    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(mockPrismaRef.current.__getRow()).toBeNull();
  });

  it('invalid template is rejected with 400', async () => {
    const req: any = reqFor('OWNER', { template: 'wide' });
    const res = mockRes();
    await updateReceiptSettingsHandler(req, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(mockPrismaRef.current.__getRow()).toBeNull();
  });

  it('GET returns defaults when no row exists', async () => {
    const req: any = reqFor('CASHIER');
    const res = mockRes();
    await getReceiptSettingsHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.template).toBe('a4');
    expect(res.body.data.displayName).toBeNull();
    expect(res.body.data.showCashier).toBe(true);
    expect(res.body.data.showCustomer).toBe(true);
    expect(res.body.data.showPrescription).toBe(true);
    expect(res.body.data.showTaxBreakdown).toBe(true);
    expect(res.body.data.showFbr).toBe(true);
    expect(res.body.data.showPayment).toBe(true);
    expect(res.body.data.showItemDetails).toBe(true);
  });

  it('GET falls back to a4 for a stored unknown template', async () => {
    mockPrismaRef.current = fakePrisma({ companyId: 'b1', template: 'wide', showCashier: false });
    const req: any = reqFor('OWNER');
    const res = mockRes();
    await getReceiptSettingsHandler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.data.template).toBe('a4');
    expect(res.body.data.showCashier).toBe(false);
  });
});
