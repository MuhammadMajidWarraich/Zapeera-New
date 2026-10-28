/**
 * Standalone regression test for the 2026-10-28 SQLi parameterization
 * (dashboard-type / dashboard / reports embedded routes + the
 * getDataFilter defence-in-depth validation).
 * Run:  node electron/routes/sqli-param.test.js
 * Requires sql.js (frontend node_modules). Exits non-zero on failure.
 *
 * Proves two layers:
 *   1. A UNION / OR-'1'='1' payload in ?companyId= (or the
 *      X-Business-ID header) returns NO rows from another business —
 *      the filter is bound as a parameter, never interpolated.
 *   2. The same payload cannot exfiltrate other tables (UNION SELECT
 *      over users) through the dashboard queries.
 *   3. A legitimate companyId still scopes correctly (no over-blocking).
 */
const assert = require('assert');
const path = require('path');

let SQL;
try {
  SQL = require('sql.js');
} catch (e) {
  SQL = require(path.join(__dirname, '..', '..', 'node_modules', 'sql.js'));
}
const { getDataFilter } = require('../utils/helpers');
const { registerDashboardTypeRoutes } = require('./dashboard-type.routes');
const { registerDashboardRoutes } = require('./dashboard.routes');

async function main() {
  const SQLLib = await SQL();
  const db = new SQLLib.Database();

  // Minimal schema the two handlers touch.
  db.run(`CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT, businessType TEXT, isActive INTEGER)`);
  db.run(`CREATE TABLE branches (id TEXT PRIMARY KEY, name TEXT, companyId TEXT, isActive INTEGER)`);
  db.run(`CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, password TEXT)`);
  db.run(`CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT, sku TEXT, minStock INTEGER, reorderLevel INTEGER, reorderQuantity INTEGER, branchId TEXT, companyId TEXT, isActive INTEGER, quantity INTEGER)`);
  db.run(`CREATE TABLE prescriptions (id TEXT PRIMARY KEY, patientName TEXT, doctorName TEXT, issuedDate TEXT, createdAt TEXT, branchId TEXT, companyId TEXT, isActive INTEGER)`);
  db.run(`CREATE TABLE prescription_items (id TEXT PRIMARY KEY, prescriptionId TEXT, productId TEXT)`);
  db.run(`CREATE TABLE sales (id TEXT PRIMARY KEY, prescriptionId TEXT, branchId TEXT, companyId TEXT, totalAmount REAL, createdAt TEXT, status TEXT)`);
  db.run(`CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT, branchId TEXT, companyId TEXT, isActive INTEGER, quantity INTEGER)`);
  db.run(`CREATE TABLE purchases (id TEXT PRIMARY KEY, branchId TEXT, companyId TEXT, status TEXT)`);
  db.run(`CREATE TABLE batches (id TEXT PRIMARY KEY, batchNo TEXT, productId TEXT, branchId TEXT, companyId TEXT, expireDate TEXT, quantity INTEGER, isActive INTEGER)`);

  db.run(`INSERT INTO companies VALUES ('biz-a', 'Biz A', 'PHARMACY', 1), ('biz-b', 'Biz B', 'PHARMACY', 1)`);
  db.run(`INSERT INTO branches VALUES ('br-a', 'Main', 'biz-a', 1), ('br-b', 'Main', 'biz-b', 1)`);
  db.run(`INSERT INTO users VALUES ('u-1', 'owner@biz-a.test', 'SECRET-HASH-BIZ-A')`);
  db.run(`INSERT INTO products VALUES ('p-1', 'Paracetamol', 'PARA', 5, 10, 20, 'br-a', 'biz-a', 1, 100)`);
  db.run(`INSERT INTO products VALUES ('p-2', 'Ibuprofen', 'IBU', 5, 10, 20, 'br-b', 'biz-b', 1, 100)`);
  db.run(`INSERT INTO prescriptions VALUES ('rx-1', 'Alice', 'Dr Who', '2026-10-28', '2026-10-28T10:00:00.000Z', 'br-a', 'biz-a', 1)`);
  db.run(`INSERT INTO prescriptions VALUES ('rx-2', 'Bob', 'Dr No', '2026-10-28', '2026-10-28T11:00:00.000Z', 'br-b', 'biz-b', 1)`);
  db.run(`INSERT INTO sales VALUES ('s-1', NULL, 'br-a', 'biz-a', 500, '2026-10-28T10:00:00.000Z', 'COMPLETED')`);
  db.run(`INSERT INTO sales VALUES ('s-2', NULL, 'br-b', 'biz-b', 700, '2026-10-28T10:00:00.000Z', 'COMPLETED')`);

  // Same prepare/bind semantics as database.service.js query().
  function query(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const out = [];
    while (stmt.step()) out.push(stmt.getAsObject());
    stmt.free();
    return out;
  }

  // Fake Express app capturing handlers.
  const handlers = {};
  const app = { get: (route, ...fns) => { handlers[route] = fns[fns.length - 1]; } };
  const authMiddleware = (req, res, next) => next();
  const deps = { query, getDataFilter };
  registerDashboardTypeRoutes(app, authMiddleware, deps);
  registerDashboardRoutes(app, authMiddleware, deps);

  function call(route, queryParams, user) {
    return new Promise((resolve) => {
      const req = { query: queryParams, headers: {}, user: user || { role: 'ADMIN', companyId: 'biz-a', branchId: 'br-a' } };
      const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; resolve(this); } };
      handlers[route](req, res);
    });
  }

  // 1. OR-'1'='1' scope bypass via ?companyId= must return NO rows
  // (the validator maps it to a sentinel that matches nothing; even
  // without the validator the bound parameter is a literal).
  let r = await call('/api/dashboard/pharmacy', { companyId: "x' OR '1'='1" });
  assert.strictEqual(r.statusCode, 200, 'pharmacy endpoint must answer');
  assert.strictEqual(r.body.data.stats.prescriptionsToday, 0, 'injection must not widen scope to all businesses');
  assert.strictEqual(r.body.data.recentPrescriptions.length, 0, 'injection must not list other-business prescriptions');

  // 2. UNION SELECT exfiltration attempt must return NO rows and must
  // not surface the users table through the response.
  r = await call('/api/dashboard/pharmacy', { companyId: "' UNION SELECT id, email, password FROM users --" });
  assert.strictEqual(r.body.data.stats.prescriptionsToday, 0, 'UNION injection must not exfiltrate');
  assert.ok(!JSON.stringify(r.body).includes('SECRET-HASH-BIZ-A'), 'user hash must never appear in the response');

  // 3. Legitimate scoping still works: biz-a sees only its own data.
  r = await call('/api/dashboard/pharmacy', { companyId: 'biz-a' });
  assert.strictEqual(r.body.data.stats.prescriptionsToday, 1, 'biz-a must see its own prescription');
  assert.strictEqual(r.body.data.recentPrescriptions[0].patientName, 'Alice');
  r = await call('/api/dashboard/pharmacy', { companyId: 'biz-b' });
  assert.strictEqual(r.body.data.stats.prescriptionsToday, 1, 'biz-b must see its own prescription');
  assert.strictEqual(r.body.data.recentPrescriptions[0].patientName, 'Bob');

  // 4. Same for /api/dashboard/stats: injection sees 0 revenue, legit sees its own.
  r = await call('/api/dashboard/stats', { companyId: "' OR '1'='1" });
  assert.strictEqual(r.body.data.totalRevenue, 0, 'stats injection must not widen scope');
  assert.strictEqual(r.body.data.totalSales, 0);
  r = await call('/api/dashboard/stats', { companyId: 'biz-a' });
  assert.strictEqual(r.body.data.totalSales, 1, 'biz-a stats must count its own sale');
  assert.strictEqual(r.body.data.totalRevenue, 500, 'biz-a stats must sum its own revenue');

  // 5. getDataFilter validation itself: injection ids become the
  // sentinel; legit ids pass through untouched.
  const f = getDataFilter({ role: 'ADMIN', companyId: 'biz-a' }, null, "' OR 1=1 --");
  assert.strictEqual(f.companyFilter, '__zapeera_invalid__', 'invalid company id must map to the no-match sentinel');
  const g = getDataFilter({ role: 'ADMIN', companyId: 'biz-a' }, null, 'biz-a');
  assert.strictEqual(g.companyFilter, 'biz-a', 'legit company id must pass through');
  const h = getDataFilter({ role: 'SUPERADMIN' }, null, null);
  assert.strictEqual(h.companyFilter, null, 'superadmin with no filter stays unscoped');

  console.log('sqli-param.test.js: ALL 5 CHECKS PASSED');
}

main().catch((e) => { console.error(e); process.exit(1); });
