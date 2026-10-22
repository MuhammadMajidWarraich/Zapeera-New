// ─── FBR POS fiscal integration (Wave B7): service layer ───────────────
// The durable-outbox half of the integration. Payload math lives in
// utils/fbr.util.ts (pure); this file owns persistence + transport:
//
//   · enqueueFbrForSale / enqueueFbrCreditNote create queue rows
//     AFTER the sale/refund transaction has committed. Both are
//     fully guarded: any failure is logged and swallowed — fiscali-
//     zation must NEVER fail or slow the sale itself (the real-world
//     FBR requirement is queue-and-sync-later when FBR is down).
//   · processDueFbrJobs (driven by jobs/fbr-worker.ts every 30s, and
//     kicked immediately after each enqueue) posts due rows to the
//     configured IMS environment with Bearer auth, retries with
//     backoff (1m → 5m → 15m, 3 attempts → FAILED), and mirrors the
//     outcome onto Sale.fbrStatus / Sale.fbrInvoiceNumber.
//   · TEST environment performs NO network call: it simulates a
//     format-faithful 19-digit FBR invoice number so the complete UX
//     (queue states, receipt QR, manual retry) is verifiable before
//     a business has real FBR credentials.
//
// The API token is read from FbrConfig only at post time, is sent
// only in the Authorization header, and is never logged or stored in
// queue payloads.

import axios from 'axios';
import { getPrisma } from '../utils/db.util';
import {
  buildFbrPayload,
  deriveFbrLines,
  fractionFbrLines,
  generateTestFbrInvoiceNumber,
  mapFbrPaymentMode,
  parseFbrResponse,
  FBR_ENDPOINTS,
  FbrDerivedLine
} from '../utils/fbr.util';

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000];
const STALE_SENDING_MS = 5 * 60_000;

type PrismaLike = Awaited<ReturnType<typeof getPrisma>>;

export const getFbrConfig = async (prisma: PrismaLike, companyId: string) =>
  prisma.fbrConfig.findUnique({ where: { companyId } });

const saleInclude = {
  items: {
    include: {
      product: { select: { id: true, name: true, sku: true, pctCode: true, taxClassId: true } }
    }
  },
  taxLines: true,
  payments: true,
  customer: { select: { id: true, name: true, phone: true } }
} as const;

const loadSaleForFbr = (prisma: PrismaLike, saleId: string) =>
  prisma.sale.findUnique({ where: { id: saleId }, include: saleInclude });

/** Derives the fiscal lines for a loaded sale (see fbr.util header). */
const derivedForSale = (sale: any) => {
  const lines = (sale.items || []).map((item: any) => ({
    productId: item.productId,
    itemCode: item.product?.sku || item.productId,
    itemName: item.product?.name || 'Item',
    pctCode: item.product?.pctCode ?? null,
    quantity: item.quantity,
    lineTotal: Number(item.totalPrice) || 0,
    taxClassId: item.product?.taxClassId ?? null
  }));
  const totalDiscount =
    (Number(sale.discountAmount) || 0) +
    (Number(sale.promotionDiscount) || 0) +
    (Number(sale.loyaltyDiscount) || 0);
  const taxableBase = Math.max(0, (Number(sale.totalAmount) || 0) - (Number(sale.taxAmount) || 0));
  return deriveFbrLines({
    lines,
    taxGroups: (sale.taxLines || []).map((t: any) => ({
      taxClassId: t.taxClassId ?? null,
      rate: Number(t.rate) || 0,
      taxAmount: Number(t.taxAmount) || 0
    })),
    subtotal: lines.reduce((a: number, l: any) => a + l.lineTotal, 0),
    totalDiscount,
    taxableBase,
    totalTaxAmount: Number(sale.taxAmount) || 0
  });
};

/** Credit notes fraction per product — merge multi-line products first. */
const aggregateByProduct = (lines: FbrDerivedLine[]): FbrDerivedLine[] => {
  const byId = new Map<string, FbrDerivedLine>();
  for (const line of lines) {
    const existing = byId.get(line.productId);
    if (!existing) {
      byId.set(line.productId, { ...line });
    } else {
      existing.quantity += line.quantity;
      existing.lineTotal += line.lineTotal;
      existing.saleValue += line.saleValue;
      existing.taxCharged += line.taxCharged;
      existing.discount += line.discount;
      existing.totalAmount += line.totalAmount;
    }
  }
  return [...byId.values()];
};

