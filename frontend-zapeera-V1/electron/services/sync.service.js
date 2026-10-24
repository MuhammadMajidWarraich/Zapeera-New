const fs = require('fs');
const path = require('path');
const { uuid, now, normalizeValue } = require('../utils/helpers');
const { getDataDir } = require('../config/database.config');
const { SYNC_CONFIG } = require('../config/sync.config');

let query = null;
let run = null;
let saveDatabase = null;

function initDatabaseFunctions(dbService) {
  query = dbService.query;
  run = dbService.run;
  saveDatabase = dbService.saveDatabase;
}

const QUEUE_PATH = path.join(getDataDir(), 'sync-queue.json');
let offlineQueue = [];
let lastPullTimestamps = {};

let _connectionState = 'OFFLINE';
let _syncInProgress = false;
let _lastSyncTime = null;
let _syncResult = null;
let syncInterval = null;
let pullInterval = null;
let fullSyncCounter = 0;
let pushDebounceTimer = null;
let pendingPushTables = new Set();

// Membership recovery (2026-10-24 trap): the provision/pull loops iterate
// local memberships, which are seeded ONLY by login's fire-and-forget
// account sync. If that one step missed, the engine idles forever behind
// a green "Online" (status checks 200, zero download calls). Recovery
// re-runs account sync when the engine is online but holds no memberships
// — bounded to one attempt per minute while the condition holds, and it
// stops as soon as memberships exist.
let _lastAccountSync = null;
let _lastAccountSyncAttemptAt = 0;
const ACCOUNT_SYNC_RECOVERY_INTERVAL_MS = 60 * 1000;

// Cloud API reports entity types using Prisma model names (singular, e.g. 'product').
// Local SQLite tables use plural names (e.g. 'products'). Map one to the other so
// pulled changes land in the correct tables.
const ENTITY_TYPE_TO_TABLE = {
  product: 'products',
  customer: 'customers',
  sale: 'sales',
  saleItem: 'sale_items',
  purchase: 'purchases',
  purchaseItem: 'purchase_items',
  batch: 'batches',
  category: 'categories',
  supplier: 'suppliers',
  manufacturer: 'manufacturers',
  shelf: 'shelves',
  stockMovement: 'stock_movements',
  company: 'companies',
  branch: 'branches',
  user: 'users',
  employee: 'employees',
  receipt: 'receipts',
  refund: 'refunds',
  refundItem: 'refund_items',
  attendance: 'attendance',
  shift: 'shifts',
  scheduledShift: 'scheduled_shifts',
  scheduledShiftUser: 'scheduled_shift_users',
  commission: 'commissions',
  settings: 'settings',
  cardDetails: 'card_details',
  subscription: 'subscriptions',
  // Maturity-program tables (Waves A2–C6). Parents are served by the cloud
  // cursor pull (/sync/changes); child rows are mapped too so any change
  // that arrives for them lands in the right local table.
  stockTransfer: 'stock_transfers',
  stockTransferItem: 'stock_transfer_items',
  salePayment: 'sale_payments',
  // Khata + loyalty ledgers (B2/B3): PULL-ONLY — server-derived, the
  // desktop never pushes these back (cloud push rejects them).
  customerLedgerEntry: 'customer_ledger_entries',
  loyaltyTransaction: 'loyalty_transactions',
  promotion: 'promotions',
  salePromotion: 'sale_promotions',
  taxClass: 'tax_classes',
  saleTaxLine: 'sale_tax_lines',
  prescription: 'prescriptions',
  prescriptionItem: 'prescription_items',
  patient: 'patients',
  doctor: 'doctors',
  appointment: 'appointments',
  doctorSettlement: 'doctor_settlements',
  roomType: 'room_types',
  room: 'rooms',
  reservation: 'reservations',
  folio: 'folios',
  folioCharge: 'folio_charges',
  folioPayment: 'folio_payments',
  productVariant: 'product_variants',
  stockTake: 'stock_takes',
  stockTakeLine: 'stock_take_lines'
  // EXCLUDED by design (B7): fbrConfig / fbrInvoiceQueue — the config holds
  // a write-only PRAL API token that must never leave the server, and the
  // queue is server-side worker state. sales.fbrInvoiceNumber/fbrStatus
  // ride with the sales table.
};

function resolveLocalTable(entityType) {
  return ENTITY_TYPE_TO_TABLE[entityType] || entityType;
}

