/**
 * Purchases Routes
 * Extracted from routes/index.js
 */

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
            }
    
            // Update product stock
            run('UPDATE products SET quantity = quantity + ? WHERE id = ?', [quantity, i.productId]);
    
            const product = query('SELECT id, name, sku FROM products WHERE id = ?', [i.productId])[0];
            createdItems.push({ id: itemId, productId: i.productId, quantity, unitPrice, total, product, batchNo, expireDate, productionDate });
          });
    
          const purchase = query('SELECT * FROM purchases WHERE id = ?', [id])[0];
          const supplier = purchase?.supplierId ? query('SELECT * FROM suppliers WHERE id = ?', [purchase.supplierId])[0] : null;
    
          console.log('[Purchases] Created purchase successfully:', purchase?.id);
    
          // 🔄 TWO-WAY SYNC: Queue purchase and purchase_items for sync to PostgreSQL
          if (purchase) handleDataChange('purchases', 'create', purchase);
          createdItems.forEach(item => handleDataChange('purchase_items', 'create', item));
    
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

}

module.exports = {
  registerPurchasesRoutes
};
