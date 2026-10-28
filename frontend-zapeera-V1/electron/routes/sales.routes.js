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
          saveDatabase, initDatabase, cloudApi } = deps;

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
          // FIX 2026-10-28 (Invoices date filter): the old `createdAt <=
          // '2026-10-28'` excluded the whole end day. Match the cloud
          // (end-of-day 23:59:59.999): include everything before the next
          // day, so a sale on the end date appears.
          if (endDate) {
            const end = new Date(String(endDate) + 'T00:00:00Z');
            if (!isNaN(end.getTime())) {
              end.setUTCDate(end.getUTCDate() + 1);
              sql += ' AND createdAt < ?'; params.push(end.toISOString().slice(0, 10));
            } else {
              sql += ' AND createdAt <= ?'; params.push(endDate);
            }
          }
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
              // Money truth differs by creation path (see RC-D2): cloud-pulled
              // sales carry the real total in totalAmount and grandTotal is 0
              // (the cloud never sets it); desktop-made sales store the real
              // total in grandTotal and totalAmount holds the subtotal.
              // Prefer grandTotal when set, else totalAmount — so pulled sales
              // show their real amount and desktop-made sales keep theirs.
              totalAmount: s.grandTotal || s.totalAmount,
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
      app.post('/api/sales', authMiddleware, async (req, res) => {
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
            // QA fix 2026-10-20 (Agent B2, B-9): item.unitPrice is NO LONGER
            // validated or used — prices are resolved from the database
            // (batch/product selling price) in the resolution phase below,
            // mirroring the web backend's server-side pricing rule. A
            // client-sent unitPrice is ignored entirely.
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
    
          // ============================================================
          // R2 (2026-10-26): cloud-authoritative pre-check. When this
          // terminal is online, ask the cloud whether the live batches
          // cover every line BEFORE deducting locally — the other
          // counter may have sold the same stock seconds ago and the
          // local copy may not know yet (5s pull). A shortfall is
          // refused with the same message shape as the local stock
          // check below, so the POS shows the same "Insufficient
          // stock" error. FAIL-OPEN by design: offline, unreachable,
          // or any precheck error sells from local stock exactly as
          // before — the R1 server replay + R3 review list are the
          // backstop, and a blocked sale must never strand a cashier
          // because the cloud hiccuped.
          // ============================================================
          if (finalCompanyId && typeof getIsOnline === 'function' && getIsOnline() && cloudApi && typeof cloudApi.precheckSale === 'function') {
            try {
              const precheck = await cloudApi.precheckSale({
                businessId: finalCompanyId,
                branchId: finalBranchId,
                items: items.map((it) => ({
                  productId: it.productId,
                  batchId: it.batchId || null,
                  quantity: it.quantity,
                  unitsDeducted: it.unitsDeducted || null,
                  unitLevel: it.unitLevel || null,
                  unitsPerBox: it.unitsPerBox || null,
                  variantId: it.variantId || null
                }))
              });
              if (precheck && precheck.success !== false && precheck.data && precheck.data.ok === false) {
                const short = (precheck.data.lines || []).find((l) => !l.ok);
                if (short) {
                  return res.status(400).json({
                    success: false,
                    message: `Insufficient stock for ${short.productName}. Available: ${short.available}, Required: ${short.required}`
                  });
                }
              }
            } catch (precheckError) {
              console.log('[Sales] Precheck skipped (cloud unreachable):', precheckError.message);
            }
          }

          // ============================================================
          // QA fix 2026-10-20 (Agent B2, B-7 + B-9): RESOLUTION PHASE.
          // Everything is validated and priced BEFORE any row is written:
          //  - unit prices come from the DATABASE (the pinned batch's
          //    sellingPrice, else the product's sellingPrice/unitPrice) —
          //    client-sent unitPrice and totals are ignored (B-9), mirroring
          //    the web backend's server-side pricing rule;
          //  - stock availability is checked for every item up front,
          //    reserving batch quantities across items of the same sale;
          //  - each item gets a concrete batch-deduction plan (pinned batch,
          //    batchNumber match, or FEFO/FIFO across the branch's batches).
          // The previous code inserted the sale row FIRST and checked stock
          // afterwards, and its item loop referenced `batchToUpdate` before
          // its `let` declaration (TDZ) — a sale without batchId crashed
          // with a 500 AND left a phantom COMPLETED sale with zero items and
          // no stock movement (B-7).
          // ============================================================
          const isBatchExpired = (expireDate) => {
            if (!expireDate) return false;
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            return new Date(expireDate) < today;
          };
          const isBatchReported = (b) => b.isReported === 1 || b.isReported === true || b.isReported === 'true';
          const reservedByBatch = new Map(); // batchId -> qty reserved by earlier items of this sale
          const reservedOf = (batchId) => reservedByBatch.get(batchId) || 0;
          const resolvedItems = [];

          for (const item of items) {
            // CRITICAL FIX: Use unitsDeducted if available (actual pieces to deduct), otherwise use quantity
            const quantity = item.unitsDeducted || item.quantity || 1;
            const product = query('SELECT id, name, unitPrice, sellingPrice FROM products WHERE id = ?', [item.productId])[0];

            if (!product) {
              return res.status(400).json({
                success: false,
                message: `Product with ID ${item.productId} not found`
              });
            }

            const productPrice = (product.sellingPrice && product.sellingPrice > 0) ? product.sellingPrice : (product.unitPrice || 0);
            let unitPrice = productPrice;
            let primaryBatchId = null;
            let pinned = false;
            const deductions = []; // [{ batchId, qty }]

            if (item.batchId) {
              // Pinned batch by ID — same checks/messages as the previous code.
              const batch = query('SELECT id, productId, quantity, branchId, isReported, expireDate, sellingPrice FROM batches WHERE id = ? AND isActive = 1', [item.batchId])[0];
              if (!batch) {
                return res.status(400).json({
                  success: false,
                  message: `Batch with ID ${item.batchId} not found`
                });
              }
              if (isBatchReported(batch)) {
                return res.status(400).json({
                  success: false,
                  message: `Batch ${item.batchId} is reported and cannot be sold`
                });
              }
              if (isBatchExpired(batch.expireDate)) {
                return res.status(400).json({
                  success: false,
                  message: `Batch ${item.batchId} is expired (expiry: ${batch.expireDate}) and cannot be sold`
                });
              }
              if (batch.branchId && batch.branchId !== finalBranchId) {
                console.warn(`[Sales] Batch ${item.batchId} belongs to different branch (${batch.branchId} vs ${finalBranchId}), but allowing sale`);
              }
              const available = (batch.quantity || 0) - reservedOf(batch.id);
              if (available < quantity) {
                return res.status(400).json({
                  success: false,
                  message: `Insufficient stock for ${product.name}. Available: ${available}, Required: ${quantity}`
                });
              }
              deductions.push({ batchId: batch.id, qty: quantity });
              reservedByBatch.set(batch.id, reservedOf(batch.id) + quantity);
              primaryBatchId = batch.id;
              if (batch.sellingPrice && batch.sellingPrice > 0) unitPrice = batch.sellingPrice;
              pinned = true;
            } else if (item.batchNumber) {
              // Pinned by batch number for this product (FEFO order), as before.
              let batch = query('SELECT id, productId, quantity, branchId, isReported, expireDate, sellingPrice FROM batches WHERE batchNo = ? AND productId = ? AND isActive = 1 AND (isReported IS NULL OR isReported = 0) ORDER BY expireDate ASC LIMIT 1',
                [item.batchNumber, item.productId])[0];
              if (batch && isBatchExpired(batch.expireDate)) batch = null;
              if (batch) {
                const available = (batch.quantity || 0) - reservedOf(batch.id);
                if (available < quantity) {
                  return res.status(400).json({
                    success: false,
                    message: `Insufficient stock for ${product.name}. Available: ${available}, Required: ${quantity}`
                  });
                }
                deductions.push({ batchId: batch.id, qty: quantity });
                reservedByBatch.set(batch.id, reservedOf(batch.id) + quantity);
                primaryBatchId = batch.id;
                if (batch.sellingPrice && batch.sellingPrice > 0) unitPrice = batch.sellingPrice;
                pinned = true;
              }
              // If the number does not resolve, fall through to FIFO below —
              // the same availability fallback the previous code applied.
            }

            if (!pinned) {
              // No pinned batch: FEFO/FIFO across the branch's valid batches
              // (not reported, not expired), exactly the pool the previous
              // code deducted from.
              const candidates = query('SELECT id, quantity, expireDate, sellingPrice FROM batches WHERE productId = ? AND (branchId = ? OR branchId IS NULL) AND quantity > 0 AND isActive = 1 AND (isReported IS NULL OR isReported = 0) ORDER BY expireDate ASC',
                [item.productId, finalBranchId]).filter(b => !isBatchExpired(b.expireDate));
              const totalAvailable = candidates.reduce((sum, b) => sum + Math.max(0, (b.quantity || 0) - reservedOf(b.id)), 0);
              if (totalAvailable < quantity) {
                return res.status(400).json({
                  success: false,
                  message: `Insufficient stock for ${product.name}. Available: ${totalAvailable}, Required: ${quantity}`
                });
              }
              let remaining = quantity;
              for (const b of candidates) {
                if (remaining <= 0) break;
                const free = (b.quantity || 0) - reservedOf(b.id);
                if (free <= 0) continue;
                const take = Math.min(remaining, free);
                deductions.push({ batchId: b.id, qty: take });
                reservedByBatch.set(b.id, reservedOf(b.id) + take);
                if (!primaryBatchId) primaryBatchId = b.id;
                remaining -= take;
              }
            }

            resolvedItems.push({
              productId: item.productId,
              productName: product.name,
              quantity,
              unitPrice,
              discount: item.discount || 0,
              total: quantity * unitPrice,
              batchId: primaryBatchId,
              deductions
            });
          }

          const subtotal = resolvedItems.reduce((sum, r) => sum + r.total, 0);

          const finalDiscount = discountAmount || (discountPercentage ? (subtotal * discountPercentage / 100) : discount);
          const taxAmount = tax || 0;
          const grandTotal = subtotal - finalDiscount + taxAmount;

          console.log('[Sales] Creating sale:', { id, invoiceNumber, subtotal, grandTotal, itemsCount: resolvedItems.length, customerId: finalCustomerId });

          // CRITICAL FIX: Use paymentStatus from request or default to COMPLETED, match backend logic
          const finalPaymentStatus = paymentStatus ? paymentStatus.toUpperCase() : 'COMPLETED';
          const finalSaleStatus = finalPaymentStatus === 'COMPLETED' ? 'COMPLETED' : 'PENDING';

          // Calculate paidAmount and returnedAmount
          const paidAmount = req.body.paidAmount || (finalPaymentStatus === 'COMPLETED' ? grandTotal : 0);
          const returnedAmount = req.body.returnedAmount || Math.max(0, paidAmount - grandTotal);

          // ============================================================
          // APPLY PHASE — all-or-nothing (B-7). The sale row is written
          // only now, after every validation passed. If any write fails,
          // the compensating rollback restores batch/product stock and
          // deletes the partial sale + items, so a failed sale can never
          // leave phantom revenue behind.
          // ============================================================
          const saleItems = [];
          const appliedBatchDeductions = [];
          const appliedProductDeductions = [];
          let saleRowInserted = false;
          try {
            // Register shift (2026-10-27, B5): tie this sale to the
          // cashier's ACTIVE shift on this terminal, resolved from the
          // local staff profile + shifts tables. Null when no shift is
          // open — the sale is still valid, it simply has no shift.
          // The cloud resolves the same way for web sales; the desktop
          // resolves locally because it sells offline. The company
          // lookup prefers the sale's company, and falls back to the
          // caller's single membership when the sale has no company
          // context (a cashier's local user row carries no companyId).
          let saleShiftId = null;
          try {
            let membershipRow = null;
            if (finalCompanyId) {
              membershipRow = query('SELECT id FROM memberships WHERE userId = ? AND businessId = ?', [req.user?.id, finalCompanyId])[0];
            }
            if (!membershipRow) {
              const memberships = query('SELECT id FROM memberships WHERE userId = ?', [req.user?.id]);
              if (memberships.length === 1) membershipRow = memberships[0];
            }
            if (membershipRow) {
              const profileRow = query('SELECT id FROM staff_profiles WHERE membershipId = ?', [membershipRow.id])[0];
              if (profileRow) {
                const activeRow = query("SELECT id FROM shifts WHERE staffProfileId = ? AND status = 'ACTIVE' ORDER BY startTime DESC LIMIT 1", [profileRow.id])[0];
                if (activeRow) saleShiftId = activeRow.id;
              }
            }
          } catch (e) {
            console.log('[Sales] Shift lookup failed, sale proceeds without a shift:', e.message);
          }

          const success = run(`INSERT INTO sales (id, invoiceNumber, receiptNumber, customerId, branchId, companyId, totalAmount, discount, tax, grandTotal, paidAmount, returnedAmount, paymentMethod, paymentStatus, status, notes, createdBy, createdAt, updatedAt, shiftId)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              [id, invoiceNumber, receiptNumber, finalCustomerId || null, finalBranchId || null, finalCompanyId || null, subtotal, finalDiscount, taxAmount, grandTotal, paidAmount, returnedAmount, upperPaymentMethod, finalPaymentStatus, finalSaleStatus, notes || null, req.user?.id, saleDate || timestamp, timestamp, saleShiftId]);

            if (!success) {
              throw new Error('Failed to insert sale');
            }
            saleRowInserted = true;

            for (const r of resolvedItems) {
              const itemId = uuid();
              const itemOk = run('INSERT INTO sale_items (id, saleId, productId, batchId, quantity, unitPrice, discount, total, createdAt) VALUES (?,?,?,?,?,?,?,?,?)',
                [itemId, id, r.productId, r.batchId, r.quantity, r.unitPrice, r.discount, r.total, timestamp]);
              if (!itemOk) throw new Error(`Failed to insert sale item for product ${r.productId}`);

              // Product stock mirror (B-10: products.quantity tracks the stock)
              const productOk = run('UPDATE products SET quantity = quantity - ? WHERE id = ?', [r.quantity, r.productId]);
              if (!productOk) throw new Error(`Failed to deduct product stock for product ${r.productId}`);
              appliedProductDeductions.push({ productId: r.productId, qty: r.quantity });
              console.log('[Sales] ✅ Deducted', r.quantity, 'units from product', r.productId);

              for (const d of r.deductions) {
                const batchOk = run('UPDATE batches SET quantity = quantity - ? WHERE id = ?', [d.qty, d.batchId]);
                if (!batchOk) throw new Error(`Failed to deduct batch stock for batch ${d.batchId}`);
                appliedBatchDeductions.push(d);
                console.log('[Sales] ✅ Deducted', d.qty, 'units from batch', d.batchId);
              }

              // Stock movement. The desktop stock_movements schema uses
              // referenceId/referenceType — the previous insert named a
              // non-existent `reference` column, so movements silently never
              // recorded (run() swallows SQL errors).
              run('INSERT INTO stock_movements (id, productId, type, quantity, reason, referenceId, referenceType, branchId, companyId, createdBy, createdAt) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                [uuid(), r.productId, 'OUT', r.quantity, 'Sale', id, 'SALE', finalBranchId || null, finalCompanyId || null, req.user?.id || null, timestamp]);

              const product = query('SELECT id, name, unitPrice, sellingPrice FROM products WHERE id = ?', [r.productId])[0];
              saleItems.push({
                id: itemId,
                productId: r.productId,
                quantity: r.quantity,
                unitPrice: r.unitPrice,
                totalPrice: r.total,
                product: product || { id: r.productId, name: r.productName || 'Unknown', unitType: 'PIECE' }
              });
            }
          } catch (applyError) {
            console.error('[Sales] ❌ Apply phase failed, rolling back sale', id, '-', applyError.message);
            for (const d of appliedBatchDeductions) {
              run('UPDATE batches SET quantity = quantity + ? WHERE id = ?', [d.qty, d.batchId]);
            }
            for (const d of appliedProductDeductions) {
              run('UPDATE products SET quantity = quantity + ? WHERE id = ?', [d.qty, d.productId]);
            }
            run('DELETE FROM stock_movements WHERE referenceId = ?', [id]);
            run('DELETE FROM sale_items WHERE saleId = ?', [id]);
            if (saleRowInserted) run('DELETE FROM sales WHERE id = ?', [id]);
            saveDatabase();
            return res.status(500).json({ success: false, message: 'Failed to create sale: ' + applyError.message });
          }
    
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
              const salesCount = query('SELECT COUNT(*) as count, SUM(totalAmount) as total FROM sales WHERE customerId = ?', [finalCustomerId])[0];
              customer.totalPurchases = salesCount?.total || 0;
            }
            customer.totalPurchases = customer.totalPurchases || 0;
            customer.loyaltyPoints = customer.loyaltyPoints || 0;
            customer.isVIP = (customer.isVIP === 1 || customer.isVIP === true || customer.loyaltyPoints >= 1000) || false;
            customer.lastVisit = customer.lastVisit || timestamp;
          }
    
          console.log('[Sales] Created sale successfully:', id);
    
          // 🔄 TWO-WAY SYNC: Queue sale and sale_items for sync to PostgreSQL.
          // R1 prerequisite (2026-10-26): enqueue the STORED sale_items
          // rows (SELECT * — saleId + batchId included), NOT the
          // response-shaped objects built above (id/productId/quantity/
          // unitPrice/totalPrice/product, no saleId, no batchId, nested
          // product). The response shape made every saleItem push fail
          // cloud validation (missing required saleId) and left the
          // sale's lines — the stock replay's only input — stranded on
          // the terminal forever.
          const saleData = query('SELECT * FROM sales WHERE id = ?', [id])[0];
          if (saleData) handleDataChange('sales', 'create', saleData);
          const storedSaleItems = query('SELECT * FROM sale_items WHERE saleId = ?', [id]);
          storedSaleItems.forEach(item => handleDataChange('sale_items', 'create', item));
    
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
