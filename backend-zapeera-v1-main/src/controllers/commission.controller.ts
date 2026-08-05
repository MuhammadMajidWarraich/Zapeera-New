import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { syncAfterOperation, pullLatestFromLive } from '../utils/sync-helper';
import Joi from 'joi';

// Validation schemas
const calculateCommissionSchema = Joi.object({
  staffId: Joi.string().required(),
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

// Calculate commission for a staff member
export const calculateCommission = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error } = calculateCommissionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const { staffId, branchId, period, periodType, baseRate, bonusRate, notes } = req.body;

    // Check if staff exists and is active
    const staff = await prisma.staff.findUnique({
      where: { id: staffId },
      include: { branch: true }
    });

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: 'Staff not found'
      });
    }

    if (!staff.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Staff is not active'
      });
    }

    // Check if commission already exists for this period
    const existingCommission = await prisma.commission.findFirst({
      where: {
        staffId,
        period,
        periodType
      }
    });

    if (existingCommission) {
      return res.status(400).json({
        success: false,
        message: 'Commission already calculated for this period'
      });
    }

    // Calculate date range based on period type
    let startDate: Date;
    let endDate: Date;

    const periodDate = new Date(period);

    switch (periodType) {
      case 'DAILY':
        startDate = new Date(periodDate);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(periodDate);
        endDate.setHours(23, 59, 59, 999);
        break;
      case 'WEEKLY':
        const dayOfWeek = periodDate.getDay();
        startDate = new Date(periodDate);
        startDate.setDate(periodDate.getDate() - dayOfWeek);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);
        endDate.setHours(23, 59, 59, 999);
        break;
      case 'MONTHLY':
        startDate = new Date(periodDate.getFullYear(), periodDate.getMonth(), 1);
        endDate = new Date(periodDate.getFullYear(), periodDate.getMonth() + 1, 0);
        endDate.setHours(23, 59, 59, 999);
        break;
      case 'YEARLY':
        startDate = new Date(periodDate.getFullYear(), 0, 1);
        endDate = new Date(periodDate.getFullYear(), 11, 31);
        endDate.setHours(23, 59, 59, 999);
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid period type'
        });
    }

    // Get sales data for the period
    const salesData = await prisma.sale.aggregate({
      where: {
        userId: staffId, // Assuming userId refers to staff who made the sale
        branchId,
        createdAt: {
          gte: startDate,
          lte: endDate
        },
        status: 'COMPLETED'
      },
      _sum: {
        totalAmount: true
      },
      _count: {
        id: true
      }
    });

    const totalSales = salesData._sum.totalAmount || 0;
    const totalTransactions = salesData._count.id || 0;
    const averageSale = totalTransactions > 0 ? totalSales / totalTransactions : 0;

    // Calculate commission
    const totalCommission = totalSales * baseRate;
    const bonusAmount = totalSales * bonusRate;
    const totalAmount = totalCommission + bonusAmount;

    // Create commission record
    const commission = await prisma.commission.create({
      data: {
        staffId,
        branchId,
        period,
        periodType,
        totalSales,
        totalTransactions,
        averageSale,
        baseRate,
        bonusRate,
        totalCommission,
        bonusAmount,
        totalAmount,
        notes
      },
      include: {
        staff: {
          select: {
            id: true,
            name: true,
            staffId: true,
            position: true
          }
        },
        branch: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('commission', 'create', commission).catch(err => {
      console.error('[Sync] Commission create sync failed:', err.message);
    });

    return res.status(201).json({
      success: true,
      data: commission,
      message: 'Commission calculated successfully'
    });
  } catch (error) {
    console.error('Error calculating commission:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get commissions
export const getCommissions = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const {
      page = 1,
      limit = 10,
      staffId = '',
      branchId = '',
      status = '',
      periodType = '',
      startDate = '',
      endDate = ''
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const where: any = {};

    if (staffId) {
      where.staffId = staffId;
    }

    if (branchId) {
      where.branchId = branchId;
    }

    if (status) {
      where.status = status;
    }

    if (periodType) {
      where.periodType = periodType;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        const endDateObj = new Date(endDate as string);
        endDateObj.setHours(23, 59, 59, 999);
        where.createdAt.lte = endDateObj;
      }
    }

    const [commissions, total] = await Promise.all([
      prisma.commission.findMany({
        where,
        skip,
        take,
        include: {
          staff: {
            select: {
              id: true,
              name: true,
              staffId: true,
              position: true
            }
          },
          branch: {
            select: {
              id: true,
              name: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.commission.count({ where })
    ]);

    return res.json({
      success: true,
      data: {
        commissions,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      }
    });
  } catch (error) {
    console.error('Error fetching commissions:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get commission by ID
export const getCommission = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    const commission = await prisma.commission.findUnique({
      where: { id },
      include: {
        staff: {
          select: {
            id: true,
            name: true,
            staffId: true,
            position: true
          }
        },
        branch: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    if (!commission) {
      return res.status(404).json({
        success: false,
        message: 'Commission not found'
      });
    }

    return res.json({
      success: true,
      data: commission
    });
  } catch (error) {
    console.error('Error fetching commission:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update commission
export const updateCommission = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const { error } = updateCommissionSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const updateData = req.body;

    // Check if commission exists
    const existingCommission = await prisma.commission.findUnique({
      where: { id }
    });

    if (!existingCommission) {
      return res.status(404).json({
        success: false,
        message: 'Commission not found'
      });
    }

    // If marking as paid, set paidAt timestamp
    if (updateData.status === 'PAID' && existingCommission.status !== 'PAID') {
      updateData.paidAt = new Date();
    }

    // Update commission record
    const commission = await prisma.commission.update({
      where: { id },
      data: updateData,
      include: {
        staff: {
          select: {
            id: true,
            name: true,
            staffId: true,
            position: true
          }
        },
        branch: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('commission', 'update', commission).catch(err => {
      console.error('[Sync] Commission update sync failed:', err.message);
    });

    return res.json({
      success: true,
      data: commission,
      message: 'Commission updated successfully'
    });
  } catch (error) {
    console.error('Error updating commission:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get commission statistics
export const getCommissionStats = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { branchId, startDate, endDate } = req.query;

    const where: any = {};
    if (branchId) {
      where.branchId = branchId;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        const endDateObj = new Date(endDate as string);
        endDateObj.setHours(23, 59, 59, 999);
        where.createdAt.lte = endDateObj;
      }
    }

    const [
      totalCommissions,
      pendingCommissions,
      approvedCommissions,
      paidCommissions,
      cancelledCommissions,
      totalAmount,
      totalPaidAmount
    ] = await Promise.all([
      prisma.commission.count({ where }),
      prisma.commission.count({ where: { ...where, status: 'PENDING' } }),
      prisma.commission.count({ where: { ...where, status: 'APPROVED' } }),
      prisma.commission.count({ where: { ...where, status: 'PAID' } }),
      prisma.commission.count({ where: { ...where, status: 'CANCELLED' } }),
      prisma.commission.aggregate({
        where,
        _sum: { totalAmount: true }
      }),
      prisma.commission.aggregate({
        where: { ...where, status: 'PAID' },
        _sum: { totalAmount: true }
      })
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
        totalPaidAmount: totalPaidAmount._sum.totalAmount || 0
      }
    });
  } catch (error) {
    console.error('Error fetching commission stats:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get staff performance summary
export const getStaffPerformance = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { staffId } = req.params;
    const { startDate, endDate } = req.query;

    const where: any = { staffId };
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        const endDateObj = new Date(endDate as string);
        endDateObj.setHours(23, 59, 59, 999);
        where.createdAt.lte = endDateObj;
      }
    }

    // Get sales performance
    const salesData = await prisma.sale.aggregate({
      where: {
        userId: staffId,
        status: 'COMPLETED',
        ...(startDate || endDate ? {
          createdAt: {
            ...(startDate ? { gte: new Date(startDate as string) } : {}),
            ...(endDate ? { lte: new Date(endDate as string) } : {})
          }
        } : {})
      },
      _sum: {
        totalAmount: true
      },
      _count: {
        id: true
      }
    });

    // Get commission data
    const commissionData = await prisma.commission.aggregate({
      where,
      _sum: {
        totalAmount: true,
        totalCommission: true,
        bonusAmount: true
      },
      _count: {
        id: true
      }
    });

    // Get recent commissions
    const recentCommissions = await prisma.commission.findMany({
      where,
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        branch: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    // Get top products sold
    const topProducts = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: {
        sale: {
          userId: staffId,
          status: 'COMPLETED',
          ...(startDate || endDate ? {
            createdAt: {
              ...(startDate ? { gte: new Date(startDate as string) } : {}),
              ...(endDate ? { lte: new Date(endDate as string) } : {})
            }
          } : {})
        }
      },
      _sum: {
        quantity: true,
        totalPrice: true
      },
      _count: {
        productId: true
      },
      orderBy: {
        _sum: {
          totalPrice: 'desc'
        }
      },
      take: 5
    });

    // Get product names for top products
    const productIds = topProducts.map(p => p.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true }
    });

    const topProductsWithNames = topProducts.map(item => {
      const product = products.find(p => p.id === item.productId);
      return {
        productName: product?.name || 'Unknown Product',
        quantity: item._sum.quantity || 0,
        totalAmount: item._sum.totalPrice || 0
      };
    });

    return res.json({
      success: true,
      data: {
        totalSales: salesData._sum.totalAmount || 0,
        totalTransactions: salesData._count.id || 0,
        averageSale: salesData._count.id > 0 ? (salesData._sum.totalAmount || 0) / salesData._count.id : 0,
        topProducts: topProductsWithNames,
        commissions: {
          totalCommissions: commissionData._count.id || 0,
          totalAmount: commissionData._sum.totalAmount || 0,
          totalCommission: commissionData._sum.totalCommission || 0,
          totalBonus: commissionData._sum.bonusAmount || 0
        },
        recentCommissions
      }
    });
  } catch (error) {
    console.error('Error fetching staff performance:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};
