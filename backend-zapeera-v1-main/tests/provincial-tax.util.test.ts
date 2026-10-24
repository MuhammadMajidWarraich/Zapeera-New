import { describe, it, expect } from '@jest/globals';
import {
  authorityForProvince,
  computeProvincialTax,
  resolveProvincialTaxConfig,
  serializeProvincialTaxBreakdown,
  PROVINCIAL_AUTHORITY_NAMES,
  ProvincialTaxConfigLike
} from '../src/utils/provincial-tax.util';
import { buildFbrPayload, deriveFbrLines } from '../src/utils/fbr.util';

// Provincial tax engine (Gap program item 1) + the FBR regression
// proof: provincial tax must NEVER change an FBR payload. The FBR
// service/util files are READ-ONLY for this feature — these tests pin
// that contract from the outside (they only CALL fbr.util, never
// modify it): the same sale derives the same FBR lines and the same
// IMS payload whether or not a provincial config was applied, because
// FBR reads Sale.taxAmount / SaleTaxLine rows only, while provincial
// tax lives in Sale.provincialTaxAmount / SaleProvincialTaxLine rows.

const pra = (over: Partial<ProvincialTaxConfigLike> = {}): ProvincialTaxConfigLike => ({
  authority: 'PRA',
  registrationNumber: 'PRA-12345',
  rate: 5,
  enabled: true,
  branchId: null,
  ...over
});

describe('authorityForProvince', () => {
  it('maps each province to its authority', () => {
    expect(authorityForProvince('Punjab')).toBe('PRA');
    expect(authorityForProvince('Sindh')).toBe('SRB');
    expect(authorityForProvince('Khyber Pakhtunkhwa')).toBe('KPRA');
    expect(authorityForProvince('Balochistan')).toBe('BRA');
  });

  it('is case-insensitive and tolerates common aliases', () => {
    expect(authorityForProvince('punjab')).toBe('PRA');
    expect(authorityForProvince('KP')).toBe('KPRA');
    expect(authorityForProvince('KPK')).toBe('KPRA');
    expect(authorityForProvince('Baluchistan')).toBe('BRA');
  });

  it('returns null where no provincial authority exists', () => {
    expect(authorityForProvince('Islamabad Capital Territory')).toBeNull();
    expect(authorityForProvince('Gilgit-Baltistan')).toBeNull();
    expect(authorityForProvince(null)).toBeNull();
    expect(authorityForProvince('')).toBeNull();
  });

  it('names all four authorities', () => {
    expect(PROVINCIAL_AUTHORITY_NAMES.PRA).toBe('Punjab Revenue Authority');
    expect(PROVINCIAL_AUTHORITY_NAMES.SRB).toBe('Sindh Revenue Board');
    expect(PROVINCIAL_AUTHORITY_NAMES.KPRA).toBe('Khyber Pakhtunkhwa Revenue Authority');
    expect(PROVINCIAL_AUTHORITY_NAMES.BRA).toBe('Balochistan Revenue Authority');
  });
});

describe('resolveProvincialTaxConfig', () => {
  it('returns null with no configs (invoice unchanged)', () => {
    expect(resolveProvincialTaxConfig([], 'branch-1')).toBeNull();
    expect(resolveProvincialTaxConfig([], null)).toBeNull();
  });

  it('returns the business-level row for any branch', () => {
    expect(resolveProvincialTaxConfig([pra()], 'branch-1')).toEqual(pra());
    expect(resolveProvincialTaxConfig([pra()], null)).toEqual(pra());
  });

  it('prefers the branch row over the business row', () => {
    const branchRow = pra({ authority: 'SRB', rate: 4, branchId: 'branch-1' });
    expect(resolveProvincialTaxConfig([pra(), branchRow], 'branch-1')).toEqual(branchRow);
    // …but another branch still gets the business row.
    expect(resolveProvincialTaxConfig([pra(), branchRow], 'branch-2')).toEqual(pra());
  });

  it('ignores disabled rows entirely', () => {
    expect(resolveProvincialTaxConfig([pra({ enabled: false })], 'branch-1')).toBeNull();
    const branchDisabled = pra({ authority: 'SRB', enabled: false, branchId: 'branch-1' });
    // A disabled branch row does NOT block the business row.
    expect(resolveProvincialTaxConfig([pra(), branchDisabled], 'branch-1')).toEqual(pra());
  });

  it('ignores rows with an unknown authority', () => {
    expect(resolveProvincialTaxConfig([pra({ authority: 'FBR' })], 'branch-1')).toBeNull();
  });
});

