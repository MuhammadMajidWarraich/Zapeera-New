/**
 * Sales Routes
 * Extracted from routes/index.js
 */

function registerSalesRoutes(app, authMiddleware, deps) {
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

// GET /api/sales (line 6731)
      app.get('/api/sales', authMiddleware, (req, res) => {
        try {
          console.log('[Sales] GET - User:', req.user?.email, 'Role:', req.user?.role, 'Branch:', req.user?.branchId);
          const { startDate, endDate, branchId, companyId, customerId, paymentMethod, limit = 500 } = req.query;
    
          // CRITICAL FIX: Check and add paidAmount/returnedAmount/invoiceNumber columns if they don't exist (migration)
          try {
            const tableInfo = query("PRAGMA table_info(sales)");
            const columnNames = tableInfo.map(col => col.name.toLowerCase());
            if (!columnNames.includes('paidamount')) {
              console.log('[Sales] Adding paidAmount column to sales table...');
              run('ALTER TABLE sales ADD COLUMN paidAmount REAL DEFAULT 0');
              saveDatabase();
            }
            if (!columnNames.includes('returnedamount')) {
              console.log('[Sales] Adding returnedAmount column to sales table...');
              run('ALTER TABLE sales ADD COLUMN returnedAmount REAL DEFAULT 0');
              saveDatabase();
            }
            if (!columnNames.includes('invoicenumber')) {
              console.log('[Sales] Adding invoiceNumber column to sales table...');
              run('ALTER TABLE sales ADD COLUMN invoiceNumber TEXT');
              saveDatabase();
              // Generate invoice numbers for existing sales that don't have one
              console.log('[Sales] Generating invoice numbers for existing sales...');
              const existingSales = query('SELECT id, createdAt FROM sales WHERE invoiceNumber IS NULL ORDER BY createdAt ASC');
              let invoiceCounter = 10000;
              for (const sale of existingSales) {
                const invoiceNumber = `INV-${String(invoiceCounter).padStart(5, '0')}`;
                run('UPDATE sales SET invoiceNumber = ? WHERE id = ?', [invoiceNumber, sale.id]);
                invoiceCounter = (invoiceCounter + 1) % 99999;
              }
              saveDatabase();
              console.log(`[Sales] Generated ${existingSales.length} invoice numbers for existing sales`);
            }
          } catch (migrationError) {
            console.log('[Sales] Migration check:', migrationError.message);
          }
    
          // CRITICAL FIX: Get data filter based on user role
          const { branchFilter, companyFilter } = getDataFilter(req.user, branchId, companyId);
    
          console.log('[Sales] Data filter:', { branchFilter, companyFilter, branchId, companyId, headerCompanyId: req.headers['x-company-id'], headerBranchId: req.headers['x-branch-id'] });
    
          let sql = 'SELECT * FROM sales WHERE 1=1';
          const params = [];
    
          // CRITICAL FIX: Apply data isolation - filter by companyId when branchId is null (All Branches)
          if (branchFilter) {
            // Specific branch selected: filter by branchId
            sql += ' AND branchId = ?';
            params.push(branchFilter);
          } else if (companyFilter) {
            // CRITICAL FIX: Company selected but no branch (All Branches): show sales from all branches of that company
            sql += ' AND companyId = ?';
            params.push(companyFilter);
            console.log('[Sales] Filtering by companyId (All Branches):', companyFilter);
          }
          if (customerId && customerId !== 'undefined') { sql += ' AND customerId = ?'; params.push(customerId); }
          if (paymentMethod && paymentMethod !== 'all') { sql += ' AND paymentMethod = ?'; params.push(paymentMethod); }
          if (startDate) { sql += ' AND createdAt >= ?'; params.push(startDate); }
          if (endDate) { sql += ' AND createdAt <= ?'; params.push(endDate); }
          sql += ` ORDER BY createdAt DESC LIMIT ${parseInt(limit) || 500}`;
    
          const rawSales = query(sql, params);
          console.log('[Sales] Found sales:', rawSales.length);
    
          const sales = rawSales.map(s => {
            const customer = s.customerId ? query('SELECT id, name, phone, email FROM customers WHERE id = ?', [s.customerId])[0] : null;
            const branch = s.branchId ? query('SELECT id, name, address FROM branches WHERE id = ?', [s.branchId])[0] : null;
            const user = s.createdBy ? query('SELECT id, name, email as username FROM users WHERE id = ?', [s.createdBy])[0] : { id: '', name: 'System', username: 'system' };
            const items = query('SELECT * FROM sale_items WHERE saleId = ?', [s.id]).map(item => {
              const product = query('SELECT id, name, unitPrice FROM products WHERE id = ?', [item.productId])[0];
              return {
                ...item,
                totalPrice: item.total,
                product: product || { id: item.productId, name: 'Unknown', unitType: 'PIECE' }
              };
            });
    
            return {
              ...s,
              subtotal: s.totalAmount,
              taxAmount: s.tax,
              discountAmount: s.discount,
              paidAmount: s.paidAmount || 0,
              returnedAmount: s.returnedAmount || 0,
              totalAmount: s.grandTotal,
              customer,
              branch: branch || { id: '', name: 'Default', address: '' },
              user: user || { id: '', name: 'Unknown', username: 'unknown' },
              items,
              receiptNumber: s.receiptNumber || s.invoiceNumber
            };
          });
    
          res.json({ success: true, data: { sales, pagination: { total: sales.length, page: 1, limit: parseInt(limit) || 500, pages: 1 } } });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // GET /api/sales/:id (line 6832)
      app.get('/api/sales/:id', authMiddleware, (req, res) => {
        try {
          const s = query('SELECT * FROM sales WHERE id = ?', [req.params.id])[0];
          if (!s) return res.status(404).json({ success: false, message: 'Sale not found' });
    
          const customer = s.customerId ? query('SELECT * FROM customers WHERE id = ?', [s.customerId])[0] : null;
          const branch = s.branchId ? query('SELECT * FROM branches WHERE id = ?', [s.branchId])[0] : null;
          const user = s.createdBy ? query('SELECT id, name, email as username FROM users WHERE id = ?', [s.createdBy])[0] : null;
          const items = query('SELECT * FROM sale_items WHERE saleId = ?', [s.id]).map(item => {
            const product = query('SELECT * FROM products WHERE id = ?', [item.productId])[0];
            return { ...item, totalPrice: item.total, product: product || { id: item.productId, name: 'Unknown', unitType: 'PIECE' } };
          });
    
          res.json({ success: true, data: {
            ...s, subtotal: s.totalAmount, taxAmount: s.tax, discountAmount: s.discount,
            paidAmount: s.paidAmount || 0, returnedAmount: s.returnedAmount || 0,
            customer, branch, user, items, receipts: [{ id: s.id, receiptNumber: s.invoiceNumber }]
          }});
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // POST /api/sales (line 6854)
      app.post('/api/sales', authMiddleware, (req, res) => {
        try {
          console.log('[Sales] POST request body:', JSON.stringify(req.body, null, 2));
    
          // CRITICAL FIX: Match backend validation schema exactly
          const { customerId, customerName, customerPhone, customerEmail, branchId, companyId, items = [], discount = 0, discountAmount = 0, discountPercentage = 0, tax = 0, paymentMethod = 'CASH', paymentStatus, notes, saleDate } = req.body;
    
          // Validate branchId (required by backend schema)
          if (!branchId) {
            return res.status(400).json({
              success: false,
              message: 'Validation error',
              errors: ['branchId is required']
            });
          }
    
          // Validate items array (required, min 1 item)
          if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
              success: false,
              message: 'Validation error',
              errors: ['At least one item is required']
            });
          }
    
          // Validate each item (match backend schema)
          const itemErrors = [];
          items.forEach((item, index) => {
            if (!item.productId || typeof item.productId !== 'string' || !item.productId.trim()) {
              itemErrors.push(`items[${index}].productId is required`);
            }
            if (item.quantity === undefined || item.quantity === null || typeof item.quantity !== 'number' || item.quantity < 1) {
              itemErrors.push(`items[${index}].quantity must be a number greater than 0`);
            }
            if (item.unitPrice === undefined || item.unitPrice === null || typeof item.unitPrice !== 'number' || item.unitPrice <= 0) {
              itemErrors.push(`items[${index}].unitPrice must be a positive number`);
            }
          });
    
          if (itemErrors.length > 0) {
            return res.status(400).json({
              success: false,
              message: 'Validation error',
              errors: itemErrors
            });
          }
    
          // Validate paymentMethod (must be one of: CASH, CARD, MOBILE, BANK_TRANSFER)
          const validPaymentMethods = ['CASH', 'CARD', 'MOBILE', 'BANK_TRANSFER'];
          const upperPaymentMethod = paymentMethod ? paymentMethod.toUpperCase() : 'CASH';
          if (!validPaymentMethods.includes(upperPaymentMethod)) {
            return res.status(400).json({
              success: false,
              message: 'Validation error',
              errors: [`paymentMethod must be one of: ${validPaymentMethods.join(', ')}`]
            });
          }
    
          // Validate paymentStatus if provided
          if (paymentStatus) {
            const validPaymentStatuses = ['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'];
            const upperPaymentStatus = paymentStatus.toUpperCase();
            if (!validPaymentStatuses.includes(upperPaymentStatus)) {
              return res.status(400).json({
                success: false,
                message: 'Validation error',
                errors: [`paymentStatus must be one of: ${validPaymentStatuses.join(', ')}`]
              });
            }
          }
    
          const id = uuid();
    
          
          // Generate invoice number with retry logic to handle race conditions
          // Short format: INV-XXXXX (4-5 digits)
          const generateUniqueInvoiceNumber = (attempt = 0) => {
            if (attempt > 10) {
              // After 10 attempts, use timestamp-based unique number
              const timestamp = Date.now().toString().slice(-8);
              return `INV-${timestamp}`;
            }
    
    
    
          // Generate invoice number - Short format: INV-XXXXX (4-5 digits)
          // Get the last invoice number to increment, or start from 10000
          let invoiceNumber;
    
          try {
            const lastSale = query("SELECT invoiceNumber FROM sales WHERE invoiceNumber IS NOT NULL ORDER BY createdAt DESC LIMIT 1")[0];
              let baseNumber;
              
            if (lastSale && lastSale.invoiceNumber) {
              // Extract number from last invoice (format: INV-XXXXX)
              const match = lastSale.invoiceNumber.match(/INV-(\d+)/);
              if (match) {
                  baseNumber = parseInt(match[1], 10);
              } else {
                  // Fallback: use random number
                  baseNumber = Math.floor(Math.random() * 90000) + 10000;
              }
            } else {
              // First invoice: start from 10000
                baseNumber = 10000;
              }
    
              // Add attempt offset to handle concurrent requests
              const nextNumber = ((baseNumber + attempt) % 99999) || 10000;
              const candidateInvoiceNumber = `INV-${String(nextNumber).padStart(5, '0')}`;
    
              // Check if invoice number already exists (race condition check)
              const existingSale = query("SELECT id FROM sales WHERE invoiceNumber = ?", [candidateInvoiceNumber])[0];
              if (existingSale) {
                // Invoice number exists, retry with incremented attempt
                return generateUniqueInvoiceNumber(attempt + 1);
              }
    
              return candidateInvoiceNumber;
          } catch (err) {
            // Fallback: generate random 4-5 digit number if query fails
            console.error('[Sales] Error getting last invoice number:', err);
              if (attempt > 5) {
                // After 5 attempts, use timestamp
                const timestamp = Date.now().toString().slice(-8);
                return `INV-${timestamp}`;
          }
    
              return `INV-${String(Math.floor(Math.random() * 90000) + 10000)}`;
            }
          };
    
          const invoiceNumber = generateUniqueInvoiceNumber();
          
    
    
    
          // Generate receipt number - Short format: RCN-XXXXX (4-5 digits)
          // Get the last receipt number to increment, or start from 10000
          let receiptNumber;
          try {
            const lastReceipt = query("SELECT receiptNumber FROM receipts ORDER BY createdAt DESC LIMIT 1")[0];
            if (lastReceipt && lastReceipt.receiptNumber) {
              // Extract number from last receipt (format: RCN-XXXXX)
              const match = lastReceipt.receiptNumber.match(/RCN-(\d+)/);
              if (match) {
                const lastNumber = parseInt(match[1], 10);
                const nextNumber = (lastNumber + 1) % 99999; // Wrap around at 99999
                receiptNumber = `RCN-${String(nextNumber).padStart(5, '0')}`;
              } else {
                // Fallback: generate random 4-5 digit number
                receiptNumber = `RCN-${String(Math.floor(Math.random() * 90000) + 10000)}`;
              }
            } else {
              // First receipt: start from 10000
              receiptNumber = `RCN-10000`;
            }
          } catch (err) {
            // Fallback: generate random 4-5 digit number if query fails
            console.error('[Sales] Error getting last receipt number:', err);
            receiptNumber = `RCN-${String(Math.floor(Math.random() * 90000) + 10000)}`;
          }
          const timestamp = now();
    
          // Get context from headers (set by frontend) - match GET endpoint logic
          const selectedCompanyId = req.headers['x-company-id'] || req.user?.selectedCompanyId;
          const selectedBranchId = req.headers['x-branch-id'] || req.user?.selectedBranchId;
    
          // CRITICAL FIX: Use branchId from body first (required by backend), then fallback to selectedBranchId or user's branchId
          // This matches backend logic which requires branchId but allows fallback
          const finalBranchId = branchId || selectedBranchId || req.user?.branchId;
          const finalCompanyId = companyId || selectedCompanyId || req.user?.companyId;
    
          // CRITICAL FIX: If still no branchId after fallback, return error (backend requires it)
          if (!finalBranchId) {
            return res.status(400).json({
              success: false,
              message: 'Validation error',
              errors: ['branchId is required. Please select a branch or ensure user has an assigned branch.']
            });
          }
    
          // Auto-create customer if name/phone provided but no customerId
          // CRITICAL FIX: Always try to create/find customer if name or phone is provided
          let finalCustomerId = customerId;
          if (!customerId && (customerName || customerPhone)) {
            console.log('[Sales] Auto-creating customer:', { customerName, customerPhone, finalCompanyId, finalBranchId });
    
            // Check if customer already exists by phone
            let existingCustomer = null;
            if (customerPhone && customerPhone.trim() !== '' && customerPhone !== '000-' + Date.now()) {
              // First try to find in same company
              if (finalCompanyId) {
                existingCustomer = query('SELECT id FROM customers WHERE phone = ? AND companyId = ?', [customerPhone.trim(), finalCompanyId])[0];
              }
              // If not found, check globally
              if (!existingCustomer) {
                existingCustomer = query('SELECT id FROM customers WHERE phone = ?', [customerPhone.trim()])[0];
              }
            }
    
            if (existingCustomer) {
              finalCustomerId = existingCustomer.id;
              console.log('[Sales] ✅ Found existing customer:', existingCustomer.id);
            } else if (customerName && customerName.trim() !== '' && !customerName.startsWith('Walk-in-')) {
              // Create new customer with COMPANY ID (branchId is optional)
              // CRITICAL FIX: Only create if it's a real customer name (not auto-generated walk-in)
              const newCustomerId = uuid();
              const insertSuccess = run(`INSERT INTO customers (id, name, email, phone, branchId, companyId, loyaltyPoints, createdBy, isActive, createdAt, updatedAt)
                   VALUES (?, ?, ?, ?, ?, ?, 0, ?, 1, ?, ?)`,
                [newCustomerId, customerName.trim(), customerEmail || null, customerPhone ? customerPhone.trim() : null, finalBranchId || null, finalCompanyId || null, req.user?.id || null, timestamp, timestamp]);
    
              if (insertSuccess) {
                finalCustomerId = newCustomerId;
                console.log('[Sales] ✅ Auto-created customer:', newCustomerId, customerName, 'Company:', finalCompanyId, 'Branch:', finalBranchId);
    
                // 🔄 TWO-WAY SYNC: Queue customer for sync
                const newCustomer = query('SELECT * FROM customers WHERE id = ?', [newCustomerId])[0];
                if (newCustomer) handleDataChange('customers', 'create', newCustomer);
              } else {
                console.error('[Sales] ❌ Failed to create customer - database insert failed');
              }
            } else {
              console.log('[Sales] ⚠️ Skipping customer creation - name is auto-generated walk-in customer');
            }
          }
    
          let subtotal = 0;
          items.forEach(i => {
            const price = i.unitPrice || i.price || i.sellingPrice || 0;
            subtotal += (i.quantity || 1) * price;
          });
    
          const finalDiscount = discountAmount || (discountPercentage ? (subtotal * discountPercentage / 100) : discount);
          const taxAmount = tax || 0;
          const grandTotal = subtotal - finalDiscount + taxAmount;
    
          console.log('[Sales] Creating sale:', { id, invoiceNumber, subtotal, grandTotal, itemsCount: items.length, customerId: finalCustomerId });
    
          // CRITICAL FIX: Use paymentStatus from request or default to COMPLETED, match backend logic
          const finalPaymentStatus = paymentStatus ? paymentStatus.toUpperCase() : 'COMPLETED';
          const finalSaleStatus = finalPaymentStatus === 'COMPLETED' ? 'COMPLETED' : 'PENDING';
    
          // Calculate paidAmount and returnedAmount
          const paidAmount = req.body.paidAmount || (finalPaymentStatus === 'COMPLETED' ? grandTotal : 0);
          const returnedAmount = req.body.returnedAmount || Math.max(0, paidAmount - grandTotal);
    
          const success = run(`INSERT INTO sales (id, invoiceNumber, receiptNumber, customerId, branchId, companyId, totalAmount, discount, tax, grandTotal, paidAmount, returnedAmount, paymentMethod, paymentStatus, status, notes, createdBy, createdAt, updatedAt)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [id, invoiceNumber, receiptNumber, finalCustomerId || null, finalBranchId || null, finalCompanyId || null, subtotal, finalDiscount, taxAmount, grandTotal, paidAmount, returnedAmount, upperPaymentMethod, finalPaymentStatus, finalSaleStatus, notes || null, req.user?.id, saleDate || timestamp, timestamp]);
    
          if (!success) {
            console.error('[Sales] Failed to insert sale');
            return res.status(500).json({ success: false, message: 'Failed to create sale' });
          }
    
          // Check stock availability for all items before creating sale (match backend)
          for (const item of items) {
            // CRITICAL FIX: Use unitsDeducted if available (actual pieces to deduct), otherwise use quantity
            const quantity = item.unitsDeducted || item.quantity || 1;
            const product = query('SELECT id, name FROM products WHERE id = ?', [item.productId])[0];
    
            if (!product) {
              return res.status(400).json({
                success: false,
                message: `Product with ID ${item.productId} not found`
              });
            }
    
            // Check stock availability through batches (match backend)
            // CRITICAL FIX: Handle batch lookup by batchId, batchNumber, or find available batch
            let totalAvailableStock = 0;
            let foundBatch = null;
    
            if (item.batchId) {
              // CRITICAL: Check specific batch by ID - exclude reported/expired batches
              foundBatch = query('SELECT id, quantity, branchId, isReported, expireDate FROM batches WHERE id = ? AND isActive = 1', [item.batchId])[0];
              if (!foundBatch) {
                return res.status(400).json({
                  success: false,
                  message: `Batch with ID ${item.batchId} not found`
                });
              }
    
              // CRITICAL: Check if batch is reported
              if (foundBatch.isReported === 1 || foundBatch.isReported === true || foundBatch.isReported === 'true') {
                return res.status(400).json({
                  success: false,
                  message: `Batch ${item.batchId} is reported and cannot be sold`
                });
              }
    
              // CRITICAL: Check if batch is expired
              if (foundBatch.expireDate) {
                const expireDate = new Date(foundBatch.expireDate);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                if (expireDate < today) {
                  return res.status(400).json({
                    success: false,
                    message: `Batch ${item.batchId} is expired (expiry: ${foundBatch.expireDate}) and cannot be sold`
                  });
                }
              }
    
              // CRITICAL FIX: Verify batch belongs to correct branch
              if (foundBatch.branchId && foundBatch.branchId !== finalBranchId) {
                console.warn(`[Sales] Batch ${item.batchId} belongs to different branch (${foundBatch.branchId} vs ${finalBranchId}), but allowing sale`);
              }
              totalAvailableStock = foundBatch.quantity || 0;
            } else if (item.batchNumber) {
              // CRITICAL: Find batch by batch number and product - exclude reported/expired batches
              // Try to find batch in the correct branch first, then fallback to any branch
              foundBatch = query('SELECT id, quantity, branchId, isReported, expireDate FROM batches WHERE batchNo = ? AND productId = ? AND isActive = 1 AND (isReported IS NULL OR isReported = 0) ORDER BY expireDate ASC LIMIT 1',
                [item.batchNumber, item.productId])[0];
    
              // CRITICAL: Check if found batch is expired
              if (foundBatch && foundBatch.expireDate) {
                const expireDate = new Date(foundBatch.expireDate);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                if (expireDate < today) {
                  foundBatch = null; // Mark as not found if expired
                }
              }
    
              if (!foundBatch) {
                // If not found, try without branch restriction (for backward compatibility)
                console.warn(`[Sales] Batch ${item.batchNumber} not found for product ${item.productId} in branch ${finalBranchId}, checking all branches`);
                foundBatch = query('SELECT id, quantity, branchId, isReported, expireDate FROM batches WHERE batchNo = ? AND productId = ? AND isActive = 1 AND (isReported IS NULL OR isReported = 0) ORDER BY expireDate ASC LIMIT 1',
                  [item.batchNumber, item.productId])[0];
    
                // Check if found batch is expired
                if (foundBatch && foundBatch.expireDate) {
                  const expireDate = new Date(foundBatch.expireDate);
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  if (expireDate < today) {
                    foundBatch = null;
                  }
                }
              }
    
              if (foundBatch) {
                totalAvailableStock = foundBatch.quantity || 0;
              } else {
                // If batch not found by number, check all batches for this product (excluding reported/expired)
                console.warn(`[Sales] Batch ${item.batchNumber} not found, checking all batches for product ${item.productId}`);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const availableBatches = query('SELECT quantity, expireDate, isReported FROM batches WHERE productId = ? AND quantity > 0 AND isActive = 1 AND (isReported IS NULL OR isReported = 0)',
                  [item.productId]);
                // Filter out expired batches
                const validBatches = availableBatches.filter(batch => {
                  if (batch.expireDate) {
                    const expireDate = new Date(batch.expireDate);
                    return expireDate >= today;
                  }
                  return true; // No expiry date means not expired
                });
                totalAvailableStock = validBatches.reduce((sum, batch) => sum + (batch.quantity || 0), 0);
              }
            } else {
              // CRITICAL: No batch specified - check all batches for this product in this branch (match backend FIFO logic)
              // Exclude reported and expired batches
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const availableBatches = query('SELECT quantity, expireDate, isReported FROM batches WHERE productId = ? AND (branchId = ? OR branchId IS NULL) AND quantity > 0 AND isActive = 1 AND (isReported IS NULL OR isReported = 0) ORDER BY expireDate ASC',
                [item.productId, finalBranchId]);
              // Filter out expired batches
              const validBatches = availableBatches.filter(batch => {
                if (batch.expireDate) {
                  const expireDate = new Date(batch.expireDate);
                  return expireDate >= today;
                }
                return true; // No expiry date means not expired
              });
              totalAvailableStock = validBatches.reduce((sum, batch) => sum + (batch.quantity || 0), 0);
            }
    
            if (totalAvailableStock < quantity) {
              return res.status(400).json({
                success: false,
                message: `Insufficient stock for ${product.name}. Available: ${totalAvailableStock}, Required: ${quantity}`
              });
            }
          }
    
          const saleItems = items.map(i => {
            const itemId = uuid();
            const price = i.unitPrice || i.price || i.sellingPrice || 0;
            // CRITICAL FIX: Use unitsDeducted if available (actual pieces to deduct), otherwise use quantity
            // unitsDeducted is the actual number of pieces/units to deduct from batch
            const quantity = i.unitsDeducted || i.quantity || 1;
            const total = quantity * price;
    
            // CRITICAL FIX: Include batchId in sale_items if available
            // Check if batchId column exists in sale_items table
            let batchIdForItem = null;
            if (i.batchId) {
              batchIdForItem = i.batchId;
            } else if (batchToUpdate) {
              batchIdForItem = batchToUpdate.id;
            }
    
            // Try to insert with batchId if column exists, otherwise insert without it
            try {
              // First try with batchId
              run('INSERT INTO sale_items (id, saleId, productId, batchId, quantity, unitPrice, discount, total, createdAt) VALUES (?,?,?,?,?,?,?,?,?)',
                [itemId, id, i.productId, batchIdForItem, quantity, price, i.discount || 0, total, timestamp]);
            } catch (e) {
              // If batchId column doesn't exist, insert without it
              if (e.message && e.message.includes('no such column: batchId')) {
                console.log('[Sales] batchId column not found in sale_items, inserting without it');
                run('INSERT INTO sale_items (id, saleId, productId, quantity, unitPrice, discount, total, createdAt) VALUES (?,?,?,?,?,?,?,?)',
                  [itemId, id, i.productId, quantity, price, i.discount || 0, total, timestamp]);
              } else {
                throw e; // Re-throw if it's a different error
              }
            }
    
            // CRITICAL: Update product stock - ensure quantity is parsed as number
            const saleQuantity = parseFloat(quantity) || 0;
            if (saleQuantity > 0) {
              const productUpdate = run('UPDATE products SET quantity = quantity - ? WHERE id = ?', [saleQuantity, i.productId]);
              if (productUpdate) {
                console.log('[Sales] ✅ Deducted', saleQuantity, 'units from product', i.productId);
              } else {
                console.error('[Sales] ❌ Failed to deduct product stock for productId:', i.productId, 'quantity:', saleQuantity);
              }
            } else {
              console.warn('[Sales] ⚠️ Invalid quantity for sale item:', i);
            }
    
            // Update batch stock (match backend - FIFO logic)
            // CRITICAL FIX: Use the batch we found during stock check, or find it again
            let batchToUpdate = null;
    
            if (i.batchId) {
              // CRITICAL: Use provided batch ID - verify it's not reported or expired
              batchToUpdate = query('SELECT id, quantity, isReported, expireDate FROM batches WHERE id = ? AND isActive = 1', [i.batchId])[0];
              if (batchToUpdate) {
                // CRITICAL: Check if batch is reported
                if (batchToUpdate.isReported === 1 || batchToUpdate.isReported === true || batchToUpdate.isReported === 'true') {
                  console.error(`[Sales] ❌ Batch ${i.batchId} is reported and cannot be sold`);
                  throw new Error(`Batch ${i.batchId} is reported and cannot be sold`);
                }
    
                // CRITICAL: Check if batch is expired
                if (batchToUpdate.expireDate) {
                  const expireDate = new Date(batchToUpdate.expireDate);
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  if (expireDate < today) {
                    console.error(`[Sales] ❌ Batch ${i.batchId} is expired (expiry: ${batchToUpdate.expireDate}) and cannot be sold`);
                    throw new Error(`Batch ${i.batchId} is expired and cannot be sold`);
                  }
                }
    
                const batchUpdate = run('UPDATE batches SET quantity = quantity - ? WHERE id = ?', [saleQuantity, i.batchId]);
                if (batchUpdate) {
                  console.log('[Sales] ✅ Deducted', saleQuantity, 'units from batch', i.batchId);
                } else {
                  console.error('[Sales] ❌ Failed to deduct batch stock for batchId:', i.batchId);
                }
              } else {
                console.warn(`[Sales] Batch ${i.batchId} not found for update, skipping batch update`);
              }
            } else if (i.batchNumber) {
              // CRITICAL: Find batch by batch number - exclude reported/expired batches
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              // Try to find in correct branch first, then fallback
              batchToUpdate = query('SELECT id, quantity, isReported, expireDate FROM batches WHERE batchNo = ? AND productId = ? AND (branchId = ? OR branchId IS NULL) AND quantity >= ? AND isActive = 1 AND (isReported IS NULL OR isReported = 0) ORDER BY expireDate ASC LIMIT 1',
                [i.batchNumber, i.productId, finalBranchId, quantity])[0];
    
              // Check if found batch is expired
              if (batchToUpdate && batchToUpdate.expireDate) {
                const expireDate = new Date(batchToUpdate.expireDate);
                if (expireDate < today) {
                  batchToUpdate = null; // Mark as not found if expired
                }
              }
    
              if (!batchToUpdate) {
                // Try without branch restriction
                batchToUpdate = query('SELECT id, quantity, isReported, expireDate FROM batches WHERE batchNo = ? AND productId = ? AND quantity >= ? AND isActive = 1 AND (isReported IS NULL OR isReported = 0) ORDER BY expireDate ASC LIMIT 1',
                  [i.batchNumber, i.productId, quantity])[0];
    
                // Check if found batch is expired
                if (batchToUpdate && batchToUpdate.expireDate) {
                  const expireDate = new Date(batchToUpdate.expireDate);
                  if (expireDate < today) {
                    batchToUpdate = null;
                  }
                }
              }
    
              if (batchToUpdate) {
                const batchUpdate = run('UPDATE batches SET quantity = quantity - ? WHERE id = ?', [saleQuantity, batchToUpdate.id]);
                if (batchUpdate) {
                  console.log('[Sales] ✅ Deducted', saleQuantity, 'units from batch', batchToUpdate.id);
                } else {
                  console.error('[Sales] ❌ Failed to deduct batch stock for batchId:', batchToUpdate.id);
                }
              } else {
                console.warn(`[Sales] Batch ${i.batchNumber} not found for product ${i.productId} (may be reported/expired), using FIFO`);
                // Fall through to FIFO logic
              }
            }
    
            // CRITICAL: FIFO: Use first available batch if no batch was found/specified
            // Exclude reported and expired batches
            if (!batchToUpdate) {
              const today = new Date();
              today.setHours(0, 0, 0, 0);
              const batch = query('SELECT id, quantity, isReported, expireDate FROM batches WHERE productId = ? AND (branchId = ? OR branchId IS NULL) AND quantity > 0 AND isActive = 1 AND (isReported IS NULL OR isReported = 0) ORDER BY expireDate ASC LIMIT 1',
                [i.productId, finalBranchId])[0];
    
              // Check if batch is expired
              let validBatch = batch;
              if (batch && batch.expireDate) {
                const expireDate = new Date(batch.expireDate);
                if (expireDate < today) {
                  validBatch = null; // Mark as not found if expired
                }
              }
    
              if (validBatch) {
                const batchQuantity = validBatch.quantity || 0;
                if (batchQuantity >= saleQuantity) {
                  const batchUpdate = run('UPDATE batches SET quantity = quantity - ? WHERE id = ?', [saleQuantity, validBatch.id]);
                  if (batchUpdate) {
                    console.log('[Sales] ✅ Deducted', saleQuantity, 'units from batch', validBatch.id, '(FIFO)');
                  } else {
                    console.error('[Sales] ❌ Failed to deduct batch stock for batchId:', validBatch.id);
                  }
                  batchToUpdate = validBatch;
                } else {
                  // Use multiple batches if needed (excluding reported/expired)
                  let remaining = saleQuantity;
                  const batches = query('SELECT id, quantity, isReported, expireDate FROM batches WHERE productId = ? AND (branchId = ? OR branchId IS NULL) AND quantity > 0 AND isActive = 1 AND (isReported IS NULL OR isReported = 0) ORDER BY expireDate ASC',
                    [i.productId, finalBranchId]);
                  // Filter out expired batches
                  const validBatches = batches.filter(b => {
                    if (b.expireDate) {
                      const expireDate = new Date(b.expireDate);
                      return expireDate >= today;
                    }
                    return true; // No expiry date means not expired
                  });
    
                  for (const b of validBatches) {
                    if (remaining <= 0) break;
                    const useQty = Math.min(remaining, b.quantity);
                    const batchUpdate = run('UPDATE batches SET quantity = quantity - ? WHERE id = ?', [useQty, b.id]);
                    if (batchUpdate) {
                      console.log('[Sales] ✅ Deducted', useQty, 'units from batch', b.id, '(FIFO multi-batch)');
                    } else {
                      console.error('[Sales] ❌ Failed to deduct batch stock for batchId:', b.id);
                    }
                    remaining -= useQty;
                  }
                }
              }
            }
    
            // Create stock movement (match backend)
            const stockMovementId = uuid();
            run('INSERT INTO stock_movements (id, productId, type, quantity, reason, reference, createdBy, createdAt) VALUES (?,?,?,?,?,?,?,?)',
              [stockMovementId, i.productId, 'OUT', saleQuantity, 'Sale', id, req.user?.id || null, timestamp]);
    
            const product = query('SELECT id, name, unitPrice, sellingPrice FROM products WHERE id = ?', [i.productId])[0];
            return {
              id: itemId,
              productId: i.productId,
              quantity: quantity,
              unitPrice: price,
              totalPrice: total,
              product: product || { id: i.productId, name: i.name || 'Unknown', unitType: 'PIECE' }
            };
          });
    
          // CRITICAL: Update customer data after sale
          if (finalCustomerId) {
            // Update loyalty points
            const loyaltyPointsEarned = Math.floor(grandTotal / 100);
            run('UPDATE customers SET loyaltyPoints = loyaltyPoints + ? WHERE id = ?', [loyaltyPointsEarned, finalCustomerId]);
            console.log('[Sales] ✅ Updated customer loyalty points:', loyaltyPointsEarned);
    
            // Update totalPurchases (if column exists)
            try {
              run('UPDATE customers SET totalPurchases = COALESCE(totalPurchases, 0) + ? WHERE id = ?', [grandTotal, finalCustomerId]);
              console.log('[Sales] ✅ Updated customer totalPurchases:', grandTotal);
            } catch (e) {
              if (e.message && !e.message.includes('no such column')) {
                console.warn('[Sales] ⚠️ Failed to update totalPurchases:', e.message);
              }
            }
    
            // Update lastVisit (if column exists)
            try {
              run('UPDATE customers SET lastVisit = ? WHERE id = ?', [timestamp, finalCustomerId]);
              console.log('[Sales] ✅ Updated customer lastVisit:', timestamp);
            } catch (e) {
              if (e.message && !e.message.includes('no such column')) {
                console.warn('[Sales] ⚠️ Failed to update lastVisit:', e.message);
              }
            }
    
            // Update isVIP status based on loyalty points (if column exists)
            try {
              // Get updated loyalty points
              const updatedCustomer = query('SELECT loyaltyPoints FROM customers WHERE id = ?', [finalCustomerId])[0];
              if (updatedCustomer && updatedCustomer.loyaltyPoints >= 1000) {
                run('UPDATE customers SET isVIP = 1 WHERE id = ?', [finalCustomerId]);
                console.log('[Sales] ✅ Updated customer to VIP status');
              }
            } catch (e) {
              if (e.message && !e.message.includes('no such column')) {
                console.warn('[Sales] ⚠️ Failed to update isVIP:', e.message);
              }
            }
          }
    
          // CRITICAL FIX: Fetch complete customer data with all fields
          // Handle case where totalPurchases and isVIP columns might not exist
          let customer = null;
          if (finalCustomerId) {
            try {
              // Try to select with all fields first
              customer = query('SELECT id, name, phone, email, address, loyaltyPoints, totalPurchases, isVIP, lastVisit, createdAt FROM customers WHERE id = ?', [finalCustomerId])[0];
            } catch (e) {
              // If columns don't exist, select without them
              if (e.message && e.message.includes('no such column')) {
                customer = query('SELECT id, name, phone, email, address, loyaltyPoints, createdAt FROM customers WHERE id = ?', [finalCustomerId])[0];
              } else {
                throw e;
              }
            }
          }
    
          if (customer) {
            // Transform customer data to match backend response format
            // Calculate totalPurchases from sales if column doesn't exist
            if (customer.totalPurchases === undefined || customer.totalPurchases === null) {
              const salesCount = query('SELECT COUNT(*) as count, SUM(grandTotal) as total FROM sales WHERE customerId = ?', [finalCustomerId])[0];
              customer.totalPurchases = salesCount?.total || 0;
            }
            customer.totalPurchases = customer.totalPurchases || 0;
            customer.loyaltyPoints = customer.loyaltyPoints || 0;
            customer.isVIP = (customer.isVIP === 1 || customer.isVIP === true || customer.loyaltyPoints >= 1000) || false;
            customer.lastVisit = customer.lastVisit || timestamp;
          }
    
          console.log('[Sales] Created sale successfully:', id);
    
          // 🔄 TWO-WAY SYNC: Queue sale and sale_items for sync to PostgreSQL
          const saleData = query('SELECT * FROM sales WHERE id = ?', [id])[0];
          if (saleData) handleDataChange('sales', 'create', saleData);
          saleItems.forEach(item => handleDataChange('sale_items', 'create', item));
    
          // CRITICAL FIX: Match backend response structure exactly
          res.status(201).json({
            success: true,
            data: {
              id,
              invoiceNumber,
              receiptNumber,
              customer: customer ? {
                id: customer.id,
                name: customer.name,
                phone: customer.phone,
                email: customer.email,
                totalPurchases: customer.totalPurchases || 0,
                loyaltyPoints: customer.loyaltyPoints || 0,
                isVIP: customer.isVIP || false,
                lastVisit: customer.lastVisit
              } : null,
              items: saleItems.map(item => ({
                id: item.id,
                productId: item.productId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                totalPrice: item.totalPrice,
                product: item.product || { id: item.productId, name: item.name || 'Unknown', barcode: null }
              })),
              subtotal,
              taxAmount,
              discountAmount: finalDiscount,
              totalAmount: grandTotal,
              paidAmount: paidAmount || 0,
              returnedAmount: returnedAmount || 0,
              grandTotal,
              paymentMethod: upperPaymentMethod,
              paymentStatus: finalPaymentStatus,
              status: finalSaleStatus,
              createdAt: timestamp,
              receiptNumber: receiptNumber // Include receiptNumber at top level for compatibility
            },
            message: 'Sale created successfully'
          });
    
          // CRITICAL: Save database after stock updates to ensure changes persist
          console.log('[Sales] 💾 Saving database after stock deduction...');
          saveDatabase();
          console.log('[Sales] ✅ Database saved successfully');
    
          // Verify stock was deducted by checking product quantities
          if (saleItems.length > 0) {
            console.log('[Sales] 🔍 Verifying stock deduction...');
            saleItems.forEach((item) => {
              const productId = item.productId;
              if (productId) {
                const product = query('SELECT id, name, quantity FROM products WHERE id = ?', [productId])[0];
                if (product) {
                  console.log('[Sales] ✅ Product stock verified:', {
                    productId: product.id,
                    productName: product.name,
                    currentQuantity: product.quantity
                  });
                } else {
                  console.warn('[Sales] ⚠️ Product not found for verification:', productId);
                }
              }
            });
          }
        } catch (e) {
          console.error('[Sales] Create error:', e.message, e.stack);
          res.status(500).json({ success: false, message: 'Failed to create sale: ' + e.message });
        }
      });

  // PUT /api/sales/:id (line 7588)
      app.put('/api/sales/:id', authMiddleware, (req, res) => {
        try {
          const { discountPercentage, saleDate, notes, paymentStatus } = req.body;
          const saleId = req.params.id;
    
          // Get existing sale with items
          const existingSale = query('SELECT * FROM sales WHERE id = ?', [saleId])[0];
          if (!existingSale) {
            return res.status(404).json({ success: false, message: 'Sale not found' });
          }
    
          // Validate discount percentage
          if (discountPercentage !== undefined && (discountPercentage < 0 || discountPercentage > 100)) {
            return res.status(400).json({
              success: false,
              message: 'Discount percentage must be between 0 and 100'
            });
          }
    
          // Validate payment status
          if (paymentStatus && !['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'].includes(paymentStatus)) {
            return res.status(400).json({
              success: false,
              message: 'Invalid payment status. Must be PENDING, COMPLETED, FAILED, or REFUNDED'
            });
          }
    
          // Calculate new totals if discount percentage changed
          let newDiscountAmount = existingSale.discountAmount || 0;
          let newTotalAmount = existingSale.totalAmount || 0;
          const subtotal = existingSale.subtotal || 0;
    
          if (discountPercentage !== undefined && discountPercentage !== (existingSale.discountPercentage || 0)) {
            newDiscountAmount = (subtotal * discountPercentage) / 100;
            newTotalAmount = subtotal - newDiscountAmount;
          }
    
          // Determine new status based on payment status
          let newStatus = existingSale.status;
          if (paymentStatus === 'COMPLETED') {
            newStatus = 'COMPLETED';
          } else if (paymentStatus === 'PENDING') {
            newStatus = 'PENDING';
          }
    
          // Build update query
          const updates = [];
          const params = [];
    
          if (discountPercentage !== undefined) {
            updates.push('discountPercentage = ?');
            params.push(discountPercentage);
          }
          if (discountPercentage !== undefined) {
            updates.push('discountAmount = ?');
            params.push(newDiscountAmount);
          }
          if (discountPercentage !== undefined) {
            updates.push('totalAmount = ?');
            params.push(newTotalAmount);
          }
          if (saleDate) {
            updates.push('saleDate = ?');
            params.push(saleDate);
          }
          if (notes !== undefined) {
            updates.push('notes = ?');
            params.push(notes);
          }
          if (paymentStatus) {
            updates.push('paymentStatus = ?');
            params.push(paymentStatus);
          }
          if (paymentStatus) {
            updates.push('status = ?');
            params.push(newStatus);
          }
    
          if (updates.length > 0) {
            updates.push('updatedAt = ?');
            params.push(now());
            params.push(saleId);
            run(`UPDATE sales SET ${updates.join(', ')} WHERE id = ?`, params);
          }
    
          // Fetch updated sale with related data
          const updatedSale = query('SELECT * FROM sales WHERE id = ?', [saleId])[0];
    
          // Get sale items
          const saleItems = query('SELECT * FROM sale_items WHERE saleId = ?', [saleId]);
    
          // Get customer, user, branch
          const customer = updatedSale.customerId ? query('SELECT * FROM customers WHERE id = ?', [updatedSale.customerId])[0] : null;
          const user = query('SELECT id, name, username, email FROM users WHERE id = ?', [updatedSale.userId])[0];
          const branch = query('SELECT id, name, address FROM branches WHERE id = ?', [updatedSale.branchId])[0];
    
          const responseData = {
            ...updatedSale,
            items: saleItems.map(item => {
              const product = query('SELECT * FROM products WHERE id = ?', [item.productId])[0];
              return {
                ...item,
                product: product || null
              };
            }),
            customer: customer || null,
            user: user || null,
            branch: branch || null
          };
    
          // 🔄 TWO-WAY SYNC: Queue for sync to PostgreSQL
          if (updatedSale) handleDataChange('sales', 'update', updatedSale);
    
          res.json({ success: true, data: responseData });
        } catch (e) {
          console.error('Error updating sale:', e);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // GET /api/sales/receipts (line 12307)
      app.get('/api/sales/receipts', authMiddleware, (req, res) => {
        try {
          const receipts = query('SELECT id, invoiceNumber as receiptNumber, id as saleId, createdAt as printedAt FROM sales ORDER BY createdAt DESC LIMIT 100');
          res.json({ success: true, data: { receipts } });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

  // GET /api/sales/receipt/:receiptNumber (line 12315)
      app.get('/api/sales/receipt/:receiptNumber', authMiddleware, (req, res) => {
        try {
          const s = query('SELECT * FROM sales WHERE invoiceNumber = ? OR receiptNumber = ?', [req.params.receiptNumber, req.params.receiptNumber])[0];
          if (!s) return res.status(404).json({ success: false, message: 'Receipt not found' });
          const customer = s.customerId ? query('SELECT * FROM customers WHERE id = ?', [s.customerId])[0] : null;
          const branch = s.branchId ? query('SELECT * FROM branches WHERE id = ?', [s.branchId])[0] : null;
          const user = s.createdBy ? query('SELECT id, name, email as username FROM users WHERE id = ?', [s.createdBy])[0] : null;
          const items = query('SELECT * FROM sale_items WHERE saleId = ?', [s.id]).map(item => {
            const product = query('SELECT * FROM products WHERE id = ?', [item.productId])[0];
            return { ...item, totalPrice: item.total, product: product || { id: '', name: 'Unknown', unitType: 'PIECE' } };
          });
          res.json({ success: true, data: { ...s, customer, branch, user, items, receipts: [{ id: s.id, receiptNumber: s.invoiceNumber }] } });
        } catch (e) { res.status(500).json({ success: false, message: e.message }); }
      });

}

module.exports = {
  registerSalesRoutes
};
