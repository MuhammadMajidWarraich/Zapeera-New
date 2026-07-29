/**
 * Account Sync Routes
 * Endpoints for syncing account metadata from Cloud API to local SQLite.
 */

function registerSyncAccountRoutes(app, authMiddleware, deps) {
  const { syncAccountService } = deps;

  // POST /api/sync/account - Sync account data from Cloud API
  app.post('/api/sync/account', authMiddleware, async (req, res) => {
    try {
      const userId = req.user?.id;
      const email = req.user?.email;

      if (!userId) {
        return res.status(400).json({ success: false, message: 'User not identified' });
      }

      const result = await syncAccountService.syncAccount(userId, email);

      if (!result.success) {
        return res.status(502).json({ success: false, message: result.message || 'Sync failed' });
      }

      res.json({
        success: true,
        data: result.data,
        message: `Synced ${result.data.memberships.length} memberships`
      });
    } catch (e) {
      console.error('[SyncAccount] Route error:', e.message);
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // GET /api/sync/account - Get local account data
  app.get('/api/sync/account', authMiddleware, async (req, res) => {
    try {
      const local = await syncAccountService.getLocalAccount();
      res.json({ success: true, data: local });
    } catch (e) {
      console.error('[SyncAccount] Local fetch error:', e.message);
      res.status(500).json({ success: false, message: e.message });
    }
  });
}

module.exports = { registerSyncAccountRoutes };
