// ─── FBR POS fiscal integration (Wave B7) ──────────────────────────────
// Pure payload construction for FBR's POS invoicing (IMS) API, per the
// PRAL "Technical Specification for Data Sharing through Software
// Fiscal Device" (the same IMS model FBR uses for Tier-1 POS
// integration; PRAL operates the IMS platform for FBR and the
// provincial authorities). No I/O lives here — the network worker is
// services/fbr.service.ts — so this file can be unit-checked
// standalone (see the payload self-check in the wave report).
//
// The IMS invoice model (spec §7 / §7.2.3 sample JSON):
//   { InvoiceNumber: "" (assigned by FBR), POSID, USIN, DateTime,
//     BuyerNTN?, BuyerCNIC?, BuyerName, BuyerPhoneNumber,
//     TotalBillAmount, TotalQuantity, TotalSaleValue, TotalTaxCharged,
//     Discount, FurtherTax, PaymentMode, RefUSIN, InvoiceType,
//     Items: [{ ItemCode, ItemName, Quantity, PCTCode, TaxRate,
//               SaleValue, TotalAmount, TaxCharged, Discount,
//               FurtherTax, InvoiceType, RefUSIN }] }
//   InvoiceType: 1 = New, 2 = Debit note, 3 = Credit note. Credit /
//   debit notes MUST carry RefUSIN = the original invoice's USIN
//   (spec FAQ 1–2). USIN is the taxpayer's own invoice number — ours
//   is the sale's invoiceNumber (INV-00001 style).
//   Success response: { InvoiceNumber: "9000052011142444901" (19
//   digits), Code: "100", Response: "…", Errors: null }.
//   PCT codes are sent WITHOUT the dot ("1601.0000" → "16010000");
//   the documented fallback when a product has no code is "00000000".
//
// Amount semantics chosen for internal consistency (the spec's own
// .NET sample does not reconcile to the cent):
//   line SaleValue  = the line's share of the sale's TAXABLE BASE
//                     (subtotal − all order-level discounts, pro-rated
//                     by stored line total) — i.e. exclusive of tax.
//   line TaxCharged = the line's share of its tax-class group's
//                     STORED SaleTaxLine.taxAmount (Wave B5), pro-rated
//                     by taxable base within the group.
//   line TotalAmount = SaleValue + TaxCharged.
//   Header TotalSaleValue = Σ SaleValue, TotalTaxCharged = Σ TaxCharged,
//   TotalBillAmount = TotalSaleValue + TotalTaxCharged = the sale's
//   stored totalAmount (both identities hold by construction in the
//   sale engine). All pro-rations round to cents with the residue on
//   the largest line — the same convention as tax.util (Wave B5).

export type FbrEnvironment = 'TEST' | 'SANDBOX' | 'PRODUCTION';

/** Cloud IMS endpoints (spec §7.2.2). TEST never touches the network. */
export const FBR_ENDPOINTS: Record<Exclude<FbrEnvironment, 'TEST'>, string> = {
  SANDBOX: 'https://ims.pral.com.pk/ims/sandbox/api/Live/PostData',
  PRODUCTION: 'https://ims.pral.com.pk/ims/production/api/Live/PostData'
};

export const FBR_DEFAULT_PCT_CODE = '00000000';

/**
 * Normalizes a user-entered PCT code to the wire format: digits only,
 * dot removed, max 8 chars. Returns null when nothing usable remains
 * (callers fall back to FBR_DEFAULT_PCT_CODE at payload time).
 */
export const normalizePctCode = (raw: unknown): string | null => {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/\D/g, '').slice(0, 8);
  return digits.length > 0 ? digits : null;
};

/** IMS PaymentMode codes (spec + integrator tables). */
export const FBR_PAYMENT_MODES = {
  CASH: 1,
  CARD: 2,
  CREDIT: 3,
  BANK_TRANSFER: 4
} as const;

/**
 * Maps a sale's tenders to one IMS PaymentMode. The spec's table has
 * no code for mobile wallets — JazzCash / Easypaisa / MOBILE are
 * electronic payments, so they ride the CARD code (2). A sale with
 * nothing paid yet is a credit sale (3). Split sales report the
 * largest allocation's mode; legacy sales use their headline
 * paymentMethod.
 */
