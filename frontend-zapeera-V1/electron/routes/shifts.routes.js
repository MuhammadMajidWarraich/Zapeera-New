/**
 * Shifts Routes — register-shift (open/close) + Shift Summary data.
 * Extracted from routes/index.js.
 *
 * Shift gaps fix (2026-10-27, B2): these were stubs — GET always
 * returned [], POST echoed the body without persisting, and there was
 * no /active/:staffId endpoint, so the desktop POS could never show a
 * shift. They are now real SQLite-backed routes mirroring the cloud
 * shift controller (same paths, same response shapes, same ownership +
 * business-scoping rules).
 *
 * Scoping (L-5): a Shift carries no companyId — its tenancy runs
 * through membershipId, so every query joins memberships and filters
 * by m.businessId = companyFilter. A shift from another business can
 * never leak in, and can never be ended/updated by id.
 *
 * B1: a cashier opens/closes/updates ONLY their own shift (resolved
 * from their membership — never from a client-sent id). Manager /
 * owner / admin may act for any staff member of the business.
 *
 * B4: getActiveShift flags a stale shift (isStale + staleReason) —
 * never silently presented as today's. Stale shifts are closed with
 * a counted balance, never auto-closed.
 *
 * B6: the active lookup reads req.params.staffId — the param the
 * route defines. (The cloud had the same bug: it read
 * req.params.staffProfileId and returned the first active shift.)
 *
 * Push routing: the sync engine routes an op to its business from the
 * payload's companyId/businessId (durableEnqueue). The cloud Shift
 * model has no companyId, so the cloud allowlist strips it — but the
 * DESKTOP row keeps companyId (set at INSERT from the membership's
 * business; backfilled on the first local mutation of a pulled row)
 * and the enqueue payload carries it as routing metadata only.
 */

