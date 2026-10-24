/**
 * Controlled / narcotics register (Gap item 2 — CloudPOS parity).
 *
 * An APPEND-ONLY dispense log for scheduled/controlled medicines:
 * one row per POS sale line of a controlled product, one REVERSAL row
 * per refunded / corrected quantity. Rows are NEVER updated or
 * deleted — corrections are reversing entries only.
 *
 * Append-only is enforced AT THIS SERVICE LAYER:
 *   - this module exports no update / delete function for log rows,
 *   - the controller exposes no PUT / DELETE route for them,
 *   - tests/controlled-medicines.test.ts statically asserts that no
 *     update, delete or upsert call on the log delegate exists
 *     anywhere in src/, and the test fails the build if one is added.
 * A direct Prisma call from elsewhere would bypass the service, the
 * same way any direct Prisma call bypasses any service in this
 * codebase; the guard is that no such call exists and the test fails
 * the build if one is added.
 *
 * Balance semantics: `balanceAfter` is the batch's stock on hand
 * immediately after the entry was written (read inside the same
 * transaction, after the decrement / restock). The register is a
 * DISPENSE register, not a stock ledger — purchases/receipts are not
 * logged here — so the running balance per product/batch is carried
 * by that snapshot, not derived from the log alone.
 *
 * Quantities are BASE units (tablets/pieces, the same units the sale
 * engine deducts): positive on DISPENSE, negative on REVERSAL.
 */

// ─── Schedule labels ──────────────────────────────────────────────────────
// Category labels only — the pharmacy sets them per product. They make
// no regulatory claim about the drug's legal class.
export const CONTROLLED_SCHEDULES = [
  'NARCOTIC',
  'PSYCHOTROPIC',
  'SCHEDULE_II',
  'SCHEDULE_III',
  'SCHEDULE_IV',
  'SCHEDULE_V',
  'CONTROLLED',
] as const;

export type ControlledSchedule = (typeof CONTROLLED_SCHEDULES)[number];

export const CONTROLLED_SCHEDULE_LABELS: Record<string, string> = {
  NARCOTIC: 'Narcotic',
  PSYCHOTROPIC: 'Psychotropic',
  SCHEDULE_II: 'Schedule II',
  SCHEDULE_III: 'Schedule III',
  SCHEDULE_IV: 'Schedule IV',
  SCHEDULE_V: 'Schedule V',
  CONTROLLED: 'Controlled',
};

/** Domain error carrying an HTTP status (honoured by error.middleware). */
export class ControlledRegisterError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'ControlledRegisterError';
    this.statusCode = statusCode;
  }
}

/**
 * Normalize a client-sent schedule value: upper-cased, must be one of
 * CONTROLLED_SCHEDULES; '' / null / undefined clears it. Returns an
 * error string instead of throwing so controllers can answer 400.
 */
export function normalizeControlledSchedule(
  value: unknown
): { schedule: string | null } | { error: string } {
  if (value === undefined || value === null || value === '') return { schedule: null };
  const normalized = String(value).trim().toUpperCase().replace(/[\s-]+/g, '_');
  if ((CONTROLLED_SCHEDULES as readonly string[]).includes(normalized)) {
    return { schedule: normalized };
  }
  return {
    error: `Invalid controlled schedule "${value}". Allowed: ${CONTROLLED_SCHEDULES.join(', ')}`,
  };
}

/** Display label for a product's schedule; unflagged schedule reads CONTROLLED. */
export function displayControlledSchedule(product: {
  isControlled?: boolean | null;
  controlledSchedule?: string | null;
}): string {
  if (!product?.isControlled) return '';
  const schedule = (product.controlledSchedule || 'CONTROLLED').toUpperCase();
  return CONTROLLED_SCHEDULE_LABELS[schedule] || schedule;
}

// ─── Append (DISPENSE) ────────────────────────────────────────────────────

export interface ControlledDispenseLineInput {
  saleItemId: string;
  productId: string;
  /** True when the product is flagged isControlled. Non-controlled lines are skipped. */
  isControlled: boolean;
  batchId: string | null;
  batchNo: string | null;
  /** Base units dispensed (the sale line's unitsDeducted). */
  quantity: number;
}

export interface AppendDispenseInput {
  companyId: string;
  branchId: string;
  saleId: string;
  invoiceNumber: string | null;
  staffUserId: string;
  staffName?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  prescriptionId?: string | null;
  prescriptionRef?: string | null;
  lines: ControlledDispenseLineInput[];
}

/**
 * Append one DISPENSE entry per controlled sale line. Must be called
 * INSIDE the sale transaction, after the batch decrement, so the
 * balanceAfter snapshot reads the post-sale batch quantity.
 * Non-controlled lines and zero-quantity lines are skipped; the return
 * value is the created entries (possibly empty).
 */
