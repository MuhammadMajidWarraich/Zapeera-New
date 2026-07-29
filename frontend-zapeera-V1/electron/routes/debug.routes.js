/**
 * Debug Routes
 * Extracted from routes/index.js
 */

function registerDebugRoutes(app, authMiddleware, deps) {
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

// GET /api/debug/postgresql (line 95)
      app.get('/api/debug/postgresql', async (req, res) => {
        try {
          const result = {
            remoteDatabaseUrl: REMOTE_DATABASE_URL ? REMOTE_DATABASE_URL.replace(/:[^:@]+@/, ':****@') : 'NOT SET',
            isOnline: getIsOnline(),
            bcryptjsAvailable: !!bcryptjs,
            connectionTest: null,
            users: [],
            error: null
          };
    
          if (!REMOTE_DATABASE_URL) {
            return res.json({ success: false, ...result, error: 'REMOTE_DATABASE_URL not configured' });
          }
    
          // Try to connect
          try {
            let Client;
            try {
              const pg = require('pg');
              Client = pg.Client;
            } catch (e) {
              return res.json({ success: false, ...result, error: 'pg module not available: ' + e.message });
            }
    
            const testClient = new (require('pg').Client)({
              connectionString: REMOTE_DATABASE_URL,
              connectionTimeoutMillis: 5000
            });
    
            await Promise.race([
              testClient.connect(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 5000))
            ]);
    
            await testClient.query('SELECT 1');
            result.connectionTest = 'SUCCESS';
    
            // List users
            const usersResult = await testClient.query('SELECT id, email, username, name, role, "isActive" FROM users LIMIT 2');
            result.users = usersResult.rows.map(u => ({
              id: u.id,
              email: u.email,
              username: u.username,
              name: u.name,
              role: u.role,
              isActive: u.isActive
            }));
    
            await testClient.end();
            res.json({ success: true, ...result });
          } catch (connError) {
            result.connectionTest = 'FAILED';
            result.error = connError.message;
            res.json({ success: false, ...result });
          }
        } catch (e) {
          res.status(500).json({ success: false, error: e.message });
        }
      });

}

module.exports = {
  registerDebugRoutes
};
