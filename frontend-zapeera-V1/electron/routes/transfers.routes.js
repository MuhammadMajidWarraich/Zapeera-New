/**
 * Inter-branch stock transfers — embedded port of
 * backend-zapeera-v1-main/src/controllers/transfer.controller.ts
 * (routes /api/transfers; module inventory — core).
 *
 * Lifecycle (two-step, as on the cloud):
 *   CREATE   → PENDING. Source batch stock is VALIDATED but NOT
 *              reserved or moved — the batch stays fully sellable
 *              until the transfer is received.
 *   COMPLETE → PENDING only; re-validates every source batch, then
 *              decrements each source batch, increments (or creates)
 *              the matching batch at the destination branch (same
 *              batchNo/expiry/prices), links it as the item's
 *              destBatch, and writes TRANSFER_OUT / TRANSFER_IN stock
 *              movements. Any shortfall fails the whole completion
 *              with 409 and nothing moves.
 *   CANCEL   → PENDING only; nothing ever moved, nothing to reverse.
 * Sync: stock_transfers / stock_transfer_items are in the cloud pull
 * feed + push map, so writes enqueue via handleDataChange.
 */
const { getDataFilter } = require('../utils/helpers');
const { v4: uuid } = require('uuid');
const { mustRun } = require('../utils/db-write');

