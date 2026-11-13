import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AuthRequest, buildBranchWhereClause } from '../middleware/auth.middleware';
import { round2 } from '../utils/accounting.util';

// ─── Basket size + comparison matrices (v1.0.22) ─────────────────────
// Average bill value (Σ totalAmount / bill count) per period + branch,
// and current-vs-previous-period matrices by the dimensions that
// actually exist in the data model: category and supplier. There is
// no product brand field and no department model, so those two
// dimensions are NOT offered (returning 400 for them beats inventing
// a mapping). The previous window is the equal-length window
// immediately before the requested range (the getPnlComparison
// pattern). Sale figures exclude REFUNDED sales (house rule); the
// service charge is inside totalAmount, so basket averages include
// it, and the service-charge total is broken out separately.

function parseDateStart(dateLike: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateLike);
  if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), 0, 0, 0, 0);
  return new Date(dateLike);
}
function parseDateEnd(dateLike: string): Date {
  const d = parseDateStart(dateLike);
  d.setHours(23, 59, 59, 999);
  return d;
}

function getPeriodRange(period: string) {
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
    case 'thisMonth':
    default:
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      break;
  }
  return { start, end };
}

function resolvePeriod(req: AuthRequest): { gte: Date; lte: Date } {
  const { from, to, startDate, endDate, period } = req.query as any;
  const fromLike = from || startDate;
  const toLike = to || endDate;
  if (fromLike && toLike) return { gte: parseDateStart(fromLike), lte: parseDateEnd(toLike) };
  const range = getPeriodRange(period || 'thisMonth');
  return { gte: range.start, lte: range.end };
}

function resolveScope(req: AuthRequest): { companyId?: string; branchId?: string } {
  const scope = buildBranchWhereClause(req, {});
  const { branchId } = req.query as any;
  const out: { companyId?: string; branchId?: string } = {};
  if (scope.companyId) out.companyId = scope.companyId;
  if (branchId) out.branchId = branchId;
  else if (scope.branchId) out.branchId = scope.branchId;
  return out;
}

/** pctChange mirrors comparePnl: null when the previous value is 0. */
function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return round2(((current - previous) / previous) * 100);
}

function basketOf(rows: Array<{ totalAmount: number; serviceChargeAmount?: number | null }>) {
  const totalSales = round2(rows.reduce((s, r) => s + (Number(r.totalAmount) || 0), 0));
  const serviceChargeTotal = round2(rows.reduce((s, r) => s + (Number(r.serviceChargeAmount) || 0), 0));
  const billCount = rows.length;
  return {
    totalSales,
    billCount,
    averageBillValue: billCount > 0 ? round2(totalSales / billCount) : 0,
    serviceChargeTotal,
  };
}

// ─── GET /reports/basket-size ────────────────────────────────────────

