#!/usr/bin/env node
/**
 * Deterministic Prisma client generation.
 *
 * Generates the client for ONE explicit mode using its dedicated schema file.
 * NEVER mutates a shared schema — the mode is fixed by the argument (or the
 * environment when the argument is omitted), and the matching committed
 * schema input is used with an explicit --schema flag.
 *
 * Usage:
 *   node scripts/generate-client.js sqlite        # Electron / desktop
 *   node scripts/generate-client.js postgresql    # Web / cloud
 *   node scripts/generate-client.js               # auto-detect from env
 *
 * DATABASE_URL is never printed. Placeholder URLs are used only to satisfy
 * Prisma's URL format validation during generation.
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');
const { resolveModeFromEnv, modeLabel } = require('./db-mode');
const { checkSchemaSync } = require('./check-schema-sync');

// npm does not load .env — do it here so auto-detection matches the server.
require('dotenv').config({ override: false });

const ROOT = path.join(__dirname, '..');
const MODES = ['sqlite', 'postgresql'];
const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function resolveModeArg() {
  const arg = (process.argv[2] || '').toLowerCase();
  if (arg === 'postgres' || arg === 'postgresql') return 'postgresql';
  if (arg === 'sqlite') return 'sqlite';
  if (!arg) return resolveModeFromEnv(process.env);
  console.error(`[Generate Client] ❌ Unknown mode "${arg}". Use: sqlite | postgresql`);
  process.exit(1);
}

function databaseUrlFor(mode) {
  if (mode === 'sqlite') {
    return 'file:./prisma/dev.db';
  }
  const env = process.env;
  const existing = [env.DATABASE_URL, env.REMOTE_DATABASE_URL, env.POSTGRESQL_URL].find((url) =>
    String(url || '').startsWith('postgres')
  );
  if (existing) {
    return existing;
  }
  console.warn(
    '[Generate Client] ⚠️  No PostgreSQL URL found in DATABASE_URL / REMOTE_DATABASE_URL / POSTGRESQL_URL.'
  );
  console.warn('[Generate Client] ⚠️  Using a placeholder URL for generation only — set DATABASE_URL before starting the server.');
  return 'postgresql://postgres:postgres@localhost:5432/zapeera';
}

function main() {
  const mode = resolveModeArg();

  const sync = checkSchemaSync();
  if (!sync.ok) {
    console.error('[Generate Client] ❌ Cannot generate: Prisma schema drift detected.');
    for (const error of sync.errors) {
      console.error(`   - ${error}`);
    }
    process.exit(1);
  }

  const schemaFile = `prisma/schema.${mode}.prisma`;
  const schemaPath = path.join(ROOT, schemaFile);
  if (!require('fs').existsSync(schemaPath)) {
    console.error(`[Generate Client] ❌ Schema file not found: ${schemaFile}`);
    process.exit(1);
  }

  console.log(`[Generate Client] 🚀 Generating Prisma client for ${modeLabel(mode)} (${schemaFile})`);
  try {
    execFileSync(
      NPX,
      ['prisma', 'generate', '--schema', schemaPath],
      {
        cwd: ROOT,
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, DATABASE_URL: databaseUrlFor(mode) },
      }
    );
  } catch (error) {
    console.error(`[Generate Client] ❌ prisma generate failed (exit ${error.status}): ${error.message}`);
    process.exit(error.status || 1);
  }
  console.log(`[Generate Client] ✅ Prisma client generated for ${modeLabel(mode)}`);
}

main();
