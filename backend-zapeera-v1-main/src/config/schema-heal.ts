/**
 * Schema self-heal — keeps the PostgreSQL schema in sync at boot.
 *
 * The project has no migration files: schema changes are applied with
 * `prisma db push` (additive, never the destructive data-loss flag). CI has
 * no production DB access, so the server applies the schema itself on
 * startup — mirroring the SQLite sync path in sync.service.ts.
 *
 * Safety:
 *  - Postgres (web) mode only; never SQLite/Electron and never in tests.
 *  - `--skip-generate`: the Prisma client is generated at build time.
 *  - Fails fast with an actionable message when the schema cannot be
 *    applied (missing tables would otherwise 500 every protected request).
 */
import * as path from 'path';
import { execSync } from 'child_process';

const SCHEMA_FILE = path.join(__dirname, '..', '..', 'prisma', 'schema.postgresql.prisma');

export function healDatabaseSchema(): void {
  const url = String(process.env.DATABASE_URL || '');
  const isPostgres = url.startsWith('postgresql://') || url.startsWith('postgres://');
  if (!isPostgres) return;
  if (String(process.env.NODE_ENV) === 'test') return;
  if (String(process.env.ELECTRON).toLowerCase() === 'true') return;
  if (String(process.env.SKIP_SCHEMA_HEAL).toLowerCase() === 'true') return;

  console.log('[Schema Heal] 📋 Synchronizing PostgreSQL schema (non-destructive prisma db push)...');
  try {
    execSync(`npx prisma db push --schema "${SCHEMA_FILE}" --skip-generate`, {
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env, DATABASE_URL: url },
      stdio: 'pipe',
      timeout: 180000,
    });
    console.log('[Schema Heal] ✅ PostgreSQL schema is up to date');
  } catch (err) {
    const msg = String((err as any)?.message || err || '').split('\n')[0];
    console.error(`[Schema Heal] ❌ Failed to synchronize PostgreSQL schema: ${msg}`);
    console.error('[Schema Heal] ❌ Manual remediation: npx prisma db push --schema prisma/schema.postgresql.prisma');
    throw new Error('PostgreSQL schema is out of sync (prisma db push failed). See [Schema Heal] logs above.');
  }
}
