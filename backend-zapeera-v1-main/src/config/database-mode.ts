/**
 * Database Mode Resolution — single source of truth for SQLite vs PostgreSQL.
 *
 * The mode is derived ONLY from the environment, mirroring the behavior of
 * `database-url-init.ts` (which normalizes DATABASE_URL before server boot):
 *   1. DATABASE_URL is postgres://   → PostgreSQL
 *   2. DATABASE_URL is set (file: or other) → SQLite — an explicit DATABASE_URL
 *      is authoritative and is never overridden by USE_POSTGRESQL or a remote
 *      sync URL. This is what keeps Electron/offline launches on SQLite even
 *      when REMOTE_DATABASE_URL (used only for sync) is configured.
 *   3. USE_POSTGRESQL === 'true'     → PostgreSQL (web / cloud)
 *   4. USE_POSTGRESQL === 'false'    → SQLite
 *   5. REMOTE_DATABASE_URL / POSTGRESQL_URL is postgres:// → PostgreSQL (legacy)
 *   6. otherwise                     → SQLite (Electron / offline desktop)
 *
 * IMPORTANT: The Prisma client MUST be generated for the same mode this
 * function selects. `prisma-mode-assert.ts` enforces that at startup.
 */

export type DatabaseMode = 'sqlite' | 'postgresql';

export const DATABASE_MODES: DatabaseMode[] = ['sqlite', 'postgresql'];

export function isPostgresUrl(url: string | undefined | null): boolean {
  const value = String(url || '');
  return value.startsWith('postgresql://') || value.startsWith('postgres://');
}

/**
 * Resolve the database mode from an environment object.
 * Defaults to process.env when no env is supplied (unit-testable).
 */
export function resolveDatabaseMode(env: NodeJS.ProcessEnv = process.env): DatabaseMode {
  if (isPostgresUrl(env.DATABASE_URL)) {
    return 'postgresql';
  }
  // An explicitly-set DATABASE_URL (e.g. file:) is authoritative for SQLite.
  if (env.DATABASE_URL) {
    return 'sqlite';
  }
  if (String(env.USE_POSTGRESQL).toLowerCase() === 'true') {
    return 'postgresql';
  }
  if (String(env.USE_POSTGRESQL).toLowerCase() === 'false') {
    return 'sqlite';
  }
  if (isPostgresUrl(env.REMOTE_DATABASE_URL) || isPostgresUrl(env.POSTGRESQL_URL)) {
    return 'postgresql';
  }
  return 'sqlite';
}

export function isPostgreSQLMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveDatabaseMode(env) === 'postgresql';
}

export function isSQLiteMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveDatabaseMode(env) === 'sqlite';
}

/** Human-readable label for logs / health payloads. */
export function databaseModeLabel(mode: DatabaseMode): string {
  return mode === 'postgresql' ? 'PostgreSQL (Web)' : 'SQLite (Electron)';
}
