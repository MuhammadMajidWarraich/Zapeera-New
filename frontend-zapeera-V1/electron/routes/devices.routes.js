/**
 * Device Presence Routes (embedded / desktop)
 *
 * The renderer's account dashboard asks THIS local server for the user's
 * connected desktops (GET /api/devices/my), but presence is a CLOUD fact —
 * it is recorded by the cloud backend from this app's check-ins, so the
 * same count is true on the web dashboard too. This route therefore just
 * proxies to the cloud with the stored cloud token; when the cloud is
 * unreachable it answers 503 (presence not established) rather than
 * inventing a local number.
 */

function registerDevicesRoutes(app, authMiddleware, deps) {
  const cloudApi = require('../services/cloud-api.service');

  // GET /api/devices/my — caller's desktop devices + connected count (cloud truth).
  app.get('/api/devices/my', authMiddleware, async (req, res) => {
    try {
      const result = await cloudApi.makeRequest('GET', '/api/devices/my');
      return res.json(result);
    } catch (e) {
      return res.status(503).json({
        success: false,
        code: 'CLOUD_UNREACHABLE',
        message: 'Cloud is unreachable — desktop presence cannot be established right now.'
      });
    }
  });
}

module.exports = {
  registerDevicesRoutes
};
