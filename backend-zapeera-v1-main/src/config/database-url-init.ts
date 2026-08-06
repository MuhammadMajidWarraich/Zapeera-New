/**
 * CRITICAL: This file MUST be CommonJS (not ES6) to ensure it runs synchronously
 * before any ES6 imports execute.
 *
 * SIMPLIFIED: The ONLY job is to ensure DATABASE_URL is valid.
 * If it's already postgresql://, keep it. Otherwise, use SQLite.
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

// Load .env files (won't override vars already set by the hosting platform)
const projectRoot = path.resolve(__dirname, '..', '..');
try {
  const dotenv = require('dotenv');
  const envProductionPath = path.join(projectRoot, '.env.production');
  const envPath = path.join(projectRoot, '.env');
  if (process.env.NODE_ENV === 'production' && fs.existsSync(envProductionPath)) {
    dotenv.config({ path: envProductionPath });
  }
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath, override: false });
  }
} catch (e) {
  // dotenv not available
}

function addConnectionLimits(databaseUrl: string): string {
  try {
    const parsed = new URL(databaseUrl);
    const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
    const limit = isDev ? '15' : '10';
    const timeout = isDev ? '20' : '15';
    if (!parsed.searchParams.has('connection_limit')) {
      parsed.searchParams.set('connection_limit', process.env.PG_CONNECTION_LIMIT || limit);
    }
    if (!parsed.searchParams.has('pool_timeout')) {
      parsed.searchParams.set('pool_timeout', process.env.PG_POOL_TIMEOUT || timeout);
    }
    return parsed.toString();
  } catch {
    return databaseUrl;
  }
}

// Determine the database URL
// Priority: existing postgres URL > REMOTE_DATABASE_URL > POSTGRESQL_URL > SQLite fallback
const currentUrl = process.env.DATABASE_URL || '';
const isPostgres = currentUrl.startsWith('postgresql://') || currentUrl.startsWith('postgres://');

const remoteUrl = process.env.REMOTE_DATABASE_URL || process.env.POSTGRESQL_URL || '';
const remoteIsPostgres = remoteUrl.startsWith('postgresql://') || remoteUrl.startsWith('postgres://');

if (isPostgres) {
  process.env.DATABASE_URL = addConnectionLimits(currentUrl);
  console.log('[DB URL Init] PostgreSQL mode - using existing DATABASE_URL');
} else if (remoteIsPostgres) {
  process.env.DATABASE_URL = addConnectionLimits(remoteUrl);
  console.log('[DB URL Init] PostgreSQL mode - using REMOTE_DATABASE_URL');
} else if (process.env.USE_POSTGRESQL === 'true' && remoteUrl) {
  process.env.DATABASE_URL = addConnectionLimits(remoteUrl);
  console.log('[DB URL Init] PostgreSQL mode - using configured URL');
} else {
  const sqlitePath = path.join(os.homedir(), '.zapeera', 'data', 'zapeera.db');
  const sqliteDir = path.dirname(sqlitePath);
  const sqliteUrl = sqlitePath.startsWith('file:') ? sqlitePath : 'file:' + sqlitePath;
  if (!fs.existsSync(sqliteDir)) {
    try { fs.mkdirSync(sqliteDir, { recursive: true }); } catch (e) {}
  }
  process.env.DATABASE_URL = sqliteUrl;
  console.log('[DB URL Init] SQLite mode -', sqlitePath);
}

// Store remote URL for sync if available
if (remoteIsPostgres && process.env.USE_POSTGRESQL === 'true') {
  process.env.REMOTE_DATABASE_URL = remoteUrl;
}

module.exports = {
  DATABASE_URL: process.env.DATABASE_URL,
  IS_POSTGRESQL_MODE: process.env.DATABASE_URL.startsWith('postgresql://') || process.env.DATABASE_URL.startsWith('postgres://')
};
