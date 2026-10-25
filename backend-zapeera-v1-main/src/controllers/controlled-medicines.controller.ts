// CRITICAL: Import database initialization FIRST to ensure DATABASE_URL is set
import '../config/database.init';

import { Response } from 'express';
import Joi from 'joi';
import { getPrisma } from '../utils/db.util';
import { AuthRequest, buildBranchWhereClause } from '../middleware/auth.middleware';
import {
  ControlledRegisterError,
  appendControlledReversalEntry,
  summarizeRegisterEntries,
} from '../services/controlled-medicines.service';

// Controlled / narcotics register (Gap item 2) — READ + REVERSAL ONLY.
// There is deliberately NO update / delete handler for log rows in this
// file: the register is append-only and corrections are REVERSAL rows
// (see controlled-medicines.service.ts). Viewing is restricted by the
// router's checkPermission('reports.read') — the reports page is
// OWNER/MANAGER-only in MODULE_HIERARCHY, so cashiers never see the
// register (there is no PHARMACIST role in this codebase; a custom
// pharmacist role can be granted reports.read through role policy).

const resolveCompanyId = (req: AuthRequest): string =>
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  req.membership?.business_id ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const resolveStaffName = (req: AuthRequest): string | null =>
  (req.user as any)?.name || (req.user as any)?.fullName || null;

function parseDateStart(dateLike: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateLike);
  if (m) {
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0);
  }
  return new Date(dateLike);
}

function parseDateEnd(dateLike: string): Date {
  const d = parseDateStart(dateLike);
  d.setHours(23, 59, 59, 999);
  return d;
}

/** Shared filters for every register read: date range + branch/product/batch/staff/type. */
function registerWhere(req: AuthRequest): any {
  const where: any = buildBranchWhereClause(req, {});
  const { startDate, endDate, from, to, branchId, productId, batchId, staffUserId, entryType } =
    req.query as Record<string, string | undefined>;
  if (branchId) where.branchId = branchId;
  if (productId) where.productId = productId;
  if (batchId) where.batchId = batchId;
  if (staffUserId) where.staffUserId = staffUserId;
  if (entryType === 'DISPENSE' || entryType === 'REVERSAL') where.entryType = entryType;
  const start = startDate || from;
  const end = endDate || to;
  if (start || end) {
    where.createdAt = {};
    if (start) where.createdAt.gte = parseDateStart(start);
    if (end) where.createdAt.lte = parseDateEnd(end);
  }
  return where;
}

const entryInclude = {
  product: { select: { id: true, name: true, controlledSchedule: true, isControlled: true } },
  batch: { select: { id: true, batchNo: true, expireDate: true } },
  sale: { select: { id: true, invoiceNumber: true } },
} as const;

function serializeEntry(entry: any): any {
  return {
    ...entry,
    createdAt: entry.createdAt ? new Date(entry.createdAt).toISOString() : null,
  };
}

/**
 * GET / — the register itself: entries (newest first) + per-product/batch
 * running-balance summary over the SAME filter (not just the page).
 */
