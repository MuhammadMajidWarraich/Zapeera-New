/**
 * Operator Service (v1.0.19 — staff PIN layer)
 *
 * The OPERATOR is the person physically at the till, identified by a
 * personal 4–6 digit PIN verified LOCALLY against the bcrypt hash that
 * rode the staffProfile sync pull down from the cloud. The operator is
 * deliberately separate from the device ACCOUNT session: the account
 * signs in once (online, 30-day local session); operators then switch
 * all day long with no internet and no account logout — which is what
 * makes shift changes on shared counters work offline.
 *
 * State: one binding per business in the local-only `operator_bindings`
 * table (never synced). The binding is proven by a random token the
 * frontend stores and sends as `x-operator-token`; the row alone grants
 * nothing. Manager overrides are short-lived in-memory grants (5 min)
 * issued by the same PIN verification for a privileged profile.
 */

const crypto = require('crypto');

let _query = null;
let _run = null;
let _saveDatabase = null;
let _uuid = null;
let _now = null;
let _bcrypt = null;

const PRIVILEGED_ROLES = ['OWNER', 'MANAGER', 'ADMIN'];
const PIN_PATTERN = /^\d{4,6}$/;
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 5 * 60 * 1000;
const OVERRIDE_TTL_MS = 5 * 60 * 1000;

// staffProfileId -> { fails, lockedUntil }
const pinAttempts = new Map();
// overrideToken -> { businessId, staffProfileId, userId, name, role, expiresAt }
const overrideGrants = new Map();

function init(deps) {
  _query = deps.query;
  _run = deps.run;
  _saveDatabase = deps.saveDatabase;
  _uuid = deps.uuid;
  _now = deps.now;
  _bcrypt = deps.bcryptjs || require('bcryptjs');
}

function ensureInit() {
  if (!_query) {
    const deps = require('./database.service');
    init({
      query: deps.query,
      run: deps.run,
      saveDatabase: deps.saveDatabase,
      uuid: require('../utils/helpers').uuid,
      now: require('../utils/helpers').now,
      bcryptjs: require('bcryptjs')
    });
  }
}

/**
 * Staff of a business with their PIN state, for the lock screen.
 * Same join the staff roster uses (profiles → memberships → users);
 * the hash itself is never returned — only hasPin.
 */
function listStaffForBusiness(businessId) {
  ensureInit();
  if (!businessId) return { pinEnabled: false, staff: [] };
  const rows = _query(
    `SELECT sp.id AS staffProfileId, sp.membershipId AS membershipId, sp.designation AS designation,
            sp.employeeId AS employeeId, sp.pinHash AS pinHash,
            m.userId AS userId, m.role AS role, u.name AS userName
     FROM staff_profiles sp
     JOIN memberships m ON m.id = sp.membershipId
     LEFT JOIN users u ON u.id = m.userId
     WHERE m.businessId = ? AND (sp.isActive IS NULL OR sp.isActive = 1)
     ORDER BY u.name ASC`,
    [businessId]
  ) || [];
  const staff = rows.map((r) => ({
    staffProfileId: r.staffProfileId,
    membershipId: r.membershipId,
    userId: r.userId,
    name: r.userName || r.designation || r.employeeId || 'Staff',
    role: r.role || null,
    designation: r.designation || null,
    employeeId: r.employeeId || null,
    hasPin: Boolean(r.pinHash)
  }));
  return { pinEnabled: staff.some((s) => s.hasPin), staff };
}

function getProfilePinRow(staffProfileId, businessId) {
  const rows = _query(
    `SELECT sp.id AS staffProfileId, sp.membershipId AS membershipId, sp.pinHash AS pinHash,
            sp.designation AS designation, sp.employeeId AS employeeId,
            m.userId AS userId, m.role AS role, m.businessId AS businessId, u.name AS userName
     FROM staff_profiles sp
     JOIN memberships m ON m.id = sp.membershipId
     LEFT JOIN users u ON u.id = m.userId
     WHERE sp.id = ? AND m.businessId = ? AND (sp.isActive IS NULL OR sp.isActive = 1)`,
    [staffProfileId, businessId]
  ) || [];
  return rows.length > 0 ? rows[0] : null;
}

function pinLockState(staffProfileId) {
  const entry = pinAttempts.get(staffProfileId);
  if (entry && entry.lockedUntil && entry.lockedUntil > Date.now()) {
    return { locked: true, retryAfterMs: entry.lockedUntil - Date.now() };
  }
  return { locked: false, retryAfterMs: 0 };
}

function recordPinFailure(staffProfileId) {
  const entry = pinAttempts.get(staffProfileId) || { fails: 0, lockedUntil: 0 };
  entry.fails += 1;
  if (entry.fails >= MAX_PIN_ATTEMPTS) {
    entry.lockedUntil = Date.now() + PIN_LOCKOUT_MS;
    entry.fails = 0;
  }
  pinAttempts.set(staffProfileId, entry);
}

/**
 * Verify a staff member's PIN against the synced hash. Pure check —
 * binding/grant issuance is the caller's job. Returns a result object:
 * { ok: true, profile } | { ok: false, reason, retryAfterMs? }
 */