export const mapFbrPaymentMode = (input: {
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  paidAmount?: number | null;
  payments?: Array<{ method: string; amount: number }> | null;
}): number => {
  const paid = Number(input.paidAmount ?? 0);
  if (paid <= 0 && String(input.paymentStatus || '').toUpperCase() !== 'COMPLETED') {
    return FBR_PAYMENT_MODES.CREDIT;
  }
  const modeOf = (method: string): number => {
    switch (String(method || '').toUpperCase()) {
      case 'CASH':
        return FBR_PAYMENT_MODES.CASH;
      case 'CARD':
      case 'JAZZCASH':
      case 'EASYPAISA':
      case 'MOBILE':
        return FBR_PAYMENT_MODES.CARD;
      case 'BANK_TRANSFER':
      case 'BANK':
        return FBR_PAYMENT_MODES.BANK_TRANSFER;
      case 'CREDIT':
        return FBR_PAYMENT_MODES.CREDIT;
      default:
        return FBR_PAYMENT_MODES.CASH;
    }
  };
  const payments = (input.payments || []).filter(p => Number(p.amount) > 0);
  if (payments.length > 0) {
    const largest = payments.reduce((a, b) => (Number(b.amount) > Number(a.amount) ? b : a));
    return modeOf(largest.method);
  }
  return modeOf(input.paymentMethod || 'CASH');
};

/** "YYYY-MM-DD HH:mm:ss" in server-local time (the IMS sample format). */
export const formatFbrDateTime = (date: Date): string => {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ` +
    `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
  );
};

/**
 * Simulates a format-faithful FBR invoice number for TEST mode: 19
 * digits like the real ones ("9000052011142444901"). Leading 9 +
 * 12 digits of epoch-ms + 6 random digits. Clearly a local simulation
 * — TEST rows are stored with status TEST and isTest = true.
 */
export const generateTestFbrInvoiceNumber = (): string => {
  const epoch = String(Date.now()).slice(-12).padStart(12, '0');
  const rand = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');
  return `9${epoch}${rand}`;
};

