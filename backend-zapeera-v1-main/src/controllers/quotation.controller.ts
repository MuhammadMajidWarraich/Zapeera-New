import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import Joi from 'joi';
import { AuthRequest } from '../middleware/auth.middleware';
import { createSale, SALE_PAYMENT_METHODS } from './sale.controller';
import { computeSaleTax } from '../utils/tax.util';
import { resolveSaleLineUnits } from '../utils/unit.util';
import { computeQuotationTotals, round2 } from '../utils/quotation.util';
import { logAuditEvent } from '../services/audit-log.service';

// ─── Quotations / estimates (v1.0.22) ─────────────────────────────────
// A price offer to a customer. Quotations NEVER touch stock: no batch
// reservation, no movement rows. Conversion replays the quotation
// through the REAL createSale handler (the appointment/kiosk/store
// precedent — this request is lent to createSale with the body
// swapped), so totals, FEFO, tax, promotions, invoice numbering and
// the FBR queue are exactly the POS's. There is deliberately no
// parallel sale logic here.
//
// Totals are computed server-side on every write (the sale rule — a
// client-sent total is never trusted). Tax uses the same tax engine
// as createSale over the same post-discount base, so the offered
// price matches what the converted sale will charge; the converted
// sale recomputes tax itself and is the authority.
//
// Status: DRAFT | SENT | ACCEPTED | REJECTED | EXPIRED | CONVERTED.
// Expiry is evaluated on READ against validUntil (no background
// job): a DRAFT/SENT quotation past validUntil reads as EXPIRED and
// cannot convert. No plan/add-on gate.

const resolveQuotationCompanyId = (req: AuthRequest): string =>
  req.membership?.business_id ||
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const QUOTATION_STATUSES = ['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED'] as const;

const quotationLineSchema = Joi.object({
  productId: Joi.string().required(),
  // Level quantity as entered (packs/strips/units); may be fractional
  // when a unitLevel is present (0.5 pack), whole base units when not.
  quantity: Joi.number().positive().required(),
  unitLevel: Joi.string().valid('PACK', 'STRIP', 'UNIT', 'pack', 'strip', 'unit').optional(),
  unitPrice: Joi.number().positive().required(),
  discountAmount: Joi.number().min(0).optional(),
  variantId: Joi.string().allow(null, '').optional(),
});

const upsertQuotationSchema = Joi.object({
  branchId: Joi.string().required(),
  customerId: Joi.string().allow(null, '').optional(),
  validUntil: Joi.date().allow(null).optional(),
  notes: Joi.string().trim().max(1000).allow('', null).optional(),
  discountPercentage: Joi.number().min(0).max(100).optional(),
  discountAmount: Joi.number().min(0).optional(),
  lines: Joi.array().items(quotationLineSchema).min(1).required(),
});

const convertQuotationSchema = Joi.object({
  paymentMethod: Joi.string().valid(...SALE_PAYMENT_METHODS).required(),
  paidAmount: Joi.number().min(0).default(0),
  payments: Joi.array().items(
    Joi.object({
      method: Joi.string().valid(...SALE_PAYMENT_METHODS).required(),
      amount: Joi.number().positive().required(),
      reference: Joi.string().allow('', null).max(120).optional(),
    })
  ).optional(),
  salespersonId: Joi.string().allow(null, '').optional(),
  saleDate: Joi.date().optional(),
});

/** Effective status: a live quotation past its validity reads EXPIRED. */
export function effectiveQuotationStatus(q: { status: string; validUntil: Date | string | null }): string {
  if ((q.status === 'DRAFT' || q.status === 'SENT') && q.validUntil && new Date(q.validUntil).getTime() < Date.now()) {
    return 'EXPIRED';
  }
  return q.status;
}

