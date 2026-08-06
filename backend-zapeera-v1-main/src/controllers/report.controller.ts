// CRITICAL: Import database initialization FIRST to ensure DATABASE_URL is set
import '../config/database.init';

import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { getPrisma } from '../utils/db.util';
import { AuthRequest, buildBranchWhereClause } from '../middleware/auth.middleware';

// Helper function to get week number
function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function parseDateStart(dateLike: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateLike);
  if (m) {
    const year = parseInt(m[1], 10);
    const month = parseInt(m[2], 10) - 1;
    const day = parseInt(m[3], 10);
    return new Date(year, month, day, 0, 0, 0, 0);
  }
  return new Date(dateLike);
}

function parseDateEnd(dateLike: string): Date {
  const d = parseDateStart(dateLike);
  d.setHours(23, 59, 59, 999);
  return d;
}

export const getSalesReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const {
      startDate = '',
      endDate = '',
      branchId = '',
      groupBy = 'day'
    } = req.query;

    console.log('Sales report request:', { startDate, endDate, branchId, groupBy });
    console.log('User context:', { userId: req.user?.id, createdBy: req.user?.createdBy, role: req.user?.role });

    // Build where clause with data isolation
    const where: any = buildBranchWhereClause(req, {});

    if (branchId) {
      where.branchId = branchId;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = parseDateStart(startDate as string);
      }
      if (endDate) {
        where.createdAt.lte = parseDateEnd(endDate as string);
      }
    } else {
      // If no date range provided, show the most recent day's sales (for "today" filter)
      const mostRecentSale = await prisma.sale.findFirst({
        where,
        orderBy: {
          createdAt: 'desc'
        },
        select: {
          createdAt: true
        }
      });

      if (mostRecentSale) {
        const mostRecentDate = new Date(mostRecentSale.createdAt);
        mostRecentDate.setHours(0, 0, 0, 0);
        const nextDay = new Date(mostRecentDate);
        nextDay.setDate(nextDay.getDate() + 1);

        where.createdAt = {
          gte: mostRecentDate,
          lt: nextDay
        };
        console.log('No date range provided, showing most recent day sales:', {
          from: mostRecentDate.toISOString(),
          to: nextDay.toISOString()
        });
      } else {
        console.log('No sales found, showing empty result');
      }
    }

    // Exclude refunded sales from reports
    where.status = { not: 'REFUNDED' };

    console.log('Sales report where clause:', where);

    // Get sales summary (excluding refunded sales)
    const salesSummary = await prisma.sale.aggregate({
      where,
      _sum: {
        totalAmount: true,
        subtotal: true,
        taxAmount: true,
        discountAmount: true
      },
      _count: {
        id: true
      }
    });

    console.log('Sales summary result:', salesSummary);

    // Debug: Get all sales to see what exists
    const allSales = await prisma.sale.findMany({
      where: branchId ? { branchId: branchId as string } : {},
      select: {
        id: true,
        totalAmount: true,
        paymentMethod: true,
        createdAt: true,
        branchId: true
      },
      take: 5
    });
    console.log('Sample sales in database:', allSales);

    // Get sales by payment method
    const salesByPaymentMethod = await prisma.sale.groupBy({
      by: ['paymentMethod'],
      where,
      _sum: {
        totalAmount: true
      },
      _count: {
        id: true
      }
    });

    console.log('Sales by payment method result:', salesByPaymentMethod);

    // Get top selling products
    const topProducts = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: {
        sale: where
      },
      _sum: {
        quantity: true,
        totalPrice: true
      },
      orderBy: {
        _sum: {
          quantity: 'desc'
        }
      },
      take: 10
    });

    console.log('Top products result:', topProducts);

    // Get product details for top products
    const topProductsWithDetails = await Promise.all(
      topProducts.map(async (item: any) => {
        const product = await prisma.product.findUnique({
          where: { id: item.productId },
          select: {
            id: true,
            name: true,
            category: {
              select: {
                name: true
              }
            }
          }
        });
        return {
          ...item,
          product
        };
      })
    );

    // Get sales trend data
    let salesTrend;
    if (groupBy === 'hour') {
      // Group by hour (used by "today" chart)
      const sales = await prisma.sale.findMany({
        where,
        select: {
          createdAt: true,
          totalAmount: true
        },
        orderBy: {
          createdAt: 'asc'
        }
      });

      const hourlyData: { [key: string]: { date: Date; total: number; count: number } } = {};
      sales.forEach((sale: any) => {
        const d = new Date(sale.createdAt);
        d.setMinutes(0, 0, 0);
        const key = d.toISOString(); // stable key per hour
        if (!hourlyData[key]) hourlyData[key] = { date: d, total: 0, count: 0 };
        hourlyData[key].total += Number(sale.totalAmount || 0);
        hourlyData[key].count += 1;
      });

      salesTrend = Object.values(hourlyData)
        .sort((a, b) => a.date.getTime() - b.date.getTime())
        .map((item) => ({
          createdAt: item.date,
          _sum: { totalAmount: item.total },
          _count: { id: item.count }
        }));
    } else if (groupBy === 'day') {
      salesTrend = await prisma.sale.groupBy({
        by: ['createdAt'],
        where,
        _sum: {
          totalAmount: true
        },
        _count: {
          id: true
        },
        orderBy: {
          createdAt: 'asc'
        }
      });
    } else if (groupBy === 'month') {
      // Group by month
      const sales = await prisma.sale.findMany({
        where,
        select: {
          createdAt: true,
          totalAmount: true
        },
        orderBy: {
          createdAt: 'asc'
        }
      });

      const monthlyData: { [key: string]: { total: number; count: number } } = {};
      sales.forEach((sale: any) => {
        const monthKey = `${sale.createdAt.getFullYear()}-${String(sale.createdAt.getMonth() + 1).padStart(2, '0')}`;
        if (!monthlyData[monthKey]) {
          monthlyData[monthKey] = { total: 0, count: 0 };
        }
        monthlyData[monthKey].total += sale.totalAmount;
        monthlyData[monthKey].count += 1;
      });

      salesTrend = Object.entries(monthlyData).map(([month, data]) => ({
        createdAt: new Date(month + '-01'),
        _sum: { totalAmount: data.total },
        _count: { id: data.count }
      }));
    } else if (groupBy === 'week') {
      // Group by week
      const sales = await prisma.sale.findMany({
        where,
        select: {
          createdAt: true,
          totalAmount: true
        },
        orderBy: {
          createdAt: 'asc'
        }
      });

      const weeklyData: { [key: string]: { total: number; count: number } } = {};
      sales.forEach((sale: any) => {
        const date = new Date(sale.createdAt);
        const year = date.getFullYear();
        const weekNumber = getWeekNumber(date);
        const weekKey = `${year}-W${String(weekNumber).padStart(2, '0')}`;

        if (!weeklyData[weekKey]) {
          weeklyData[weekKey] = { total: 0, count: 0 };
        }
        weeklyData[weekKey].total += sale.totalAmount;
        weeklyData[weekKey].count += 1;
      });

      salesTrend = Object.entries(weeklyData).map(([week, data]) => ({
        createdAt: new Date(week.replace('W', '-W')),
        _sum: { totalAmount: data.total },
        _count: { id: data.count }
      }));
    } else if (groupBy === 'year') {
      // Group by year
      const sales = await prisma.sale.findMany({
        where,
        select: {
          createdAt: true,
          totalAmount: true
        },
        orderBy: {
          createdAt: 'asc'
        }
      });

      const yearlyData: { [key: string]: { total: number; count: number } } = {};
      sales.forEach((sale: any) => {
        const year = sale.createdAt.getFullYear().toString();

        if (!yearlyData[year]) {
          yearlyData[year] = { total: 0, count: 0 };
        }
        yearlyData[year].total += sale.totalAmount;
        yearlyData[year].count += 1;
      });

      salesTrend = Object.entries(yearlyData).map(([year, data]) => ({
        createdAt: new Date(year + '-01-01'),
        _sum: { totalAmount: data.total },
        _count: { id: data.count }
      }));
    }

    const responseData = {
      summary: {
        totalSales: salesSummary._count.id,
        totalRevenue: salesSummary._sum.totalAmount || 0,
        totalSubtotal: salesSummary._sum.subtotal || 0,
        totalTax: salesSummary._sum.taxAmount || 0,
        totalDiscount: salesSummary._sum.discountAmount || 0
      },
      salesByPaymentMethod,
      topProducts: topProductsWithDetails,
      salesTrend: salesTrend || []
    };

    console.log('Sales report response:', responseData);

    return res.json({
      success: true,
      data: responseData
    });
  } catch (error) {
    console.error('Get sales report error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getInventoryReport = async (req: AuthRequest, res: Response) => {
  try {
    const { branchId = '', lowStock = false } = req.query;

    const prisma = await getPrisma();
    console.log('Inventory report request:', { branchId, lowStock });
    console.log('User context:', { userId: req.user?.id, createdBy: req.user?.createdBy, role: req.user?.role });

    // Build where clause with data isolation
    const where: any = buildBranchWhereClause(req, {
      isActive: true
    });

    if (branchId) {
      where.branchId = branchId;
    }

    // Low stock filtering is now handled through batch quantities
    // This would need to be implemented differently with the new batch-based system

    // Get inventory summary
    const inventorySummary = await prisma.product.aggregate({
      where,
      _count: {
        id: true
      }
    });

    // Get products by category
    const productsByCategory = await prisma.product.groupBy({
      by: ['categoryId'],
      where,
      _count: {
        id: true
      }
    });

    // Get category details
    const categoriesWithDetails = await Promise.all(
      productsByCategory.map(async (item: any) => {
        const category = await prisma.category.findUnique({
          where: { id: item.categoryId },
          select: {
            id: true,
            name: true
          }
        });
        return {
          ...item,
          category
        };
      })
    );

    // Get low stock products - using raw query for comparison
    const lowStockProducts = await prisma.$queryRaw`
      SELECT p.*, c.name as category_name, s.name as supplier_name
      FROM products p
      LEFT JOIN categories c ON p."categoryId" = c.id
      LEFT JOIN suppliers s ON p."supplierId" = s.id
      WHERE p."isActive" = true
      ${branchId ? Prisma.sql`AND p."branchId" = ${branchId}` : Prisma.empty}
      -- Stock checking is now handled through batches
      ORDER BY p."minStock" ASC
    `;

    return res.json({
      success: true,
      data: {
        summary: {
          totalProducts: inventorySummary._count?.id || 0,
          totalStock: 0, // Stock is now managed through batches
          lowStockCount: Array.isArray(lowStockProducts) ? lowStockProducts.length : 0
        },
        productsByCategory: categoriesWithDetails,
        lowStockProducts
      }
    });
  } catch (error) {
    console.error('Get inventory report error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getCustomerReport = async (req: AuthRequest, res: Response) => {
  try {
    const {
      startDate = '',
      endDate = '',
      branchId = '',
      vip = false
    } = req.query;

    const prisma = await getPrisma();
    console.log('Customer report request:', { startDate, endDate, branchId, vip });
    console.log('User context:', { userId: req.user?.id, createdBy: req.user?.createdBy, role: req.user?.role });

    // Build where clause with data isolation
    const where: any = buildBranchWhereClause(req, {
      isActive: true
    });

    if (branchId) {
      where.branchId = branchId;
    }

    if (vip === 'true') {
      where.isVIP = true;
    }

    // Get customer summary
    const customerSummary = await prisma.customer.aggregate({
      where,
      _sum: {
        totalPurchases: true,
        loyaltyPoints: true
      },
      _count: {
        id: true
      }
    });

    // Get customers by VIP status
    const customersByVIP = await prisma.customer.groupBy({
      by: ['isVIP'],
      where,
      _count: {
        id: true
      },
      _sum: {
        totalPurchases: true,
        loyaltyPoints: true
      }
    });

    // Get top customers by spending
    const topCustomers = await prisma.customer.findMany({
      where,
      select: {
        id: true,
        name: true,
        phone: true,
        totalPurchases: true,
        loyaltyPoints: true,
        lastVisit: true,
        isVIP: true,
        _count: {
          select: {
            sales: true
          }
        }
      },
      orderBy: {
        totalPurchases: 'desc'
      },
      take: 10
    });

    // Get recent customers
    const recentCustomers = await prisma.customer.findMany({
      where,
      select: {
        id: true,
        name: true,
        phone: true,
        createdAt: true,
        totalPurchases: true
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 10
    });

    return res.json({
      success: true,
      data: {
        summary: {
          totalCustomers: customerSummary._count.id,
          totalSpent: customerSummary._sum.totalPurchases || 0,
          totalLoyaltyPoints: customerSummary._sum.loyaltyPoints || 0,
          averageSpent: customerSummary._count.id > 0 ? (customerSummary._sum.totalPurchases || 0) / customerSummary._count.id : 0
        },
        customersByVIP,
        topCustomers,
        recentCustomers
      }
    });
  } catch (error) {
    console.error('Get customer report error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getProductPerformanceReport = async (req: AuthRequest, res: Response) => {
  try {
    const {
      startDate = '',
      endDate = '',
      branchId = '',
      categoryId = ''
    } = req.query;

    const prisma = await getPrisma();
    console.log('Product performance report request:', { startDate, endDate, branchId, categoryId });
    console.log('User context:', { userId: req.user?.id, createdBy: req.user?.createdBy, role: req.user?.role });

    // Build where clause with data isolation
    const where: any = buildBranchWhereClause(req, {});

    if (branchId) {
      where.branchId = branchId;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = parseDateStart(startDate as string);
      }
      if (endDate) {
        where.createdAt.lte = parseDateEnd(endDate as string);
      }
    }

    // Get product performance
    const productPerformance = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: {
        sale: where
      },
      _sum: {
        quantity: true,
        totalPrice: true
      },
      _count: {
        id: true
      },
      orderBy: {
        _sum: {
          quantity: 'desc'
        }
      },
      take: 20
    });

    // Get product details
    const productsWithDetails = await Promise.all(
      productPerformance.map(async (item: any) => {
        const product = await prisma.product.findUnique({
          where: { id: item.productId },
          select: {
            id: true,
            name: true,
            // sellingPrice and stock are now managed through batches
            category: {
              select: {
                name: true
              }
            },
            supplier: {
              select: {
                name: true
              }
            }
          }
        });
        return {
          ...item,
          product
        };
      })
    );

    // Get performance by category
    const performanceByCategory = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: {
        sale: where,
        product: categoryId ? { categoryId: categoryId as string } : undefined
      },
      _sum: {
        quantity: true,
        totalPrice: true
      },
      _count: {
        id: true
      }
    });

    // Get category details for performance
    const categoryPerformance = await Promise.all(
      performanceByCategory.map(async (item: any) => {
        const product = await prisma.product.findUnique({
          where: { id: item.productId },
          select: {
            category: {
              select: {
                name: true
              }
            }
          }
        });
        return {
          ...item,
          category: product?.category?.name || 'Unknown'
        };
      })
    );

    // Group by category
    const categoryStats: { [key: string]: { quantity: number; revenue: number; count: number } } = {};
    console.log('Category performance data:', categoryPerformance);

    categoryPerformance.forEach((item: any) => {
      const category = item.category;
      if (!categoryStats[category]) {
        categoryStats[category] = { quantity: 0, revenue: 0, count: 0 };
      }
      categoryStats[category].quantity += item._sum?.quantity || 0;
      categoryStats[category].revenue += item._sum?.totalPrice || 0;
      categoryStats[category].count += typeof item._count === 'object' && item._count?.id ? item._count.id : 0;
    });

    console.log('Category stats:', categoryStats);

    // Calculate summary statistics
    const totalProducts = productsWithDetails.length;
    const totalRevenue = productsWithDetails.reduce((sum: number, item: any) => sum + (item._sum?.totalPrice || 0), 0);
    const avgRevenue = totalProducts > 0 ? totalRevenue / totalProducts : 0;
    const topProduct = productsWithDetails.length > 0 ? {
      name: productsWithDetails[0].product?.name || 'Unknown',
      revenue: productsWithDetails[0]._sum?.totalPrice || 0
    } : null;

    return res.json({
      success: true,
      data: {
        summary: {
          totalProducts,
          totalRevenue,
          averageRevenue: avgRevenue
        },
        topProduct,
        topProducts: productsWithDetails,
        categoryPerformance: Object.entries(categoryStats).map(([category, stats]) => ({
          category,
          ...stats
        }))
      }
    });
  } catch (error) {
    console.error('Get product performance report error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get top selling products
export const getTopSellingProducts = async (req: AuthRequest, res: Response) => {
  try {
    const { branchId = '', limit = 10 } = req.query;

    const prisma = await getPrisma();
    console.log('Top selling products request:', { branchId, limit });
    console.log('User context:', { userId: req.user?.id, createdBy: req.user?.createdBy, role: req.user?.role });

    // Build where clause with data isolation
    const where: any = buildBranchWhereClause(req, {});

    if (branchId) {
      where.branchId = branchId;
    }

    // Get top selling products
    const topProducts = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: {
        sale: where
      },
      _sum: {
        quantity: true,
        totalPrice: true
      },
      _count: {
        id: true
      },
      orderBy: {
        _sum: {
          quantity: 'desc'
        }
      },
      take: Number(limit)
    });

    // Get product details
    const productsWithDetails = await Promise.all(
      topProducts.map(async (item: any) => {
        const product = await prisma.product.findUnique({
          where: { id: item.productId },
          select: {
            id: true,
            name: true,
            // sellingPrice and stock are now managed through batches
            category: {
              select: {
                name: true
              }
            }
          }
        });
        return {
          productId: item.productId,
          totalQuantity: item._sum?.quantity || 0,
          totalRevenue: item._sum?.totalPrice || 0,
          totalSales: item._count?.id || 0,
          product
        };
      })
    );

    return res.json({
      success: true,
      data: productsWithDetails
    });
  } catch (error) {
    console.error('Get top selling products error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get sales by payment method
export const getSalesByPaymentMethod = async (req: AuthRequest, res: Response) => {
  try {
    const { branchId = '' } = req.query;

    const prisma = await getPrisma();
    console.log('Sales by payment method request:', { branchId });
    console.log('User context:', { userId: req.user?.id, createdBy: req.user?.createdBy, role: req.user?.role });

    // Build where clause with data isolation
    const where: any = buildBranchWhereClause(req, {});

    if (branchId) {
      where.branchId = branchId;
    }

    // Get sales by payment method
    const salesByPaymentMethod = await prisma.sale.groupBy({
      by: ['paymentMethod'],
      where,
      _sum: {
        totalAmount: true
      },
      _count: {
        id: true
      },
      orderBy: {
        _sum: {
          totalAmount: 'desc'
        }
      }
    });

    return res.json({
      success: true,
      data: salesByPaymentMethod
    });
  } catch (error) {
    console.error('Get sales by payment method error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get real-time dashboard data
export const getDashboardData = async (req: AuthRequest, res: Response) => {
  try {
    const { branchId = '' } = req.query;

    const prisma = await getPrisma();
    console.log('Dashboard data request:', { branchId });
    console.log('User context:', { userId: req.user?.id, createdBy: req.user?.createdBy, role: req.user?.role });

    // Build where clause with data isolation
    const where: any = buildBranchWhereClause(req, {});

    if (branchId) {
      where.branchId = branchId;
    }

    // Get the most recent day with sales data (for "today" display)
    const mostRecentSale = await prisma.sale.findFirst({
      where,
      orderBy: {
        createdAt: 'desc'
      },
      select: {
        createdAt: true
      }
    });

    let today, tomorrow;
    if (mostRecentSale) {
      // Use the most recent sale date as "today"
      today = new Date(mostRecentSale.createdAt);
      today.setHours(0, 0, 0, 0);
      tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
    } else {
      // Fallback to actual today if no sales found
      today = new Date();
      today.setHours(0, 0, 0, 0);
      tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
    }

    const todayWhere = {
      ...where,
      createdAt: {
        gte: today,
        lt: tomorrow
      },
      status: { not: 'REFUNDED' } // Exclude refunded sales
    };

    // Get today's sales summary (excluding refunded)
    const todaySales = await prisma.sale.aggregate({
      where: todayWhere,
      _sum: {
        totalAmount: true,
        subtotal: true,
        taxAmount: true,
        discountAmount: true
      },
      _count: {
        id: true
      }
    });

    // Get yesterday's sales for comparison
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayEnd = new Date(tomorrow);
    yesterdayEnd.setDate(yesterdayEnd.getDate() - 1);

    const yesterdayWhere = {
      ...where,
      createdAt: {
        gte: yesterday,
        lt: yesterdayEnd
      },
      status: { not: 'REFUNDED' } // Exclude refunded sales
    };

    const yesterdaySales = await prisma.sale.aggregate({
      where: yesterdayWhere,
      _sum: {
        totalAmount: true
      },
      _count: {
        id: true
      }
    });

    // Get this month's sales (excluding refunded)
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const monthWhere = {
      ...where,
      createdAt: {
        gte: startOfMonth,
        lte: endOfMonth
      },
      status: { not: 'REFUNDED' } // Exclude refunded sales
    };

    const monthSales = await prisma.sale.aggregate({
      where: monthWhere,
      _sum: {
        totalAmount: true
      },
      _count: {
        id: true
      }
    });

    // Get last month's sales for comparison (excluding refunded)
    const startOfLastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const endOfLastMonth = new Date(today.getFullYear(), today.getMonth(), 0);

    const lastMonthWhere = {
      ...where,
      status: { not: 'REFUNDED' }, // Exclude refunded sales
      createdAt: {
        gte: startOfLastMonth,
        lte: endOfLastMonth
      }
    };

    const lastMonthSales = await prisma.sale.aggregate({
      where: lastMonthWhere,
      _sum: {
        totalAmount: true
      },
      _count: {
        id: true
      }
    });

    // Calculate profit (assuming 30% profit margin)
    const todayProfit = (todaySales._sum?.totalAmount || 0) * 0.3;
    const monthProfit = (monthSales._sum?.totalAmount || 0) * 0.3;

    // Calculate growth percentages
    const todayGrowth = yesterdaySales._sum?.totalAmount && yesterdaySales._sum.totalAmount > 0
      ? ((todaySales._sum?.totalAmount || 0) - yesterdaySales._sum.totalAmount) / yesterdaySales._sum.totalAmount * 100
      : 0;

    const monthGrowth = lastMonthSales._sum?.totalAmount && lastMonthSales._sum.totalAmount > 0
      ? ((monthSales._sum?.totalAmount || 0) - lastMonthSales._sum.totalAmount) / lastMonthSales._sum.totalAmount * 100
      : 0;

    // Get recent sales (latest across all time for the selected scope)
    const recentSales = await prisma.sale.findMany({
      where,
      include: {
        customer: {
          select: {
            name: true,
            phone: true
          }
        },
        branch: {
          select: {
            name: true
          }
        },
        items: {
          include: {
            product: {
              select: {
                name: true
              }
            }
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 5
    });

    // Get total products count
    const totalProducts = await prisma.product.count({
      where: {
        ...where,
        isActive: true
      }
    });

    // Get total staff count (memberships + employees)
    const companyId = where.companyId || (await prisma.branch.findUnique({
      where: { id: where.branchId },
      select: { companyId: true }
    }))?.companyId;

    const [membershipCount, staffCount] = await Promise.all([
      companyId ? prisma.membership.count({
        where: {
          businessId: companyId,
          status: 'ACTIVE',
          ...(where.branchId ? {
            branches: {
              some: {
                branchId: where.branchId
              }
            }
          } : {})
        }
      }) : Promise.resolve(0),
      prisma.staffProfile.count({
        where: {
          ...where,
          isActive: true
        }
      })
    ]);

    const totalStaff = membershipCount + staffCount;

    // Get total cost and batches overview
    const batches = await prisma.batch.findMany({
      where: {
        ...where,
        isActive: true
      },
      select: {
        id: true,
        purchasePrice: true,
        quantity: true,
        expireDate: true
      }
    });

    let totalCost = 0;
    let expiredBatchesCount = 0;
    let outOfStockBatchesCount = 0;
    const now = new Date();

    batches.forEach((batch: any) => {
      const qty = batch.quantity || 0;
      totalCost += (batch.purchasePrice || 0) * qty;

      if (batch.expireDate && new Date(batch.expireDate) < now) {
        expiredBatchesCount++;
      }
      if (qty <= 0) {
        outOfStockBatchesCount++;
      }
    });

    const batchesOverview = {
      total: batches.length,
      expired: expiredBatchesCount,
      outOfStock: outOfStockBatchesCount
    };

    // Get top selling products (Most Selling)
    const saleItems = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: {
        sale: {
          ...where,
          status: { not: 'REFUNDED' }
        }
      },
      _sum: {
        quantity: true,
        totalPrice: true
      },
      orderBy: {
        _sum: {
          quantity: 'desc'
        }
      },
      take: 5
    });

    const topProducts = await Promise.all(
      saleItems.map(async (item: any) => {
        const product = await prisma.product.findUnique({
          where: { id: item.productId },
          select: { id: true, name: true, sku: true }
        });
        return {
          ...product,
          salesCount: item._sum.quantity || 0,
          revenue: item._sum.totalPrice || 0
        };
      })
    );

    // Get slow selling products
    // Logic: products with low sales or no sales in the last 30 days
    const slowSellingItems = await prisma.saleItem.groupBy({
      by: ['productId'],
      where: {
        sale: {
          ...where,
          status: { not: 'REFUNDED' }
        }
      },
      _sum: {
        quantity: true,
        totalPrice: true
      },
      orderBy: {
        _sum: {
          quantity: 'asc'
        }
      },
      take: 5
    });

    const slowProducts = await Promise.all(
      slowSellingItems.map(async (item: any) => {
        const product = await prisma.product.findUnique({
          where: { id: item.productId },
          select: { id: true, name: true, sku: true }
        });
        return {
          ...product,
          salesCount: item._sum.quantity || 0,
          revenue: item._sum.totalPrice || 0
        };
      })
    );

    // Get low stock products - calculate from batches
    // First get all active products with their batches for the branch/company
    const productsWithBatches = await prisma.product.findMany({
      where: {
        isActive: true,
        ...(where.branchId && typeof where.branchId === 'string'
          ? { branchId: where.branchId }
          : where.branchId && where.branchId.in
            ? { branchId: { in: where.branchId.in } }
            : {}),
        companyId: where.companyId
      },
      include: {
        batches: {
          where: {
            isActive: true,
            quantity: { gt: 0 }
          },
          select: {
            quantity: true
          }
        },
        branch: {
          select: {
            name: true
          }
        },
        category: {
          select: {
            name: true,
            type: true
          }
        }
      }
    });

    // Calculate actual stock and filter low stock products
    const lowStockProducts = productsWithBatches
      .map(product => ({
        id: product.id,
        name: product.name,
        sku: product.sku,
        minStock: product.minStock,
        unitsPerPack: product.unitsPerPack,
        branch_name: product.branch?.name,
        category_name: product.category?.name,
        category_type: product.category?.type,
        stock: product.batches.reduce((sum, batch) => sum + batch.quantity, 0)
      }))
      .filter(product => product.stock <= product.minStock)
      .sort((a, b) => a.stock - b.stock)
      .slice(0, 10);

    return res.json({
      success: true,
      data: {
        today: {
          revenue: todaySales._sum?.totalAmount || 0,
          profit: todayProfit,
          transactions: todaySales._count?.id || 0,
          growth: todayGrowth
        },
        month: {
          revenue: monthSales._sum?.totalAmount || 0,
          profit: monthProfit,
          transactions: monthSales._count?.id || 0,
          growth: monthGrowth
        },
        recentSales,
        totalProducts,
        totalStaff,
        mostSellingProducts: topProducts,
        slowSellingProducts: slowProducts,
        totalCost,
        batchesOverview,
        lowStockProducts
      }
    });
  } catch (error) {
    console.error('Get dashboard data error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};