export async function appendControlledDispenseEntries(
  tx: any,
  input: AppendDispenseInput
): Promise<any[]> {
  const created: any[] = [];
  for (const line of input.lines) {
    if (!line.isControlled) continue;
    if (!line.quantity || line.quantity <= 0) continue;
    if (!line.batchId) {
      // A controlled product must always dispense from a batch (the
      // sale engine resolves one for every stocked line). A batch-less
      // controlled line is a data error, not a loggable dispense.
      throw new ControlledRegisterError(
        400,
        'Controlled product cannot be dispensed without a batch'
      );
    }
    const batch = await tx.batch.findUnique({
      where: { id: line.batchId },
      select: { quantity: true },
    });
    const entry = await tx.controlledDispenseLog.create({
      data: {
        companyId: input.companyId,
        branchId: input.branchId,
        productId: line.productId,
        batchId: line.batchId,
        batchNo: line.batchNo,
        saleId: input.saleId,
        saleItemId: line.saleItemId,
        entryType: 'DISPENSE',
        quantity: line.quantity,
        // Post-decrement stock; the batch row must still exist (the
        // sale just decremented it in this same transaction).
        balanceAfter: batch ? batch.quantity : 0,
        staffUserId: input.staffUserId,
        staffName: input.staffName || null,
        customerId: input.customerId || null,
        customerName: input.customerName || null,
        prescriptionId: input.prescriptionId || null,
        prescriptionRef: input.prescriptionRef || null,
        invoiceNumber: input.invoiceNumber || null,
      },
    });
    created.push(entry);
  }
  return created;
}

// ─── Reversal (correction) ────────────────────────────────────────────────

export interface AppendReversalInput {
  companyId: string;
  branchId: string;
  /** The DISPENSE entry being corrected. */
  originalEntryId: string;
  /** Positive base units to reverse (stored as a negative quantity). */
  quantity: number;
  /** Required: why this quantity is being reversed. */
  reason: string;
  staffUserId: string;
  staffName?: string | null;
  saleId?: string | null;
  invoiceNumber?: string | null;
}

/**
 * Append a REVERSAL entry against a DISPENSE entry. The original row
 * is never mutated: the reversal is a new row with a negative
 * quantity pointing at it via reversesId. Partial reversals are
 * allowed, but the cumulative reversed quantity may never exceed the
 * dispensed quantity. Must be called inside the caller's transaction
 * (refund restock / manual correction) so balanceAfter reads the
 * batch quantity as of the reversal.
 */
export async function appendControlledReversalEntry(
  tx: any,
  input: AppendReversalInput
): Promise<any> {
  if (!input.reason || !String(input.reason).trim()) {
    throw new ControlledRegisterError(400, 'A reversal requires a reason');
  }
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new ControlledRegisterError(400, 'Reversal quantity must be a positive whole number');
  }
  const original = await tx.controlledDispenseLog.findUnique({
    where: { id: input.originalEntryId },
  });
  if (!original || original.companyId !== input.companyId) {
    throw new ControlledRegisterError(404, 'Original dispense entry not found in this business');
  }
  if (original.entryType !== 'DISPENSE') {
    throw new ControlledRegisterError(400, 'Only a DISPENSE entry can be reversed');
  }
  const priorReversals = await tx.controlledDispenseLog.findMany({
    where: { reversesId: original.id },
    select: { quantity: true },
  });
  const alreadyReversed = priorReversals.reduce(
    (sum: number, row: any) => sum + Math.abs(Number(row.quantity) || 0),
    0
  );
  if (alreadyReversed + input.quantity > original.quantity) {
    throw new ControlledRegisterError(
      400,
      `Cannot reverse ${input.quantity} units: ${alreadyReversed} of ${original.quantity} dispensed units have already been reversed`
    );
  }
  const batch = original.batchId
    ? await tx.batch.findUnique({
        where: { id: original.batchId },
        select: { quantity: true },
      })
    : null;
  return tx.controlledDispenseLog.create({
    data: {
      companyId: input.companyId,
      branchId: input.branchId,
      productId: original.productId,
      batchId: original.batchId,
      batchNo: original.batchNo,
      saleId: input.saleId || original.saleId || null,
      saleItemId: original.saleItemId || null,
      entryType: 'REVERSAL',
      quantity: -input.quantity,
      // Stock as of the reversal (post-restock in the refund flow;
      // unchanged in a manual register correction).
      balanceAfter: batch ? batch.quantity : original.balanceAfter,
      reversesId: original.id,
      reason: String(input.reason).trim(),
      staffUserId: input.staffUserId,
      staffName: input.staffName || null,
      customerId: original.customerId || null,
      customerName: original.customerName || null,
      prescriptionId: original.prescriptionId || null,
      prescriptionRef: original.prescriptionRef || null,
      invoiceNumber: input.invoiceNumber || original.invoiceNumber || null,
    },
  });
}

