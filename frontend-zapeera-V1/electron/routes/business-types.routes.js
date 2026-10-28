/**
 * Business Types Routes — the per-type module list (2026-10-28: this
 * endpoint returned [] always, so the admin module-per-type view was
 * empty; it now computes from the shared applicability map, the same
 * port of the cloud's module-applicability.util.ts used by
 * /api/modules/enabled).
 */
function registerBusinessTypesRoutes(app, authMiddleware, deps) {
  const { query } = deps;
  const { modulesForBusinessType, STANDARD_MODULES } = require('../utils/module-applicability');

  const DEFAULT_TYPES = [
    { id: 'pharmacy', name: 'PHARMACY', label: 'Pharmacy', description: 'Pharmacy business' },
    { id: 'store', name: 'RETAIL_STORE', label: 'Store', description: 'Retail store' },
    { id: 'hotel', name: 'HOTEL', label: 'Hotel', description: 'Hotel business' },
    { id: 'clinic', name: 'CLINIC', label: 'Clinic', description: 'Clinic business' },
  ];

  app.get('/api/business-types', authMiddleware, (req, res) => {
    try {
      res.json({ success: true, data: DEFAULT_TYPES });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // Module catalog (all modules the desktop knows) — the admin
  // Business Type Management view lists these to toggle per type.
  app.get('/api/business-types/modules', authMiddleware, (req, res) => {
    res.json({ success: true, data: STANDARD_MODULES.map(m => ({ ...m, enabled: true })) });
  });

  app.get('/api/business-types/:id', authMiddleware, (req, res) => {
    const type = DEFAULT_TYPES.find(t => t.id === req.params.id || t.name === req.params.id);
    if (!type) return res.status(404).json({ success: false, message: 'Business type not found' });
    res.json({ success: true, data: type });
  });

  app.get('/api/business-types/:id/modules', authMiddleware, (req, res) => {
    const type = DEFAULT_TYPES.find(t => t.id === req.params.id || t.name.toUpperCase() === String(req.params.id).toUpperCase());
    if (!type) return res.status(404).json({ success: false, message: 'Business type not found' });
    res.json({ success: true, data: modulesForBusinessType(type.name) });
  });
}

module.exports = { registerBusinessTypesRoutes };
