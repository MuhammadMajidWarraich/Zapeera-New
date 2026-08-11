#!/usr/bin/env node
/**
 * Comprehensive SQLite Setup Fix
 * This script ensures SQLite mode is properly configured and working
 * Run this if SQLite mode is not working
 *
 * DATA SAFETY (Issue 3):
 *   - The initial `db push` NEVER uses the destructive data-loss flag:
 *     existing user data is never dropped automatically.
 *   - The destructive "backup + delete + recreate database" recovery path only
 *     runs when the operator explicitly opts in by setting:
 *       FIX_SQLITE_ALLOW_DESTRUCTIVE=true
 *   - Without the opt-in, a schema conflict produces actionable instructions
 *     and leaves the database untouched.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.sqlite.prisma');
const sqlitePath = path.join(os.homedir(), '.zapeera', 'data', 'zapeera.db');
const sqliteDir = path.dirname(sqlitePath);

const allowDestructive = process.env.FIX_SQLITE_ALLOW_DESTRUCTIVE === 'true';

console.log('🔧 SQLite Setup Fix');
console.log('==================\n');

try {
  // Step 1: Ensure SQLite directory exists
  console.log('Step 1: Ensuring SQLite directory exists...');
  if (!fs.existsSync(sqliteDir)) {
    fs.mkdirSync(sqliteDir, { recursive: true });
    console.log('✅ Created SQLite directory:', sqliteDir);
  } else {
    console.log('✅ SQLite directory exists');
  }

  // Step 2: Verify the committed SQLite schema (deterministic — never mutated)
  console.log('\nStep 2: Checking Prisma schema...');
  if (!fs.existsSync(schemaPath)) {
    console.error('❌ SQLite schema file not found:', schemaPath);
    throw new Error('Missing prisma/schema.sqlite.prisma');
  }
  const schema = fs.readFileSync(schemaPath, 'utf8');
  const currentProvider = schema.match(/provider\s*=\s*"(\w+)"/);
  const provider = currentProvider ? currentProvider[1] : null;
  if (provider !== 'sqlite') {
    console.error(`❌ prisma/schema.sqlite.prisma has provider "${provider}", expected "sqlite".`);
    throw new Error('Invalid SQLite schema provider');
  }
  console.log('✅ Deterministic SQLite schema verified (provider = sqlite)');

  // Step 3: Set DATABASE_URL
  console.log('\nStep 3: Setting DATABASE_URL...');
  process.env.DATABASE_URL = `file:${sqlitePath}`;
  console.log('✅ DATABASE_URL set to:', process.env.DATABASE_URL);

  // Step 4: Regenerate Prisma client from the deterministic SQLite schema
  console.log('\nStep 4: Regenerating Prisma client...');
  try {
    execSync('node scripts/generate-client.js sqlite', {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: `file:${sqlitePath}` }
    });
    console.log('✅ Prisma client regenerated');
  } catch (err) {
    console.error('❌ Error regenerating Prisma client:', err.message);
    throw err;
  }

  // Step 5: Push schema to database (non-destructive — never the data-loss flag)
  console.log('\nStep 5: Initializing database schema...');

  // Check if database exists and handle constraint errors
  const dbExists = fs.existsSync(sqlitePath);
  let needsFreshStart = false;

  if (dbExists) {
    console.log('⚠️  Database file already exists');
    console.log('   Attempting to update schema...');
  }

  try {
    execSync('npx prisma db push --schema prisma/schema.sqlite.prisma', {
      stdio: 'pipe',
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: `file:${sqlitePath}` }
    });
    console.log('✅ Database schema initialized');
  } catch (err) {
    const errorMsg = err.message || err.toString();

    // Check if it's the constraint/index error
    if (errorMsg.includes('index associated with UNIQUE or PRIMARY KEY constraint cannot be dropped') ||
        errorMsg.includes('UNIQUE constraint failed') ||
        errorMsg.includes('cannot drop')) {
      console.log('⚠️  Schema conflict detected - database is left untouched.');
      if (!allowDestructive) {
        console.log('');
        console.log('🛑 DESTRUCTIVE RECOVERY SKIPPED. To rebuild the database from scratch you must opt in:');
        console.log('    1. Back up this database file first: ' + sqlitePath);
        console.log('    2. Re-run with: FIX_SQLITE_ALLOW_DESTRUCTIVE=true npm run fix:sqlite');
        console.log('   ⚠️  WARNING: that recovery DELETES the existing database and all its data.');
        process.exit(1);
      }
      console.log('📢 DESTRUCTIVE RECOVERY OPTED IN (FIX_SQLITE_ALLOW_DESTRUCTIVE=true)');
      console.log('   The database will be backed up before it is recreated.');
      needsFreshStart = true;
    } else {
      console.error('❌ Error initializing database:', errorMsg);
      throw err;
    }
  }

  // If we need to recreate (explicit opt-in only), backup and delete old database
  if (needsFreshStart) {
    console.log('⚠️  Recreating database — this DESTRUCTIVE path runs only because you opted in.');
    if (dbExists) {
      const backupPath = sqlitePath + '.backup.' + Date.now();
      console.log(`📦 Backing up existing database to: ${backupPath}`);
      try {
        fs.copyFileSync(sqlitePath, backupPath);
        console.log('✅ Backup created');
      } catch (backupErr) {
        console.log('⚠️  Could not create backup:', backupErr.message);
      }

      // Also backup the -wal and -shm files if they exist
      const walPath = sqlitePath + '-wal';
      const shmPath = sqlitePath + '-shm';
      if (fs.existsSync(walPath)) {
        try {
          fs.copyFileSync(walPath, backupPath + '-wal');
        } catch (e) {}
      }
      if (fs.existsSync(shmPath)) {
        try {
          fs.copyFileSync(shmPath, backupPath + '-shm');
        } catch (e) {}
      }

      // Delete old database files
      console.log('🗑️  Removing old database files...');
      try {
        fs.unlinkSync(sqlitePath);
        if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
        if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
        console.log('✅ Old database removed');
      } catch (deleteErr) {
        console.error('❌ Could not delete old database:', deleteErr.message);
        throw deleteErr;
      }
    }

    // Now try again with fresh database
    console.log('🔄 Creating fresh database...');
    try {
      execSync('npx prisma db push --schema prisma/schema.sqlite.prisma', {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, DATABASE_URL: `file:${sqlitePath}` }
      });
      console.log('✅ Fresh database schema initialized');
    } catch (retryErr) {
      console.error('❌ Error creating fresh database:', retryErr.message);
      throw retryErr;
    }
  }

  // Step 6: Seed database with default data
  console.log('\nStep 6: Seeding database with default data...');
  try {
    execSync('npx ts-node scripts/seed-sqlite.ts', {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, DATABASE_URL: `file:${sqlitePath}` }
    });
    console.log('✅ Database seeded');
  } catch (err) {
    console.log('⚠️  Could not seed database (may already have data):', err.message);
    // Continue anyway - seeding is optional
  }

  // Step 7: Verify database
  console.log('\nStep 7: Verifying database...');
  if (fs.existsSync(sqlitePath)) {
    const stats = fs.statSync(sqlitePath);
    console.log('✅ Database file exists');
    console.log(`   Size: ${(stats.size / 1024).toFixed(2)} KB`);
    console.log(`   Path: ${sqlitePath}`);
  } else {
    console.log('⚠️  Database file not found (will be created on first use)');
  }

  console.log('\n✅ SQLite setup complete!');
  console.log('\nNext steps:');
  console.log('  1. Start the server: npm run dev:electron');
  console.log('  2. Or build and start: npm run build && npm start');
  console.log('\nDefault login credentials:');
  console.log('   Username: superadmin');
  console.log('   Password: admin123');
  console.log('\nNote: Make sure USE_POSTGRESQL is NOT set to "true" for SQLite mode');

} catch (error) {
  console.error('\n❌ Error fixing SQLite setup:', error.message);
  console.error('\nTroubleshooting:');
  console.error('  1. Make sure you have Node.js and npm installed');
  console.error('  2. Run: npm install');
  console.error('  3. Check that Prisma is installed: npx prisma --version');
  console.error('  4. Try manually: npm run setup:electron && npm run db:push');
  process.exit(1);
}
