/**
 * Local-First Login Service (v1.0.19, Phase 2B — owner's design).
 *
 * The cached-logon pattern (like a Windows domain logon): a user who
 * has successfully CLOUD-verified on this device gets their credential
 * cached on the mirrored local user row — a bcrypt hash produced
 * LOCALLY from the password the cloud just verified (the cloud never
 * sends hashes). Later sign-ins verify locally first and work fully
 * offline, including after a deliberate logout.
 *
 * Invariants:
 * - cacheCredential() is called ONLY from the provision-session
 *   handler, which is gated by the Electron main process's cloud-token
 *   validation + the short-lived provisioning token — there is no
 *   standalone "cache this password" endpoint.
 * - Hash only, bcrypt cost 10 (same as the cloud's SALT_ROUNDS).
 *   The typed password is never logged anywhere in this module.
 * - Validity window: local login is honoured while the device is
 *   inside the Phase-1 revalidation window for that user — 30 days
 *   primary + 72h grace from the last successful cloud verification.
 *   THE ANCHOR: local_identity.lastCloudValidationAt (updated by
 *   provision, account sync and the periodic auth refresh), falling
 *   back to users.credentialCachedAt when no identity row exists yet
 *   (both are cloud-verification timestamps by construction).
 * - Cloud wins on contact: purgeCredential() destroys the cached hash
 *   (replaced with a fresh random placeholder, the flag cleared) when
 *   the cloud definitively rejects the account. Ambiguous network
 *   failures purge NOTHING — callers must only purge on a definitive
 *   rejection (same classification discipline as the restore machine).
 * - Logout never touches this data: the identity mirror and the cached
 *   credential survive account logout by design.
 */

let _query = null;
let _run = null;
let _saveDatabase = null;
let _now = null;
let _hashPasswordBcrypt = null;
let _verifyPassword = null;
let _sessionService = null;
let _deviceService = null;
let _generateToken = null;

const PRIMARY_WINDOW_HOURS = 720; // 30 days — mirrors session.service
const GRACE_HOURS = 72;           // mirrors session.service offline grace

function init(deps) {
  _query = deps.query;
  _run = deps.run;
  _saveDatabase = deps.saveDatabase;
  _now = deps.now;
  _hashPasswordBcrypt = deps.hashPasswordBcrypt;
  _verifyPassword = deps.verifyPassword;
  _sessionService = deps.sessionService || null;
  _deviceService = deps.deviceService || null;
  _generateToken = deps.generateToken || null;
}

function ensureInit() {
  if (_query) return;
  const db = require('./database.service');
  _query = db.query;
  _run = db.run;
  _saveDatabase = db.saveDatabase;
  _now = require('../utils/helpers').now;
  const authService = require('./auth/auth.service');
  _hashPasswordBcrypt = authService.hashPasswordBcrypt;
  _verifyPassword = authService.verifyPassword;
  try { _sessionService = require('./session.service'); } catch { _sessionService = null; }
  try { _deviceService = require('./device.service'); } catch { _deviceService = null; }
}

