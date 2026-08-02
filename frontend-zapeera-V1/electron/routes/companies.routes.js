/**
 * Companies Routes
 * Extracted from routes/index.js
 */

function registerCompaniesRoutes(app, authMiddleware, deps) {
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

// GET /api/companies (line 1593)
      app.get('/api/companies', authMiddleware, async (req, res) => {
        try {
          const user = req.user;
          console.log('[Companies] GET request from user:', user.id, 'Role:', user.role);
    
          // Build where clause based on user role (same logic as backend controller)
          let whereClause = 'isActive = 1';
          const params = [];
    
          if (user?.role === 'SUPERADMIN') {
            // SUPERADMIN can see all companies
            console.log('[Companies] SUPERADMIN - showing all companies');
          } else if (user?.role === 'ADMIN' || user?.role === 'OWNER') {
            // ADMIN/OWNER can see companies they created, plus any company they
            // are a member of (synced from cloud during provisioning).
            whereClause += ' AND (createdBy = ? OR id IN (SELECT businessId FROM memberships WHERE userId = ?))';
            params.push(user.id, user.id);
            console.log('[Companies] ADMIN/OWNER - showing companies created by or shared with:', user.id);
          } else if (user?.role === 'MANAGER' || user?.role === 'CASHIER') {
            // MANAGER/CASHIER can only see their branch's company
            if (user?.branchId) {
              const userBranch = query('SELECT companyId FROM branches WHERE id = ?', [user.branchId])[0];
              if (userBranch?.companyId) {
                whereClause += ' AND id = ?';
                params.push(userBranch.companyId);
                console.log('[Companies] MANAGER/CASHIER - showing company:', userBranch.companyId);
              } else {
                // No company access
                whereClause += ' AND id = ?';
                params.push('no-access');
              }
            } else {
              // No branch assigned - no access
              whereClause += ' AND id = ?';
              params.push('no-access');
            }
          } else {
            // Unknown role - no access
            whereClause += ' AND id = ?';
            params.push('no-access');
          }
    
          const companies = query(`SELECT * FROM companies WHERE ${whereClause} ORDER BY createdAt DESC`, params);
          console.log(`[Companies] Found ${companies.length} companies for user ${user.id}`);
    
          const result = await Promise.all(companies.map(async (c) => {
            // CRITICAL FIX: Get branches for this company - include ALL branches (active and inactive)
            // Then filter to show active ones, but also include recently created ones
            let branches = query('SELECT id, name, phone, address, email, isActive, createdAt, createdBy FROM branches WHERE companyId = ?', [c.id]);
    
            console.log(`[Companies] Company ${c.id} - Found ${branches.length} total branches`);
    
            // Filter to show active branches, but also include branches created by current user (even if inactive)
            // This ensures newly created branches are visible immediately
            const userCreatedBranches = branches.filter(b => b.createdBy === user.id);
            const activeBranches = branches.filter(b => b.isActive === 1 || b.isActive === '1');
    
            console.log(`[Companies] Company ${c.id} - Active branches: ${activeBranches.length}, User-created: ${userCreatedBranches.length}`);
    
            // Combine: active branches + user-created branches (remove duplicates)
            const allVisibleBranches = [...activeBranches];
            userCreatedBranches.forEach(b => {
              if (!allVisibleBranches.find(existing => existing.id === b.id)) {
                allVisibleBranches.push(b);
              }
            });
    
            // Sort by createdAt DESC (newest first)
            allVisibleBranches.sort((a, b) => {
              const dateA = new Date(a.createdAt || 0).getTime();
              const dateB = new Date(b.createdAt || 0).getTime();
              return dateB - dateA;
            });
    
            console.log(`[Companies] Company ${c.id} - Total visible branches: ${allVisibleBranches.length}`);
    
            // Return only id, name, phone for branches (match original format)
            const branchesForResponse = allVisibleBranches.map(b => ({
              id: b.id,
              name: b.name,
              phone: b.phone || null
            }));
    
            // Count should include all active branches
            const branchCount = query('SELECT COUNT(*) as c FROM branches WHERE companyId = ? AND isActive = 1', [c.id])[0]?.c || 0;
    
            // CRITICAL FIX: Count staff (users) correctly - count users by companyId OR branchId
            // Some users might have companyId set directly, others might only have branchId
            // Exclude ADMIN and SUPERADMIN roles as they are not "staff"
            // Count ALL users (active and inactive) as they are still "staff"
            const companyBranchIds = query('SELECT id FROM branches WHERE companyId = ? AND isActive = 1', [c.id]).map(b => b.id);
            
            // Build comprehensive query to count all staff for this company
            // Method 1: Users with branchId matching company's branches
            // Method 2: Users with companyId matching (regardless of branchId)
            // Use DISTINCT to avoid double-counting users that match both conditions
            
            let staffCount = 0;
            let staffQuery = '';
            let staffParams = [];
            
            if (companyBranchIds.length > 0) {
              // CRITICAL FIX: Use EXACT same logic as backend (backend-zapeera-v1/src/controllers/company.controller.ts)
              // Count users by branchId OR companyId (comprehensive approach)
              // Use DISTINCT to avoid double-counting users that match both conditions
              const placeholders = companyBranchIds.map(() => '?').join(',');
              
              // Query: Users where (branchId IN company branches) OR (companyId = company)
              // This ensures we catch all users regardless of how they're linked
              const allCompanyUsers = query(`
                SELECT DISTINCT id
                FROM users 
                WHERE (
                  branchId IN (${placeholders}) 
                  OR companyId = ?
                ) 
                AND role NOT IN ('ADMIN', 'SUPERADMIN')
              `, [...companyBranchIds, c.id]);
              
              staffCount = allCompanyUsers.length;
              
              console.log(`[Companies] Company ${c.id} (${c.name}) - Found ${staffCount} staff members from ${companyBranchIds.length} branches:`);
              allCompanyUsers.forEach(u => {
                console.log(`[Companies]   - Staff ID: ${u.id}`);
              });
            } else {
              // No branches - count by companyId only (exact same as backend)
              const allCompanyUsers = query(`
                SELECT DISTINCT id
                FROM users 
                WHERE companyId = ? 
                AND role NOT IN ('ADMIN', 'SUPERADMIN')
              `, [c.id]);
              
              staffCount = allCompanyUsers.length;
              console.log(`[Companies] Company ${c.id} (${c.name}) - Found ${staffCount} staff members (no branches, by companyId only)`);
            }
            
            // CRITICAL FIX: If SQLite returns 0 staff but PostgreSQL is available, check PostgreSQL directly
            // This ensures staff count is accurate even if sync hasn't completed
            if (staffCount === 0 && REMOTE_DATABASE_URL && connectPostgreSQL) {
              try {
                const connected = await checkPostgreSQLConnection();
                if (connected) {
                  console.log(`[Companies] ⚠️ SQLite shows 0 staff - checking PostgreSQL directly...`);
                  const client = await connectPostgreSQL(true);
                  if (client) {
                    // Query PostgreSQL directly using same logic as backend
                    if (companyBranchIds.length > 0) {
                      const pgPlaceholders = companyBranchIds.map((_, i) => `$${i + 1}`).join(',');
                      const pgQuery = `
                        SELECT DISTINCT u.id
                        FROM "users" u
                        WHERE (
                          u."branchId" IN (${pgPlaceholders})
                          OR u."companyId" = $${companyBranchIds.length + 1}
                        )
                        AND u."role" NOT IN ('ADMIN', 'SUPERADMIN')
                      `;
                      const pgResult = await client.query(pgQuery, [...companyBranchIds, c.id]);
                      const pgStaffCount = pgResult.rows.length;
                      
                      if (pgStaffCount > 0) {
                        console.log(`[Companies] ✅ PostgreSQL shows ${pgStaffCount} staff - using PostgreSQL count`);
                        staffCount = pgStaffCount;
                        // Trigger background sync to update SQLite
                        (async () => {
                          try {
                            await pullAllFromPostgreSQL(true);
                            saveDatabase();
                            console.log(`[Companies] ✅ Background sync completed - SQLite updated`);
                          } catch (syncErr) {
                            console.error(`[Companies] ⚠️ Background sync error:`, syncErr.message);
                          }
                        })();
                      } else {
                        console.log(`[Companies] ℹ️ PostgreSQL also shows 0 staff - count is correct`);
                      }
                    } else {
                      // No branches - query by companyId only
                      const pgQuery = `
                        SELECT DISTINCT u.id
                        FROM "users" u
                        WHERE u."companyId" = $1
                        AND u."role" NOT IN ('ADMIN', 'SUPERADMIN')
                      `;
                      const pgResult = await client.query(pgQuery, [c.id]);
                      const pgStaffCount = pgResult.rows.length;
                      
                      if (pgStaffCount > 0) {
                        console.log(`[Companies] ✅ PostgreSQL shows ${pgStaffCount} staff - using PostgreSQL count`);
                        staffCount = pgStaffCount;
                        // Trigger background sync
                        (async () => {
                          try {
                            await pullAllFromPostgreSQL(true);
                            saveDatabase();
                            console.log(`[Companies] ✅ Background sync completed - SQLite updated`);
                          } catch (syncErr) {
                            console.error(`[Companies] ⚠️ Background sync error:`, syncErr.message);
                          }
                        })();
                      }
                    }
                  }
                }
              } catch (pgErr) {
                console.error(`[Companies] ⚠️ PostgreSQL check failed (non-critical):`, pgErr.message);
                // Continue with SQLite count
              }
            }
            
            console.log(`[Companies] Company ${c.id} (${c.name}) - SQLite staff count: ${staffCount} (from ${companyBranchIds.length} branches)`);
            
            // CRITICAL DEBUG: Log if staff count is 0
            if (staffCount === 0) {
              console.log(`[Companies] ⚠️⚠️⚠️ WARNING: Staff count is 0 for company ${c.id} (${c.name})`);
              console.log(`[Companies]   - Company has ${companyBranchIds.length} active branches`);
              console.log(`[Companies]   - Branch IDs:`, companyBranchIds);
              console.log(`[Companies]   - Checking if PostgreSQL fallback is needed...`);
            }
            
            // Also count employees (if employees table exists and has companyId)
            let employeesCount = 0;
            try {
              // Check if employees table exists
              const employeesTableCheck = query("SELECT name FROM sqlite_master WHERE type='table' AND name='employees'");
              if (employeesTableCheck.length > 0) {
                employeesCount = query('SELECT COUNT(*) as c FROM employees WHERE companyId = ? AND (isActive = 1 OR isActive IS NULL)', [c.id])[0]?.c || 0;
              }
            } catch (e) {
              // Employees table might not exist - that's fine
              employeesCount = 0;
            }
    
            console.log(`[Companies] Company ${c.id} - Final counts: branches=${branchCount}, staff=${staffCount}, employees=${employeesCount}`);
    
            return {
              ...c,
              branches: branchesForResponse,
              _count: {
                branches: branchCount,
                users: staffCount, // Fixed: Count staff from branches, not by companyId
                employees: employeesCount,
                products: query('SELECT COUNT(*) as c FROM products WHERE companyId = ? AND isActive = 1', [c.id])[0]?.c || 0
              }
            };
          }));
    
          console.log(`[Companies] ✅ Returning ${result.length} companies with staff counts`);
          res.json({ success: true, data: result });
        } catch (e) {
          console.error('[Companies] GET error:', e);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // GET /api/companies/:id (line 1698)
      app.get('/api/companies/:id', authMiddleware, (req, res) => {
        try {
          const items = query('SELECT * FROM companies WHERE id = ? AND isActive = 1', [req.params.id]);
          if (!items.length) return res.status(404).json({ success: false, message: 'Not found' });
          res.json({ success: true, data: items[0] });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // POST /api/companies (line 1707)
      app.post('/api/companies', authMiddleware, (req, res) => {
        try {
          const user = req.user;
          console.log('[Companies] POST request from user:', user.id, 'Role:', user.role);
          console.log('[Companies] Request body:', req.body);
    
          if (!user || !user.id) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
          }
    
          const { name, description, address, phone, email, businessType = 'PHARMACY' } = req.body;
          if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Company name is required' });
          }
    
          // Check if company name already exists
          const existing = query('SELECT id FROM companies WHERE name = ?', [name.trim()]);
          if (existing.length) {
            console.log('[Companies] Company already exists:', name);
            return res.status(400).json({ success: false, message: 'Company with this name already exists' });
          }
    
          const id = uuid();
          const timestamp = now();
    
          console.log('[Companies] Creating company with:', {
            id,
            name: name.trim(),
            description: description?.trim() || null,
            address: address?.trim() || null,
            phone: phone?.trim() || null,
            email: email?.trim() || null,
            businessType,
            createdBy: user.id,
            isActive: 1
          });
    
          // Insert company with isActive = 1 explicitly
          run(`INSERT INTO companies (id, name, description, address, phone, email, businessType, createdBy, isActive, createdAt, updatedAt)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [id, name.trim(), description?.trim() || null, address?.trim() || null, phone?.trim() || null, email?.trim() || null, businessType, user.id, 1, timestamp, timestamp]);
    
          const company = query('SELECT * FROM companies WHERE id = ?', [id])[0];
    
          if (!company) {
            console.error('[Companies] Company not found after creation');
            return res.status(500).json({ success: false, message: 'Failed to create company' });
          }
    
          console.log('[Companies] ✅ Company created successfully:', {
            id: company.id,
            name: company.name,
            createdBy: company.createdBy
          });
    
          // 🔄 TWO-WAY SYNC: Queue for sync to PostgreSQL
          if (company) {
            handleDataChange('companies', 'create', company);
            console.log('[Companies] Queued for sync to PostgreSQL');
    
            // Trigger immediate sync if online (don't wait for debounce)
            if (getIsOnline()) {
              setTimeout(async () => {
                try {
                  console.log('[Companies] Triggering immediate sync to PostgreSQL...');
                  const client = await connectPostgreSQL();
                  if (client) {
                    await syncTableToPostgreSQL('companies', client);
                    console.log('[Companies] ✅ Immediate sync completed');
                  }
                } catch (e) {
                  console.error('[Companies] Immediate sync error:', e.message);
                }
              }, 500); // Small delay to ensure company is saved
            }

          }
    
          // Format response with branches and counts
          const result = {
            ...company,
            branches: [],
            _count: {
              branches: 0,
              users: 0,
              employees: 0,
              products: 0
            }
          };
    
          res.status(201).json({ success: true, data: result, message: 'Company created successfully' });
        } catch (e) {
          console.error('[Companies] POST error:', e);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // PUT /api/companies/:id (line 1804)
      app.put('/api/companies/:id', authMiddleware, (req, res) => {
        try {
          console.log('[Companies] PUT request for id:', req.params.id, 'body:', req.body);
          const { name, description, address, phone, email, businessType } = req.body;
    
          const updates = [];
          const params = [];
    
          if (name !== undefined && name !== null) {
            updates.push('name = ?');
            params.push(name.trim());
            console.log('[Companies] Updating name to:', name.trim());
          }
          if (description !== undefined && description !== null) {
            updates.push('description = ?');
            params.push(description.trim() || null);
            console.log('[Companies] Updating description');
          }
          if (address !== undefined && address !== null) {
            updates.push('address = ?');
            params.push(address.trim() || null);
            console.log('[Companies] Updating address');
          }
          if (phone !== undefined && phone !== null) {
            updates.push('phone = ?');
            params.push(phone.trim() || null);
            console.log('[Companies] Updating phone');
          }
          if (email !== undefined && email !== null) {
            updates.push('email = ?');
            params.push(email.trim().toLowerCase() || null);
            console.log('[Companies] Updating email');
          }
          if (businessType !== undefined && businessType !== null) {
            updates.push('businessType = ?');
            params.push(businessType);
            console.log('[Companies] Updating businessType to:', businessType);
          }
    
          if (updates.length > 0) {
            // Always update updatedAt
            updates.push('updatedAt = ?');
            params.push(now());
            params.push(req.params.id);
    
            const updateQuery = `UPDATE companies SET ${updates.join(', ')} WHERE id = ?`;
            console.log('[Companies] Update query:', updateQuery);
            console.log('[Companies] Update params:', params);
    
            run(updateQuery, params);
    
            // Save database immediately after update
            saveDatabase();
            console.log('[Companies] ✅ Database saved after update');
          } else {
            console.log('[Companies] ⚠️ No fields to update');
            return res.status(400).json({ success: false, message: 'No fields to update' });
          }
    
          // Verify the update
          const company = query('SELECT * FROM companies WHERE id = ?', [req.params.id])[0];
    
          if (!company) {
            console.error('[Companies] ❌ Company not found after update:', req.params.id);
            return res.status(404).json({ success: false, message: 'Company not found after update' });
          }
    
          console.log('[Companies] ✅ Updated company:', {
            id: company.id,
            name: company.name,
            email: company.email,
            updatedAt: company.updatedAt
          });
    
          // 🔄 TWO-WAY SYNC: Queue for sync to PostgreSQL
          if (company) handleDataChange('companies', 'update', company);
    
          res.json({ success: true, data: company, message: 'Company updated successfully' });
        } catch (e) {
          console.error('[Companies] Update error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // DELETE /api/companies/:id (line 1889)
      app.delete('/api/companies/:id', authMiddleware, (req, res) => {
        try {
          console.log('[Companies] DELETE request for id:', req.params.id);
          const company = query('SELECT * FROM companies WHERE id = ?', [req.params.id])[0];
    
          if (!company) {
            console.log('[Companies] ⚠️ Company not found:', req.params.id);
            return res.status(404).json({ success: false, message: 'Company not found' });
          }
    
          console.log('[Companies] Deleting company:', company.name, 'Current isActive:', company.isActive);
          run('UPDATE companies SET isActive = 0, updatedAt = ? WHERE id = ?', [now(), req.params.id]);
    
          // Save database immediately after delete
          saveDatabase();
          console.log('[Companies] ✅ Database saved after delete');
    
          // Verify the update
          const updatedCompany = query('SELECT * FROM companies WHERE id = ?', [req.params.id])[0];
          console.log('[Companies] ✅ Company after delete - isActive:', updatedCompany?.isActive, 'Name:', updatedCompany?.name);
    
          // 🔄 TWO-WAY SYNC: Queue soft delete for sync
          if (company) handleDataChange('companies', 'update', { ...company, isActive: 0, updatedAt: now() });
    
          res.json({ success: true, message: 'Company deleted successfully' });
        } catch (e) {
          console.error('[Companies] Delete error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // GET /api/companies/:id/stats (line 1921)
      app.get('/api/companies/:id/stats', authMiddleware, (req, res) => {
        try {
          const id = req.params.id;
          res.json({ success: true, data: {
            branches: query('SELECT COUNT(*) as c FROM branches WHERE companyId = ? AND isActive = 1', [id])[0]?.c || 0,
            users: query('SELECT COUNT(*) as c FROM users WHERE companyId = ? AND isActive = 1', [id])[0]?.c || 0,
            products: query('SELECT COUNT(*) as c FROM products WHERE companyId = ? AND isActive = 1', [id])[0]?.c || 0
          }});
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // GET /api/companies/my/list
      app.get('/api/companies/my/list', authMiddleware, (req, res) => {
        try {
          const userId = req.user.id;
          const ownedCompanies = query(
            'SELECT id, name, description, address, phone, email, slug, businessType, createdBy FROM companies WHERE isActive = 1 AND createdBy = ?',
            [userId]
          );

          const owned = ownedCompanies.map(c => ({
            ...c,
            slug: c.slug || null,
            description: c.description || null,
            address: c.address || null,
            phone: c.phone || null,
            email: c.email || null,
            createdBy: c.createdBy || null,
            accessType: 'owned'
          }));

          // Shared businesses: companies the user has an ACTIVE membership for
          // (synced from cloud during provisioning), even when not the creator.
          const sharedRows = query(
            `SELECT c.id, c.name, c.description, c.address, c.phone, c.email, c.slug, c.businessType, c.createdBy,
                    m.role AS memberRole, m.branchIds AS memberBranchIds
             FROM memberships m
             JOIN companies c ON c.id = m.businessId
             WHERE m.userId = ? AND m.status IN ('ACTIVE', 'DOWNLOADED') AND c.isActive = 1`,
            [userId]
          );

          const shared = (sharedRows || []).map(c => ({
            ...c,
            slug: c.slug || null,
            description: c.description || null,
            address: c.address || null,
            phone: c.phone || null,
            email: c.email || null,
            createdBy: c.createdBy || null,
            accessType: 'shared',
            memberRole: (c.memberRole || 'MANAGER').toUpperCase() === 'CASHIER' ? 'CASHIER' : 'MANAGER',
            memberBranchId: (c.memberBranchIds || '').split(',')[0] || null,
          }));

          res.json({ success: true, data: { owned, shared } });
        } catch (e) {
          console.error('[Companies] my/list error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

}

module.exports = {
  registerCompaniesRoutes
};

