import '../config/database.init';
import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AuthRequest, buildBranchWhereClause } from '../middleware/auth.middleware';

function parseDateStart(dateLike: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateLike);
  if (m) {
    return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), 0, 0, 0, 0);
  }
  return new Date(dateLike);
}
function parseDateEnd(dateLike: string): Date {
  const d = parseDateStart(dateLike);
  d.setHours(23, 59, 59, 999);
  return d;
}

function getDateRange(period: string) {
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  switch (period) {
    case 'today':
      start.setHours(0, 0, 0, 0);
      break;
    case 'yesterday':
      start.setDate(start.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      break;
    case 'last7':
      start.setDate(start.getDate() - 6);
      start.setHours(0, 0, 0, 0);
      break;
    case 'last30':
      start.setDate(start.getDate() - 29);
      start.setHours(0, 0, 0, 0);
      break;
    case 'thisMonth':
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      break;
    case 'lastMonth':
      start.setMonth(start.getMonth() - 1);
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      end.setMonth(end.getMonth());
      end.setDate(0);
      end.setHours(23, 59, 59, 999);
      break;
    case 'thisYear':
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
      break;
    default:
      start.setHours(0, 0, 0, 0);
  }
  return { start, end };
}

function buildDateFilter(req: AuthRequest) {
  const { startDate, endDate, period } = req.query as any;
  if (startDate && endDate) {
    return { gte: parseDateStart(startDate), lte: parseDateEnd(endDate) };
  }
  const range = getDateRange(period || 'today');
  return { gte: range.start, lte: range.end };
}

export const getAdvancedSalesReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = buildDateFilter(req);
    const where = buildBranchWhereClause(req, { createdAt: dateFilter, status: { not: 'REFUNDED' } });
    const { branchId } = req.query as any;
    if (branchId) where.branchId = branchId;

    const [summary, byPaymentMethod, byHour, topProducts, refunded] = await Promise.all([
      prisma.sale.aggregate({ where, _sum: { totalAmount: true, subtotal: true, taxAmount: true, discountAmount: true }, _count: { id: true } }),
      prisma.sale.groupBy({ by: ['paymentMethod'], where, _sum: { totalAmount: true }, _count: { id: true } }),
      prisma.sale.findMany({ where, select: { createdAt: true, totalAmount: true }, orderBy: { createdAt: 'asc' } }),
      prisma.saleItem.groupBy({ by: ['productId'], where: { sale: where }, _sum: { quantity: true, totalPrice: true }, _count: { id: true }, orderBy: { _sum: { quantity: 'desc' } }, take: 10 }),
      prisma.sale.aggregate({ where: { ...where, status: 'REFUNDED' }, _sum: { totalAmount: true }, _count: { id: true } }),
    ]);

    const hourlyMap: Record<string, { total: number; count: number }> = {};
    byHour.forEach((s: any) => {
      const h = new Date(s.createdAt).getHours();
      const key = `${String(h).padStart(2, '0')}:00`;
      if (!hourlyMap[key]) hourlyMap[key] = { total: 0, count: 0 };
      hourlyMap[key].total += Number(s.totalAmount || 0);
      hourlyMap[key].count += 1;
    });

    const topProductsWithDetails = await Promise.all(
      topProducts.map(async (item: any) => {
        const product = await prisma.product.findUnique({ where: { id: item.productId }, select: { name: true, category: { select: { name: true } } } });
        return { ...item, product };
      })
    );

    return res.json({
      success: true,
      data: {
        summary: { totalRevenue: summary._sum.totalAmount || 0, totalOrders: summary._count.id, totalTax: summary._sum.taxAmount || 0, totalDiscount: summary._sum.discountAmount || 0, avgOrderValue: summary._count.id > 0 ? (summary._sum.totalAmount || 0) / summary._count.id : 0 },
        byPaymentMethod,
        byHour: Object.entries(hourlyMap).map(([hour, v]) => ({ hour, ...v })).sort((a, b) => a.hour.localeCompare(b.hour)),
        topProducts: topProductsWithDetails,
        refunded: { totalRefunded: refunded._sum.totalAmount || 0, refundCount: refunded._count.id },
      },
    });
  } catch (error: any) {
    console.error('Advanced sales report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdvancedInventoryReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const where = buildBranchWhereClause(req, { isActive: true });
    const { branchId } = req.query as any;
    if (branchId) where.branchId = branchId;

    const [productsCount, batches, categories, lowStockBatches, nearExpiry] = await Promise.all([
      prisma.product.count({ where }),
      prisma.batch.findMany({ where: { isActive: true, product: where }, select: { id: true, quantity: true, purchasePrice: true, expireDate: true } }),
      prisma.category.count({ where: { OR: [{ companyId: req.membership?.business_id }, { branch: { companyId: req.membership?.business_id } }] } }),
      prisma.batch.findMany({
        where: { isActive: true, quantity: { lte: 10 }, product: where },
        select: { id: true, batchNo: true, quantity: true, expireDate: true, product: { select: { name: true } } },
        take: 20,
      }),
      prisma.batch.findMany({
        where: { isActive: true, expireDate: { lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), gte: new Date() }, product: where },
        select: { id: true, batchNo: true, quantity: true, expireDate: true, product: { select: { name: true } } },
        take: 20,
      }),
    ]);

    let totalStock = 0;
    let totalValue = 0;
    let expired = 0;
    batches.forEach((b: any) => {
      totalStock += b.quantity || 0;
      totalValue += (b.purchasePrice || 0) * (b.quantity || 0);
      if (b.expireDate && new Date(b.expireDate) < new Date()) expired++;
    });

    return res.json({
      success: true,
      data: {
        summary: { totalProducts: productsCount, totalStock, totalValue, expiredBatches: expired, lowStockItems: lowStockBatches.length, nearExpiryItems: nearExpiry.length },
        lowStockBatches,
        nearExpiryBatches: nearExpiry,
      },
    });
  } catch (error: any) {
    console.error('Advanced inventory report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdvancedCustomerReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = buildDateFilter(req);
    const customerWhere = buildBranchWhereClause(req, { isActive: true });
    const saleWhere = buildBranchWhereClause(req, {});
    const { branchId } = req.query as any;
    if (branchId) {
      customerWhere.branchId = branchId;
      saleWhere.branchId = branchId;
    }

    const [totalCustomers, vipCustomers, newCustomers, topCustomers, customerSales] = await Promise.all([
      prisma.customer.count({ where: customerWhere }),
      prisma.customer.count({ where: { ...customerWhere, isVIP: true } }),
      prisma.customer.count({ where: { ...customerWhere, createdAt: dateFilter } }),
      prisma.customer.findMany({ where: customerWhere, orderBy: { totalPurchases: 'desc' }, take: 10, select: { id: true, name: true, phone: true, totalPurchases: true, loyaltyPoints: true, isVIP: true, lastVisit: true, _count: { select: { sales: true } } } }),
      prisma.sale.groupBy({ by: ['customerId'], where: { ...saleWhere, createdAt: dateFilter, status: { not: 'REFUNDED' } }, _sum: { totalAmount: true }, _count: { id: true } }),
    ]);

    const customerIds = customerSales.map((c: any) => c.customerId).filter(Boolean);
    const customerDetails = customerIds.length > 0 ? await prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } }) : [];
    const customerMap = new Map(customerDetails.map((c: any) => [c.id, c]));

    return res.json({
      success: true,
      data: {
        summary: { totalCustomers, vipCustomers, newCustomers, averageSpent: totalCustomers > 0 ? (topCustomers.reduce((s: number, c: any) => s + (c.totalPurchases || 0), 0) / totalCustomers) : 0 },
        topCustomers,
        customerSales: customerSales.map((c: any) => ({ ...c, customerName: customerMap.get(c.customerId)?.name || 'Walk-in' })).sort((a: any, b: any) => (b._sum?.totalAmount || 0) - (a._sum?.totalAmount || 0)),
      },
    });
  } catch (error: any) {
    console.error('Advanced customer report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdvancedStaffReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = buildDateFilter(req);
    const staffWhere = buildBranchWhereClause(req, { isActive: true });
    const saleWhere = buildBranchWhereClause(req, {});
    const { branchId } = req.query as any;
    if (branchId) {
      staffWhere.branchId = branchId;
      saleWhere.branchId = branchId;
    }

    const [totalStaff, attendanceCount, shifts, commissions, salesByUser] = await Promise.all([
      prisma.staffProfile.count({ where: staffWhere }),
      prisma.attendance.count({ where: { checkIn: { gte: dateFilter.gte, lte: dateFilter.lte }, branchId: branchId || undefined } }),
      prisma.shift.findMany({ where: { shiftDate: { gte: dateFilter.gte, lte: dateFilter.lte }, branchId: branchId || undefined }, select: { staffProfileId: true, status: true } }),
      prisma.commission.aggregate({ where: { createdAt: dateFilter, branchId: branchId || undefined }, _sum: { totalAmount: true }, _count: { id: true } }),
      prisma.sale.groupBy({ by: ['userId'], where: { ...saleWhere, createdAt: dateFilter, status: { not: 'REFUNDED' } }, _sum: { totalAmount: true }, _count: { id: true } }),
    ]);

    const userIds = salesByUser.map((s: any) => s.userId).filter(Boolean);
    const users = userIds.length > 0 ? await prisma.zapeeraUser.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    const userMap = new Map(users.map((u: any) => [u.id, u]));

    const shiftMap: Record<string, { present: number; absent: number; late: number }> = {};
    shifts.forEach((s: any) => {
      const key = s.staffProfileId;
      if (!shiftMap[key]) shiftMap[key] = { present: 0, absent: 0, late: 0 };
      shiftMap[key][s.status.toLowerCase() as 'present' | 'absent' | 'late'] = (shiftMap[key][s.status.toLowerCase() as 'present' | 'absent' | 'late'] || 0) + 1;
    });

    return res.json({
      success: true,
      data: {
        summary: { totalStaff, attendanceRecords: attendanceCount, totalCommissions: commissions._sum.totalAmount || 0, commissionCount: commissions._count.id },
        salesByStaff: salesByUser.map((s: any) => ({ ...s, staffName: userMap.get(s.userId)?.name || 'Unknown' })),
        shiftSummary: Object.entries(shiftMap).map(([staffProfileId, stats]) => ({ staffProfileId, ...stats })),
      },
    });
  } catch (error: any) {
    console.error('Advanced staff report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdvancedFinancialReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = buildDateFilter(req);
    const where = buildBranchWhereClause(req, {});
    const { branchId } = req.query as any;
    if (branchId) where.branchId = branchId;

    const [salesAgg, refundsAgg, purchasesAgg] = await Promise.all([
      prisma.sale.aggregate({ where: { ...where, createdAt: dateFilter, status: { not: 'REFUNDED' } }, _sum: { totalAmount: true }, _count: { id: true } }),
      prisma.sale.aggregate({ where: { ...where, createdAt: dateFilter, status: 'REFUNDED' }, _sum: { totalAmount: true }, _count: { id: true } }),
      prisma.purchase.aggregate({ where: { ...where, createdAt: dateFilter }, _sum: { totalAmount: true }, _count: { id: true } }),
    ]);

    const totalRevenue = salesAgg._sum.totalAmount || 0;
    const totalRefunds = refundsAgg._sum.totalAmount || 0;
    const totalPurchases = purchasesAgg._sum.totalAmount || 0;
    const netProfit = totalRevenue - totalRefunds - totalPurchases;

    return res.json({
      success: true,
      data: {
        summary: { totalRevenue, totalRefunds, totalPurchases, netProfit, profitMargin: totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0 },
      },
    });
  } catch (error: any) {
    console.error('Advanced financial report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdvancedPurchaseReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = buildDateFilter(req);
    const where = buildBranchWhereClause(req, { createdAt: dateFilter });
    const { branchId, supplierId } = req.query as any;
    if (branchId) where.branchId = branchId;

    const [summary, bySupplier, byStatus, recent] = await Promise.all([
      prisma.purchase.aggregate({ where, _sum: { totalAmount: true, paidAmount: true, outstanding: true }, _count: { id: true } }),
      prisma.purchase.groupBy({ by: ['supplierId'], where, _sum: { totalAmount: true }, _count: { id: true } }),
      prisma.purchase.groupBy({ by: ['status'], where, _sum: { totalAmount: true }, _count: { id: true } }),
      prisma.purchase.findMany({ where: supplierId ? { ...where, supplierId } : where, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, invoiceNo: true, totalAmount: true, status: true, createdAt: true, supplier: { select: { name: true } } } }),
    ]);

    const supplierIds = bySupplier.map((s: any) => s.supplierId).filter(Boolean);
    const suppliers = supplierIds.length > 0 ? await prisma.supplier.findMany({ where: { id: { in: supplierIds } }, select: { id: true, name: true } }) : [];
    const supplierMap = new Map(suppliers.map((s: any) => [s.id, s]));

    return res.json({
      success: true,
      data: {
        summary: { totalPurchases: summary._count.id, totalAmount: summary._sum.totalAmount || 0, paidAmount: summary._sum.paidAmount || 0, outstanding: summary._sum.outstanding || 0 },
        bySupplier: bySupplier.map((s: any) => ({ ...s, supplierName: supplierMap.get(s.supplierId)?.name || 'Unknown' })),
        byStatus,
        recentPurchases: recent,
      },
    });
  } catch (error: any) {
    console.error('Advanced purchase report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
