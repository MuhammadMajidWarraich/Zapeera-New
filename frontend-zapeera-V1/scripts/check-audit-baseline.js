/**
 * Baseline-aware `npm audit` gate for CI.
 *
 * The production web bundle must stay free of high/critical advisories, but
 * DESKTOP/BUILD tooling (electron, electron-builder, vite) ships advisories
 * that can only be cleared with blind major upgrades the CI cannot validate.
 * This gate fails when a HIGH or CRITICAL advisory appears that is NOT already
 * recorded in `audit-baseline.json` — and also when an allowlisted advisory
 * escalates in severity. Anything else (moderate/low) never blocks the deploy.
 *
 * Usage:
 *   node scripts/check-audit-baseline.js            # CI gate (fail on new)
 *   node scripts/check-audit-baseline.js --update   # regenerate the baseline
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const BASELINE_FILE = path.join(__dirname, 'audit-baseline.json');
const updateMode = process.argv.includes('--update');

const SEVERITY_ORDER = ['low', 'moderate', 'high', 'critical'];
const FAIL_SEVERITIES = new Set(['high', 'critical']);

function runAudit() {
  const result = spawnSync(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['audit', '--json'],
    {
      cwd: path.join(__dirname, '..'),
      encoding: 'utf8',
      timeout: 120000,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  if (result.error) {
    throw new Error(`failed to spawn npm audit: ${result.error.message}`);
  }
  let data;
  try {
    data = JSON.parse(result.stdout);
  } catch {
    throw new Error(`npm audit returned non-JSON output: ${String(result.stdout || result.stderr).slice(0, 400)}`);
  }
  if (data.error) {
    throw new Error(`npm audit failed: ${data.error.summary || JSON.stringify(data.error)}`);
  }
  return (data.vulnerabilities || {});
}

/**
 * Collect failing (name, advisoryUrl) pairs with advisory severity.
 * Only advisories rated high/critical are included — they match what
 * `npm audit --audit-level=high` would fail on.
 */
function collectFailingAdvisories(vulnerabilities) {
  const result = [];
  for (const [name, info] of Object.entries(vulnerabilities)) {
    for (const via of info.via || []) {
      if (typeof via === 'string') continue;
      if (!via.url || !via.severity) continue;
      if (!FAIL_SEVERITIES.has(via.severity)) continue;
      result.push({ name, url: via.url, severity: via.severity });
    }
  }
  return result;
}

function loadBaseline() {
  try {
    const data = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
    const map = new Map();
    for (const entry of data.advisories || []) {
      map.set(`${entry.name}|${entry.url}`, entry.severity);
    }
    return { raw: data, map };
  } catch {
    return { raw: null, map: new Map() };
  }
}

const vulnerabilities = runAudit();
const advisories = collectFailingAdvisories(vulnerabilities);
advisories.sort((a, b) => a.name.localeCompare(b.name) || a.url.localeCompare(b.url));

if (updateMode) {
  const payload = {
    generated: new Date().toISOString(),
    advisories: advisories.map((a) => ({ name: a.name, url: a.url, severity: a.severity })),
  };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(payload, null, 2) + '\n');
  console.log(`[Audit Gate] ✅ Baseline written: ${advisories.length} allowlisted high/critical advisories (${BASELINE_FILE})`);
  process.exit(0);
}

const baseline = loadBaseline();
if (baseline.raw === null) {
  console.error(`[Audit Gate] ❌ Cannot read baseline ${BASELINE_FILE}. Run "node scripts/check-audit-baseline.js --update" first.`);
  process.exit(1);
}

const baselineSeverityIndex = (entry) => SEVERITY_ORDER.indexOf(baseline.map.get(`${entry.name}|${entry.url}`) || 'low');

const newAdvisories = advisories.filter((a) => !baseline.map.has(`${a.name}|${a.url}`));
const escalated = advisories.filter((a) => {
  if (!baseline.map.has(`${a.name}|${a.url}`)) return false;
  return SEVERITY_ORDER.indexOf(a.severity) > baselineSeverityIndex(a);
});

if (newAdvisories.length > 0 || escalated.length > 0) {
  if (newAdvisories.length > 0) {
    console.error(`[Audit Gate] ❌ ${newAdvisories.length} NEW high/critical advisory/advisories (not in baseline):`);
    for (const a of newAdvisories) console.error(`   ${a.name} [${a.severity}] ${a.url}`);
  }
  if (escalated.length > 0) {
    console.error(`[Audit Gate] ❌ ${escalated.length} allowlisted advisory/advisories ESCALATED in severity:`);
    for (const a of escalated) {
      console.error(`   ${a.name} [${a.severity}] ${a.url} (baseline allowed ${baseline.map.get(`${a.name}|${a.url}`)})`);
    }
  }
  console.error('[Audit Gate]   Fix the dependency, or deliberately update the baseline with: node scripts/check-audit-baseline.js --update');
  process.exit(1);
}

const totalFail = advisories.length;
const packagesAffected = new Set(advisories.map((a) => a.name)).size;
console.log(`[Audit Gate] ✅ No NEW high/critical advisories (${totalFail} known allowlisted high/critical advisory/advisories across ${packagesAffected} package(s)).`);
process.exit(0);