/**
 * Other Routes
 * Extracted from routes/index.js
 */

function registerOtherRoutes(app, authMiddleware, deps) {
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

// GET /health (line 28)
      app.get('/health', (req, res) => {
        try {
          // CRITICAL: Always return 200 OK immediately - server is listening and ready
          // This allows frontend to connect even if database is still initializing
          // CRITICAL FIX: Don't trigger database connection checks that might interfere with data fetching
          // Use cached state only - don't call checkPostgreSQLConnection() here
          const healthResponse = {
            status: 'ok',
            serverReady: true,
            database: 'sqlite',
            path: getDatabasePath() || 'not-set',
            timestamp: now(),
            databaseInitialized: !!getDatabase(),
            sqliteWorking: false,
            postgresqlAvailable: !!REMOTE_DATABASE_URL,
            // CRITICAL FIX: Use cached getIsOnline() state instead of checking connection
            // This prevents health check from interfering with active data operations
            postgresqlConnected: getIsOnline() && !!getPgClient()
          };
    
          // If database is initialized, test it (non-blocking)
          if (getDatabase()) {
            try {
              const testQuery = query('SELECT 1 as test');
              if (testQuery && testQuery.length > 0) {
                healthResponse.sqliteWorking = true;
              }
            } catch (dbError) {
              // Ignore - database might be initializing
              healthResponse.databaseError = dbError.message;
            }
          } else {
            // Database not initialized yet - but server is ready
            healthResponse.message = 'Database initializing in background';
            // Try to initialize in background (non-blocking)
            setImmediate(async () => {
              try {
                if (!getDatabase()) {
                  await initDatabase();
                  console.log('[Health] ✅ Database initialized in background');
                }
              } catch (initError) {
                console.error('[Health] ⚠️ Background database initialization error (non-critical):', initError.message);
              }
            });
          }
    
          // ALWAYS return 200 OK - server is ready to accept connections
          res.status(200).json(healthResponse);
        } catch (e) {
          console.error('[Health] Health check error:', e.message);
          // Even on error, return 200 OK - server is listening
          res.status(200).json({
            status: 'ok',
            serverReady: true,
            message: e.message,
            database: 'sqlite',
            path: getDatabasePath() || 'not-set',
            timestamp: now(),
            sqliteWorking: false,
            postgresqlAvailable: !!REMOTE_DATABASE_URL,
            postgresqlConnected: false
          });
        }
      });

}

module.exports = {
  registerOtherRoutes
};
