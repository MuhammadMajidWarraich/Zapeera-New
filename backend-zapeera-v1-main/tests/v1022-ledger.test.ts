// v1.0.22 ledger tests — pure posting math + report equations, no
// database, plus registration-completeness checks against the sync
// registry sources (read as text, never executed).
//
// The builders in src/utils/ledger.util.ts must satisfy, for EVERY
// source type: debits == credits on the correct accounts, with gaps
// reported as exceptions instead of invented numbers.

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  ACCOUNT_CODES,
  SYSTEM_CHART,
  LedgerUnbalancedError,
  balanceDraft,
  buildBalanceSheet,
  buildExpensePosting,
  buildGiftCardSalePosting,
  buildKhataPaymentPosting,
  buildOpeningPosting,
  buildPurchasePosting,
  buildRefundPosting,
  buildReversalLines,
  buildSalePosting,
  buildTrialBalance,
  buildWalletTopUpPosting,
  buildWastagePosting,
  tenderAccountCode,
  type DraftLine,
} from '../src/utils/ledger.util';

const sumSide = (lines: DraftLine[], side: 'debit' | 'credit'): number =>
  Math.round(lines.reduce((s, l) => s + (l[side] || 0), 0) * 100) / 100;

const expectBalanced = (lines: DraftLine[]) => {
  expect(sumSide(lines, 'debit')).toBe(sumSide(lines, 'credit'));
};

const lineFor = (lines: DraftLine[], code: string): DraftLine | undefined =>
  lines.find((l) => l.code === code);

// ─── Balance validation ─────────────────────────────────────────────

describe('balanceDraft', () => {
  it('rejects entries whose sides differ by more than a cent', () => {
    expect(() =>
      balanceDraft(
        [
          { code: '1000', debit: 100, credit: 0 },
          { code: '4000', debit: 0, credit: 90 },
        ],
        'test',
      ),
    ).toThrow(LedgerUnbalancedError);
  });

  it('assigns a cent residue to the largest line of the short side', () => {
    const out = balanceDraft(
      [
        { code: '1000', debit: 100, credit: 0 },
        { code: '4000', debit: 0, credit: 33.33 },
        { code: '2100', debit: 0, credit: 66.66 },
      ],
      'test',
    );
    expect(lineFor(out, '2100')?.credit).toBe(66.67);
    expectBalanced(out);
  });

  it('throws when the short side has no line to absorb the residue', () => {
    expect(() =>
      balanceDraft([{ code: '1000', debit: 100, credit: 0 }], 'test'),
    ).toThrow(LedgerUnbalancedError);
  });

  it('drops zero lines and rejects two-sided or negative legs', () => {
    expect(
      balanceDraft(
        [
          { code: '1000', debit: 50, credit: 0 },
          { code: '4000', debit: 0, credit: 50 },
          { code: '2100', debit: 0, credit: 0 },
        ],
        'test',
      ),
    ).toHaveLength(2);
    expect(() =>
      balanceDraft([{ code: '1000', debit: 10, credit: 10 }], 'test'),
    ).toThrow(LedgerUnbalancedError);
    expect(() =>
      balanceDraft([{ code: '1000', debit: -5, credit: 0 }], 'test'),
    ).toThrow(LedgerUnbalancedError);
  });
});

// ─── Chart ───────────────────────────────────────────────────────────

