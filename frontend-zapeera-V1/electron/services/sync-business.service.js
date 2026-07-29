const path = require('path');

let _query = null;
let _run = null;
let _saveDatabase = null;
let _uuid = null;
let _now = null;
let _getDataDir = null;
let _cloudApi = null;

const SYNC_TABLES = [
  'products', 'categories', 'manufacturers', 'suppliers', 'shelves',
  'batches', 'customers', 'sales', 'sale_items', 'purchases',
  'purchase_items', 'employees', 'stock_movements', 'refunds'
];

function init(deps) {
  _query = deps.query;
  _run = deps.run;
  _saveDatabase = deps.saveDatabase;
  _uuid = deps.uuid;
  _now = deps.now;
  _getDataDir = deps.getDataDir;
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
    _getDataDir = require('../config/database.config').getDataDir;
    _cloudApi = require('./cloud-api.service');
  }
}

function getBusinessDbPath(businessId) {
  ensureInit();
  const dataDir = _getDataDir();
  return path.join(dataDir, 'businesses', `${businessId}.db`);
}

async function provisionBusiness(businessId, userId, branchIds = []) {
  ensureInit();
  if (!_cloudApi) {
    return { success: false, message: 'Cloud API not configured' };
  }

  try {
    const result = await _cloudApi.provisionBusiness(businessId);
    if (result.success !== false && result.data) {
      _run(`UPDATE memberships SET status = 'DOWNLOADED', updatedAt = ? WHERE businessId = ? AND userId = ?`,
        [_now(), businessId, userId]);
      _saveDatabase();
    }
    return result;
  } catch (e) {
    return { success: false, message: e.message };
  }
}

async function getBusinessProvisionStatus(businessId, userId) {
  ensureInit();
  const memberships = _query(
    `SELECT status, updatedAt FROM memberships WHERE businessId = ? AND userId = ?`,
    [businessId, userId]
  );
  return memberships && memberships.length > 0 ? memberships[0] : { status: 'CLOUD_ONLY', updatedAt: null };
}

function removeLocalBusiness(businessId) {
  ensureInit();
  _run(`UPDATE memberships SET status = 'CLOUD_ONLY', updatedAt = ? WHERE businessId = ?`,
    [_now(), businessId]);
  _saveDatabase();
}

module.exports = {
  init,
  setCloudApi,
  provisionBusiness,
  getBusinessProvisionStatus,
  removeLocalBusiness,
  getBusinessDbPath,
  SYNC_TABLES
};
