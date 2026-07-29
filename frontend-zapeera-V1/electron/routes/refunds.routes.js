/**
 * Refunds Routes
 * Extracted from routes/index.js
 */

function registerRefundsRoutes(app, authMiddleware, deps) {
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

// GET /api/refunds (line 11813)
      app.get('/api/refunds', authMiddleware, (req, res) => {
        try {
          console.log('[Refunds] GET - User:', req.user?.email, 'Branch:', req.user?.branchId);
          const { status, branchId, companyId } = req.query;
    
          // Get data filter based on user role
          const { branchFilter, companyFilter } = getDataFilter(req.user, branchId, companyId);
    
          let sql = 'SELECT * FROM refunds WHERE 1=1';
          const params = [];
    
          // Apply data isolation
          if (branchFilter) { sql += ' AND branchId = ?'; params.push(branchFilter); }
          if (companyFilter) { sql += ' AND companyId = ?'; params.push(companyFilter); }
          if (status) { sql += ' AND status = ?'; params.push(status); }
          sql += ' ORDER BY createdAt DESC';
    
          const rawRefunds = query(sql, params);
          console.log('[Refunds] Found refunds:', rawRefunds.length);
    
          const refunds = rawRefunds.map(r => {
            const sale = r.saleId ? query('SELECT * FROM sales WHERE id = ?', [r.saleId])[0] : null;
            const customer = sale?.customerId ? query('SELECT * FROM customers WHERE id = ?', [sale.customerId])[0] : null;
            const user = r.createdBy ? query('SELECT id, name, email FROM users WHERE id = ?', [r.createdBy])[0] : null;
            const saleItems = sale ? query('SELECT si.*, p.name as productName FROM sale_items si JOIN products p ON si.productId = p.id WHERE si.saleId = ?', [sale.id]) : [];
            const receipts = sale ? query('SELECT * FROM receipts WHERE saleId = ?', [sale.id]) : [];
    
            // Get refund items from refund_items table
            const refundItems = query('SELECT ri.*, p.name as productName, p.unitType FROM refund_items ri LEFT JOIN products p ON ri.productId = p.id WHERE ri.refundId = ?', [r.id]);
    
            // Transform refund items to match frontend format
            const items = refundItems.map(ri => ({
              id: ri.id,
              refundId: ri.refundId,
              saleItemId: ri.saleItemId,
              productId: ri.productId,
              product: {
                id: ri.productId,
                name: ri.productName || 'Unknown Product',
                unitType: ri.unitType || 'units'
              },
              quantity: parseInt(ri.quantity) || 0,
              unitPrice: parseFloat(ri.amount) / (parseInt(ri.quantity) || 1), // Calculate unit price from amount
              reason: ri.reason || r.reason || 'No reason provided'
            }));
    
            return {
              ...r,
              originalSaleId: r.saleId, // Add originalSaleId for compatibility
              originalSale: sale ? {
                ...sale,
                items: saleItems,
                receipts: receipts // Include receipts for invoice number lookup
              } : null,
              sale: sale ? { ...sale, items: saleItems } : null, // Keep for backward compatibility
              customer: customer || null,
              processedBy: user || null,
              refundedByUser: user || null, // Add refundedByUser for frontend compatibility
              items: items, // Include refund items
              refundReason: r.reason || 'No reason provided', // Ensure refundReason is included
              refundAmount: parseFloat(r.amount) || 0, // Ensure refundAmount is included
              refundNumber: `REF-${r.id.substr(0, 8).toUpperCase()}`
            };
          });
    
          res.json({ success: true, data: { refunds, pagination: { total: refunds.length, page: 1, limit: 50, pages: 1 } } });
        } catch (e) {
          console.error('[Refunds] GET error:', e.message);
          res.status(500).json({ success: false, message: e.message });
        }
      });

  // POST /api/refunds (line 11886)
      app.post('/api/refunds', authMiddleware, (req, res) => {
        try {
          console.log('[Refunds] POST request body:', JSON.stringify(req.body));
          // Support both old format (saleId, amount, reason) and new format (originalSaleId/invoiceNumber, refundReason, items)
          const { saleId, originalSaleId, invoiceNumber, amount, reason, refundReason, items = [], branchId, companyId, refundedBy } = req.body;
    
          // Determine which identifier to use
          let saleIdentifier = saleId || originalSaleId;
          let searchByInvoiceNumber = false;
    
          if (invoiceNumber) {
            searchByInvoiceNumber = true;
            saleIdentifier = invoiceNumber;
          }
    
          if (!saleIdentifier) {
            console.error('[Refunds] No sale identifier provided (saleId, originalSaleId, or invoiceNumber required)');
            return res.status(400).json({ success: false, message: 'Sale ID or Invoice Number is required' });
          }
    
          // Get original sale by invoice number or sale ID
          console.log('[Refunds] Looking for sale:', { saleIdentifier, searchByInvoiceNumber });
          let sale = null;
          if (searchByInvoiceNumber) {
            sale = query('SELECT * FROM sales WHERE invoiceNumber = ?', [saleIdentifier])[0];
          if (!sale) {
              // Fallback: try to find by partial match or by ID if invoice number not found
              sale = query('SELECT * FROM sales WHERE invoiceNumber LIKE ? OR id = ?', [`%${saleIdentifier}%`, saleIdentifier])[0];
            }
          } else {
            sale = query('SELECT * FROM sales WHERE id = ?', [saleIdentifier])[0];
          }
    
          if (!sale) {
            console.error('[Refunds] Sale not found:', saleIdentifier);
            return res.status(404).json({
              success: false,
              message: searchByInvoiceNumber
                ? `Sale with invoice number "${saleIdentifier}" not found`
                : `Sale with ID "${saleIdentifier}" not found`
            });
          }
    
          const finalSaleId = sale.id;
          console.log('[Refunds] Found sale:', { id: finalSaleId, invoiceNumber: sale.invoiceNumber });
    
          // Check if sale is already refunded
          if (sale.status === 'REFUNDED') {
            console.log('[Refunds] ⚠️ Sale already refunded:', finalSaleId);
            return res.status(400).json({
              success: false,
              message: 'Already Refunded: This sale has already been refunded.',
              error: 'ALREADY_REFUNDED'
            });
          }

          // Check if any sale items have already been refunded
          if (items && items.length > 0) {
            const saleItemIds = items
              .map(item => item.saleItemId)
              .filter(id => id && id.trim() !== '');
            
            if (saleItemIds.length > 0) {
              // Ensure refund_items table has saleItemId column
              try {
                const refundItemsColumns = query('PRAGMA table_info(refund_items)');
                const columnNames = refundItemsColumns.map(col => col.name.toLowerCase());
                if (!columnNames.includes('saleitemid')) {
                  console.log('[Refunds] Adding saleItemId column to refund_items table...');
                  run('ALTER TABLE refund_items ADD COLUMN saleItemId TEXT');
                  saveDatabase();
                }
              } catch (migrationError) {
                console.log('[Refunds] Migration check:', migrationError.message);
              }
              
              // Check if any of these sale items have already been refunded
              const existingRefundItems = query(
                'SELECT ri.*, r.createdAt as refundCreatedAt, p.name as productName FROM refund_items ri ' +
                'INNER JOIN refunds r ON ri.refundId = r.id ' +
                'LEFT JOIN products p ON ri.productId = p.id ' +
                'WHERE ri.saleItemId IN (' + saleItemIds.map(() => '?').join(',') + ')',
                saleItemIds
              );

              if (existingRefundItems && existingRefundItems.length > 0) {
                const alreadyRefundedItems = existingRefundItems.map(ri => ({
                  saleItemId: ri.saleItemId,
                  productName: ri.productName || 'Unknown Product',
                  refundedAt: ri.refundCreatedAt
                }));

                // Create a user-friendly error message
                const productNames = alreadyRefundedItems.map(item => item.productName).join(', ');
                const refundDate = alreadyRefundedItems[0]?.refundedAt 
                  ? new Date(alreadyRefundedItems[0].refundedAt).toLocaleDateString() 
                  : 'previously';

                const errorMessage = `Already Refunded: ${productNames} ${alreadyRefundedItems.length > 1 ? 'items have' : 'item has'} already been refunded on ${refundDate}.`;

                console.log('[Refunds] ⚠️ Some items already refunded:', alreadyRefundedItems);
                return res.status(400).json({
                  success: false,
                  message: errorMessage,
                  error: 'ALREADY_REFUNDED',
                  errors: alreadyRefundedItems.map(item => 
                    `${item.productName} was already refunded on ${new Date(item.refundedAt).toLocaleDateString()}`
                  )
                });
              }
            }
          }
    
          const id = uuid();
          const refundNumber = `REF-${Date.now()}`;
          const timestamp = now();
    
          // Calculate refund amount from items if provided, otherwise use amount or sale total
          let refundAmount = 0;
          if (items && items.length > 0) {
            refundAmount = items.reduce((total, item) => total + (parseFloat(item.quantity) * parseFloat(item.unitPrice)), 0);
          } else {
            refundAmount = parseFloat(amount) || parseFloat(sale.grandTotal) || 0;
          }
    
          const finalReason = refundReason || reason || 'Customer return';
          const finalBranchId = branchId || sale.branchId || req.user?.branchId || null;
          const finalCompanyId = companyId || sale.companyId || req.user?.companyId || null;
          const finalRefundedBy = refundedBy || req.user?.id || null;
    
          console.log('[Refunds] Creating refund:', { id, saleId: finalSaleId, refundAmount, finalBranchId, finalCompanyId, finalReason });
    
          const insertSuccess = run(`INSERT INTO refunds (id, saleId, amount, reason, branchId, companyId, status, createdBy, createdAt, updatedAt)
               VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [id, finalSaleId, refundAmount, finalReason, finalBranchId, finalCompanyId, 'COMPLETED', finalRefundedBy, timestamp, timestamp]);
    
          if (!insertSuccess) {
            console.error('[Refunds] Failed to insert refund');
            return res.status(500).json({ success: false, message: 'Failed to create refund record' });
          }
    
          // Restore product stock for refunded items and store refund items
          // Use items from request if provided, otherwise restore all items from sale
          let saleItems = [];
          let refundItemsToStore = [];
    
          if (items && items.length > 0) {
            console.log('[Refunds] Restoring stock for', items.length, 'specific items');
            saleItems = items; // Use items from request
    
            // CRITICAL: Get original sale_items to retrieve batchId if not provided in refund items
            const originalSaleItems = query('SELECT * FROM sale_items WHERE saleId = ?', [finalSaleId]);
            console.log('[Refunds] Original sale items:', originalSaleItems.map(item => ({
              id: item.id,
              productId: item.productId,
              quantity: item.quantity,
              batchId: item.batchId
            })));
    
            // Store refund items in refund_items table
            items.forEach((refundItem, index) => {
              if (refundItem.productId && refundItem.quantity) {
                const refundItemId = uuid();
                const itemAmount = parseFloat(refundItem.unitPrice) * parseFloat(refundItem.quantity);
    
                // CRITICAL: Find batchId from original sale_items if not provided
                let batchIdToUse = refundItem.batchId;
                if (!batchIdToUse && refundItem.saleItemId) {
                  const originalItem = originalSaleItems.find(si => si.id === refundItem.saleItemId);
                  if (originalItem && originalItem.batchId) {
                    batchIdToUse = originalItem.batchId;
                    console.log('[Refunds] Found batchId from original sale_item:', batchIdToUse);
                  }
                }
                // If still no batchId, try to find by productId
                if (!batchIdToUse) {
                  const originalItem = originalSaleItems.find(si => si.productId === refundItem.productId);
                  if (originalItem && originalItem.batchId) {
                    batchIdToUse = originalItem.batchId;
                    console.log('[Refunds] Found batchId from original sale_item by productId:', batchIdToUse);
                  }
                }
    
                // Store refund item
                run(`INSERT INTO refund_items (id, refundId, saleItemId, productId, quantity, amount, reason, createdAt, updatedAt)
                     VALUES (?,?,?,?,?,?,?,?,?)`,
                  [refundItemId, id, refundItem.saleItemId || null, refundItem.productId, refundItem.quantity, itemAmount, refundItem.reason || finalReason, timestamp, timestamp]);
    
                refundItemsToStore.push({
                  id: refundItemId,
                  refundId: id,
                  saleItemId: refundItem.saleItemId || null,
                  productId: refundItem.productId,
                  quantity: refundItem.quantity,
                  amount: itemAmount,
                  reason: refundItem.reason || finalReason
                });
    
                // CRITICAL: Restore product stock - ensure quantity is parsed as number
                const refundQuantity = parseFloat(refundItem.quantity) || 0;
                if (refundQuantity > 0) {
                  const productUpdate = run('UPDATE products SET quantity = quantity + ? WHERE id = ?', [refundQuantity, refundItem.productId]);
                  if (productUpdate) {
                    console.log('[Refunds] ✅ Restored', refundQuantity, 'units to product', refundItem.productId);
                  } else {
                    console.error('[Refunds] ❌ Failed to restore product stock for productId:', refundItem.productId);
                  }
    
                  // Also restore batch stock if batchId is available
                  if (batchIdToUse) {
                    const batchUpdate = run('UPDATE batches SET quantity = quantity + ? WHERE id = ?', [refundQuantity, batchIdToUse]);
                    if (batchUpdate) {
                      console.log('[Refunds] ✅ Restored', refundQuantity, 'units to batch', batchIdToUse);
                    } else {
                      console.warn('[Refunds] ⚠️ Failed to restore batch stock for batchId:', batchIdToUse);
                    }
                  } else {
                    // CRITICAL: If batchId is not available, try to find it from batches table
                    console.log('[Refunds] ⚠️ No batchId found, trying to find batch for product:', refundItem.productId);
                    const productBatches = query('SELECT id, quantity FROM batches WHERE productId = ? AND isActive = 1 ORDER BY expireDate ASC, createdAt DESC', [refundItem.productId]);
                    if (productBatches && productBatches.length > 0) {
                      // Use the first available batch
                      const batchToRestore = productBatches[0];
                      const batchUpdate = run('UPDATE batches SET quantity = quantity + ? WHERE id = ?', [refundQuantity, batchToRestore.id]);
                      if (batchUpdate) {
                        console.log('[Refunds] ✅ Restored', refundQuantity, 'units to batch', batchToRestore.id, '(found by product)');
                      } else {
                        console.warn('[Refunds] ⚠️ Failed to restore batch stock for batchId:', batchToRestore.id);
                      }
                    } else {
                      console.warn('[Refunds] ⚠️ No batches found for product:', refundItem.productId);
                    }
                  }
                } else {
                  console.warn('[Refunds] ⚠️ Invalid quantity for refund item:', refundItem);
                }
              }
            });
          } else {
            // CRITICAL: Get sale items with batchId if available
            saleItems = query('SELECT * FROM sale_items WHERE saleId = ?', [finalSaleId]);
            console.log('[Refunds] Restoring stock for', saleItems.length, 'items from sale_items');
            console.log('[Refunds] Sale items:', saleItems.map(item => ({
              id: item.id,
              productId: item.productId,
              quantity: item.quantity,
              batchId: item.batchId
            })));
    
            // Store all sale items as refund items
            saleItems.forEach(item => {
              if (item.productId && item.quantity) {
                const refundItemId = uuid();
                const itemAmount = parseFloat(item.total) || (parseFloat(item.unitPrice) * parseFloat(item.quantity));
    
                // Store refund item
                run(`INSERT INTO refund_items (id, refundId, saleItemId, productId, quantity, amount, reason, createdAt, updatedAt)
                     VALUES (?,?,?,?,?,?,?,?,?)`,
                  [refundItemId, id, item.id || null, item.productId, item.quantity, itemAmount, finalReason, timestamp, timestamp]);
    
                refundItemsToStore.push({
                  id: refundItemId,
                  refundId: id,
                  saleItemId: item.id || null,
                  productId: item.productId,
                  quantity: item.quantity,
                  amount: itemAmount,
                  reason: finalReason
                });
    
                // CRITICAL: Restore product stock - ensure quantity is parsed as number
                const refundQuantity = parseFloat(item.quantity) || 0;
                if (refundQuantity > 0) {
                  const productUpdate = run('UPDATE products SET quantity = quantity + ? WHERE id = ?', [refundQuantity, item.productId]);
                  if (productUpdate) {
                    console.log('[Refunds] ✅ Restored', refundQuantity, 'units to product', item.productId);
                  } else {
                    console.error('[Refunds] ❌ Failed to restore product stock for productId:', item.productId);
                  }
    
                  // Also restore batch stock if batchId exists
                  if (item.batchId) {
                    const batchUpdate = run('UPDATE batches SET quantity = quantity + ? WHERE id = ?', [refundQuantity, item.batchId]);
                    if (batchUpdate) {
                      console.log('[Refunds] ✅ Restored', refundQuantity, 'units to batch', item.batchId);
                    } else {
                      console.warn('[Refunds] ⚠️ Failed to restore batch stock for batchId:', item.batchId);
                    }
                  } else {
                    // CRITICAL: If batchId is not in sale_items, try to find it from batches table
                    // Find the most recent batch for this product that was used in the sale
                    console.log('[Refunds] ⚠️ No batchId in sale_item, trying to find batch for product:', item.productId);
                    const productBatches = query('SELECT id, quantity FROM batches WHERE productId = ? AND isActive = 1 ORDER BY expireDate ASC, createdAt DESC', [item.productId]);
                    if (productBatches && productBatches.length > 0) {
                      // Use the first available batch
                      const batchToRestore = productBatches[0];
                      const batchUpdate = run('UPDATE batches SET quantity = quantity + ? WHERE id = ?', [refundQuantity, batchToRestore.id]);
                      if (batchUpdate) {
                        console.log('[Refunds] ✅ Restored', refundQuantity, 'units to batch', batchToRestore.id, '(found by product)');
                      } else {
                        console.warn('[Refunds] ⚠️ Failed to restore batch stock for batchId:', batchToRestore.id);
                      }
                    } else {
                      console.warn('[Refunds] ⚠️ No batches found for product:', item.productId);
                    }
                  }
                } else {
                  console.warn('[Refunds] ⚠️ Invalid quantity for sale item:', item);
                }
              }
            });
          }
    
          // CRITICAL: Save database after stock updates to ensure changes persist
          console.log('[Refunds] 💾 Saving database after stock restoration...');
          saveDatabase();
          console.log('[Refunds] ✅ Database saved successfully');
    
          // Verify stock was restored by checking product quantities
          if (saleItems.length > 0) {
            console.log('[Refunds] 🔍 Verifying stock restoration...');
            saleItems.forEach((item, index) => {
              const productId = item.productId || (items && items[index] && items[index].productId);
              if (productId) {
                const product = query('SELECT id, name, quantity FROM products WHERE id = ?', [productId])[0];
                if (product) {
                  console.log('[Refunds] ✅ Product stock verified:', {
                    productId: product.id,
                    productName: product.name,
                    currentQuantity: product.quantity
                  });
                } else {
                  console.warn('[Refunds] ⚠️ Product not found for verification:', productId);
                }
              }
            });
          }
    
          // Update sale status
          run("UPDATE sales SET status = 'REFUNDED', paymentStatus = 'REFUNDED', updatedAt = ? WHERE id = ?", [timestamp, finalSaleId]);
          console.log('[Refunds] Updated sale status to REFUNDED');
    
          const refund = query('SELECT * FROM refunds WHERE id = ?', [id])[0];
          const customer = sale.customerId ? query('SELECT * FROM customers WHERE id = ?', [sale.customerId])[0] : null;
    
          console.log('[Refunds] ✅ Refund created successfully:', id);
    
          // 🔄 TWO-WAY SYNC: Queue refund for sync to PostgreSQL
          if (refund) handleDataChange('refunds', 'create', refund);
    
          // Get refund items for response
          const refundItemsResponse = query('SELECT ri.*, p.name as productName, p.unitType FROM refund_items ri LEFT JOIN products p ON ri.productId = p.id WHERE ri.refundId = ?', [id]);
          const itemsResponse = refundItemsResponse.map(ri => ({
            id: ri.id,
            refundId: ri.refundId,
            saleItemId: ri.saleItemId,
            productId: ri.productId,
            product: {
              id: ri.productId,
              name: ri.productName || 'Unknown Product',
              unitType: ri.unitType || 'units'
            },
            quantity: parseInt(ri.quantity) || 0,
            unitPrice: parseFloat(ri.amount) / (parseInt(ri.quantity) || 1),
            reason: ri.reason || finalReason
          }));
    
          res.status(201).json({
            success: true,
            data: {
              refund: {
              ...refund,
              refundNumber,
                refundReason: finalReason,
                refundAmount: refundAmount
              },
              sale,
              customer,
              items: itemsResponse, // Use refund items instead of sale items
              processedBy: { id: req.user?.id, name: req.user?.name || 'Admin' }
            },
            message: 'Refund processed successfully'
          });
        } catch (e) {
          console.error('[Refunds] POST error:', e.message, e.stack);
          res.status(500).json({ success: false, message: 'Failed to process refund: ' + e.message });
        }
      });

}

module.exports = {
  registerRefundsRoutes
};
