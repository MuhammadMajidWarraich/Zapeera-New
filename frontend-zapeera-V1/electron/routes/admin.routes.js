/**
 * Admin Routes
 * Extracted from routes/index.js
 */

function registerAdminRoutes(app, authMiddleware, deps) {
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

// GET /api/admin (line 10980)
      app.get('/api/admin', authMiddleware, (req, res) => {
        try {
          const admins = query('SELECT id, email, name, role, phone, companyId, createdAt FROM users WHERE role = "ADMIN" OR role = "SUPERADMIN" ORDER BY createdAt DESC');
          const result = admins.map(a => ({
            id: a.id,
            name: a.name,
            email: a.email,
            phone: a.phone || '',
            company: a.companyId || '',
            userCount: query('SELECT COUNT(*) as c FROM users WHERE createdBy = ?', [a.id])[0]?.c || 0,
            status: 'active',
            plan: 'premium',
            createdAt: a.createdAt,
            lastActive: a.createdAt
          }));
          res.json({ success: true, data: { admins: result, pagination: { total: result.length, page: 1, limit: 50, pages: 1 } } });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // POST /api/admin (line 11000)
      app.post('/api/admin', authMiddleware, (req, res) => {
        try {
          const { name, email, phone, company, plan, password } = req.body;
          if (!email || !password || !name) return res.status(400).json({ success: false, message: 'Email, password, name required' });
          const id = uuid();
          run('INSERT INTO users (id, username, email, password, name, role, isActive, createdBy, createdAt, updatedAt) VALUES (?,?,?,?,?,?,0,?,?,?)',
            [id, email, email, hashPassword(password), name, 'ADMIN', req.user?.id, now(), now()]);
          const user = query('SELECT * FROM users WHERE id = ?', [id])[0];
    
          // 🔄 TWO-WAY SYNC: Sync to PostgreSQL immediately (if online)
          if (user) {
            console.log('[Admin] 🔄 Attempting immediate sync to PostgreSQL...');
    
            // CRITICAL: Try to sync immediately
            (async () => {
              try {
                const connected = await checkPostgreSQLConnection();
                console.log('[Admin] PostgreSQL connection check:', connected ? 'CONNECTED' : 'OFFLINE');
    
                if (connected) {
                  const client = await connectPostgreSQL(true);
                  if (client) {
                    try {
                      const pgColumns = await getPostgreSQLColumns('users', client);
                      if (pgColumns && pgColumns.length > 0) {
                        const mapped = mapRowForPostgreSQL('users', user);
                        const columns = Object.keys(mapped).filter(c => pgColumns.includes(c));
                        const values = columns.map(c => mapped[c]);
    
                        if (columns.length > 0) {
                          const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
                          const updateSet = columns
                            .filter(c => c !== 'id')
                            .map((col) => `"${col}" = EXCLUDED."${col}"`)
                            .join(', ');
    
                          const sql = `
                            INSERT INTO "users" (${columns.map(c => `"${c}"`).join(', ')})
                            VALUES (${placeholders})
                            ON CONFLICT (id) DO UPDATE SET ${updateSet}
                          `;
    
                          await client.query(sql, values);
                          console.log('[Admin] ✅ ADMIN ACCOUNT SYNCED TO POSTGRESQL: User created in live database');
                          console.log('[Admin] User details synced:', { id: user.id, email: user.email, name: user.name, isActive: user.isActive });
                        }
                      }
                    } catch (syncErr) {
                      console.error('[Admin] ❌ Sync to PostgreSQL failed:', syncErr.message);
                      console.error('[Admin] Stack:', syncErr.stack);
                      handleDataChange('users', 'create', user);
                    }
                  } else {
                    console.log('[Admin] ⚠️ PostgreSQL client not available, queuing for later sync');
                    handleDataChange('users', 'create', user);
                  }
                } else {
                  console.log('[Admin] ⚠️ PostgreSQL offline, queuing for later sync');
                  handleDataChange('users', 'create', user);
                }
              } catch (e) {
                console.error('[Admin] ❌ Sync check failed:', e.message);
                handleDataChange('users', 'create', user);
              }
            })();
          }
    
          res.status(201).json({ success: true, data: { id, email, name, role: 'ADMIN', company, plan: plan || 'basic', status: 'pending' } });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

}

module.exports = {
  registerAdminRoutes
};