describe('system chart', () => {
  it('has 15 accounts with unique codes and valid types', () => {
    expect(SYSTEM_CHART).toHaveLength(15);
    const codes = SYSTEM_CHART.map((a) => a.code);
    expect(new Set(codes).size).toBe(15);
    for (const a of SYSTEM_CHART) {
      expect(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']).toContain(a.type);
    }
    expect(ACCOUNT_CODES.CASH).toBe('1000');
    expect(ACCOUNT_CODES.OWNERS_EQUITY).toBe('3000');
    expect(ACCOUNT_CODES.SALES_RETURNS).toBe('4010');
  });

  it('maps tender methods to the right balance-sheet accounts', () => {
    expect(tenderAccountCode('CASH')).toBe('1000');
    expect(tenderAccountCode('CARD')).toBe('1010');
    expect(tenderAccountCode('JAZZCASH')).toBe('1010');
    expect(tenderAccountCode('GIFT_CARD')).toBe('2200');
    expect(tenderAccountCode('EWALLET')).toBe('2210');
    expect(tenderAccountCode(null)).toBe('1010');
  });
});

// ─── Sale ────────────────────────────────────────────────────────────

const baseSale = {
  subtotal: 1000,
  discountAmount: 100,
  promotionDiscount: 0,
  loyaltyDiscount: 50,
  taxAmount: 136,
  provincialTaxAmount: 0,
  serviceChargeAmount: 42.5,
  totalAmount: 1028.5,
  paidAmount: 1028.5,
  returnedAmount: 0,
  paymentMethod: 'CASH',
  giftCardAmount: 0,
  walletAmount: 0,
  allocations: [{ method: 'CASH', amount: 1028.5 }],
  cogs: { knownCost: 400, unknownLines: 0 },
  invoiceNumber: 'INV-00001',
};

describe('buildSalePosting', () => {
  it('posts a cash sale to Cash / Sales / Tax / Service Charge + COGS', () => {
    const { lines, exceptions } = buildSalePosting(baseSale);
    expect(exceptions).toEqual([]);
    expectBalanced(lines);
    expect(lineFor(lines, '1000')?.debit).toBe(1028.5);
    expect(lineFor(lines, '4000')?.credit).toBe(850);
    expect(lineFor(lines, '2100')?.credit).toBe(136);
    expect(lineFor(lines, '4100')?.credit).toBe(42.5);
    expect(lineFor(lines, '5000')?.debit).toBe(400);
    expect(lineFor(lines, '1200')?.credit).toBe(400);
    expect(lineFor(lines, '1100')).toBeUndefined();
  });

  it('posts the unpaid remainder to Receivables (credit / FOLIO sale)', () => {
    const { lines } = buildSalePosting({
      ...baseSale,
      totalAmount: 500,
      subtotal: 500,
      discountAmount: 0,
      loyaltyDiscount: 0,
      taxAmount: 0,
      serviceChargeAmount: 0,
      paidAmount: 0,
      paymentMethod: 'FOLIO',
      allocations: [],
      cogs: { knownCost: 200, unknownLines: 0 },
    });
    expectBalanced(lines);
    expect(lineFor(lines, '1100')?.debit).toBe(500);
    expect(lineFor(lines, '4000')?.credit).toBe(500);
    expect(lineFor(lines, '1000')).toBeUndefined();
  });

  it('splits mixed tender by allocation rows and takes change from cash', () => {
    const { lines } = buildSalePosting({
      ...baseSale,
      totalAmount: 950,
      subtotal: 950,
      discountAmount: 0,
      loyaltyDiscount: 0,
      taxAmount: 0,
      serviceChargeAmount: 0,
      paidAmount: 1000,
      returnedAmount: 50,
      paymentMethod: 'MIXED',
      allocations: [
        { method: 'CASH', amount: 600 },
        { method: 'CARD', amount: 400 },
      ],
      cogs: { knownCost: 0, unknownLines: 0 },
    });
    expectBalanced(lines);
    expect(lineFor(lines, '1000')?.debit).toBe(550);
    expect(lineFor(lines, '1010')?.debit).toBe(400);
    expect(lineFor(lines, '4000')?.credit).toBe(950);
  });

  it('falls back to headline fields when allocations do not sum to paidAmount', () => {
    const { lines, exceptions } = buildSalePosting({
      ...baseSale,
      allocations: [{ method: 'CASH', amount: 500 }],
      giftCardAmount: 200,
      walletAmount: 100,
      paymentMethod: 'CASH',
    });
    expect(exceptions.length).toBe(1);
    expectBalanced(lines);
    expect(lineFor(lines, '2200')?.debit).toBe(200);
    expect(lineFor(lines, '2210')?.debit).toBe(100);
    expect(lineFor(lines, '1000')?.debit).toBe(728.5);
  });

  it('records unknown-cost lines as exceptions and still posts revenue', () => {
    const { lines, exceptions } = buildSalePosting({
      ...baseSale,
      cogs: { knownCost: 100, unknownLines: 2 },
    });
    expect(exceptions.length).toBe(1);
    expect(exceptions[0]).toMatch(/2 sale line/);
    expectBalanced(lines);
    expect(lineFor(lines, '5000')?.debit).toBe(100);
  });

  it('posts overpayment to Customer Advances, never negative receivables', () => {
    const { lines } = buildSalePosting({
      ...baseSale,
      totalAmount: 900,
      subtotal: 900,
      discountAmount: 0,
      loyaltyDiscount: 0,
      taxAmount: 0,
      serviceChargeAmount: 0,
      paidAmount: 1000,
      allocations: [{ method: 'CASH', amount: 1000 }],
      cogs: { knownCost: 0, unknownLines: 0 },
    });
    expectBalanced(lines);
    expect(lineFor(lines, '2210')?.credit).toBe(100);
    expect(lineFor(lines, '1100')).toBeUndefined();
  });

  it('rejects discounts that exceed the subtotal', () => {
    expect(() => buildSalePosting({ ...baseSale, discountAmount: 1500 })).toThrow(
      LedgerUnbalancedError,
    );
  });

  it('rejects change that exceeds the amount paid', () => {
    expect(() =>
      buildSalePosting({ ...baseSale, returnedAmount: 2000 }),
    ).toThrow(LedgerUnbalancedError);
  });
});

// ─── Refund / purchase / expense / khata / gift / wallet / wastage ──

describe('buildRefundPosting', () => {
  it('reduces khata due first, then pays money out, with pro-rata tax', () => {
    const { lines, exceptions } = buildRefundPosting({
      refundAmount: 200,
      refundMethod: 'CASH',
      saleTotalAmount: 1028.5,
      saleTaxAmount: 136,
      saleProvincialTaxAmount: 0,
      salePaidAmount: 1028.5,
      priorRefundTotal: 0,
      cogsReversal: { knownCost: 80, unknownLines: 0 },
    });
    expect(exceptions).toEqual([]);
    expectBalanced(lines);
    expect(lineFor(lines, '4010')?.debit).toBe(173.55);
    expect(lineFor(lines, '2100')?.debit).toBe(26.45);
    expect(lineFor(lines, '1000')?.credit).toBe(200);
    expect(lineFor(lines, '1100')).toBeUndefined();
    expect(lineFor(lines, '1200')?.debit).toBe(80);
    expect(lineFor(lines, '5000')?.credit).toBe(80);
  });

  it('credits Receivables when the original sale was on credit', () => {
    const { lines } = buildRefundPosting({
      refundAmount: 200,
      refundMethod: 'CASH',
      saleTotalAmount: 1000,
      saleTaxAmount: 0,
      saleProvincialTaxAmount: 0,
      salePaidAmount: 600,
      priorRefundTotal: 100,
      cogsReversal: { knownCost: 0, unknownLines: 0 },
    });
    // Outstanding due = 1000 − 600 − 100 = 300; refund 200 < 300.
    expectBalanced(lines);
    expect(lineFor(lines, '1100')?.credit).toBe(200);
    expect(lineFor(lines, '1000')).toBeUndefined();
  });
});

describe('buildPurchasePosting', () => {
  it('debits Inventory, credits Cash and Payables', () => {
    const { lines } = buildPurchasePosting({ totalAmount: 10000, paidAmount: 4000 });
    expectBalanced(lines);
    expect(lineFor(lines, '1200')?.debit).toBe(10000);
    expect(lineFor(lines, '1000')?.credit).toBe(4000);
    expect(lineFor(lines, '2000')?.credit).toBe(6000);
  });

  it('rejects paid amounts above the total', () => {
    expect(() => buildPurchasePosting({ totalAmount: 100, paidAmount: 150 })).toThrow(
      LedgerUnbalancedError,
    );
  });
});

describe('buildExpensePosting', () => {
  it('debits Operating Expenses, credits Cash or Bank by method', () => {
    const cash = buildExpensePosting({ amount: 1500, paymentMethod: 'CASH' });
    expectBalanced(cash.lines);
    expect(lineFor(cash.lines, '6000')?.debit).toBe(1500);
    expect(lineFor(cash.lines, '1000')?.credit).toBe(1500);
    const card = buildExpensePosting({ amount: 1500, paymentMethod: 'CARD' });
    expect(lineFor(card.lines, '1010')?.credit).toBe(1500);
  });

  it('skips zero expenses', () => {
    expect(buildExpensePosting({ amount: 0, paymentMethod: 'CASH' }).lines).toEqual([]);
  });
});

describe('buildKhataPaymentPosting', () => {
  it('settles Receivables, overpayment to Customer Advances', () => {
    const { lines } = buildKhataPaymentPosting({ amount: 500, method: 'CASH', advancePortion: 120 });
    expectBalanced(lines);
    expect(lineFor(lines, '1000')?.debit).toBe(500);
    expect(lineFor(lines, '1100')?.credit).toBe(380);
    expect(lineFor(lines, '2210')?.credit).toBe(120);
  });
});

describe('buildGiftCardSalePosting / buildWalletTopUpPosting', () => {
  it('credits liabilities, never revenue', () => {
    const gift = buildGiftCardSalePosting({ value: 2000, paymentMethod: 'CASH' });
    expectBalanced(gift.lines);
    expect(lineFor(gift.lines, '2200')?.credit).toBe(2000);
    expect(lineFor(gift.lines, '4000')).toBeUndefined();
    const wallet = buildWalletTopUpPosting({ amount: 1000, method: 'CARD' });
    expectBalanced(wallet.lines);
    expect(lineFor(wallet.lines, '1010')?.debit).toBe(1000);
    expect(lineFor(wallet.lines, '2210')?.credit).toBe(1000);
  });
});

describe('buildWastagePosting', () => {
  it('debits Wastage Loss and credits Inventory', () => {
    const { lines } = buildWastagePosting({ value: 250 });
    expectBalanced(lines);
    expect(lineFor(lines, '5100')?.debit).toBe(250);
    expect(lineFor(lines, '1200')?.credit).toBe(250);
  });
});

// ─── Opening balances + reversal ─────────────────────────────────────

describe('buildOpeningPosting', () => {
  it('plugs the balancing figure to Owner’s Equity, explicitly', () => {
    const { lines } = buildOpeningPosting({
      inventoryValue: 50000,
      receivables: 12000,
      bankValue: 80000,
      payables: 20000,
      advances: 5000,
      giftCardLiability: 3000,
    });
    expectBalanced(lines);
    expect(lineFor(lines, '3000')?.credit).toBe(114000);
    expect(lineFor(lines, '3000')?.memo).toMatch(/derived from live operational data/);
  });

  it('debits Owner’s Equity when liabilities exceed assets', () => {
    const { lines } = buildOpeningPosting({
      inventoryValue: 1000,
      receivables: 0,
      bankValue: 0,
      payables: 5000,
      advances: 0,
      giftCardLiability: 0,
    });
    expectBalanced(lines);
    expect(lineFor(lines, '3000')?.debit).toBe(4000);
  });

  it('produces no lines for a zero opening position', () => {
    const { lines } = buildOpeningPosting({
      inventoryValue: 0,
      receivables: 0,
      bankValue: 0,
      payables: 0,
      advances: 0,
      giftCardLiability: 0,
    });
    expect(lines).toEqual([]);
  });
});

describe('buildReversalLines', () => {
  it('mirrors debits and credits', () => {
    const out = buildReversalLines([
      { code: '1000', debit: 100, credit: 0, memo: 'Sale' },
      { code: '4000', debit: 0, credit: 100 },
    ]);
    expect(out[0]).toEqual({ code: '1000', debit: 0, credit: 100, memo: 'Reversal — Sale' });
    expect(out[1].debit).toBe(100);
    expectBalanced(out);
  });
});

// ─── Reports ─────────────────────────────────────────────────────────

const fakeAccounts = SYSTEM_CHART.map((a) => ({
  id: a.code,
  code: a.code,
  name: a.name,
  type: a.type,
  subtype: a.subtype || null,
}));

const toLineRows = (postings: DraftLine[][]) =>
  postings.flat().map((l) => ({ accountId: l.code, debit: l.debit, credit: l.credit }));

describe('trial balance + balance sheet', () => {
  it('balances a full simulated business day, jointly', () => {
    const postings = [
      buildOpeningPosting({
        inventoryValue: 50000, receivables: 12000, bankValue: 80000,
        payables: 20000, advances: 5000, giftCardLiability: 3000,
      }).lines,
      buildSalePosting(baseSale).lines,
      buildSalePosting({
        ...baseSale, totalAmount: 500, subtotal: 500, discountAmount: 0,
        loyaltyDiscount: 0, taxAmount: 0, serviceChargeAmount: 0, paidAmount: 0,
        paymentMethod: 'FOLIO', allocations: [], cogs: { knownCost: 200, unknownLines: 0 },
      }).lines,
      buildRefundPosting({
        refundAmount: 200, refundMethod: 'CASH', saleTotalAmount: 1028.5,
        saleTaxAmount: 136, saleProvincialTaxAmount: 0, salePaidAmount: 1028.5,
        priorRefundTotal: 0, cogsReversal: { knownCost: 80, unknownLines: 0 },
      }).lines,
      buildPurchasePosting({ totalAmount: 10000, paidAmount: 4000 }).lines,
      buildExpensePosting({ amount: 1500, paymentMethod: 'CARD' }).lines,
      buildKhataPaymentPosting({ amount: 500, method: 'CASH', advancePortion: 0 }).lines,
      buildGiftCardSalePosting({ value: 2000, paymentMethod: 'CASH' }).lines,
      buildWalletTopUpPosting({ amount: 1000, method: 'CARD' }).lines,
      buildWastagePosting({ value: 250 }).lines,
    ];
    const rows = toLineRows(postings);
    const tb = buildTrialBalance(fakeAccounts, rows);
    expect(tb.difference).toBe(0);
    expect(tb.totalDebits).toBe(tb.totalCredits);
    expect(tb.totalDebits).toBeGreaterThan(0);
    const bs = buildBalanceSheet(fakeAccounts, rows);
    expect(bs.difference).toBe(0);
    expect(bs.totalAssets).toBe(bs.totalLiabilities + bs.totalEquity);
    // Net income = revenue (850 + 500 − 173.55 returns + 42.50 service
    // = 1218.95) − COGS net (400 + 200 − 80 = 520) − expenses (1500)
    // − wastage (250) = −1051.05.
    expect(bs.netIncome).toBe(-1051.05);
  });

  it('omits accounts without activity from the trial balance', () => {
    const tb = buildTrialBalance(fakeAccounts, [
      { accountId: '1000', debit: 100, credit: 0 },
      { accountId: '4000', debit: 0, credit: 100 },
    ]);
    expect(tb.rows.map((r) => r.code)).toEqual(['1000', '4000']);
    expect(tb.difference).toBe(0);
  });

  it('reports a nonzero trial-balance difference explicitly, never plugged', () => {
    const tb = buildTrialBalance(fakeAccounts, [
      { accountId: '1000', debit: 100, credit: 0 },
    ]);
    expect(tb.difference).toBe(100);
  });

  it('computes retained profit from the journals, not a stored account', () => {
    const bs = buildBalanceSheet(fakeAccounts, [
      { accountId: '4000', debit: 0, credit: 1000 },
      { accountId: '5000', debit: 400, credit: 0 },
      { accountId: '6000', debit: 100, credit: 0 },
    ]);
    expect(bs.netIncome).toBe(500);
  });
});

// ─── Schema + sync registration completeness ─────────────────────────

const readText = (...parts: string[]): string =>
  fs.readFileSync(path.join(__dirname, ...parts), 'utf8');

describe('ledger schema', () => {
  it('declares all four models in BOTH schemas with the idempotency key', () => {
    for (const file of ['schema.postgresql.prisma', 'schema.sqlite.prisma']) {
      const text = readText('..', 'prisma', file);
      for (const model of ['model ChartOfAccount', 'model JournalEntry', 'model JournalLine', 'model LedgerException']) {
        expect(text).toContain(model);
      }
      expect(text).toContain('uq_journalEntry_source_reversal');
      expect(text).toContain('@@unique([sourceType, sourceId, reversalOfId]');
    }
  });
});

describe('v1.0.22 sync registration', () => {
  it('lists all six tables in the desktop push order, parents before children', () => {
    const text = readText('..', '..', 'frontend-zapeera-V1', 'electron', 'services', 'sync.service.js');
    for (const table of ['quotations', 'quotation_lines', 'receipt_templates', 'service_charge_configs', 'wastage_records', 'audit_logs']) {
      expect(text).toContain(`name: '${table}'`);
    }
    expect(text.indexOf(`name: 'quotations'`)).toBeLessThan(text.indexOf(`name: 'quotation_lines'`));
  });

  it('maps all six models in TABLE_MAPPINGS', () => {
    const text = readText('..', 'src', 'utils', 'sync-helper.ts');
    expect(text).toContain(`'quotation': 'quotations'`);
    expect(text).toContain(`'quotationLine': 'quotation_lines'`);
    expect(text).toContain(`'receiptTemplate': 'receipt_templates'`);
    expect(text).toContain(`'serviceChargeConfig': 'service_charge_configs'`);
    expect(text).toContain(`'wastageRecord': 'wastage_records'`);
    expect(text).toContain(`'auditLog': 'audit_logs'`);
  });

  it('pulls five tables and never pulls the audit trail down', () => {
    const text = readText('..', 'src', 'services', 'sync.service.ts');
    for (const [pg, model] of [
      ['quotations', 'quotation'],
      ['quotation_lines', 'quotationLine'],
      ['receipt_templates', 'receiptTemplate'],
      ['service_charge_configs', 'serviceChargeConfig'],
      ['wastage_records', 'wastageRecord'],
    ]) {
      expect(text).toContain(`{ pg: '${pg}', sqlite: '${model}' }`);
    }
    expect(text).not.toContain(`{ pg: 'audit_logs', sqlite:`);
  });

  it('pushes four models and blocks the two pull-only configs', () => {
    const text = readText('..', 'src', 'services', 'sync.service.ts');
    for (const model of ['quotation', 'quotationLine', 'wastageRecord', 'auditLog']) {
      expect(text).toContain(`'${model}',`);
      expect(text).toContain(`{ prisma: '${model}', pg:`);
    }
    expect(text).not.toContain(`'receiptTemplate',`);
    expect(text).not.toContain(`'serviceChargeConfig',`);
    expect(text).not.toContain(`{ prisma: 'receiptTemplate'`);
    expect(text).not.toContain(`{ prisma: 'serviceChargeConfig'`);
  });

  it('ranks, blocks, allowlists and cursor-pulls per the intended directions', () => {
    const text = readText('..', 'src', 'controllers', 'sync-cloud-api.controller.ts');
    // Ranks (quotation before quotationLine).
    expect(text).toContain('quotation: 530, quotationLine: 540');
    expect(text).toContain('receiptTemplate: 550, serviceChargeConfig: 560');
    expect(text).toContain('wastageRecord: 570, auditLog: 580');
    // Push-blocked configs.
    expect(text).toContain(`'receiptTemplate', 'serviceChargeConfig',`);
    // Exact-field allowlists for the four pushables.
    expect(text).toContain('quotation: new Set(');
    expect(text).toContain('quotationLine: new Set(');
    expect(text).toContain('wastageRecord: new Set(');
    expect(text).toContain('auditLog: new Set(');
    expect(text).toContain(`'quotationNumber'`);
    expect(text).toContain(`'stockMovementId'`);
    // Cursor-pull parents (child + audit deliberately absent).
    expect(text).toContain(`'quotation', 'receiptTemplate', 'serviceChargeConfig', 'wastageRecord'`);
    // Sale allowlist carries the service-charge fields.
    expect(text).toContain(`'serviceChargeAmount', 'serviceChargeType', 'serviceChargePercentage'`);
  });
});
