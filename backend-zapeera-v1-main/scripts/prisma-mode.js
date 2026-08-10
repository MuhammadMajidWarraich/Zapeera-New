#!/usr/bin/env node
/**
 * Mode-aware Prisma CLI wrapper.
 *
 * Runs any `prisma` subcommand (generate, db push, migrate deploy, migrate dev,
 * studio, validate, ...) against the schema of the SELECTED database mode:
 *   prisma/schema.sqlite.prisma       or
 *   prisma/schema.postgresql.prisma
 *
 * Usage:
 *   node scripts/prisma-mode.js db push
 *   node scripts/prisma-mode.js migrate deploy
 *   node scripts/prisma-mode.js studio
 *   node scripts/prisma-mode.js validate
 *
 * Never prints DATABASE_URL.
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const os = require('os');
const { resolveModeFromEnv, modeLabel } = require('./db-mode');

const ROOT = path.join(__dirname, '..');
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

// npm does not load .env — do it here so mode detection matches the server.
require('dotenv').config({ override: false });

function sqliteDatabaseUrl() {
  const sqlitePath = path.join(os.homedir(), '.zapeera', 'data', 'zapeera.db');
  return sqlitePath.startsWith('file:') ? sqlitePath : 'file:' + sqlitePath;
}

function databaseUrlFor(mode) {
  if (mode === 'sqlite') {
    return sqliteDatabaseUrl();
  }
  const env = process.env;
  const existing = [env.DATABASE_URL, env.REMOTE_DATABASE_URL, env.POSTGRESQL_URL].find((url) =>
    String(url || '').startsWith('postgres')
  );
  if (existing) {
    return existing;
  }
  console.error('[Prisma Mode] ❌ PostgreSQL mode requires a PostgreSQL URL.');
  console.error('[Prisma Mode]    Set DATABASE_URL or REMOTE_DATABASE_URL (postgresql://...) before running this command.');
  process.exit(1);
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('Usage: node scripts/prisma-mode.js <prisma subcommand...> (e.g. db push, migrate deploy, studio, validate)');
    process.exit(1);
  }

  const mode = resolveModeFromEnv(process.env);
  const schemaFile = `prisma/schema.${mode}.prisma`;
  const schemaPath = path.join(ROOT, schemaFile);
  if (!require('fs').existsSync(schemaPath)) {
    console.error(`[Prisma Mode] ❌ Schema file not found: ${schemaFile}`);
    process.exit(1);
  }

  const subcommand = args.join(' ');
  console.log(`[Prisma Mode] 🚀 prisma ${subcommand} --schema ${schemaFile} (${modeLabel(mode)})`);

  if (args[0] === 'migrate' && mode === 'sqlite') {
    console.error('[Prisma Mode] ❌ Migrations are managed for PostgreSQL (prisma/migrations).');
    console.error('[Prisma Mode]    For SQLite use: node scripts/prisma-mode.js db push');
    process.exit(1);
  }

  try {
    execFileSync(
      NPX,
      ['prisma', ...args, '--schema', schemaFile],
      {
        cwd: ROOT,
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, DATABASE_URL: databaseUrlFor(mode) },
      }
    );
  } catch (error) {
    process.exit(error.status || 1);
  }
}

main();
