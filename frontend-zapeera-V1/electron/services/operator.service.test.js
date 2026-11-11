/**
 * Standalone test for services/operator.service.js — Phase 3 staff-PIN
 * operator layer: roster + pinEnabled, PIN verify + lockout, binding,
 * and one-action manager override grants.
 * Run:  node electron/services/operator.service.test.js
 */
const assert = require('assert');
const bcryptjs = require('bcryptjs');
const svc = require('./operator.service');

// ---- Fake joined data --------------------------------------------------
const profiles = [
  { staffProfileId: 'sp-owner', membershipId: 'm-owner', designation: 'Owner', employeeId: 'E1', pinHash: bcryptjs.hashSync('1111', 10), userId: 'u-owner', role: 'OWNER', userName: 'Olivia Owner', businessId: 'biz-1' },
  { staffProfileId: 'sp-mgr', membershipId: 'm-mgr', designation: 'Manager', employeeId: 'E2', pinHash: bcryptjs.hashSync('2222', 10), userId: 'u-mgr', role: 'MANAGER', userName: 'Manny Manager', businessId: 'biz-1' },
  { staffProfileId: 'sp-cash', membershipId: 'm-cash', designation: 'Cashier', employeeId: 'E3', pinHash: bcryptjs.hashSync('3333', 10), userId: 'u-cash', role: 'CASHIER', userName: 'Cass Cashier', businessId: 'biz-1' },
  { staffProfileId: 'sp-nopin', membershipId: 'm-nopin', designation: 'Helper', employeeId: 'E4', pinHash: null, userId: 'u-help', role: 'CASHIER', userName: 'No Pin', businessId: 'biz-1' },
  { staffProfileId: 'sp-other', membershipId: 'm-other', designation: 'Cashier', employeeId: 'E5', pinHash: null, userId: 'u-other', role: 'CASHIER', userName: 'Other Biz', businessId: 'biz-2' }
];
const bindings = [];

function query(sql, params = []) {
  if (sql.includes('FROM staff_profiles sp') && sql.includes('WHERE m.businessId = ?')) {
    const [biz] = params;
    return profiles.filter(p => p.businessId === biz).map(p => ({ ...p }));
  }
  if (sql.includes('FROM staff_profiles sp') && sql.includes('WHERE sp.id = ?')) {
    const [id, biz] = params;
    return profiles.filter(p => p.staffProfileId === id && p.businessId === biz).map(p => ({ ...p }));
  }
  if (sql.includes('SELECT businessId FROM operator_bindings WHERE businessId = ?')) {
    return bindings.filter(b => b.businessId === params[0]).map(b => ({ businessId: b.businessId }));
  }
  if (sql.includes('SELECT * FROM operator_bindings WHERE businessId = ?')) {
    return bindings.filter(b => b.businessId === params[0]).map(b => ({ ...b }));
  }
  if (sql.includes('WHERE b.operatorToken = ?')) {
    return bindings.filter(b => b.operatorToken === params[0]).map(b => {
      const prof = profiles.find(x => x.staffProfileId === b.staffProfileId) || {};
      return { ...b, role: prof.role, userName: prof.userName, designation: prof.designation, employeeId: prof.employeeId };
    });
  }
  throw new Error('fake query: unhandled SQL: ' + sql);
}

function run(sql, params = []) {
  if (sql.includes('INSERT INTO operator_bindings')) {
    const [businessId, staffProfileId, membershipId, userId, operatorToken, ts] = params;
    bindings.push({ businessId, staffProfileId, membershipId, userId, operatorToken, boundAt: ts, updatedAt: ts });
    return;
  }
  if (sql.includes('UPDATE operator_bindings SET')) {
    const [staffProfileId, membershipId, userId, operatorToken, , , businessId] = params;
    const b = bindings.find(x => x.businessId === businessId);
    if (b) Object.assign(b, { staffProfileId, membershipId, userId, operatorToken });
    return;
  }
  if (sql.includes('DELETE FROM operator_bindings WHERE businessId = ?')) {
    const idx = bindings.findIndex(b => b.businessId === params[0]);
    if (idx >= 0) bindings.splice(idx, 1);
    return;
  }
  throw new Error('fake run: unhandled SQL: ' + sql);
}

