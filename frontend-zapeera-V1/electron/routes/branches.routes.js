/**
 * Branches Routes
 * Extracted from routes/index.js
 */

function registerBranchesRoutes(app, authMiddleware, deps) {
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

// GET /api/branches (line 1933)
      app.get('/api/branches', authMiddleware, async (req, res) => {
        try {
          console.log('[Branches] GET - User:', req.user?.email, 'Role:', req.user?.role, 'Company:', req.user?.companyId);
          const { companyId } = req.query;
    
          // CRITICAL FIX: Get companyId from headers first (set by frontend), then from user object
          const headerCompanyId = req.headers['x-company-id'];
          const selectedCompanyId = headerCompanyId || req.user?.selectedCompanyId;
    
          // CRITICAL FIX: For ADMIN users, filter by selected companyId (from headers) or their companyId
          // For SUPERADMIN, show all branches (or filter by query param or header)
          let finalCompanyId = null;
    
          if (req.user?.role === 'ADMIN') {
            // ADMIN users should only see branches from selected company (from headers) or their company
            finalCompanyId = selectedCompanyId || req.user?.companyId;
            console.log('[Branches] ADMIN user - filtering by companyId:', finalCompanyId, '(from header:', headerCompanyId, ')');
          } else if (req.user?.role === 'SUPERADMIN') {
            // SUPERADMIN can see all or filter by query param or header
            finalCompanyId = companyId || selectedCompanyId || null;
            console.log('[Branches] SUPERADMIN - companyId filter:', finalCompanyId, '(from header:', headerCompanyId, ')');
          } else {
            // Other roles: use selected companyId (from headers) or their assigned companyId
            finalCompanyId = selectedCompanyId || req.user?.companyId;
            console.log('[Branches] Other role - filtering by companyId:', finalCompanyId, '(from header:', headerCompanyId, ')');
          }
    
          // CRITICAL FIX: Query SQLite first
          // For ADMIN users, ALWAYS include branches they created (using OR condition)
          let sql = 'SELECT * FROM branches WHERE isActive = 1';
          const params = [];
    
          // CRITICAL FIX: ALWAYS filter by companyId when provided (strict isolation - prevent data leakage)
          // Don't use OR condition with createdBy - this causes data leakage between businesses
          if (finalCompanyId && finalCompanyId.trim() !== '') {
            // STRICT: Only show branches from the selected company
            sql += ' AND companyId = ?';
            params.push(finalCompanyId);
            console.log('[Branches] STRICT company filter applied:', finalCompanyId, '(prevents data leakage)');
          } else if (req.user?.role === 'ADMIN') {
            // CRITICAL FIX: When no company selected, filter by user's companyId to prevent data leakage
            const userCompanyId = req.user?.companyId;
            if (userCompanyId) {
              sql += ' AND companyId = ?';
              params.push(userCompanyId);
              console.log('[Branches] ADMIN: No company selected - filtering by user companyId:', userCompanyId, '(prevents data leakage)');
            } else {
              // If admin has no companyId, show empty (no branches) to prevent data leakage
              sql += ' AND companyId = ?';
              params.push('no-company-selected');
              console.log('[Branches] ADMIN: No company selected and user has no companyId - showing empty (prevent data leakage)');
            }
          } else if (req.user?.role !== 'SUPERADMIN') {
            // For non-SUPERADMIN users without company selection, show empty
            sql += ' AND companyId = ?';
            params.push('no-company-selected');
            console.log('[Branches] No company selected - showing empty (prevent data leakage)');
          }
          sql += ' ORDER BY createdAt DESC';
    
          let branches = query(sql, params).map(b => ({
            ...b,
            company: query('SELECT id, name FROM companies WHERE id = ?', [b.companyId])[0]
          }));
          console.log('[Branches] SQLite branches found:', branches.length);
    
          // CRITICAL FIX: REMOVED fallback query that used OR createdBy
          // This was causing data leakage - branches from other businesses were showing
          // Now we strictly filter by companyId only (no OR createdBy fallback)
          if (req.user?.role === 'ADMIN' && req.user?.id && branches.length === 0 && finalCompanyId) {
            console.log('[Branches] ⚠️ SQLite query returned empty for ADMIN with companyId:', finalCompanyId);
            console.log('[Branches] ✅ This is correct - no branches in this company (prevents data leakage)');
          }
    
          // CRITICAL FIX: ALWAYS check PostgreSQL for branches if available (not just when SQLite is empty)
          // This ensures branches created in PostgreSQL are visible even if SQLite hasn't synced
          let pgBranches = [];
          if (REMOTE_DATABASE_URL) {
            try {
              console.log('[Branches] 🔄 Checking PostgreSQL for branches...');
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
    
              // CRITICAL FIX: STRICT companyId filtering - prevent data leakage
              // ALWAYS filter by companyId when provided (no OR createdBy - this causes data leakage)
              let pgSql = 'SELECT id, name, address, phone, email, "companyId", "managerId", "createdBy", "isActive", "createdAt", "updatedAt" FROM branches WHERE "isActive" = true';
              const pgParams = [];
    
              if (finalCompanyId && finalCompanyId.trim() !== '') {
                // STRICT: Only show branches from the selected company (prevent data leakage)
                pgSql += ' AND "companyId" = $1';
                pgParams.push(finalCompanyId);
                console.log('[Branches] PostgreSQL STRICT company filter:', finalCompanyId, '(prevents data leakage)');
              } else if (req.user?.role === 'ADMIN') {
                // CRITICAL FIX: When no company selected, filter by user's companyId to prevent data leakage
                const userCompanyId = req.user?.companyId;
                if (userCompanyId) {
                  pgSql += ' AND "companyId" = $1';
                  pgParams.push(userCompanyId);
                  console.log('[Branches] PostgreSQL: No company selected - filtering by user companyId:', userCompanyId, '(prevents data leakage)');
                } else {
                  // If admin has no companyId, show empty (no branches) to prevent data leakage
                  pgSql += ' AND "companyId" = $1';
                  pgParams.push('no-company-selected');
                  console.log('[Branches] PostgreSQL: No company selected and user has no companyId - showing empty (prevent data leakage)');
                }
              } else if (req.user?.role !== 'SUPERADMIN') {
                // For non-SUPERADMIN users without company selection, show empty
                pgSql += ' AND "companyId" = $1';
                pgParams.push('no-company-selected');
                console.log('[Branches] PostgreSQL: No company selected - showing empty (prevent data leakage)');
              }
    
              pgSql += ' ORDER BY "createdAt" DESC LIMIT 100';
    
              let pgResult = await Promise.race([
                pgClient.query(pgSql, pgParams),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Query timeout')), 10000))
              ]);
    
              console.log('[Branches] PostgreSQL branches found:', pgResult.rows?.length || 0);
    
              await pgClient.end();
    
              if (pgResult.rows && pgResult.rows.length > 0) {
                console.log(`[Branches] ✅ Found ${pgResult.rows.length} branches in PostgreSQL`);
                pgBranches = pgResult.rows;
              } else {
                console.log('[Branches] ⚠️ No branches found in PostgreSQL for companyId:', finalCompanyId);
                console.log('[Branches] ✅ This is correct - no branches in this company (prevents data leakage)');
                // CRITICAL FIX: REMOVED fallback query that used createdBy
                // This was causing data leakage - branches from other businesses were showing
                // Now we strictly filter by companyId only (no createdBy fallback)
              }
            } catch (pgError) {
              console.error('[Branches] PostgreSQL check failed:', pgError.message);
            }
          }
    
          // CRITICAL FIX: Merge PostgreSQL branches with SQLite branches
          if (pgBranches.length > 0) {
            // Convert PostgreSQL format to SQLite format
            const convertedPgBranches = pgBranches.map(pgBranch => ({
              id: pgBranch.id,
              name: pgBranch.name,
              address: pgBranch.address || null,
              phone: pgBranch.phone || null,
              email: pgBranch.email || null,
              companyId: pgBranch.companyId,
              managerId: pgBranch.managerId || null,
              createdBy: pgBranch.createdBy,
              isActive: pgBranch.isActive,
              createdAt: pgBranch.createdAt,
              updatedAt: pgBranch.updatedAt
            }));
    
            // CRITICAL FIX: Filter out inactive branches from PostgreSQL
            // Only include branches where isActive is true or 1
            const activePgBranches = convertedPgBranches.filter(branch => {
              const isActive = branch.isActive === true || branch.isActive === 1 || branch.isActive === '1';
              if (!isActive) {
                console.log(`[Branches] ⚠️ Filtering out inactive branch from PostgreSQL: ${branch.name} (isActive: ${branch.isActive})`);
              }
              return isActive;
            });
    
            console.log(`[Branches] PostgreSQL branches: ${convertedPgBranches.length} total, ${activePgBranches.length} active`);
    
            // Get company info for active PostgreSQL branches
            activePgBranches.forEach(branch => {
              const company = query('SELECT id, name FROM companies WHERE id = ?', [branch.companyId])[0];
              if (company) {
                branch.company = company;
              }
            });
    
            if (branches.length === 0) {
              // CRITICAL: If SQLite is empty, use only active PostgreSQL branches
              console.log(`[Branches] ✅ SQLite empty - using ${activePgBranches.length} active branches from PostgreSQL`);
              branches = activePgBranches;
            } else {
              // Merge: remove duplicates and combine only active branches
              const sqliteBranchIds = new Set(branches.map(b => b.id));
              const uniquePgBranches = activePgBranches.filter(pgBranch => !sqliteBranchIds.has(pgBranch.id));
              if (uniquePgBranches.length > 0) {
                console.log(`[Branches] ✅ Merging ${uniquePgBranches.length} unique active branches from PostgreSQL`);
                branches = [...uniquePgBranches, ...branches];
              }
            }
          }
    
          // CRITICAL FIX: Final filter - ensure all branches in the result are active
          // This catches any edge cases where inactive branches might have slipped through
          branches = branches.filter(branch => {
            const isActive = branch.isActive === true || branch.isActive === 1 || branch.isActive === '1';
            if (!isActive) {
              console.log(`[Branches] ⚠️ Final filter: Removing inactive branch: ${branch.name} (isActive: ${branch.isActive})`);
            }
            return isActive;
          });
    
          // CRITICAL FIX: Enhance branches with manager info and statistics (_count)
          const enhancedBranches = branches.map(branch => {
            let manager = null;
    
            // Fetch manager by managerId if set
            if (branch.managerId) {
              const managerUser = query('SELECT id, name, email, role FROM users WHERE id = ?', [branch.managerId])[0];
              if (managerUser) {
                manager = {
                  id: managerUser.id,
                  name: managerUser.name,
                  email: managerUser.email,
                  role: managerUser.role
                };
              }
            }
    
            // If no manager found by managerId, look for any MANAGER role user in this branch
            if (!manager) {
              const branchManager = query('SELECT id, name, email, role FROM users WHERE branchId = ? AND role = ? LIMIT 1', [branch.id, 'MANAGER'])[0];
              if (branchManager) {
                manager = {
                  id: branchManager.id,
                  name: branchManager.name,
                  email: branchManager.email,
                  role: branchManager.role
                };
              }
            }
    
            // Calculate statistics (_count)
            const userCount = query('SELECT COUNT(*) as count FROM users WHERE branchId = ? AND (isActive = 1 OR isActive IS NULL)', [branch.id])[0]?.count || 0;
            const productCount = query('SELECT COUNT(*) as count FROM products WHERE branchId = ? AND (isActive = 1 OR isActive IS NULL)', [branch.id])[0]?.count || 0;
            const customerCount = query('SELECT COUNT(*) as count FROM customers WHERE branchId = ? AND (isActive = 1 OR isActive IS NULL)', [branch.id])[0]?.count || 0;
            const salesCount = query('SELECT COUNT(*) as count FROM sales WHERE branchId = ? AND (status IS NULL OR status != ?)', [branch.id, 'REFUNDED'])[0]?.count || 0;
    
            return {
              ...branch,
              manager: manager,
              _count: {
                users: userCount,
                products: productCount,
                customers: customerCount,
                sales: salesCount
              }
            };
          });
    
          console.log('[Branches] === FINAL RESULT ===');
          console.log('[Branches] Total branches being returned:', enhancedBranches.length);
          if (enhancedBranches.length > 0) {
            console.log('[Branches] Branch IDs:', enhancedBranches.map(b => b.id));
            console.log('[Branches] Branch names:', enhancedBranches.map(b => b.name));
            enhancedBranches.forEach(b => {
              console.log(`[Branches] ${b.name} - Manager:`, b.manager ? b.manager.name : 'No Manager', 'Stats:', b._count);
            });
          } else {
            console.log('[Branches] ⚠️ WARNING: Returning EMPTY array!');
            console.log('[Branches] User role:', req.user?.role);
            console.log('[Branches] User companyId:', req.user?.companyId);
            console.log('[Branches] Final companyId filter:', finalCompanyId);
          }
          console.log('[Branches] ');
    
          res.json({ success: true, data: { branches: enhancedBranches, pagination: { total: enhancedBranches.length } } });
        } catch (e) {
          console.error('[Branches] Error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // GET /api/branches/:id (line 2215)
      app.get('/api/branches/:id', authMiddleware, (req, res) => {
        try {
          const items = query('SELECT * FROM branches WHERE id = ? AND isActive = 1', [req.params.id]);
          if (!items.length) return res.status(404).json({ success: false, message: 'Not found' });
          res.json({ success: true, data: items[0] });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // POST /api/branches (line 2224)
      app.post('/api/branches', authMiddleware, (req, res) => {
        try {
          const { name, address, phone, email, companyId, managerId } = req.body;
    
          // CRITICAL FIX: Ensure companyId is set - prioritize from body, then headers, then user context
          let finalCompanyId = companyId || req.user?.selectedCompanyId || req.user?.companyId;
    
          if (!name) {
            return res.status(400).json({ success: false, message: 'Name is required' });
          }
    
          if (!finalCompanyId) {
            return res.status(400).json({ success: false, message: 'Company ID is required. Please select a company first.' });
          }
    
          // CRITICAL FIX: Ensure only one manager per branch
          // If managerId is provided, validate:
          // 1. The user exists and has MANAGER role
          // 2. The manager is not already assigned to another branch
          if (managerId) {
            // Check if user exists and is a MANAGER
            const managerUser = query('SELECT id, role, branchId FROM users WHERE id = ?', [managerId])[0];
    
            if (!managerUser) {
              return res.status(400).json({ success: false, message: 'Manager user not found' });
            }
    
            if (managerUser.role !== 'MANAGER') {
              return res.status(400).json({
                success: false,
                message: 'Selected user is not a MANAGER. Only users with MANAGER role can be assigned as branch manager.'
              });
            }
    
            // Check if this manager is already assigned to another active branch
            const existingManagerBranch = query('SELECT id, name FROM branches WHERE managerId = ? AND isActive = 1', [managerId])[0];
    
            if (existingManagerBranch) {
              return res.status(400).json({
                success: false,
                message: `This manager is already assigned to branch "${existingManagerBranch.name}". A manager can only be assigned to one branch at a time.`
              });
            }
          }
    
          console.log('[Branches] POST - Creating branch:', { name, finalCompanyId, userId: req.user?.id, role: req.user?.role });
    
          const id = uuid();
          run(`INSERT INTO branches (id, name, address, phone, email, companyId, managerId, createdBy, createdAt, updatedAt)
               VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [id, name, address || null, phone || null, email || null, finalCompanyId, managerId || null, req.user.id, now(), now()]);
          const branch = query('SELECT * FROM branches WHERE id = ?', [id])[0];
    
          if (!branch) {
            return res.status(500).json({ success: false, message: 'Failed to create branch' });
          }
    
          // Add company info to branch
          branch.company = query('SELECT id, name FROM companies WHERE id = ?', [finalCompanyId])[0];
    
          console.log('[Branches] POST - Branch created successfully:', { id: branch.id, name: branch.name, companyId: branch.companyId });
    
          // 🔄 TWO-WAY SYNC: Queue for sync to PostgreSQL
          if (branch) handleDataChange('branches', 'create', branch);
    
          res.status(201).json({ success: true, data: branch, message: 'Branch created successfully' });
        } catch (e) {
          console.error('[Branches] POST - Error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // PUT /api/branches/:id (line 2297)
      app.put('/api/branches/:id', authMiddleware, (req, res) => {
        try {
          const { name, address, phone, email, managerId, isActive } = req.body;
    
          console.log('[Branches] PUT request for id:', req.params.id, 'body:', req.body);
    
          // CRITICAL FIX: Ensure only one manager per branch
          // If managerId is being updated, validate:
          // 1. The user exists and has MANAGER role
          // 2. The manager is not already assigned to another branch (unless it's the same branch)
          if (managerId !== undefined && managerId !== null) {
            // Check if user exists and is a MANAGER
            const managerUser = query('SELECT id, role, branchId FROM users WHERE id = ?', [managerId])[0];
    
            if (!managerUser) {
              return res.status(400).json({ success: false, message: 'Manager user not found' });
            }
    
            if (managerUser.role !== 'MANAGER') {
              return res.status(400).json({
                success: false,
                message: 'Selected user is not a MANAGER. Only users with MANAGER role can be assigned as branch manager.'
              });
            }
    
            // Check if this manager is already assigned to another active branch (not this one)
            const existingManagerBranch = query('SELECT id, name FROM branches WHERE managerId = ? AND isActive = 1 AND id != ?', [managerId, req.params.id])[0];
    
            if (existingManagerBranch) {
              return res.status(400).json({
                success: false,
                message: `This manager is already assigned to branch "${existingManagerBranch.name}". A manager can only be assigned to one branch at a time.`
              });
            }
          }
    
          // CRITICAL FIX: Build update query dynamically based on provided fields
          // This ensures that if a field is provided (even if empty string), it gets updated
          const updates = [];
          const params = [];
    
          if (name !== undefined) {
            updates.push('name = ?');
            params.push(name);
            console.log('[Branches] Updating name to:', name);
          }
          if (address !== undefined) {
            updates.push('address = ?');
            params.push(address);
          }
          if (phone !== undefined) {
            updates.push('phone = ?');
            params.push(phone);
          }
          if (email !== undefined) {
            updates.push('email = ?');
            params.push(email);
          }
          if (managerId !== undefined) {
            updates.push('managerId = ?');
            params.push(managerId);
          }
          if (isActive !== undefined) {
            updates.push('isActive = ?');
            params.push(isActive ? 1 : 0);
          }
    
          // Always update updatedAt
          updates.push('updatedAt = ?');
          params.push(now());
    
          // Add the WHERE clause parameter
          params.push(req.params.id);
    
          if (updates.length > 1) { // More than just updatedAt
            const updateQuery = `UPDATE branches SET ${updates.join(', ')} WHERE id = ?`;
            console.log('[Branches] Update query:', updateQuery);
            console.log('[Branches] Update params:', params);
            run(updateQuery, params);
          } else {
            console.log('[Branches] No fields to update');
          }
    
          // Save database immediately after update
          saveDatabase();
          console.log('[Branches] ✅ Database saved after update');
    
          const branch = query('SELECT * FROM branches WHERE id = ?', [req.params.id])[0];
          console.log('[Branches] Updated branch:', branch);
    
          // 🔄 TWO-WAY SYNC: Queue for sync to PostgreSQL
          if (branch) handleDataChange('branches', 'update', branch);
    
          res.json({ success: true, data: branch, message: 'Branch updated successfully' });
        } catch (e) {
          console.error('[Branches] Update error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // DELETE /api/branches/:id (line 2398)
      app.delete('/api/branches/:id', authMiddleware, (req, res) => {
        try {
          console.log('[Branches] DELETE request for id:', req.params.id);
          const branch = query('SELECT * FROM branches WHERE id = ?', [req.params.id])[0];
    
          if (!branch) {
            console.log('[Branches] ⚠️ Branch not found:', req.params.id);
            return res.status(404).json({ success: false, message: 'Branch not found' });
          }
    
          console.log('[Branches] Deleting branch:', branch.name, 'Current isActive:', branch.isActive);
          run('UPDATE branches SET isActive = 0, updatedAt = ? WHERE id = ?', [now(), req.params.id]);
    
          // Save database immediately after delete
          saveDatabase();
          console.log('[Branches] ✅ Database saved after delete');
    
          // Verify the update
          const updatedBranch = query('SELECT * FROM branches WHERE id = ?', [req.params.id])[0];
          console.log('[Branches] ✅ Branch after delete - isActive:', updatedBranch?.isActive, 'Name:', updatedBranch?.name);
    
          // 🔄 TWO-WAY SYNC: Queue soft delete for sync
          if (branch) handleDataChange('branches', 'update', { ...branch, isActive: 0, updatedAt: now() });
    
          res.json({ success: true, message: 'Branch deleted successfully' });
        } catch (e) {
          console.error('[Branches] Delete error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

}

module.exports = {
  registerBranchesRoutes
};
