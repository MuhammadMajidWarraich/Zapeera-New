// Multi-batch FEFO allocation (gap-features item 3 — strip / box /
// loose unit conversion at POS).
//
// THE GAP IT CLOSES: the web sale engine used to require ONE batch
// holding the whole line quantity (`findFirst` with `quantity >=
// unitsRequired`). A sale of 15 loose tablets failed when the stock
// sat as 10 + 10 across two batches, and selling 1 strip (10 tablets)
// failed when the nearest-expiry batch held only 8 — even though the
// branch held enough in total. The desktop embedded sale route
// (electron/routes/sales.routes.js) already allocates FEFO across
// batches with a `deductions` plan; the web engine now does the same,
// and persists the plan as SaleItemBatch rows so refunds and sale
// deletion can return every unit to the batch it actually came from.
//
// All functions here are pure (no Prisma, no I/O) so they are unit
// tested directly in tests/fefo-allocation.test.ts. Callers pass
// batches ALREADY ordered FEFO (nearest expiry first) — the sale
// controller's `orderBy: { expireDate: 'asc' }` — and quantities in
// BASE units (tablets), which the C2 unit engine
// (utils/unit.util.resolveSaleLineUnits) already resolves for
// PACK/STRIP/UNIT lines. Breaking a strip/box is nothing special at
// this level: a strip is 10 base units, and FEFO simply takes 10
// base units from the nearest-expiry batch(es), splitting across
// batches when one batch cannot cover the line.

export interface FefoBatchInput {
  id: string;
  /** Current available quantity in BASE units. */
  quantity: number;
}

export interface FefoAllocation {
  batchId: string;
  /** Base units taken from this batch. */
  qty: number;
}

export interface FefoPlan {
  /** One entry per batch touched, in FEFO order. Sums to `required` when shortfall is 0. */
  allocations: FefoAllocation[];
  /** Base units still uncovered (0 when the plan is complete). */
  shortfall: number;
}

/**
 * Greedy FEFO allocation: take from the nearest-expiry batch first,
 * spill into the next batch when it runs out. Batches with quantity
 * <= 0 are skipped. Never mutates the input.
 */
export function allocateFefo(batches: FefoBatchInput[], required: number): FefoPlan {
  const allocations: FefoAllocation[] = [];
  let remaining = Math.max(0, Math.floor(required || 0));
  for (const batch of batches) {
    if (remaining <= 0) break;
    const free = Math.max(0, Math.floor(batch.quantity || 0));
    if (free <= 0) continue;
    const take = Math.min(remaining, free);
    allocations.push({ batchId: batch.id, qty: take });
    remaining -= take;
  }
  return { allocations, shortfall: remaining };
}

/**
 * Plan a refund restock across a sale line's original FEFO
 * allocations.
 *
 * `unitsToReturn` is the base units this refund returns (the refund
 * controller derives it from the sale line's own
 * unitsDeducted/quantity ratio). `priorReturnedBaseUnits` is how
 * many base units of THIS sale line were already returned by earlier
 * refunds of the same sale — those are attributed to the earliest
 * (FEFO-first) allocations first, exactly the order this function
 * restocks in, so a batch can never be credited twice for the same
 * units. The returned plan sums to at most `unitsToReturn` and never
 * exceeds any allocation's remaining (unrefunded) quantity.
 *
 * Callers that cannot attribute prior refunds per line (refund items
 * carry productId, not saleItemId) pass the product-level prior total
 * computed with the line's own ratio — exact whenever a product was
 * sold on one line, and exact for every C2 (unitLevel) line, whose
 * ratio is always 1.
 */
export function planRefundRestock(
  allocations: FefoAllocation[],
  unitsToReturn: number,
  priorReturnedBaseUnits = 0
): FefoAllocation[] {
  let toReturn = Math.max(0, Math.floor(unitsToReturn || 0));
  let alreadyReturned = Math.max(0, Math.floor(priorReturnedBaseUnits || 0));
  const plan: FefoAllocation[] = [];
  for (const alloc of allocations) {
    if (toReturn <= 0) break;
    // Skip the part of this allocation already returned by prior refunds.
    const alreadyFromThis = Math.min(alreadyReturned, alloc.qty);
    alreadyReturned -= alreadyFromThis;
    const stillOut = alloc.qty - alreadyFromThis;
    if (stillOut <= 0) continue;
    const take = Math.min(toReturn, stillOut);
    plan.push({ batchId: alloc.batchId, qty: take });
    toReturn -= take;
  }
  return plan;
}
