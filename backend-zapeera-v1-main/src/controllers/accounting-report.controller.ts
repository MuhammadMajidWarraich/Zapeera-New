import '../config/database.init';
import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AuthRequest, buildBranchWhereClause } from '../middleware/auth.middleware';
import {
  summarizeCogs,
  computePnl,
  comparePnl,
  ageLedgerEntries,
  mergeTenderRows,
  sumTenderRows,
  round2,
  TenderRow,
  PnlStatement,
} from '../utils/accounting.util';

// Accounting-lite endpoints (Wave B8) — read-only finance views over
// real rows. Definitions live in utils/accounting.util.ts; nothing here
// posts or mutates. Period parameters: `from`/`to` (YYYY-MM-DD) win,
// then the reports family's `startDate`/`endDate`, then `period`
// (default 'thisMonth' — an accounting statement is a monthly artifact;
// the other reports default to 'today').

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
  if (fromLike && toLike) {
    return { gte: parseDateStart(fromLike), lte: parseDateEnd(toLike) };
  }
  const range = getPeriodRange(period || 'thisMonth');
  return { gte: range.start, lte: range.end };
}

/** Tenant scope for this request: company + effective branch (query branchId wins, else the context branch). */
function resolveScope(req: AuthRequest): { companyId?: string; branchId?: string } {
  const scope = buildBranchWhereClause(req, {});
  const { branchId } = req.query as any;
  const out: { companyId?: string; branchId?: string } = {};
  if (scope.companyId) out.companyId = scope.companyId;
  if (branchId) out.branchId = branchId;
  else if (scope.branchId) out.branchId = scope.branchId;
  return out;
}

/** Scope shape the P&L builder consumes (branchId optional). */
interface PnlScope {
  companyId?: string;
  branchId?: string;
}

/** Sale where for statements: period + tenant scope, REFUNDED sales excluded (house rule). */
function buildStatementSaleWhere(scope: PnlScope, dateFilter: { gte: Date; lte: Date }) {
  const where: any = { createdAt: dateFilter, status: { not: 'REFUNDED' } };
  if (scope.companyId) where.companyId = scope.companyId;
  if (scope.branchId) where.branchId = scope.branchId;
  return where;
}

function buildExpenseWhere(scope: PnlScope, dateFilter: { gte: Date; lte: Date }) {
  const where: any = { expenseDate: { gte: dateFilter.gte, lte: dateFilter.lte } };
  if (scope.companyId) where.companyId = scope.companyId;
  if (scope.branchId) where.branchId = scope.branchId;
  return where;
}

/**
 * P&L statement builder (Item 8) — the exact computation the old
 * getAccountingPnl did inline, extracted so /pnl/compare can reuse it
 * for the current period, the previous period and every branch.
 * Returns the statement data (no res.json); callers handle errors.
 */