// ── Durable push queue wiring (Sync Hardening) ──────────────────────────
// handleDataChange used to record writes ONLY in the JSON offline queue
// (sync-queue.json), which nothing ever converted into cloud operations —
// while pushChangesToCloud drains the durable sync_operations table, whose
// only writer (sync-queue.service's enqueueOperation) had no callers. The
// net effect was that desktop writes never reached the cloud push API.
// handleDataChange now ALSO enqueues every pushable write into the durable
// SQLite queue (idempotency-keyed; retried with exponential backoff),
// which is the queue pushChangesToCloud actually drains. The JSON queue
// remains as a lightweight activity log for the status UI.
const TABLE_TO_ENTITY_TYPE = {};
for (const [entityType, table] of Object.entries(ENTITY_TYPE_TO_TABLE)) {
  TABLE_TO_ENTITY_TYPE[table] = entityType;
}

// Entity types the cloud push endpoint rejects by design — never enqueue:
// khata/loyalty are server-derived (pull-only); FBR never leaves the
// server. (No local module writes these tables; defence in depth.)
const PUSH_BLOCKED_ENTITY_TYPES = new Set(['customerLedgerEntry', 'loyaltyTransaction', 'fbrConfig', 'fbrInvoiceQueue']);

// Tables owned by provisioning / auth, not by the operations API.
const NON_PUSHABLE_TABLES = new Set(['companies', 'branches', 'users', 'memberships', 'device_activation']);

let _syncQueueService = null;
function getSyncQueueService() {
  if (!_syncQueueService) {
    try { _syncQueueService = require('./sync-queue.service'); } catch { _syncQueueService = null; }
  }
  return _syncQueueService;
}

function resolveBusinessIdForRecord(data) {
  if (data && (data.companyId || data.businessId)) return data.companyId || data.businessId;
  const ids = getLocalBusinessIds();
  return ids.length === 1 ? ids[0] : null;
}

function durableEnqueue(tableName, operation, data) {
  try {
    if (NON_PUSHABLE_TABLES.has(tableName)) return;
    const entityType = TABLE_TO_ENTITY_TYPE[tableName];
    if (!entityType || PUSH_BLOCKED_ENTITY_TYPES.has(entityType)) return;
    if (!data || !data.id) return;
    const queueService = getSyncQueueService();
    if (!queueService || typeof queueService.enqueueOperation !== 'function') return;
    const businessId = resolveBusinessIdForRecord(data);
    if (!businessId) return; // ambiguous multi-business context — provisioning/pull still reconcile
    const op = String(operation || '').toUpperCase();
    if (!['CREATE', 'UPDATE', 'DELETE'].includes(op)) return;
    queueService.enqueueOperation(
      entityType,
      data.id,
      op,
      op === 'DELETE' ? { id: data.id } : data,
      { businessId, branchId: data.branchId || null }
    );
  } catch (e) {
    console.log(`[Sync] Durable enqueue failed for ${tableName}: ${e.message}`);
  }
}

const SYNC_TABLES = [
  { name: 'companies', priority: 1 },
  { name: 'branches', priority: 2 },
  { name: 'users', priority: 3 },
  { name: 'categories', priority: 4 },
  { name: 'manufacturers', priority: 5 },
  { name: 'suppliers', priority: 6 },
  { name: 'shelves', priority: 7 },
  { name: 'products', priority: 8 },
  { name: 'batches', priority: 9 },
  { name: 'customers', priority: 10 },
  { name: 'employees', priority: 11 },
  { name: 'sales', priority: 12 },
  { name: 'sale_items', priority: 13 },
  { name: 'purchases', priority: 14 },
  { name: 'purchase_items', priority: 15 },
  { name: 'stock_movements', priority: 16 },
  { name: 'receipts', priority: 17 },
  { name: 'refunds', priority: 18 },
  { name: 'refund_items', priority: 19 },
  { name: 'attendance', priority: 20 },
  { name: 'shifts', priority: 21 },
  { name: 'scheduled_shifts', priority: 22 },
  { name: 'scheduled_shift_users', priority: 23 },
  { name: 'commissions', priority: 24 },
  { name: 'settings', priority: 25 },
  { name: 'card_details', priority: 26 },
  { name: 'subscriptions', priority: 27 },
  { name: 'device_activation', priority: 28 },
  // Maturity-program tables (Waves A2–C6), parents before children
  { name: 'product_variants', priority: 29 },
  { name: 'stock_transfers', priority: 30 },
  { name: 'stock_transfer_items', priority: 31 },
  { name: 'stock_takes', priority: 32 },
  { name: 'stock_take_lines', priority: 33 },
  { name: 'promotions', priority: 34 },
  { name: 'tax_classes', priority: 35 },
  { name: 'sale_payments', priority: 36 },
  { name: 'sale_promotions', priority: 37 },
  { name: 'sale_tax_lines', priority: 38 },
  { name: 'customer_ledger_entries', priority: 39 },
  { name: 'loyalty_transactions', priority: 40 },
  { name: 'prescriptions', priority: 41 },
  { name: 'prescription_items', priority: 42 },
  { name: 'patients', priority: 43 },
  { name: 'doctors', priority: 44 },
  { name: 'appointments', priority: 45 },
  { name: 'doctor_settlements', priority: 46 },
  { name: 'room_types', priority: 47 },
  { name: 'rooms', priority: 48 },
  { name: 'reservations', priority: 49 },
  { name: 'folios', priority: 50 },
  { name: 'folio_charges', priority: 51 },
  { name: 'folio_payments', priority: 52 }
].sort((a, b) => a.priority - b.priority);

