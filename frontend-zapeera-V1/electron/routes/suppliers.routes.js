/**
 * Suppliers Routes
 * Extracted from routes/index.js
 */

function registerSuppliersRoutes(app, authMiddleware, deps) {
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

// GET /api/suppliers (line 3741)
      app.get('/api/suppliers', authMiddleware, async (req, res) => {
        try {
          // CRITICAL FIX: Ensure database is initialized before querying
          if (!getDatabase()) {
            console.log('[Suppliers] Database not initialized, initializing now...');
            try {
              await initDatabase();
            } catch (initError) {
              console.error('[Suppliers] Failed to initialize database:', initError.message);
              return res.status(500).json({
                success: false,
                message: 'Database not initialized. Please restart the application.'
              });
            }
          }
    
          // CRITICAL FIX: Ensure query function is available
          if (typeof query !== 'function') {
            console.error('[Suppliers] Query function not available');
            return res.status(500).json({
              success: false,
              message: 'Database query function not available. Please restart the application.'
            });
          }
    
          console.log('[Suppliers] === GET REQUEST ===');
          console.log('[Suppliers] User:', req.user?.email, 'Role:', req.user?.role, 'Branch:', req.user?.branchId);
          console.log('[Suppliers] Query params:', req.query);
          const { page = 1, limit = 50, search = '', active = true, manufacturerId = '' } = req.query;
    
          // Get context from headers (set by frontend) - match backend-zp
          const selectedCompanyId = req.headers['x-company-id'] || req.user?.selectedCompanyId;
          const selectedBranchId = req.headers['x-branch-id'] || req.user?.selectedBranchId;
    
          const skip = (Number(page) - 1) * Number(limit);
          const take = Number(limit);
    
          let sql = 'SELECT * FROM suppliers WHERE branchId IS NOT NULL'; // Exclude NULL branchId (legacy data)
          const params = [];
    
          // Strict branch-level data isolation - match backend-zp exactly
          // CRITICAL FIX: For ADMIN users, ALWAYS include suppliers they created (using OR condition)
          const userRole = req.user?.role;
          if (userRole === 'SUPERADMIN' || userRole === 'ADMIN') {
            // SUPERADMIN/ADMIN: Must select a branch to see data
            // CRITICAL FIX: For ADMIN, use strict AND condition - only show suppliers from selected branch/company
            if (userRole === 'ADMIN' && req.user?.id) {
              if (selectedBranchId) {
                sql += ' AND branchId = ?';
                params.push(selectedBranchId);
                console.log('[Suppliers] ADMIN: Using strict AND filter - branchId only');
              } else if (selectedCompanyId) {
                // Show suppliers from branches under the company
                try {
                const companyBranches = query('SELECT id FROM branches WHERE companyId = ?', [selectedCompanyId]);
                  if (companyBranches && companyBranches.length > 0) {
                    const branchIds = companyBranches.map(b => b.id).filter(id => id); // Filter out null/undefined
                    if (branchIds.length > 0) {
                  const branchPlaceholders = branchIds.map(() => '?').join(',');
                  sql += ` AND branchId IN (${branchPlaceholders})`;
                  params.push(...branchIds);
                      console.log('[Suppliers] ADMIN: Using strict AND filter - company branches only:', branchIds);
                    } else {
                      // No valid branch IDs - filter by companyId
                      sql += ' AND companyId = ?';
                      params.push(selectedCompanyId);
                      console.log('[Suppliers] ADMIN: Using strict AND filter - companyId only (no valid branches)');
                    }
                } else {
                  // No branches in company - filter by companyId
                  sql += ' AND companyId = ?';
                  params.push(selectedCompanyId);
                  console.log('[Suppliers] ADMIN: Using strict AND filter - companyId only (no branches)');
                  }
                } catch (branchQueryError) {
                  console.error('[Suppliers] Error querying company branches:', branchQueryError);
                  // Fallback to companyId filter
                  sql += ' AND companyId = ?';
                  params.push(selectedCompanyId);
                  console.log('[Suppliers] ADMIN: Fallback to companyId filter due to error');
                }
              } else {
                // No branch/company selected - use user's own company/branch
                const userCompanyId = req.user?.companyId;
                const userBranchId = req.user?.branchId;
                if (userBranchId) {
                  sql += ' AND branchId = ?';
                  params.push(userBranchId);
                  console.log('[Suppliers] ADMIN: Using strict AND filter - user branchId:', userBranchId);
                } else if (userCompanyId) {
                  // Get branches for user's company
                  const companyBranches = query('SELECT id FROM branches WHERE companyId = ?', [userCompanyId]);
                  if (companyBranches.length > 0) {
                    const branchIds = companyBranches.map(b => b.id);
                    const branchPlaceholders = branchIds.map(() => '?').join(',');
                    sql += ` AND branchId IN (${branchPlaceholders})`;
                    params.push(...branchIds);
                    console.log('[Suppliers] ADMIN: Using strict AND filter - user company branches:', branchIds);
                  } else {
                    sql += ' AND companyId = ?';
                    params.push(userCompanyId);
                    console.log('[Suppliers] ADMIN: Using strict AND filter - user companyId:', userCompanyId);
                  }
                } else {
                  // No branch/company - return empty (but don't cause error)
                  sql += ' AND 1=0';
                  console.log('[Suppliers] ADMIN: No branch/company - returning empty');
                }
              }
            } else {
              // SUPERADMIN: Use original logic
              if (selectedBranchId) {
                sql += ' AND branchId = ?';
                params.push(selectedBranchId);
              } else if (selectedCompanyId) {
                // Show suppliers from branches under the company
                const companyBranches = query('SELECT id FROM branches WHERE companyId = ?', [selectedCompanyId]);
                if (companyBranches.length > 0) {
                  const branchIds = companyBranches.map(b => b.id);
                  sql += ' AND branchId IN (' + branchIds.map(() => '?').join(',') + ')';
                  params.push(...branchIds);
                } else {
                  sql += ' AND branchId = ?';
                  params.push('must-select-branch');
                }
              } else {
                // No branch selected - show empty (force branch selection)
                sql += ' AND branchId = ?';
                params.push('must-select-branch');
              }
            }
          } else if (userRole === 'MANAGER' || userRole === 'CASHIER') {
            // MANAGER/CASHIER: Only see data from their assigned branch
            if (req.user?.branchId) {
              sql += ' AND branchId = ?';
              params.push(req.user.branchId);
            } else {
              sql += ' AND branchId = ?';
              params.push('non-existent-branch-id'); // No access
            }
          } else {
            // No access if no user context
            sql += ' AND branchId = ?';
            params.push('non-existent-branch-id');
          }
    
          // Apply active filter
          if (active === 'true' || active === true || active === '1') {
            sql += ' AND isActive = 1';
          }
    
          // Filter suppliers by manufacturer if manufacturerId is provided
          if (manufacturerId) {
            sql += ' AND manufacturerId = ?';
            params.push(manufacturerId);
          }
    
          // Search - match backend-zp (name, contactPerson, phone, email, address)
          if (search) {
            const searchTerm = `%${search}%`;
            sql += ' AND (name LIKE ? OR contactPerson LIKE ? OR phone LIKE ? OR email LIKE ? OR address LIKE ?)';
            params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
          }
    
          sql += ' ORDER BY name ASC';
    
          // Get total count for pagination - MUST be done BEFORE adding LIMIT/OFFSET
          // Build count query without LIMIT/OFFSET
          const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as count');
          // Create count params without LIMIT/OFFSET values
          const countParams = [...params]; // Copy params before adding LIMIT/OFFSET
          let total = 0;
          try {
            const totalResult = query(countSql, countParams);
            total = totalResult[0]?.count || 0;
            console.log('[Suppliers] Total count query result:', total);
          } catch (countError) {
            console.error('[Suppliers] Count query error:', countError);
            console.error('[Suppliers] Count SQL:', countSql);
            console.error('[Suppliers] Count params:', countParams);
            // Continue with total = 0 if count fails
            total = 0;
          }
    
          // Apply pagination
          sql += ' LIMIT ? OFFSET ?';
          params.push(take, skip);
    
          // Get branch/company filters for product count
          const { branchFilter, companyFilter } = getDataFilter(req.user, selectedBranchId, selectedCompanyId);
    
          let suppliers = [];
          try {
            console.log('[Suppliers] Executing query with SQL:', sql);
            console.log('[Suppliers] Query params:', params);
            const suppliersResult = query(sql, params);
            console.log('[Suppliers] Query returned', suppliersResult.length, 'suppliers');
            suppliers = suppliersResult.map(s => {
              // Build product count query - count ALL products for this supplier
              // If branch is selected, count products from that branch
              // If company is selected (no branch), count products from all branches of that company
              // If neither, count all products for this supplier (no filters)
              let productCountSql = 'SELECT COUNT(*) as c FROM products WHERE supplierId = ? AND isActive = 1';
              const productCountParams = [s.id];
    
              if (selectedBranchId && branchFilter) {
                // Specific branch selected - count products from that branch only
                productCountSql += ' AND branchId = ?';
                productCountParams.push(branchFilter);
                console.log(`[Suppliers] Counting products for supplier ${s.id} (${s.name}) in branch ${branchFilter}`);
              } else if (selectedCompanyId && companyFilter && !selectedBranchId) {
                // Company selected but no branch - count products from all branches of that company
                productCountSql += ' AND companyId = ?';
                productCountParams.push(companyFilter);
                console.log(`[Suppliers] Counting products for supplier ${s.id} (${s.name}) in company ${companyFilter}`);
              } else {
                // No branch/company filter - count ALL products for this supplier (across all branches/companies)
                console.log(`[Suppliers] Counting ALL products for supplier ${s.id} (${s.name}) - no branch/company filter`);
              }
    
              const productCount = query(productCountSql, productCountParams)[0]?.c || 0;
              console.log(`[Suppliers] Supplier ${s.id} (${s.name}) has ${productCount} products`);
    
              return {
            ...s,
            manufacturer: s.manufacturerId ? query('SELECT id, name, country FROM manufacturers WHERE id = ?', [s.manufacturerId])[0] : null,
            _count: {
                  products: productCount
                }
              };
            });
          } catch (queryError) {
            console.error('[Suppliers] Query execution error:', queryError);
            console.error('[Suppliers] SQL:', sql);
            console.error('[Suppliers] Params:', params);
            throw queryError; // Re-throw to be caught by outer try-catch
          }
    
          console.log('[Suppliers] SQLite suppliers found:', suppliers.length, 'Total:', total);
    
          // CRITICAL FIX: If SQLite query returned empty for ADMIN, try simpler query FIRST
          // This ensures newly created suppliers in SQLite are found even if branchId filter doesn't match
          if (userRole === 'ADMIN' && req.user?.id && suppliers.length === 0 && selectedBranchId) {
            console.log('[Suppliers] ⚠️ SQLite query returned empty for ADMIN, trying simpler query...');
    
            // Simple query: Get suppliers created by admin OR suppliers from selected branch (no isActive filter)
            const simpleSql = `SELECT * FROM suppliers WHERE branchId IS NOT NULL AND (createdBy = ? OR branchId = ?) ORDER BY name ASC LIMIT ? OFFSET ?`;
            const simpleSuppliers = query(simpleSql, [req.user.id, selectedBranchId, take, skip]);
    
            if (simpleSuppliers.length > 0) {
              console.log('[Suppliers] ✅ Simple query found', simpleSuppliers.length, 'suppliers');
              // Get branch/company filters for product count
              const { branchFilter: simpleBranchFilter, companyFilter: simpleCompanyFilter } = getDataFilter(req.user, selectedBranchId, selectedCompanyId);
    
              suppliers = simpleSuppliers.map(s => {
                // Build product count query - count ALL products for this supplier
                // If branch is selected, count products from that branch
                // If company is selected (no branch), count products from all branches of that company
                // If neither, count all products for this supplier (no filters)
                let productCountSql = 'SELECT COUNT(*) as c FROM products WHERE supplierId = ? AND isActive = 1';
                const productCountParams = [s.id];
    
                if (selectedBranchId && simpleBranchFilter) {
                  // Specific branch selected - count products from that branch only
                  productCountSql += ' AND branchId = ?';
                  productCountParams.push(simpleBranchFilter);
                  console.log(`[Suppliers] Counting products for simple supplier ${s.id} (${s.name}) in branch ${simpleBranchFilter}`);
                } else if (selectedCompanyId && simpleCompanyFilter && !selectedBranchId) {
                  // Company selected but no branch - count products from all branches of that company
                  productCountSql += ' AND companyId = ?';
                  productCountParams.push(simpleCompanyFilter);
                  console.log(`[Suppliers] Counting products for simple supplier ${s.id} (${s.name}) in company ${simpleCompanyFilter}`);
                } else {
                  // No branch/company filter - count ALL products for this supplier (across all branches/companies)
                  console.log(`[Suppliers] Counting ALL products for simple supplier ${s.id} (${s.name}) - no branch/company filter`);
                }
    
                return {
                ...s,
                manufacturer: s.manufacturerId ? query('SELECT id, name, country FROM manufacturers WHERE id = ?', [s.manufacturerId])[0] : null,
                _count: {
                    products: query(productCountSql, productCountParams)[0]?.c || 0
                }
                };
              });
    
              // Recalculate total for simple query
              const simpleTotalSql = `SELECT COUNT(*) as count FROM suppliers WHERE branchId IS NOT NULL AND (createdBy = ? OR branchId = ?)`;
              const simpleTotalResult = query(simpleTotalSql, [req.user.id, selectedBranchId]);
              total = simpleTotalResult[0]?.count || 0;
    
              console.log('[Suppliers] ✅ Using simple query results -', suppliers.length, 'suppliers visible, Total:', total);
            } else {
              console.log('[Suppliers] ⚠️ Simple query also returned empty');
            }
          }
    
          // CRITICAL FIX: ALWAYS check PostgreSQL for suppliers if available (similar to users/branches)
          // This ensures suppliers created in PostgreSQL are visible even if SQLite hasn't synced
          let pgSuppliers = [];
          if (REMOTE_DATABASE_URL) {
            try {
              console.log('[Suppliers] 🔄 Checking PostgreSQL for suppliers...');
              const pg = require('pg');
              const Client = pg.Client;
              const pgClient = new (require('pg').Client)({
                connectionString: REMOTE_DATABASE_URL,
                connectionTimeoutMillis: 5000
              });
    
              await Promise.race([
                pgClient.connect(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 5000))
              ]);
    
              // CRITICAL FIX: For ADMIN users, always show suppliers they created (by createdBy)
              let pgSql = 'SELECT id, name, "contactPerson", phone, email, address, "manufacturerId", "branchId", "companyId", "createdBy", "isActive", "createdAt", "updatedAt" FROM suppliers WHERE "branchId" IS NOT NULL';
              const pgParams = [];
              let paramIndex = 1;
    
              if (userRole === 'ADMIN' && req.user?.id && selectedBranchId) {
                // CRITICAL: For ADMIN, show suppliers from selected branch OR suppliers they created
                pgSql += ` AND ("branchId" = $${paramIndex++} OR "createdBy" = $${paramIndex++})`;
                pgParams.push(selectedBranchId, req.user.id);
                console.log('[Suppliers] PostgreSQL query: branchId OR createdBy filter');
              } else if (selectedBranchId) {
                pgSql += ` AND "branchId" = $${paramIndex++}`;
                pgParams.push(selectedBranchId);
              }
    
              // Apply active filter if needed
              if (active === 'true' || active === true || active === '1') {
                pgSql += ` AND "isActive" = true`;
              }
    
              // Apply search filter if needed
              if (search) {
                pgSql += ` AND (name ILIKE $${paramIndex++} OR "contactPerson" ILIKE $${paramIndex++} OR phone ILIKE $${paramIndex++} OR email ILIKE $${paramIndex++} OR address ILIKE $${paramIndex++})`;
                const searchTerm = `%${search}%`;
                pgParams.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
              }
    
              pgSql += ` ORDER BY name ASC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
              pgParams.push(take, skip);
    
              const pgResult = await Promise.race([
                pgClient.query(pgSql, pgParams),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Query timeout')), 10000))
              ]);
    
              await pgClient.end();
    
              if (pgResult.rows && pgResult.rows.length > 0) {
                console.log(`[Suppliers] ✅ Found ${pgResult.rows.length} suppliers in PostgreSQL`);
                pgSuppliers = pgResult.rows.map(s => ({
                  ...s,
                  manufacturer: null,
                  _count: { products: 0 }
                }));
    
                // Populate manufacturer and product count for PostgreSQL suppliers
                // Get branch/company filters for product count
                const { branchFilter: pgBranchFilter, companyFilter: pgCompanyFilter } = getDataFilter(req.user, selectedBranchId, selectedCompanyId);
    
                pgSuppliers.forEach(s => {
                  if (s.manufacturerId) {
                    const manufacturer = query('SELECT id, name, country FROM manufacturers WHERE id = ?', [s.manufacturerId])[0];
                    if (manufacturer) {
                      s.manufacturer = manufacturer;
                    }
                  }
                  // Build product count query with branch/company filters
                  let productCountSql = 'SELECT COUNT(*) as c FROM products WHERE supplierId = ? AND isActive = 1';
                  const productCountParams = [s.id];
    
                  if (pgBranchFilter) {
                    productCountSql += ' AND branchId = ?';
                    productCountParams.push(pgBranchFilter);
                  }
                  if (pgCompanyFilter) {
                    productCountSql += ' AND companyId = ?';
                    productCountParams.push(pgCompanyFilter);
                  }
    
                  const productCount = query(productCountSql, productCountParams)[0]?.c || 0;
                  s._count = { products: productCount };
                });
              } else {
                console.log('[Suppliers] ⚠️ No suppliers found in PostgreSQL');
              }
            } catch (pgError) {
              console.error('[Suppliers] PostgreSQL check failed:', pgError.message);
            }
          }
    
          // CRITICAL FIX: Merge PostgreSQL suppliers with SQLite suppliers
          if (pgSuppliers.length > 0) {
            if (suppliers.length === 0) {
              // CRITICAL: If SQLite is empty, use PostgreSQL suppliers directly
              console.log(`[Suppliers] ✅ SQLite empty - using ${pgSuppliers.length} suppliers from PostgreSQL`);
              suppliers = pgSuppliers;
              total = pgSuppliers.length;
            } else {
              // Merge: remove duplicates and combine
              const sqliteSupplierIds = new Set(suppliers.map(s => s.id));
              const uniquePgSuppliers = pgSuppliers.filter(pgSupplier => !sqliteSupplierIds.has(pgSupplier.id));
              if (uniquePgSuppliers.length > 0) {
                console.log(`[Suppliers] ✅ Merging ${uniquePgSuppliers.length} unique suppliers from PostgreSQL`);
                suppliers = [...uniquePgSuppliers, ...suppliers];
                total += uniquePgSuppliers.length;
              }
            }
          }
    
          console.log('[Suppliers] === FINAL RESULT ===');
          console.log('[Suppliers] Total suppliers being returned:', suppliers.length);
          console.log('[Suppliers] ');
    
          res.json({
            success: true,
            data: {
              suppliers,
              pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                pages: Math.ceil(total / Number(limit))
              }
            }
          });
        } catch (e) {
          console.error('[Suppliers] GET error:', e);
          console.error('[Suppliers] Error stack:', e.stack);
          res.status(500).json({
            success: false,
            message: e.message || 'Failed to load suppliers',
            error: process.env.NODE_ENV === 'development' ? e.stack : undefined
          });
        }
      });

  // GET /api/suppliers/:id (line 4183)
      app.get('/api/suppliers/:id', authMiddleware, (req, res) => {
        try {
          const { id } = req.params;
          let sql = 'SELECT * FROM suppliers WHERE id = ?';
          const params = [id];
    
          // Data isolation based on user role - match backend-zp
          const userRole = req.user?.role;
          if (userRole === 'SUPERADMIN') {
            // SUPERADMIN can see all suppliers
          } else if (userRole === 'ADMIN') {
            // For ADMIN users, use their own ID as createdBy (self-referencing)
            sql += ' AND createdBy = ?';
            params.push(req.user.id);
          } else if (req.user?.createdBy) {
            // Other users see suppliers from their admin
            sql += ' AND createdBy = ?';
            params.push(req.user.createdBy);
          } else if (req.user?.id) {
            // Fallback to user ID if no createdBy
            sql += ' AND createdBy = ?';
            params.push(req.user.id);
          } else {
            // No access if no user context
            sql += ' AND createdBy = ?';
            params.push('non-existent-admin-id');
          }
    
          const supplier = query(sql, params)[0];
          if (!supplier) {
            return res.status(404).json({ success: false, message: 'Supplier not found' });
          }
    
          // Add relations - match backend-zp
          supplier.manufacturer = supplier.manufacturerId ? query('SELECT id, name, country FROM manufacturers WHERE id = ?', [supplier.manufacturerId])[0] : null;
          supplier._count = {
            products: query('SELECT COUNT(*) as c FROM products WHERE supplierId = ? AND isActive = 1', [id])[0]?.c || 0
          };
    
          res.json({ success: true, data: supplier });
        } catch (e) {
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // POST /api/suppliers (line 4229)
      app.post('/api/suppliers', authMiddleware, (req, res) => {
        try {
          console.log('[Suppliers] POST request received');
          console.log('[Suppliers] Request body:', JSON.stringify(req.body, null, 2));
          console.log('[Suppliers] User:', { id: req.user?.id, email: req.user?.email, branchId: req.user?.branchId, companyId: req.user?.companyId });
    
          const { name, contactPerson, phone, email, address, manufacturerId, branchId, companyId } = req.body;
    
          if (!name || !name.trim()) {
            console.error('[Suppliers] ❌ Validation failed: Name is required');
            return res.status(400).json({ success: false, message: 'Name is required' });
          }
    
          if (!contactPerson || !contactPerson.trim()) {
            console.error('[Suppliers] ❌ Validation failed: Contact Person is required');
            return res.status(400).json({ success: false, message: 'Contact Person is required' });
          }
    
          if (!phone || !phone.trim()) {
            console.error('[Suppliers] ❌ Validation failed: Phone is required');
            return res.status(400).json({ success: false, message: 'Phone is required' });
          }
    
          // Get context from headers (set by frontend) - match GET endpoint logic
          const selectedCompanyId = req.headers['x-company-id'] || req.user?.selectedCompanyId;
          const selectedBranchId = req.headers['x-branch-id'] || req.user?.selectedBranchId;
    
          // Use branchId from body, then selectedBranchId from headers, then user's assigned branchId
          // This ensures created items use the same branchId that will be used for filtering
          const finalBranchId = branchId || selectedBranchId || req.user?.branchId || null;
          const finalCompanyId = companyId || selectedCompanyId || req.user?.companyId || null;
    
          console.log('[Suppliers] Final IDs:', { finalBranchId, finalCompanyId });
    
          // Check if supplier with this name already exists in this branch (match backend)
          if (finalBranchId) {
            const existingSupplier = query('SELECT id FROM suppliers WHERE name = ? AND branchId = ?', [name, finalBranchId]);
            if (existingSupplier && existingSupplier.length > 0) {
              return res.status(400).json({
                success: false,
                message: 'Supplier with this name already exists in this branch'
              });
            }
          }
    
          const id = uuid();
          const timestamp = now();
    
          // OFFLINE-FIRST: Always use SQLite, PostgreSQL sync happens in background
          console.log('[Suppliers] Using SQLite (offline-first mode)');
    
          // CRITICAL: Ensure SQLite table exists and has all required columns BEFORE insert
          try {
            // Check if table exists
            const tableExists = query("SELECT name FROM sqlite_master WHERE type='table' AND name='suppliers'");
            if (!tableExists || tableExists.length === 0) {
              console.error('[Suppliers] ❌ Table "suppliers" does not exist!');
              return res.status(500).json({ success: false, message: 'Database table not found. Please restart the application.' });
            }
    
            const tableInfo = query("PRAGMA table_info(suppliers)");
            const columnNames = tableInfo.map(col => col.name.toLowerCase());
            console.log('[Suppliers] SQLite table columns:', columnNames);
    
            // Required columns for suppliers table
            const requiredColumns = {
              'isactive': 'INTEGER DEFAULT 1',
              'manufacturerid': 'TEXT',
              'contactperson': 'TEXT',
              'createdby': 'TEXT',
              'email': 'TEXT',
              'address': 'TEXT'
            };
    
            // Add missing columns if they don't exist
            for (const [colName, colType] of Object.entries(requiredColumns)) {
              if (!columnNames.includes(colName)) {
                console.log(`[Suppliers] Adding missing column: ${colName}...`);
                try {
                  run(`ALTER TABLE suppliers ADD COLUMN ${colName} ${colType}`);
                  saveDatabase();
                  console.log(`[Suppliers] ✅ Added column: ${colName}`);
                } catch (alterError) {
                  console.log(`[Suppliers] Could not add column ${colName}:`, alterError.message);
                }
              }
            }
          } catch (migrationError) {
            console.log('[Suppliers] Migration check:', migrationError.message);
          }
    
          // Insert into SQLite - PRIMARY DATABASE
          console.log('[Suppliers] Inserting into SQLite:', { id, name, contactPerson, phone, manufacturerId: manufacturerId || null, finalBranchId, finalCompanyId });
          console.log('[Suppliers] User context:', { userId: req.user?.id, userBranchId: req.user?.branchId, userCompanyId: req.user?.companyId });
    
          try {
            // Handle email and address - trim and convert empty strings to null (match backend)
            const cleanEmail = (email && typeof email === 'string' && email.trim() !== '') ? email.trim() : null;
            const cleanAddress = (address && typeof address === 'string' && address.trim() !== '') ? address.trim() : null;
            const insertSuccess = run(`INSERT INTO suppliers (id, name, contactPerson, phone, email, address, manufacturerId, branchId, companyId, createdBy, isActive, createdAt, updatedAt)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
              [id, name, contactPerson, phone, cleanEmail, cleanAddress, manufacturerId || null, finalBranchId, finalCompanyId, req.user?.id || null, timestamp, timestamp]);
    
            if (!insertSuccess) {
              const errorMsg = lastDbError || 'Unknown database error';
              console.error('[Suppliers] ❌ SQLite insert failed:', errorMsg);
              console.error('[Suppliers] Insert params:', [id, name, contactPerson, phone, manufacturerId || null, finalBranchId, finalCompanyId, req.user?.id || null, timestamp, timestamp]);
              return res.status(500).json({ success: false, message: 'Failed to create supplier: ' + errorMsg });
            }
          } catch (insertError) {
            console.error('[Suppliers] ❌ Exception during insert:', insertError);
            console.error('[Suppliers] Error details:', {
              message: insertError.message,
              stack: insertError.stack,
              lastDbError: lastDbError
            });
            return res.status(500).json({ success: false, message: 'Failed to create supplier: ' + (insertError.message || lastDbError || 'Database error') });
          }
    
          // Query the created supplier
          let supplier = query('SELECT * FROM suppliers WHERE id = ?', [id])[0];
    
          if (!supplier) {
            console.error('[Suppliers] Supplier not found after insert, trying by name...');
            // Fallback: try to find by name
            const byName = query('SELECT * FROM suppliers WHERE name = ? ORDER BY createdAt DESC LIMIT 1', [name]);
            if (byName.length > 0) {
              supplier = byName[0];
              console.log('[Suppliers] Found supplier by name');
            } else {
              return res.status(500).json({ success: false, message: 'Supplier created but could not be retrieved' });
            }
          }
    
          console.log('[Suppliers] ✅ Created successfully in SQLite:', supplier.id);
    
          // Get related data from SQLite
          const manufacturer = supplier.manufacturerId ? query('SELECT id, name FROM manufacturers WHERE id = ?', [supplier.manufacturerId])[0] : null;
          // Build product count query with branch/company filters
          const { branchFilter: createBranchFilter, companyFilter: createCompanyFilter } = getDataFilter(req.user, finalBranchId, finalCompanyId);
          let productCountSql = 'SELECT COUNT(*) as c FROM products WHERE supplierId = ? AND isActive = 1';
          const productCountParams = [supplier.id];
    
          if (createBranchFilter) {
            productCountSql += ' AND branchId = ?';
            productCountParams.push(createBranchFilter);
          }
          if (createCompanyFilter) {
            productCountSql += ' AND companyId = ?';
            productCountParams.push(createCompanyFilter);
          }
    
          const productCount = query(productCountSql, productCountParams)[0]?.c || 0;
    
          const supplierWithCount = {
            ...supplier,
            manufacturer: manufacturer,
            _count: { products: productCount }
          };
    
          // Queue for sync to PostgreSQL (background)
          handleDataChange('suppliers', 'create', supplier);
    
          res.status(201).json({ success: true, data: supplierWithCount, message: 'Supplier created successfully' });
        } catch (e) {
          console.error('[Suppliers] Create error:', e);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // PUT /api/suppliers/:id (line 4400)
      app.put('/api/suppliers/:id', authMiddleware, (req, res) => {
        try {
          const { id } = req.params;
          const updateData = req.body;
    
          // Check if supplier exists with data isolation (match backend)
          let whereSql = 'SELECT * FROM suppliers WHERE id = ?';
          const whereParams = [id];
    
          const userRole = req.user?.role;
          if (userRole === 'SUPERADMIN') {
            // SUPERADMIN can see all
          } else if (userRole === 'ADMIN') {
            whereSql += ' AND createdBy = ?';
            whereParams.push(req.user.id);
          } else if (req.user?.createdBy) {
            whereSql += ' AND createdBy = ?';
            whereParams.push(req.user.createdBy);
          } else if (req.user?.id) {
            whereSql += ' AND createdBy = ?';
            whereParams.push(req.user.id);
          } else {
            whereSql += ' AND createdBy = ?';
            whereParams.push('non-existent-admin-id');
          }
    
          const existingSupplier = query(whereSql, whereParams)[0];
          if (!existingSupplier) {
            return res.status(404).json({ success: false, message: 'Supplier not found' });
          }
    
          // Build update fields - match backend structure
          const updateFields = [];
          const updateValues = [];
    
          if (updateData.name !== undefined) { updateFields.push('name = ?'); updateValues.push(updateData.name); }
          if (updateData.phone !== undefined) { updateFields.push('phone = ?'); updateValues.push(updateData.phone); }
          if (updateData.contactPerson !== undefined) { updateFields.push('contactPerson = ?'); updateValues.push(updateData.contactPerson); }
    
          if (updateData.email !== undefined) {
            // Handle email - trim and convert empty strings to null (match backend)
            const cleanEmail = (updateData.email && typeof updateData.email === 'string' && updateData.email.trim() !== '') 
              ? updateData.email.trim() 
              : null;
            updateFields.push('email = ?');
            updateValues.push(cleanEmail);
          }
          if (updateData.address !== undefined) {
            // Handle address - trim and convert empty strings to null (match backend)
            const cleanAddress = (updateData.address && typeof updateData.address === 'string' && updateData.address.trim() !== '') 
              ? updateData.address.trim() 
              : null;
            updateFields.push('address = ?');
            updateValues.push(cleanAddress);
          }
          if (updateData.manufacturerId !== undefined) {
    
            // Handle empty manufacturerId (match backend)
            const cleanManufacturerId = (updateData.manufacturerId && updateData.manufacturerId.trim() !== '')
              ? updateData.manufacturerId
              : null;
            updateFields.push('manufacturerId = ?');
            updateValues.push(cleanManufacturerId);
          }
          if (updateData.isActive !== undefined) { updateFields.push('isActive = ?'); updateValues.push(updateData.isActive ? 1 : 0); }
    
          if (updateFields.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update' });
          }
    
          updateFields.push('updatedAt = ?');
          updateValues.push(now());
          updateValues.push(id);
    
          run(`UPDATE suppliers SET ${updateFields.join(', ')} WHERE id = ?`, updateValues);
          saveDatabase();
    
          // Get updated supplier with related data (match backend)
          const supplier = query('SELECT * FROM suppliers WHERE id = ?', [id])[0];
          if (!supplier) {
            return res.status(404).json({ success: false, message: 'Supplier not found after update' });
          }
    
          // Include related data (match backend)
          const manufacturer = supplier.manufacturerId ? query('SELECT id, name FROM manufacturers WHERE id = ?', [supplier.manufacturerId])[0] : null;
          // Build product count query with branch/company filters
          const filterResult = getDataFilter(req.user, existingSupplier.branchId, existingSupplier.companyId);
          const updateBranchFilter = filterResult.branchFilter;
          const updateCompanyFilter = filterResult.companyFilter;
          let productCountSql = 'SELECT COUNT(*) as c FROM products WHERE supplierId = ? AND isActive = 1';
          const productCountParams = [supplier.id];
    
          if (updateBranchFilter) {
            productCountSql += ' AND branchId = ?';
            productCountParams.push(updateBranchFilter);
          }
          if (updateCompanyFilter) {
            productCountSql += ' AND companyId = ?';
            productCountParams.push(updateCompanyFilter);
          }
    
          const productCount = query(productCountSql, productCountParams)[0]?.c || 0;
    
          const supplierWithRelations = {
            ...supplier,
            manufacturer: manufacturer || null,
            _count: { products: productCount }
          };
    
          // 🔄 TWO-WAY SYNC: Queue for sync to PostgreSQL
          if (supplierWithRelations) handleDataChange('suppliers', 'update', supplierWithRelations);
    
          res.json({ success: true, data: supplierWithRelations, message: 'Supplier updated successfully' });
        } catch (e) {
          console.error('[Suppliers] Update error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // DELETE /api/suppliers/:id (line 4521)
      app.delete('/api/suppliers/:id', authMiddleware, (req, res) => {
        try {
          const { id } = req.params;
    
          // Check if supplier exists with data isolation (match backend)
          let whereSql = 'SELECT * FROM suppliers WHERE id = ?';
          const whereParams = [id];
    
          const userRole = req.user?.role;
          if (userRole === 'SUPERADMIN') {
            // SUPERADMIN can see all
          } else if (userRole === 'ADMIN') {
            whereSql += ' AND createdBy = ?';
            whereParams.push(req.user.id);
          } else if (req.user?.createdBy) {
            whereSql += ' AND createdBy = ?';
            whereParams.push(req.user.createdBy);
          } else if (req.user?.id) {
            whereSql += ' AND createdBy = ?';
            whereParams.push(req.user.id);
          } else {
            whereSql += ' AND createdBy = ?';
            whereParams.push('non-existent-admin-id');
          }
    
          const supplier = query(whereSql, whereParams)[0];
          if (!supplier) {
            return res.status(404).json({
              success: false,
              message: 'Supplier not found'
            });
          }
    
          // Check if supplier has products (match backend)
          // Build product count query with branch/company filters
          const { branchFilter: deleteBranchFilter, companyFilter: deleteCompanyFilter } = getDataFilter(req.user, existingSupplier.branchId, existingSupplier.companyId);
          let productCountSql = 'SELECT COUNT(*) as c FROM products WHERE supplierId = ? AND isActive = 1';
          const productCountParams = [id];
    
          if (deleteBranchFilter) {
            productCountSql += ' AND branchId = ?';
            productCountParams.push(deleteBranchFilter);
          }
          if (deleteCompanyFilter) {
            productCountSql += ' AND companyId = ?';
            productCountParams.push(deleteCompanyFilter);
          }
    
          const productCount = query(productCountSql, productCountParams)[0]?.c || 0;
          if (productCount > 0) {
            return res.status(400).json({
              success: false,
              message: 'Cannot delete supplier with existing products'
            });
          }
    
          // Hard delete (match backend)
          run('DELETE FROM suppliers WHERE id = ?', [id]);
          saveDatabase();
    
          // 🔄 TWO-WAY SYNC: Queue delete for sync
          handleDataChange('suppliers', 'delete', { id });
    
          res.json({ success: true, message: 'Supplier deleted successfully' });
        } catch (e) {
          console.error('[Suppliers] Delete error:', e);
          res.status(500).json({ success: false, message: e.message });
        }
      });

}

module.exports = {
  registerSuppliersRoutes
};
