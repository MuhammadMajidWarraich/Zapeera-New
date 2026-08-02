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
  subscription: 'subscriptions'
};

function resolveLocalTable(entityType) {
  return ENTITY_TYPE_TO_TABLE[entityType] || entityType;
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
  { name: 'device_activation', priority: 28 }
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
    } catch {
      setConnectionState('AUTH_REQUIRED');
      return 'AUTH_REQUIRED';
    }
    return 'CLOUD_REACHABLE';
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
    const pending = loadOperationsForPush();
    if (!pending || pending.length === 0) {
      _syncInProgress = false;
      setConnectionState('SYNCED');
      return { status: 'SUCCESS', uploaded: 0, failed: 0 };
    }
    const businessGroups = {};
    for (const op of pending) {
      const key = op.businessId || 'default';
      if (!businessGroups[key]) businessGroups[key] = [];
      businessGroups[key].push(op);
    }
    let totalUploaded = 0;
    let totalFailed = 0;
    for (const [businessId, operations] of Object.entries(businessGroups)) {
      try {
        const result = await cloudApi.pushOperations(businessId, operations);
        if (result.success !== false) {
          for (const op of operations) {
            markOperationCompleted(op);
          }
          totalUploaded += operations.length;
        } else {
          totalFailed += operations.length;
        }
      } catch (e) {
        console.log(`[Sync] Push failed for ${businessId}: ${e.message}`);
        totalFailed += operations.length;
        for (const op of operations) {
          markOperationFailed(op, e.message);
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
        const values = columns.map(c => data[c]);
        const existing = query(`SELECT id FROM ${table} WHERE id = ?`, [entityId]);
        if (existing && existing.length > 0) {
          const setClause = columns.filter(c => c !== 'id').map(c => `${c} = ?`).join(', ');
          const updateValues = columns.filter(c => c !== 'id').map(c => data[c]);
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
    setConnectionState('PENDING');
    if (_connectionState === 'SYNC_READY') {
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
  syncBidirectional,
  getSyncResult,
  SYNC_CONFIG,
  REMOTE_DATABASE_URL: null
};
