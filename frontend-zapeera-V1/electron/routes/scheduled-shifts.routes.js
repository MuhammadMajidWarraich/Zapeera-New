/**
 * Scheduled shifts — embedded port of
 * backend-zapeera-v1-main/src/controllers/scheduledShift.controller.ts
 * (routes /api/scheduled-shifts; module shifts — core).
 *
 * The local scheduled_shifts table predates the cloud model and
 * carries only (id, shiftId, date, branchId, companyId, createdBy):
 * registration runs a PRAGMA migration adding the missing columns
 * (name, startTime, endTime, maxUsers, status, notes) and creates
 * scheduled_shift_users, so older local DBs upgrade in place.
 * Unlike the cloud list (which filters only by branch/status/date),
 * the embedded list is company-scoped via getDataFilter, like every
 * other embedded route.
 * Sync: scheduled_shifts / scheduled_shift_users are in the cloud
 * pull feed + push map, so writes enqueue via handleDataChange.
 */
const { getDataFilter } = require('../utils/helpers');
const { v4: uuid } = require('uuid');

const TIME_RE = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;

function registerScheduledShiftRoutes(app, authMiddleware, deps) {
  const { query, run, saveDatabase, handleDataChange } = deps;

  // ── Schema migration (older local DBs) ──────────────────────────
  try {
    const tableInfo = query('PRAGMA table_info(scheduled_shifts)');
    const columnNames = tableInfo.map((col) => col.name.toLowerCase());
    const addColumn = (name, type) => {
      if (!columnNames.includes(name.toLowerCase())) {
        run(`ALTER TABLE scheduled_shifts ADD COLUMN ${name} ${type}`);
      }
    };
    addColumn('name', 'TEXT');
    addColumn('startTime', 'TEXT');
    addColumn('endTime', 'TEXT');
    addColumn('maxUsers', 'INTEGER DEFAULT 1');
    addColumn('status', "TEXT DEFAULT 'SCHEDULED'");
    addColumn('notes', 'TEXT');
    run(`CREATE TABLE IF NOT EXISTS scheduled_shift_users (
      id TEXT PRIMARY KEY, scheduledShiftId TEXT, userId TEXT, assignedAt TEXT DEFAULT CURRENT_TIMESTAMP, assignedBy TEXT
    )`);
    saveDatabase();
  } catch (e) {
    console.log('[ScheduledShifts] Migration check:', e.message);
  }

  function enqueue(entityType, op, row) {
    try { if (typeof handleDataChange === 'function') handleDataChange(entityType, op, row); } catch (e) { console.error('[ScheduledShifts] sync enqueue failed:', e.message); }
  }
  function shapeShift(row) {
    const branch = row.branchId ? query('SELECT id, name FROM branches WHERE id = ?', [row.branchId])[0] : null;
    const assigned = query('SELECT userId FROM scheduled_shift_users WHERE scheduledShiftId = ?', [row.id]);
    const assignedUsers = assigned.map((a) => {
      const u = query('SELECT id, name FROM users WHERE id = ?', [a.userId])[0];
      return u ? { id: u.id, name: u.name } : { id: a.userId, name: 'Unknown User' };
    });
    return {
      id: row.id,
      name: row.name,
      startTime: row.startTime,
      endTime: row.endTime,
      date: row.date ? String(row.date).slice(0, 10) : null,
      branchId: row.branchId,
      branchName: branch ? branch.name : 'Unknown Branch',
      assignedUsers,
      maxUsers: row.maxUsers === null ? 1 : Number(row.maxUsers) || 1,
      status: String(row.status || 'SCHEDULED').toLowerCase(),
      notes: row.notes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
  function pageParams(req, def = 10) {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || def));
    return { page, limit, offset: (page - 1) * limit };
  }
  function syncAssignedUsers(shiftId, userIds, assignedBy) {
    const existing = query('SELECT userId FROM scheduled_shift_users WHERE scheduledShiftId = ?', [shiftId]).map((r) => r.userId);
    for (const userId of userIds) {
      if (!existing.includes(userId)) {
        const id = uuid();
        run('INSERT INTO scheduled_shift_users (id, scheduledShiftId, userId, assignedAt, assignedBy) VALUES (?, ?, ?, ?, ?)', [id, shiftId, userId, new Date().toISOString(), assignedBy || null]);
        enqueue('scheduledShiftUser', 'create', { id, scheduledShiftId: shiftId, userId });
      }
    }
    for (const userId of existing) {
      if (!userIds.includes(userId)) {
        const row = query('SELECT id FROM scheduled_shift_users WHERE scheduledShiftId = ? AND userId = ?', [shiftId, userId])[0];
        run('DELETE FROM scheduled_shift_users WHERE scheduledShiftId = ? AND userId = ?', [shiftId, userId]);
        if (row) enqueue('scheduledShiftUser', 'delete', row);
      }
    }
  }

  app.post('/api/scheduled-shifts', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const b = req.body || {};
      if (!b.name || !String(b.name).trim()) return res.status(400).json({ success: false, message: 'name is required' });
      if (!TIME_RE.test(String(b.startTime || '')) || !TIME_RE.test(String(b.endTime || ''))) {
        return res.status(400).json({ success: false, message: 'startTime and endTime are required in HH:MM format' });
      }
      if (!b.date) return res.status(400).json({ success: false, message: 'date is required' });
      if (!b.branchId) return res.status(400).json({ success: false, message: 'branchId is required' });
      if (b.maxUsers !== undefined && (!Number.isInteger(b.maxUsers) || b.maxUsers < 1)) return res.status(400).json({ success: false, message: 'maxUsers must be at least 1' });
      const branch = query('SELECT id FROM branches WHERE id = ? AND companyId = ?', [b.branchId, companyFilter])[0];
      if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });
      const assignedUserIds = Array.isArray(b.assignedUserIds) ? [...new Set(b.assignedUserIds)] : [];
      for (const userId of assignedUserIds) {
        if (!query('SELECT id FROM users WHERE id = ?', [userId])[0]) return res.status(404).json({ success: false, message: `User not found: ${userId}` });
      }
      const id = uuid();
      const now = new Date().toISOString();
      run(
        'INSERT INTO scheduled_shifts (id, name, startTime, endTime, date, branchId, companyId, maxUsers, status, notes, createdBy, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, String(b.name).trim(), b.startTime, b.endTime, new Date(b.date).toISOString(), b.branchId, companyFilter, b.maxUsers || 1, 'SCHEDULED', b.notes || null, req.user?.id || null, now, now]
      );
      syncAssignedUsers(id, assignedUserIds, req.user?.id || null);
      saveDatabase();
      const row = query('SELECT * FROM scheduled_shifts WHERE id = ?', [id])[0];
      enqueue('scheduledShift', 'create', row);
      res.status(201).json({ success: true, data: shapeShift(row), message: 'Scheduled shift created successfully' });
    } catch (e) {
      console.error('[ScheduledShifts] Create error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/scheduled-shifts', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const { page, limit, offset } = pageParams(req);
      const where = ['companyId = ?'];
      const params = [companyFilter];
      if (req.query.branchId) { where.push('branchId = ?'); params.push(String(req.query.branchId)); }
      if (req.query.status) { where.push('status = ?'); params.push(String(req.query.status).toUpperCase()); }
      if (req.query.startDate) { where.push('date >= ?'); params.push(new Date(String(req.query.startDate)).toISOString()); }
      if (req.query.endDate) { const d = new Date(String(req.query.endDate)); d.setHours(23, 59, 59, 999); where.push('date <= ?'); params.push(d.toISOString()); }
      const total = query(`SELECT COUNT(*) AS c FROM scheduled_shifts WHERE ${where.join(' AND ')}`, params)[0].c;
      const rows = query(`SELECT * FROM scheduled_shifts WHERE ${where.join(' AND ')} ORDER BY date DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
      res.json({ success: true, data: rows.map(shapeShift), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (e) {
      console.error('[ScheduledShifts] List error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.get('/api/scheduled-shifts/:id', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM scheduled_shifts WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Scheduled shift not found' });
      res.json({ success: true, data: shapeShift(row) });
    } catch (e) {
      console.error('[ScheduledShifts] Get error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.put('/api/scheduled-shifts/:id', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.body.branchId, req.body.companyId || req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM scheduled_shifts WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Scheduled shift not found' });
      const b = req.body || {};
      const sets = [];
      const params = [];
      const setStr = (col, v) => { sets.push(`${col} = ?`); params.push(v); };
      if (b.name !== undefined) {
        if (!String(b.name).trim()) return res.status(400).json({ success: false, message: 'name is required' });
        setStr('name', String(b.name).trim());
      }
      if (b.startTime !== undefined) {
        if (!TIME_RE.test(String(b.startTime))) return res.status(400).json({ success: false, message: 'startTime must be in HH:MM format' });
        setStr('startTime', b.startTime);
      }
      if (b.endTime !== undefined) {
        if (!TIME_RE.test(String(b.endTime))) return res.status(400).json({ success: false, message: 'endTime must be in HH:MM format' });
        setStr('endTime', b.endTime);
      }
      if (b.date !== undefined) setStr('date', new Date(b.date).toISOString());
      if (b.branchId !== undefined) {
        if (b.branchId && !query('SELECT id FROM branches WHERE id = ? AND companyId = ?', [b.branchId, companyFilter])[0]) return res.status(404).json({ success: false, message: 'Branch not found' });
        setStr('branchId', b.branchId || null);
      }
      if (b.maxUsers !== undefined) {
        if (!Number.isInteger(b.maxUsers) || b.maxUsers < 1) return res.status(400).json({ success: false, message: 'maxUsers must be at least 1' });
        setStr('maxUsers', b.maxUsers);
      }
      if (b.notes !== undefined) setStr('notes', b.notes || null);
      if (b.status !== undefined) setStr('status', String(b.status).toUpperCase());
      if (sets.length === 0 && b.assignedUserIds === undefined) return res.status(400).json({ success: false, message: 'No fields to update' });
      if (sets.length > 0) {
        setStr('updatedAt', new Date().toISOString());
        params.push(req.params.id);
        run(`UPDATE scheduled_shifts SET ${sets.join(', ')} WHERE id = ?`, params);
      }
      if (Array.isArray(b.assignedUserIds)) {
        const userIds = [...new Set(b.assignedUserIds)];
        for (const userId of userIds) {
          if (!query('SELECT id FROM users WHERE id = ?', [userId])[0]) return res.status(404).json({ success: false, message: `User not found: ${userId}` });
        }
        syncAssignedUsers(req.params.id, userIds, req.user?.id || null);
      }
      saveDatabase();
      const updated = query('SELECT * FROM scheduled_shifts WHERE id = ?', [req.params.id])[0];
      enqueue('scheduledShift', 'update', updated);
      res.json({ success: true, data: shapeShift(updated), message: 'Scheduled shift updated successfully' });
    } catch (e) {
      console.error('[ScheduledShifts] Update error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  app.delete('/api/scheduled-shifts/:id', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);
      if (!companyFilter) return res.status(400).json({ success: false, message: 'Business context is required' });
      const row = query('SELECT * FROM scheduled_shifts WHERE id = ? AND companyId = ?', [req.params.id, companyFilter])[0];
      if (!row) return res.status(404).json({ success: false, message: 'Scheduled shift not found' });
      run('DELETE FROM scheduled_shift_users WHERE scheduledShiftId = ?', [req.params.id]);
      run('DELETE FROM scheduled_shifts WHERE id = ?', [req.params.id]);
      saveDatabase();
      enqueue('scheduledShift', 'delete', row);
      res.json({ success: true, data: { id: req.params.id }, message: 'Scheduled shift deleted successfully' });
    } catch (e) {
      console.error('[ScheduledShifts] Delete error:', e.message);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });
}

module.exports = { registerScheduledShiftRoutes };
