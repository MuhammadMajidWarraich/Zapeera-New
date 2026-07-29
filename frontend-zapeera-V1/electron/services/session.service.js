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

const DEFAULT_SESSION_HOURS = 168; // 7 days
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
  const offlineExpiresAt = computeExpiry(OFFLINE_GRACE_HOURS);

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
  cleanExpiredSessions,
  getUserActiveSessions
};