export interface RefundReversalLineInput {
  saleItemId: string;
  productId: string;
  isControlled: boolean;
  /** Base units being returned (the refund's unitsToReturn). */
  quantity: number;
  /** Per-line reason (e.g. the refund item's reason); falls back to the batch reason. */
  reason?: string;
}

/**
 * Refund wiring: for each refunded controlled line, reverse the
 * matching DISPENSE entry (looked up by saleItemId) by the returned
 * quantity. Call INSIDE the refund transaction, after the batch
 * restock. Lines whose sale predates the register have no DISPENSE
 * entry — there is nothing to reverse, so they are skipped (the
 * register never contained them). Returns the created reversals.
 */
export async function appendRefundReversals(
  tx: any,
  input: {
    companyId: string;
    branchId: string;
    saleId: string;
    invoiceNumber: string | null;
    staffUserId: string;
    staffName?: string | null;
    reason: string;
    lines: RefundReversalLineInput[];
  }
): Promise<any[]> {
  const created: any[] = [];
  for (const line of input.lines) {
    if (!line.isControlled) continue;
    if (!line.quantity || line.quantity <= 0) continue;
    const original = await tx.controlledDispenseLog.findFirst({
      where: { saleItemId: line.saleItemId, entryType: 'DISPENSE' },
      orderBy: { createdAt: 'asc' },
    });
    if (!original) continue;
    // A refund never reverses more than was dispensed on that line;
    // clamp to the still-unreversed remainder instead of failing the
    // whole refund on a stale partial-reversal edge.
    const priorReversals = await tx.controlledDispenseLog.findMany({
      where: { reversesId: original.id },
      select: { quantity: true },
    });
    const alreadyReversed = priorReversals.reduce(
      (sum: number, row: any) => sum + Math.abs(Number(row.quantity) || 0),
      0
    );
    const remaining = original.quantity - alreadyReversed;
    const quantity = Math.min(line.quantity, remaining);
    if (quantity <= 0) continue;
    created.push(
      await appendControlledReversalEntry(tx, {
        companyId: input.companyId,
        branchId: input.branchId,
        originalEntryId: original.id,
        quantity,
        reason: line.reason || input.reason,
        staffUserId: input.staffUserId,
        staffName: input.staffName || null,
        saleId: input.saleId,
        invoiceNumber: input.invoiceNumber,
      })
    );
  }
  return created;
}

// ─── Report math (pure — no DB, unit-tested) ─────────────────────────────

export interface RegisterEntryLike {
  id: string;
  productId: string;
  productName?: string | null;
  batchId: string | null;
  batchNo: string | null;
  quantity: number;
  balanceAfter: number;
  createdAt: Date | string;
}

export interface RegisterSummary {
  productId: string;
  productName: string | null;
  batchId: string | null;
  batchNo: string | null;
  totalDispensed: number;
  totalReversed: number;
  netDispensed: number;
  /** Batch stock on hand after the latest entry (the running balance). */
  currentBalance: number;
  lastEntryAt: string;
  entryCount: number;
}

/**
 * Per product/batch summary of register entries: total dispensed,
 * total reversed, net dispensed, and the running balance (the latest
 * entry's balanceAfter snapshot). Entries may arrive in any order;
 * grouping is by product + batch.
 */
export function summarizeRegisterEntries(entries: RegisterEntryLike[]): RegisterSummary[] {
  const groups = new Map<string, RegisterSummary & { _latest: number }>();
  for (const entry of entries) {
    const key = `${entry.productId}|${entry.batchId || ''}`;
    const createdMs = new Date(entry.createdAt).getTime();
    let group = groups.get(key);
    if (!group) {
      group = {
        productId: entry.productId,
        productName: entry.productName || null,
        batchId: entry.batchId,
        batchNo: entry.batchNo,
        totalDispensed: 0,
        totalReversed: 0,
        netDispensed: 0,
        currentBalance: entry.balanceAfter,
        lastEntryAt: new Date(entry.createdAt).toISOString(),
        entryCount: 0,
        _latest: createdMs,
      };
      groups.set(key, group);
    }
    if (entry.quantity > 0) group.totalDispensed += entry.quantity;
    else group.totalReversed += Math.abs(entry.quantity);
    group.netDispensed = group.totalDispensed - group.totalReversed;
    group.entryCount += 1;
    if (createdMs >= group._latest) {
      group._latest = createdMs;
      group.currentBalance = entry.balanceAfter;
      group.lastEntryAt = new Date(entry.createdAt).toISOString();
    }
  }
  return [...groups.values()]
    .map(({ _latest, ...summary }) => summary)
    .sort((a, b) => (a.productName || '').localeCompare(b.productName || ''));
}
