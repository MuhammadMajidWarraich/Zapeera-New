/**
 * Service-sale helper — the embedded equivalent of the cloud's
 * invokeCreateSale for the clinic/hotel packs (completeVisit,
 * checkOutFolio). The visit/checkout invoice rides on auto-managed
 * SERVICE products (isService = 1, no stock), exactly as on the cloud:
 *   CONSULT-<doctorId>      "Consultation — Dr <name>"
 *   ROOMNIGHT-<roomTypeId>  "Room Night — <type name>"
 *   FOLIOCHG-<chargeId>     the folio charge's own description
 * Identity is the SKU (globally unique). The first ensure creates the
 * product under a find-or-created "Services" category.
 *
 * The sale row mirrors electron/routes/sales.routes.js (same columns,
 * same INV-xxxxx numbering, same shift resolution, same
 * handleDataChange enqueue so the invoice syncs to the cloud like a
 * POS sale). Service lines carry batchId null and deduct no stock.
 * M3: totalAmount is the GRAND total here (same as the fixed POS insert).
 */
const { v4: uuid } = require('uuid');
const { mustRun } = require('./db-write');

function generateInvoiceNumber(query) {
  try {
    const lastSale = query("SELECT invoiceNumber FROM sales WHERE invoiceNumber IS NOT NULL ORDER BY createdAt DESC LIMIT 1")[0];
    let baseNumber = 10000;
    if (lastSale && lastSale.invoiceNumber) {
      const match = lastSale.invoiceNumber.match(/INV-(\d+)/);
      if (match) baseNumber = parseInt(match[1], 10);
    }
    for (let attempt = 0; attempt < 10; attempt++) {
      const nextNumber = ((baseNumber + attempt) % 99999) || 10000;
      const candidate = `INV-${String(nextNumber).padStart(5, '0')}`;
      if (!query('SELECT id FROM sales WHERE invoiceNumber = ?', [candidate])[0]) return candidate;
    }
  } catch (e) {
    console.error('[ServiceSale] invoice number fallback:', e.message);
  }
  return `INV-${Date.now().toString().slice(-8)}`;
}

function ensureServiceProduct(deps, { companyId, branchId, sku, name, description, createdBy }) {
  const { query, run } = deps;
  let product = query('SELECT * FROM products WHERE sku = ?', [sku])[0];
  if (product && product.companyId !== companyId) product = null;
  if (!product) {
    let category = query('SELECT * FROM categories WHERE companyId = ? AND branchId = ? AND name = ?', [companyId, branchId, 'Services'])[0];
    if (!category) {
      const catId = uuid();
      const now = new Date().toISOString();
      mustRun(run,
        'INSERT INTO categories (id, name, description, type, companyId, branchId, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [catId, 'Services', 'Consultations and other non-stock services', 'GENERAL', companyId, branchId, createdBy || null, now, now]
      );
      category = { id: catId };
    }
    const productId = uuid();
    const now = new Date().toISOString();
    mustRun(run,
      'INSERT INTO products (id, name, sku, description, categoryId, branchId, companyId, createdBy, isService, isActive, minStock, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 0, ?, ?)',
      [productId, name, sku, description || null, category.id, branchId, companyId, createdBy || null, now, now]
    );
    product = query('SELECT * FROM products WHERE id = ?', [productId])[0];
  } else {
    const patch = [];
    const params = [];
    if (product.name !== name) { patch.push('name = ?'); params.push(name); }
    if (!product.isService) { patch.push('isService = 1'); }
    if (!product.isActive) { patch.push('isActive = 1'); }
    if (patch.length > 0) {
      params.push(product.id);
      mustRun(run, `UPDATE products SET ${patch.join(', ')} WHERE id = ?`, params);
      product = query('SELECT * FROM products WHERE id = ?', [product.id])[0];
    }
  }
  return product;
}

