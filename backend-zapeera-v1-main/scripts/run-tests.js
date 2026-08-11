#!/usr/bin/env node
/**
 * Deterministic Jest runner.
 *
 * `npm test` must ALWAYS run against an isolated SQLite-generated Prisma
 * client (TEST_MODE / file: DATABASE_URL), regardless of which provider was
 * generated last by web (PostgreSQL) or Electron (SQLite) development.
 *
 * This wrapper:
 *   1. detects the currently generated provider;
 *   2. generates a SQLite client when tests require it (the test schema);
 *   3. runs Jest (passing through all CLI arguments);
 *   4. restores the ORIGINAL provider afterwards — even when Jest fails,
 *      throws, or the process receives an interruption signal.
 *
 * Guarantees:
 *   - `npm test` / `npm run test:coverage` / `npm run test:sync` are
 *     deterministic and always use SQLite test mode.
 *   - Web (PostgreSQL) startup works immediately after any test command.
 *   - Electron (SQLite) startup works immediately after any test command.
 *   - No tracked file is modified (only node_modules/.prisma is regenerated).
 *
 * Usage:
 *   node scripts/run-tests.js [jest args...]
 */

'use strict';

const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const GENERATOR = path.join(__dirname, 'generate-client.js');
const GENERATED_SCHEMA = path.join(ROOT, 'node_modules', '.prisma', 'client', 'schema.prisma');
const SQLITE_MODE = 'sqlite';
const POSTGRESQL_MODE = 'postgresql';

/** Read the datasource provider baked into the generated Prisma client. */
function readGeneratedProvider() {
  if (!fs.existsSync(GENERATED_SCHEMA)) {
    return null;
  }
  const text = fs.readFileSync(GENERATED_SCHEMA, 'utf8');
  const match = text.match(/datasource\s+\w+\s*\{[\s\S]*?provider\s*=\s*"(\w+)"/);
  return match ? match[1].toLowerCase() : null;
}

function generate(mode) {
  execFileSync(process.execPath, [GENERATOR, mode], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  });
}

/**
 * Pure decision helper — exported for unit tests.
 * Returns the provider that must be generated before Jest runs.
 */
function providerForTests(originalProvider) {
  return originalProvider === SQLITE_MODE ? null : SQLITE_MODE;
}

/**
 * Pure decision helper — exported for unit tests.
 * Returns the provider that must be restored after Jest exits, or null when
 * no restore is needed (unchanged, or nothing existed before).
 */
function providerToRestore(originalProvider) {
  if (originalProvider === SQLITE_MODE || originalProvider === POSTGRESQL_MODE) {
    return originalProvider;
  }
  return null;
}

/** Restore the previously active provider; logs but never throws. */
function restoreProvider(originalProvider) {
  const current = readGeneratedProvider();
  const target = providerToRestore(originalProvider);

  if (target === null) {
    if (current !== SQLITE_MODE) {
      console.log(
        `[Test Runner] ℹ️  No previous provider to restore (was: ${originalProvider || 'none'}); leaving the SQLite test client generated.`
      );
    }
    return;
  }

  if (current === target) {
    console.log(`[Test Runner] ✅ Prisma provider unchanged: ${target}`);
    return;
  }

  console.log(`[Test Runner] 🔄 Restoring Prisma provider: ${current} → ${target}`);
  try {
    generate(target);
    console.log(`[Test Runner] ✅ Prisma provider restored to ${target}`);
  } catch (error) {
    console.error(`[Test Runner] ❌ Failed to restore Prisma provider to ${target}: ${error.message}`);
    console.error(`[Test Runner]    Run manually: node scripts/generate-client.js ${target}`);
  }
}

function main() {
  const jestArgs = process.argv.slice(2);
  const originalProvider = readGeneratedProvider();
  const toGenerate = providerForTests(originalProvider);

  if (toGenerate) {
    console.log(
      `[Test Runner] 🔄 Generating SQLite test client (current provider: ${originalProvider || 'none'})`
    );
    try {
      generate(toGenerate);
    } catch (error) {
      console.error(`[Test Runner] ❌ Could not generate SQLite test client: ${error.message}`);
      process.exit(1);
    }
  } else {
    console.log(`[Test Runner] ✅ SQLite test client already active (${originalProvider})`);
  }

  console.log(`[Test Runner] 🚀 Starting Jest with: ${jestArgs.length ? jestArgs.join(' ') : '(default)'}`);

  // Spawn Jest as a child so we can guarantee cleanup on exit AND on signals.
  // NOTE: the local jest CLI is spawned directly with the current Node binary
  // (no shell, no npx.cmd) so Jest args are forwarded verbatim — patterns may
  // contain shell metacharacters like parentheses and pipes.
  const JEST_BIN = path.join(ROOT, 'node_modules', 'jest', 'bin', 'jest.js');
  const child = spawn(process.execPath, [JEST_BIN, ...jestArgs], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });

  let finished = false;
  const finish = (code) => {
    if (finished) return;
    finished = true;
    restoreProvider(originalProvider);
    process.exit(code);
  };

  child.on('error', (error) => {
    console.error(`[Test Runner] ❌ Failed to start Jest: ${error.message}`);
    finish(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      console.error(`[Test Runner] ⚠️  Jest terminated by signal ${signal}`);
      finish(1);
    } else {
      finish(code === null ? 1 : code);
    }
  });

  // Forward interruption signals to Jest; cleanup runs when the child exits.
  const forward = (signal) => {
    if (finished) {
      // Child already gone — finish our own cleanup now.
      finish(1);
      return;
    }
    try {
      child.kill(signal);
    } catch {
      finish(1);
    }
  };
  process.on('SIGINT', () => forward('SIGINT'));
  process.on('SIGTERM', () => forward('SIGTERM'));
  process.on('SIGHUP', () => forward('SIGHUP'));
}

// Keep the script importable by unit tests (providerForTests / providerToRestore).
if (require.main === module) {
  main();
}

module.exports = { providerForTests, providerToRestore, readGeneratedProvider };