let cloudApi = null;

function setCloudApi(apiModule) {
  cloudApi = apiModule;
}

function getCloudApi() {
  return cloudApi;
}

function getConnectionState() {
  return _connectionState;
}

function setConnectionState(state) {
  const valid = ['OFFLINE', 'CLOUD_REACHABLE', 'AUTH_REQUIRED', 'SYNC_READY', 'SYNCING', 'SYNCED', 'PENDING', 'ERROR'];
  if (valid.includes(state)) {
    const prev = _connectionState;
    _connectionState = state;
    if (prev !== state) {
      console.log(`[Cloud] State: ${state}`);
    }
  }
}

async function checkCloudConnectivity(force = false) {
  if (!cloudApi) {
    setConnectionState('OFFLINE');
    return 'OFFLINE';
  }
  try {
    const health = await cloudApi.checkHealth();
    if (!health.reachable) {
      setConnectionState('OFFLINE');
      return 'OFFLINE';
    }
    if (_connectionState === 'OFFLINE') {
      console.log('[Cloud] Connected');
    }
    setConnectionState('CLOUD_REACHABLE');
    try {
      const status = await cloudApi.getSyncStatus();
      if (status.success !== false) {
        setConnectionState('SYNC_READY');
        return 'SYNC_READY';
      }
      // The cloud answered but did not accept the request (e.g. the
      // persisted provisioning token has expired — cloud JWTs live 7
      // days). That is an auth problem, not "reachable": surface it so
      // the UI can ask for a fresh sign-in instead of sitting on a
      // misleading state forever.
      setConnectionState('AUTH_REQUIRED');
      return 'AUTH_REQUIRED';
    } catch {
      setConnectionState('AUTH_REQUIRED');
      return 'AUTH_REQUIRED';
    }
  } catch (e) {
    setConnectionState('OFFLINE');
    return 'OFFLINE';
  }
}

async function pushChangesToCloud() {
  if (_syncInProgress) {
    return { status: 'SKIPPED', message: 'Sync already in progress' };
  }
  if (_connectionState !== 'SYNC_READY') {
    console.log('[Sync] Push skipped: not ready');
    return { status: _connectionState === 'OFFLINE' ? 'OFFLINE' : 'AUTH_REQUIRED', uploaded: 0, failed: 0 };
  }
  _syncInProgress = true;
  setConnectionState('SYNCING');
  try {
    requeueFailedOperations();
    const pending = loadOperationsForPush();
    if (!pending || pending.length === 0) {
      _syncInProgress = false;
      setConnectionState('SYNCED');
      return { status: 'SUCCESS', uploaded: 0, failed: 0 };
    }
    const businessGroups = {};
    for (const row of pending) {
      const key = row.businessId || 'default';
      if (!businessGroups[key]) businessGroups[key] = [];
      businessGroups[key].push(row);
    }
    let totalUploaded = 0;
    let totalFailed = 0;
    for (const [businessId, rows] of Object.entries(businessGroups)) {
      const operations = rows.map(buildPushOperation);
      let response;
      try {
        response = await cloudApi.pushOperations(businessId, operations);
      } catch (e) {
        console.log(`[Sync] Push failed for ${businessId}: ${e.message}`);
        totalFailed += rows.length;
        for (const row of rows) {
          markOperationFailed(row, e.message);
        }
        continue;
      }
      const perOpResults = response && response.data && Array.isArray(response.data.results)
        ? new Map(response.data.results.map(r => [r.id, r]))
        : null;
      if (!perOpResults) {
        // Older server without per-op results: keep the wholesale contract.
        if (response && response.success !== false) {
          for (const row of rows) markOperationCompleted(row);
          totalUploaded += rows.length;
        } else {
          totalFailed += rows.length;
          for (const row of rows) markOperationFailed(row, (response && response.message) || 'Cloud rejected batch');
        }
        continue;
      }
      // Per-op reconciliation against the server's results.
      for (const row of rows) {
        const r = perOpResults.get(row.id);
        if (!r) {
          markOperationFailed(row, 'No result returned for operation');
          totalFailed++;
        } else if (r.status === 'ACCEPTED' || r.status === 'DUPLICATE') {
          markOperationCompleted(row);
          totalUploaded++;
        } else if (r.status === 'CONFLICT') {
          // The server holds a newer row; the next pull reconciles the
          // local copy. Completing the op stops an endless stale re-push.
          console.log(`[Sync] Conflict for ${row.entityType} ${row.entityId} — server copy wins, reconciles on next pull`);
          markOperationCompleted(row);
          totalUploaded++;
        } else {
          // FAILED retries via the backoff requeue; REJECTED is parked in
          // FAILED too, which keeps it out of the PENDING drain.
          markOperationFailed(row, r.message || `Cloud returned ${r.status}`);
          totalFailed++;
        }
      }
    }
    _syncInProgress = false;
    if (totalFailed > 0 && totalUploaded === 0) {
      setConnectionState('ERROR');
      return { status: 'FAILED', uploaded: 0, failed: totalFailed };
    }
    if (totalFailed > 0) {
      setConnectionState('SYNCED');
      return { status: 'PARTIAL', uploaded: totalUploaded, failed: totalFailed };
    }
    setConnectionState('SYNCED');
    return { status: 'SUCCESS', uploaded: totalUploaded, failed: 0 };
  } catch (e) {
    _syncInProgress = false;
    setConnectionState('ERROR');
    return { status: 'FAILED', uploaded: 0, failed: 0, error: e.message };
  }
}

