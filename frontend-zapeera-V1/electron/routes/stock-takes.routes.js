/**
 * Stock-takes — embedded port of
 * backend-zapeera-v1-main/src/controllers/stock-take.controller.ts
 * (routes /api/stock-takes; module stock_takes — core).
 *
 * A formal physical count of one branch. The session is OPEN while
 * counting; each counted batch becomes a line whose systemQty is the
 * batch quantity AT THE MOMENT OF THE COUNT. Completing the session
 * posts every counted line's variance in one step: the batch quantity
 * is SET to the counted quantity and a STOCK_TAKE_ADJUSTMENT stock
 * movement records the signed variance. Uncounted lines are never
 * touched. At most one OPEN session per branch (409
 * STOCK_TAKE_ALREADY_OPEN). Completion is OWNER/MANAGER only — it
 * rewrites stock. Lines are frozen once the session closes.
 * Sync: stock_takes / stock_take_lines are in the cloud pull feed +
 * push map, so writes enqueue via handleDataChange.
 */
const { getDataFilter } = require('../utils/helpers');
const { v4: uuid } = require('uuid');
const { mustRun } = require('../utils/db-write');

function lineVariance(systemQty, countedQty) {
  if (countedQty === null || countedQty === undefined) return null;
  return countedQty - systemQty;
}

function summarizeStockTake(lines) {
  let countedLines = 0;
  let totalSystem = 0;
  let totalCounted = 0;
  let shortageUnits = 0;
  let surplusUnits = 0;
  let adjustedLines = 0;
  for (const line of lines) {
    if (line.countedQty === null || line.countedQty === undefined) continue;
    countedLines += 1;
    totalSystem += Number(line.systemQty) || 0;
    totalCounted += Number(line.countedQty) || 0;
    const v = lineVariance(line.systemQty, line.countedQty);
    if (v < 0) shortageUnits += Math.abs(v);
    if (v > 0) surplusUnits += v;
    if (v !== 0) adjustedLines += 1;
  }
  return {
    lineCount: lines.length,
    countedLines,
    uncountedLines: lines.length - countedLines,
    totalSystem,
    totalCounted,
    totalVariance: totalCounted - totalSystem,
    shortageUnits,
    surplusUnits,
    adjustedLines
  };
}

