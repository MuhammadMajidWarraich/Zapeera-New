/**
 * Receipt print templates (Zapeera POS) — shared by the POS print /
 * preview / download paths in CreateInvoice.tsx and the receipt
 * settings UI in Settings.tsx.
 *
 * Two templates render from the same ReceiptData:
 *  - 'thermal': narrow 80mm compact slip, like a real pharmacy receipt
 *  - 'a4': redesigned full-page modern A4 receipt
 *
 * Defaults preserve the previous receipt content exactly: nothing is
 * dropped unless a show-* toggle hides it. The settings overrides
 * (displayName / tagline / address / phone / email / website /
 * footerMessage) fall back to the business's own details carried on
 * ReceiptData.business when null.
 *
 * FIXED_SOFTWARE_LINE is hard-coded and renders on BOTH templates,
 * always. The editable footerMessage is a separate line above it.
 */
import { escapeHtml } from "@/utils/html-escape";

export type ReceiptTemplateId = 'thermal' | 'a4';

export interface ReceiptSettings {
  template: ReceiptTemplateId;
  displayName: string | null;
  tagline: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  footerMessage: string | null;
  showCashier: boolean;
  showCustomer: boolean;
  showPrescription: boolean;
  showTaxBreakdown: boolean;
  showFbr: boolean;
  showPayment: boolean;
  showItemDetails: boolean;
}

export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
  template: 'a4',
  displayName: null,
  tagline: null,
  address: null,
  phone: null,
  email: null,
  website: null,
  footerMessage: null,
  showCashier: true,
  showCustomer: true,
  showPrescription: true,
  showTaxBreakdown: true,
  showFbr: true,
  showPayment: true,
  showItemDetails: true,
};

export function resolveReceiptSettings(
  partial: Partial<ReceiptSettings> | null | undefined,
): ReceiptSettings {
  const merged: ReceiptSettings = { ...DEFAULT_RECEIPT_SETTINGS, ...(partial ?? {}) };
  if (merged.template !== 'thermal' && merged.template !== 'a4') {
    merged.template = 'a4';
  }
  return merged;
}

export interface ReceiptData {
  receiptNumber: string;
  date: string;
  time: string;
  cashier: string;
  customer: {
    name: string;
    phone?: string;
    email?: string;
    address?: string;
  } | null;
  items: Array<{
    name: string;
    qty: number;
    price: number;
    total: number;
    batch?: string;
    expiry?: string;
    instructions?: string;
    /** Precomputed quantity phrase, e.g. "2 STRIP (20 tablets)" or "7 BOX". */
    qtyLabel?: string;
    variantName?: string;
  }>;
  subtotal: number;
  /** Plain discount amount (before loyalty / promotion lines). */
  discounts: number;
  discountPercentage?: number;
  loyaltyDiscount?: number;
  pointsRedeemed?: number;
  pointsEarned?: number;
  promotionDiscount?: number;
  promotionLabel?: string;
  taxBreakdown?: Array<{ label: string; amount: number }>;
  provincialTaxBreakdown?: Array<{ label: string; amount: number }>;
  fbrInvoiceNumber?: string | null;
  fbrStatus?: string | null;
  /** Pre-rendered QR data URL for the FBR invoice number (if any). */
  fbrQrDataUrl?: string | null;
  prescription?: {
    patientName?: string;
    rxNumber?: string;
    doctorName?: string;
    notes?: string;
  } | null;
  total: number;
  paymentMethod: string;
  paymentStatus: string;
  /** The business's own details — settings overrides fall back to these. */
  business?: {
    displayName: string;
    branchName?: string | null;
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
  };
}

/**
 * Fixed footer line. Hard-coded on purpose — it is NEVER read from
 * settings, NEVER editable and NEVER hideable, on either template.
 */
export const FIXED_SOFTWARE_LINE =
  'This invoice is generated using Zapeera A business management software';

const DEFAULT_TAGLINE = 'Your Health, Our Priority';

const pkr = (n: number | undefined | null): string => `PKR ${Number(n || 0).toFixed(2)}`;

