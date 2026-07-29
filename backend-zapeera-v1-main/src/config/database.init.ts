/**
 * Database Initialization - MUST be imported FIRST before any Prisma imports
 * This ensures DATABASE_URL is set before Prisma validates the schema
 *
 * DUAL MODE SUPPORT:
 * - USE_POSTGRESQL=true  -> Website mode (PostgreSQL direct)
 * - USE_POSTGRESQL=false -> Electron mode (SQLite offline + sync)
 */

import dotenv from 'dotenv';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

// Load environment variables FIRST
// Priority: .env.production (if NODE_ENV=production and file exists) → .env (always as fallback)
if (process.env.NODE_ENV === 'production' && fs.existsSync('.env.production')) {
  dotenv.config({ path: '.env.production' });
  console.log('[DB Init] 📁 Loaded .env.production');
}
// Always load .env as base/fallback (won't override existing vars)
dotenv.config({ override: false });

// CRITICAL FIX: Check Prisma schema provider to determine database type
// Read schema.prisma to check if provider is 'sqlite' or 'postgresql'
let schemaProvider = 'sqlite'; // Default to SQLite
try {
  const schemaPath = path.join(__dirname, '..', '..', 'prisma', 'schema.prisma');
  if (fs.existsSync(schemaPath)) {
    const schemaContent = fs.readFileSync(schemaPath, 'utf8');
    const providerMatch = schemaContent.match(/provider\s*=\s*["'](\w+)["']/i);
    if (providerMatch) {
      schemaProvider = providerMatch[1].toLowerCase();
      console.log('[DB Init] 📋 Detected Prisma schema provider:', schemaProvider);
    }
  }
} catch (err) {
  console.warn('[DB Init] ⚠️ Could not read schema.prisma, defaulting to SQLite');
}

// Check if we should use PostgreSQL directly (for website)
// CRITICAL FIX: If schema is SQLite, force SQLite mode regardless of USE_POSTGRESQL
const usePostgreSQL = schemaProvider === 'postgresql' && process.env.USE_POSTGRESQL === 'true';

if (schemaProvider === 'sqlite' && process.env.USE_POSTGRESQL === 'true') {
  console.warn('[DB Init] ⚠️ Schema is SQLite but USE_POSTGRESQL=true - forcing SQLite mode');
}

function withPostgresConnectionLimit(databaseUrl: string): string {
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
    const effectiveLimit = isDev
      ? Math.max(Number.isFinite(envLimit) ? envLimit : 0, parseInt(defaultConnectionLimit, 10))
      : (Number.isFinite(envLimit) ? envLimit : parseInt(defaultConnectionLimit, 10));
    const effectivePoolTimeout = isDev
      ? Math.max(Number.isFinite(envPoolTimeout) ? envPoolTimeout : 0, parseInt(defaultPoolTimeout, 10))
      : (Number.isFinite(envPoolTimeout) ? envPoolTimeout : parseInt(defaultPoolTimeout, 10));

    parsed.searchParams.set('connection_limit', String(effectiveLimit));
    parsed.searchParams.set('pool_timeout', String(effectivePoolTimeout));
    return parsed.toString();
  } catch {
    return databaseUrl;
  }
}

// PostgreSQL URL (optional in SQLite mode, required in PostgreSQL mode)
const postgresUrl = process.env.REMOTE_DATABASE_URL || process.env.POSTGRESQL_URL;
const POSTGRESQL_URL = postgresUrl ? withPostgresConnectionLimit(postgresUrl) : '';

if (usePostgreSQL && !POSTGRESQL_URL) {
  console.error('[DB Init] ❌ ERROR: REMOTE_DATABASE_URL or POSTGRESQL_URL is required in PostgreSQL mode.');
  console.error('[DB Init] Please set REMOTE_DATABASE_URL in your .env file');
  process.exit(1);
}

if (!POSTGRESQL_URL) {
  console.warn('[DB Init] ⚠️ PostgreSQL URL not configured. Sync to PostgreSQL is disabled.');
}

// SQLite URL for offline mode
const sqlitePath = path.join(os.homedir(), '.zapeera', 'data', 'zapeera.db');
const sqliteDir = path.dirname(sqlitePath);
// CRITICAL FIX: Ensure SQLite URL starts with 'file:' protocol
const SQLITE_URL = sqlitePath.startsWith('file:') ? sqlitePath : `file:${sqlitePath}`;

// Ensure SQLite directory exists
if (!fs.existsSync(sqliteDir)) {
  try {
    fs.mkdirSync(sqliteDir, { recursive: true });
    console.log('[DB Init] Created SQLite directory:', sqliteDir);
  } catch (err) {
    console.warn('[DB Init] Could not create SQLite directory:', err);
  }
}

// Store PostgreSQL URL for sync operations when configured
if (POSTGRESQL_URL) {
  process.env.REMOTE_DATABASE_URL = POSTGRESQL_URL;
}

if (process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('file:')) {
  console.log('[DB Init] 🔒 DATABASE_URL already set externally:', process.env.DATABASE_URL);
} else if (usePostgreSQL) {
  // Website mode - use PostgreSQL directly
  console.log('[DB Init] 🌐 WEBSITE MODE - Using PostgreSQL directly');
  console.log('[DB Init] ⚠️  Note: For website, deploy with postgresql schema');
  process.env.DATABASE_URL = POSTGRESQL_URL;
} else {
  // Electron/Software mode - use SQLite for offline support
  console.log('[DB Init] 💻 ELECTRON MODE - Using SQLite for offline support');
  console.log('[DB Init] 📁 SQLite path:', sqlitePath);
  console.log('[DB Init] 🔗 SQLite URL:', SQLITE_URL);
  if (POSTGRESQL_URL) {
    console.log('[DB Init] 🔗 PostgreSQL URL available for sync');
  } else {
    console.log('[DB Init] ⚠️ PostgreSQL sync disabled (no URL configured)');
  }
  // CRITICAL FIX: Force set DATABASE_URL to ensure it starts with 'file:'
  process.env.DATABASE_URL = SQLITE_URL;
  
  // Verify it's set correctly
  if (!process.env.DATABASE_URL.startsWith('file:')) {
    console.error('[DB Init] ❌ ERROR: DATABASE_URL does not start with file: protocol!');
    console.error('[DB Init] Current DATABASE_URL:', process.env.DATABASE_URL);
    process.env.DATABASE_URL = `file:${sqlitePath}`;
    console.log('[DB Init] ✅ Fixed DATABASE_URL:', process.env.DATABASE_URL);
  }
}

// Export for reference
export const DATABASE_INITIALIZED = true;
export const IS_POSTGRESQL_MODE = usePostgreSQL;
export const POSTGRES_URL = POSTGRESQL_URL;
export const SQLITE_PATH = sqlitePath;

console.log('[DB Init] ✅ Database initialization complete');
console.log('[DB Init] 📊 Mode:', usePostgreSQL ? 'PostgreSQL (Web)' : 'SQLite (Electron)');