async function verifyPin(businessId, staffProfileId, pin) {
  ensureInit();
  if (typeof pin !== 'string' || !PIN_PATTERN.test(pin)) {
    return { ok: false, reason: 'INVALID_PIN_FORMAT' };
  }
  const lock = pinLockState(staffProfileId);
  if (lock.locked) {
    return { ok: false, reason: 'PIN_LOCKED', retryAfterMs: lock.retryAfterMs };
  }
  const row = getProfilePinRow(staffProfileId, businessId);
  if (!row) return { ok: false, reason: 'STAFF_NOT_FOUND' };
  if (!row.pinHash) return { ok: false, reason: 'NO_PIN_SET' };
  const match = await _bcrypt.compare(pin, row.pinHash);
  if (!match) {
    recordPinFailure(staffProfileId);
    return { ok: false, reason: 'PIN_MISMATCH' };
  }
  pinAttempts.delete(staffProfileId);
  return {
    ok: true,
    profile: {
      staffProfileId: row.staffProfileId,
      membershipId: row.membershipId,
      userId: row.userId,
      businessId: row.businessId,
      role: row.role || null,
      name: row.userName || row.designation || row.employeeId || 'Staff'
    }
  };
}

function isPrivilegedRole(role) {
  return PRIVILEGED_ROLES.includes(String(role || '').toUpperCase());
}

/** Bind the operator for a business; returns the binding + token. */
function bindOperator(profile) {
  ensureInit();
  const operatorToken = crypto.randomBytes(32).toString('hex');
  const ts = _now();
  const existing = _query('SELECT businessId FROM operator_bindings WHERE businessId = ?', [profile.businessId]) || [];
  if (existing.length > 0) {
    _run(
      `UPDATE operator_bindings SET staffProfileId = ?, membershipId = ?, userId = ?, operatorToken = ?, boundAt = ?, updatedAt = ? WHERE businessId = ?`,
      [profile.staffProfileId, profile.membershipId, profile.userId, operatorToken, ts, ts, profile.businessId]
    );
  } else {
    _run(
      `INSERT INTO operator_bindings (businessId, staffProfileId, membershipId, userId, operatorToken, boundAt, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [profile.businessId, profile.staffProfileId, profile.membershipId, profile.userId, operatorToken, ts, ts, ts]
    );
  }
  _saveDatabase();
  return {
    businessId: profile.businessId,
    staffProfileId: profile.staffProfileId,
    membershipId: profile.membershipId,
    userId: profile.userId,
    role: profile.role || null,
    name: profile.name || 'Staff',
    operatorToken,
    boundAt: ts
  };
}

function getBindingByToken(operatorToken) {
  ensureInit();
  if (!operatorToken) return null;
  const rows = _query(
    `SELECT b.businessId, b.staffProfileId, b.membershipId, b.userId, b.boundAt,
            m.role AS role, u.name AS userName, sp.designation AS designation, sp.employeeId AS employeeId
     FROM operator_bindings b
     JOIN memberships m ON m.id = b.membershipId
     JOIN staff_profiles sp ON sp.id = b.staffProfileId
     LEFT JOIN users u ON u.id = b.userId
     WHERE b.operatorToken = ?`,
    [operatorToken]
  ) || [];
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    businessId: r.businessId,
    staffProfileId: r.staffProfileId,
    membershipId: r.membershipId,
    userId: r.userId,
    role: r.role || null,
    name: r.userName || r.designation || r.employeeId || 'Staff',
    boundAt: r.boundAt
  };
}

function getBindingForBusiness(businessId) {
  ensureInit();
  if (!businessId) return null;
  const rows = _query('SELECT * FROM operator_bindings WHERE businessId = ?', [businessId]) || [];
  return rows.length > 0 ? rows[0] : null;
}

function clearBinding(businessId) {
  ensureInit();
  if (!businessId) return;
  _run('DELETE FROM operator_bindings WHERE businessId = ?', [businessId]);
  _saveDatabase();
}

/** Issue a short-lived manager-override grant for one business. */
function issueOverrideGrant(profile) {
  const overrideToken = crypto.randomBytes(32).toString('hex');
  overrideGrants.set(overrideToken, {
    businessId: profile.businessId,
    staffProfileId: profile.staffProfileId,
    userId: profile.userId,
    name: profile.name,
    role: profile.role || null,
    expiresAt: Date.now() + OVERRIDE_TTL_MS
  });
  return overrideToken;
}

/** Resolve (and consume) an override grant. One grant = one action. */
function consumeOverrideGrant(overrideToken, businessId) {
  if (!overrideToken) return null;
  const grant = overrideGrants.get(overrideToken);
  if (!grant) return null;
  overrideGrants.delete(overrideToken);
  if (grant.expiresAt < Date.now()) return null;
  if (businessId && grant.businessId !== businessId) return null;
  return grant;
}

function peekOverrideGrant(overrideToken, businessId) {
  if (!overrideToken) return null;
  const grant = overrideGrants.get(overrideToken);
  if (!grant || grant.expiresAt < Date.now()) return null;
  if (businessId && grant.businessId !== businessId) return null;
  return grant;
}

module.exports = {
  init,
  listStaffForBusiness,
  verifyPin,
  isPrivilegedRole,
  bindOperator,
  getBindingByToken,
  getBindingForBusiness,
  clearBinding,
  issueOverrideGrant,
  consumeOverrideGrant,
  peekOverrideGrant,
  PRIVILEGED_ROLES
};
