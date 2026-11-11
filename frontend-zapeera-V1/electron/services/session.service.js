/**
 * Session Service
 * Manages device-bound sessions with expiry tracking.
 * Sessions tie a user + device together and support offline grace periods.
 */

const crypto = require('crypto');

let _query = null;
let _run = null;
let _saveDatabase = null;
let _uuid = null;
let _now = null;

const DEFAULT_SESSION_HOURS = 720; // 30 days (v1.0.19 revalidation window — was 168h/7d)
// Offline grace: how long AFTER the primary expiry a device-bound session
// may still be used to enter the app offline (validateOfflineSession flags
// it _offlineGrace). The grace deadline must therefore sit BEYOND
// expiresAt: offlineExpiresAt = creation + 720h + 72h. (Before the
// 2026-11-10 fix it was computed as creation + 72h, i.e. ~4 days before
// expiresAt, so the grace branch in validateOfflineSession could never
// fire — see ZAPEERA_DESKTOP_OFFLINE_GATE_2026-11-10.md.)
const OFFLINE_GRACE_HOURS = 72;

function init(deps) {
  _query = deps.query;
  _run = deps.run;
  _saveDatabase = deps.saveDatabase;
  _uuid = deps.uuid;
  _now = deps.now;
}

function ensureInit() {
  if (!_query) {
    const deps = require('./database.service');
    _query = deps.query;
    _run = deps.run;
    _saveDatabase = deps.saveDatabase;
    _uuid = require('../utils/helpers').uuid;
    _now = require('../utils/helpers').now;
  }
}

function generateSessionToken() {
  return crypto.randomBytes(48).toString('hex');
}

function createSession(userId, deviceId, metadata = {}) {
  ensureInit();

  const id = _uuid();
  const token = generateSessionToken();
  const timestamp = _now();
  const expiresAt = computeExpiry(DEFAULT_SESSION_HOURS);
  const offlineExpiresAt = computeExpiry(DEFAULT_SESSION_HOURS + OFFLINE_GRACE_HOURS);

  _run(`
    INSERT INTO sessions
    (id, token, userId, deviceId, status, expiresAt, offlineExpiresAt, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)
  `, [id, token, userId, deviceId, expiresAt, offlineExpiresAt, timestamp, timestamp]);

  _saveDatabase();

  return {
    id,
    token,
    userId,
    deviceId,
    expiresAt,
    offlineExpiresAt,
    createdAt: timestamp
  };
}

function validateSession(token) {
  ensureInit();
  if (!token) return null;

  const results = _query('SELECT * FROM sessions WHERE token = ? AND status = ?', [token, 'ACTIVE']);
  if (!results || results.length === 0) return null;

  const session = results[0];
  const now = new Date();

  if (session.expiresAt && new Date(session.expiresAt) < now) {
    revokeSession(token);
    return null;
  }

  return session;
}

function validateOfflineSession(token) {
  ensureInit();
  if (!token) return null;

  const results = _query('SELECT * FROM sessions WHERE token = ? AND status = ?', [token, 'ACTIVE']);
  if (!results || results.length === 0) return null;

  const session = results[0];
  const now = new Date();

  if (session.expiresAt && new Date(session.expiresAt) < now) {
    if (session.offlineExpiresAt && new Date(session.offlineExpiresAt) >= now) {
      return { ...session, _offlineGrace: true };
    }
    revokeSession(token);
    return null;
  }

  return session;
}

function revokeSession(token) {
  ensureInit();
  _run(`UPDATE sessions SET status = 'REVOKED', updatedAt = ? WHERE token = ?`,
    [_now(), token]);
  _saveDatabase();
}

function revokeAllUserSessions(userId, exceptToken = null) {
  ensureInit();
  if (exceptToken) {
    _run(`UPDATE sessions SET status = 'REVOKED', updatedAt = ? WHERE userId = ? AND token != ?`,
      [_now(), userId, exceptToken]);
  } else {
    _run(`UPDATE sessions SET status = 'REVOKED', updatedAt = ? WHERE userId = ?`,
      [_now(), userId]);
  }
  _saveDatabase();
}

function refreshSession(token, hours = DEFAULT_SESSION_HOURS) {
  ensureInit();
  const newExpiry = computeExpiry(hours);
  _run(`UPDATE sessions SET expiresAt = ?, updatedAt = ? WHERE token = ? AND status = 'ACTIVE'`,
    [newExpiry, _now(), token]);
  _saveDatabase();
}

function cleanExpiredSessions() {
  ensureInit();
  const timestamp = _now();

  const expired = _query(
    `SELECT id FROM sessions WHERE status = 'ACTIVE' AND expiresAt < ? AND offlineExpiresAt < ?`,
    [timestamp, timestamp]
  );

  if (expired && expired.length > 0) {
    _run(
      `UPDATE sessions SET status = 'EXPIRED', updatedAt = ? WHERE status = 'ACTIVE' AND expiresAt < ? AND offlineExpiresAt < ?`,
      [timestamp, timestamp, timestamp]
    );
    _saveDatabase();
  }

  return expired ? expired.length : 0;
}

function getUserActiveSessions(userId) {
  ensureInit();
  return _query(
    `SELECT id, deviceId, status, expiresAt, offlineExpiresAt, createdAt, updatedAt
     FROM sessions WHERE userId = ? AND status = 'ACTIVE' ORDER BY createdAt DESC`,
    [userId]
  );
}

/**
 * One-time repair for sessions created by builds where offlineExpiresAt
 * was computed as creation + OFFLINE_GRACE_HOURS — i.e. BEFORE the primary
 * expiry — which made the offline grace unreachable. For every session
 * that is still ACTIVE and still inside its primary validity, move the
 * grace deadline to expiresAt + OFFLINE_GRACE_HOURS (the value
 * createSession now writes). Sessions whose primary expiry has already
 * passed are deliberately untouched: nothing dead is resurrected, and
 * existing sessions keep their original primary expiry (only NEW
 * sessions get the 720h primary). Idempotent — post-fix rows already
 * satisfy offlineExpiresAt > expiresAt and are skipped. Returns the
 * number of sessions repaired.
 */
function repairOfflineGraceWindows() {
  ensureInit();
  const nowMs = Date.now();
  const rows = _query(`SELECT id, expiresAt, offlineExpiresAt FROM sessions WHERE status = 'ACTIVE'`, []) || [];
  let repaired = 0;
  for (const row of rows) {
    const expMs = row.expiresAt ? new Date(row.expiresAt).getTime() : NaN;
    if (!Number.isFinite(expMs) || expMs < nowMs) continue; // primary validity over — leave it dead
    const offMs = row.offlineExpiresAt ? new Date(row.offlineExpiresAt).getTime() : NaN;
    if (Number.isFinite(offMs) && offMs >= expMs) continue; // already on the post-fix window
    const repairedOfflineExpiry = new Date(expMs + OFFLINE_GRACE_HOURS * 60 * 60 * 1000).toISOString();
    _run(`UPDATE sessions SET offlineExpiresAt = ?, updatedAt = ? WHERE id = ?`,
      [repairedOfflineExpiry, _now(), row.id]);
    repaired++;
  }
  if (repaired > 0) _saveDatabase();
  return repaired;
}

function computeExpiry(hours) {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString();
}

module.exports = {
  init,
  createSession,
  validateSession,
  validateOfflineSession,
  revokeSession,
  revokeAllUserSessions,
  refreshSession,
  repairOfflineGraceWindows,
  cleanExpiredSessions,
  getUserActiveSessions
};
