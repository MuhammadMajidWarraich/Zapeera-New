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

function recordMovement(productId, type, quantity, reason, opts = {}) {
  ensureInit();
  const id = _uuid();
  const timestamp = _now();

  _run(`
    INSERT INTO stock_movements
    (id, productId, type, quantity, reason, referenceId, referenceType, branchId, companyId, createdBy, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id, productId, type, quantity, reason || '',
    opts.referenceId || null, opts.referenceType || null,
    opts.branchId || null, opts.companyId || null,
    opts.createdBy || null, timestamp, timestamp
  ]);

  const netQuantity = computeProductStock(productId);
  _run('UPDATE products SET quantity = ?, updatedAt = ? WHERE id = ?', [netQuantity, timestamp, productId]);
  _saveDatabase();

  return { movementId: id, newStock: netQuantity };
}

function computeProductStock(productId) {
  ensureInit();
  const movements = _query(
    `SELECT type, quantity FROM stock_movements WHERE productId = ?`,
    [productId]
  );

  let stock = 0;
  for (const m of movements || []) {
    const qty = m.quantity || 0;
    if (m.type === 'SALE' || m.type === 'OUT' || m.type === 'ADJUSTMENT_NEGATIVE') {
      stock -= qty;
    } else {
      stock += qty;
    }
  }
  return Math.max(0, stock);
}

async function pullStockFromCloud(productId, companyId) {
  ensureInit();
  if (!_cloudApi) return { pulled: 0 };

  try {
    const result = await _cloudApi.makeRequest('GET', `/api/inventory/stock-movements?productId=${productId}&companyId=${companyId}`);
    let pulled = 0;
    for (const row of (result.data || result.rows || [])) {
      const existing = _query('SELECT id FROM stock_movements WHERE id = ?', [row.id]);
      if (!existing || existing.length === 0) {
        _run(`
          INSERT INTO stock_movements
          (id, productId, type, quantity, reason, referenceId, referenceType, branchId, companyId, createdBy, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
          row.id, row.productId, row.type, row.quantity, row.reason || '',
          row.referenceId || null, row.referenceType || null,
          row.branchId || null, row.companyId || null,
          row.createdBy || null, row.createdAt || _now(), _now()
        ]);
        pulled++;
      }
    }

    if (pulled > 0) {
      const netStock = computeProductStock(productId);
      _run('UPDATE products SET quantity = ?, updatedAt = ? WHERE id = ?', [netStock, _now(), productId]);
      _saveDatabase();
    }

    return { pulled };
  } catch (e) {
    console.error('[SyncInventory] Pull error:', e.message);
    return { pulled: 0, error: e.message };
  }
}

function getProductMovements(productId, limit = 100) {
  ensureInit();
  return _query(
    `SELECT * FROM stock_movements WHERE productId = ? ORDER BY createdAt DESC LIMIT ?`,
    [productId, limit]
  );
}

module.exports = {
  init,
  setCloudApi,
  recordMovement,
  computeProductStock,
  pullStockFromCloud,
  getProductMovements
};
