#!/usr/bin/env node
/**
 * Ensure the Prisma provider matches the database selected by the local
 * environment before development starts. This prevents a SQLite-generated
 * client from being launched against a PostgreSQL DATABASE_URL (and vice versa).
 */
const path = require('path');
const { execFileSync } = require('child_process');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const databaseUrl = String(process.env.DATABASE_URL || process.env.REMOTE_DATABASE_URL || '');
const usesPostgres =
  process.env.USE_POSTGRESQL === 'true' ||
  databaseUrl.startsWith('postgresql://') ||
  databaseUrl.startsWith('postgres://');

const scriptName = usesPostgres ? 'ensure-schema-postgresql.js' : 'ensure-schema-sqlite.js';
console.log(`[Schema Check] Environment selects ${usesPostgres ? 'PostgreSQL' : 'SQLite'}; running ${scriptName}`);

execFileSync(process.execPath, [path.join(__dirname, scriptName)], {
  cwd: path.join(__dirname, '..'),
  env: process.env,
  stdio: 'inherit',
});
