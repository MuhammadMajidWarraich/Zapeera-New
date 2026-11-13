import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import Joi from 'joi';
import { AuthRequest } from '../middleware/auth.middleware';
import { logAuditEvent } from '../services/audit-log.service';
import { round2 } from '../utils/quotation.util';

// ─── Wastage / damage recording (v1.0.22) ────────────────────────────
// A write-off event against ONE batch: the batch quantity is
// decremented AND a WASTAGE StockMovement is written in the SAME
// transaction (the stock-take completion precedent), so inventory
// stays consistent and the stock-movement history shows the
// write-off. Rows are append-only: corrections are new rows, never
// edits. `quantity` is base units; `unitCost` snapshots the batch
// purchase price at recording time so the report values the loss
// without re-reading batch history.
//
// A batch is REQUIRED: stock lives in batches, and a write-off that
// cannot say which batch it came from cannot keep the batch ledger
// truthful. The record's batchId stays nullable in the schema for
// forward compatibility (a future FEFO-spanning write-off), but this
// API version requires it.

const resolveWastageCompanyId = (req: AuthRequest): string =>
  req.membership?.business_id ||
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const WASTAGE_REASONS = ['DAMAGED', 'EXPIRED', 'SPOILAGE', 'THEFT', 'OTHER'] as const;

const recordWastageSchema = Joi.object({
  branchId: Joi.string().required(),
  productId: Joi.string().required(),
  batchId: Joi.string().required(),
  quantity: Joi.number().integer().min(1).required(),
  reason: Joi.string().valid(...WASTAGE_REASONS).required(),
  reasonNote: Joi.string().trim().max(500).allow('', null).optional(),
});

const wastageInclude = {
  product: { select: { id: true, name: true, sku: true } },
  batch: { select: { id: true, batchNo: true, expireDate: true } },
  branch: { select: { id: true, name: true } },
  recorder: { select: { id: true, name: true } },
} as const;

// ─── POST /wastage ───────────────────────────────────────────────────

export const recordWastage = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = recordWastageSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: 'Validation error', errors: error.details.map((d) => d.message) });
    }
    const companyId = resolveWastageCompanyId(req);
    const branch = await prisma.branch.findFirst({ where: { id: value.branchId, companyId }, select: { id: true } });
    if (!branch) return res.status(400).json({ success: false, message: 'Branch was not found in this business' });
    const batch = await prisma.batch.findFirst({
      where: { id: value.batchId, companyId, branchId: value.branchId, productId: value.productId },
      select: { id: true, quantity: true, purchasePrice: true, batchNo: true },
    });
    if (!batch) {
      return res.status(400).json({ success: false, message: 'Batch was not found for this product and branch' });
    }
    if (batch.quantity < value.quantity) {
      return res.status(400).json({
        success: false,
        message: `Batch ${batch.batchNo} holds only ${batch.quantity} units — cannot write off ${value.quantity}`,
        code: 'WASTAGE_INSUFFICIENT_STOCK',
      });
    }

    const createdBy = req.user?.id || null;
    const record = await prisma.$transaction(async (tx: any) => {
      // Atomic guard: the decrement applies only when the batch still
      // holds enough (a concurrent sale cannot drive it negative).
      const decremented = await tx.batch.updateMany({
        where: { id: batch.id, companyId, quantity: { gte: value.quantity } },
        data: { quantity: { decrement: value.quantity } },
      });
      if (decremented.count !== 1) {
        throw Object.assign(new Error('Batch stock changed while recording — please retry'), { statusCode: 409 });
      }
      const created = await tx.wastageRecord.create({
        data: {
          companyId,
          branchId: value.branchId,
          productId: value.productId,
          batchId: value.batchId,
          quantity: value.quantity,
          reason: value.reason,
          reasonNote: value.reasonNote || null,
          unitCost: batch.purchasePrice ?? null,
          recordedBy: createdBy,
        },
      });
      const movement = await tx.stockMovement.create({
        data: {
          productId: value.productId,
          type: 'WASTAGE',
          quantity: value.quantity,
          reason: `Wastage (${value.reason})${value.reasonNote ? ` — ${value.reasonNote}` : ''} — batch ${batch.batchNo}`,
          reference: created.id,
          createdBy: createdBy || 'system',
        },
      });
      return tx.wastageRecord.update({
        where: { id: created.id },
        data: { stockMovementId: movement.id },
        include: wastageInclude,
      });
    });

    void logAuditEvent({
      companyId,
      branchId: value.branchId,
      userId: createdBy,
      userName: (req.user as any)?.name || null,
      action: 'WASTAGE_RECORD',
      entityType: 'WastageRecord',
      entityId: record.id,
      description: `Wrote off ${value.quantity} units (${value.reason}) — batch ${batch.batchNo}`,
      metadata: { wastageRecordId: record.id, productId: value.productId, batchId: value.batchId, quantity: value.quantity, reason: value.reason },
    });

    return res.status(201).json({ success: true, data: record });
  } catch (error: any) {
    console.error('Record wastage error:', error);
    return res.status(error?.statusCode || 500).json({ success: false, message: error?.message || 'Internal server error' });
  }
};

