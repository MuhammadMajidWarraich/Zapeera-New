/**
 * Promotions Routes (desktop embedded server)
 *
 * Replaces the 2026 stub that answered GET /api/promotions with
 * `{ data: { promotions: [], pagination } }` — an OBJECT where the web
 * contract (backend promotion.controller getPromotions) returns the
 * ARRAY directly with `pagination` as a sibling. The Settings →
 * Promotions page does `setPromotions(response.data)` and then
 * `promotions.map(...)` at render: with the stub's shape that threw
 * "promotions.map is not a function" → ErrorBoundary → (pre-fix) the
 * fatal file:///C:/zapeera navigation. This module implements the web
 * contract faithfully against the local `promotions` table:
 *   GET    /api/promotions           data: Promotion[] + pagination{}
 *   GET    /api/promotions/:id       data: Promotion
 *   POST   /api/promotions           201, OWNER/MANAGER/ADMIN only
 *   PUT    /api/promotions/:id       merged update, usedCount immutable
 *   DELETE /api/promotions/:id       soft (isActive = 0), history kept
 *   POST   /api/promotions/validate  coupon check for the POS
 * Validation mirrors the web controller's cross-field rules and the
 * DUPLICATE_COUPON_CODE 409. Validate computes PERCENT/FLAT over the
 * subtotal and BUY_X_GET_Y over the provided cart items — the same
 * response shape as the web validateCoupon.
 */

