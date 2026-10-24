import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  CONTROLLED_SCHEDULES,
  ControlledRegisterError,
  appendControlledDispenseEntries,
  appendControlledReversalEntry,
  appendRefundReversals,
  displayControlledSchedule,
  normalizeControlledSchedule,
  summarizeRegisterEntries,
} from '../src/services/controlled-medicines.service';

// Controlled / narcotics register (Gap item 2) — log-integrity harness.
// No database is involved: the service functions take a transaction
// client, so tests run against an in-memory fake `tx` implementing
// only the delegate methods the service calls.

function makeFakeTx(seed?: {
  batches?: Record<string, number>;
  entries?: any[];
}): any {
  const entries: any[] = [...(seed?.entries || [])];
  const batches: Record<string, number> = { ...(seed?.batches || {}) };
  let seq = entries.length;
  return {
    batch: {
      findUnique: jest.fn(async ({ where }: any) => {
        const q = batches[where.id];
        return q === undefined ? null : { quantity: q };
      }),
    },
    controlledDispenseLog: {
      findUnique: jest.fn(async ({ where }: any) => entries.find((e) => e.id === where.id) || null),
      findFirst: jest.fn(async ({ where }: any) => {
        const found = entries
          .filter((e) => e.saleItemId === where.saleItemId && e.entryType === where.entryType)
          .sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
        return found[0] || null;
      }),
      findMany: jest.fn(async ({ where }: any) => {
        if (where?.reversesId) return entries.filter((e) => e.reversesId === where.reversesId);
        return entries;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `log_${++seq}`, createdAt: new Date('2026-10-24T10:00:00.000Z'), ...data };
        entries.push(row);
        return row;
      }),
      // The fake deliberately has NO update / delete / upsert: any
      // service code path calling one throws (mirrors the append-only
      // rule), and the static guard below asserts none exists in src/.
      update: jest.fn(async () => {
        throw new Error('controlledDispenseLog.update is forbidden (append-only register)');
      }),
      delete: jest.fn(async () => {
        throw new Error('controlledDispenseLog.delete is forbidden (append-only register)');
      }),
    },
    _entries: entries,
    _batches: batches,
  };
}

const baseDispense = {
  companyId: 'co_1',
  branchId: 'br_1',
  saleId: 'sale_1',
  invoiceNumber: 'INV-10001',
  staffUserId: 'user_1',
  staffName: 'Test Pharmacist',
  customerId: 'cust_1',
  customerName: 'Test Customer',
  prescriptionId: 'rx_1',
  prescriptionRef: 'Rx rx_1 (Dr. Test)',
};

describe('controlled schedule labels', () => {
  it('accepts and normalizes every allowed schedule', () => {
    for (const schedule of CONTROLLED_SCHEDULES) {
      expect(normalizeControlledSchedule(schedule.toLowerCase())).toEqual({ schedule });
    }
    expect(normalizeControlledSchedule('Schedule II')).toEqual({ schedule: 'SCHEDULE_II' });
  });

  it('clears on empty input and rejects unknown labels', () => {
    expect(normalizeControlledSchedule('')).toEqual({ schedule: null });
    expect(normalizeControlledSchedule(null)).toEqual({ schedule: null });
    expect(normalizeControlledSchedule(undefined)).toEqual({ schedule: null });
    const bad = normalizeControlledSchedule('SCHEDULE_X');
    expect('error' in bad && (bad as any).error).toMatch(/SCHEDULE_X/);
  });

  it('displays a fallback label for controlled products without a schedule', () => {
    expect(displayControlledSchedule({ isControlled: true, controlledSchedule: null })).toBe('Controlled');
    expect(displayControlledSchedule({ isControlled: true, controlledSchedule: 'NARCOTIC' })).toBe('Narcotic');
    expect(displayControlledSchedule({ isControlled: false })).toBe('');
  });
});