async function pullChangesFromCloud() {
  if (_syncInProgress) {
    return { status: 'SKIPPED', message: 'Sync already in progress' };
  }
  if (_connectionState !== 'SYNC_READY') {
    return { status: _connectionState === 'OFFLINE' ? 'OFFLINE' : 'AUTH_REQUIRED', downloaded: 0 };
  }
  _syncInProgress = true;
  setConnectionState('SYNCING');
  try {
    const businesses = getLocalBusinessIds();
    let totalDownloaded = 0;
    for (const businessId of businesses) {
      try {
        const cursor = getSyncCursor(businessId);
        const result = await cloudApi.pullChanges(businessId, cursor);
        if (result.success !== false && result.changes && result.changes.length > 0) {
          applyChanges(result.changes);
          setSyncCursor(businessId, result.nextCursor);
          totalDownloaded += result.changes.length;
        }
      } catch (e) {
        console.log(`[Sync] Pull failed for ${businessId}: ${e.message}`);
      }
    }
    _syncInProgress = false;
    setConnectionState('SYNCED');
    return { status: 'SUCCESS', downloaded: totalDownloaded };
  } catch (e) {
    _syncInProgress = false;
    setConnectionState('ERROR');
    return { status: 'FAILED', error: e.message, downloaded: 0 };
  }
}

// Download full business payloads (branches, subscription, roles, modules, slug)
// for memberships that have not been downloaded yet, then mark them DOWNLOADED
// so the business can be used offline. Idempotent: businesses with local branches
// are skipped.
async function provisionPendingBusinesses() {
  if (!query || !run || !saveDatabase) return { provisioned: 0, failed: 0 };
  if (!cloudApi) return { provisioned: 0, failed: 0 };

  let provisioned = 0;
  let failed = 0;
  const memberships = query(`SELECT * FROM memberships WHERE status = 'ACTIVE'`);
  for (const m of memberships || []) {
    const businessId = m.businessId;
    if (!businessId) continue;

    const branchRows = query('SELECT id FROM branches WHERE companyId = ? LIMIT 1', [businessId]);
    if (branchRows && branchRows.length > 0) continue;

    try {
      const result = await cloudApi.provisionBusiness(businessId);
      if (result && result.success !== false && result.data) {
        persistProvisionedBusiness(result.data);
        run('UPDATE memberships SET status = ?, updatedAt = ? WHERE businessId = ?', ['DOWNLOADED', now(), businessId]);
        provisioned++;
        console.log(`[Sync] Provisioned business ${businessId}`);
      } else {
        console.log(`[Sync] Provision rejected for ${businessId}: ${result && result.message}`);
        failed++;
      }
    } catch (e) {
      console.log(`[Sync] Provision failed for ${businessId}: ${e.message}`);
      failed++;
    }
  }
  if (provisioned > 0 || failed > 0) saveDatabase();
  return { provisioned, failed };
}