async function buildPnlStatement(prisma: any, scope: PnlScope, dateFilter: { gte: Date; lte: Date }) {
  const saleWhere = buildStatementSaleWhere(scope, dateFilter);
  // Refunds are scoped to the tenant WITHOUT the period/status parts:
  // a refund belongs to the period it was created in, whatever the
  // original sale's date or status (the dashboard's netting basis).
  const { createdAt: _createdAt, status: _status, ...saleScope } = saleWhere;
  const expenseWhere = buildExpenseWhere(scope, dateFilter);

  const [salesAgg, saleItems, refunds, expenseAgg, expenseByCategory] = await Promise.all([
    prisma.sale.aggregate({ where: saleWhere, _sum: { totalAmount: true }, _count: { id: true } }),
    prisma.saleItem.findMany({
      where: { sale: saleWhere },
      select: { quantity: true, productId: true, batch: { select: { purchasePrice: true } } },
    }),
    prisma.refund.findMany({
      where: { createdAt: dateFilter, originalSale: saleScope },
      select: {
        id: true,
        refundAmount: true,
        originalSaleId: true,
        items: { select: { productId: true, quantity: true } },
      },
    }),
    prisma.expense.aggregate({ where: expenseWhere, _sum: { amount: true }, _count: { id: true } }),
    prisma.expense.groupBy({
      by: ['categoryId'],
      where: expenseWhere,
      _sum: { amount: true },
      _count: { id: true },
    }),
  ]);

  const grossRevenue = salesAgg._sum?.totalAmount || 0;
  const refundsTotal = refunds.reduce((sum: number, r: any) => sum + (r.refundAmount || 0), 0);

  // Service lines (Wave C4) have no batch BY DESIGN and their cost
  // is knowably zero (a consultation consumes no stock) — price
  // them at 0 here so they are not miscounted as cost-unknown
  // legacy lines by summarizeCogs.
  const itemProductIds = [...new Set(saleItems.map((it: any) => it.productId).filter(Boolean))];
  const serviceProductIdSet = new Set(
    itemProductIds.length
      ? (await prisma.product.findMany({
          where: { id: { in: itemProductIds }, isService: true },
          select: { id: true },
        })).map((p: any) => p.id)
      : []
  );

  const cogsGross = summarizeCogs(
    saleItems.map((it: any) => ({
      quantity: it.quantity,
      batchPurchasePrice: it.batch
        ? it.batch.purchasePrice
        : (serviceProductIdSet.has(it.productId) ? 0 : null),
    }))
  );

  // Refund COGS reversal: original batch cost per product, resolved
  // from the original sales' items (first line per product, as the
  // dashboard does). A refund item whose product is absent from the
  // original sale — or whose original line had no batch — is cost-
  // unknown: counted, contributes 0.
  let refundCost = { cogs: 0, knownLines: 0, unknownCostLines: 0, unknownCostUnits: 0 };
  if (refunds.length > 0) {
    const originalSaleIds = [...new Set(refunds.map((r: any) => r.originalSaleId))];
    const originalItems = await prisma.saleItem.findMany({
      where: { saleId: { in: originalSaleIds } },
      select: { saleId: true, productId: true, batch: { select: { purchasePrice: true } } },
    });
    // Refunded service lines (Wave C4) likewise reverse at a
    // knowable cost of 0, not "unknown".
    const originalProductIds = [...new Set((originalItems as any[]).map((oi: any) => oi.productId))];
    const refundServiceIdSet = new Set(
      originalProductIds.length
        ? (await prisma.product.findMany({
            where: { id: { in: originalProductIds }, isService: true },
            select: { id: true },
          })).map((p: any) => p.id)
        : []
    );
    const costBySaleProduct = new Map<string, number | null>();
    for (const oi of originalItems as any[]) {
      const key = `${oi.saleId}::${oi.productId}`;
      if (!costBySaleProduct.has(key)) {
        costBySaleProduct.set(
          key,
          oi.batch ? oi.batch.purchasePrice : (refundServiceIdSet.has(oi.productId) ? 0 : null)
        );
      }
    }
    const lines = refunds.flatMap((r: any) =>
      (r.items || []).map((ri: any) => ({
        quantity: ri.quantity,
        batchPurchasePrice: costBySaleProduct.get(`${r.originalSaleId}::${ri.productId}`) ?? null,
      }))
    );
    refundCost = summarizeCogs(lines);
  }

  // Expense category names (same resolution as the expense report).
  const categoryIds = expenseByCategory
    .map((g: any) => g.categoryId)
    .filter((id: any): id is string => typeof id === 'string' && id !== '');
  const categoryRows = categoryIds.length > 0
    ? await prisma.expenseCategory.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } })
    : [];
  const categoryNameById = new Map(categoryRows.map((c: any) => [c.id, c.name]));
  const byCategory = (expenseByCategory as any[])
    .map((g) => ({
      categoryId: g.categoryId || null,
      category: g.categoryId ? categoryNameById.get(g.categoryId) || 'Unknown category' : 'Uncategorized',
      amount: round2(g._sum?.amount || 0),
      count: g._count?.id || 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  const pnl = computePnl({
    grossRevenue,
    refundsTotal,
    cogsGross: cogsGross.cogs,
    cogsReversal: refundCost.cogs,
    expensesTotal: expenseAgg._sum?.amount || 0,
  });

  return {
    period: { from: dateFilter.gte.toISOString(), to: dateFilter.lte.toISOString() },
    revenue: pnl.revenue,
    cogs: {
      ...pnl.cogs,
      unknownCostLines: cogsGross.unknownCostLines,
      unknownCostUnits: cogsGross.unknownCostUnits,
      unknownRefundCostLines: refundCost.unknownCostLines,
      unknownRefundCostUnits: refundCost.unknownCostUnits,
    },
    grossProfit: pnl.grossProfit,
    expenses: {
      total: pnl.expenses,
      count: expenseAgg._count?.id || 0,
      byCategory,
    },
    netProfit: pnl.netProfit,
    counts: { sales: salesAgg._count?.id || 0, refunds: refunds.length },
  };
}

/** Narrow a built statement to the PnlStatement shape comparePnl consumes. */
function toPnlStatement(data: any): PnlStatement {
  return {
    revenue: data.revenue,
    cogs: { gross: data.cogs.gross, refundReversal: data.cogs.refundReversal, net: data.cogs.net },
    grossProfit: data.grossProfit,
    expenses: data.expenses.total,
    netProfit: data.netProfit,
  };
}

// ─── GET /reports/accounting/pnl ─────────────────────────────────────

export const getAccountingPnl = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = resolvePeriod(req);
    const data = await buildPnlStatement(prisma, resolveScope(req), dateFilter);
    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('Accounting P&L error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── GET /reports/accounting/pnl/compare ─────────────────────────────
// Item 8 — deeper P&L: the current period against the previous
// equal-length period immediately before it, plus a per-branch
// breakdown of the current period (only when no single branch is
// selected — a branch-scoped request is already one branch).
// The previous period is derived from the requested range, so a
// custom from/to compares against the equal-length window before it.

export const getPnlComparison = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = resolvePeriod(req);
    const scope = resolveScope(req);

    const current = await buildPnlStatement(prisma, scope, dateFilter);
    const lengthMs = dateFilter.lte.getTime() - dateFilter.gte.getTime();
    const prevEnd = new Date(dateFilter.gte.getTime() - 1);
    const prevStart = new Date(prevEnd.getTime() - lengthMs);
    const previous = await buildPnlStatement(prisma, scope, { gte: prevStart, lte: prevEnd });
    const comparison = comparePnl(toPnlStatement(current), toPnlStatement(previous));

    let byBranch: any[] = [];
    if (!scope.branchId && scope.companyId) {
      const branches = await prisma.branch.findMany({
        where: { companyId: scope.companyId },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      byBranch = await Promise.all(
        (branches as any[]).map(async (b) => {
          const s = await buildPnlStatement(prisma, { ...scope, branchId: b.id }, dateFilter);
          return {
            branchId: b.id,
            branchName: b.name,
            revenue: s.revenue,
            cogs: s.cogs,
            grossProfit: s.grossProfit,
            expenses: s.expenses,
            netProfit: s.netProfit,
            counts: s.counts,
          };
        })
      );
    }

    return res.json({
      success: true,
      data: {
        period: current.period,
        previousPeriod: previous.period,
        current,
        previous,
        comparison,
        byBranch,
      },
    });
  } catch (error: any) {
    console.error('Accounting P&L comparison error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── GET /reports/accounting/receivables-ageing ──────────────────────

export const getReceivablesAgeing = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const scope = resolveScope(req);
    const asOf = new Date();

    const customerWhere: any = {};
    if (scope.companyId) customerWhere.companyId = scope.companyId;
    if (scope.branchId) customerWhere.branchId = scope.branchId;

    const [customers, entries] = await Promise.all([
      prisma.customer.findMany({ where: customerWhere, select: { id: true, name: true, phone: true } }),
      prisma.customerLedgerEntry.findMany({
        where: {
          ...(scope.companyId ? { companyId: scope.companyId } : {}),
          ...(scope.branchId ? { customer: { branchId: scope.branchId } } : {}),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { customerId: true, amount: true, createdAt: true },
      }),
    ]);

    const customerById = new Map(customers.map((c: any) => [c.id, c]));
    const entriesByCustomer = new Map<string, Array<{ amount: number; createdAt: Date }>>();
    for (const e of entries as any[]) {
      if (!customerById.has(e.customerId)) continue;
      const list = entriesByCustomer.get(e.customerId) || [];
      list.push({ amount: e.amount, createdAt: e.createdAt });
      entriesByCustomer.set(e.customerId, list);
    }

    const rows: any[] = [];
    let customerAdvances = 0;
    const totals = { days0to30: 0, days31to60: 0, days61to90: 0, over90: 0, total: 0 };
    for (const [customerId, list] of entriesByCustomer) {
      const aged = ageLedgerEntries(list, asOf);
      if (aged.advance > 0) customerAdvances = round2(customerAdvances + aged.advance);
      if (aged.openDue <= 0) continue;
      const c = customerById.get(customerId);
      rows.push({
        customerId,
        customerName: c?.name || 'Unknown customer',
        phone: c?.phone || null,
        total: aged.openDue,
        buckets: aged.buckets,
      });
      totals.days0to30 = round2(totals.days0to30 + aged.buckets.days0to30);
      totals.days31to60 = round2(totals.days31to60 + aged.buckets.days31to60);
      totals.days61to90 = round2(totals.days61to90 + aged.buckets.days61to90);
      totals.over90 = round2(totals.over90 + aged.buckets.over90);
      totals.total = round2(totals.total + aged.openDue);
    }
    rows.sort((a, b) => b.total - a.total);

    return res.json({
      success: true,
      data: {
        asOf: asOf.toISOString(),
        rows,
        totals,
        customerAdvances,
        customersWithDues: rows.length,
      },
    });
  } catch (error: any) {
    console.error('Receivables ageing error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── GET /reports/accounting/payables ────────────────────────────────

export const getPayables = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const scope = resolveScope(req);
    const now = new Date();

    const where: any = { outstanding: { gt: 0 }, status: { not: 'CANCELLED' } };
    if (scope.companyId) where.companyId = scope.companyId;
    if (scope.branchId) where.branchId = scope.branchId;

    const purchases = await prisma.purchase.findMany({
      where,
      orderBy: { purchaseDate: 'asc' },
      select: {
        id: true,
        invoiceNo: true,
        purchaseDate: true,
        totalAmount: true,
        paidAmount: true,
        outstanding: true,
        supplier: { select: { id: true, name: true, contactPerson: true, phone: true } },
      },
    });

    const rows = (purchases as any[]).map((p) => ({
      purchaseId: p.id,
      supplier: p.supplier
        ? { id: p.supplier.id, name: p.supplier.name, contactPerson: p.supplier.contactPerson, phone: p.supplier.phone }
        : null,
      invoiceNo: p.invoiceNo || null,
      purchaseDate: p.purchaseDate,
      total: round2(p.totalAmount || 0),
      paid: round2(p.paidAmount || 0),
      outstanding: round2(p.outstanding || 0),
      ageDays: Math.max(0, Math.floor((now.getTime() - new Date(p.purchaseDate).getTime()) / 86400000)),
    }));
    const totalOutstanding = round2(rows.reduce((sum, r) => sum + r.outstanding, 0));

    return res.json({
      success: true,
      data: { asOf: now.toISOString(), rows, totalOutstanding, count: rows.length },
    });
  } catch (error: any) {
    console.error('Payables error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── GET /reports/accounting/cashbook ────────────────────────────────

export const getCashbook = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const dateFilter = resolvePeriod(req);
    const scope = resolveScope(req);

    // Receipts are a CASH view: no status exclusion (a refunded sale's
    // money did come in; it leaves again through the refunds-out rows,
    // so the net stays truthful). Sales without SalePayment allocations
    // (pre-B1 history, unpaid-at-counter sales) fall back to the
    // headline paymentMethod with the amount actually paid — paidAmount,
    // not totalAmount: a cashbook counts money received, and the unpaid
    // remainder is khata, not cash.
    const cashSaleWhere: any = { createdAt: dateFilter };
    if (scope.companyId) cashSaleWhere.companyId = scope.companyId;
    if (scope.branchId) cashSaleWhere.branchId = scope.branchId;
    const saleScope: any = {};
    if (scope.companyId) saleScope.companyId = scope.companyId;
    if (scope.branchId) saleScope.branchId = scope.branchId;

    const expenseWhere = buildExpenseWhere(resolveScope(req), dateFilter);

    const [allocations, legacySales, khataPayments, refundRows, expenseAgg] = await Promise.all([
      prisma.salePayment.groupBy({
        by: ['method'],
        where: { sale: cashSaleWhere },
        _sum: { amount: true },
        _count: { id: true },
      }),
      prisma.sale.groupBy({
        by: ['paymentMethod'],
        where: { ...cashSaleWhere, payments: { none: {} } },
        _sum: { paidAmount: true },
        _count: { id: true },
      }),
      prisma.customerLedgerEntry.groupBy({
        by: ['method'],
        where: {
          type: 'PAYMENT',
          createdAt: dateFilter,
          ...(scope.companyId ? { companyId: scope.companyId } : {}),
          ...(scope.branchId ? { customer: { branchId: scope.branchId } } : {}),
        },
        _sum: { amount: true },
        _count: { id: true },
      }),
      prisma.refund.groupBy({
        by: ['refundMethod'],
        where: { createdAt: dateFilter, originalSale: saleScope },
        _sum: { refundAmount: true },
        _count: { id: true },
      }),
      prisma.expense.aggregate({ where: expenseWhere, _sum: { amount: true }, _count: { id: true } }),
    ]);

    const salesReceipts = mergeTenderRows(
      (allocations as any[]).map((r) => ({ method: r.method, amount: r._sum?.amount || 0, count: r._count?.id || 0 })),
      (legacySales as any[]).map((r) => ({ method: r.paymentMethod, amount: r._sum?.paidAmount || 0, count: r._count?.id || 0 }))
    );
    // Khata PAYMENT rows store negative amounts (they reduce a due);
    // cash received is the absolute value.
    const khataReceipts: TenderRow[] = (khataPayments as any[]).map((r) => ({
      method: r.method || 'UNSPECIFIED',
      amount: Math.abs(r._sum?.amount || 0),
      count: r._count?.id || 0,
    }));
    const refundsOut: TenderRow[] = (refundRows as any[]).map((r) => ({
      method: r.refundMethod || 'UNSPECIFIED',
      amount: r._sum?.refundAmount || 0,
      count: r._count?.id || 0,
    }));

    const salesTotal = sumTenderRows(salesReceipts);
    const khataTotal = sumTenderRows(khataReceipts);
    const refundsTotal = sumTenderRows(refundsOut);
    const expensesTotal = round2(expenseAgg._sum?.amount || 0);
    const totalIn = round2(salesTotal + khataTotal);
    const totalOut = round2(refundsTotal + expensesTotal);

    return res.json({
      success: true,
      data: {
        period: { from: dateFilter.gte.toISOString(), to: dateFilter.lte.toISOString() },
        moneyIn: {
          salesReceipts: { byMethod: salesReceipts, total: salesTotal },
          khataPayments: { byMethod: khataReceipts, total: khataTotal },
          total: totalIn,
        },
        moneyOut: {
          refunds: { byMethod: refundsOut, total: refundsTotal },
          expenses: { total: expensesTotal, count: expenseAgg._count?.id || 0 },
          total: totalOut,
        },
        netMovement: round2(totalIn - totalOut),
      },
    });
  } catch (error: any) {
    console.error('Cashbook error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
