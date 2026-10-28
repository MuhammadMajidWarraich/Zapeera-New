/**
 * Prescriptions Routes (embedded port)
 * Port of the cloud prescriptions list
 * (backend-zapeera-v1-main/src/controllers/prescription.controller.ts
 * getPrescriptions).
 *
 * FIX 2026-10-28: the desktop Prescriptions page had no embedded backing —
 * GET /api/prescriptions 404'd on the embedded server. Same filters,
 * ordering and response shape as the cloud (company-scoped; the cloud list
 * does not branch-filter). Each row carries its items (createdAt asc) and
 * _count.sales (sales dispensed against the prescription).
 */

function registerPrescriptionsRoutes(app, authMiddleware, deps) {
  const { query, run, saveDatabase, handleDataChange, getDataFilter } = deps;
  const { requireModule } = require('../utils/module-applicability');
  const { v4: uuid } = require('uuid');
  const gatePrescriptions = requireModule('prescriptions', { query, getDataFilter });

  function nullIfEmpty(v) {
    if (v === undefined || v === null) return null;
    const t = String(v).trim();
    return t === '' ? null : t;
  }
  function requireManager(req, res, action) {
    const role = String(req.user?.role || '').toUpperCase();
    if (!['OWNER', 'MANAGER', 'ADMIN'].includes(role)) {
      res.status(403).json({ success: false, message: `Only the owner or a manager can ${action}` });
      return false;
    }
    return true;
  }
  function enqueue(entityType, op, row) {
    try { if (typeof handleDataChange === 'function') handleDataChange(entityType, op, row); } catch (e) { console.error('[Prescriptions] sync enqueue failed:', e.message); }
  }
  function shapePrescription(p) {
    const items = query('SELECT * FROM prescription_items WHERE prescriptionId = ? ORDER BY createdAt ASC', [p.id]);
    const salesCount = query('SELECT COUNT(*) as c FROM sales WHERE prescriptionId = ?', [p.id])[0]?.c || 0;
    return { ...p, items, _count: { sales: Number(salesCount) || 0 } };
  }
  function validateItems(items, companyFilter) {
    if (!Array.isArray(items) || items.length === 0) return { ok: false, message: 'At least one item is required' };
    const productsById = new Map();
    for (const item of items) {
      if (!item.productId || typeof item.quantity !== 'number' || item.quantity <= 0) {
        return { ok: false, message: 'Each item must include productId and a positive quantity' };
      }
      if (item.dosage !== undefined && item.dosage !== null && String(item.dosage).length > 60) return { ok: false, message: 'dosage cannot exceed 60 characters' };
      if (item.durationDays !== undefined && item.durationDays !== null && (!Number.isInteger(item.durationDays) || item.durationDays < 1 || item.durationDays > 3650)) {
        return { ok: false, message: 'durationDays must be an integer between 1 and 3650' };
      }
      const p = query('SELECT id, name FROM products WHERE id = ? AND companyId = ?', [item.productId, companyFilter])[0];
      if (!p) return { ok: false, message: 'One or more prescription items refer to a product that does not exist in this business' };
      productsById.set(item.productId, p);
    }
    return { ok: true, productsById };
  }
  function insertItems(prescriptionId, items, productsById, now) {
    for (const item of items) {
      run(
        'INSERT INTO prescription_items (id, prescriptionId, productId, productName, quantity, dosage, durationDays, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [uuid(), prescriptionId, item.productId, productsById.get(item.productId).name || '', item.quantity, item.dosage ? String(item.dosage).trim() : null, item.durationDays ?? null, now, now]
      );
    }
  }

  // GET /api/prescriptions
  app.get('/api/prescriptions', authMiddleware, gatePrescriptions, (req, res) => {
    try {
      const { page = 1, limit = 20, search, productId, from, to, isActive, reviewStatus, source } = req.query;

      // Company scope (mirrors the cloud's resolvePrescriptionCompanyId)
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);

      let sql = 'SELECT * FROM prescriptions WHERE 1=1';
      const params = [];
      if (companyFilter) { sql += ' AND companyId = ?'; params.push(companyFilter); }
      if (isActive !== undefined) { sql += ' AND isActive = ?'; params.push(String(isActive) === 'true' ? 1 : 0); }
      if (reviewStatus === 'PENDING' || reviewStatus === 'REVIEWED' || reviewStatus === 'REJECTED') {
        sql += ' AND reviewStatus = ?'; params.push(String(reviewStatus));
      }
      if (source === 'STAFF' || source === 'ONLINE_UPLOAD') {
        sql += ' AND source = ?'; params.push(String(source));
      }
      if (search) {
        sql += ' AND (patientName LIKE ? OR patientPhone LIKE ?)';
        params.push(`%${search}%`, `%${search}%`);
      }
      if (productId) {
        sql += ' AND EXISTS (SELECT 1 FROM prescription_items pi WHERE pi.prescriptionId = prescriptions.id AND pi.productId = ?)';
        params.push(String(productId));
      }
      if (from) { sql += ' AND issuedDate >= ?'; params.push(String(from)); }
      if (to) { sql += ' AND issuedDate <= ?'; params.push(`${String(to)}T23:59:59.999`); }

      const total = query(`SELECT COUNT(*) as c FROM (${sql})` , params)[0]?.c || 0;

      const pageNum = Number(page) || 1;
      const limitNum = Number(limit) || 20;
      const offset = (pageNum - 1) * limitNum;
      const rows = query(`${sql} ORDER BY issuedDate DESC LIMIT ${limitNum} OFFSET ${offset}`, params);

      const prescriptions = rows.map((p) => {
        const items = query('SELECT * FROM prescription_items WHERE prescriptionId = ? ORDER BY createdAt ASC', [p.id]);
        const salesCount = query('SELECT COUNT(*) as c FROM sales WHERE prescriptionId = ?', [p.id])[0]?.c || 0;
        return {
          ...p,
          items,
          _count: { sales: Number(salesCount) || 0 }
        };
      });

      return res.json({
        success: true,
        data: prescriptions,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: Number(total) || 0,
          pages: Math.ceil((Number(total) || 0) / limitNum)
        }
      });
    } catch (e) {
      console.error('[Prescriptions] GET error:', e.message);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // POST /api/prescriptions — staff-entered prescription (source STAFF)
  app.post('/api/prescriptions', authMiddleware, gatePrescriptions, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const b = req.body || {};
      if (!b.patientName || !String(b.patientName).trim() || String(b.patientName).trim().length > 160) return res.status(400).json({ success: false, message: 'patientName is required (max 160 characters)' });
      if (!b.issuedDate) return res.status(400).json({ success: false, message: 'issuedDate is required' });
      if (b.patientPhone !== undefined && b.patientPhone !== null && String(b.patientPhone).length > 40) return res.status(400).json({ success: false, message: 'patientPhone cannot exceed 40 characters' });
      if (b.doctorName !== undefined && b.doctorName !== null && String(b.doctorName).length > 160) return res.status(400).json({ success: false, message: 'doctorName cannot exceed 160 characters' });
      if (b.doctorReg !== undefined && b.doctorReg !== null && String(b.doctorReg).length > 80) return res.status(400).json({ success: false, message: 'doctorReg cannot exceed 80 characters' });
      if (b.notes !== undefined && b.notes !== null && String(b.notes).length > 1000) return res.status(400).json({ success: false, message: 'notes cannot exceed 1000 characters' });
      if (b.imageUrl !== undefined && b.imageUrl !== null && String(b.imageUrl).length > 7000000) return res.status(400).json({ success: false, message: 'imageUrl is too large' });
      const itemsCheck = validateItems(b.items, companyFilter);
      if (!itemsCheck.ok) return res.status(400).json({ success: false, message: itemsCheck.message });
      let branchId = b.branchId ? String(b.branchId) : (req.user?.selectedBranchId ? String(req.user.selectedBranchId) : null);
      if (branchId && !query('SELECT id FROM branches WHERE id = ? AND companyId = ?', [branchId, companyFilter])[0]) {
        return res.status(400).json({ success: false, message: 'Branch not found in this business' });
      }
      const id = uuid();
      const now = new Date().toISOString();
      run(
        'INSERT INTO prescriptions (id, companyId, branchId, patientName, patientPhone, doctorName, doctorReg, notes, imageUrl, issuedDate, reviewStatus, source, isActive, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, companyFilter, branchId, String(b.patientName).trim(), nullIfEmpty(b.patientPhone), nullIfEmpty(b.doctorName), nullIfEmpty(b.doctorReg), nullIfEmpty(b.notes), nullIfEmpty(b.imageUrl), new Date(b.issuedDate).toISOString(), 'REVIEWED', 'STAFF', 1, req.user?.id || null, now, now]
      );
      insertItems(id, b.items, itemsCheck.productsById, now);
      saveDatabase();
      const row = query('SELECT * FROM prescriptions WHERE id = ?', [id])[0];
      enqueue('prescription', 'create', row);
      res.status(201).json({ success: true, data: shapePrescription(row), message: 'Prescription created successfully' });
    } catch (e) {
      console.error('[Prescriptions] Create error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // GET /api/prescriptions/:id
  app.get('/api/prescriptions/:id', authMiddleware, gatePrescriptions, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM prescriptions WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Prescription not found' });
      res.json({ success: true, data: shapePrescription(row) });
    } catch (e) {
      console.error('[Prescriptions] Get error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // PUT /api/prescriptions/:id — line set is REPLACED wholesale when items are sent
  app.put('/api/prescriptions/:id', authMiddleware, gatePrescriptions, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM prescriptions WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Prescription not found' });
      const b = req.body || {};
      if (Object.keys(b).length === 0) return res.status(400).json({ success: false, message: 'No fields to update' });
      let itemsCheck = null;
      if (b.items !== undefined) {
        itemsCheck = validateItems(b.items, companyFilter);
        if (!itemsCheck.ok) return res.status(400).json({ success: false, message: itemsCheck.message });
      }
      const sets = [];
      const params = [];
      const setStr = (col, v) => { sets.push(`${col} = ?`); params.push(v); };
      if (b.patientName !== undefined) {
        if (!String(b.patientName).trim() || String(b.patientName).trim().length > 160) return res.status(400).json({ success: false, message: 'patientName is required (max 160 characters)' });
        setStr('patientName', String(b.patientName).trim());
      }
      if (b.patientPhone !== undefined) setStr('patientPhone', nullIfEmpty(b.patientPhone));
      if (b.doctorName !== undefined) setStr('doctorName', nullIfEmpty(b.doctorName));
      if (b.doctorReg !== undefined) setStr('doctorReg', nullIfEmpty(b.doctorReg));
      if (b.notes !== undefined) setStr('notes', nullIfEmpty(b.notes));
      if (b.imageUrl !== undefined) setStr('imageUrl', nullIfEmpty(b.imageUrl));
      if (b.issuedDate !== undefined) setStr('issuedDate', new Date(b.issuedDate).toISOString());
      if (b.branchId !== undefined) {
        if (b.branchId && !query('SELECT id FROM branches WHERE id = ? AND companyId = ?', [b.branchId, companyFilter])[0]) return res.status(400).json({ success: false, message: 'Branch not found in this business' });
        setStr('branchId', b.branchId || null);
      }
      const now = new Date().toISOString();
      if (sets.length > 0) {
        setStr('updatedAt', now);
        params.push(req.params.id);
        run(`UPDATE prescriptions SET ${sets.join(', ')} WHERE id = ?`, params);
      }
      if (itemsCheck) {
        run('DELETE FROM prescription_items WHERE prescriptionId = ?', [req.params.id]);
        insertItems(req.params.id, b.items, itemsCheck.productsById, now);
      }
      saveDatabase();
      const updated = query('SELECT * FROM prescriptions WHERE id = ?', [req.params.id])[0];
      enqueue('prescription', 'update', updated);
      res.json({ success: true, data: shapePrescription(updated), message: 'Prescription updated successfully' });
    } catch (e) {
      console.error('[Prescriptions] Update error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // PATCH /api/prescriptions/:id/review — pharmacist review (OWNER/MANAGER/ADMIN)
  app.patch('/api/prescriptions/:id/review', authMiddleware, gatePrescriptions, (req, res) => {
    try {
      if (!requireManager(req, res, 'review a prescription')) return;
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM prescriptions WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Prescription not found' });
      if (!row.isActive) return res.status(400).json({ success: false, message: 'A voided prescription can no longer be reviewed', code: 'PRESCRIPTION_VOIDED' });
      const b = req.body || {};
      if (b.decision !== 'REVIEWED' && b.decision !== 'REJECTED') return res.status(400).json({ success: false, message: "decision must be REVIEWED or REJECTED" });
      if (b.note !== undefined && b.note !== null && String(b.note).length > 500) return res.status(400).json({ success: false, message: 'note cannot exceed 500 characters' });
      let itemsCheck = null;
      if (b.items !== undefined) {
        itemsCheck = validateItems(b.items, companyFilter);
        if (!itemsCheck.ok) return res.status(400).json({ success: false, message: itemsCheck.message });
      }
      const existingItems = query('SELECT id FROM prescription_items WHERE prescriptionId = ?', [req.params.id]);
      if (b.decision === 'REVIEWED' && !itemsCheck && existingItems.length === 0) {
        return res.status(400).json({ success: false, message: 'This prescription has no medicines listed yet — transcribe its items to approve it.', code: 'PRESCRIPTION_NO_ITEMS' });
      }
      const now = new Date().toISOString();
      run(
        'UPDATE prescriptions SET reviewStatus = ?, reviewedBy = ?, reviewedAt = ?, reviewNote = ?, updatedAt = ? WHERE id = ?',
        [b.decision, req.user?.id || null, now, b.note ? String(b.note).trim() : null, now, req.params.id]
      );
      if (itemsCheck) {
        run('DELETE FROM prescription_items WHERE prescriptionId = ?', [req.params.id]);
        insertItems(req.params.id, b.items, itemsCheck.productsById, now);
      }
      saveDatabase();
      const updated = query('SELECT * FROM prescriptions WHERE id = ?', [req.params.id])[0];
      enqueue('prescription', 'update', updated);
      res.json({ success: true, data: shapePrescription(updated), message: b.decision === 'REVIEWED' ? 'Prescription approved' : 'Prescription rejected' });
    } catch (e) {
      console.error('[Prescriptions] Review error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // DELETE /api/prescriptions/:id — void (OWNER/MANAGER/ADMIN), reason required
  app.delete('/api/prescriptions/:id', authMiddleware, gatePrescriptions, (req, res) => {
    try {
      if (!requireManager(req, res, 'void a prescription')) return;
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM prescriptions WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Prescription not found' });
      if (!row.isActive) return res.status(400).json({ success: false, message: 'This prescription is already voided', code: 'PRESCRIPTION_VOIDED' });
      const reason = req.body?.reason;
      if (!reason || String(reason).trim().length < 3 || String(reason).trim().length > 500) {
        return res.status(400).json({ success: false, message: 'A reason is required to void a prescription record' });
      }
      const now = new Date().toISOString();
      run(
        'UPDATE prescriptions SET isActive = 0, voidReason = ?, voidedAt = ?, voidedBy = ?, updatedAt = ? WHERE id = ?',
        [String(reason).trim(), now, req.user?.id || null, now, req.params.id]
      );
      saveDatabase();
      const updated = query('SELECT * FROM prescriptions WHERE id = ?', [req.params.id])[0];
      enqueue('prescription', 'update', updated);
      res.json({ success: true, data: shapePrescription(updated), message: 'Prescription voided' });
    } catch (e) {
      console.error('[Prescriptions] Void error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });
}

module.exports = {
  registerPrescriptionsRoutes
};
