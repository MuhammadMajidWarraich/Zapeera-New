/**
 * Standalone test for services/license/license-gate.js and
 * license-client.js (shadow mode, plan mapping, stale-token guard).
 * Run:  node electron/services/license/license-gate.test.js
 * Uses THROWAWAY Ed25519 keypairs generated in-memory (never a real key).
 * Exits non-zero on the first failed assertion.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const license = require('./license.service');
const gate = require('./license-gate');
const client = require('./license-client');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

function issue(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const sig = crypto.sign(null, body, privPem);
  return `${license._base64urlEncode(body)}.${license._base64urlEncode(sig)}`;
}

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapeera-license-gate-test-'));
const now = Date.now();
const base = {
  licenseId: 'lic-gate-1',
  accountId: 'acc-1',
  businessIds: ['biz-1'],
  planId: 'single-growth',
  status: 'ACTIVE',
  issuedAt: now,
  serverTime: now,
  expiresAt: now + 30 * 24 * 3600 * 1000,
  deviceId: 'DEV-AAA',
  installId: 'INST-1'
};
const common = { publicKeyPem: pubPem, stateDir, deviceId: 'DEV-AAA', installId: 'INST-1' };

// 1. Shadow mode is ON: the gate returns the LEGACY verdict even when
// the license denies, and records the mismatch.
assert.strictEqual(gate.SHADOW_MODE, true, 'this release must ship in shadow mode');
gate.resetShadowStats();
const expiredToken = issue({ ...base, expiresAt: now - 10 * 24 * 3600 * 1000 });
let hookEvents = [];
gate.setMismatchHook((event) => hookEvents.push(event));
let check = gate.checkEntitlement({ token: expiredToken, legacyEntitled: true, legacyPlanId: 'single-growth', businessId: 'biz-1', ...common });
assert.strictEqual(check.mode, 'shadow', 'mode must be shadow');
assert.strictEqual(check.entitled, true, 'shadow mode must return the legacy verdict');
assert.strictEqual(check.licenseEntitled, false, 'license verdict must still be computed');
assert.strictEqual(check.mismatch, true, 'license-deny vs legacy-entitle is a mismatch');
assert.strictEqual(hookEvents.length, 1, 'mismatch hook must fire exactly once');
assert.strictEqual(hookEvents[0].licenseReason, 'expired');
assert.strictEqual(gate.getShadowStats().mismatches, 1, 'mismatch counter must record it');
assert.strictEqual(gate.getShadowStats().licenseDeniedLegacyEntitled, 1);

// 2. Shadow mode: agreement logs no mismatch, and the license plan is
// reported alongside the legacy plan.
hookEvents = [];
check = gate.checkEntitlement({ token: issue(base), legacyEntitled: true, legacyPlanId: 'single-growth', businessId: 'biz-1', ...common });
assert.strictEqual(check.entitled, true);
assert.strictEqual(check.mismatch, false);
assert.strictEqual(check.licensePlanId, 'single-growth');
assert.strictEqual(hookEvents.length, 0, 'no hook on agreement');
assert.strictEqual(gate.getShadowStats().mismatches, 1, 'counter unchanged on agreement');

// 3. Shadow write gate: a write that enforcement would block is still
// ALLOWED in shadow mode (log only).
const deniedCheck = gate.checkEntitlement({ token: expiredToken, legacyEntitled: true, legacyPlanId: 'single-growth', businessId: 'biz-1', ...common });
for (const action of gate.BLOCKED_WRITE_ACTIONS) {
  const g = gate.gateWrite(action, deniedCheck);
  assert.strictEqual(g.allowed, true, `${action} must be allowed in shadow mode`);
  assert.strictEqual(g.reason, 'shadow-mode');
}

// 4. Plan → limits mapping is driven by the LICENSE planId; an unknown
// license plan maps to null limits, never to a silent default.
let resolved = gate.resolvePlanLimits(check, 'single-starter');
assert.strictEqual(resolved.planId, 'single-growth', 'license plan wins over legacy plan');
assert.strictEqual(resolved.limits.maxBranches, 3, 'growth plan allows 3 branches');
assert.strictEqual(resolved.plan.name, 'Growth');
const unknownPlanCheck = gate.checkEntitlement({
  token: issue({ ...base, planId: 'single-mythical' }),
  legacyEntitled: true, legacyPlanId: 'single-growth', businessId: 'biz-1', ...common
});
resolved = gate.resolvePlanLimits(unknownPlanCheck, 'single-growth');
assert.strictEqual(resolved.plan, null, 'unknown license plan must not map to a plan');
assert.strictEqual(resolved.limits.maxBranches, null, 'unknown license plan must map to null limits');

// 5. Configured with the real embedded key: a token signed by any
// OTHER keypair fails verification, the license verdict is "denied",
// and the legacy verdict still decides in shadow mode (both deny here,
// so no mismatch is counted).
check = gate.checkEntitlement({ token: issue(base), legacyEntitled: false, legacyPlanId: null, businessId: 'biz-1', stateDir, deviceId: 'DEV-AAA', installId: 'INST-1' });
assert.strictEqual(check.entitled, false, 'legacy denied must stay denied');
assert.strictEqual(check.licenseEntitled, false, 'foreign-key token must not entitle');
assert.strictEqual(check.licenseReason, 'bad-signature-or-format');
assert.strictEqual(check.mismatch, false, 'both-deny is not a mismatch');

// 5b. Enforce-path write gating (via a fabricated enforce check —
 // SHADOW_MODE itself stays true): a denied license blocks the listed
 // writes under READ_ONLY_EXPORT_ONLY, allows reads/exports, and
 // under FULL_LOCK blocks everything except read/export/backup.
const enforceDenied = { mode: 'enforce', entitled: false, licenseReason: 'expired', hardExpiryMode: 'READ_ONLY_EXPORT_ONLY' };
for (const action of gate.BLOCKED_WRITE_ACTIONS) {
  assert.strictEqual(gate.gateWrite(action, enforceDenied).allowed, false, `${action} must block under enforcement`);
}
assert.strictEqual(gate.gateWrite('read', enforceDenied).allowed, true, 'reads stay allowed under read-only');
assert.strictEqual(gate.gateWrite('export', enforceDenied).allowed, true, 'exports stay allowed under read-only');
const fullLock = { mode: 'enforce', entitled: false, licenseReason: 'expired', hardExpiryMode: 'FULL_LOCK' };
assert.strictEqual(gate.gateWrite('sale.create', fullLock).allowed, false, 'full lock blocks writes');
assert.strictEqual(gate.gateWrite('export', fullLock).allowed, true, 'full lock still allows export');

// 6. Stale-plan-after-downgrade guard (license-client): storing an
// OLDER token after a newer one is ignored, so a stale higher plan
// can never re-assert itself. Uses a fake in-memory settings table.
const store = new Map();
client.init({
  query: (sql, params) => {
    if (sql.includes('SELECT value FROM settings')) {
      const v = store.get(params[0]);
      return v === undefined ? [] : [{ value: v }];
    }
    if (sql.includes('SELECT id FROM settings')) {
      return store.has(params[0]) ? [{ id: 'x' }] : [];
    }
    return [];
  },
  run: (sql, params) => {
    if (sql.includes('UPDATE settings SET value')) { store.set(params[2], params[0]); return true; }
    if (sql.includes('INSERT INTO settings')) { store.set(params[1], params[2]); return true; }
    return true;
  },
  saveDatabase: () => {},
  uuid: () => `test-${Math.random()}`
});
const newer = issue({ ...base, issuedAt: now, planId: 'single-starter' });
const older = issue({ ...base, issuedAt: now - 24 * 3600 * 1000, planId: 'single-scale' });
let r = client.storeToken(newer, { publicKeyPem: pubPem });
assert.strictEqual(r.stored, true, 'newer token must store');
assert.strictEqual(client.getStoredMeta().planId, 'single-starter');
r = client.storeToken(older, { publicKeyPem: pubPem });
assert.strictEqual(r.stored, false, 'older token must be ignored');
assert.strictEqual(r.reason, 'stale-token-ignored');
assert.strictEqual(client.getStoredMeta().planId, 'single-starter', 'stored plan must stay the newer one');
// A forged token is rejected while a key is configured.
const forged = issue({ ...base, planId: 'single-scale' }).slice(0, -4) + 'AAAA';
r = client.storeToken(forged, { publicKeyPem: pubPem });
assert.strictEqual(r.stored, false, 'bad-signature token must be rejected');
assert.strictEqual(r.reason, 'bad-signature-or-format');
// acquireFromProvision picks the token out of the provision payload.
r = client.acquireFromProvision({ licenseToken: issue({ ...base, issuedAt: now + 1000, planId: 'single-growth' }) }, { publicKeyPem: pubPem });
assert.strictEqual(r.stored, true, 'provision token must store');
assert.strictEqual(client.getStoredMeta().planId, 'single-growth');
// refreshFromCloud fails soft when the server endpoint is absent.
(async () => {
  const failingApi = { getAuthToken: () => 'tok', makeRequest: async () => { const e = new Error('HTTP 404'); e.statusCode = 404; throw e; } };
  const rr = await client.refreshFromCloud(failingApi);
  assert.strictEqual(rr.refreshed, false, 'failed refresh must not throw or clear the token');
  assert.strictEqual(client.getStoredToken() !== null, true, 'stored token must survive a failed refresh');
  console.log('license-gate.test.js: ALL 7 CHECKS PASSED');
  fs.rmSync(stateDir, { recursive: true, force: true });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
