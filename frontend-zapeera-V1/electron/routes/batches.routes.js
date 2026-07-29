/**
 * Batches Routes
 * Extracted from routes/index.js
 */

function registerBatchesRoutes(app, authMiddleware, deps) {
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

// GET /api/batches (line 5879)
      app.get('/api/batches', authMiddleware, (req, res) => {
        try {
          console.log('[Batches] GET - User:', req.user?.email, 'Branch:', req.user?.branchId);
          const { productId, branchId, companyId, search, isActive, isReported } = req.query;
    
          // CRITICAL FIX: Read from headers first (set by frontend), then from user object
          // Headers take priority - this allows "All Branches" selection (null branchId)
          const headerBranchId = req.headers['x-branch-id'];
          const headerCompanyId = req.headers['x-company-id'];
    
          // If headerBranchId is explicitly set (even if empty string), use it
          // If headerBranchId is undefined, fall back to user's selectedBranchId or branchId
          let targetBranchId = headerBranchId !== undefined ? (headerBranchId || null) : (req.user?.selectedBranchId || req.user?.branchId);
          let targetCompanyId = headerCompanyId || req.user?.selectedCompanyId || req.user?.companyId;
    
          console.log('[Batches] Context from headers:', { headerBranchId, headerCompanyId });
          console.log('[Batches] Final context:', { targetBranchId, targetCompanyId, isAllBranches: !targetBranchId && targetCompanyId ? 'YES' : 'NO' });
    
          // CRITICAL FIX: For ADMIN/SUPERADMIN users, if headerCompanyId is set but headerBranchId is undefined,
          // this means "All Branches" was selected - don't use user's assigned branch
          if ((req.user?.role === 'ADMIN' || req.user?.role === 'SUPERADMIN') && headerCompanyId && headerBranchId === undefined) {
            // "All Branches" selected - keep targetBranchId as null to get all branches' batches
            targetBranchId = null;
            console.log('[Batches] ADMIN - All Branches selected (headerCompanyId set, headerBranchId undefined), keeping targetBranchId as null');
          } else if (req.user?.role !== 'SUPERADMIN') {
            // For non-ADMIN users, use their assigned branch if header didn't provide one
            if (headerBranchId === undefined && !targetBranchId) {
              targetBranchId = req.user?.branchId;
            }
            // Only use user's assigned company if header didn't provide one
            if (!headerCompanyId && !targetCompanyId) {
              targetCompanyId = req.user?.companyId;
            }
          }
    
          // If we have branchId but no companyId, get companyId from the branch (match website)
          if (targetBranchId && !targetCompanyId) {
            const branch = query('SELECT companyId FROM branches WHERE id = ?', [targetBranchId])[0];
            if (branch?.companyId) {
              targetCompanyId = branch.companyId;
              console.log('[Batches] Got companyId from branch:', targetCompanyId);
            }
          }
    
          // Override with query params if provided
          if (branchId) targetBranchId = branchId;
          if (companyId) targetCompanyId = companyId;
    
          // Check if isActive and isReported columns exist
          let hasIsActiveColumn = true;
          let hasIsReportedColumn = true;
          try {
            const tableInfo = query("PRAGMA table_info(batches)");
            hasIsActiveColumn = tableInfo.some(col => col.name === 'isActive');
            hasIsReportedColumn = tableInfo.some(col => col.name === 'isReported');
          } catch (e) {
            hasIsActiveColumn = false;
            hasIsReportedColumn = false;
          }
    
          // SENIOR ENGINEER FIX: Match website - don't filter by isActive by default
          // Website only filters by isActive if explicitly requested via query param
          let sql = 'SELECT * FROM batches WHERE 1=1';
          const params = [];
    
          // Apply branch and company filters
          // CRITICAL: Only filter by branchId if it's explicitly provided (not null)
          // When "All Branches" is selected, targetBranchId will be null, so we only filter by companyId
          if (targetBranchId) {
            sql += ' AND branchId = ?';
            params.push(targetBranchId);
            console.log('[Batches] Filtering by branchId:', targetBranchId);
          } else if (targetCompanyId) {
            // When All Branches is selected (no branchId), filter by companyId to get all branches' batches
            console.log('[Batches] All Branches selected - will filter by companyId only:', targetCompanyId);
          }
          if (targetCompanyId) {
            sql += ' AND companyId = ?';
            params.push(targetCompanyId);
            console.log('[Batches] Filtering by companyId:', targetCompanyId);
          }

          // CRITICAL FIX: Data isolation - filter by createdBy for non-SUPERADMIN users
          // This ensures each business only sees their own batches
          if (req.user?.role !== 'SUPERADMIN' && req.user?.createdBy) {
            sql += ' AND createdBy = ?';
            params.push(req.user.createdBy);
            console.log('[Batches] Filtering by createdBy for data isolation:', req.user.createdBy);
          }

          // Only filter by isActive if explicitly requested (match website)
          if (isActive !== undefined && hasIsActiveColumn) {
            if (isActive === 'true' || isActive === true || isActive === '1') {
              sql += ' AND (isActive = 1 OR isActive IS NULL)';
            } else if (isActive === 'false' || isActive === false || isActive === '0') {
              sql += ' AND isActive = 0';
            }
          }
    
          // CRITICAL FIX: Filter by isReported - check for isReported column, not isActive
          // Handle both string and boolean values from query params
          if (hasIsReportedColumn) {
            if (isReported !== undefined && isReported !== null && isReported !== '') {
              // isReported parameter is explicitly provided
              const isReportedValue = isReported === 'true' || isReported === true || isReported === '1' || isReported === 1;
              if (isReportedValue) {
              sql += ' AND isReported = 1';
                console.log('[Batches] Filtering for reported batches (isReported = 1)');
              } else {
                // Explicitly false - show only non-reported
                sql += ' AND (isReported = 0 OR isReported IS NULL)';
                console.log('[Batches] Filtering for non-reported batches (isReported = 0 or NULL)');
              }
            } else {
              // isReported not specified - default to showing only non-reported batches
              // This ensures reported batches don't show in active tab by default
              sql += ' AND (isReported = 0 OR isReported IS NULL)';
              console.log('[Batches] Default: Showing only non-reported batches (isReported not specified)');
            }
          }
    
          if (productId) {
            sql += ' AND productId = ?';
            params.push(productId);
          }
    
          if (search) {
            // Match backend-zp: search in batchNo, supplierName, supplierInvoiceNo, and product name/formula
            const searchTerm = `%${search}%`;
            // For product name/formula, we need to join or subquery
            const productIds = query('SELECT id FROM products WHERE name LIKE ? OR formula LIKE ?', [searchTerm, searchTerm]).map(p => p.id);
            if (productIds.length > 0) {
              sql += ' AND (batchNo LIKE ? OR batchNumber LIKE ? OR supplierName LIKE ? OR supplierInvoiceNo LIKE ? OR productId IN (' + productIds.map(() => '?').join(',') + '))';
              params.push(searchTerm, searchTerm, searchTerm, searchTerm, ...productIds);
            } else {
              sql += ' AND (batchNo LIKE ? OR batchNumber LIKE ? OR supplierName LIKE ? OR supplierInvoiceNo LIKE ?)';
              params.push(searchTerm, searchTerm, searchTerm, searchTerm);
            }
          }
    
          sql += ' ORDER BY createdAt DESC';
    
          // Get total count for pagination
          const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as count');
          const totalResult = query(countSql, params);
          const total = totalResult[0]?.count || 0;
    
          // Apply pagination - match backend-zp
          const page = Number(req.query.page) || 1;
          const limit = Number(req.query.limit) || 50;
          const skip = (page - 1) * limit;
          sql += ' LIMIT ? OFFSET ?';
          params.push(limit, skip);
    
          const rawBatches = query(sql, params);
          console.log('[Batches] Found:', rawBatches.length, 'Total:', total);
    
          const batches = rawBatches.map(b => {
            const product = b.productId ? query('SELECT id, name, sku FROM products WHERE id = ?', [b.productId])[0] : null;
            const supplier = b.supplierId ? query('SELECT id, name FROM suppliers WHERE id = ?', [b.supplierId])[0] : null;

            return {
              ...b,
              batchNo: b.batchNo || b.batchNumber,
              batchNumber: b.batchNo || b.batchNumber,
              totalStock: b.quantity,
              expireDate: b.expireDate || b.expiryDate,
              expiryDate: b.expireDate || b.expiryDate,
              productionDate: b.productionDate || b.manufacturingDate,
              manufacturingDate: b.productionDate || b.manufacturingDate,
              reportReason: b.reportReason || null,
              reportedBy: b.reportedBy || null,
              taxType: b.taxType || null,
              product: product ? { id: product.id, name: product.name, sku: product.sku } : null,
              supplier: supplier ? { id: supplier.id, name: supplier.name } : null
            };
          });
    
          res.json({
            success: true,
            data: {
              batches,
              pagination: {
                page: Number(page),
                limit: Number(limit),
                total,
                pages: Math.ceil(total / Number(limit))
              }
            }
          });
        } catch (e) {
          console.error('[API] Batches GET error:', e);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // GET /api/batches/low-stock (line 6065)
      app.get('/api/batches/low-stock', authMiddleware, (req, res) => {
        try {
          const { page = 1, limit = 50, search = '', branchId } = req.query;
          const skip = (parseInt(page) - 1) * parseInt(limit);
    
          // Get data filter based on user role
          let targetBranchId = branchId || req.user?.selectedBranchId || req.user?.branchId;
          let targetCompanyId = req.user?.selectedCompanyId || req.user?.companyId;
    
          // For non-superadmin users, ensure they only see their branch data
          if (req.user?.role !== 'SUPERADMIN') {
            if (!targetBranchId) {
              targetBranchId = req.user?.branchId;
            }
            if (!targetCompanyId) {
              targetCompanyId = req.user?.companyId;
            }
          }
    
          // If we have branchId but no companyId, get companyId from the branch
          if (targetBranchId && !targetCompanyId) {
            const branch = query('SELECT companyId FROM branches WHERE id = ?', [targetBranchId])[0];
            if (branch?.companyId) {
              targetCompanyId = branch.companyId;
            }
          }
    
          // Build product where clause
          let productWhere = 'WHERE isActive = 1';
          const productParams = [];
    
          if (targetCompanyId) {
            productWhere += ' AND companyId = ?';
            productParams.push(targetCompanyId);
          }
    
          if (targetBranchId) {
            productWhere += ' AND branchId = ?';
            productParams.push(targetBranchId);
          }
    
          // Get products with their batches
          const products = query(`SELECT * FROM products ${productWhere}`, productParams);
    
          // Calculate low stock batches and batches requiring attention
          const batchesRequiringAttention = [];
          const now = new Date();
    
          for (const product of products) {
            // Get all batches for this product
            let batchWhere = 'WHERE productId = ? AND isActive = 1 AND quantity > 0';
            const batchParams = [product.id];
    
            if (targetCompanyId) {
              batchWhere += ' AND companyId = ?';
              batchParams.push(targetCompanyId);
            }
    
            if (targetBranchId) {
              batchWhere += ' AND branchId = ?';
              batchParams.push(targetBranchId);
            }
    
            const batches = query(`SELECT * FROM batches ${batchWhere} ORDER BY expireDate ASC`, batchParams);
    
            // Calculate total stock
            const totalStock = batches.reduce((sum, batch) => sum + (batch.quantity || 0), 0);
            const minStock = product.minStock || 10;
            const batchLowStockThreshold = minStock * 0.2;
    
            // CRITICAL: Check if product total stock is low - if so, include ALL batches for this product
            const isProductLowStock = totalStock <= minStock;
    
            // Check each batch individually for various conditions
            for (const batch of batches) {
              let shouldInclude = false;
              let reason = '';
    
              // CRITICAL FIX: If product total stock is low, include ALL batches for this product
              if (isProductLowStock) {
                shouldInclude = true;
                reason = 'Product Low Stock';
              }
    
              // Also check if individual batch is low stock (less than 20% of min stock or less than 10 units)
              const individualBatchLow = (batch.quantity || 0) <= batchLowStockThreshold || (batch.quantity || 0) <= 10;
              if (individualBatchLow) {
                shouldInclude = true;
                reason = reason ? `${reason}, Low Stock Batch` : 'Low Stock Batch';
              }
    
              // Check if batch is near expiry (within 30 days)
              if (batch.expireDate) {
                const expireDate = new Date(batch.expireDate);
                const daysUntilExpiry = Math.ceil((expireDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                if (daysUntilExpiry <= 30 && daysUntilExpiry > 0) {
                  shouldInclude = true;
                  reason = reason ? `${reason}, Near Expiry` : 'Near Expiry';
                }
              }
    
              // Check if batch is expired
              if (batch.expireDate && new Date(batch.expireDate) < now) {
                shouldInclude = true;
                reason = reason ? `${reason}, Expired` : 'Expired';
              }
    
              if (shouldInclude) {
                const suggestedOrderQty = Math.max(0, minStock * 2 - totalStock);
    
                // Get category and supplier
                const category = product.categoryId ? query('SELECT name FROM categories WHERE id = ?', [product.categoryId])[0] : null;
                const supplier = product.supplierId ? query('SELECT name FROM suppliers WHERE id = ?', [product.supplierId])[0] : null;
                const branch = product.branchId ? query('SELECT id, name FROM branches WHERE id = ?', [product.branchId])[0] : null;
    
                const daysUntilExpiry = batch.expireDate ? Math.ceil((new Date(batch.expireDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;
    
                batchesRequiringAttention.push({
                  id: batch.id,
                  batchNo: batch.batchNo || batch.id,
                  productId: product.id,
                  productName: product.name,
                  productSku: product.barcode || product.sku || product.id,
                  category: category?.name || 'Uncategorized',
                  supplier: supplier?.name || 'Unknown Supplier',
                  branch: {
                    id: product.branchId,
                    name: branch?.name || 'Unknown Branch'
                  },
                  currentStock: batch.quantity || 0,
                  totalProductStock: totalStock,
                  minStock: minStock,
                  maxStock: product.maxStock || minStock * 10,
                  unitPrice: batch.sellingPrice || product.sellingPrice || 0,
                  expireDate: batch.expireDate || null,
                  productionDate: batch.productionDate || null,
                  orderQuantity: suggestedOrderQty,
                  isLowStock: batch.quantity <= batchLowStockThreshold || totalStock <= minStock,
                  isCritical: batch.quantity <= (batchLowStockThreshold * 0.5) || totalStock <= (minStock * 0.5),
                  isNearExpiry: daysUntilExpiry !== null && daysUntilExpiry <= 30 && daysUntilExpiry > 0,
                  isExpired: batch.expireDate ? new Date(batch.expireDate) < now : false,
                  reason: reason
                });
              }
            }
          }
    
          // Apply search filter
          let filteredBatches = batchesRequiringAttention;
          if (search) {
            const searchLower = search.toLowerCase();
            filteredBatches = batchesRequiringAttention.filter(batch =>
              batch.productName.toLowerCase().includes(searchLower) ||
              batch.productSku.toLowerCase().includes(searchLower) ||
              batch.category.toLowerCase().includes(searchLower) ||
              batch.batchNo.toLowerCase().includes(searchLower)
            );
          }
    
          // Apply pagination
          const paginatedBatches = filteredBatches.slice(skip, skip + parseInt(limit));
    
          res.json({
            success: true,
            data: {
              batches: paginatedBatches,
              pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: filteredBatches.length,
                pages: Math.ceil(filteredBatches.length / parseInt(limit))
              }
            }
          });
        } catch (e) {
          console.error('[Batches/LowStock] Error:', e);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // GET /api/batches/near-expiry (line 6246)
      app.get('/api/batches/near-expiry', authMiddleware, (req, res) => {
        try {
          // Get data filter based on user role
          const { branchFilter, companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
    
          const thirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
          let sql = 'SELECT * FROM batches WHERE isActive = 1 AND expiryDate <= ? AND quantity > 0';
          const params = [thirtyDays];
    
          // Apply strict data isolation
          if (branchFilter) { sql += ' AND branchId = ?'; params.push(branchFilter); }
          if (companyFilter) { sql += ' AND companyId = ?'; params.push(companyFilter); }
    
          const batches = query(sql, params).map(b => ({
            ...b,
            product: b.productId ? query('SELECT id, name, sku FROM products WHERE id = ?', [b.productId])[0] : null
          }));
          res.json({ success: true, data: { batches, pagination: { total: batches.length, page: 1, limit: 100, pages: 1 } } });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // GET /api/batches/:id (line 6268)
      app.get('/api/batches/:id', authMiddleware, (req, res) => {
        try {
          const b = query('SELECT * FROM batches WHERE id = ? AND isActive = 1', [req.params.id])[0];
          if (!b) return res.status(404).json({ success: false, message: 'Batch not found' });
          b.product = b.productId ? query('SELECT * FROM products WHERE id = ?', [b.productId])[0] : null;
          b.branch = b.branchId ? query('SELECT id, name FROM branches WHERE id = ?', [b.branchId])[0] : null;
          // CRITICAL FIX: Map purchasePrice to costPrice for frontend compatibility
          b.purchasePrice = b.purchasePrice || 0;
          b.costPrice = b.purchasePrice || 0;  // Also include as costPrice for compatibility
          res.json({ success: true, data: b });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // POST /api/batches (line 6282)
      app.post('/api/batches', authMiddleware, (req, res) => {
        try {
          console.log('[Batches] POST request body:', req.body);
    
          // Support both 'batchNumber' and 'batchNo' field names
          const batchNumber = req.body.batchNumber || req.body.batchNo;
          const { productId, supplierId, branchId, companyId } = req.body;
    
          // Support multiple quantity field names
          const quantity = parseInt(req.body.quantity || req.body.totalStock || req.body.stockQuantity || 0);
          // CRITICAL FIX: Check for purchasePrice (frontend sends this) OR costPrice OR costPricePerUnit
          const costPrice = parseFloat(req.body.purchasePrice || req.body.costPrice || req.body.costPricePerUnit || 0);
          const sellingPrice = parseFloat(req.body.sellingPrice || req.body.sellingPricePerUnit || 0);
          const expiryDate = req.body.expiryDate || req.body.expireDate || null;
          const manufacturingDate = req.body.manufacturingDate || req.body.productionDate || null;
    
          // Validation - match backend controller schema
          if (!batchNumber || !batchNumber.trim()) {
            return res.status(400).json({
              success: false,
              message: 'Validation error',
              errors: ['Batch number is required']
            });
          }
    
          if (!productId || !productId.trim()) {
            return res.status(400).json({
              success: false,
              message: 'Validation error',
              errors: ['Product selection is required']
            });
          }
    
          if (!req.body.supplierId || !req.body.supplierId.trim()) {
            return res.status(400).json({
              success: false,
              message: 'Validation error',
              errors: ['Supplier selection is required']
            });
          }
    
          // Expiry date and production date are optional (only required for medical products)
          // Frontend will handle conditional validation based on product type
    
          if (!req.body.shelfId || !req.body.shelfId.trim()) {
            return res.status(400).json({
              success: false,
              message: 'Validation error',
              errors: ['Shelf selection is required']
            });
          }
    
          if (costPrice <= 0) {
            return res.status(400).json({
              success: false,
              message: 'Validation error',
              errors: ['Purchase price must be positive']
            });
          }
    
          if (sellingPrice <= 0) {
            return res.status(400).json({
              success: false,
              message: 'Validation error',
              errors: ['Selling price must be positive']
            });
          }
    
          if (quantity <= 0) {
            return res.status(400).json({
              success: false,
              message: 'Validation error',
              errors: ['Quantity must be positive']
            });
          }
    
          // Check if product exists
          const productCheck = query('SELECT id, name FROM products WHERE id = ?', [productId]);
          if (!productCheck.length) {
            return res.status(400).json({
              success: false,
              message: 'Product not found'
            });
          }
    
          const id = uuid();
          const timestamp = now();
    
          // Get context from headers (set by frontend) - match backend controller EXACTLY
          // Backend line 554-555: branchId = req.user?.selectedBranchId || req.user?.branchId;
          const selectedCompanyId = req.headers['x-company-id'] || req.user?.selectedCompanyId;
          const selectedBranchId = req.headers['x-branch-id'] || req.user?.selectedBranchId;
    
          // CRITICAL FIX: Match backend EXACTLY - prioritize selectedBranchId from headers FIRST
          // Backend does NOT use branchId from body, only from headers/user
          let finalBranchId = selectedBranchId || req.user?.branchId || null;
          let finalCompanyId = selectedCompanyId || req.user?.companyId || null;
    
          // If user doesn't have branch/company context, get it from their admin (match backend)
          if (!finalBranchId || !finalCompanyId) {
            if (req.user?.createdBy) {
              const adminUser = query('SELECT branchId, companyId FROM users WHERE id = ?', [req.user.createdBy])[0];
              if (adminUser) {
                finalBranchId = finalBranchId || adminUser.branchId || null;
                finalCompanyId = finalCompanyId || adminUser.companyId || null;
              }
            }
          }
    
          // If still no branch/company, try to get from the product (match backend)
          if (!finalBranchId || !finalCompanyId) {
            const product = query('SELECT branchId, companyId FROM products WHERE id = ?', [productId])[0];
            if (product) {
              finalBranchId = finalBranchId || product.branchId || null;
              finalCompanyId = finalCompanyId || product.companyId || null;
            }
          }
    
          if (!finalBranchId || !finalCompanyId) {
            return res.status(400).json({
              success: false,
              message: 'Branch and company context required. Please ensure you have proper access permissions.',
            });
          }
    
          // Check if batch number already exists for this product and branch (match backend)
          const existingBatch = query('SELECT id FROM batches WHERE batchNo = ? AND productId = ? AND branchId = ?',
            [batchNumber, productId, finalBranchId]);
          if (existingBatch && existingBatch.length > 0) {
            return res.status(400).json({
              success: false,
              message: 'Batch number already exists for this product'
            });
          }
    
          // OFFLINE-FIRST: Always use SQLite, PostgreSQL sync happens in background
          console.log('[Batches] Using SQLite (offline-first mode)');
    
          // CRITICAL: Ensure SQLite table has all required columns BEFORE insert
          try {
            const tableInfo = query("PRAGMA table_info(batches)");
            const columnNames = tableInfo.map(col => col.name.toLowerCase());
            console.log('[Batches] SQLite table columns:', columnNames);
    
            // Add missing columns if they don't exist
            if (!columnNames.includes('isactive')) {
              console.log('[Batches] Adding isActive column...');
              run('ALTER TABLE batches ADD COLUMN isActive INTEGER DEFAULT 1');
              saveDatabase();
            }
            if (!columnNames.includes('isreported')) {
              console.log('[Batches] Adding isReported column...');
              run('ALTER TABLE batches ADD COLUMN isReported INTEGER DEFAULT 0');
              saveDatabase();
            }
            if (!columnNames.includes('reportreason')) {
              console.log('[Batches] Adding reportReason column...');
              run('ALTER TABLE batches ADD COLUMN reportReason TEXT');
              saveDatabase();
            }
            if (!columnNames.includes('reportedby')) {
              console.log('[Batches] Adding reportedBy column...');
              run('ALTER TABLE batches ADD COLUMN reportedBy TEXT');
              saveDatabase();
            }
            if (!columnNames.includes('taxtype')) {
              console.log('[Batches] Adding taxType column...');
              run('ALTER TABLE batches ADD COLUMN taxType TEXT');
              saveDatabase();
            }
          } catch (migrationError) {
            console.log('[Batches] Migration check:', migrationError.message);
          }
    
          // Clean up IDs - match backend
          const cleanBranchId = finalBranchId;
          const cleanSupplierId = (supplierId && supplierId.trim() !== '') ? supplierId : null;
    
          // Map old field names to new PostgreSQL schema - match backend validation
          const totalBoxes = parseInt(req.body.totalBoxes || 0);
          const unitsPerBox = parseInt(req.body.unitsPerBox || 1);
    
          // Validate totalBoxes and unitsPerBox (match backend)
          if (totalBoxes < 0) {
            return res.status(400).json({
              success: false,
              message: 'Validation error',
              errors: ['Total boxes must be 0 or greater']
            });
          }
    
          if (unitsPerBox <= 0) {
            return res.status(400).json({
              success: false,
              message: 'Validation error',
              errors: ['Units per box must be positive']
            });
          }
    
          const supplierName = req.body.supplierName || (cleanSupplierId ? query('SELECT name FROM suppliers WHERE id = ?', [cleanSupplierId])[0]?.name : null);
          const shelfId = req.body.shelfId || null;
          const shelfName = req.body.shelfName || (shelfId ? query('SELECT name FROM shelves WHERE id = ?', [shelfId])[0]?.name : null);
    
          // Insert into SQLite - PRIMARY DATABASE
          console.log('[Batches] Inserting into SQLite:', { id, batchNumber, productId, quantity, cleanBranchId, finalCompanyId, taxType: req.body.taxType });
    
          const taxType = req.body.taxType || null;
          
          // Try to insert with taxType first
          let insertSuccess;
          try {
            insertSuccess = run(`INSERT INTO batches (id, batchNo, productId, branchId, companyId, supplierId, supplierName, barcode, totalBoxes, unitsPerBox, quantity, purchasePrice, sellingPrice, stockPurchasePrice, paidAmount, supplierOutstanding, supplierInvoiceNo, purchasingMethod, expireDate, productionDate, shelfId, shelfName, isActive, isReported, reportReason, reportedBy, taxType, createdBy, createdAt, updatedAt)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,?,?,?,?,?,?)`,
              [id, batchNumber, productId, cleanBranchId, finalCompanyId, cleanSupplierId, supplierName, req.body.barcode || null, totalBoxes, unitsPerBox, quantity, costPrice, sellingPrice, costPrice, 0, 0, req.body.supplierInvoiceNo || null, req.body.purchasingMethod || null, expiryDate || null, manufacturingDate || null, shelfId, shelfName, null, null, taxType, req.user?.id || null, timestamp, timestamp]);
          } catch (insertError) {
            // If taxType column doesn't exist, insert without it and update separately
            console.log('[Batches] ⚠️ taxType column might not exist, trying without it...');
            insertSuccess = run(`INSERT INTO batches (id, batchNo, productId, branchId, companyId, supplierId, supplierName, barcode, totalBoxes, unitsPerBox, quantity, purchasePrice, sellingPrice, stockPurchasePrice, paidAmount, supplierOutstanding, supplierInvoiceNo, purchasingMethod, expireDate, productionDate, shelfId, shelfName, isActive, isReported, reportReason, reportedBy, createdBy, createdAt, updatedAt)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,?,?,?,?,?)`,
              [id, batchNumber, productId, cleanBranchId, finalCompanyId, cleanSupplierId, supplierName, req.body.barcode || null, totalBoxes, unitsPerBox, quantity, costPrice, sellingPrice, costPrice, 0, 0, req.body.supplierInvoiceNo || null, req.body.purchasingMethod || null, expiryDate || null, manufacturingDate || null, shelfId, shelfName, null, null, req.user?.id || null, timestamp, timestamp]);
            
            // Now add taxType column and update it
            if (insertSuccess && taxType) {
              try {
                run('ALTER TABLE batches ADD COLUMN taxType TEXT');
                saveDatabase();
                run('UPDATE batches SET taxType = ? WHERE id = ?', [taxType, id]);
                saveDatabase();
                console.log('[Batches] ✅ taxType column added and updated:', taxType);
              } catch (taxTypeError) {
                console.warn('[Batches] ⚠️ Could not add/update taxType:', taxTypeError.message);
              }
            }
          }
    
          if (!insertSuccess) {
            const errorMsg = lastDbError || 'Unknown database error';
            console.error('[Batches] ❌ SQLite insert failed:', errorMsg);
            return res.status(500).json({ success: false, message: 'Failed to create batch: ' + errorMsg });
          }
    
          // Note: Product quantity is now managed through batches, not directly on products
          // Don't update product quantity - batches handle stock
    
          // Query the created batch
          let batch = query('SELECT * FROM batches WHERE id = ?', [id])[0];
    
          if (!batch) {
            console.error('[Batches] Batch not found after insert, trying by batchNo...');
            // Fallback: try to find by batchNo or batchNumber
            const byBatchNumber = query('SELECT * FROM batches WHERE (batchNo = ? OR batchNumber = ?) AND productId = ? ORDER BY createdAt DESC LIMIT 1', [batchNumber, batchNumber, productId]);
            if (byBatchNumber.length > 0) {
              batch = byBatchNumber[0];
              console.log('[Batches] Found batch by batchNumber');
            } else {
              return res.status(500).json({ success: false, message: 'Batch created but could not be retrieved' });
            }
          }
    
          console.log('[Batches] ✅ Created successfully in SQLite:', batch.id);
    
          // Get related data from SQLite
          const product = batch.productId ? query('SELECT id, name, sku FROM products WHERE id = ?', [batch.productId])[0] : null;
          const supplier = batch.supplierId ? query('SELECT id, name FROM suppliers WHERE id = ?', [batch.supplierId])[0] : null;
          const branch = batch.branchId ? query('SELECT id, name FROM branches WHERE id = ?', [batch.branchId])[0] : null;
    
          // Return with expected field names
          const response = {
            ...batch,
            batchNo: batch.batchNo || batch.batchNumber,  // Frontend expects batchNo
            batchNumber: batch.batchNo || batch.batchNumber,
            product: product || { id: '', name: 'Unknown', sku: '' },
            supplier: supplier,
            branch: branch || { id: '', name: 'Unknown' },
            totalStock: batch.quantity,
            expireDate: batch.expiryDate,
            productionDate: batch.manufacturingDate,
            // CRITICAL FIX: Map purchasePrice to costPrice for frontend compatibility
            purchasePrice: batch.purchasePrice || 0,
            costPrice: batch.purchasePrice || 0  // Also include as costPrice for compatibility
          };
    
          console.log('[Batches] ✅ Created successfully in SQLite:', batch.id);
    
          // Queue for sync to PostgreSQL (background)
          handleDataChange('batches', 'create', batch);
    
          res.status(201).json({ success: true, data: response, message: 'Batch created successfully' });
        } catch (e) {
          console.error('[API] Batch create error:', e.message, e.stack);
          res.status(500).json({ success: false, message: 'Error creating batch: ' + e.message });
        }
      });

  // PUT /api/batches/:id (line 6555)
      app.put('/api/batches/:id', authMiddleware, (req, res) => {
        try {
          const { id } = req.params;
          const updateData = req.body;
    
          // Check if batch exists (match backend)
          const existingBatch = query('SELECT * FROM batches WHERE id = ?', [id])[0];
          if (!existingBatch) {
            return res.status(404).json({ success: false, message: 'Batch not found' });
          }
    
          // Build update fields - match backend structure
          const updateFields = [];
          const updateValues = [];
    
          // Support multiple field name variations
          // If updating batch number, check for duplicates (match backend)
          if (updateData.batchNo !== undefined || updateData.batchNumber !== undefined) {
            const newBatchNo = updateData.batchNo || updateData.batchNumber;
            if (newBatchNo !== existingBatch.batchNo && newBatchNo !== existingBatch.batchNumber) {
              // Check if batch number already exists for this product and branch
              const duplicateBatch = query('SELECT id FROM batches WHERE batchNo = ? AND productId = ? AND branchId = ? AND id != ?',
                [newBatchNo, existingBatch.productId, existingBatch.branchId, id]);
              if (duplicateBatch && duplicateBatch.length > 0) {
                return res.status(400).json({
                  success: false,
                  message: 'Batch number already exists for this product'
                });
              }
            }
            updateFields.push('batchNo = ?');
            updateValues.push(newBatchNo);
          }
          if (updateData.quantity !== undefined) {
            updateFields.push('quantity = ?');
            updateValues.push(updateData.quantity);
          }
          if (updateData.expireDate !== undefined || updateData.expiryDate !== undefined) {
            updateFields.push('expireDate = ?');
            updateValues.push(updateData.expireDate || updateData.expiryDate || null);
          }
          if (updateData.productionDate !== undefined || updateData.manufacturingDate !== undefined) {
            updateFields.push('productionDate = ?');
            updateValues.push(updateData.productionDate || updateData.manufacturingDate || null);
          }
          if (updateData.purchasePrice !== undefined || updateData.costPrice !== undefined) {
            updateFields.push('purchasePrice = ?');
            updateValues.push(updateData.purchasePrice || updateData.costPrice || 0);
          }
          if (updateData.sellingPrice !== undefined) {
            updateFields.push('sellingPrice = ?');
            updateValues.push(updateData.sellingPrice);
          }
          if (updateData.supplierId !== undefined) {
            updateFields.push('supplierId = ?');
            updateValues.push(updateData.supplierId || null);
          }
          if (updateData.supplierName !== undefined) {
            updateFields.push('supplierName = ?');
            updateValues.push(updateData.supplierName || null);
          }
          if (updateData.shelfId !== undefined) {
            updateFields.push('shelfId = ?');
            updateValues.push(updateData.shelfId || null);
          }
          if (updateData.shelfName !== undefined) {
            updateFields.push('shelfName = ?');
            updateValues.push(updateData.shelfName || null);
          }
          if (updateData.totalBoxes !== undefined) {
            updateFields.push('totalBoxes = ?');
            updateValues.push(updateData.totalBoxes || 0);
          }
          if (updateData.unitsPerBox !== undefined) {
            updateFields.push('unitsPerBox = ?');
            updateValues.push(updateData.unitsPerBox || 1);
          }
          if (updateData.isActive !== undefined) {
            updateFields.push('isActive = ?');
            updateValues.push(updateData.isActive ? 1 : 0);
          }
          if (updateData.isReported !== undefined) {
            updateFields.push('isReported = ?');
            updateValues.push(updateData.isReported ? 1 : 0);
          }
    
          if (updateData.reportReason !== undefined) {
            updateFields.push('reportReason = ?');
            updateValues.push(updateData.reportReason || null);
          }
          if (updateData.reportedBy !== undefined) {
            updateFields.push('reportedBy = ?');
            updateValues.push(updateData.reportedBy || null);
          }
          if (updateData.taxType !== undefined) {
            updateFields.push('taxType = ?');
            updateValues.push(updateData.taxType || null);
          }
    
          if (updateFields.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update' });
          }
    
          updateFields.push('updatedAt = ?');
          updateValues.push(now());
          updateValues.push(id);
    
          run(`UPDATE batches SET ${updateFields.join(', ')} WHERE id = ?`, updateValues);
    
          // Get updated batch with related data (match backend)
          const batch = query('SELECT * FROM batches WHERE id = ?', [id])[0];
          if (!batch) {
            return res.status(404).json({ success: false, message: 'Batch not found after update' });
          }
    
          // Include related data (match backend)
          const product = batch.productId ? query('SELECT id, name, sku FROM products WHERE id = ?', [batch.productId])[0] : null;
          const supplier = batch.supplierId ? query('SELECT id, name FROM suppliers WHERE id = ?', [batch.supplierId])[0] : null;
          const branch = batch.branchId ? query('SELECT id, name FROM branches WHERE id = ?', [batch.branchId])[0] : null;
    
          const batchWithRelations = {
            ...batch,
            batchNo: batch.batchNo || batch.batchNumber,
            batchNumber: batch.batchNo || batch.batchNumber,
            expireDate: batch.expireDate || batch.expiryDate,
            expiryDate: batch.expireDate || batch.expiryDate,
            productionDate: batch.productionDate || batch.manufacturingDate,
            manufacturingDate: batch.productionDate || batch.manufacturingDate,
            purchasePrice: batch.purchasePrice || 0,
            costPrice: batch.purchasePrice || 0,
            reportReason: batch.reportReason || null,
            reportedBy: batch.reportedBy || null,
            taxType: batch.taxType || null,
            product: product || null,
            supplier: supplier || null,
            branch: branch || null
          };
    
          // 🔄 TWO-WAY SYNC: Queue for sync to PostgreSQL
          if (batchWithRelations) handleDataChange('batches', 'update', batchWithRelations);
    
          res.json({ success: true, data: batchWithRelations, message: 'Batch updated successfully' });
        } catch (e) {
          console.error('[Batches] Update error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // DELETE /api/batches/:id (line 6693)
      app.delete('/api/batches/:id', authMiddleware, (req, res) => {
        try {
          console.log('[Batches] DELETE request for id:', req.params.id);
          const batch = query('SELECT * FROM batches WHERE id = ?', [req.params.id])[0];
    
          if (!batch) {
            console.log('[Batches] ⚠️ Batch not found:', req.params.id);
            return res.status(404).json({ success: false, message: 'Batch not found' });
          }
    
          console.log('[Batches] Deleting batch:', batch.batchNo || batch.batchNumber, 'Current isActive:', batch.isActive);
    
          // CRITICAL FIX: Use hard delete (DELETE FROM) instead of soft delete for complete removal
          // This ensures deleted batches don't reappear after login
          const deleteResult = run('DELETE FROM batches WHERE id = ?', [req.params.id]);
    
          if (!deleteResult) {
            console.error('[Batches] ❌ Delete query failed!');
            console.error('[Batches] Last DB error:', lastDbError);
            return res.status(500).json({ success: false, message: lastDbError || 'Failed to delete batch in database' });
          }
          console.log('[Batches] ✅ Delete query executed successfully (hard delete)');
    
          // Save database immediately after delete
          saveDatabase();
          console.log('[Batches] ✅ Database saved after delete');
    
          // 🔄 TWO-WAY SYNC: Queue delete for sync to PostgreSQL
          if (batch) handleDataChange('batches', 'delete', batch);
    
          res.json({ success: true, message: 'Batch deleted successfully' });
        } catch (e) {
          console.error('[Batches] Delete error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

}

module.exports = {
  registerBatchesRoutes
};
