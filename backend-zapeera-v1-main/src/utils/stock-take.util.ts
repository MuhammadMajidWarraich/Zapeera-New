// Stock-take (Wave C6 — Retail pack): the variance math of a formal
// physical count. Pure functions — the controller owns the database,
// this file owns the arithmetic, so the numbers a manager signs off
// are exactly the numbers the completion transaction posts.
//
// THE MODEL:
//   • Each counted line snapshots systemQty (the batch's quantity at
//     the moment of the count). variance = countedQty - systemQty.
//     A line with countedQty null is UNCOUNTED: it has no variance
//     and completion never touches its batch.
//   • Completion applies, per counted line with variance != 0: the
//     batch's quantity is SET to countedQty (not incremented — the
//     count is the truth) and a STOCK_TAKE_ADJUSTMENT stock movement
//     records the signed variance. Zero-variance lines are frozen
//     with variance 0 and no movement.

export interface StockTakeLineLike {
  batchId: string;
  productId: string;
  systemQty: number;
  countedQty: number | null | undefined;
}

/** Variance of one line; null while the line is uncounted. */
export function lineVariance(systemQty: number, countedQty: number | null | undefined): number | null {
  if (countedQty === null || countedQty === undefined) return null;
  return countedQty - systemQty;
}

export interface StockTakeAdjustment {
  batchId: string;
  productId: string;
  systemQty: number;
  countedQty: number;
  variance: number;
}

/**
 * The exact set of batch corrections a completion posts: counted
 * lines whose variance is non-zero, in line order.
 */
export function completionAdjustments(lines: StockTakeLineLike[]): StockTakeAdjustment[] {
  const out: StockTakeAdjustment[] = [];
  for (const line of lines) {
    const variance = lineVariance(line.systemQty, line.countedQty);
    if (variance === null || variance === 0) continue;
    out.push({
      batchId: line.batchId,
      productId: line.productId,
      systemQty: line.systemQty,
      countedQty: line.countedQty as number,
      variance,
    });
  }
  return out;
}

export interface StockTakeSummary {
  lineCount: number;
  countedLines: number;
  uncountedLines: number;
  /** Σ systemQty over counted lines. */
  totalSystem: number;
  /** Σ countedQty over counted lines. */
  totalCounted: number;
  /** Σ variance over counted lines (== totalCounted - totalSystem). */
  totalVariance: number;
  /** Units missing (the absolute sum of negative variances). */
  shortageUnits: number;
  /** Units over (the sum of positive variances). */
  surplusUnits: number;
  /** Counted lines the completion will correct (variance != 0). */
  adjustedLines: number;
}

/** The register summary shown before and after completion. */
export function summarizeStockTake(lines: StockTakeLineLike[]): StockTakeSummary {
  let countedLines = 0;
  let totalSystem = 0;
  let totalCounted = 0;
  let shortageUnits = 0;
  let surplusUnits = 0;
  let adjustedLines = 0;

  for (const line of lines) {
    const variance = lineVariance(line.systemQty, line.countedQty);
    if (variance === null) continue;
    countedLines += 1;
    totalSystem += line.systemQty;
    totalCounted += line.countedQty as number;
    if (variance < 0) shortageUnits += -variance;
    if (variance > 0) surplusUnits += variance;
    if (variance !== 0) adjustedLines += 1;
  }

  return {
    lineCount: lines.length,
    countedLines,
    uncountedLines: lines.length - countedLines,
    totalSystem,
    totalCounted,
    totalVariance: totalCounted - totalSystem,
    shortageUnits,
    surplusUnits,
    adjustedLines,
  };
}
