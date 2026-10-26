function registerSyncRoutes(app, authMiddleware, deps) {
  const { cloudApi, now, getOfflineQueue, SYNC_CONFIG, CLOUD_API_URL } = deps;
  // deps carries the sync ENGINE's functions spread flat (getConnectionState,
  // syncAllToPostgreSQL, ...), not a `syncService` object — the previous code
  // destructured deps.syncService (undefined), so /api/sync/status threw and
  // its catch answered connectionState 'UNKNOWN' forever. Build the engine
  // facade from what deps actually provides.
  const syncService = (deps.syncService && typeof deps.syncService.getConnectionState === 'function')
    ? deps.syncService
    : {
        getConnectionState: deps.getConnectionState || (() => 'OFFLINE'),
        getLastSyncTime: deps.getLastSyncTime || (() => null),
        syncAll: deps.syncAllToPostgreSQL || deps.syncBidirectional || (async () => ({ success: false })),
        pullAll: deps.pullAllFromPostgreSQL || deps.pullChangesFromCloud || (async () => ({ success: false })),
        clearOfflineQueue: () => {}
      };
  // Pending count from the durable sync_operations queue when available.
  const durablePending = () => {
    try {
      if (deps.syncQueueService && typeof deps.syncQueueService.getQueueStatus === 'function') {
        const qs = deps.syncQueueService.getQueueStatus();
        return { pending: (qs.pending || 0) + (qs.inFlight || 0), failed: qs.failed || 0 };
      }
    } catch (e) { /* fall through to the activity-log count */ }
    return { pending: (getOfflineQueue() || []).filter(q => !q.synced).length, failed: 0 };
  };

  // GET /api/sync/status - Current sync state
  app.get('/api/sync/status', authMiddleware, async (req, res) => {
    try {
      const connState = syncService.getConnectionState();
      res.json({
        success: true,
        data: {
          connectionState: connState,
          lastSync: syncService.getLastSyncTime(),
          pendingChanges: durablePending().pending,
          failedChanges: durablePending().failed,
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

  // ── Multi-counter sync review + reconciliation (R3/R7, 2026-10-26) ──
  // Desktop-mode proxy: the SPA calls these on the embedded server
  // (apiService base URL is 127.0.0.1:4201 in Electron) and they forward
  // to the cloud with the cloud JWT the sync engine already holds. The
  // business comes from the X-Business-ID header apiService sets (or an
  // explicit businessId query/body param). In web mode the same paths hit
  // the cloud directly, so the page code is identical in both shells.
  // Offline the proxy answers 503 with an empty summary instead of
  // failing the page — the badge simply hides its review count.
  const businessIdOf = (req) =>
    req.query.businessId || req.body?.businessId || req.headers['x-business-id'] || req.headers['x-company-id'] || null;
  const reviewUnavailable = (res, message) =>
    res.status(503).json({ success: false, message: message || 'Cloud unavailable — review data will load when back online.' });

  app.get('/api/sync/review/summary', authMiddleware, async (req, res) => {
    try {
      const businessId = businessIdOf(req);
      if (!businessId) return res.status(400).json({ success: false, message: 'businessId is required' });
      if (!cloudApi || typeof cloudApi.getSyncReviewSummary !== 'function') return reviewUnavailable(res);
      const result = await cloudApi.getSyncReviewSummary(businessId);
      res.json(result && result.success !== false ? result : { success: false, message: (result && result.message) || 'Cloud unavailable' });
    } catch (e) {
      reviewUnavailable(res, e.message);
    }
  });

  app.get('/api/sync/review', authMiddleware, async (req, res) => {
    try {
      const businessId = businessIdOf(req);
      if (!businessId) return res.status(400).json({ success: false, message: 'businessId is required' });
      if (!cloudApi || typeof cloudApi.getSyncReview !== 'function') return reviewUnavailable(res);
      const result = await cloudApi.getSyncReview(businessId, req.query.status || 'open', parseInt(req.query.limit, 10) || 50);
      res.json(result && result.success !== false ? result : { success: false, message: (result && result.message) || 'Cloud unavailable' });
    } catch (e) {
      reviewUnavailable(res, e.message);
    }
  });

  app.post('/api/sync/review/:saleId/resolve', authMiddleware, async (req, res) => {
    try {
      const businessId = businessIdOf(req);
      if (!businessId) return res.status(400).json({ success: false, message: 'businessId is required' });
      if (!cloudApi || typeof cloudApi.resolveSyncReview !== 'function') return reviewUnavailable(res);
      const result = await cloudApi.resolveSyncReview(businessId, req.params.saleId, req.body?.note);
      res.json(result && result.success !== false ? result : { success: false, message: (result && result.message) || 'Cloud unavailable' });
    } catch (e) {
      reviewUnavailable(res, e.message);
    }
  });

  app.post('/api/sync/reconciliations/run', authMiddleware, async (req, res) => {
    try {
      const businessId = businessIdOf(req);
      if (!businessId) return res.status(400).json({ success: false, message: 'businessId is required' });
      if (!cloudApi || typeof cloudApi.runReconciliation !== 'function') return reviewUnavailable(res);
      const result = await cloudApi.runReconciliation(businessId, req.body?.branchId);
      res.json(result && result.success !== false ? result : { success: false, message: (result && result.message) || 'Cloud unavailable' });
    } catch (e) {
      reviewUnavailable(res, e.message);
    }
  });

  app.get('/api/sync/reconciliations', authMiddleware, async (req, res) => {
    try {
      const businessId = businessIdOf(req);
      if (!businessId) return res.status(400).json({ success: false, message: 'businessId is required' });
      if (!cloudApi || typeof cloudApi.listReconciliations !== 'function') return reviewUnavailable(res);
      const result = await cloudApi.listReconciliations(businessId, req.query.status, parseInt(req.query.limit, 10) || 20);
      res.json(result && result.success !== false ? result : { success: false, message: (result && result.message) || 'Cloud unavailable' });
    } catch (e) {
      reviewUnavailable(res, e.message);
    }
  });

  app.post('/api/sync/reconciliations/:id/create-stock-take', authMiddleware, async (req, res) => {
    try {
      const businessId = businessIdOf(req);
      if (!businessId) return res.status(400).json({ success: false, message: 'businessId is required' });
      if (!cloudApi || typeof cloudApi.createStockTakeFromReconciliation !== 'function') return reviewUnavailable(res);
      const result = await cloudApi.createStockTakeFromReconciliation(businessId, req.params.id);
      res.json(result && result.success !== false ? result : { success: false, message: (result && result.message) || 'Cloud unavailable' });
    } catch (e) {
      reviewUnavailable(res, e.message);
    }
  });

  app.post('/api/sync/reconciliations/:id/resolve', authMiddleware, async (req, res) => {
    try {
      const businessId = businessIdOf(req);
      if (!businessId) return res.status(400).json({ success: false, message: 'businessId is required' });
      if (!cloudApi || typeof cloudApi.resolveReconciliation !== 'function') return reviewUnavailable(res);
      const result = await cloudApi.resolveReconciliation(businessId, req.params.id, req.body?.note);
      res.json(result && result.success !== false ? result : { success: false, message: (result && result.message) || 'Cloud unavailable' });
    } catch (e) {
      reviewUnavailable(res, e.message);
    }
  });
}

module.exports = {
  registerSyncRoutes
};
