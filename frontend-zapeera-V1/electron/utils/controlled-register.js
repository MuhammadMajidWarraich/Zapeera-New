/**
 * Controlled-medicines register — embedded port of
 * backend-zapeera-v1-main/src/services/controlled-medicines.service.ts
 * (append + reversal + summary only).
 *
 * The register is APPEND-ONLY: DISPENSE rows are written by the sale
 * engine (see the hook in routes/sales.routes.js, which mirrors the
 * cloud's sale-time append), corrections are REVERSAL rows, and there
 * is deliberately no update/delete. A reversal never touches the
 * original row; it is a new row with a negative quantity, and the
 * total reversed can never exceed the original dispensed quantity.
 * Rows are LOCAL-ONLY: controlled_dispense_logs is not in the cloud
 * pull feed / push map yet.
 */
const { v4: uuid } = require('uuid');
const { mustRun } = require('./db-write');

function appendDispenseEntry(deps, input) {
  const { query, run } = deps;
  // input: { companyId, branchId, productId, batchId, batchNo, saleId,
  //   saleItemId, quantity, staffUserId, staffName, customerId,
  //   customerName, prescriptionId, prescriptionRef, invoiceNumber }
  const batch = input.batchId ? query('SELECT quantity FROM batches WHERE id = ?', [input.batchId])[0] : null;
  const id = uuid();
  const now = new Date().toISOString();
  mustRun(run,
    'INSERT INTO controlled_dispense_logs (id, companyId, branchId, productId, batchId, batchNo, saleId, saleItemId, entryType, quantity, balanceAfter, staffUserId, staffName, customerId, customerName, prescriptionId, prescriptionRef, invoiceNumber, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, input.companyId, input.branchId || null, input.productId, input.batchId || null, input.batchNo || null, input.saleId || null, input.saleItemId || null, 'DISPENSE', input.quantity, batch ? (Number(batch.quantity) || 0) : 0, input.staffUserId || null, input.staffName || null, input.customerId || null, input.customerName || null, input.prescriptionId || null, input.prescriptionRef || null, input.invoiceNumber || null, now]
  );
  return query('SELECT * FROM controlled_dispense_logs WHERE id = ?', [id])[0];
}

function appendReversalEntry(deps, input) {
  const { query, run } = deps;
  // input: { companyId, branchId, originalEntryId, quantity, reason,
  //   staffUserId, staffName, saleId, invoiceNumber }
  if (!input.reason || !String(input.reason).trim()) {
    const e = new Error('A reversal requires a reason');
    e.statusCode = 400;
    throw e;
  }
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    const e = new Error('Reversal quantity must be a positive whole number');
    e.statusCode = 400;
    throw e;
  }
  const original = query('SELECT * FROM controlled_dispense_logs WHERE id = ?', [input.originalEntryId])[0];
  if (!original || original.companyId !== input.companyId) {
    const e = new Error('Original dispense entry not found in this business');
    e.statusCode = 404;
    throw e;
  }
  if (original.entryType !== 'DISPENSE') {
    const e = new Error('Only a DISPENSE entry can be reversed');
    e.statusCode = 400;
    throw e;
  }
  const priorReversals = query('SELECT quantity FROM controlled_dispense_logs WHERE reversesId = ?', [original.id]);
  const alreadyReversed = priorReversals.reduce((s, row) => s + Math.abs(Number(row.quantity) || 0), 0);
  if (alreadyReversed + input.quantity > original.quantity) {
    const e = new Error(`Cannot reverse ${input.quantity} units: ${alreadyReversed} of ${original.quantity} dispensed units have already been reversed`);
    e.statusCode = 400;
    throw e;
  }
  const batch = original.batchId ? query('SELECT quantity FROM batches WHERE id = ?', [original.batchId])[0] : null;
  const id = uuid();
  const now = new Date().toISOString();
  mustRun(run,
    'INSERT INTO controlled_dispense_logs (id, companyId, branchId, productId, batchId, batchNo, saleId, saleItemId, entryType, quantity, balanceAfter, reversesId, reason, staffUserId, staffName, customerId, customerName, prescriptionId, prescriptionRef, invoiceNumber, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, input.companyId, input.branchId || original.branchId, original.productId, original.batchId, original.batchNo, input.saleId || original.saleId || null, original.saleItemId || null, 'REVERSAL', -input.quantity, batch ? (Number(batch.quantity) || 0) : original.balanceAfter, original.id, String(input.reason).trim(), input.staffUserId || null, input.staffName || null, original.customerId || null, original.customerName || null, original.prescriptionId || null, original.prescriptionRef || null, input.invoiceNumber || original.invoiceNumber || null, now]
  );
  return query('SELECT * FROM controlled_dispense_logs WHERE id = ?', [id])[0];
}

/** Per-product/batch running-balance summary over the given entries. */
function summarizeRegisterEntries(entries) {
  const groups = new Map();
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
        _latest: createdMs
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

module.exports = { appendDispenseEntry, appendReversalEntry, summarizeRegisterEntries };
