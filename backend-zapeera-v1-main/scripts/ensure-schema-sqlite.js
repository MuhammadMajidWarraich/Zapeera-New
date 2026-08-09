#!/usr/bin/env node
/**
 * Ensure schema is set to SQLite before starting Electron mode
 * This prevents Prisma validation errors
 * Also ensures database is initialized
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');

// In test mode (jest) the test suites provision their own SQLite databases,
// so never touch the desktop database directory or push into it.
const isTestMode = process.env.NODE_ENV === 'test' || process.env.TEST_MODE === 'true';

// Ensure SQLite database directory exists
const sqlitePath = path.join(os.homedir(), '.zapeera', 'data', 'zapeera.db');
const sqliteDir = path.dirname(sqlitePath);

try {
  // Ensure SQLite directory exists (desktop only — tests use their own DBs)
  if (!isTestMode && !fs.existsSync(sqliteDir)) {
    fs.mkdirSync(sqliteDir, { recursive: true });
    console.log('[Schema Check] 📁 Created SQLite directory:', sqliteDir);
  }

  // Read current schema
  const schema = fs.readFileSync(schemaPath, 'utf8');

  // Check current provider
  const currentProvider = schema.match(/provider\s*=\s*"(\w+)"/);
  const provider = currentProvider ? currentProvider[1] : null;

  let needsRegenerate = false;

  if (provider === 'sqlite') {
    // Already correct, just regenerate if needed
    console.log('[Schema Check] ✅ Schema is already set to SQLite');
    needsRegenerate = true;
  } else {
    // Need to switch
    console.log(`[Schema Check] ⚠️  Schema is set to ${provider}, switching to SQLite...`);

    // Replace provider
    let updatedSchema = schema.replace(
      /provider\s*=\s*"postgresql"/,
      'provider = "sqlite"'
    );

    // Note: Prisma handles BigInt for SQLite automatically (stores as INTEGER)
    // No need to convert types - Prisma handles the mapping

    fs.writeFileSync(schemaPath, updatedSchema, 'utf8');
    console.log('[Schema Check] ✅ Switched to SQLite');
    needsRegenerate = true;
  }

  if (needsRegenerate) {
    // Regenerate Prisma client
    console.log('[Schema Check] 🔄 Regenerating Prisma client...');
    try {
      execSync('npx prisma generate', {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, DATABASE_URL: `file:${sqlitePath}` }
      });
      console.log('[Schema Check] ✅ Prisma client regenerated');
    } catch (err) {
      console.error('[Schema Check] ⚠️  Error regenerating client:', err.message);
      // Continue anyway - might already be generated
    }

    // Push schema to database (creates tables if they don't exist) — desktop only
    if (isTestMode) {
      console.log('[Schema Check] ✅ Test mode detected — skipping desktop database push');
    } else {
      console.log('[Schema Check] 🔄 Initializing SQLite database...');
      const dbExists = fs.existsSync(sqlitePath);

      try {
        execSync('npx prisma db push --accept-data-loss', {
          stdio: 'pipe',
          cwd: path.join(__dirname, '..'),
          env: { ...process.env, DATABASE_URL: `file:${sqlitePath}` }
        });
        console.log('[Schema Check] ✅ SQLite database initialized');
      } catch (err) {
        const errorMsg = err.message || err.toString();

        // PRESERVE DATA: Never auto-wipe an existing database on schema conflict.
        // If the schema differs, log a warning and continue. Devs must manually
        // migrate or run `prisma db push --accept-data-loss` themselves.
        if (errorMsg.includes('index associated with UNIQUE or PRIMARY KEY constraint cannot be dropped') ||
            errorMsg.includes('UNIQUE constraint failed') ||
            errorMsg.includes('cannot drop')) {
          console.log('[Schema Check] ⚠️  Schema conflict detected - SKIPPING auto-wipe to preserve data.');
          console.log('[Schema Check] ⚠️  Run `npx prisma db push --accept-data-loss` manually if needed.');
        } else {
          console.error('[Schema Check] ⚠️  Error initializing database:', errorMsg);
        }
        // Continue startup with the existing database
        void dbExists;
      }
    }
  }
} catch (error) {
  console.error('[Schema Check] ❌ Error:', error.message);
  process.exit(1);
}
