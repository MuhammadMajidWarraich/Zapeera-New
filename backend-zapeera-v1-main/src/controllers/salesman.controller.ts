// ─── Salesman management (gap item 7) ───────────────────────────────
// Salesmen are staff members flagged StaffProfile.isSalesman (set via
// the staff create/update endpoints). Their SALES are tracked by the
// attribution that already exists — Sale.salespersonId when the POS
// credits a sale to a salesman, else Sale.userId for the cashier —
// and the commissions system aggregates on exactly that rule, so
// nothing here duplicates commission math: the performance views below
// read the same sales + Commission rows the commissions endpoints do.
//
// Endpoints are read-only: salesman records themselves are staff
// records (StaffProfile), created/edited through /api/staff.

import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import logger from '../utils/logger';

// The caller's business id, resolved by the multitenancy middleware
// (same shape the commission controller uses).
const callerBusinessId = (req: Request): string | null =>
  (req as any).business_id || (req as any).membership?.business_id || null;

// Default range: the current calendar month, so the performance view
// opens on "this month" without the client sending dates.
const defaultRange = (): { startDate: Date; endDate: Date } => {
  const now = new Date();
  return {
    startDate: new Date(now.getFullYear(), now.getMonth(), 1),
    endDate: new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  };
};

const parseRange = (req: Request): { startDate: Date; endDate: Date } => {
  const { startDate, endDate } = req.query;
  const range = defaultRange();
  if (startDate) range.startDate = new Date(startDate as string);
  if (endDate) {
    const e = new Date(endDate as string);
    e.setHours(23, 59, 59, 999);
    range.endDate = e;
  }
  return range;
};

// The salesman → user include shared by both endpoints.
const salesmanInclude = {
  membership: {
    select: {
      id: true,
      userId: true,
      businessId: true,
      user: { select: { id: true, name: true, email: true, phone: true } }
    }
  }
};

// Sales attributed to one seller (USER id): the same OR rule the
// commission calculation uses — a sale counts for the staff member it
// was ATTRIBUTED to (Sale.salespersonId) when set, and for its cashier
// (Sale.userId) otherwise, so an attributed sale never double-counts.
// Exported for the item-7 tests (the attribution rule is money logic).
export const attributedSalesWhere = (
  staffUserId: string,
  companyId: string,
  range: { startDate: Date; endDate: Date },
  branchId?: string | null
): any => ({
  OR: [
    { salespersonId: staffUserId },
    { salespersonId: null, userId: staffUserId }
  ],
  companyId,
  status: 'COMPLETED',
  createdAt: { gte: range.startDate, lte: range.endDate },
  ...(branchId ? { branchId } : {})
});

