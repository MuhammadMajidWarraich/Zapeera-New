/**
 * Standalone test for services/session.service.js — session windows and
 * the offline grace (incl. the 2026-11-10 grace-window repair).
 * Run:  node electron/services/session.service.test.js
 * Uses an in-memory fake for the injected database deps. Exits non-zero
 * on the first failed assertion.
 */
const assert = require('assert');
const svc = require('./session.service');

// ---- In-memory fake DB -------------------------------------------------
const rows = [];
let uuidCounter = 0;

function query(sql, params = []) {
  if (sql.includes('WHERE token = ?')) {
    const [token, status] = params;
    return rows.filter(r => r.token === token && r.status === status).map(r => ({ ...r }));
  }
  if (sql.includes("WHERE status = 'ACTIVE'")) {
    return rows.filter(r => r.status === 'ACTIVE').map(r => ({ ...r }));
  }
  throw new Error('fake query: unhandled SQL: ' + sql);
}

function run(sql, params = []) {
  if (sql.includes('INSERT INTO sessions')) {
    const [id, token, userId, deviceId, expiresAt, offlineExpiresAt, createdAt, updatedAt] = params;
    rows.push({ id, token, userId, deviceId, status: 'ACTIVE', expiresAt, offlineExpiresAt, createdAt, updatedAt });
    return;
  }
  if (sql.includes("SET status = 'REVOKED'")) {
    const [, token] = params;
    const row = rows.find(r => r.token === token);
    if (row) row.status = 'REVOKED';
    return;
  }
  if (sql.includes('SET offlineExpiresAt')) {
    const [offlineExpiresAt, , id] = params;
    const row = rows.find(r => r.id === id);
    if (row) row.offlineExpiresAt = offlineExpiresAt;
    return;
  }
  throw new Error('fake run: unhandled SQL: ' + sql);
}

svc.init({
  query,
  run,
  saveDatabase: () => {},
  uuid: () => `uuid-${++uuidCounter}`,
  now: () => new Date().toISOString(),
});

const HOUR = 60 * 60 * 1000;
const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
function seedSession({ token, expiresAt, offlineExpiresAt, status = 'ACTIVE' }) {
  const row = {
    id: `seed-${token}`, token, userId: 'user-1', deviceId: 'dev-1',
    status, expiresAt, offlineExpiresAt, createdAt: iso(-24 * HOUR), updatedAt: iso(-24 * HOUR),
  };
  rows.push(row);
  return row;
}

// ---- 1. createSession: grace deadline sits BEYOND the primary expiry ---
{
  const before = Date.now();
  const s = svc.createSession('user-1', 'dev-1');
  const expMs = new Date(s.expiresAt).getTime();
  const offMs = new Date(s.offlineExpiresAt).getTime();
  assert.ok(Math.abs(expMs - (before + 720 * HOUR)) < 5000, 'expiresAt = creation + 720h (30 days)');
  assert.ok(Math.abs(offMs - (before + 792 * HOUR)) < 5000, 'offlineExpiresAt = creation + 792h (720h + 72h grace)');
  assert.ok(offMs > expMs, 'grace deadline must be after the primary expiry');
  console.log('ok 1 - createSession windows (720h/30d primary, +72h grace beyond it)');
}

// ---- 2. validateOfflineSession inside the primary window ---------------
{
  seedSession({ token: 'tok-primary', expiresAt: iso(24 * HOUR), offlineExpiresAt: iso(96 * HOUR) });
  const s = svc.validateOfflineSession('tok-primary');
  assert.ok(s, 'session inside primary window validates');
  assert.ok(!s._offlineGrace, 'no grace flag inside the primary window');
  console.log('ok 2 - validation inside primary window');
}

// ---- 3. validateOfflineSession inside the grace window -----------------
{
  seedSession({ token: 'tok-grace', expiresAt: iso(-1 * HOUR), offlineExpiresAt: iso(48 * HOUR) });
  const s = svc.validateOfflineSession('tok-grace');
  assert.ok(s, 'session inside grace window validates');
  assert.strictEqual(s._offlineGrace, true, 'grace flag set');
  console.log('ok 3 - validation inside grace window (flagged _offlineGrace)');
}

// ---- 4. Past the grace window: rejected AND revoked --------------------
{
  const row = seedSession({ token: 'tok-dead', expiresAt: iso(-96 * HOUR), offlineExpiresAt: iso(-24 * HOUR) });
  const s = svc.validateOfflineSession('tok-dead');
  assert.strictEqual(s, null, 'session past grace is rejected');
  assert.strictEqual(row.status, 'REVOKED', 'dead session is revoked, not left ACTIVE');
  console.log('ok 4 - past grace: rejected + revoked');
}

