/**
 * Standalone test for services/license/license.service.js
 * Run:  node electron/services/license/license.service.test.js
 * Uses a THROWAWAY Ed25519 keypair generated in-memory (never a real key).
 * Exits non-zero on the first failed assertion.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const license = require('./license.service');

const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });

function issue(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const sig = crypto.sign(null, body, privPem);
  return `${license._base64urlEncode(body)}.${license._base64urlEncode(sig)}`;
}

const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapeera-license-test-'));
const now = Date.now();
const base = {
  licenseId: 'lic-test-1',
  accountId: 'acc-1',
  businessIds: ['biz-1'],
  planId: 'single-growth',
  status: 'ACTIVE',
  issuedAt: now,
  serverTime: now,
  expiresAt: now + 7 * 24 * 3600 * 1000
};

// 1. Configured (real public key pasted 2026-10-28): the embedded key
// parses as Ed25519, and a token signed by any OTHER keypair fails
// verification against it.
assert.strictEqual(license.evaluate(issue(base)).configured, true, 'public key must be configured');
const embeddedKey = crypto.createPublicKey(license.LICENSE_PUBLIC_KEY_PEM);
assert.strictEqual(embeddedKey.asymmetricKeyType, 'ed25519', 'embedded key must be Ed25519');
assert.strictEqual(license.evaluate(issue(base), { stateDir }).valid, false, 'token from another keypair must fail verification');

// 2. Valid token verifies and entitles.
let r = license.evaluate(issue(base), { publicKeyPem: pubPem, stateDir });
assert.strictEqual(r.valid, true, 'valid token must verify');
assert.strictEqual(r.entitled, true, 'ACTIVE + unexpired must entitle');

// 3. Tampered payload is rejected (the local-DB-edit forgery case).
const good = issue(base);
const [bodySeg, sigSeg] = good.split('.');
const forgedPayload = JSON.parse(license._base64urlDecode(bodySeg).toString('utf8'));
forgedPayload.planId = 'single-scale';
forgedPayload.expiresAt = now + 365 * 24 * 3600 * 1000;
const forged = `${license._base64urlEncode(Buffer.from(JSON.stringify(forgedPayload)))}.${sigSeg}`;
r = license.evaluate(forged, { publicKeyPem: pubPem, stateDir });
assert.strictEqual(r.valid, false, 'tampered payload must fail signature verification');

// 4. Expired token: signature valid, entitlement denied. Grace is 3
// days, so "expired" for this check means past expiresAt + grace.
r = license.evaluate(issue({ ...base, expiresAt: now - 4 * 24 * 3600 * 1000, serverTime: now }), { publicKeyPem: pubPem, stateDir });
assert.strictEqual(r.valid, true);
assert.strictEqual(r.entitled, false);
assert.strictEqual(r.reason, 'expired');

// 5. Suspended status denies entitlement.
r = license.evaluate(issue({ ...base, status: 'SUSPENDED' }), { publicKeyPem: pubPem, stateDir });
assert.strictEqual(r.entitled, false);
assert.strictEqual(r.reason, 'status-suspended');

// 6. Device binding enforced when the token carries a deviceId.
const bound = issue({ ...base, deviceId: 'DEV-AAA' });
assert.strictEqual(license.evaluate(bound, { publicKeyPem: pubPem, stateDir, deviceId: 'DEV-AAA' }).entitled, true);
assert.strictEqual(license.evaluate(bound, { publicKeyPem: pubPem, stateDir, deviceId: 'DEV-BBB' }).reason, 'device-mismatch');

// 7. Clock rollback: after seeing serverTime T, an "expired at T-4d"
// token stays expired even if the wall clock is wound back before T-4d.
const T = now + 30 * 24 * 3600 * 1000; // a future server time we "see" once
license.recordServerTime(T, stateDir);
assert.ok(license.effectiveNow(stateDir) >= T, 'effectiveNow must never go behind last seen server time');
const wouldBeValidIfClockRolledBack = issue({ ...base, serverTime: T, expiresAt: T - 4 * 24 * 3600 * 1000 });
r = license.evaluate(wouldBeValidIfClockRolledBack, { publicKeyPem: pubPem, stateDir });
assert.strictEqual(r.reason, 'expired', 'rollback must not resurrect an expired license');

// 8. Monotonic record never moves backwards.
assert.strictEqual(license.recordServerTime(T - 5000, stateDir), T, 'recordServerTime must be monotonic');

// --- New checks (2026-10-28): grace, fail-closed binding, issuance
// cap, key rotation. These run in a FRESH state dir: check 7 anchored
// the shared dir 30 days in the future, which would make every
// normally-dated token read as expired there.
const stateDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'zapeera-license-test2-'));
const now2 = Date.now();
const base2 = { ...base, issuedAt: now2, serverTime: now2, expiresAt: now2 + 7 * 24 * 3600 * 1000 };

// 9. Grace days (GRACE_DAYS = 3): expired 2 days ago still entitles
// (inGrace), expired 4 days ago does not.
r = license.evaluate(issue({ ...base2, expiresAt: now2 - 2 * 24 * 3600 * 1000 }), { publicKeyPem: pubPem, stateDir: stateDir2 });
assert.strictEqual(r.entitled, true, 'within 3-day grace must still entitle');
assert.strictEqual(r.inGrace, true, 'inGrace must be true inside the grace window');
assert.strictEqual(r.graceDays, 3, 'GRACE_DAYS must be 3');
r = license.evaluate(issue({ ...base2, expiresAt: now2 - 4 * 24 * 3600 * 1000 }), { publicKeyPem: pubPem, stateDir: stateDir2 });
assert.strictEqual(r.entitled, false, 'past 3-day grace must deny');
assert.strictEqual(r.reason, 'expired');

// 10. Fail-closed binding (enforceBinding): a token WITHOUT device /
// install claims denies when the caller passes its own ids; a token
// bound to another device denies; a matching token entitles.
const boundOpts = { publicKeyPem: pubPem, stateDir: stateDir2, deviceId: 'DEV-AAA', installId: 'INST-1', enforceBinding: true };
r = license.evaluate(issue(base2), boundOpts);
assert.strictEqual(r.entitled, false, 'unbound token must deny under fail-closed binding');
assert.strictEqual(r.reason, 'missing-device-claim');
r = license.evaluate(issue({ ...base2, deviceId: 'DEV-BBB', installId: 'INST-1' }), boundOpts);
assert.strictEqual(r.entitled, false, 'other-device token must deny');
assert.strictEqual(r.reason, 'device-mismatch');
r = license.evaluate(issue({ ...base2, deviceId: 'DEV-AAA', installId: 'INST-1' }), boundOpts);
assert.strictEqual(r.entitled, true, 'matching device + install must entitle');
// ... and without enforceBinding the same gap only warns, never denies.
r = license.evaluate(issue(base2), { publicKeyPem: pubPem, stateDir: stateDir2, deviceId: 'DEV-AAA', installId: 'INST-1' });
assert.strictEqual(r.entitled, true, 'without enforceBinding a missing claim warns only');
assert.ok(r.warnings.includes('missing-device-claim'), 'missing claim must be reported in warnings');

// 11. Issuance lifetime cap (40 days): expiresAt > issuedAt + 40d is
// rejected; a token without issuedAt is rejected too.
r = license.evaluate(issue({ ...base2, expiresAt: now2 + 41 * 24 * 3600 * 1000 }), { publicKeyPem: pubPem, stateDir: stateDir2 });
assert.strictEqual(r.entitled, false, 'far-future expiry must deny');
assert.strictEqual(r.reason, 'token-lifetime-exceeded');
const { issuedAt: _dropped, ...noIssuedAt } = base2;
r = license.evaluate(issue(noIssuedAt), { publicKeyPem: pubPem, stateDir: stateDir2 });
assert.strictEqual(r.entitled, false, 'token without issuedAt must deny');
assert.strictEqual(r.reason, 'missing-issued-at');

// 12. Business coverage: the token must cover the requested business.
r = license.evaluate(issue({ ...base2, businessIds: ['biz-1'] }), { publicKeyPem: pubPem, stateDir: stateDir2, businessId: 'biz-2' });
assert.strictEqual(r.entitled, false, 'token for another business must deny');
assert.strictEqual(r.reason, 'business-not-covered');
r = license.evaluate(issue({ ...base2, businessIds: ['biz-1'] }), { publicKeyPem: pubPem, stateDir: stateDir2, businessId: 'biz-1' });
assert.strictEqual(r.entitled, true, 'token covering the business must entitle');

// 13. Key rotation: a token with kid 'key-2' verifies against the
// rotated key (publicKeys override); an unknown kid fails closed.
const { publicKey: pub2, privateKey: priv2 } = crypto.generateKeyPairSync('ed25519');
const pubPem2 = pub2.export({ type: 'spki', format: 'pem' });
const privPem2 = priv2.export({ type: 'pkcs8', format: 'pem' });
function issueWithKey(payload, priv) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const sig = crypto.sign(null, body, priv);
  return `${license._base64urlEncode(body)}.${license._base64urlEncode(sig)}`;
}
const rotated = issueWithKey({ ...base2, kid: 'key-2' }, privPem2);
r = license.evaluate(rotated, { publicKeyPem: pubPem, stateDir: stateDir2, publicKeys: { 'key-2': pubPem2 } });
assert.strictEqual(r.entitled, true, 'rotated key must verify when its kid is known');
r = license.evaluate(rotated, { publicKeyPem: pubPem, stateDir: stateDir2 });
assert.strictEqual(r.valid, false, 'rotated token without the rotated key must fail');
const unknownKid = issueWithKey({ ...base2, kid: 'key-99' }, privPem2);
r = license.evaluate(unknownKid, { publicKeyPem: pubPem, stateDir: stateDir2, publicKeys: { 'key-2': pubPem2 } });
assert.strictEqual(r.valid, false, 'unknown kid must fail closed');

// 14. Hard-expiry policy constant: read-only/export-only, never full lock
// by default.
assert.strictEqual(license.HARD_EXPIRY_MODE, 'READ_ONLY_EXPORT_ONLY', 'hard-expiry default must be read-only/export-only');

fs.rmSync(stateDir, { recursive: true, force: true });
fs.rmSync(stateDir2, { recursive: true, force: true });
console.log('license.service.test.js: ALL 14 CHECKS PASSED');