const buildPayloadForRow = async (prisma: PrismaLike, row: any): Promise<Record<string, unknown>> => {
  const config = await getFbrConfig(prisma, row.companyId);
  if (!config?.posId) {
    throw new Error('FBR POS ID is not configured for this business');
  }
  if (row.kind === 'CREDIT_NOTE') {
    const refund = await prisma.refund.findUnique({
      where: { id: row.refundId },
      include: { items: true }
    });
    if (!refund) throw new Error('Refund not found for credit note');
    const originalSale: any = await loadSaleForFbr(prisma, refund.originalSaleId);
    if (!originalSale) throw new Error('Original sale not found for credit note');
    const aggregated = aggregateByProduct(derivedForSale(originalSale).lines);
    const originalQty = new Map<string, number>();
    for (const item of originalSale.items || []) {
      originalQty.set(item.productId, (originalQty.get(item.productId) || 0) + item.quantity);
    }
    const fractions = (refund.items || []).map((ri: any) => ({
      productId: ri.productId,
      fraction: (originalQty.get(ri.productId) || 0) > 0 ? ri.quantity / (originalQty.get(ri.productId) as number) : 0,
      quantity: ri.quantity
    }));
    const lines = fractionFbrLines(aggregated, fractions);
    return buildFbrPayload({
      posId: config.posId,
      usin: `CN-${refund.id.slice(-8).toUpperCase()}`,
      dateTime: refund.createdAt ? new Date(refund.createdAt) : new Date(),
      buyerName: originalSale.customer?.name,
      buyerPhone: originalSale.customer?.phone,
      invoiceType: 3,
      refUsin: originalSale.invoiceNumber || originalSale.id,
      paymentMode: mapFbrPaymentMode({
        paymentMethod: refund.refundMethod || originalSale.paymentMethod,
        paymentStatus: 'COMPLETED',
        paidAmount: Number(refund.refundAmount) || 1,
        payments: []
      }),
      lines
    });
  }
  const sale: any = await loadSaleForFbr(prisma, row.saleId);
  if (!sale) throw new Error('Sale not found for fiscalization');
  const derived = derivedForSale(sale);
  return buildFbrPayload({
    posId: config.posId,
    usin: sale.invoiceNumber || sale.id,
    dateTime: sale.createdAt ? new Date(sale.createdAt) : new Date(),
    buyerName: sale.customer?.name,
    buyerPhone: sale.customer?.phone,
    invoiceType: 1,
    refUsin: null,
    paymentMode: mapFbrPaymentMode({
      paymentMethod: sale.paymentMethod,
      paymentStatus: sale.paymentStatus,
      paidAmount: sale.paidAmount,
      payments: sale.payments || []
    }),
    lines: derived.lines
  });
};

/**
 * Creates the queue row for a committed sale. Returns the row, or
 * null when FBR is not enabled for the business (the common case —
 * no row, no noise) or when anything went wrong (logged, swallowed).
 */
export const enqueueFbrForSale = async (prisma: PrismaLike, saleId: string): Promise<any | null> => {
  try {
    const sale = await prisma.sale.findUnique({
      where: { id: saleId },
      select: { id: true, companyId: true }
    });
    if (!sale) return null;
    const config = await getFbrConfig(prisma, sale.companyId);
    if (!config?.enabled) return null;
    let row: any;
    try {
      row = await prisma.fbrInvoiceQueue.create({
        data: {
          companyId: sale.companyId,
          saleId: sale.id,
          kind: 'SALE',
          idempotencyKey: `SALE:${sale.id}`,
          status: 'PENDING',
          isTest: config.environment === 'TEST'
        }
      });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        row = await prisma.fbrInvoiceQueue.findUnique({
          where: { idempotencyKey: `SALE:${sale.id}` }
        });
        return row;
      }
      throw e;
    }
    await prisma.sale.update({ where: { id: sale.id }, data: { fbrStatus: 'PENDING' } });
    return row;
  } catch (err: any) {
    console.error('[FBR] enqueueFbrForSale failed (sale unaffected):', err.message);
    return null;
  }
};

/**
 * Creates the credit-note queue row for a committed refund — ONLY
 * when the original sale was actually fiscalized (its SALE row is
 * SENT, or TEST in test mode). A refund of a non-fiscal sale has no
 * fiscal footprint, so no row is created. Guarded like the sale path.
 */