function persistProvisionedBusiness(data) {
  const biz = data.business;
  if (!biz || !biz.id) return;

  const existingCompany = query('SELECT id FROM companies WHERE id = ?', [biz.id]);
  if (existingCompany && existingCompany.length > 0) {
    run(`UPDATE companies SET name = ?, description = ?, address = ?, phone = ?, email = ?, slug = ?, businessType = ?, updatedAt = ? WHERE id = ?`,
      [biz.name || '', biz.description || null, biz.address || null, biz.phone || null, biz.email || null, biz.slug || null, biz.businessType || 'PHARMACY', now(), biz.id]);
  } else {
    run(`INSERT INTO companies (id, name, description, address, phone, email, slug, businessType, isActive, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [biz.id, biz.name || '', biz.description || null, biz.address || null, biz.phone || null, biz.email || null, biz.slug || null, biz.businessType || 'PHARMACY', biz.createdBy || null, now(), now()]);
  }

  for (const b of data.branches || []) {
    if (!b || !b.id) continue;
    const existing = query('SELECT id FROM branches WHERE id = ?', [b.id]);
    const isActive = b.isActive === false || b.isActive === 0 ? 0 : 1;
    if (existing && existing.length > 0) {
      run(`UPDATE branches SET name = ?, address = ?, phone = ?, email = ?, companyId = ?, isActive = ?, updatedAt = ? WHERE id = ?`,
        [b.name || '', b.address || null, b.phone || null, b.email || null, biz.id, isActive, now(), b.id]);
    } else {
      run(`INSERT INTO branches (id, name, address, phone, email, companyId, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [b.id, b.name || '', b.address || null, b.phone || null, b.email || null, biz.id, isActive, now(), now()]);
    }
  }

  if (data.subscription) {
    const sub = data.subscription;
    const existing = query('SELECT id FROM subscriptions WHERE companyId = ?', [biz.id]);
    if (existing && existing.length > 0) {
      run(`UPDATE subscriptions SET plan = ?, status = ?, updatedAt = ? WHERE companyId = ?`, [sub.planId || 'BASIC', sub.status || 'ACTIVE', now(), biz.id]);
    } else {
      run(`INSERT INTO subscriptions (id, companyId, plan, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)`,
        [uuid(), biz.id, sub.planId || 'BASIC', sub.status || 'ACTIVE', now(), now()]);
    }
  }
}

function loadOperationsForPush() {
  if (!query) return [];
  return query(
    `SELECT * FROM sync_operations WHERE status = 'PENDING' ORDER BY createdAt ASC LIMIT 100`
  );
}

// Failed pushes are retried with exponential backoff (30s → 1m → 2m → 4m,
// capped at 30m) up to MAX_PUSH_ATTEMPTS, after which the op stays parked
// in FAILED for inspection via the queue status routes.
const MAX_PUSH_ATTEMPTS = 5;

function requeueFailedOperations() {
  if (!query || !run) return 0;
  try {
    const failed = query(
      `SELECT id, attemptCount, updatedAt FROM sync_operations WHERE status = 'FAILED' AND attemptCount < ? LIMIT 200`,
      [MAX_PUSH_ATTEMPTS]
    );
    let requeued = 0;
    const nowMs = Date.now();
    for (const row of failed || []) {
      const backoffMs = Math.min(Math.pow(2, row.attemptCount || 1) * 30000, 30 * 60 * 1000);
      const lastMs = new Date(row.updatedAt).getTime();
      if (Number.isFinite(lastMs) && nowMs - lastMs >= backoffMs) {
        run(`UPDATE sync_operations SET status = 'PENDING', updatedAt = ? WHERE id = ?`, [now(), row.id]);
        requeued++;
      }
    }
    if (requeued > 0) saveDatabase();
    return requeued;
  } catch (e) {
    console.log(`[Sync] Requeue of failed operations error: ${e.message}`);
    return 0;
  }
}

// sync_operations rows store the payload as JSON text and the operation in
// whatever case the writer used; the cloud API expects a parsed payload
// object and an uppercase operation.
function buildPushOperation(row) {
  let payload = row.payload;
  if (typeof payload === 'string') {
    try { payload = JSON.parse(payload); } catch { payload = {}; }
  }
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    operation: String(row.operation || '').toUpperCase(),
    payload,
    idempotencyKey: row.idempotencyKey || undefined
  };
}

function markOperationCompleted(op) {
  if (run) {
    run(`UPDATE sync_operations SET status = 'COMPLETED', updatedAt = ? WHERE id = ?`, [now(), op.id]);
    saveDatabase();
  }
}

function markOperationFailed(op, error) {
  if (run) {
    run(`UPDATE sync_operations SET status = 'FAILED', lastError = ?, attemptCount = attemptCount + 1, updatedAt = ? WHERE id = ?`,
      [error, now(), op.id]);
    saveDatabase();
  }
}

