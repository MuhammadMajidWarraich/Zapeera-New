function registerSyncRoutes(app, authMiddleware, deps) {
  const { cloudApi, syncService, now, getOfflineQueue, SYNC_CONFIG, CLOUD_API_URL } = deps;

  // GET /api/sync/status - Current sync state
  app.get('/api/sync/status', authMiddleware, async (req, res) => {
    try {
      const connState = syncService.getConnectionState();
      res.json({
        success: true,
        data: {
          connectionState: connState,
          lastSync: syncService.getLastSyncTime(),
          pendingChanges: (getOfflineQueue() || []).filter(q => !q.synced).length,
          queueSize: (getOfflineQueue() || []).length,
          status: connState,
          syncInProgress: connState === 'SYNCING',
          cloudApiUrl: CLOUD_API_URL ? 'configured' : 'not configured',
          config: {
            pollInterval: SYNC_CONFIG.POLL_INTERVAL
          }
        }
      });
    } catch (e) {
      res.json({
        success: true,
        data: { connectionState: 'UNKNOWN', lastSync: null, status: 'error' }
      });
    }
  });

  // POST /api/sync/push - Push local changes to Cloud API
  app.post('/api/sync/push', authMiddleware, async (req, res) => {
    try {
      if (!cloudApi) {
        return res.status(503).json({
          success: false,
          message: 'Cloud API not available. Data is safely stored in SQLite and will sync when connected.'
        });
      }

      const pushResult = await syncService.syncAll();
      res.json({
        success: pushResult.success !== false,
        message: pushResult.success ? 'Sync complete' : 'Sync failed',
        data: {
          ...pushResult,
          timestamp: new Date().toISOString()
        }
      });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // POST /api/sync/pull - Pull from Cloud API
  app.post('/api/sync/pull', authMiddleware, async (req, res) => {
    try {
      const result = await syncService.pullAll();
      res.json({ success: result.success !== false, data: result });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // POST /api/sync/full - Full bidirectional sync
  app.post('/api/sync/full', authMiddleware, async (req, res) => {
    try {
      const pullResult = await syncService.pullAll();
      const pushResult = await syncService.syncAll();
      res.json({
        success: true,
        data: { pull: pullResult, push: pushResult }
      });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // GET /api/sync/check-connectivity - Quick connectivity check
  app.get('/api/sync/check-connectivity', authMiddleware, async (req, res) => {
    try {
      const connState = syncService.getConnectionState();
      const isOnline = connState === 'SYNC_READY' || connState === 'SYNCED' || connState === 'SYNCING';
      res.json({
        success: true,
        data: {
          isOnline,
          connectionState: connState,
          cloudApiUrl: CLOUD_API_URL ? 'SET' : 'NOT SET',
          lastCheck: now(),
          queueSize: (getOfflineQueue() || []).length
        }
      });
    } catch (e) {
      res.json({ success: false, data: { isOnline: false }, message: e.message });
    }
  });

  // GET /api/sync/queue - View pending queue
  app.get('/api/sync/queue', authMiddleware, (req, res) => {
    try {
      const all = getOfflineQueue() || [];
      const pending = all.filter(q => !q.synced);
      res.json({
        success: true,
        data: {
          total: all.length,
          pending: pending.length,
          items: pending.slice(0, 50).map(q => ({
            id: q.id,
            table: q.tableName,
            operation: q.operation,
            timestamp: q.timestamp,
            retries: q.retries
          }))
        }
      });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // DELETE /api/sync/queue - Clear queue
  app.delete('/api/sync/queue', authMiddleware, (req, res) => {
    try {
      const cleared = (getOfflineQueue() || []).length;
      syncService.clearOfflineQueue();
      res.json({ success: true, data: { cleared } });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });
}

module.exports = {
  registerSyncRoutes
};
