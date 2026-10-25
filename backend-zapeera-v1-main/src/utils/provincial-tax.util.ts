// Provincial tax engine (Gap program item 1: PRA / SRB / KPRA / BRA
// alongside FBR).
//
// Pakistan's provincial sales taxes on services are collected by a
// DIFFERENT authority than FBR, per province:
//
//   PRA  — Punjab Revenue Authority (Punjab)
//   SRB  — Sindh Revenue Board (Sindh)
//   KPRA — Khyber Pakhtunkhwa Revenue Authority (Khyber Pakhtunkhwa)
//   BRA  — Balochistan Revenue Authority (Balochistan)
//
// CloudPOS sells exactly this (provincial authority alongside FBR);
// Zapeera listed FBR only. This module is the whole engine; the sale
// controller only resolves inputs and persists outputs, mirroring the
// tax-class engine (tax.util.ts, Wave B5).
//
// SEPARATION FROM FBR (the hard rule):
//   · Provincial tax is computed on the SAME post-discount taxable
//     base as the FBR/general tax (subtotal − manual discount −
//     promotions − loyalty), but it is stored SEPARATELY:
//     Sale.provincialTaxAmount + SaleProvincialTaxLine rows. It is
//     NEVER folded into Sale.taxAmount and NEVER written to
//     SaleTaxLine rows.
//   · The FBR service derives its payload from Sale.taxAmount and the
//     SaleTaxLine rows only (utils/fbr.util.ts, services/fbr.service.ts
//     — untouched by this feature), so enabling provincial tax cannot
//     change any FBR number, invoice number or QR. The FBR payload's
//     TotalBillAmount is the FBR bill (base + FBR tax); the customer's
//     total is that PLUS the provincial tax, carried on the receipt as
//     its own line(s).
//   · With no provincial config set, the engine returns zero lines
//     and provincialTaxAmount 0, so invoice output is identical to
//     today (proved by tests/provincial-tax.util.test.ts).
//
// RESOLUTION (per sale, by branch):
//   1. An ENABLED config row for the sale's branch (branchId set)
//      wins — a multi-province chain taxes each branch under its own
//      province's authority.
//   2. Otherwise the ENABLED business-level row (branchId null).
//   3. Otherwise — no config, or every config disabled — no
//      provincial tax. Disabled rows never apply.
//   The API enforces at most one ENABLED config per (company,
//   branchId) scope, so resolution is unambiguous; this module still
//   picks deterministically (first enabled row in authority order)
//   if the data ever violates that.
//
// MATH:
//   · One authority per sale, so one line: tax = round2(base × rate
//     / 100), taxableAmount = round2(base). Rounding is half-up to
//     cents (Math.round), the same convention as tax.util.
//   · Rates are per-authority snapshots: a config edit applies to
//     FUTURE sales only; past sales keep their stored lines.

export type ProvincialAuthority = 'PRA' | 'SRB' | 'KPRA' | 'BRA';

export const PROVINCIAL_AUTHORITIES: ProvincialAuthority[] = ['PRA', 'SRB', 'KPRA', 'BRA'];

export const PROVINCIAL_AUTHORITY_NAMES: Record<ProvincialAuthority, string> = {
  PRA: 'Punjab Revenue Authority',
  SRB: 'Sindh Revenue Board',
  KPRA: 'Khyber Pakhtunkhwa Revenue Authority',
  BRA: 'Balochistan Revenue Authority'
};

export const PROVINCIAL_AUTHORITY_PROVINCES: Record<ProvincialAuthority, string> = {
  PRA: 'Punjab',
  SRB: 'Sindh',
  KPRA: 'Khyber Pakhtunkhwa',
  BRA: 'Balochistan'
};

/** Province name (as a business/branch would write it) → authority. */
const PROVINCE_TO_AUTHORITY: Record<string, ProvincialAuthority> = {
  punjab: 'PRA',
  sindh: 'SRB',
  'khyber pakhtunkhwa': 'KPRA',
  'khyber-pakhtunkhwa': 'KPRA',
  kp: 'KPRA',
  kpk: 'KPRA',
  balochistan: 'BRA',
  baluchistan: 'BRA'
};

