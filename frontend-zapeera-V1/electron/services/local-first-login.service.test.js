/**
 * Standalone test for services/local-first-login.service.js — Phase 2B:
 * cached cloud-verified credentials, the revalidation window, the
 * failure classifications, healing and purge discipline.
 * Run:  node electron/services/local-first-login.service.test.js
 * Uses an in-memory fake for the injected database deps plus the REAL
 * bcrypt helpers from services/auth/auth.service.js.
 */
const assert = require('assert');
const svc = require('./local-first-login.service');
const authService = require('./auth/auth.service');

// ---- In-memory fake DB -------------------------------------------------
const users = [];
const identities = [];

function findUserRow(idf) {
  return users.filter(u =>
    (String(u.email || '').toLowerCase() === idf || String(u.username || '').toLowerCase() === idf));
}

function query(sql, params = []) {
  if (sql.includes('FROM users u') && sql.includes('LEFT JOIN local_identity')) {
    const [idf] = params;
    return findUserRow(idf)
      .filter(u => u.credentialCachedAt != null)
      .map(u => {
        const identity = identities.find(i => i.cloudUserId === u.id);
        return { ...u, identityLastValidation: identity ? identity.lastCloudValidationAt : null };
      });
  }
  if (sql.includes('SELECT id FROM users WHERE')) {
    const [idf] = params;
    return findUserRow(idf).filter(u => u.credentialCachedAt != null).map(u => ({ id: u.id }));
  }
  if (sql.includes('SELECT id FROM local_identity WHERE cloudUserId = ?')) {
    const [cid] = params;
    return identities.filter(i => i.cloudUserId === cid).map(i => ({ id: i.id }));
  }
  throw new Error('fake query: unhandled SQL: ' + sql);
}

function run(sql, params = []) {
  if (sql.includes('UPDATE users SET password = ?, credentialCachedAt = ?')) {
    const [hash, cachedAt, , id] = params;
    const u = users.find(x => x.id === id);
    if (u) { u.password = hash; u.credentialCachedAt = cachedAt; }
    return;
  }
  if (sql.includes('UPDATE users SET password = ?, credentialCachedAt = NULL')) {
    const [hash, , id] = params;
    const u = users.find(x => x.id === id);
    if (u) { u.password = hash; u.credentialCachedAt = null; }
    return;
  }
  if (sql.includes('UPDATE users SET sessionToken = ?')) {
    const [token, , , id] = params;
    const u = users.find(x => x.id === id);
    if (u) { u.sessionToken = token; u.lastLoginAt = params[1]; }
    return;
  }
  if (sql.includes('UPDATE local_identity SET')) {
    const [, , , , , , cid] = params;
    const i = identities.find(x => x.cloudUserId === cid);
    if (i) { i.lastCloudValidationAt = params[4]; i.lastAuthenticatedAt = params[3]; }
    return;
  }
  if (sql.includes('INSERT INTO local_identity')) {
    const [id, cloudUserId, displayName, email, username, lastAuthenticatedAt, lastCloudValidationAt] = params;
    identities.push({ id, cloudUserId, displayName, email, username, lastAuthenticatedAt, lastCloudValidationAt });
    return;
  }
  throw new Error('fake run: unhandled SQL: ' + sql);
}

const FIXED_NOW = '2026-11-11T10:00:00.000Z';
svc.init({
  query,
  run,
  saveDatabase: () => {},
  now: () => FIXED_NOW,
  hashPasswordBcrypt: authService.hashPasswordBcrypt,
  verifyPassword: authService.verifyPassword,
  sessionService: {
    createSession: (userId, deviceId) => ({
      token: 'sess-' + userId,
      expiresAt: '2026-12-11T10:00:00.000Z',
      offlineExpiresAt: '2026-12-14T10:00:00.000Z'
    })
  },
  deviceService: { registerDevice: () => {}, getDeviceId: () => 'dev-1' },
  generateToken: (payload) => 'jwt-' + payload.id
});

function seedUser(overrides = {}) {
  const u = {
    id: 'user-1',
    username: 'owner@shop.pk',
    email: 'owner@shop.pk',
    name: 'Owner',
    role: 'OWNER',
    companyId: 'biz-1',
    branchId: null,
    profileImage: null,
    isActive: 1,
    password: authService.hashPasswordBcrypt('placeholder-' + Math.random()),
    credentialCachedAt: null,
    ...overrides
  };
  users.push(u);
  return u;
}

const DAY = 24 * 3600 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const NOW_MS = new Date(FIXED_NOW).getTime();

