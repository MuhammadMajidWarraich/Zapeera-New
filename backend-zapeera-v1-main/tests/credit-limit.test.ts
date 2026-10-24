// ─── Item 7: customer credit limits + salesman attribution ──────────
// Unit tests over stub Prisma clients — no database needed. They pin
// the money rules: a credit charge is allowed only while
//   khata balance + new due <= Customer.creditLimit
// and a null limit means unlimited (historical behaviour). They also
// pin the salesman attribution rule (same OR as the commission
// calculation) and the schema fields the feature depends on.

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  checkCreditLimit,
  getCustomerKhataBalance,
  getCustomerCreditLimit,
  CREDIT_LIMIT_EXCEEDED,
  CREDIT_LIMIT_OVERRIDE_ROLES
} from '../src/utils/credit-limit.util';
import { attributedSalesWhere } from '../src/controllers/salesman.controller';

// Minimal Prisma-shaped stub: only the two calls the helper makes.
const stubClient = (opts: { balance?: number; creditLimit?: number | null }) => ({
  customerLedgerEntry: {
    aggregate: async () => ({ _sum: { amount: opts.balance ?? 0 } })
  },
  customer: {
    findFirst: async () => ({ creditLimit: opts.creditLimit ?? null })
  }
});

describe('credit-limit helper (gap item 7)', () => {
  it('returns null (unlimited) when the customer has no limit set', async () => {
    const result = await checkCreditLimit(stubClient({ balance: 999999, creditLimit: null }), 'c1', 'biz1', 5000);
    expect(result).toBeNull();
  });

  it('allows a charge that stays within the limit', async () => {
    const result = await checkCreditLimit(stubClient({ balance: 4000, creditLimit: 10000 }), 'c1', 'biz1', 5000);
    expect(result).toEqual({
      allowed: true,
      balance: 4000,
      creditLimit: 10000,
      projectedBalance: 9000,
      overBy: 0
    });
  });

  it('allows a charge that lands exactly on the limit', async () => {
    const result = await checkCreditLimit(stubClient({ balance: 4000, creditLimit: 10000 }), 'c1', 'biz1', 6000);
    expect(result?.allowed).toBe(true);
    expect(result?.projectedBalance).toBe(10000);
    expect(result?.overBy).toBe(0);
  });

  it('blocks a charge that would exceed the limit, with the overage', async () => {
    const result = await checkCreditLimit(stubClient({ balance: 8000, creditLimit: 10000 }), 'c1', 'biz1', 5000);
    expect(result).toEqual({
      allowed: false,
      balance: 8000,
      creditLimit: 10000,
      projectedBalance: 13000,
      overBy: 3000
    });
  });

  it('blocks any credit when the limit is already reached', async () => {
    const result = await checkCreditLimit(stubClient({ balance: 10000, creditLimit: 10000 }), 'c1', 'biz1', 1);
    expect(result?.allowed).toBe(false);
    expect(result?.overBy).toBe(1);
  });

  it('blocks any credit when the limit is zero', async () => {
    const result = await checkCreditLimit(stubClient({ balance: 0, creditLimit: 0 }), 'c1', 'biz1', 100);
    expect(result?.allowed).toBe(false);
    expect(result?.overBy).toBe(100);
  });

  it('counts a negative balance (advance / store credit) as headroom', async () => {
    const result = await checkCreditLimit(stubClient({ balance: -2000, creditLimit: 10000 }), 'c1', 'biz1', 11000);
    expect(result?.allowed).toBe(true);
    expect(result?.projectedBalance).toBe(9000);
  });

  it('rounds money to 2 decimals', async () => {
    const result = await checkCreditLimit(stubClient({ balance: 0.1, creditLimit: 100 }), 'c1', 'biz1', 0.2);
    expect(result?.projectedBalance).toBe(0.3);
  });

  it('reads the khata balance as the SUM of ledger rows', async () => {
    const balance = await getCustomerKhataBalance(stubClient({ balance: 1234.56 }), 'c1', 'biz1');
    expect(balance).toBe(1234.56);
  });

  it('returns null limit for a missing customer (caller proceeds as before)', async () => {
    const client = {
      customerLedgerEntry: { aggregate: async () => ({ _sum: { amount: 0 } }) },
      customer: { findFirst: async () => null }
    };
    expect(await getCustomerCreditLimit(client, 'nope', 'biz1')).toBeNull();
    expect(await checkCreditLimit(client, 'nope', 'biz1', 100)).toBeNull();
  });

  it('exposes the 402 domain code and the override role vocabulary', () => {
    expect(CREDIT_LIMIT_EXCEEDED).toBe('CREDIT_LIMIT_EXCEEDED');
    expect([...CREDIT_LIMIT_OVERRIDE_ROLES].sort()).toEqual(['ADMIN', 'MANAGER', 'OWNER']);
  });
});

describe('salesman attribution rule (gap item 7)', () => {
  const range = { startDate: new Date('2026-10-01'), endDate: new Date('2026-10-31T23:59:59.999Z') };

  it('attributes a sale to its salesperson when set, never to the cashier', () => {
    const where = attributedSalesWhere('seller-1', 'biz1', range);
    // The OR matches (salespersonId = seller) OR (no salesperson AND cashier = seller).
    expect(where.OR).toEqual([
      { salespersonId: 'seller-1' },
      { salespersonId: null, userId: 'seller-1' }
    ]);
    // A sale attributed to ANOTHER salesman is excluded from this seller.
    const matchesForSeller = (sale: any) =>
      sale.salespersonId === 'seller-1' || (sale.salespersonId == null && sale.userId === 'seller-1');
    expect(matchesForSeller({ salespersonId: 'seller-2', userId: 'seller-1' })).toBe(false);
    expect(matchesForSeller({ salespersonId: 'seller-1', userId: 'cashier-9' })).toBe(true);
    expect(matchesForSeller({ salespersonId: null, userId: 'seller-1' })).toBe(true);
    expect(matchesForSeller({ salespersonId: null, userId: 'cashier-9' })).toBe(false);
  });

  it('scopes the attribution to the business, COMPLETED sales and the range', () => {
    const where = attributedSalesWhere('seller-1', 'biz1', range, 'branch-1');
    expect(where.companyId).toBe('biz1');
    expect(where.status).toBe('COMPLETED');
    expect(where.branchId).toBe('branch-1');
    expect(where.createdAt).toEqual({ gte: range.startDate, lte: range.endDate });
  });
});

describe('item-7 schema fields', () => {
  const schemas = ['schema.sqlite.prisma', 'schema.postgresql.prisma'].map((f) =>
    fs.readFileSync(path.join(__dirname, '..', 'prisma', f), 'utf8')
  );

  it('declares Customer.creditLimit (nullable) in both schemas', () => {
    for (const text of schemas) {
      expect(text).toContain('creditLimit    Float?');
    }
  });

  it('declares StaffProfile.isSalesman in both schemas', () => {
    for (const text of schemas) {
      expect(text).toContain('isSalesman');
    }
  });
});