/**
 * The authority for a province name, or null when the province is not
 * one of the four (e.g. Islamabad Capital Territory / Gilgit-Baltistan
 * have no provincial services-tax authority of this kind — FBR only).
 */
export const authorityForProvince = (province: string | null | undefined): ProvincialAuthority | null => {
  if (!province) return null;
  const key = String(province).trim().toLowerCase();
  return PROVINCE_TO_AUTHORITY[key] ?? null;
};

export const isProvincialAuthority = (value: unknown): value is ProvincialAuthority =>
  typeof value === 'string' && (PROVINCIAL_AUTHORITIES as string[]).includes(value);

export interface ProvincialTaxConfigLike {
  id?: string;
  branchId?: string | null;
  authority: string;
  registrationNumber?: string | null;
  rate: number;
  enabled?: boolean | null;
}

export interface ProvincialTaxLine {
  authority: ProvincialAuthority;
  authorityName: string;
  registrationNumber: string | null;
  rate: number;
  taxableAmount: number;
  taxAmount: number;
}

export interface ProvincialTaxResult {
  provincialTaxAmount: number;
  lines: ProvincialTaxLine[];
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Picks the config that applies to a sale at `branchId` (null = the
 * sale's branch is unknown; only the business-level row can apply).
 * Branch rows beat business rows; disabled rows never apply.
 */
export const resolveProvincialTaxConfig = (
  configs: ProvincialTaxConfigLike[],
  branchId: string | null | undefined
): ProvincialTaxConfigLike | null => {
  const enabled = configs.filter(c => c.enabled !== false && isProvincialAuthority(c.authority));
  if (enabled.length === 0) return null;
  const byAuthorityOrder = (a: ProvincialTaxConfigLike, b: ProvincialTaxConfigLike) =>
    PROVINCIAL_AUTHORITIES.indexOf(a.authority as ProvincialAuthority) -
    PROVINCIAL_AUTHORITIES.indexOf(b.authority as ProvincialAuthority);
  if (branchId) {
    const branchRow = enabled
      .filter(c => c.branchId === branchId)
      .sort(byAuthorityOrder)[0];
    if (branchRow) return branchRow;
  }
  return enabled.filter(c => !c.branchId).sort(byAuthorityOrder)[0] ?? null;
};

/**
 * Computes the provincial tax for one sale. `taxableBase` is the same
 * post-discount base the FBR/general tax uses. No config (or a zero
 * rate) → zero lines and a zero amount — the invoice is unchanged.
 */
export const computeProvincialTax = (input: {
  taxableBase: number;
  config: ProvincialTaxConfigLike | null | undefined;
}): ProvincialTaxResult => {
  const { taxableBase, config } = input;
  if (!config || !isProvincialAuthority(config.authority)) {
    return { provincialTaxAmount: 0, lines: [] };
  }
  const rate = Number(config.rate) || 0;
  if (rate <= 0 || taxableBase <= 0) {
    return { provincialTaxAmount: 0, lines: [] };
  }
  const authority = config.authority as ProvincialAuthority;
  const line: ProvincialTaxLine = {
    authority,
    authorityName: PROVINCIAL_AUTHORITY_NAMES[authority],
    registrationNumber: config.registrationNumber ? String(config.registrationNumber) : null,
    rate,
    taxableAmount: round2(taxableBase),
    taxAmount: round2(taxableBase * (rate / 100))
  };
  return { provincialTaxAmount: line.taxAmount, lines: [line] };
};

/**
 * Shapes a sale's stored SaleProvincialTaxLine rows into the
 * `provincialTaxBreakdown` array API responses carry. Accepts a sale
 * object whose `provincialTaxLines` relation was included; anything
 * else yields an empty array (pre-feature sales have no rows — their
 * receipts keep the legacy rendering, which shows no provincial line
 * at all).
 */
export const serializeProvincialTaxBreakdown = (sale: any): ProvincialTaxLine[] => {
  if (!sale || !Array.isArray(sale.provincialTaxLines)) return [];
  return sale.provincialTaxLines.map((line: any) => ({
    authority: line.authority as ProvincialAuthority,
    authorityName: line.authorityName,
    registrationNumber: line.registrationNumber ?? null,
    rate: Number(line.rate),
    taxableAmount: Number(line.taxableAmount),
    taxAmount: Number(line.taxAmount)
  }));
};
