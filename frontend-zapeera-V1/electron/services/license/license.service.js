/**
 * Signed License Service — SHADOW MODE (security hardening 2026-10-23,
 * completed 2026-10-28 per Muhammad's decisions of 2026-10-28 18:58 PKT).
 *
 * STATUS: wired into the entitlement gates in SHADOW MODE ONLY. The
 * subscription fallback and the write gates call evaluate() on every
 * check and LOG the license verdict vs the legacy verdict, but the
 * legacy verdict still decides — nothing is denied by a license yet.
 * Flip `SHADOW_MODE` in electron/services/license/license-gate.js to
 * `false` to enforce (only after the server issues real tokens AND one
 * shadow release has shown a ~0% mismatch rate).
 *
 * Design
 * ------
 * The cloud backend signs a license token with an Ed25519 PRIVATE key that
 * never leaves the server:
 *
 *     token = base64url(JSON payload) + "." + base64url(Ed25519 signature)
 *
 * Payload claims:
 *   licenseId   unique id of the issued license
 *   accountId   cloud account (owner) id
 *   businessIds array of business ids the license covers
 *   planId      e.g. "single-growth"
 *   status      "ACTIVE" | "TRIAL" | "GRACE" | "SUSPENDED" | "CANCELLED"
 *   issuedAt    ms epoch (server time) — REQUIRED. A token without it is
 *               rejected (fail-closed) once enforcement is on.
 *   expiresAt   ms epoch (server time) — the paid period end.
 *   serverTime  ms epoch, server clock at issuance (anti-rollback anchor)
 *   deviceId    REQUIRED from the server — binds the license to one
 *               install's device id (see binding note below).
 *   installId   REQUIRED from the server — binds to one install (hash of
 *               the per-install JWT secret; the secret itself never
 *               leaves the machine).
 *   kid         optional key id for rotation (see KEY ROTATION below).
 *
 * Approved parameters (Muhammad, 2026-10-28):
 *   GRACE_DAYS = 3 — the ONE home of the grace period. Entitlement runs
 *   until expiresAt + 3 days. The server must NOT also bake grace into
 *   expiresAt (no double-counting); it issues expiresAt = period end.
 *   HARD_EXPIRY_MODE = 'READ_ONLY_EXPORT_ONLY' — at hard expiry, selling
 *   stops (no new sales/invoices/purchases/refunds/stock edits) but the
 *   customer can still view history and export/backup their data.
 *   Full lock remains a ONE-WORD switch: set HARD_EXPIRY_MODE to
 *   'FULL_LOCK' (see license-gate.js). Never the default.
 *   MAX_TOKEN_LIFETIME_DAYS = 40 — issuance cap: a token whose expiresAt
 *   is more than ~40 days after its issuedAt (one billing period +
 *   3-day grace) is rejected. A validly signed far-future token can
 *   never entitle indefinitely.
 *
 * Clock-rollback resistance: every successfully verified token's
 * `serverTime` is recorded monotonically (it can only move forward) in a
 * small state file (license-state.json, mode 0600, next to the other
 * per-install files under ~/.zapeera). Expiry is judged against
 * max(wall clock, lastSeenServerTime), so winding the PC clock back does
 * not extend a license. Known residual (accepted): the state file itself
 * is deletable by the file owner, which resets the anchor — but expiry
 * is still judged against the wall clock, and every online sync
 * re-anchors from a fresh server timestamp.
 *
 * Device/install binding (fail-closed once enforcing):
 *   The server MUST always populate deviceId + installId, and callers
 *   MUST always pass both via opts. evaluate() fails closed
 *   ('device-mismatch' / 'install-mismatch' / 'missing-*-claim') when
 *   binding is opted into (opts.enforceBinding — the production gate
 *   ALWAYS opts in). evaluate() itself is ALWAYS strict: it returns the
 *   verdict enforcement would give. Shadow mode lives in the GATE
 *   (license-gate.js), which calls evaluate(), logs the verdict and any
 *   mismatch vs the legacy path, and returns the legacy verdict — so in
 *   shadow mode a missing claim is logged instead of denying, exactly
 *   as the approved rollout prescribes. Binding is enforced in
 *   evaluate() only when the relevant inputs are present or
 *   enforceBinding is set, so the pure function stays usable for
 *   unbound tokens in tests; production never relies on that leniency
 *   — license-gate.js always passes deviceId + installId +
 *   enforceBinding: true.
 *
 * KEY ROTATION:
 *   The public key is embedded, never delivered over the wire (a
 *   server-delivered key would be trustable by anyone who can already
 *   serve a fake license server). Rotation procedure:
 *     1. Generate a new Ed25519 keypair on the server; the new private
 *        key goes into the server env only (LICENSE_PRIVATE_KEY_PEM).
 *     2. Ship a desktop release that adds the new public key to
 *        LICENSE_PUBLIC_KEY_ROTATION under a new kid (e.g. 'key-2'),
 *        keeping the old key in place. Tokens carrying kid 'key-2'
 *        verify against the new key; tokens without a kid (or with
 *        kid 'key-1') verify against LICENSE_PUBLIC_KEY_PEM.
 *     3. The server starts issuing tokens with kid 'key-2'. Old tokens
 *        keep working until they expire (max 40 days).
 *     4. After every old token has expired, a later release may remove
 *        the old key from the rotation map. An unknown kid fails closed
 *        ('unknown-key-id').
 *   `publicKeyPem` / `publicKeys` opts exist for tests and for the
 *   rotation transition only.
 *
 * Rollout (do NOT skip steps):
 *   1. Backend: generate an Ed25519 keypair ON the server; private key in
 *      the server env only (LICENSE_PRIVATE_KEY_PEM), never in any repo.
 *      Issue tokens at login/provision/refresh with ALL claims populated
 *      (issuedAt, expiresAt <= issuedAt + 40d, serverTime, deviceId,
 *      installId, businessIds) and re-check subscription status on every
 *      issuance; a lapsed account gets no fresh token (revocation by
 *      non-issuance). Refresh endpoint contract: POST /api/license/refresh
 *      { deviceId, installId } -> { success, data: { licenseToken } }.
 *   2. Backend: return the token in the provision payload; desktop stores
 *      it verbatim (settings table, key 'zapeera_license_token').
 *   3. Desktop: paste the PUBLIC key into LICENSE_PUBLIC_KEY_PEM below
 *      and ship. Gates evaluate in shadow mode for one release — log
 *      mismatches vs the old path (license-gate.js).
 *   4. Desktop: flip SHADOW_MODE to false in license-gate.js; the
 *      entitlement gates switch to evaluate(); keep the cloud-live
 *      lookup primary.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Ed25519 PUBLIC key (PEM) for license verification.
 * Pasted 2026-10-28 from ~/workspace/license-pubkey.pem (key 'key-1',
 * generated on the server by the parallel key-generation step; the
 * private key lives in the server env only, never in any repo).
 * While this was empty, evaluate() returned { configured: false } and
 * the gates fell back to the legacy path.
 */