const quotationInclude = {
  lines: {
    include: {
      product: { select: { id: true, name: true, sku: true, barcode: true } },
      variant: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  },
  customer: { select: { id: true, name: true, phone: true, email: true } },
  branch: { select: { id: true, name: true } },
} as const;

function presentQuotation(q: any) {
  return { ...q, status: effectiveQuotationStatus(q) };
}

// Quotation numbers mirror the invoice-number pattern (sale.controller):
// QT-##### advancing past the highest suffix in use, with a P2002
// retry in the caller. Quotations are cloud-created only (no
// device-band slots), so the scan is global, like invoices.
async function generateUniqueQuotationNumber(tx: any, attempt = 0): Promise<string> {
  if (attempt > 10) {
    return `QT-${Date.now().toString().slice(-8)}`;
  }
  const all = await tx.quotation.findMany({ select: { quotationNumber: true } });
  let maxSuffix = 0;
  for (const q of all) {
    const m = q.quotationNumber ? String(q.quotationNumber).match(/^QT-(\d{5})$/) : null;
    if (m) maxSuffix = Math.max(maxSuffix, parseInt(m[1], 10));
  }
  const suffix = ((maxSuffix + attempt) % 99999) + 1;
  const quotationNumber = `QT-${String(suffix).padStart(5, '0')}`;
  const existing = await tx.quotation.findUnique({ where: { quotationNumber }, select: { id: true } });
  if (existing) return generateUniqueQuotationNumber(tx, attempt + 1);
  return quotationNumber;
}

interface ResolvedQuotationLine {
  productId: string;
  variantId: string | null;
  variantName: string | null;
  quantity: number; // base units
  unitLevel: string | null;
  unitFactor: number | null;
  unitPrice: number;
  discountAmount: number;
  totalPrice: number;
  taxAmount: number;
  taxClassId: string | null;
  levelQuantity: number;
}

async function resolveQuotationLines(
  prisma: any,
  companyId: string,
  rawLines: any[],
  headerDiscountPercentage: number,
  headerDiscountAmount: number
): Promise<{ lines: ResolvedQuotationLine[]; totals: { subtotal: number; discountAmount: number; taxAmount: number; totalAmount: number } }> {
  const productIds = [...new Set(rawLines.map((l) => l.productId))];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, companyId },
    select: { id: true, name: true, unitsPerPack: true, unitsPerStrip: true, unitType: true, taxClassId: true },
  });
  const productById = new Map<string, any>(products.map((p: any) => [p.id, p]));
  for (const id of productIds) {
    if (!productById.has(id as string)) {
      throw Object.assign(new Error(`Product ${id} was not found in this business`), { statusCode: 400 });
    }
  }

  const variantIds = [...new Set(rawLines.map((l) => l.variantId).filter(Boolean))];
  const variants = variantIds.length
    ? await prisma.productVariant.findMany({ where: { id: { in: variantIds }, companyId }, select: { id: true, productId: true, name: true, isActive: true } })
    : [];
  const variantById = new Map<string, any>(variants.map((v: any) => [v.id, v]));

  // Tax engine inputs (same as createSale): company tax classes; the
  // defaultTax rate is resolved from the owner's settings below.
  const companyTaxClasses = await prisma.taxClass.findMany({ where: { companyId } });

  const resolved: ResolvedQuotationLine[] = [];
  for (const raw of rawLines) {
    const product = productById.get(raw.productId);
    let variant: any = null;
    if (raw.variantId) {
      variant = variantById.get(raw.variantId);
      if (!variant || variant.productId !== raw.productId || variant.isActive === false) {
        throw Object.assign(new Error(`Variant ${raw.variantId} is not an active variant of ${product.name}`), { statusCode: 400 });
      }
    }
    let baseQty: number;
    let factor: number | null = null;
    let level: string | null = null;
    if (raw.unitLevel) {
      const r = resolveSaleLineUnits(
        { quantity: Number(raw.quantity), unitLevel: raw.unitLevel },
        { unitsPerPack: product.unitsPerPack, unitsPerStrip: product.unitsPerStrip, unitType: product.unitType },
        product.name
      );
      if ('error' in r) throw Object.assign(new Error(r.error), { statusCode: 400 });
      baseQty = r.baseQty;
      factor = r.factor;
      level = r.level;
    } else {
      // Historical rule: whole base units, no level.
      if (!Number.isInteger(Number(raw.quantity)) || Number(raw.quantity) < 1) {
        throw Object.assign(new Error(`Quantity for ${product.name} must be a whole number of units without a selling level`), { statusCode: 400 });
      }
      baseQty = Number(raw.quantity);
    }
    const levelQuantity = factor ? baseQty / factor : baseQty;
    const gross = levelQuantity * Number(raw.unitPrice);
    const lineDiscount = Math.min(Math.max(0, Number(raw.discountAmount) || 0), gross);
    resolved.push({
      productId: raw.productId,
      variantId: variant ? variant.id : null,
      variantName: variant ? variant.name : null,
      quantity: baseQty,
      unitLevel: level,
      unitFactor: factor,
      unitPrice: Number(raw.unitPrice),
      discountAmount: round2(lineDiscount),
      totalPrice: round2(gross - lineDiscount),
      taxAmount: 0,
      taxClassId: product.taxClassId || null,
      levelQuantity,
    });
  }

  const totals = computeQuotationTotals({
    lines: resolved.map((l) => ({ quantity: l.quantity, unitFactor: l.unitFactor, unitPrice: l.unitPrice, discountAmount: l.discountAmount })),
    discountPercentage: headerDiscountPercentage,
    discountAmount: headerDiscountAmount,
    taxAmount: 0,
  });

  // Tax via the sale tax engine over the post-discount base. The
  // defaultTax rate comes from the business owner's settings — the
  // same lookup createSale performs (currentAdminId = the owner's
  // user id). When no rate is configured the engine still runs (rate
  // 0) so classed lines keep their class rates.
  let taxAmount = 0;
  try {
    const ownerRow = await prisma.business.findUnique({ where: { id: companyId }, select: { createdBy: true } });
    let settingRate = 0;
    if (ownerRow?.createdBy) {
      const s = await prisma.settings.findUnique({
        where: { createdBy_key: { createdBy: ownerRow.createdBy, key: 'defaultTax' } },
      });
      if (s) settingRate = parseFloat(s.value) || 0;
    }
    const taxResult = computeSaleTax({
      lines: resolved.map((l) => ({ lineTotal: l.totalPrice, taxClassId: l.taxClassId })),
      classes: companyTaxClasses,
      defaultTaxRate: settingRate,
      subtotal: totals.subtotal,
      taxableBase: totals.subtotal - totals.discountAmount,
    });
    taxAmount = taxResult.taxAmount;
  } catch (taxError) {
    console.warn('Could not compute quotation tax, using 0:', taxError);
    taxAmount = 0;
  }

  // Allocate the engine total across lines pro-rata (remainder to the
  // last line) so Σ line tax equals the header tax exactly.
  let allocated = 0;
  resolved.forEach((l, idx) => {
    if (idx === resolved.length - 1) {
      l.taxAmount = round2(taxAmount - allocated);
    } else {
      l.taxAmount = totals.subtotal > 0 ? round2((taxAmount * l.totalPrice) / totals.subtotal) : 0;
      allocated = round2(allocated + l.taxAmount);
    }
  });

  return {
    lines: resolved,
    totals: { ...totals, taxAmount: round2(taxAmount), totalAmount: round2(totals.subtotal - totals.discountAmount + taxAmount) },
  };
}

