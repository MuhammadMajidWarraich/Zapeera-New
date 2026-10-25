// ─── Daraz order polling (Tier 1 sales channel) ──────────────────────────
// In-process scheduled job, following jobs/subscription-cron.ts:
//   startDarazOrderPoll() called from server.ts; runs once immediately,
//   then on a setInterval. No VM crontab, no new infrastructure.
//
// What it does:
//   • Every 15 min: for each business with a CONNECTED Daraz row,
//     triggerSync(prisma, businessId, 'daraz', { entity: 'order' }).
//   • Every 60 min: same call with { entity: 'stock' } (hourly push).
//
// What it does NOT do (deliberately): the handler owns the cursor,
// pagination, dedup and idempotency (integrations/daraz/handler.ts), so
// a missed tick is harmless — the next tick re-reads from the cursor.
// This module only finds connected businesses, fans the call out, and
// isolates failures per connection. It never touches the sale shape,
// the walk-in/COD/no-khata rule, or any other integration.
//
// Backoff: a connection that fails repeatedly is skipped for an
// exponentially growing number of its entity's ticks (1, 2, 4, 8 —
// capped at 8 ticks). A success resets the backoff. A skipped
// connection is logged, never retried early, and never blocks others.
// With zero CONNECTED Daraz rows a tick logs one quiet line and
// returns — no error, no sync-log spam (triggerSync is never called).

import { getPrisma } from '../utils/db.util';
import { triggerSync } from '../services/integration.service';

/** Order poll cadence — Daraz has no webhooks; see daraz README §3. */
export const DARAZ_ORDER_POLL_MS = 15 * 60 * 1000;
/** Hourly stock push cadence — see daraz README §2/§4. */
export const DARAZ_STOCK_PUSH_MS = 60 * 60 * 1000;

/** Backoff cap, in ticks of the entity's own interval (1, 2, 4, 8). */
const MAX_BACKOFF_TICKS = 8;

const LOG_PREFIX = '[DarazOrderPoll]';

type PollEntity = 'order' | 'stock';

export interface DarazOrderPollDeps {
  /** Defaults to the real getPrisma(). Injectable for tests. */
  getPrisma?: () => Promise<any>;
  /** Defaults to the real triggerSync(). Injectable for tests. */
  triggerSync?: typeof triggerSync;
}

interface BackoffState {
  /** Consecutive failures for this (business, entity). */
  failures: number;
  /** Epoch ms before which this (business, entity) is skipped. */
  nextEligibleAt: number;
}

export interface DarazOrderPollHandle {
  start: () => void;
  stop: () => void;
  /** Run one order tick now (used by the interval; exposed for tests). */
  runOrderPoll: () => Promise<void>;
  /** Run one stock tick now (used by the interval; exposed for tests). */
  runStockPush: () => Promise<void>;
}

