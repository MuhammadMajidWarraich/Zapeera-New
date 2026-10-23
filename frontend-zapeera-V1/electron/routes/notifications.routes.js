/**
 * Notification Routes (desktop parity fix)
 *
 * The shared frontend polls GET /api/notifications/unread-count on an
 * interval for the header badge and loads the notification panel from
 * GET /api/notifications, but the desktop embedded server never
 * implemented the module, so v1.0.4 answered 404 on every poll.
 *
 * Web contract (backend notification.controller.ts): every route
 * requires authentication (handled here by the shared authMiddleware)
 * and responds { success, data | message }.
 *
 * The desktop local DB has NO notifications table — notifications are
 * created cloud-side (sales/inventory/subscription events on the
 * server) and are not part of the desktop sync table set. The honest
 * local behaviour is therefore exactly what the web backend returns
 * for a user with zero notifications: empty list, unreadCount 0,
 * read-all/clear-all as successful no-ops, and the web's own 404
 * ("Notification not found") for single-item mutations, since no
 * local notification can ever exist.
 *
 * Preferences are the one piece with real local state: the web merges
 * stored rows over "all categories enabled" defaults. Locally we
 * persist per-user choices in the settings key-value table under
 * `notification_preferences:<userId>` (written directly, deliberately
 * NOT queued for cloud sync — the cloud keeps its own per-user
 * preference rows and this key must not collide with them).
 */

// Canonical category list — mirrors backend notification.controller.ts
const NOTIFICATION_CATEGORIES = [
  'sale',
  'inventory',
  'subscription',
  'invitation',
  'staff',
  'billing',
  'system'
];

function registerNotificationRoutes(app, authMiddleware, deps) {
  const { query, run, uuid, now } = deps;

  const prefKey = (userId) => `notification_preferences:${userId || 'anonymous'}`;

  function loadPrefs(userId) {
    try {
      const rows = query('SELECT value FROM settings WHERE key = ?', [prefKey(userId)]);
      if (rows && rows.length && rows[0].value) {
        const parsed = JSON.parse(rows[0].value);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch (e) { /* unreadable prefs fall back to defaults */ }
    return {};
  }

  function savePrefs(userId, prefs) {
    const key = prefKey(userId);
    const value = JSON.stringify(prefs);
    const existing = query('SELECT id FROM settings WHERE key = ?', [key]);
    if (existing && existing.length) {
      run('UPDATE settings SET value = ?, updatedAt = ? WHERE key = ?', [value, now(), key]);
    } else {
      run('INSERT INTO settings (id, key, value, createdAt, updatedAt) VALUES (?,?,?,?,?)',
        [uuid(), key, value, now(), now()]);
    }
  }

  function mergedPrefs(userId) {
    const stored = loadPrefs(userId);
    const result = {};
    for (const cat of NOTIFICATION_CATEGORIES) {
      result[cat] = typeof stored[cat] === 'boolean' ? stored[cat] : true;
    }
    return result;
  }

  // GET /api/notifications/preferences — stored choices over defaults
  app.get('/api/notifications/preferences', authMiddleware, (req, res) => {
    try {
      res.json({ success: true, data: mergedPrefs(req.user?.id) });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // PUT /api/notifications/preferences — update a single category
  app.put('/api/notifications/preferences', authMiddleware, (req, res) => {
    try {
      const { category, enabled } = req.body || {};
      if (!NOTIFICATION_CATEGORIES.includes(category)) {
        return res.status(400).json({ success: false, message: '"category" must be one of: ' + NOTIFICATION_CATEGORIES.join(', ') });
      }
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ success: false, message: '"enabled" must be a boolean' });
      }
      const prefs = loadPrefs(req.user?.id);
      prefs[category] = enabled;
      savePrefs(req.user?.id, prefs);
      res.json({ success: true, data: { category, enabled } });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // PUT /api/notifications/preferences/all — bulk update
  app.put('/api/notifications/preferences/all', authMiddleware, (req, res) => {
    try {
      const prefs = (req.body || {}).preferences;
      if (!prefs || typeof prefs !== 'object') {
        return res.status(400).json({ success: false, message: 'preferences object required' });
      }
      const stored = loadPrefs(req.user?.id);
      for (const [category, enabled] of Object.entries(prefs)) {
        if (NOTIFICATION_CATEGORIES.includes(category)) {
          stored[category] = Boolean(enabled);
        }
      }
      savePrefs(req.user?.id, stored);
      res.json({ success: true, message: 'Preferences updated' });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // GET /api/notifications — paginated list (always empty locally)
  app.get('/api/notifications', authMiddleware, (req, res) => {
    try {
      let page = req.query.page === undefined ? 1 : Number(req.query.page);
      let limit = req.query.limit === undefined ? 20 : Number(req.query.limit);
      if (!Number.isInteger(page) || page < 1) {
        return res.status(400).json({ success: false, message: '"page" must be an integer greater than or equal to 1' });
      }
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        return res.status(400).json({ success: false, message: '"limit" must be an integer between 1 and 100' });
      }
      res.json({
        success: true,
        data: {
          notifications: [],
          total: 0,
          unreadCount: 0,
          page,
          limit,
          totalPages: 0
        }
      });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // GET /api/notifications/unread-count — the endpoint polled by the shell
  app.get('/api/notifications/unread-count', authMiddleware, (req, res) => {
    try {
      res.json({ success: true, data: { unreadCount: 0 } });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // PUT /api/notifications/read-all — no-op on an empty local store
  app.put('/api/notifications/read-all', authMiddleware, (req, res) => {
    try {
      res.json({ success: true, message: 'All notifications marked as read' });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // DELETE /api/notifications/clear-all — no-op on an empty local store
  app.delete('/api/notifications/clear-all', authMiddleware, (req, res) => {
    try {
      res.json({ success: true, message: 'Cleared 0 notifications' });
    } catch (e) { res.status(500).json({ success: false, message: e.message }); }
  });

  // PUT /api/notifications/:id/read — no local notification can exist,
  // so this is the web backend's own not-found answer.
  app.put('/api/notifications/:id/read', authMiddleware, (req, res) => {
    res.status(404).json({ success: false, message: 'Notification not found' });
  });

  // DELETE /api/notifications/:id — same not-found contract as the web.
  app.delete('/api/notifications/:id', authMiddleware, (req, res) => {
    res.status(404).json({ success: false, message: 'Notification not found' });
  });
}

module.exports = {
  registerNotificationRoutes,
  NOTIFICATION_CATEGORIES
};
