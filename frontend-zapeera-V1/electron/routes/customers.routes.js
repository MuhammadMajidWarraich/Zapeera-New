/**
 * Customers Routes
 * Extracted from routes/index.js
 */

function registerCustomersRoutes(app, authMiddleware, deps) {
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

// GET /api/customers (line 3448)
      app.get('/api/customers', authMiddleware, (req, res) => {
        try {
          console.log('[Customers] GET - User:', req.user?.email, 'Role:', req.user?.role, 'Branch:', req.user?.branchId);
          const { branchId, companyId, search, vip, limit = 100 } = req.query;
    
          // Get data filter based on user role
          const { branchFilter, companyFilter } = getDataFilter(req.user, branchId, companyId);
    
          // Check if isActive column exists
          let hasIsActiveColumn = true;
          try {
            const tableInfo = query("PRAGMA table_info(customers)");
            hasIsActiveColumn = tableInfo.some(col => col.name === 'isActive');
          } catch (e) {
            hasIsActiveColumn = false;
          }
    
          let sql = hasIsActiveColumn ? 'SELECT * FROM customers WHERE (isActive = 1 OR isActive IS NULL)' : 'SELECT * FROM customers WHERE 1=1';
          const params = [];
    
          // Apply strict data isolation - only show items from selected branch/company
          const userRole = req.user?.role;
          if (userRole === 'SUPERADMIN') {
            // SUPERADMIN can see all, but can filter if requested
            if (branchFilter) { sql += ' AND branchId = ?'; params.push(branchFilter); }
            if (companyFilter) { sql += ' AND companyId = ?'; params.push(companyFilter); }
          } else {
            // ADMIN and other roles: strict filtering - only selected branch/company
            if (branchFilter || companyFilter) {
              if (branchFilter) { sql += ' AND branchId = ?'; params.push(branchFilter); }
              if (companyFilter) { sql += ' AND companyId = ?'; params.push(companyFilter); }
            }
          }
    
          if (search) { sql += ' AND (name LIKE ? OR email LIKE ? OR phone LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
          if (vip === 'true') { sql += ' AND loyaltyPoints >= 1000'; }
          sql += ' ORDER BY createdAt DESC';
          sql += ` LIMIT ${parseInt(limit) || 100}`;
    
          console.log('[Customers] SQL:', sql, 'Params:', params);
          const rawCustomers = query(sql, params);
          console.log('[Customers] Found customers:', rawCustomers.length);
    
          const customers = rawCustomers.map(c => {
            const salesCount = query('SELECT COUNT(*) as count, SUM(grandTotal) as total FROM sales WHERE customerId = ?', [c.id])[0];
            const branch = c.branchId ? query('SELECT id, name FROM branches WHERE id = ?', [c.branchId])[0] : null;
            const lastSale = query('SELECT createdAt FROM sales WHERE customerId = ? ORDER BY createdAt DESC LIMIT 1', [c.id])[0];
            return {
              ...c,
              totalPurchases: salesCount?.total || 0,
              totalSpent: salesCount?.total || 0,
              isVIP: (c.loyaltyPoints || 0) >= 1000,
              branch: branch || { id: '', name: 'Default' },
              lastPurchase: lastSale?.createdAt || null,
              _count: { sales: salesCount?.count || 0 }
            };
          });
          res.json({ success: true, data: { customers, pagination: { total: customers.length, page: 1, limit: parseInt(limit) || 100, pages: 1 } } });
        } catch (e) {
          console.error('[Customers] GET error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // GET /api/customers/:id (line 3513)
      app.get('/api/customers/:id', authMiddleware, async (req, res) => {
        try {
          const result = await queryActiveDatabase('customers', { id: req.params.id, isActive: true });
          if (!result || !result.success || !result.data || result.data.length === 0) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
          }
          res.json({ success: true, data: result.data[0], dbType: result.dbType });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // POST /api/customers (line 3524)
      app.post('/api/customers', authMiddleware, async (req, res) => {
        try {
          const { name, email, phone, address, branchId, companyId, loyaltyPoints = 0 } = req.body;
          if (!name) return res.status(400).json({ success: false, message: 'Name is required' });
    
          // Get context from headers (set by frontend) - match GET endpoint logic
          const selectedCompanyId = req.headers['x-company-id'] || req.user?.selectedCompanyId;
          const selectedBranchId = req.headers['x-branch-id'] || req.user?.selectedBranchId;
    
          // Use branchId from body, then selectedBranchId from headers, then user's assigned branchId
          // This ensures created items use the same branchId that will be used for filtering
          const finalBranchId = branchId || selectedBranchId || req.user?.branchId || null;
          const finalCompanyId = companyId || selectedCompanyId || req.user?.companyId || null;
          const id = uuid();
          const timestamp = now();
    
          // Check which database to use (PostgreSQL if available, SQLite otherwise)
          const dbType = await getActiveDatabase();
          console.log('[Customers] Using database:', dbType);
    
          // Prepare customer data
          const customerData = {
            id,
            name,
            phone: phone || null,
            email: email || null,
            address: address || null,
            branchId: finalBranchId,
            companyId: finalCompanyId,
            totalPurchases: 0,
            loyaltyPoints: loyaltyPoints || 0,
            isVIP: 0,
            lastVisit: null,
            isActive: true,
            createdBy: req.user?.id || null,
            createdAt: timestamp,
            updatedAt: timestamp
          };
    
          // CRITICAL FIX: For SQLite, ensure table has all required columns before inserting
          if (dbType === 'sqlite') {
            try {
              const tableInfo = query("PRAGMA table_info(customers)");
              const columnNames = tableInfo.map(col => col.name.toLowerCase());
    
              // Add missing columns if they don't exist
              const requiredColumns = [
                { name: 'isActive', sql: 'ALTER TABLE customers ADD COLUMN isActive INTEGER DEFAULT 1' },
                { name: 'isVIP', sql: 'ALTER TABLE customers ADD COLUMN isVIP INTEGER DEFAULT 0' },
                { name: 'totalPurchases', sql: 'ALTER TABLE customers ADD COLUMN totalPurchases REAL DEFAULT 0' },
                { name: 'lastVisit', sql: 'ALTER TABLE customers ADD COLUMN lastVisit TEXT' }
              ];
    
              requiredColumns.forEach(col => {
                if (!columnNames.includes(col.name.toLowerCase())) {
                  console.log(`[Customers] Adding ${col.name} column to SQLite...`);
                  try {
                    run(col.sql);
                    saveDatabase();
                    console.log(`[Customers] ✅ Added ${col.name} column`);
                  } catch (e) {
                    console.log(`[Customers] ⚠️ Could not add ${col.name} column:`, e.message);
                  }
                }
              });
            } catch (migrationError) {
              console.log('[Customers] Migration check:', migrationError.message);
            }
          }
    
          // Insert into active database (PostgreSQL if available, SQLite otherwise)
          const insertResult = await insertIntoActiveDatabase('customers', customerData);
    
          if (!insertResult || !insertResult.success) {
            const errorMsg = insertResult?.error || 'Unknown database error';
            console.error('[Customers] ❌ Insert failed:', errorMsg);
            return res.status(500).json({ success: false, message: 'Failed to create customer: ' + errorMsg });
          }
    
          const customer = insertResult.data;
          console.log('[Customers] ✅ Created successfully in', insertResult.dbType, ':', customer.id);
    
          // Get related data (sales count, branch) - query from same database
          let salesCount = { count: 0, total: 0 };
          let branch = null;
    
          if (insertResult.dbType === 'postgresql') {
            // Query from PostgreSQL
            const salesResult = await queryActiveDatabase('sales', { customerId: customer.id });
            if (salesResult && salesResult.success && salesResult.data) {
              salesCount.count = salesResult.data.length;
              salesCount.total = salesResult.data.reduce((sum, s) => sum + (parseFloat(s.grandTotal) || 0), 0);
            }
            if (customer.branchId) {
              const branchResult = await queryActiveDatabase('branches', { id: customer.branchId });
              if (branchResult && branchResult.success && branchResult.data && branchResult.data.length > 0) {
                branch = branchResult.data[0];
              }
            }
          } else {
            // Query from SQLite
            const salesData = query('SELECT COUNT(*) as count, SUM(grandTotal) as total FROM sales WHERE customerId = ?', [customer.id]);
            salesCount = salesData[0] || { count: 0, total: 0 };
            if (customer.branchId) {
              const branchData = query('SELECT id, name FROM branches WHERE id = ?', [customer.branchId]);
              branch = branchData[0] || null;
            }
          }
    
          const customerWithCount = {
            ...customer,
            totalPurchases: salesCount.count || 0,
            totalSpent: salesCount.total || 0,
            isVIP: (customer.loyaltyPoints || 0) >= 1000,
            branch: branch || { id: '', name: 'Default' },
            _count: { sales: salesCount.count || 0 }
          };
    
          // If using SQLite, queue for sync to PostgreSQL (background)
          if (insertResult.dbType === 'sqlite') {
            handleDataChange('customers', 'create', customer);
          }
    
          res.status(201).json({ success: true, data: customerWithCount, message: 'Customer created successfully', dbType: insertResult.dbType });
        } catch (e) {
          console.error('[Customers] Create error:', e);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // PUT /api/customers/:id (line 3655)
      app.put('/api/customers/:id', authMiddleware, async (req, res) => {
        try {
          const { name, email, phone, address, loyaltyPoints } = req.body;
    
          // Build update data (only include provided fields)
          const updateData = {
            updatedAt: now()
          };
          if (name !== undefined) updateData.name = name;
          if (email !== undefined) updateData.email = email;
          if (phone !== undefined) updateData.phone = phone;
          if (address !== undefined) updateData.address = address;
          if (loyaltyPoints !== undefined) updateData.loyaltyPoints = loyaltyPoints;
    
          // Update in active database (PostgreSQL if available, SQLite otherwise)
          const updateResult = await updateInActiveDatabase('customers', updateData, { id: req.params.id });
    
          if (!updateResult || !updateResult.success) {
            const errorMsg = updateResult?.error || 'Update failed';
            return res.status(500).json({ success: false, message: errorMsg });
          }
    
          const customer = updateResult.data;
          console.log('[Customers] ✅ Updated successfully in', updateResult.dbType, ':', customer.id);
    
          // If using SQLite, queue for sync to PostgreSQL (background)
          if (updateResult.dbType === 'sqlite' && customer) {
            handleDataChange('customers', 'update', customer);
          }
    
          res.json({ success: true, data: customer, message: 'Customer updated successfully', dbType: updateResult.dbType });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // DELETE /api/customers/:id (line 3690)
      app.delete('/api/customers/:id', authMiddleware, async (req, res) => {
        try {
          // Soft delete in active database (PostgreSQL if available, SQLite otherwise)
          const deleteResult = await deleteInActiveDatabase('customers', { id: req.params.id }, true);
    
          if (!deleteResult || !deleteResult.success) {
            const errorMsg = deleteResult?.error || 'Delete failed';
            return res.status(500).json({ success: false, message: errorMsg });
          }
    
          const customer = deleteResult.data;
          console.log('[Customers] ✅ Deleted successfully in', deleteResult.dbType, ':', req.params.id);
    
          // If using SQLite, queue for sync to PostgreSQL (background)
          if (deleteResult.dbType === 'sqlite' && customer) {
            handleDataChange('customers', 'update', customer);
          }
    
          res.json({ success: true, message: 'Customer deleted successfully', dbType: deleteResult.dbType });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // GET /api/customers/:id/purchase-history (line 3713)
      app.get('/api/customers/:id/purchase-history', authMiddleware, (req, res) => {
        try {
          const customer = query('SELECT * FROM customers WHERE id = ?', [req.params.id])[0];
          if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
    
          const sales = query('SELECT * FROM sales WHERE customerId = ? ORDER BY createdAt DESC LIMIT 50', [req.params.id]).map(s => {
            const items = query('SELECT * FROM sale_items WHERE saleId = ?', [s.id]).map(item => {
              const product = query('SELECT id, name, unitPrice FROM products WHERE id = ?', [item.productId])[0];
              return { ...item, totalPrice: item.total, product: product || { id: '', name: 'Unknown', unitType: 'PIECE' } };
            });
            const user = s.createdBy ? query('SELECT id, name, email as username FROM users WHERE id = ?', [s.createdBy])[0] : null;
            const branch = s.branchId ? query('SELECT name FROM branches WHERE id = ?', [s.branchId])[0] : null;
            return { ...s, items, user, branch, totalAmount: s.grandTotal };
          });
    
          const totalSpent = query('SELECT SUM(grandTotal) as total FROM sales WHERE customerId = ?', [req.params.id])[0]?.total || 0;
          const avgOrder = sales.length > 0 ? totalSpent / sales.length : 0;
    
          res.json({ success: true, data: {
            customer: { id: customer.id, name: customer.name, phone: customer.phone },
            sales,
            stats: { totalPurchases: sales.length, totalSpent, averageOrder: avgOrder },
            pagination: { total: sales.length, page: 1, limit: 50, pages: 1 }
          }});
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

}

module.exports = {
  registerCustomersRoutes
};