async function requireQuotation(prisma: any, companyId: string, id: string) {
  const q = await prisma.quotation.findFirst({ where: { id, companyId }, include: quotationInclude });
  return q;
}

// ─── POST /quotations ────────────────────────────────────────────────

export const createQuotation = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = upsertQuotationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: 'Validation error', errors: error.details.map((d) => d.message) });
    }
    const companyId = resolveQuotationCompanyId(req);
    const branch = await prisma.branch.findFirst({ where: { id: value.branchId, companyId }, select: { id: true } });
    if (!branch) return res.status(400).json({ success: false, message: 'Branch was not found in this business' });
    if (value.customerId) {
      const customer = await prisma.customer.findFirst({ where: { id: value.customerId, companyId }, select: { id: true } });
      if (!customer) return res.status(400).json({ success: false, message: 'Customer was not found in this business' });
    }

    const { lines, totals } = await resolveQuotationLines(
      prisma,
      companyId,
      value.lines,
      value.discountPercentage || 0,
      value.discountAmount || 0
    );

    const quotation = await prisma.$transaction(async (tx: any) => {
      const quotationNumber = await generateUniqueQuotationNumber(tx);
      return tx.quotation.create({
        data: {
          quotationNumber,
          companyId,
          branchId: value.branchId,
          customerId: value.customerId || null,
          userId: req.user?.id,
          status: 'DRAFT',
          validUntil: value.validUntil ? new Date(value.validUntil) : null,
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          discountPercentage: value.discountPercentage || 0,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          notes: value.notes || null,
          lines: {
            create: lines.map((l) => ({
              productId: l.productId,
              variantId: l.variantId,
              variantName: l.variantName,
              quantity: l.quantity,
              unitLevel: l.unitLevel,
              unitFactor: l.unitFactor,
              unitPrice: l.unitPrice,
              discountAmount: l.discountAmount,
              taxAmount: l.taxAmount,
              totalPrice: l.totalPrice,
            })),
          },
        },
        include: quotationInclude,
      });
    });

    return res.status(201).json({ success: true, data: presentQuotation(quotation) });
  } catch (error: any) {
    console.error('Create quotation error:', error);
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Internal server error' });
  }
};

