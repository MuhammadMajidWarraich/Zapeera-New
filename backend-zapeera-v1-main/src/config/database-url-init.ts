/**
 * CRITICAL: This file MUST be CommonJS (not ES6) to ensure it runs synchronously
 * before any ES6 imports execute.
 *
 * DUAL MODE SUPPORT:
 * - USE_POSTGRESQL=true  -> Website mode (PostgreSQL direct)
 * - Default              -> Electron mode (SQLite offline + sync)
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

// Load environment variables FIRST (before checking for database URL)
// Find project root (where .env file should be)
const projectRoot = path.resolve(__dirname, '..', '..');
const envProductionPath = path.join(projectRoot, '.env.production');
const envPath = path.join(projectRoot, '.env');

// Priority: .env.production (if NODE_ENV=production and file exists) → .env (always as fallback)
if (process.env.NODE_ENV === 'production' && fs.existsSync(envProductionPath)) {
  require('dotenv').config({ path: envProductionPath });
  console.log('[DB URL Init] 📁 Loaded .env.production from:', envProductionPath);
}
// Always load .env as base/fallback (won't override existing vars)
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath, override: false });
  console.log('[DB URL Init] 📁 Loaded .env from:', envPath);
} else {
  console.warn('[DB URL Init] ⚠️  .env file not found at:', envPath);
}

// CRITICAL FIX: Check Prisma schema provider to determine database type
// Read schema.prisma to check if provider is 'sqlite' or 'postgresql'
let schemaProvider = 'sqlite'; // Default to SQLite
try {
  const schemaPath = path.join(projectRoot, 'prisma', 'schema.prisma');
  if (fs.existsSync(schemaPath)) {
    const schemaContent = fs.readFileSync(schemaPath, 'utf8');
    const providerMatch = schemaContent.match(/provider\s*=\s*["'](\w+)["']/i);
    if (providerMatch) {
      schemaProvider = providerMatch[1].toLowerCase();
      console.log('[DB URL Init] 📋 Detected Prisma schema provider:', schemaProvider);
    }
  }
} catch (err) {
  console.warn('[DB URL Init] ⚠️ Could not read schema.prisma, defaulting to SQLite');
}

// Check if we should use PostgreSQL directly (for website)
// CRITICAL FIX: If schema is SQLite, force SQLite mode regardless of USE_POSTGRESQL
const usePostgreSQL = schemaProvider === 'postgresql' && process.env.USE_POSTGRESQL === 'true';

if (schemaProvider === 'sqlite' && process.env.USE_POSTGRESQL === 'true') {
  console.warn('[DB URL Init] ⚠️ Schema is SQLite but USE_POSTGRESQL=true - forcing SQLite mode');
}

function withPostgresConnectionLimit(databaseUrl: string) {
  try {
    const parsed = new URL(databaseUrl);
    // IMPORTANT:
    // PostgreSQL servers typically have max_connections=100 by default
    // We use a smaller pool (10-15) to avoid exhausting server connection slots
    // Prisma will reuse connections efficiently within this pool
    const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
    // Use smaller connection pool to avoid exhausting PostgreSQL server limits
    const defaultConnectionLimit = isDev ? '15' : '10';
    const defaultPoolTimeout = isDev ? '20' : '15';

    // Always set/override so stale query params in the URL can't force bad defaults.
    // Also: if env vars are set too low for dev (e.g. 1/0), bump them to safe minimums.
    const envLimit = parseInt(process.env.PG_CONNECTION_LIMIT || '', 10);
    const envPoolTimeout = parseInt(process.env.PG_POOL_TIMEOUT || '', 10);
    const effectiveLimit = isDev ? Math.max(Number.isFinite(envLimit) ? envLimit : 0, parseInt(defaultConnectionLimit, 10)) : (Number.isFinite(envLimit) ? envLimit : parseInt(defaultConnectionLimit, 10));
    const effectivePoolTimeout = isDev ? Math.max(Number.isFinite(envPoolTimeout) ? envPoolTimeout : 0, parseInt(defaultPoolTimeout, 10)) : (Number.isFinite(envPoolTimeout) ? envPoolTimeout : parseInt(defaultPoolTimeout, 10));

    parsed.searchParams.set('connection_limit', String(effectiveLimit));
    parsed.searchParams.set('pool_timeout', String(effectivePoolTimeout));
    return parsed.toString();
  } catch (e) {
    return databaseUrl;
  }
}

// PostgreSQL URL (optional in SQLite mode, required in PostgreSQL mode)
const postgresUrl = process.env.REMOTE_DATABASE_URL || process.env.POSTGRESQL_URL;
const postgresUrlWithLimits = postgresUrl ? withPostgresConnectionLimit(postgresUrl) : null;

if (usePostgreSQL && !postgresUrlWithLimits) {
  console.error('[DB URL Init] ❌ ERROR: REMOTE_DATABASE_URL or POSTGRESQL_URL is required in PostgreSQL mode.');
  console.error('[DB URL Init] Please set REMOTE_DATABASE_URL in your .env file');
  process.exit(1);
}

if (!postgresUrlWithLimits) {
  console.warn('[DB URL Init] ⚠️ PostgreSQL URL not configured. Sync to PostgreSQL is disabled.');
}

// SQLite URL
const sqlitePath = path.join(os.homedir(), '.zapeera', 'data', 'zapeera.db');
const sqliteDir = path.dirname(sqlitePath);
// CRITICAL FIX: Ensure SQLite URL starts with 'file:' protocol
const sqliteUrl = sqlitePath.startsWith('file:') ? sqlitePath : `file:${sqlitePath}`;

// Ensure SQLite directory exists
if (!fs.existsSync(sqliteDir)) {
  try {
    fs.mkdirSync(sqliteDir, { recursive: true });
    console.log('[DB URL Init] 📁 Created SQLite directory:', sqliteDir);
  } catch (err: unknown) {
    console.warn('[DB URL Init] ⚠️ Could not create SQLite directory:', err instanceof Error ? err.message : String(err));
  }
}

// Store PostgreSQL URL for sync only when configured
if (postgresUrlWithLimits) {
  process.env.REMOTE_DATABASE_URL = postgresUrlWithLimits;
}

// CRITICAL: If DATABASE_URL is already set externally (test mode, etc.), preserve it.
if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('file:')) {
  console.log('[DB URL Init] 🔒 DATABASE_URL already set externally:', process.env.DATABASE_URL);
} else if (usePostgreSQL) {
  // Website mode
  console.log('[DB URL Init] 🌐 WEBSITE MODE - PostgreSQL');
  process.env.DATABASE_URL = postgresUrlWithLimits!;
} else {
  // Electron mode - SQLite for offline
  console.log('[DB URL Init] 💻 ELECTRON MODE - SQLite');
  console.log('[DB URL Init] 📁 SQLite path:', sqlitePath);
  console.log('[DB URL Init] 🔗 SQLite URL:', sqliteUrl);
  // CRITICAL FIX: Force set DATABASE_URL to ensure it starts with 'file:'
  process.env.DATABASE_URL = sqliteUrl;
  
  // Verify it's set correctly
  if (!process.env.DATABASE_URL.startsWith('file:')) {
    console.error('[DB URL Init] ❌ ERROR: DATABASE_URL does not start with file: protocol!');
    console.error('[DB URL Init] Current DATABASE_URL:', process.env.DATABASE_URL);
    process.env.DATABASE_URL = `file:${sqlitePath}`;
    console.log('[DB URL Init] ✅ Fixed DATABASE_URL:', process.env.DATABASE_URL);
  }
}

module.exports = {
  DATABASE_URL: process.env.DATABASE_URL,
  IS_POSTGRESQL_MODE: usePostgreSQL
};