export function createDarazOrderPoll(deps: DarazOrderPollDeps = {}): DarazOrderPollHandle {
  const resolvePrisma = deps.getPrisma ?? getPrisma;
  const sync = deps.triggerSync ?? triggerSync;

  // Backoff state, keyed `${businessId}:${entity}`. Lives on the handle
  // (not module-global) so tests get a fresh state per handle.
  const backoff = new Map<string, BackoffState>();

  let orderTimer: NodeJS.Timeout | undefined;
  let stockTimer: NodeJS.Timeout | undefined;
  let orderRunning = false;
  let stockRunning = false;
  let started = false;

  function backoffKey(businessId: string, entity: PollEntity): string {
    return `${businessId}:${entity}`;
  }

  function isBackedOff(businessId: string, entity: PollEntity): BackoffState | null {
    const state = backoff.get(backoffKey(businessId, entity));
    if (!state) return null;
    if (Date.now() < state.nextEligibleAt) return state;
    return null;
  }

  function recordSuccess(businessId: string, entity: PollEntity): void {
    backoff.delete(backoffKey(businessId, entity));
  }

  function recordFailure(businessId: string, entity: PollEntity, intervalMs: number): void {
    const key = backoffKey(businessId, entity);
    const prev = backoff.get(key);
    const failures = (prev?.failures ?? 0) + 1;
    // Skip 1, 2, 4, 8 … ticks of this entity's interval, capped at 8.
    // The tick that just failed already ran, so the next eligible tick
    // is (skipTicks + 1) intervals out — e.g. failures=1 skips the
    // very next tick and retries on the one after.
    const skipTicks = Math.min(2 ** (failures - 1), MAX_BACKOFF_TICKS);
    const nextEligibleAt = Date.now() + (skipTicks + 1) * intervalMs;
    backoff.set(key, { failures, nextEligibleAt });
    console.log(
      `${LOG_PREFIX} Backing off business=${businessId} entity=${entity} ` +
        `failures=${failures} — skipping next ${skipTicks} tick(s) ` +
        `(retry in ~${Math.round(((skipTicks + 1) * intervalMs) / 60_000)} min)`
    );
  }

  async function listConnectedDarazBusinesses(prisma: any): Promise<string[]> {
    const rows = await prisma.integrationConnection.findMany({
      where: {
        provider: 'daraz',
        status: 'connected',
        encryptedCredentials: { not: null }
      },
      select: { businessId: true }
    });
    return rows.map((row: { businessId: string }) => row.businessId);
  }

  async function runTick(entity: PollEntity, intervalMs: number): Promise<void> {
    let prisma: any;
    try {
      prisma = await resolvePrisma();
    } catch (err: any) {
      console.error(`${LOG_PREFIX} Cannot reach database for ${entity} tick:`, err?.message ?? err);
      return;
    }

    let businessIds: string[];
    try {
      businessIds = await listConnectedDarazBusinesses(prisma);
    } catch (err: any) {
      console.error(`${LOG_PREFIX} Cannot list Daraz connections for ${entity} tick:`, err?.message ?? err);
      return;
    }

    if (businessIds.length === 0) {
      console.log(`${LOG_PREFIX} No connected Daraz businesses — nothing to ${entity === 'order' ? 'poll' : 'push'}.`);
      return;
    }

    let attempted = 0;
    let succeeded = 0;
    let failed = 0;
    let skipped = 0;

    for (const businessId of businessIds) {
      // Per-connection backoff: a repeatedly failing connection is
      // skipped without touching triggerSync (and without a log row).
      const backedOff = isBackedOff(businessId, entity);
      if (backedOff) {
        skipped++;
        console.log(
          `${LOG_PREFIX} Skipping business=${businessId} entity=${entity} ` +
            `(backoff, failures=${backedOff.failures})`
        );
        continue;
      }

      attempted++;
      try {
        // triggerSync writes the IntegrationSyncLog row itself
        // (created 'failed' first, then updated) and dispatches to
        // the Daraz handler, which owns cursor/pagination/dedup.
        const { result } = await sync(prisma, businessId, 'daraz', { entity });
        recordSuccess(businessId, entity);
        succeeded++;
        console.log(
          `${LOG_PREFIX} ${entity} business=${businessId} ` +
            `processed=${result?.recordsProcessed ?? 0} failed=${result?.recordsFailed ?? 0}` +
            (result?.message ? ` — ${result.message}` : '')
        );
      } catch (err: any) {
        // Per-connection error isolation: one connection failing
        // (NOT_CONNECTED, vendor error, unknown SKU, …) must never
        // stop the other connections or crash the server.
        failed++;
        recordFailure(businessId, entity, intervalMs);
        console.error(
          `${LOG_PREFIX} ${entity} failed business=${businessId}:`,
          err?.message ?? err
        );
      }
    }

    console.log(
      `${LOG_PREFIX} ${entity} tick done: ` +
        `${succeeded} ok / ${failed} failed / ${skipped} backed-off ` +
        `of ${businessIds.length} connected`
    );
  }

  async function runOrderPoll(): Promise<void> {
    if (orderRunning) {
      console.log(`${LOG_PREFIX} Order tick already running — skipping overlapping tick.`);
      return;
    }
    orderRunning = true;
    try {
      await runTick('order', DARAZ_ORDER_POLL_MS);
    } catch (err: any) {
      // runTick already guards its own steps; this is a last resort so
      // an unexpected throw can never take down the interval/server.
      console.error(`${LOG_PREFIX} Unexpected order-tick error:`, err?.message ?? err);
    } finally {
      orderRunning = false;
    }
  }

  async function runStockPush(): Promise<void> {
    if (stockRunning) {
      console.log(`${LOG_PREFIX} Stock tick already running — skipping overlapping tick.`);
      return;
    }
    stockRunning = true;
    try {
      await runTick('stock', DARAZ_STOCK_PUSH_MS);
    } catch (err: any) {
      console.error(`${LOG_PREFIX} Unexpected stock-tick error:`, err?.message ?? err);
    } finally {
      stockRunning = false;
    }
  }

  function start(): void {
    if (started) {
      console.log(`${LOG_PREFIX} Already started — ignoring duplicate start.`);
      return;
    }
    started = true;
    // Run once immediately, then on the interval — same pattern as
    // subscription-cron / fbr-worker.
    void runOrderPoll();
    void runStockPush();
    orderTimer = setInterval(() => void runOrderPoll(), DARAZ_ORDER_POLL_MS);
    stockTimer = setInterval(() => void runStockPush(), DARAZ_STOCK_PUSH_MS);
    console.log(
      `${LOG_PREFIX} Started (order every ${DARAZ_ORDER_POLL_MS / 60_000} min, ` +
        `stock every ${DARAZ_STOCK_PUSH_MS / 60_000} min)`
    );
  }

  function stop(): void {
    if (orderTimer) clearInterval(orderTimer);
    if (stockTimer) clearInterval(stockTimer);
    orderTimer = undefined;
    stockTimer = undefined;
    started = false;
    console.log(`${LOG_PREFIX} Stopped.`);
  }

  return { start, stop, runOrderPoll, runStockPush };
}

// ─── Module-level singleton (what server.ts wires up) ──────────────────────

let singleton: DarazOrderPollHandle | undefined;

/** Start the Daraz order-poll + hourly stock-push job (idempotent). */
export function startDarazOrderPoll(deps: DarazOrderPollDeps = {}): void {
  if (!singleton) singleton = createDarazOrderPoll(deps);
  singleton.start();
}

/** Stop the job's timers (graceful shutdown / tests). */
export function stopDarazOrderPoll(): void {
  singleton?.stop();
  singleton = undefined;
}
