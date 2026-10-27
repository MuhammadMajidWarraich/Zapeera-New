/**
 * Staff Routes — staff-profile list for the POS + Shift Management.
 * Extracted from routes/index.js.
 *
 * Shift gaps fix (2026-10-27, B2): there was NO embedded /api/staff
 * route at all, so on the desktop the POS could never resolve the
 * signed-in cashier's staff-profile id (myStaffProfileId stayed null)
 * and the shift pill stayed hidden. This mirrors the cloud
 * getStaff / getStaffMember (same envelope, same flat fields), scoped
 * to the selected business via the membership join (L-4).
 *
 * The local memberships table carries role as TEXT and branchIds as a
 * JSON array string (there is no membership-branches join table
 * locally), so the branch filter runs in JS after the SQL filters.
 */

function registerStaffRoutes(app, authMiddleware, deps) {
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

  function shapeStaffRow(row) {
    const branchIds = (() => {
      try {
        const parsed = JSON.parse(row.mBranchIds || '[]');
        return Array.isArray(parsed) ? parsed : [];
      } catch { return []; }
    })();
    const branch = branchIds.length > 0
      ? (() => {
          const b = query('SELECT id, name FROM branches WHERE id = ?', [branchIds[0]])[0];
          return b ? { id: b.id, name: b.name } : null;
        })()
      : null;
    const staff = { ...row };
    delete staff.mUserId; delete staff.mBusinessId; delete staff.mRole;
    delete staff.mBranchIds; delete staff.userName; delete staff.userEmail;
    delete staff.userPhone; delete staff.userProfileImage;
    staff.name = row.userName || '';
    staff.email = row.userEmail || '';
    staff.phone = row.userPhone || '';
    staff.profileImage = row.userProfileImage || null;
    staff.staffId = row.employeeId;
    staff.position = row.designation;
    staff.hireDate = row.joiningDate;
    staff.branch = branch;
    staff.role = row.mRole || null;
    staff.membership = {
      id: row.membershipId,
      userId: row.mUserId,
      businessId: row.mBusinessId,
      role: row.mRole || null,
      user: { id: row.mUserId || null, name: row.userName || null, email: row.userEmail || null, phone: row.userPhone || null, profileImage: row.userProfileImage || null }
    };
    return staff;
  }

  // GET /api/staff — paginated staff list for the scoped business.
  app.get('/api/staff', authMiddleware, (req, res) => {
    try {
      const { page = 1, limit = 10, search = '', status = '', branchId = '', department = '', isActive = 'true' } = req.query;
      const { companyFilter } = getDataFilter(req.user, branchId || undefined, req.query.companyId);
      const isActiveFilter = String(isActive).toLowerCase();
      const whereParts = ['(? IS NULL OR m.businessId = ?)'];
      const params = [companyFilter, companyFilter];
      if (isActiveFilter !== 'all') {
        whereParts.push('sp.isActive = ?');
        params.push(isActiveFilter === 'true' ? 1 : 0);
      }
      if (department) {
        whereParts.push('sp.department = ?');
        params.push(department);
      }
      if (status) {
        whereParts.push('m.role = ?');
        params.push(status);
      }
      if (search) {
        whereParts.push('(sp.employeeId LIKE ? OR sp.designation LIKE ? OR sp.department LIKE ? OR u.name LIKE ? OR u.email LIKE ?)');
        const like = `%${search}%`;
        params.push(like, like, like, like, like);
      }
      // Staff lists are small (tens of rows per business) — fetch the
      // filtered set and paginate in JS so the branch filter (a JSON
      // array on memberships.branchIds) and the total stay honest.
      const rows = query(
        `SELECT sp.*, m.id AS membershipId, m.userId AS mUserId, m.businessId AS mBusinessId,
                m.role AS mRole, m.branchIds AS mBranchIds,
                u.name AS userName, u.email AS userEmail, u.phone AS userPhone, u.profileImage AS userProfileImage
         FROM staff_profiles sp
         JOIN memberships m ON m.id = sp.membershipId
         LEFT JOIN users u ON u.id = m.userId
         WHERE ${whereParts.join(' AND ')}
         ORDER BY sp.createdAt DESC LIMIT 1000`,
        params
      );
      let filtered = rows;
      if (branchId) {
        filtered = rows.filter((row) => {
          try {
            const ids = JSON.parse(row.mBranchIds || '[]');
            return Array.isArray(ids) && ids.includes(branchId);
          } catch { return false; }
        });
      }
      const shaped = filtered.map(shapeStaffRow);
      const total = shaped.length;
      const take = Number(limit);
      const skip = (Number(page) - 1) * take;
      const staff = shaped.slice(skip, skip + take);
      return res.json({ success: true, data: { staff, pagination: { page: Number(page), limit: take, total, pages: Math.ceil(total / take) } } });
    } catch (e) {
      console.error('[Staff] Error fetching staff:', e.message);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // GET /api/staff/:id — one staff profile, business-scoped.
  app.get('/api/staff/:id', authMiddleware, (req, res) => {
    try {
      const { companyFilter } = getDataFilter(req.user, undefined, req.query.companyId);
      const row = query(
        `SELECT sp.*, m.id AS membershipId, m.userId AS mUserId, m.businessId AS mBusinessId,
                m.role AS mRole, m.branchIds AS mBranchIds,
                u.name AS userName, u.email AS userEmail, u.phone AS userPhone, u.profileImage AS userProfileImage
         FROM staff_profiles sp
         JOIN memberships m ON m.id = sp.membershipId
         LEFT JOIN users u ON u.id = m.userId
         WHERE sp.id = ? AND (? IS NULL OR m.businessId = ?)`,
        [req.params.id, companyFilter, companyFilter]
      )[0];
      if (!row) return res.status(404).json({ success: false, message: 'Staff not found' });
      return res.json({ success: true, data: shapeStaffRow(row) });
    } catch (e) {
      console.error('[Staff] Error fetching staff member:', e.message);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

}

module.exports = {
  registerStaffRoutes
};
