/**
 * License Client — token acquisition, storage and refresh (2026-10-28).
 *
 * The desktop never mints a license: the cloud backend is the only
 * issuer (Ed25519 private key in the server env). This module is the
 * desktop side of that flow:
 *
 *   acquire  — a token arrives in the provision payload at login /
 *              provision (auth.routes.js provision-session) or from a
 *              refresh call; storeToken() verifies the signature (when
 *              the public key is configured) and stores it verbatim.
 *   store    — settings table, key 'zapeera_license_token' (the token
 *              itself) + 'zapeera_license_token_meta' (JSON: licenseId,
 *              planId, issuedAt, expiresAt, storedAt). Storing the meta
 *              beside the token lets the "prefer newest" rule compare
 *              without parsing an unverified token for trust.
 *   refresh  — when online, POST /api/license/refresh { deviceId,
 *              installId } with the cloud access token; the server
 *              re-checks subscription status and issues a fresh token
 *              (or nothing, when lapsed — revocation by non-issuance).
 *              The endpoint does not exist on the server yet (server
 *              rollout step 1); until it does, refresh fails soft —
 *              it logs and keeps the stored token, and NEVER throws
 *              into the caller.
 *   newest wins — storeToken() replaces the stored token only when the
 *   new token's issuedAt is >= the stored one, so a stale token (e.g.
 *   carrying a higher plan after a downgrade) can never re-assert
 *   itself over a newer token. A token with no parseable issuedAt never
 *   replaces a stored token.
 *
 * Device / install binding inputs (populated on EVERY token use):
 *   deviceId  — the install's device id (~/.zapeera/device-id.txt via
 *               the device-fingerprint util, same source as
 *               device.service.js).
 *   installId — sha256 hex of the per-install JWT secret
 *               (~/.zapeera/jwt-secret.txt). The secret itself never
 *               leaves the machine; its hash is a stable per-install
 *               identifier. Falls back to the deviceId when no secret
 *               file exists yet (fresh install before first login).
 *
 * Server contract (for the server-side issuer — not implemented here):
 *   POST /api/license/refresh, Authorization: Bearer <cloud access token>
 *   body: { deviceId, installId }
 *   success: { success: true, data: { licenseToken } }
 *   The server MUST re-check subscription status on every issuance,
 *   MUST populate issuedAt / expiresAt (expiresAt <= issuedAt + 40d) /
 *   serverTime / deviceId / installId / businessIds, and MUST NOT issue
 *   when the account is lapsed, suspended or over its device limit.
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const licenseService = require('./license.service');

const TOKEN_SETTING_KEY = 'zapeera_license_token';
const TOKEN_META_SETTING_KEY = 'zapeera_license_token_meta';

let _query = null;
let _run = null;
let _saveDatabase = null;
let _uuid = null;

function init(deps) {
  if (!deps) return;
  _query = deps.query || _query;
  _run = deps.run || _run;
  _saveDatabase = deps.saveDatabase || _saveDatabase;
  _uuid = deps.uuid || _uuid;
}

function ensureInit() {
  if (!_query) {
    const db = require('../database.service');
    _query = db.query;
    _run = db.run;
    _saveDatabase = db.saveDatabase;
    _uuid = require('../../utils/helpers').uuid;
  }
}

function defaultStateDir() {
  return path.join(os.homedir(), '.zapeera');
}

// ---------------------------------------------------------------------------
// Device / install ids
// ---------------------------------------------------------------------------

function getDeviceId() {
  try {
    const deviceUtils = require('../../utils/device-fingerprint.js');
    if (deviceUtils && typeof deviceUtils.getDeviceId === 'function') return deviceUtils.getDeviceId();
  } catch (e) { /* fall through to the file fallback */ }
  const deviceIdPath = path.join(defaultStateDir(), 'device-id.txt');
  try {
    if (fs.existsSync(deviceIdPath)) return fs.readFileSync(deviceIdPath, 'utf8').trim();
  } catch (e) { /* fall through */ }
  return null;
}

/**
 * installId = sha256(per-install JWT secret). Stable per install, and
 * the secret itself is never exposed. Falls back to the deviceId when
 * no secret file exists yet.
 */
