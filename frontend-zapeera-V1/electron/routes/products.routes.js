/**
 * Products Routes
 * Extracted from routes/index.js
 */

function registerProductsRoutes(app, authMiddleware, deps) {
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

// GET /api/products (line 2805)
      app.get('/api/products', authMiddleware, (req, res) => {
        try {
          const { branchId, companyId, categoryId, category, search, lowStock, categoryType, limit = 1000 } = req.query;
          console.log('[Products] GET - User:', req.user?.email, 'Role:', req.user?.role, 'Branch:', req.user?.branchId);
    
          // CRITICAL FIX: Get data filter based on user role
          const { branchFilter, companyFilter } = getDataFilter(req.user, branchId, companyId);
    
          console.log('[Products] Data filter:', { branchFilter, companyFilter, branchId, companyId, headerCompanyId: req.headers['x-company-id'], headerBranchId: req.headers['x-branch-id'] });
    
          let sql = 'SELECT * FROM products WHERE isActive = 1';
          const params = [];
    
          // CRITICAL FIX: Apply strict data isolation - filter by companyId when branchId is null (All Branches)
          const userRole = req.user?.role;
          if (userRole === 'SUPERADMIN') {
            // SUPERADMIN can see all, but can filter if requested
            if (branchFilter) {
              sql += ' AND branchId = ?';
              params.push(branchFilter);
            } else if (companyFilter) {
              // When no branch but company selected, show products from all branches of that company
              sql += ' AND companyId = ?';
              params.push(companyFilter);
            }
          } else {
            // ADMIN and other roles: strict filtering
            if (branchFilter) {
              // Specific branch selected: filter by branchId
              sql += ' AND branchId = ?';
              params.push(branchFilter);
            } else if (companyFilter) {
              // CRITICAL FIX: Company selected but no branch (All Branches): show products from all branches of that company
              sql += ' AND companyId = ?';
              params.push(companyFilter);
              console.log('[Products] Filtering by companyId (All Branches):', companyFilter);
            }
          }
    
          if (categoryId || category) { sql += ' AND categoryId = ?'; params.push(categoryId || category); }
          if (search) { sql += ' AND (name LIKE ? OR genericName LIKE ? OR sku LIKE ? OR barcode LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }
          if (lowStock === 'true') { sql += ' AND quantity <= minStock'; }
          sql += ' ORDER BY createdAt DESC';
          sql += ` LIMIT ${parseInt(limit) || 1000}`;
    
          console.log('[Products] SQL:', sql);
          console.log('[Products] Params:', params);
    
          const rawProducts = query(sql, params);
          console.log('[Products] Raw products count:', rawProducts.length);
    
          const products = rawProducts.map(p => {
            const cat = p.categoryId ? query('SELECT id, name, type, color FROM categories WHERE id = ?', [p.categoryId])[0] : null;
            const sup = p.supplierId ? query('SELECT id, name FROM suppliers WHERE id = ?', [p.supplierId])[0] : null;
            const branch = p.branchId ? query('SELECT id, name FROM branches WHERE id = ?', [p.branchId])[0] : null;
    
            // Filter by category type if specified
            if (categoryType && cat && cat.type !== categoryType) {
              return null;
            }
    
            // Get batches for this product - match backend-zp logic
            // Filter: isActive = true, quantity > 0, and (expireDate is null OR expireDate > now)
            const nowDate = new Date().toISOString();
            let productBatches = query(
              `SELECT * FROM batches
               WHERE productId = ?
               AND (isActive = 1 OR isActive IS NULL)
               AND quantity > 0
               AND (expireDate IS NULL OR expireDate > ?)
               ORDER BY expireDate ASC`,
              [p.id, nowDate]
            );
            console.log('[Products] Found', productBatches.length, 'active batches for product', p.name, '(productId:', p.id + ')');
    
            // Auto-create batch if none exists and product has stock
            if (productBatches.length === 0 && p.quantity > 0) {
              const batchId = uuid();
              const batchNo = `AUTO-${Date.now()}-${Math.random().toString(36).substr(2, 3)}`;
              const timestamp = now();
              const expiryDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    
              run(`INSERT INTO batches (id, batchNo, productId, branchId, companyId, supplierId, supplierName, barcode, totalBoxes, unitsPerBox, quantity, purchasePrice, sellingPrice, stockPurchasePrice, paidAmount, supplierOutstanding, supplierInvoiceNo, purchasingMethod, expireDate, productionDate, shelfId, shelfName, isActive, isReported, createdBy, createdAt, updatedAt)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,?,?,?)`,
                [batchId, batchNo, p.id, p.branchId, p.companyId, p.supplierId || null, null, null, 0, 1, p.quantity, p.costPrice || 0, p.sellingPrice || p.unitPrice || 0, p.costPrice || 0, 0, 0, null, null, expiryDate, timestamp, null, null, req.user?.id || null, timestamp, timestamp]);
    
              productBatches = query('SELECT * FROM batches WHERE productId = ? AND isActive = 1 ORDER BY expiryDate ASC', [p.id]);
              console.log('[Products] Auto-created batch for product:', p.name);
            }
    
            // Format batches with supplier and manufacturer relations - match backend-zp
            const formattedBatches = productBatches.map(b => {
              // Get supplier from batch
              const batchSupplier = b.supplierId ? query('SELECT id, name FROM suppliers WHERE id = ?', [b.supplierId])[0] : null;
    
              // Get manufacturer from supplier
              let batchManufacturer = null;
              if (batchSupplier) {
                const supplierWithManufacturer = query('SELECT s.*, m.id as manufacturerId, m.name as manufacturerName FROM suppliers s LEFT JOIN manufacturers m ON s.manufacturerId = m.id WHERE s.id = ?', [b.supplierId])[0];
                if (supplierWithManufacturer?.manufacturerId) {
                  batchManufacturer = {
                    id: supplierWithManufacturer.manufacturerId,
                    name: supplierWithManufacturer.manufacturerName
                  };
                }
              }
    
              return {
                id: b.id,
                batchNo: b.batchNo || b.batchNumber,
                batchNumber: b.batchNo || b.batchNumber,
                quantity: b.quantity || 0,
                totalBoxes: b.totalBoxes || 0,
                unitsPerBox: b.unitsPerBox || 1,
                purchasePrice: b.purchasePrice || b.costPrice || 0,
                sellingPrice: b.sellingPrice || 0,
                expireDate: b.expireDate || b.expiryDate,
                supplierName: b.supplierName || (batchSupplier ? batchSupplier.name : null),
                supplier: batchSupplier ? {
                  id: batchSupplier.id,
                  name: batchSupplier.name,
                  manufacturer: batchManufacturer
                } : null
              };
            });
    
            // Get current batch (first available with stock) - match backend-zp
            const currentBatch = formattedBatches.find(b => b.quantity > 0) || formattedBatches[0] || null;
    
            // Calculate total stock from batches - match backend-zp
            const totalStock = formattedBatches.reduce((sum, b) => sum + (b.quantity || 0), 0) || (p.quantity || 0);
    
            // Get price from current batch or product - match backend-zp
            const price = currentBatch?.sellingPrice || p.sellingPrice || p.unitPrice || 0;
    
            // Get supplier and manufacturer from current batch (not from product directly) - match backend-zp
            const productSupplier = currentBatch?.supplier || (p.supplierId ? query('SELECT id, name FROM suppliers WHERE id = ?', [p.supplierId])[0] : null);
            const productManufacturer = currentBatch?.supplier?.manufacturer || null;
    
            return {
              ...p,
              price: price,
              stock: totalStock,
              sellingPrice: price,
              costPrice: currentBatch?.purchasePrice || p.costPrice || 0,
              unitType: p.unitType || 'PIECE',
              unitsPerPack: p.unitsPerPack || 1,
              minStock: p.minStock || 10,
              maxStock: p.maxStock || 1000,
              requiresPrescription: p.requiresPrescription || false,
              category: cat || { id: '', name: 'Uncategorized', type: 'GENERAL' },
              supplier: productSupplier ? {
                id: productSupplier.id,
                name: productSupplier.name,
                manufacturer: productManufacturer
              } : null,
              branch: branch || { id: '', name: 'Unknown' },
              manufacturer: productManufacturer,
              batches: formattedBatches,
              currentBatch: currentBatch
            };
          }).filter(p => p !== null);
    
          console.log('[Products] Final products count:', products.length);
          res.json({ success: true, data: { products, pagination: { total: products.length, page: 1, limit: parseInt(limit) || 1000, pages: 1 } } });
        } catch (e) { console.error('[API] Products GET error:', e); res.status(500).json({ success: false, message: e.message }); }
      });

  // GET /api/products/:id (line 2974)
      app.get('/api/products/:id', authMiddleware, (req, res) => {
        try {
          const items = query('SELECT * FROM products WHERE id = ? AND isActive = 1', [req.params.id]);
          if (!items.length) return res.status(404).json({ success: false, message: 'Product not found' });
          const p = items[0];
          p.category = p.categoryId ? query('SELECT * FROM categories WHERE id = ?', [p.categoryId])[0] : null;
          p.manufacturer = p.manufacturerId ? query('SELECT * FROM manufacturers WHERE id = ?', [p.manufacturerId])[0] : null;
          p.supplier = p.supplierId ? query('SELECT * FROM suppliers WHERE id = ?', [p.supplierId])[0] : null;
          p.branch = p.branchId ? query('SELECT id, name FROM branches WHERE id = ?', [p.branchId])[0] : null;
    
          // Get batches for this product with supplier and manufacturer relations - match backend-zp
          const nowDate = new Date().toISOString();
          const productBatches = query(
            `SELECT * FROM batches
             WHERE productId = ?
             AND (isActive = 1 OR isActive IS NULL)
             AND quantity > 0
             AND (expireDate IS NULL OR expireDate > ?)
             ORDER BY expireDate ASC`,
            [p.id, nowDate]
          );
          console.log('[Products] Found', productBatches.length, 'active batches for product', p.id);
    
          // Format batches with supplier and manufacturer relations - match backend-zp
          p.batches = productBatches.map(b => {
            // Get supplier from batch
            const batchSupplier = b.supplierId ? query('SELECT id, name FROM suppliers WHERE id = ?', [b.supplierId])[0] : null;
    
            // Get manufacturer from supplier
            let batchManufacturer = null;
            if (batchSupplier) {
              const supplierWithManufacturer = query('SELECT s.*, m.id as manufacturerId, m.name as manufacturerName FROM suppliers s LEFT JOIN manufacturers m ON s.manufacturerId = m.id WHERE s.id = ?', [b.supplierId])[0];
              if (supplierWithManufacturer?.manufacturerId) {
                batchManufacturer = {
                  id: supplierWithManufacturer.manufacturerId,
                  name: supplierWithManufacturer.manufacturerName
                };
              }
            }
    
            return {
              id: b.id,
              batchNo: b.batchNo || b.batchNumber,
              batchNumber: b.batchNo || b.batchNumber,
              quantity: b.quantity || 0,
              totalBoxes: b.totalBoxes || 0,
              unitsPerBox: b.unitsPerBox || 1,
              purchasePrice: b.purchasePrice || b.costPrice || 0,
              sellingPrice: b.sellingPrice || 0,
              expireDate: b.expireDate || b.expiryDate,
              supplierName: b.supplierName || (batchSupplier ? batchSupplier.name : null),
              supplier: batchSupplier ? {
                id: batchSupplier.id,
                name: batchSupplier.name,
                manufacturer: batchManufacturer
              } : null
            };
          });
    
          // Get current batch (first available with stock) - match backend-zp
          p.currentBatch = p.batches.find(b => b.quantity > 0) || p.batches[0] || null;
    
          // Calculate total stock from batches - match backend-zp
          const batchStock = p.batches.reduce((sum, b) => sum + (b.quantity || 0), 0);
          p.stock = batchStock > 0 ? batchStock : (p.quantity || 0);
          p.price = p.currentBatch?.sellingPrice || p.sellingPrice || p.unitPrice || 0;
    
          // Get supplier and manufacturer from current batch (not from product directly) - match backend-zp
          p.supplier = p.currentBatch?.supplier || (p.supplierId ? query('SELECT id, name FROM suppliers WHERE id = ?', [p.supplierId])[0] : null);
          p.manufacturer = p.currentBatch?.supplier?.manufacturer || null;
    
          res.json({ success: true, data: p });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // POST /api/products (line 3050)
      app.post('/api/products', authMiddleware, (req, res) => {
        let productId = null;
        try {
          console.log('[Products] === PRODUCT CREATION START ===');
          console.log('[Products] POST request body:', JSON.stringify(req.body, null, 2));
          console.log('[Products] User:', { id: req.user?.id, email: req.user?.email, role: req.user?.role, branchId: req.user?.branchId, companyId: req.user?.companyId });
    
          // Validate database is initialized
          if (!getDatabase()) {
            console.error('[Products] ❌ Database not initialized!');
            return res.status(500).json({ success: false, message: 'Database not initialized. Please restart the application.' });
          }
    
          const { name, genericName, formula, sku, barcode, description, categoryId, branchId, companyId,
                  unitPrice = 0, costPrice = 0, sellingPrice = 0, stock = 0, quantity = 0, minStock = 10, maxStock = 1000,
                  unitsPerPack = 1, reorderLevel = 20, requiresPrescription = false,
                  manufacturerId, supplierId, shelfId, expiryDate, manufacturingDate, batchNumber } = req.body;
    
          // Validate required fields
          if (!name || !name.trim()) {
            console.error('[Products] ❌ Name is required but not provided');
            return res.status(400).json({ success: false, message: 'Product name is required' });
          }
    
          productId = uuid();
          const generatedSku = sku || `SKU-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
          const timestamp = now();
          const finalQuantity = parseInt(stock) || parseInt(quantity) || 0;
          const finalSellingPrice = parseFloat(sellingPrice) || parseFloat(unitPrice) || 0;
          const finalCostPrice = parseFloat(costPrice) || 0;
    
          // Get context from headers (set by frontend) - match backend controller
          const selectedCompanyId = req.headers['x-company-id'] || req.user?.selectedCompanyId;
          const selectedBranchId = req.headers['x-branch-id'] || req.user?.selectedBranchId;
    
          // Use selected company/branch context if available, otherwise use the provided branchId, then user's branch
          let targetCompanyId = selectedCompanyId || companyId || req.user?.companyId || null;
          let targetBranchId = selectedBranchId || branchId || req.user?.branchId || null;
    
          if (targetCompanyId && targetBranchId) {
            // Use selected company/branch context
            console.log('[Products] Using selected company/branch context:', { targetCompanyId, targetBranchId });
          } else {
            // Fallback to provided branchId or user's branch
            if (branchId) {
              const branch = query('SELECT companyId FROM branches WHERE id = ?', [branchId])[0];
              if (!branch) {
                return res.status(400).json({
                  success: false,
                  message: 'Branch not found'
                });
              }
              targetCompanyId = branch.companyId;
              targetBranchId = branchId;
              console.log('[Products] Using provided branch context:', { targetCompanyId, targetBranchId });
            } else if (req.user?.branchId) {
              // Use user's assigned branch
              const branch = query('SELECT companyId FROM branches WHERE id = ?', [req.user.branchId])[0];
              if (branch) {
                targetCompanyId = branch.companyId;
                targetBranchId = req.user.branchId;
                console.log('[Products] Using user\'s assigned branch context:', { targetCompanyId, targetBranchId });
              } else {
                return res.status(400).json({
                  success: false,
                  message: 'User branch not found. Please select a branch first.'
                });
              }
            } else {
              return res.status(400).json({
                success: false,
                message: 'Branch is required. Please select a branch first.'
              });
            }
          }
    
          // Check if barcode already exists for this admin (match backend)
          if (barcode && barcode.trim()) {
            const existingProduct = query('SELECT id FROM products WHERE barcode = ? AND createdBy = ?',
              [barcode, req.user?.createdBy || req.user?.id || 'default-admin-id']);
            if (existingProduct && existingProduct.length > 0) {
              return res.status(400).json({
                success: false,
                message: 'Product with this barcode already exists'
              });
            }
          }
    
          const cleanCategoryId = (categoryId && categoryId.length > 10) ? categoryId : null;
          const cleanSupplierId = (supplierId && supplierId.length > 10) ? supplierId : null;
    
          console.log('[Products] Creating product with:', {
            id: productId,
            name,
            targetBranchId,
            targetCompanyId,
            cleanCategoryId,
            cleanSupplierId,
            finalQuantity: 0,
            finalSellingPrice,
            finalCostPrice
          });
    
          // CRITICAL: Ensure SQLite table exists and has all required columns BEFORE insert
          try {
            // Check if table exists
            const tableExists = query("SELECT name FROM sqlite_master WHERE type='table' AND name='products'");
            if (!tableExists || tableExists.length === 0) {
              console.error('[Products] ❌ Table "products" does not exist!');
              return res.status(500).json({ success: false, message: 'Database table not found. Please restart the application.' });
            }
    
            const tableInfo = query("PRAGMA table_info(products)");
            const columnNames = tableInfo.map(col => col.name.toLowerCase());
            console.log('[Products] SQLite table columns:', columnNames);
    
            // Required columns for products table
            const requiredColumns = {
              'formula': 'TEXT',
              'genericname': 'TEXT',
              'createdby': 'TEXT',
              'unitprice': 'REAL DEFAULT 0'
            };
    
            // Add missing columns if they don't exist
            for (const [colName, colType] of Object.entries(requiredColumns)) {
              if (!columnNames.includes(colName)) {
                console.log(`[Products] Adding missing column: ${colName}...`);
                const alterSuccess = run(`ALTER TABLE products ADD COLUMN ${colName} ${colType}`);
                if (alterSuccess) {
                  saveDatabase();
                  console.log(`[Products] ✅ Added column: ${colName}`);
                } else {
                  console.error(`[Products] ❌ Failed to add column ${colName}:`, lastDbError);
                }
              }
            }
          } catch (migrationError) {
            console.error('[Products] ❌ Migration check error:', migrationError.message, migrationError.stack);
            return res.status(500).json({ success: false, message: 'Database migration error: ' + migrationError.message });
          }
    
          // Insert into SQLite - PRIMARY DATABASE
          console.log('[Products] Executing INSERT statement...');
          // Note: Stock is now managed through batches, not directly on products (match backend)
          // Set quantity to 0 - batches will handle stock
          const finalQuantityForDb = 0;
    
          const insertSuccess = run(`INSERT INTO products (id, name, genericName, sku, barcode, description, categoryId, branchId, companyId,
               unitPrice, costPrice, sellingPrice, quantity, minStock, maxStock, unitsPerPack, reorderLevel, requiresPrescription,
               manufacturerId, supplierId, shelfId, expiryDate, manufacturingDate, batchNumber, createdBy, isActive, createdAt, updatedAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
            [productId, name.trim(), genericName || formula || null, generatedSku, barcode || null, description || null,
             cleanCategoryId, targetBranchId, targetCompanyId, finalSellingPrice, finalCostPrice, finalSellingPrice,
             finalQuantityForDb, minStock || 1, maxStock || null, unitsPerPack || 1, reorderLevel || 20,
             requiresPrescription ? 1 : 0, manufacturerId || null, cleanSupplierId, shelfId || null,
             expiryDate || null, manufacturingDate || null, batchNumber || null,
             req.user?.createdBy || req.user?.id || null, timestamp, timestamp]);
    
          if (!insertSuccess) {
            const errorMsg = lastDbError || 'Unknown database error';
            console.error('[Products] ❌ SQLite insert FAILED!');
            console.error('[Products] Error:', errorMsg);
            console.error('[Products] Product ID:', productId);
            return res.status(500).json({ success: false, message: 'Failed to create product: ' + errorMsg });
          }
    
          console.log('[Products] ✅ INSERT statement executed successfully');
    
          // CRITICAL: Verify the insert actually worked by querying the database
          console.log('[Products] Verifying product was inserted...');
          const verifyAttempts = 3;
          let p = null;
          for (let attempt = 1; attempt <= verifyAttempts; attempt++) {
            p = query('SELECT * FROM products WHERE id = ?', [productId])[0];
            if (p) {
              console.log(`[Products] ✅ Product verified in database (attempt ${attempt})`);
              break;
            }
            console.log(`[Products] ⚠️ Product not found (attempt ${attempt}/${verifyAttempts}), retrying...`);
            // Small delay before retry (synchronous wait)
            const start = Date.now();
            while (Date.now() - start < 100) { /* wait 100ms */ }
          }
    
          if (!p) {
            console.error('[Products] ❌ CRITICAL: Product insert reported success but product not found in database!');
            console.error('[Products] Product ID:', productId);
            console.error('[Products] This indicates a database persistence issue.');
            return res.status(500).json({ success: false, message: 'Product creation failed: Database persistence error. Please try again.' });
          }
    
          console.log('[Products] ✅ Product found in database:', { id: p.id, name: p.name });
    
          // Build response with nested objects
          const category = p.categoryId ? query('SELECT id, name FROM categories WHERE id = ?', [p.categoryId])[0] : null;
          const supplier = p.supplierId ? query('SELECT id, name FROM suppliers WHERE id = ?', [p.supplierId])[0] : null;
          const branch = p.branchId ? query('SELECT id, name FROM branches WHERE id = ?', [p.branchId])[0] : null;
    
          const product = {
            ...p,
            category: category || { id: '', name: 'Uncategorized' },
            supplier: supplier || { id: '', name: 'Unknown' },
            branch: branch || { id: '', name: 'Unknown' },
            stock: p.quantity || 0,
            price: p.sellingPrice || 0,
            requiresPrescription: !!p.requiresPrescription
          };
    
          console.log('[Products] ✅ Product created successfully:', { id: product.id, name: product.name, branchId: product.branchId });
          console.log('[Products] === PRODUCT CREATION SUCCESS ===');
    
          // 🔄 TWO-WAY SYNC: Queue for sync to PostgreSQL (non-blocking)
          try {
            handleDataChange('products', 'create', product);
          } catch (syncError) {
            console.error('[Products] ⚠️ Sync queue error (non-critical):', syncError.message);
          }
    
          res.status(201).json({ success: true, data: product, message: 'Product created successfully' });
        } catch (e) {
          console.error('[Products] ❌ EXCEPTION in product creation:', e.message);
          console.error('[Products] Stack trace:', e.stack);
          console.error('[Products] Product ID:', productId);
          console.error('[Products] === PRODUCT CREATION FAILED ===');
    
          // If product was partially created, try to clean up
          if (productId) {
            try {
              const existing = query('SELECT id FROM products WHERE id = ?', [productId]);
              if (existing && existing.length > 0) {
                console.log('[Products] Cleaning up partially created product...');
                run('DELETE FROM products WHERE id = ?', [productId]);
                saveDatabase();
              }
            } catch (cleanupError) {
              console.error('[Products] Cleanup error:', cleanupError.message);
            }
          }
    
          res.status(500).json({ success: false, message: 'Error creating product: ' + e.message });
        }
      });

  // PUT /api/products/:id (line 3295)
      app.put('/api/products/:id', authMiddleware, (req, res) => {
        try {
          const { id } = req.params;
          const updateData = req.body;
    
          // Check if product exists (match backend)
          const existingProduct = query('SELECT * FROM products WHERE id = ?', [id])[0];
          if (!existingProduct) {
            return res.status(404).json({ success: false, message: 'Product not found' });
          }
    
          // Check if barcode already exists for this admin (if being updated) - match backend
          if (updateData.barcode && updateData.barcode !== existingProduct.barcode) {
            const barcodeExists = query('SELECT id FROM products WHERE barcode = ? AND id != ?', [updateData.barcode, id]);
            if (barcodeExists && barcodeExists.length > 0) {
              return res.status(400).json({ success: false, message: 'Product with this barcode already exists' });
            }
          }
    
          // Build update fields - match backend structure
          const updateFields = [];
          const updateValues = [];
    
          if (updateData.name !== undefined) { updateFields.push('name = ?'); updateValues.push(updateData.name); }
          if (updateData.description !== undefined) { updateFields.push('description = ?'); updateValues.push(updateData.description || null); }
          if (updateData.sku !== undefined) { updateFields.push('sku = ?'); updateValues.push(updateData.sku); }
          if (updateData.categoryId !== undefined) { updateFields.push('categoryId = ?'); updateValues.push(updateData.categoryId || null); }
          if (updateData.supplierId !== undefined) { updateFields.push('supplierId = ?'); updateValues.push(updateData.supplierId || null); }
          if (updateData.branchId !== undefined) { updateFields.push('branchId = ?'); updateValues.push(updateData.branchId); }
          if (updateData.barcode !== undefined) { updateFields.push('barcode = ?'); updateValues.push(updateData.barcode || null); }
          if (updateData.requiresPrescription !== undefined) { updateFields.push('requiresPrescription = ?'); updateValues.push(updateData.requiresPrescription ? 1 : 0); }
          if (updateData.isActive !== undefined) { updateFields.push('isActive = ?'); updateValues.push(updateData.isActive ? 1 : 0); }
          if (updateData.minStock !== undefined) { updateFields.push('minStock = ?'); updateValues.push(updateData.minStock); }
          if (updateData.maxStock !== undefined) { updateFields.push('maxStock = ?'); updateValues.push(updateData.maxStock || null); }
          if (updateData.unitsPerPack !== undefined) { updateFields.push('unitsPerPack = ?'); updateValues.push(updateData.unitsPerPack); }
          if (updateData.formula !== undefined) { updateFields.push('formula = ?'); updateValues.push(updateData.formula || null); }
    
          if (updateFields.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update' });
          }
    
          updateFields.push('updatedAt = ?');
          updateValues.push(now());
          updateValues.push(id);
    
          run(`UPDATE products SET ${updateFields.join(', ')} WHERE id = ?`, updateValues);
    
          // Get updated product with related data (match backend)
          const product = query('SELECT * FROM products WHERE id = ?', [id])[0];
          if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found after update' });
          }
    
          // Include related data (match backend)
          const category = product.categoryId ? query('SELECT id, name FROM categories WHERE id = ?', [product.categoryId])[0] : null;
          const supplier = product.supplierId ? query('SELECT id, name FROM suppliers WHERE id = ?', [product.supplierId])[0] : null;
          const branch = product.branchId ? query('SELECT id, name FROM branches WHERE id = ?', [product.branchId])[0] : null;
    
          const productWithRelations = {
            ...product,
            category: category || null,
            supplier: supplier || null,
            branch: branch ? { id: branch.id, name: branch.name } : null
          };
    
          // 🔄 TWO-WAY SYNC: Queue for sync to PostgreSQL
          if (productWithRelations) handleDataChange('products', 'update', productWithRelations);
    
          res.json({ success: true, data: productWithRelations, message: 'Product updated successfully' });
        } catch (e) {
          console.error('[Products] Update error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // DELETE /api/products/:id (line 3371)
      app.delete('/api/products/:id', authMiddleware, (req, res) => {
        try {
          const { id } = req.params;
    
          // Check if product exists (match backend)
          const product = query('SELECT * FROM products WHERE id = ?', [id])[0];
          if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
          }
    
          console.log(`[Products] Deleting product: ${product.name} (ID: ${id})`);
    
          // Match backend: Hard delete with transaction - delete related records first
          // Delete stock movements
          console.log('[Products] Deleting related stock movements...');
          const deleteStockMovements = run('DELETE FROM stock_movements WHERE productId = ?', [id]);
          if (!deleteStockMovements) {
            console.error('[Products] ❌ Failed to delete stock movements:', lastDbError);
          }
    
          // Delete sale items
          console.log('[Products] Deleting related sale items...');
          const deleteSaleItems = run('DELETE FROM sale_items WHERE productId = ?', [id]);
          if (!deleteSaleItems) {
            console.error('[Products] ❌ Failed to delete sale items:', lastDbError);
          }
    
          // Delete refund items
          console.log('[Products] Deleting related refund items...');
          const deleteRefundItems = run('DELETE FROM refund_items WHERE productId = ?', [id]);
          if (!deleteRefundItems) {
            console.error('[Products] ❌ Failed to delete refund items:', lastDbError);
          }
    
          // Delete batches
          console.log('[Products] Deleting related batches...');
          const deleteBatches = run('DELETE FROM batches WHERE productId = ?', [id]);
          if (!deleteBatches) {
            console.error('[Products] ❌ Failed to delete batches:', lastDbError);
          }
    
          // Delete the product itself (hard delete - match backend)
          console.log('[Products] Deleting product...');
          const deleteProduct = run('DELETE FROM products WHERE id = ?', [id]);
    
          if (!deleteProduct) {
            console.error('[Products] ❌ Delete query failed!');
            console.error('[Products] Last DB error:', lastDbError);
            return res.status(500).json({ success: false, message: lastDbError || 'Failed to delete product in database' });
          }
    
          console.log('[Products] ✅ Delete query executed successfully (hard delete)');
    
          // Save database immediately after delete
          saveDatabase();
          console.log('[Products] ✅ Database saved after delete');
    
          // Verify the deletion
          const verifyProduct = query('SELECT id FROM products WHERE id = ?', [id]);
          if (verifyProduct.length > 0) {
            console.error('[Products] ⚠️ Product still exists after delete!');
            return res.status(500).json({ success: false, message: 'Product deletion failed - product still exists in database' });
          }
    
          console.log(`[Products] ✅ Product ${product.name} permanently deleted from database`);
    
          // 🔄 TWO-WAY SYNC: Queue delete for sync to PostgreSQL
          handleDataChange('products', 'delete', product);
    
          res.json({ success: true, message: 'Product permanently deleted from database' });
        } catch (e) {
          console.error('[Products] Delete error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // GET /api/products/:productId/batches (line 5824)
      app.get('/api/products/:productId/batches', authMiddleware, (req, res) => {
        try {
          const { productId } = req.params;
          console.log('[Batches] Getting batches for product:', productId);
    
          // First check if product exists
          const product = query('SELECT * FROM products WHERE id = ?', [productId])[0];
          if (!product) {
            return res.json({ success: true, data: [] });
          }
    
          let batches = query('SELECT * FROM batches WHERE productId = ? AND isActive = 1 ORDER BY expiryDate ASC', [productId]);
    
          // If no batches exist, auto-create one from product stock
          if (batches.length === 0 && product.quantity > 0) {
            console.log('[Batches] No batches found, auto-creating from product stock');
            const batchId = uuid();
            const batchNo = `AUTO-${Date.now()}`;
            const timestamp = now();
            const expiryDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    
            run(`INSERT INTO batches (id, batchNo, productId, branchId, companyId, supplierId, supplierName, barcode, totalBoxes, unitsPerBox, quantity, purchasePrice, sellingPrice, stockPurchasePrice, paidAmount, supplierOutstanding, supplierInvoiceNo, purchasingMethod, expireDate, productionDate, shelfId, shelfName, isActive, isReported, createdBy, createdAt, updatedAt)
                 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,0,?,?,?)`,
              [batchId, batchNo, productId, product.branchId, product.companyId, product.supplierId || null, null, null, 0, 1, product.quantity, product.costPrice || 0, product.sellingPrice || product.unitPrice || 0, product.costPrice || 0, 0, 0, null, null, expiryDate, timestamp, null, null, req.user?.id || null, timestamp, timestamp]);
    
            batches = query('SELECT * FROM batches WHERE productId = ? AND isActive = 1 ORDER BY expiryDate ASC', [productId]);
          }
    
          const result = batches.map(b => ({
            ...b,
            id: b.id,
            batchNo: b.batchNo || b.batchNumber,
            batchNumber: b.batchNo || b.batchNumber,
            totalStock: b.quantity,
            quantity: b.quantity,
              expireDate: b.expireDate || b.expiryDate,
              expiryDate: b.expireDate || b.expiryDate,
              productionDate: b.productionDate || b.manufacturingDate,
              manufacturingDate: b.productionDate || b.manufacturingDate,
            purchasePrice: b.purchasePrice || b.costPrice,
            costPrice: b.purchasePrice || b.costPrice,
            sellingPrice: b.sellingPrice,
            product: product,
            supplier: b.supplierId ? query('SELECT id, name FROM suppliers WHERE id = ?', [b.supplierId])[0] : null
          }));
    
          console.log('[Batches] Returning', result.length, 'batches for product', productId);
          res.json({ success: true, data: result });
        } catch (e) {
          console.error('[Batches] Error getting product batches:', e);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // GET /api/products/stock-movements (line 10761)
      app.get('/api/products/stock-movements', authMiddleware, (req, res) => {
        try {
          // Return empty array since we don't track movements yet
          res.json({ success: true, data: { stockMovements: [], pagination: { total: 0, page: 1, limit: 50, pages: 1 } } });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // PATCH /api/products/:id/stock (line 10769)
      app.patch('/api/products/:id/stock', authMiddleware, (req, res) => {
        try {
          const { type, quantity, reason } = req.body;
          const product = query('SELECT * FROM products WHERE id = ?', [req.params.id])[0];
          if (!product) return res.status(404).json({ success: false, message: 'Product not found' });
    
          let newQuantity = product.quantity;
          if (type === 'IN') newQuantity += quantity;
          else if (type === 'OUT') newQuantity -= quantity;
          else if (type === 'ADJUSTMENT') newQuantity = quantity;
    
          run('UPDATE products SET quantity = ?, updatedAt = ? WHERE id = ?', [newQuantity, now(), req.params.id]);
          const updated = query('SELECT * FROM products WHERE id = ?', [req.params.id])[0];
          updated.stock = updated.quantity;
    
          // 🔄 TWO-WAY SYNC: Queue stock update for sync
          if (updated) handleDataChange('products', 'update', updated);
    
          // Also create a stock movement record
          const movementId = uuid();
          const timestamp = now();
          run(`INSERT INTO stock_movements (id, productId, type, quantity, reason, branchId, companyId, createdBy, createdAt, updatedAt)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [movementId, req.params.id, type, quantity, reason || null, product.branchId, product.companyId, req.user?.id, timestamp, timestamp]);
          const movement = query('SELECT * FROM stock_movements WHERE id = ?', [movementId])[0];
          if (movement) handleDataChange('stock_movements', 'create', movement);
    
          res.json({ success: true, data: updated });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // POST /api/products/bulk-delete (line 12209)
      app.post('/api/products/bulk-delete', authMiddleware, (req, res) => {
        try {
          const { productIds } = req.body;
          if (!productIds || !productIds.length) return res.status(400).json({ success: false, message: 'No products to delete' });
          productIds.forEach(id => {
            const product = query('SELECT * FROM products WHERE id = ?', [id])[0];
            run('UPDATE products SET isActive = 0, updatedAt = ? WHERE id = ?', [now(), id]);
            // 🔄 TWO-WAY SYNC: Queue soft delete for sync
            if (product) handleDataChange('products', 'update', { ...product, isActive: 0, updatedAt: now() });
          });
          res.json({ success: true, message: 'Products deleted', data: { deletedCount: productIds.length, deletedProducts: productIds.map(id => ({ id })) } });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // POST /api/products/bulk-import (line 12224)
      app.post('/api/products/bulk-import', authMiddleware, (req, res) => {
        try {
          const { products } = req.body;
          if (!products || !products.length) return res.status(400).json({ success: false, message: 'No products to import' });
    
          const successful = [];
          const failed = [];
    
          products.forEach(p => {
            try {
              const id = uuid();
              run(`INSERT INTO products (id, name, genericName, sku, description, categoryId, branchId, companyId, unitPrice, costPrice, sellingPrice, quantity, minStock, createdBy, isActive, createdAt, updatedAt)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
                [id, p.name, p.genericName || null, p.sku || `SKU-${Date.now()}`, p.description || null, p.categoryId || null, p.branchId || null, p.companyId || null, p.sellingPrice || 0, p.costPrice || 0, p.sellingPrice || 0, p.stock || 0, p.minStock || 10, req.user?.id, now(), now()]);
              const product = query('SELECT * FROM products WHERE id = ?', [id])[0];
              // 🔄 TWO-WAY SYNC: Queue for sync to PostgreSQL
              if (product) handleDataChange('products', 'create', product);
              successful.push({ ...p, id });
            } catch (e) {
              failed.push({ product: p, error: e.message });
            }
          });
    
          res.json({ success: true, data: { successful, failed, total: products.length, successCount: successful.length, failureCount: failed.length } });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

}

module.exports = {
  registerProductsRoutes
};
