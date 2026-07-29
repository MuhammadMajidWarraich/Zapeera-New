/**
 * Sync Queue Service
 * Manages offline-created operations that need to be pushed to Cloud API when online.
 * Follows idempotent, ordered, retryable queue pattern.
 * Uses sync_operations SQLite table for durable queue storage.
 */

const crypto = require('crypto');

let _query = null;
let _run = null;
let _saveDatabase = null;
let _uuid = null;
let _now = null;

function init(deps) {
  _query = deps.query;
  _run = deps.run;
  _saveDatabase = deps.saveDatabase;
  _uuid = deps.uuid;
  _now = deps.now;
}

function ensureInit() {
  if (!_query) {
    const db = require('./database.service');
    _query = db.query;
    _run = db.run;
    _saveDatabase = db.saveDatabase;
    _uuid = require('../utils/helpers').uuid;
    _now = require('../utils/helpers').now;
  }
}

function generateIdempotencyKey() {
  return crypto.randomBytes(16).toString('hex');
}

function enqueueOperation(entityType, entityId, operation, payload, opts = {}) {
  ensureInit();
  const id = _uuid();
  const idempotencyKey = opts.idempotencyKey || generateIdempotencyKey();
  const timestamp = _now();

  _run(`
    INSERT INTO sync_operations
    (id, businessId, branchId, entityType, entityId, operation, payload, idempotencyKey, status, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
  `, [
    id,
    opts.businessId || null,
    opts.branchId || null,
    entityType,
    entityId || null,
    operation,
    typeof payload === 'string' ? payload : JSON.stringify(payload),
    idempotencyKey,
    timestamp,
    timestamp
  ]);

  _saveDatabase();
  return { id, idempotencyKey };
}

function getPendingOperations(limit = 50) {
  ensureInit();
  return _query(
    `SELECT * FROM sync_operations WHERE status = 'PENDING' ORDER BY createdAt ASC LIMIT ?`,
    [limit]
  );
}

function getFailedOperations(limit = 50) {
  ensureInit();
  return _query(
    `SELECT * FROM sync_operations WHERE status = 'FAILED' ORDER BY updatedAt DESC LIMIT ?`,
    [limit]
  );
}

function markInFlight(id) {
  ensureInit();
  _run(`UPDATE sync_operations SET status = 'IN_FLIGHT', attemptCount = attemptCount + 1, updatedAt = ? WHERE id = ?`,
    [_now(), id]);
  _saveDatabase();
}

function markCompleted(id, result = null) {
  ensureInit();
  _run(`UPDATE sync_operations SET status = 'COMPLETED', payload = ?, updatedAt = ? WHERE id = ?`,
    [result ? JSON.stringify(result) : '{}', _now(), id]);
  _saveDatabase();
}

function markFailed(id, error) {
  ensureInit();
  _run(`UPDATE sync_operations SET status = 'FAILED', lastError = ?, updatedAt = ? WHERE id = ?`,
    [error, _now(), id]);
  _saveDatabase();
}

function resetStuckOperations(maxAttempts = 3) {
  ensureInit();
  const stuck = _query(
    `SELECT * FROM sync_operations WHERE status = 'IN_FLIGHT' AND attemptCount < ? AND updatedAt < ?`,
    [maxAttempts, new Date(Date.now() - 60000).toISOString()]
  );
  for (const op of stuck || []) {
    _run(`UPDATE sync_operations SET status = 'PENDING', updatedAt = ? WHERE id = ?`,
      [_now(), op.id]);
  }
  _saveDatabase();
  return stuck ? stuck.length : 0;
}

async function pushPendingToCloudApi(cloudApi) {
  ensureInit();
  if (!cloudApi) {
    return { pushed: 0, failed: 0, errors: ['Cloud API not configured'] };
  }

  const errors = [];
  let pushed = 0;
  let failed = 0;

  try {
    resetStuckOperations();
    const pending = getPendingOperations(50);

    for (const op of pending) {
      markInFlight(op.id);

      try {
        let payload;
        try { payload = JSON.parse(op.payload); } catch { payload = op.payload; }

        const businessId = op.businessId;
        if (!businessId) {
          markFailed(op.id, 'No businessId');
          failed++;
          continue;
        }

        const result = await cloudApi.pushOperations(businessId, [{
          id: op.id,
          entityType: op.entityType,
          entityId: op.entityId,
          operation: op.operation,
          payload: payload,
          idempotencyKey: op.idempotencyKey
        }]);

        if (result.success !== false) {
          markCompleted(op.id);
          pushed++;
        } else {
          markFailed(op.id, result.message || 'Cloud API rejected');
          failed++;
        }
      } catch (e) {
        markFailed(op.id, e.message);
        errors.push(e.message);
        failed++;
      }
    }
  } catch (e) {
    errors.push(e.message);
  }

  return { pushed, failed, errors };
}

function getQueueStatus() {
  ensureInit();
  const pending = _query("SELECT COUNT(*) as count FROM sync_operations WHERE status = 'PENDING'");
  const inFlight = _query("SELECT COUNT(*) as count FROM sync_operations WHERE status = 'IN_FLIGHT'");
  const failed = _query("SELECT COUNT(*) as count FROM sync_operations WHERE status = 'FAILED'");
  const completed = _query("SELECT COUNT(*) as count FROM sync_operations WHERE status = 'COMPLETED'");
  return {
    pending: pending[0]?.count || 0,
    inFlight: inFlight[0]?.count || 0,
    failed: failed[0]?.count || 0,
    completed: completed[0]?.count || 0
  };
}

module.exports = {
  init,
  enqueueOperation,
  getPendingOperations,
  getFailedOperations,
  markInFlight,
  markCompleted,
  markFailed,
  resetStuckOperations,
  pushPendingToCloudApi,
  getQueueStatus
};
