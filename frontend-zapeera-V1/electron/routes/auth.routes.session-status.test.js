/**
 * Regression test for v1.0.20.1 — GET /api/auth/session-status MUST return
 * `data.businesses` (the field the DesktopSessionBanner reads).
 *
 * The v1.0.19 endpoint returned `data.subscriptions` while the banner did
 * `status.businesses.find(...)` — `undefined.find()` crashed EVERY desktop
 * workspace load with "Cannot read properties of undefined (reading
 * 'find')". Web never crashed: the banner only renders on desktop.
 *
 * Run:  node electron/routes/auth.routes.session-status.test.js
 * Exits non-zero on the first failed assertion.
 */
const assert = require('assert');
const { registerAuthRoutes } = require('./auth.routes');

// ---- Fake Express app: capture registered handlers ----------------------
const handlers = {};
const app = {
  get: (path, ...fns) => { handlers['GET ' + path] = fns[fns.length - 1]; },
  post: () => {},
  put: () => {},
  delete: () => {},
  patch: () => {},
};
const authMiddleware = (_req, _res, next) => next();

// ---- Fake deps ------------------------------------------------------------
function makeDeps(queryImpl, sessions) {
  return {
    query: queryImpl,
    run: () => {},
    sessionService: {
      getUserActiveSessions: () => sessions,
    },
    // Everything else the module destructures is unused on this path.
  };
}

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

function callSessionStatus(deps) {
  registerAuthRoutes(app, authMiddleware, deps);
  const handler = handlers['GET /api/auth/session-status'];
  assert.ok(handler, 'session-status handler must be registered');
  const req = { user: { id: 'u1' } };
  const res = fakeRes();
  handler(req, res);
  return res;
}

// ---- Case 1: businesses array is returned with mapped rows --------------
{
  const deps = makeDeps(
    (sql) => {
      assert.ok(sql.includes('FROM subscriptions'), 'reads the local subscriptions mirror');
      return [
        { companyId: 'biz-a', status: 'ACTIVE', periodEnd: '2026-12-11 11:49:59.579' },
        { companyId: 'biz-b', status: 'ACTIVE', periodEnd: null },
      ];
    },
    [{ expiresAt: '2026-12-11T00:00:00.000Z', offlineExpiresAt: '2026-12-14T00:00:00.000Z' }],
  );
  const res = callSessionStatus(deps);
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.success, true);
  assert.ok(Array.isArray(res.body.data.businesses), 'data.businesses must be an array (banner .find()s it)');
  assert.strictEqual(res.body.data.businesses.length, 2);
  assert.deepStrictEqual(res.body.data.businesses[0], {
    businessId: 'biz-a',
    status: 'ACTIVE',
    periodEnd: '2026-12-11 11:49:59.579',
  });
  assert.strictEqual(res.body.data.businesses[1].periodEnd, null);
  assert.ok(res.body.data.session, 'session window present');
  console.log('PASS  session-status returns data.businesses[] with mapped rows');
}

// ---- Case 2: mid-upgrade DB (query throws) -> empty array, still 200 ----
{
  const deps = makeDeps(
    () => { throw new Error('no such column: periodEnd'); },
    [],
  );
  const res = callSessionStatus(deps);
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body.data.businesses, [], 'banner stays silent on a mid-upgrade DB');
  assert.strictEqual(res.body.data.session, null);
  console.log('PASS  mid-upgrade DB -> businesses [] (no crash, banner silent)');
}

console.log('ALL session-status regression checks passed (v1.0.20.1)');