function registerStockTakeRoutes(app, authMiddleware, deps) {
  const { query, run, saveDatabase, handleDataChange } = deps;

  function requireManager(req, res, action) {
    const role = String(req.user?.role || '').toUpperCase();
    if (!['OWNER', 'MANAGER', 'ADMIN'].includes(role)) {
      res.status(403).json({ success: false, message: `Only the owner or a manager can ${action}` });
      return false;
    }
    return true;
  }
  function enqueue(entityType, op, row) {
    try { if (typeof handleDataChange === 'function') handleDataChange(entityType, op, row); } catch (e) { console.error('[StockTakes] sync enqueue failed:', e.message); }
  }
  function shapeLine(line, status) {
    const product = query('SELECT id, name, sku FROM products WHERE id = ?', [line.productId])[0] || null;
    const batch = line.batchId ? query('SELECT id, batchNo, expireDate, variantId FROM batches WHERE id = ?', [line.batchId])[0] : null;
    return {
      ...line,
      variance: status === 'COMPLETED' ? line.variance : lineVariance(line.systemQty, line.countedQty),
      product,
      batch
    };
  }
  function shapeTake(row) {
    const lines = query('SELECT * FROM stock_take_lines WHERE stockTakeId = ? ORDER BY createdAt ASC', [row.id]);
    const shaped = lines.map((l) => shapeLine(l, row.status));
    return { ...row, lines: shaped, summary: summarizeStockTake(shaped) };
  }
  function pageParams(req, def = 50) {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || def));
    return { page, limit, offset: (page - 1) * limit };
  }

  app.post('/api/stock-takes', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const b = req.body || {};
      if (!b.branchId) return res.status(400).json({ success: false, message: 'branchId is required' });
      const branch = query('SELECT id, name FROM branches WHERE id = ? AND companyId = ?', [b.branchId, companyFilter])[0];
      if (!branch) return res.status(404).json({ success: false, message: 'Branch not found in this business' });
      const open = query("SELECT id, createdAt FROM stock_takes WHERE companyId = ? AND branchId = ? AND status = 'OPEN'", [companyFilter, branch.id])[0];
      if (open) {
        return res.status(409).json({ success: false, message: 'A stock-take is already open for this branch — complete or cancel it before starting another', code: 'STOCK_TAKE_ALREADY_OPEN', data: { openStockTakeId: open.id } });
      }
      const id = uuid();
      const now = new Date().toISOString();
      run(
        'INSERT INTO stock_takes (id, companyId, branchId, status, startedBy, note, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, companyFilter, branch.id, 'OPEN', req.user?.id || null, b.note ? String(b.note).trim() : null, now, now]
      );
      saveDatabase();
      const row = query('SELECT * FROM stock_takes WHERE id = ?', [id])[0];
      enqueue('stockTake', 'create', row);
      res.status(201).json({ success: true, data: shapeTake(row) });
    } catch (e) {
      console.error('[StockTakes] Create error:', e.message);
      res.status(500).json({ success: false, message: 'Failed to open stock-take' });
    }
  });

  app.get('/api/stock-takes', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const { page, limit, offset } = pageParams(req);
      const where = ['companyId = ?'];
      const params = [companyFilter];
      if (req.query.branchId) { where.push('branchId = ?'); params.push(String(req.query.branchId)); }
      if (req.query.status) { where.push('status = ?'); params.push(String(req.query.status).toUpperCase()); }
      const total = query(`SELECT COUNT(*) AS c FROM stock_takes WHERE ${where.join(' AND ')}`, params)[0].c;
      const rows = query(`SELECT * FROM stock_takes WHERE ${where.join(' AND ')} ORDER BY createdAt DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
      res.json({ success: true, data: rows.map(shapeTake), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (e) {
      console.error('[StockTakes] List error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/stock-takes/:id', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM stock_takes WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Stock-take not found' });
      res.json({ success: true, data: shapeTake(row) });
    } catch (e) {
      console.error('[StockTakes] Get error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post('/api/stock-takes/:id/lines', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const b = req.body || {};
      if (!b.batchId || !Number.isInteger(b.countedQty) || b.countedQty < 0) {
        return res.status(400).json({ success: false, message: 'batchId and a countedQty of 0 or more are required' });
      }
      const take = query('SELECT id, status, branchId FROM stock_takes WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!take) return res.status(404).json({ success: false, message: 'Stock-take not found' });
      if (take.status !== 'OPEN') {
        return res.status(409).json({ success: false, message: 'This stock-take is no longer open — its lines are frozen', code: 'STOCK_TAKE_NOT_OPEN' });
      }
      const batch = query('SELECT id, productId, quantity FROM batches WHERE id = ? AND companyId = ? AND branchId = ?', [b.batchId, companyFilter, take.branchId])[0];
      if (!batch) return res.status(404).json({ success: false, message: "Batch not found in this stock-take's branch" });
      const now = new Date().toISOString();
      const existing = query('SELECT * FROM stock_take_lines WHERE stockTakeId = ? AND batchId = ?', [take.id, batch.id])[0];
      let line;
      if (existing) {
        run('UPDATE stock_take_lines SET systemQty = ?, countedQty = ?, updatedAt = ? WHERE id = ?', [batch.quantity, b.countedQty, now, existing.id]);
        line = query('SELECT * FROM stock_take_lines WHERE id = ?', [existing.id])[0];
        enqueue('stockTakeLine', 'update', line);
      } else {
        const lineId = uuid();
        run(
          'INSERT INTO stock_take_lines (id, stockTakeId, productId, batchId, systemQty, countedQty, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [lineId, take.id, batch.productId, batch.id, batch.quantity, b.countedQty, now, now]
        );
        line = query('SELECT * FROM stock_take_lines WHERE id = ?', [lineId])[0];
        enqueue('stockTakeLine', 'create', line);
      }
      saveDatabase();
      res.status(201).json({ success: true, data: shapeLine(line, take.status) });
    } catch (e) {
      console.error('[StockTakes] Line error:', e.message);
      res.status(500).json({ success: false, message: 'Failed to record the count' });
    }
  });

  app.delete('/api/stock-takes/:id/lines/:lineId', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const take = query('SELECT id, status FROM stock_takes WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!take) return res.status(404).json({ success: false, message: 'Stock-take not found' });
      if (take.status !== 'OPEN') {
        return res.status(409).json({ success: false, message: 'This stock-take is no longer open — its lines are frozen', code: 'STOCK_TAKE_NOT_OPEN' });
      }
      const line = query('SELECT id FROM stock_take_lines WHERE id = ? AND stockTakeId = ?', [req.params.lineId, take.id])[0];
      if (!line) return res.status(404).json({ success: false, message: 'Stock-take line not found' });
      run('DELETE FROM stock_take_lines WHERE id = ?', [line.id]);
      saveDatabase();
      enqueue('stockTakeLine', 'delete', line);
      res.json({ success: true, message: 'Line removed from the stock-take' });
    } catch (e) {
      console.error('[StockTakes] Line delete error:', e.message);
      res.status(500).json({ success: false, message: 'Failed to remove the line' });
    }
  });

  app.post('/api/stock-takes/:id/complete', authMiddleware, (req, res) => {
    try {
      if (!requireManager(req, res, 'complete a stock-take')) return;
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const take = query('SELECT * FROM stock_takes WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!take) return res.status(404).json({ success: false, message: 'Stock-take not found' });
      if (take.status !== 'OPEN') {
        return res.status(409).json({ success: false, message: 'This stock-take is no longer open', code: 'STOCK_TAKE_NOT_OPEN' });
      }
      const lines = query('SELECT * FROM stock_take_lines WHERE stockTakeId = ? ORDER BY createdAt ASC', [take.id]);
      const countedLines = lines.filter((l) => l.countedQty !== null && l.countedQty !== undefined);
      if (countedLines.length === 0) {
        return res.status(400).json({ success: false, message: 'Nothing has been counted in this stock-take yet', code: 'STOCK_TAKE_NO_COUNTS' });
      }
      const completedBy = req.user?.id || null;
      const now = new Date().toISOString();
      const applied = [];
      try {
        for (const line of countedLines) {
          const variance = lineVariance(line.systemQty, line.countedQty);
          // Zero-variance lines are frozen with variance 0 and no movement.
          mustRun(run, 'UPDATE stock_take_lines SET variance = ?, updatedAt = ? WHERE id = ?', [variance, now, line.id]);
          if (variance === 0) continue;
          const batch = query('SELECT * FROM batches WHERE id = ? AND companyId = ?', [line.batchId, companyFilter])[0];
          if (!batch) throw new Error(`Batch ${line.batchId} could not be adjusted — it no longer belongs to this business`);
          const prevQty = batch.quantity;
          mustRun(run, 'UPDATE batches SET quantity = ? WHERE id = ?', [line.countedQty, line.batchId]);
          applied.push({ batchId: line.batchId, prevQty });
          const movementId = uuid();
          mustRun(run, 
            'INSERT INTO stock_movements (id, productId, type, quantity, reason, referenceId, referenceType, branchId, companyId, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [movementId, line.productId, 'STOCK_TAKE_ADJUSTMENT', variance, `Stock take ${take.id} — counted ${line.countedQty} vs system ${line.systemQty}`, take.id, 'STOCK_TAKE', take.branchId, companyFilter, completedBy || 'system', now]
          );
          mustRun(run, 'UPDATE stock_take_lines SET adjustmentMovementId = ? WHERE id = ?', [movementId, line.id]);
        }
        mustRun(run, "UPDATE stock_takes SET status = ?, completedBy = ?, completedAt = ?, updatedAt = ? WHERE id = ?", ['COMPLETED', completedBy, now, now, take.id]);
      } catch (e) {
        for (const a of applied.reverse()) run('UPDATE batches SET quantity = ? WHERE id = ?', [a.prevQty, a.batchId]);
        run('DELETE FROM stock_movements WHERE referenceId = ?', [take.id]);
        saveDatabase();
        throw e;
      }
      saveDatabase();
      const updated = query('SELECT * FROM stock_takes WHERE id = ?', [take.id])[0];
      enqueue('stockTake', 'update', updated);
      res.json({ success: true, data: shapeTake(updated), message: 'Stock-take completed — variances posted' });
    } catch (e) {
      console.error('[StockTakes] Complete error:', e.message);
      res.status(500).json({ success: false, message: 'Failed to complete stock-take: ' + e.message });
    }
  });

  app.post('/api/stock-takes/:id/cancel', authMiddleware, (req, res) => {
    try {
      if (!requireManager(req, res, 'cancel a stock-take')) return;
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const take = query('SELECT * FROM stock_takes WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!take) return res.status(404).json({ success: false, message: 'Stock-take not found' });
      if (take.status !== 'OPEN') {
        return res.status(409).json({ success: false, message: 'This stock-take is no longer open', code: 'STOCK_TAKE_NOT_OPEN' });
      }
      const now = new Date().toISOString();
      run("UPDATE stock_takes SET status = ?, updatedAt = ? WHERE id = ?", ['CANCELLED', now, take.id]);
      saveDatabase();
      const updated = query('SELECT * FROM stock_takes WHERE id = ?', [take.id])[0];
      enqueue('stockTake', 'update', updated);
      res.json({ success: true, data: shapeTake(updated), message: 'Stock-take cancelled' });
    } catch (e) {
      console.error('[StockTakes] Cancel error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });
}

module.exports = { registerStockTakeRoutes };