function getLocalBusinessIds() {
  if (!query) return [];
  const rows = query(`SELECT DISTINCT businessId FROM memberships WHERE status IN ('ACTIVE', 'DOWNLOADED')`);
  return (rows || []).map(r => r.businessId).filter(Boolean);
}

function getLocalMembershipCount() {
  return getLocalBusinessIds().length;
}

function getLastAccountSync() {
  return _lastAccountSync;
}

// Re-seed local memberships from the cloud when the engine is online but
// the local DB holds none — the self-healing step login's fire-and-forget
// account sync never had. Never throws: every failure is recorded on
// _lastAccountSync (surfaced to the UI via the sync-status IPC) and the
// next attempt waits out the throttle window. Identity comes from the
// users table, NOT local_identity: provision-session writes the users row
// even when its account-sync step fails, so users is the row that exists
// in exactly the trap state this recovers from.
async function recoverMissingMemberships() {
  if (!query) return { recovered: false, reason: 'no-database' };
  if (Date.now() - _lastAccountSyncAttemptAt < ACCOUNT_SYNC_RECOVERY_INTERVAL_MS) {
    return { recovered: false, reason: 'throttled', accountSync: _lastAccountSync };
  }
  _lastAccountSyncAttemptAt = Date.now();
  try {
    let localUser = null;
    try {
      const rows = query('SELECT id, email FROM users ORDER BY lastLoginAt DESC LIMIT 1');
      localUser = rows && rows[0];
    } catch {
      // Older local DBs without lastLoginAt: any local user will do.
      const rows = query('SELECT id, email FROM users LIMIT 1');
      localUser = rows && rows[0];
    }
    if (!localUser || !localUser.email) {
      _lastAccountSync = { at: now(), success: false, memberships: 0, message: 'No local user to re-sync account for' };
      return { recovered: false, reason: 'no-local-user', accountSync: _lastAccountSync };
    }
    const accountService = require('./sync-account.service');
    const result = await accountService.syncAccount(localUser.id, localUser.email);
    const memberships = (result && result.data && result.data.memberships) ? result.data.memberships.length : 0;
    _lastAccountSync = {
      at: now(),
      success: result ? result.success === true : false,
      memberships,
      message: result ? (result.message || null) : 'Account sync unavailable'
    };
    if (_lastAccountSync.success) {
      console.log(`[Sync] Account recovery: ${memberships} membership(s) re-seeded`);
      return { recovered: memberships > 0, accountSync: _lastAccountSync };
    }
    console.log(`[Sync] Account recovery failed: ${_lastAccountSync.message}`);
    return { recovered: false, reason: 'account-sync-failed', accountSync: _lastAccountSync };
  } catch (e) {
    _lastAccountSync = { at: now(), success: false, memberships: 0, message: e.message };
    console.log(`[Sync] Account recovery error: ${e.message}`);
    return { recovered: false, reason: 'error', accountSync: _lastAccountSync };
  }
}

function getSyncCursor(businessId) {
  if (!query) return null;
  const rows = query(`SELECT value FROM settings WHERE key = ?`, [`sync_cursor_${businessId}`]);
  // First pull: start from the beginning so the desktop downloads full history,
  // not just the backend's default 24-hour window.
  return rows && rows.length > 0 ? rows[0].value : '1970-01-01T00:00:00.000Z';
}

function setSyncCursor(businessId, cursor) {
  if (!run) return;
  const existing = query(`SELECT id FROM settings WHERE key = ?`, [`sync_cursor_${businessId}`]);
  if (existing && existing.length > 0) {
    run(`UPDATE settings SET value = ?, updatedAt = ? WHERE key = ?`, [cursor, now(), `sync_cursor_${businessId}`]);
  } else {
    run(`INSERT INTO settings (id, key, value, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`,
      [uuid(), `sync_cursor_${businessId}`, cursor, now(), now()]);
  }
  saveDatabase();
}

function applyChanges(changes) {
  if (!run || !query || !saveDatabase) return;
  for (const change of changes) {
    try {
      const { entityType, entityId, operation, data } = change;
      const table = resolveLocalTable(entityType);
      if (operation === 'DELETE') {
        run(`DELETE FROM ${table} WHERE id = ?`, [entityId]);
      } else {
        const columns = Object.keys(data);
        // Json-typed fields (e.g. product_variants.attributes) arrive as
        // objects — sql.js can only bind scalars, so store them as JSON
        // text, mirroring the backend replication's cleanRecordForSQLite.
        const values = columns.map(c => {
          const v = data[c];
          return v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v;
        });
        const existing = query(`SELECT id FROM ${table} WHERE id = ?`, [entityId]);
        if (existing && existing.length > 0) {
          const setClause = columns.filter(c => c !== 'id').map(c => `${c} = ?`).join(', ');
          const updateValues = columns.filter(c => c !== 'id').map(c => values[columns.indexOf(c)]);
          if (setClause) {
            run(`UPDATE ${table} SET ${setClause} WHERE id = ?`, [...updateValues, entityId]);
          }
        } else {
          const placeholders = columns.map(() => '?').join(', ');
          const columnList = columns.join(', ');
          run(`INSERT INTO ${table} (${columnList}) VALUES (${placeholders})`, values);
        }
      }
    } catch (e) {
      console.log(`[Sync] Apply change error: ${e.message}`);
    }
  }
  saveDatabase();
}

