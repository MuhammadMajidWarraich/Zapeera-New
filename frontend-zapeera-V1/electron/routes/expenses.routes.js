/**
 * Expenses — embedded port of
 * backend-zapeera-v1-main/src/controllers/expense.controller.ts
 * (routes /api/expenses + /api/expense-categories; module expenses —
 * core, applies to all business types).
 *
 * LOCAL-ONLY (no cloud sync): expenses / expense_categories are not
 * in the cloud pull feed / push map yet — rows are created/read here
 * only until the feed + push map gain them.
 * Serialization mirrors the cloud: `category` is the plain category
 * name string (or 'Uncategorized'), `categoryRef` carries the
 * {id, name} object, `date` is the YYYY-MM-DD of expenseDate.
 */
const { getDataFilter } = require('../utils/helpers');
const { v4: uuid } = require('uuid');

const EXPENSE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];
const EXPENSE_PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'MOBILE_WALLET', 'OTHER'];

function registerExpenseRoutes(app, authMiddleware, deps) {
  const { query, run, saveDatabase } = deps;

  function nullIfEmpty(v) {
    if (v === undefined || v === null) return null;
    const t = String(v).trim();
    return t === '' ? null : t;
  }
  function toDateOnly(value) {
    if (!value) return null;
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function serializeExpense(row) {
    const category = row.categoryId ? query('SELECT id, name FROM expense_categories WHERE id = ?', [row.categoryId])[0] : null;
    const branch = row.branchId ? query('SELECT id, name FROM branches WHERE id = ?', [row.branchId])[0] : null;
    return {
      ...row,
      amount: Number(row.amount) || 0,
      categoryRef: category || null,
      category: category ? category.name : 'Uncategorized',
      date: toDateOnly(row.expenseDate),
      branch: branch || null
    };
  }
  function pageParams(req, def = 200) {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit, 10) || def));
    return { page, limit, offset: (page - 1) * limit };
  }

  // ── Categories ────────────────────────────────────────────────
  app.get('/api/expense-categories', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const where = ['companyId = ?'];
      const params = [companyFilter];
      if (req.query.branchId) { where.push('(branchId = ? OR branchId IS NULL)'); params.push(String(req.query.branchId)); }
      if (req.query.isActive !== undefined) { where.push('isActive = ?'); params.push(req.query.isActive === 'true' ? 1 : 0); }
      const rows = query(`SELECT * FROM expense_categories WHERE ${where.join(' AND ')} ORDER BY name ASC`, params);
      res.json({ success: true, data: rows.map((r) => ({ ...r, isActive: !!r.isActive })) });
    } catch (e) {
      console.error('[Expenses] Get categories error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post('/api/expense-categories', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const b = req.body || {};
      if (!b.name || !String(b.name).trim() || String(b.name).trim().length > 120) return res.status(400).json({ success: false, message: 'Category name is required (max 120 characters)' });
      if (b.branchId && !query('SELECT id FROM branches WHERE id = ? AND companyId = ?', [b.branchId, companyFilter])[0]) {
        return res.status(400).json({ success: false, message: 'Branch not found in this business' });
      }
      const dup = query('SELECT id FROM expense_categories WHERE companyId = ? AND name = ? AND (branchId IS ? OR branchId = ?)', [companyFilter, String(b.name).trim(), b.branchId || null, b.branchId || null])[0];
      if (dup) return res.status(409).json({ success: false, message: 'A category with this name already exists in this scope' });
      const id = uuid();
      const now = new Date().toISOString();
      run(
        'INSERT INTO expense_categories (id, name, description, companyId, branchId, isActive, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, String(b.name).trim(), nullIfEmpty(b.description), companyFilter, b.branchId || null, b.isActive === undefined ? 1 : (b.isActive ? 1 : 0), req.user?.id || null, now, now]
      );
      saveDatabase();
      const row = query('SELECT * FROM expense_categories WHERE id = ?', [id])[0];
      res.status(201).json({ success: true, data: { ...row, isActive: !!row.isActive } });
    } catch (e) {
      console.error('[Expenses] Create category error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.put('/api/expense-categories/:id', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM expense_categories WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Expense category not found' });
      const b = req.body || {};
      const sets = [];
      const params = [];
      const setStr = (col, v) => { sets.push(`${col} = ?`); params.push(v); };
      if (b.name !== undefined) {
        if (!String(b.name).trim() || String(b.name).trim().length > 120) return res.status(400).json({ success: false, message: 'Category name is required (max 120 characters)' });
        setStr('name', String(b.name).trim());
      }
      if (b.description !== undefined) setStr('description', nullIfEmpty(b.description));
      if (b.branchId !== undefined) {
        if (b.branchId && !query('SELECT id FROM branches WHERE id = ? AND companyId = ?', [b.branchId, companyFilter])[0]) return res.status(400).json({ success: false, message: 'Branch not found in this business' });
        setStr('branchId', b.branchId || null);
      }
      if (b.isActive !== undefined) setStr('isActive', b.isActive ? 1 : 0);
      if (sets.length === 0) return res.status(400).json({ success: false, message: 'No fields to update' });
      setStr('updatedAt', new Date().toISOString());
      params.push(req.params.id);
      run(`UPDATE expense_categories SET ${sets.join(', ')} WHERE id = ?`, params);
      saveDatabase();
      const updated = query('SELECT * FROM expense_categories WHERE id = ?', [req.params.id])[0];
      res.json({ success: true, data: { ...updated, isActive: !!updated.isActive } });
    } catch (e) {
      console.error('[Expenses] Update category error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.delete('/api/expense-categories/:id', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM expense_categories WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Expense category not found' });
      const inUse = query('SELECT id FROM expenses WHERE categoryId = ? LIMIT 1', [req.params.id])[0];
      if (inUse) return res.status(409).json({ success: false, message: 'This category is used by expenses and cannot be deleted — deactivate it instead' });
      run('DELETE FROM expense_categories WHERE id = ?', [req.params.id]);
      saveDatabase();
      res.json({ success: true, data: { id: req.params.id } });
    } catch (e) {
      console.error('[Expenses] Delete category error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // ── Expenses ──────────────────────────────────────────────────
  app.get('/api/expenses', authMiddleware, (req, res) => {
    try {
      const { companyFilter, branchFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const { page, limit, offset } = pageParams(req);
      const where = ['companyId = ?'];
      const params = [companyFilter];
      const branchId = req.query.branchId || branchFilter || null;
      if (branchId) { where.push('branchId = ?'); params.push(branchId); }
      if (req.query.categoryId) { where.push('categoryId = ?'); params.push(String(req.query.categoryId)); }
      const statusValue = String(req.query.status || '').toUpperCase();
      if (EXPENSE_STATUSES.includes(statusValue)) { where.push('status = ?'); params.push(statusValue); }
      const rangeStart = req.query.startDate || req.query.from;
      const rangeEnd = req.query.endDate || req.query.to;
      if (rangeStart) { where.push('expenseDate >= ?'); params.push(new Date(String(rangeStart)).toISOString()); }
      if (rangeEnd) { const d = new Date(String(rangeEnd)); d.setHours(23, 59, 59, 999); where.push('expenseDate <= ?'); params.push(d.toISOString()); }
      if (req.query.search) {
        const s = `%${req.query.search}%`;
        where.push('(title LIKE ? OR vendor LIKE ? OR description LIKE ? OR reference LIKE ?)'); params.push(s, s, s, s);
      }
      const whereSql = where.join(' AND ');
      const total = query(`SELECT COUNT(*) AS c FROM expenses WHERE ${whereSql}`, params)[0].c;
      const rows = query(`SELECT * FROM expenses WHERE ${whereSql} ORDER BY expenseDate DESC, createdAt DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
      const totalAggregate = query(`SELECT COALESCE(SUM(amount), 0) AS total FROM expenses WHERE ${whereSql}`, params)[0].total;
      const grouped = query(`SELECT categoryId, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS count FROM expenses WHERE ${whereSql} GROUP BY categoryId`, params);
      const byCategory = grouped.map((g) => {
        const cat = g.categoryId ? query('SELECT name FROM expense_categories WHERE id = ?', [g.categoryId])[0] : null;
        return { categoryId: g.categoryId || null, category: cat ? cat.name : 'Uncategorized', total: Math.round((Number(g.total) || 0) * 100) / 100, count: g.count };
      });
      res.json({
        success: true,
        data: {
          expenses: rows.map(serializeExpense),
          pagination: { page, limit, total, pages: Math.ceil(total / limit) },
          summary: { totalExpenses: Math.round((Number(totalAggregate) || 0) * 100) / 100, byCategory }
        }
      });
    } catch (e) {
      console.error('[Expenses] Get expenses error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/expenses/:id', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM expenses WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Expense not found' });
      res.json({ success: true, data: serializeExpense(row) });
    } catch (e) {
      console.error('[Expenses] Get expense error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post('/api/expenses', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const b = req.body || {};
      if (typeof b.amount !== 'number' || b.amount <= 0) return res.status(400).json({ success: false, message: 'amount must be a positive number' });
      if (!b.expenseDate) return res.status(400).json({ success: false, message: 'expenseDate is required' });
      if (b.title !== undefined && b.title !== null && String(b.title).length > 200) return res.status(400).json({ success: false, message: 'title cannot exceed 200 characters' });
      const paymentMethod = b.paymentMethod || 'CASH';
      if (!EXPENSE_PAYMENT_METHODS.includes(paymentMethod)) return res.status(400).json({ success: false, message: `paymentMethod must be one of: ${EXPENSE_PAYMENT_METHODS.join(', ')}` });
      const status = b.status || 'PENDING';
      if (!EXPENSE_STATUSES.includes(status)) return res.status(400).json({ success: false, message: `status must be one of: ${EXPENSE_STATUSES.join(', ')}` });
      if (b.categoryId) {
        if (!query('SELECT id FROM expense_categories WHERE id = ? AND companyId = ?', [b.categoryId, companyFilter])[0]) return res.status(404).json({ success: false, message: 'Expense category not found' });
      }
      const branchId = b.branchId || req.user?.selectedBranchId || null;
      if (branchId && !query('SELECT id FROM branches WHERE id = ? AND companyId = ?', [branchId, companyFilter])[0]) {
        return res.status(400).json({ success: false, message: 'Branch not found in this business' });
      }
      const id = uuid();
      const now = new Date().toISOString();
      run(
        'INSERT INTO expenses (id, title, description, vendor, amount, expenseDate, paymentMethod, reference, status, companyId, branchId, categoryId, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, b.title ? String(b.title).trim() : null, nullIfEmpty(b.description), nullIfEmpty(b.vendor), b.amount, new Date(b.expenseDate).toISOString(), paymentMethod, nullIfEmpty(b.reference), status, companyFilter, branchId, b.categoryId || null, req.user?.id || null, now, now]
      );
      saveDatabase();
      const row = query('SELECT * FROM expenses WHERE id = ?', [id])[0];
      res.status(201).json({ success: true, data: serializeExpense(row) });
    } catch (e) {
      console.error('[Expenses] Create expense error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.put('/api/expenses/:id', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM expenses WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Expense not found' });
      const b = req.body || {};
      const sets = [];
      const params = [];
      const setStr = (col, v) => { sets.push(`${col} = ?`); params.push(v); };
      if (b.title !== undefined) {
        if (b.title !== null && String(b.title).length > 200) return res.status(400).json({ success: false, message: 'title cannot exceed 200 characters' });
        setStr('title', b.title ? String(b.title).trim() : null);
      }
      if (b.description !== undefined) setStr('description', nullIfEmpty(b.description));
      if (b.vendor !== undefined) setStr('vendor', nullIfEmpty(b.vendor));
      if (b.amount !== undefined) {
        if (typeof b.amount !== 'number' || b.amount <= 0) return res.status(400).json({ success: false, message: 'amount must be a positive number' });
        setStr('amount', b.amount);
      }
      if (b.expenseDate !== undefined) setStr('expenseDate', new Date(b.expenseDate).toISOString());
      if (b.paymentMethod !== undefined) {
        if (!EXPENSE_PAYMENT_METHODS.includes(b.paymentMethod)) return res.status(400).json({ success: false, message: `paymentMethod must be one of: ${EXPENSE_PAYMENT_METHODS.join(', ')}` });
        setStr('paymentMethod', b.paymentMethod);
      }
      if (b.reference !== undefined) setStr('reference', nullIfEmpty(b.reference));
      if (b.status !== undefined) {
        if (!EXPENSE_STATUSES.includes(b.status)) return res.status(400).json({ success: false, message: `status must be one of: ${EXPENSE_STATUSES.join(', ')}` });
        setStr('status', b.status);
      }
      if (b.categoryId !== undefined) {
        if (b.categoryId && !query('SELECT id FROM expense_categories WHERE id = ? AND companyId = ?', [b.categoryId, companyFilter])[0]) return res.status(404).json({ success: false, message: 'Expense category not found' });
        setStr('categoryId', b.categoryId || null);
      }
      if (b.branchId !== undefined) {
        if (b.branchId && !query('SELECT id FROM branches WHERE id = ? AND companyId = ?', [b.branchId, companyFilter])[0]) return res.status(400).json({ success: false, message: 'Branch not found in this business' });
        setStr('branchId', b.branchId || null);
      }
      if (sets.length === 0) return res.status(400).json({ success: false, message: 'No fields to update' });
      setStr('updatedAt', new Date().toISOString());
      params.push(req.params.id);
      run(`UPDATE expenses SET ${sets.join(', ')} WHERE id = ?`, params);
      saveDatabase();
      const updated = query('SELECT * FROM expenses WHERE id = ?', [req.params.id])[0];
      res.json({ success: true, data: serializeExpense(updated) });
    } catch (e) {
      console.error('[Expenses] Update expense error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.delete('/api/expenses/:id', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM expenses WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Expense not found' });
      run('DELETE FROM expenses WHERE id = ?', [req.params.id]);
      saveDatabase();
      res.json({ success: true, data: { id: req.params.id } });
    } catch (e) {
      console.error('[Expenses] Delete expense error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });
}

module.exports = { registerExpenseRoutes };