function getInstallId() {
  try {
    const secretPath = path.join(defaultStateDir(), 'jwt-secret.txt');
    if (fs.existsSync(secretPath)) {
      const secret = fs.readFileSync(secretPath, 'utf8').trim();
      if (secret) return crypto.createHash('sha256').update(secret, 'utf8').digest('hex');
    }
  } catch (e) { /* fall through */ }
  return getDeviceId();
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function readSetting(key) {
  try {
    ensureInit();
    const row = _query('SELECT value FROM settings WHERE key = ?', [key])[0];
    return row ? row.value : null;
  } catch (e) {
    return null;
  }
}

function writeSetting(key, value) {
  ensureInit();
  const ts = new Date().toISOString();
  const existing = _query('SELECT id FROM settings WHERE key = ?', [key]);
  if (existing && existing.length > 0) {
    _run('UPDATE settings SET value = ?, updatedAt = ? WHERE key = ?', [value, ts, key]);
  } else {
    _run('INSERT INTO settings (id, key, value, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)',
      [typeof _uuid === 'function' ? _uuid() : crypto.randomUUID(), key, value, ts, ts]);
  }
  if (typeof _saveDatabase === 'function') _saveDatabase();
}

function getStoredToken() {
  return readSetting(TOKEN_SETTING_KEY);
}

function getStoredMeta() {
  const raw = readSetting(TOKEN_META_SETTING_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    return null;
  }
}

/** Parse a token's payload WITHOUT trusting it (comparison only). */
function peekPayload(token) {
  try {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const payload = JSON.parse(licenseService._base64urlDecode(parts[0]).toString('utf8'));
    return payload && typeof payload === 'object' ? payload : null;
  } catch (e) {
    return null;
  }
}

/**
 * Store a license token. Verifies the signature when the public key is
 * configured (an unverifiable token is still stored — the gate logs it
 * as invalid — but a token that FAILS verification while a key IS
 * configured is rejected outright: it can only be a forgery or a
 * stale-key token). Newest wins by issuedAt (see module header).
 * @returns {{ stored: boolean, reason: string }}
 */
function storeToken(token, opts = {}) {
  if (!token || typeof token !== 'string') return { stored: false, reason: 'no-token' };
  const pem = opts.publicKeyPem || licenseService.LICENSE_PUBLIC_KEY_PEM;
  if (pem) {
    const payload = licenseService.verifyLicenseToken(token, pem, opts.publicKeys);
    if (!payload) return { stored: false, reason: 'bad-signature-or-format' };
  }
  const incoming = peekPayload(token) || {};
  const stored = getStoredToken();
  const storedMeta = getStoredMeta();
  const storedIssuedAt = storedMeta && typeof storedMeta.issuedAt === 'number'
    ? storedMeta.issuedAt
    : (stored ? (peekPayload(stored) || {}).issuedAt : null);
  if (stored && typeof incoming.issuedAt === 'number' && typeof storedIssuedAt === 'number' && incoming.issuedAt < storedIssuedAt) {
    console.log('[License] Ignoring stale token (issuedAt older than stored token — downgrade guard)');
    return { stored: false, reason: 'stale-token-ignored' };
  }
  if (stored && typeof incoming.issuedAt !== 'number') {
    console.log('[License] Ignoring token without issuedAt while a token is already stored');
    return { stored: false, reason: 'missing-issued-at' };
  }
  try {
    writeSetting(TOKEN_SETTING_KEY, token);
    writeSetting(TOKEN_META_SETTING_KEY, JSON.stringify({
      licenseId: incoming.licenseId || null,
      planId: incoming.planId || null,
      issuedAt: typeof incoming.issuedAt === 'number' ? incoming.issuedAt : null,
      expiresAt: typeof incoming.expiresAt === 'number' ? incoming.expiresAt : null,
      storedAt: Date.now()
    }));
  } catch (e) {
    console.warn('[License] Failed to persist license token:', e.message);
    return { stored: false, reason: 'persist-failed' };
  }
  return { stored: true, reason: 'ok' };
}

/**
 * Accept a token from a provision / login payload (the server returns
 * it as `licenseToken` or `license_token`). No-op when absent.
 * @param {object} payload provision payload
 * @param {object} [opts] forwarded to storeToken (test key overrides)
 */
function acquireFromProvision(payload, opts = {}) {
  if (!payload || typeof payload !== 'object') return { stored: false, reason: 'no-payload' };
  const token = payload.licenseToken || payload.license_token || null;
  if (!token) return { stored: false, reason: 'no-license-token-in-payload' };
  const result = storeToken(token, opts);
  console.log('[License] Provision token', result.stored ? 'stored' : `not stored (${result.reason})`);
  return result;
}

/**
 * Request a fresh token from the cloud when online. Fails soft by
 * design: the server endpoint does not exist yet, the machine may be
 * offline, or the account may be lapsed — in all cases the stored
 * token stays put and the caller carries on.
 * @param {object} cloudApi cloud-api.service (makeRequest + getAuthToken)
 * @returns {Promise<{ refreshed: boolean, reason: string }>}
 */
async function refreshFromCloud(cloudApi, opts = {}) {
  try {
    if (!cloudApi || typeof cloudApi.makeRequest !== 'function') {
      return { refreshed: false, reason: 'cloud-api-unavailable' };
    }
    if (typeof cloudApi.getAuthToken === 'function' && !cloudApi.getAuthToken()) {
      return { refreshed: false, reason: 'no-cloud-token' };
    }
    const deviceId = opts.deviceId || getDeviceId();
    const installId = opts.installId || getInstallId();
    const res = await cloudApi.makeRequest('POST', '/api/license/refresh', { deviceId, installId }, { timeout: 10000 });
    const token = res && res.data ? (res.data.licenseToken || res.data.license_token || null) : null;
    if (!token) {
      console.log('[License] Refresh returned no token (account may be lapsed or endpoint unavailable)');
      return { refreshed: false, reason: 'no-token-in-response' };
    }
    const result = storeToken(token, opts);
    console.log('[License] Refresh', result.stored ? 'stored a fresh token' : `token not stored (${result.reason})`);
    return { refreshed: result.stored, reason: result.reason };
  } catch (e) {
    // 404 (endpoint not deployed yet), offline, timeout, lapsed account:
    // all soft. The stored token remains the entitlement source.
    console.log('[License] Refresh unavailable, keeping stored token:', e.message);
    return { refreshed: false, reason: e.message || 'refresh-failed' };
  }
}

module.exports = {
  TOKEN_SETTING_KEY,
  TOKEN_META_SETTING_KEY,
  init,
  getDeviceId,
  getInstallId,
  getStoredToken,
  getStoredMeta,
  peekPayload,
  storeToken,
  acquireFromProvision,
  refreshFromCloud
};
