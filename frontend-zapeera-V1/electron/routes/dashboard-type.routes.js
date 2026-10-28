/**
 * Dashboard-Type Routes (embedded port)
 * Port of the cloud type-specific workspace dashboards
 * (backend-zapeera-v1-main/src/controllers/dashboard-type.controller.ts).
 *
 * FIX 2026-10-28: the desktop ran the same React bundle as the web but the
 * embedded server never implemented GET /api/dashboard/pharmacy, so the five
 * pharmacy widgets (Prescriptions Today, Batches Expiring Soon, Reorder
 * Suggestions, Recent Prescriptions, Expiring Soon — Nearest First) 404'd
 * and the widget's catch {} swallowed it silently. This file ports the cloud
 * endpoint to the embedded SQLite server with the SAME response shape, so
 * the frontend is unchanged. The PHARMACY type guard mirrors the cloud's
 * enforceType: a business with a canonical type other than PHARMACY gets
 * 400 DASHBOARD_TYPE_MISMATCH; custom/unknown types fall through.
 *
 * Day window follows the embedded convention (UTC calendar day, like
 * /api/reports/dashboard and /api/dashboard/stats) — the cloud uses its
 * server-local day; both servers run UTC, so the windows agree.
 */

const CANONICAL_TYPES = ['PHARMACY', 'DEPARTMENTAL_STORE', 'RETAIL_STORE', 'HOTEL', 'CLINIC'];
const DAY_MS = 24 * 60 * 60 * 1000;