// ---- 5. Unknown / missing token ----------------------------------------
{
  assert.strictEqual(svc.validateOfflineSession('nope'), null);
  assert.strictEqual(svc.validateOfflineSession(null), null);
  console.log('ok 5 - unknown token rejected');
}

// ---- 6. repairOfflineGraceWindows --------------------------------------
{
  rows.length = 0;
  // (a) buggy-shape row, still within primary validity -> repaired
  const a = seedSession({ token: 'rep-a', expiresAt: iso(100 * HOUR), offlineExpiresAt: iso(-28 * HOUR) });
  // (b) buggy-shape row whose primary expiry already passed -> untouched
  const bOffline = iso(-82 * HOUR);
  const b = seedSession({ token: 'rep-b', expiresAt: iso(-10 * HOUR), offlineExpiresAt: bOffline });
  // (c) already on the post-fix window -> untouched
  const cExpires = iso(100 * HOUR);
  const cOffline = new Date(new Date(cExpires).getTime() + 72 * HOUR).toISOString();
  const c = seedSession({ token: 'rep-c', expiresAt: cExpires, offlineExpiresAt: cOffline });
  // (d) revoked row in buggy shape -> untouched (repair only looks at ACTIVE)
  const dOffline = iso(-28 * HOUR);
  const d = seedSession({ token: 'rep-d', expiresAt: iso(100 * HOUR), offlineExpiresAt: dOffline, status: 'REVOKED' });

  const repaired = svc.repairOfflineGraceWindows();
  assert.strictEqual(repaired, 1, 'exactly one session repaired');
  const expected = new Date(new Date(a.expiresAt).getTime() + 72 * HOUR).toISOString();
  assert.strictEqual(a.offlineExpiresAt, expected, 'repaired to expiresAt + 72h');
  assert.strictEqual(b.offlineExpiresAt, bOffline, 'expired session untouched (no resurrection)');
  assert.strictEqual(c.offlineExpiresAt, cOffline, 'post-fix row untouched');
  assert.strictEqual(d.offlineExpiresAt, dOffline, 'revoked row untouched');

  assert.ok(a.expiresAt !== undefined && new Date(a.expiresAt).getTime() > Date.now(), 'repair never rewrites the primary expiry');
  assert.strictEqual(svc.repairOfflineGraceWindows(), 0, 'repair is idempotent');
  console.log('ok 6 - repair: still-valid buggy rows only, idempotent, no resurrection');
}

// ---- 7. A grace login does NOT extend the window ------------------------
{
  rows.length = 0;
  const g = seedSession({ token: 'tok-grace2', expiresAt: iso(-2 * HOUR), offlineExpiresAt: iso(24 * HOUR) });
  const beforeExp = g.expiresAt; const beforeOff = g.offlineExpiresAt;
  const s1 = svc.validateOfflineSession('tok-grace2');
  assert.ok(s1 && s1._offlineGrace, 'grace validation succeeds');
  const s2 = svc.validateOfflineSession('tok-grace2');
  assert.ok(s2 && s2._offlineGrace, 'repeat grace validation still succeeds inside the window');
  assert.strictEqual(g.expiresAt, beforeExp, 'grace login must not extend expiresAt');
  assert.strictEqual(g.offlineExpiresAt, beforeOff, 'grace login must not extend offlineExpiresAt');
  console.log('ok 7 - grace login is a hard window (no extension on use)');
}

// ---- 8. Legacy 7-day session repaired for grace, primary untouched -----
{
  rows.length = 0;
  // A session minted by v1.0.18: primary = creation+168h (still valid),
  // offlineExpiresAt = creation+72h (buggy, already in the past).
  const legacy = seedSession({ token: 'tok-legacy', expiresAt: iso(50 * HOUR), offlineExpiresAt: iso(-98 * HOUR) });
  const legacyExp = legacy.expiresAt;
  const n = svc.repairOfflineGraceWindows();
  assert.strictEqual(n, 1, 'legacy session repaired');
  assert.strictEqual(legacy.expiresAt, legacyExp, 'legacy primary expiry NOT extended by repair');
  assert.strictEqual(legacy.offlineExpiresAt, new Date(new Date(legacyExp).getTime() + 72 * HOUR).toISOString(), 'legacy grace = its own expiresAt + 72h');
  console.log('ok 8 - legacy 168h session: grace repaired, primary untouched');
}

console.log('\nAll session.service tests passed.');