// ─── GET /quotations ─────────────────────────────────────────────────

export const getQuotations = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveQuotationCompanyId(req);
    const { branchId, customerId, status, search, from, to } = req.query as any;
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '25'), 10) || 25));

    const where: any = { companyId };
    if (branchId) where.branchId = branchId;
    if (customerId) where.customerId = customerId;
    if (status && (QUOTATION_STATUSES as readonly string[]).includes(status)) where.status = status;
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    if (search) {
      where.OR = [
        { quotationNumber: { contains: String(search), mode: 'insensitive' } },
        { customer: { name: { contains: String(search), mode: 'insensitive' } } },
        { notes: { contains: String(search), mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.quotation.findMany({ where, include: quotationInclude, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.quotation.count({ where }),
    ]);
    // A status=EXPIRED filter must also match live rows past validity.
    let presented = (rows as any[]).map(presentQuotation);
    if (status === 'EXPIRED') {
      presented = presented.filter((q) => q.status === 'EXPIRED');
    }
    return res.json({ success: true, data: presented, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error: any) {
    console.error('Get quotations error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── GET /quotations/:id ─────────────────────────────────────────────

export const getQuotation = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const q = await requireQuotation(prisma, resolveQuotationCompanyId(req), req.params.id);
    if (!q) return res.status(404).json({ success: false, message: 'Quotation not found' });
    return res.json({ success: true, data: presentQuotation(q) });
  } catch (error: any) {
    console.error('Get quotation error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── PUT /quotations/:id ─────────────────────────────────────────────
// Only DRAFT/SENT quotations are editable; lines are replaced
// wholesale and totals recomputed. CONVERTED quotations are final.

export const updateQuotation = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = upsertQuotationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: 'Validation error', errors: error.details.map((d) => d.message) });
    }
    const companyId = resolveQuotationCompanyId(req);
    const existing = await requireQuotation(prisma, companyId, req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: 'Quotation not found' });
    if (!['DRAFT', 'SENT'].includes(effectiveQuotationStatus(existing))) {
      return res.status(409).json({ success: false, message: `A ${effectiveQuotationStatus(existing)} quotation cannot be edited`, code: 'QUOTATION_NOT_EDITABLE' });
    }
    const branch = await prisma.branch.findFirst({ where: { id: value.branchId, companyId }, select: { id: true } });
    if (!branch) return res.status(400).json({ success: false, message: 'Branch was not found in this business' });
    if (value.customerId) {
      const customer = await prisma.customer.findFirst({ where: { id: value.customerId, companyId }, select: { id: true } });
      if (!customer) return res.status(400).json({ success: false, message: 'Customer was not found in this business' });
    }

    const { lines, totals } = await resolveQuotationLines(prisma, companyId, value.lines, value.discountPercentage || 0, value.discountAmount || 0);

    const updated = await prisma.$transaction(async (tx: any) => {
      await tx.quotationLine.deleteMany({ where: { quotationId: existing.id } });
      return tx.quotation.update({
        where: { id: existing.id },
        data: {
          branchId: value.branchId,
          customerId: value.customerId || null,
          validUntil: value.validUntil ? new Date(value.validUntil) : null,
          notes: value.notes || null,
          subtotal: totals.subtotal,
          discountAmount: totals.discountAmount,
          discountPercentage: value.discountPercentage || 0,
          taxAmount: totals.taxAmount,
          totalAmount: totals.totalAmount,
          lines: {
            create: lines.map((l) => ({
              productId: l.productId,
              variantId: l.variantId,
              variantName: l.variantName,
              quantity: l.quantity,
              unitLevel: l.unitLevel,
              unitFactor: l.unitFactor,
              unitPrice: l.unitPrice,
              discountAmount: l.discountAmount,
              taxAmount: l.taxAmount,
              totalPrice: l.totalPrice,
            })),
          },
        },
        include: quotationInclude,
      });
    });

    return res.json({ success: true, data: presentQuotation(updated) });
  } catch (error: any) {
    console.error('Update quotation error:', error);
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Internal server error' });
  }
};

// ─── DELETE /quotations/:id ──────────────────────────────────────────

export const deleteQuotation = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveQuotationCompanyId(req);
    const existing = await prisma.quotation.findFirst({ where: { id: req.params.id, companyId }, select: { id: true, status: true, validUntil: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Quotation not found' });
    if (existing.status === 'CONVERTED') {
      return res.status(409).json({ success: false, message: 'A converted quotation cannot be deleted', code: 'QUOTATION_CONVERTED' });
    }
    await prisma.quotation.delete({ where: { id: existing.id } });
    return res.json({ success: true, message: 'Quotation deleted' });
  } catch (error: any) {
    console.error('Delete quotation error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── Status transitions ──────────────────────────────────────────────

async function transitionQuotation(req: AuthRequest, res: Response, from: string[], to: string, extra: Record<string, any> = {}) {
  const prisma = await getPrisma();
  const companyId = resolveQuotationCompanyId(req);
  const existing = await prisma.quotation.findFirst({ where: { id: req.params.id, companyId }, select: { id: true, status: true, validUntil: true } });
  if (!existing) return res.status(404).json({ success: false, message: 'Quotation not found' });
  const current = effectiveQuotationStatus(existing);
  if (!from.includes(current)) {
    return res.status(409).json({ success: false, message: `A ${current} quotation cannot move to ${to}`, code: 'QUOTATION_BAD_TRANSITION' });
  }
  const updated = await prisma.quotation.update({ where: { id: existing.id }, data: { status: to, ...extra }, include: quotationInclude });
  return res.json({ success: true, data: presentQuotation(updated) });
}

export const markQuotationSent = async (req: AuthRequest, res: Response) => {
  try {
    return await transitionQuotation(req, res, ['DRAFT'], 'SENT', { sentAt: new Date() });
  } catch (error: any) {
    console.error('Mark quotation sent error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const acceptQuotation = async (req: AuthRequest, res: Response) => {
  try {
    return await transitionQuotation(req, res, ['DRAFT', 'SENT'], 'ACCEPTED');
  } catch (error: any) {
    console.error('Accept quotation error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const rejectQuotation = async (req: AuthRequest, res: Response) => {
  try {
    return await transitionQuotation(req, res, ['DRAFT', 'SENT'], 'REJECTED');
  } catch (error: any) {
    console.error('Reject quotation error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const expireQuotation = async (req: AuthRequest, res: Response) => {
  try {
    return await transitionQuotation(req, res, ['DRAFT', 'SENT'], 'EXPIRED');
  } catch (error: any) {
    console.error('Expire quotation error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── POST /quotations/:id/convert ────────────────────────────────────
// Replay the quotation through createSale (the appointment
// precedent): this request is lent to createSale with the body
// swapped for the sale payload, the branch pinned, and both restored
// afterwards. The sale is the authority on totals/tax/stock; the
// quotation only supplies the cart + header discount + customer.

export const convertQuotation = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = convertQuotationSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: 'Validation error', errors: error.details.map((d) => d.message) });
    }
    const companyId = resolveQuotationCompanyId(req);
    const quotation = await requireQuotation(prisma, companyId, req.params.id);
    if (!quotation) return res.status(404).json({ success: false, message: 'Quotation not found' });
    const current = effectiveQuotationStatus(quotation);
    if (current === 'CONVERTED') {
      return res.status(409).json({ success: false, message: 'This quotation has already been converted', code: 'QUOTATION_ALREADY_CONVERTED' });
    }
    if (!['DRAFT', 'SENT', 'ACCEPTED'].includes(current)) {
      return res.status(409).json({ success: false, message: `A ${current} quotation cannot be converted`, code: 'QUOTATION_NOT_CONVERTIBLE' });
    }
    if (!quotation.lines || quotation.lines.length === 0) {
      return res.status(400).json({ success: false, message: 'This quotation has no lines to convert' });
    }

    const payload: any = {
      customerId: quotation.customerId || null,
      branchId: quotation.branchId,
      items: quotation.lines.map((l: any) => ({
        productId: l.productId,
        // Level representation: createSale re-resolves factors itself.
        quantity: l.unitFactor ? l.quantity / l.unitFactor : l.quantity,
        ...(l.unitLevel ? { unitLevel: l.unitLevel } : {}),
        unitPrice: l.unitPrice,
        discountAmount: l.discountAmount || 0,
        ...(l.variantId ? { variantId: l.variantId } : {}),
      })),
      paymentMethod: value.paymentMethod,
      paidAmount: value.paidAmount || 0,
      ...(value.payments ? { payments: value.payments } : {}),
      discountAmount: quotation.discountAmount || 0,
      discountPercentage: quotation.discountPercentage || 0,
      ...(value.salespersonId ? { salespersonId: value.salespersonId } : {}),
      ...(value.saleDate ? { saleDate: value.saleDate } : {}),
      channel: 'POS',
    };

    const originalBody = (req as any).body;
    const originalUser = (req as any).user;
    let status = 500;
    let body: any = null;
    const captureRes: any = {
      status(code: number) { status = code; return this; },
      json(responseBody: any) { body = responseBody; return this; },
    };
    try {
      (req as any).body = payload;
      if (originalUser) {
        (req as any).user = { ...originalUser, selectedCompanyId: companyId, selectedBranchId: quotation.branchId };
      }
      await createSale(req as any, captureRes);
    } finally {
      (req as any).body = originalBody;
      (req as any).user = originalUser;
    }

    if (status >= 400 || !body?.success) {
      return res.status(status >= 400 ? status : 400).json(body || { success: false, message: 'Sale creation failed during conversion' });
    }

    const saleId = body?.data?.id || body?.data?.sale?.id || null;
    let markWarning: string | null = null;
    try {
      await prisma.quotation.update({
        where: { id: quotation.id },
        data: { status: 'CONVERTED', convertedSaleId: saleId },
      });
    } catch (markError: any) {
      // The sale already exists — never report failure (a retry would
      // duplicate the sale). Surface the marking failure as a warning.
      console.error('Quotation convert: sale created but quotation could not be marked CONVERTED:', markError);
      markWarning = 'The sale was created but the quotation could not be marked as converted — please check the quotation list.';
    }

    void logAuditEvent({
      companyId,
      branchId: quotation.branchId,
      userId: req.user?.id || null,
      userName: (req.user as any)?.name || null,
      action: 'QUOTATION_CONVERT',
      entityType: 'Quotation',
      entityId: quotation.id,
      description: `Quotation ${quotation.quotationNumber} converted to sale${saleId ? ` ${saleId}` : ''}`,
      metadata: { quotationId: quotation.id, quotationNumber: quotation.quotationNumber, saleId },
    });

    const updated = await requireQuotation(prisma, companyId, quotation.id);
    return res.status(201).json({
      success: true,
      data: { quotation: updated ? presentQuotation(updated) : null, sale: body.data },
      ...(markWarning ? { warning: markWarning } : {}),
    });
  } catch (error: any) {
    console.error('Convert quotation error:', error);
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Internal server error' });
  }
};
