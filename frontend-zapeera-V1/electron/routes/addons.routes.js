/**
 * Subscription Add-on Routes (embedded / desktop)
 *
 * Mirrors the web backend's /api/subscription/addons contract
 * (addon.controller.ts) against the local sql.js database, so the shared
 * frontend's Billing → Add-ons section works identically on desktop:
 *   GET  /api/subscription/addons/catalogue
 *   GET  /api/subscription/addons?businessId=
 *   POST /api/subscription/addons            (purchase / adjust — activates immediately on desktop)
 *   POST /api/subscription/addons/cancel     (CANCEL_PENDING until paid-through; nothing is deleted)
 *
 * All plan/add-on math goes through services/addon-limits.js — the desktop
 * mirror of the web's ONE effective-limits function.
 */

const {
  ADDON_CATALOGUE,
  isAddonType,
  getEffectiveLimits,
  checkAddonPurchasable,
  computeAddonPeriod,
  normalizeMonths,
  serializeAddon,
} = require('../services/addon-limits');

function registerAddonRoutes(app, authMiddleware, deps) {
  const { query, run, uuid, now } = deps;

  const resolveBusinessId = (req) =>
    (req.body && req.body.businessId) ||
    (req.query && req.query.businessId) ||
    req.headers['x-business-id'] ||
    req.headers['x-company-id'] ||
    null;

  // Same ownership rule as backup.routes.js: creator, or an ACTIVE OWNER membership.
  const isOwner = (userId, business) => {
    if (!business) return false;
    if (business.createdBy === userId) return true;
    const m = query(
      "SELECT id FROM memberships WHERE userId = ? AND businessId = ? AND status IN ('ACTIVE','DOWNLOADED') AND UPPER(COALESCE(role,'')) = 'OWNER'",
      [userId, business.id]
    )[0];
    return !!m;
  };

  const findBusiness = (businessId) =>
    query('SELECT * FROM companies WHERE id = ? AND isActive = 1', [businessId])[0] || null;

  // GET /api/subscription/addons/catalogue — the 7 add-ons with prices.
  app.get('/api/subscription/addons/catalogue', authMiddleware, (req, res) => {
    return res.json({ success: true, data: Object.values(ADDON_CATALOGUE) });
  });

  // GET /api/subscription/addons?businessId= — the business's add-ons + effective limits.
  app.get('/api/subscription/addons', authMiddleware, (req, res) => {
    try {
      const businessId = resolveBusinessId(req);
      if (!businessId) {
        return res.status(400).json({ success: false, message: 'businessId is required' });
      }
      const business = findBusiness(String(businessId));
      if (!isOwner(req.user.id, business)) {
        return res.status(403).json({ success: false, message: 'Only the business owner can view add-ons.' });
      }
      const rows = query('SELECT * FROM subscription_addons WHERE businessId = ? ORDER BY createdAt ASC', [
        String(businessId),
      ]);
      const limits = getEffectiveLimits(query, String(businessId));
      return res.json({
        success: true,
        data: {
          businessId: String(businessId),
          planId: limits.planId,
          planName: limits.planName,
          isTrial: limits.isTrial,
          limits: {
            maxBranches: limits.maxBranches,
            maxStaffSeats: limits.maxStaffSeats,
            staffAllowed: limits.staffAllowed,
            financeAllowed: limits.financeAllowed,
            advancedReportsAllowed: limits.advancedReportsAllowed,
            multiBranchReportsAllowed: limits.multiBranchReportsAllowed,
            whatsappPack: limits.whatsappPack,
            voiceTokenQuota: limits.voiceTokenQuota,
          },
          monthlyAddonSpend: limits.monthlyAddonSpend,
          addons: rows.map(serializeAddon),
        },
      });
    } catch (e) {
      console.error('[Addons] list error:', e.message);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // POST /api/subscription/addons — owner buys / adjusts an add-on.
  // Desktop purchases activate immediately (embedded convention).
  app.post('/api/subscription/addons', authMiddleware, (req, res) => {
    try {
      const businessId = resolveBusinessId(req);
      const type = req.body && req.body.type;
      if (!businessId) {
        return res.status(400).json({ success: false, message: 'businessId is required' });
      }
      if (!isAddonType(type)) {
        return res.status(400).json({ success: false, code: 'ADDON_UNKNOWN_TYPE', message: 'Unknown add-on type.' });
      }
      const business = findBusiness(String(businessId));
      if (!isOwner(req.user.id, business)) {
        return res.status(403).json({ success: false, message: 'Only the business owner can buy add-ons.' });
      }

      const limitsBefore = getEffectiveLimits(query, String(businessId));
      if (!limitsBefore.hasSubscription) {
        return res
          .status(404)
          .json({ success: false, code: 'ADDON_NO_SUBSCRIPTION', message: 'No subscription found for this business.' });
      }
      const check = checkAddonPurchasable(limitsBefore, type);
      if (!check.ok) {
        return res.status(check.statusCode).json({ success: false, code: check.code, message: check.message });
      }

      const entry = ADDON_CATALOGUE[type];
      const quantity = entry.stackable
        ? Math.min(1000, Math.max(1, Math.floor(Number(req.body.quantity) || 1)))
        : 1;
      const months = normalizeMonths(req.body.months ?? 1);
      if (!months) {
        return res
          .status(400)
          .json({ success: false, code: 'ADDON_INVALID_MONTHS', message: 'Months must be a whole number between 1 and 36.' });
      }

      const nowDate = new Date();
      // Embedded memberships carry no plan period end → full requested months.
      const { periodEnd, chargedMonths } = computeAddonPeriod(nowDate, months, null);
      const upfrontAmount = entry.priceMonthly * quantity * chargedMonths;
      const periodEndIso = periodEnd.toISOString();
      const ts = now();

      const existing = query('SELECT * FROM subscription_addons WHERE businessId = ? AND type = ?', [
        String(businessId),
        type,
      ])[0];
      let row;
      if (existing) {
        run(
          'UPDATE subscription_addons SET quantity = ?, status = ?, periodEnd = ?, cancelledAt = NULL, updatedAt = ? WHERE id = ?',
          [quantity, 'ACTIVE', periodEndIso, ts, existing.id]
        );
        row = query('SELECT * FROM subscription_addons WHERE id = ?', [existing.id])[0];
      } else {
        const id = uuid();
        run(
          'INSERT INTO subscription_addons (id, businessId, type, quantity, status, startedAt, periodEnd, cancelledAt, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?)',
          [id, String(businessId), type, quantity, 'ACTIVE', ts, periodEndIso, null, ts, ts]
        );
        row = query('SELECT * FROM subscription_addons WHERE id = ?', [id])[0];
      }

      return res.json({
        success: true,
        message: `${entry.name} is active.`,
        data: {
          addon: serializeAddon(row),
          upfrontAmount,
          chargedMonths,
          periodEnd: periodEndIso,
        },
      });
    } catch (e) {
      console.error('[Addons] purchase error:', e.message);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // POST /api/subscription/addons/cancel — stays effective until the paid-through
  // date (CANCEL_PENDING); a PENDING request is withdrawn immediately (CANCELLED).
  app.post('/api/subscription/addons/cancel', authMiddleware, (req, res) => {
    try {
      const businessId = resolveBusinessId(req);
      const type = req.body && req.body.type;
      if (!businessId) {
        return res.status(400).json({ success: false, message: 'businessId is required' });
      }
      if (!isAddonType(type)) {
        return res.status(400).json({ success: false, code: 'ADDON_UNKNOWN_TYPE', message: 'Unknown add-on type.' });
      }
      const business = findBusiness(String(businessId));
      if (!isOwner(req.user.id, business)) {
        return res.status(403).json({ success: false, message: 'Only the business owner can cancel add-ons.' });
      }
      const existing = query('SELECT * FROM subscription_addons WHERE businessId = ? AND type = ?', [
        String(businessId),
        type,
      ])[0];
      if (!existing || String(existing.status).toUpperCase() === 'CANCELLED') {
        return res
          .status(404)
          .json({ success: false, code: 'ADDON_NOT_FOUND', message: 'This add-on is not active for the business.' });
      }
      const nextStatus = String(existing.status).toUpperCase() === 'PENDING' ? 'CANCELLED' : 'CANCEL_PENDING';
      const ts = now();
      run('UPDATE subscription_addons SET status = ?, cancelledAt = ?, updatedAt = ? WHERE id = ?', [
        nextStatus,
        ts,
        ts,
        existing.id,
      ]);
      const row = query('SELECT * FROM subscription_addons WHERE id = ?', [existing.id])[0];
      return res.json({
        success: true,
        message:
          nextStatus === 'CANCELLED'
            ? `${ADDON_CATALOGUE[type].name} request withdrawn.`
            : `${ADDON_CATALOGUE[type].name} will stay active until ${
                row.periodEnd ? new Date(row.periodEnd).toLocaleDateString() : 'the end of the paid period'
              }, then switch off. Nothing is deleted.`,
        data: { addon: serializeAddon(row) },
      });
    } catch (e) {
      console.error('[Addons] cancel error:', e.message);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });
}

module.exports = { registerAddonRoutes };
