// Daraz order-poll job tests.
//
// NOTE on location: the job lives in src/jobs/, but jest `roots` is
// `tests` only (jest.config.js), so this file lives here next to the
// existing tests/integrations-daraz.test.ts — a test under src/jobs/
// would never run under `npm test`.
//
// The job is tested through its injectable deps (fake prisma +
// fake triggerSync): no live DB, no live Daraz, no handler involved.
// Cursor rules (5-min overlap, first poll 24h back) live in the
// handler and are covered by tests/integrations-daraz.test.ts —
// not duplicated here.

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  createDarazOrderPoll,
  startDarazOrderPoll,
  stopDarazOrderPoll,
  DARAZ_ORDER_POLL_MS,
  DARAZ_STOCK_PUSH_MS
} from '../src/jobs/daraz-order-poll';

const MIN_15 = 15 * 60 * 1000;
const MIN_60 = 60 * 60 * 1000;

expect(DARAZ_ORDER_POLL_MS).toBe(MIN_15);
expect(DARAZ_STOCK_PUSH_MS).toBe(MIN_60);

const OK_RESULT = { log: {}, result: { recordsProcessed: 1, recordsFailed: 0, message: 'ok' } };

function makeFakePrisma(businessIds: string[]) {
  return {
    integrationConnection: {
      findMany: jest.fn(async () => businessIds.map((id) => ({ businessId: id })))
    }
  };
}

function callsFor(
  sync: { mock: { calls: any[][] } },
  businessId: string,
  entity: 'order' | 'stock'
): number {
  return sync.mock.calls.filter(
    (c) => c[1] === businessId && (c[3] as any)?.entity === entity
  ).length;
}