// ─── GET /wastage ────────────────────────────────────────────────────

// A bare YYYY-MM-DD `to` means the whole day, not its first instant:
// date pickers send bare dates, and `lte: new Date("2026-11-14")` is
// midnight at the START of the 14th, which would drop that day's rows.
// Full datetimes pass through unchanged.
const endOfDayOrAsIs = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T23:59:59.999`) : new Date(v);

export const getWastageRecords = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveWastageCompanyId(req);
    const { branchId, productId, reason, from, to } = req.query as any;
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '25'), 10) || 25));

    const where: any = { companyId };
    if (branchId) where.branchId = branchId;
    if (productId) where.productId = productId;
    if (reason && (WASTAGE_REASONS as readonly string[]).includes(reason)) where.reason = reason;
    if (from || to) {
      where.recordedAt = {};
      if (from) where.recordedAt.gte = new Date(from);
      if (to) where.recordedAt.lte = endOfDayOrAsIs(to);
    }

    const [rows, total] = await Promise.all([
      prisma.wastageRecord.findMany({ where, include: wastageInclude, orderBy: { recordedAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.wastageRecord.count({ where }),
    ]);
    return res.json({ success: true, data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (error: any) {
    console.error('Get wastage records error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── GET /wastage/report ─────────────────────────────────────────────
// Totals + breakdowns by product, by reason and by day. Value uses
// the snapshotted unitCost (the loss at write-off cost), never a
// re-read selling price.

export const getWastageReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveWastageCompanyId(req);
    const { branchId, from, to } = req.query as any;

    const where: any = { companyId };
    if (branchId) where.branchId = branchId;
    if (from || to) {
      where.recordedAt = {};
      if (from) where.recordedAt.gte = new Date(from);
      if (to) where.recordedAt.lte = endOfDayOrAsIs(to);
    }

    const rows = await prisma.wastageRecord.findMany({
      where,
      select: {
        quantity: true,
        unitCost: true,
        reason: true,
        recordedAt: true,
        product: { select: { id: true, name: true, sku: true } },
      },
      orderBy: { recordedAt: 'asc' },
    });

    const byProduct = new Map<string, { productId: string; productName: string; sku: string | null; quantity: number; value: number; events: number }>();
    const byReason = new Map<string, { reason: string; quantity: number; value: number; events: number }>();
    const byDay = new Map<string, { date: string; quantity: number; value: number; events: number }>();
    let totalQuantity = 0;
    let totalValue = 0;
    for (const r of rows as any[]) {
      const value = round2((Number(r.quantity) || 0) * (Number(r.unitCost) || 0));
      totalQuantity += Number(r.quantity) || 0;
      totalValue = round2(totalValue + value);

      const p = byProduct.get(r.product.id) || { productId: r.product.id, productName: r.product.name, sku: r.product.sku || null, quantity: 0, value: 0, events: 0 };
      p.quantity += Number(r.quantity) || 0;
      p.value = round2(p.value + value);
      p.events += 1;
      byProduct.set(r.product.id, p);

      const rs = byReason.get(r.reason) || { reason: r.reason, quantity: 0, value: 0, events: 0 };
      rs.quantity += Number(r.quantity) || 0;
      rs.value = round2(rs.value + value);
      rs.events += 1;
      byReason.set(r.reason, rs);

      const day = new Date(r.recordedAt).toISOString().slice(0, 10);
      const d = byDay.get(day) || { date: day, quantity: 0, value: 0, events: 0 };
      d.quantity += Number(r.quantity) || 0;
      d.value = round2(d.value + value);
      d.events += 1;
      byDay.set(day, d);
    }

    return res.json({
      success: true,
      data: {
        totals: { quantity: totalQuantity, value: round2(totalValue), events: rows.length },
        byProduct: [...byProduct.values()].sort((a, b) => b.value - a.value),
        byReason: [...byReason.values()].sort((a, b) => b.value - a.value),
        byDay: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
      },
    });
  } catch (error: any) {
    console.error('Get wastage report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
