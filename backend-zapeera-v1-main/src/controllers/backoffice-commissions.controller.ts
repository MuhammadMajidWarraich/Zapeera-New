import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';

/**
 * Backoffice Commissions (read-only).
 *
 * Tenant commission records are created and managed inside each business
 * (POST/PUT /api/commissions, tenant session). The backoffice only needs
 * platform-wide visibility, so these endpoints never write: list with
 * business/status/period filters plus aggregate stats.
 */

const commissionInclude = {
  staffProfile: {
    select: {
      id: true,
      employeeId: true,
      designation: true,
    },
  },
  membership: {
    include: {
      user: { select: { id: true, name: true, email: true } },
      business: { select: { id: true, name: true } },
    },
  },
  branch: { select: { id: true, name: true } },
};

function buildWhere(req: Request): any {
  const { businessId = '', status = '', periodType = '' } = req.query;
  const where: any = {};
  if (businessId) where.membership = { businessId: String(businessId) };
  if (status) where.status = String(status);
  if (periodType) where.periodType = String(periodType);
  return where;
}

export const getBackofficeCommissions = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);
    const where = buildWhere(req);

    const [commissions, total] = await Promise.all([
      prisma.commission.findMany({
        where,
        skip,
        take,
        include: commissionInclude,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.commission.count({ where }),
    ]);

    return res.json({
      success: true,
      data: {
        commissions,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit)),
        },
      },
    });
  } catch (error: any) {
    console.error('Backoffice get commissions error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getBackofficeCommissionStats = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { businessId = '' } = req.query;
    const where: any = {};
    if (businessId) where.membership = { businessId: String(businessId) };

    const [totalCommissions, pendingCommissions, approvedCommissions, paidCommissions, cancelledCommissions, totalAmount, totalPaidAmount, totalSales] = await Promise.all([
      prisma.commission.count({ where }),
      prisma.commission.count({ where: { ...where, status: 'PENDING' } }),
      prisma.commission.count({ where: { ...where, status: 'APPROVED' } }),
      prisma.commission.count({ where: { ...where, status: 'PAID' } }),
      prisma.commission.count({ where: { ...where, status: 'CANCELLED' } }),
      prisma.commission.aggregate({ where, _sum: { totalAmount: true } }),
      prisma.commission.aggregate({ where: { ...where, status: 'PAID' }, _sum: { totalAmount: true } }),
      prisma.commission.aggregate({ where, _sum: { totalSales: true } }),
    ]);

    return res.json({
      success: true,
      data: {
        totalCommissions,
        pendingCommissions,
        approvedCommissions,
        paidCommissions,
        cancelledCommissions,
        totalAmount: totalAmount._sum.totalAmount || 0,
        totalPaidAmount: totalPaidAmount._sum.totalAmount || 0,
        totalSales: totalSales._sum.totalSales || 0,
      },
    });
  } catch (error: any) {
    console.error('Backoffice commission stats error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
