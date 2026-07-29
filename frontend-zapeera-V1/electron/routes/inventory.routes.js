/**
 * Inventory Routes
 * Extracted from routes/index.js
 */

function registerInventoryRoutes(app, authMiddleware, deps) {
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

// GET /api/inventory/summary (line 10229)
      app.get('/api/inventory/summary', authMiddleware, (req, res) => {
        try {
          // Get data filter based on user role
          const { branchFilter, companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
    
          let whereClause = 'WHERE isActive = 1';
          const params = [];
    
          // Apply strict data isolation
          if (branchFilter) { whereClause += ' AND branchId = ?'; params.push(branchFilter); }
          if (companyFilter) { whereClause += ' AND companyId = ?'; params.push(companyFilter); }
    
          res.json({ success: true, data: {
            totalProducts: query(`SELECT COUNT(*) as c FROM products ${whereClause}`, params)[0]?.c || 0,
            totalValue: query(`SELECT SUM(quantity * costPrice) as v FROM products ${whereClause}`, params)[0]?.v || 0,
            lowStock: query(`SELECT COUNT(*) as c FROM products ${whereClause} AND quantity <= minStock`, params)[0]?.c || 0,
            outOfStock: query(`SELECT COUNT(*) as c FROM products ${whereClause} AND quantity = 0`, params)[0]?.c || 0
          }});
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // GET /api/inventory/batches (line 10251)
      app.get('/api/inventory/batches', authMiddleware, async (req, res) => {
        try {
          console.log('[Inventory/Batches] GET request with params:', req.query);
          const { productId, branchId, expired, nearExpiry, limit = 100, isReported } = req.query;
    
          // Allow calling without productId when filtering by expired/nearExpiry
          if (!productId && !expired && !nearExpiry) {
            return res.status(400).json({ success: false, message: 'productId is required when not filtering by expired/nearExpiry' });
          }
    
          // CRITICAL FIX: Match backend logic exactly - get branchId/companyId from multiple sources
          // Priority: query param > header > user's assigned branch > product's branch
          let targetBranchId = branchId || req.user?.selectedBranchId || req.user?.branchId;
          let targetCompanyId = req.user?.selectedCompanyId || req.user?.companyId;
    
          console.log('[Inventory/Batches] Initial context:', { productId, targetBranchId, targetCompanyId, userId: req.user?.id, role: req.user?.role });
    
          // Handle expired/nearExpiry batches without productId
          if (!productId && (expired === 'true' || nearExpiry === 'true')) {
            let batchWhere = 'WHERE isActive = 1';
            const batchParams = [];

            if (targetBranchId) {
              batchWhere += ' AND branchId = ?';
              batchParams.push(targetBranchId);
            }
            if (targetCompanyId) {
              batchWhere += ' AND companyId = ?';
              batchParams.push(targetCompanyId);
            }
            
            // CRITICAL FIX: Data isolation - filter by createdBy for non-SUPERADMIN users
            // This ensures each business only sees their own expired batches
            if (req.user?.role !== 'SUPERADMIN' && req.user?.createdBy) {
              batchWhere += ' AND createdBy = ?';
              batchParams.push(req.user.createdBy);
              console.log('[Inventory/Batches] Filtering expired batches by createdBy for data isolation:', req.user.createdBy);
            }
    
            const now = new Date().toISOString();
            if (expired === 'true') {
              batchWhere += ' AND expireDate < ?';
              batchParams.push(now);
            } else if (nearExpiry === 'true') {
              const thirtyDaysFromNow = new Date();
              thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
              batchWhere += ' AND expireDate <= ? AND expireDate >= ?';
              batchParams.push(thirtyDaysFromNow.toISOString(), now);
            }
    
            batchWhere += ' ORDER BY expireDate ASC LIMIT ?';
            batchParams.push(parseInt(limit) || 100);
    
            const batches = query(`SELECT b.*, p.id as product_id, p.name as product_name, p.sku as product_sku, p.barcode as product_barcode, p.minStock as product_minStock, p.unitType as product_unitType FROM batches b LEFT JOIN products p ON b.productId = p.id ${batchWhere}`, batchParams);
    
            const result = batches.map(b => {
              const expiryDateValue = b.expireDate || b.expiryDate;
              const expiryDateObj = expiryDateValue ? new Date(expiryDateValue) : null;
              const daysUntilExpiry = expiryDateObj ? Math.ceil((expiryDateObj.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)) : null;
    
              let expiryStatus = 'GOOD';
              if (daysUntilExpiry !== null) {
                if (daysUntilExpiry < 0) expiryStatus = 'EXPIRED';
                else if (daysUntilExpiry <= 7) expiryStatus = 'CRITICAL';
                else if (daysUntilExpiry <= 30) expiryStatus = 'WARNING';
              }
    
              return {
                id: b.id,
                batchNo: b.batchNo || b.batchNumber,
                batchNumber: b.batchNo || b.batchNumber,
                quantity: b.quantity,
                totalStock: b.quantity,
                sellingPrice: b.sellingPrice,
                costPrice: b.costPrice,
                expireDate: expiryDateValue,
                expiryDate: expiryDateValue,
                manufacturingDate: b.manufacturingDate || b.productionDate,
                productionDate: b.manufacturingDate || b.productionDate,
                expiryStatus,
                daysUntilExpiry,
                productId: b.productId,
                product: {
                  id: b.product_id || b.productId,
                  name: b.product_name || 'Unknown',
                  sku: b.product_sku || '',
                  barcode: b.product_barcode,
                  minStock: b.product_minStock || 0,
                  unitType: b.product_unitType || 'PIECE'
                }
              };
            });
    
            return res.json({
              success: true,
              data: result,
              pagination: {
                page: 1,
                limit: parseInt(limit) || 100,
                total: result.length,
                pages: 1
              }
            });
          }
    
          // First check if product exists (only when productId is provided)
          const product = productId ? query('SELECT * FROM products WHERE id = ?', [productId])[0] : null;
          if (productId && !product) {
            return res.json({ success: true, data: [] });
          }
    
          // CRITICAL: If no branchId/companyId, get from product (match backend logic line 198-208)
          if (!targetBranchId && (req.user?.role === 'ADMIN' || req.user?.role === 'SUPERADMIN')) {
            targetBranchId = product.branchId;
            targetCompanyId = product.companyId;
            console.log('[Inventory/Batches] Got context from product:', { targetBranchId, targetCompanyId });
          }
    
          // If we have branchId but no companyId, get companyId from branch
          if (targetBranchId && !targetCompanyId) {
            const branch = query('SELECT companyId FROM branches WHERE id = ?', [targetBranchId])[0];
            if (branch?.companyId) {
              targetCompanyId = branch.companyId;
              console.log('[Inventory/Batches] Got companyId from branch:', targetCompanyId);
            }
          }
    
          console.log('[Inventory/Batches] Final context:', { productId, targetBranchId, targetCompanyId });
    
          // CRITICAL FIX: Match backend EXACTLY - backend requires branchId AND companyId (line 212-217)
          // If we still don't have them, get from product (backend line 198-208)
          if (!targetBranchId) {
            targetBranchId = product.branchId;
          }
          if (!targetCompanyId) {
            targetCompanyId = product.companyId;
          }
    
          // CRITICAL FIX: Check if isReported column exists
          let hasIsReportedColumn = true;
          try {
            const tableInfo = query("PRAGMA table_info(batches)");
            hasIsReportedColumn = tableInfo.some(col => col.name === 'isReported');
          } catch (e) {
            hasIsReportedColumn = false;
          }
    
          // CRITICAL FIX: For POS, ALWAYS get ALL batches for product first (no branch/company filters)
          // This ensures batches are visible regardless of branch/company matching
          // Backend requires branchId/companyId, but for POS we need to show all available batches
          // CRITICAL: Database schema uses expireDate (not expiryDate), so use expireDate for SQLite
          // CRITICAL: Exclude reported batches - they should not be available for sale
          // CRITICAL FIX: Only filter by branch/company if branchId is explicitly provided in query params
          // If branchId is not provided, show ALL batches for the product (new batches will be visible)
          // CRITICAL FIX: Check if isActive column exists - some databases might not have it
          let hasIsActiveColumn = true;
          try {
            const batchTableInfo = query("PRAGMA table_info(batches)");
            hasIsActiveColumn = batchTableInfo.some(col => col.name === 'isActive');
          } catch (e) {
            hasIsActiveColumn = false;
          }
    
          let batchSql = 'SELECT * FROM batches WHERE productId = ? AND quantity > 0';
          if (hasIsActiveColumn) {
            batchSql += ' AND (isActive = 1 OR isActive IS NULL)';
          }
          // CRITICAL FIX: For POS, only exclude batches that are EXPLICITLY marked as reported (isReported = 1)
          // Don't filter out batches with isReported = NULL or isReported = 0
          // This ensures new batches and batches without the isReported flag are visible
          // SQLite NULL handling: NULL != 1 returns NULL (not TRUE), so we need explicit NULL check
          if (hasIsReportedColumn) {
            // Only exclude batches explicitly marked as reported (isReported = 1)
            // Include: isReported IS NULL, isReported = 0, or any value != 1
            batchSql += ' AND (isReported IS NULL OR isReported = 0 OR (isReported IS NOT NULL AND isReported != 1))';
            console.log('[Inventory/Batches] ✅ Applied isReported filter: excluding only batches with isReported = 1');
          } else {
            console.log('[Inventory/Batches] ⚠️ isReported column does not exist, skipping filter');
          }
    
          // CRITICAL FIX: Only apply branch/company filter if branchId is explicitly provided in query
          // This ensures new batches are visible even if they don't match the selected branch
          const branchIdFromQuery = req.query.branchId;
    
          // CRITICAL FIX: Always fetch ALL batches first, then filter/prioritize by branch if needed
          // This ensures batches are visible even if branchId doesn't match exactly
          batchSql += ' ORDER BY expireDate ASC';
          console.log('[Inventory/Batches] 🔍 SQLite query:', batchSql);
          console.log('[Inventory/Batches] 🔍 SQLite query params:', [productId]);
          var batches = query(batchSql, [productId]);
          console.log('[Inventory/Batches] SQLite batches found (ALL batches for product):', batches.length);
    
          if (batches.length > 0) {
            console.log('[Inventory/Batches] Sample batch before filtering:', {
              id: batches[0].id,
              batchNo: batches[0].batchNo,
              branchId: batches[0].branchId,
              companyId: batches[0].companyId,
              quantity: batches[0].quantity,
              isActive: batches[0].isActive
            });
          }
    
          // CRITICAL FIX: If branchId is provided, prioritize batches matching that branch, but still show all
          // Don't filter by companyId if it would result in empty batches - show all batches for the product
          if (branchIdFromQuery && batches.length > 0) {
            const matchingBatches = batches.filter(b => b.branchId === branchIdFromQuery);
            const nonMatchingBatches = batches.filter(b => b.branchId !== branchIdFromQuery);
    
            if (matchingBatches.length > 0) {
              console.log('[Inventory/Batches] Found', matchingBatches.length, 'batches matching branchId:', branchIdFromQuery);
              // Prioritize matching batches, but include all
              batches = [...matchingBatches, ...nonMatchingBatches];
            } else {
              console.log('[Inventory/Batches] No batches match branchId:', branchIdFromQuery, '- showing all', batches.length, 'batches');
            }
    
            // CRITICAL FIX: Only filter by companyId if it won't result in empty batches
            // If filtering by companyId would leave us with no batches, show all batches instead
            if (targetCompanyId) {
              const companyMatchingBatches = batches.filter(b => b.companyId === targetCompanyId);
              if (companyMatchingBatches.length > 0) {
                console.log('[Inventory/Batches] Found', companyMatchingBatches.length, 'batches matching companyId:', targetCompanyId);
                // Only use company filter if it returns batches
                batches = companyMatchingBatches;
              } else {
                console.log('[Inventory/Batches] ⚠️ No batches match companyId:', targetCompanyId, '- showing all', batches.length, 'batches instead (company filter would result in empty)');
                // Don't filter - keep all batches to ensure batches are visible
              }
            }
          }
    
          if (batches.length > 0) {
            console.log('[Inventory/Batches] Sample batch:', {
              id: batches[0].id,
              batchNo: batches[0].batchNo,
              quantity: batches[0].quantity,
              expireDate: batches[0].expireDate,
              branchId: batches[0].branchId,
              companyId: batches[0].companyId
            });
          }
    
          // CRITICAL FIX: If branchId was not provided in query, prioritize batches matching selected branch
          // but still show all batches (this ensures new batches are visible)
          if (batches.length > 0 && !branchIdFromQuery && (targetBranchId || targetCompanyId)) {
            const matchingBatches = batches.filter(b => {
              const branchMatch = !targetBranchId || b.branchId === targetBranchId;
              const companyMatch = !targetCompanyId || b.companyId === targetCompanyId;
              return branchMatch && companyMatch;
            });
    
            if (matchingBatches.length > 0) {
              console.log('[Inventory/Batches] Found', matchingBatches.length, 'batches matching branch/company filters, prioritizing them');
              // Prioritize matching batches, but include all
              batches = [...matchingBatches, ...batches.filter(b => !matchingBatches.includes(b))];
            } else {
              console.log('[Inventory/Batches] No batches match filters, but showing all', batches.length, 'batches anyway');
            }
          }
    
          // CRITICAL FIX: ALWAYS check PostgreSQL for batches if available (not just when SQLite is empty)
          // This ensures batches created in PostgreSQL are visible even if SQLite hasn't synced
          let pgBatches = [];
          if (REMOTE_DATABASE_URL) {
            try {
              console.log('[Inventory/Batches] 🔄 Checking PostgreSQL for batches...');
              const pg = require('pg');
              const Client = pg.Client;
              const pgClient = new (require('pg').Client)({
                connectionString: REMOTE_DATABASE_URL,
                connectionTimeoutMillis: 5000
              });
    
              await Promise.race([
                pgClient.connect(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout')), 5000))
              ]);
    
              // CRITICAL FIX: For POS, get ALL batches for product first (no branch/company filters)
              // This ensures batches are visible regardless of branch/company
              // CRITICAL: PostgreSQL uses expireDate (not expiryDate), so use COALESCE to handle both
              // CRITICAL FIX: Only filter by branch/company if branchId is explicitly provided in query params
              const branchIdFromQuery = req.query.branchId;
              let pgSql;
              let pgParams;
    
              // CRITICAL FIX: For POS, exclude only batches explicitly marked as reported (isReported = true)
              // Don't filter out batches with isReported = false or NULL
              if (branchIdFromQuery) {
                // If branchId is provided in query, filter by it
                pgSql = 'SELECT id, "batchNo", "productId", "branchId", "companyId", quantity, "sellingPrice", "costPrice", "expireDate", "expiryDate", "productionDate", "isActive", "isReported" FROM batches WHERE "productId" = $1 AND "branchId" = $2 AND "isActive" = true AND quantity > 0 AND ("isReported" IS NULL OR "isReported" = false)';
                pgParams = [productId, branchIdFromQuery];
                if (targetCompanyId) {
                  pgSql += ' AND "companyId" = $3';
                  pgParams.push(targetCompanyId);
                }
                pgSql += ' ORDER BY COALESCE("expireDate", "expiryDate") ASC LIMIT 100';
              } else {
                // If branchId is NOT provided, show ALL batches for the product
                pgSql = 'SELECT id, "batchNo", "productId", "branchId", "companyId", quantity, "sellingPrice", "costPrice", "expireDate", "expiryDate", "productionDate", "isActive", "isReported" FROM batches WHERE "productId" = $1 AND "isActive" = true AND quantity > 0 AND ("isReported" IS NULL OR "isReported" = false) ORDER BY COALESCE("expireDate", "expiryDate") ASC LIMIT 100';
                pgParams = [productId];
              }
    
              let pgResult = await Promise.race([
                getPgClient().query(pgSql, pgParams),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Query timeout')), 10000))
              ]);
    
              console.log('[Inventory/Batches] PostgreSQL batches found:', pgResult.rows?.length || 0, branchIdFromQuery ? '(filtered by branchId)' : '(ALL batches for product, no branch filter)');
    
              // CRITICAL FIX: If branchId was not provided in query, prioritize batches matching selected branch
              // but still show all batches (this ensures new batches are visible)
              if (pgResult.rows && pgResult.rows.length > 0 && !branchIdFromQuery && (targetBranchId || targetCompanyId)) {
                const matchingBatches = pgResult.rows.filter(b => {
                  const branchMatch = !targetBranchId || b.branchId === targetBranchId;
                  const companyMatch = !targetCompanyId || b.companyId === targetCompanyId;
                  return branchMatch && companyMatch;
                });
    
                if (matchingBatches.length > 0) {
                  console.log('[Inventory/Batches] Found', matchingBatches.length, 'PostgreSQL batches matching branch/company filters, prioritizing them');
                  // Prioritize matching batches, but include all
                  pgResult.rows = [...matchingBatches, ...pgResult.rows.filter(b => !matchingBatches.includes(b))];
                } else {
                  console.log('[Inventory/Batches] No PostgreSQL batches match filters, but showing all', pgResult.rows.length, 'batches anyway');
                }
              }
    
              if (pgResult.rows && pgResult.rows.length > 0) {
                console.log(`[Inventory/Batches] ✅ Found ${pgResult.rows.length} batches in PostgreSQL`);
                pgBatches = pgResult.rows;
                await pgClient.end();
              } else {
                console.log('[Inventory/Batches] ⚠️ No batches found in PostgreSQL for product:', productId);
                // CRITICAL: Even if query with filters returns empty, batches might exist without matching branch/company
                // Try one more time with NO filters at all (except isReported and isActive)
                if (targetBranchId || targetCompanyId) {
                  console.log('[Inventory/Batches] 🔄 Retrying PostgreSQL query with NO branch/company filters...');
                  const pgSqlNoFilters = 'SELECT id, "batchNo", "productId", "branchId", "companyId", quantity, "sellingPrice", "costPrice", "expireDate", "expiryDate", "productionDate", "isActive", "isReported" FROM batches WHERE "productId" = $1 AND "isActive" = true AND quantity > 0 AND ("isReported" IS NULL OR "isReported" = false) ORDER BY COALESCE("expireDate", "expiryDate") ASC LIMIT 100';
                  console.log('[Inventory/Batches] PostgreSQL retry query:', pgSqlNoFilters);
                  try {
                  const pgResultNoFilters = await Promise.race([
                    pgClient.query(pgSqlNoFilters, [productId]),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Query timeout')), 10000))
                  ]);
                  if (pgResultNoFilters.rows && pgResultNoFilters.rows.length > 0) {
                    console.log(`[Inventory/Batches] ✅ Found ${pgResultNoFilters.rows.length} batches in PostgreSQL (no branch/company filter)`);
                    pgBatches = pgResultNoFilters.rows;
                    } else {
                      console.log('[Inventory/Batches] ⚠️ Still no batches found in PostgreSQL after removing branch/company filters');
                  }
                  } catch (retryError) {
                    console.error('[Inventory/Batches] ❌ Retry query failed:', retryError.message);
                }
                }
                await pgClient.end();
              }
            } catch (pgError) {
              console.error('[Inventory/Batches] PostgreSQL check failed:', pgError.message);
            }
          }
    
          // Auto-create batch if none exists and product has stock
          if (batches.length === 0 && pgBatches.length === 0 && product.quantity > 0) {
            console.log('[Inventory/Batches] Auto-creating batch for product:', productId);
            const batchId = uuid();
            const batchNo = `AUTO-${Date.now()}`;
            const timestamp = now();
            const expiryDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
            const finalBranchId = targetBranchId || product.branchId;
            const finalCompanyId = targetCompanyId || product.companyId;
    
            run(`INSERT INTO batches (id, batchNo, productId, branchId, companyId, supplierId, supplierName, barcode, totalBoxes, unitsPerBox, quantity, purchasePrice, sellingPrice, stockPurchasePrice, paidAmount, supplierOutstanding, supplierInvoiceNo, purchasingMethod, expireDate, productionDate, shelfId, shelfName, isActive, isReported, createdBy, createdAt, updatedAt)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,?,?,?)`,
              [batchId, batchNo, productId, finalBranchId, finalCompanyId, product.supplierId || null, null, null, 0, 1, product.quantity, product.costPrice || 0, product.sellingPrice || product.unitPrice || 0, product.costPrice || 0, 0, 0, null, null, expiryDate, timestamp, null, null, req.user?.id || null, timestamp, timestamp]);
    
            // Re-query batches after auto-create
            batches = query('SELECT * FROM batches WHERE productId = ? AND isActive = 1 AND quantity > 0 ORDER BY expireDate ASC', [productId]);
          }
    
          // CRITICAL FIX: ALWAYS use PostgreSQL batches if SQLite is empty
          // This ensures batches from PostgreSQL are visible even if SQLite hasn't synced
          if (pgBatches.length > 0) {
            // Convert PostgreSQL format to SQLite format
            const convertedPgBatches = pgBatches.map(pgBatch => ({
              id: pgBatch.id,
              batchNo: pgBatch.batchNo,
              productId: pgBatch.productId,
              branchId: pgBatch.branchId,
              companyId: pgBatch.companyId,
              quantity: pgBatch.quantity,
              sellingPrice: pgBatch.sellingPrice,
              costPrice: pgBatch.costPrice,
              expireDate: pgBatch.expireDate || pgBatch.expiryDate,
              expiryDate: pgBatch.expireDate || pgBatch.expiryDate,
              productionDate: pgBatch.productionDate,
              isActive: pgBatch.isActive
            }));
    
            if (batches.length === 0) {
              // CRITICAL: If SQLite is empty, use PostgreSQL batches directly
              console.log(`[Inventory/Batches] ✅ SQLite empty - using ${convertedPgBatches.length} batches from PostgreSQL`);
              batches = convertedPgBatches;
            } else {
              // Merge: remove duplicates and combine
              const sqliteBatchIds = new Set(batches.map(b => b.id));
              const uniquePgBatches = convertedPgBatches.filter(pgBatch => !sqliteBatchIds.has(pgBatch.id));
              if (uniquePgBatches.length > 0) {
                console.log(`[Inventory/Batches] ✅ Merging ${uniquePgBatches.length} unique batches from PostgreSQL`);
                batches = [...uniquePgBatches, ...batches];
              }
            }
          }
    
          // Filter expired if requested
          const now_date = new Date();
          let filteredBatches = batches;
          if (expired === 'false') {
            filteredBatches = batches.filter(b => {
              // CRITICAL: Database uses expireDate (not expiryDate)
              const expDate = b.expireDate || b.expiryDate;
              if (!expDate) return true;
              return new Date(expDate) > now_date;
            });
          }
    
          const result = filteredBatches.map(b => {
            // CRITICAL: Database uses expireDate (not expiryDate), so check both
            const expiryDateValue = b.expireDate || b.expiryDate;
            const expiryDateObj = expiryDateValue ? new Date(expiryDateValue) : null;
            const daysUntilExpiry = expiryDateObj ? Math.ceil((expiryDateObj.getTime() - now_date.getTime()) / (1000 * 60 * 60 * 24)) : null;
    
            let expiryStatus = 'GOOD';
            if (daysUntilExpiry !== null) {
              if (daysUntilExpiry < 0) expiryStatus = 'EXPIRED';
              else if (daysUntilExpiry <= 7) expiryStatus = 'CRITICAL';
              else if (daysUntilExpiry <= 30) expiryStatus = 'WARNING';
            }
    
            return {
              id: b.id,
              batchNo: b.batchNo || b.batchNumber,
              batchNumber: b.batchNo || b.batchNumber,
              quantity: b.quantity,
              totalStock: b.quantity,
              sellingPrice: b.sellingPrice,
              costPrice: b.costPrice,
              expireDate: expiryDateValue,
              expiryDate: expiryDateValue,
              manufacturingDate: b.manufacturingDate || b.productionDate,
              productionDate: b.manufacturingDate || b.productionDate,
              expiryStatus,
              daysUntilExpiry,
              productId: b.productId,
              product: { id: product.id, name: product.name, sku: product.sku }
            };
          });
    
          console.log('[Inventory/Batches] === FINAL RESULT ===');
          console.log('[Inventory/Batches] Total batches being returned:', result.length);
          if (result.length > 0) {
            console.log('[Inventory/Batches] Batch IDs:', result.map(b => b.id));
            console.log('[Inventory/Batches] Batch numbers:', result.map(b => b.batchNo));
            console.log('[Inventory/Batches] Batch quantities:', result.map(b => b.quantity));
          } else {
            console.log('[Inventory/Batches] ⚠️ WARNING: Returning EMPTY array!');
            console.log('[Inventory/Batches] Product ID:', productId);
            console.log('[Inventory/Batches] SQLite batches count:', batches.length);
            console.log('[Inventory/Batches] PostgreSQL batches count:', pgBatches.length);
            console.log('[Inventory/Batches] Product exists:', !!product);
            if (product) {
              console.log('[Inventory/Batches] Product branchId:', product.branchId);
              console.log('[Inventory/Batches] Product companyId:', product.companyId);
            }
          }
          console.log('[Inventory/Batches] ');
    
          res.json({ success: true, data: result });
        } catch (e) {
          console.error('[Inventory/Batches] Error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // GET /api/inventory/products (line 12331)
      app.get('/api/inventory/products', authMiddleware, (req, res) => {
        try {
          const { branchId, companyId, lowStock } = req.query;
    
          // Get data filter based on user role
          const { branchFilter, companyFilter } = getDataFilter(req.user, branchId, companyId);
    
          let sql = 'SELECT * FROM products WHERE isActive = 1';
          const params = [];
    
          // Apply strict data isolation
          if (branchFilter) { sql += ' AND branchId = ?'; params.push(branchFilter); }
          if (companyFilter) { sql += ' AND companyId = ?'; params.push(companyFilter); }
          if (lowStock === 'true') { sql += ' AND quantity <= minStock'; }
          sql += ' ORDER BY quantity ASC';
          const products = query(sql, params).map(p => ({
            ...p,
            stock: p.quantity,
            category: p.categoryId ? query('SELECT id, name FROM categories WHERE id = ?', [p.categoryId])[0] : { id: '', name: 'Uncategorized' },
            supplier: p.supplierId ? query('SELECT id, name FROM suppliers WHERE id = ?', [p.supplierId])[0] : { id: '', name: 'Unknown' }
          }));
          res.json({ success: true, data: { products, pagination: { total: products.length, page: 1, limit: 100, pages: 1 } } });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // GET /api/inventory/low-stock (line 12357)
      app.get('/api/inventory/low-stock', authMiddleware, (req, res) => {
        try {
          // Get data filter based on user role
          const { branchFilter, companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
    
          let sql = 'SELECT * FROM products WHERE isActive = 1 AND quantity <= minStock';
          const params = [];
    
          // Apply strict data isolation
          if (branchFilter) { sql += ' AND branchId = ?'; params.push(branchFilter); }
          if (companyFilter) { sql += ' AND companyId = ?'; params.push(companyFilter); }
          sql += ' ORDER BY quantity ASC';
    
          const products = query(sql, params).map(p => ({
            ...p,
            stock: p.quantity,
            category: p.categoryId ? query('SELECT id, name FROM categories WHERE id = ?', [p.categoryId])[0] : { id: '', name: 'Uncategorized' },
            supplier: p.supplierId ? query('SELECT id, name FROM suppliers WHERE id = ?', [p.supplierId])[0] : { id: '', name: 'Unknown' }
          }));
          res.json({ success: true, data: { products, count: products.length } });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // GET /api/inventory/reports (line 12381)
      app.get('/api/inventory/reports', authMiddleware, (req, res) => {
        try {
          // Get data filter based on user role
          const { branchFilter, companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
    
          let productsSql = 'SELECT * FROM products WHERE isActive = 1';
          const productsParams = [];
    
          // Apply strict data isolation
          if (branchFilter) { productsSql += ' AND branchId = ?'; productsParams.push(branchFilter); }
          if (companyFilter) { productsSql += ' AND companyId = ?'; productsParams.push(companyFilter); }
    
          const products = query(productsSql, productsParams);
    
          // Also filter categories by branch/company
          let categoriesSql = 'SELECT * FROM categories WHERE isActive = 1';
          const categoriesParams = [];
          if (branchFilter) { categoriesSql += ' AND branchId = ?'; categoriesParams.push(branchFilter); }
          if (companyFilter) { categoriesSql += ' AND companyId = ?'; categoriesParams.push(companyFilter); }
    
          const categories = query(categoriesSql, categoriesParams);
          const lowStock = products.filter(p => p.quantity <= p.minStock);
          const outOfStock = products.filter(p => p.quantity === 0);
          const totalValue = products.reduce((sum, p) => sum + (p.quantity * (p.costPrice || 0)), 0);
    
          res.json({ success: true, data: {
            summary: { totalProducts: products.length, totalValue, lowStockCount: lowStock.length, outOfStockCount: outOfStock.length },
            lowStockProducts: lowStock.map(p => ({
              ...p, stock: p.quantity,
              category: p.categoryId ? query('SELECT name FROM categories WHERE id = ?', [p.categoryId])[0] : { name: 'Uncategorized' },
              supplier: p.supplierId ? query('SELECT name FROM suppliers WHERE id = ?', [p.supplierId])[0] : { name: 'Unknown' }
            })),
            productsByCategory: categories.map(c => ({
              categoryId: c.id,
              category: { id: c.id, name: c.name },
              _count: { id: products.filter(p => p.categoryId === c.id).length },
              _sum: { stock: products.filter(p => p.categoryId === c.id).reduce((sum, p) => sum + (p.quantity || 0), 0) }
            }))
          }});
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

}

module.exports = {
  registerInventoryRoutes
};
