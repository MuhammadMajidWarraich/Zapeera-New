function registerModulesRoutes(app, authMiddleware, deps) {
  const { query } = deps;

  const STANDARD_MODULES = [
    { name: 'sales', enabled: true, sortOrder: 1 },
    { name: 'inventory', enabled: true, sortOrder: 2 },
    { name: 'purchases', enabled: true, sortOrder: 3 },
    { name: 'reports', enabled: true, sortOrder: 4 },
    { name: 'prescriptions', enabled: true, sortOrder: 5 },
    { name: 'business_management', enabled: true, sortOrder: 6 },
    { name: 'expenses', enabled: true, sortOrder: 7 },
    { name: 'subscription', enabled: true, sortOrder: 8 },
  ];

  app.get('/api/modules/enabled', authMiddleware, (req, res) => {
    try {
      const companyId = req.headers['x-business-id'] || req.user?.companyId;

      if (req.user.role === 'SUPERADMIN') {
        return res.json({ success: true, data: STANDARD_MODULES });
      }

      res.json({ success: true, data: STANDARD_MODULES });
    } catch (e) {
      console.error('[Modules] error:', e.message);
      res.status(500).json({ success: false, message: e.message });
    }
  });
}

module.exports = {
  registerModulesRoutes
};
