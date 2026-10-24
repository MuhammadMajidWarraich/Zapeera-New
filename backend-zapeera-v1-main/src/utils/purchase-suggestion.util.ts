// ─── Auto-purchase + aging reports (Gap Item 4) — pure logic ───────────────
// Every function here is pure (plain data in, plain data out) so the
// money/stock math is unit-testable without a database. Controllers feed
// these functions with Prisma rows; nothing here touches Prisma, the
// network, or the filesystem — in particular NOTHING here can create a
// Purchase: suggestion generation returns proposal data only, and a
// Purchase exists only after an explicit approval through the
// purchase-suggestion controller's approve endpoint.

export type AgeBucketKey = 'days0to30' | 'days31to60' | 'days61to90' | 'over90';

export interface AgeBuckets {
  days0to30: number;
  days31to60: number;
  days61to90: number;
  over90: number;
}

export const EMPTY_BUCKETS: AgeBuckets = {
  days0to30: 0,
  days31to60: 0,
  days61to90: 0,
  over90: 0,
};

/** Whole days between two dates (never negative). */
export function ageDays(from: Date, asOf: Date): number {
  return Math.max(
    0,
    Math.floor((asOf.getTime() - new Date(from).getTime()) / 86400000)
  );
}

/** Which aging bucket an age in days falls in. Boundaries are inclusive
 *  at the top: 0–30, 31–60, 61–90, 91+. */
export function ageBucket(days: number): AgeBucketKey {
  if (days <= 30) return 'days0to30';
  if (days <= 60) return 'days31to60';
  if (days <= 90) return 'days61to90';
  return 'over90';
}

/** Bucket a list of dated outstanding amounts (e.g. unpaid purchases).
 *  Each item contributes its outstanding amount to the bucket of its
 *  age. Returns per-bucket totals plus the grand total. */
export function bucketOutstandingByAge(
  items: Array<{ date: Date; outstanding: number }>,
  asOf: Date
): { buckets: AgeBuckets; total: number } {
  const buckets: AgeBuckets = { ...EMPTY_BUCKETS };
  let total = 0;
  for (const item of items) {
    const amount = Number(item.outstanding || 0);
    if (amount <= 0) continue;
    buckets[ageBucket(ageDays(item.date, asOf))] += amount;
    total += amount;
  }
  return {
    buckets: {
      days0to30: round2(buckets.days0to30),
      days31to60: round2(buckets.days31to60),
      days61to90: round2(buckets.days61to90),
      over90: round2(buckets.over90),
    },
    total: round2(total),
  };
}

/** Round to 2dp (same rule as utils/accounting.util round2). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// ─── Suggestion thresholds ─────────────────────────────────────────────────

export type SuggestionReason =
  | 'BELOW_REORDER_LEVEL'
  | 'BELOW_MIN_STOCK'
  | 'EXPIRING_STOCK';

export interface SuggestionInput {
  /** Live stock in base units (all live batches, expired included). */
  currentStock: number;
  /** Sellable stock: live batches excluding expired ones (FEFO basis). */
  sellableStock: number;
  /** Sellable units sitting in batches expiring within 30 days. */
  expiringStock: number;
  /** Opt-in reorder point (null = product never opted in). */
  reorderLevel: number | null;
  /** Fixed reorder quantity (null = top-up formula). */
  reorderQuantity: number | null;
  /** Low-stock alert threshold. */
  minStock: number;
  /** Optional ceiling; suggested qty never exceeds maxStock − stock. */
  maxStock: number | null;
}

/**
 * Decide whether a product needs a purchase suggestion and how much.
 * Rules, in priority order:
 *  1. Opted-in products (reorderLevel set) suggest when sellable stock
 *     is at or below the reorder level — the C3 rule, on the FEFO
 *     (sellable, not raw) stock basis. Suggested qty = fixed
 *     reorderQuantity when set, else 2 x level − sellable stock.
 *  2. Otherwise, products below minStock suggest a top-up to
 *     2 x minStock (the low-stock alert threshold is a promise the
 *     shelf should not sit below; the suggestion restores headroom).
 *  3. EXPIRING_STOCK is a modifier, not a trigger on its own: when a
 *     product triggers on rule 1 or 2 AND more than half its sellable
 *     stock expires within 30 days, the reason is upgraded and the
 *     suggested qty covers the expiring units too (they will be
 *     unsellable before the next cycle).
 * Suggested qty is always >= 1 and capped by maxStock when set.
 * Returns null when no suggestion is needed.
 */
export function computeSuggestion(input: SuggestionInput): {
  reason: SuggestionReason;
  suggestedQty: number;
} | null {
  const { sellableStock, expiringStock, reorderLevel, reorderQuantity, minStock, maxStock } = input;

  let reason: SuggestionReason | null = null;
  let suggestedQty = 0;

  if (reorderLevel !== null && reorderLevel !== undefined && sellableStock <= reorderLevel) {
    reason = 'BELOW_REORDER_LEVEL';
    suggestedQty = reorderQuantity
      ? reorderQuantity
      : Math.max(1, reorderLevel * 2 - sellableStock);
  } else if (sellableStock < minStock) {
    reason = 'BELOW_MIN_STOCK';
    suggestedQty = Math.max(1, minStock * 2 - sellableStock);
  } else {
    return null;
  }

  // Expiring-stock modifier: most of the sellable shelf dies within 30d.
  if (expiringStock > 0 && sellableStock > 0 && expiringStock * 2 > sellableStock) {
    reason = 'EXPIRING_STOCK';
    suggestedQty = Math.max(suggestedQty, expiringStock);
  }

  if (maxStock !== null && maxStock !== undefined) {
    suggestedQty = Math.min(suggestedQty, Math.max(1, maxStock - sellableStock));
    if (suggestedQty < 1) suggestedQty = 1;
  }

  return { reason, suggestedQty };
}

