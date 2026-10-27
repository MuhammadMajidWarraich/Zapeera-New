import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { buildBranchWhereClause, getUserRole } from '../middleware/auth.middleware';
import { syncAfterOperation, pullLatestFromLive } from '../utils/sync-helper';
import { createNotification } from './notification.controller';
import Joi from 'joi';
import logger from '../utils/logger';

const startShiftSchema = Joi.object({
  staffProfileId: Joi.string().required(),
  branchId: Joi.string().required(),
  shiftDate: Joi.date().required(),
  startTime: Joi.date().required(),
  openingBalance: Joi.number().min(0).default(0),
  notes: Joi.string().optional()
});

const endShiftSchema = Joi.object({
  shiftId: Joi.string().required(),
  endTime: Joi.date().required(),
  actualBalance: Joi.number().min(0).required(),
  notes: Joi.string().optional()
});

const updateShiftSchema = Joi.object({
  cashIn: Joi.number().min(0).optional(),
  cashOut: Joi.number().min(0).optional(),
  notes: Joi.string().optional()
});

const staffInclude = {
  staffProfile: {
    include: {
      membership: {
        include: {
          user: { select: { id: true, name: true, email: true } }
        }
      }
    }
  },
  branch: { select: { id: true, name: true } }
};

// ── Shift gaps fix (2026-10-27, B1/B4/B6) ─────────────────────────────
// B1: a cashier opens/closes/updates ONLY their own shift. Manager /
// owner / admin (privileged roles) may act for any staff member of the
// business. Ownership is resolved from the caller's membership — never
// from a client-sent id.
// B4: a shift is STALE when its shiftDate is a previous calendar day,
// or its startTime is more than 24h old. Stale shifts are FLAGGED, not
// auto-closed: auto-closing would invent a counted balance. The flag
// rides on getActiveShift so the POS dialog can warn + offer Close.
// B6: the route param is :staffId (shift.routes.ts) — the controller
// used to read req.params.staffProfileId (undefined), so every lookup
// returned the business's FIRST active shift, whoever asked.
const SHIFT_PRIVILEGED_ROLES = new Set(['OWNER', 'ADMIN', 'MANAGER', 'SUPERADMIN']);

function isShiftPrivileged(req: Request): boolean {
  return SHIFT_PRIVILEGED_ROLES.has(getUserRole(req as any));
}

async function resolveCallerStaffProfileId(prisma: any, req: Request): Promise<string | null> {
  const userId = (req as any).user?.id;
  const companyId = buildBranchWhereClause(req as any, {}).companyId;
  if (!userId || !companyId) return null;
  const membership = await prisma.membership.findFirst({
    where: { userId, businessId: companyId },
    select: { id: true }
  });
  if (!membership) return null;
  const profile = await prisma.staffProfile.findFirst({
    where: { membershipId: membership.id },
    select: { id: true }
  });
  return profile?.id ?? null;
}

function isShiftStale(shift: { shiftDate?: string | Date; startTime?: string | Date }): { isStale: boolean; staleReason: string | null } {
  if (!shift) return { isStale: false, staleReason: null };
  const now = new Date();
  const start = new Date(shift.startTime as any);
  const shiftDay = new Date(shift.shiftDate as any);
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const shiftDayStart = new Date(shiftDay); shiftDayStart.setHours(0, 0, 0, 0);
  if (shiftDayStart.getTime() < todayStart.getTime()) {
    return { isStale: true, staleReason: `Shift opened on ${shiftDay.toLocaleDateString()} — from a previous day` };
  }
  if (now.getTime() - start.getTime() > 24 * 60 * 60 * 1000) {
    return { isStale: true, staleReason: 'Shift open for more than 24 hours' };
  }
  return { isStale: false, staleReason: null };
}