(async () => {
  // 1) A provisioned user WITHOUT a cached credential is unknown to
  //    local-first (the placeholder hash must never authenticate).
  const u1 = seedUser();
  let r = await svc.verifyLocalLogin('owner@shop.pk', 'whatever');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'LOCAL_UNKNOWN', 'placeholder-only user must be LOCAL_UNKNOWN');

  // 2) Cache the verified credential → local login succeeds in-window.
  svc.cacheCredential('user-1', 'S3cret!pw');
  const row1 = users.find(u => u.id === 'user-1');
  assert.ok(row1.credentialCachedAt, 'credentialCachedAt must be set');
  assert.ok(/^\$2[aby]\$10\$/.test(row1.password), 'cached hash must be bcrypt cost 10, got: ' + row1.password.slice(0, 7));
  r = await svc.verifyLocalLogin('Owner@Shop.pk', 'S3cret!pw'); // case-insensitive identifier
  assert.strictEqual(r.ok, true, 'correct password must verify locally');
  assert.strictEqual(r.user.id, 'user-1');
  assert.strictEqual(r.sessionToken, 'sess-user-1');
  assert.strictEqual(r.session.offlineGrace, false);

  // 3) Wrong password → mismatch classification (NOT unknown).
  r = await svc.verifyLocalLogin('owner@shop.pk', 'wrong-pw');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.code, 'LOCAL_MISMATCH');

  // 4) Never-on-this-device → unknown classification.
  r = await svc.verifyLocalLogin('stranger@shop.pk', 'S3cret!pw');
  assert.strictEqual(r.code, 'LOCAL_UNKNOWN');

  // 5) Window: identity anchor 31 days ago → grace (login honoured,
  //    flagged); 34 days ago → expired gate. Anchor = the identity
  //    row's lastCloudValidationAt when present.
  identities.push({ id: 'cloud-user-1', cloudUserId: 'user-1', lastCloudValidationAt: iso(NOW_MS - 31 * DAY), lastAuthenticatedAt: iso(NOW_MS - 31 * DAY) });
  r = await svc.verifyLocalLogin('owner@shop.pk', 'S3cret!pw');
  assert.strictEqual(r.ok, true, 'grace window must still honour local login');
  assert.strictEqual(r.session.offlineGrace, true);
  identities[0].lastCloudValidationAt = iso(NOW_MS - 34 * DAY);
  r = await svc.verifyLocalLogin('owner@shop.pk', 'S3cret!pw');
  assert.strictEqual(r.code, 'LOCAL_WINDOW_EXPIRED', 'past 30d + 72h the gate must close');

  // 6) Anchor fallback: no identity row → credentialCachedAt anchors.
  identities.length = 0;
  row1.credentialCachedAt = iso(NOW_MS - 10 * DAY);
  r = await svc.verifyLocalLogin('owner@shop.pk', 'S3cret!pw');
  assert.strictEqual(r.ok, true, 'credentialCachedAt fallback anchor must work');
  row1.credentialCachedAt = iso(NOW_MS - 40 * DAY);
  r = await svc.verifyLocalLogin('owner@shop.pk', 'S3cret!pw');
  assert.strictEqual(r.code, 'LOCAL_WINDOW_EXPIRED');

  // 7) Heal: password changed online → one cloud sign-in re-caches;
  //    the old password then mismatches and the new one works.
  row1.credentialCachedAt = FIXED_NOW;
  svc.cacheCredential('user-1', 'N3w!password');
  r = await svc.verifyLocalLogin('owner@shop.pk', 'S3cret!pw');
  assert.strictEqual(r.code, 'LOCAL_MISMATCH', 'old password must fail after heal');
  r = await svc.verifyLocalLogin('owner@shop.pk', 'N3w!password');
  assert.strictEqual(r.ok, true, 'new password must work after heal');

  // 8) Purge (definitive cloud rejection): entry destroyed — the old
  //    password no longer authenticates and the row reads unknown.
  svc.purgeCredentialByCloudUserId('user-1');
  assert.strictEqual(users.find(u => u.id === 'user-1').credentialCachedAt, null);
  r = await svc.verifyLocalLogin('owner@shop.pk', 'N3w!password');
  assert.strictEqual(r.code, 'LOCAL_UNKNOWN', 'purged user must be unknown to local-first');
  const verdict = await authService.verifyPassword('N3w!password', users.find(u => u.id === 'user-1').password);
  assert.strictEqual(verdict.valid, false, 'purge must replace the hash itself, not just the flag');

  // 9) Inactive mirrored user never authenticates locally.
  const u2 = seedUser({ id: 'user-2', username: 'off@shop.pk', email: 'off@shop.pk', isActive: 0 });
  svc.cacheCredential('user-2', 'pw123456');
  r = await svc.verifyLocalLogin('off@shop.pk', 'pw123456');
  assert.strictEqual(r.code, 'LOCAL_UNKNOWN', 'inactive user must not authenticate');

  // 10) touchIdentityFromProvision creates then updates the anchor.
  svc.touchIdentityFromProvision({ id: 'user-9', name: 'Nine', email: 'nine@shop.pk', username: 'nine@shop.pk' });
  const idn = identities.find(i => i.cloudUserId === 'user-9');
  assert.ok(idn && idn.lastCloudValidationAt === FIXED_NOW, 'provision must anchor the identity row');
  svc.touchIdentityFromProvision({ id: 'user-9', name: 'Nine', email: 'nine@shop.pk', username: 'nine@shop.pk' });
  assert.strictEqual(identities.filter(i => i.cloudUserId === 'user-9').length, 1, 'identity upsert must not duplicate');

  console.log('local-first-login.service.test: ALL PASS');
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
