// v1.0.19.1 — subscription state is CLOUD-AUTHORITATIVE on the desktop:
// the local subscriptions row is a pull-only mirror. Guards proven here:
//  (1) handleDataChange never enqueues a subscription op;
//  (2) a control entity (categories) still enqueues normally;
//  (3) a legacy PENDING subscription op already sitting in the queue is
//      retired terminally by the drain (FAILED, attempts at ceiling) so
//      it is never sent and never revived — while other ops stay queued.
// Boots the real embedded server on a throwaway DB; no cloud involved.
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = 4419;
let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { failed++; console.log(`  FAIL ${name}${extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''}`); }
}

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zapeera-subauth-'));
  const server = require('../embedded-server.js');
  await server.startServer(PORT, dir);
  await new Promise((r) => setTimeout(r, 1200));

  const db = require('./database.service.js');
  const run = (sql, params = []) => db.run(sql, params);
  const query = (sql, params = []) => db.query(sql, params);
  const sync = require('./sync.service.js');

  const nowIso = new Date().toISOString();
  run(`INSERT INTO companies (id, name, businessType, isActive, createdAt, updatedAt) VALUES ('biz-t','T','PHARMACY',1,?,?)`, [nowIso, nowIso]);
  run(`INSERT INTO users (id, email, name, password, createdAt, updatedAt) VALUES ('u-t','t@t.local','T','x',?,?)`, [nowIso, nowIso]);
  run(`INSERT INTO memberships (id, userId, businessId, role, status, createdAt, updatedAt) VALUES ('m-t','u-t','biz-t','OWNER','ACTIVE',?,?)`, [nowIso, nowIso]);

  // (1) + (2): enqueue gating
  sync.handleDataChange('subscriptions', 'UPDATE', { id: 'sub-t', companyId: 'biz-t', plan: 'STARTER', status: 'ACTIVE', periodEnd: '2020-01-01T00:00:00.000Z' });
  sync.handleDataChange('categories', 'CREATE', { id: 'cat-t', companyId: 'biz-t', name: 'ControlCat' });
  await new Promise((r) => setTimeout(r, 300));
  const subOps = query(`SELECT * FROM sync_operations WHERE entityType = 'subscription'`);
  const catOps = query(`SELECT * FROM sync_operations WHERE entityType = 'category'`);
  check('subscription write enqueues NO push op', subOps.length === 0, subOps.length);
  check('control category write DOES enqueue', catOps.length === 1, catOps.length);

  // (3): legacy queued subscription op is retired by the drain
  run(`INSERT INTO sync_operations (id, businessId, entityType, entityId, operation, payload, idempotencyKey, status, attemptCount, createdAt, updatedAt)
       VALUES ('op-legacy-sub','biz-t','subscription','sub-t','UPDATE','{}','legacy-sub-key','PENDING',0,?,?)`, [nowIso, nowIso]);
  await sync.pushChangesToCloud().catch(() => {});
  const retired = query(`SELECT * FROM sync_operations WHERE id = 'op-legacy-sub'`)[0];
  check('legacy subscription op retired FAILED', retired && retired.status === 'FAILED', retired && retired.status);
  check('retired op attempts at ceiling (never revived)', retired && Number(retired.attemptCount) >= 5, retired && retired.attemptCount);
  check('retired op carries the cloud-authoritative reason', retired && /Cloud-authoritative/.test(retired.lastError || ''), retired && retired.lastError);
  const catAfter = query(`SELECT * FROM sync_operations WHERE entityType = 'category'`)[0];
  check('control op untouched by retirement (still queued)', !!catAfter && catAfter.status === 'PENDING', catAfter && catAfter.status);

  console.log(`\nsubscription-cloud-authoritative: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error('ERROR', e); process.exit(1); });