export const startShift = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error } = startShiftSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: 'Validation error', errors: error.details.map(d => d.message) });
    }

    const { staffProfileId, branchId, shiftDate, startTime, openingBalance, notes } = req.body;

    const staffProfile = await prisma.staffProfile.findUnique({ where: { id: staffProfileId } });
    if (!staffProfile) return res.status(404).json({ success: false, message: 'Staff not found' });
    if (!staffProfile.isActive) return res.status(400).json({ success: false, message: 'Staff is not active' });

    // B1 + L-5: the staff profile must belong to the SELECTED business,
    // and the branch must too — otherwise a shift could be opened for
    // foreign staff or in a foreign branch.
    const selectedCompanyId = buildBranchWhereClause(req as any, {}).companyId;
    const staffMembership = await prisma.membership.findUnique({ where: { id: staffProfile.membershipId }, select: { businessId: true } });
    if (!staffMembership || staffMembership.businessId !== selectedCompanyId) {
      return res.status(404).json({ success: false, message: 'Staff not found' });
    }
    const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { companyId: true } });
    if (!branch || branch.companyId !== selectedCompanyId) {
      return res.status(404).json({ success: false, message: 'Branch not found' });
    }
    // B1: a staff member opens ONLY their own shift. Privileged roles
    // (manager / owner / admin) may open a shift for any staff member.
    if (!isShiftPrivileged(req)) {
      const ownProfileId = await resolveCallerStaffProfileId(prisma, req);
      if (!ownProfileId || ownProfileId !== staffProfileId) {
        return res.status(403).json({ success: false, message: 'You can only open your own shift' });
      }
    }

    const activeShift = await prisma.shift.findFirst({ where: { staffProfileId, status: 'ACTIVE' } });
    if (activeShift) return res.status(400).json({ success: false, message: 'Staff already has an active shift' });

    const shift = await prisma.shift.create({
      data: {
        staffProfileId,
        membershipId: staffProfile.membershipId,
        branchId,
        shiftDate: new Date(shiftDate),
        startTime: new Date(startTime),
        openingBalance,
        notes
      },
      include: staffInclude
    });

    syncAfterOperation('shift', 'create', shift).catch((err: any) => {
      logger.error('[Sync] Shift create sync failed:', { message: err.message });
    });

    // Notify the staff member about assigned shift
    const staffUserId = staffProfile.membershipId;
    if (staffUserId) {
      const membership = await prisma.membership.findUnique({ where: { id: staffUserId }, select: { userId: true, businessId: true } });
      if (membership?.userId && membership.businessId) {
        createNotification({
          userId: membership.userId,
          businessId: membership.businessId,
          type: 'shift_assigned',
          title: 'Shift Assigned',
          body: `You have a shift on ${new Date(shiftDate).toLocaleDateString()} starting at ${new Date(startTime).toLocaleTimeString()}`,
          actionUrl: `/employee-portal`,
        }).catch(() => {});
      }
    }

    return res.status(201).json({ success: true, data: shift, message: 'Shift started successfully' });
  } catch (error) {
    logger.error('Error starting shift:', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const endShift = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error } = endShiftSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: 'Validation error', errors: error.details.map(d => d.message) });
    }

    const { shiftId, endTime, actualBalance, notes } = req.body;
    const shift = await prisma.shift.findUnique({
      where: { id: shiftId },
      include: { ...staffInclude, membership: { select: { businessId: true } } },
    });

    if (!shift) return res.status(404).json({ success: false, message: 'Shift not found' });
    // Business-type scoping (L-5 fix, 2026-10-26): a shift from another
    // business must not be endable by id — cross-tenant write.
    if ((shift as any).membership?.businessId !== buildBranchWhereClause(req as any, {}).companyId) {
      return res.status(404).json({ success: false, message: 'Shift not found' });
    }
    // B1: a staff member closes ONLY their own shift.
    if (!isShiftPrivileged(req)) {
      const ownProfileId = await resolveCallerStaffProfileId(prisma, req);
      if (!ownProfileId || ownProfileId !== shift.staffProfileId) {
        return res.status(403).json({ success: false, message: 'You can only close your own shift' });
      }
    }
    if (shift.status !== 'ACTIVE') return res.status(400).json({ success: false, message: 'Shift is not active' });

    const expectedBalance = shift.openingBalance + shift.cashIn - shift.cashOut;
    const difference = actualBalance - expectedBalance;

    const updatedShift = await prisma.shift.update({
      where: { id: shiftId },
      data: { endTime: new Date(endTime), actualBalance, expectedBalance, difference, status: 'COMPLETED', notes: notes || shift.notes },
      include: staffInclude
    });

    return res.json({ success: true, data: updatedShift, message: 'Shift ended successfully' });
  } catch (error) {
    logger.error('Error ending shift:', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getShifts = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { page = 1, limit = 10, staffProfileId = '', branchId = '', status = '', startDate = '', endDate = '' } = req.query;

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);
    const where: any = {};

    if (staffProfileId) where.staffProfileId = staffProfileId;
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;

    // Business-type scoping (L-5 fix, 2026-10-26): shifts belong to the
    // SELECTED business only. Without this there was no business filter at
    // all, so every business listed the same shifts.
    where.membership = { businessId: buildBranchWhereClause(req as any, {}).companyId };

    if (startDate || endDate) {
      where.shiftDate = {};
      if (startDate) where.shiftDate.gte = new Date(startDate as string);
      if (endDate) {
        const e = new Date(endDate as string);
        e.setHours(23, 59, 59, 999);
        where.shiftDate.lte = e;
      }
    }

    const [shifts, total] = await Promise.all([
      prisma.shift.findMany({ where, skip, take, include: staffInclude, orderBy: { shiftDate: 'desc' } }),
      prisma.shift.count({ where })
    ]);

    return res.json({ success: true, data: { shifts, pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) } } });
  } catch (error) {
    logger.error('Error fetching shifts:', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getActiveShift = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    // B6: the route param is :staffId (shift.routes.ts) — the controller
    // used to read req.params.staffProfileId (undefined), so Prisma
    // dropped the filter and every lookup returned the business's FIRST
    // active shift, whoever asked. Read the param the route defines.
    // A missing id is a 400, never a silent first-row return.
    const staffProfileId = (req.params as any).staffId || (req.params as any).staffProfileId;
    if (!staffProfileId) {
      return res.status(400).json({ success: false, message: 'staffId is required' });
    }
    // Business-type scoping (L-5 fix, 2026-10-26): an active shift from
    // another business must not be visible through this business's POS.
    const activeShift = await prisma.shift.findFirst({
      where: { staffProfileId, status: 'ACTIVE', membership: { businessId: buildBranchWhereClause(req as any, {}).companyId } },
      include: staffInclude,
    });
    if (!activeShift) return res.json({ success: true, data: null });
    // B4: flag a stale shift — never silently present yesterday's shift
    // as today's. The POS dialog warns and offers Close.
    const { isStale, staleReason } = isShiftStale(activeShift);
    return res.json({ success: true, data: { ...activeShift, isStale, staleReason } });
  } catch (error) {
    console.error('Error fetching active shift:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const updateShift = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const { error } = updateShiftSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: 'Validation error', errors: error.details.map(d => d.message) });
    }

    const updateData = req.body;
    const existingShift = await prisma.shift.findUnique({
      where: { id },
      include: { membership: { select: { businessId: true } } },
    });
    if (!existingShift) return res.status(404).json({ success: false, message: 'Shift not found' });
    // Business-type scoping (L-5 fix, 2026-10-26): a shift from another
    // business must not be mutable by id — cross-tenant write.
    if (existingShift.membership?.businessId !== buildBranchWhereClause(req as any, {}).companyId) {
      return res.status(404).json({ success: false, message: 'Shift not found' });
    }
    // B1: a staff member updates ONLY their own shift.
    if (!isShiftPrivileged(req)) {
      const ownProfileId = await resolveCallerStaffProfileId(prisma, req);
      if (!ownProfileId || ownProfileId !== existingShift.staffProfileId) {
        return res.status(403).json({ success: false, message: 'You can only update your own shift' });
      }
    }
    if (existingShift.status !== 'ACTIVE') return res.status(400).json({ success: false, message: 'Shift is not active' });

    const newCashIn = updateData.cashIn !== undefined ? updateData.cashIn : existingShift.cashIn;
    const newCashOut = updateData.cashOut !== undefined ? updateData.cashOut : existingShift.cashOut;
    const expectedBalance = existingShift.openingBalance + newCashIn - newCashOut;

    const shift = await prisma.shift.update({ where: { id }, data: { ...updateData, expectedBalance }, include: staffInclude });
    return res.json({ success: true, data: shift, message: 'Shift updated successfully' });
  } catch (error) {
    console.error('Error updating shift:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getShiftStats = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { branchId, startDate, endDate } = req.query;
    const where: any = {};
    // Business-type scoping (L-5 fix, 2026-10-26): stats are for the
    // SELECTED business only.
    where.membership = { businessId: buildBranchWhereClause(req as any, {}).companyId };
    if (branchId) where.branchId = branchId;
    if (startDate || endDate) {
      where.shiftDate = {};
      if (startDate) where.shiftDate.gte = new Date(startDate as string);
      if (endDate) {
        const e = new Date(endDate as string);
        e.setHours(23, 59, 59, 999);
        where.shiftDate.lte = e;
      }
    }

    const [totalShifts, activeShifts, completedShifts, cancelledShifts, totalCashIn, totalCashOut, totalDifference] = await Promise.all([
      prisma.shift.count({ where }),
      prisma.shift.count({ where: { ...where, status: 'ACTIVE' } }),
      prisma.shift.count({ where: { ...where, status: 'COMPLETED' } }),
      prisma.shift.count({ where: { ...where, status: 'CANCELLED' } }),
      prisma.shift.aggregate({ where: { ...where, status: 'COMPLETED' }, _sum: { cashIn: true } }),
      prisma.shift.aggregate({ where: { ...where, status: 'COMPLETED' }, _sum: { cashOut: true } }),
      prisma.shift.aggregate({ where: { ...where, status: 'COMPLETED' }, _sum: { difference: true } })
    ]);

    return res.json({
      success: true,
      data: {
        totalShifts, activeShifts, completedShifts, cancelledShifts,
        totalCashIn: totalCashIn._sum.cashIn || 0,
        totalCashOut: totalCashOut._sum.cashOut || 0,
        totalDifference: totalDifference._sum.difference || 0
      }
    });
  } catch (error) {
    console.error('Error fetching shift stats:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
