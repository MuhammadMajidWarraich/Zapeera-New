/**
 * Baseline-aware ESLint gate for CI (Issue 6).
 *
 * Legacy code quality issues must NOT block deploys, but NEW lint problems
 * must. This script lints the whole project and fails only when it finds
 * problems that are not already recorded in `lint-baseline.json`.
 *
 * Usage:
 *   node scripts/check-lint-baseline.js            # CI gate (fail on new problems)
 *   node scripts/check-lint-baseline.js --write    # regenerate the baseline
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { ESLint } = require('eslint');

const BASELINE_FILE = path.join(__dirname, 'lint-baseline.json');
const writeMode = process.argv.includes('--write');

function problemKey(filePath, msg) {
  const normalized = path.relative(path.resolve(__dirname, '..'), filePath).split(path.sep).join('/');
  return `${normalized}:${msg.line}:${msg.column}:${msg.ruleId || '(parse-error)'}:${msg.severity === 2 ? 'error' : 'warning'}:${msg.message}`;
}

(async () => {
  const eslint = new ESLint();
  const results = await eslint.lintFiles(['.']);

  const problems = [];
  for (const result of results) {
    for (const msg of result.messages) {
      if (msg.fatal || msg.severity >= 1) {
        problems.push(problemKey(result.filePath, msg));
      }
    }
  }
  problems.sort();

  if (writeMode) {
    fs.writeFileSync(BASELINE_FILE, JSON.stringify({ generated: new Date().toISOString(), problems }, null, 2) + '\n');
    console.log(`[Lint Gate] ✅ Baseline written: ${problems.length} known problems (${BASELINE_FILE})`);
    process.exit(0);
  }

  let baseline;
  try {
    baseline = new Set(JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')).problems);
  } catch (e) {
    console.error(`[Lint Gate] ❌ Cannot read baseline ${BASELINE_FILE}. Run "node scripts/check-lint-baseline.js --write" first.`);
    process.exit(1);
  }

  const newProblems = problems.filter((p) => !baseline.has(p));
  const resolvedCount = [...baseline].filter((p) => !problems.includes(p)).length;

  if (newProblems.length > 0) {
    console.error(`[Lint Gate] ❌ ${newProblems.length} NEW lint problem(s) found (not in baseline). Fix them or update the baseline deliberately:`);
    for (const p of newProblems) console.error(`   ${p}`);
    console.error(`[Lint Gate] Known baseline problems: ${problems.length - newProblems.length}. Resolved since baseline: ${resolvedCount}.`);
    process.exit(1);
  }

  console.log(`[Lint Gate] ✅ No new lint problems (${problems.length} known baseline problems; ${resolvedCount} resolved since baseline).`);
  process.exit(0);
})().catch((err) => {
  console.error('[Lint Gate] ❌', err);
  process.exit(1);
});