describe('appendControlledDispenseEntries', () => {
  it('appends one DISPENSE entry per controlled line with the post-decrement balance', async () => {
    const tx = makeFakeTx({ batches: { batch_1: 90, batch_2: 5 } });
    const created = await appendControlledDispenseEntries(tx, {
      ...baseDispense,
      lines: [
        { saleItemId: 'si_1', productId: 'prod_1', isControlled: true, batchId: 'batch_1', batchNo: 'B-1', quantity: 10 },
        { saleItemId: 'si_2', productId: 'prod_2', isControlled: false, batchId: 'batch_2', batchNo: 'B-2', quantity: 5 },
        { saleItemId: 'si_3', productId: 'prod_3', isControlled: true, batchId: 'batch_1', batchNo: 'B-1', quantity: 0 },
      ],
    });
    // Only the controlled, positive-quantity line is logged.
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      entryType: 'DISPENSE',
      quantity: 10,
      balanceAfter: 90, // batch_1 held 90 after the sale decrement
      batchNo: 'B-1',
      staffUserId: 'user_1',
      staffName: 'Test Pharmacist',
      customerName: 'Test Customer',
      prescriptionRef: 'Rx rx_1 (Dr. Test)',
      invoiceNumber: 'INV-10001',
    });
    expect(tx.controlledDispenseLog.create).toHaveBeenCalledTimes(1);
  });

  it('refuses a controlled line with no batch instead of logging a batch-less dispense', async () => {
    const tx = makeFakeTx({ batches: {} });
    await expect(
      appendControlledDispenseEntries(tx, {
        ...baseDispense,
        lines: [{ saleItemId: 'si_1', productId: 'prod_1', isControlled: true, batchId: null, batchNo: null, quantity: 5 }],
      })
    ).rejects.toThrow('without a batch');
  });
});

describe('appendControlledReversalEntry', () => {
  function seededTx() {
    return makeFakeTx({
      batches: { batch_1: 95 },
      entries: [
        {
          id: 'log_1',
          companyId: 'co_1',
          branchId: 'br_1',
          productId: 'prod_1',
          batchId: 'batch_1',
          batchNo: 'B-1',
          saleId: 'sale_1',
          saleItemId: 'si_1',
          entryType: 'DISPENSE',
          quantity: 10,
          balanceAfter: 90,
          reversesId: null,
          reason: null,
          staffUserId: 'user_1',
          staffName: 'Test Pharmacist',
          customerId: 'cust_1',
          customerName: 'Test Customer',
          prescriptionId: 'rx_1',
          prescriptionRef: 'Rx rx_1 (Dr. Test)',
          invoiceNumber: 'INV-10001',
          createdAt: new Date('2026-10-24T09:00:00.000Z'),
        },
      ],
    });
  }

  it('appends a negative REVERSAL linked to the original, never mutating it', async () => {
    const tx = seededTx();
    const reversal = await appendControlledReversalEntry(tx, {
      companyId: 'co_1',
      branchId: 'br_1',
      originalEntryId: 'log_1',
      quantity: 4,
      reason: 'Refund: customer returned 4 tablets',
      staffUserId: 'user_2',
      staffName: 'Manager',
    });
    expect(reversal).toMatchObject({
      entryType: 'REVERSAL',
      quantity: -4,
      balanceAfter: 95, // batch restocked by the refund before the reversal
      reversesId: 'log_1',
      productId: 'prod_1',
      batchId: 'batch_1',
    });
    // The original row is untouched.
    const original = tx._entries.find((e: any) => e.id === 'log_1');
    expect(original.quantity).toBe(10);
    expect(original.entryType).toBe('DISPENSE');
    expect(tx.controlledDispenseLog.update).not.toHaveBeenCalled();
    expect(tx.controlledDispenseLog.delete).not.toHaveBeenCalled();
  });

  it('rejects a reversal that would exceed the dispensed quantity', async () => {
    const tx = seededTx();
    await appendControlledReversalEntry(tx, {
      companyId: 'co_1',
      branchId: 'br_1',
      originalEntryId: 'log_1',
      quantity: 6,
      reason: 'Partial refund',
      staffUserId: 'user_2',
    });
    // 6 of 10 already reversed: reversing 5 more must fail.
    await expect(
      appendControlledReversalEntry(tx, {
        companyId: 'co_1',
        branchId: 'br_1',
        originalEntryId: 'log_1',
        quantity: 5,
        reason: 'Second refund',
        staffUserId: 'user_2',
      })
    ).rejects.toThrow('already been reversed');
  });

  it('rejects reversing a REVERSAL, missing reasons, and unknown originals', async () => {
    const tx = seededTx();
    const reversal = await appendControlledReversalEntry(tx, {
      companyId: 'co_1',
      branchId: 'br_1',
      originalEntryId: 'log_1',
      quantity: 2,
      reason: 'Correction',
      staffUserId: 'user_2',
    });
    await expect(
      appendControlledReversalEntry(tx, {
        companyId: 'co_1',
        branchId: 'br_1',
        originalEntryId: reversal.id,
        quantity: 1,
        reason: 'Reverse the reversal',
        staffUserId: 'user_2',
      })
    ).rejects.toThrow('Only a DISPENSE entry can be reversed');
    await expect(
      appendControlledReversalEntry(tx, {
        companyId: 'co_1',
        branchId: 'br_1',
        originalEntryId: 'log_1',
        quantity: 1,
        reason: '   ',
        staffUserId: 'user_2',
      })
    ).rejects.toThrow('requires a reason');
    await expect(
      appendControlledReversalEntry(tx, {
        companyId: 'co_1',
        branchId: 'br_1',
        originalEntryId: 'log_missing',
        quantity: 1,
        reason: 'Correction',
        staffUserId: 'user_2',
      })
    ).rejects.toThrow('not found');
    const missing = (async () => {
      try {
        await appendControlledReversalEntry(tx, {
          companyId: 'co_1',
          branchId: 'br_1',
          originalEntryId: 'log_missing',
          quantity: 1,
          reason: 'Correction',
          staffUserId: 'user_2',
        });
      } catch (e) {
        return e;
      }
      return null;
    })();
    expect((await missing) instanceof ControlledRegisterError).toBe(true);
    expect(((await missing) as ControlledRegisterError).statusCode).toBe(404);
  });
});

