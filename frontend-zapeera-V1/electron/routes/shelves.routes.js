/**
 * Shelves Routes
 * Extracted from routes/index.js
 */

function registerShelvesRoutes(app, authMiddleware, deps) {
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

// GET /api/shelves (line 5015)
      app.get('/api/shelves', authMiddleware, (req, res) => {
        try {
          console.log('[Shelves] GET - User:', req.user?.email, 'Role:', req.user?.role, 'Branch:', req.user?.branchId);
          const { page = 1, limit = 50, search = '', active = true } = req.query;
    
          // Get context from headers (set by frontend) - match backend-zp
          const selectedCompanyId = req.headers['x-company-id'] || req.user?.selectedCompanyId;
          const selectedBranchId = req.headers['x-branch-id'] || req.user?.selectedBranchId;
    
          const skip = (Number(page) - 1) * Number(limit);
          const take = Number(limit);
    
          let sql = 'SELECT * FROM shelves WHERE 1=1';
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
    
          // Search - match backend-zp (name, description, location)
          if (search) {
            const searchTerm = `%${search}%`;
            sql += ' AND (name LIKE ? OR description LIKE ? OR location LIKE ?)';
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
    
          const allShelves = query(sql, params);
          const shelves = allShelves.map(s => ({
            ...s,
            branch: s.branchId ? query('SELECT id, name FROM branches WHERE id = ?', [s.branchId])[0] : null,
            _count: { batches: query('SELECT COUNT(*) as c FROM batches WHERE shelfId = ?', [s.id])[0]?.c || 0 }
          }));
    
          console.log('[Shelves] Found:', shelves.length, 'SQL:', sql, 'Params:', params);
          res.json({ success: true, data: { shelves, pagination: { total: shelves.length, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(shelves.length / parseInt(limit)) } } });
        } catch (e) { console.error('[Shelves] Error:', e); res.status(500).json({ success: false, message: e.message }); }
      });

  // GET /api/shelves/:id (line 5097)
      app.get('/api/shelves/:id', authMiddleware, (req, res) => {
        try {
          const { id } = req.params;
          let sql = 'SELECT * FROM shelves WHERE id = ?';
          const params = [id];
    
          // Data isolation based on user role - match backend-zp
          const userRole = req.user?.role;
          if (userRole === 'SUPERADMIN') {
            // SUPERADMIN can see all shelves
          } else if (userRole === 'ADMIN') {
            // For ADMIN users, use their own ID as createdBy (self-referencing)
            sql += ' AND createdBy = ?';
            params.push(req.user.id);
          } else if (req.user?.createdBy) {
            // Other users see shelves from their admin
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
    
          const shelf = query(sql, params)[0];
          if (!shelf) {
            return res.status(404).json({ success: false, message: 'Shelf not found' });
          }
    
          // Add relations - match backend-zp
          shelf._count = {
            batches: query('SELECT COUNT(*) as c FROM batches WHERE shelfId = ? AND isActive = 1', [id])[0]?.c || 0
          };
    
          res.json({ success: true, data: shelf });
        } catch (e) {
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // POST /api/shelves (line 5142)
      app.post('/api/shelves', authMiddleware, async (req, res) => {
        try {
          const { name, description, location, branchId, companyId } = req.body;
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
    
          // Check if shelf with this name already exists in this branch (match backend)
          const existingShelf = query('SELECT id FROM shelves WHERE name = ? AND branchId = ?', [name, finalBranchId]);
          if (existingShelf && existingShelf.length > 0) {
            return res.status(400).json({
              success: false,
              message: 'Shelf with this name already exists in this branch'
            });
          }
    
          console.log('[Shelves] Creating shelf:', { name, finalBranchId, finalCompanyId });
    
          const id = uuid();
          const timestamp = now();
    
          // OFFLINE-FIRST: Always use SQLite, PostgreSQL sync happens in background
          // Skip PostgreSQL entirely - SQLite is the primary database for CRUD
          console.log('[Shelves] Using SQLite (offline-first mode)');
            // CRITICAL: Ensure SQLite table has all required columns BEFORE insert
            try {
              const tableInfo = query("PRAGMA table_info(shelves)");
              const columnNames = tableInfo.map(col => col.name.toLowerCase());
              console.log('[Shelves] SQLite table columns found:', columnNames);
    
              // Add missing columns if they don't exist (case-insensitive check)
              if (!columnNames.includes('isactive')) {
                console.log('[Shelves] ⚠️  isActive column missing, adding it...');
                run('ALTER TABLE shelves ADD COLUMN isActive INTEGER DEFAULT 1');
                saveDatabase();
                console.log('[Shelves] ✅ isActive column added');
              }
            } catch (migrationError) {
              console.error('[Shelves] Migration error:', migrationError.message);
              // Continue anyway - table might be fine
            }
    
          // Insert into SQLite - PRIMARY DATABASE
          console.log('[Shelves] Inserting into SQLite:', { id, name, description, location, finalBranchId, finalCompanyId });
    
          const insertSuccess = run(`INSERT INTO shelves (id, name, description, location, branchId, companyId, createdBy, isActive, createdAt, updatedAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
            [id, name, description || null, location || null, finalBranchId, finalCompanyId, req.user?.id || null, timestamp, timestamp]);
    
          if (!insertSuccess) {
            const errorMsg = lastDbError || 'Unknown database error';
            console.error('[Shelves] ❌ SQLite insert failed:', errorMsg);
            console.error('[Shelves] SQL:', `INSERT INTO shelves (id, name, location, capacity, branchId, companyId, createdBy, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`);
            console.error('[Shelves] Params:', [id, name, location || null, capacity, finalBranchId, finalCompanyId, req.user?.id || null, timestamp, timestamp]);
            return res.status(500).json({ success: false, message: 'Failed to create shelf: ' + errorMsg });
          }
    
          // Query the created shelf
          let shelf = query('SELECT * FROM shelves WHERE id = ?', [id])[0];
    
          if (!shelf) {
            console.error('[Shelves] Shelf not found after insert, trying by name...');
            // Fallback: try to find by name
            const byName = query('SELECT * FROM shelves WHERE name = ? ORDER BY createdAt DESC LIMIT 1', [name]);
            if (byName.length > 0) {
              shelf = byName[0];
              console.log('[Shelves] Found shelf by name');
            } else {
              return res.status(500).json({ success: false, message: 'Shelf created but could not be retrieved' });
            }
          }
    
          console.log('[Shelves] ✅ Created successfully in SQLite:', shelf.id);
          const usedDatabase = 'sqlite';
    
          // Get related data from SQLite
          let branch = null;
          let batchCount = 0;
    
          if (shelf.branchId) {
            branch = query('SELECT id, name FROM branches WHERE id = ?', [shelf.branchId])[0] || null;
          }
          batchCount = query('SELECT COUNT(*) as c FROM batches WHERE shelfId = ?', [shelf.id])[0]?.c || 0;
    
          // Return shelf with proper format
          const shelfWithCount = {
            ...shelf,
            branch: branch,
            _count: { batches: batchCount }
          };
    
          console.log('[Shelves] Created shelf:', shelfWithCount, 'Database:', usedDatabase);
    
          // Queue for sync to PostgreSQL (background)
          handleDataChange('shelves', 'create', shelf);
    
          res.status(201).json({ success: true, data: shelfWithCount, message: 'Shelf created successfully' });
        } catch (e) {
          console.error('[Shelves] Create error:', e);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // PUT /api/shelves/:id (line 5267)
      app.put('/api/shelves/:id', authMiddleware, (req, res) => {
        try {
          const { id } = req.params;
          const updateData = req.body;
    
          // Check if shelf exists with data isolation (match backend)
          let whereSql = 'SELECT * FROM shelves WHERE id = ?';
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
    
          const existingShelf = query(whereSql, whereParams)[0];
          if (!existingShelf) {
            return res.status(404).json({
              success: false,
              message: 'Shelf not found'
            });
          }
    
          // Check if name already exists for this admin (if being updated) - match backend
          if (updateData.name && updateData.name !== existingShelf.name) {
            const nameExists = query('SELECT id FROM shelves WHERE name = ? AND branchId = ? AND id != ?',
              [updateData.name, existingShelf.branchId, id]);
            if (nameExists && nameExists.length > 0) {
              return res.status(400).json({
                success: false,
                message: 'Shelf with this name already exists in this branch'
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
          if (updateData.location !== undefined) {
            const cleanLocation = updateData.location && updateData.location.trim() !== '' ? updateData.location.trim() : null;
            updateFields.push('location = ?');
            updateValues.push(cleanLocation);
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
    
          run(`UPDATE shelves SET ${updateFields.join(', ')} WHERE id = ?`, updateValues);
          saveDatabase();
    
          const shelf = query('SELECT * FROM shelves WHERE id = ?', [id])[0];
          if (!shelf) {
            return res.status(404).json({ success: false, message: 'Shelf not found after update' });
          }
    
          // Add relations (match backend)
          shelf._count = {
            batches: query('SELECT COUNT(*) as c FROM batches WHERE shelfId = ?', [id])[0]?.c || 0
          };
    
          // 🔄 TWO-WAY SYNC: Queue for sync to PostgreSQL
          if (shelf) handleDataChange('shelves', 'update', shelf);
    
          res.json({ success: true, data: shelf, message: 'Shelf updated successfully' });
        } catch (e) {
          console.error('[Shelves] Update error:', e);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // DELETE /api/shelves/:id (line 5368)
      app.delete('/api/shelves/:id', authMiddleware, (req, res) => {
        try {
          const { id } = req.params;
    
          // Check if shelf exists with data isolation (match backend)
          let whereSql = 'SELECT * FROM shelves WHERE id = ?';
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
    
          const shelf = query(whereSql, whereParams)[0];
          if (!shelf) {
            return res.status(404).json({
              success: false,
              message: 'Shelf not found'
            });
          }
    
          // Check if shelf has batches (match backend)
          const batchCount = query('SELECT COUNT(*) as c FROM batches WHERE shelfId = ?', [id])[0]?.c || 0;
          if (batchCount > 0) {
            return res.status(400).json({
              success: false,
              message: 'Cannot delete shelf with existing batches'
            });
          }
    
          // Hard delete (match backend)
          run('DELETE FROM shelves WHERE id = ?', [id]);
          saveDatabase();
    
          // 🔄 TWO-WAY SYNC: Queue delete for sync
          handleDataChange('shelves', 'delete', { id });
    
          res.json({ success: true, message: 'Shelf deleted successfully' });
        } catch (e) {
          console.error('[Shelves] Delete error:', e);
          res.status(500).json({ success: false, message: e.message });
        }
      });

}

module.exports = {
  registerShelvesRoutes
};