// ─── Approval gate (state machine) ─────────────────────────────────────────
// The ONLY transition that may create a Purchase is PENDING -> APPROVED,
// driven by an explicit approve call. Everything else is rejected here
// so a double-approve, an approve-after-reject, or an approve of an
// expired suggestion can never mint a second (or any) Purchase.

export type SuggestionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';

export function canApprove(status: string): boolean {
  return status === 'PENDING';
}

export function canReject(status: string): boolean {
  return status === 'PENDING';
}

/** Validate a status transition; throws on any illegal move. */
export function assertTransition(from: string, to: SuggestionStatus): void {
  const allowed: Record<string, SuggestionStatus[]> = {
    PENDING: ['APPROVED', 'REJECTED', 'EXPIRED'],
    APPROVED: [],
    REJECTED: [],
    EXPIRED: [],
  };
  if (!(allowed[from] || []).includes(to)) {
    throw new Error(`Illegal suggestion transition: ${from} -> ${to}`);
  }
}

// ─── Stock aging + movement ────────────────────────────────────────────────

export type StockAgeBucketKey = 'days0to30' | 'days31to60' | 'days61to90' | 'days91to180' | 'over180';

export interface StockAgeBuckets {
  days0to30: number;
  days31to60: number;
  days61to90: number;
  days91to180: number;
  over180: number;
}

/** Stock-age bucket by days since the batch was received (createdAt).
 *  Stock value ages with the batch, not with the product. */
export function stockAgeBucket(days: number): StockAgeBucketKey {
  if (days <= 30) return 'days0to30';
  if (days <= 60) return 'days31to60';
  if (days <= 90) return 'days61to90';
  if (days <= 180) return 'days91to180';
  return 'over180';
}

export type MovementClass = 'FAST' | 'MEDIUM' | 'SLOW' | 'DEAD';

export interface MovementInput {
  /** Base units sold in the analysis window. */
  unitsSold: number;
  /** Length of the window in days (>= 1). */
  daysInPeriod: number;
  /** Current sellable stock in base units. */
  currentStock: number;
}

/**
 * Classify how fast a product moves and how long current stock lasts.
 *  - DEAD: nothing sold in the window.
 *  - FAST: sells through current stock within 30 days at current rate.
 *  - SLOW: current stock lasts more than 90 days at current rate.
 *  - MEDIUM: everything in between.
 * daysOfCover is null when there is no sales rate to project from.
 */
export function classifyMovement(input: MovementInput): {
  movementClass: MovementClass;
  dailyRate: number;
  daysOfCover: number | null;
} {
  const days = Math.max(1, input.daysInPeriod);
  const dailyRate = round2(input.unitsSold / days);
  if (input.unitsSold <= 0 || dailyRate <= 0) {
    return { movementClass: 'DEAD', dailyRate: 0, daysOfCover: null };
  }
  const daysOfCover = Math.floor(input.currentStock / dailyRate);
  if (daysOfCover <= 30) return { movementClass: 'FAST', dailyRate, daysOfCover };
  if (daysOfCover > 90) return { movementClass: 'SLOW', dailyRate, daysOfCover };
  return { movementClass: 'MEDIUM', dailyRate, daysOfCover };
}

// ─── Medicine-wise profitability ───────────────────────────────────────────

/**
 * Gross profit for one product over a window.
 * revenue = sum of SaleItem.totalPrice (money truth; on C2 unit-level
 * lines totalPrice is level-qty x level-price).
 * cost = base units sold x batch purchasePrice (FEFO/COGS basis — the
 * same basis utils/accounting.util summarizeCogs uses). Units sold in
 * base units = unitsDeducted when recorded, else quantity.
 * Lines with no batch cost are reported separately (unknownCostUnits)
 * and excluded from cost — never silently priced at zero.
 */
export function productProfitability(lines: Array<{
  totalPrice: number;
  unitsDeducted: number | null | undefined;
  quantity: number;
  batchPurchasePrice: number | null | undefined;
}>): {
  revenue: number;
  cost: number;
  grossProfit: number;
  marginPct: number | null;
  unitsSold: number;
  unknownCostUnits: number;
} {
  let revenue = 0;
  let cost = 0;
  let unitsSold = 0;
  let unknownCostUnits = 0;
  for (const line of lines) {
    const units = Number(line.unitsDeducted ?? line.quantity ?? 0);
    revenue += Number(line.totalPrice || 0);
    unitsSold += units;
    if (line.batchPurchasePrice === null || line.batchPurchasePrice === undefined) {
      unknownCostUnits += units;
    } else {
      cost += Number(line.batchPurchasePrice) * units;
    }
  }
  revenue = round2(revenue);
  cost = round2(cost);
  const grossProfit = round2(revenue - cost);
  return {
    revenue,
    cost,
    grossProfit,
    marginPct: revenue > 0 ? round2((grossProfit / revenue) * 100) : null,
    unitsSold,
    unknownCostUnits,
  };
}

// ─── Customer risk band (khata aging extension) ────────────────────────────

/** Risk band from the oldest open due: CURRENT (<=30d), WATCH (31–60),
 *  OVERDUE (61–90), CRITICAL (90+). */
export function customerRiskBand(oldestDueAgeDays: number | null): string {
  if (oldestDueAgeDays === null) return 'CURRENT';
  if (oldestDueAgeDays <= 30) return 'CURRENT';
  if (oldestDueAgeDays <= 60) return 'WATCH';
  if (oldestDueAgeDays <= 90) return 'OVERDUE';
  return 'CRITICAL';
}