const esc = (value: unknown): string => escapeHtml(value);

interface ResolvedBusiness {
  displayName: string;
  branchName: string;
  tagline: string;
  address: string;
  phone: string;
  email: string;
  website: string;
}

/** Settings overrides win; null falls back to the business's own details. */
function resolveBusiness(receipt: ReceiptData, settings: ReceiptSettings): ResolvedBusiness {
  const b = receipt.business;
  const pick = (override: string | null | undefined, fallback: string | null | undefined): string =>
    override ?? fallback ?? '';
  return {
    displayName: pick(settings.displayName, b?.displayName) || 'Zapeera',
    branchName: b?.branchName ?? '',
    tagline: pick(settings.tagline, DEFAULT_TAGLINE),
    address: pick(settings.address, b?.address),
    phone: pick(settings.phone, b?.phone),
    email: pick(settings.email, b?.email),
    website: pick(settings.website, b?.website),
  };
}

interface TotalRow {
  label: string;
  amount: string;
  kind: 'plain' | 'discount' | 'final';
}

/** Totals rows in receipt order; tax lines honour the showTaxBreakdown toggle. */
function totalRows(receipt: ReceiptData, settings: ReceiptSettings): TotalRow[] {
  const rows: TotalRow[] = [{ label: 'Subtotal:', amount: pkr(receipt.subtotal), kind: 'plain' }];
  if (receipt.discounts > 0) {
    rows.push({
      label:
        receipt.discountPercentage && receipt.discountPercentage > 0
          ? `Discount (${receipt.discountPercentage}%):`
          : 'Discount:',
      amount: `-${pkr(receipt.discounts)}`,
      kind: 'discount',
    });
  }
  if (receipt.loyaltyDiscount && receipt.loyaltyDiscount > 0) {
    rows.push({
      label: `Loyalty Discount (${receipt.pointsRedeemed || 0} pts):`,
      amount: `-${pkr(receipt.loyaltyDiscount)}`,
      kind: 'discount',
    });
  }
  if (receipt.promotionDiscount && receipt.promotionDiscount > 0) {
    rows.push({
      label: `Promotion${receipt.promotionLabel ? ` (${receipt.promotionLabel})` : ''}:`,
      amount: `-${pkr(receipt.promotionDiscount)}`,
      kind: 'discount',
    });
  }
  if (settings.showTaxBreakdown) {
    for (const line of receipt.taxBreakdown || []) {
      rows.push({ label: `${line.label}:`, amount: pkr(line.amount), kind: 'plain' });
    }
    for (const line of receipt.provincialTaxBreakdown || []) {
      rows.push({ label: `${line.label}:`, amount: pkr(line.amount), kind: 'plain' });
    }
  }
  rows.push({ label: 'TOTAL:', amount: pkr(receipt.total), kind: 'final' });
  return rows;
}

/** Batch / expiry / dosage detail lines under an item; hidden by showItemDetails. */
function itemDetailLines(
  item: ReceiptData['items'][number],
  settings: ReceiptSettings,
): string {
  if (!settings.showItemDetails) return '';
  const lines: string[] = [];
  if (item.batch) lines.push(`Batch: ${esc(item.batch)}`);
  if (item.expiry) lines.push(`Exp: ${esc(item.expiry)}`);
  if (item.instructions) lines.push(esc(item.instructions));
  return lines.map((line) => `<div class="item-details">${line}</div>`).join('');
}

function prescriptionText(receipt: ReceiptData): string | null {
  const rx = receipt.prescription;
  if (!rx) return null;
  const parts: string[] = [];
  if (rx.patientName) parts.push(esc(rx.patientName));
  if (rx.doctorName) parts.push(`(Dr. ${esc(rx.doctorName)})`);
  return parts.length > 0 ? parts.join(' ') : null;
}

