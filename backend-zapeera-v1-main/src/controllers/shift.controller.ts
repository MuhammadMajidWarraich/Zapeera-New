import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { syncAfterOperation, pullLatestFromLive } from '../utils/sync-helper';
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
    const shift = await prisma.shift.findUnique({ where: { id: shiftId }, include: staffInclude });

    if (!shift) return res.status(404).json({ success: false, message: 'Shift not found' });
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
    const { staffProfileId } = req.params;
    const activeShift = await prisma.shift.findFirst({ where: { staffProfileId, status: 'ACTIVE' }, include: staffInclude });
    return res.json({ success: true, data: activeShift });
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
    const existingShift = await prisma.shift.findUnique({ where: { id } });
    if (!existingShift) return res.status(404).json({ success: false, message: 'Shift not found' });
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