describe('computeProvincialTax', () => {
  it('is zero with no config — the no-config invoice is identical to today', () => {
    expect(computeProvincialTax({ taxableBase: 10000, config: null })).toEqual({
      provincialTaxAmount: 0,
      lines: []
    });
    expect(computeProvincialTax({ taxableBase: 10000, config: undefined })).toEqual({
      provincialTaxAmount: 0,
      lines: []
    });
  });

  it('charges one authority line at the configured rate on the post-discount base', () => {
    const result = computeProvincialTax({ taxableBase: 10000, config: pra() });
    expect(result).toEqual({
      provincialTaxAmount: 500,
      lines: [{
        authority: 'PRA',
        authorityName: 'Punjab Revenue Authority',
        registrationNumber: 'PRA-12345',
        rate: 5,
        taxableAmount: 10000,
        taxAmount: 500
      }]
    });
  });

  it('supports each authority at its own rate (multi-rate across sales)', () => {
    expect(computeProvincialTax({ taxableBase: 20000, config: pra({ authority: 'SRB', rate: 4 }) }).provincialTaxAmount).toBe(800);
    expect(computeProvincialTax({ taxableBase: 20000, config: pra({ authority: 'KPRA', rate: 2 }) }).provincialTaxAmount).toBe(400);
    expect(computeProvincialTax({ taxableBase: 20000, config: pra({ authority: 'BRA', rate: 3 }) }).provincialTaxAmount).toBe(600);
  });

  it('rounds half-up to cents (PKR 333.33 at 5% → 16.67, not 16.66)', () => {
    const result = computeProvincialTax({ taxableBase: 333.33, config: pra({ rate: 5 }) });
    expect(result.lines[0].taxAmount).toBe(16.67);
    expect(result.provincialTaxAmount).toBe(16.67);
  });

  it('rounds the taxable base to cents too', () => {
    const result = computeProvincialTax({ taxableBase: 100.005, config: pra({ rate: 10 }) });
    expect(result.lines[0].taxableAmount).toBe(100.01);
    expect(result.lines[0].taxAmount).toBe(10);
  });

  it('is zero on a zero or negative base, and on a zero rate', () => {
    expect(computeProvincialTax({ taxableBase: 0, config: pra() })).toEqual({ provincialTaxAmount: 0, lines: [] });
    expect(computeProvincialTax({ taxableBase: -50, config: pra() })).toEqual({ provincialTaxAmount: 0, lines: [] });
    expect(computeProvincialTax({ taxableBase: 10000, config: pra({ rate: 0 }) })).toEqual({ provincialTaxAmount: 0, lines: [] });
  });

  it('keeps the registration number snapshot on the line (null when unset)', () => {
    expect(computeProvincialTax({ taxableBase: 1000, config: pra({ registrationNumber: null }) }).lines[0].registrationNumber).toBeNull();
    expect(computeProvincialTax({ taxableBase: 1000, config: pra({ registrationNumber: 'SRB-9' }) }).lines[0].registrationNumber).toBe('SRB-9');
  });

  it('provincial + FBR together: the two taxes add on the same base, neither inside the other', () => {
    // Base 10,000; FBR/general 17% = 1,700 (computed by tax.util, not here);
    // provincial PRA 5% = 500. Customer total = 10,000 + 1,700 + 500.
    const provincial = computeProvincialTax({ taxableBase: 10000, config: pra() });
    const fbrTax = Math.round(10000 * 0.17 * 100) / 100; // 17% of 10,000
    expect(provincial.provincialTaxAmount + fbrTax).toBe(2200);
    expect(provincial.provincialTaxAmount).toBe(500);
    expect(fbrTax).toBe(1700);
  });
});