function normalizeIdentifier(identifier) {
  return String(identifier || '').trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * Find the mirrored user row for an identifier, but ONLY when a real
 * verified credential is cached on it (credentialCachedAt set).
 */
function findCachedUser(identifier) {
  ensureInit();
  const idf = normalizeIdentifier(identifier);
  if (!idf) return null;
  const rows = _query(
    `SELECT u.*, i.lastCloudValidationAt AS identityLastValidation
       FROM users u
       LEFT JOIN local_identity i ON i.cloudUserId = u.id
      WHERE (lower(u.email) = ? OR lower(u.username) = ?)
        AND u.credentialCachedAt IS NOT NULL
      LIMIT 1`,
    [idf, idf]
  );
  return rows && rows.length > 0 ? rows[0] : null;
}

/** Window state for a cached-user row: 'active' | 'grace' | 'expired'. */
function getWindowState(row, atMs = Date.now()) {
  const anchorRaw = row.identityLastValidation || row.credentialCachedAt || null;
  if (!anchorRaw) return 'expired';
  const anchorMs = new Date(anchorRaw).getTime();
  if (!Number.isFinite(anchorMs)) return 'expired';
  const primaryEnd = anchorMs + PRIMARY_WINDOW_HOURS * 3600 * 1000;
  const graceEnd = primaryEnd + GRACE_HOURS * 3600 * 1000;
  if (atMs <= primaryEnd) return 'active';
  if (atMs <= graceEnd) return 'grace';
  return 'expired';
}

/**
 * Verify a local-first login attempt.
 * Returns one of:
 *   { ok: true, user, token, sessionToken, session: { expiresAt, offlineExpiresAt, offlineGrace } }
 *   { ok: false, code: 'LOCAL_UNKNOWN' | 'LOCAL_MISMATCH' | 'LOCAL_WINDOW_EXPIRED' }
 */
async function verifyLocalLogin(identifier, password) {
  ensureInit();
  const row = findCachedUser(identifier);
  if (!row) return { ok: false, code: 'LOCAL_UNKNOWN' };
  if (row.isActive === 0 || row.isActive === '0' || row.isActive === false) {
    return { ok: false, code: 'LOCAL_UNKNOWN' };
  }

  const windowState = getWindowState(row);
  if (windowState === 'expired') {
    return { ok: false, code: 'LOCAL_WINDOW_EXPIRED' };
  }

  const verdict = await _verifyPassword(String(password || ''), row.password);
  if (!verdict || !verdict.valid) {
    return { ok: false, code: 'LOCAL_MISMATCH' };
  }

  // Password verified locally — mint a local session through the same
  // machinery provision-session uses (session.service + local JWT).
  const timestamp = _now();
  let sessionToken = null;
  let sessionInfo = null;
  try {
    if (_deviceService && typeof _deviceService.registerDevice === 'function') {
      _deviceService.registerDevice(row.id);
    }
    if (_sessionService && typeof _sessionService.createSession === 'function') {
      const deviceId = _deviceService && typeof _deviceService.getDeviceId === 'function'
        ? _deviceService.getDeviceId()
        : null;
      const session = _sessionService.createSession(row.id, deviceId);
      sessionToken = session.token;
      sessionInfo = {
        expiresAt: session.expiresAt,
        offlineExpiresAt: session.offlineExpiresAt,
        offlineGrace: windowState === 'grace'
      };
      _run('UPDATE users SET sessionToken = ?, lastLoginAt = ?, updatedAt = ? WHERE id = ?',
        [sessionToken, timestamp, timestamp, row.id]);
      _saveDatabase();
    }
  } catch (svcError) {
    console.warn('[LocalFirstLogin] Session setup warning:', svcError.message);
  }

  const token = _generateToken
    ? _generateToken({ id: row.id, email: row.email, name: row.name, role: row.role || 'USER', companyId: row.companyId, branchId: row.branchId })
    : null;

  const user = {
    id: row.id,
    username: row.username,
    email: row.email,
    name: row.name,
    role: row.role || 'USER',
    companyId: row.companyId || undefined,
    branchId: row.branchId || undefined,
    profileImage: row.profileImage || undefined,
    isActive: true
  };

  return { ok: true, user, token, sessionToken, session: sessionInfo, windowState };
}

/**
 * Cache a cloud-verified credential on the mirrored user row.
 * ONLY called from provision-session (cloud-verified flow). Refreshes
 * (heals) the entry on every successful cloud sign-in.
 */
function cacheCredential(userId, password) {
  ensureInit();
  if (!userId || !password) return false;
  const hash = _hashPasswordBcrypt(String(password));
  _run('UPDATE users SET password = ?, credentialCachedAt = ?, updatedAt = ? WHERE id = ?',
    [hash, _now(), _now(), userId]);
  _saveDatabase();
  return true;
}

/**
 * Record a cloud verification on the identity mirror at provision
 * time (anchors the local-login window even before the first account
 * sync writes local_identity).
 */
function touchIdentityFromProvision(user) {
  ensureInit();
  if (!user || !user.id) return;
  const timestamp = _now();
  const localId = 'cloud-' + user.id;
  const existing = _query('SELECT id FROM local_identity WHERE cloudUserId = ?', [user.id]);
  if (existing && existing.length > 0) {
    _run(`UPDATE local_identity SET displayName = ?, email = ?, username = ?, lastAuthenticatedAt = ?, lastCloudValidationAt = ?, updatedAt = ? WHERE cloudUserId = ?`,
      [user.name || user.displayName || '', user.email || '', user.username || user.email || '', timestamp, timestamp, timestamp, user.id]);
  } else {
    _run(`INSERT INTO local_identity (id, cloudUserId, displayName, email, username, lastAuthenticatedAt, lastCloudValidationAt, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [localId, user.id, user.name || user.displayName || '', user.email || '', user.username || user.email || '', timestamp, timestamp, timestamp, timestamp]);
  }
  _saveDatabase();
}

/** Destroy a cached credential (cloud definitively rejected the account). */
function purgeCredentialByCloudUserId(cloudUserId) {
  ensureInit();
  if (!cloudUserId) return false;
  const placeholder = _hashPasswordBcrypt('purged-' + cloudUserId + '-' + Date.now() + '-' + Math.random());
  _run('UPDATE users SET password = ?, credentialCachedAt = NULL, updatedAt = ? WHERE id = ?',
    [placeholder, _now(), cloudUserId]);
  _saveDatabase();
  return true;
}

function purgeCredentialByIdentifier(identifier) {
  ensureInit();
  const idf = normalizeIdentifier(identifier);
  if (!idf) return false;
  const rows = _query(
    'SELECT id FROM users WHERE (lower(email) = ? OR lower(username) = ?) AND credentialCachedAt IS NOT NULL LIMIT 1',
    [idf, idf]
  );
  if (!rows || rows.length === 0) return false;
  return purgeCredentialByCloudUserId(rows[0].id);
}

module.exports = {
  init,
  verifyLocalLogin,
  cacheCredential,
  touchIdentityFromProvision,
  purgeCredentialByCloudUserId,
  purgeCredentialByIdentifier,
  // Exported for tests
  _findCachedUser: findCachedUser,
  _getWindowState: getWindowState,
  PRIMARY_WINDOW_HOURS,
  GRACE_HOURS
};
