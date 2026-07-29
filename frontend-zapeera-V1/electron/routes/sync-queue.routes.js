function registerSyncQueueRoutes(app, authMiddleware, deps) {
  const { syncQueueService } = deps;

  // GET /api/sync/queue/status - Queue status
  app.get('/api/sync/queue/status', authMiddleware, (req, res) => {
    try {
      const status = syncQueueService.getQueueStatus();
      res.json({ success: true, data: status });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // POST /api/sync/queue/push - Push pending operations to Cloud API
  app.post('/api/sync/queue/push', authMiddleware, async (req, res) => {
    try {
      const cloudApi = deps.cloudApi;
      const result = await syncQueueService.pushPendingToCloudApi(cloudApi);
      res.json({ success: true, data: result });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // GET /api/sync/queue/pending - Get pending operations
  app.get('/api/sync/queue/pending', authMiddleware, (req, res) => {
    try {
      const pending = syncQueueService.getPendingOperations(parseInt(req.query.limit) || 50);
      res.json({ success: true, data: pending });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });
}

module.exports = { registerSyncQueueRoutes };