/** Parses an IMS response body into a verdict. */
export const parseFbrResponse = (
  body: any
): { ok: boolean; invoiceNumber: string | null; code: string | null; message: string } => {
  if (!body || typeof body !== 'object') {
    return { ok: false, invoiceNumber: null, code: null, message: 'Empty or non-JSON response from FBR' };
  }
  const code = body.Code !== undefined && body.Code !== null ? String(body.Code) : null;
  const invoiceNumber =
    body.InvoiceNumber !== undefined && body.InvoiceNumber !== null ? String(body.InvoiceNumber) : null;
  const message =
    body.Response || body.Message || (body.Errors ? JSON.stringify(body.Errors) : '') || '';
  return {
    ok: code === '100' && !!invoiceNumber,
    invoiceNumber,
    code,
    message: String(message)
  };
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface FbrLineInput {
  productId: string;
  itemCode: string;
  itemName: string;
  pctCode?: string | null;
  quantity: number;
  /** Stored line total (SaleItem.totalPrice) — the pro-ration basis. */
  lineTotal: number;
  /** Resolved tax-class id of the product, or null for default handling. */
  taxClassId?: string | null;
}

export interface FbrTaxGroupInput {
  /** Stored SaleTaxLine.taxClassId (null = implicit default group). */
  taxClassId: string | null;
  rate: number;
  taxAmount: number;
}

export interface FbrDerivedLine {
  productId: string;
  itemCode: string;
  itemName: string;
  pctCode: string;
  quantity: number;
  /** The line's original stored total (fractioning basis for credit notes). */
  lineTotal: number;
  rate: number;
  saleValue: number;
  taxCharged: number;
  discount: number;
  totalAmount: number;
}

/**
 * Derives the per-line fiscal figures for a sale: taxable base, tax
 * and discount per line. `taxableBase` is the sale's post-discount
 * base (subtotal − discounts); `taxGroups` are the stored SaleTaxLine
 * rows (empty for pre-B5 sales — a single implied group carrying the
 * sale's whole taxAmount is synthesized).
 */
export const deriveFbrLines = (input: {
  lines: FbrLineInput[];
  taxGroups: FbrTaxGroupInput[];
  subtotal: number;
  totalDiscount: number;
  taxableBase: number;
  totalTaxAmount: number;
}): { lines: FbrDerivedLine[]; totalSaleValue: number; totalTaxCharged: number; totalDiscount: number } => {
  const { lines, subtotal, totalDiscount, taxableBase } = input;
  const scale = subtotal > 0 ? taxableBase / subtotal : 0;

  // Per-line taxable base (cents, residue to the largest line).
  const bases = lines.map(l => round2(l.lineTotal * scale));
  const baseResidue = round2(taxableBase - bases.reduce((a, b) => a + b, 0));
  if (lines.length > 0 && baseResidue !== 0) {
    let largest = 0;
    for (let i = 1; i < lines.length; i++) if (bases[i] > bases[largest]) largest = i;
    bases[largest] = round2(bases[largest] + baseResidue);
  }

  // Tax pools by group key. Stored groups are authoritative; lines
  // whose group has no stored row (class changed after the sale, or
  // pre-B5 sale) share an implied pool built from the sale's total.
  const groupKeyOf = (taxClassId?: string | null) => taxClassId ?? '__default__';
  const storedPools = new Map<string, { rate: number; taxAmount: number }>();
  for (const g of input.taxGroups) {
    storedPools.set(groupKeyOf(g.taxClassId), { rate: Number(g.rate) || 0, taxAmount: Number(g.taxAmount) || 0 });
  }
  const storedTotal = [...storedPools.values()].reduce((a, g) => a + g.taxAmount, 0);
  const impliedRate =
    taxableBase > 0 ? ((Number(input.totalTaxAmount) || 0) / taxableBase) * 100 : 0;

  const lineGroupIdx = new Map<string, number[]>();
  lines.forEach((l, i) => {
    const key = groupKeyOf(l.taxClassId);
    const arr = lineGroupIdx.get(key) || [];
    arr.push(i);
    lineGroupIdx.set(key, arr);
  });

  const taxes = new Array(lines.length).fill(0);
  const rates = new Array(lines.length).fill(0);
  for (const [key, idxs] of lineGroupIdx.entries()) {
    const stored = storedPools.get(key);
    const groupBase = idxs.reduce((a, i) => a + bases[i], 0);
    let pool: number;
    let rate: number;
    if (stored) {
      pool = stored.taxAmount;
      rate = stored.rate;
    } else {
      // Implied pool at the sale's effective rate — unless stored
      // groups already account for the whole tax, in which case an
      // unmatched group contributes 0 rather than inventing tax.
      const leftover = Math.max(0, (Number(input.totalTaxAmount) || 0) - storedTotal);
      rate = impliedRate;
      pool = storedPools.size > 0 && leftover <= 0 ? 0 : round2(groupBase * (impliedRate / 100));
    }
    // Pro-rate the pool across the group's lines by base (cents,
    // residue to the group's largest line).
    const shares = idxs.map(i => (groupBase > 0 ? round2(pool * (bases[i] / groupBase)) : 0));
    const residue = round2(pool - shares.reduce((a, b) => a + b, 0));
    if (idxs.length > 0 && residue !== 0) {
      let largest = 0;
      for (let j = 1; j < idxs.length; j++) if (bases[idxs[j]] > bases[idxs[largest]]) largest = j;
      shares[largest] = round2(shares[largest] + residue);
    }
    idxs.forEach((lineIdx, j) => {
      taxes[lineIdx] = shares[j];
      rates[lineIdx] = rate;
    });
  }

  // Per-line discount (pro-rated by stored line total, cents,
  // residue to the largest line).
  const discounts = lines.map(l => (subtotal > 0 ? round2(totalDiscount * (l.lineTotal / subtotal)) : 0));
  const discountResidue = round2(totalDiscount - discounts.reduce((a, b) => a + b, 0));
  if (lines.length > 0 && discountResidue !== 0) {
    let largest = 0;
    for (let i = 1; i < lines.length; i++) if (lines[i].lineTotal > lines[largest].lineTotal) largest = i;
    discounts[largest] = round2(discounts[largest] + discountResidue);
  }

  const derived: FbrDerivedLine[] = lines.map((l, i) => ({
    productId: l.productId,
    itemCode: l.itemCode,
    itemName: l.itemName,
    pctCode: normalizePctCode(l.pctCode) || FBR_DEFAULT_PCT_CODE,
    quantity: l.quantity,
    lineTotal: l.lineTotal,
    rate: rates[i],
    saleValue: bases[i],
    taxCharged: taxes[i],
    discount: discounts[i],
    totalAmount: round2(bases[i] + taxes[i])
  }));

  return {
    lines: derived,
    totalSaleValue: round2(derived.reduce((a, l) => a + l.saleValue, 0)),
    totalTaxCharged: round2(derived.reduce((a, l) => a + l.taxCharged, 0)),
    totalDiscount: round2(derived.reduce((a, l) => a + l.discount, 0))
  };
};

/**
 * Fractions a set of derived lines for a credit note: each entry maps
 * a productId to the refunded fraction (0–1) of the original line.
 * Figures round to cents per line, exactly as derived.
 */
export const fractionFbrLines = (
  derived: FbrDerivedLine[],
  fractions: Array<{ productId: string; fraction: number; quantity: number }>
): FbrDerivedLine[] => {
  const byProduct = new Map(derived.map(l => [l.productId, l]));
  const out: FbrDerivedLine[] = [];
  for (const f of fractions) {
    const line = byProduct.get(f.productId);
    if (!line || f.fraction <= 0) continue;
    const frac = Math.min(1, f.fraction);
    out.push({
      ...line,
      quantity: f.quantity,
      saleValue: round2(line.saleValue * frac),
      taxCharged: round2(line.taxCharged * frac),
      discount: round2(line.discount * frac),
      totalAmount: round2(line.totalAmount * frac)
    });
  }
  return out;
};

export interface FbrPayloadInput {
  posId: string;
  usin: string;
  dateTime: Date;
  buyerName?: string | null;
  buyerPhone?: string | null;
  buyerNtn?: string | null;
  buyerCnic?: string | null;
  invoiceType: 1 | 2 | 3;
  refUsin?: string | null;
  paymentMode: number;
  lines: FbrDerivedLine[];
}

/** Shapes derived lines into the IMS invoice model (spec §7.2.3). */
export const buildFbrPayload = (input: FbrPayloadInput): Record<string, unknown> => {
  const items = input.lines.map(l => ({
    ItemCode: l.itemCode,
    ItemName: l.itemName,
    Quantity: l.quantity,
    PCTCode: l.pctCode,
    TaxRate: l.rate,
    SaleValue: l.saleValue,
    TotalAmount: l.totalAmount,
    TaxCharged: l.taxCharged,
    Discount: l.discount,
    FurtherTax: 0,
    InvoiceType: input.invoiceType,
    RefUSIN: input.refUsin ?? null
  }));
  const totalSaleValue = round2(input.lines.reduce((a, l) => a + l.saleValue, 0));
  const totalTaxCharged = round2(input.lines.reduce((a, l) => a + l.taxCharged, 0));
  const totalDiscount = round2(input.lines.reduce((a, l) => a + l.discount, 0));
  const totalQuantity = input.lines.reduce((a, l) => a + l.quantity, 0);
  return {
    InvoiceNumber: '',
    POSID: Number(input.posId),
    USIN: input.usin,
    DateTime: formatFbrDateTime(input.dateTime),
    ...(input.buyerNtn ? { BuyerNTN: input.buyerNtn } : {}),
    ...(input.buyerCnic ? { BuyerCNIC: input.buyerCnic } : {}),
    BuyerName: input.buyerName || '',
    BuyerPhoneNumber: input.buyerPhone || '',
    TotalBillAmount: round2(totalSaleValue + totalTaxCharged),
    TotalQuantity: totalQuantity,
    TotalSaleValue: totalSaleValue,
    TotalTaxCharged: totalTaxCharged,
    Discount: totalDiscount,
    FurtherTax: 0,
    PaymentMode: input.paymentMode,
    RefUSIN: input.refUsin ?? null,
    InvoiceType: input.invoiceType,
    Items: items
  };
};