// GET /api/salesmen — the POS salesman picker + the salesman roster.
// Active salesmen of the caller's business only; optional branchId /
// search (?q= matches name, email or employeeId).
export const listSalesmen = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const businessId = callerBusinessId(req);
    if (!businessId) {
      return res.status(400).json({ success: false, message: 'Business context required' });
    }

    const { branchId, q } = req.query;
    const where: any = {
      isSalesman: true,
      isActive: true,
      membership: { businessId }
    };
    if (q) {
      const needle = String(q);
      where.OR = [
        { employeeId: { contains: needle } },
        { membership: { user: { name: { contains: needle } } } },
        { membership: { user: { email: { contains: needle } } } }
      ];
    }

    const salesmen = await prisma.staffProfile.findMany({
      where,
      include: salesmanInclude,
      orderBy: { createdAt: 'asc' }
    });

    // Branch filter via the membership → branches relation (same
    // shape the staff list uses).
    let rows = salesmen;
    if (branchId) {
      const inBranch = await prisma.staffProfile.findMany({
        where: { ...where, membership: { businessId, branches: { some: { branchId: String(branchId) } } } },
        select: { id: true }
      });
      const allowed = new Set(inBranch.map((s: any) => s.id));
      rows = salesmen.filter((s: any) => allowed.has(s.id));
    }

    return res.json({
      success: true,
      data: rows.map((s: any) => ({
        staffProfileId: s.id,
        employeeId: s.employeeId,
        userId: s.membership.userId,
        name: s.membership.user?.name || '',
        email: s.membership.user?.email || '',
        phone: s.membership.user?.phone || '',
        designation: s.designation,
        department: s.department,
        isActive: s.isActive,
        isSalesman: s.isSalesman
      }))
    });
  } catch (error) {
    logger.error('Error listing salesmen:', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// GET /api/salesmen/performance?startDate&endDate&branchId —
// salesman-wise sales tracking: one row per salesman with the sales
// attributed to them in the range (totals, transactions, average
// sale) plus the commission rows calculated for them in the same
// range. Salesmen with no sales in the range still appear, at zero.
export const getSalesmenPerformance = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const businessId = callerBusinessId(req);
    if (!businessId) {
      return res.status(400).json({ success: false, message: 'Business context required' });
    }

    const range = parseRange(req);
    const branchId = req.query.branchId ? String(req.query.branchId) : null;

    const salesmen = await prisma.staffProfile.findMany({
      where: { isSalesman: true, isActive: true, membership: { businessId } },
      include: salesmanInclude,
      orderBy: { createdAt: 'asc' }
    });

    const rows = await Promise.all(
      salesmen.map(async (s: any) => {
        const staffUserId = s.membership.userId;
        const [salesAgg, commissionAgg] = await Promise.all([
          prisma.sale.aggregate({
            where: attributedSalesWhere(staffUserId, businessId, range, branchId),
            _sum: { totalAmount: true },
            _count: { id: true }
          }),
          prisma.commission.aggregate({
            where: {
              staffProfileId: s.id,
              createdAt: { gte: range.startDate, lte: range.endDate },
              ...(branchId ? { branchId } : {})
            },
            _sum: { totalAmount: true, totalCommission: true, bonusAmount: true },
            _count: { id: true }
          })
        ]);
        const totalSales = salesAgg._sum.totalAmount || 0;
        const transactions = salesAgg._count.id || 0;
        return {
          staffProfileId: s.id,
          employeeId: s.employeeId,
          userId: staffUserId,
          name: s.membership.user?.name || '',
          email: s.membership.user?.email || '',
          designation: s.designation,
          totalSales,
          transactions,
          averageSale: transactions > 0 ? totalSales / transactions : 0,
          commissions: {
            periods: commissionAgg._count.id || 0,
            totalAmount: commissionAgg._sum.totalAmount || 0,
            totalCommission: commissionAgg._sum.totalCommission || 0,
            totalBonus: commissionAgg._sum.bonusAmount || 0
          }
        };
      })
    );

    const totals = rows.reduce(
      (acc, r) => ({
        totalSales: acc.totalSales + r.totalSales,
        transactions: acc.transactions + r.transactions,
        totalCommission: acc.totalCommission + r.commissions.totalCommission
      }),
      { totalSales: 0, transactions: 0, totalCommission: 0 }
    );

    return res.json({
      success: true,
      data: {
        range: { startDate: range.startDate, endDate: range.endDate },
        salesmen: rows,
        totals
      }
    });
  } catch (error) {
    logger.error('Error fetching salesmen performance:', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// GET /api/salesmen/:id/performance?startDate&endDate&branchId — one
// salesman's detail: the same totals as the list view plus their
// recent attributed sales. Commission detail lives on the existing
// /api/commissions/performance/:staffId endpoint.
export const getSalesmanPerformance = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const businessId = callerBusinessId(req);
    if (!businessId) {
      return res.status(400).json({ success: false, message: 'Business context required' });
    }

    const staffProfileId = req.params.id;
    const range = parseRange(req);
    const branchId = req.query.branchId ? String(req.query.branchId) : null;

    const salesman = await prisma.staffProfile.findFirst({
      where: { id: staffProfileId, isSalesman: true, membership: { businessId } },
      include: salesmanInclude
    });
    if (!salesman) {
      return res.status(404).json({ success: false, message: 'Salesman not found' });
    }

    const staffUserId = salesman.membership.userId;
    const [salesAgg, recentSales] = await Promise.all([
      prisma.sale.aggregate({
        where: attributedSalesWhere(staffUserId, businessId, range, branchId),
        _sum: { totalAmount: true, paidAmount: true },
        _count: { id: true }
      }),
      prisma.sale.findMany({
        where: attributedSalesWhere(staffUserId, businessId, range, branchId),
        take: 20,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          invoiceNumber: true,
          totalAmount: true,
          paidAmount: true,
          paymentStatus: true,
          createdAt: true,
          customer: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } }
        }
      })
    ]);

    const totalSales = salesAgg._sum.totalAmount || 0;
    const transactions = salesAgg._count.id || 0;

    return res.json({
      success: true,
      data: {
        staffProfileId: salesman.id,
        employeeId: salesman.employeeId,
        userId: staffUserId,
        name: salesman.membership.user?.name || '',
        email: salesman.membership.user?.email || '',
        designation: salesman.designation,
        range: { startDate: range.startDate, endDate: range.endDate },
        totalSales,
        totalPaid: salesAgg._sum.paidAmount || 0,
        transactions,
        averageSale: transactions > 0 ? totalSales / transactions : 0,
        recentSales
      }
    });
  } catch (error) {
    logger.error('Error fetching salesman performance:', { error: String(error) });
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
