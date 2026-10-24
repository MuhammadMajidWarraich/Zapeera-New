import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AuthRequest, buildBranchWhereClause } from '../middleware/auth.middleware';
import {
  ageLedgerEntries,
  round2,
} from '../utils/accounting.util';
import {
  ageDays,
  bucketOutstandingByAge,
  stockAgeBucket,
  classifyMovement,
  productProfitability,
  customerRiskBand,
  type AgeBuckets,
  type StockAgeBuckets,
} from '../utils/purchase-suggestion.util';

// ─── Aging reports (Gap Item 4) ─────────────────────────────────────────────
// Read-only reports over rows that already exist (purchases, khata ledger
// entries, batches, sale items). Nothing here posts or mutates.
// Relationship to the existing accounting-lite endpoints (which this file
// does NOT touch): /accounting/payables lists open purchase invoices flat
// with no buckets — supplier aging below groups them per supplier into
// 0–30/31–60/61–90/90+ buckets. /accounting/receivables-ageing buckets
// khata dues per customer — customer aging below reuses its exact FIFO
// engine (ageLedgerEntries) and ADDS the oldest-due date, last payment
// date and a risk band. Stock aging, movement and profitability have no
// existing counterpart.
// Period parameters: `from`/`to` (YYYY-MM-DD) or `days` (default 30 for
// movement/profitability). Branch scope follows the request context.

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

function resolveScope(req: AuthRequest): { companyId?: string; branchId?: string } {
  const scope = buildBranchWhereClause(req, {});
  const { branchId } = req.query as any;
  const out: { companyId?: string; branchId?: string } = {};
  if (scope.companyId) out.companyId = scope.companyId;
  if (branchId) out.branchId = branchId;
  else if (scope.branchId) out.branchId = scope.branchId;
  return out;
}

/** Analysis window: explicit from/to wins, else the last `days` days. */
function resolveWindow(req: AuthRequest, defaultDays: number): { gte: Date; lte: Date; days: number } {
  const { from, to, days } = req.query as any;
  if (from && to) {
    const gte = parseDateStart(String(from));
    const lte = parseDateEnd(String(to));
    const n = Math.max(1, Math.ceil((lte.getTime() - gte.getTime()) / 86400000));
    return { gte, lte, days: n };
  }
  const n = Math.max(1, Math.min(365, Number(days) || defaultDays));
  const lte = new Date();
  lte.setHours(23, 59, 59, 999);
  const gte = new Date(lte.getTime() - (n - 1) * 86400000);
  gte.setHours(0, 0, 0, 0);
  return { gte, lte, days: n };
}

const EMPTY_STOCK_BUCKETS: StockAgeBuckets = {
  days0to30: 0,
  days31to60: 0,
  days61to90: 0,
  days91to180: 0,
  over180: 0,
};

