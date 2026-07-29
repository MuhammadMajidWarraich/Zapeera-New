let _query = null;
let _run = null;
let _saveDatabase = null;
let _now = null;
let _syncAccountService = null;

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

let refreshTimer = null;

function init(deps) {
  _query = deps.query;
  _run = deps.run;
  _saveDatabase = deps.saveDatabase;
  _now = deps.now;
  _syncAccountService = deps.syncAccountService;
}

function ensureInit() {
  if (!_query) {
    const db = require('./database.service');
    _query = db.query;
    _run = db.run;
    _saveDatabase = db.saveDatabase;
    _now = require('../utils/helpers').now;
    _syncAccountService = require('./sync-account.service');
  }
}

async function refreshAuthorization(userId) {
  ensureInit();
  if (!userId || !_syncAccountService) return { changed: false };

  try {
    const prevMemberships = _query('SELECT businessId, role, status FROM memberships WHERE userId = ?', [userId]);

    const result = await _syncAccountService.syncAccount(userId, null);
    if (!result.success) return { changed: false };

    const currentMemberships = _query('SELECT businessId, role, status FROM memberships WHERE userId = ?', [userId]);

    const changes = detectChanges(prevMemberships, currentMemberships);

    _run(`UPDATE local_identity SET lastCloudValidationAt = ?, updatedAt = ? WHERE cloudUserId = ?`,
      [_now(), _now(), userId]);
    _saveDatabase();

    return { changed: changes.length > 0, changes };
  } catch (e) {
    console.error('[AuthRefresh] Error:', e.message);
    return { changed: false, error: e.message };
  }
}

function detectChanges(prev, current) {
  const changes = [];
  const prevMap = {};
  for (const m of prev || []) prevMap[m.businessId] = m;

  for (const cur of current || []) {
    const prevRecord = prevMap[cur.businessId];
    if (!prevRecord) {
      changes.push({ businessId: cur.businessId, type: 'ADDED', role: cur.role });
    } else if (prevRecord.role !== cur.role) {
      changes.push({ businessId: cur.businessId, type: 'ROLE_CHANGED', from: prevRecord.role, to: cur.role });
    } else if (prevRecord.status !== cur.status) {
      changes.push({ businessId: cur.businessId, type: 'STATUS_CHANGED', from: prevRecord.status, to: cur.status });
    }
  }

  for (const prevM of prev || []) {
    const stillExists = (current || []).some(c => c.businessId === prevM.businessId);
    if (!stillExists) {
      changes.push({ businessId: prevM.businessId, type: 'REMOVED' });
    }
  }

  return changes;
}

async function startPeriodicRefresh(userId) {
  stopPeriodicRefresh();
  if (!userId) return;

  refreshTimer = setInterval(async () => {
    try {
      await refreshAuthorization(userId);
    } catch (e) {
      console.error('[AuthRefresh] Periodic refresh error:', e.message);
    }
  }, REFRESH_INTERVAL_MS);
}

function stopPeriodicRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

module.exports = {
  init,
  refreshAuthorization,
  startPeriodicRefresh,
  stopPeriodicRefresh,
  detectChanges
};
