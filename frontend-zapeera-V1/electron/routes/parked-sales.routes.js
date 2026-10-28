/**
 * Parked sales (POS Hold) — embedded port of
 * backend-zapeera-v1-main/src/controllers/parked-sale.controller.ts
 * (routes /api/parked-sales, module sales — core, applies to all types).
 *
 * LOCAL-ONLY (no cloud sync): the cloud pull feed does not serve
 * parked_sales, and the local `payload` column is a JSON *string* while
 * the cloud Prisma field is `Json` — a naive push would store a
 * malformed payload. Rows are created/read/deleted here only; a sync
 * port needs a feed + payload-shape change first.
 * BranchId is required on create (cloud Joi); itemCount/grandTotal are
 * derived from the payload, exactly as on the cloud.
 */
const { getDataFilter } = require('../utils/helpers');

function registerParkedSalesRoutes(app, authMiddleware, { query, run, saveDatabase }) {
  const TABLE = 'parked_sales';

  function toListItem(row) {
    return {
      id: row.id,
      businessId: row.businessId,
      branchId: row.branchId,
      createdById: row.createdById,
      customerId: row.customerId,
      label: row.label,
      itemCount: row.itemCount,
      grandTotal: Number(row.grandTotal) || 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      createdByName: row.createdByName || null,
      customerName: row.customerName || null
    };
  }

  function toDetail(row) {
    const item = toListItem(row);
    let payload = null;
    try { payload = row.payload ? JSON.parse(row.payload) : null; } catch { payload = null; }
    return { ...item, payload };
  }

  function namesFor(rows) {
    const creatorIds = [...new Set(rows.map((r) => r.createdById).filter(Boolean))];
    const customerIds = [...new Set(rows.map((r) => r.customerId).filter(Boolean))];
    const creatorNames = {};
    const customerNames = {};
    for (const id of creatorIds) {
      const u = query('SELECT name, email FROM users WHERE id = ?', [id])[0];
      if (u) creatorNames[id] = u.name || u.email || null;
    }
    for (const id of customerIds) {
      const c = query('SELECT name FROM customers WHERE id = ?', [id])[0];
      if (c) customerNames[id] = c.name || null;
    }
    return { creatorNames, customerNames };
  }

  function attachNames(rows) {
    const { creatorNames, customerNames } = namesFor(rows);
    return rows.map((r) => ({ ...r, createdByName: creatorNames[r.createdById] || null, customerName: customerNames[r.customerId] || null }));
  }

  // GET /api/parked-sales — list for the business (+ optional branchId), newest first, NO payload
  app.get('/api/parked-sales', authMiddleware, (req, res) => {
    try {
      const { companyFilter, branchFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const where = ['businessId = ?'];
      const params = [companyFilter];
      if (req.query.branchId) {
        where.push('branchId = ?');
        params.push(String(req.query.branchId));
      } else if (branchFilter) {
        where.push('branchId = ?');
        params.push(branchFilter);
      }
      const rows = query(`SELECT * FROM ${TABLE} WHERE ${where.join(' AND ')} ORDER BY createdAt DESC`, params);
      res.json({ success: true, data: { parkedSales: attachNames(rows).map(toListItem) } });
    } catch (e) {
      console.error('[ParkedSales] list error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // GET /api/parked-sales/:id — full record WITH payload
  app.get('/api/parked-sales/:id', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query(`SELECT * FROM ${TABLE} WHERE id = ? AND businessId = ?`, [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Parked sale not found' });
      res.json({ success: true, data: { parkedSale: toDetail(attachNames([row])[0]) } });
    } catch (e) {
      console.error('[ParkedSales] get error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // POST /api/parked-sales — create
  app.post('/api/parked-sales', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const { branchId, customerId, label, payload } = req.body || {};
      if (!branchId) return res.status(400).json({ success: false, message: 'Branch is required' });
      if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
        return res.status(400).json({ success: false, message: 'Items are required' });
      }
      for (const item of payload.items) {
        if (!item.productId || typeof item.quantity !== 'number' || item.quantity <= 0) {
          return res.status(400).json({ success: false, message: 'Each item must include productId and a positive quantity' });
        }
      }
      if (label !== undefined && label !== null && String(label).length > 120) {
        return res.status(400).json({ success: false, message: 'Label cannot exceed 120 characters' });
      }
      const branch = query('SELECT id FROM branches WHERE id = ? AND companyId = ?', [branchId, companyFilter])[0];
      if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });
      if (customerId) {
        const customer = query('SELECT id FROM customers WHERE id = ? AND companyId = ?', [customerId, companyFilter])[0];
        if (!customer) return res.status(404).json({ success: false, message: 'Customer not found' });
      }
      // Derive itemCount/grandTotal exactly as the cloud does; fall back
      // to the product selling price when an item carries no price.
      let itemCount = 0;
      let grandTotal = 0;
      for (const item of payload.items) {
        itemCount += item.quantity;
        let price = typeof item.price === 'number' ? item.price : null;
        if (price === null) {
          const p = query('SELECT sellingPrice, unitPrice FROM products WHERE id = ? AND companyId = ?', [item.productId, companyFilter])[0];
          price = p ? (Number(p.sellingPrice) || Number(p.unitPrice) || 0) : 0;
        }
        grandTotal += price * item.quantity;
      }
      const id = `ps_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const now = new Date().toISOString();
      run(
        `INSERT INTO ${TABLE} (id, businessId, branchId, createdById, customerId, label, payload, itemCount, grandTotal, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, companyFilter, branchId, req.user.id, customerId || null, label || null, JSON.stringify(payload), itemCount, grandTotal, now, now]
      );
      saveDatabase();
      const row = query(`SELECT * FROM ${TABLE} WHERE id = ?`, [id])[0];
      res.status(201).json({ success: true, data: { parkedSale: toDetail(attachNames([row])[0]) } });
    } catch (e) {
      console.error('[ParkedSales] create error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  function deleteOne(req, res) {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query(`SELECT id FROM ${TABLE} WHERE id = ? AND businessId = ?`, [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Parked sale not found' });
      run(`DELETE FROM ${TABLE} WHERE id = ?`, [req.params.id]);
      saveDatabase();
      res.json({ success: true, data: { id: req.params.id } });
    } catch (e) {
      console.error('[ParkedSales] delete error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  }

  // DELETE /api/parked-sales/:id
  app.delete('/api/parked-sales/:id', authMiddleware, deleteOne);
  // POST /api/parked-sales/:id/discard — the frontend's discard action (same as delete)
  app.post('/api/parked-sales/:id/discard', authMiddleware, deleteOne);
}

module.exports = { registerParkedSalesRoutes };
