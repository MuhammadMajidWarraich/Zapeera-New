let _query = null;
let _run = null;
let _saveDatabase = null;
let _uuid = null;
let _now = null;
let _cloudApi = null;

function init(deps) {
  _query = deps.query;
  _run = deps.run;
  _saveDatabase = deps.saveDatabase;
  _uuid = deps.uuid;
  _now = deps.now;
}

function setCloudApi(api) {
  _cloudApi = api;
}

function ensureInit() {
  if (!_query) {
    const db = require('./database.service');
    _query = db.query;
    _run = db.run;
    _saveDatabase = db.saveDatabase;
    _uuid = require('../utils/helpers').uuid;
    _now = require('../utils/helpers').now;
    _cloudApi = require('./cloud-api.service');
  }
}

async function syncAccount(userId, email) {
  ensureInit();
  if (!_cloudApi) {
    return { success: false, message: 'Cloud API not configured' };
  }

  try {
    const result = await _cloudApi.syncAccount();
    if (!result.success) {
      return { success: false, message: result.message || 'Cloud sync failed' };
    }

    const data = result.data || {};
    const results = { user: null, memberships: [], businesses: [], subscriptions: [] };

    if (data.user) {
      const pgUser = data.user;
      const localId = 'cloud-' + pgUser.id;
      const existing = _query('SELECT id FROM local_identity WHERE cloudUserId = ?', [pgUser.id]);

      if (existing && existing.length > 0) {
        _run(`UPDATE local_identity SET displayName = ?, email = ?, username = ?, lastCloudValidationAt = ?, updatedAt = ? WHERE cloudUserId = ?`,
          [pgUser.name || pgUser.displayName, pgUser.email, pgUser.username || pgUser.email, _now(), _now(), pgUser.id]);
      } else {
        _run(`INSERT INTO local_identity (id, cloudUserId, displayName, email, username, lastAuthenticatedAt, lastCloudValidationAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [localId, pgUser.id, pgUser.name || pgUser.displayName, pgUser.email, pgUser.username || pgUser.email, _now(), _now(), _now(), _now()]);
      }

      _saveDatabase();
      results.user = pgUser;
    }

    if (data.memberships && Array.isArray(data.memberships)) {
      for (const m of data.memberships) {
        const localId = 'cloud-' + m.id;
        const existing = _query('SELECT id FROM memberships WHERE id = ?', [localId]);

        if (existing && existing.length > 0) {
          _run(`UPDATE memberships SET role = ?, businessName = ?, businessType = ?, subscriptionPlan = ?, subscriptionStatus = ?, status = ?, updatedAt = ? WHERE id = ?`,
            [m.role, m.businessName || '', m.businessType || '', m.subscriptionPlan || '', m.subscriptionStatus || '', m.status || 'ACTIVE', _now(), localId]);
        } else {
          _run(`INSERT INTO memberships (id, userId, businessId, businessName, businessType, role, branchIds, subscriptionPlan, subscriptionStatus, status, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [localId, userId, m.businessId, m.businessName || '', m.businessType || '', m.role || '', (m.branchIds || []).join(','), m.subscriptionPlan || '', m.subscriptionStatus || '', m.status || 'ACTIVE', _now(), _now()]);
        }

        results.memberships.push(m);
      }
    }

    _saveDatabase();
    return { success: true, data: results };
  } catch (e) {
    console.error('[SyncAccount] Error:', e.message);
    return { success: false, message: e.message };
  }
}

async function getLocalAccount() {
  ensureInit();
  const identity = _query('SELECT * FROM local_identity ORDER BY updatedAt DESC LIMIT 1');
  const memberships = _query('SELECT * FROM memberships ORDER BY updatedAt DESC');

  return {
    identity: identity && identity.length > 0 ? identity[0] : null,
    memberships: memberships || []
  };
}

module.exports = { init, setCloudApi, syncAccount, getLocalAccount };
