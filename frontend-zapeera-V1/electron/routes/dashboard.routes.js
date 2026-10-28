/**
 * Dashboard Routes
 * Extracted from routes/index.js
 */

function registerDashboardRoutes(app, authMiddleware, deps) {
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

// GET /api/dashboard/stats (line 10065)
      app.get('/api/dashboard/stats', authMiddleware, (req, res) => {
        try {
          console.log('[Dashboard/Stats] User:', req.user?.email, 'Role:', req.user?.role, 'Branch:', req.user?.branchId);
          const { branchId, companyId } = req.query;
    
          // Get data filter based on user role
          const { branchFilter, companyFilter } = getDataFilter(req.user, branchId, companyId);
    
          // Build WHERE clauses — PARAMETERIZED (SQLi fix 2026-10-28).
          // All four clauses append branch then company in the same
          // order, so one scopeParams array serves every query below.
          let productWhere = 'WHERE isActive = 1';
          let customerWhere = 'WHERE isActive = 1';
          let salesWhere = 'WHERE 1=1';
          let purchaseWhere = "WHERE status != 'DELETED'";
          const scopeParams = [];
    
          if (branchFilter) {
            productWhere += ' AND branchId = ?';
            customerWhere += ' AND branchId = ?';
            salesWhere += ' AND branchId = ?';
            purchaseWhere += ' AND branchId = ?';
            scopeParams.push(branchFilter);
          }
          if (companyFilter) {
            productWhere += ' AND companyId = ?';
            customerWhere += ' AND companyId = ?';
            salesWhere += ' AND companyId = ?';
            purchaseWhere += ' AND companyId = ?';
            scopeParams.push(companyFilter);
          }
    
          const today = new Date().toISOString().split('T')[0];
    
          const stats = {
            totalProducts: query(`SELECT COUNT(*) as c FROM products ${productWhere}`, scopeParams)[0]?.c || 0,
            totalCustomers: query(`SELECT COUNT(*) as c FROM customers ${customerWhere}`, scopeParams)[0]?.c || 0,
            totalSales: query(`SELECT COUNT(*) as c FROM sales ${salesWhere}`, scopeParams)[0]?.c || 0,
            totalRevenue: query(`SELECT SUM(totalAmount) as t FROM sales ${salesWhere}`, scopeParams)[0]?.t || 0,
            todaySales: query(`SELECT COUNT(*) as c FROM sales ${salesWhere} AND DATE(createdAt) = ?`, [...scopeParams, today])[0]?.c || 0,
            todayRevenue: query(`SELECT SUM(totalAmount) as t FROM sales ${salesWhere} AND DATE(createdAt) = ?`, [...scopeParams, today])[0]?.t || 0,
            lowStockProducts: query(`SELECT COUNT(*) as c FROM products ${productWhere} AND quantity <= minStock`, scopeParams)[0]?.c || 0,
            outOfStock: query(`SELECT COUNT(*) as c FROM products ${productWhere} AND quantity = 0`, scopeParams)[0]?.c || 0,
            pendingOrders: query(`SELECT COUNT(*) as c FROM purchases ${purchaseWhere} AND status = 'PENDING'`, scopeParams)[0]?.c || 0
          };
    
          console.log('[Dashboard/Stats] Returning stats:', stats);
          res.json({ success: true, data: stats });
        } catch (e) {
          console.error('[Dashboard/Stats] Error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // GET /api/dashboard/chart (line 10115)
      app.get('/api/dashboard/chart', authMiddleware, (req, res) => {
        try {
          console.log('[Dashboard/Chart] User:', req.user?.email, 'Period:', req.query.period);
          const { period = 'week', branchId, companyId } = req.query;
    
          // Get data filter based on user role
          const { branchFilter, companyFilter } = getDataFilter(req.user, branchId, companyId);
    
          // Build WHERE clause — PARAMETERIZED (SQLi fix 2026-10-28).
          let whereClause = 'WHERE 1=1';
          const chartScopeParams = [];
          if (branchFilter) { whereClause += ' AND branchId = ?'; chartScopeParams.push(branchFilter); }
          if (companyFilter) { whereClause += ' AND companyId = ?'; chartScopeParams.push(companyFilter); }
    
          // Determine date range based on period
          let days;
          let startDate;
          const today = new Date();
    
          switch(period) {
            case 'today':
              days = 1;
              startDate = new Date().toISOString().split('T')[0];
              break;
            case 'week':
            case 'this_week':
            case '7days':
              days = 7;
              startDate = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
              break;
            case 'month':
            case 'this_month':
            case '30days':
              days = 30;
              startDate = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
              break;
            case 'year':
            case 'this_year':
              days = 365;
              startDate = new Date(today.getFullYear(), 0, 1).toISOString().split('T')[0];
              break;
            default:
              days = 7;
              startDate = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          }
    
          const data = [];
    
          // Generate data points
          for (let i = Math.min(days, 30) - 1; i >= 0; i--) {
            const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
            const result = query(`SELECT SUM(totalAmount) as total, COUNT(*) as count FROM sales ${whereClause} AND DATE(createdAt) = ?`, [...chartScopeParams, date])[0];
    
            data.push({
              date,
              sales: result?.total || 0,
              revenue: result?.total || 0,
              orders: result?.count || 0,
              name: new Date(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
            });
          }
    
          // Summary for the period
          const summary = query(`SELECT SUM(totalAmount) as totalRevenue, COUNT(*) as totalOrders FROM sales ${whereClause} AND DATE(createdAt) >= ?`, [...chartScopeParams, startDate])[0];
    
          console.log('[Dashboard/Chart] Returning', data.length, 'data points, Summary:', summary);
    
          res.json({
            success: true,
            data,
            summary: {
              totalRevenue: summary?.totalRevenue || 0,
              totalOrders: summary?.totalOrders || 0,
              averageOrder: summary?.totalOrders > 0 ? (summary?.totalRevenue / summary?.totalOrders) : 0
            }
          });
        } catch (e) {
          console.error('[Dashboard/Chart] Error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // GET /api/dashboard/admin-stats (line 10197)
      app.get('/api/dashboard/admin-stats', authMiddleware, (req, res) => {
        try {
          res.json({ success: true, data: {
            totalCompanies: query('SELECT COUNT(*) as c FROM companies WHERE isActive = 1')[0]?.c || 0,
            totalBranches: query('SELECT COUNT(*) as c FROM branches WHERE isActive = 1')[0]?.c || 0,
            totalUsers: query('SELECT COUNT(*) as c FROM users WHERE isActive = 1')[0]?.c || 0,
            totalProducts: query('SELECT COUNT(*) as c FROM products WHERE isActive = 1')[0]?.c || 0
          }});
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

}

module.exports = {
  registerDashboardRoutes
};