function registerTransferRoutes(app, authMiddleware, deps) {
  const { query, run, saveDatabase, handleDataChange } = deps;

  function generateTransferNumber() {
    const now = new Date();
    const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const randPart = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `TRF-${datePart}-${randPart}`;
  }
  function enqueue(entityType, op, row) {
    try { if (typeof handleDataChange === 'function') handleDataChange(entityType, op, row); } catch (e) { console.error('[Transfers] sync enqueue failed:', e.message); }
  }
  function shapeTransfer(row) {
    const fromBranch = row.fromBranchId ? query('SELECT id, name FROM branches WHERE id = ?', [row.fromBranchId])[0] : null;
    const toBranch = row.toBranchId ? query('SELECT id, name FROM branches WHERE id = ?', [row.toBranchId])[0] : null;
    const items = query('SELECT * FROM stock_transfer_items WHERE transferId = ?', [row.id]).map((item) => {
      const product = query('SELECT id, name, sku, barcode FROM products WHERE id = ?', [item.productId])[0] || null;
      const sourceBatch = item.sourceBatchId ? query('SELECT id, batchNo, quantity, expireDate FROM batches WHERE id = ?', [item.sourceBatchId])[0] : null;
      const destBatch = item.destBatchId ? query('SELECT id, batchNo, quantity, expireDate FROM batches WHERE id = ?', [item.destBatchId])[0] : null;
      return { ...item, product, sourceBatch, destBatch };
    });
    return { ...row, fromBranch, toBranch, items };
  }
  function pageParams(req, def = 10) {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || def));
    return { page, limit, offset: (page - 1) * limit };
  }

  app.post('/api/transfers', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const b = req.body || {};
      if (!b.fromBranchId || !b.toBranchId) return res.status(400).json({ success: false, message: 'fromBranchId and toBranchId are required' });
      if (!Array.isArray(b.items) || b.items.length === 0) return res.status(400).json({ success: false, message: 'At least one item is required' });
      for (const item of b.items) {
        if (!item.productId || !item.sourceBatchId || !Number.isInteger(item.quantity) || item.quantity < 1) {
          return res.status(400).json({ success: false, message: 'Each item must include productId, sourceBatchId and a quantity of at least 1' });
        }
      }
      if (b.fromBranchId === b.toBranchId) return res.status(400).json({ success: false, message: 'Source and destination branches cannot be the same' });
      const fromBranch = query('SELECT id FROM branches WHERE id = ? AND companyId = ?', [b.fromBranchId, companyFilter])[0];
      const toBranch = query('SELECT id FROM branches WHERE id = ? AND companyId = ?', [b.toBranchId, companyFilter])[0];
      if (!fromBranch || !toBranch) return res.status(404).json({ success: false, message: 'Branch not found' });
      // Merge duplicate source-batch lines so validation sees the true total.
      const quantityByBatch = new Map();
      for (const item of b.items) quantityByBatch.set(item.sourceBatchId, (quantityByBatch.get(item.sourceBatchId) || 0) + item.quantity);
      for (const item of b.items) {
        const batch = query('SELECT * FROM batches WHERE id = ? AND companyId = ? AND branchId = ?', [item.sourceBatchId, companyFilter, b.fromBranchId])[0];
        if (!batch) return res.status(400).json({ success: false, message: `Source batch not found in the source branch: ${item.sourceBatchId}` });
        if (batch.productId !== item.productId) return res.status(400).json({ success: false, message: `Batch ${batch.batchNo} does not belong to the selected product` });
        const requestedTotal = quantityByBatch.get(item.sourceBatchId) || 0;
        if ((Number(batch.quantity) || 0) < requestedTotal) {
          const product = query('SELECT name FROM products WHERE id = ?', [item.productId])[0];
          return res.status(409).json({ success: false, message: `Insufficient stock in batch ${batch.batchNo} (${product ? product.name : 'product'}): available ${batch.quantity || 0}, requested ${requestedTotal}`, code: 'INSUFFICIENT_STOCK' });
        }
      }
      const id = uuid();
      const now = new Date().toISOString();
      run(
        'INSERT INTO stock_transfers (id, transferNumber, companyId, fromBranchId, toBranchId, status, notes, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, generateTransferNumber(), companyFilter, b.fromBranchId, b.toBranchId, 'PENDING', b.notes || null, req.user?.id || null, now, now]
      );
      for (const item of b.items) {
        run(
          'INSERT INTO stock_transfer_items (id, transferId, productId, sourceBatchId, quantity, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [uuid(), id, item.productId, item.sourceBatchId, item.quantity, now, now]
        );
      }
      saveDatabase();
      const row = query('SELECT * FROM stock_transfers WHERE id = ?', [id])[0];
      enqueue('stockTransfer', 'create', row);
      for (const item of query('SELECT * FROM stock_transfer_items WHERE transferId = ?', [id])) enqueue('stockTransferItem', 'create', item);
      res.status(201).json({ success: true, data: shapeTransfer(row), message: 'Transfer created successfully' });
    } catch (e) {
      console.error('[Transfers] Create error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/transfers', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const { page, limit, offset } = pageParams(req);
      const where = ['companyId = ?'];
      const params = [companyFilter];
      if (req.query.status) { where.push('status = ?'); params.push(String(req.query.status).toUpperCase()); }
      if (req.query.fromBranchId) { where.push('fromBranchId = ?'); params.push(String(req.query.fromBranchId)); }
      if (req.query.toBranchId) { where.push('toBranchId = ?'); params.push(String(req.query.toBranchId)); }
      const total = query(`SELECT COUNT(*) AS c FROM stock_transfers WHERE ${where.join(' AND ')}`, params)[0].c;
      const rows = query(`SELECT * FROM stock_transfers WHERE ${where.join(' AND ')} ORDER BY createdAt DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
      res.json({ success: true, data: rows.map(shapeTransfer), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (e) {
      console.error('[Transfers] List error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/transfers/:id', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM stock_transfers WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Transfer not found' });
      res.json({ success: true, data: shapeTransfer(row) });
    } catch (e) {
      console.error('[Transfers] Get error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post('/api/transfers/:id/complete', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const transfer = query('SELECT * FROM stock_transfers WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!transfer) return res.status(404).json({ success: false, message: 'Transfer not found' });
      if (transfer.status !== 'PENDING') {
        return res.status(409).json({ success: false, message: `Only a PENDING transfer can be completed (current status: ${transfer.status})`, code: 'INVALID_TRANSFER_STATUS' });
      }
      const items = query('SELECT * FROM stock_transfer_items WHERE transferId = ?', [transfer.id]);
      const actorId = req.user?.id || null;
      const now = new Date().toISOString();
      // Re-validate every source batch BEFORE moving anything: any
      // shortfall fails the whole completion and nothing moves.
      for (const item of items) {
        const sourceBatch = query('SELECT * FROM batches WHERE id = ? AND companyId = ? AND branchId = ?', [item.sourceBatchId, companyFilter, transfer.fromBranchId])[0];
        if (!sourceBatch) return res.status(409).json({ success: false, message: 'Source batch for one of the transfer items no longer exists', code: 'INSUFFICIENT_STOCK' });
        if ((Number(sourceBatch.quantity) || 0) < item.quantity) {
          return res.status(409).json({ success: false, message: `Insufficient stock in batch ${sourceBatch.batchNo}: available ${sourceBatch.quantity || 0}, transfer needs ${item.quantity}. Nothing was moved.`, code: 'INSUFFICIENT_STOCK' });
        }
      }
      const fromBranch = query('SELECT name FROM branches WHERE id = ?', [transfer.fromBranchId])[0];
      const toBranch = query('SELECT name FROM branches WHERE id = ?', [transfer.toBranchId])[0];
      const applied = [];
      try {
        for (const item of items) {
          const sourceBatch = query('SELECT * FROM batches WHERE id = ?', [item.sourceBatchId])[0];
          mustRun(run, 'UPDATE batches SET quantity = quantity - ? WHERE id = ?', [item.quantity, sourceBatch.id]);
          applied.push({ batchId: sourceBatch.id, delta: -item.quantity });
          let destBatch = query('SELECT * FROM batches WHERE batchNo = ? AND productId = ? AND branchId = ?', [sourceBatch.batchNo, item.productId, transfer.toBranchId])[0];
          if (destBatch) {
            mustRun(run, 'UPDATE batches SET quantity = quantity + ? WHERE id = ?', [item.quantity, destBatch.id]);
            applied.push({ batchId: destBatch.id, delta: item.quantity });
          } else {
            const destId = uuid();
            mustRun(run, 
              'INSERT INTO batches (id, batchNo, productId, branchId, companyId, supplierId, supplierName, barcode, quantity, purchasePrice, sellingPrice, stockPurchasePrice, expireDate, productionDate, purchasingMethod, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
              [destId, sourceBatch.batchNo, item.productId, transfer.toBranchId, companyFilter, sourceBatch.supplierId, sourceBatch.supplierName, sourceBatch.barcode, item.quantity, sourceBatch.purchasePrice, sourceBatch.sellingPrice, sourceBatch.stockPurchasePrice, sourceBatch.expireDate, sourceBatch.productionDate, sourceBatch.purchasingMethod, actorId, now, now]
            );
            destBatch = query('SELECT * FROM batches WHERE id = ?', [destId])[0];
            applied.push({ batchId: destId, delta: item.quantity, created: true });
          }
          mustRun(run, 'UPDATE stock_transfer_items SET destBatchId = ?, updatedAt = ? WHERE id = ?', [destBatch.id, now, item.id]);
          mustRun(run, 
            'INSERT INTO stock_movements (id, productId, type, quantity, reason, referenceId, referenceType, branchId, companyId, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [uuid(), item.productId, 'TRANSFER_OUT', item.quantity, `Transfer ${transfer.transferNumber} to ${toBranch ? toBranch.name : transfer.toBranchId}`, transfer.id, 'STOCK_TRANSFER', transfer.fromBranchId, companyFilter, actorId, now]
          );
          mustRun(run, 
            'INSERT INTO stock_movements (id, productId, type, quantity, reason, referenceId, referenceType, branchId, companyId, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [uuid(), item.productId, 'TRANSFER_IN', item.quantity, `Transfer ${transfer.transferNumber} from ${fromBranch ? fromBranch.name : transfer.fromBranchId}`, transfer.id, 'STOCK_TRANSFER', transfer.toBranchId, companyFilter, actorId, now]
          );
        }
        mustRun(run, 'UPDATE stock_transfers SET status = ?, completedBy = ?, completedAt = ?, updatedAt = ? WHERE id = ?', ['COMPLETED', actorId, now, now, transfer.id]);
      } catch (e) {
        // Compensating rollback: the validation above makes a mid-move
        // failure unlikely, but a failed completion must never leave
        // half-moved stock behind.
        for (const a of applied.reverse()) {
          if (a.created) run('DELETE FROM batches WHERE id = ?', [a.batchId]);
          else run('UPDATE batches SET quantity = quantity - ? WHERE id = ?', [a.delta, a.batchId]);
        }
        run('DELETE FROM stock_movements WHERE referenceId = ?', [transfer.id]);
        saveDatabase();
        throw e;
      }
      saveDatabase();
      const updated = query('SELECT * FROM stock_transfers WHERE id = ?', [transfer.id])[0];
      enqueue('stockTransfer', 'update', updated);
      res.json({ success: true, data: shapeTransfer(updated), message: 'Transfer completed — stock moved to the destination branch' });
    } catch (e) {
      console.error('[Transfers] Complete error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post('/api/transfers/:id/cancel', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const transfer = query('SELECT * FROM stock_transfers WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!transfer) return res.status(404).json({ success: false, message: 'Transfer not found' });
      if (transfer.status !== 'PENDING') {
        return res.status(409).json({ success: false, message: `Only a PENDING transfer can be cancelled (current status: ${transfer.status})`, code: 'INVALID_TRANSFER_STATUS' });
      }
      const now = new Date().toISOString();
      run('UPDATE stock_transfers SET status = ?, cancelledBy = ?, cancelledAt = ?, updatedAt = ? WHERE id = ?', ['CANCELLED', req.user?.id || null, now, now, transfer.id]);
      saveDatabase();
      const updated = query('SELECT * FROM stock_transfers WHERE id = ?', [transfer.id])[0];
      enqueue('stockTransfer', 'update', updated);
      res.json({ success: true, data: shapeTransfer(updated), message: 'Transfer cancelled' });
    } catch (e) {
      console.error('[Transfers] Cancel error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });
}

module.exports = { registerTransferRoutes };
