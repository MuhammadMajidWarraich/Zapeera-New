function registerBusinessTypesRoutes(app, authMiddleware, deps) {
  const { query } = deps;

  const DEFAULT_TYPES = [
    { id: 'pharmacy', name: 'PHARMACY', label: 'Pharmacy', description: 'Pharmacy business' },
    { id: 'store', name: 'STORE', label: 'Store', description: 'Retail store' },
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

  app.get('/api/business-types/modules', authMiddleware, (req, res) => {
    res.json({ success: true, data: [] });
  });

  app.get('/api/business-types/:id', authMiddleware, (req, res) => {
    const type = DEFAULT_TYPES.find(t => t.id === req.params.id || t.name === req.params.id);
    if (!type) return res.status(404).json({ success: false, message: 'Business type not found' });
    res.json({ success: true, data: type });
  });

  app.get('/api/business-types/:id/modules', authMiddleware, (req, res) => {
    res.json({ success: true, data: [] });
  });
}

module.exports = { registerBusinessTypesRoutes };