svc.init({ query, run, saveDatabase: () => {}, now: () => '2026-11-11T10:00:00.000Z', bcryptjs });

(async () => {
  // Roster: pinEnabled true for biz-1 (some PINs), false for biz-2
  // (nobody has a PIN) — and hashes are never exposed.
  let roster = svc.listStaffForBusiness('biz-1');
  assert.strictEqual(roster.pinEnabled, true);
  assert.strictEqual(roster.staff.length, 4);
  assert.ok(roster.staff.every(s => !('pinHash' in s)), 'roster must never carry pinHash');
  assert.strictEqual(roster.staff.find(s => s.staffProfileId === 'sp-nopin').hasPin, false);
  roster = svc.listStaffForBusiness('biz-2');
  assert.strictEqual(roster.pinEnabled, false, 'business with no PINs must report pinEnabled=false');

  // PIN verify: format guard, no-PIN, mismatch, success.
  let v = await svc.verifyPin('biz-1', 'sp-cash', '33');
  assert.strictEqual(v.reason, 'INVALID_PIN_FORMAT');
  v = await svc.verifyPin('biz-1', 'sp-nopin', '1234');
  assert.strictEqual(v.reason, 'NO_PIN_SET');
  v = await svc.verifyPin('biz-1', 'sp-cash', '9999');
  assert.strictEqual(v.reason, 'PIN_MISMATCH');
  v = await svc.verifyPin('biz-1', 'sp-cash', '3333');
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.profile.userId, 'u-cash');
  assert.strictEqual(v.profile.role, 'CASHIER');
  const cashProfile = v.profile;

  // Cross-business profile is not found.
  v = await svc.verifyPin('biz-2', 'sp-cash', '3333');
  assert.strictEqual(v.reason, 'STAFF_NOT_FOUND');

  // Binding: token resolves back to the operator; rebind replaces.
  const binding = svc.bindOperator(cashProfile);
  assert.ok(binding.operatorToken && binding.operatorToken.length >= 32);
  const byToken = svc.getBindingByToken(binding.operatorToken);
  assert.strictEqual(byToken.staffProfileId, 'sp-cash');
  const mgrVerify = await svc.verifyPin('biz-1', 'sp-mgr', '2222');
  const binding2 = svc.bindOperator(mgrVerify.profile);
  assert.strictEqual(svc.getBindingForBusiness('biz-1').staffProfileId, 'sp-mgr');
  assert.strictEqual(svc.getBindingByToken(binding.operatorToken), null, 'old token must die on rebind');
  svc.clearBinding('biz-1');
  assert.strictEqual(svc.getBindingForBusiness('biz-1'), null);

  // Lockout: 5 consecutive failures lock the profile.
  for (let i = 0; i < 5; i++) {
    const f = await svc.verifyPin('biz-1', 'sp-owner', '9999');
    assert.strictEqual(f.reason, 'PIN_MISMATCH');
  }
  const locked = await svc.verifyPin('biz-1', 'sp-owner', '1111');
  assert.strictEqual(locked.reason, 'PIN_LOCKED', 'even the correct PIN is refused during lockout');

  // Override grants: privileged only at the route layer; here the
  // grant mechanics — single consume, business-scoped, peek no-consume.
  const grantToken = svc.issueOverrideGrant({ staffProfileId: 'sp-mgr', membershipId: 'm-mgr', userId: 'u-mgr', businessId: 'biz-1', role: 'MANAGER', name: 'Manny Manager' });
  assert.ok(typeof grantToken === 'string' && grantToken.length >= 32);
  assert.ok(svc.peekOverrideGrant(grantToken, 'biz-1'));
  assert.strictEqual(svc.peekOverrideGrant(grantToken, 'biz-2'), null, 'grant must be business-scoped');
  const consumed = svc.consumeOverrideGrant(grantToken, 'biz-1');
  assert.strictEqual(consumed.staffProfileId, 'sp-mgr');
  assert.strictEqual(svc.consumeOverrideGrant(grantToken, 'biz-1'), null, 'grant is single-use');

  assert.strictEqual(svc.isPrivilegedRole('manager'), true);
  assert.strictEqual(svc.isPrivilegedRole('CASHIER'), false);

  console.log('operator.service.test: ALL PASS');
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exit(1);
});
