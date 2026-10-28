/**
 * Tax classes — embedded port of
 * backend-zapeera-v1-main/src/controllers/tax-class.controller.ts
 * (routes /api/tax-classes; module sales — core).
 *
 * · Writes are OWNER/MANAGER/ADMIN only; every sales role can read
 *   the list (the POS/product forms need it).
 * · DELETE is soft (isActive = false): past sales snapshot the class
 *   name/rate onto their SaleTaxLine rows.
 * · Exactly one class per company is the default: setting a class as
 *   default clears the flag on its siblings in the same write.
 *   Retiring the current default is BLOCKED while other active
 *   classes exist — set another class as default first.
 * Sync: tax_classes is in the cloud pull feed + push map, so writes
 * enqueue via handleDataChange.
 */
const { getDataFilter } = require('../utils/helpers');
const { v4: uuid } = require('uuid');

function registerTaxClassRoutes(app, authMiddleware, deps) {
  const { query, run, saveDatabase, handleDataChange } = deps;

  function requireManager(req, res) {
    const role = String(req.user?.role || '').toUpperCase();
    if (!['OWNER', 'MANAGER', 'ADMIN'].includes(role)) {
      res.status(403).json({ success: false, message: 'Only the owner or a manager can manage tax classes' });
      return false;
    }
    return true;
  }
  function enqueue(entityType, op, row) {
    try { if (typeof handleDataChange === 'function') handleDataChange(entityType, op, row); } catch (e) { console.error('[TaxClasses] sync enqueue failed:', e.message); }
  }
  function shapeTaxClass(r) {
    return { ...r, rate: Number(r.rate) || 0, isDefault: !!r.isDefault, isActive: !!r.isActive };
  }

  app.post('/api/tax-classes', authMiddleware, (req, res) => {
    try {
      if (!requireManager(req, res)) return;
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const b = req.body || {};
      if (!b.name || !String(b.name).trim() || String(b.name).trim().length > 120) return res.status(400).json({ success: false, message: 'Tax class name is required (max 120 characters)' });
      if (typeof b.rate !== 'number' || b.rate < 0 || b.rate > 100) return res.status(400).json({ success: false, message: 'rate must be a number between 0 and 100' });
      const clash = query('SELECT id FROM tax_classes WHERE companyId = ? AND name = ?', [companyFilter, String(b.name).trim()])[0];
      if (clash) return res.status(409).json({ success: false, message: 'A tax class with this name already exists in this business' });
      const id = uuid();
      const now = new Date().toISOString();
      const isDefault = b.isDefault === true;
      if (isDefault) run('UPDATE tax_classes SET isDefault = 0 WHERE companyId = ?', [companyFilter]);
      run(
        'INSERT INTO tax_classes (id, companyId, name, rate, isDefault, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, companyFilter, String(b.name).trim(), b.rate, isDefault ? 1 : 0, b.isActive === undefined ? 1 : (b.isActive ? 1 : 0), now, now]
      );
      saveDatabase();
      const row = query('SELECT * FROM tax_classes WHERE id = ?', [id])[0];
      enqueue('taxClass', 'create', row);
      res.status(201).json({ success: true, data: shapeTaxClass(row) });
    } catch (e) {
      console.error('[TaxClasses] Create error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/tax-classes', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const rows = query('SELECT * FROM tax_classes WHERE companyId = ? ORDER BY isDefault DESC, name ASC', [companyFilter]);
      res.json({ success: true, data: rows.map(shapeTaxClass) });
    } catch (e) {
      console.error('[TaxClasses] List error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/tax-classes/:id', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM tax_classes WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Tax class not found' });
      res.json({ success: true, data: shapeTaxClass(row) });
    } catch (e) {
      console.error('[TaxClasses] Get error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.put('/api/tax-classes/:id', authMiddleware, (req, res) => {
    try {
      if (!requireManager(req, res)) return;
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM tax_classes WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Tax class not found' });
      const b = req.body || {};
      const sets = [];
      const params = [];
      const setStr = (col, v) => { sets.push(`${col} = ?`); params.push(v); };
      if (b.name !== undefined) {
        if (!String(b.name).trim() || String(b.name).trim().length > 120) return res.status(400).json({ success: false, message: 'Tax class name is required (max 120 characters)' });
        const clash = query('SELECT id FROM tax_classes WHERE companyId = ? AND name = ? AND id != ?', [companyFilter, String(b.name).trim(), req.params.id])[0];
        if (clash) return res.status(409).json({ success: false, message: 'A tax class with this name already exists in this business' });
        setStr('name', String(b.name).trim());
      }
      if (b.rate !== undefined) {
        if (typeof b.rate !== 'number' || b.rate < 0 || b.rate > 100) return res.status(400).json({ success: false, message: 'rate must be a number between 0 and 100' });
        setStr('rate', b.rate);
      }
      if (b.isDefault === true) {
        run('UPDATE tax_classes SET isDefault = 0 WHERE companyId = ? AND id != ?', [companyFilter, req.params.id]);
        setStr('isDefault', 1);
      } else if (b.isDefault === false) {
        setStr('isDefault', 0);
      }
      if (b.isActive !== undefined) setStr('isActive', b.isActive ? 1 : 0);
      if (sets.length === 0) return res.status(400).json({ success: false, message: 'No fields to update' });
      setStr('updatedAt', new Date().toISOString());
      params.push(req.params.id);
      run(`UPDATE tax_classes SET ${sets.join(', ')} WHERE id = ?`, params);
      saveDatabase();
      const updated = query('SELECT * FROM tax_classes WHERE id = ?', [req.params.id])[0];
      enqueue('taxClass', 'update', updated);
      res.json({ success: true, data: shapeTaxClass(updated) });
    } catch (e) {
      console.error('[TaxClasses] Update error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // DELETE = soft retire (OWNER/MANAGER/ADMIN). Retiring the current
  // default is blocked while other active classes exist.
  app.delete('/api/tax-classes/:id', authMiddleware, (req, res) => {
    try {
      if (!requireManager(req, res)) return;
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM tax_classes WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Tax class not found' });
      if (!row.isActive) return res.status(400).json({ success: false, message: 'This tax class is already inactive', code: 'TAX_CLASS_INACTIVE' });
      if (row.isDefault) {
        const others = query('SELECT id FROM tax_classes WHERE companyId = ? AND isActive = 1 AND id != ?', [companyFilter, req.params.id]);
        if (others.length > 0) {
          return res.status(400).json({ success: false, message: 'Set another tax class as default before retiring the current default', code: 'DEFAULT_TAX_CLASS_REQUIRED' });
        }
      }
      run('UPDATE tax_classes SET isActive = 0, updatedAt = ? WHERE id = ?', [new Date().toISOString(), req.params.id]);
      saveDatabase();
      const updated = query('SELECT * FROM tax_classes WHERE id = ?', [req.params.id])[0];
      enqueue('taxClass', 'update', updated);
      res.json({ success: true, data: shapeTaxClass(updated), message: 'Tax class retired' });
    } catch (e) {
      console.error('[TaxClasses] Delete error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });
}

module.exports = { registerTaxClassRoutes };