function registerDashboardTypeRoutes(app, authMiddleware, deps) {
  const { query, getDataFilter } = deps;

  // GET /api/dashboard/pharmacy
  app.get('/api/dashboard/pharmacy', authMiddleware, (req, res) => {
    try {
      const { branchFilter, companyFilter } = getDataFilter(req.user, req.query.branchId, req.query.companyId);

      // PHARMACY type guard (mirrors cloud enforceType)
      if (companyFilter) {
        const company = query('SELECT businessType FROM companies WHERE id = ?', [companyFilter])[0];
        const actual = String(company?.businessType || '').trim().toUpperCase();
        if (CANONICAL_TYPES.includes(actual) && actual !== 'PHARMACY') {
          return res.status(400).json({
            success: false,
            code: 'DASHBOARD_TYPE_MISMATCH',
            message: `This dashboard is for PHARMACY businesses; the selected business is ${actual}.`
          });
        }
      }

      // UTC day window (embedded convention)
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const tomorrow = new Date(today);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const horizon = new Date(today);
      horizon.setUTCDate(horizon.getUTCDate() + 30);
      const todayISO = today.toISOString();
      const tomorrowISO = tomorrow.toISOString();
      const horizonISO = horizon.toISOString();
      const now = new Date();

      const scopeSql = (alias) => {
        let sql = '';
        if (branchFilter) sql += ` AND ${alias}.branchId = '${branchFilter}'`;
        if (companyFilter) sql += ` AND ${alias}.companyId = '${companyFilter}'`;
        return sql;
      };

      // Prescriptions today (non-voided only; a NULL isActive locally means
      // "never voided" — the cloud column is NOT NULL true, the local DDL
      // has no default, so NULL rows must count too).
      const activeSql = (alias) => ` AND (${alias}.isActive IS NULL OR ${alias}.isActive = 1)`;
      const prescriptionsToday = query(
        `SELECT COUNT(*) as c FROM prescriptions p WHERE p.createdAt >= ? AND p.createdAt < ?${activeSql('p')}${scopeSql('p')}`,
        [todayISO, tomorrowISO]
      )[0]?.c || 0;

      // Awaiting dispensing: today's prescriptions with no sale linked
      const prescriptionsAwaiting = query(
        `SELECT COUNT(*) as c FROM prescriptions p WHERE p.createdAt >= ? AND p.createdAt < ?${activeSql('p')}${scopeSql('p')} AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.prescriptionId = p.id)`,
        [todayISO, tomorrowISO]
      )[0]?.c || 0;

      // Recent prescriptions (top 5, newest first) with item counts
      const recentPrescriptions = query(
        `SELECT p.id, p.patientName, p.doctorName, p.issuedDate, p.createdAt,
          (SELECT COUNT(*) FROM prescription_items pi WHERE pi.prescriptionId = p.id) as itemsCount
         FROM prescriptions p WHERE 1=1${activeSql('p')}${scopeSql('p')}
         ORDER BY p.createdAt DESC LIMIT 5`
      ).map((p) => ({
        id: p.id,
        patientName: p.patientName,
        doctorName: p.doctorName,
        itemsCount: Number(p.itemsCount) || 0,
        issuedDate: p.issuedDate,
        createdAt: p.createdAt
      }));

      // Batches expiring in the next 30 days (top 5, nearest first).
      // DATE() on both sides: expireDate is an ISO timestamp for synced
      // rows but a bare YYYY-MM-DD for locally-created batches, and a bare
      // date equal to today must still count as expiring today (a raw
      // string compare would drop it: '2026-10-28' < '2026-10-28T00:00…').
      const todayDate = todayISO.slice(0, 10);
      const horizonDate = horizonISO.slice(0, 10);
      const expiringBatches = query(
        `SELECT b.id, b.batchNo, b.expireDate, b.quantity, p.name as product_name
         FROM batches b
         LEFT JOIN products p ON b.productId = p.id
         WHERE b.isActive = 1 AND b.quantity > 0 AND DATE(b.expireDate) >= ? AND DATE(b.expireDate) < ?${scopeSql('b')}
         ORDER BY b.expireDate ASC LIMIT 5`,
        [todayDate, horizonDate]
      );
      const expiringSoonCount = query(
        `SELECT COUNT(*) as c FROM batches b WHERE b.isActive = 1 AND b.quantity > 0 AND DATE(b.expireDate) >= ? AND DATE(b.expireDate) < ?${scopeSql('b')}`,
        [todayDate, horizonDate]
      )[0]?.c || 0;
      const expiredCount = query(
        `SELECT COUNT(*) as c FROM batches b WHERE b.isActive = 1 AND b.quantity > 0 AND DATE(b.expireDate) < ?${scopeSql('b')}`,
        [todayDate]
      )[0]?.c || 0;

      // Products in scope with their batch stock (mirrors the cloud: total
      // stock = ALL active batches; live stock = non-expired active
      // batches only). One query per definition, filtered in JS exactly
      // like the cloud's lowStock / reorderLines loops.
      const products = query(
        `SELECT p.id, p.name, p.minStock, p.reorderLevel, p.reorderQuantity,
          COALESCE((SELECT SUM(b.quantity) FROM batches b WHERE b.productId = p.id AND b.isActive = 1), 0) as totalStock,
          COALESCE((SELECT SUM(b.quantity) FROM batches b WHERE b.productId = p.id AND b.isActive = 1 AND (b.expireDate IS NULL OR b.expireDate > ?)), 0) as liveStock
         FROM products p WHERE p.isActive = 1${scopeSql('p')}`,
        [now.toISOString()]
      );

      const lowStock = [];
      const reorderLines = [];
      for (const product of products) {
        const totalStock = Number(product.totalStock) || 0;
        const liveStock = Number(product.liveStock) || 0;
        const minStock = product.minStock === null || product.minStock === undefined ? 0 : Number(product.minStock);
        if (totalStock <= minStock) {
          lowStock.push({ id: product.id, name: product.name, stock: totalStock, minStock });
        }
        if (product.reorderLevel !== null && product.reorderLevel !== undefined && liveStock <= product.reorderLevel) {
          reorderLines.push({
            id: product.id,
            name: product.name,
            currentStock: liveStock,
            reorderLevel: product.reorderLevel,
            suggestedQty: product.reorderQuantity
              ? product.reorderQuantity
              : Math.max(1, product.reorderLevel * 2 - liveStock)
          });
        }
      }
      lowStock.sort((a, b) => a.stock - b.stock);
      reorderLines.sort((a, b) => a.currentStock - b.currentStock);

      return res.json({
        success: true,
        data: {
          businessType: 'PHARMACY',
          stats: {
            prescriptionsToday: Number(prescriptionsToday) || 0,
            prescriptionsAwaiting: Number(prescriptionsAwaiting) || 0,
            expiringSoonCount: Number(expiringSoonCount) || 0,
            expiredCount: Number(expiredCount) || 0,
            lowStockCount: lowStock.length,
            reorderCount: reorderLines.length
          },
          recentPrescriptions,
          expiringSoon: expiringBatches.map((b) => ({
            id: b.id,
            productName: b.product_name || 'Unknown Product',
            batchNo: b.batchNo,
            expireDate: b.expireDate,
            quantity: b.quantity,
            daysToExpiry: b.expireDate
              ? Math.ceil((new Date(b.expireDate).getTime() - today.getTime()) / DAY_MS)
              : null
          })),
          lowStock: lowStock.slice(0, 5),
          reorderSuggestions: reorderLines.slice(0, 5)
        }
      });
    } catch (e) {
      console.error('[Dashboard/Pharmacy] Error:', e.message);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });
}

module.exports = {
  registerDashboardTypeRoutes
};