function buildThermalHtml(receipt: ReceiptData, settings: ReceiptSettings): string {
  const biz = resolveBusiness(receipt, settings);
  const rxText = prescriptionText(receipt);
  const contactLine = biz.phone
    ? `For any queries, contact us at: ${esc(biz.phone)}`
    : 'For any queries, contact us';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Receipt - ${esc(receipt.receiptNumber)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: 'Courier New', Courier, monospace;
    font-size: 11px;
    line-height: 1.45;
    margin: 0 auto;
    padding: 3mm;
    width: 80mm;
    background: #fff;
    color: #000;
  }
  .center { text-align: center; }
  .biz { font-size: 15px; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; }
  .branch { font-size: 12px; font-weight: bold; margin-top: 2px; }
  .tagline { font-size: 10px; font-style: italic; color: #444; margin-top: 2px; }
  .contact { font-size: 10px; margin-top: 1px; }
  .sep { border-top: 1px dashed #000; margin: 8px 0; }
  .row { display: flex; justify-content: space-between; gap: 8px; }
  .row > span:last-child { text-align: right; }
  .section-title { font-weight: bold; margin-bottom: 4px; }
  .item { margin-bottom: 6px; }
  .item-name { font-weight: bold; }
  .item-details { font-size: 10px; color: #333; }
  .total-line { display: flex; justify-content: space-between; gap: 8px; }
  .total-line.discount { color: #15803d; }
  .total-final { font-weight: bold; font-size: 13px; border-top: 2px solid #000; padding-top: 4px; margin-top: 4px; }
  .fbr { text-align: center; margin-top: 8px; }
  .fbr img { width: 110px; height: 110px; margin-top: 4px; }
  .footer { text-align: center; margin-top: 10px; }
  .thanks { font-size: 13px; font-weight: bold; letter-spacing: 1px; }
  .footer-message { margin-top: 4px; }
  .software-note { margin-top: 8px; font-size: 9px; font-style: italic; color: #666; }
  @media print {
    body { padding: 0; }
    @page { size: 80mm auto; margin: 2mm; }
  }
</style>
</head>
<body>
  <div class="center">
    <div class="biz">${esc(biz.displayName)}</div>
    ${biz.branchName ? `<div class="branch">${esc(biz.branchName)}</div>` : ''}
    ${biz.tagline ? `<div class="tagline">${esc(biz.tagline)}</div>` : ''}
    ${biz.address ? `<div class="contact">${esc(biz.address)}</div>` : ''}
    ${biz.phone ? `<div class="contact">Tel: ${esc(biz.phone)}</div>` : ''}
    ${biz.email ? `<div class="contact">${esc(biz.email)}</div>` : ''}
    ${biz.website ? `<div class="contact">${esc(biz.website)}</div>` : ''}
  </div>

  <div class="sep"></div>

  <div class="row"><span>Receipt #:</span><b>${esc(receipt.receiptNumber)}</b></div>
  <div class="row"><span>Date:</span><span>${esc(receipt.date)}</span></div>
  <div class="row"><span>Time:</span><span>${esc(receipt.time)}</span></div>
  ${settings.showCashier ? `<div class="row"><span>Cashier:</span><span>${esc(receipt.cashier)}</span></div>` : ''}
  ${settings.showCustomer && receipt.customer ? `
  <div class="row"><span>Customer:</span><span>${esc(receipt.customer.name)}${receipt.customer.phone ? ` (${esc(receipt.customer.phone)})` : ''}</span></div>
  ${receipt.customer.email ? `<div class="row"><span>Email:</span><span>${esc(receipt.customer.email)}</span></div>` : ''}
  ${receipt.customer.address ? `<div class="row"><span>Address:</span><span>${esc(receipt.customer.address)}</span></div>` : ''}` : ''}
  ${settings.showPrescription && rxText ? `<div class="row"><span>Rx:</span><span>${rxText}</span></div>` : ''}
  ${settings.showPrescription && receipt.prescription?.rxNumber ? `<div class="row"><span>Rx #:</span><span>${esc(receipt.prescription.rxNumber)}</span></div>` : ''}
  ${settings.showPrescription && receipt.prescription?.notes ? `<div class="row"><span>Rx notes:</span><span>${esc(receipt.prescription.notes)}</span></div>` : ''}

  <div class="sep"></div>

  <div class="section-title">Items:</div>
  ${receipt.items
    .map(
      (item) => `
  <div class="item">
    <div class="row"><span class="item-name">${esc(item.name)}${item.variantName ? ` (${esc(item.variantName)})` : ''}</span><span class="item-name">${pkr(item.total)}</span></div>
    <div class="item-details">${esc(item.qtyLabel ?? String(item.qty))} × ${pkr(item.price)}</div>
    ${itemDetailLines(item, settings)}
  </div>`,
    )
    .join('')}

  <div class="sep"></div>

  ${totalRows(receipt, settings)
    .map(
      (row) =>
        `<div class="total-line${row.kind === 'discount' ? ' discount' : ''}${row.kind === 'final' ? ' total-final' : ''}"><span>${esc(row.label)}</span><span>${esc(row.amount)}</span></div>`,
    )
    .join('')}
  ${receipt.pointsEarned && receipt.pointsEarned > 0 ? `<div class="row"><span>Points earned:</span><span>+${receipt.pointsEarned} pts</span></div>` : ''}

  ${settings.showPayment ? `
  <div class="sep"></div>
  <div class="row"><span>Payment:</span><b>${esc(receipt.paymentMethod.toUpperCase())} • ${receipt.paymentStatus === 'COMPLETED' ? 'Paid' : 'Unpaid'}</b></div>` : ''}

  ${settings.showFbr && receipt.fbrInvoiceNumber ? `
  <div class="fbr">
    <div><b>FBR Invoice #:</b> ${esc(receipt.fbrInvoiceNumber)}</div>
    ${receipt.fbrQrDataUrl ? `<img src="${receipt.fbrQrDataUrl}" alt="FBR invoice QR">` : ''}
    <div class="contact">Verify at FBR's invoice verification portal.</div>
  </div>` : ''}
  ${settings.showFbr && !receipt.fbrInvoiceNumber && receipt.fbrStatus ? `
  <div class="center" style="margin-top: 8px;">Fiscal status: <b>${esc(receipt.fbrStatus)}</b> — the FBR invoice number will appear once FBR confirms it.</div>` : ''}

  <div class="sep"></div>

  <div class="footer">
    <div class="thanks">THANK YOU!</div>
    <div>Thank you for choosing ${esc(biz.displayName)}!</div>
    ${settings.footerMessage ? `<div class="footer-message">${esc(settings.footerMessage)}</div>` : ''}
    <div>${contactLine}</div>
    <div class="software-note">${esc(FIXED_SOFTWARE_LINE)}</div>
  </div>
</body>
</html>`;
}

function buildA4Html(receipt: ReceiptData, settings: ReceiptSettings): string {
  const biz = resolveBusiness(receipt, settings);
  const rxText = prescriptionText(receipt);
  const contactLine = biz.phone
    ? `For any queries, contact us at: ${esc(biz.phone)}`
    : 'For any queries, contact us';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Receipt - ${esc(receipt.receiptNumber)}</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 12px;
    line-height: 1.5;
    margin: 0;
    padding: 24px;
    background: #fff;
    color: #111827;
  }
  .page { max-width: 720px; margin: 0 auto; }
  .head { display: flex; justify-content: space-between; gap: 24px; padding-bottom: 14px; border-bottom: 3px solid #2563eb; }
  .brand h1 { margin: 0; font-size: 24px; font-weight: bold; color: #2563eb; line-height: 1.2; }
  .brand .branch-name { font-size: 14px; font-weight: 600; color: #1e40af; margin-top: 2px; }
  .brand .tagline { font-size: 11px; color: #6b7280; font-style: italic; margin-top: 2px; }
  .brand .contact { font-size: 11px; color: #374151; margin-top: 6px; }
  .meta { text-align: right; font-size: 11px; flex-shrink: 0; }
  .meta .receipt-label { font-size: 11px; font-weight: 700; letter-spacing: 1.5px; color: #6b7280; text-transform: uppercase; }
  .meta .receipt-no { font-size: 16px; font-weight: 800; color: #1e40af; font-family: monospace; }
  .meta div { margin-top: 2px; }
  .cards { display: flex; gap: 12px; margin-top: 14px; }
  .card { flex: 1; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 12px; font-size: 11px; }
  .card h3 { margin: 0 0 6px 0; font-size: 11px; font-weight: 700; letter-spacing: 0.5px; text-transform: uppercase; color: #1e40af; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 16px; }
  table.items th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #1e40af; border-bottom: 2px solid #2563eb; padding: 6px 4px; }
  table.items th.num, table.items td.num { text-align: right; }
  table.items td { padding: 8px 4px; border-bottom: 1px dotted #d1d5db; vertical-align: top; }
  .item-name { font-weight: 600; }
  .item-details { font-size: 10px; color: #6b7280; margin-top: 2px; }
  .totals { width: 300px; margin: 14px 0 0 auto; }
  .total-line { display: flex; justify-content: space-between; gap: 12px; padding: 2px 0; }
  .total-line.discount { color: #16a34a; }
  .total-final { font-weight: bold; font-size: 16px; border-top: 2px solid #1e40af; padding-top: 8px; margin-top: 6px; color: #1e40af; }
  .payrow { display: flex; gap: 12px; margin-top: 16px; }
  .pay { flex: 1; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px; padding: 10px 12px; font-size: 11px; }
  .pay strong { color: #1e40af; }
  .fbr { flex: 1; text-align: center; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; padding: 10px 12px; font-size: 11px; }
  .fbr img { width: 110px; height: 110px; margin-top: 6px; }
  .footer { text-align: center; margin-top: 22px; padding-top: 14px; border-top: 1px solid #e5e7eb; font-size: 10px; color: #6b7280; }
  .footer p { margin: 4px 0; }
  .footer .footer-brand { font-size: 12px; font-weight: 600; color: #1e40af; }
  .footer .software-note { margin-top: 8px; font-style: italic; color: #9ca3af; }
  @media print {
    body { padding: 0; }
    @page { size: A4; margin: 10mm; }
  }
</style>
</head>
<body>
<div class="page">
  <div class="head">
    <div class="brand">
      <h1>${esc(biz.displayName)}</h1>
      ${biz.branchName ? `<div class="branch-name">${esc(biz.branchName)}</div>` : ''}
      ${biz.tagline ? `<div class="tagline">${esc(biz.tagline)}</div>` : ''}
      <div class="contact">
        ${biz.address ? `${esc(biz.address)}<br>` : ''}
        ${biz.phone ? `Tel: ${esc(biz.phone)}` : ''}${biz.phone && biz.email ? ' &nbsp;·&nbsp; ' : ''}${biz.email ? esc(biz.email) : ''}
        ${biz.website ? `<br>${esc(biz.website)}` : ''}
      </div>
    </div>
    <div class="meta">
      <div class="receipt-label">Receipt</div>
      <div class="receipt-no">${esc(receipt.receiptNumber)}</div>
      <div><strong>Date:</strong> ${esc(receipt.date)}</div>
      <div><strong>Time:</strong> ${esc(receipt.time)}</div>
      ${settings.showCashier ? `<div><strong>Cashier:</strong> ${esc(receipt.cashier)}</div>` : ''}
    </div>
  </div>

  ${settings.showCustomer && receipt.customer ? `
  <div class="cards">
    <div class="card">
      <h3>Customer</h3>
      <div><strong>${esc(receipt.customer.name)}</strong></div>
      ${receipt.customer.phone ? `<div>Phone: ${esc(receipt.customer.phone)}</div>` : ''}
      ${receipt.customer.email ? `<div>Email: ${esc(receipt.customer.email)}</div>` : ''}
      ${receipt.customer.address ? `<div>Address: ${esc(receipt.customer.address)}</div>` : ''}
    </div>
    ${settings.showPrescription && rxText ? `
    <div class="card">
      <h3>Prescription</h3>
      <div><strong>Rx:</strong> ${rxText}</div>
      ${receipt.prescription?.rxNumber ? `<div>Rx #: ${esc(receipt.prescription.rxNumber)}</div>` : ''}
      ${receipt.prescription?.notes ? `<div>${esc(receipt.prescription.notes)}</div>` : ''}
    </div>` : ''}
  </div>` : settings.showPrescription && rxText ? `
  <div class="cards">
    <div class="card">
      <h3>Prescription</h3>
      <div><strong>Rx:</strong> ${rxText}</div>
      ${receipt.prescription?.rxNumber ? `<div>Rx #: ${esc(receipt.prescription.rxNumber)}</div>` : ''}
      ${receipt.prescription?.notes ? `<div>${esc(receipt.prescription.notes)}</div>` : ''}
    </div>
  </div>` : ''}

  <table class="items">
    <thead>
      <tr><th>Item</th><th class="num">Qty</th><th class="num">Unit Price</th><th class="num">Total</th></tr>
    </thead>
    <tbody>
      ${receipt.items
        .map(
          (item) => `
      <tr>
        <td>
          <div class="item-name">${esc(item.name)}${item.variantName ? ` (${esc(item.variantName)})` : ''}</div>
          ${itemDetailLines(item, settings)}
        </td>
        <td class="num">${esc(item.qtyLabel ?? String(item.qty))}</td>
        <td class="num">${pkr(item.price)}</td>
        <td class="num"><strong>${pkr(item.total)}</strong></td>
      </tr>`,
        )
        .join('')}
    </tbody>
  </table>

  <div class="totals">
    ${totalRows(receipt, settings)
      .map(
        (row) =>
          `<div class="total-line${row.kind === 'discount' ? ' discount' : ''}${row.kind === 'final' ? ' total-final' : ''}"><span>${esc(row.label)}</span><span>${esc(row.amount)}</span></div>`,
      )
      .join('')}
    ${receipt.pointsEarned && receipt.pointsEarned > 0 ? `<div class="total-line"><span>Points earned:</span><span>+${receipt.pointsEarned} pts</span></div>` : ''}
  </div>

  ${settings.showPayment || (settings.showFbr && (receipt.fbrInvoiceNumber || receipt.fbrStatus)) ? `
  <div class="payrow">
    ${settings.showPayment ? `
    <div class="pay">
      <strong>Payment Method:</strong> ${esc(receipt.paymentMethod.toUpperCase())}<br>
      <strong>Status:</strong> ${receipt.paymentStatus === 'COMPLETED' ? 'Paid' : 'Unpaid'}
    </div>` : ''}
    ${settings.showFbr && receipt.fbrInvoiceNumber ? `
    <div class="fbr">
      <strong>FBR Invoice #:</strong> ${esc(receipt.fbrInvoiceNumber)}
      ${receipt.fbrQrDataUrl ? `<br><img src="${receipt.fbrQrDataUrl}" alt="FBR invoice QR">` : ''}
    </div>` : ''}
    ${settings.showFbr && !receipt.fbrInvoiceNumber && receipt.fbrStatus ? `
    <div class="fbr">
      Fiscal status: <strong>${esc(receipt.fbrStatus)}</strong> — the FBR invoice number will appear once FBR confirms it.
    </div>` : ''}
  </div>` : ''}

  <div class="footer">
    <p class="footer-brand">Thank you for choosing ${esc(biz.displayName)}!</p>
    ${settings.footerMessage ? `<p>${esc(settings.footerMessage)}</p>` : ''}
    <p>${contactLine}</p>
    <p class="software-note">${esc(FIXED_SOFTWARE_LINE)}</p>
  </div>
</div>
</body>
</html>`;
}

/**
 * Renders the receipt as a full standalone HTML document in the
 * template chosen by `settings.template`. NOTE: the thermal 80mm
 * @page size is a print hint — the paper actually used depends on
 * the user's printer settings.
 */
export function buildReceiptHtml(receipt: ReceiptData, settings: ReceiptSettings): string {
  const resolved = resolveReceiptSettings(settings);
  return resolved.template === 'thermal'
    ? buildThermalHtml(receipt, resolved)
    : buildA4Html(receipt, resolved);
}