export const enqueueFbrCreditNote = async (prisma: PrismaLike, refundId: string): Promise<any | null> => {
  try {
    const refund = await prisma.refund.findUnique({
      where: { id: refundId },
      select: { id: true, originalSaleId: true }
    });
    if (!refund) return null;
    const originalQueue = await prisma.fbrInvoiceQueue.findFirst({
      where: { saleId: refund.originalSaleId, kind: 'SALE', status: { in: ['SENT', 'TEST'] } },
      select: { id: true, companyId: true }
    });
    if (!originalQueue) return null;
    const config = await getFbrConfig(prisma, originalQueue.companyId);
    if (!config?.enabled) return null;
    try {
      const row = await prisma.fbrInvoiceQueue.create({
        data: {
          companyId: originalQueue.companyId,
          saleId: refund.originalSaleId,
          refundId: refund.id,
          kind: 'CREDIT_NOTE',
          idempotencyKey: `CN:${refund.id}`,
          status: 'PENDING',
          isTest: config.environment === 'TEST'
        }
      });
      return row;
    } catch (e: any) {
      if (e?.code === 'P2002') return null;
      throw e;
    }
  } catch (err: any) {
    console.error('[FBR] enqueueFbrCreditNote failed (refund unaffected):', err.message);
    return null;
  }
};

const markFailed = async (
  prisma: PrismaLike,
  row: any,
  attempts: number,
  message: string,
  requestPayload?: Record<string, unknown>
): Promise<void> => {
  const exhausted = attempts >= MAX_ATTEMPTS;
  await prisma.fbrInvoiceQueue.update({
    where: { id: row.id },
    data: {
      status: exhausted ? 'FAILED' : 'PENDING',
      attempts,
      nextAttemptAt: exhausted ? null : new Date(Date.now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)]),
      lastError: message.slice(0, 500),
      ...(requestPayload ? { requestPayload: requestPayload as any } : {})
    }
  });
  if (row.kind === 'SALE') {
    await prisma.sale.update({
      where: { id: row.saleId },
      data: { fbrStatus: exhausted ? 'FAILED' : 'PENDING' }
    });
  }
  console.error(`[FBR] row=${row.id} sale=${row.saleId} attempt=${attempts} ${exhausted ? 'FAILED' : 'will retry'}: ${message}`);
};

const markSent = async (
  prisma: PrismaLike,
  row: any,
  attempts: number,
  invoiceNumber: string,
  status: 'SENT' | 'TEST',
  requestPayload: Record<string, unknown>,
  responsePayload: unknown
): Promise<void> => {
  await prisma.fbrInvoiceQueue.update({
    where: { id: row.id },
    data: {
      status,
      attempts,
      fbrInvoiceNumber: invoiceNumber,
      requestPayload: requestPayload as any,
      responsePayload: responsePayload as any,
      lastError: null,
      nextAttemptAt: null,
      sentAt: new Date()
    }
  });
  // Only the sale's own fiscal document mirrors onto the Sale row;
  // credit-note numbers stay on their queue rows.
  if (row.kind === 'SALE') {
    await prisma.sale.update({
      where: { id: row.saleId },
      data: { fbrInvoiceNumber: invoiceNumber, fbrStatus: status }
    });
  }
};

