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
  const { query, getDataFilter } = deps;

  // GET /api/prescriptions
  app.get('/api/prescriptions', authMiddleware, (req, res) => {
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
}

module.exports = {
  registerPrescriptionsRoutes
};
