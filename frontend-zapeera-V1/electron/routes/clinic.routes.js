/**
 * Clinic pack — embedded port of the cloud's patient / doctor /
 * appointment controllers (routes /api/patients, /api/doctors,
 * /api/appointments; module gates: patients/doctors/appointments —
 * CLINIC only, via requireModule).
 *
 * Conventions mirror the cloud:
 * · Every query is scoped to the caller's business; an id from
 *   another tenant reads as "not found".
 * · No hard delete: DELETE deactivates (isActive = false) and is
 *   OWNER/MANAGER/ADMIN only; the record and its visit history stay
 *   readable and it can be reactivated by an update.
 * · Booking assigns the patient's token in the doctor's queue for the
 *   day (per doctor+date sequence, server-side, never reused).
 * · COMPLETED is only reachable through complete-visit, which bills
 *   the visit through the service-sale helper (fee line on the
 *   doctor's CONSULT-<id> service product + any extra stock lines),
 *   snapshots feeCharged + doctorShareAmount, and links sale +
 *   prescription. Billing failure leaves the appointment un-completed
 *   so the desk can retry.
 * · A doctor's consultationFee/sharePercent are DEFAULTS for future
 *   visits only; the settlement report reads the snapshots, never the
 *   doctor's current fee/share.
 * Sync: patients/doctors/appointments/doctor_settlements are in the
 * cloud pull feed + push map, so writes enqueue via handleDataChange.
 */
const { getDataFilter } = require('../utils/helpers');
const { v4: uuid } = require('uuid');
const clinic = require('../utils/clinic.util');
const { requireModule } = require('../utils/module-applicability');
const { ensureServiceProduct, createServiceSale } = require('../utils/service-sale');
const { mustRun } = require('../utils/db-write');

