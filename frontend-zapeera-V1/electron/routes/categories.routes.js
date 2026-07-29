/**
 * Categories Routes
 * Extracted from routes/index.js
 */

function registerCategoriesRoutes(app, authMiddleware, deps) {
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

// GET /api/categories (line 2430)
      app.get('/api/categories', authMiddleware, (req, res) => {
        try {
          // CRITICAL FIX: Ensure database is initialized before querying
          if (!getDatabase()) {
            console.log('[Categories] Database not initialized, initializing now...');
            try {
              // Try to initialize synchronously (if possible) or return error
              return res.status(500).json({
                success: false,
                message: 'Database not initialized. Please restart the application.'
              });
            } catch (initError) {
              console.error('[Categories] Failed to initialize database:', initError.message);
              return res.status(500).json({
                success: false,
                message: 'Database not initialized. Please restart the application.'
              });
            }
          }
    
          // CRITICAL FIX: Ensure query function is available
          if (typeof query !== 'function') {
            console.error('[Categories] Query function not available');
            return res.status(500).json({
              success: false,
              message: 'Database query function not available. Please restart the application.'
            });
          }
    
          console.log('[Categories] GET - User:', req.user?.email, 'Role:', req.user?.role, 'Branch:', req.user?.branchId);
          const { page = 1, limit = 50, search = '', branchId = '' } = req.query;
    
          // CRITICAL FIX: Get companyId and branchId from headers first (set by frontend)
          const headerCompanyId = req.headers['x-company-id'];
          const headerBranchId = req.headers['x-branch-id'];
    
          // Determine branch ID - prioritize query param, then header, then user's branch
          const targetBranchId = branchId && typeof branchId === 'string' && branchId.trim() !== ''
            ? branchId
            : headerBranchId || req.user?.selectedBranchId || req.user?.branchId;
    
          // CRITICAL FIX: Determine company ID - prioritize header (set by frontend)
          const targetCompanyId = headerCompanyId || req.user?.selectedCompanyId || req.user?.companyId;
    
          console.log('[Categories] Target branchId:', targetBranchId, 'Target companyId:', targetCompanyId);
    
          const skip = (Number(page) - 1) * Number(limit);
          const take = Number(limit);
    
          let sql = 'SELECT * FROM categories WHERE 1=1';
          const params = [];
    
          // CRITICAL FIX: Filter by companyId first when branchId is null (All Branches view)
          // When company is selected but no branch, show categories from all branches of that company
          if (targetBranchId) {
            // Specific branch selected: show categories from this branch
            sql += ' AND (branchId = ? OR branchId IS NULL)';
            params.push(targetBranchId);
            console.log('[Categories] Filtering by branchId:', targetBranchId);
          } else if (targetCompanyId) {
            // CRITICAL FIX: Company selected but no branch (All Branches) - show categories from all branches of this company
            const companyBranches = query('SELECT id FROM branches WHERE companyId = ?', [targetCompanyId]);
            if (companyBranches.length > 0) {
              const branchIds = companyBranches.map(b => b.id);
              sql += ' AND (branchId IN (' + branchIds.map(() => '?').join(',') + ') OR branchId IS NULL)';
              params.push(...branchIds);
              console.log('[Categories] Filtering by company branches:', branchIds.length, 'branches');
          } else {
              // No branches in company - STRICT filter by companyId only (no NULL allowed)
              sql += ' AND companyId = ?';
              params.push(targetCompanyId);
              console.log('[Categories] No branches in company - STRICT companyId filter:', targetCompanyId);
              console.log('[Categories] No branches in company - filtering by companyId only');
            }
          } else {
            // No branch/company selected - use createdBy as fallback
            if (req.user?.role === 'SUPERADMIN') {
              // SUPERADMIN can see all categories if no branch/company selected
              console.log('[Categories] SUPERADMIN - showing all categories');
            } else if (req.user?.role === 'ADMIN') {
              // For ADMIN users, show categories they created OR categories with NULL branchId
              const adminCreatedBy = req.user.createdBy || req.user.id;
              sql += ' AND (createdBy = ? OR branchId IS NULL)';
              params.push(adminCreatedBy);
              console.log('[Categories] ADMIN - filtering by createdBy:', adminCreatedBy);
            } else if (req.user?.createdBy) {
              // Other users see categories from their admin OR categories with NULL branchId
              sql += ' AND (createdBy = ? OR branchId IS NULL)';
              params.push(req.user.createdBy);
              console.log('[Categories] User - filtering by createdBy:', req.user.createdBy);
            } else if (req.user?.id) {
              // Fallback to user ID if no createdBy OR categories with NULL branchId
              sql += ' AND (createdBy = ? OR branchId IS NULL)';
              params.push(req.user.id);
              console.log('[Categories] User - filtering by userId:', req.user.id);
            } else {
              // No access if no user context - but still show NULL branchId categories
              sql += ' AND branchId IS NULL';
              console.log('[Categories] No user context - showing only NULL branchId categories');
            }
          }
    
          // CRITICAL FIX: STRICT company filtering - prevent data leakage
          // ALWAYS filter by companyId when provided (don't allow NULL companyId - this causes data leakage)
          if (targetCompanyId && targetCompanyId.trim() !== '') {
            // STRICT: Only show categories from the selected company
            // Remove the OR companyId IS NULL condition - this was causing data leakage
            sql += ' AND companyId = ?';
            params.push(targetCompanyId);
            console.log('[Categories] STRICT company filter applied:', targetCompanyId, '(prevents data leakage)');
          } else if (req.user?.role !== 'SUPERADMIN') {
            // For non-SUPERADMIN users without company selection, show empty
            sql += ' AND companyId = ?';
            params.push('no-company-selected');
            console.log('[Categories] No company selected - showing empty (prevent data leakage)');
          }
    
          // Search - match backend-zp (name, description)
          if (search) {
            const searchTerm = `%${search}%`;
            sql += ' AND (name LIKE ? OR description LIKE ?)';
            params.push(searchTerm, searchTerm);
          }
    
          sql += ' ORDER BY name ASC';
    
          // Get total count for pagination
          const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as count');
          const totalResult = query(countSql, params);
          const total = totalResult[0]?.count || 0;
    
          // Apply pagination
          sql += ' LIMIT ? OFFSET ?';
          params.push(take, skip);
    
          const categories = query(sql, params).map(c => ({
            ...c,
            _count: {
              products: query('SELECT COUNT(*) as count FROM products WHERE categoryId = ? AND isActive = 1', [c.id])[0]?.count || 0
            }
          }));
    
          console.log('[Categories] Found:', categories.length, 'Total:', total);
          res.json({
            success: true,
            data: {
              categories,
              pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                pages: Math.ceil(total / Number(limit))
              }
            }
          });
        } catch (e) {
          console.error('[API] Categories GET error:', e);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // GET /api/categories/:id (line 2592)
      app.get('/api/categories/:id', authMiddleware, (req, res) => {
        try {
          const items = query('SELECT * FROM categories WHERE id = ? AND isActive = 1', [req.params.id]);
          if (!items.length) return res.status(404).json({ success: false, message: 'Category not found' });
          const category = items[0];
          category._count = { products: query('SELECT COUNT(*) as count FROM products WHERE categoryId = ? AND isActive = 1', [category.id])[0]?.count || 0 };
          res.json({ success: true, data: category });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // POST /api/categories (line 2603)
      app.post('/api/categories', authMiddleware, async (req, res) => {
        try {
          const { name, description, type = 'GENERAL', color = '#3B82F6', branchId, companyId } = req.body;
          console.log('[Categories] Creating category (PostgreSQL first, SQLite fallback):', { name, type, color, branchId, companyId });
    
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
    
          // OFFLINE-FIRST: Always use SQLite, PostgreSQL sync happens in background
          // Skip PostgreSQL entirely - SQLite is the primary database for CRUD
          console.log('[Categories] Using SQLite (offline-first mode)');
    
          // CRITICAL: Ensure SQLite table has all required columns BEFORE insert
          try {
            const tableInfo = query("PRAGMA table_info(categories)");
            const columnNames = tableInfo.map(col => col.name.toLowerCase());
            console.log('[Categories] SQLite table columns:', columnNames);
    
            // Add missing columns if they don't exist
            if (!columnNames.includes('isactive')) {
              console.log('[Categories] Adding isActive column...');
              run('ALTER TABLE categories ADD COLUMN isActive INTEGER DEFAULT 1');
              saveDatabase();
            }
            if (!columnNames.includes('type')) {
              console.log('[Categories] Adding type column...');
              run('ALTER TABLE categories ADD COLUMN type TEXT DEFAULT "GENERAL"');
              saveDatabase();
            }
            if (!columnNames.includes('color')) {
              console.log('[Categories] Adding color column...');
              run('ALTER TABLE categories ADD COLUMN color TEXT DEFAULT "#3B82F6"');
              saveDatabase();
            }
          } catch (migrationError) {
            console.log('[Categories] Migration check:', migrationError.message);
          }
    
          // Insert into SQLite - PRIMARY DATABASE
          console.log('[Categories] Inserting into SQLite:', { id, name, type, color, finalBranchId, finalCompanyId });
    
          const insertSuccess = run(`INSERT INTO categories (id, name, description, type, color, branchId, companyId, createdBy, isActive, createdAt, updatedAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
            [id, name, description || null, type, color, finalBranchId, finalCompanyId, req.user?.id || null, timestamp, timestamp]);
    
          if (!insertSuccess) {
            const errorMsg = lastDbError || 'Unknown database error';
            console.error('[Categories] ❌ SQLite insert failed:', errorMsg);
            console.error('[Categories] SQL:', `INSERT INTO categories (id, name, description, type, color, branchId, companyId, createdBy, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`);
            console.error('[Categories] Params:', [id, name, description || null, type, color, finalBranchId, finalCompanyId, req.user?.id || null, timestamp, timestamp]);
            return res.status(500).json({ success: false, message: 'Failed to create category: ' + errorMsg });
          }
    
          // Query the created category
          let category = query('SELECT * FROM categories WHERE id = ?', [id])[0];
    
          if (!category) {
            console.error('[Categories] Category not found after insert, trying by name...');
            // Fallback: try to find by name
            const byName = query('SELECT * FROM categories WHERE name = ? ORDER BY createdAt DESC LIMIT 1', [name]);
            if (byName.length > 0) {
              category = byName[0];
              console.log('[Categories] Found category by name');
            } else {
              return res.status(500).json({ success: false, message: 'Category created but could not be retrieved' });
            }
          }
    
          console.log('[Categories] ✅ Created successfully in SQLite:', category.id);
          const usedDatabase = 'sqlite';
    
          // Get product count from SQLite
          let productCount = 0;
          productCount = query('SELECT COUNT(*) as count FROM products WHERE categoryId = ? AND isActive = 1', [category.id])[0]?.count || 0;
    
          const categoryWithCount = {
            ...category,
            _count: { products: productCount }
          };
    
          console.log('[Categories] Created category:', categoryWithCount, 'Database:', usedDatabase);
    
          // Queue for sync to PostgreSQL (background)
          handleDataChange('categories', 'create', category);
    
          res.status(201).json({ success: true, data: categoryWithCount, message: 'Category created successfully' });
        } catch (e) {
          console.error('[Categories] Create error:', e);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // PUT /api/categories/:id (line 2707)
      app.put('/api/categories/:id', authMiddleware, (req, res) => {
        try {
          const { id } = req.params;
          const updateData = req.body;
    
          // Check if category exists (match backend)
          const existingCategory = query('SELECT * FROM categories WHERE id = ?', [id])[0];
          if (!existingCategory) {
            return res.status(404).json({ success: false, message: 'Category not found' });
          }
    
          // Check if name already exists for this branch (if being updated) - match backend
          if (updateData.name && updateData.name !== existingCategory.name) {
            const targetBranchId = req.user?.selectedBranchId || req.user?.branchId || existingCategory.branchId;
            const nameExists = query('SELECT id FROM categories WHERE name = ? AND id != ? AND branchId = ?',
              [updateData.name, id, targetBranchId]);
            if (nameExists && nameExists.length > 0) {
              return res.status(400).json({ success: false, message: 'Category with this name already exists in this branch' });
            }
          }
    
          // Build update fields - match backend structure
          const updateFields = [];
          const updateValues = [];
    
          if (updateData.name !== undefined) { updateFields.push('name = ?'); updateValues.push(updateData.name); }
          if (updateData.description !== undefined) { updateFields.push('description = ?'); updateValues.push(updateData.description || null); }
          if (updateData.type !== undefined) { updateFields.push('type = ?'); updateValues.push(updateData.type); }
          if (updateData.color !== undefined) { updateFields.push('color = ?'); updateValues.push(updateData.color); }
    
          if (updateFields.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update' });
          }
    
          updateFields.push('updatedAt = ?');
          updateValues.push(now());
          updateValues.push(id);
    
          run(`UPDATE categories SET ${updateFields.join(', ')} WHERE id = ?`, updateValues);
    
          // Get updated category with product count (match backend)
          const category = query('SELECT * FROM categories WHERE id = ?', [id])[0];
          if (!category) {
            return res.status(404).json({ success: false, message: 'Category not found after update' });
          }
    
          // Include product count (match backend)
          const productCount = query('SELECT COUNT(*) as count FROM products WHERE categoryId = ? AND isActive = 1', [category.id])[0]?.count || 0;
          const categoryWithCount = {
            ...category,
            _count: { products: productCount }
          };
    
          // 🔄 TWO-WAY SYNC: Queue for sync to PostgreSQL
          if (categoryWithCount) handleDataChange('categories', 'update', categoryWithCount);
    
          res.json({ success: true, data: categoryWithCount, message: 'Category updated successfully' });
        } catch (e) {
          console.error('[Categories] Update error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // DELETE /api/categories/:id (line 2771)
      app.delete('/api/categories/:id', authMiddleware, (req, res) => {
        try {
          const { id } = req.params;
    
          // Check if category exists (match backend)
          const category = query('SELECT * FROM categories WHERE id = ?', [id])[0];
          if (!category) {
            return res.status(404).json({ success: false, message: 'Category not found' });
          }
    
          // Check if category has products (match backend)
          const productCount = query('SELECT COUNT(*) as count FROM products WHERE categoryId = ? AND isActive = 1', [id])[0]?.count || 0;
          if (productCount > 0) {
            return res.status(400).json({
              success: false,
              message: 'Cannot delete category with existing products'
            });
          }
    
          // Hard delete (match backend)
          run('DELETE FROM categories WHERE id = ?', [id]);
          saveDatabase();
    
          // 🔄 TWO-WAY SYNC: Queue delete for sync to PostgreSQL
          handleDataChange('categories', 'delete', { id });
    
          res.json({ success: true, message: 'Category deleted successfully' });
        } catch (e) {
          console.error('[Categories] Delete error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

}

module.exports = {
  registerCategoriesRoutes
};