function resolveActiveShiftId(query, userId, companyId) {
  try {
    let membershipRow = null;
    if (companyId) membershipRow = query('SELECT id FROM memberships WHERE userId = ? AND businessId = ?', [userId, companyId])[0];
    if (!membershipRow) {
      const memberships = query('SELECT id FROM memberships WHERE userId = ?', [userId]);
      if (memberships.length === 1) membershipRow = memberships[0];
    }
    if (!membershipRow) return null;
    const profileRow = query('SELECT id FROM staff_profiles WHERE membershipId = ?', [membershipRow.id])[0];
    if (!profileRow) return null;
    const activeRow = query("SELECT id FROM shifts WHERE staffProfileId = ? AND status = 'ACTIVE' ORDER BY startTime DESC LIMIT 1", [profileRow.id])[0];
    return activeRow ? activeRow.id : null;
  } catch {
    return null;
  }
}

/**
 * Create a service-only sale (no stock lines). `items` is
 * [{ productId, quantity, unitPrice }]. Returns the stored sale row
 * (with items) or throws.
 */
function createServiceSale(deps, { companyId, branchId, customerId, items, paymentMethod, paymentStatus, paidAmount, notes, createdBy, userId }) {
  const { query, run, saveDatabase, handleDataChange } = deps;
  const subtotal = items.reduce((s, it) => s + it.quantity * it.unitPrice, 0);
  const grandTotal = Math.round(subtotal * 100) / 100;
  const finalPaymentStatus = (paymentStatus || 'COMPLETED').toUpperCase();
  const finalSaleStatus = finalPaymentStatus === 'COMPLETED' ? 'COMPLETED' : 'PENDING';
  const finalPaidAmount = paidAmount !== undefined ? paidAmount : (finalPaymentStatus === 'COMPLETED' ? grandTotal : 0);
  const id = uuid();
  const invoiceNumber = generateInvoiceNumber(query);
  const receiptNumber = invoiceNumber.replace('INV-', 'RCN-');
  const timestamp = new Date().toISOString();
  const shiftId = resolveActiveShiftId(query, userId, companyId);
  // The sale row + its items are one unit: a failed item insert must
  // not leave an item-less sale behind (the caller retries billing).
  const storedItems = [];
  try {
    mustRun(run,
      'INSERT INTO sales (id, invoiceNumber, receiptNumber, customerId, branchId, companyId, totalAmount, discount, tax, grandTotal, paidAmount, returnedAmount, paymentMethod, paymentStatus, status, notes, createdBy, createdAt, updatedAt, shiftId) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      [id, invoiceNumber, receiptNumber, customerId || null, branchId, companyId, grandTotal, 0, 0, grandTotal, finalPaidAmount, Math.max(0, finalPaidAmount - grandTotal), (paymentMethod || 'CASH').toUpperCase(), finalPaymentStatus, finalSaleStatus, notes || null, createdBy || null, timestamp, timestamp, shiftId]
    );
    for (const it of items) {
      const itemId = uuid();
      const total = Math.round(it.quantity * it.unitPrice * 100) / 100;
      mustRun(run,
        'INSERT INTO sale_items (id, saleId, productId, batchId, quantity, unitPrice, discount, total, createdAt) VALUES (?,?,?,?,?,?,?,?,?)',
        [itemId, id, it.productId, null, it.quantity, it.unitPrice, 0, total, timestamp]
      );
      storedItems.push(query('SELECT * FROM sale_items WHERE id = ?', [itemId])[0]);
    }
  } catch (e) {
    run('DELETE FROM sale_items WHERE saleId = ?', [id]);
    run('DELETE FROM sales WHERE id = ?', [id]);
    saveDatabase();
    throw e;
  }
  saveDatabase();
  const sale = query('SELECT * FROM sales WHERE id = ?', [id])[0];
  if (typeof handleDataChange === 'function') {
    try {
      handleDataChange('sales', 'create', sale);
      for (const si of storedItems) handleDataChange('sale_items', 'create', si);
    } catch (e) {
      console.error('[ServiceSale] sync enqueue failed (sale stored locally):', e.message);
    }
  }
  return { ...sale, items: storedItems };
}

module.exports = { ensureServiceProduct, createServiceSale, generateInvoiceNumber };