export const getBasketSize = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = resolvePeriod(req);
    const scope = resolveScope(req);

    const saleWhere: any = { createdAt: dateFilter, status: { not: 'REFUNDED' } };
    if (scope.companyId) saleWhere.companyId = scope.companyId;
    if (scope.branchId) saleWhere.branchId = scope.branchId;

    const sales = await prisma.sale.findMany({
      where: saleWhere,
      select: { totalAmount: true, serviceChargeAmount: true, branchId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    const overall = basketOf(sales as any[]);

    let byBranch: any[] = [];
    if (!scope.branchId && scope.companyId) {
      const branches = await prisma.branch.findMany({
        where: { companyId: scope.companyId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      byBranch = (branches as any[]).map((b) => ({
        branchId: b.id,
        branchName: b.name,
        ...basketOf((sales as any[]).filter((s) => s.branchId === b.id)),
      }));
    }

    const byDayMap = new Map<string, Array<{ totalAmount: number; serviceChargeAmount?: number | null }>>();
    for (const s of sales as any[]) {
      const day = new Date(s.createdAt).toISOString().slice(0, 10);
      const list = byDayMap.get(day) || [];
      list.push(s);
      byDayMap.set(day, list);
    }
    const byDay = [...byDayMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, rows]) => ({ date, ...basketOf(rows) }));

    return res.json({
      success: true,
      data: {
        period: { from: dateFilter.gte.toISOString(), to: dateFilter.lte.toISOString() },
        scope: { companyId: scope.companyId || null, branchId: scope.branchId || null },
        overall,
        byBranch,
        byDay,
      },
    });
  } catch (error: any) {
    console.error('Basket size error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── GET /reports/comparison-matrix ──────────────────────────────────
// kind=sales|purchases, dimension=category|supplier. Sales lines use
// SaleItem.totalPrice (the stored line money truth); purchase lines
// use PurchaseItem.totalPrice. Purchases exclude CANCELLED.

const MATRIX_KINDS = ['sales', 'purchases'] as const;
const MATRIX_DIMENSIONS = ['category', 'supplier'] as const;

export const getComparisonMatrix = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const kind = String(req.query.kind || 'sales');
    const dimension = String(req.query.dimension || 'category');
    if (!(MATRIX_KINDS as readonly string[]).includes(kind)) {
      return res.status(400).json({ success: false, message: 'kind must be sales or purchases' });
    }
    if (!(MATRIX_DIMENSIONS as readonly string[]).includes(dimension)) {
      return res.status(400).json({
        success: false,
        message: 'dimension must be category or supplier — brand and department do not exist in the data model',
        code: 'DIMENSION_UNAVAILABLE',
      });
    }
    const dateFilter = resolvePeriod(req);
    const scope = resolveScope(req);
    const lengthMs = dateFilter.lte.getTime() - dateFilter.gte.getTime();
    const prevEnd = new Date(dateFilter.gte.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - lengthMs);
    const prevFilter = { gte: prevStart, lte: prevEnd };

    async function aggregateSales(filter: { gte: Date; lte: Date }) {
      const saleWhere: any = { createdAt: filter, status: { not: 'REFUNDED' } };
      if (scope.companyId) saleWhere.companyId = scope.companyId;
      if (scope.branchId) saleWhere.branchId = scope.branchId;
      const items = await prisma.saleItem.findMany({
        where: { sale: saleWhere },
        select: {
          totalPrice: true,
          product: {
            select: {
              categoryId: true,
              supplierId: true,
              category: { select: { id: true, name: true } },
              supplier: { select: { id: true, name: true } },
            },
          },
        },
      });
      return bucket(items as any[]);
    }

    async function aggregatePurchases(filter: { gte: Date; lte: Date }) {
      const purchaseWhere: any = { purchaseDate: filter, status: { not: 'CANCELLED' } };
      if (scope.companyId) purchaseWhere.companyId = scope.companyId;
      if (scope.branchId) purchaseWhere.branchId = scope.branchId;
      const items = await prisma.purchaseItem.findMany({
        where: { purchase: purchaseWhere },
        select: {
          totalPrice: true,
          purchase: { select: { supplierId: true, supplier: { select: { id: true, name: true } } } },
          product: {
            select: {
              categoryId: true,
              category: { select: { id: true, name: true } },
            },
          },
        },
      });
      return bucket(items as any[]);
    }

    function bucket(items: any[]) {
      const map = new Map<string, { dimensionId: string | null; dimensionName: string; amount: number; count: number }>();
      for (const it of items) {
        let id: string | null = null;
        let name: string | null = null;
        if (dimension === 'category') {
          id = it.product?.category?.id || it.product?.categoryId || null;
          name = it.product?.category?.name || null;
        } else if (kind === 'sales') {
          id = it.product?.supplier?.id || it.product?.supplierId || null;
          name = it.product?.supplier?.name || null;
        } else {
          id = it.purchase?.supplier?.id || it.purchase?.supplierId || null;
          name = it.purchase?.supplier?.name || null;
        }
        const key = id || '__unassigned__';
        const row = map.get(key) || { dimensionId: id, dimensionName: name || 'Unassigned', amount: 0, count: 0 };
        row.amount = round2(row.amount + (Number(it.totalPrice) || 0));
        row.count += 1;
        map.set(key, row);
      }
      return map;
    }

    const aggregate = kind === 'sales' ? aggregateSales : aggregatePurchases;
    const [currentMap, previousMap] = await Promise.all([aggregate(dateFilter), aggregate(prevFilter)]);

    const keys = new Set([...currentMap.keys(), ...previousMap.keys()]);
    const rows = [...keys]
      .map((key) => {
        const c = currentMap.get(key) || { dimensionId: previousMap.get(key)?.dimensionId || null, dimensionName: previousMap.get(key)?.dimensionName || 'Unassigned', amount: 0, count: 0 };
        const p = previousMap.get(key) || { dimensionId: c.dimensionId, dimensionName: c.dimensionName, amount: 0, count: 0 };
        return {
          dimensionId: c.dimensionId,
          dimensionName: c.dimensionName,
          current: { amount: round2(c.amount), count: c.count },
          previous: { amount: round2(p.amount), count: p.count },
          change: round2(c.amount - p.amount),
          pctChange: pctChange(c.amount, p.amount),
        };
      })
      .sort((a, b) => b.current.amount - a.current.amount);

    const totals = {
      current: { amount: round2(rows.reduce((s, r) => s + r.current.amount, 0)), count: rows.reduce((s, r) => s + r.current.count, 0) },
      previous: { amount: round2(rows.reduce((s, r) => s + r.previous.amount, 0)), count: rows.reduce((s, r) => s + r.previous.count, 0) },
    };

    return res.json({
      success: true,
      data: {
        kind,
        dimension,
        period: { from: dateFilter.gte.toISOString(), to: dateFilter.lte.toISOString() },
        previousPeriod: { from: prevFilter.gte.toISOString(), to: prevFilter.lte.toISOString() },
        scope: { companyId: scope.companyId || null, branchId: scope.branchId || null },
        rows,
        totals: { ...totals, change: round2(totals.current.amount - totals.previous.amount), pctChange: pctChange(totals.current.amount, totals.previous.amount) },
      },
    });
  } catch (error: any) {
    console.error('Comparison matrix error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
