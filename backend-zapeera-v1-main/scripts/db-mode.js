#!/usr/bin/env node
/**
 * Database mode resolution for Node scripts (CommonJS mirror of
 * src/config/database-mode.ts). Used by scripts that must select the Prisma
 * schema before TypeScript is available.
 *
 * Kept in sync with database-mode.ts — tests/database-mode.test.ts verifies
 * both implementations agree for the same environment matrix.
 */

'use strict';

function isPostgresUrl(url) {
  const value = String(url || '');
  return value.startsWith('postgresql://') || value.startsWith('postgres://');
}

function resolveModeFromEnv(env) {
  const e = env || process.env;
  if (isPostgresUrl(e.DATABASE_URL)) {
    return 'postgresql';
  }
  // An explicitly-set DATABASE_URL (e.g. file:) is authoritative for SQLite.
  if (e.DATABASE_URL) {
    return 'sqlite';
  }
  if (String(e.USE_POSTGRESQL).toLowerCase() === 'true') {
    return 'postgresql';
  }
  if (String(e.USE_POSTGRESQL).toLowerCase() === 'false') {
    return 'sqlite';
  }
  if (isPostgresUrl(e.REMOTE_DATABASE_URL) || isPostgresUrl(e.POSTGRESQL_URL)) {
    return 'postgresql';
  }
  return 'sqlite';
}

function modeLabel(mode) {
  return mode === 'postgresql' ? 'PostgreSQL (Web)' : 'SQLite (Electron)';
}

module.exports = { resolveModeFromEnv, isPostgresUrl, modeLabel };

if (require.main === module) {
  const mode = resolveModeFromEnv(process.env);
  console.log(modeLabel(mode));
  console.log(mode);
}