describe('appendRefundReversals', () => {
  it('reverses the matching DISPENSE entry by the returned quantity', async () => {
    const tx = makeFakeTx({
      batches: { batch_1: 97 },
      entries: [
        {
          id: 'log_1',
          companyId: 'co_1',
          branchId: 'br_1',
          productId: 'prod_1',
          batchId: 'batch_1',
          batchNo: 'B-1',
          saleId: 'sale_1',
          saleItemId: 'si_1',
          entryType: 'DISPENSE',
          quantity: 10,
          balanceAfter: 90,
          createdAt: new Date('2026-10-24T09:00:00.000Z'),
        },
      ],
    });
    const created = await appendRefundReversals(tx, {
      companyId: 'co_1',
      branchId: 'br_1',
      saleId: 'sale_1',
      invoiceNumber: 'INV-10001',
      staffUserId: 'user_2',
      reason: 'Refund: damaged tablets',
      lines: [
        { saleItemId: 'si_1', productId: 'prod_1', isControlled: true, quantity: 3 },
        { saleItemId: 'si_2', productId: 'prod_2', isControlled: false, quantity: 5 },
      ],
    });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ entryType: 'REVERSAL', quantity: -3, reversesId: 'log_1' });
  });

  it('skips lines whose sale predates the register and clamps to the unreversed remainder', async () => {
    const tx = makeFakeTx({
      batches: { batch_1: 100 },
      entries: [
        {
          id: 'log_1',
          companyId: 'co_1',
          branchId: 'br_1',
          productId: 'prod_1',
          batchId: 'batch_1',
          batchNo: 'B-1',
          saleId: 'sale_1',
          saleItemId: 'si_1',
          entryType: 'DISPENSE',
          quantity: 10,
          balanceAfter: 90,
          createdAt: new Date('2026-10-24T09:00:00.000Z'),
        },
        {
          id: 'log_2',
          companyId: 'co_1',
          branchId: 'br_1',
          productId: 'prod_1',
          batchId: 'batch_1',
          batchNo: 'B-1',
          saleId: 'sale_1',
          saleItemId: 'si_1',
          entryType: 'REVERSAL',
          quantity: -8,
          balanceAfter: 98,
          reversesId: 'log_1',
          createdAt: new Date('2026-10-24T09:30:00.000Z'),
        },
      ],
    });
    const created = await appendRefundReversals(tx, {
      companyId: 'co_1',
      branchId: 'br_1',
      saleId: 'sale_1',
      invoiceNumber: 'INV-10001',
      staffUserId: 'user_2',
      reason: 'Refund',
      lines: [
        // Pre-register sale line: no DISPENSE entry exists — nothing to reverse.
        { saleItemId: 'si_old', productId: 'prod_9', isControlled: true, quantity: 4 },
        // Only 2 of 10 remain unreversed, though the refund returns 5.
        { saleItemId: 'si_1', productId: 'prod_1', isControlled: true, quantity: 5 },
      ],
    });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ quantity: -2, reversesId: 'log_1' });
  });
});

