/**
 * Prisma Client Mode Assertion — runs at server startup.
 *
 * Guarantees the GENERATED Prisma client's datasource provider matches the
 * SELECTED database mode. A SQLite-generated client must never run against a
 * PostgreSQL DATABASE_URL and vice versa — that combination crashes at startup
 * with confusing Prisma errors (P1012 / "url must start with file:").
 *
 * SECURITY: The failure output reports the configured mode, the generated
 * provider, and safe remediation commands. It NEVER prints DATABASE_URL or any
 * other secret.
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolveDatabaseMode, DatabaseMode, DATABASE_MODES, databaseModeLabel } from './database-mode';

/** Escape hatch for tooling that manages the client out-of-band. */
export const SKIP_ENV_VAR = 'ZAPEERA_SKIP_DB_MODE_CHECK';

export interface DbModeCheckResult {
  ok: boolean;
  configuredMode: DatabaseMode;
  generatedProvider: DatabaseMode | null;
  generatedSchemaPath: string | null;
  skipped: boolean;
  reason?: string;
}

/** Path of the schema copy embedded in the generated Prisma client. */
export function getGeneratedClientSchemaPath(): string {
  // From src/config or dist/config → backend root → node_modules/.prisma/client/schema.prisma
  return path.resolve(__dirname, '..', '..', 'node_modules', '.prisma', 'client', 'schema.prisma');
}

/** Read the datasource provider baked into the generated Prisma client. */
export function readGeneratedProvider(generatedSchemaPath: string = getGeneratedClientSchemaPath()): DatabaseMode | null {
  if (!fs.existsSync(generatedSchemaPath)) {
    return null;
  }
  const text = fs.readFileSync(generatedSchemaPath, 'utf8');
  const match = text.match(/datasource\s+\w+\s*\{[\s\S]*?provider\s*=\s*"(\w+)"/);
  if (!match) {
    return null;
  }
  const provider = match[1].toLowerCase();
  return DATABASE_MODES.includes(provider as DatabaseMode) ? (provider as DatabaseMode) : null;
}

/**
 * Pure check — unit-testable with injected env / provider.
 */
export function checkDatabaseMode(
  env: NodeJS.ProcessEnv = process.env,
  generatedProvider: DatabaseMode | null = readGeneratedProvider()
): DbModeCheckResult {
  if (String(env[SKIP_ENV_VAR]).toLowerCase() === 'true') {
    return { ok: true, configuredMode: resolveDatabaseMode(env), generatedProvider, generatedSchemaPath: null, skipped: true, reason: `${SKIP_ENV_VAR}=true` };
  }

  const configuredMode = resolveDatabaseMode(env);
  const generatedSchemaPath = getGeneratedClientSchemaPath();

  if (!generatedProvider) {
    return {
      ok: false,
      configuredMode,
      generatedProvider: null,
      generatedSchemaPath,
      skipped: false,
      reason: 'Prisma client not generated — no generated schema found.',
    };
  }

  if (generatedProvider !== configuredMode) {
    return {
      ok: false,
      configuredMode,
      generatedProvider,
      generatedSchemaPath,
      skipped: false,
      reason: `Generated client provider (${generatedProvider}) does not match selected mode (${configuredMode}).`,
    };
  }

  return { ok: true, configuredMode, generatedProvider, generatedSchemaPath, skipped: false };
}

/**
 * Build an actionable, secret-free failure message with remediation commands.
 */
export function buildMismatchMessage(result: DbModeCheckResult): string {
  const mode = result.configuredMode;
  const remediationWeb = '  npm run setup:web        # regenerate client for PostgreSQL (web/cloud)';
  const remediationDesktop = '  npm run setup:electron  # regenerate client for SQLite (desktop/offline)';
  const remediationManual =
    mode === 'postgresql'
      ? '  npx prisma generate --schema prisma/schema.postgresql.prisma'
      : '  npx prisma generate --schema prisma/schema.sqlite.prisma';

  const lines = [
    '',
    '==================================================================',
    ' DATABASE MODE MISMATCH — PRISMA CLIENT DOES NOT MATCH SELECTED MODE',
    '==================================================================',
    '',
    ` Configured mode     : ${databaseModeLabel(mode)}`,
    ` Generated provider  : ${result.generatedProvider || 'unknown (no generated client)'}`,
    ` Generated schema    : ${result.generatedSchemaPath || 'n/a'}`,
    '',
    result.reason || '',
    '',
    ' The Prisma client must be regenerated for the selected mode:',
    '',
    remediationWeb,
    remediationDesktop,
    remediationManual,
    '',
    ` To bypass this check (NOT recommended): set ${SKIP_ENV_VAR}=true`,
    '',
    '==================================================================',
    '',
  ];
  return lines.join('\n');
}

/**
 * Assert at startup that the generated Prisma client matches the selected mode.
 * Exits the process with a clear, actionable message on mismatch.
 */
export function assertDatabaseModeMatch(env: NodeJS.ProcessEnv = process.env): DbModeCheckResult {
  const result = checkDatabaseMode(env);
  if (result.skipped) {
    console.log(`[DB Mode] ⏭️  Skipped Prisma client mode check (${SKIP_ENV_VAR}=true)`);
    return result;
  }
  if (!result.ok) {
    console.error(buildMismatchMessage(result));
    console.error('[DB Mode] ❌ Refusing to start: generated Prisma client does not match the selected database mode.');
    process.exit(1);
  }
  console.log(
    `[DB Mode] ✅ Configured mode: ${databaseModeLabel(result.configuredMode)} | Generated client provider: ${result.generatedProvider}`
  );
  return result;
}
