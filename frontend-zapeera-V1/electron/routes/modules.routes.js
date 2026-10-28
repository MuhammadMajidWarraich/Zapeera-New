/**
 * Modules Routes — enabled-module list, scoped to the caller's business
 * type (2026-10-28: previously returned all 8 modules enabled for every
 * business type, so a pharmacy saw clinic/hotel modules and vice versa).
 * The applicability map is the shared port of the cloud's
 * module-applicability.util.ts — see utils/module-applicability.js.
 */
function registerModulesRoutes(app, authMiddleware, deps) {
  const { query, getDataFilter } = deps;
  const { modulesForBusinessType, STANDARD_MODULES } = require('../utils/module-applicability');

  app.get('/api/modules/enabled', authMiddleware, (req, res) => {
    try {
      const companyId = req.headers['x-business-id'] || req.user?.companyId || req.user?.selectedCompanyId;

      if (req.user.role === 'SUPERADMIN') {
        return res.json({ success: true, data: STANDARD_MODULES.map(m => ({ ...m, enabled: true })) });
      }

      let businessType = null;
      if (companyId) {
        const company = query('SELECT businessType FROM companies WHERE id = ?', [companyId])[0];
        if (company && company.businessType) businessType = String(company.businessType).toUpperCase();
      }
      // Unknown / unset type: all modules apply (matches the shared util's
      // fall-through for unlisted types), same as the cloud's default.
      res.json({ success: true, data: modulesForBusinessType(businessType) });
    } catch (e) {
      console.error('[Modules] error:', e.message);
      res.status(500).json({ success: false, message: e.message });
    }
  });
}

module.exports = {
  registerModulesRoutes
};