// ─── GET /reports/advanced/aging/supplier ──────────────────────────────────
// Payables grouped per supplier into age buckets (age = days since the
// purchase date). A supplier with no open invoices does not appear.
export const getSupplierAgingReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const scope = resolveScope(req);
    const asOf = new Date();
    const where: any = { outstanding: { gt: 0 }, status: { not: 'CANCELLED' } };
    if (scope.companyId) where.companyId = scope.companyId;
    if (scope.branchId) where.branchId = scope.branchId;

    const purchases = await prisma.purchase.findMany({
      where,
      orderBy: { purchaseDate: 'asc' },
      select: {
        supplierId: true,
        purchaseDate: true,
        outstanding: true,
        supplier: { select: { id: true, name: true, contactPerson: true, phone: true } },
      },
    });

    const bySupplier = new Map<string, {
      supplier: any;
      items: Array<{ date: Date; outstanding: number }>;
      oldestDate: Date | null;
      openInvoices: number;
    }>();
    for (const p of purchases as any[]) {
      const key = p.supplierId;
      const entry = bySupplier.get(key) || {
        supplier: p.supplier,
        items: [],
        oldestDate: null,
        openInvoices: 0,
      };
      entry.items.push({ date: new Date(p.purchaseDate), outstanding: p.outstanding });
      entry.openInvoices += 1;
      if (!entry.oldestDate || new Date(p.purchaseDate) < entry.oldestDate) {
        entry.oldestDate = new Date(p.purchaseDate);
      }
      bySupplier.set(key, entry);
    }

    const rows = Array.from(bySupplier.values()).map((entry) => {
      const aged = bucketOutstandingByAge(entry.items, asOf);
      return {
        supplier: entry.supplier
          ? { id: entry.supplier.id, name: entry.supplier.name, contactPerson: entry.supplier.contactPerson, phone: entry.supplier.phone }
          : null,
        buckets: aged.buckets,
        total: aged.total,
        openInvoices: entry.openInvoices,
        oldestDueDate: entry.oldestDate,
        oldestDueAgeDays: entry.oldestDate ? ageDays(entry.oldestDate, asOf) : null,
      };
    });
    rows.sort((a, b) => b.total - a.total);
    const totals: AgeBuckets = { days0to30: 0, days31to60: 0, days61to90: 0, over90: 0 };
    let totalOutstanding = 0;
    for (const r of rows) {
      totals.days0to30 = round2(totals.days0to30 + r.buckets.days0to30);
      totals.days31to60 = round2(totals.days31to60 + r.buckets.days31to60);
      totals.days61to90 = round2(totals.days61to90 + r.buckets.days61to90);
      totals.over90 = round2(totals.over90 + r.buckets.over90);
      totalOutstanding = round2(totalOutstanding + r.total);
    }

    return res.json({
      success: true,
      data: { asOf: asOf.toISOString(), rows, totals, totalOutstanding, suppliersWithDues: rows.length },
    });
  } catch (error) {
    console.error('Supplier aging report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── GET /reports/advanced/aging/customer ───────────────────────────────────
// Khata receivables per customer, FIFO-aged exactly like
// /accounting/receivables-ageing (same ageLedgerEntries engine), plus
// oldest open due, last payment date and a CURRENT/WATCH/OVERDUE/
// CRITICAL risk band. Customers with no open due are excluded; customers
// whose payments exceed their dues (advance) are reported separately.
export const getCustomerAgingReport = async (req: AuthRequest, res: Response) => {
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
        select: { customerId: true, type: true, amount: true, createdAt: true },
      }),
    ]);

    const customerById = new Map((customers as any[]).map((c: any) => [c.id, c]));
    const entriesByCustomer = new Map<string, Array<{ type: string; amount: number; createdAt: Date }>>();
    for (const e of entries as any[]) {
      if (!customerById.has(e.customerId)) continue;
      const list = entriesByCustomer.get(e.customerId) || [];
      list.push({ type: e.type, amount: e.amount, createdAt: new Date(e.createdAt) });
      entriesByCustomer.set(e.customerId, list);
    }

    const rows: any[] = [];
    let customerAdvances = 0;
    const totals: AgeBuckets = { days0to30: 0, days31to60: 0, days61to90: 0, over90: 0 };
    for (const [customerId, list] of entriesByCustomer) {
      const aged = ageLedgerEntries(list, asOf);
      if (aged.advance > 0) customerAdvances = round2(customerAdvances + aged.advance);
      if (aged.openDue <= 0) continue;
      // Oldest open due: replay the FIFO tranches — the earliest
      // SALE_DUE date whose amount is not fully settled by later
      // payments. ageLedgerEntries settles oldest-first, so the oldest
      // surviving tranche date is the earliest unsettled SALE_DUE.
      let oldestDueDate: Date | null = null;
      let credit = 0;
      const tranches: Array<{ date: Date; remaining: number }> = [];
      for (const e of list) {
        if (e.amount > 0) {
          let rest = e.amount;
          const absorbed = Math.min(credit, rest);
          credit -= absorbed;
          rest -= absorbed;
          if (rest > 0) tranches.push({ date: e.createdAt, remaining: rest });
        } else {
          let settle = -e.amount;
          while (settle > 0 && tranches.length > 0) {
            const head = tranches[0];
            const take = Math.min(head.remaining, settle);
            head.remaining -= take;
            settle -= take;
            if (head.remaining <= 0.000001) tranches.shift();
          }
          if (settle > 0) credit += settle;
        }
      }
      if (tranches.length > 0) oldestDueDate = tranches[0].date;
      const lastPayment = [...list]
        .filter(e => e.type === 'PAYMENT')
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      const oldestDueAgeDays = oldestDueDate ? ageDays(oldestDueDate, asOf) : null;
      const c = customerById.get(customerId);
      rows.push({
        customerId,
        customerName: c?.name || 'Unknown customer',
        phone: c?.phone || null,
        total: aged.openDue,
        buckets: aged.buckets,
        oldestDueDate,
        oldestDueAgeDays,
        lastPaymentDate: lastPayment ? lastPayment.createdAt : null,
        riskBand: customerRiskBand(oldestDueAgeDays),
      });
      totals.days0to30 = round2(totals.days0to30 + aged.buckets.days0to30);
      totals.days31to60 = round2(totals.days31to60 + aged.buckets.days31to60);
      totals.days61to90 = round2(totals.days61to90 + aged.buckets.days61to90);
      totals.over90 = round2(totals.over90 + aged.buckets.over90);
    }
    rows.sort((a, b) => b.total - a.total);
    const total = round2(rows.reduce((n, r) => n + r.total, 0));

    return res.json({
      success: true,
      data: { asOf: asOf.toISOString(), rows, totals, total, customerAdvances, customersWithDues: rows.length },
    });
  } catch (error) {
    console.error('Customer aging report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── GET /reports/advanced/aging/stock ──────────────────────────────────────
// Stock aging: live batches grouped per product, stock VALUE bucketed by
// days since the batch was received (createdAt). Expired batches are
// excluded from sellable value but reported as dead value. Slow /
// non-moving is flagged from sales in the last 90 days.
export const getStockAgingReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const scope = resolveScope(req);
    const asOf = new Date();
    const now = asOf;
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000);

    const batchWhere: any = { isActive: true, quantity: { gt: 0 } };
    if (scope.companyId) batchWhere.companyId = scope.companyId;
    if (scope.branchId) batchWhere.branchId = scope.branchId;

    const [batches, products, recentSales] = await Promise.all([
      prisma.batch.findMany({
        where: batchWhere,
        select: {
          productId: true,
          quantity: true,
          purchasePrice: true,
          expireDate: true,
          createdAt: true,
        },
      }),
      prisma.product.findMany({
        where: {
          ...(scope.companyId ? { companyId: scope.companyId } : {}),
          ...(scope.branchId ? { branchId: scope.branchId } : {}),
          isActive: true,
        },
        select: { id: true, name: true, sku: true, minStock: true },
      }),
      prisma.saleItem.findMany({
        where: {
          sale: {
            ...(scope.companyId ? { companyId: scope.companyId } : {}),
            ...(scope.branchId ? { branchId: scope.branchId } : {}),
            status: { not: 'REFUNDED' },
            createdAt: { gte: ninetyDaysAgo },
          },
        },
        select: { productId: true, sale: { select: { createdAt: true } } },
      }),
    ]);

    const productById = new Map((products as any[]).map((p: any) => [p.id, p]));
    const lastSaleByProduct = new Map<string, Date>();
    for (const item of recentSales as any[]) {
      const d = new Date(item.sale.createdAt);
      const prev = lastSaleByProduct.get(item.productId);
      if (!prev || d > prev) lastSaleByProduct.set(item.productId, d);
    }

    const byProduct = new Map<string, {
      product: any;
      totalQty: number;
      totalValue: number;
      buckets: StockAgeBuckets;
      expiredQty: number;
      expiredValue: number;
      expiringQty: number;
      expiringValue: number;
      oldestBatchAgeDays: number;
    }>();
    for (const batch of batches as any[]) {
      const product = productById.get(batch.productId);
      if (!product) continue;
      const entry = byProduct.get(batch.productId) || {
        product,
        totalQty: 0,
        totalValue: 0,
        buckets: { ...EMPTY_STOCK_BUCKETS },
        expiredQty: 0,
        expiredValue: 0,
        expiringQty: 0,
        expiringValue: 0,
        oldestBatchAgeDays: 0,
      };
      const qty = batch.quantity || 0;
      const value = round2(qty * (batch.purchasePrice || 0));
      const batchAge = ageDays(new Date(batch.createdAt), asOf);
      if (batchAge > entry.oldestBatchAgeDays) entry.oldestBatchAgeDays = batchAge;
      const expired = batch.expireDate && new Date(batch.expireDate) <= now;
      if (expired) {
        entry.expiredQty += qty;
        entry.expiredValue = round2(entry.expiredValue + value);
        continue;
      }
      entry.totalQty += qty;
      entry.totalValue = round2(entry.totalValue + value);
      entry.buckets[stockAgeBucket(batchAge)] = round2(entry.buckets[stockAgeBucket(batchAge)] + value);
      if (batch.expireDate && new Date(batch.expireDate).getTime() - now.getTime() <= 30 * 86400000) {
        entry.expiringQty += qty;
        entry.expiringValue = round2(entry.expiringValue + value);
      }
      byProduct.set(batch.productId, entry);
    }

    const rows = Array.from(byProduct.values()).map((entry) => {
      const lastSale = lastSaleByProduct.get(entry.product.id) || null;
      return {
        productId: entry.product.id,
        productName: entry.product.name,
        sku: entry.product.sku,
        totalQty: entry.totalQty,
        totalValue: entry.totalValue,
        buckets: entry.buckets,
        expiredQty: entry.expiredQty,
        expiredValue: entry.expiredValue,
        expiringQty: entry.expiringQty,
        expiringValue: entry.expiringValue,
        oldestBatchAgeDays: entry.oldestBatchAgeDays,
        lastSaleDate: lastSale,
        daysSinceLastSale: lastSale ? ageDays(lastSale, asOf) : null,
        nonMoving90d: lastSale === null,
      };
    });
    rows.sort((a, b) => b.totalValue - a.totalValue);
    const totals = {
      totalQty: rows.reduce((n, r) => n + r.totalQty, 0),
      totalValue: round2(rows.reduce((n, r) => n + r.totalValue, 0)),
      expiredValue: round2(rows.reduce((n, r) => n + r.expiredValue, 0)),
      expiringValue: round2(rows.reduce((n, r) => n + r.expiringValue, 0)),
      nonMovingProducts: rows.filter(r => r.nonMoving90d).length,
      buckets: rows.reduce(
        (acc, r) => ({
          days0to30: round2(acc.days0to30 + r.buckets.days0to30),
          days31to60: round2(acc.days31to60 + r.buckets.days31to60),
          days61to90: round2(acc.days61to90 + r.buckets.days61to90),
          days91to180: round2(acc.days91to180 + r.buckets.days91to180),
          over180: round2(acc.over180 + r.buckets.over180),
        }),
        { ...EMPTY_STOCK_BUCKETS }
      ),
    };

    return res.json({ success: true, data: { asOf: asOf.toISOString(), rows, totals } });
  } catch (error) {
    console.error('Stock aging report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── GET /reports/advanced/aging/movement ───────────────────────────────────
// Fast/slow-moving analysis over a window (?days=, default 30): units
// sold per product vs current sellable stock -> daily rate, days of
// cover, FAST/MEDIUM/SLOW/DEAD class (see classifyMovement).
export const getMovementReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const scope = resolveScope(req);
    const { gte, lte, days } = resolveWindow(req, 30);
    const now = new Date();

    const saleWhere: any = { status: { not: 'REFUNDED' }, createdAt: { gte, lte } };
    if (scope.companyId) saleWhere.companyId = scope.companyId;
    if (scope.branchId) saleWhere.branchId = scope.branchId;

    const [saleItems, products, batches] = await Promise.all([
      prisma.saleItem.findMany({
        where: { sale: saleWhere },
        select: { productId: true, quantity: true, unitsDeducted: true },
      }),
      prisma.product.findMany({
        where: {
          ...(scope.companyId ? { companyId: scope.companyId } : {}),
          ...(scope.branchId ? { branchId: scope.branchId } : {}),
          isActive: true,
          isService: false,
        },
        select: { id: true, name: true, sku: true, minStock: true },
      }),
      prisma.batch.findMany({
        where: {
          isActive: true,
          ...(scope.companyId ? { companyId: scope.companyId } : {}),
          ...(scope.branchId ? { branchId: scope.branchId } : {}),
        },
        select: { productId: true, quantity: true, expireDate: true },
      }),
    ]);

    const soldByProduct = new Map<string, number>();
    for (const item of saleItems as any[]) {
      const units = Number(item.unitsDeducted ?? item.quantity ?? 0);
      soldByProduct.set(item.productId, (soldByProduct.get(item.productId) || 0) + units);
    }
    const stockByProduct = new Map<string, number>();
    for (const batch of batches as any[]) {
      const expired = batch.expireDate && new Date(batch.expireDate) <= now;
      if (expired) continue;
      stockByProduct.set(batch.productId, (stockByProduct.get(batch.productId) || 0) + (batch.quantity || 0));
    }

    const rows = (products as any[]).map((product) => {
      const unitsSold = soldByProduct.get(product.id) || 0;
      const currentStock = stockByProduct.get(product.id) || 0;
      const movement = classifyMovement({ unitsSold, daysInPeriod: days, currentStock });
      return {
        productId: product.id,
        productName: product.name,
        sku: product.sku,
        unitsSold,
        currentStock,
        minStock: product.minStock ?? 0,
        dailyRate: movement.dailyRate,
        daysOfCover: movement.daysOfCover,
        movementClass: movement.movementClass,
      };
    });
    const classRank: Record<string, number> = { FAST: 0, MEDIUM: 1, SLOW: 2, DEAD: 3 };
    rows.sort((a, b) => classRank[a.movementClass] - classRank[b.movementClass] || b.unitsSold - a.unitsSold);
    const counts = {
      FAST: rows.filter(r => r.movementClass === 'FAST').length,
      MEDIUM: rows.filter(r => r.movementClass === 'MEDIUM').length,
      SLOW: rows.filter(r => r.movementClass === 'SLOW').length,
      DEAD: rows.filter(r => r.movementClass === 'DEAD').length,
    };

    return res.json({
      success: true,
      data: { from: gte.toISOString(), to: lte.toISOString(), days, rows, counts, products: rows.length },
    });
  } catch (error) {
    console.error('Movement report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── GET /reports/advanced/aging/profitability ──────────────────────────────
// Medicine-wise profitability over a window (?days=, default 30):
// revenue (SaleItem.totalPrice) minus COGS (base units sold x batch
// purchasePrice). Lines with no batch cost are excluded from cost and
// counted as unknownCostUnits — never silently priced at zero. Refunds
// are NOT netted here: this is gross sales profitability per product;
// net profit lives in the accounting P&L (item 8's area).
export const getProfitabilityReport = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const scope = resolveScope(req);
    const { gte, lte, days } = resolveWindow(req, 30);

    const saleWhere: any = { status: { not: 'REFUNDED' }, createdAt: { gte, lte } };
    if (scope.companyId) saleWhere.companyId = scope.companyId;
    if (scope.branchId) saleWhere.branchId = scope.branchId;

    const [saleItems, products] = await Promise.all([
      prisma.saleItem.findMany({
        where: { sale: saleWhere },
        select: {
          productId: true,
          quantity: true,
          unitsDeducted: true,
          totalPrice: true,
          batch: { select: { purchasePrice: true } },
        },
      }),
      prisma.product.findMany({
        where: {
          ...(scope.companyId ? { companyId: scope.companyId } : {}),
          ...(scope.branchId ? { branchId: scope.branchId } : {}),
        },
        select: { id: true, name: true, sku: true },
      }),
    ]);

    const productById = new Map((products as any[]).map((p: any) => [p.id, p]));
    const linesByProduct = new Map<string, Array<{
      totalPrice: number;
      unitsDeducted: number | null | undefined;
      quantity: number;
      batchPurchasePrice: number | null | undefined;
    }>>();
    for (const item of saleItems as any[]) {
      const list = linesByProduct.get(item.productId) || [];
      list.push({
        totalPrice: item.totalPrice,
        unitsDeducted: item.unitsDeducted ?? null,
        quantity: item.quantity,
        batchPurchasePrice: item.batch?.purchasePrice ?? null,
      });
      linesByProduct.set(item.productId, list);
    }

    const rows = Array.from(linesByProduct.entries()).map(([productId, lines]) => {
      const profit = productProfitability(lines);
      const product = productById.get(productId);
      return {
        productId,
        productName: product?.name || 'Unknown product',
        sku: product?.sku || null,
        ...profit,
      };
    });
    rows.sort((a, b) => b.grossProfit - a.grossProfit);
    const totals = {
      revenue: round2(rows.reduce((n, r) => n + r.revenue, 0)),
      cost: round2(rows.reduce((n, r) => n + r.cost, 0)),
      grossProfit: round2(rows.reduce((n, r) => n + r.grossProfit, 0)),
      unitsSold: rows.reduce((n, r) => n + r.unitsSold, 0),
      unknownCostUnits: rows.reduce((n, r) => n + r.unknownCostUnits, 0),
    };

    return res.json({
      success: true,
      data: { from: gte.toISOString(), to: lte.toISOString(), days, rows, totals },
    });
  } catch (error) {
    console.error('Profitability report error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