async function syncBidirectional() {
  if (_syncInProgress) {
    return { status: 'SKIPPED', message: 'Sync already in progress' };
  }
  const state = await checkCloudConnectivity();
  if (state !== 'SYNC_READY') {
    console.log('[Sync] Sync skipped:', state === 'OFFLINE' ? 'offline' : 'not authenticated');
    return { status: state === 'OFFLINE' ? 'OFFLINE' : 'AUTH_REQUIRED', uploaded: 0, downloaded: 0 };
  }
  console.log('[Sync] Starting synchronization');
  // Membership recovery: with zero local memberships the provision/pull
  // steps below iterate zero rows forever — re-seed first (throttled).
  if (getLocalBusinessIds().length === 0) {
    await recoverMissingMemberships();
  }
  try {
    const provisionResult = await provisionPendingBusinesses();
    if (provisionResult.provisioned > 0) console.log(`[Sync] Provisioned ${provisionResult.provisioned} business(es)`);
  } catch (e) {
    console.log(`[Sync] Provision pass error: ${e.message}`);
  }
  const pushResult = await pushChangesToCloud();
  const pullResult = await pullChangesFromCloud();
  _lastSyncTime = now();
  console.log(`[Sync] ${pushResult.uploaded} uploaded, ${pullResult.downloaded} downloaded`);
  console.log('[Sync] Synchronization completed');
  _syncResult = { status: 'SUCCESS', uploaded: pushResult.uploaded || 0, downloaded: pullResult.downloaded || 0 };
  return _syncResult;
}

function startPeriodicSync() {
  if (syncInterval) return;
  loadOfflineQueue();
  console.log(`[Sync] Config: Poll every ${SYNC_CONFIG.POLL_INTERVAL}ms`);
  console.log('[Sync] SQLite is PRIMARY database - all features work without cloud');
  setTimeout(async () => {
    const state = await checkCloudConnectivity();
    if (state === 'SYNC_READY') {
      console.log('[Sync] Cloud available - starting sync');
      startSyncIntervals();
    } else {
      console.log('[Sync] Offline - will retry');
      const retryInterval = setInterval(async () => {
        const nowState = await checkCloudConnectivity(true);
        if (nowState === 'SYNC_READY') {
          clearInterval(retryInterval);
          console.log('[Sync] Cloud now available - starting sync');
          startSyncIntervals();
        }
      }, 10000);
    }
  }, 3000);
  function startSyncIntervals() {
    setTimeout(async () => {
      await syncBidirectional();
    }, 5000);
    if (pullInterval) clearInterval(pullInterval);
    pullInterval = setInterval(async () => {
      const st = await checkCloudConnectivity();
      if (st !== 'SYNC_READY') return;
      fullSyncCounter++;
      // Membership recovery (2026-10-24 trap): with zero local memberships
      // the provision/pull steps below iterate zero rows forever — re-seed
      // first (throttled to one account-sync attempt per minute). On a
      // successful re-seed the same tick provisions + pulls, so recovery
      // completes without waiting for the next tick.
      if (getLocalBusinessIds().length === 0) {
        await recoverMissingMemberships();
      }
      try {
        const provisionResult = await provisionPendingBusinesses();
        if (provisionResult.provisioned > 0) console.log(`[Sync] Provisioned ${provisionResult.provisioned} business(es)`);
      } catch (e) {
        console.log(`[Sync] Provision pass error: ${e.message}`);
      }
      await pullChangesFromCloud();
    }, SYNC_CONFIG.POLL_INTERVAL);
    if (syncInterval) clearInterval(syncInterval);
    syncInterval = setInterval(async () => {
      const st = await checkCloudConnectivity();
      if (st !== 'SYNC_READY') {
        if (st === 'OFFLINE') console.log('[Sync] Push skipped - offline');
        return;
      }
      await pushChangesToCloud();
    }, 30000);
  }
}

