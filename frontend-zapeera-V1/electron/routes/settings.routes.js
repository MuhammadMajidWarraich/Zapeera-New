/**
 * Settings Routes
 * Extracted from routes/index.js
 */

function registerSettingsRoutes(app, authMiddleware, deps) {
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

// GET /api/settings (line 10729)
      app.get('/api/settings', authMiddleware, (req, res) => {
        try {
          const settings = query('SELECT * FROM settings');
          const obj = {};
          settings.forEach(s => { obj[s.key] = s.value; });
          res.json({ success: true, data: obj });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // PUT /api/settings (line 10739)
      app.put('/api/settings', authMiddleware, (req, res) => {
        try {
          Object.entries(req.body).forEach(([key, value]) => {
            const exists = query('SELECT id FROM settings WHERE key = ?', [key]);
            if (exists.length) {
              run('UPDATE settings SET value = ?, updatedAt = ? WHERE key = ?', [value, now(), key]);
              const setting = query('SELECT * FROM settings WHERE key = ?', [key])[0];
              // 🔄 TWO-WAY SYNC: Queue for sync to PostgreSQL
              if (setting) handleDataChange('settings', 'update', setting);
            } else {
              const id = uuid();
              run('INSERT INTO settings (id, key, value, createdAt, updatedAt) VALUES (?,?,?,?,?)', [id, key, value, now(), now()]);
              const setting = query('SELECT * FROM settings WHERE id = ?', [id])[0];
              // 🔄 TWO-WAY SYNC: Queue for sync to PostgreSQL
              if (setting) handleDataChange('settings', 'create', setting);
            }
          });
          res.json({ success: true, message: 'Settings updated' });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

}

module.exports = {
  registerSettingsRoutes
};