describe('daraz-order-poll job', () => {
  let logSpy: jest.SpiedFunction<typeof console.log>;
  let errSpy: jest.SpiedFunction<typeof console.error>;

  beforeEach(() => {
    jest.useFakeTimers();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    logSpy.mockRestore();
    errSpy.mockRestore();
    stopDarazOrderPoll();
  });

  it('runs order every 15 min and stock every 60 min (timer wiring)', async () => {
    const prisma = makeFakePrisma(['biz-a', 'biz-b']);
    const sync = jest.fn(async () => OK_RESULT);
    const job = createDarazOrderPoll({ getPrisma: async () => prisma, triggerSync: sync as any });

    job.start();
    await jest.advanceTimersByTimeAsync(0); // flush the immediate runs
    // Immediate runs on start: one order + one stock per business.
    expect(callsFor(sync, 'biz-a', 'order')).toBe(1);
    expect(callsFor(sync, 'biz-b', 'order')).toBe(1);
    expect(callsFor(sync, 'biz-a', 'stock')).toBe(1);
    expect(callsFor(sync, 'biz-b', 'stock')).toBe(1);

    await jest.advanceTimersByTimeAsync(MIN_15);
    expect(callsFor(sync, 'biz-a', 'order')).toBe(2);
    expect(callsFor(sync, 'biz-a', 'stock')).toBe(1);

    await jest.advanceTimersByTimeAsync(MIN_15); // t = 30 min
    expect(callsFor(sync, 'biz-a', 'order')).toBe(3);
    expect(callsFor(sync, 'biz-a', 'stock')).toBe(1);

    await jest.advanceTimersByTimeAsync(MIN_15 + MIN_15); // t = 60 min
    expect(callsFor(sync, 'biz-a', 'order')).toBe(5);
    expect(callsFor(sync, 'biz-a', 'stock')).toBe(2);

    // Every call went to the daraz provider with the right entity.
    for (const call of sync.mock.calls as any[][]) {
      expect(call[2]).toBe('daraz');
      expect(['order', 'stock']).toContain((call[3] as any).entity);
    }
    job.stop();
  });

  it('no-ops cleanly with zero connected businesses', async () => {
    const prisma = makeFakePrisma([]);
    const sync = jest.fn(async () => OK_RESULT);
    const job = createDarazOrderPoll({ getPrisma: async () => prisma, triggerSync: sync as any });

    job.start();
    await jest.advanceTimersByTimeAsync(0);
    await jest.advanceTimersByTimeAsync(MIN_60);
    expect(sync).not.toHaveBeenCalled();
    // One quiet line per tick, no error.
    expect(errSpy).not.toHaveBeenCalled();
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('No connected Daraz businesses'))).toBe(true);
    job.stop();
  });

  it('isolates per-connection failures: one failing business does not stop others', async () => {
    const prisma = makeFakePrisma(['biz-bad', 'biz-good']);
    const sync = jest.fn(async (_prisma: any, businessId: string) => {
      if (businessId === 'biz-bad') throw new Error('vendor exploded');
      return OK_RESULT;
    });
    const job = createDarazOrderPoll({ getPrisma: async () => prisma, triggerSync: sync as any });

    job.start();
    await jest.advanceTimersByTimeAsync(0);
    // Both were attempted; the good one succeeded despite the bad one.
    expect(callsFor(sync, 'biz-bad', 'order')).toBe(1);
    expect(callsFor(sync, 'biz-good', 'order')).toBe(1);
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes('biz-bad'))).toBe(true);

    // Next tick: bad is backed off (skipped), good still polled.
    await jest.advanceTimersByTimeAsync(MIN_15);
    expect(callsFor(sync, 'biz-bad', 'order')).toBe(1);
    expect(callsFor(sync, 'biz-good', 'order')).toBe(2);
    job.stop();
  });

  it('backs off exponentially on repeated failures (1, 2, 4 ticks)', async () => {
    const prisma = makeFakePrisma(['biz-flaky']);
    const sync = jest.fn(async () => {
      throw new Error('Daraz down');
    });
    const job = createDarazOrderPoll({ getPrisma: async () => prisma, triggerSync: sync as any });

    job.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(callsFor(sync, 'biz-flaky', 'order')).toBe(1); // t=0: fail #1 → skip 1 tick

    await jest.advanceTimersByTimeAsync(MIN_15); // t=15: skipped
    expect(callsFor(sync, 'biz-flaky', 'order')).toBe(1);

    await jest.advanceTimersByTimeAsync(MIN_15); // t=30: retried → fail #2 → skip 2 ticks
    expect(callsFor(sync, 'biz-flaky', 'order')).toBe(2);

    await jest.advanceTimersByTimeAsync(MIN_15); // t=45: skipped
    expect(callsFor(sync, 'biz-flaky', 'order')).toBe(2);
    await jest.advanceTimersByTimeAsync(MIN_15); // t=60: skipped
    expect(callsFor(sync, 'biz-flaky', 'order')).toBe(2);

    await jest.advanceTimersByTimeAsync(MIN_15); // t=75: retried → fail #3 → skip 4 ticks
    expect(callsFor(sync, 'biz-flaky', 'order')).toBe(3);
    expect(logSpy.mock.calls.some((c) => String(c[0]).includes('Backing off'))).toBe(true);
    job.stop();
  });

  it('a success resets the backoff: the next failure backs off only 1 tick again', async () => {
    const prisma = makeFakePrisma(['biz-flaky']);
    let fail = true;
    const sync = jest.fn(async () => {
      if (fail) throw new Error('Daraz down');
      return OK_RESULT;
    });
    const job = createDarazOrderPoll({ getPrisma: async () => prisma, triggerSync: sync as any });

    job.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(callsFor(sync, 'biz-flaky', 'order')).toBe(1); // t=0: fail #1 → skip 1

    await jest.advanceTimersByTimeAsync(MIN_15); // t=15: skipped
    expect(callsFor(sync, 'biz-flaky', 'order')).toBe(1);

    fail = false;
    await jest.advanceTimersByTimeAsync(MIN_15); // t=30: retried → success → reset
    expect(callsFor(sync, 'biz-flaky', 'order')).toBe(2);

    fail = true;
    await jest.advanceTimersByTimeAsync(MIN_15); // t=45: fail again → failures=1 → skip 1
    expect(callsFor(sync, 'biz-flaky', 'order')).toBe(3);

    await jest.advanceTimersByTimeAsync(MIN_15); // t=60: skipped (only 1 tick, not 2)
    expect(callsFor(sync, 'biz-flaky', 'order')).toBe(3);

    await jest.advanceTimersByTimeAsync(MIN_15); // t=75: retried
    expect(callsFor(sync, 'biz-flaky', 'order')).toBe(4);
    job.stop();
  });

  it('backoff is per-entity: a stock failure does not block order polls', async () => {
    const prisma = makeFakePrisma(['biz-a']);
    const sync = jest.fn(async (_prisma: any, _businessId: string, _provider: string, opts: any) => {
      if (opts.entity === 'stock') throw new Error('stock push failed');
      return OK_RESULT;
    });
    const job = createDarazOrderPoll({ getPrisma: async () => prisma, triggerSync: sync as any });

    job.start();
    await jest.advanceTimersByTimeAsync(0);
    expect(callsFor(sync, 'biz-a', 'order')).toBe(1);
    expect(callsFor(sync, 'biz-a', 'stock')).toBe(1); // failed → backed off

    await jest.advanceTimersByTimeAsync(MIN_15);
    expect(callsFor(sync, 'biz-a', 'order')).toBe(2); // orders unaffected

    await jest.advanceTimersByTimeAsync(MIN_15 + MIN_15 + MIN_15); // t=60: stock tick, still backed off
    expect(callsFor(sync, 'biz-a', 'stock')).toBe(1);
    expect(callsFor(sync, 'biz-a', 'order')).toBe(5);
    job.stop();
  });

  it('a failing connection-list query does not crash the tick; the next tick retries', async () => {
    const prisma = makeFakePrisma(['biz-a']);
    let listCalls = 0;
    (prisma.integrationConnection.findMany as jest.Mock).mockImplementation(async () => {
      listCalls++;
      if (listCalls === 1) throw new Error('DB blip');
      return [{ businessId: 'biz-a' }];
    });
    const sync = jest.fn(async () => OK_RESULT);
    const job = createDarazOrderPoll({ getPrisma: async () => prisma, triggerSync: sync as any });

    job.start();
    await jest.advanceTimersByTimeAsync(0);
    // The immediate ORDER tick's list failed (no order sync); the
    // immediate STOCK tick's list (2nd call) succeeded, so stock ran.
    expect(callsFor(sync, 'biz-a', 'order')).toBe(0);
    expect(callsFor(sync, 'biz-a', 'stock')).toBe(1);
    expect(errSpy).toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(MIN_15);
    expect(callsFor(sync, 'biz-a', 'order')).toBe(1); // retried fine
    job.stop();
  });

  it('stop() clears both timers', async () => {
    const prisma = makeFakePrisma(['biz-a']);
    const sync = jest.fn(async () => OK_RESULT);
    const job = createDarazOrderPoll({ getPrisma: async () => prisma, triggerSync: sync as any });

    job.start();
    await jest.advanceTimersByTimeAsync(0);
    const callsAtStop = sync.mock.calls.length;
    expect(callsAtStop).toBeGreaterThan(0);
    job.stop();

    await jest.advanceTimersByTimeAsync(MIN_60 * 2);
    expect(sync.mock.calls.length).toBe(callsAtStop);
  });

  it('module singleton start/stop works (the server.ts wiring path)', async () => {
    const prisma = makeFakePrisma(['biz-a']);
    const sync = jest.fn(async () => OK_RESULT);

    startDarazOrderPoll({ getPrisma: async () => prisma, triggerSync: sync as any });
    await jest.advanceTimersByTimeAsync(0);
    expect(sync.mock.calls.length).toBeGreaterThan(0);

    const callsAtStop = sync.mock.calls.length;
    stopDarazOrderPoll();
    await jest.advanceTimersByTimeAsync(MIN_60);
    expect(sync.mock.calls.length).toBe(callsAtStop);
  });
});