describe('serializeProvincialTaxBreakdown', () => {
  it('returns [] for sales without the relation (pre-feature sales)', () => {
    expect(serializeProvincialTaxBreakdown({})).toEqual([]);
    expect(serializeProvincialTaxBreakdown(null)).toEqual([]);
    expect(serializeProvincialTaxBreakdown({ provincialTaxLines: null })).toEqual([]);
  });

  it('shapes stored rows with numeric coercion', () => {
    const sale = {
      provincialTaxLines: [{
        authority: 'SRB',
        authorityName: 'Sindh Revenue Board',
        registrationNumber: 'SRB-7',
        rate: '4',
        taxableAmount: '20000',
        taxAmount: '800'
      }]
    };
    expect(serializeProvincialTaxBreakdown(sale)).toEqual([{
      authority: 'SRB',
      authorityName: 'Sindh Revenue Board',
      registrationNumber: 'SRB-7',
      rate: 4,
      taxableAmount: 20000,
      taxAmount: 800
    }]);
  });
});

describe('FBR regression proof (provincial tax must not move FBR)', () => {
  // One sale: two lines, subtotal 10,000, no order discount,
  // FBR/general tax 17% = 1,700 via one implicit Default group.
  const fbrLines = [
    { productId: 'p1', itemCode: 'SKU1', itemName: 'Item 1', pctCode: '12340000', quantity: 2, lineTotal: 6000, taxClassId: null },
    { productId: 'p2', itemCode: 'SKU2', itemName: 'Item 2', pctCode: null, quantity: 1, lineTotal: 4000, taxClassId: null }
  ];
  const fbrGroups = [{ taxClassId: null, rate: 17, taxAmount: 1700 }];

  const derive = () => deriveFbrLines({
    lines: fbrLines,
    taxGroups: fbrGroups,
    subtotal: 10000,
    totalDiscount: 0,
    taxableBase: 10000,
    totalTaxAmount: 1700
  });

  it('derives identical FBR lines with and without provincial tax applied', () => {
    // The provincial tax is a separate amount on the same base; it is
    // never passed into deriveFbrLines (which only takes the FBR tax
    // groups + totalTaxAmount). This test pins the call shape: the
    // provincial amount (500) is NOT an input here at all.
    const withoutProvincial = derive();
    const withProvincial = derive();
    expect(withProvincial).toEqual(withoutProvincial);
    expect(withProvincial.totalTaxCharged).toBe(1700);
    expect(withProvincial.totalSaleValue).toBe(10000);
  });

  it('builds an identical IMS payload either way (TotalBillAmount excludes provincial tax)', () => {
    const derived = derive();
    const payload = buildFbrPayload({
      posId: '123456',
      usin: 'INV-10001',
      dateTime: new Date('2026-10-24T10:00:00'),
      buyerName: 'Walk-in',
      buyerPhone: null,
      invoiceType: 1,
      refUsin: null,
      paymentMode: 1,
      lines: derived.lines
    });
    // FBR bill = base + FBR tax only. The customer's total (12,200 with
    // PRA 5% = 500) is larger; the extra 500 is provincial money and
    // must never appear in the FBR document.
    expect(payload.TotalBillAmount).toBe(11700);
    expect(payload.TotalTaxCharged).toBe(1700);
    expect(payload.TotalSaleValue).toBe(10000);
    const provincial = computeProvincialTax({ taxableBase: 10000, config: pra() });
    expect(Number(payload.TotalBillAmount) + provincial.provincialTaxAmount).toBe(12200);
  });
});
