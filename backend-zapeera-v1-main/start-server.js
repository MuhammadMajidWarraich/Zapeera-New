#!/usr/bin/env node
/**
 * Startup script that sets DATABASE_URL before starting the server
 *
 * DUAL MODE:
 * - Default: SQLite (for Electron/offline)
 * - USE_POSTGRESQL=true: PostgreSQL (for website)
 */

const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn } = require('child_process');
// Load environment variables
// Priority: .env.production (if NODE_ENV=production and file exists) → .env (always as fallback)
if (process.env.NODE_ENV === 'production' && fs.existsSync('.env.production')) {
  require('dotenv').config({ path: '.env.production' });
  console.log('[Startup] 📁 Loaded .env.production');
}
// Always load .env as base/fallback (won't override existing vars)
require('dotenv').config({ override: false });

// Check mode - auto-detect if DATABASE_URL is already a postgres URL
const isExistingPostgresUrl = (process.env.DATABASE_URL || '').startsWith('postgresql://') || (process.env.DATABASE_URL || '').startsWith('postgres://');
const usePostgreSQL = process.env.USE_POSTGRESQL === 'true' || isExistingPostgresUrl;

// PostgreSQL URL - use DATABASE_URL if already postgres, otherwise check other env vars
const postgresUrl = isExistingPostgresUrl
  ? process.env.DATABASE_URL
  : (process.env.REMOTE_DATABASE_URL || process.env.POSTGRESQL_URL);

if (!postgresUrl && !isExistingPostgresUrl) {
  console.error('[Startup] ❌ ERROR: No PostgreSQL URL found. Set DATABASE_URL, REMOTE_DATABASE_URL, or POSTGRESQL_URL.');
  process.exit(1);
}

// SQLite URL
const sqlitePath = path.join(os.homedir(), '.zapeera', 'data', 'zapeera.db');
const sqliteDir = path.dirname(sqlitePath);
const sqliteUrl = `file:${sqlitePath}`;

// Ensure SQLite directory exists
if (!fs.existsSync(sqliteDir)) {
  try {
    fs.mkdirSync(sqliteDir, { recursive: true });
  } catch (err) {}
}

// Set DATABASE_URL based on mode
let databaseUrl;
if (usePostgreSQL) {
  console.log('[Startup] 🌐 WEBSITE MODE - Using PostgreSQL');
  databaseUrl = postgresUrl;
} else {
  console.log('[Startup] 💻 ELECTRON MODE - Using SQLite');
  databaseUrl = sqliteUrl;
}

process.env.DATABASE_URL = databaseUrl;
process.env.REMOTE_DATABASE_URL = postgresUrl;

console.log('[Startup] ✅ DATABASE_URL set');

// Get the script to run (dev or start)
const script = process.argv[2] || 'start';
const isDev = script === 'dev';

// Determine the command to run
let command;
let args;

if (isDev) {
  command = 'npx';
  args = ['ts-node-dev', '--respawn', '--transpile-only', 'src/server.ts'];
} else {
  command = 'node';
  args = ['dist/server.js'];
}

// Spawn the process
const child = spawn(command, args, {
  stdio: 'inherit',
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
    REMOTE_DATABASE_URL: postgresUrl
  },
  shell: true
});

child.on('error', (error) => {
  console.error('[Startup] ❌ Failed to start server:', error);
  process.exit(1);
});

child.on('exit', (code) => {
  process.exit(code || 0);
});