/** Processes one queue row end-to-end. Never throws. */
export const processFbrQueueRow = async (prisma: PrismaLike, rowId: string): Promise<void> => {
  try {
    const row = await prisma.fbrInvoiceQueue.findUnique({ where: { id: rowId } });
    if (!row || row.status !== 'PENDING') return;
    // Claim the row so overlapping ticks/immediate kicks can't double-post.
    const claimed = await prisma.fbrInvoiceQueue.updateMany({
      where: { id: rowId, status: 'PENDING' },
      data: { status: 'SENDING' }
    });
    if (claimed.count === 0) return;
    const attempts = row.attempts + 1;

    const config = await getFbrConfig(prisma, row.companyId);
    if (!config?.enabled) {
      await prisma.fbrInvoiceQueue.update({
        where: { id: row.id },
        data: { status: 'SKIPPED', attempts, lastError: 'FBR was disabled for this business before posting' }
      });
      if (row.kind === 'SALE') {
        await prisma.sale.update({ where: { id: row.saleId }, data: { fbrStatus: 'SKIPPED' } });
      }
      return;
    }

    let payload: Record<string, unknown>;
    try {
      payload = await buildPayloadForRow(prisma, row);
    } catch (e: any) {
      await markFailed(prisma, row, attempts, `Payload build failed: ${e.message}`);
      return;
    }

    // TEST mode: simulate locally — no network, format-faithful number.
    if (config.environment === 'TEST') {
      const invoiceNumber = generateTestFbrInvoiceNumber();
      await markSent(prisma, row, attempts, invoiceNumber, 'TEST', payload, {
        simulated: true,
        Code: '100',
        InvoiceNumber: invoiceNumber,
        Response: 'TEST MODE — simulated locally, nothing was sent to FBR'
      });
      return;
    }

    if (!config.apiToken) {
      await markFailed(prisma, row, attempts, 'FBR API token is not configured for this business', payload);
      return;
    }

    const endpoint = FBR_ENDPOINTS[config.environment as 'SANDBOX' | 'PRODUCTION'];
    try {
      const resp = await axios.post(endpoint, payload, {
        headers: { Authorization: `Bearer ${config.apiToken}`, 'Content-Type': 'application/json' },
        timeout: 30_000,
        validateStatus: () => true
      });
      const parsed = parseFbrResponse(resp.data);
      if (resp.status >= 200 && resp.status < 300 && parsed.ok && parsed.invoiceNumber) {
        await markSent(prisma, row, attempts, parsed.invoiceNumber, 'SENT', payload, resp.data);
      } else {
        await markFailed(
          prisma,
          row,
          attempts,
          `FBR rejected the invoice (HTTP ${resp.status}${parsed.code ? `, Code ${parsed.code}` : ''})${parsed.message ? `: ${parsed.message}` : ''}`,
          payload
        );
      }
    } catch (e: any) {
      // Network/timeout — the token is never part of these messages.
      await markFailed(prisma, row, attempts, `FBR request failed: ${e.message}`, payload);
    }
  } catch (err: any) {
    console.error('[FBR] processFbrQueueRow error:', err.message);
  }
};

/** Fire-and-forget immediate attempt (post-enqueue / manual retry). */
export const attemptImmediateFbr = (rowId: string): void => {
  void (async () => {
    try {
      const prisma = await getPrisma();
      await processFbrQueueRow(prisma, rowId);
    } catch (err: any) {
      console.error('[FBR] immediate attempt failed:', err.message);
    }
  })();
};

/** One worker tick: recover stale claims, then post everything due. */
export const processDueFbrJobs = async (): Promise<void> => {
  const prisma = await getPrisma();
  // Rows stuck in SENDING (crash mid-post) become due again.
  await prisma.fbrInvoiceQueue.updateMany({
    where: { status: 'SENDING', updatedAt: { lt: new Date(Date.now() - STALE_SENDING_MS) } },
    data: { status: 'PENDING', nextAttemptAt: new Date() }
  });
  const due = await prisma.fbrInvoiceQueue.findMany({
    where: {
      status: 'PENDING',
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }]
    },
    orderBy: { createdAt: 'asc' },
    take: 20,
    select: { id: true }
  });
  for (const row of due) {
    await processFbrQueueRow(prisma, row.id);
  }
};

/**
 * Manual retry for one sale (owner/manager action): resets its latest
 * SALE queue row to PENDING with a fresh attempt budget, or enqueues
 * a new row when none exists (e.g. FBR was enabled after the sale).
 */
export const retryFbrForSale = async (
  prisma: PrismaLike,
  companyId: string,
  saleId: string
): Promise<{ ok: boolean; message: string; row?: any }> => {
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, companyId },
    select: { id: true }
  });
  if (!sale) return { ok: false, message: 'Sale not found' };
  const config = await getFbrConfig(prisma, companyId);
  if (!config?.enabled) {
    return { ok: false, message: 'FBR POS is not enabled for this business — enable it in Business Settings first' };
  }
  const existing = await prisma.fbrInvoiceQueue.findFirst({
    where: { saleId, kind: 'SALE' },
    orderBy: { createdAt: 'desc' }
  });
  if (existing && (existing.status === 'SENT' || existing.status === 'TEST')) {
    return { ok: false, message: 'This sale already has an FBR invoice number', row: existing };
  }
  if (existing) {
    const row = await prisma.fbrInvoiceQueue.update({
      where: { id: existing.id },
      data: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null }
    });
    await prisma.sale.update({ where: { id: saleId }, data: { fbrStatus: 'PENDING' } });
    attemptImmediateFbr(row.id);
    return { ok: true, message: 'Fiscal retry queued', row };
  }
  const row = await enqueueFbrForSale(prisma, saleId);
  if (!row) return { ok: false, message: 'Could not queue the fiscal retry' };
  attemptImmediateFbr(row.id);
  return { ok: true, message: 'Fiscal posting queued', row };
};
