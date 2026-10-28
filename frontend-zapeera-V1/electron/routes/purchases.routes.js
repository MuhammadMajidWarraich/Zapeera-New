/**
 * Purchases Routes
 * Extracted from routes/index.js
 */

const { mustRun } = require('../utils/db-write');

function registerPurchasesRoutes(app, authMiddleware, deps) {
  const { query, run, getDatabase, getActiveDatabase, insertIntoActiveDatabase, 
          queryActiveDatabase, updateInActiveDatabase, deleteInActiveDatabase,
          handleDataChange, getDataFilter, uuid, now, hashPassword, generateToken,
          verifyToken, getDeviceId, getDeviceInfo, REMOTE_DATABASE_URL, SYNC_CONFIG,
          connectPostgreSQL, checkPostgreSQLConnection, syncAllToPostgreSQL,
          pullAllFromPostgreSQL, processOfflineQueue, startPeriodicSync,
          markTableForPush, queueOfflineOperation, loadOfflineQueue, saveOfflineQueue,
          createRecordPostgreSQLFirst, mapRowForPostgreSQL, getPostgreSQLColumns,
          getSQLiteColumns, pgRowToSqlite, normalizeValue, getWeekNumber, getDateFromWeek,
          getDatabasePath, getDataDir, OFFLINE_ACCESS_HOURS, bcryptjs, getPgClient, getIsOnline, getSyncInProgress, getLastSyncTime, getOfflineQueue,
          saveDatabase, initDatabase } = deps;

// GET /api/purchases/reorder-suggestions — FIX 2026-10-28: the desktop
// Reorder Suggestions page had no embedded backing. Faithful port of the
// cloud C3 engine (purchase.controller.ts getReorderSuggestions): products
// with a reorderLevel set, live stock from non-expired batches, lines
// grouped by the latest batch's supplier, same response shape. Registered
// first so the literal segment wins over any /:id route.
//
// GATE 2026-10-28 (audit item e): OWNER/MANAGER/ADMIN only. The cloud's
// permission matrix gives CASHIER no purchases grant at all, so a cashier
// could never read reorder suggestions on the web — the desktop was
// over-permissive here.
      app.get('/api/purchases/reorder-suggestions', authMiddleware, (req, res) => {
        try {
          const role = String(req.user?.role || '').toUpperCase();
          if (!['OWNER', 'MANAGER', 'ADMIN'].includes(role)) {
            return res.status(403).json({ success: false, message: 'Only the owner or a manager can view reorder suggestions' });
          }
          const { branchFilter, companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);

          let productSql = 'SELECT id, name, sku, branchId, reorderLevel, reorderQuantity, unitsPerPack, unitsPerStrip FROM products WHERE isActive = 1 AND reorderLevel IS NOT NULL';
          const productParams = [];
          if (branchFilter) { productSql += ' AND branchId = ?'; productParams.push(branchFilter); }
          if (companyFilter) { productSql += ' AND companyId = ?'; productParams.push(companyFilter); }
          productSql += ' ORDER BY name ASC';
          const products = query(productSql, productParams);

          if (products.length === 0) {
            return res.json({
              success: true,
              data: { groups: [], totals: { products: 0, units: 0, estimatedCost: 0 }, participatingProducts: 0 }
            });
          }

          const productIds = products.map((p) => p.id);
          const placeholders = productIds.map(() => '?').join(',');
          let batchSql = `SELECT productId, quantity, purchasePrice, supplierId, expireDate, createdAt FROM batches WHERE isActive = 1 AND productId IN (${placeholders})`;
          const batchParams = [...productIds];
          if (companyFilter) { batchSql += ' AND companyId = ?'; batchParams.push(companyFilter); }
          batchSql += ' ORDER BY createdAt DESC';
          const batches = query(batchSql, batchParams);

          // Per product: live stock (non-expired batches only) + latest batch
          // (any status — it carries the most recent cost and supplier).
          const nowMs = Date.now();
          const stockByProduct = new Map();
          const latestBatchByProduct = new Map();
          for (const batch of batches) {
            if (!latestBatchByProduct.has(batch.productId)) {
              latestBatchByProduct.set(batch.productId, batch);
            }
            const expired = batch.expireDate && new Date(batch.expireDate).getTime() <= nowMs;
            if (!expired) {
              stockByProduct.set(batch.productId, (stockByProduct.get(batch.productId) || 0) + (batch.quantity || 0));
            }
          }

          const linesBySupplier = new Map();
          const supplierIds = new Set();
          for (const product of products) {
            const currentStock = stockByProduct.get(product.id) || 0;
            if (currentStock > product.reorderLevel) continue;

            const latest = latestBatchByProduct.get(product.id);
            const suggestedQty = product.reorderQuantity
              ? product.reorderQuantity
              : Math.max(1, product.reorderLevel * 2 - currentStock);

            const line = {
              productId: product.id,
              productName: product.name,
              sku: product.sku,
              branchId: product.branchId,
              currentStock,
              reorderLevel: product.reorderLevel,
              reorderQuantity: product.reorderQuantity,
              suggestedQty,
              lastCost: latest ? latest.purchasePrice : null,
              unitsPerPack: product.unitsPerPack || 1,
              unitsPerStrip: product.unitsPerStrip ?? null
            };

            const supplierKey = latest?.supplierId || '__unassigned__';
            if (latest?.supplierId) supplierIds.add(latest.supplierId);
            const group = linesBySupplier.get(supplierKey) || [];
            group.push(line);
            linesBySupplier.set(supplierKey, group);
          }

          const suppliers = supplierIds.size
            ? query(`SELECT id, name, contactPerson, phone FROM suppliers WHERE id IN (${[...supplierIds].map(() => '?').join(',')})`, [...supplierIds])
            : [];
          const supplierById = new Map(suppliers.map((s) => [s.id, s]));

          const groups = Array.from(linesBySupplier.entries()).map(([key, lines]) => {
            const estimatedCost = lines.reduce(
              (sum, l) => sum + (l.lastCost ? l.suggestedQty * l.lastCost : 0),
              0
            );
            return {
              supplier: key === '__unassigned__' ? null : supplierById.get(key) || null,
              lines,
              totalEstimatedCost: estimatedCost
            };
          });
          // Named suppliers first (alphabetical), unassigned group last.
          groups.sort((a, b) => {
            if (!a.supplier) return 1;
            if (!b.supplier) return -1;
            return a.supplier.name.localeCompare(b.supplier.name);
          });

          const totals = {
            products: groups.reduce((n, g) => n + g.lines.length, 0),
            units: groups.reduce((n, g) => n + g.lines.reduce((m, l) => m + l.suggestedQty, 0), 0),
            estimatedCost: groups.reduce((n, g) => n + g.totalEstimatedCost, 0)
          };

          return res.json({
            success: true,
            data: { groups, totals, participatingProducts: products.length }
          });
        } catch (e) {
          console.error('[Purchases/ReorderSuggestions] Error:', e.message);
          return res.status(500).json({ success: false, message: 'Internal server error' });
        }
      });

// GET /api/purchases (line 11072)
      app.get('/api/purchases', authMiddleware, (req, res) => {
        try {
          console.log('[Purchases] GET - User:', req.user?.email, 'Branch:', req.user?.branchId);
          const { status, supplierId, branchId, companyId, page = 1, limit = 50 } = req.query;
    
          // Get data filter based on user role
          const { branchFilter, companyFilter } = getDataFilter(req.user, branchId, companyId);
    
          let sql = 'SELECT * FROM purchases WHERE status != "DELETED"';
          const params = [];
    
          // Apply data isolation
          if (branchFilter) { sql += ' AND branchId = ?'; params.push(branchFilter); }
          if (companyFilter) { sql += ' AND companyId = ?'; params.push(companyFilter); }
          if (status && status !== 'all') { sql += ' AND status = ?'; params.push(status); }
          if (supplierId && supplierId !== 'all') { sql += ' AND supplierId = ?'; params.push(supplierId); }
          sql += ' ORDER BY createdAt DESC';
    
          const purchases = query(sql, params).map(p => {
            const supplier = p.supplierId ? query('SELECT id, name, contactPerson, phone, email FROM suppliers WHERE id = ?', [p.supplierId])[0] : null;
            const purchaseItems = query('SELECT * FROM purchase_items WHERE purchaseId = ?', [p.id]).map(item => {
              const product = query('SELECT id, name, sku, barcode FROM products WHERE id = ?', [item.productId])[0];
              return { ...item, product: product || { id: '', name: 'Unknown', sku: '' } };
            });
            return {
              ...p,
              invoiceNo: p.invoiceNo || p.purchaseNumber,
              purchaseDate: p.purchaseDate || p.createdAt,
              paidAmount: p.paidAmount || 0,
              outstanding: (p.grandTotal || 0) - (p.paidAmount || 0),
              supplier: supplier || { id: '', name: 'Unknown', contactPerson: '', phone: '' },
              purchaseItems,
              items: purchaseItems
            };
          });
    
          console.log('[Purchases] Found', purchases.length, 'purchases');
          res.json({ success: true, data: purchases, pagination: { total: purchases.length, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(purchases.length / parseInt(limit)) || 1 } });
        } catch (e) {
          console.error('[Purchases] GET error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // POST /api/purchases (line 11117)
      app.post('/api/purchases', authMiddleware, (req, res) => {
        try {
          console.log('[Purchases] POST request body:', req.body);
          const { supplierId, branchId, companyId, items = [], discount = 0, tax = 0, notes, status = 'PENDING', invoiceNo, paidAmount = 0, purchaseDate } = req.body;
    
          if (!items.length) {
            return res.status(400).json({ success: false, message: 'At least one item is required' });
          }
    
          const id = uuid();
          const purchaseNumber = `PO-${Date.now()}`;
          const timestamp = now();
    
          // Get context from headers (set by frontend) - match GET endpoint logic
          const selectedCompanyId = req.headers['x-company-id'] || req.user?.selectedCompanyId;
          const selectedBranchId = req.headers['x-branch-id'] || req.user?.selectedBranchId;
    
          // Use branchId from body, then selectedBranchId from headers, then user's assigned branchId
          // This ensures created items use the same branchId that will be used for filtering
          const finalBranchId = branchId || selectedBranchId || req.user?.branchId || null;
          const finalCompanyId = companyId || selectedCompanyId || req.user?.companyId || null;
    
          let totalAmount = 0;
          items.forEach(i => { totalAmount += (i.quantity || 1) * (i.unitPrice || i.costPrice || 0); });
          const grandTotal = totalAmount - (discount || 0) + (tax || 0);
          const paymentStatus = paidAmount >= grandTotal ? 'PAID' : (paidAmount > 0 ? 'PARTIAL' : 'PENDING');
    
          console.log('[Purchases] Creating purchase:', { id, purchaseNumber, totalAmount, grandTotal, paidAmount });
    
          // License shadow gate (2026-10-28): evaluate + log only in
          // shadow mode; the 402 branch is the enforcement wiring.
          const licenseWrite = require('../services/license/license-gate').checkWriteAllowed('purchase.create', { businessId: finalCompanyId || null });
          if (!licenseWrite.allowed) {
            return res.status(402).json({ success: false, code: 'LICENSE_REQUIRED', message: 'Your subscription has ended. Renew to create new purchases — your data stays readable and exportable.', licenseReason: licenseWrite.reason });
          }

          const success = run(`INSERT INTO purchases (id, purchaseNumber, invoiceNo, supplierId, branchId, companyId, totalAmount, paidAmount, discount, tax, grandTotal, paymentStatus, status, notes, purchaseDate, createdBy, createdAt, updatedAt)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [id, purchaseNumber, invoiceNo || null, supplierId || null, finalBranchId, finalCompanyId, totalAmount, paidAmount, discount || 0, tax || 0, grandTotal, paymentStatus, status, notes || null, purchaseDate || timestamp, req.user?.id, timestamp, timestamp]);
    
          if (!success) {
            console.error('[Purchases] Failed to insert purchase');
            return res.status(500).json({ success: false, message: 'Failed to create purchase' });
          }
    
          const createdItems = [];
          items.forEach(i => {
            const itemId = uuid();
            const unitPrice = i.unitPrice || i.costPrice || 0;
            const quantity = i.quantity || 1;
            const total = quantity * unitPrice;
            const batchNo = i.batchNo || `BT-${Date.now()}`;
            const expireDate = i.expireDate || null;
            const productionDate = i.productionDate || null;
    
            run('INSERT INTO purchase_items (id, purchaseId, productId, quantity, unitPrice, total, createdAt) VALUES (?,?,?,?,?,?,?)',
              [itemId, id, i.productId, quantity, unitPrice, total, timestamp]);
    
            // Create batch for this purchase item
            if (i.productId) {
              const batchId = uuid();
              run(`INSERT INTO batches (id, batchNo, productId, branchId, companyId, supplierId, supplierName, barcode, totalBoxes, unitsPerBox, quantity, purchasePrice, sellingPrice, stockPurchasePrice, paidAmount, supplierOutstanding, supplierInvoiceNo, purchasingMethod, expireDate, productionDate, shelfId, shelfName, isActive, isReported, createdBy, createdAt, updatedAt)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,?,?,?)`,
                [batchId, batchNo, i.productId, branchId || null, companyId || null, supplierId || null, null, null, 0, 1, quantity, unitPrice, unitPrice * 1.3, unitPrice, 0, 0, null, null, expireDate, productionDate, null, null, req.user?.id || null, timestamp, timestamp]);
              // R1/R7 (2026-10-26): link the purchase line to the batch it
              // stocked (the INSERT above leaves batchId NULL) and push
              // the batch row itself. Without the link the R7 ledger
              // cannot attribute the receipt to any batch, and without
              // the batch row the cloud never learns the batch exists —
              // so an R1 replay of a sale from this batch would draw
              // from the wrong batches or flag a false oversell.
              run('UPDATE purchase_items SET batchId = ? WHERE id = ?', [batchId, itemId]);
              const batchRow = query('SELECT * FROM batches WHERE id = ?', [batchId])[0];
              if (batchRow) handleDataChange('batches', 'create', batchRow);
            }
    
            // Update product stock
            run('UPDATE products SET quantity = quantity + ? WHERE id = ?', [quantity, i.productId]);
    
            const product = query('SELECT id, name, sku FROM products WHERE id = ?', [i.productId])[0];
            createdItems.push({ id: itemId, productId: i.productId, quantity, unitPrice, total, product, batchNo, expireDate, productionDate });
          });
    
          const purchase = query('SELECT * FROM purchases WHERE id = ?', [id])[0];
          const supplier = purchase?.supplierId ? query('SELECT * FROM suppliers WHERE id = ?', [purchase.supplierId])[0] : null;
    
          console.log('[Purchases] Created purchase successfully:', purchase?.id);
    
          // 🔄 TWO-WAY SYNC: Queue purchase and purchase_items for sync to PostgreSQL.
          // R1 prerequisite (2026-10-26): enqueue the STORED purchase_items
          // rows (SELECT * — purchaseId + batchId included), NOT the
          // response-shaped objects built above (no purchaseId, no batchId,
          // nested product). The response shape made every purchaseItem
          // push fail cloud validation (missing required purchaseId).
          if (purchase) handleDataChange('purchases', 'create', purchase);
          const storedPurchaseItems = query('SELECT * FROM purchase_items WHERE purchaseId = ?', [id]);
          storedPurchaseItems.forEach(item => handleDataChange('purchase_items', 'create', item));
    
          res.status(201).json({
            success: true,
            data: {
              ...purchase,
              purchaseItems: createdItems,
              supplier,
              outstanding: grandTotal - paidAmount
            },
            message: 'Purchase order created successfully'
          });
        } catch (e) {
          console.error('[Purchases] Create error:', e.message, e.stack);
          res.status(500).json({ success: false, message: 'Failed to create purchase: ' + e.message });
        }
      });

      // DELETE /api/purchases/:id — port of the cloud deletePurchase
      // (2026-10-28): tenancy-scoped, 404 when not found, deletes the
      // purchase items and the batches created for the purchase.
      //
      // Two deliberate deviations from the cloud, both protective:
      // (1) OWNER/MANAGER/ADMIN only — the cloud route carries no role
      // gate at all, so any business user could delete purchases and
      // their batches; a destructive write with no gate is a gap, not
      // a feature. (2) 409 PURCHASE_BATCH_IN_USE when any batch of the
      // purchase already has sale lines against it — the cloud deletes
      // the batch anyway, leaving dangling sale_items.batchId rows and
      // corrupting cost-based profit; the desktop refuses instead.
      app.delete('/api/purchases/:id', authMiddleware, (req, res) => {
        try {
          const role = String(req.user?.role || '').toUpperCase();
          if (!['OWNER', 'MANAGER', 'ADMIN'].includes(role)) {
            return res.status(403).json({ success: false, message: 'Only the owner or a manager can delete a purchase' });
          }
          const { branchFilter, companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
          let sql = 'SELECT * FROM purchases WHERE id = ?';
          const params = [req.params.id];
          if (branchFilter) { sql += ' AND branchId = ?'; params.push(branchFilter); }
          if (companyFilter) { sql += ' AND companyId = ?'; params.push(companyFilter); }
          const purchase = query(sql, params)[0];
          if (!purchase) return res.status(404).json({ success: false, message: 'Purchase not found' });
          const items = query('SELECT id, batchId FROM purchase_items WHERE purchaseId = ?', [req.params.id]);
          const batchIds = items.map(i => i.batchId).filter(Boolean);
          if (batchIds.length > 0) {
            const placeholders = batchIds.map(() => '?').join(',');
            const sold = query(`SELECT COUNT(*) as c FROM sale_items WHERE batchId IN (${placeholders})`, batchIds)[0]?.c || 0;
            if (Number(sold) > 0) {
              return res.status(409).json({ success: false, message: 'This purchase cannot be deleted — some of its batches have already been sold', code: 'PURCHASE_BATCH_IN_USE' });
            }
          }
          // Snapshot for compensating rollback (the embedded run() has
          // no transaction support — same convention as transfers and
          // stock-takes: restore what was deleted if a later step fails).
          // The restore INSERT is built from the row's own keys so it
          // stays correct if the schema grows.
          const snapshotItems = query('SELECT * FROM purchase_items WHERE purchaseId = ?', [req.params.id]);
          const snapshotBatches = batchIds.length > 0
            ? query(`SELECT * FROM batches WHERE id IN (${batchIds.map(() => '?').join(',')})`, batchIds)
            : [];
          const restoreRow = (table, row) => {
            const cols = Object.keys(row);
            const placeholders = cols.map(() => '?').join(',');
            try { run(`INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`, cols.map(c => row[c])); } catch (_) { /* best effort */ }
          };
          try {
            mustRun(run, 'DELETE FROM purchase_items WHERE purchaseId = ?', [req.params.id]);
            if (batchIds.length > 0) {
              mustRun(run, `DELETE FROM batches WHERE id IN (${batchIds.map(() => '?').join(',')})`, batchIds);
            }
            mustRun(run, 'DELETE FROM purchases WHERE id = ?', [req.params.id]);
            saveDatabase();
          } catch (e) {
            for (const b of snapshotBatches) restoreRow('batches', b);
            for (const it of snapshotItems) restoreRow('purchase_items', it);
            throw e;
          }
          try { handleDataChange('purchases', 'delete', { id: req.params.id }); } catch (e) { console.error('[Purchases] sync enqueue failed:', e.message); }
          res.json({ success: true, message: 'Purchase deleted successfully' });
        } catch (e) {
          console.error('[Purchases] Delete error:', e.message);
          res.status(500).json({ success: false, message: 'Internal server error' });
        }
      });

}

module.exports = {
  registerPurchasesRoutes
};