describe('summarizeRegisterEntries (running-balance math)', () => {
  it('groups by product/batch with dispensed, reversed, net and latest balance', () => {
    const summary = summarizeRegisterEntries([
      { id: 'a', productId: 'p1', productName: 'Med A', batchId: 'b1', batchNo: 'B-1', quantity: 10, balanceAfter: 90, createdAt: '2026-10-24T09:00:00.000Z' },
      { id: 'b', productId: 'p1', productName: 'Med A', batchId: 'b1', batchNo: 'B-1', quantity: -4, balanceAfter: 94, createdAt: '2026-10-24T10:00:00.000Z' },
      { id: 'c', productId: 'p1', productName: 'Med A', batchId: 'b2', batchNo: 'B-2', quantity: 5, balanceAfter: 45, createdAt: '2026-10-24T09:30:00.000Z' },
      { id: 'd', productId: 'p2', productName: 'Med B', batchId: 'b1', batchNo: 'B-1', quantity: 7, balanceAfter: 13, createdAt: '2026-10-24T08:00:00.000Z' },
    ]);
    expect(summary).toHaveLength(3);
    const medAB1 = summary.find((s) => s.productId === 'p1' && s.batchId === 'b1')!;
    expect(medAB1).toMatchObject({
      totalDispensed: 10,
      totalReversed: 4,
      netDispensed: 6,
      currentBalance: 94, // latest entry's snapshot
      entryCount: 2,
    });
    const medAB2 = summary.find((s) => s.batchId === 'b2')!;
    expect(medAB2).toMatchObject({ totalDispensed: 5, totalReversed: 0, netDispensed: 5, currentBalance: 45 });
  });

  it('returns an empty summary for an empty register', () => {
    expect(summarizeRegisterEntries([])).toEqual([]);
  });
});

describe('append-only guard (static)', () => {
  const SRC = path.join(__dirname, '..', 'src');

  function read(rel: string): string {
    return fs.readFileSync(path.join(SRC, rel), 'utf8');
  }

  it('has no update/delete/upsert code path for log rows anywhere in src/', () => {
    const files = [
      'services/controlled-medicines.service.ts',
      'controllers/controlled-medicines.controller.ts',
      'controllers/sale.controller.ts',
      'controllers/refund.controller.ts',
      'controllers/product.controller.ts',
      'routes/controlled-medicines.routes.ts',
    ];
    for (const file of files) {
      const text = read(file);
      for (const forbidden of [
        'controlledDispenseLog.update',
        'controlledDispenseLog.delete',
        'controlledDispenseLog.upsert',
        'controlledDispenseLog.deleteMany',
        'controlledDispenseLog.updateMany',
      ]) {
        expect(text).not.toContain(forbidden);
      }
    }
  });

  it('registers no PUT/DELETE route for the register', () => {
    const routes = read('routes/controlled-medicines.routes.ts');
    expect(routes).not.toMatch(/router\.(put|delete|patch)\(/);
  });

  it('exposes no update/delete function from the service module', () => {
    const service = read('services/controlled-medicines.service.ts');
    expect(service).not.toMatch(/export (async )?function \w*(update|delete)\w*Controlled/i);
    expect(service).not.toMatch(/export const \w*(update|delete)\w*Controlled/i);
  });

  it('declares the model and product flag in both Prisma schemas', () => {
    for (const schema of ['prisma/schema.sqlite.prisma', 'prisma/schema.postgresql.prisma']) {
      const text = fs.readFileSync(path.join(__dirname, '..', schema), 'utf8');
      expect(text).toContain('model ControlledDispenseLog');
      expect(text).toContain('isControlled');
      expect(text).toContain('controlledSchedule');
    }
  });
});
