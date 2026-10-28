/**
 * Controlled / narcotics register — embedded port of
 * backend-zapeera-v1-main/src/controllers/controlled-medicines.controller.ts
 * (routes /api/controlled-medicines; module reports — core).
 *
 * READ + REVERSAL ONLY. There is deliberately no update/delete for
 * log rows: the register is append-only and corrections are REVERSAL
 * rows. Viewing is OWNER/MANAGER only (the cloud gates on
 * checkPermission('reports.read'); the desktop has no per-grant
 * roles, and OWNER/MANAGER is the reports-read population here).
 * DISPENSE rows are written by the sale engine (routes/sales.routes.js
 * hook, mirroring the cloud's sale-time append). Until a sale of a
 * controlled product happens on this terminal the register is empty —
 * that is expected, not a bug.
 * LOCAL-ONLY (no cloud sync): controlled_dispense_logs is not in the
 * cloud pull feed / push map yet.
 */
const { getDataFilter } = require('../utils/helpers');
const { appendReversalEntry, summarizeRegisterEntries } = require('../utils/controlled-register');

function registerControlledMedicinesRoutes(app, authMiddleware, deps) {
  const { query, run, saveDatabase } = deps;

  function requireManager(req, res) {
    const role = String(req.user?.role || '').toUpperCase();
    if (!['OWNER', 'MANAGER', 'ADMIN'].includes(role)) {
      res.status(403).json({ success: false, message: 'Only the owner or a manager can view the controlled register' });
      return false;
    }
    return true;
  }
  function pageParams(req, def = 50) {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || def));
    return { page, limit, offset: (page - 1) * limit };
  }
  function registerWhere(req, companyFilter) {
    const where = ['companyId = ?'];
    const params = [companyFilter];
    const q = req.query;
    if (q.branchId) { where.push('branchId = ?'); params.push(String(q.branchId)); }
    if (q.productId) { where.push('productId = ?'); params.push(String(q.productId)); }
    if (q.batchId) { where.push('batchId = ?'); params.push(String(q.batchId)); }
    if (q.staffUserId) { where.push('staffUserId = ?'); params.push(String(q.staffUserId)); }
    if (q.entryType === 'DISPENSE' || q.entryType === 'REVERSAL') { where.push('entryType = ?'); params.push(q.entryType); }
    const start = q.startDate || q.from;
    const end = q.endDate || q.to;
    if (start) { where.push('createdAt >= ?'); params.push(new Date(String(start)).toISOString()); }
    if (end) { const d = new Date(String(end)); d.setHours(23, 59, 59, 999); where.push('createdAt <= ?'); params.push(d.toISOString()); }
    return { where: where.join(' AND '), params };
  }
  function serializeEntry(row) {
    const product = row.productId ? query('SELECT id, name, controlledSchedule, isControlled FROM products WHERE id = ?', [row.productId])[0] : null;
    const batch = row.batchId ? query('SELECT id, batchNo, expireDate FROM batches WHERE id = ?', [row.batchId])[0] : null;
    const sale = row.saleId ? query('SELECT id, invoiceNumber FROM sales WHERE id = ?', [row.saleId])[0] : null;
    return {
      ...row,
      product: product ? { ...product, isControlled: !!product.isControlled } : null,
      batch: batch || null,
      sale: sale || null
    };
  }
  function withProductNames(rows) {
    return rows.map((r) => {
      const p = r.productId ? query('SELECT name FROM products WHERE id = ?', [r.productId])[0] : null;
      return { ...r, productName: p ? p.name : null };
    });
  }

  // GET /api/controlled-medicines — register + per-product/batch summary over the SAME filter
  app.get('/api/controlled-medicines', authMiddleware, (req, res) => {
    try {
      if (!requireManager(req, res)) return;
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const { page, limit, offset } = pageParams(req);
      const { where, params } = registerWhere(req, companyFilter);
      const total = query(`SELECT COUNT(*) AS c FROM controlled_dispense_logs WHERE ${where}`, params)[0].c;
      const rows = query(`SELECT * FROM controlled_dispense_logs WHERE ${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
      const allFiltered = query(`SELECT * FROM controlled_dispense_logs WHERE ${where} ORDER BY createdAt ASC`, params);
      const summary = summarizeRegisterEntries(withProductNames(allFiltered));
      res.json({ success: true, data: { entries: rows.map(serializeEntry), summary, pagination: { page, limit, total, pages: Math.ceil(total / limit) } } });
    } catch (e) {
      console.error('[Controlled] Register error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // GET /api/controlled-medicines/audit/staff — per-staff totals
  app.get('/api/controlled-medicines/audit/staff', authMiddleware, (req, res) => {
    try {
      if (!requireManager(req, res)) return;
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const { where, params } = registerWhere(req, companyFilter);
      const entries = query(`SELECT * FROM controlled_dispense_logs WHERE ${where} ORDER BY createdAt ASC`, params);
      const byStaff = new Map();
      for (const e of entries) {
        const key = e.staffUserId || 'unknown';
        let row = byStaff.get(key);
        if (!row) {
          row = { staffUserId: key, staffName: e.staffName || null, totalDispensed: 0, totalReversed: 0, netDispensed: 0, entryCount: 0, dispenseCount: 0, reversalCount: 0, lastEntryAt: null };
          byStaff.set(key, row);
        }
        if (e.quantity > 0) { row.totalDispensed += e.quantity; row.dispenseCount += 1; }
        else { row.totalReversed += Math.abs(e.quantity); row.reversalCount += 1; }
        row.netDispensed = row.totalDispensed - row.totalReversed;
        row.entryCount += 1;
        row.lastEntryAt = new Date(e.createdAt).toISOString();
        if (e.staffName && !row.staffName) row.staffName = e.staffName;
      }
      for (const row of byStaff.values()) {
        if (!row.staffName && row.staffUserId !== 'unknown') {
          const u = query('SELECT name FROM users WHERE id = ?', [row.staffUserId])[0];
          row.staffName = u ? u.name : null;
        }
      }
      const staff = [...byStaff.values()].sort((a, b) => b.netDispensed - a.netDispensed);
      res.json({
        success: true,
        data: {
          staff,
          totals: {
            totalDispensed: staff.reduce((s, r) => s + r.totalDispensed, 0),
            totalReversed: staff.reduce((s, r) => s + r.totalReversed, 0),
            netDispensed: staff.reduce((s, r) => s + r.netDispensed, 0),
            entryCount: staff.reduce((s, r) => s + r.entryCount, 0)
          }
        }
      });
    } catch (e) {
      console.error('[Controlled] Staff audit error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // GET /api/controlled-medicines/inspection-pack — the inspector's pack
  app.get('/api/controlled-medicines/inspection-pack', authMiddleware, (req, res) => {
    try {
      if (!requireManager(req, res)) return;
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const { where, params } = registerWhere(req, companyFilter);
      const entries = query(`SELECT * FROM controlled_dispense_logs WHERE ${where} ORDER BY createdAt ASC LIMIT 10000`, params);
      const business = query('SELECT id, name FROM companies WHERE id = ?', [companyFilter])[0];
      const branchIds = [...new Set(entries.map((e) => String(e.branchId)).filter(Boolean))];
      const branches = branchIds.map((id) => query('SELECT id, name FROM branches WHERE id = ?', [id])[0]).filter(Boolean);
      const summary = summarizeRegisterEntries(withProductNames(entries));
      const staffRows = entries.reduce((acc, e) => {
        const key = e.staffUserId || 'unknown';
        acc[key] = acc[key] || { staffUserId: key, staffName: e.staffName || null, totalDispensed: 0, totalReversed: 0, netDispensed: 0, entryCount: 0 };
        if (e.quantity > 0) acc[key].totalDispensed += e.quantity;
        else acc[key].totalReversed += Math.abs(e.quantity);
        acc[key].netDispensed = acc[key].totalDispensed - acc[key].totalReversed;
        acc[key].entryCount += 1;
        return acc;
      }, {});
      const pack = {
        business: business ? { id: business.id, name: business.name } : null,
        branches,
        period: { from: req.query.startDate || req.query.from || null, to: req.query.endDate || req.query.to || null },
        entries: entries.map(serializeEntry),
        summary,
        staffTotals: Object.values(staffRows)
      };
      if (req.query.format === 'csv') {
        const esc = (v) => {
          const text = v === null || v === undefined ? '' : String(v);
          return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        };
        const header = ['createdAt', 'entryType', 'productName', 'batchNo', 'quantity', 'balanceAfter', 'staffName', 'customerName', 'prescriptionRef', 'invoiceNumber', 'reason'].join(',');
        const lines = pack.entries.map((e) => [e.createdAt, e.entryType, e.product ? e.product.name : '', e.batchNo || '', e.quantity, e.balanceAfter, e.staffName || '', e.customerName || '', e.prescriptionRef || '', e.invoiceNumber || '', e.reason || ''].map(esc).join(','));
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="controlled-register.csv"');
        return res.send([header, ...lines].join('\n'));
      }
      res.json({ success: true, data: pack });
    } catch (e) {
      console.error('[Controlled] Inspection pack error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // POST /api/controlled-medicines/reversals — append a REVERSAL row
  app.post('/api/controlled-medicines/reversals', authMiddleware, (req, res) => {
    try {
      if (!requireManager(req, res)) return;
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const b = req.body || {};
      if (!b.originalEntryId || !Number.isInteger(b.quantity) || b.quantity < 1 || !b.reason || !String(b.reason).trim()) {
        return res.status(400).json({ success: false, message: 'originalEntryId, a positive whole-number quantity and a reason are required' });
      }
      try {
        const reversal = appendReversalEntry({ query, run }, {
          companyId: companyFilter,
          branchId: null,
          originalEntryId: b.originalEntryId,
          quantity: b.quantity,
          reason: b.reason,
          staffUserId: req.user?.id || null,
          staffName: req.user?.name || req.user?.fullName || null
        });
        saveDatabase();
        res.status(201).json({ success: true, data: serializeEntry(reversal) });
      } catch (e) {
        if (e.statusCode) return res.status(e.statusCode).json({ success: false, message: e.message });
        throw e;
      }
    } catch (e) {
      console.error('[Controlled] Reversal error:', e.message);
      res.status(500).json({ success: false, message: e.message || 'Internal server error' });
    }
  });

  // GET /api/controlled-medicines/:id — one entry
  app.get('/api/controlled-medicines/:id', authMiddleware, (req, res) => {
    try {
      if (!requireManager(req, res)) return;
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM controlled_dispense_logs WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Register entry not found' });
      res.json({ success: true, data: serializeEntry(row) });
    } catch (e) {
      console.error('[Controlled] Get entry error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });
}

module.exports = { registerControlledMedicinesRoutes };