function registerClinicRoutes(app, authMiddleware, deps) {
  const { query, run, saveDatabase, handleDataChange } = deps;

  function nullIfEmpty(v) {
    if (v === undefined || v === null) return null;
    const t = String(v).trim();
    return t === '' ? null : t;
  }
  function pageParams(req, def = 50) {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || def));
    return { page, limit, offset: (page - 1) * limit };
  }
  function pagination(page, limit, total) {
    return { page, limit, total, pages: Math.ceil(total / limit) };
  }
  function requireManager(req, res, action) {
    const role = String(req.user?.role || '').toUpperCase();
    if (!['OWNER', 'MANAGER', 'ADMIN'].includes(role)) {
      res.status(403).json({ success: false, message: `Only the owner or a manager can ${action}` });
      return false;
    }
    return true;
  }
  function shapePatient(r) {
    return { ...r, isActive: !!r.isActive };
  }
  function shapeDoctor(r) {
    return { ...r, isActive: !!r.isActive, consultationFee: Number(r.consultationFee) || 0, sharePercent: Number(r.sharePercent) || 0 };
  }
  function shapeAppointment(r) {
    const patient = r.patientId ? query('SELECT id, name, phone, age, gender FROM patients WHERE id = ?', [r.patientId])[0] : null;
    const doctor = r.doctorId ? query('SELECT id, name, specialization FROM doctors WHERE id = ?', [r.doctorId])[0] : null;
    return { ...r, feeCharged: r.feeCharged === null ? null : Number(r.feeCharged), doctorShareAmount: r.doctorShareAmount === null ? null : Number(r.doctorShareAmount), patient: patient || null, doctor: doctor || null };
  }
  function enqueue(entityType, op, row) {
    try { if (typeof handleDataChange === 'function') handleDataChange(entityType, op, row); } catch (e) { console.error('[Clinic] sync enqueue failed:', e.message); }
  }
  const gatePatients = requireModule('patients', { query, getDataFilter });
  const gateDoctors = requireModule('doctors', { query, getDataFilter });
  const gateAppointments = requireModule('appointments', { query, getDataFilter });

  // ── Patients ────────────────────────────────────────────────────
  app.post('/api/patients', authMiddleware, gatePatients, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const b = req.body || {};
      if (!b.name || !String(b.name).trim() || String(b.name).trim().length > 160) return res.status(400).json({ success: false, message: 'Patient name is required (max 160 characters)' });
      if (b.age !== undefined && b.age !== null && (!Number.isInteger(b.age) || b.age < 0 || b.age > 130)) return res.status(400).json({ success: false, message: 'Age must be an integer between 0 and 130' });
      if (b.branchId) {
        if (!query('SELECT id FROM branches WHERE id = ? AND companyId = ?', [b.branchId, companyFilter])[0]) return res.status(400).json({ success: false, message: 'Branch not found in this business' });
      }
      const id = uuid();
      const now = new Date().toISOString();
      run(
        'INSERT INTO patients (id, companyId, branchId, name, phone, age, gender, cnic, address, notes, isActive, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
        [id, companyFilter, b.branchId || null, String(b.name).trim(), nullIfEmpty(b.phone), b.age ?? null, nullIfEmpty(b.gender), nullIfEmpty(b.cnic), nullIfEmpty(b.address), nullIfEmpty(b.notes), req.user?.id || null, now, now]
      );
      saveDatabase();
      const row = query('SELECT * FROM patients WHERE id = ?', [id])[0];
      enqueue('patient', 'create', row);
      res.status(201).json({ success: true, data: shapePatient(row), message: 'Patient created successfully' });
    } catch (e) {
      console.error('[Clinic] Create patient error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/patients', authMiddleware, gatePatients, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const { page, limit, offset } = pageParams(req);
      const where = ['companyId = ?'];
      const params = [companyFilter];
      if (req.query.branchId) { where.push('branchId = ?'); params.push(String(req.query.branchId)); }
      if (req.query.search) { where.push('(name LIKE ? OR phone LIKE ? OR cnic LIKE ?)'); params.push(`%${req.query.search}%`, `%${req.query.search}%`, `%${req.query.search}%`); }
      if (req.query.isActive !== undefined) { where.push('isActive = ?'); params.push(req.query.isActive === 'true' ? 1 : 0); }
      const total = query(`SELECT COUNT(*) AS c FROM patients WHERE ${where.join(' AND ')}`, params)[0].c;
      const rows = query(`SELECT * FROM patients WHERE ${where.join(' AND ')} ORDER BY name ASC LIMIT ? OFFSET ?`, [...params, limit, offset]);
      res.json({ success: true, data: rows.map(shapePatient), pagination: pagination(page, limit, total) });
    } catch (e) {
      console.error('[Clinic] Get patients error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/patients/:id', authMiddleware, gatePatients, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM patients WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Patient not found' });
      res.json({ success: true, data: shapePatient(row) });
    } catch (e) {
      console.error('[Clinic] Get patient error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.put('/api/patients/:id', authMiddleware, gatePatients, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM patients WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Patient not found' });
      const b = req.body || {};
      const sets = [];
      const params = [];
      const setStr = (col, v) => { sets.push(`${col} = ?`); params.push(v); };
      if (b.name !== undefined) {
        if (!String(b.name).trim() || String(b.name).trim().length > 160) return res.status(400).json({ success: false, message: 'Patient name is required (max 160 characters)' });
        setStr('name', String(b.name).trim());
      }
      if (b.phone !== undefined) setStr('phone', nullIfEmpty(b.phone));
      if (b.age !== undefined) {
        if (b.age !== null && (!Number.isInteger(b.age) || b.age < 0 || b.age > 130)) return res.status(400).json({ success: false, message: 'Age must be an integer between 0 and 130' });
        setStr('age', b.age);
      }
      if (b.gender !== undefined) setStr('gender', nullIfEmpty(b.gender));
      if (b.cnic !== undefined) setStr('cnic', nullIfEmpty(b.cnic));
      if (b.address !== undefined) setStr('address', nullIfEmpty(b.address));
      if (b.notes !== undefined) setStr('notes', nullIfEmpty(b.notes));
      if (b.branchId !== undefined) setStr('branchId', b.branchId || null);
      if (b.isActive !== undefined) setStr('isActive', b.isActive ? 1 : 0);
      if (sets.length === 0) return res.status(400).json({ success: false, message: 'No fields to update' });
      setStr('updatedAt', new Date().toISOString());
      params.push(req.params.id);
      run(`UPDATE patients SET ${sets.join(', ')} WHERE id = ?`, params);
      saveDatabase();
      const updated = query('SELECT * FROM patients WHERE id = ?', [req.params.id])[0];
      enqueue('patient', 'update', updated);
      res.json({ success: true, data: shapePatient(updated), message: 'Patient updated successfully' });
    } catch (e) {
      console.error('[Clinic] Update patient error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // DELETE = soft deactivate (OWNER/MANAGER/ADMIN), as on the cloud
  app.delete('/api/patients/:id', authMiddleware, gatePatients, (req, res) => {
    try {
      if (!requireManager(req, res, 'deactivate a patient record')) return;
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM patients WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Patient not found' });
      if (!row.isActive) return res.status(400).json({ success: false, message: 'This patient is already inactive', code: 'PATIENT_INACTIVE' });
      run('UPDATE patients SET isActive = 0, updatedAt = ? WHERE id = ?', [new Date().toISOString(), req.params.id]);
      saveDatabase();
      const updated = query('SELECT * FROM patients WHERE id = ?', [req.params.id])[0];
      enqueue('patient', 'update', updated);
      res.json({ success: true, data: shapePatient(updated), message: 'Patient deactivated' });
    } catch (e) {
      console.error('[Clinic] Deactivate patient error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // ── Doctors ─────────────────────────────────────────────────────
  app.get('/api/doctors/settlement-report', authMiddleware, gateDoctors, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const now = new Date();
      const fromDate = req.query.from ? new Date(String(req.query.from)) : new Date(now.getFullYear(), now.getMonth(), 1);
      const toDate = req.query.to ? new Date(String(req.query.to)) : now;
      toDate.setHours(23, 59, 59, 999);
      const fromIso = fromDate.toISOString();
      const toIso = toDate.toISOString();
      const doctorId = req.query.doctorId ? String(req.query.doctorId) : null;
      const docParams = [companyFilter];
      let docSql = 'SELECT id, name, specialization, isActive FROM doctors WHERE companyId = ?';
      if (doctorId) { docSql += ' AND id = ?'; docParams.push(doctorId); }
      docSql += ' ORDER BY name ASC';
      const doctors = query(docSql, docParams);
      const doctorIds = doctors.map((d) => d.id);
      let visits = [];
      let payments = [];
      if (doctorIds.length > 0) {
        const ph = doctorIds.map(() => '?').join(',');
        visits = query(`SELECT doctorId, feeCharged, doctorShareAmount FROM appointments WHERE companyId = ? AND doctorId IN (${ph}) AND status = 'COMPLETED' AND appointmentDate >= ? AND appointmentDate <= ?`, [companyFilter, ...doctorIds, fromIso, toIso]);
        payments = query(`SELECT doctorId, amount FROM doctor_settlements WHERE companyId = ? AND doctorId IN (${ph}) AND createdAt >= ? AND createdAt <= ?`, [companyFilter, ...doctorIds, fromIso, toIso]);
      }
      const rows = doctors.map((doctor) => ({
        doctor: { id: doctor.id, name: doctor.name, specialization: doctor.specialization, isActive: !!doctor.isActive },
        ...clinic.summarizeDoctorSettlement(doctor.id, visits, payments)
      }));
      const totals = rows.reduce((acc, row) => ({
        visits: acc.visits + row.visits,
        consultationRevenue: clinic.round2(acc.consultationRevenue + row.consultationRevenue),
        doctorShare: clinic.round2(acc.doctorShare + row.doctorShare),
        clinicShare: clinic.round2(acc.clinicShare + row.clinicShare),
        settled: clinic.round2(acc.settled + row.settled),
        outstanding: clinic.round2(acc.outstanding + row.outstanding)
      }), { visits: 0, consultationRevenue: 0, doctorShare: 0, clinicShare: 0, settled: 0, outstanding: 0 });
      res.json({ success: true, data: { period: { from: fromIso, to: toIso }, doctors: rows, totals } });
    } catch (e) {
      console.error('[Clinic] Settlement report error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post('/api/doctors/settlements', authMiddleware, gateDoctors, (req, res) => {
    try {
      if (!requireManager(req, res, 'record a doctor settlement')) return;
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const b = req.body || {};
      if (!b.doctorId || !b.from || !b.to || typeof b.amount !== 'number' || b.amount <= 0) {
        return res.status(400).json({ success: false, message: 'doctorId, from, to and a positive amount are required' });
      }
      if (new Date(b.to).getTime() < new Date(b.from).getTime()) return res.status(400).json({ success: false, message: 'The settlement period end must not be before its start' });
      const doctor = query('SELECT id, name, specialization FROM doctors WHERE id = ? AND companyId = ?', [b.doctorId, companyFilter])[0];
      if (!doctor) return res.status(404).json({ success: false, message: 'Doctor not found' });
      const id = uuid();
      const now = new Date().toISOString();
      run(
        'INSERT INTO doctor_settlements (id, companyId, doctorId, periodFrom, periodTo, amount, note, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, companyFilter, doctor.id, new Date(b.from).toISOString(), new Date(b.to).toISOString(), clinic.round2(b.amount), nullIfEmpty(b.note), req.user?.id || null, now, now]
      );
      saveDatabase();
      const row = query('SELECT * FROM doctor_settlements WHERE id = ?', [id])[0];
      enqueue('doctorSettlement', 'create', row);
      res.status(201).json({ success: true, data: { ...row, doctor }, message: 'Settlement recorded successfully' });
    } catch (e) {
      console.error('[Clinic] Create settlement error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/doctors/settlements', authMiddleware, gateDoctors, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const { page, limit, offset } = pageParams(req);
      const where = ['companyId = ?'];
      const params = [companyFilter];
      if (req.query.doctorId) { where.push('doctorId = ?'); params.push(String(req.query.doctorId)); }
      if (req.query.from) { where.push('createdAt >= ?'); params.push(new Date(String(req.query.from)).toISOString()); }
      if (req.query.to) { const d = new Date(String(req.query.to)); d.setHours(23, 59, 59, 999); where.push('createdAt <= ?'); params.push(d.toISOString()); }
      const total = query(`SELECT COUNT(*) AS c FROM doctor_settlements WHERE ${where.join(' AND ')}`, params)[0].c;
      const rows = query(`SELECT * FROM doctor_settlements WHERE ${where.join(' AND ')} ORDER BY createdAt DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
      const shaped = rows.map((r) => ({ ...r, doctor: query('SELECT id, name, specialization FROM doctors WHERE id = ?', [r.doctorId])[0] || null }));
      res.json({ success: true, data: shaped, pagination: pagination(page, limit, total) });
    } catch (e) {
      console.error('[Clinic] Get settlements error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.post('/api/doctors', authMiddleware, gateDoctors, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const b = req.body || {};
      if (!b.name || !String(b.name).trim() || String(b.name).trim().length > 160) return res.status(400).json({ success: false, message: 'Doctor name is required (max 160 characters)' });
      const fee = b.consultationFee === undefined ? 0 : Number(b.consultationFee);
      const share = b.sharePercent === undefined ? 0 : Number(b.sharePercent);
      if (Number.isNaN(fee) || fee < 0) return res.status(400).json({ success: false, message: 'consultationFee must be 0 or more' });
      if (Number.isNaN(share) || share < 0 || share > 100) return res.status(400).json({ success: false, message: 'sharePercent must be between 0 and 100' });
      const id = uuid();
      const now = new Date().toISOString();
      run(
        'INSERT INTO doctors (id, companyId, name, specialization, phone, consultationFee, sharePercent, isActive, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)',
        [id, companyFilter, String(b.name).trim(), nullIfEmpty(b.specialization), nullIfEmpty(b.phone), fee, share, req.user?.id || null, now, now]
      );
      saveDatabase();
      const row = query('SELECT * FROM doctors WHERE id = ?', [id])[0];
      enqueue('doctor', 'create', row);
      // Best-effort service product ensure (needs a branch context)
      try {
        const branchId = req.body.branchId || req.user?.selectedBranchId || null;
        if (branchId) {
          const product = ensureServiceProduct({ query, run }, { companyId: companyFilter, branchId, sku: clinic.consultationProductSku(id), name: clinic.consultationProductName(row.name), description: `Consultation fee for Dr ${row.name} (auto-managed service item)`, createdBy: req.user?.id || null });
          if (product && row.serviceProductId !== product.id) {
            run('UPDATE doctors SET serviceProductId = ? WHERE id = ?', [product.id, id]);
            saveDatabase();
          }
        }
      } catch (e) { console.warn('[Clinic] Could not ensure doctor service product:', e.message); }
      res.status(201).json({ success: true, data: shapeDoctor(query('SELECT * FROM doctors WHERE id = ?', [id])[0]), message: 'Doctor created successfully' });
    } catch (e) {
      console.error('[Clinic] Create doctor error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/doctors', authMiddleware, gateDoctors, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const { page, limit, offset } = pageParams(req);
      const where = ['companyId = ?'];
      const params = [companyFilter];
      if (req.query.search) { where.push('(name LIKE ? OR specialization LIKE ? OR phone LIKE ?)'); params.push(`%${req.query.search}%`, `%${req.query.search}%`, `%${req.query.search}%`); }
      if (req.query.isActive !== undefined) { where.push('isActive = ?'); params.push(req.query.isActive === 'true' ? 1 : 0); }
      const total = query(`SELECT COUNT(*) AS c FROM doctors WHERE ${where.join(' AND ')}`, params)[0].c;
      const rows = query(`SELECT * FROM doctors WHERE ${where.join(' AND ')} ORDER BY name ASC LIMIT ? OFFSET ?`, [...params, limit, offset]);
      res.json({ success: true, data: rows.map(shapeDoctor), pagination: pagination(page, limit, total) });
    } catch (e) {
      console.error('[Clinic] Get doctors error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/doctors/:id', authMiddleware, gateDoctors, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM doctors WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Doctor not found' });
      res.json({ success: true, data: shapeDoctor(row) });
    } catch (e) {
      console.error('[Clinic] Get doctor error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.put('/api/doctors/:id', authMiddleware, gateDoctors, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM doctors WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Doctor not found' });
      const b = req.body || {};
      const sets = [];
      const params = [];
      const setStr = (col, v) => { sets.push(`${col} = ?`); params.push(v); };
      if (b.name !== undefined) {
        if (!String(b.name).trim() || String(b.name).trim().length > 160) return res.status(400).json({ success: false, message: 'Doctor name is required (max 160 characters)' });
        setStr('name', String(b.name).trim());
      }
      if (b.specialization !== undefined) setStr('specialization', nullIfEmpty(b.specialization));
      if (b.phone !== undefined) setStr('phone', nullIfEmpty(b.phone));
      if (b.consultationFee !== undefined) {
        const fee = Number(b.consultationFee);
        if (Number.isNaN(fee) || fee < 0) return res.status(400).json({ success: false, message: 'consultationFee must be 0 or more' });
        setStr('consultationFee', fee);
      }
      if (b.sharePercent !== undefined) {
        const share = Number(b.sharePercent);
        if (Number.isNaN(share) || share < 0 || share > 100) return res.status(400).json({ success: false, message: 'sharePercent must be between 0 and 100' });
        setStr('sharePercent', share);
      }
      if (b.isActive !== undefined) setStr('isActive', b.isActive ? 1 : 0);
      if (sets.length === 0) return res.status(400).json({ success: false, message: 'No fields to update' });
      setStr('updatedAt', new Date().toISOString());
      params.push(req.params.id);
      run(`UPDATE doctors SET ${sets.join(', ')} WHERE id = ?`, params);
      saveDatabase();
      const updated = query('SELECT * FROM doctors WHERE id = ?', [req.params.id])[0];
      enqueue('doctor', 'update', updated);
      res.json({ success: true, data: shapeDoctor(updated), message: 'Doctor updated successfully' });
    } catch (e) {
      console.error('[Clinic] Update doctor error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // DELETE = soft deactivate (OWNER/MANAGER/ADMIN), as on the cloud
  app.delete('/api/doctors/:id', authMiddleware, gateDoctors, (req, res) => {
    try {
      if (!requireManager(req, res, 'deactivate a doctor')) return;
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM doctors WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Doctor not found' });
      if (!row.isActive) return res.status(400).json({ success: false, message: 'This doctor is already inactive', code: 'DOCTOR_INACTIVE' });
      run('UPDATE doctors SET isActive = 0, updatedAt = ? WHERE id = ?', [new Date().toISOString(), req.params.id]);
      saveDatabase();
      const updated = query('SELECT * FROM doctors WHERE id = ?', [req.params.id])[0];
      enqueue('doctor', 'update', updated);
      res.json({ success: true, data: shapeDoctor(updated), message: 'Doctor deactivated' });
    } catch (e) {
      console.error('[Clinic] Deactivate doctor error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // ── Appointments ────────────────────────────────────────────────
  app.post('/api/appointments', authMiddleware, gateAppointments, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const b = req.body || {};
      if (!b.patientId || !b.doctorId || !b.appointmentDate) return res.status(400).json({ success: false, message: 'patientId, doctorId and appointmentDate are required' });
      const patient = query('SELECT id, isActive FROM patients WHERE id = ? AND companyId = ?', [b.patientId, companyFilter])[0];
      if (!patient) return res.status(404).json({ success: false, message: 'Patient not found' });
      if (!patient.isActive) return res.status(400).json({ success: false, message: 'This patient record is inactive and cannot be booked', code: 'PATIENT_INACTIVE' });
      const doctor = query('SELECT id, isActive FROM doctors WHERE id = ? AND companyId = ?', [b.doctorId, companyFilter])[0];
      if (!doctor) return res.status(404).json({ success: false, message: 'Doctor not found' });
      if (!doctor.isActive) return res.status(400).json({ success: false, message: 'This doctor is inactive and cannot take new bookings', code: 'DOCTOR_INACTIVE' });
      let branchId = b.branchId ? String(b.branchId) : (req.user?.selectedBranchId ? String(req.user.selectedBranchId) : null);
      if (branchId && !query('SELECT id FROM branches WHERE id = ? AND companyId = ?', [branchId, companyFilter])[0]) {
        return res.status(400).json({ success: false, message: 'Branch not found in this business' });
      }
      const appointmentDate = clinic.normalizeAppointmentDate(b.appointmentDate);
      const id = uuid();
      const now = new Date().toISOString();
      // Token: next after the day's current maximum for this doctor.
      // A collision (two desks booking at once) recomputes and retries.
      let appointment = null;
      for (let attempt = 0; attempt < 5 && !appointment; attempt++) {
        const existing = query('SELECT tokenNumber FROM appointments WHERE companyId = ? AND doctorId = ? AND appointmentDate = ?', [companyFilter, doctor.id, appointmentDate]);
        const tokenNumber = clinic.nextTokenNumber(existing.map((a) => a.tokenNumber));
        try {
          run(
            'INSERT INTO appointments (id, companyId, branchId, patientId, doctorId, appointmentDate, tokenNumber, status, reason, notes, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [id, companyFilter, branchId, patient.id, doctor.id, appointmentDate, tokenNumber, 'BOOKED', nullIfEmpty(b.reason), nullIfEmpty(b.notes), req.user?.id || null, now, now]
          );
          appointment = query('SELECT * FROM appointments WHERE id = ?', [id])[0];
        } catch (e) {
          if (String(e.message || '').includes('UNIQUE') && attempt < 4) continue;
          throw e;
        }
      }
      saveDatabase();
      enqueue('appointment', 'create', appointment);
      res.status(201).json({ success: true, data: shapeAppointment(appointment), message: `Appointment booked — token ${appointment.tokenNumber}` });
    } catch (e) {
      console.error('[Clinic] Create appointment error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/appointments', authMiddleware, gateAppointments, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const { page, limit, offset } = pageParams(req, 100);
      const where = ['companyId = ?'];
      const params = [companyFilter];
      if (req.query.doctorId) { where.push('doctorId = ?'); params.push(String(req.query.doctorId)); }
      if (req.query.patientId) { where.push('patientId = ?'); params.push(String(req.query.patientId)); }
      if (req.query.status) { where.push('status = ?'); params.push(String(req.query.status).toUpperCase()); }
      if (req.query.branchId) { where.push('branchId = ?'); params.push(String(req.query.branchId)); }
      if (req.query.date) {
        const day = clinic.normalizeAppointmentDate(String(req.query.date));
        const next = new Date(new Date(day).getTime() + 24 * 60 * 60 * 1000).toISOString();
        where.push('appointmentDate >= ? AND appointmentDate < ?'); params.push(day, next);
      } else {
        if (req.query.from) { where.push('appointmentDate >= ?'); params.push(clinic.normalizeAppointmentDate(String(req.query.from))); }
        if (req.query.to) {
          const toDay = clinic.normalizeAppointmentDate(String(req.query.to));
          const next = new Date(new Date(toDay).getTime() + 24 * 60 * 60 * 1000).toISOString();
          where.push('appointmentDate < ?'); params.push(next);
        }
      }
      const total = query(`SELECT COUNT(*) AS c FROM appointments WHERE ${where.join(' AND ')}`, params)[0].c;
      const rows = query(`SELECT * FROM appointments WHERE ${where.join(' AND ')} ORDER BY appointmentDate ASC, tokenNumber ASC LIMIT ? OFFSET ?`, [...params, limit, offset]);
      res.json({ success: true, data: rows.map(shapeAppointment), pagination: pagination(page, limit, total) });
    } catch (e) {
      console.error('[Clinic] Get appointments error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/appointments/:id', authMiddleware, gateAppointments, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM appointments WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Appointment not found' });
      res.json({ success: true, data: shapeAppointment(row) });
    } catch (e) {
      console.error('[Clinic] Get appointment error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.patch('/api/appointments/:id/status', authMiddleware, gateAppointments, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM appointments WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Appointment not found' });
      const status = String(req.body?.status || '').trim().toUpperCase();
      if (!clinic.isAppointmentStatus(status)) return res.status(400).json({ success: false, message: `Invalid status: ${status}` });
      if (status === 'COMPLETED') {
        return res.status(400).json({ success: false, message: 'COMPLETED is only reachable through complete-visit, which bills the visit', code: 'APPOINTMENT_COMPLETED_VIA_VISIT' });
      }
      if (!clinic.canTransitionAppointment(row.status, status)) {
        return res.status(400).json({ success: false, message: `A visit in status ${row.status} cannot move to ${status}`, code: 'APPOINTMENT_BAD_TRANSITION' });
      }
      run('UPDATE appointments SET status = ?, updatedAt = ? WHERE id = ?', [status, new Date().toISOString(), req.params.id]);
      saveDatabase();
      const updated = query('SELECT * FROM appointments WHERE id = ?', [req.params.id])[0];
      enqueue('appointment', 'update', updated);
      res.json({ success: true, data: shapeAppointment(updated) });
    } catch (e) {
      console.error('[Clinic] Update appointment status error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // POST /api/appointments/:id/complete-visit — completion IS billing.
  app.post('/api/appointments/:id/complete-visit', authMiddleware, gateAppointments, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const b = req.body || {};
      const appointment = query('SELECT * FROM appointments WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!appointment) return res.status(404).json({ success: false, message: 'Appointment not found' });
      if (appointment.status === 'COMPLETED') return res.status(400).json({ success: false, message: 'This visit is already completed and billed', code: 'APPOINTMENT_COMPLETED' });
      if (!['CHECKED_IN', 'IN_VISIT'].includes(appointment.status)) {
        return res.status(400).json({ success: false, message: `A visit in status ${appointment.status} cannot be completed — check the patient in first`, code: 'APPOINTMENT_NOT_IN_VISIT' });
      }
      const doctor = query('SELECT * FROM doctors WHERE id = ?', [appointment.doctorId])[0];
      const patient = query('SELECT * FROM patients WHERE id = ?', [appointment.patientId])[0];
      if (!doctor || !patient) return res.status(404).json({ success: false, message: 'Appointment not found' });
      const branchId = appointment.branchId || (req.user?.selectedBranchId ? String(req.user.selectedBranchId) : null);
      if (!branchId) return res.status(400).json({ success: false, message: 'No branch context for this visit — open the clinic from a branch first', code: 'NO_BRANCH_CONTEXT' });
      const feeCharged = clinic.round2(b.feeCharged !== undefined ? b.feeCharged : (doctor.consultationFee || 0));
      if (feeCharged < 0) return res.status(400).json({ success: false, message: 'feeCharged must be 0 or more' });

      const createdBy = req.user?.id || null;
      const now = new Date().toISOString();

      // 1) The prescription the doctor wrote, if any.
      let prescription = null;
      if (Array.isArray(b.prescriptionItems) && b.prescriptionItems.length > 0) {
        const productsById = new Map();
        for (const item of b.prescriptionItems) {
          if (!item.productId || typeof item.quantity !== 'number' || item.quantity <= 0) {
            return res.status(400).json({ success: false, message: 'Each prescription item must include productId and a positive quantity' });
          }
          const p = query('SELECT id, name FROM products WHERE id = ? AND companyId = ?', [item.productId, companyFilter])[0];
          if (!p) return res.status(400).json({ success: false, message: 'One or more prescription items refer to a product that does not exist in this business' });
          productsById.set(item.productId, p);
        }
        const prescriptionId = uuid();
        mustRun(run,
          'INSERT INTO prescriptions (id, companyId, branchId, patientName, patientPhone, doctorName, doctorReg, notes, issuedDate, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [prescriptionId, companyFilter, branchId, patient.name, patient.phone || null, doctor.name, null, nullIfEmpty(b.prescriptionNotes), now, createdBy, now, now]
        );
        for (const item of b.prescriptionItems) {
          mustRun(run,
            'INSERT INTO prescription_items (id, prescriptionId, productId, productName, quantity, dosage, durationDays, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [uuid(), prescriptionId, item.productId, productsById.get(item.productId).name || '', item.quantity, item.dosage ? String(item.dosage).trim() : null, item.durationDays ?? null, now, now]
          );
        }
        prescription = query('SELECT * FROM prescriptions WHERE id = ?', [prescriptionId])[0];
        enqueue('prescription', 'create', prescription);
      }

      // 2) Compose the visit invoice: fee line (service, no stock) + any extra stock lines.
      const saleItems = [];
      if (feeCharged > 0) {
        const serviceProduct = ensureServiceProduct({ query, run }, { companyId: companyFilter, branchId, sku: clinic.consultationProductSku(doctor.id), name: clinic.consultationProductName(doctor.name), description: `Consultation fee for Dr ${doctor.name} (auto-managed service item)`, createdBy });
        saleItems.push({ productId: serviceProduct.id, quantity: 1, unitPrice: feeCharged });
      }
      // Stock lines: pinned batch, or FEFO pick; deduct now and restore on billing failure.
      // Two passes on purpose: pass 1 validates + resolves EVERY item
      // before any stock moves — a single-pass loop would leave earlier
      // items deducted when a later item fails validation.
      const deductions = [];
      const controlledLines = [];
      const resolved = [];
      for (const item of b.items || []) {
        if (!item.productId || typeof item.quantity !== 'number' || item.quantity < 1 || typeof item.unitPrice !== 'number' || item.unitPrice < 0) {
          return res.status(400).json({ success: false, message: 'Each sale item must include productId, a quantity of at least 1 and a unitPrice of 0 or more' });
        }
        const product = query('SELECT id, name FROM products WHERE id = ? AND companyId = ?', [item.productId, companyFilter])[0];
        if (!product) return res.status(400).json({ success: false, message: `Product ${item.productId} not found in this business` });
        let batch = null;
        if (item.batchId) {
          batch = query('SELECT * FROM batches WHERE id = ? AND isActive = 1', [item.batchId])[0];
          if (!batch || batch.productId !== item.productId) return res.status(400).json({ success: false, message: `Batch with ID ${item.batchId} not found` });
        } else {
          batch = query('SELECT * FROM batches WHERE productId = ? AND companyId = ? AND branchId = ? AND isActive = 1 ORDER BY expireDate ASC', [item.productId, companyFilter, branchId])[0];
        }
        if (!batch) return res.status(400).json({ success: false, message: `No stock batch available for ${product.name}` });
        if ((Number(batch.quantity) || 0) < item.quantity) {
          return res.status(400).json({ success: false, message: `Insufficient stock for ${product.name}. Available: ${batch.quantity}, Required: ${item.quantity}` });
        }
        resolved.push({ item, product, batch });
      }
      try {
        for (const r of resolved) {
          const { item, batch } = r;
          mustRun(run, 'UPDATE batches SET quantity = quantity - ? WHERE id = ?', [item.quantity, batch.id]);
          mustRun(run, 'UPDATE products SET quantity = quantity - ? WHERE id = ?', [item.quantity, item.productId]);
          deductions.push({ batchId: batch.id, productId: item.productId, qty: item.quantity });
          // Controlled register: remember the line; the DISPENSE row is
          // written after the visit sale exists (it carries the sale id).
          const controlled = query('SELECT isControlled FROM products WHERE id = ?', [item.productId])[0];
          if (controlled && controlled.isControlled) controlledLines.push({ productId: item.productId, batchId: batch.id, batchNo: batch.batchNo, quantity: item.quantity });
          saleItems.push({ productId: item.productId, quantity: item.quantity, unitPrice: item.unitPrice });
        }
      } catch (e) {
        for (const d of deductions) {
          run('UPDATE batches SET quantity = quantity + ? WHERE id = ?', [d.qty, d.batchId]);
          run('UPDATE products SET quantity = quantity + ? WHERE id = ?', [d.qty, d.productId]);
        }
        throw e;
      }

      // 3) Bill it through the service-sale helper (skipped only when
      //    there is genuinely nothing to bill).
      let sale = null;
      if (saleItems.length > 0) {
        try {
          sale = createServiceSale({ query, run, saveDatabase, handleDataChange }, {
            companyId: companyFilter, branchId, customerId: null, items: saleItems,
            paymentMethod: b.paymentMethod || 'CASH', paymentStatus: b.paymentStatus,
            paidAmount: b.paidAmount, notes: `Clinic visit — ${patient.name} (Dr ${doctor.name})`,
            createdBy, userId: req.user?.id
          });
          if (Array.isArray(b.payments) && b.payments.length > 0) {
            for (const p of b.payments) {
              mustRun(run, 'INSERT INTO sale_payments (id, saleId, method, amount, reference, createdAt) VALUES (?, ?, ?, ?, ?, ?)', [uuid(), sale.id, String(p.method).toUpperCase(), p.amount, p.reference || null, now]);
            }
            saveDatabase();
          }
          // Controlled register: one DISPENSE row per controlled line
          // dispensed at the visit (same hook as the POS sale engine).
          for (const cl of controlledLines) {
            try {
              require('../utils/controlled-register').appendDispenseEntry({ query, run }, {
                companyId: companyFilter, branchId, productId: cl.productId, batchId: cl.batchId, batchNo: cl.batchNo,
                saleId: sale.id, saleItemId: null, quantity: cl.quantity,
                staffUserId: req.user?.id || null, staffName: req.user?.name || null,
                customerId: null, customerName: patient.name,
                prescriptionId: prescription ? prescription.id : null, prescriptionRef: null,
                invoiceNumber: sale.invoiceNumber || null
              });
            } catch (e) { console.error('[Clinic] Controlled register append failed (visit proceeds):', e.message); }
          }
        } catch (e) {
          for (const d of deductions) {
            run('UPDATE batches SET quantity = quantity + ? WHERE id = ?', [d.qty, d.batchId]);
            run('UPDATE products SET quantity = quantity + ? WHERE id = ?', [d.qty, d.productId]);
          }
          saveDatabase();
          console.error('[Clinic] Visit billing failed:', e.message);
          return res.status(500).json({ success: false, message: 'Visit billing failed: ' + e.message });
        }
      }

      // 4) Snapshot the money split and close the visit.
      const { doctorShare } = clinic.computeDoctorShare(feeCharged, doctor.sharePercent);
      mustRun(run,
        'UPDATE appointments SET status = ?, saleId = ?, prescriptionId = ?, feeCharged = ?, doctorShareAmount = ?, updatedAt = ? WHERE id = ?',
        ['COMPLETED', sale ? sale.id : null, prescription ? prescription.id : (appointment.prescriptionId || null), feeCharged, doctorShare, now, appointment.id]
      );
      saveDatabase();
      const updated = query('SELECT * FROM appointments WHERE id = ?', [appointment.id])[0];
      enqueue('appointment', 'update', updated);
      res.status(201).json({
        success: true,
        data: {
          appointment: shapeAppointment(updated),
          sale,
          prescription: prescription ? { id: prescription.id, patientName: prescription.patientName, doctorName: prescription.doctorName } : null
        },
        message: 'Visit completed'
      });
    } catch (e) {
      console.error('[Clinic] Complete visit error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });
}

module.exports = { registerClinicRoutes };
