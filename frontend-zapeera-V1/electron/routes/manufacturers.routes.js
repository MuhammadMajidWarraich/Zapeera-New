/**
 * Manufacturers Routes
 * Extracted from routes/index.js
 */

function registerManufacturersRoutes(app, authMiddleware, deps) {
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

// GET /api/manufacturers (line 4592)
      app.get('/api/manufacturers', authMiddleware, (req, res) => {
        try {
          console.log('[Manufacturers] GET - User:', req.user?.email, 'Role:', req.user?.role, 'Branch:', req.user?.branchId);
          const { page = 1, limit = 50, search = '', active = true } = req.query;
    
          // Get context from headers (set by frontend) - match backend-zp
          const selectedCompanyId = req.headers['x-company-id'] || req.user?.selectedCompanyId;
          const selectedBranchId = req.headers['x-branch-id'] || req.user?.selectedBranchId;
    
          const skip = (Number(page) - 1) * Number(limit);
          const take = Number(limit);
    
          let sql = 'SELECT * FROM manufacturers WHERE 1=1';
          const params = [];
    
          // Strict branch-level data isolation - match backend-zp exactly
          const userRole = req.user?.role;
          if (userRole === 'SUPERADMIN' || userRole === 'ADMIN') {
            // SUPERADMIN/ADMIN: Must select a branch to see data
            if (selectedBranchId) {
              sql += ' AND branchId = ?';
              params.push(selectedBranchId);
            } else if (selectedCompanyId) {
              // Show all branches under the company
              sql += ' AND companyId = ?';
              params.push(selectedCompanyId);
            } else {
              // No branch selected - show empty (force branch selection)
              sql += ' AND branchId = ?';
              params.push('must-select-branch');
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
    
          // Search - match backend-zp (name, description, country)
          if (search) {
            sql += ' AND (name LIKE ? OR description LIKE ? OR country LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm);
          }
    
          sql += ' ORDER BY name ASC';
    
          // Get total count for pagination
          const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as count');
          const totalResult = query(countSql, params);
          const total = totalResult[0]?.count || 0;
    
          // Apply pagination
          sql += ' LIMIT ? OFFSET ?';
          params.push(take, skip);
    
          const manufacturers = query(sql, params).map(m => ({
            ...m,
            _count: {
              suppliers: query('SELECT COUNT(*) as c FROM suppliers WHERE manufacturerId = ? AND isActive = 1', [m.id])[0]?.c || 0
            }
          }));
    
          console.log('[Manufacturers] Found:', manufacturers.length, 'Total:', total);
          res.json({
            success: true,
            data: {
              manufacturers,
              pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                pages: Math.ceil(total / Number(limit))
              }
            }
          });
        } catch (e) {
          console.error('[Manufacturers] Error:', e);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // GET /api/manufacturers/:id (line 4688)
      app.get('/api/manufacturers/:id', authMiddleware, (req, res) => {
        try {
          const { id } = req.params;
          let sql = 'SELECT * FROM manufacturers WHERE id = ?';
          const params = [id];
    
          // Data isolation based on user role - match backend-zp
          const userRole = req.user?.role;
          if (userRole === 'SUPERADMIN') {
            // SUPERADMIN can see all manufacturers
          } else if (userRole === 'ADMIN') {
            // For ADMIN users, use their own ID as createdBy (self-referencing)
            sql += ' AND createdBy = ?';
            params.push(req.user.id);
          } else if (req.user?.createdBy) {
            // Other users see manufacturers from their admin
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
    
          const manufacturer = query(sql, params)[0];
          if (!manufacturer) {
            return res.status(404).json({ success: false, message: 'Manufacturer not found' });
          }
    
          // Add relations - match backend-zp
          manufacturer._count = {
            suppliers: query('SELECT COUNT(*) as c FROM suppliers WHERE manufacturerId = ? AND isActive = 1', [id])[0]?.c || 0
          };
          manufacturer.suppliers = query('SELECT id, name, contactPerson, phone, isActive FROM suppliers WHERE manufacturerId = ? AND isActive = 1', [id]);
    
          res.json({ success: true, data: manufacturer });
        } catch (e) {
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // POST /api/manufacturers (line 4734)
      app.post('/api/manufacturers', authMiddleware, async (req, res) => {
        try {
          const { name, description, website, country, branchId, companyId } = req.body;
          if (!name) return res.status(400).json({ success: false, message: 'Name is required' });
    
          // Get context from headers (set by frontend) - match backend controller
          const selectedCompanyId = req.headers['x-company-id'] || req.user?.selectedCompanyId;
          const selectedBranchId = req.headers['x-branch-id'] || req.user?.selectedBranchId;
    
          // Determine branchId and companyId - match backend controller exactly
          let finalBranchId = selectedBranchId || req.user?.branchId || branchId || null;
          let finalCompanyId = selectedCompanyId || req.user?.companyId || companyId || null;
    
          // If branchId is provided but no companyId, get companyId from branch (match backend)
          if (finalBranchId && !finalCompanyId) {
            const branch = query('SELECT companyId FROM branches WHERE id = ?', [finalBranchId])[0];
            if (branch) {
              finalCompanyId = branch.companyId;
            }
          }
    
          if (!finalBranchId) {
            return res.status(400).json({
              success: false,
              message: 'Branch is required. Please select a branch first.'
            });
          }
    
          // Check if manufacturer with this name already exists in this branch (match backend)
          const existingManufacturer = query('SELECT id FROM manufacturers WHERE name = ? AND branchId = ?', [name, finalBranchId]);
          if (existingManufacturer && existingManufacturer.length > 0) {
            return res.status(400).json({
              success: false,
              message: 'Manufacturer with this name already exists in this branch'
            });
          }
    
          console.log('[Manufacturers] Creating manufacturer:', { name, finalBranchId, finalCompanyId });
    
          const id = uuid();
          const timestamp = now();
    
          // OFFLINE-FIRST: Always use SQLite, PostgreSQL sync happens in background
          // Skip PostgreSQL entirely - SQLite is the primary database for CRUD
          console.log('[Manufacturers] Using SQLite (offline-first mode)');
    
          // CRITICAL: Ensure SQLite table has all required columns BEFORE insert
          try {
            const tableInfo = query("PRAGMA table_info(manufacturers)");
            const columnNames = tableInfo.map(col => col.name.toLowerCase());
            console.log('[Manufacturers] SQLite table columns:', columnNames);
    
            // Add missing columns if they don't exist
            if (!columnNames.includes('isactive')) {
              console.log('[Manufacturers] Adding isActive column...');
              run('ALTER TABLE manufacturers ADD COLUMN isActive INTEGER DEFAULT 1');
              saveDatabase();
            }
          } catch (migrationError) {
            console.log('[Manufacturers] Migration check:', migrationError.message);
          }
    
          // Insert into SQLite - PRIMARY DATABASE
          console.log('[Manufacturers] Inserting into SQLite:', { id, name, description, website: req.body.website, country: req.body.country, finalBranchId, finalCompanyId });
    
          // Clean description, website, country - match backend (trim and null if empty)
          const cleanDescription = description && description.trim() !== '' ? description.trim() : null;
          const cleanWebsite = website && website.trim() !== '' ? website.trim() : null;
          const cleanCountry = country && country.trim() !== '' ? country.trim() : null;
    
          const insertSuccess = run(`INSERT INTO manufacturers (id, name, description, website, country, branchId, companyId, createdBy, isActive, createdAt, updatedAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
            [id, name, cleanDescription, cleanWebsite, cleanCountry, finalBranchId, finalCompanyId, req.user?.createdBy || req.user?.id || 'default-admin-id', timestamp, timestamp]);
    
          if (!insertSuccess) {
            const errorMsg = lastDbError || 'Unknown database error';
            console.error('[Manufacturers] ❌ SQLite insert failed:', errorMsg);
            console.error('[Manufacturers] SQL:', `INSERT INTO manufacturers (id, name, description, email, phone, address, branchId, companyId, createdBy, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`);
            console.error('[Manufacturers] Params:', [id, name, description || null, email || null, phone || null, address || null, finalBranchId, finalCompanyId, req.user?.id || null, timestamp, timestamp]);
            return res.status(500).json({ success: false, message: 'Failed to create manufacturer: ' + errorMsg });
          }
    
          // Query the created manufacturer
          let manufacturer = query('SELECT * FROM manufacturers WHERE id = ?', [id])[0];
    
          if (!manufacturer) {
            console.error('[Manufacturers] Manufacturer not found after insert, trying by name...');
            // Fallback: try to find by name
            const byName = query('SELECT * FROM manufacturers WHERE name = ? ORDER BY createdAt DESC LIMIT 1', [name]);
            if (byName.length > 0) {
              manufacturer = byName[0];
              console.log('[Manufacturers] Found manufacturer by name');
            } else {
              return res.status(500).json({ success: false, message: 'Manufacturer created but could not be retrieved' });
            }
          }
    
          console.log('[Manufacturers] ✅ Created successfully in SQLite:', manufacturer.id);
          const usedDatabase = 'sqlite';
    
          // Get related data from SQLite
          let supplierCount = 0;
          let suppliers = [];
    
          supplierCount = query('SELECT COUNT(*) as c FROM suppliers WHERE manufacturerId = ?', [manufacturer.id])[0]?.c || 0;
          suppliers = query('SELECT id, name FROM suppliers WHERE manufacturerId = ? AND isActive = 1', [manufacturer.id]);
    
          const manufacturerWithCount = {
            ...manufacturer,
            _count: { suppliers: supplierCount },
            suppliers: suppliers
          };
    
          console.log('[Manufacturers] Created manufacturer:', manufacturerWithCount, 'Database:', usedDatabase);
    
          // Queue for sync to PostgreSQL (background)
          handleDataChange('manufacturers', 'create', manufacturer);
    
          res.status(201).json({ success: true, data: manufacturerWithCount, message: 'Manufacturer created successfully' });
        } catch (e) {
          console.error('[Manufacturers] Create error:', e);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // PUT /api/manufacturers/:id (line 4860)
      app.put('/api/manufacturers/:id', authMiddleware, (req, res) => {
        try {
          const { id } = req.params;
          const updateData = req.body;
    
          // Check if manufacturer exists with data isolation (match backend)
          let whereSql = 'SELECT * FROM manufacturers WHERE id = ?';
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
    
          const existingManufacturer = query(whereSql, whereParams)[0];
          if (!existingManufacturer) {
            return res.status(404).json({
              success: false,
              message: 'Manufacturer not found'
            });
          }
    
          // Check if name already exists for this admin (if being updated) - match backend
          if (updateData.name && updateData.name !== existingManufacturer.name) {
            const nameExists = query('SELECT id FROM manufacturers WHERE name = ? AND branchId = ? AND id != ?',
              [updateData.name, existingManufacturer.branchId, id]);
            if (nameExists && nameExists.length > 0) {
              return res.status(400).json({
                success: false,
                message: 'Manufacturer with this name already exists in this branch'
              });
            }
          }
    
          // Build update fields - match backend structure
          const updateFields = [];
          const updateValues = [];
    
          if (updateData.name !== undefined) {
            updateFields.push('name = ?');
            updateValues.push(updateData.name);
          }
          if (updateData.description !== undefined) {
            const cleanDescription = updateData.description && updateData.description.trim() !== '' ? updateData.description.trim() : null;
            updateFields.push('description = ?');
            updateValues.push(cleanDescription);
          }
          if (updateData.website !== undefined) {
            const cleanWebsite = updateData.website && updateData.website.trim() !== '' ? updateData.website.trim() : null;
            updateFields.push('website = ?');
            updateValues.push(cleanWebsite);
          }
          if (updateData.country !== undefined) {
            const cleanCountry = updateData.country && updateData.country.trim() !== '' ? updateData.country.trim() : null;
            updateFields.push('country = ?');
            updateValues.push(cleanCountry);
          }
          if (updateData.isActive !== undefined) {
            updateFields.push('isActive = ?');
            updateValues.push(updateData.isActive ? 1 : 0);
          }
    
          if (updateFields.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update' });
          }
    
          updateFields.push('updatedAt = ?');
          updateValues.push(now());
          updateValues.push(id);
    
          run(`UPDATE manufacturers SET ${updateFields.join(', ')} WHERE id = ?`, updateValues);
          saveDatabase();
    
          const manufacturer = query('SELECT * FROM manufacturers WHERE id = ?', [id])[0];
    
          // 🔄 TWO-WAY SYNC: Queue for sync to PostgreSQL
          if (manufacturer) handleDataChange('manufacturers', 'update', manufacturer);
    
          res.json({ success: true, data: manufacturer, message: 'Manufacturer updated successfully' });
        } catch (e) {
          console.error('[Manufacturers] Update error:', e);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // DELETE /api/manufacturers/:id (line 4958)
      app.delete('/api/manufacturers/:id', authMiddleware, (req, res) => {
        try {
          const { id } = req.params;
    
          // Check if manufacturer exists with data isolation (match backend)
          let whereSql = 'SELECT * FROM manufacturers WHERE id = ?';
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
    
          const manufacturer = query(whereSql, whereParams)[0];
          if (!manufacturer) {
            return res.status(404).json({
              success: false,
              message: 'Manufacturer not found'
            });
          }
    
          // Check if manufacturer has suppliers (match backend)
          const supplierCount = query('SELECT COUNT(*) as c FROM suppliers WHERE manufacturerId = ? AND isActive = 1', [id])[0]?.c || 0;
          if (supplierCount > 0) {
            return res.status(400).json({
              success: false,
              message: 'Cannot delete manufacturer with existing suppliers'
            });
          }
    
          // Hard delete (match backend)
          run('DELETE FROM manufacturers WHERE id = ?', [id]);
          saveDatabase();
    
          // 🔄 TWO-WAY SYNC: Queue delete for sync
          handleDataChange('manufacturers', 'delete', { id });
    
          res.json({ success: true, message: 'Manufacturer deleted successfully' });
        } catch (e) {
          console.error('[Manufacturers] Delete error:', e);
          res.status(500).json({ success: false, message: e.message });
        }
      });

}

module.exports = {
  registerManufacturersRoutes
};
