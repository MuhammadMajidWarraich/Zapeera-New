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
    const { branchId } = req.query as any;
    const businessId = req.membership?.business_id;
    const staffMembershipFilter: any = {};
    if (businessId) staffMembershipFilter.businessId = businessId;
    if (branchId) staffMembershipFilter.branches = { some: { branchId } };
    const staffWhere = {
      isActive: true,
      ...(Object.keys(staffMembershipFilter).length ? { membership: staffMembershipFilter } : {})
    };
    const saleWhere = buildBranchWhereClause(req, {});
    if (branchId) {
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

// Helper to build a sale where clause scoped to company/branch with date filter
function buildSaleWhere(req: AuthRequest, dateFilter: { gte: Date; lte: Date }) {
  const where: any = { createdAt: dateFilter, status: { not: 'REFUNDED' } };
  const scope = buildBranchWhereClause(req, {});
  if (scope.companyId) where.companyId = scope.companyId;
  const { branchId } = req.query as any;
  if (branchId) where.branchId = branchId;
  else if (scope.branchId) where.branchId = scope.branchId;
  return where;
}

export const getAdvancedRefundsReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = buildDateFilter(req);
    const saleWhere: any = { createdAt: dateFilter };
    const scope = buildBranchWhereClause(req, {});
    if (scope.companyId) saleWhere.companyId = scope.companyId;
    const { branchId } = req.query as any;
    if (branchId) saleWhere.branchId = branchId;
    else if (scope.branchId) saleWhere.branchId = scope.branchId;

    const where: any = { originalSale: saleWhere };

    const [summary, recent] = await Promise.all([
      prisma.refund.aggregate({ where, _sum: { refundAmount: true }, _count: { id: true } }),
      prisma.refund.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          refundAmount: true,
          refundReason: true,
          status: true,
          createdAt: true,
          originalSale: { select: { invoiceNumber: true, customer: { select: { name: true } } } },
          items: { select: { quantity: true, product: { select: { name: true } } } },
        },
      }),
    ]);

    return res.json({
      success: true,
      data: {
        summary: { totalRefunds: summary._count.id, totalRefundAmount: summary._sum.refundAmount || 0 },
        recent,
      },
    });
  } catch (error: any) {
    console.error('Advanced refunds report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdvancedExpiryReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const scope = buildBranchWhereClause(req, { isActive: true });
    const { branchId } = req.query as any;
    if (branchId) scope.branchId = branchId;

    const now = new Date();
    const in30d = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    const batches = await prisma.batch.findMany({
      where: scope,
      select: { id: true, quantity: true, purchasePrice: true, expireDate: true, product: { select: { name: true } } },
    });

    let expiredItems = 0;
    let expiredValue = 0;
    let expiringSoon = 0;
    let totalValue = 0;
    const byMonth: Record<string, number> = {};

    batches.forEach((b: any) => {
      const qty = b.quantity || 0;
      const value = (b.purchasePrice || 0) * qty;
      totalValue += value;
      if (b.expireDate) {
        const d = new Date(b.expireDate);
        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (d < now) {
          expiredItems += qty;
          expiredValue += value;
        } else if (d <= in30d) {
          expiringSoon += qty;
        }
        byMonth[monthKey] = (byMonth[monthKey] || 0) + 1;
      }
    });

    const wasteRate = totalValue > 0 ? (expiredValue / totalValue) * 100 : 0;

    return res.json({
      success: true,
      data: {
        summary: { expiredItems, expiringSoon, expiryValue: expiredValue, wasteRate },
        byMonth: Object.entries(byMonth).map(([month, count]) => ({ month, count })).sort((a, b) => a.month.localeCompare(b.month)),
      },
    });
  } catch (error: any) {
    console.error('Advanced expiry report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdvancedCategoryReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = buildDateFilter(req);
    const scope = buildBranchWhereClause(req, {});

    const categories = await prisma.category.findMany({
      where: { OR: [{ companyId: scope.companyId }, { branch: { companyId: scope.companyId } }] },
      select: { id: true, name: true },
    });

    const saleWhere: any = { sale: { createdAt: dateFilter, status: { not: 'REFUNDED' } }, product: {} };
    if (scope.companyId) saleWhere.product.companyId = scope.companyId;
    const { branchId } = req.query as any;
    if (branchId) saleWhere.product.branchId = branchId;
    else if (scope.branchId) saleWhere.product.branchId = scope.branchId;

    const items = await prisma.saleItem.findMany({
      where: saleWhere,
      select: { totalPrice: true, product: { select: { categoryId: true } } },
    });

    const catSales: Record<string, number> = {};
    items.forEach((i: any) => {
      const cid = i.product?.categoryId;
      if (cid) catSales[cid] = (catSales[cid] || 0) + (i.totalPrice || 0);
    });

    let totalCategorySales = 0;
    let topCategory = '—';
    let topValue = 0;
    const byCategory = categories.map((c: any) => {
      const v = catSales[c.id] || 0;
      totalCategorySales += v;
      if (v > topValue) {
        topValue = v;
        topCategory = c.name;
      }
      return { categoryName: c.name, _sum: { totalAmount: v } };
    });

    return res.json({
      success: true,
      data: {
        summary: {
          totalCategories: categories.length,
          totalCategorySales,
          topCategory,
          avgCategoryValue: categories.length > 0 ? totalCategorySales / categories.length : 0,
        },
        byCategory,
      },
    });
  } catch (error: any) {
    console.error('Advanced category report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdvancedBranchReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = buildDateFilter(req);
    const scope = buildBranchWhereClause(req, {});

    const branches = await prisma.branch.findMany({
      where: { companyId: scope.companyId },
      select: { id: true, name: true },
    });

    const saleWhere: any = { createdAt: dateFilter, status: { not: 'REFUNDED' } };
    if (scope.companyId) saleWhere.companyId = scope.companyId;

    const grouped = await prisma.sale.groupBy({
      by: ['branchId'],
      where: saleWhere,
      _sum: { totalAmount: true },
    });

    const revMap = new Map(grouped.map((g: any) => [g.branchId, g._sum?.totalAmount || 0]));

    let totalBranchRevenue = 0;
    let topBranch = '—';
    let topValue = 0;
    const byBranch = branches.map((b: any) => {
      const v = revMap.get(b.id) || 0;
      totalBranchRevenue += v;
      if (v > topValue) {
        topValue = v;
        topBranch = b.name;
      }
      return { branchName: b.name, totalRevenue: v };
    });

    return res.json({
      success: true,
      data: {
        summary: {
          totalBranches: branches.length,
          topBranch,
          totalBranchRevenue,
          avgBranchSales: branches.length > 0 ? totalBranchRevenue / branches.length : 0,
        },
        byBranch,
      },
    });
  } catch (error: any) {
    console.error('Advanced branch report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdvancedTaxReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = buildDateFilter(req);
    const saleWhere: any = buildSaleWhere(req, dateFilter);

    const sales = await prisma.sale.findMany({
      where: saleWhere,
      select: { totalAmount: true, taxAmount: true, items: { select: { totalPrice: true, product: { select: { categoryId: true } } } } },
    });

    let totalTax = 0;
    let taxableSales = 0;
    let exemptSales = 0;
    const catMap: Record<string, { sales: number; tax: number }> = {};

    sales.forEach((s: any) => {
      const tax = s.taxAmount || 0;
      const total = s.totalAmount || 0;
      totalTax += tax;
      if (tax > 0) taxableSales += total;
      else exemptSales += total;

      const itemTotal = (s.items || []).reduce((sum: number, i: any) => sum + (i.totalPrice || 0), 0);
      (s.items || []).forEach((i: any) => {
        const cid = i.product?.categoryId;
        if (!cid) return;
        if (!catMap[cid]) catMap[cid] = { sales: 0, tax: 0 };
        catMap[cid].sales += i.totalPrice || 0;
        catMap[cid].tax += itemTotal > 0 ? (tax * (i.totalPrice || 0)) / itemTotal : 0;
      });
    });

    const categoryIds = Object.keys(catMap);
    const categories = categoryIds.length > 0
      ? await prisma.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } })
      : [];
    const catNameMap = new Map(categories.map((c: any) => [c.id, c.name]));

    return res.json({
      success: true,
      data: {
        summary: {
          totalTax,
          taxRate: taxableSales > 0 ? (totalTax / taxableSales) * 100 : 0,
          taxableSales,
          exemptSales,
        },
        byCategory: Object.entries(catMap).map(([cid, v]) => ({ categoryName: catNameMap.get(cid) || 'Unknown', taxAmount: v.tax })),
      },
    });
  } catch (error: any) {
    console.error('Advanced tax report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdvancedPaymentTrendsReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = buildDateFilter(req);
    const saleWhere = buildSaleWhere(req, dateFilter);

    const byMethod = await prisma.sale.groupBy({
      by: ['paymentMethod'],
      where: saleWhere,
      _sum: { totalAmount: true },
      _count: { id: true },
    });

    let cashPayments = 0;
    let cardPayments = 0;
    byMethod.forEach((m: any) => {
      const v = m._sum?.totalAmount || 0;
      const method = String(m.paymentMethod || '').toUpperCase();
      if (method.includes('CASH') || method === 'COD') cashPayments += v;
      else cardPayments += v;
    });

    return res.json({
      success: true,
      data: {
        summary: { cashPayments, cardPayments },
        byMethod,
      },
    });
  } catch (error: any) {
    console.error('Advanced payment trends report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdvancedAttendanceReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = buildDateFilter(req);
    const scope = buildBranchWhereClause(req, {});
    const { branchId } = req.query as any;

    const where: any = { checkIn: { gte: dateFilter.gte, lte: dateFilter.lte } };
    if (branchId) where.branchId = branchId;
    else if (scope.branchId) where.branchId = scope.branchId;

    const records = await prisma.attendance.findMany({
      where,
      select: {
        id: true,
        status: true,
        totalHours: true,
        checkIn: true,
        staffProfile: { select: { membership: { select: { user: { select: { name: true } } } } } },
      },
    });

    let present = 0;
    let late = 0;
    let absent = 0;
    let totalHours = 0;
    const byStaff: Record<string, { present: number; late: number; absent: number; totalHours: number }> = {};

    records.forEach((r: any) => {
      const name = r.staffProfile?.membership?.user?.name || 'Unknown';
      const status = String(r.status || 'PRESENT').toUpperCase();
      if (status === 'PRESENT') present++;
      else if (status === 'LATE') late++;
      else if (status === 'ABSENT') absent++;
      totalHours += r.totalHours || 0;
      if (!byStaff[name]) byStaff[name] = { present: 0, late: 0, absent: 0, totalHours: 0 };
      byStaff[name][status.toLowerCase() as 'present' | 'late' | 'absent']++;
      byStaff[name].totalHours += r.totalHours || 0;
    });

    return res.json({
      success: true,
      data: {
        summary: {
          totalRecords: records.length,
          present,
          late,
          absent,
          avgHours: records.length > 0 ? totalHours / records.length : 0,
        },
        byStaff: Object.entries(byStaff).map(([staffName, v]) => ({ staffName, ...v })),
      },
    });
  } catch (error: any) {
    console.error('Advanced attendance report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdvancedStockMovementsReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = buildDateFilter(req);
    const scope = buildBranchWhereClause(req, {});

    const where: any = { createdAt: { gte: dateFilter.gte, lte: dateFilter.lte }, product: {} };
    if (scope.companyId) where.product.companyId = scope.companyId;
    const { branchId } = req.query as any;
    if (branchId) where.product.branchId = branchId;
    else if (scope.branchId) where.product.branchId = scope.branchId;

    const movements = await prisma.stockMovement.findMany({
      where,
      select: { id: true, type: true, quantity: true, reason: true, createdAt: true, product: { select: { name: true } } },
    });

    let transfers = 0;
    let adjustments = 0;
    let totalMoved = 0;
    movements.forEach((m: any) => {
      const type = String(m.type || '').toUpperCase();
      if (type === 'IN' || type === 'OUT') transfers++;
      else adjustments++;
      totalMoved += Math.abs(m.quantity || 0);
    });

    return res.json({
      success: true,
      data: {
        summary: { transfers, adjustments, totalMoved, movementValue: 0 },
        movements,
      },
    });
  } catch (error: any) {
    console.error('Advanced stock movements report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdvancedExpenseReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = buildDateFilter(req);
    const scope = buildBranchWhereClause(req, {});
    const { branchId } = req.query as any;

    // No expense model exists yet; expenses come from purchases outstanding as proxy
    const purchaseWhere: any = { createdAt: { gte: dateFilter.gte, lte: dateFilter.lte } };
    if (scope.companyId) purchaseWhere.companyId = scope.companyId;
    if (branchId) purchaseWhere.branchId = branchId;
    else if (scope.branchId) purchaseWhere.branchId = scope.branchId;

    const [purchases, sales] = await Promise.all([
      prisma.purchase.aggregate({ where: purchaseWhere, _sum: { totalAmount: true, outstanding: true }, _count: { id: true } }),
      prisma.sale.aggregate({ where: buildSaleWhere(req, dateFilter), _sum: { discountAmount: true } }),
    ]);

    const totalExpenses = (purchases._sum?.totalAmount || 0);
    const operatingCosts = totalExpenses;
    const fixedCosts = 0;
    const variableCosts = totalExpenses;

    return res.json({
      success: true,
      data: {
        summary: { totalExpenses, operatingCosts, fixedCosts, variableCosts },
      },
    });
  } catch (error: any) {
    console.error('Advanced expense report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdvancedShiftReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = buildDateFilter(req);
    const scope = buildBranchWhereClause(req, {});
    const { branchId } = req.query as any;

    const where: any = { shiftDate: { gte: dateFilter.gte, lte: dateFilter.lte } };
    if (branchId) where.branchId = branchId;
    else if (scope.branchId) where.branchId = scope.branchId;

    const shifts = await prisma.shift.findMany({
      where,
      select: {
        id: true,
        status: true,
        openingBalance: true,
        cashIn: true,
        cashOut: true,
        expectedBalance: true,
        actualBalance: true,
        difference: true,
        staffProfile: { select: { membership: { select: { user: { select: { name: true } } } } } },
      },
    });

    let active = 0;
    let completed = 0;
    let netDifference = 0;
    const byStaff: Record<string, { shifts: number; cashIn: number; cashOut: number; difference: number }> = {};

    shifts.forEach((s: any) => {
      const name = s.staffProfile?.membership?.user?.name || 'Unknown';
      const status = String(s.status || '').toUpperCase();
      if (status === 'ACTIVE') active++;
      else if (status === 'COMPLETED' || status === 'CLOSED') completed++;
      netDifference += s.difference || 0;
      if (!byStaff[name]) byStaff[name] = { shifts: 0, cashIn: 0, cashOut: 0, difference: 0 };
      byStaff[name].shifts++;
      byStaff[name].cashIn += s.cashIn || 0;
      byStaff[name].cashOut += s.cashOut || 0;
      byStaff[name].difference += s.difference || 0;
    });

    return res.json({
      success: true,
      data: {
        summary: { totalShifts: shifts.length, active, completed, netDifference },
        byStaff: Object.entries(byStaff).map(([staffName, v]) => ({ staffName, ...v })),
      },
    });
  } catch (error: any) {
    console.error('Advanced shift report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdvancedSupplierReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = buildDateFilter(req);
    const scope = buildBranchWhereClause(req, {});
    const { branchId } = req.query as any;

    const supplierWhere: any = { isActive: true };
    if (scope.companyId) supplierWhere.companyId = scope.companyId;
    if (branchId) supplierWhere.branchId = branchId;
    else if (scope.branchId) supplierWhere.branchId = scope.branchId;

    const purchaseWhere: any = { purchaseDate: { gte: dateFilter.gte, lte: dateFilter.lte } };
    if (scope.companyId) purchaseWhere.companyId = scope.companyId;
    if (branchId) purchaseWhere.branchId = branchId;
    else if (scope.branchId) purchaseWhere.branchId = scope.branchId;

    const [suppliers, purchases] = await Promise.all([
      prisma.supplier.findMany({ where: supplierWhere, select: { id: true, name: true } }),
      prisma.purchase.findMany({
        where: purchaseWhere,
        select: { supplierId: true, totalAmount: true, paidAmount: true, outstanding: true },
      }),
    ]);

    const map: Record<string, { purchases: number; totalAmount: number; paidAmount: number; outstanding: number }> = {};
    suppliers.forEach((s: any) => {
      map[s.id] = { purchases: 0, totalAmount: 0, paidAmount: 0, outstanding: 0 };
    });
    purchases.forEach((p: any) => {
      if (!map[p.supplierId]) return;
      map[p.supplierId].purchases++;
      map[p.supplierId].totalAmount += p.totalAmount || 0;
      map[p.supplierId].paidAmount += p.paidAmount || 0;
      map[p.supplierId].outstanding += p.outstanding || 0;
    });

    const bySupplier = suppliers.map((s: any) => ({ supplierName: s.name, ...map[s.id] }));
    const totalAmount = bySupplier.reduce((sum, s) => sum + s.totalAmount, 0);
    const outstanding = bySupplier.reduce((sum, s) => sum + s.outstanding, 0);

    return res.json({
      success: true,
      data: {
        summary: { totalSuppliers: suppliers.length, totalPurchases: purchases.length, totalAmount, outstanding },
        bySupplier,
      },
    });
  } catch (error: any) {
    console.error('Advanced supplier report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdvancedRetentionReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = buildDateFilter(req);
    const scope = buildBranchWhereClause(req, {});
    const { branchId } = req.query as any;

    const saleWhere: any = { createdAt: { gte: dateFilter.gte, lte: dateFilter.lte }, status: { not: 'REFUNDED' } };
    if (scope.companyId) saleWhere.companyId = scope.companyId;
    if (branchId) saleWhere.branchId = branchId;
    else if (scope.branchId) saleWhere.branchId = scope.branchId;

    const [customerCount, sales] = await Promise.all([
      prisma.customer.count({ where: { ...scope, isActive: true } }),
      prisma.sale.findMany({ where: saleWhere, select: { customerId: true, totalAmount: true } }),
    ]);

    const ordersByCustomer: Record<string, { orders: number; spent: number }> = {};
    sales.forEach((s: any) => {
      if (!s.customerId) return;
      if (!ordersByCustomer[s.customerId]) ordersByCustomer[s.customerId] = { orders: 0, spent: 0 };
      ordersByCustomer[s.customerId].orders++;
      ordersByCustomer[s.customerId].spent += s.totalAmount || 0;
    });

    const repeatCustomers = Object.values(ordersByCustomer).filter((v) => v.orders > 1).length;
    const totalOrders = sales.length;

    const customerIds = Object.keys(ordersByCustomer);
    const customers = customerIds.length > 0
      ? await prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } })
      : [];
    const nameMap = new Map(customers.map((c: any) => [c.id, c.name]));

    const topCustomers = Object.entries(ordersByCustomer)
      .map(([cid, v]) => ({ customerName: nameMap.get(cid) || 'Unknown', orderCount: v.orders, totalSpent: v.spent }))
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 10);

    return res.json({
      success: true,
      data: {
        summary: {
          totalCustomers: customerCount,
          repeatCustomers,
          retentionRate: customerCount > 0 ? (repeatCustomers / customerCount) * 100 : 0,
          avgOrdersPerCustomer: customerCount > 0 ? totalOrders / customerCount : 0,
        },
        topCustomers,
      },
    });
  } catch (error: any) {
    console.error('Advanced retention report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdvancedCommissionReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = buildDateFilter(req);
    const scope = buildBranchWhereClause(req, {});
    const { branchId } = req.query as any;

    const where: any = { createdAt: { gte: dateFilter.gte, lte: dateFilter.lte } };
    if (branchId) where.branchId = branchId;
    else if (scope.branchId) where.branchId = scope.branchId;

    const commissions = await prisma.commission.findMany({
      where,
      select: {
        id: true,
        status: true,
        totalSales: true,
        totalTransactions: true,
        totalCommission: true,
        totalAmount: true,
        staffProfile: { select: { membership: { select: { user: { select: { name: true } } } } } },
      },
    });

    let paid = 0;
    let pending = 0;
    const byStaff: Record<string, { totalSales: number; totalTransactions: number; totalCommission: number; totalAmount: number; status: string }> = {};

    commissions.forEach((c: any) => {
      const name = c.staffProfile?.membership?.user?.name || 'Unknown';
      if (String(c.status || '').toUpperCase() === 'PAID') paid += c.totalAmount || 0;
      else pending += c.totalAmount || 0;
      if (!byStaff[name]) byStaff[name] = { totalSales: 0, totalTransactions: 0, totalCommission: 0, totalAmount: 0, status: c.status || 'PENDING' };
      byStaff[name].totalSales += c.totalSales || 0;
      byStaff[name].totalTransactions += c.totalTransactions || 0;
      byStaff[name].totalCommission += c.totalCommission || 0;
      byStaff[name].totalAmount += c.totalAmount || 0;
    });

    return res.json({
      success: true,
      data: {
        summary: { totalCommissions: commissions.length, totalAmount: commissions.reduce((s, c) => s + (c.totalAmount || 0), 0), paid, pending },
        byStaff: Object.entries(byStaff).map(([staffName, v]) => ({ staffName, ...v })),
      },
    });
  } catch (error: any) {
    console.error('Advanced commission report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdvancedProfitReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = buildDateFilter(req);
    const saleWhere = buildSaleWhere(req, dateFilter);
    const scope = buildBranchWhereClause(req, {});
    const purchaseWhere: any = { createdAt: dateFilter };
    if (scope.companyId) purchaseWhere.companyId = scope.companyId;
    const { branchId } = req.query as any;
    if (branchId) purchaseWhere.branchId = branchId;
    else if (scope.branchId) purchaseWhere.branchId = scope.branchId;

    const [sales, purchases, refunds] = await Promise.all([
      prisma.sale.aggregate({ where: saleWhere, _sum: { totalAmount: true } }),
      prisma.purchase.aggregate({ where: purchaseWhere, _sum: { totalAmount: true } }),
      prisma.refund.aggregate({ where: { originalSale: saleWhere }, _sum: { refundAmount: true } }),
    ]);

    const revenue = sales._sum?.totalAmount || 0;
    const cogs = purchases._sum?.totalAmount || 0;
    const refunded = refunds._sum?.refundAmount || 0;
    const grossProfit = revenue - cogs;
    const netProfit = grossProfit - refunded;

    return res.json({
      success: true,
      data: {
        summary: {
          grossProfit,
          netProfit,
          grossMargin: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
          netMargin: revenue > 0 ? (netProfit / revenue) * 100 : 0,
        },
      },
    });
  } catch (error: any) {
    console.error('Advanced profit report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdvancedCashflowReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = buildDateFilter(req);
    const saleWhere = buildSaleWhere(req, dateFilter);
    const scope = buildBranchWhereClause(req, {});
    const purchaseWhere: any = { createdAt: dateFilter };
    if (scope.companyId) purchaseWhere.companyId = scope.companyId;
    const { branchId } = req.query as any;
    if (branchId) purchaseWhere.branchId = branchId;
    else if (scope.branchId) purchaseWhere.branchId = scope.branchId;

    const [sales, purchases, refunds] = await Promise.all([
      prisma.sale.aggregate({ where: saleWhere, _sum: { totalAmount: true, paidAmount: true } }),
      prisma.purchase.aggregate({ where: purchaseWhere, _sum: { totalAmount: true, paidAmount: true } }),
      prisma.refund.aggregate({ where: { originalSale: saleWhere }, _sum: { refundAmount: true } }),
    ]);

    const cashInflow = (sales._sum?.paidAmount || 0) || (sales._sum?.totalAmount || 0);
    const cashOutflow = (purchases._sum?.paidAmount || 0) + (refunds._sum?.refundAmount || 0);
    const netCashflow = cashInflow - cashOutflow;

    return res.json({
      success: true,
      data: {
        summary: { cashInflow, cashOutflow, netCashflow, cashBalance: netCashflow },
      },
    });
  } catch (error: any) {
    console.error('Advanced cashflow report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdvancedBatchReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const scope = buildBranchWhereClause(req, { isActive: true });
    const { branchId } = req.query as any;
    if (branchId) scope.branchId = branchId;

    const batches = await prisma.batch.findMany({
      where: scope,
      select: {
        id: true,
        batchNo: true,
        quantity: true,
        purchasePrice: true,
        sellingPrice: true,
        expireDate: true,
        isActive: true,
        product: { select: { name: true } },
      },
    });

    let activeBatches = 0;
    let expiredBatches = 0;
    let totalValue = 0;
    const now = new Date();

    batches.forEach((b: any) => {
      if (b.isActive) activeBatches++;
      if (b.expireDate && new Date(b.expireDate) < now) expiredBatches++;
      totalValue += (b.purchasePrice || 0) * (b.quantity || 0);
    });

    return res.json({
      success: true,
      data: {
        summary: { totalBatches: batches.length, activeBatches, expiredBatches, totalValue },
        batches,
      },
    });
  } catch (error: any) {
    console.error('Advanced batch report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdvancedDiscountReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = buildDateFilter(req);
    const saleWhere = buildSaleWhere(req, dateFilter);

    const [summary, byMethod] = await Promise.all([
      prisma.sale.aggregate({ where: saleWhere, _sum: { discountAmount: true, totalAmount: true }, _count: { id: true } }),
      prisma.sale.groupBy({ by: ['paymentMethod'], where: saleWhere, _sum: { discountAmount: true }, _count: { id: true } }),
    ]);

    const totalDiscount = summary._sum?.discountAmount || 0;
    const totalOrders = summary._count?.id || 0;
    const totalSales = summary._sum?.totalAmount || 0;

    return res.json({
      success: true,
      data: {
        summary: {
          totalDiscount,
          totalOrders,
          avgDiscount: totalOrders > 0 ? totalDiscount / totalOrders : 0,
          discountRate: totalSales > 0 ? (totalDiscount / (totalSales + totalDiscount)) * 100 : 0,
        },
        byMethod,
      },
    });
  } catch (error: any) {
    console.error('Advanced discount report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdvancedProductReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = buildDateFilter(req);
    const scope = buildBranchWhereClause(req, {});

    const productWhere: any = { isActive: true };
    if (scope.companyId) productWhere.companyId = scope.companyId;
    const { branchId } = req.query as any;
    if (branchId) productWhere.branchId = branchId;
    else if (scope.branchId) productWhere.branchId = scope.branchId;

    const saleItemWhere: any = { sale: { createdAt: dateFilter, status: { not: 'REFUNDED' } }, product: {} };
    if (scope.companyId) saleItemWhere.product.companyId = scope.companyId;
    if (branchId) saleItemWhere.product.branchId = branchId;
    else if (scope.branchId) saleItemWhere.product.branchId = scope.branchId;

    const [totalProducts, items] = await Promise.all([
      prisma.product.count({ where: productWhere }),
      prisma.saleItem.findMany({
        where: saleItemWhere,
        select: { quantity: true, totalPrice: true, product: { select: { name: true } } },
      }),
    ]);

    const byProduct: Record<string, { productName: string; quantity: number; revenue: number; orders: number }> = {};
    items.forEach((i: any) => {
      const name = i.product?.name || 'Unknown';
      if (!byProduct[name]) byProduct[name] = { productName: name, quantity: 0, revenue: 0, orders: 0 };
      byProduct[name].quantity += i.quantity || 0;
      byProduct[name].revenue += i.totalPrice || 0;
      byProduct[name].orders++;
    });

    const productList = Object.values(byProduct).sort((a, b) => b.revenue - a.revenue);
    const totalRevenue = productList.reduce((s, p) => s + p.revenue, 0);

    return res.json({
      success: true,
      data: {
        summary: {
          totalProducts,
          totalRevenue,
          avgRevenue: productList.length > 0 ? totalRevenue / productList.length : 0,
          topProduct: productList.length > 0 ? productList[0].productName : '—',
        },
        byProduct: productList.slice(0, 20),
      },
    });
  } catch (error: any) {
    console.error('Advanced product report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdvancedTurnoverReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = buildDateFilter(req);
    const scope = buildBranchWhereClause(req, {});

    const productWhere: any = { isActive: true };
    if (scope.companyId) productWhere.companyId = scope.companyId;
    const { branchId } = req.query as any;
    if (branchId) productWhere.branchId = branchId;
    else if (scope.branchId) productWhere.branchId = scope.branchId;

    const [products, saleItems] = await Promise.all([
      prisma.product.findMany({ where: productWhere, select: { id: true, name: true, batches: { select: { quantity: true, purchasePrice: true, isActive: true } } } }),
      prisma.saleItem.findMany({
        where: { sale: { createdAt: dateFilter, status: { not: 'REFUNDED' } }, product: productWhere },
        select: { quantity: true, productId: true, totalPrice: true },
      }),
    ]);

    const sold: Record<string, number> = {};
    const cogs: Record<string, number> = {};
    saleItems.forEach((i: any) => {
      sold[i.productId] = (sold[i.productId] || 0) + (i.quantity || 0);
      cogs[i.productId] = (cogs[i.productId] || 0) + (i.totalPrice || 0);
    });

    const byProduct = products.map((p: any) => {
      const avgStock = (p.batches || []).filter((b: any) => b.isActive).reduce((s: number, b: any) => s + (b.quantity || 0), 0);
      const unitsSold = sold[p.id] || 0;
      const cost = cogs[p.id] || 0;
      const inventoryValue = (p.batches || []).filter((b: any) => b.isActive).reduce((s: number, b: any) => s + ((b.purchasePrice || 0) * (b.quantity || 0)), 0);
      return {
        productName: p.name,
        unitsSold,
        avgStock,
        inventoryValue,
        turnover: avgStock > 0 ? unitsSold / avgStock : 0,
      };
    });

    const inventoryValue = byProduct.reduce((s, p) => s + p.inventoryValue, 0);
    const totalCostOfGoods = saleItems.reduce((s, i) => s + (i.totalPrice || 0), 0);
    const avgInventory = products.length > 0 ? inventoryValue / products.length : 0;

    return res.json({
      success: true,
      data: {
        summary: {
          totalProducts: products.length,
          inventoryValue,
          totalCostOfGoods,
          turnoverRatio: avgInventory > 0 ? totalCostOfGoods / avgInventory : 0,
        },
        byProduct: byProduct.filter((p: any) => p.unitsSold > 0).sort((a: any, b: any) => b.unitsSold - a.unitsSold).slice(0, 20),
      },
    });
  } catch (error: any) {
    console.error('Advanced turnover report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAdvancedDailyReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = buildDateFilter(req);
    const saleWhere = buildSaleWhere(req, dateFilter);

    const sales = await prisma.sale.findMany({
      where: saleWhere,
      select: { totalAmount: true, createdAt: true },
    });

    const byDay: Record<string, { total: number; count: number }> = {};
    sales.forEach((s: any) => {
      const d = new Date(s.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!byDay[key]) byDay[key] = { total: 0, count: 0 };
      byDay[key].total += s.totalAmount || 0;
      byDay[key].count++;
    });

    const daily = Object.entries(byDay).map(([day, v]) => ({ day, ...v })).sort((a, b) => a.day.localeCompare(b.day));
    const totalRevenue = sales.reduce((s, x) => s + (x.totalAmount || 0), 0);
    const bestDay = daily.length > 0 ? daily.reduce((a, b) => (b.total > a.total ? b : a)).day : '—';

    return res.json({
      success: true,
      data: {
        summary: { totalRevenue, totalOrders: sales.length, bestDay },
        byDay: daily,
      },
    });
  } catch (error: any) {
    console.error('Advanced daily report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
