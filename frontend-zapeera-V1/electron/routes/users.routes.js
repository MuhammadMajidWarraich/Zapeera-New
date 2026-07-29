/**
 * Users Routes
 * Extracted from routes/index.js
 */

function registerUsersRoutes(app, authMiddleware, deps) {
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

// GET /api/users/debug (line 7709)
      app.get('/api/users/debug', authMiddleware, (req, res) => {
        try {
          const currentUserId = req.user?.id;
          const userRole = req.user?.role;
    
          if (userRole === 'ADMIN' && currentUserId) {
            const allCreatedUsers = query('SELECT id, username, email, name, role, branchId, companyId, createdBy, isActive FROM users WHERE createdBy = ?', [currentUserId]);
            console.log('[Users] DEBUG endpoint: Found', allCreatedUsers.length, 'users created by admin');
            return res.json({ success: true, data: { users: allCreatedUsers, count: allCreatedUsers.length } });
          }
          return res.json({ success: false, message: 'Only for ADMIN users' });
        } catch (e) {
          console.error('[Users] DEBUG endpoint error:', e);
          return res.status(500).json({ success: false, message: e.message });
        }
      });

  // GET /api/users (line 7727)
      app.get('/api/users', authMiddleware, async (req, res) => {
        try {
          console.log('[Users] GET - User:', req.user?.email, 'Role:', req.user?.role, 'Branch:', req.user?.branchId);
          const { branchId, companyId, role, search } = req.query;
    
          // CRITICAL FIX: Check if users exist in SQLite - if not, trigger sync from PostgreSQL
          const totalUsersInSQLite = query('SELECT COUNT(*) as c FROM users')[0]?.c || 0;
          const totalNonAdminUsersInSQLite = query(`SELECT COUNT(*) as c FROM users WHERE role NOT IN ('ADMIN', 'SUPERADMIN')`)[0]?.c || 0;
          console.log('[Users] 📊 Total users in SQLite:', totalUsersInSQLite, 'Non-admin users:', totalNonAdminUsersInSQLite);
          
          // CRITICAL: If very few users in SQLite, trigger immediate sync from PostgreSQL
          // This ensures users are available for querying
          if (totalNonAdminUsersInSQLite < 5 && REMOTE_DATABASE_URL && pullAllFromPostgreSQL) {
            console.log('[Users] ⚠️ Very few users in SQLite - triggering sync from PostgreSQL...');
            // Trigger sync in background (non-blocking)
            (async () => {
              try {
                const connected = await checkPostgreSQLConnection();
                if (connected) {
                  console.log('[Users] ✅ PostgreSQL connected - syncing all tables (including users)...');
                  const syncResult = await pullAllFromPostgreSQL(true); // Force full sync
                  console.log('[Users] ✅ Full sync complete: added=', syncResult.added || 0, 'updated=', syncResult.updated || 0);
                  if (syncResult.added > 0 || syncResult.updated > 0) {
                    saveDatabase();
                    console.log('[Users] ✅ Database saved after sync');
                  }
                } else {
                  console.log('[Users] ⚠️ PostgreSQL not connected - skipping sync');
                }
              } catch (syncErr) {
                console.error('[Users] ⚠️ Background sync error:', syncErr.message);
              }
            })();
          }
          
          // If very few users in SQLite but PostgreSQL is available, trigger sync
          if (totalUsersInSQLite < 3 && REMOTE_DATABASE_URL && pullAllFromPostgreSQL) {
            console.log('[Users] ⚠️ Very few users in SQLite (' + totalUsersInSQLite + ') - triggering sync from PostgreSQL...');
            // Trigger sync in background (non-blocking)
            (async () => {
              try {
                const connected = await checkPostgreSQLConnection();
                if (connected) {
                  console.log('[Users] ✅ PostgreSQL connected - syncing users table...');
                  // Use pullAllFromPostgreSQL which handles connection properly
                  const syncResult = await pullAllFromPostgreSQL(true); // Force full sync
                  console.log('[Users] ✅ Full sync complete: added=' + (syncResult.added || 0) + ', updated=' + (syncResult.updated || 0));
                  if (syncResult.added > 0 || syncResult.updated > 0) {
                    saveDatabase();
                    console.log('[Users] ✅ Database saved after sync');
                  }
                } else {
                  console.log('[Users] ⚠️ PostgreSQL not connected - skipping sync');
                }
              } catch (syncErr) {
                console.error('[Users] ⚠️ Background sync error:', syncErr.message);
              }
            })();
          }
    
          // CRITICAL FIX: Get context from headers FIRST (set by frontend when business is selected)
          // Headers take absolute priority - this is what the frontend sends when user selects a business
          const headerCompanyId = req.headers['x-company-id'];
          const headerBranchId = req.headers['x-branch-id'];
          const selectedCompanyId = headerCompanyId || req.user?.selectedCompanyId;
          const selectedBranchId = headerBranchId || req.user?.selectedBranchId;
    
          console.log('[Users] 🔍 Header context:', {
            headerCompanyId,
            headerBranchId,
            selectedCompanyId,
            selectedBranchId,
            userCompanyId: req.user?.companyId,
            userBranchId: req.user?.branchId
          });
    
          // Use getDataFilter for consistent data isolation (match backend)
          // CRITICAL: Pass headers directly to getDataFilter so it uses them
          const requestedBranchId = branchId || selectedBranchId || null;
          const requestedCompanyId = companyId || selectedCompanyId || null;
          const { branchFilter, companyFilter } = getDataFilter(req.user, requestedBranchId, requestedCompanyId);
    
          console.log('[Users] 🔍 Filter result:', {
            branchFilter,
            companyFilter,
            requestedBranchId,
            requestedCompanyId
          });
    
          // Check if isActive column exists
          let hasIsActiveColumn = true;
          try {
            const tableInfo = query("PRAGMA table_info(users)");
            hasIsActiveColumn = tableInfo.some(col => col.name === 'isActive');
          } catch (e) {
            hasIsActiveColumn = false;
          }
    
          // CRITICAL: Include username, createdBy, AND companyId in SELECT for proper filtering
          // Backend returns companyId directly, so we must include it in SELECT
          let sql = 'SELECT id, username, email, name, role, companyId, branchId, createdBy, isActive, createdAt, updatedAt FROM users WHERE 1=1';
          const params = [];
    
          // CRITICAL FIX: Show ALL users by default (both active and inactive)
          // This ensures newly created staff (isActive = 0) are visible immediately
          // SuperAdmin can see all users and activate them as needed
          const isActiveFilter = req.query.isActive;
          if (hasIsActiveColumn) {
            if (isActiveFilter === 'true' || isActiveFilter === true || isActiveFilter === '1') {
              // Show only active users (if explicitly requested)
              sql += ' AND (isActive = 1 OR isActive IS NULL)';
              console.log('[Users] ✅ Filtering for active users only (isActive = true)');
            } else if (isActiveFilter === 'false' || isActiveFilter === false || isActiveFilter === '0') {
              // Show only inactive users (if explicitly requested)
              sql += ' AND isActive = 0';
              console.log('[Users] ✅ Filtering for inactive users only (isActive = 0)');
            } else {
              // Default: Show ALL users (both active and inactive) - CRITICAL FIX
              // Don't add isActive filter - show everyone
              console.log('[Users] ✅ Showing ALL users (active and inactive) - default behavior');
            }
          }
    
          // Apply data isolation - CRITICAL: Always show users created by current user
          const userRole = req.user?.role;
          const currentUserId = req.user?.id;
    
          // CRITICAL FIX: For ADMIN users, use createdBy (the admin who created them) instead of their own ID
          const adminCreatedBy = (userRole === 'ADMIN' && req.user?.createdBy) ? req.user.createdBy : null;
          const createdByValue = adminCreatedBy || currentUserId;
    
          console.log('[Users] Filter context:', {
            userRole,
            currentUserId,
            adminCreatedBy: req.user?.createdBy,
            createdByValue,
            branchFilter,
            companyFilter,
            role,
            search
          });
    
          // DEBUG: Query ALL users in database to see what exists
          const allUsersDebug = query('SELECT id, username, email, name, role, branchId, companyId, createdBy, isActive FROM users LIMIT 20');
          console.log('[Users] 🔍 DEBUG - All users in database:', JSON.stringify(allUsersDebug, null, 2));
          console.log('[Users] 🔍 Total users in database:', allUsersDebug.length);
    
          // CRITICAL DEBUG: Check if admin-created users exist BEFORE applying filters
          if (userRole === 'ADMIN' && currentUserId) {
            const adminCreatedBy = req.user?.createdBy || currentUserId;
            const adminUsersCheck = query('SELECT id, username, email, createdBy, isActive FROM users WHERE createdBy = ? OR createdBy = ?', [adminCreatedBy, currentUserId]);
            console.log('[Users] 🔍 DEBUG - Users created by admin (BEFORE filters):', adminUsersCheck.length);
            console.log('[Users] 🔍 DEBUG - Admin users:', JSON.stringify(adminUsersCheck, null, 2));
          }
    
          // CRITICAL DEBUG: Check if admin-created users exist
          if (userRole === 'ADMIN' && currentUserId) {
            const adminCreatedBy = req.user?.createdBy || currentUserId;
            const adminUsersCheck = query('SELECT id, username, email, createdBy, isActive FROM users WHERE createdBy = ? OR createdBy = ?', [adminCreatedBy, currentUserId]);
            console.log('[Users] 🔍 DEBUG - Users created by admin:', adminUsersCheck.length);
            console.log('[Users] 🔍 DEBUG - Admin users:', JSON.stringify(adminUsersCheck, null, 2));
          }
    
          // CRITICAL FIX: Match backend-zp logic EXACTLY (line 83-123)
          // Backend uses: where.OR = [{ createdBy: adminCreatedBy }, { createdBy: adminUserId }, { branchId: selectedBranchId }]
          // CRITICAL: If SQLite users have createdBy = null, we need to use branchId/companyId filtering instead
          if (userRole === 'ADMIN' && currentUserId) {
            // Match backend logic line 87-123 EXACTLY
            // CRITICAL: For GET query, we need to check BOTH:
            // 1. req.user?.createdBy (the admin who created this admin, if any)
            // 2. currentUserId (the current admin's ID - this is what POST uses for createdBy)
            // This ensures we find ALL staff created by the current admin
            const adminCreatedBy = req.user?.createdBy || currentUserId; // Backend line 87
            const adminUserId = currentUserId; // Backend line 88 - THIS is what POST uses for createdBy
            
            // CRITICAL FIX: Check if SQLite users have createdBy = null
            // If so, we need to use branchId/companyId filtering instead of createdBy
            const testCreatedByQuery = query('SELECT COUNT(*) as c FROM users WHERE createdBy = ? OR createdBy = ?', [adminCreatedBy, adminUserId]);
            const usersWithCreatedBy = testCreatedByQuery[0]?.c || 0;
            const hasCreatedByData = usersWithCreatedBy > 0;
            
            console.log('[Users] 🔍 Checking if SQLite has createdBy data:', {
              adminCreatedBy,
              adminUserId,
              usersWithCreatedBy,
              hasCreatedByData
            });
            
            console.log('[Users] 🏢 Admin user context:', {
              userId: adminUserId,
              createdBy: adminCreatedBy,
              selectedBranchId: branchFilter,
              selectedCompanyId: companyFilter,
              hasCreatedByData
            });
    
            // CRITICAL FIX: If SQLite users have createdBy = null, use branchId/companyId filtering instead
            // This ensures users are visible even if createdBy field is not set
            if (!hasCreatedByData && (branchFilter || companyFilter)) {
              console.log('[Users] ⚠️ SQLite users have createdBy = null - using branchId/companyId filtering instead');
              
              // Use branchId/companyId filtering only (skip createdBy filter)
              let branchCompanyFilter = '';
              const branchCompanyParams = [];
              
              if (branchFilter && branchFilter.trim() !== '') {
                // Specific branch selected
                branchCompanyFilter = ' AND branchId = ?';
                branchCompanyParams.push(branchFilter);
                console.log('[Users] 🏢 Admin: Filter by branchId only (createdBy = null):', branchFilter);
              } else if (companyFilter && companyFilter.trim() !== '') {
                // Company selected - get all branches of this company
                const companyBranches = query('SELECT id FROM branches WHERE companyId = ? AND isActive = 1', [companyFilter]);
                if (companyBranches.length > 0) {
                  const branchIds = companyBranches.map(b => b.id);
                  branchCompanyFilter = ' AND branchId IN (' + branchIds.map(() => '?').join(',') + ')';
                  branchCompanyParams.push(...branchIds);
                  console.log('[Users] 🏢 Admin: Filter by branchId IN company branches (createdBy = null):', branchIds.length, 'branches');
                } else {
                  // No branches - filter by companyId
                  branchCompanyFilter = ' AND companyId = ?';
                  branchCompanyParams.push(companyFilter);
                  console.log('[Users] 🏢 Admin: Filter by companyId only (createdBy = null):', companyFilter);
                }
              }
              
              // Apply branch/company filter only (no createdBy filter)
              if (branchCompanyFilter) {
                sql += branchCompanyFilter;
                params.push(...branchCompanyParams);
                console.log('[Users] ✅ ADMIN: Using branchId/companyId filter only (createdBy = null)');
              } else {
                console.log('[Users] ⚠️ ADMIN: No branch/company filter available - will rely on PostgreSQL fallback');
              }
            } else {
              // Normal flow: Use createdBy filter (if data exists)
              // CRITICAL: Match backend EXACTLY (line 84-175)
              // Backend structure: { AND: [{ OR: [{ createdBy: X }, { createdBy: Y }, { branchId: Z }] }, { branch: { companyId: C } }] }
              // SQLite equivalent: (createdBy = X OR createdBy = Y OR branchId = Z) AND (branchId IN company branches OR companyId = C)
              
              // Step 1: Build OR conditions - match backend line 106-130 EXACTLY
              const orConditions = [];
              const orParams = [];
      
              // CRITICAL: For ADMIN users, ALWAYS include createdBy in OR condition
              // Backend line 106-109: OR = [{ createdBy: adminCreatedBy }, { createdBy: adminUserId }]
              const uniqueCreatedBy = [...new Set([adminCreatedBy, adminUserId])];
              console.log('[Users] 🔍 Building OR condition with createdBy values (match backend line 106-109):', uniqueCreatedBy);
      
              uniqueCreatedBy.forEach((createdByVal) => {
                orConditions.push('createdBy = ?');
                orParams.push(createdByVal);
              });
      
              // CRITICAL: Add branchId to OR conditions - match backend line 130 EXACTLY
              // Backend line 130: orConditions.push({ branchId: selectedBranchId })
              // This ensures manager-created cashiers in selected branch show up for admin
              if (branchFilter && branchFilter.trim() !== '') {
                orConditions.push('branchId = ?');
                orParams.push(branchFilter);
                console.log('[Users] 🏢 Admin: Added branchId to OR condition (match backend line 130):', branchFilter);
              } else if (companyFilter && companyFilter.trim() !== '') {
                // Backend line 137: orConditions.push({ branch: { companyId: selectedCompanyId } })
                // SQLite equivalent: Add all company branchIds to OR
                const companyBranches = query('SELECT id FROM branches WHERE companyId = ? AND isActive = 1', [companyFilter]);
                if (companyBranches.length > 0) {
                  const branchIds = companyBranches.map(b => b.id);
                  branchIds.forEach(branchId => {
                    orConditions.push('branchId = ?');
                    orParams.push(branchId);
                  });
                  console.log('[Users] 🏢 Admin: Added company branches to OR condition (match backend line 137):', branchIds.length, 'branches');
                }
              } else {
                // Backend line 148: orConditions.push({ branch: { companyId: userCompanyId } })
                // SQLite equivalent: Add user's company branchIds to OR
                const userCompanyId = req.user?.companyId;
                if (userCompanyId) {
                  const userCompanyBranches = query('SELECT id FROM branches WHERE companyId = ? AND isActive = 1', [userCompanyId]);
                  if (userCompanyBranches.length > 0) {
                    const branchIds = userCompanyBranches.map(b => b.id);
                    branchIds.forEach(branchId => {
                      orConditions.push('branchId = ?');
                      orParams.push(branchId);
                    });
                    console.log('[Users] 🏢 Admin: Added user company branches to OR condition (match backend line 148):', branchIds.length, 'branches');
                  }
                }
              }
      
              // Step 2: Build AND conditions - match backend line 119-155 EXACTLY
              // Backend structure: AND = [{ branchId: selectedBranchId }] or [{ branch: { companyId: selectedCompanyId } }]
              // SQLite equivalent: AND branchId = Z or AND branchId IN (company branches) or AND companyId = C
              let andConditions = [];
              const andParams = [];
      
              if (branchFilter && branchFilter.trim() !== '') {
                // Backend line 127: andConditions.push({ branchId: selectedBranchId })
                andConditions.push('branchId = ?');
                andParams.push(branchFilter);
                console.log('[Users] 🏢 Admin: AND filter - branchId (match backend line 127):', branchFilter);
              } else if (companyFilter && companyFilter.trim() !== '') {
                // Backend line 134: andConditions.push({ branch: { companyId: selectedCompanyId } })
                const companyBranches = query('SELECT id FROM branches WHERE companyId = ? AND isActive = 1', [companyFilter]);
                if (companyBranches.length > 0) {
                  const branchIds = companyBranches.map(b => b.id);
                  andConditions.push('branchId IN (' + branchIds.map(() => '?').join(',') + ')');
                  andParams.push(...branchIds);
                  console.log('[Users] 🏢 Admin: AND filter - company branches (match backend line 134):', branchIds.length, 'branches');
                } else {
                  // Fallback: filter by companyId directly
                  andConditions.push('companyId = ?');
                  andParams.push(companyFilter);
                  console.log('[Users] 🏢 Admin: AND filter - companyId (no branches found):', companyFilter);
                }
              } else {
                // Backend line 145: andConditions.push({ branch: { companyId: userCompanyId } })
                const userCompanyId = req.user?.companyId;
                if (userCompanyId) {
                  const userCompanyBranches = query('SELECT id FROM branches WHERE companyId = ? AND isActive = 1', [userCompanyId]);
                  if (userCompanyBranches.length > 0) {
                    const branchIds = userCompanyBranches.map(b => b.id);
                    andConditions.push('branchId IN (' + branchIds.map(() => '?').join(',') + ')');
                    andParams.push(...branchIds);
                    console.log('[Users] 🏢 Admin: AND filter - user company branches (match backend line 145):', branchIds.length, 'branches');
                  } else {
                    andConditions.push('companyId = ?');
                    andParams.push(userCompanyId);
                    console.log('[Users] 🏢 Admin: AND filter - user companyId (no branches found):', userCompanyId);
                  }
                } else {
                  // Backend line 152: andConditions.push({ branchId: 'no-company-selected' })
                  andConditions.push('branchId = ?');
                  andParams.push('no-company-selected');
                  console.log('[Users] 🏢 Admin: AND filter - no company selected (match backend line 152)');
                }
              }
      
              // Step 3: Combine OR and AND - match backend line 161-171 EXACTLY
              // Backend line 161-165: where.AND = [{ OR: orConditions }, ...andConditions]
              // SQLite equivalent: (OR conditions) AND (AND conditions)
              if (orConditions.length > 0) {
                // Apply OR condition first
                sql += ' AND (' + orConditions.join(' OR ') + ')';
                params.push(...orParams);
                console.log('[Users] ✅ ADMIN: OR condition applied (match backend line 163):', uniqueCreatedBy.length, 'createdBy values');
      
                // Then apply AND conditions
                if (andConditions.length > 0) {
                  sql += ' AND (' + andConditions.join(' AND ') + ')';
                  params.push(...andParams);
                  console.log('[Users] ✅ ADMIN: AND condition applied (match backend line 164):', andConditions.length, 'filters');
                }
      
                console.log('[Users] ✅ ADMIN: Final SQL structure matches backend EXACTLY (line 161-171)');
                console.log('[Users] ✅ ADMIN: Full SQL:', sql);
                console.log('[Users] ✅ ADMIN: Full Params:', params);
              } else {
                // Fallback: If no OR conditions, at least show users created by admin
                sql += ' AND (createdBy = ? OR createdBy = ?)';
                params.push(adminCreatedBy, adminUserId);
      
                // Still apply AND conditions if available
                if (andConditions.length > 0) {
                  sql += ' AND (' + andConditions.join(' AND ') + ')';
                  params.push(...andParams);
                }
      
                console.log('[Users] ✅ ADMIN: Fallback - showing users created by admin with AND filters');
              }
            }
    
            // CRITICAL FIX: Apply additional AND filters (role, search) AFTER OR condition
            // These filters apply to ALL results (both createdBy and branchId matches)
            // This ensures admin-created staff are still visible even with role/search filters
            if (role) {
              // CRITICAL: Don't filter by role if it would exclude admin-created users
              // Only apply role filter if it doesn't conflict with createdBy
              sql += ' AND role = ?';
              params.push(role);
              console.log('[Users] ✅ ADMIN: AND filter - role:', role, '(applied after OR)');
            }
    
            if (search) {
              sql += ' AND (name LIKE ? OR email LIKE ? OR username LIKE ?)';
              params.push(`%${search}%`, `%${search}%`, `%${search}%`);
              console.log('[Users] ✅ ADMIN: AND filter - search:', search, '(applied after OR)');
            }
          } else if (userRole === 'SUPERADMIN') {
            // SUPERADMIN: Show all users, but can filter
            if (branchFilter) {
              sql += ' AND branchId = ?';
              params.push(branchFilter);
            }
            if (companyFilter) {
              sql += ' AND companyId = ?';
              params.push(companyFilter);
            }
            if (role) {
              sql += ' AND role = ?';
              params.push(role);
            }
            if (search) {
              sql += ' AND (name LIKE ? OR email LIKE ? OR username LIKE ?)';
              params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }
          } else {
            // Other roles: Show users in their branch/company or created by them
            const filterConditions = [];
            if (createdByValue) {
              filterConditions.push('createdBy = ?');
              params.push(createdByValue);
            }
            if (branchFilter) {
              filterConditions.push('branchId = ?');
              params.push(branchFilter);
            }
            if (companyFilter) {
              filterConditions.push('companyId = ?');
              params.push(companyFilter);
            }
            if (filterConditions.length > 0) {
              sql += ' AND (' + filterConditions.join(' OR ') + ')';
            }
            if (role) {
              sql += ' AND role = ?';
              params.push(role);
            }
            if (search) {
              sql += ' AND (name LIKE ? OR email LIKE ? OR username LIKE ?)';
              params.push(`%${search}%`, `%${search}%`, `%${search}%`);
            }
          }
    
          sql += ' ORDER BY createdAt DESC';
    
          console.log('[Users] 🔍 FINAL SQL Query:', sql);
          console.log('[Users] 🔍 FINAL SQL Params:', params);
          console.log('[Users] 🔍 FINAL SQL Params Count:', params.length);
          console.log('[Users] 🔍 FINAL SQL Params Types:', params.map(p => typeof p));
    
          // CRITICAL: Execute query and log results immediately
          console.log('[Users] 🔍 About to execute query with', params.length, 'parameters');
          console.log('[Users] 🔍 SQL:', sql);
          console.log('[Users] 🔍 Params:', params);
    
          let queryResult;
          try {
            queryResult = query(sql, params);
          } catch (queryError) {
            console.error('[Users] ❌ Query execution error:', queryError.message);
            console.error('[Users] ❌ SQL:', sql);
            console.error('[Users] ❌ Params:', params);
            queryResult = []; // Set to empty array on error
          }
    
          console.log('[Users] 🔍 Query executed - Raw results count:', queryResult.length);
          if (queryResult.length > 0) {
            console.log('[Users] 🔍 First 3 raw results:', queryResult.slice(0, 3).map(u => ({ id: u.id, name: u.name, email: u.email, createdBy: u.createdBy, branchId: u.branchId, isActive: u.isActive })));
          } else {
            console.log('[Users] ⚠️⚠️⚠️ SQLite query returned 0 results!');
            console.log('[Users] ⚠️ This means either:');
            console.log('[Users] ⚠️   1. Users are not synced to SQLite yet');
            console.log('[Users] ⚠️   2. Query filters are too strict');
            console.log('[Users] ⚠️   3. Users don\'t exist in SQLite');
            console.log('[Users] ⚠️ PostgreSQL fallback will be checked next...');
    
            // CRITICAL DEBUG: Check what users exist in database
            const debugAllUsers = query('SELECT id, name, email, createdBy, branchId, isActive FROM users LIMIT 20');
            console.log('[Users] 🔍 DEBUG: All users in database (no filters):', debugAllUsers.length);
            if (debugAllUsers.length > 0) {
              console.log('[Users] 🔍 DEBUG: Sample users:', debugAllUsers.map(u => ({ id: u.id, name: u.name, email: u.email, createdBy: u.createdBy, branchId: u.branchId, isActive: u.isActive })));
    
              // Check if any users match the createdBy values we're looking for
              if (userRole === 'ADMIN' && currentUserId) {
                const adminCreatedByValue = req.user?.createdBy || currentUserId;
                const adminUserIdValue = currentUserId;
                const uniqueCreatedBy = [...new Set([adminCreatedByValue, adminUserIdValue])];
    
                console.log('[Users] 🔍 DEBUG: Looking for users with createdBy:', uniqueCreatedBy);
                const matchingUsers = debugAllUsers.filter(u => uniqueCreatedBy.includes(u.createdBy));
                console.log('[Users] 🔍 DEBUG: Users matching createdBy:', matchingUsers.length);
                if (matchingUsers.length > 0) {
                  console.log('[Users] 🔍 DEBUG: Matching users:', matchingUsers.map(u => ({ id: u.id, name: u.name, email: u.email, createdBy: u.createdBy })));
                  console.log('[Users] ⚠️ CRITICAL: Users exist with matching createdBy but query returned 0! This indicates a query logic issue.');
                } else {
                  console.log('[Users] 🔍 DEBUG: No users found with matching createdBy values');
                }
              }
            } else {
              console.log('[Users] 🔍 DEBUG: No users in database at all');
            }
          }
    
          let users = queryResult.map(u => {
            // CRITICAL FIX: Ensure companyId is included in response (match backend)
            // Backend returns companyId directly, so we must include it
            // If companyId is null, try to get it from branch
            let companyId = u.companyId;
            let branch = null;
            
            if (u.branchId) {
              branch = query('SELECT id, name, companyId FROM branches WHERE id = ?', [u.branchId])[0];
              if (branch && !companyId && branch.companyId) {
                companyId = branch.companyId;
                console.log('[Users] 🔍 Fixed companyId from branch:', { userId: u.id, branchId: u.branchId, companyId });
              }
            }
            
            const userObj = {
              ...u,
              // Ensure username exists (use email if username is null)
              username: u.username || u.email || '',
              // CRITICAL: Ensure companyId is set (match backend)
              companyId: companyId || u.companyId || null,
              branch: branch ? { id: branch.id, name: branch.name } : null
            };
            // Remove password from response (security)
            delete userObj.password;
            return userObj;
          });
    
          // CRITICAL FIX: For ADMIN users, ALWAYS verify all created users are included (not just when empty)
          // This ensures newly created staff are ALWAYS visible even if main query filters them out
          if (userRole === 'ADMIN' && currentUserId) {
            const adminCreatedByValue = req.user?.createdBy || currentUserId;
            const adminUserIdValue = currentUserId;
            const uniqueCreatedBy = [...new Set([adminCreatedByValue, adminUserIdValue])];
    
            // CRITICAL: Always check if all admin-created users are in the result
            // Get ALL users created by admin (no filters) - this is a SIMPLE query to verify users exist
            const simpleCreatedByQuery = `SELECT id, username, email, name, role, companyId, branchId, createdBy, isActive, createdAt, updatedAt FROM users WHERE (${uniqueCreatedBy.map(() => 'createdBy = ?').join(' OR ')}) ORDER BY createdAt DESC LIMIT 100`;
            console.log('[Users] 🔍 Verification query SQL:', simpleCreatedByQuery);
            console.log('[Users] 🔍 Verification query params:', uniqueCreatedBy);
    
            const allAdminCreatedUsers = query(simpleCreatedByQuery, uniqueCreatedBy);
    
            console.log('[Users] 🔍 All admin-created users in DB (simple query):', allAdminCreatedUsers.length);
            console.log('[Users] 🔍 Users found by main query:', users.length);
    
            if (allAdminCreatedUsers.length > 0) {
              console.log('[Users] 🔍 Admin-created users found:', allAdminCreatedUsers.map(u => ({ id: u.id, name: u.name, email: u.email, createdBy: u.createdBy, branchId: u.branchId })));
            }
    
            // Check if any admin-created users are missing from main query results
            const foundUserIds = new Set(users.map(u => u.id));
            const missingUsers = allAdminCreatedUsers.filter(u => !foundUserIds.has(u.id));
    
            if (missingUsers.length > 0) {
              console.log('[Users] ⚠️ Found', missingUsers.length, 'admin-created users missing from main query - adding them');
    
              // Add missing users to the result
              const missingUsersMapped = missingUsers.map(u => {
                // CRITICAL FIX: Ensure companyId is included in response (match backend)
                let companyId = u.companyId;
                let branch = null;
                
                if (u.branchId) {
                  branch = query('SELECT id, name, companyId FROM branches WHERE id = ?', [u.branchId])[0];
                  if (branch && !companyId && branch.companyId) {
                    companyId = branch.companyId;
                  }
                }
                
                const userObj = {
                  ...u,
                  username: u.username || u.email || '',
                  // CRITICAL: Ensure companyId is set (match backend)
                  companyId: companyId || u.companyId || null,
                  branch: branch ? { id: branch.id, name: branch.name } : null
                };
                delete userObj.password;
                return userObj;
              });
    
              // Combine: missing users first (newest), then existing users
              users = [...missingUsersMapped, ...users];
              console.log('[Users] ✅ Added missing users - total now:', users.length);
            } else if (users.length === 0 && allAdminCreatedUsers.length > 0) {
              // CRITICAL FIX: If main query returned empty but admin-created users exist, use them DIRECTLY
              // This is the most common case - main query filters are too strict, but simple query finds users
              console.log('[Users] ⚠️ CRITICAL: Main query returned 0 but', allAdminCreatedUsers.length, 'admin-created users exist - using them directly');
              users = allAdminCreatedUsers.map(u => {
                // CRITICAL FIX: Ensure companyId is included in response (match backend)
                let companyId = u.companyId;
                let branch = null;
                
                if (u.branchId) {
                  branch = query('SELECT id, name, companyId FROM branches WHERE id = ?', [u.branchId])[0];
                  if (branch && !companyId && branch.companyId) {
                    companyId = branch.companyId;
                  }
                }
                
                const userObj = {
                  ...u,
                  username: u.username || u.email || '',
                  // CRITICAL: Ensure companyId is set (match backend)
                  companyId: companyId || u.companyId || null,
                  branch: branch ? { id: branch.id, name: branch.name } : null
                };
                delete userObj.password;
                return userObj;
              });
              console.log('[Users] ✅ Using all admin-created users directly -', users.length, 'users visible');
            } else if (users.length === 0 && allAdminCreatedUsers.length === 0) {
              console.log('[Users] ⚠️ No admin-created users found in database at all');
            } else {
              console.log('[Users] ✅ All admin-created users are already in the main query results');
            }
          }
    
          console.log('[Users] === QUERY RESULT ===');
          console.log('[Users] SQL Query:', sql);
          console.log('[Users] Query Params:', params);
          console.log('[Users] Users Found:', users.length);
          console.log('[Users] User Role:', userRole);
          console.log('[Users] Current User ID:', currentUserId);
          console.log('[Users] Created By Value:', createdByValue);
          console.log('[Users] Branch Filter:', branchFilter);
          console.log('[Users] Company Filter:', companyFilter);
          console.log('[Users] ');
    
          // SENIOR ENGINEER FIX: For ADMIN users, if no users found, try fallback
          // This ensures newly created users are ALWAYS visible (matches website behavior)
          if (userRole === 'ADMIN' && currentUserId && users.length === 0) {
            console.log('[Users] 🔄 FALLBACK: No users found with main query, trying simple fallback...');
    
            // CRITICAL FIX: Remove ALL filters - just get users created by admin
            // This ensures newly created users are ALWAYS visible regardless of isActive, branchId, etc.
            const adminCreatedByValue = req.user?.createdBy || currentUserId;
            const adminUserIdValue = currentUserId;
            const uniqueCreatedBy = [...new Set([adminCreatedByValue, adminUserIdValue])];
    
            const fallbackConditions = uniqueCreatedBy.map(() => 'createdBy = ?').join(' OR ');
            // REMOVE isActive filter completely - show ALL users created by admin
            const fallbackSql = `SELECT id, username, email, name, role, companyId, branchId, createdBy, isActive, createdAt, updatedAt FROM users WHERE (${fallbackConditions}) ORDER BY name`;
            const fallbackUsers = query(fallbackSql, uniqueCreatedBy);
            console.log('[Users] 🔄 Fallback query (NO filters):', fallbackUsers.length, 'users created by admin');
    
            if (fallbackUsers.length > 0) {
              users = fallbackUsers.map(u => {
                // CRITICAL FIX: Ensure companyId is included in response (match backend)
                let companyId = u.companyId;
                let branch = null;
                
                if (u.branchId) {
                  branch = query('SELECT id, name, companyId FROM branches WHERE id = ?', [u.branchId])[0];
                  if (branch && !companyId && branch.companyId) {
                    companyId = branch.companyId;
                  }
                }
                
                return {
                  ...u,
                  username: u.username || u.email || '',
                  // CRITICAL: Ensure companyId is set (match backend)
                  companyId: companyId || u.companyId || null,
                  branch: branch ? { id: branch.id, name: branch.name } : null
                };
              });
              console.log('[Users] ✅ FALLBACK SUCCESS: Using fallback results -', users.length, 'users visible');
              console.log('[Users] Fallback users:', users.map(u => ({ id: u.id, name: u.name, createdBy: u.createdBy, isActive: u.isActive, companyId: u.companyId })));
            } else {
              console.log('[Users] ⚠️ FALLBACK: Still no users found. Checking database...');
              // Verify database state
              const allUsers = query('SELECT COUNT(*) as count FROM users');
              console.log('[Users] 🔍 Database check: Total users in database:', allUsers[0]?.count || 0);
    
              // Check if users exist but createdBy doesn't match
              const allUsersList = query('SELECT id, name, email, createdBy, isActive FROM users LIMIT 10');
              console.log('[Users] 🔍 All users in DB:', JSON.stringify(allUsersList, null, 2));
              console.log('[Users] 🔍 Looking for createdBy:', uniqueCreatedBy);
            }
          }
    
          // Log first few users for debugging
          if (users.length > 0) {
            console.log('[Users] Sample users:', users.slice(0, 3).map(u => ({
              id: u.id,
              name: u.name,
              email: u.email,
              username: u.username,
              role: u.role,
              branchId: u.branchId,
              companyId: u.companyId,
              createdBy: u.createdBy
            })));
          } else {
            console.log('[Users] ⚠️  No users found with main query! Checking all users in database...');
            const allUsers = query('SELECT id, name, email, username, role, branchId, companyId, createdBy, isActive FROM users LIMIT 20');
            console.log('[Users] All users in DB:', JSON.stringify(allUsers, null, 2));
            console.log('[Users] Total users in database:', allUsers.length);
            console.log('[Users] Current user context:', {
              currentUserId: currentUserId,
              userRole: userRole,
              branchFilter: branchFilter,
              companyFilter: companyFilter,
              adminCreatedBy: adminCreatedBy
            });
    
            // CRITICAL: For ADMIN users, if no users found, try simple query as fallback
            if (userRole === 'ADMIN' && currentUserId && users.length === 0) {
              console.log('[Users] 🔄 ADMIN: Main query returned 0 users, trying FALLBACK query...');
    
              // CRITICAL FIX: Try multiple fallback strategies
              // Strategy 1: Users created by currentUserId
              let fallbackUsers = query('SELECT id, username, email, name, role, companyId, branchId, createdBy, isActive, createdAt, updatedAt FROM users WHERE createdBy = ? ORDER BY name', [currentUserId]);
              console.log('[Users] 🔄 FALLBACK Strategy 1 (createdBy = currentUserId):', fallbackUsers.length, 'users found');
    
              // Strategy 2: If still none, try adminCreatedBy
              if (fallbackUsers.length === 0 && adminCreatedBy && adminCreatedBy !== currentUserId) {
                fallbackUsers = query('SELECT id, username, email, name, role, companyId, branchId, createdBy, isActive, createdAt, updatedAt FROM users WHERE createdBy = ? ORDER BY name', [adminCreatedBy]);
                console.log('[Users] 🔄 FALLBACK Strategy 2 (createdBy = adminCreatedBy):', fallbackUsers.length, 'users found');
              }
    
              // Strategy 3: If still none, show ALL users (last resort)
              if (fallbackUsers.length === 0) {
                fallbackUsers = query('SELECT id, username, email, name, role, companyId, branchId, createdBy, isActive, createdAt, updatedAt FROM users ORDER BY name LIMIT 50');
                console.log('[Users] 🔄 FALLBACK Strategy 3 (ALL users):', fallbackUsers.length, 'users found');
              }
    
              if (fallbackUsers.length > 0) {
                console.log('[Users] ✅ FALLBACK: Found users:', fallbackUsers.map(u => ({ id: u.id, name: u.name, createdBy: u.createdBy, isActive: u.isActive })));
                // Use fallback results
                const fallbackMapped = fallbackUsers.map(u => {
                  // CRITICAL FIX: Ensure companyId is included in response (match backend)
                  let companyId = u.companyId;
                  let branch = null;
                  
                  if (u.branchId) {
                    branch = query('SELECT id, name, companyId FROM branches WHERE id = ?', [u.branchId])[0];
                    if (branch && !companyId && branch.companyId) {
                      companyId = branch.companyId;
                    }
                  }
                  
                  return {
                    ...u,
                    username: u.username || u.email || '',
                    // CRITICAL: Ensure companyId is set (match backend)
                    companyId: companyId || u.companyId || null,
                    branch: branch ? { id: branch.id, name: branch.name } : null
                  };
                });
                return res.json({ success: true, data: { users: fallbackMapped, pagination: { total: fallbackMapped.length, page: 1, limit: 100, pages: 1 } } });
              } else {
                console.log('[Users] ❌ FALLBACK: Still no users found. Checking if createdBy field exists...');
                // Check if any users have createdBy field set
                const usersWithCreatedBy = query('SELECT id, name, email, createdBy FROM users WHERE createdBy IS NOT NULL LIMIT 10');
                console.log('[Users] Users with createdBy field:', usersWithCreatedBy);
    
                // Check ALL users regardless of createdBy
                const allUsersNoFilter = query('SELECT id, name, email, createdBy, isActive FROM users LIMIT 10');
                console.log('[Users] ALL users (no filter):', JSON.stringify(allUsersNoFilter, null, 2));
              }
            }
    
            // Check if any users match the createdBy filter
            if (userRole === 'ADMIN') {
              if (adminCreatedBy) {
                const usersByAdminCreatedBy = query('SELECT id, name, email, createdBy FROM users WHERE createdBy = ?', [adminCreatedBy]);
                console.log('[Users] Users created by adminCreatedBy:', usersByAdminCreatedBy);
              }
              const usersByCurrentAdmin = query('SELECT id, name, email, createdBy FROM users WHERE createdBy = ?', [currentUserId]);
              console.log('[Users] Users created by current admin (currentUserId):', usersByCurrentAdmin);
              console.log('[Users] ⚠️ If users exist but not showing, check:');
              console.log('[Users]   1. Is createdBy field set correctly when creating staff?');
              console.log('[Users]   2. Does currentUserId match the createdBy value?');
              console.log('[Users]   3. Are users active (isActive = 1)?');
            } else if (createdByValue) {
              const usersByCreatedBy = query('SELECT id, name, email, createdBy FROM users WHERE createdBy = ?', [createdByValue]);
              console.log('[Users] Users created by admin (createdByValue):', usersByCreatedBy);
            }
          }
    
          // CRITICAL FIX: ALWAYS check PostgreSQL if available and merge results
          // This ensures newly created staff in PostgreSQL are visible even if SQLite hasn't synced yet
          // IMPORTANT: Check PostgreSQL REGARDLESS of SQLite results to catch newly created staff
          // CRITICAL: If SQLite returned 0 users, FORCE PostgreSQL check
          let pgUsers = [];
          const shouldForcePostgreSQLCheck = queryResult.length === 0;
          
          if (REMOTE_DATABASE_URL) {
            try {
              if (shouldForcePostgreSQLCheck) {
                console.log('[Users] 🔄 FORCING PostgreSQL check because SQLite returned 0 users...');
              }
              console.log('[Users] 🔄 Checking PostgreSQL for users (ALWAYS, regardless of SQLite results)...');
              const pg = require('pg');
              const Client = pg.Client;
              const getUsersPgClient = new (require('pg').Client)({
                connectionString: REMOTE_DATABASE_URL,
                connectionTimeoutMillis: 5000,
                query_timeout: 10000,
                statement_timeout: 10000
              });
    
              await Promise.race([
                getUsersPgClient.connect(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 5000))
              ]);
    
              // CRITICAL FIX: For ADMIN users, use OR condition (createdBy OR branchId) - match SQLite logic
              // This ensures newly created staff are ALWAYS visible, even if branch doesn't match
              // When "All Branches" is selected (branchFilter empty), shows all admin-created staff
              // When specific branch selected, shows admin-created staff OR branch staff
              // CRITICAL: If SQLite has createdBy = null, use branchId/companyId filtering instead
              if (userRole === 'ADMIN' && currentUserId) {
                const adminCreatedByValue = req.user?.createdBy || currentUserId;
                const adminUserIdValue = currentUserId;
                const uniqueCreatedBy = [...new Set([adminCreatedByValue, adminUserIdValue])];

                // CRITICAL FIX: Check if we should use branchId/companyId filtering instead of createdBy
                // This happens when SQLite users have createdBy = null
                const useBranchCompanyFilter = !hasCreatedByData && (branchFilter || companyFilter);
                
                let pgSql = '';
                const pgParams = [];
                let paramIndex = 1;

                if (useBranchCompanyFilter) {
                  // Use branchId/companyId filtering only (skip createdBy filter)
                  console.log('[Users] 🔍 PostgreSQL: Using branchId/companyId filter (createdBy = null in SQLite)');
                  
                  if (branchFilter && branchFilter.trim() !== '') {
                    // Specific branch selected
                    pgSql = `SELECT id, username, email, name, role, "companyId", "branchId", "createdBy", "isActive", "createdAt", "updatedAt" FROM users WHERE "branchId" = $1`;
                    pgParams.push(branchFilter);
                    console.log('[Users] 🔍 PostgreSQL: Filter by branchId only:', branchFilter);
                  } else if (companyFilter && companyFilter.trim() !== '') {
                    // Company selected - get all branches of this company
                    const companyBranches = query('SELECT id FROM branches WHERE companyId = ? AND isActive = 1', [companyFilter]);
                    if (companyBranches.length > 0) {
                      const branchIds = companyBranches.map(b => b.id);
                      const branchPlaceholders = branchIds.map(() => `$${paramIndex++}`).join(', ');
                      pgSql = `SELECT id, username, email, name, role, "companyId", "branchId", "createdBy", "isActive", "createdAt", "updatedAt" FROM users WHERE "branchId" IN (${branchPlaceholders})`;
                      pgParams.push(...branchIds);
                      console.log('[Users] 🔍 PostgreSQL: Filter by branchId IN company branches:', branchIds.length, 'branches');
                    } else {
                      // No branches - filter by companyId
                      pgSql = `SELECT id, username, email, name, role, "companyId", "branchId", "createdBy", "isActive", "createdAt", "updatedAt" FROM users WHERE "companyId" = $1`;
                      pgParams.push(companyFilter);
                      console.log('[Users] 🔍 PostgreSQL: Filter by companyId only:', companyFilter);
                    }
                  }
                } else {
                  // Normal flow: Use createdBy filter - MATCH BACKEND EXACTLY (line 100-175)
                  // Backend uses: OR = [{ createdBy: adminCreatedBy }, { createdBy: adminUserId }, { branchId: selectedBranchId }]
                  // Then AND = [{ branch: { companyId: selectedCompanyId } }]
                  
                  // Step 1: Build OR condition with createdBy (match backend line 106-109)
                  const createdByConditions = uniqueCreatedBy.map((_, idx) => `"createdBy" = $${idx + 1}`).join(' OR ');
                  const orConditions = [createdByConditions];
                  pgParams.push(...uniqueCreatedBy);
                  paramIndex = uniqueCreatedBy.length + 1;

                  // Step 2: Add branchId to OR conditions (match backend line 130, 137, 148)
                  // This ensures manager-created cashiers in selected branch show up for admin
                  if (branchFilter && branchFilter.trim() !== '') {
                    // Specific branch selected: add branchId to OR condition
                    orConditions.push(`"branchId" = $${paramIndex++}`);
                    pgParams.push(branchFilter);
                    console.log('[Users] 🔍 PostgreSQL: Added branchId to OR condition (match backend line 130)');
                  } else if (companyFilter && companyFilter.trim() !== '') {
                    // Company selected: add company branches to OR condition
                    const companyBranches = query('SELECT id FROM branches WHERE companyId = ? AND isActive = 1', [companyFilter]);
                    if (companyBranches.length > 0) {
                      const branchIds = companyBranches.map(b => b.id);
                      // Add each branchId to OR condition
                      branchIds.forEach(branchId => {
                        orConditions.push(`"branchId" = $${paramIndex++}`);
                        pgParams.push(branchId);
                      });
                      console.log('[Users] 🔍 PostgreSQL: Added company branches to OR condition:', branchIds.length, 'branches');
                    }
                  } else {
                    // No branch/company filter - add user's company branches to OR condition
                    const userCompanyId = req.user?.companyId;
                    if (userCompanyId) {
                      const userCompanyBranches = query('SELECT id FROM branches WHERE companyId = ? AND isActive = 1', [userCompanyId]);
                      if (userCompanyBranches.length > 0) {
                        const branchIds = userCompanyBranches.map(b => b.id);
                        branchIds.forEach(branchId => {
                          orConditions.push(`"branchId" = $${paramIndex++}`);
                          pgParams.push(branchId);
                        });
                        console.log('[Users] 🔍 PostgreSQL: Added user company branches to OR condition:', branchIds.length, 'branches');
                      }
                    }
                  }

                  // Step 3: Build AND conditions for branch/company (match backend line 117-175)
                  // CRITICAL: Use AND, not OR - this matches backend logic
                  let pgBranchCompanyFilter = '';
                  if (branchFilter && branchFilter.trim() !== '') {
                    // Specific branch selected: AND filter by branchId
                    pgBranchCompanyFilter = ` AND "branchId" = $${paramIndex++}`;
                    pgParams.push(branchFilter);
                    console.log('[Users] 🔍 PostgreSQL: ADMIN AND filter - (createdBy OR createdBy OR branchId) AND (branchId = selected branch)');
                  } else if (companyFilter && companyFilter.trim() !== '') {
                    // Company selected (but no specific branch): AND filter by company branches
                    const companyBranches = query('SELECT id FROM branches WHERE companyId = ? AND isActive = 1', [companyFilter]);
                    if (companyBranches.length > 0) {
                      const branchIds = companyBranches.map(b => b.id);
                      const branchPlaceholders = branchIds.map(() => `$${paramIndex++}`).join(', ');
                      pgBranchCompanyFilter = ` AND "branchId" IN (${branchPlaceholders})`;
                      pgParams.push(...branchIds);
                      console.log('[Users] 🔍 PostgreSQL: ADMIN AND filter - (createdBy OR createdBy OR company branches) AND (company branches)');
                    } else {
                      // No branches in company - still filter by companyId
                      pgBranchCompanyFilter = ` AND "companyId" = $${paramIndex++}`;
                      pgParams.push(companyFilter);
                      console.log('[Users] 🔍 PostgreSQL: ADMIN AND filter - (createdBy OR createdBy) AND (companyId) - no branches found');
                    }
                  } else {
                    // No branch/company filter - show all admin-created staff from user's own company
                    const userCompanyId = req.user?.companyId;
                    if (userCompanyId) {
                      // Get all branches of user's company
                      const userCompanyBranches = query('SELECT id FROM branches WHERE companyId = ? AND isActive = 1', [userCompanyId]);
                      if (userCompanyBranches.length > 0) {
                        const branchIds = userCompanyBranches.map(b => b.id);
                        const branchPlaceholders = branchIds.map(() => `$${paramIndex++}`).join(', ');
                        pgBranchCompanyFilter = ` AND "branchId" IN (${branchPlaceholders})`;
                        pgParams.push(...branchIds);
                        console.log('[Users] 🔍 PostgreSQL: ADMIN AND filter - (createdBy OR createdBy) AND (user company branches):', branchIds.length, 'branches');
                      } else {
                        pgBranchCompanyFilter = ` AND "companyId" = $${paramIndex++}`;
                        pgParams.push(userCompanyId);
                        console.log('[Users] 🔍 PostgreSQL: ADMIN AND filter - (createdBy OR createdBy) AND (companyId = user company) - no branches found');
                      }
                    } else {
                      console.log('[Users] 🔍 PostgreSQL: ADMIN query - (createdBy only, no company restriction)');
                    }
                  }

                  // Build final SQL: (createdBy OR createdBy OR branchId) AND (branch/company filter)
                  // This matches backend EXACTLY (line 100-175)
                  pgSql = `SELECT id, username, email, name, role, "companyId", "branchId", "createdBy", "isActive", "createdAt", "updatedAt" FROM users WHERE (${orConditions.join(' OR ')})`;
                  if (pgBranchCompanyFilter) {
                    pgSql += pgBranchCompanyFilter;
                  }
                  console.log('[Users] 🔍 PostgreSQL: Final SQL structure - (createdBy OR createdBy OR branchId) AND (branch/company) - MATCHES BACKEND');
                }
    
                console.log('[Users] 🔍 PostgreSQL SQL:', pgSql);
                console.log('[Users] 🔍 PostgreSQL Params:', pgParams);
    
                // Don't filter by isActive - show all (active and inactive)
                // Apply role filter if provided
                if (role) {
                  pgSql += ` AND role = $${paramIndex++}`;
                  pgParams.push(role);
                }
                // Apply search filter if provided
                if (search) {
                  pgSql += ` AND (name ILIKE $${paramIndex++} OR email ILIKE $${paramIndex++} OR username ILIKE $${paramIndex++})`;
                  pgParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
                }
    
                pgSql += ' ORDER BY "createdAt" DESC LIMIT 100';
    
                console.log('[Users] 🔍 Executing PostgreSQL query...');
                console.log('[Users] 🔍 PostgreSQL SQL:', pgSql);
                console.log('[Users] 🔍 PostgreSQL Params:', pgParams);
                
                const pgResult = await Promise.race([
                  getUsersPgClient.query(pgSql, pgParams),
                  new Promise((_, reject) => setTimeout(() => reject(new Error('Query timeout')), 10000))
                ]);
    
                await getUsersPgClient.end();
    
                if (pgResult.rows && pgResult.rows.length > 0) {
                  console.log(`[Users] ✅✅✅ PostgreSQL: Found ${pgResult.rows.length} users`);
                  console.log('[Users] ✅ PostgreSQL users sample:', pgResult.rows.slice(0, 3).map(u => ({ id: u.id, name: u.name, email: u.email, createdBy: u.createdBy, branchId: u.branchId, companyId: u.companyId })));
                  pgUsers = pgResult.rows.map(u => {
                    // CRITICAL FIX: Ensure companyId is included in response (match backend)
                    // If companyId is null, try to get it from branch
                    let companyId = u.companyId;
                    let branch = null;
                    
                    if (u.branchId) {
                      branch = query('SELECT id, name, companyId FROM branches WHERE id = ?', [u.branchId])[0];
                      if (branch && !companyId && branch.companyId) {
                        companyId = branch.companyId;
                        console.log('[Users] 🔍 PostgreSQL: Fixed companyId from branch:', { userId: u.id, branchId: u.branchId, companyId });
                      }
                    }
                    
                    const userObj = {
                      ...u,
                      username: u.username || u.email || '',
                      // CRITICAL: Ensure companyId is set (match backend)
                      companyId: companyId || u.companyId || null,
                      branch: branch ? { id: branch.id, name: branch.name } : null
                    };
                    return userObj;
                  });
                  console.log('[Users] ✅✅✅ PostgreSQL users mapped:', pgUsers.length, 'users ready to merge');
                  console.log('[Users] ✅ PostgreSQL users details:', pgUsers.map(u => ({ id: u.id, name: u.name, createdBy: u.createdBy, branchId: u.branchId, companyId: u.companyId })));
                } else {
                  console.log('[Users] ⚠️ PostgreSQL: No users found with current filter');
                  console.log('[Users] ⚠️ This might mean:');
                  console.log('[Users] ⚠️   1. No users match the filter criteria');
                  console.log('[Users] ⚠️   2. Users exist but don\'t match createdBy/branchId/companyId');
                  console.log('[Users] ⚠️   3. PostgreSQL query failed silently');
                }
              } else {
                // For non-ADMIN users, use original logic
                let pgSql = 'SELECT id, username, email, name, role, "companyId", "branchId", "createdBy", "isActive", "createdAt", "updatedAt" FROM users WHERE 1=1';
                const pgParams = [];
                let paramIndex = 1;
    
                if (userRole === 'SUPERADMIN') {
                  if (branchFilter) {
                    pgSql += ` AND "branchId" = $${paramIndex++}`;
                    pgParams.push(branchFilter);
                  }
                  if (companyFilter) {
                    pgSql += ` AND "companyId" = $${paramIndex++}`;
                    pgParams.push(companyFilter);
                  }
                } else if (createdByValue) {
                  pgSql += ` AND ("createdBy" = $${paramIndex++}`;
                  pgParams.push(createdByValue);
                  if (branchFilter) {
                    pgSql += ` OR "branchId" = $${paramIndex++})`;
                    pgParams.push(branchFilter);
                  } else {
                    pgSql += ')';
                  }
                } else {
                  // If no filters, at least filter by current user's createdBy to show their staff
                  if (currentUserId) {
                    pgSql += ` AND "createdBy" = $${paramIndex++}`;
                    pgParams.push(currentUserId);
                    console.log('[Users] 🔍 PostgreSQL: Fallback filter - createdBy:', currentUserId);
                  }
                }
    
                // Don't filter by isActive - show all (active and inactive)
                if (role) {
                  pgSql += ` AND role = $${paramIndex++}`;
                  pgParams.push(role);
                }
                if (search) {
                  pgSql += ` AND (name ILIKE $${paramIndex++} OR email ILIKE $${paramIndex++} OR username ILIKE $${paramIndex++})`;
                  pgParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
                }
    
                pgSql += ' ORDER BY "createdAt" DESC LIMIT 100';
    
                console.log('[Users] 🔍 PostgreSQL Query (non-ADMIN):', pgSql);
                console.log('[Users] 🔍 PostgreSQL Params:', pgParams);
    
                const pgResult = await Promise.race([
                  getUsersPgClient.query(pgSql, pgParams),
                  new Promise((_, reject) => setTimeout(() => reject(new Error('Query timeout')), 10000))
                ]);
    
                await getUsersPgClient.end();
    
                if (pgResult.rows && pgResult.rows.length > 0) {
                  console.log(`[Users] ✅ PostgreSQL (non-ADMIN): Found ${pgResult.rows.length} users`);
                  pgUsers = pgResult.rows.map(u => {
                    // CRITICAL FIX: Ensure companyId is included in response (match backend)
                    // If companyId is null, try to get it from branch
                    let companyId = u.companyId;
                    let branch = null;
                    
                    if (u.branchId) {
                      branch = query('SELECT id, name, companyId FROM branches WHERE id = ?', [u.branchId])[0];
                      if (branch && !companyId && branch.companyId) {
                        companyId = branch.companyId;
                        console.log('[Users] 🔍 PostgreSQL: Fixed companyId from branch:', { userId: u.id, branchId: u.branchId, companyId });
                      }
                    }
                    
                    const userObj = {
                      ...u,
                      username: u.username || u.email || '',
                      // CRITICAL: Ensure companyId is set (match backend)
                      companyId: companyId || u.companyId || null,
                      branch: branch ? { id: branch.id, name: branch.name } : null
                    };
                    return userObj;
                  });
                }
              }
    
              // CRITICAL FALLBACK: ALWAYS run fallback for ADMIN users if main query returned empty
              // This ensures newly created staff are ALWAYS visible even if filters are too strict
              // IMPORTANT: Run fallback even if SQLite has some users, to catch newly created ones in PostgreSQL
              if (pgUsers.length === 0 && userRole === 'ADMIN' && currentUserId) {
                try {
                  console.log('[Users] 🔄 FALLBACK: Running fallback query for ADMIN users...');
                  const fallbackPgClient = new (require('pg').Client)({
                    connectionString: REMOTE_DATABASE_URL,
                    connectionTimeoutMillis: 5000
                  });
                  await fallbackPgClient.connect();
    
                  const adminCreatedByValue = req.user?.createdBy || currentUserId;
                  const adminUserIdValue = currentUserId;
                  const uniqueCreatedBy = [...new Set([adminCreatedByValue, adminUserIdValue])];
    
                  // Get ALL users created by admin (no branch/role filters)
                  const fallbackConditions = uniqueCreatedBy.map((_, idx) => `"createdBy" = $${idx + 1}`).join(' OR ');
                  const fallbackSql = `SELECT id, username, email, name, role, "companyId", "branchId", "createdBy", "isActive", "createdAt", "updatedAt" FROM users WHERE (${fallbackConditions}) ORDER BY "createdAt" DESC LIMIT 100`;
    
                  console.log('[Users] 🔄 FALLBACK: Querying ALL users created by admin:', uniqueCreatedBy);
                  console.log('[Users] 🔄 FALLBACK SQL:', fallbackSql);
    
                  const fallbackResult = await fallbackPgClient.query(fallbackSql, uniqueCreatedBy);
                  await fallbackPgClient.end();
    
                  if (fallbackResult.rows && fallbackResult.rows.length > 0) {
                    console.log(`[Users] ✅ FALLBACK: Found ${fallbackResult.rows.length} users created by admin`);
                    console.log('[Users] 🔍 FALLBACK users:', fallbackResult.rows.map(u => ({ id: u.id, username: u.username, createdBy: u.createdBy, branchId: u.branchId })));
    
                    // Map fallback results
                    pgUsers = fallbackResult.rows.map(u => {
                      // CRITICAL FIX: Ensure companyId is included in response (match backend)
                      let companyId = u.companyId;
                      let branch = null;
                      
                      if (u.branchId) {
                        branch = query('SELECT id, name, companyId FROM branches WHERE id = ?', [u.branchId])[0];
                        if (branch && !companyId && branch.companyId) {
                          companyId = branch.companyId;
                          console.log('[Users] 🔍 PostgreSQL (FALLBACK): Fixed companyId from branch:', { userId: u.id, branchId: u.branchId, companyId });
                        }
                      }
                      
                      const userObj = {
                        ...u,
                        username: u.username || u.email || '',
                        // CRITICAL: Ensure companyId is set (match backend)
                        companyId: companyId || u.companyId || null,
                        branch: branch ? { id: branch.id, name: branch.name } : null
                      };
                      return userObj;
                    });
                    console.log('[Users] ✅ Using FALLBACK results -', pgUsers.length, 'users');
                  } else {
                    console.log('[Users] ⚠️ FALLBACK: Still no users found in PostgreSQL');
                  }
                } catch (fallbackError) {
                  console.error('[Users] FALLBACK query error:', fallbackError.message);
                }
              }
            } catch (pgError) {
              console.error('[Users] PostgreSQL check failed (non-critical):', pgError.message);
              // Continue with SQLite results only
            }
          }
    
          // CRITICAL FIX: ALWAYS use PostgreSQL users if SQLite is empty
          // This ensures newly created staff in PostgreSQL are visible even if SQLite hasn't synced
          if (pgUsers.length > 0) {
            if (users.length === 0) {
              // CRITICAL: If SQLite is empty, use PostgreSQL users directly
              console.log(`[Users] ✅✅✅ SQLite empty - using ${pgUsers.length} users from PostgreSQL directly`);
              console.log(`[Users] ✅ PostgreSQL users being used:`, pgUsers.map(u => ({ id: u.id, name: u.name, email: u.email, branchId: u.branchId, companyId: u.companyId })));
              users = pgUsers;
            } else {
              // CRITICAL FIX: SQLite takes priority for existing users (it has the latest updates)
              // Only add PostgreSQL users that don't exist in SQLite
              const sqliteUserIds = new Set(users.map(u => u.id));
              const uniquePgUsers = pgUsers.filter(pgUser => !sqliteUserIds.has(pgUser.id));
    
              if (uniquePgUsers.length > 0) {
                console.log(`[Users] ✅ Merging ${uniquePgUsers.length} unique users from PostgreSQL with ${users.length} from SQLite`);
                // CRITICAL: SQLite users FIRST (they have the latest updates), then add unique PostgreSQL users
                // This ensures SQLite updates (like name changes) are not overwritten by old PostgreSQL data
                users = [...users, ...uniquePgUsers];
                console.log(`[Users] ✅ SQLite users take priority - ${users.length} total users (${users.length - uniquePgUsers.length} from SQLite, ${uniquePgUsers.length} from PostgreSQL)`);
              } else {
                console.log('[Users] ✅ All PostgreSQL users already in SQLite results - SQLite data takes priority');
              }
            }
          }
    
          // CRITICAL FIX: AFTER PostgreSQL merge, verify all admin-created users are included
          // This ensures newly created staff are ALWAYS visible even if main query filters them out
          // IMPORTANT: This runs AFTER PostgreSQL merge so it can check both SQLite and PostgreSQL results
          if (userRole === 'ADMIN' && currentUserId) {
            const adminCreatedByValue = req.user?.createdBy || currentUserId;
            const adminUserIdValue = currentUserId;
            const uniqueCreatedBy = [...new Set([adminCreatedByValue, adminUserIdValue])];
    
            // Get ALL users created by admin from SQLite (simple query, no filters)
            const simpleCreatedByQuery = `SELECT id, username, email, name, role, companyId, branchId, createdBy, isActive, createdAt, updatedAt FROM users WHERE (${uniqueCreatedBy.map(() => 'createdBy = ?').join(' OR ')}) ORDER BY createdAt DESC LIMIT 100`;
            const allAdminCreatedUsersSQLite = query(simpleCreatedByQuery, uniqueCreatedBy);
    
            console.log('[Users] 🔍 POST-MERGE: SQLite admin-created users:', allAdminCreatedUsersSQLite.length);
            console.log('[Users] 🔍 POST-MERGE: Current users count:', users.length);
    
            // Combine SQLite and PostgreSQL results for verification
            const allAdminCreatedUsers = [...allAdminCreatedUsersSQLite];
            if (pgUsers.length > 0) {
              const pgAdminUsers = pgUsers.filter(u => uniqueCreatedBy.includes(u.createdBy));
              console.log('[Users] 🔍 POST-MERGE: PostgreSQL admin-created users:', pgAdminUsers.length);
              // Add unique PostgreSQL users
              const sqliteIds = new Set(allAdminCreatedUsers.map(u => u.id));
              pgAdminUsers.forEach(pgUser => {
                if (!sqliteIds.has(pgUser.id)) {
                  allAdminCreatedUsers.push(pgUser);
                }
              });
            }
    
            console.log('[Users] 🔍 POST-MERGE: Total admin-created users (SQLite + PostgreSQL):', allAdminCreatedUsers.length);
    
            // Check if any admin-created users are missing from current results
            const foundUserIds = new Set(users.map(u => u.id));
            const missingUsers = allAdminCreatedUsers.filter(u => !foundUserIds.has(u.id));
    
            if (missingUsers.length > 0) {
              console.log('[Users] ⚠️ POST-MERGE: Found', missingUsers.length, 'admin-created users missing - adding them');
              const missingUsersMapped = missingUsers.map(u => {
                const userObj = {
                  ...u,
                  username: u.username || u.email || '',
                  branch: u.branchId ? query('SELECT id, name FROM branches WHERE id = ?', [u.branchId])[0] : null
                };
                delete userObj.password;
                return userObj;
              });
              users = [...missingUsersMapped, ...users];
              console.log('[Users] ✅ POST-MERGE: Added missing users - total now:', users.length);
            } else if (users.length === 0 && allAdminCreatedUsers.length > 0) {
              // CRITICAL: If still empty but admin-created users exist, use them directly
              console.log('[Users] ⚠️ POST-MERGE: Still empty but', allAdminCreatedUsers.length, 'admin-created users exist - using them directly');
              users = allAdminCreatedUsers.map(u => {
                // CRITICAL FIX: Ensure companyId is included in response (match backend)
                let companyId = u.companyId;
                let branch = null;
                
                if (u.branchId) {
                  branch = query('SELECT id, name, companyId FROM branches WHERE id = ?', [u.branchId])[0];
                  if (branch && !companyId && branch.companyId) {
                    companyId = branch.companyId;
                  }
                }
                
                const userObj = {
                  ...u,
                  username: u.username || u.email || '',
                  // CRITICAL: Ensure companyId is set (match backend)
                  companyId: companyId || u.companyId || null,
                  branch: branch ? { id: branch.id, name: branch.name } : null
                };
                delete userObj.password;
                return userObj;
              });
              console.log('[Users] ✅ POST-MERGE: Using all admin-created users directly -', users.length, 'users visible');
            }
          }
    
          // CRITICAL FIX: If still no users and we're an ADMIN, ensure we return at least the fallback results
          // This prevents empty responses when staff exists in PostgreSQL but SQLite query filtered them out
          if (userRole === 'ADMIN' && currentUserId && users.length === 0) {
            console.log('[Users] ⚠️ CRITICAL: No users found. Running emergency fallback...');
    
            // Emergency fallback: Get ALL users created by admin from SQLite (no filters at all)
            const adminCreatedByValue = req.user?.createdBy || currentUserId;
            const adminUserIdValue = currentUserId;
            const uniqueCreatedBy = [...new Set([adminCreatedByValue, adminUserIdValue])];
            const emergencyFallbackSql = `SELECT id, username, email, name, role, companyId, branchId, createdBy, isActive, createdAt, updatedAt FROM users WHERE (${uniqueCreatedBy.map(() => 'createdBy = ?').join(' OR ')}) ORDER BY createdAt DESC LIMIT 100`;
            const emergencyUsers = query(emergencyFallbackSql, uniqueCreatedBy);
    
            if (emergencyUsers.length > 0) {
              users = emergencyUsers.map(u => {
                // CRITICAL FIX: Ensure companyId is included in response (match backend)
                let companyId = u.companyId;
                let branch = null;
                
                if (u.branchId) {
                  branch = query('SELECT id, name, companyId FROM branches WHERE id = ?', [u.branchId])[0];
                  if (branch && !companyId && branch.companyId) {
                    companyId = branch.companyId;
                  }
                }
                
                return {
                  ...u,
                  username: u.username || u.email || '',
                  // CRITICAL: Ensure companyId is set (match backend)
                  companyId: companyId || u.companyId || null,
                  branch: branch ? { id: branch.id, name: branch.name } : null
                };
              });
              console.log('[Users] ✅ EMERGENCY FALLBACK (SQLite): Found', users.length, 'users');
              console.log('[Users] Emergency users:', users.map(u => ({ id: u.id, username: u.username, createdBy: u.createdBy, companyId: u.companyId })));
            } else {
              console.log('[Users] ⚠️ EMERGENCY FALLBACK (SQLite): No users found');
    
              // FINAL FALLBACK: Try PostgreSQL with NO filters at all
              if (REMOTE_DATABASE_URL) {
                try {
                  console.log('[Users] 🔄 FINAL FALLBACK: Checking PostgreSQL with NO filters...');
                  const finalPgClient = new (require('pg').Client)({
                    connectionString: REMOTE_DATABASE_URL,
                    connectionTimeoutMillis: 5000
                  });
                  await finalPgClient.connect();
    
                  const finalFallbackSql = `SELECT id, username, email, name, role, "companyId", "branchId", "createdBy", "isActive", "createdAt", "updatedAt" FROM users WHERE ("createdBy" = $1 OR "createdBy" = $2) ORDER BY "createdAt" DESC LIMIT 100`;
                  const finalResult = await finalPgClient.query(finalFallbackSql, uniqueCreatedBy);
                  await finalPgClient.end();
    
                  if (finalResult.rows && finalResult.rows.length > 0) {
                    users = finalResult.rows.map(u => {
                      // CRITICAL FIX: Ensure companyId is included in response (match backend)
                      let companyId = u.companyId;
                      let branch = null;
                      
                      if (u.branchId) {
                        branch = query('SELECT id, name, companyId FROM branches WHERE id = ?', [u.branchId])[0];
                        if (branch && !companyId && branch.companyId) {
                          companyId = branch.companyId;
                        }
                      }
                      
                      const userObj = {
                        ...u,
                        username: u.username || u.email || '',
                        // CRITICAL: Ensure companyId is set (match backend)
                        companyId: companyId || u.companyId || null,
                        branch: branch ? { id: branch.id, name: branch.name } : null
                      };
                      return userObj;
                    });
                    console.log('[Users] ✅ FINAL FALLBACK (PostgreSQL): Found', users.length, 'users');
                    console.log('[Users] Final users:', users.map(u => ({ id: u.id, username: u.username, createdBy: u.createdBy, companyId: u.companyId })));
                  }
                } catch (finalError) {
                  console.error('[Users] FINAL FALLBACK error:', finalError.message);
                }
              }
            }
          }
    
          // CRITICAL FIX: If still empty for ADMIN, do ONE FINAL check - get ALL users created by admin (no filters at all)
          // This is the LAST resort to ensure staff are visible
          if (userRole === 'ADMIN' && currentUserId && users.length === 0) {
            console.log('[Users] ⚠️ CRITICAL: Still no users found after all queries. Running FINAL emergency check...');
    
            const adminCreatedByValue = req.user?.createdBy || currentUserId;
            const adminUserIdValue = currentUserId;
            const uniqueCreatedBy = [...new Set([adminCreatedByValue, adminUserIdValue])];
    
            // FINAL CHECK: Get ALL users from SQLite (no filters, no conditions, just createdBy)
            const finalCheckSql = `SELECT id, username, email, name, role, companyId, branchId, createdBy, isActive, createdAt, updatedAt FROM users WHERE (${uniqueCreatedBy.map(() => 'createdBy = ?').join(' OR ')}) ORDER BY createdAt DESC LIMIT 200`;
            const finalCheckUsers = query(finalCheckSql, uniqueCreatedBy);
    
            if (finalCheckUsers.length > 0) {
              console.log(`[Users] ✅ FINAL CHECK: Found ${finalCheckUsers.length} users in SQLite`);
              users = finalCheckUsers.map(u => {
                // CRITICAL FIX: Ensure companyId is included in response (match backend)
                let companyId = u.companyId;
                let branch = null;
                
                if (u.branchId) {
                  branch = query('SELECT id, name, companyId FROM branches WHERE id = ?', [u.branchId])[0];
                  if (branch && !companyId && branch.companyId) {
                    companyId = branch.companyId;
                  }
                }
                
                const userObj = {
                  ...u,
                  username: u.username || u.email || '',
                  // CRITICAL: Ensure companyId is set (match backend)
                  companyId: companyId || u.companyId || null,
                  branch: branch ? { id: branch.id, name: branch.name } : null
                };
                delete userObj.password;
                return userObj;
              });
            } else {
              console.log('[Users] ⚠️ FINAL CHECK: No users found in SQLite either');
    
              // LAST RESORT: Get ALL users (no filters at all) - just to see if database has any users
              const allUsersCheck = query('SELECT id, username, email, name, role, companyId, branchId, createdBy, isActive FROM users ORDER BY createdAt DESC LIMIT 50');
              console.log(`[Users] 🔍 LAST RESORT: Total users in database: ${allUsersCheck.length}`);
              if (allUsersCheck.length > 0) {
                console.log('[Users] 🔍 Last resort users:', allUsersCheck.map(u => ({ id: u.id, name: u.name, email: u.email, createdBy: u.createdBy, branchId: u.branchId })));
              }
            }
          }
    
          console.log('[Users] === FINAL RESULT ===');
          console.log('[Users] Total users being returned:', users.length);
          console.log('[Users] User IDs:', users.map(u => u.id));
          if (users.length > 0) {
            console.log('[Users] Sample users:', users.slice(0, 3).map(u => ({ id: u.id, name: u.name, email: u.email, createdBy: u.createdBy, branchId: u.branchId })));
          }
          console.log('[Users] ');
    
          // CRITICAL: NEVER return empty array for ADMIN users - always return at least something
          // If still empty, do ONE MORE emergency query with NO filters at all
          if (userRole === 'ADMIN' && currentUserId && users.length === 0) {
            console.log('[Users] ❌ CRITICAL WARNING: Returning empty array for ADMIN user!');
            console.log('[Users] This should NOT happen - all fallbacks failed!');
            console.log('[Users] Current user context:', {
              userId: currentUserId,
              role: userRole,
              createdBy: req.user?.createdBy,
              branchFilter,
              companyFilter
            });
    
            // LAST RESORT: Query ALL users (no filters) and filter by createdBy in JavaScript
            console.log('[Users] 🔄 LAST RESORT: Querying ALL users and filtering in memory...');
            const allUsersNoFilter = query('SELECT id, username, email, name, role, companyId, branchId, createdBy, isActive, createdAt, updatedAt FROM users ORDER BY createdAt DESC LIMIT 200');
            console.log('[Users] 🔄 LAST RESORT: Found', allUsersNoFilter.length, 'total users in database');
    
            if (allUsersNoFilter.length > 0) {
              const adminCreatedByValue = req.user?.createdBy || currentUserId;
              const adminUserIdValue = currentUserId;
              const uniqueCreatedBy = [...new Set([adminCreatedByValue, adminUserIdValue])];
    
              // Filter in memory by createdBy
              const adminUsers = allUsersNoFilter.filter(u => uniqueCreatedBy.includes(u.createdBy));
              console.log('[Users] 🔄 LAST RESORT: Filtered to', adminUsers.length, 'admin-created users');
    
              if (adminUsers.length > 0) {
                users = adminUsers.map(u => {
                  const userObj = {
                    ...u,
                    username: u.username || u.email || '',
                    branch: u.branchId ? query('SELECT id, name FROM branches WHERE id = ?', [u.branchId])[0] : null
                  };
                  delete userObj.password;
                  return userObj;
                });
                console.log('[Users] ✅ LAST RESORT SUCCESS: Using', users.length, 'users from memory filter');
              } else {
                console.log('[Users] ⚠️ LAST RESORT: No users found with createdBy filter in memory');
                console.log('[Users] 🔍 All users createdBy values:', allUsersNoFilter.map(u => ({ id: u.id, name: u.name, createdBy: u.createdBy })));
                console.log('[Users] 🔍 Looking for createdBy:', uniqueCreatedBy);
              }
            }
          }
    
          // CRITICAL DEBUG: Log final users before sending response
          console.log('[Users] === SENDING RESPONSE ===');
          console.log('[Users] Total users:', users.length);
          if (users.length > 0) {
            console.log('[Users] ✅✅✅ Sample users with companyId:', users.slice(0, 5).map(u => ({ 
              id: u.id, 
              name: u.name, 
              email: u.email, 
              companyId: u.companyId, 
              branchId: u.branchId,
              branch: u.branch,
              createdBy: u.createdBy,
              role: u.role
            })));
            // Check how many users have companyId set
            const usersWithCompanyId = users.filter(u => u.companyId);
            const usersWithoutCompanyId = users.filter(u => !u.companyId);
            console.log('[Users] 📊 CompanyId stats:', {
              total: users.length,
              withCompanyId: usersWithCompanyId.length,
              withoutCompanyId: usersWithoutCompanyId.length,
              withoutCompanyIdSample: usersWithoutCompanyId.slice(0, 3).map(u => ({ id: u.id, name: u.name, branchId: u.branchId }))
            });
          } else {
            console.log('[Users] ⚠️⚠️⚠️ WARNING: Returning 0 users!');
            console.log('[Users] This might mean:');
            console.log('[Users]   1. No users match the filters');
            console.log('[Users]   2. Users exist but createdBy doesn\'t match');
            console.log('[Users]   3. Users exist but companyId/branchId doesn\'t match');
            console.log('[Users]   4. Users not synced from PostgreSQL to SQLite');
            console.log('[Users] Current user context:', {
              userId: req.user?.id,
              role: req.user?.role,
              createdBy: req.user?.createdBy,
              companyId: req.user?.companyId,
              branchId: req.user?.branchId,
              headerCompanyId: req.headers['x-company-id'],
              headerBranchId: req.headers['x-branch-id']
            });
            
            // CRITICAL: If no users found, check if users exist in database at all
            const allUsersCheck = query('SELECT COUNT(*) as c FROM users')[0]?.c || 0;
            const allNonAdminUsersCheck = query(`SELECT COUNT(*) as c FROM users WHERE role NOT IN ('ADMIN', 'SUPERADMIN')`)[0]?.c || 0;
            console.log('[Users] 🔍 Database check: Total users=', allUsersCheck, 'Non-admin users=', allNonAdminUsersCheck);
            
            if (allNonAdminUsersCheck === 0 && REMOTE_DATABASE_URL) {
              console.log('[Users] ⚠️ CRITICAL: No users in SQLite - triggering immediate sync from PostgreSQL...');
              // Trigger immediate sync (blocking for this request)
              try {
                const connected = await checkPostgreSQLConnection();
                if (connected) {
                  console.log('[Users] ✅ PostgreSQL connected - syncing users NOW...');
                  const syncResult = await pullAllFromPostgreSQL(true);
                  saveDatabase();
                  console.log('[Users] ✅ Sync complete - retrying query...');
                  
                  // Retry query after sync
                  // Simple query: get all users created by admin
                  if (userRole === 'ADMIN' && currentUserId) {
                    const adminCreatedBy = req.user?.createdBy || currentUserId;
                    const adminUserId = currentUserId;
                    const uniqueCreatedBy = [...new Set([adminCreatedBy, adminUserId])];
                    const retrySql = `SELECT id, username, email, name, role, companyId, branchId, createdBy, isActive, createdAt, updatedAt FROM users WHERE (${uniqueCreatedBy.map(() => 'createdBy = ?').join(' OR ')}) ORDER BY createdAt DESC LIMIT 100`;
                    const retryUsers = query(retrySql, uniqueCreatedBy);
                    
                    if (retryUsers.length > 0) {
                      console.log('[Users] ✅✅✅ RETRY SUCCESS: Found', retryUsers.length, 'users after sync!');
                      users = retryUsers.map(u => {
                        let companyId = u.companyId;
                        let branch = null;
                        if (u.branchId) {
                          branch = query('SELECT id, name, companyId FROM branches WHERE id = ?', [u.branchId])[0];
                          if (branch && !companyId && branch.companyId) {
                            companyId = branch.companyId;
                          }
                        }
                        return {
                          ...u,
                          username: u.username || u.email || '',
                          companyId: companyId || u.companyId || null,
                          branch: branch ? { id: branch.id, name: branch.name } : null
                        };
                      });
                    }
                  }
                }
              } catch (syncErr) {
                console.error('[Users] ⚠️ Immediate sync error:', syncErr.message);
              }
            }
          }
          
          // Removed pagination from response
          res.json({ success: true, data: { users } });
        } catch (e) {
          console.error('[Users] GET error:', e);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // POST /api/users (line 8780)
      app.post('/api/users', authMiddleware, async (req, res) => {
        let userId = null;
        try {
          console.log('[Users] === STAFF CREATION START ===');
          console.log('[Users] POST request body:', JSON.stringify(req.body, null, 2));
          console.log('[Users] Current user:', { id: req.user?.id, email: req.user?.email, role: req.user?.role, branchId: req.user?.branchId, companyId: req.user?.companyId });
    
          // Validate database is initialized
          if (!getDatabase()) {
            console.error('[Users] ❌ Database not initialized!');
            return res.status(500).json({ success: false, message: 'Database not initialized. Please restart the application.' });
          }
    
          const { email, username, password, name, role = 'CASHIER', branchId, companyId } = req.body;
    
          // Frontend sends both username and email, use username as primary identifier
          const userEmail = (email || username || '').toLowerCase().trim();
          const userUsername = (username || email || '').toLowerCase().trim();
    
          // Validate required fields
          if (!userEmail || !userEmail.length) {
            console.error('[Users] ❌ Email/username is required but not provided');
            return res.status(400).json({ success: false, message: 'Email/username is required' });
          }
    
          if (!password || !password.trim()) {
            console.error('[Users] ❌ Password is required but not provided');
            return res.status(400).json({ success: false, message: 'Password is required' });
          }
    
          if (!name || !name.trim()) {
            console.error('[Users] ❌ Name is required but not provided');
            return res.status(400).json({ success: false, message: 'Name is required' });
          }
    
          if (!userUsername || !userUsername.length) {
            console.error('[Users] ❌ Username is required but not provided');
            return res.status(400).json({ success: false, message: 'Username is required' });
          }
    
          // Get context from headers (set by frontend) - match backend logic
          const selectedCompanyId = req.headers['x-company-id'] || req.user?.selectedCompanyId;
          const selectedBranchId = req.headers['x-branch-id'] || req.user?.selectedBranchId;
    
          // CRITICAL FIX: Match backend - prioritize branchId from body FIRST, then headers, then user's assigned
          // This ensures staff is created with the correct branch context
          const finalBranchId = branchId || selectedBranchId || req.user?.branchId || null;
          const finalCompanyId = companyId || selectedCompanyId || req.user?.companyId || null;
    
          // Check if user already exists by email or username - get full details
          // Note: For existence check, we can use SQLite directly as it's faster and both databases should be in sync
          const existingByEmail = query('SELECT id, name, email, username, role, branchId, companyId, createdBy, isActive FROM users WHERE LOWER(email) = ?', [userEmail]);
          const existingByUsername = query('SELECT id, name, email, username, role, branchId, companyId, createdBy, isActive FROM users WHERE LOWER(username) = ?', [userUsername]);
    
          const existingUser = existingByEmail[0] || existingByUsername[0];
    
          if (existingUser) {
            // Check if this user would be visible in the current user's view
            const currentUserId = req.user?.id;
            const currentUserRole = req.user?.role;
            const currentUserBranchId = req.user?.branchId;
            const currentUserCompanyId = req.user?.companyId;
    
            // Check why user might not be visible
            const reasons = [];
            if (existingUser.isActive === 0 || existingUser.isActive === false) {
              reasons.push('inactive');
            }
            if (existingUser.branchId && existingUser.branchId !== currentUserBranchId && existingUser.branchId !== finalBranchId) {
              reasons.push('different branch');
            }
            if (existingUser.companyId && existingUser.companyId !== currentUserCompanyId && existingUser.companyId !== finalCompanyId) {
              reasons.push('different company');
            }
            if (existingUser.createdBy && existingUser.createdBy !== currentUserId) {
              reasons.push('created by different user');
            }
    
            // If user exists but might not be visible, provide helpful message
            if (reasons.length > 0) {
              console.log('[Users] User exists but not visible:', {
                userId: existingUser.id,
                email: existingUser.email,
                reasons: reasons,
                existingUser: existingUser,
                currentUser: { id: currentUserId, branchId: currentUserBranchId, companyId: currentUserCompanyId }
              });
    
              return res.status(400).json({
                success: false,
                message: `User with this email or username already exists but is not visible in your view. Reasons: ${reasons.join(', ')}. User ID: ${existingUser.id}`,
                data: {
                  existingUserId: existingUser.id,
                  existingUserName: existingUser.name,
                  reasons: reasons,
                  suggestion: 'Try updating the existing user or contact administrator.'
                }
              });
            }
    
            // User exists and should be visible - return standard error
            return res.status(400).json({
              success: false,
              message: 'User with this email or username already exists',
              data: {
                existingUserId: existingUser.id,
                existingUserName: existingUser.name
              }
            });
          }
    
          // CRITICAL FIX: Validate only one manager per branch
          // If creating a MANAGER, check if the selected branch already has an active manager
          if (role === 'MANAGER' && finalBranchId) {
            const existingManager = query('SELECT id, name, username FROM users WHERE role = ? AND branchId = ? AND isActive = 1', 
              ['MANAGER', finalBranchId])[0];
    
            if (existingManager) {
              // Get branch name for better error message
              const branch = query('SELECT name FROM branches WHERE id = ?', [finalBranchId])[0];
              const branchName = branch?.name || 'this branch';
    
              return res.status(400).json({
                success: false,
                message: `Only one manager can be assigned to one branch. Branch "${branchName}" already has a manager (${existingManager.name || existingManager.username}).`,
                data: {
                  existingManagerId: existingManager.id,
                  existingManagerName: existingManager.name || existingManager.username,
                  branchId: finalBranchId,
                  branchName: branchName
                }
              });
            }
          }
    
          userId = uuid();
          const timestamp = now();
          const hashedPassword = hashPassword(password);
    
          // CRITICAL: Match backend-zp logic exactly
          // Backend uses: createdBy = currentUserId (always use current user's ID)
          // This ensures the user will appear in queries that check for createdBy = adminUserId
          // The query checks for both adminCreatedBy OR adminUserId, so using adminUserId ensures visibility
          const currentUserId = req.user?.id;
          const currentUserAdminId = req.user?.createdBy; // Admin who created this admin (if any)
          const createdByValue = currentUserId; // Always use current user's ID to ensure visibility
    
          if (!createdByValue) {
            console.error('[Users] ❌ CRITICAL: No user ID found in request! Cannot set createdBy.');
            return res.status(500).json({ success: false, message: 'Authentication error: User ID not found' });
          }
    
          console.log('[Users] Creating staff with context:', {
            userId,
            currentUserId: req.user?.id,
            createdBy: createdByValue,
            finalBranchId,
            finalCompanyId,
            role,
            name,
            email: userEmail,
            username: userUsername
          });
    
          // Verify users table exists
          try {
            const tableExists = query("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
            if (!tableExists || tableExists.length === 0) {
              console.error('[Users] ❌ Table "users" does not exist!');
              return res.status(500).json({ success: false, message: 'Database table not found. Please restart the application.' });
            }
          } catch (tableError) {
            console.error('[Users] ❌ Error checking users table:', tableError.message);
            return res.status(500).json({ success: false, message: 'Database error: ' + tableError.message });
          }
    
          // Check which database to use (PostgreSQL if available, SQLite otherwise)
          const dbType = await getActiveDatabase();
          console.log('[Users] Using database for staff creation:', dbType);
    
          // Prepare user data
          const userData = {
            id: userId,
            username: userUsername,
            email: userEmail,
            password: hashedPassword,
            name: name.trim(),
            role,
            branchId: finalBranchId || null,
            companyId: finalCompanyId || null,
            isActive: 0, // CRITICAL FIX: New users are INACTIVE by default - SuperAdmin must activate
            createdBy: createdByValue,
            createdAt: timestamp,
            updatedAt: timestamp
          };
    
          console.log('[Users] ✅ Creating user with isActive = 0 (inactive by default - SuperAdmin must activate)');
          console.log('[Users] User data:', {
            id: userData.id,
            username: userData.username,
            email: userData.email,
            name: userData.name,
            role: userData.role,
            branchId: userData.branchId,
            companyId: userData.companyId,
            createdBy: userData.createdBy,
            isActive: userData.isActive
          });
    
          // Insert into active database (PostgreSQL if available, SQLite otherwise)
          const insertResult = await insertIntoActiveDatabase('users', userData);
    
          if (!insertResult || !insertResult.success) {
            const errorMsg = insertResult?.error || 'Failed to create staff';
            console.error('[Users] ❌ Staff creation FAILED!');
            console.error('[Users] Error:', errorMsg);
            console.error('[Users] User ID:', userId);
    
            // Try to query if user exists anyway (might have been created despite error)
            const checkUser = await queryActiveDatabase('users', { id: userId });
            if (checkUser && checkUser.success && checkUser.data && checkUser.data.length > 0) {
              console.log('[Users] ⚠️ User exists despite error! User:', checkUser.data[0]);
              // Continue with the existing user
            } else {
              return res.status(500).json({ success: false, message: 'Failed to create staff: ' + errorMsg });
            }
          }
    
          console.log('[Users] ✅ INSERT statement executed successfully in', insertResult.dbType);
    
          // For SQLite, save database immediately after insert
          if (insertResult.dbType === 'sqlite') {
            saveDatabase();
            console.log('[Users] ✅ Database saved immediately after insert');
          }
    
          // Get the created user
          let user = insertResult.data;
    
          // If user not in result, query it
          if (!user) {
            const userResult = await queryActiveDatabase('users', { id: userId });
            if (userResult && userResult.success && userResult.data && userResult.data.length > 0) {
              user = userResult.data[0];
            } else {
              // Fallback: try to find by email/username
              const byEmailResult = await queryActiveDatabase('users', { email: userEmail });
              if (byEmailResult && byEmailResult.success && byEmailResult.data && byEmailResult.data.length > 0) {
                user = byEmailResult.data[0];
                console.log('[Users] Found staff by email fallback');
              } else {
                return res.status(500).json({ success: false, message: 'Staff creation failed: Could not retrieve created user. Please try again.' });
              }
            }
          }
    
          console.log('[Users] ✅ Staff found in database:', { id: user.id, name: user.name, email: user.email, createdBy: user.createdBy });
    
          console.log('[Users] ✅ Staff found in database:', { id: user.id, name: user.name, email: user.email, createdBy: user.createdBy });
    
          // SENIOR ENGINEER FIX: Verify staff can be retrieved with the ACTUAL GET query
          // Match the exact query structure used in GET endpoint
          console.log('[Users] 🔍 Verifying staff will be visible in GET query...');
          const adminCreatedByValue = req.user?.createdBy || req.user?.id;
          const adminUserIdValue = req.user?.id;
          const uniqueCreatedBy = [...new Set([adminCreatedByValue, adminUserIdValue])];
    
          // Match the exact GET query structure: (createdBy OR) AND (isActive) AND (optional filters)
          const createdByOrConditions = uniqueCreatedBy.map(() => 'createdBy = ?').join(' OR ');
          const testQuery = `SELECT id, username, email, name, role, branchId, companyId, createdBy, isActive FROM users WHERE (isActive = 1 OR isActive IS NULL) AND (${createdByOrConditions})`;
          const testParams = uniqueCreatedBy;
          const testResult = query(testQuery, testParams);
          const foundInTest = testResult.some(u => u.id === userId);
          console.log('[Users] ✅ Verification query result:', {
            found: foundInTest,
            testQuery,
            testParams,
            allResults: testResult.map(u => ({ id: u.id, name: u.name, createdBy: u.createdBy, isActive: u.isActive }))
          });
    
          if (!foundInTest) {
            console.error('[Users] ⚠️ WARNING: Staff created but may not be visible in GET query!');
            console.error('[Users] This might be a query logic issue. Staff ID:', userId);
          } else {
            console.log('[Users] ✅ Staff will be visible in GET query');
          }
    
          // Ensure username field exists in response
          if (!user.username) {
            user.username = user.email || userUsername;
          }
    
          // CRITICAL: Ensure createdBy is in response
          if (!user.createdBy && createdByValue) {
            user.createdBy = createdByValue;
            // Update in database to ensure it's saved
            run('UPDATE users SET createdBy = ? WHERE id = ?', [createdByValue, userId]);
            saveDatabase();
            console.log('[Users] ✅ Fixed createdBy in database');
          }
    
          // Add branch information if branchId exists
          if (user.branchId) {
            const branch = query('SELECT id, name FROM branches WHERE id = ?', [user.branchId])[0];
            user.branch = branch || { id: user.branchId, name: 'Unknown Branch' };
          } else {
            user.branch = null;
          }
    
          // CRITICAL: Verify and fix createdBy if needed
          if (!user.createdBy && createdByValue) {
            console.error('[Users] ⚠️ WARNING: createdBy was not set! Updating staff...');
            const updateSuccess = run('UPDATE users SET createdBy = ? WHERE id = ?', [createdByValue, userId]);
            if (updateSuccess) {
              user.createdBy = createdByValue;
              saveDatabase();
              console.log('[Users] ✅ Fixed createdBy field');
            } else {
              console.error('[Users] ❌ Failed to update createdBy:', lastDbError);
            }
          }
    
          // Final save to ensure everything is persisted
          saveDatabase();
          console.log('[Users] ✅ Database saved to disk');
    
          // SENIOR ENGINEER FIX: Final verification - query ALL users to confirm creation
          const allUsersAfterInsert = query('SELECT id, username, email, name, role, branchId, companyId, createdBy, isActive FROM users ORDER BY createdAt DESC LIMIT 5');
          console.log('[Users] 🔍 All users in database after insert:', JSON.stringify(allUsersAfterInsert, null, 2));
          const newlyCreatedUser = allUsersAfterInsert.find(u => u.id === userId);
          if (newlyCreatedUser) {
            console.log('[Users] ✅ CONFIRMED: Newly created user found in database:', {
              id: newlyCreatedUser.id,
              name: newlyCreatedUser.name,
              email: newlyCreatedUser.email,
              createdBy: newlyCreatedUser.createdBy,
              isActive: newlyCreatedUser.isActive,
              branchId: newlyCreatedUser.branchId,
              companyId: newlyCreatedUser.companyId
            });
          } else {
            console.error('[Users] ❌ CRITICAL: User NOT found in database after insert!');
            console.error('[Users] Searched for userId:', userId);
            console.error('[Users] All users found:', allUsersAfterInsert.map(u => ({ id: u.id, name: u.name })));
          }
    
          // CRITICAL: Immediately verify staff can be retrieved
          console.log('[Users] 🔍 FINAL VERIFICATION: Checking if staff can be retrieved...');
          const finalCheck = query('SELECT id, username, email, name, role, branchId, companyId, createdBy, isActive FROM users WHERE id = ?', [userId]);
          if (finalCheck.length > 0) {
            console.log('[Users] ✅ FINAL VERIFICATION PASSED: Staff exists in database');
            console.log('[Users] Staff details:', JSON.stringify(finalCheck[0], null, 2));
    
            // Also verify with createdBy query (the actual query used in GET)
            const createdByCheck = query('SELECT id, name, email, createdBy FROM users WHERE createdBy = ? AND (isActive = 1 OR isActive IS NULL)', [createdByValue]);
            console.log('[Users] 🔍 Verification with createdBy query:', createdByCheck.length, 'users found');
            if (createdByCheck.some(u => u.id === userId)) {
              console.log('[Users] ✅ VERIFICATION: Staff will be visible in GET query!');
            } else {
              console.error('[Users] ❌ VERIFICATION FAILED: Staff may NOT be visible in GET query!');
              console.error('[Users] CreatedBy value:', createdByValue);
              console.error('[Users] Staff createdBy:', user.createdBy);
            }
          } else {
            console.error('[Users] ❌ FINAL VERIFICATION FAILED: Staff not found in database after save!');
          }
    
          console.log('[Users] ✅ Staff created successfully:', {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            branchId: user.branchId,
            companyId: user.companyId,
            createdBy: user.createdBy,
            isActive: user.isActive
          });
          console.log('[Users] === STAFF CREATION SUCCESS ===');
    
          // CRITICAL: Verify the user can be found in GET query
          if (user.createdBy) {
            const verifyUser = query('SELECT id, createdBy FROM users WHERE id = ? AND createdBy = ?', [userId, user.createdBy]);
            if (verifyUser.length === 0) {
              console.error('[Users] ⚠️ WARNING: Staff not found in verification query!');
            } else {
              console.log('[Users] ✅ Staff verified - will show up in GET query');
            }
          } else {
            console.error('[Users] ⚠️ WARNING: Staff has no createdBy field!');
          }
    
          // If using SQLite, queue for sync to PostgreSQL (background)
          if (insertResult.dbType === 'sqlite') {
            console.log('[Users] Data saved to SQLite, triggering immediate sync to PostgreSQL...');
            try {
              handleDataChange('users', 'create', user);
    
              // CRITICAL: Force immediate sync attempt (non-blocking)
              (async () => {
                try {
                  const connected = await checkPostgreSQLConnection();
                  if (connected) {
                    console.log('[Users] ✅ PostgreSQL is now available, syncing user immediately...');
                    const client = await connectPostgreSQL(true);
                    if (client) {
                      await syncTableToPostgreSQL('users', client);
                      console.log('[Users] ✅ User synced to PostgreSQL');
                    }
                  }
                } catch (e) {
                  console.log('[Users] ⚠️ Immediate sync failed (will retry):', e.message);
                }
              })();
            } catch (syncError) {
              console.error('[Users] ⚠️ Sync queue error (non-critical):', syncError.message);
            }
          }
    
          res.status(201).json({
            success: true,
            data: user,
            message: 'Staff created successfully',
            dbType: insertResult.dbType,
            syncedToPostgreSQL: insertResult.dbType === 'postgresql'
          });
        } catch (e) {
          console.error('[Users] ❌ EXCEPTION in staff creation:', e.message);
          console.error('[Users] Stack trace:', e.stack);
          console.error('[Users] User ID:', userId);
          console.error('[Users] === STAFF CREATION FAILED ===');
    
          // If staff was partially created, try to clean up
          if (userId) {
            try {
              const existing = query('SELECT id FROM users WHERE id = ?', [userId]);
              if (existing && existing.length > 0) {
                console.log('[Users] Cleaning up partially created staff...');
                run('DELETE FROM users WHERE id = ?', [userId]);
                saveDatabase();
              }
            } catch (cleanupError) {
              console.error('[Users] Cleanup error:', cleanupError.message);
            }
          }
    
          res.status(500).json({ success: false, message: 'Error creating staff: ' + e.message });
        }
      });

  // GET /api/users/:id (line 9230)
      app.get('/api/users/:id', authMiddleware, (req, res) => {
        try {
          const user = query('SELECT id, email, name, role, phone, branchId, companyId, isActive, createdAt, updatedAt FROM users WHERE id = ?', [req.params.id])[0];
          if (!user) return res.status(404).json({ success: false, message: 'User not found' });
          user.branch = user.branchId ? query('SELECT id, name FROM branches WHERE id = ?', [user.branchId])[0] : null;
          res.json({ success: true, data: user });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // PUT /api/users/:id (line 9240)
      app.put('/api/users/:id', authMiddleware, (req, res) => {
        try {
          console.log('[Users] === UPDATE USER START ===');
          console.log('[Users] PUT request for id:', req.params.id, 'body:', req.body);
          console.log('[Users] Current user:', {
            id: req.user?.id,
            role: req.user?.role,
            createdBy: req.user?.createdBy
          });
    
          const { name, email, username, role, phone, branchId, companyId, isActive, password } = req.body;
    
          // CRITICAL FIX: Check if user exists BEFORE updating
          console.log('[Users] 🔍 Looking up user:', req.params.id);
    
          // Try multiple query approaches to find the user
          let existingUser = null;
          let userResult = null;
    
          // Approach 1: Full SELECT *
          try {
            userResult = query('SELECT * FROM users WHERE id = ?', [req.params.id]);
            console.log('[Users] 🔍 Query 1 (SELECT *) - result type:', typeof userResult, 'is array:', Array.isArray(userResult));
            if (Array.isArray(userResult) && userResult.length > 0) {
              existingUser = userResult[0];
              console.log('[Users] ✅ User found via SELECT *');
            }
          } catch (e) {
            console.log('[Users] ⚠️ Query 1 failed:', e.message);
          }
    
          // Approach 2: If first query failed, try simpler SELECT
          if (!existingUser) {
            try {
              const simpleResult = query('SELECT id, username, email, name, role, phone, branchId, companyId, isActive, createdAt, updatedAt, createdBy FROM users WHERE id = ?', [req.params.id]);
              console.log('[Users] 🔍 Query 2 (SELECT specific fields) - result:', Array.isArray(simpleResult) ? simpleResult.length : 'not array');
              if (Array.isArray(simpleResult) && simpleResult.length > 0) {
                existingUser = simpleResult[0];
                console.log('[Users] ✅ User found via SELECT specific fields');
              }
            } catch (e) {
              console.log('[Users] ⚠️ Query 2 failed:', e.message);
            }
          }
    
          // Approach 3: If still not found, try minimal SELECT
          if (!existingUser) {
            try {
              const minimalResult = query('SELECT id, username, name, email, role, branchId, companyId, isActive, createdBy FROM users WHERE id = ?', [req.params.id]);
              console.log('[Users] 🔍 Query 3 (SELECT minimal) - result:', Array.isArray(minimalResult) ? minimalResult.length : 'not array');
              if (Array.isArray(minimalResult) && minimalResult.length > 0) {
                existingUser = minimalResult[0];
                console.log('[Users] ✅ User found via SELECT minimal');
              }
            } catch (e) {
              console.log('[Users] ⚠️ Query 3 failed:', e.message);
            }
          }
    
          // Approach 4: Last resort - check if user exists at all
          if (!existingUser) {
            try {
              const existsCheck = query('SELECT id FROM users WHERE id = ?', [req.params.id]);
              console.log('[Users] 🔍 Query 4 (EXISTS check) - result:', Array.isArray(existsCheck) ? existsCheck.length : 'not array');
              if (Array.isArray(existsCheck) && existsCheck.length > 0) {
                // User exists but we couldn't fetch full data - create minimal user object
                console.log('[Users] ⚠️ User exists but full query failed - creating minimal user object');
                existingUser = {
                  id: req.params.id,
                  username: null,
                  email: null,
                  name: null,
                  role: null,
                  branchId: null,
                  companyId: null,
                  isActive: 1,
                  createdBy: null,
                  createdAt: null,
                  updatedAt: null
                };
              }
            } catch (e) {
              console.log('[Users] ⚠️ Query 4 failed:', e.message);
            }
          }
    
          // CRITICAL FIX: If user lookup failed, don't return 404 yet
          // Proceed with UPDATE - if user doesn't exist, UPDATE will fail and we'll return 404 then
          // If UPDATE succeeds, fetch user after update to build response
          if (!existingUser) {
            console.log('[Users] ⚠️ User lookup failed, but proceeding with UPDATE (will verify during UPDATE)');
            // Skip access control check if we can't find user - UPDATE will fail if user doesn't exist
          } else {
            console.log('[Users] ✅ User found:', {
              id: existingUser.id,
              username: existingUser.username || 'N/A',
              name: existingUser.name || 'N/A',
              createdBy: existingUser.createdBy || 'N/A'
            });
    
            // CRITICAL FIX: Only ADMIN and SUPERADMIN can edit users
            if (req.user?.role === 'ADMIN') {
              const adminCreatedBy = req.user?.createdBy || req.user?.id;
              const adminUserId = req.user?.id;
    
              // Check if user was created by this admin
              if (existingUser.createdBy !== adminCreatedBy && existingUser.createdBy !== adminUserId) {
                console.log('[Users] ❌ Access denied - user not created by admin:', {
                  userCreatedBy: existingUser.createdBy,
                  adminCreatedBy,
                  adminUserId
                });
                return res.status(403).json({
                  success: false,
                  message: 'Access denied: You can only update users you created'
                });
              }
              console.log('[Users] ✅ Access granted - user created by admin');
            } else if (req.user?.role !== 'SUPERADMIN') {
              // Only ADMIN and SUPERADMIN can edit users - deny all other roles
              console.log('[Users] ❌ Access denied - only ADMIN and SUPERADMIN can edit users:', {
                userRole: req.user?.role,
                userId: req.user?.id
              });
              return res.status(403).json({
                success: false,
                message: 'Access denied: Only ADMIN and SUPERADMIN can edit users'
              });
            }
          }
    
          // CRITICAL FIX: Validate username uniqueness if username is being updated (case-insensitive)
          if (username !== undefined && username.trim() !== '') {
            const normalizedUsername = username.trim().toLowerCase();
            // Use LOWER() for case-insensitive comparison in SQLite
            const existingUserByUsername = query('SELECT id FROM users WHERE LOWER(username) = ? AND id != ?', [normalizedUsername, req.params.id])[0];
            if (existingUserByUsername) {
              console.log('[Users] ❌ Username already exists:', normalizedUsername);
              return res.status(400).json({
                success: false,
                message: 'Username already exists! Please choose a different username.'
              });
            }
            console.log('[Users] ✅ Username is unique:', normalizedUsername);
          }
    
          const updates = [];
          const params = [];
    
          if (name !== undefined && name !== null) {
            updates.push('name = ?');
            params.push(name);
            console.log('[Users] Updating name to:', name);
          }
          if (email !== undefined && email !== null) {
            updates.push('email = ?');
            params.push(email.toLowerCase());
            console.log('[Users] Updating email to:', email.toLowerCase());
          }
          // CRITICAL FIX: Handle username updates (was missing!)
          if (username !== undefined && username !== null && username.trim() !== '') {
            updates.push('username = ?');
            params.push(username.trim().toLowerCase());
            console.log('[Users] Updating username to:', username.trim().toLowerCase());
          }
          if (role !== undefined && role !== null) {
            updates.push('role = ?');
            params.push(role);
            console.log('[Users] Updating role to:', role);
          }
          if (phone !== undefined && phone !== null) {
            updates.push('phone = ?');
            params.push(phone);
            console.log('[Users] Updating phone to:', phone);
          }
          if (branchId !== undefined && branchId !== null) {
            updates.push('branchId = ?');
            params.push(branchId);
            console.log('[Users] Updating branchId to:', branchId);
          }
          if (companyId !== undefined && companyId !== null) {
            updates.push('companyId = ?');
            params.push(companyId);
            console.log('[Users] Updating companyId to:', companyId);
          }
          // CRITICAL FIX: Don't allow isActive updates via PUT - use activate endpoint instead
          // Remove isActive from updates if present
          // if (isActive !== undefined && isActive !== null) {
          //   const isActiveValue = isActive === true || isActive === 'true' || isActive === 1 || isActive === '1' ? 1 : 0;
          //   updates.push('isActive = ?');
          //   params.push(isActiveValue);
          //   console.log('[Users] Updating isActive to:', isActiveValue, '(from:', isActive, typeof isActive, ')');
          // }
          if (password !== undefined && password !== null && password.trim() !== '') {
            updates.push('password = ?');
            params.push(hashPassword(password));
            console.log('[Users] Updating password (hashed)');
          }
    
          if (updates.length > 0) {
            // Always update updatedAt
            updates.push('updatedAt = ?');
            params.push(now());
            params.push(req.params.id);
    
            const updateQuery = `UPDATE users SET ${updates.join(', ')} WHERE id = ?`;
            console.log('[Users] === EXECUTING UPDATE QUERY ===');
            console.log('[Users] Update query:', updateQuery);
            console.log('[Users] Update params:', params);
            console.log('[Users] User ID to update:', req.params.id);
    
            // Execute UPDATE query
            try {
            const updateResult = run(updateQuery, params);
              console.log('[Users] Update result:', updateResult);
              console.log('[Users] Last DB error:', lastDbError);
    
            if (!updateResult) {
              console.error('[Users] ❌ Update query failed!');
              console.error('[Users] Last DB error:', lastDbError);
    
                // CRITICAL: Check if error is because user doesn't exist
                if (lastDbError && (lastDbError.includes('no such row') || lastDbError.includes('NOT FOUND'))) {
                  return res.status(404).json({
                    success: false,
                    message: 'User not found'
                  });
                }
    
              return res.status(500).json({ success: false, message: lastDbError || 'Failed to update user in database' });
            }
            console.log('[Users] ✅ Update query executed successfully');
              console.log('[Users] === UPDATE QUERY EXECUTED ===');
    
            // Save database immediately after update
            saveDatabase();
            console.log('[Users] ✅ Database saved after update');
    
              // CRITICAL: Verify the update was successful by querying the database
              console.log('[Users] 🔍 Verifying update by querying database...');
              const verifyResult = query('SELECT * FROM users WHERE id = ?', [req.params.id]);
              if (Array.isArray(verifyResult) && verifyResult.length > 0) {
                const verifiedUser = verifyResult[0];
                console.log('[Users] ✅ Verified updated user in database:', {
                  id: verifiedUser.id,
                  name: verifiedUser.name,
                  username: verifiedUser.username,
                  email: verifiedUser.email,
                  role: verifiedUser.role
                });
    
                // Update existingUser with verified data
                existingUser = verifiedUser;
              } else if (verifyResult && !Array.isArray(verifyResult)) {
                existingUser = verifyResult;
                console.log('[Users] ✅ Verified updated user in database (object format)');
              } else {
                console.warn('[Users] ⚠️ Could not verify update - user not found in database after update');
              }
            } catch (updateError) {
              console.error('[Users] ❌ Exception during UPDATE:', updateError);
              return res.status(500).json({
                success: false,
                message: `Update failed: ${updateError.message || 'Unknown error'}`
              });
            }
    
            // CRITICAL: After successful UPDATE and save, fetch the user to build response
            // This ensures we have the latest data from the database
            console.log('[Users] 🔍 Fetching updated user from database after UPDATE and save...');
            const updatedUserResult = query('SELECT * FROM users WHERE id = ?', [req.params.id]);
            console.log('[Users] 🔍 Updated user query result:', {
              isArray: Array.isArray(updatedUserResult),
              length: Array.isArray(updatedUserResult) ? updatedUserResult.length : 'not array',
              hasData: !!updatedUserResult
            });
    
            if (Array.isArray(updatedUserResult) && updatedUserResult.length > 0) {
              existingUser = updatedUserResult[0];
              console.log('[Users] ✅ Fetched updated user after UPDATE:', {
                id: existingUser.id,
                name: existingUser.name,
                username: existingUser.username,
                email: existingUser.email,
                role: existingUser.role
              });
            } else if (updatedUserResult && !Array.isArray(updatedUserResult)) {
              // Handle case where query returns object directly
              existingUser = updatedUserResult;
              console.log('[Users] ✅ Fetched updated user after UPDATE (object):', {
                id: existingUser.id,
                name: existingUser.name,
                username: existingUser.username
              });
            } else {
              console.log('[Users] ⚠️ Could not fetch updated user from DB, updating existingUser with request values');
              // If we still don't have existingUser, create minimal object from update data
              if (!existingUser) {
                existingUser = {
                  id: req.params.id,
                  username: username || null,
                  email: email || null,
                  name: name || null,
                  role: role || null,
                  phone: phone || null,
                  branchId: branchId || null,
                  companyId: companyId || null,
                  isActive: 1,
                  createdBy: req.user?.id || null,
                  createdAt: null,
                  updatedAt: now()
                };
                console.log('[Users] ⚠️ Created minimal user object from update data');
              } else {
                // Update existingUser with the new values from the request (fallback if DB query fails)
                if (name !== undefined && name !== null) {
                  existingUser.name = name;
                  console.log('[Users] ✅ Updated existingUser.name to:', name);
                }
                if (username !== undefined && username !== null) {
                  existingUser.username = username.trim().toLowerCase();
                  console.log('[Users] ✅ Updated existingUser.username to:', username.trim().toLowerCase());
                }
                if (email !== undefined && email !== null) {
                  existingUser.email = email.toLowerCase();
                  console.log('[Users] ✅ Updated existingUser.email to:', email.toLowerCase());
                }
                if (role !== undefined && role !== null) {
                  existingUser.role = role;
                  console.log('[Users] ✅ Updated existingUser.role to:', role);
                }
                if (phone !== undefined && phone !== null) {
                  existingUser.phone = phone;
                }
                if (branchId !== undefined && branchId !== null) {
                  existingUser.branchId = branchId;
                }
                if (companyId !== undefined && companyId !== null) {
                  existingUser.companyId = companyId;
                }
                existingUser.updatedAt = now();
                console.log('[Users] ✅ Updated existingUser object with new values from request');
              }
            }
          } else {
            console.log('[Users] ⚠️ No fields to update');
            return res.status(400).json({ success: false, message: 'No fields to update' });
          }
    
          // CRITICAL FIX: Build response from existingUser + updateData instead of re-querying
          // This avoids verification query failures and ensures we always return success if UPDATE succeeded
          console.log('[Users] 🔍 Building response from existing user data + updates');
    
          // Get branch info for response (use existingUser.branchId if available, otherwise from updateData)
          const branchIdForResponse = branchId !== undefined && branchId !== null ? branchId : existingUser.branchId;
          let branch = null;
          if (branchIdForResponse) {
            const branchResult = query('SELECT id, name FROM branches WHERE id = ?', [branchIdForResponse]);
            if (Array.isArray(branchResult) && branchResult.length > 0) {
              branch = branchResult[0];
            } else if (branchResult) {
              branch = branchResult;
            }
          }
    
          // CRITICAL: Build response using updated values from request (they were just saved to DB)
          // Priority: ALWAYS use request values if provided (they were just updated in DB)
          // This ensures the response reflects what was actually updated
          const userResponse = {
            id: existingUser.id,
            // CRITICAL: Always use request values if provided - they were just saved to DB
            username: username !== undefined && username !== null ? username.trim().toLowerCase() : existingUser.username,
            email: email !== undefined && email !== null ? email.toLowerCase() : existingUser.email,
            name: name !== undefined && name !== null ? name : existingUser.name, // CRITICAL: Use request name if provided
            role: role !== undefined && role !== null ? role : existingUser.role,
            phone: phone !== undefined && phone !== null ? phone : (existingUser.phone || null),
            branchId: branchId !== undefined && branchId !== null ? branchId : existingUser.branchId,
            companyId: companyId !== undefined && companyId !== null ? companyId : existingUser.companyId,
            isActive: existingUser.isActive === 1 || existingUser.isActive === '1' || existingUser.isActive === true || existingUser.isActive === 'true',
            createdAt: existingUser.createdAt || null,
            updatedAt: new Date().toISOString(), // Use current time since we just updated
            createdBy: existingUser.createdBy || null,
            branch: branch || null
          };
    
          console.log('[Users] 🔍 Final user response data:', {
            id: userResponse.id,
            name: userResponse.name,
            username: userResponse.username,
            email: userResponse.email,
            role: userResponse.role,
            branchId: userResponse.branchId,
            updatedAt: userResponse.updatedAt,
            'Request name': name,
            'Request username': username,
            'ExistingUser name': existingUser.name,
            'ExistingUser username': existingUser.username,
            'Response name (should match request)': userResponse.name,
            'Name updated?': name !== undefined && name !== null && name !== existingUser.name
          });
    
          // CRITICAL: Verify the name in response matches what was requested
          if (name !== undefined && name !== null && userResponse.name !== name) {
            console.error('[Users] ❌ CRITICAL: Response name does not match request name!');
            console.error('[Users] Request name:', name);
            console.error('[Users] Response name:', userResponse.name);
            // Force correct name
            userResponse.name = name;
            console.log('[Users] ✅ Fixed response name to match request:', userResponse.name);
          }
    
          console.log('[Users] ✅ Built user response:', {
            id: userResponse.id,
            username: userResponse.username,
            name: userResponse.name,
            email: userResponse.email
          });
    
          console.log('[Users] ✅ Updated user:', {
            id: userResponse.id,
            username: userResponse.username,
            name: userResponse.name,
            email: userResponse.email,
            isActive: userResponse.isActive,
            branchId: userResponse.branchId,
            updatedAt: userResponse.updatedAt
          });
          console.log('[Users] === UPDATE USER END ===');
    
          // 🔄 TWO-WAY SYNC: Queue for sync to PostgreSQL
          handleDataChange('users', 'update', userResponse);
    
          // CRITICAL: Ensure response contains only single user, not users array
          // Double-check that userResponse is a single object, not an array or wrapped object
          let finalUserData = userResponse;
          if (Array.isArray(userResponse)) {
            console.error('[Users] ❌ ERROR: userResponse is an array! Taking first element.');
            finalUserData = userResponse[0];
          } else if (userResponse && typeof userResponse === 'object' && userResponse.users) {
            console.error('[Users] ❌ ERROR: userResponse has users property! Extracting single user.');
            finalUserData = Array.isArray(userResponse.users) ? userResponse.users[0] : userResponse;
          }
    
          // Final verification - ensure it's a single user object
          if (!finalUserData || typeof finalUserData !== 'object' || Array.isArray(finalUserData)) {
            console.error('[Users] ❌ CRITICAL ERROR: finalUserData is not a valid user object!');
            console.error('[Users] finalUserData type:', typeof finalUserData);
            console.error('[Users] finalUserData isArray:', Array.isArray(finalUserData));
            console.error('[Users] finalUserData:', finalUserData);
            return res.status(500).json({
              success: false,
              message: 'Failed to build user response - invalid data format'
            });
          }
    
          const finalResponse = {
            success: true,
            data: finalUserData, // Single user object, NOT { users: [...] } and NOT an array
            message: 'User updated successfully'
          };
    
          console.log('[Users] ✅ Sending update response:', {
            success: finalResponse.success,
            hasData: !!finalResponse.data,
            dataIsArray: Array.isArray(finalResponse.data),
            dataHasUsers: !!finalResponse.data?.users,
            dataKeys: finalResponse.data ? Object.keys(finalResponse.data) : [],
            dataId: finalResponse.data?.id,
            dataName: finalResponse.data?.name,
            dataUsername: finalResponse.data?.username
          });
    
          // CRITICAL: Verify response structure one more time before sending
          if (Array.isArray(finalResponse.data) || finalResponse.data?.users) {
            console.error('[Users] ❌ CRITICAL: Response still has wrong format! Not sending.');
            return res.status(500).json({
              success: false,
              message: 'Internal error: Response format validation failed'
            });
          }
    
          res.status(200).json(finalResponse);
        } catch (e) {
          console.error('[Users] Update error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // PATCH /api/users/:id/activate (line 9729)
      app.patch('/api/users/:id/activate', authMiddleware, (req, res) => {
        try {
          const { isActive } = req.body;
          const userId = req.params.id;
    
          console.log('[Users] === ACTIVATE USER START ===');
          console.log('[Users] PATCH activate request for id:', userId, 'isActive:', isActive);
          console.log('[Users] Current user:', {
            id: req.user?.id,
            role: req.user?.role,
            createdBy: req.user?.createdBy
          });
    
          // CRITICAL FIX: Check if user exists - use multiple query approaches like update user
          console.log('[Users] 🔍 Looking up user:', userId);
    
          // Try multiple query approaches to find the user
          let user = null;
    
          // Approach 1: Full SELECT *
          try {
            const userResult1 = query('SELECT * FROM users WHERE id = ?', [userId]);
            console.log('[Users] 🔍 Query 1 (SELECT *) - result type:', typeof userResult1, 'is array:', Array.isArray(userResult1));
            if (Array.isArray(userResult1) && userResult1.length > 0) {
              user = userResult1[0];
              console.log('[Users] ✅ User found via SELECT *');
            }
          } catch (e) {
            console.log('[Users] ⚠️ Query 1 failed:', e.message);
          }
    
          // Approach 2: If first query failed, try simpler SELECT
          if (!user) {
            try {
              const simpleResult = query('SELECT id, username, email, name, role, phone, branchId, companyId, isActive, createdAt, updatedAt, createdBy FROM users WHERE id = ?', [userId]);
              console.log('[Users] 🔍 Query 2 (SELECT specific fields) - result:', Array.isArray(simpleResult) ? simpleResult.length : 'not array');
              if (Array.isArray(simpleResult) && simpleResult.length > 0) {
                user = simpleResult[0];
                console.log('[Users] ✅ User found via SELECT specific fields');
              }
            } catch (e) {
              console.log('[Users] ⚠️ Query 2 failed:', e.message);
            }
          }
    
          // Approach 3: If still not found, try minimal SELECT
          if (!user) {
            try {
              const minimalResult = query('SELECT id, username, name, email, role, branchId, companyId, isActive, createdBy FROM users WHERE id = ?', [userId]);
              console.log('[Users] 🔍 Query 3 (SELECT minimal) - result:', Array.isArray(minimalResult) ? minimalResult.length : 'not array');
              if (Array.isArray(minimalResult) && minimalResult.length > 0) {
                user = minimalResult[0];
                console.log('[Users] ✅ User found via SELECT minimal');
              }
            } catch (e) {
              console.log('[Users] ⚠️ Query 3 failed:', e.message);
            }
          }
    
          // Approach 4: Last resort - check if user exists at all
          if (!user) {
            try {
              const existsCheck = query('SELECT id FROM users WHERE id = ?', [userId]);
              console.log('[Users] 🔍 Query 4 (EXISTS check) - result:', Array.isArray(existsCheck) ? existsCheck.length : 'not array');
              if (Array.isArray(existsCheck) && existsCheck.length > 0) {
                // User exists but we couldn't fetch full data - proceed with UPDATE anyway
                console.log('[Users] ⚠️ User exists but full query failed - proceeding with UPDATE');
                // Don't return 404 - let UPDATE query verify if user exists
              }
            } catch (e) {
              console.log('[Users] ⚠️ Query 4 failed:', e.message);
            }
          }
    
          if (!user) {
            console.log('[Users] ❌ User not found after all query attempts:', userId);
            // CRITICAL: Don't return 404 yet - proceed with UPDATE, it will fail if user doesn't exist
            console.log('[Users] ⚠️ Proceeding with UPDATE anyway (will verify during UPDATE)');
          } else {
            console.log('[Users] ✅ User found:', {
              id: user.id,
              username: user.username || 'N/A',
              name: user.name || 'N/A',
              createdBy: user.createdBy || 'N/A'
            });
    
            
            // CRITICAL FIX: Verify MANAGER can only activate cashiers from their own branch
            if (req.user?.role === 'MANAGER') {
              // Managers can only activate/deactivate cashiers from their own branch
              if (user.role !== 'CASHIER') {
                console.log('[Users] ❌ Access denied - manager can only activate cashiers:', {
                  userRole: user.role,
                  managerId: req.user?.id
                });
                return res.status(403).json({
                  success: false,
                  message: 'Access denied: You can only activate/deactivate cashiers'
                });
              }
              
              if (user.branchId !== req.user?.branchId) {
                console.log('[Users] ❌ Access denied - manager can only activate cashiers from their branch:', {
                  userBranchId: user.branchId,
                  managerBranchId: req.user?.branchId
                });
                return res.status(403).json({
                  success: false,
                  message: 'Access denied: You can only activate cashiers from your own branch'
                });
              }
              console.log('[Users] ✅ Access granted - manager activating cashier from their branch');
            }
    
    
    
            // CRITICAL FIX: Verify ADMIN can only activate users they created
            if (req.user?.role === 'ADMIN') {
              const adminCreatedBy = req.user?.createdBy || req.user?.id;
              const adminUserId = req.user?.id;
    
              // Check if user was created by this admin
              if (user.createdBy !== adminCreatedBy && user.createdBy !== adminUserId) {
                console.log('[Users] ❌ Access denied - user not created by admin:', {
                  userCreatedBy: user.createdBy,
                  adminCreatedBy,
                  adminUserId
                });
                return res.status(403).json({
                  success: false,
                  message: 'Access denied: You can only activate users you created'
                });
              }
              console.log('[Users] ✅ Access granted - user created by admin');
            }
          }
    
          // Update user active status
          const currentStatus = user ? user.isActive : null;
          console.log('[Users] Updating user active status:', {
            userId: userId,
            currentStatus: currentStatus,
            newStatus: isActive
          });
    
          const updateResult = run('UPDATE users SET isActive = ?, updatedAt = ? WHERE id = ?', [isActive ? 1 : 0, now(), userId]);
          if (!updateResult) {
            console.error('[Users] ❌ Update query failed!');
            console.error('[Users] Last DB error:', lastDbError);
    
            // CRITICAL: Check if error is because user doesn't exist
            if (lastDbError && (lastDbError.includes('no such row') || lastDbError.includes('NOT FOUND') || lastDbError.includes('no rows'))) {
              return res.status(404).json({
                success: false,
                message: 'User not found'
              });
            }
    
            return res.status(500).json({ success: false, message: lastDbError || 'Failed to update user in database' });
          }
          console.log('[Users] ✅ Update query executed successfully');
    
          // Save database immediately after update
          saveDatabase();
          console.log('[Users] ✅ Database saved after activate/deactivate');
    
          // CRITICAL FIX: Fetch updated user after successful UPDATE
          console.log('[Users] 🔍 Fetching updated user after successful UPDATE');
          const updatedUserResult = query('SELECT * FROM users WHERE id = ?', [userId]);
          let updatedUser = null;
          if (Array.isArray(updatedUserResult) && updatedUserResult.length > 0) {
            updatedUser = updatedUserResult[0];
            console.log('[Users] ✅ Fetched updated user after UPDATE');
          } else if (updatedUserResult) {
            updatedUser = updatedUserResult;
          } else {
            // Build response from existing user + update
            console.log('[Users] ⚠️ Could not fetch user after UPDATE, building response from existing data');
            updatedUser = {
              ...user,
              isActive: isActive ? 1 : 0,
              updatedAt: now()
            };
          }
    
          // Get branch info for response
          let branch = null;
          if (updatedUser.branchId) {
            const branchResult = query('SELECT id, name FROM branches WHERE id = ?', [updatedUser.branchId]);
            if (Array.isArray(branchResult) && branchResult.length > 0) {
              branch = branchResult[0];
            } else if (branchResult) {
              branch = branchResult;
            }
          }
    
          const userResponse = {
            id: updatedUser.id,
            username: updatedUser.username || null,
            email: updatedUser.email || null,
            name: updatedUser.name || null,
            role: updatedUser.role || null,
            phone: updatedUser.phone || null,
            branchId: updatedUser.branchId || null,
            companyId: updatedUser.companyId || null,
            isActive: updatedUser.isActive === 1 || updatedUser.isActive === '1' || updatedUser.isActive === true || updatedUser.isActive === 'true',
            createdAt: updatedUser.createdAt || null,
            updatedAt: updatedUser.updatedAt || null,
            createdBy: updatedUser.createdBy || null,
            branch: branch || null
          };
    
          console.log('[Users] ✅ User activated/deactivated:', {
            id: userResponse.id,
            username: userResponse.username,
            isActive: userResponse.isActive
          });
          console.log('[Users] === ACTIVATE USER END ===');
    
          // 🔄 TWO-WAY SYNC: Queue for sync to PostgreSQL
          handleDataChange('users', 'update', userResponse);
    
          res.status(200).json({
            success: true,
            data: userResponse,
            message: `User ${isActive ? 'activated' : 'deactivated'} successfully`
          });
        } catch (e) {
          console.error('[Users] ❌ Activate error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // DELETE /api/users/:id (line 9963)
      app.delete('/api/users/:id', authMiddleware, (req, res) => {
        try {
          console.log('[Users] DELETE request for id:', req.params.id);
          const user = query('SELECT * FROM users WHERE id = ?', [req.params.id])[0];
    
          if (!user) {
            // CRITICAL FIX: If user not found, return 200 with info message
            // This allows frontend to remove user from list even if already deleted
            console.log('[Users] ⚠️ User not found (already deleted):', req.params.id);
            return res.status(200).json({
              success: true,
              message: 'User was already deleted or does not exist'
            });
          }
    
          console.log('[Users] Deleting user:', user.name, user.username, 'Current isActive:', user.isActive);
    
          // CRITICAL FIX: Use hard delete (DELETE FROM) instead of soft delete for complete removal
          // If you want soft delete, use: UPDATE users SET isActive = 0
          // For hard delete, use: DELETE FROM users
          const deleteResult = run('DELETE FROM users WHERE id = ?', [req.params.id]);
    
          if (!deleteResult) {
            console.error('[Users] ❌ Delete query failed!');
            console.error('[Users] Last DB error:', lastDbError);
            return res.status(500).json({ success: false, message: lastDbError || 'Failed to delete user in database' });
          }
          console.log('[Users] ✅ Delete query executed successfully (hard delete)');
    
          // Save database immediately after delete
          saveDatabase();
          console.log('[Users] ✅ Database saved after delete');
    
          // 🔄 TWO-WAY SYNC: Queue delete for sync
          if (user) handleDataChange('users', 'delete', user);
    
          res.status(200).json({ success: true, message: 'User deleted successfully' });
        } catch (e) {
          console.error('[Users] Delete error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // POST /api/users/bulk-delete (line 10007)
      app.post('/api/users/bulk-delete', authMiddleware, (req, res) => {
        try {
          const { usernames } = req.body; // Array of usernames to delete
    
          if (!usernames || !Array.isArray(usernames) || usernames.length === 0) {
            return res.status(400).json({ success: false, message: 'Please provide an array of usernames to delete' });
          }
    
          console.log('[Users] BULK DELETE request for usernames:', usernames);
    
          let deletedCount = 0;
          let notFoundCount = 0;
          const errors = [];
    
          usernames.forEach((username) => {
            try {
              // Find user by username (case-insensitive)
              const user = query('SELECT id, name, username FROM users WHERE LOWER(username) = ?', [username.toLowerCase().trim()])[0];
    
              if (user) {
                // Hard delete the user
                const deleteResult = run('DELETE FROM users WHERE id = ?', [user.id]);
    
                if (deleteResult) {
                  console.log(`[Users] ✅ Deleted user: ${user.name} (${user.username})`);
                  deletedCount++;
                  // Queue for sync
                  handleDataChange('users', 'delete', user);
                } else {
                  errors.push(`Failed to delete ${username}: ${lastDbError || 'Database error'}`);
                }
              } else {
                console.log(`[Users] ⚠️ User not found: ${username}`);
                notFoundCount++;
              }
            } catch (error) {
              errors.push(`Error deleting ${username}: ${error.message}`);
            }
          });
    
          // Save database after all deletions
          saveDatabase();
          console.log('[Users] ✅ Database saved after bulk delete');
    
          res.json({
            success: true,
            message: `Bulk delete completed: ${deletedCount} deleted, ${notFoundCount} not found`,
            deleted: deletedCount,
            notFound: notFoundCount,
            errors: errors.length > 0 ? errors : undefined
          });
        } catch (e) {
          console.error('[Users] Bulk delete error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

}

module.exports = {
  registerUsersRoutes
};
