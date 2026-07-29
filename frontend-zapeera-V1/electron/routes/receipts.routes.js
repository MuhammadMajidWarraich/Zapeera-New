/**
 * Receipts Routes
 * Extracted from routes/index.js
 */

function registerReceiptsRoutes(app, authMiddleware, deps) {
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

// GET /api/receipts (line 12252)
      app.get('/api/receipts', authMiddleware, (req, res) => {
        try {
          console.log('[Receipts] GET - User:', req.user?.email, 'Role:', req.user?.role);
          const { branchId, companyId, limit = 100 } = req.query;
    
          // Get data filter based on user role
          const { branchFilter, companyFilter } = getDataFilter(req.user, branchId, companyId);
    
          let sql = 'SELECT * FROM receipts WHERE 1=1';
          const params = [];
    
          // CRITICAL FIX: STRICT data isolation - prevent data leakage
          const userRole = req.user?.role;
          if (userRole === 'ADMIN' || userRole === 'SUPERADMIN') {
            if (branchFilter && branchFilter.trim() !== '') {
              sql += ' AND branchId = ?';
              params.push(branchFilter);
            } else if (companyFilter && companyFilter.trim() !== '') {
              // When no branch but company selected, filter by companyId
              sql += ' AND companyId = ?';
              params.push(companyFilter);
              console.log('[Receipts] STRICT company filter:', companyFilter, '(prevents data leakage)');
            }
          } else {
            // CRITICAL FIX: STRICT filtering for other roles too
            if (branchFilter && branchFilter.trim() !== '') {
              sql += ' AND branchId = ?';
              params.push(branchFilter);
            } else if (companyFilter && companyFilter.trim() !== '') {
              // When no branch but company selected, filter by companyId
              sql += ' AND companyId = ?';
              params.push(companyFilter);
              console.log('[Receipts] STRICT company filter:', companyFilter, '(prevents data leakage)');
            }
          }
    
          sql += ' ORDER BY createdAt DESC';
          sql += ` LIMIT ${parseInt(limit) || 100}`;
    
          const receipts = query(sql, params).map(r => ({
            ...r,
            branch: r.branchId ? query('SELECT id, name FROM branches WHERE id = ?', [r.branchId])[0] : null,
            sale: r.saleId ? query('SELECT id, invoiceNumber, totalAmount FROM sales WHERE id = ?', [r.saleId])[0] : null,
            user: r.userId ? query('SELECT id, name, email FROM users WHERE id = ?', [r.userId])[0] : null
          }));
    
          console.log('[Receipts] Found:', receipts.length);
          res.json({ success: true, data: { receipts, pagination: { total: receipts.length, page: 1, limit: parseInt(limit) || 100, pages: 1 } } });
        } catch (e) {
          console.error('[Receipts] GET error:', e);
          res.status(500).json({ success: false, message: e.message });
        }
      });

}

module.exports = {
  registerReceiptsRoutes
};