function markTableForPush(tableName) {
  pendingPushTables.add(tableName);
  if (_connectionState === 'SYNC_READY' && pushDebounceTimer) {
    clearTimeout(pushDebounceTimer);
  }
  if (_connectionState === 'SYNC_READY') {
    pushDebounceTimer = setTimeout(async () => {
      if (pendingPushTables.size > 0) {
        pendingPushTables.clear();
        await pushChangesToCloud();
      }
    }, SYNC_CONFIG.PUSH_DEBOUNCE);
  }
}

function handleDataChange(tableName, operation, data) {
  try {
    queueOfflineOperation(tableName, operation, data);
    durableEnqueue(tableName, operation, data);
    // Latch fix (2026-10-24): this used to setConnectionState('PENDING')
    // unconditionally and THEN test `if (_connectionState ===
    // 'SYNC_READY')` — always false after the set — so the immediate
    // push never fired, the state stayed PENDING until a periodic
    // interval rescued it, and the UI (which maps PENDING from an
    // engine that was actually SYNC_READY moments earlier) showed
    // "Offline" on a connected machine. Only downgrade to PENDING when
    // we are not already in a ready state, and always run the
    // recheck/push when we were ready.
    const wasReady = ['SYNC_READY', 'SYNCED', 'SYNCING'].includes(_connectionState);
    if (!wasReady && _connectionState !== 'AUTH_REQUIRED') {
      setConnectionState('PENDING');
    }
    if (wasReady) {
      (async () => {
        try {
          const state = await checkCloudConnectivity();
          if (state === 'SYNC_READY') {
            const pending = loadOperationsForPush();
            if (pending && pending.length > 0) {
              await pushChangesToCloud();
            }
          }
        } catch (e) {
          markTableForPush(tableName);
        }
      })();
    }
  } catch (e) {
    console.log(`[Sync] Error queuing ${tableName} ${operation}: ${e.message}`);
  }
}

function loadOfflineQueue() {
  try {
    if (fs.existsSync(QUEUE_PATH)) {
      const data = fs.readFileSync(QUEUE_PATH, 'utf8');
      offlineQueue = JSON.parse(data);
    }
  } catch (e) {
    offlineQueue = [];
  }
}

function saveOfflineQueue() {
  try {
    fs.writeFileSync(QUEUE_PATH, JSON.stringify(offlineQueue, null, 2));
  } catch (e) {}
}

function queueOfflineOperation(tableName, operation, data) {
  if (offlineQueue.length >= SYNC_CONFIG.MAX_QUEUE_SIZE) {
    offlineQueue = offlineQueue.slice(-SYNC_CONFIG.MAX_QUEUE_SIZE + 100);
  }
  offlineQueue.push({
    id: uuid(),
    tableName,
    operation,
    data,
    timestamp: now(),
    retries: 0,
    synced: false
  });
  saveOfflineQueue();
}

function getSyncResult() {
  return _syncResult;
}

function getSyncInProgress() {
  return _syncInProgress;
}

function getLastSyncTime() {
  return _lastSyncTime;
}

function getOfflineQueue() {
  return offlineQueue;
}

function processOfflineQueue() {
  if (offlineQueue.length === 0) return { processed: 0, failed: 0 };
  if (_connectionState !== 'SYNC_READY') return { processed: 0, failed: 0, message: 'Not ready' };
  return pushChangesToCloud();
}

function syncAllToPostgreSQL() {
  return syncBidirectional();
}

function pullAllFromPostgreSQL() {
  return pullChangesFromCloud();
}

function syncFromPostgreSQL() {
  return pullChangesFromCloud();
}

function checkPostgreSQLConnection() {
  return checkCloudConnectivity();
}

function connectPostgreSQL() {
  return checkCloudConnectivity();
}

function getPgClient() {
  return null;
}

function getIsOnline() {
  return _connectionState === 'SYNC_READY' || _connectionState === 'SYNCING' || _connectionState === 'SYNCED';
}

module.exports = {
  connectPostgreSQL,
  checkPostgreSQLConnection,
  processOfflineQueue,
  startPeriodicSync,
  markTableForPush,
  handleDataChange,
  loadOfflineQueue,
  saveOfflineQueue,
  queueOfflineOperation,
  getPgClient,
  getIsOnline,
  getSyncInProgress,
  getLastSyncTime,
  getOfflineQueue,
  initDatabaseFunctions,
  setCloudApi,
  getCloudApi,
  getConnectionState,
  setConnectionState,
  checkCloudConnectivity,
  pushChangesToCloud,
  pullChangesFromCloud,
  provisionPendingBusinesses,
  getLocalMembershipCount,
  getLastAccountSync,
  recoverMissingMemberships,
  syncBidirectional,
  getSyncResult,
  SYNC_CONFIG,
  REMOTE_DATABASE_URL: null
};