function registerPromotionsRoutes(app, authMiddleware, deps) {
  const { query, run, uuid, now, handleDataChange, saveDatabase } = deps;

  const resolveCompanyId = (req) =>
    req.headers['x-business-id'] || req.headers['x-company-id'] ||
    req.user?.selectedCompanyId || req.user?.companyId || null;

  const canManage = (req) => {
    const role = String(req.user?.membership?.roleName || req.user?.role || '').toUpperCase();
    return ['OWNER', 'MANAGER', 'ADMIN'].includes(role);
  };

  const present = (row) => {
    if (!row) return row;
    const out = { ...row, isActive: row.isActive === 1 || row.isActive === '1' || row.isActive === true };
    if (row.categoryId) {
      const c = query('SELECT id, name FROM categories WHERE id = ?', [row.categoryId])[0];
      out.category = c ? { id: c.id, name: c.name } : null;
    } else out.category = null;
    if (row.productId) {
      const p = query('SELECT id, name, barcode FROM products WHERE id = ?', [row.productId])[0];
      out.product = p ? { id: p.id, name: p.name, barcode: p.barcode || null } : null;
    } else out.product = null;
    return out;
  };

  const normalizeCode = (code) => {
    if (code === undefined || code === null) return null;
    const c = String(code).trim().toUpperCase();
    return c ? c : null;
  };

  const crossFieldError = (m) => {
    if (m.type === 'PERCENT' && (!(m.value > 0) || m.value > 100)) return 'A PERCENT promotion needs a value between 0 and 100';
    if (m.type === 'FLAT' && !(m.value > 0)) return 'A FLAT promotion needs a value above 0';
    if (m.type === 'BUY_X_GET_Y' && (!m.buyQty || m.buyQty < 1 || !m.getQty || m.getQty < 1)) return 'A BUY_X_GET_Y promotion needs buyQty and getQty of at least 1';
    if (m.scope === 'CATEGORY' && !m.categoryId) return 'A CATEGORY promotion needs a category';
    if (m.scope === 'PRODUCT' && !m.productId) return 'A PRODUCT promotion needs a product';
    if (m.startsAt && m.endsAt && new Date(m.endsAt).getTime() <= new Date(m.startsAt).getTime()) return 'endsAt must be after startsAt';
    return null;
  };

  const scopeTargetError = (companyId, m) => {
    if (m.scope === 'CATEGORY' && m.categoryId) {
      const c = query('SELECT id FROM categories WHERE id = ? AND companyId = ?', [m.categoryId, companyId])[0];
      if (!c) return 'Category not found in this business';
    }
    if (m.scope === 'PRODUCT' && m.productId) {
      const p = query('SELECT id FROM products WHERE id = ? AND companyId = ?', [m.productId, companyId])[0];
      if (!p) return 'Product not found in this business';
    }
    return null;
  };

  // POST /api/promotions/validate — registered before /:id routes.
  app.post('/api/promotions/validate', authMiddleware, (req, res) => {
    try {
      const companyId = resolveCompanyId(req);
      const { code, items, subtotal: bodySubtotal } = req.body || {};
      const normCode = normalizeCode(code);
      if (!normCode) return res.json({ success: true, data: { valid: false, reason: 'Enter a coupon code' } });
      const promo = query('SELECT * FROM promotions WHERE companyId = ? AND code = ?', [companyId, normCode])[0];
      if (!promo) return res.json({ success: true, data: { valid: false, reason: `Coupon code "${normCode}" was not found` } });
      const p = present(promo);
      if (!p.isActive) return res.json({ success: true, data: { valid: false, reason: 'This coupon is not active', promotion: p } });
      const nowMs = Date.now();
      if (promo.startsAt && new Date(promo.startsAt).getTime() > nowMs) return res.json({ success: true, data: { valid: false, reason: 'This coupon is not valid yet', promotion: p } });
      if (promo.endsAt && new Date(promo.endsAt).getTime() < nowMs) return res.json({ success: true, data: { valid: false, reason: 'This coupon has expired', promotion: p } });
      if (promo.usageLimit != null && (promo.usedCount || 0) >= promo.usageLimit) return res.json({ success: true, data: { valid: false, reason: 'This coupon has reached its usage limit', promotion: p } });

      const hasItems = Array.isArray(items) && items.length > 0;
      const subtotal = hasItems
        ? items.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0)
        : (bodySubtotal !== undefined ? Number(bodySubtotal) || 0 : null);
      if (subtotal === null) return res.status(400).json({ success: false, message: 'Provide either the cart items or a subtotal to validate against' });
      if (promo.minBill != null && subtotal < promo.minBill) return res.json({ success: true, data: { valid: false, reason: `This coupon needs a minimum bill of ${promo.minBill}`, promotion: p } });
      if (!hasItems && (promo.type === 'BUY_X_GET_Y' || promo.scope !== 'ALL')) {
        return res.json({ success: true, data: { valid: false, reason: 'This coupon applies to specific items — the cart items are needed to check it', promotion: p } });
      }

      // Eligible lines for scoped offers.
      let eligible = hasItems ? items : [];
      if (hasItems && promo.scope === 'PRODUCT') eligible = items.filter(it => it.productId === promo.productId);
      if (hasItems && promo.scope === 'CATEGORY') {
        eligible = items.filter(it => {
          const prod = query('SELECT categoryId FROM products WHERE id = ?', [it.productId])[0];
          return prod && prod.categoryId === promo.categoryId;
        });
      }
      const eligibleSubtotal = eligible.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);

      let discount = 0;
      if (promo.type === 'PERCENT') discount = (promo.scope === 'ALL' ? subtotal : eligibleSubtotal) * (Number(promo.value) || 0) / 100;
      else if (promo.type === 'FLAT') discount = Math.min(Number(promo.value) || 0, promo.scope === 'ALL' ? subtotal : eligibleSubtotal);
      else if (promo.type === 'BUY_X_GET_Y') {
        // Free units per complete (buy+get) group, valued at the
        // cheapest eligible unit price (standard BXGY convention).
        const totalQty = eligible.reduce((s, it) => s + (Number(it.quantity) || 0), 0);
        const groups = Math.floor(totalQty / ((promo.buyQty || 0) + (promo.getQty || 0)));
        const cheapest = eligible.reduce((min, it) => Math.min(min, Number(it.unitPrice) || 0), Infinity);
        discount = groups > 0 && Number.isFinite(cheapest) ? groups * (promo.getQty || 0) * cheapest : 0;
      }
      discount = Math.round(discount * 100) / 100;
      if (!(discount > 0)) return res.json({ success: true, data: { valid: false, reason: `Coupon code "${normCode}" does not apply to the items in this sale`, promotion: p } });
      return res.json({ success: true, data: { valid: true, promotion: p, estimatedDiscount: discount, estimatedTotalPromotionDiscount: discount } });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // GET /api/promotions
  app.get('/api/promotions', authMiddleware, (req, res) => {
    try {
      const companyId = resolveCompanyId(req);
      const page = Math.max(1, parseInt(req.query.page, 10) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 20));
      const where = ['companyId = ?'];
      const params = [companyId];
      if (req.query.type) { where.push('type = ?'); params.push(req.query.type); }
      if (req.query.isActive !== undefined) { where.push('isActive = ?'); params.push(String(req.query.isActive) === 'true' ? 1 : 0); }
      if (req.query.search) { where.push('(name LIKE ? OR code LIKE ?)'); params.push(`%${req.query.search}%`, `%${String(req.query.search).toUpperCase()}%`); }
      const total = query(`SELECT COUNT(*) AS c FROM promotions WHERE ${where.join(' AND ')}`, params)[0]?.c || 0;
      const rows = query(
        `SELECT * FROM promotions WHERE ${where.join(' AND ')} ORDER BY createdAt DESC LIMIT ? OFFSET ?`,
        [...params, limit, (page - 1) * limit]
      );
      res.json({
        success: true,
        data: rows.map(present),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) }
      });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // GET /api/promotions/:id
  app.get('/api/promotions/:id', authMiddleware, (req, res) => {
    try {
      const companyId = resolveCompanyId(req);
      const row = query('SELECT * FROM promotions WHERE id = ? AND companyId = ?', [req.params.id, companyId])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Promotion not found' });
      res.json({ success: true, data: present(row) });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // POST /api/promotions
  app.post('/api/promotions', authMiddleware, (req, res) => {
    try {
      if (!canManage(req)) return res.status(403).json({ success: false, message: 'Only the owner or a manager can manage promotions', code: 'PROMOTION_MANAGER_ONLY' });
      const companyId = resolveCompanyId(req);
      const b = req.body || {};
      if (!b.name || !String(b.name).trim()) return res.status(400).json({ success: false, message: 'Validation error', errors: ['name is required'] });
      if (!['PERCENT', 'FLAT', 'BUY_X_GET_Y'].includes(b.type)) return res.status(400).json({ success: false, message: 'Validation error', errors: ['type must be PERCENT, FLAT or BUY_X_GET_Y'] });
      const merged = {
        name: String(b.name).trim(),
        type: b.type,
        value: b.type === 'BUY_X_GET_Y' ? 0 : (b.value ?? 0),
        buyQty: b.type === 'BUY_X_GET_Y' ? (b.buyQty ?? null) : null,
        getQty: b.type === 'BUY_X_GET_Y' ? (b.getQty ?? null) : null,
        scope: b.scope || 'ALL',
        categoryId: b.scope === 'CATEGORY' ? (b.categoryId || null) : null,
        productId: b.scope === 'PRODUCT' ? (b.productId || null) : null,
        code: normalizeCode(b.code),
        minBill: b.minBill ?? null,
        startsAt: b.startsAt || null,
        endsAt: b.endsAt || null,
        usageLimit: b.usageLimit ?? null,
        isActive: b.isActive === false ? 0 : 1
      };
      const cross = crossFieldError(merged);
      if (cross) return res.status(400).json({ success: false, message: cross });
      const scopeErr = scopeTargetError(companyId, merged);
      if (scopeErr) return res.status(400).json({ success: false, message: scopeErr });
      if (merged.code) {
        const clash = query('SELECT id FROM promotions WHERE companyId = ? AND code = ?', [companyId, merged.code])[0];
        if (clash) return res.status(409).json({ success: false, message: `A promotion with code "${merged.code}" already exists in this business`, code: 'DUPLICATE_COUPON_CODE' });
      }
      const id = uuid();
      const ts = now();
      run(`INSERT INTO promotions (id, companyId, name, type, value, buyQty, getQty, scope, categoryId, productId, code, minBill, startsAt, endsAt, usageLimit, usedCount, isActive, createdAt, updatedAt)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, companyId, merged.name, merged.type, merged.value, merged.buyQty, merged.getQty, merged.scope, merged.categoryId, merged.productId, merged.code, merged.minBill, merged.startsAt, merged.endsAt, merged.usageLimit, 0, merged.isActive, ts, ts]);
      saveDatabase && saveDatabase();
      const row = query('SELECT * FROM promotions WHERE id = ?', [id])[0];
      if (row && handleDataChange) handleDataChange('promotions', 'create', row);
      res.status(201).json({ success: true, data: present(row) });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // PUT /api/promotions/:id
  app.put('/api/promotions/:id', authMiddleware, (req, res) => {
    try {
      if (!canManage(req)) return res.status(403).json({ success: false, message: 'Only the owner or a manager can manage promotions', code: 'PROMOTION_MANAGER_ONLY' });
      const companyId = resolveCompanyId(req);
      const existing = query('SELECT * FROM promotions WHERE id = ? AND companyId = ?', [req.params.id, companyId])[0];
      if (!existing) return res.status(404).json({ success: false, message: 'Promotion not found' });
      const b = req.body || {};
      const merged = { ...existing, ...b };
      if (merged.type === 'BUY_X_GET_Y') merged.value = 0;
      if (merged.scope !== 'CATEGORY') merged.categoryId = null;
      if (merged.scope !== 'PRODUCT') merged.productId = null;
      if (b.code !== undefined) merged.code = normalizeCode(b.code);
      if (b.categoryId !== undefined) merged.categoryId = b.categoryId || null;
      if (b.productId !== undefined) merged.productId = b.productId || null;
      const cross = crossFieldError(merged);
      if (cross) return res.status(400).json({ success: false, message: cross });
      const scopeErr = scopeTargetError(companyId, merged);
      if (scopeErr) return res.status(400).json({ success: false, message: scopeErr });
      if (merged.code && merged.code !== existing.code) {
        const clash = query('SELECT id FROM promotions WHERE companyId = ? AND code = ? AND id != ?', [companyId, merged.code, existing.id])[0];
        if (clash) return res.status(409).json({ success: false, message: `A promotion with code "${merged.code}" already exists in this business`, code: 'DUPLICATE_COUPON_CODE' });
      }
      run(`UPDATE promotions SET name = ?, type = ?, value = ?, buyQty = ?, getQty = ?, scope = ?, categoryId = ?, productId = ?, code = ?, minBill = ?, startsAt = ?, endsAt = ?, usageLimit = ?, isActive = ?, updatedAt = ? WHERE id = ?`,
        [merged.name, merged.type, merged.type === 'BUY_X_GET_Y' ? 0 : (merged.value ?? 0), merged.buyQty ?? null, merged.getQty ?? null, merged.scope || 'ALL', merged.categoryId, merged.productId, merged.code, merged.minBill ?? null, merged.startsAt || null, merged.endsAt || null, merged.usageLimit ?? null, merged.isActive === false || merged.isActive === 0 ? 0 : 1, now(), existing.id]);
      saveDatabase && saveDatabase();
      const row = query('SELECT * FROM promotions WHERE id = ?', [existing.id])[0];
      if (row && handleDataChange) handleDataChange('promotions', 'update', row);
      res.json({ success: true, data: present(row) });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // DELETE /api/promotions/:id — soft: deactivates, redemption history kept.
  app.delete('/api/promotions/:id', authMiddleware, (req, res) => {
    try {
      if (!canManage(req)) return res.status(403).json({ success: false, message: 'Only the owner or a manager can manage promotions', code: 'PROMOTION_MANAGER_ONLY' });
      const companyId = resolveCompanyId(req);
      const existing = query('SELECT * FROM promotions WHERE id = ? AND companyId = ?', [req.params.id, companyId])[0];
      if (!existing) return res.status(404).json({ success: false, message: 'Promotion not found' });
      run('UPDATE promotions SET isActive = 0, updatedAt = ? WHERE id = ?', [now(), existing.id]);
      saveDatabase && saveDatabase();
      const row = query('SELECT * FROM promotions WHERE id = ?', [existing.id])[0];
      if (row && handleDataChange) handleDataChange('promotions', 'update', row);
      res.json({ success: true, data: present(row) });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });
}

module.exports = {
  registerPromotionsRoutes
};