function registerShiftsRoutes(app, authMiddleware, deps) {
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

  // Cloud Shift fields only — the push payload must carry nothing the
  // cloud model does not have (the cloud allowlist would strip it, but
  // the contract is to send clean rows). companyId is added back at the
  // enqueue call sites as routing metadata (see header).
  const SHIFT_CLOUD_FIELDS = ['id', 'staffProfileId', 'membershipId', 'branchId', 'shiftDate', 'startTime', 'endTime', 'openingBalance', 'cashIn', 'cashOut', 'expectedBalance', 'actualBalance', 'difference', 'status', 'notes', 'createdAt', 'updatedAt'];

  function sanitizeShiftRow(row) {
    if (!row) return null;
    const out = {};
    for (const f of SHIFT_CLOUD_FIELDS) out[f] = row[f] === undefined ? null : row[f];
    return out;
  }

  // Same stale rule as the cloud (shift.controller.ts isShiftStale):
  // a previous calendar day, or open for more than 24 hours.
  //
  // L2 (2026-10-28): the calendar-day leg used the server-local day
  // (setHours(0,0,0,0)). The desktop runs in PKT while its clock is
  // UTC, so a shift opened at 22:00 PKT was flagged stale at 00:00
  // UTC — 05:00 PKT, five hours early. Both days are now computed in
  // Asia/Karachi. The 24-hour leg is absolute time and needs no zone.
  function karachiDay(date) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(date));
  }
  function shiftStaleInfo(shift) {
    if (!shift) return { isStale: false, staleReason: null };
    const nowDate = new Date();
    const start = new Date(shift.startTime);
    const shiftDay = new Date(shift.shiftDate);
    if (karachiDay(shiftDay) < karachiDay(nowDate)) {
      return { isStale: true, staleReason: `Shift opened on ${shiftDay.toLocaleDateString()} — from a previous day` };
    }
    if (nowDate.getTime() - start.getTime() > 24 * 60 * 60 * 1000) {
      return { isStale: true, staleReason: 'Shift open for more than 24 hours' };
    }
    return { isStale: false, staleReason: null };
  }

  const SHIFT_PRIVILEGED_ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'SUPERADMIN'];

  function isShiftPrivileged(role) {
    return SHIFT_PRIVILEGED_ROLES.includes(String(role || '').toUpperCase());
  }

  // The caller's own staff profile, via their membership in the scoped
  // business. Falls back to the caller's single membership when no
  // business is in scope; with several memberships and no scope the
  // caller cannot be disambiguated, so null (fail closed → 403).
  function resolveCallerStaffProfileId(req, companyFilter) {
    const userId = req.user && req.user.id;
    if (!userId) return null;
    let membership = null;
    if (companyFilter) {
      membership = query('SELECT id FROM memberships WHERE userId = ? AND businessId = ?', [userId, companyFilter])[0];
    }
    if (!membership) {
      const memberships = query('SELECT id FROM memberships WHERE userId = ?', [userId]);
      if (memberships.length === 1) membership = memberships[0];
    }
    if (!membership) return null;
    const profile = query('SELECT id FROM staff_profiles WHERE membershipId = ?', [membership.id])[0];
    return profile ? profile.id : null;
  }

  // One shift row shaped like the cloud's staffInclude response
  // (staffProfile with membership.user + branch), for start/end/update
  // and the active lookup.
  function selectShiftWithIncludes(id) {
    const rows = query(
      `SELECT s.*, sp.employeeId AS spEmployeeId, sp.designation AS spDesignation,
              m.userId AS mUserId, u.name AS userName,
              b.name AS branchName
       FROM shifts s
       LEFT JOIN staff_profiles sp ON sp.id = s.staffProfileId
       LEFT JOIN memberships m ON m.id = s.membershipId
       LEFT JOIN users u ON u.id = m.userId
       LEFT JOIN branches b ON b.id = s.branchId
       WHERE s.id = ?`,
      [id]
    );
    const row = rows[0];
    if (!row) return null;
    const shift = { ...row };
    delete shift.spEmployeeId; delete shift.spDesignation;
    delete shift.mUserId; delete shift.userName; delete shift.branchName;
    shift.staffProfile = row.spEmployeeId ? {
      id: row.staffProfileId,
      employeeId: row.spEmployeeId,
      designation: row.spDesignation || null,
      membership: { user: { id: row.mUserId || null, name: row.userName || null } }
    } : null;
    shift.branch = { id: row.branchId, name: row.branchName || null };
    return shift;
  }

  // GET /api/shifts — list, business-scoped via the membership join.
  app.get('/api/shifts', authMiddleware, (req, res) => {
    try {
      const { page = 1, limit = 10, staffProfileId = '', branchId = '', status = '', startDate = '', endDate = '' } = req.query;
      const { companyFilter, branchFilter } = getDataFilter(req.user, branchId || undefined, req.query.companyId);
      const skip = (Number(page) - 1) * Number(limit);
      const take = Number(limit);
      const startBound = startDate ? (String(startDate).length === 10 ? `${startDate}T00:00:00.000Z` : String(startDate)) : null;
      const endBound = endDate ? (String(endDate).length === 10 ? `${endDate}T23:59:59.999Z` : String(endDate)) : null;
      const whereSql = `FROM shifts s JOIN memberships m ON m.id = s.membershipId
        LEFT JOIN staff_profiles sp ON sp.id = s.staffProfileId
        LEFT JOIN users u ON u.id = m.userId
        LEFT JOIN branches b ON b.id = s.branchId
        WHERE (? IS NULL OR m.businessId = ?)
          AND (? IS NULL OR s.branchId = ?)
          AND (? IS NULL OR s.staffProfileId = ?)
          AND (? IS NULL OR s.status = ?)
          AND (? IS NULL OR s.shiftDate >= ?)
          AND (? IS NULL OR s.shiftDate <= ?)`;
      const whereParams = [
        companyFilter, companyFilter,
        branchFilter, branchFilter,
        staffProfileId || null, staffProfileId || null,
        status || null, status || null,
        startBound, startBound,
        endBound, endBound
      ];
      const rows = query(
        `SELECT s.*, sp.employeeId AS spEmployeeId, sp.designation AS spDesignation,
                m.userId AS mUserId, u.name AS userName, b.name AS branchName
         ${whereSql}
         ORDER BY s.shiftDate DESC LIMIT ? OFFSET ?`,
        [...whereParams, take, skip]
      );
      const totalRow = query(`SELECT COUNT(*) as total ${whereSql}`, whereParams)[0];
      const total = totalRow ? totalRow.total : 0;
      const shifts = rows.map((row) => {
        const shift = { ...row };
        delete shift.spEmployeeId; delete shift.spDesignation;
        delete shift.mUserId; delete shift.userName; delete shift.branchName;
        shift.staffProfile = row.spEmployeeId ? {
          id: row.staffProfileId,
          employeeId: row.spEmployeeId,
          designation: row.spDesignation || null,
          membership: { user: { id: row.mUserId || null, name: row.userName || null } }
        } : null;
        shift.branch = { id: row.branchId, name: row.branchName || null };
        return shift;
      });
      return res.json({ success: true, data: { shifts, pagination: { page: Number(page), limit: Number(limit), total, pages: Math.ceil(total / Number(limit)) } } });
    } catch (e) {
      console.error('[Shifts] Error fetching shifts:', e.message);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // GET /api/shifts/stats — counts + sums for the scoped business.
  app.get('/api/shifts/stats', authMiddleware, (req, res) => {
    try {
      const { branchId, startDate, endDate } = req.query;
      const { companyFilter, branchFilter } = getDataFilter(req.user, branchId || undefined, req.query.companyId);
      const startBound = startDate ? (String(startDate).length === 10 ? `${startDate}T00:00:00.000Z` : String(startDate)) : null;
      const endBound = endDate ? (String(endDate).length === 10 ? `${endDate}T23:59:59.999Z` : String(endDate)) : null;
      const whereSql = `FROM shifts s JOIN memberships m ON m.id = s.membershipId
        WHERE (? IS NULL OR m.businessId = ?)
          AND (? IS NULL OR s.branchId = ?)
          AND (? IS NULL OR s.shiftDate >= ?)
          AND (? IS NULL OR s.shiftDate <= ?)`;
      const whereParams = [companyFilter, companyFilter, branchFilter, branchFilter, startBound, startBound, endBound, endBound];
      const count = (extraWhere) => {
        const row = query(`SELECT COUNT(*) as c ${whereSql} ${extraWhere || ''}`, whereParams)[0];
        return row ? row.c : 0;
      };
      const sum = (col) => {
        const row = query(`SELECT COALESCE(SUM(${col}), 0) as s ${whereSql} AND s.status = 'COMPLETED'`, whereParams)[0];
        return row ? row.s : 0;
      };
      return res.json({
        success: true,
        data: {
          totalShifts: count(''),
          activeShifts: count(`AND s.status = 'ACTIVE'`),
          completedShifts: count(`AND s.status = 'COMPLETED'`),
          cancelledShifts: count(`AND s.status = 'CANCELLED'`),
          totalCashIn: sum('cashIn'),
          totalCashOut: sum('cashOut'),
          totalDifference: sum('difference')
        }
      });
    } catch (e) {
      console.error('[Shifts] Error fetching shift stats:', e.message);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // GET /api/shifts/active/:staffId — the staff member's ACTIVE shift.
  // B6: read req.params.staffId — the param the route defines.
  app.get('/api/shifts/active/:staffId', authMiddleware, (req, res) => {
    try {
      const staffProfileId = req.params.staffId;
      if (!staffProfileId) {
        return res.status(400).json({ success: false, message: 'staffId is required' });
      }
      const { companyFilter } = getDataFilter(req.user, undefined, req.query.companyId);
      const row = query(
        `SELECT s.* FROM shifts s JOIN memberships m ON m.id = s.membershipId
         WHERE s.staffProfileId = ? AND s.status = 'ACTIVE' AND (? IS NULL OR m.businessId = ?)
         ORDER BY s.startTime DESC LIMIT 1`,
        [staffProfileId, companyFilter, companyFilter]
      )[0];
      if (!row) return res.json({ success: true, data: null });
      const shift = selectShiftWithIncludes(row.id);
      const { isStale, staleReason } = shiftStaleInfo(shift);
      return res.json({ success: true, data: { ...shift, isStale, staleReason } });
    } catch (e) {
      console.error('[Shifts] Error fetching active shift:', e.message);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // POST /api/shifts/start — open a shift (B1: own shift only, unless
  // privileged; business + branch must match the scoped business).
  app.post('/api/shifts/start', authMiddleware, (req, res) => {
    try {
      const { staffProfileId, branchId, shiftDate, startTime, openingBalance = 0, notes } = req.body || {};
      if (!staffProfileId || !branchId || !shiftDate || !startTime) {
        return res.status(400).json({ success: false, message: 'Validation error', errors: ['staffProfileId, branchId, shiftDate and startTime are required'] });
      }
      if (!Number.isFinite(Number(openingBalance)) || Number(openingBalance) < 0) {
        return res.status(400).json({ success: false, message: 'Validation error', errors: ['openingBalance must be 0 or more'] });
      }
      const { companyFilter, role } = getDataFilter(req.user, branchId, req.query.companyId);
      const profile = query(
        `SELECT sp.*, m.businessId AS businessId FROM staff_profiles sp
         JOIN memberships m ON m.id = sp.membershipId WHERE sp.id = ?`,
        [staffProfileId]
      )[0];
      if (!profile) return res.status(404).json({ success: false, message: 'Staff not found' });
      if (!profile.isActive) return res.status(400).json({ success: false, message: 'Staff is not active' });
      if (companyFilter && profile.businessId !== companyFilter) {
        return res.status(404).json({ success: false, message: 'Staff not found' });
      }
      const branchRow = query('SELECT companyId FROM branches WHERE id = ?', [branchId])[0];
      if (!branchRow) return res.status(404).json({ success: false, message: 'Branch not found' });
      if (companyFilter && branchRow.companyId !== companyFilter) {
        return res.status(404).json({ success: false, message: 'Branch not found' });
      }
      if (!isShiftPrivileged(role)) {
        const ownProfileId = resolveCallerStaffProfileId(req, companyFilter);
        if (!ownProfileId || ownProfileId !== staffProfileId) {
          return res.status(403).json({ success: false, message: 'You can only open your own shift' });
        }
      }
      const existing = query("SELECT id FROM shifts WHERE staffProfileId = ? AND status = 'ACTIVE' LIMIT 1", [staffProfileId])[0];
      if (existing) return res.status(400).json({ success: false, message: 'Staff already has an active shift' });

      const id = uuid();
      const timestamp = now();
      const shiftDateIso = new Date(shiftDate).toISOString();
      const startTimeIso = new Date(startTime).toISOString();
      // Legacy `name` is NOT NULL on upgraded DBs (roster-shaped table)
      // and nothing reads it — store a readable day label.
      const ok = run(
        `INSERT INTO shifts (id, staffProfileId, membershipId, branchId, shiftDate, startTime, openingBalance, cashIn, cashOut, status, notes, name, companyId, createdBy, createdAt, updatedAt)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [id, staffProfileId, profile.membershipId, branchId, shiftDateIso, startTimeIso, Number(openingBalance) || 0, 0, 0, 'ACTIVE', notes || null, `Shift ${shiftDateIso.slice(0, 10)}`, profile.businessId, (req.user && req.user.id) || null, timestamp, timestamp]
      );
      if (!ok) return res.status(500).json({ success: false, message: 'Failed to open shift' });
      saveDatabase();
      const shift = selectShiftWithIncludes(id);
      if (shift) handleDataChange('shifts', 'create', { ...sanitizeShiftRow(shift), companyId: profile.businessId });
      return res.status(201).json({ success: true, data: shift, message: 'Shift started successfully' });
    } catch (e) {
      console.error('[Shifts] Error starting shift:', e.message);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // POST /api/shifts/end — close a shift with the counted balance.
  app.post('/api/shifts/end', authMiddleware, (req, res) => {
    try {
      const { shiftId, endTime, actualBalance, notes } = req.body || {};
      if (!shiftId || !endTime || actualBalance === undefined || actualBalance === null) {
        return res.status(400).json({ success: false, message: 'Validation error', errors: ['shiftId, endTime and actualBalance are required'] });
      }
      if (!Number.isFinite(Number(actualBalance)) || Number(actualBalance) < 0) {
        return res.status(400).json({ success: false, message: 'Validation error', errors: ['actualBalance must be 0 or more'] });
      }
      const { companyFilter, role } = getDataFilter(req.user, undefined, req.query.companyId);
      const shift = query(
        `SELECT s.*, m.businessId AS businessId FROM shifts s
         JOIN memberships m ON m.id = s.membershipId WHERE s.id = ?`,
        [shiftId]
      )[0];
      if (!shift) return res.status(404).json({ success: false, message: 'Shift not found' });
      if (companyFilter && shift.businessId !== companyFilter) {
        return res.status(404).json({ success: false, message: 'Shift not found' });
      }
      if (!isShiftPrivileged(role)) {
        const ownProfileId = resolveCallerStaffProfileId(req, companyFilter);
        if (!ownProfileId || ownProfileId !== shift.staffProfileId) {
          return res.status(403).json({ success: false, message: 'You can only close your own shift' });
        }
      }
      if (shift.status !== 'ACTIVE') return res.status(400).json({ success: false, message: 'Shift is not active' });

      const expectedBalance = (Number(shift.openingBalance) || 0) + (Number(shift.cashIn) || 0) - (Number(shift.cashOut) || 0);
      const actual = Number(actualBalance);
      const difference = actual - expectedBalance;
      const timestamp = now();
      // companyId is backfilled here: a pulled row carries NULL until
      // its first local mutation, and the push op needs it for routing.
      const ok = run(
        `UPDATE shifts SET endTime = ?, actualBalance = ?, expectedBalance = ?, difference = ?, status = 'COMPLETED', notes = ?, companyId = ?, updatedAt = ? WHERE id = ?`,
        [new Date(endTime).toISOString(), actual, expectedBalance, difference, notes || shift.notes, shift.businessId, timestamp, shiftId]
      );
      if (!ok) return res.status(500).json({ success: false, message: 'Failed to close shift' });
      saveDatabase();
      const updated = selectShiftWithIncludes(shiftId);
      if (updated) handleDataChange('shifts', 'update', { ...sanitizeShiftRow(updated), companyId: shift.businessId });
      return res.json({ success: true, data: updated, message: 'Shift ended successfully' });
    } catch (e) {
      console.error('[Shifts] Error ending shift:', e.message);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // PUT /api/shifts/:id — drawer movements (cashIn/cashOut/notes) on an
  // ACTIVE shift. Same ownership + scoping as end.
  app.put('/api/shifts/:id', authMiddleware, (req, res) => {
    try {
      const { id } = req.params;
      const { cashIn, cashOut, notes } = req.body || {};
      if (cashIn !== undefined && (!Number.isFinite(Number(cashIn)) || Number(cashIn) < 0)) {
        return res.status(400).json({ success: false, message: 'Validation error', errors: ['cashIn must be 0 or more'] });
      }
      if (cashOut !== undefined && (!Number.isFinite(Number(cashOut)) || Number(cashOut) < 0)) {
        return res.status(400).json({ success: false, message: 'Validation error', errors: ['cashOut must be 0 or more'] });
      }
      const { companyFilter, role } = getDataFilter(req.user, undefined, req.query.companyId);
      const shift = query(
        `SELECT s.*, m.businessId AS businessId FROM shifts s
         JOIN memberships m ON m.id = s.membershipId WHERE s.id = ?`,
        [id]
      )[0];
      if (!shift) return res.status(404).json({ success: false, message: 'Shift not found' });
      if (companyFilter && shift.businessId !== companyFilter) {
        return res.status(404).json({ success: false, message: 'Shift not found' });
      }
      if (!isShiftPrivileged(role)) {
        const ownProfileId = resolveCallerStaffProfileId(req, companyFilter);
        if (!ownProfileId || ownProfileId !== shift.staffProfileId) {
          return res.status(403).json({ success: false, message: 'You can only update your own shift' });
        }
      }
      if (shift.status !== 'ACTIVE') return res.status(400).json({ success: false, message: 'Shift is not active' });

      const newCashIn = cashIn !== undefined ? Number(cashIn) : (Number(shift.cashIn) || 0);
      const newCashOut = cashOut !== undefined ? Number(cashOut) : (Number(shift.cashOut) || 0);
      const expectedBalance = (Number(shift.openingBalance) || 0) + newCashIn - newCashOut;
      const ok = run(
        `UPDATE shifts SET cashIn = ?, cashOut = ?, notes = ?, expectedBalance = ?, companyId = ?, updatedAt = ? WHERE id = ?`,
        [newCashIn, newCashOut, notes !== undefined ? notes : shift.notes, expectedBalance, shift.businessId, now(), id]
      );
      if (!ok) return res.status(500).json({ success: false, message: 'Failed to update shift' });
      saveDatabase();
      const updated = selectShiftWithIncludes(id);
      if (updated) handleDataChange('shifts', 'update', { ...sanitizeShiftRow(updated), companyId: shift.businessId });
      return res.json({ success: true, data: updated, message: 'Shift updated successfully' });
    } catch (e) {
      console.error('[Shifts] Error updating shift:', e.message);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

}

module.exports = {
  registerShiftsRoutes
};
