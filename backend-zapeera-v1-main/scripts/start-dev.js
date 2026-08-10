#!/usr/bin/env node
/**
 * Deterministic development launcher.
 *
 *   node scripts/start-dev.js web        # PostgreSQL (website / cloud)
 *   node scripts/start-dev.js electron   # SQLite (Electron / offline desktop)
 *   node scripts/start-dev.js auto       # detect from environment
 *
 * - `web`:    generates the PostgreSQL client, then runs ts-node-dev with the
 *             existing environment (DATABASE_URL must be a postgres:// URL).
 * - `electron`: generates the SQLite client, initializes the SQLite database,
 *             then runs ts-node-dev with DATABASE_URL forced to the desktop
 *             SQLite file (override wins over .env because dotenv never
 *             overrides an already-set variable).
 *
 * The selected mode always matches the generated client — the server's startup
 * assertion (src/config/prisma-mode-assert.ts) enforces this as a second line
 * of defense.
 */

'use strict';

const { spawn } = require('child_process');
const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const { resolveModeFromEnv, modeLabel } = require('./db-mode');

// npm does not load .env — do it here so mode detection matches the server.
require('dotenv').config({ override: false });

function modeFromArg() {
  const arg = (process.argv[2] || 'auto').toLowerCase();
  if (arg === 'web' || arg === 'postgres' || arg === 'postgresql') return 'postgresql';
  if (arg === 'electron' || arg === 'sqlite') return 'sqlite';
  if (arg === 'auto') return resolveModeFromEnv(process.env);
  console.error(`[Start Dev] ❌ Unknown mode "${arg}". Use: web | electron | auto`);
  process.exit(1);
}

function sqliteUrl() {
  const p = path.join(os.homedir(), '.zapeera', 'data', 'zapeera.db');
  return p.startsWith('file:') ? p : 'file:' + p;
}

function main() {
  const mode = modeFromArg();
  const env = { ...process.env };

  if (mode === 'sqlite') {
    console.log(`[Start Dev] 💻 Electron mode (SQLite) — preparing client and database...`);
    try {
      execFileSync(process.execPath, [path.join(__dirname, 'init-sqlite-db.js')], {
        cwd: ROOT,
        stdio: 'inherit',
        env,
      });
    } catch (error) {
      process.exit(error.status || 1);
    }
    // Force the desktop SQLite URL: dotenv (override:false) will not overwrite it.
    env.DATABASE_URL = sqliteUrl();
    env.USE_POSTGRESQL = 'false';
  } else {
    console.log(`[Start Dev] 🌐 Web mode (PostgreSQL) — preparing client...`);
    try {
      execFileSync(process.execPath, [path.join(__dirname, 'generate-client.js'), 'postgresql'], {
        cwd: ROOT,
        stdio: 'inherit',
        env,
      });
    } catch (error) {
      process.exit(error.status || 1);
    }
    env.USE_POSTGRESQL = 'true';
  }

  console.log(`[Start Dev] 🚀 Starting server in ${modeLabel(mode)} mode...`);
  const child = spawn('npx', ['ts-node-dev', '--respawn', '--transpile-only', 'src/server.ts'], {
    cwd: ROOT,
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32',
  });

  child.on('error', (error) => {
    console.error('[Start Dev] ❌ Failed to start server:', error.message);
    process.exit(1);
  });
  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

main();
