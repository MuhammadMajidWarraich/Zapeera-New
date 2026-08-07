import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { syncAfterOperation, pullLatestFromLive } from '../utils/sync-helper';
import Joi from 'joi';
import logger from '../utils/logger';

const calculateCommissionSchema = Joi.object({
  staffProfileId: Joi.string().required(),
  branchId: Joi.string().required(),
  period: Joi.string().required(),
  periodType: Joi.string().valid('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY').default('MONTHLY'),
  baseRate: Joi.number().min(0).max(1).default(0.02),
  bonusRate: Joi.number().min(0).max(1).default(0),
  notes: Joi.string().optional()
});

const updateCommissionSchema = Joi.object({
  status: Joi.string().valid('PENDING', 'APPROVED', 'PAID', 'CANCELLED').optional(),
  notes: Joi.string().optional()
});

const commissionStaffInclude = {
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

export const calculateCommission = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error } = calculateCommissionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: 'Validation error', errors: error.details.map(d => d.message) });
    }

    const { staffProfileId, branchId, period, periodType, baseRate, bonusRate, notes } = req.body;

    const staffProfile = await prisma.staffProfile.findUnique({ where: { id: staffProfileId } });
    if (!staffProfile) return res.status(404).json({ success: false, message: 'Staff not found' });
    if (!staffProfile.isActive) return res.status(400).json({ success: false, message: 'Staff is not active' });

    const existingCommission = await prisma.commission.findFirst({ where: { staffProfileId, period, periodType } });
    if (existingCommission) return res.status(400).json({ success: false, message: 'Commission already calculated for this period' });

    const periodDate = new Date(period);
    let startDate: Date;
    let endDate: Date;

    switch (periodType) {
      case 'DAILY':
        startDate = new Date(periodDate); startDate.setHours(0, 0, 0, 0);
        endDate = new Date(periodDate); endDate.setHours(23, 59, 59, 999);
        break;
      case 'WEEKLY': {
        const dow = periodDate.getDay();
        startDate = new Date(periodDate); startDate.setDate(periodDate.getDate() - dow); startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate); endDate.setDate(startDate.getDate() + 6); endDate.setHours(23, 59, 59, 999);
        break;
      }
      case 'MONTHLY':
        startDate = new Date(periodDate.getFullYear(), periodDate.getMonth(), 1);
        endDate = new Date(periodDate.getFullYear(), periodDate.getMonth() + 1, 0); endDate.setHours(23, 59, 59, 999);
        break;
      case 'YEARLY':
        startDate = new Date(periodDate.getFullYear(), 0, 1);
        endDate = new Date(periodDate.getFullYear(), 11, 31); endDate.setHours(23, 59, 59, 999);
        break;
      default:
        return res.status(400).json({ success: false, message: 'Invalid period type' });
    }

    const salesData = await prisma.sale.aggregate({
      where: { userId: staffProfile.membershipId, branchId, createdAt: { gte: startDate, lte: endDate }, status: 'COMPLETED' },
      _sum: { totalAmount: true },
      _count: { id: true }
    });

    const totalSales = salesData._sum.totalAmount || 0;
    const totalTransactions = salesData._count.id || 0;
    const averageSale = totalTransactions > 0 ? totalSales / totalTransactions : 0;
    const totalCommission = totalSales * baseRate;
    const bonusAmount = totalSales * bonusRate;
    const totalAmount = totalCommission + bonusAmount;

    const commission = await prisma.commission.create({
      data: {
        staffProfileId,
        membershipId: staffProfile.membershipId,
        branchId, period, periodType, totalSales, totalTransactions, averageSale,
        baseRate, bonusRate, totalCommission, bonusAmount, totalAmount, notes
      },
      include: commissionStaffInclude
    });

    syncAfterOperation('commission', 'create', commission).catch((err: any) => {
      logger.error('[Sync] Commission create sync failed:', { message: err.message });
    });

    return res.status(201).json({ success: true, data: commission, message: 'Commission calculated successfully' });
  } catch (error) {
    logger.error('Error calculating commission:', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getCommissions = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { page = 1, limit = 10, staffProfileId = '', branchId = '', status = '', periodType = '', startDate = '', endDate = '' } = req.query;

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);
    const where: any = {};

    if (staffProfileId) where.staffProfileId = staffProfileId;
    if (branchId) where.branchId = branchId;
    if (status) where.status = status;
    if (periodType) where.periodType = periodType;

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) {
        const e = new Date(endDate as string); e.setHours(23, 59, 59, 999);
        where.createdAt.lte = e;
      }
    }

    const [commissions, total] = await Promise.all([
      prisma.commission.findMany({ where, skip, take, include: commissionStaffInclude, orderBy: { createdAt: 'desc' } }),
      prisma.commission.count({ where })
    ]);

    return res.json({ success: true, data: { commissions, pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) } } });
  } catch (error) {
    logger.error('Error fetching commissions:', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getCommission = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const commission = await prisma.commission.findUnique({ where: { id }, include: commissionStaffInclude });
    if (!commission) return res.status(404).json({ success: false, message: 'Commission not found' });
    return res.json({ success: true, data: commission });
  } catch (error) {
    logger.error('Error fetching commission:', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const updateCommission = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const { error } = updateCommissionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: 'Validation error', errors: error.details.map(d => d.message) });
    }

    const updateData = req.body;
    const existingCommission = await prisma.commission.findUnique({ where: { id } });
    if (!existingCommission) return res.status(404).json({ success: false, message: 'Commission not found' });

    if (updateData.status === 'PAID' && existingCommission.status !== 'PAID') {
      updateData.paidAt = new Date();
    }

    const commission = await prisma.commission.update({ where: { id }, data: updateData, include: commissionStaffInclude });

    syncAfterOperation('commission', 'update', commission).catch((err: any) => {
      logger.error('[Sync] Commission update sync failed:', { message: err.message });
    });

    return res.json({ success: true, data: commission, message: 'Commission updated successfully' });
  } catch (error) {
    logger.error('Error updating commission:', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getCommissionStats = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { branchId, startDate, endDate } = req.query;
    const where: any = {};
    if (branchId) where.branchId = branchId;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) { const e = new Date(endDate as string); e.setHours(23, 59, 59, 999); where.createdAt.lte = e; }
    }

    const [totalCommissions, pendingCommissions, approvedCommissions, paidCommissions, cancelledCommissions, totalAmount, totalPaidAmount] = await Promise.all([
      prisma.commission.count({ where }),
      prisma.commission.count({ where: { ...where, status: 'PENDING' } }),
      prisma.commission.count({ where: { ...where, status: 'APPROVED' } }),
      prisma.commission.count({ where: { ...where, status: 'PAID' } }),
      prisma.commission.count({ where: { ...where, status: 'CANCELLED' } }),
      prisma.commission.aggregate({ where, _sum: { totalAmount: true } }),
      prisma.commission.aggregate({ where: { ...where, status: 'PAID' }, _sum: { totalAmount: true } })
    ]);

    return res.json({
      success: true,
      data: {
        totalCommissions, pendingCommissions, approvedCommissions, paidCommissions, cancelledCommissions,
        totalAmount: totalAmount._sum.totalAmount || 0,
        totalPaidAmount: totalPaidAmount._sum.totalAmount || 0
      }
    });
  } catch (error) {
    logger.error('Error fetching commission stats:', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getStaffPerformance = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { staffProfileId } = req.params;
    const { startDate, endDate } = req.query;

    const where: any = { staffProfileId };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate as string);
      if (endDate) { const e = new Date(endDate as string); e.setHours(23, 59, 59, 999); where.createdAt.lte = e; }
    }

    const staffProfile = await prisma.staffProfile.findUnique({ where: { id: staffProfileId }, select: { membershipId: true } });

    const commissionData = await prisma.commission.aggregate({
      where, _sum: { totalAmount: true, totalCommission: true, bonusAmount: true }, _count: { id: true }
    });

    const recentCommissions = await prisma.commission.findMany({
      where, take: 5, orderBy: { createdAt: 'desc' }, include: { branch: { select: { id: true, name: true } } }
    });

    const topProducts = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: {
        sale: {
          userId: staffProfile?.membershipId || '',
          status: 'COMPLETED',
          ...(startDate || endDate ? { createdAt: { ...(startDate ? { gte: new Date(startDate as string) } : {}), ...(endDate ? { lte: new Date(endDate as string) } : {}) } } : {})
        }
      },
      _sum: { quantity: true, totalPrice: true },
      _count: { productId: true },
      orderBy: { _sum: { totalPrice: 'desc' } },
      take: 5
    });

    const productIds = topProducts.map(p => p.productId);
    const products = productIds.length > 0 ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } }) : [];

    const topProductsWithNames = topProducts.map(item => ({
      productName: products.find(p => p.id === item.productId)?.name || 'Unknown Product',
      quantity: item._sum.quantity || 0,
      totalAmount: item._sum.totalPrice || 0
    }));

    return res.json({
      success: true,
      data: {
        commissions: {
          totalCommissions: commissionData._count.id || 0,
          totalAmount: commissionData._sum.totalAmount || 0,
          totalCommission: commissionData._sum.totalCommission || 0,
          totalBonus: commissionData._sum.bonusAmount || 0
        },
        topProducts: topProductsWithNames,
        recentCommissions
      }
    });
  } catch (error) {
    logger.error('Error fetching staff performance:', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