export const getControlledRegister = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const where = registerWhere(req);
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100));
    const [total, entries, allForSummary] = await Promise.all([
      (prisma as any).controlledDispenseLog.count({ where }),
      (prisma as any).controlledDispenseLog.findMany({
        where,
        include: entryInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      (prisma as any).controlledDispenseLog.findMany({
        where,
        include: { product: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'asc' },
        take: 10000,
      }),
    ]);
    const summary = summarizeRegisterEntries(
      allForSummary.map((e: any) => ({
        id: e.id,
        productId: e.productId,
        productName: e.product?.name || null,
        batchId: e.batchId,
        batchNo: e.batchNo,
        quantity: e.quantity,
        balanceAfter: e.balanceAfter,
        createdAt: e.createdAt,
      }))
    );
    return res.json({
      success: true,
      data: {
        entries: entries.map(serializeEntry),
        summary,
        totals: {
          totalDispensed: summary.reduce((s, g) => s + g.totalDispensed, 0),
          totalReversed: summary.reduce((s, g) => s + g.totalReversed, 0),
          netDispensed: summary.reduce((s, g) => s + g.netDispensed, 0),
          entryCount: total,
        },
        pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      },
    });
  } catch (error: any) {
    console.error('[ControlledRegister] getControlledRegister error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
};

/** GET /:id — one register entry (scoped to the caller's business). */
export const getControlledRegisterEntry = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const entry = await (prisma as any).controlledDispenseLog.findFirst({
      where: { id: req.params.id, companyId: resolveCompanyId(req) },
      include: entryInclude,
    });
    if (!entry) {
      return res.status(404).json({ success: false, message: 'Register entry not found' });
    }
    return res.json({ success: true, data: serializeEntry(entry) });
  } catch (error: any) {
    console.error('[ControlledRegister] getControlledRegisterEntry error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
};

/**
 * GET /audit/staff — dispensing audit by staff member over the same
 * date/branch filters: who dispensed how much, how much was reversed.
 */
export const getControlledStaffAudit = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const where = registerWhere(req);
    const entries = await (prisma as any).controlledDispenseLog.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      take: 10000,
    });
    const byStaff = new Map<string, any>();
    for (const e of entries) {
      const key = e.staffUserId;
      let row = byStaff.get(key);
      if (!row) {
        row = {
          staffUserId: key,
          staffName: e.staffName || null,
          totalDispensed: 0,
          totalReversed: 0,
          netDispensed: 0,
          entryCount: 0,
          dispenseCount: 0,
          reversalCount: 0,
          lastEntryAt: null as string | null,
        };
        byStaff.set(key, row);
      }
      if (e.quantity > 0) {
        row.totalDispensed += e.quantity;
        row.dispenseCount += 1;
      } else {
        row.totalReversed += Math.abs(e.quantity);
        row.reversalCount += 1;
      }
      row.netDispensed = row.totalDispensed - row.totalReversed;
      row.entryCount += 1;
      row.lastEntryAt = new Date(e.createdAt).toISOString();
      if (e.staffName && !row.staffName) row.staffName = e.staffName;
    }
    // Resolve display names for staff ids that never carried a snapshot.
    const nameless = [...byStaff.values()].filter((r) => !r.staffName);
    if (nameless.length > 0) {
      const users = await prisma.zapeeraUser.findMany({
        where: { id: { in: nameless.map((r) => r.staffUserId) } },
        select: { id: true, name: true },
      });
      const nameById = new Map(users.map((u: any) => [u.id, u.name]));
      for (const row of nameless) row.staffName = nameById.get(row.staffUserId) || null;
    }
    const staff = [...byStaff.values()].sort((a, b) => b.netDispensed - a.netDispensed);
    return res.json({
      success: true,
      data: {
        staff,
        totals: {
          totalDispensed: staff.reduce((s, r) => s + r.totalDispensed, 0),
          totalReversed: staff.reduce((s, r) => s + r.totalReversed, 0),
          netDispensed: staff.reduce((s, r) => s + r.netDispensed, 0),
          entryCount: staff.reduce((s, r) => s + r.entryCount, 0),
        },
      },
    });
  } catch (error: any) {
    console.error('[ControlledRegister] getControlledStaffAudit error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
};

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * GET /inspection-pack — the inspector's pack: business + branch
 * identity, period, every entry oldest-first (the register as it
 * reads on paper), per-product/batch balances, and staff totals.
 * ?format=csv downloads the same pack as a CSV file.
 */
export const getInspectionPack = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const where = registerWhere(req);
    const companyId = resolveCompanyId(req);
    const [business, entries] = await Promise.all([
      prisma.business.findUnique({
        where: { id: companyId },
        select: { id: true, name: true },
      }),
      (prisma as any).controlledDispenseLog.findMany({
        where,
        include: entryInclude,
        orderBy: { createdAt: 'asc' },
        take: 10000,
      }),
    ]);
    const branchIds: string[] = [...new Set((entries as any[]).map((e: any) => String(e.branchId)))];
    const branches = branchIds.length
      ? await prisma.branch.findMany({
          where: { id: { in: branchIds } },
          select: { id: true, name: true },
        })
      : [];
    const branchNameById = new Map(branches.map((b: any) => [b.id, b.name]));
    const summary = summarizeRegisterEntries(
      entries.map((e: any) => ({
        id: e.id,
        productId: e.productId,
        productName: e.product?.name || null,
        batchId: e.batchId,
        batchNo: e.batchNo,
        quantity: e.quantity,
        balanceAfter: e.balanceAfter,
        createdAt: e.createdAt,
      }))
    );
    const pack = {
      businessName: (business as any)?.name || null,
      branchNames: branches.map((b: any) => b.name),
      period: {
        from: (req.query.startDate as string) || (req.query.from as string) || null,
        to: (req.query.endDate as string) || (req.query.to as string) || null,
      },
      generatedAt: new Date().toISOString(),
      generatedBy: resolveStaffName(req),
      totals: {
        totalDispensed: summary.reduce((s, g) => s + g.totalDispensed, 0),
        totalReversed: summary.reduce((s, g) => s + g.totalReversed, 0),
        netDispensed: summary.reduce((s, g) => s + g.netDispensed, 0),
        entryCount: entries.length,
      },
      summary,
      entries: entries.map((e: any) => ({
        ...serializeEntry(e),
        branchName: branchNameById.get(e.branchId) || null,
      })),
    };
    if (String(req.query.format || '').toLowerCase() === 'csv') {
      const header = [
        'Date',
        'Type',
        'Product',
        'Schedule',
        'Batch',
        'Qty',
        'Balance After',
        'Staff',
        'Customer',
        'Prescription Ref',
        'Invoice',
        'Reverses Entry',
        'Reason',
      ];
      const lines = [header.map(csvEscape).join(',')];
      for (const e of pack.entries) {
        lines.push(
          [
            new Date(e.createdAt).toISOString(),
            e.entryType,
            e.product?.name || '',
            e.product?.controlledSchedule || '',
            e.batchNo || '',
            e.quantity,
            e.balanceAfter,
            e.staffName || e.staffUserId,
            e.customerName || '',
            e.prescriptionRef || '',
            e.invoiceNumber || '',
            e.reversesId || '',
            e.reason || '',
          ]
            .map(csvEscape)
            .join(',')
        );
      }
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="controlled-register-${stamp}.csv"`
      );
      return res.send(lines.join('\n'));
    }
    return res.json({ success: true, data: pack });
  } catch (error: any) {
    console.error('[ControlledRegister] getInspectionPack error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
}

// ─── Reversal ─────────────────────────────────────────────────────────────

const createReversalSchema = Joi.object({
  originalEntryId: Joi.string().required(),
  quantity: Joi.number().integer().min(1).required(),
  reason: Joi.string().trim().min(1).max(500).required(),
});

/**
 * POST /reversals — append a REVERSAL entry against a DISPENSE entry.
 * The original row is never touched; the reversal is a new row with a
 * negative quantity. The reversing staff member is the caller.
 */
export const createControlledReversal = async (req: AuthRequest, res: Response) => {
  try {
    const { error } = createReversalSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map((d) => d.message),
      });
    }
    const prisma = await getPrisma();
    const companyId = resolveCompanyId(req);
    const userId = (req as any).user.id;
    const staffName = resolveStaffName(req);
    try {
      const reversal = await prisma.$transaction(async (tx: any) => {
        const original = await tx.controlledDispenseLog.findUnique({
          where: { id: req.body.originalEntryId },
          select: { id: true, companyId: true, branchId: true },
        });
        if (!original || original.companyId !== companyId) {
          throw new ControlledRegisterError(404, 'Original dispense entry not found in this business');
        }
        return appendControlledReversalEntry(tx, {
          companyId,
          branchId: original.branchId,
          originalEntryId: req.body.originalEntryId,
          quantity: req.body.quantity,
          reason: req.body.reason,
          staffUserId: userId,
          staffName,
        });
      });
      return res.status(201).json({ success: true, data: serializeEntry(reversal) });
    } catch (txError: any) {
      if (txError instanceof ControlledRegisterError) {
        return res
          .status(txError.statusCode)
          .json({ success: false, message: txError.message });
      }
      throw txError;
    }
  } catch (error: any) {
    console.error('[ControlledRegister] createControlledReversal error:', error);
    return res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
};
