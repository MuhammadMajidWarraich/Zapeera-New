/**
 * Database Initialization - runs after database-url-init.ts
 * This file is kept for backward compatibility but DATABASE_URL
 * management is handled entirely by database-url-init.ts.
 */

// DATABASE_URL is already set by database-url-init.ts (CommonJS, runs first)
// This file just re-exports for any modules that import it

export const DATABASE_INITIALIZED = true;
export const IS_POSTGRESQL_MODE = (process.env.DATABASE_URL || '').startsWith('postgresql://') || (process.env.DATABASE_URL || '').startsWith('postgres://');
export const POSTGRES_URL = IS_POSTGRESQL_MODE ? process.env.DATABASE_URL : '';
export const SQLITE_PATH = require('path').join(require('os').homedir(), '.zapeera', 'data', 'zapeera.db');
