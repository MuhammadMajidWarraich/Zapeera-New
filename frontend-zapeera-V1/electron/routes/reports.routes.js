/**
 * Reports Routes
 * Extracted from routes/index.js
 */

function registerReportsRoutes(app, authMiddleware, deps) {
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

// GET /api/reports/sales (line 10209)
      app.get('/api/reports/sales', authMiddleware, (req, res) => {
        try {
          // Redirect to the proper implementation below
          // This endpoint is implemented at line 8091 with full backend logic
          console.log('[Reports/Sales] Using placeholder - proper implementation at line 8091');
          res.json({ success: true, data: query('SELECT * FROM sales ORDER BY createdAt DESC LIMIT 100') });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // GET /api/reports/inventory (line 10219)
      app.get('/api/reports/inventory', authMiddleware, (req, res) => {
        try {
          // Redirect to the proper implementation below
          // This endpoint is implemented at line 8176 with full backend logic
          console.log('[Reports/Inventory] Using placeholder - proper implementation at line 8176');
          res.json({ success: true, data: query('SELECT * FROM products WHERE isActive = 1 ORDER BY quantity ASC') });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // GET /api/reports/dashboard (line 11209)
      app.get('/api/reports/dashboard', authMiddleware, (req, res) => {
        try {
          console.log('[Reports/Dashboard] User:', req.user?.email, 'Role:', req.user?.role, 'Branch:', req.user?.branchId);
          const { branchId = '' } = req.query;
    
          // Get context from headers (set by frontend) - match backend
          const selectedCompanyId = req.headers['x-company-id'] || req.user?.selectedCompanyId;
          const selectedBranchId = req.headers['x-branch-id'] || req.user?.selectedBranchId || branchId;
    
          // Update user object with headers for getDataFilter
          if (selectedBranchId) req.user.selectedBranchId = selectedBranchId;
          if (selectedCompanyId) req.user.selectedCompanyId = selectedCompanyId;
    
          // Get data filter based on user role
          const { branchFilter, companyFilter } = getDataFilter(req.user, selectedBranchId, selectedCompanyId);
    
          let salesWhere = 'WHERE (status IS NULL OR status != \'REFUNDED\')';
          if (branchFilter) salesWhere += ` AND branchId = '${branchFilter}'`;
          if (companyFilter) salesWhere += ` AND companyId = '${companyFilter}'`;
    
          // Get the most recent day with sales data (for "today" display)
          const mostRecentSale = query(`SELECT createdAt FROM sales ${salesWhere} ORDER BY createdAt DESC LIMIT 1`)[0];
    
          let today, tomorrow;
          if (mostRecentSale) {
            today = new Date(mostRecentSale.createdAt);
            today.setHours(0, 0, 0, 0);
            tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
          } else {
            today = new Date();
            today.setHours(0, 0, 0, 0);
            tomorrow = new Date(today);
            tomorrow.setDate(tomorrow.getDate() + 1);
          }
    
          const todayStart = today.toISOString();
          const todayEnd = tomorrow.toISOString();
          const todayWhere = `${salesWhere} AND createdAt >= '${todayStart}' AND createdAt < '${todayEnd}'`;
    
          // Get today's sales summary
          const todaySales = query(`SELECT
            COUNT(*) as count,
            COALESCE(SUM(grandTotal), 0) as revenue,
            COALESCE(SUM(subtotal), 0) as subtotal,
            COALESCE(SUM(taxAmount), 0) as taxAmount,
            COALESCE(SUM(discountAmount), 0) as discountAmount
            FROM sales ${todayWhere}`)[0] || { count: 0, revenue: 0, subtotal: 0, taxAmount: 0, discountAmount: 0 };
    
          // Get yesterday's sales for comparison
          const yesterday = new Date(today);
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayEnd = new Date(tomorrow);
          yesterdayEnd.setDate(yesterdayEnd.getDate() - 1);
          const yesterdayStart = yesterday.toISOString();
          const yesterdayEndStr = yesterdayEnd.toISOString();
          const yesterdayWhere = `${salesWhere} AND createdAt >= '${yesterdayStart}' AND createdAt < '${yesterdayEndStr}'`;
    
          const yesterdaySales = query(`SELECT
            COALESCE(SUM(grandTotal), 0) as revenue
            FROM sales ${yesterdayWhere}`)[0] || { revenue: 0 };
    
          // Get month's sales
          const monthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
          const monthWhere = `${salesWhere} AND createdAt >= '${monthStart}'`;
          const monthSales = query(`SELECT
            COUNT(*) as count,
            COALESCE(SUM(grandTotal), 0) as revenue
            FROM sales ${monthWhere}`)[0] || { count: 0, revenue: 0 };
    
          // Get last month's sales for comparison
          const lastMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1).toISOString();
          const lastMonthEnd = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
          const lastMonthWhere = `${salesWhere} AND createdAt >= '${lastMonthStart}' AND createdAt < '${lastMonthEnd}'`;
          const lastMonthSales = query(`SELECT
            COALESCE(SUM(grandTotal), 0) as revenue
            FROM sales ${lastMonthWhere}`)[0] || { revenue: 0 };
    
          // Calculate profits (30% margin)
          const todayProfit = (parseFloat(todaySales.revenue) || 0) * 0.3;
          const monthProfit = (parseFloat(monthSales.revenue) || 0) * 0.3;
    
          // Calculate growth percentages
          const todayGrowth = parseFloat(yesterdaySales.revenue) > 0
            ? ((parseFloat(todaySales.revenue) || 0) - parseFloat(yesterdaySales.revenue)) / parseFloat(yesterdaySales.revenue) * 100
            : 0;
    
          const monthGrowth = parseFloat(lastMonthSales.revenue) > 0
            ? ((parseFloat(monthSales.revenue) || 0) - parseFloat(lastMonthSales.revenue)) / parseFloat(lastMonthSales.revenue) * 100
            : 0;
    
          // Get recent sales
          const recentSales = query(`SELECT s.*,
            c.name as customer_name, c.phone as customer_phone
            FROM sales s
            LEFT JOIN customers c ON s.customerId = c.id
            ${todayWhere}
            ORDER BY s.createdAt DESC
            LIMIT 5`);
    
          const formattedRecentSales = recentSales.map(sale => ({
            id: sale.id,
            totalAmount: parseFloat(sale.grandTotal) || 0,
            createdAt: sale.createdAt,
            customer: sale.customer_name ? {
              name: sale.customer_name,
              phone: sale.customer_phone
            } : null,
            items: [] // Items would need a separate query
          }));
    
          res.json({
            success: true,
            data: {
              today: {
                revenue: parseFloat(todaySales.revenue) || 0,
                profit: todayProfit,
                transactions: parseInt(todaySales.count) || 0,
                growth: todayGrowth
              },
              month: {
                revenue: parseFloat(monthSales.revenue) || 0,
                profit: monthProfit,
                transactions: parseInt(monthSales.count) || 0,
                growth: monthGrowth
              },
              recentSales: formattedRecentSales
            }
          });
        } catch (e) {
          console.error('[Reports/Dashboard] Error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // GET /api/reports/sales (line 11345)
      app.get('/api/reports/sales', authMiddleware, (req, res) => {
        try {
          console.log('[Reports/Sales] User:', req.user?.email, 'Role:', req.user?.role, 'Branch:', req.user?.branchId);
          const { startDate, endDate, branchId, companyId, period } = req.query;
    
          // Get context from headers (set by frontend) - match backend
          const selectedCompanyId = req.headers['x-company-id'] || req.user?.selectedCompanyId;
          const selectedBranchId = req.headers['x-branch-id'] || req.user?.selectedBranchId;
    
          // Update user object with headers for getDataFilter
          if (selectedBranchId) req.user.selectedBranchId = selectedBranchId;
          if (selectedCompanyId) req.user.selectedCompanyId = selectedCompanyId;
    
          // Get data filter based on user role
          const { branchFilter, companyFilter } = getDataFilter(req.user, branchId, companyId);
    
          // Build WHERE clause with data isolation - MATCH BACKEND EXACTLY
          let whereClause = 'WHERE 1=1';
          // Exclude refunded sales from reports (match backend)
          whereClause += ` AND (status IS NULL OR status != 'REFUNDED')`;
    
          if (branchFilter) whereClause += ` AND branchId = '${branchFilter}'`;
          if (companyFilter) whereClause += ` AND companyId = '${companyFilter}'`;
    
          // Handle period-based filtering - MATCH BACKEND DATE HANDLING
          const today = new Date().toISOString().split('T')[0];
          let periodStartDate = startDate;
    
          if (period === 'today') {
            periodStartDate = today;
          } else if (period === 'week' || period === 'this_week') {
            periodStartDate = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          } else if (period === 'month' || period === 'this_month') {
            periodStartDate = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          } else if (period === 'year' || period === 'this_year') {
            periodStartDate = new Date(new Date().getFullYear(), 0, 1).toISOString().split('T')[0];
          }
    
          // Match backend: Add 23:59:59 to end date to include the entire day
          if (periodStartDate) whereClause += ` AND DATE(createdAt) >= '${periodStartDate}'`;
          if (endDate) {
            const endDateWithTime = new Date(endDate);
            endDateWithTime.setHours(23, 59, 59, 999);
            whereClause += ` AND createdAt <= '${endDateWithTime.toISOString()}'`;
          }
    
          // Match backend: Use totalAmount instead of grandTotal, subtotal, taxAmount, discountAmount
          const sales = query(`SELECT * FROM sales ${whereClause} ORDER BY createdAt DESC LIMIT 100`);
          const totalRevenue = query(`SELECT SUM(totalAmount) as total FROM sales ${whereClause}`)[0]?.total ||
                              query(`SELECT SUM(grandTotal) as total FROM sales ${whereClause}`)[0]?.total || 0;
          const totalSales = query(`SELECT COUNT(*) as count FROM sales ${whereClause}`)[0]?.count || 0;
          const totalDiscount = query(`SELECT SUM(discountAmount) as total FROM sales ${whereClause}`)[0]?.total ||
                               query(`SELECT SUM(discount) as total FROM sales ${whereClause}`)[0]?.total || 0;
          const totalTax = query(`SELECT SUM(taxAmount) as total FROM sales ${whereClause}`)[0]?.total ||
                           query(`SELECT SUM(tax) as total FROM sales ${whereClause}`)[0]?.total || 0;
          const totalSubtotal = query(`SELECT SUM(subtotal) as total FROM sales ${whereClause}`)[0]?.total || totalRevenue;
    
          console.log('[Reports/Sales] Found sales:', totalSales, 'Revenue:', totalRevenue);
    
          // Sales by payment method - Match backend field names
          const salesByPaymentMethod = query(`SELECT paymentMethod, COUNT(*) as count, SUM(totalAmount) as total FROM sales ${whereClause} GROUP BY paymentMethod`).map(item => ({
            paymentMethod: item.paymentMethod,
            _sum: { totalAmount: item.total || 0 },
            _count: { id: item.count || 0 }
          }));
    
          // Top products (with branch filter)
          let topProductsWhere = branchFilter ? `AND s.branchId = '${branchFilter}'` : '';
          if (companyFilter) topProductsWhere += ` AND s.companyId = '${companyFilter}'`;
    
          const topProducts = query(`SELECT p.id, p.name, SUM(si.quantity) as totalQty, SUM(si.total) as totalRevenue
            FROM sale_items si JOIN products p ON si.productId = p.id
            JOIN sales s ON si.saleId = s.id WHERE 1=1 ${topProductsWhere}
            GROUP BY p.id ORDER BY totalRevenue DESC LIMIT 10`);
    
          // CRITICAL FIX: Generate salesTrend based on groupBy parameter and date range
          // Match backend format: { createdAt: Date, _sum: { totalAmount }, _count: { id } }
          const groupBy = req.query.groupBy || (period === 'today' ? 'hour' : 'day');
          const salesTrend = [];
    
          // Calculate date range
          const actualStartDate = periodStartDate || startDate || new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
          const actualEndDate = endDate || today;
    
          console.log('[Reports/Sales] Generating salesTrend:', { groupBy, period, actualStartDate, actualEndDate, branchFilter, companyFilter });
    
          // Build base WHERE clause for trend
          let trendWhere = whereClause;
    
          // CRITICAL FIX: Handle "today" period with hourly grouping
          if (period === 'today' || groupBy === 'hour') {
            // Group by hour for today
            const todayStart = new Date(today + 'T00:00:00');
            const now = new Date();
    
            for (let hour = 0; hour <= now.getHours(); hour++) {
              const hourStart = new Date(todayStart);
              hourStart.setHours(hour, 0, 0, 0);
              const hourEnd = new Date(hourStart);
              hourEnd.setHours(hour, 59, 59, 999);
    
              const hourWhere = trendWhere + ` AND createdAt >= '${hourStart.toISOString()}' AND createdAt <= '${hourEnd.toISOString()}'`;
              const hourData = query(`SELECT SUM(totalAmount) as total, SUM(grandTotal) as grandTotal, COUNT(*) as count FROM sales ${hourWhere}`)[0];
    
              salesTrend.push({
                createdAt: hourStart,
                _sum: { totalAmount: parseFloat(hourData?.total || hourData?.grandTotal || 0) },
                _count: { id: parseInt(hourData?.count || 0) }
              });
            }
          } else if (groupBy === 'day') {
            // Group by day
            const start = new Date(actualStartDate);
            const end = new Date(actualEndDate);
            const days = Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    
            for (let i = 0; i < days; i++) {
              const currentDate = new Date(start);
              currentDate.setDate(start.getDate() + i);
              const dateStr = currentDate.toISOString().split('T')[0];
    
              const dayWhere = trendWhere + ` AND DATE(createdAt) = '${dateStr}'`;
              const dayData = query(`SELECT SUM(totalAmount) as total, SUM(grandTotal) as grandTotal, COUNT(*) as count FROM sales ${dayWhere}`)[0];
    
              salesTrend.push({
                createdAt: new Date(dateStr + 'T00:00:00'),
                _sum: { totalAmount: parseFloat(dayData?.total || dayData?.grandTotal || 0) },
                _count: { id: parseInt(dayData?.count || 0) }
              });
            }
          } else if (groupBy === 'week') {
            // Group by week
            const start = new Date(actualStartDate);
            const end = new Date(actualEndDate);
            const weeks = {};
    
            const sales = query(`SELECT createdAt, totalAmount, grandTotal FROM sales ${trendWhere}`);
            sales.forEach(sale => {
              const saleDate = new Date(sale.createdAt);
              const weekKey = `${saleDate.getFullYear()}-W${getWeekNumber(saleDate)}`;
    
              if (!weeks[weekKey]) {
                weeks[weekKey] = { total: 0, count: 0 };
              }
              weeks[weekKey].total += parseFloat(sale.totalAmount || sale.grandTotal || 0);
              weeks[weekKey].count += 1;
            });
    
            Object.entries(weeks).forEach(([weekKey, data]) => {
              const [year, weekNum] = weekKey.split('-W');
              const weekStart = getDateFromWeek(parseInt(year), parseInt(weekNum));
              salesTrend.push({
                createdAt: weekStart,
                _sum: { totalAmount: data.total },
                _count: { id: data.count }
              });
            });
    
            salesTrend.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
          } else if (groupBy === 'month') {
            // Group by month
            const months = {};
    
            const sales = query(`SELECT createdAt, totalAmount, grandTotal FROM sales ${trendWhere}`);
            sales.forEach(sale => {
              const saleDate = new Date(sale.createdAt);
              const monthKey = `${saleDate.getFullYear()}-${String(saleDate.getMonth() + 1).padStart(2, '0')}`;
    
              if (!months[monthKey]) {
                months[monthKey] = { total: 0, count: 0 };
              }
              months[monthKey].total += parseFloat(sale.totalAmount || sale.grandTotal || 0);
              months[monthKey].count += 1;
            });
    
            Object.entries(months).forEach(([monthKey, data]) => {
              salesTrend.push({
                createdAt: new Date(monthKey + '-01'),
                _sum: { totalAmount: data.total },
                _count: { id: data.count }
              });
            });
    
            salesTrend.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
          } else if (groupBy === 'year') {
            // Group by year
            const years = {};
    
            const sales = query(`SELECT createdAt, totalAmount, grandTotal FROM sales ${trendWhere}`);
            sales.forEach(sale => {
              const saleDate = new Date(sale.createdAt);
              const yearKey = saleDate.getFullYear().toString();
    
              if (!years[yearKey]) {
                years[yearKey] = { total: 0, count: 0 };
              }
              years[yearKey].total += parseFloat(sale.totalAmount || sale.grandTotal || 0);
              years[yearKey].count += 1;
            });
    
            Object.entries(years).forEach(([yearKey, data]) => {
              salesTrend.push({
                createdAt: new Date(yearKey + '-01-01'),
                _sum: { totalAmount: data.total },
                _count: { id: data.count }
              });
            });
    
            salesTrend.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
          }
    
          console.log('[Reports/Sales] Generated salesTrend:', salesTrend.length, 'items');
    
          res.json({ success: true, data: {
            summary: { totalSales, totalRevenue, totalSubtotal, totalTax, totalDiscount },
            salesByPaymentMethod,
            topProducts: topProducts.map(p => ({
              productId: p.id,
              product: { id: p.id, name: p.name, category: { name: p.categoryName || 'Uncategorized' } },
              _sum: { quantity: p.totalQty || 0, totalPrice: p.totalRevenue || 0 },
              _count: { id: 1 }
            })),
            salesTrend,
            sales: sales.map(s => ({
              ...s,
              customer: s.customerId ? query('SELECT id, name, phone FROM customers WHERE id = ?', [s.customerId])[0] : null
            }))
          }});
        } catch (e) {
          console.error('[Reports/Sales] Error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // GET /api/reports/inventory (line 11580)
      app.get('/api/reports/inventory', authMiddleware, (req, res) => {
        try {
          console.log('[Reports/Inventory] User:', req.user?.email, 'Branch:', req.user?.branchId);
          const { branchId, companyId } = req.query;
    
          // Get context from headers (set by frontend) - match backend
          const selectedCompanyId = req.headers['x-company-id'] || req.user?.selectedCompanyId;
          const selectedBranchId = req.headers['x-branch-id'] || req.user?.selectedBranchId;
    
          // Update user object with headers for getDataFilter
          if (selectedBranchId) req.user.selectedBranchId = selectedBranchId;
          if (selectedCompanyId) req.user.selectedCompanyId = selectedCompanyId;
    
          // Get data filter based on user role
          const { branchFilter, companyFilter } = getDataFilter(req.user, branchId, companyId);
    
          let whereClause = 'WHERE isActive = 1';
          if (branchFilter) whereClause += ` AND branchId = '${branchFilter}'`;
          if (companyFilter) whereClause += ` AND companyId = '${companyFilter}'`;
    
          // Match backend: Stock is now managed through batches, not product.quantity
          const products = query(`SELECT * FROM products ${whereClause} ORDER BY quantity ASC`);
          const totalProducts = products.length;
    
          // Calculate stock from batches (match backend logic)
          let totalStock = 0;
          let totalValue = 0;
          let lowStockCount = 0;
          let outOfStock = 0;
    
          products.forEach(p => {
            // Get stock from batches for this product
            const batches = query('SELECT SUM(quantity) as total FROM batches WHERE productId = ? AND (isActive = 1 OR isActive IS NULL)', [p.id]);
            const batchStock = batches[0]?.total || 0;
            const productStock = batchStock > 0 ? batchStock : (p.quantity || 0);
    
            totalStock += productStock;
            totalValue += productStock * (p.costPrice || 0);
    
            if (productStock <= (p.minStock || 0)) lowStockCount++;
            if (productStock === 0) outOfStock++;
          });
    
          console.log('[Reports/Inventory] Products:', totalProducts, 'Stock:', totalStock);
    
          // Match backend: Use batch-based stock calculations
          const lowStockProducts = products.filter(p => {
            const batches = query('SELECT SUM(quantity) as total FROM batches WHERE productId = ? AND (isActive = 1 OR isActive IS NULL)', [p.id]);
            const batchStock = batches[0]?.total || 0;
            const productStock = batchStock > 0 ? batchStock : (p.quantity || 0);
            return productStock <= (p.minStock || 0);
          }).map(p => {
            const batches = query('SELECT SUM(quantity) as total FROM batches WHERE productId = ? AND (isActive = 1 OR isActive IS NULL)', [p.id]);
            const batchStock = batches[0]?.total || 0;
            const productStock = batchStock > 0 ? batchStock : (p.quantity || 0);
            return {
              ...p,
              stock: productStock,
              quantity: productStock,
              category: p.categoryId ? query('SELECT name FROM categories WHERE id = ?', [p.categoryId])[0] : { name: 'Uncategorized' },
              supplier: p.supplierId ? query('SELECT name FROM suppliers WHERE id = ?', [p.supplierId])[0] : { name: 'Unknown' }
            };
          });
    
          // Products by category (with filter)
          const productsByCategory = query(`SELECT c.name as category, COUNT(p.id) as count, SUM(p.quantity) as totalStock
            FROM products p LEFT JOIN categories c ON p.categoryId = c.id ${whereClause.replace('WHERE', 'WHERE p.')} GROUP BY c.id`);
    
          res.json({ success: true, data: {
            summary: { totalProducts, totalStock, totalValue, lowStockCount, outOfStock },
            productsByCategory,
            lowStockProducts
          }});
        } catch (e) {
          console.error('[Reports/Inventory] Error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // GET /api/reports/customers (line 11660)
      app.get('/api/reports/customers', authMiddleware, (req, res) => {
        try {
          console.log('[Reports/Customers] User:', req.user?.email, 'Branch:', req.user?.branchId);
          const { startDate, endDate, branchId, companyId, vip } = req.query;
    
          // Get context from headers (set by frontend) - match backend
          const selectedCompanyId = req.headers['x-company-id'] || req.user?.selectedCompanyId;
          const selectedBranchId = req.headers['x-branch-id'] || req.user?.selectedBranchId;
    
          // Update user object with headers for getDataFilter
          if (selectedBranchId) req.user.selectedBranchId = selectedBranchId;
          if (selectedCompanyId) req.user.selectedCompanyId = selectedCompanyId;
    
          // Get data filter based on user role
          const { branchFilter, companyFilter } = getDataFilter(req.user, branchId, companyId);
    
          // Build WHERE clause - Match backend logic
          let whereClause = 'WHERE isActive = 1';
          if (branchFilter) whereClause += ` AND branchId = '${branchFilter}'`;
          if (companyFilter) whereClause += ` AND companyId = '${companyFilter}'`;
          if (vip === 'true') whereClause += ` AND isVIP = 1`;
    
          const customers = query(`SELECT * FROM customers ${whereClause} ORDER BY createdAt DESC`);
          const totalCustomers = customers.length;
    
          // Calculate total spent from sales - Match backend
          let salesWhere = 'WHERE 1=1';
          if (branchFilter) salesWhere += ` AND branchId = '${branchFilter}'`;
          if (companyFilter) salesWhere += ` AND companyId = '${companyFilter}'`;
          if (startDate) salesWhere += ` AND DATE(createdAt) >= '${startDate}'`;
          if (endDate) {
            const endDateWithTime = new Date(endDate);
            endDateWithTime.setHours(23, 59, 59, 999);
            salesWhere += ` AND createdAt <= '${endDateWithTime.toISOString()}'`;
          }
    
          const totalSpent = query(`SELECT SUM(totalAmount) as total FROM sales ${salesWhere}`)[0]?.total ||
                             query(`SELECT SUM(grandTotal) as total FROM sales ${salesWhere}`)[0]?.total || 0;
          const totalLoyaltyPoints = query(`SELECT SUM(loyaltyPoints) as total FROM customers ${whereClause}`)[0]?.total || 0;
    
          // Customers by VIP status - Match backend
          const customersByVIP = query(`SELECT isVIP, COUNT(*) as count, SUM(totalPurchases) as totalSpent, SUM(loyaltyPoints) as totalPoints
            FROM customers ${whereClause} GROUP BY isVIP`).map(item => ({
            isVIP: item.isVIP || false,
            _count: { id: item.count || 0 },
            _sum: { totalPurchases: item.totalSpent || 0, loyaltyPoints: item.totalPoints || 0 }
          }));
    
          // Top customers by spending - Match backend
          const topCustomers = customers
            .sort((a, b) => (b.totalPurchases || 0) - (a.totalPurchases || 0))
            .slice(0, 10)
            .map(c => ({
              ...c,
              _count: { sales: query('SELECT COUNT(*) as count FROM sales WHERE customerId = ?', [c.id])[0]?.count || 0 }
            }));
    
          // Recent customers - Match backend
          const recentCustomers = customers.slice(0, 10).map(c => ({
            id: c.id,
            name: c.name,
            phone: c.phone,
            createdAt: c.createdAt,
            totalPurchases: c.totalPurchases || 0
          }));
    
          res.json({ success: true, data: {
            summary: {
              totalCustomers,
              totalSpent,
              totalLoyaltyPoints,
              averageSpent: totalCustomers > 0 ? totalSpent / totalCustomers : 0
            },
            customersByVIP,
            topCustomers,
            recentCustomers
          }});
        } catch (e) {
          console.error('[Reports/Customers] Error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // GET /api/reports/products (line 11744)
      app.get('/api/reports/products', authMiddleware, (req, res) => {
        try {
          console.log('[Reports/Products] User:', req.user?.email, 'Branch:', req.user?.branchId);
          const { branchId, companyId } = req.query;
    
          // Get context from headers (set by frontend) - match backend
          const selectedCompanyId = req.headers['x-company-id'] || req.user?.selectedCompanyId;
          const selectedBranchId = req.headers['x-branch-id'] || req.user?.selectedBranchId;
    
          // Update user object with headers for getDataFilter
          if (selectedBranchId) req.user.selectedBranchId = selectedBranchId;
          if (selectedCompanyId) req.user.selectedCompanyId = selectedCompanyId;
    
          // Get data filter based on user role (match backend)
          const { branchFilter, companyFilter } = getDataFilter(req.user, branchId, companyId);
    
          let whereClause = 'WHERE isActive = 1';
          if (branchFilter) whereClause += ` AND branchId = '${branchFilter}'`;
          if (companyFilter) whereClause += ` AND companyId = '${companyFilter}'`;
    
          // Get top products with stock from batches (match backend)
          const products = query(`SELECT * FROM products ${whereClause} ORDER BY createdAt DESC LIMIT 20`);
    
          const topProducts = products.map(p => {
            // Calculate stock from batches (match backend)
            const batches = query('SELECT SUM(quantity) as total FROM batches WHERE productId = ? AND (isActive = 1 OR isActive IS NULL)', [p.id]);
            const batchStock = batches[0]?.total || 0;
            const productStock = batchStock > 0 ? batchStock : (p.quantity || 0);
    
            return {
              productId: p.id,
              product: {
                id: p.id,
                name: p.name,
                stock: productStock,
                sellingPrice: p.sellingPrice || p.unitPrice || 0,
                category: p.categoryId ? query('SELECT name FROM categories WHERE id = ?', [p.categoryId])[0] : { name: 'Uncategorized' }
              },
              _sum: {
                quantity: productStock,
                totalPrice: productStock * (p.sellingPrice || p.unitPrice || 0)
              },
              _count: { id: 1 }
            };
          });
    
          // Category performance (match backend)
          const categoryPerformance = query(`SELECT c.id, c.name, COUNT(p.id) as productCount, SUM(p.quantity) as totalStock
            FROM categories c LEFT JOIN products p ON c.id = p.categoryId ${whereClause.replace('WHERE', 'WHERE p.')}
            GROUP BY c.id ORDER BY productCount DESC`).map(item => ({
            category: { id: item.id, name: item.name },
            _count: { products: item.productCount || 0 },
            _sum: { stock: item.totalStock || 0 }
          }));
    
          res.json({
            success: true,
            data: {
              topProducts,
              categoryPerformance
            }
          });
        } catch (e) {
          console.error('[Reports/Products] Error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

}

module.exports = {
  registerReportsRoutes
};
