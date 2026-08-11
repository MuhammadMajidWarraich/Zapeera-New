#!/usr/bin/env node
/**
 * Initialize the SQLite (Electron/desktop) database.
 *
 * Steps:
 *   1. Generate the Prisma client from prisma/schema.sqlite.prisma (deterministic)
 *   2. Ensure the SQLite data directory exists
 *   3. `prisma db push` against the desktop database to create missing tables
 *
 * PRESERVES DATA: `db push` NEVER passes the destructive data-loss flag, so
 * it can never drop tables, indexes, or rows to force a schema change. If a
 * schema conflict is found it logs a warning and continues with the existing
 * database instead of wiping it. Resolving a destructive conflict is a
 * deliberate, manual action with an explicit warning (see the log output).
 *
 * Test mode (NODE_ENV=test / TEST_MODE=true) only generates the client — it
 * never touches the desktop database.
 *
 * Usage: node scripts/init-sqlite-db.js
 */

'use strict';

const { execFileSync, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCHEMA_FILE = 'prisma/schema.sqlite.prisma';
const isTestMode = process.env.NODE_ENV === 'test' || process.env.TEST_MODE === 'true';

// npm does not load .env — do it here (SQLite mode is explicit for this script).
require('dotenv').config({ override: false });

const sqlitePath = path.join(os.homedir(), '.zapeera', 'data', 'zapeera.db');
const sqliteDir = path.dirname(sqlitePath);
const sqliteUrl = sqlitePath.startsWith('file:') ? sqlitePath : 'file:' + sqlitePath;

function run(cmd, args, opts) {
  try {
    execSync([cmd, ...args].join(' '), { ...opts, stdio: 'inherit', shell: true });
  } catch (error) {
    const msg = error.message || error.toString();
    return { failed: true, message: msg };
  }
  return { failed: false };
}

function main() {
  // Step 1: deterministic client generation (never mutates a shared schema)
  try {
    execFileSync(process.execPath, [path.join(__dirname, 'generate-client.js'), 'sqlite'], {
      cwd: ROOT,
      stdio: 'inherit',
      env: process.env,
    });
  } catch (error) {
    process.exit(error.status || 1);
  }

  if (isTestMode) {
    console.log('[Init SQLite] ✅ Test mode — client generated; skipping desktop database push');
    return;
  }

  // Step 2: data directory
  if (!fs.existsSync(sqliteDir)) {
    fs.mkdirSync(sqliteDir, { recursive: true });
    console.log(`[Init SQLite] 📁 Created data directory: ${sqliteDir}`);
  }

  // Step 3: create tables (idempotent, non-destructive)
  // The push NEVER passes the destructive data-loss flag: without it, `db push`
  // fails on destructive schema changes instead of applying them, so existing
  // user data is never dropped automatically. Fresh installs create all tables
  // normally.
  console.log(`[Init SQLite] 🔄 Initializing database: ${sqlitePath}`);
  const result = run('npx', ['prisma', 'db', 'push', '--schema', SCHEMA_FILE], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: sqliteUrl },
  });

  if (result.failed) {
    // PRESERVE DATA: never auto-wipe an existing database on schema conflict.
    const msg = result.message;
    if (
      msg.includes('index associated with UNIQUE or PRIMARY KEY constraint cannot be dropped') ||
      msg.includes('UNIQUE constraint failed') ||
      msg.includes('cannot drop')
    ) {
      console.log('[Init SQLite] ⚠️  Schema conflict detected — SKIPPING destructive changes to preserve data.');
      console.log('[Init SQLite] ⚠️  To resolve it manually, back up the database first, then run:');
      console.log('[Init SQLite] ⚠️  npx prisma db push --schema prisma/schema.sqlite.prisma');
      console.log('[Init SQLite] ⚠️  (add the destructive data-loss flag only if you confirm the change is safe).');
    } else {
      console.error(`[Init SQLite] ⚠️  Error initializing database: ${msg}`);
    }
    // Continue startup with the existing database.
  } else {
    console.log('[Init SQLite] ✅ Database ready');
  }
}

main();