const LICENSE_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAq3bRlBVtiLx6EQwAJAf3G6qUtyzZ5fJ/FEY0BRqNU1Q=
-----END PUBLIC KEY-----`;

/**
 * Rotated public keys, keyed by `kid` (see KEY ROTATION above).
 * Empty during the first rollout; a rotation adds e.g.
 *   'key-2': '-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n'
 * Tokens with kid 'key-1' (or no kid) verify against
 * LICENSE_PUBLIC_KEY_PEM; any other kid must be present here or the
 * token is rejected ('unknown-key-id').
 */
const LICENSE_PUBLIC_KEY_ROTATION = {};

/** Grace period in days — the single home of the 3-day grace (Decision 3). */
const GRACE_DAYS = 3;

/**
 * Behaviour at hard expiry (Decision 2). 'READ_ONLY_EXPORT_ONLY':
 * writes stop, reads + export/backup stay available. One-word switch
 * to 'FULL_LOCK' if that is ever what "strong" is meant to be — never
 * the default. Consumed by license-gate.js, not by evaluate() itself.
 */
const HARD_EXPIRY_MODE = 'READ_ONLY_EXPORT_ONLY';

/** Issuance lifetime cap in days (one billing period + grace). */
const MAX_TOKEN_LIFETIME_DAYS = 40;

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_TOKEN_LIFETIME_MS = MAX_TOKEN_LIFETIME_DAYS * DAY_MS;

const STATE_FILE_NAME = 'license-state.json';

function defaultStateDir() {
  // Same per-install directory as jwt-secret.txt / device-id.txt.
  return path.join(os.homedir(), '.zapeera');
}

function base64urlDecode(segment) {
  return Buffer.from(String(segment).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function base64urlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Verify a license token's signature and parse its payload.
 * Key selection: the (unverified) payload's `kid` picks the key — kid
 * 'key-1' or absent means the primary LICENSE_PUBLIC_KEY_PEM; any other
 * kid must exist in the rotation map (module const or `extraKeys`
 * override), otherwise the token is rejected.
 * @param {string} token
 * @param {string} [publicKeyPem] override for the primary key (tests)
 * @param {Object<string,string>} [extraKeys] override for the rotation map (tests)
 * @returns {object|null} payload when the signature is valid, else null
 */
function verifyLicenseToken(token, publicKeyPem, extraKeys) {
  try {
    const primary = publicKeyPem || LICENSE_PUBLIC_KEY_PEM;
    if (!primary || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const payloadBytes = base64urlDecode(parts[0]);
    const signature = base64urlDecode(parts[1]);
    let payload;
    try {
      payload = JSON.parse(payloadBytes.toString('utf8'));
    } catch (e) {
      return null;
    }
    if (!payload || typeof payload !== 'object') return null;
    let pem = primary;
    const kid = typeof payload.kid === 'string' ? payload.kid : null;
    if (kid && kid !== 'key-1') {
      const rotation = Object.assign({}, LICENSE_PUBLIC_KEY_ROTATION, extraKeys || {});
      if (!rotation[kid]) return null; // unknown key id — fail closed
      pem = rotation[kid];
    }
    const ok = crypto.verify(null, payloadBytes, pem, signature);
    if (!ok) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Monotonic "last seen server time" (anti clock-rollback)
// ---------------------------------------------------------------------------

function readState(stateDir) {
  try {
    const file = path.join(stateDir || defaultStateDir(), STATE_FILE_NAME);
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && typeof parsed.lastSeenServerTime === 'number') return parsed;
    }
  } catch (e) { /* corrupt/missing state → start fresh */ }
  return { lastSeenServerTime: 0 };
}

function recordServerTime(serverTimeMs, stateDir) {
  if (typeof serverTimeMs !== 'number' || !(serverTimeMs > 0)) return 0;
  const dir = stateDir || defaultStateDir();
  const state = readState(dir);
  if (serverTimeMs <= state.lastSeenServerTime) return state.lastSeenServerTime;
  state.lastSeenServerTime = serverTimeMs;
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, STATE_FILE_NAME), JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
  } catch (e) { /* persistence failure: in-memory value still returned by caller flow */ }
  return state.lastSeenServerTime;
}

/** Effective "now" for expiry checks: never behind the last server time seen. */
function effectiveNow(stateDir) {
  return Math.max(Date.now(), readState(stateDir).lastSeenServerTime);
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/**
/**
 * Evaluate a stored license token. ALWAYS strict: the returned verdict
 * is what enforcement would decide (fail-closed binding when opted in,
 * issuance lifetime cap, expiry + 3-day grace, status). Shadow mode is
 * a property of the GATE (license-gate.js), not of this function — the
 * gate logs this verdict and returns the legacy verdict instead.
 *
 * @param {string} token
 * @param {object} [opts]
 *   deviceId / installId: this install's ids. Callers MUST pass both;
 *     with enforceBinding: true a missing claim or missing caller
 *     context fails closed.
 *   enforceBinding: fail-closed binding (the production gate always
 *     sets this). Without it, binding is enforced only when both the
 *     claim and the caller context are present and disagree; gaps are
 *     reported in `warnings` instead of denying.
 *   businessId: when passed, the token must cover it in businessIds.
 *   stateDir, publicKeyPem, publicKeys: test/rotation overrides.
 * @returns {{configured: boolean, valid: boolean, entitled: boolean,
 *   reason: string, warnings: string[], graceDays: number,
 *   graceUntilMs: number|null, inGrace: boolean,
 *   hardExpiryMode: string, payload?: object}}
 *   configured=false → no public key embedded yet; callers MUST use the
 *   legacy entitlement path (this is today's behaviour).
 */
function evaluate(token, opts = {}) {
  const pem = opts.publicKeyPem || LICENSE_PUBLIC_KEY_PEM;
  const base = {
    configured: Boolean(pem),
    valid: false,
    entitled: false,
    reason: '',
    warnings: [],
    graceDays: GRACE_DAYS,
    graceUntilMs: null,
    inGrace: false,
    hardExpiryMode: HARD_EXPIRY_MODE
  };
  if (!pem) return Object.assign(base, { reason: 'license-public-key-not-configured' });
  if (!token) return Object.assign(base, { configured: true, reason: 'no-license-token' });

  const payload = verifyLicenseToken(token, pem, opts.publicKeys);
  if (!payload) return Object.assign(base, { configured: true, reason: 'bad-signature-or-format' });

  // Anchor anti-rollback time on every authentic token.
  if (typeof payload.serverTime === 'number') {
    recordServerTime(payload.serverTime, opts.stateDir);
  }

  const warnings = [];
  const failures = [];

  // --- Issuance bounds (token-intrinsic, fail-closed). ---
  if (typeof payload.issuedAt !== 'number') {
    failures.push('missing-issued-at');
  } else if (typeof payload.expiresAt === 'number' && payload.expiresAt - payload.issuedAt > MAX_TOKEN_LIFETIME_MS) {
    failures.push('token-lifetime-exceeded');
  }
  if (typeof payload.expiresAt !== 'number') {
    failures.push('missing-expires-at');
  }

  // --- Device / install binding (fail-closed once enforcing). ---
  const enforceBinding = opts.enforceBinding === true;
  if (opts.deviceId && payload.deviceId && payload.deviceId !== opts.deviceId) {
    failures.push('device-mismatch');
  } else if (enforceBinding) {
    if (opts.deviceId && !payload.deviceId) failures.push('missing-device-claim');
    else if (!opts.deviceId && payload.deviceId) failures.push('missing-device-context');
    else if (!opts.deviceId && !payload.deviceId) failures.push('binding-unavailable');
  } else if (opts.deviceId && !payload.deviceId) {
    warnings.push('missing-device-claim');
  } else if (!opts.deviceId && payload.deviceId) {
    warnings.push('missing-device-context');
  }
  if (opts.installId && payload.installId && payload.installId !== opts.installId) {
    failures.push('install-mismatch');
  } else if (enforceBinding) {
    if (opts.installId && !payload.installId) failures.push('missing-install-claim');
    else if (!opts.installId && payload.installId) failures.push('missing-install-context');
    else if (!opts.installId && !payload.installId) failures.push('binding-unavailable');
  } else if (opts.installId && !payload.installId) {
    warnings.push('missing-install-claim');
  } else if (!opts.installId && payload.installId) {
    warnings.push('missing-install-context');
  }

  // --- Business coverage (the gates must check this; evaluate does it
  // when the caller passes businessId). ---
  if (opts.businessId) {
    if (!Array.isArray(payload.businessIds)) {
      failures.push('missing-business-claims');
    } else if (!payload.businessIds.includes(opts.businessId)) {
      failures.push('business-not-covered');
    }
  }

  // --- Expiry + grace. Entitlement runs until expiresAt + GRACE_DAYS. ---
  const now = effectiveNow(opts.stateDir);
  let graceUntilMs = null;
  let expired = false;
  if (typeof payload.expiresAt === 'number') {
    graceUntilMs = payload.expiresAt + GRACE_DAYS * DAY_MS;
    if (now > graceUntilMs) expired = true;
    else if (now > payload.expiresAt) base.inGrace = true;
  }

  // --- Status. ---
  const status = String(payload.status || '').toUpperCase();
  const statusOk = status === 'ACTIVE' || status === 'TRIAL' || status === 'GRACE';

  let reason = 'ok';
  if (failures.length > 0) reason = failures[0];
  else if (expired) reason = 'expired';
  else if (!statusOk) reason = `status-${status.toLowerCase() || 'missing'}`;

  return Object.assign(base, {
    configured: true,
    valid: true,
    entitled: reason === 'ok',
    reason,
    warnings,
    graceUntilMs,
    payload
  });
}

module.exports = {
  LICENSE_PUBLIC_KEY_PEM,
  LICENSE_PUBLIC_KEY_ROTATION,
  GRACE_DAYS,
  HARD_EXPIRY_MODE,
  MAX_TOKEN_LIFETIME_DAYS,
  verifyLicenseToken,
  recordServerTime,
  effectiveNow,
  evaluate,
  // Exported for the test script and the future server-side issuer tests.
  _base64urlEncode: base64urlEncode,
  _base64urlDecode: base64urlDecode
};

