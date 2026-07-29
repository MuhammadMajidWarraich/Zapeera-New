const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), '.zapeera', 'data', 'zapeera.db');
console.log('Opening database:', dbPath);

try {
  const db = new Database(dbPath);
  const cols = db.prepare('PRAGMA table_info(manufacturers)').all();
  console.log('manufacturers columns:', cols.map(c => c.name).join(', '));
  if (!cols.some(c => c.name === 'phone')) {
    db.prepare('ALTER TABLE "manufacturers" ADD COLUMN "phone" TEXT').run();
    console.log('✅ Added phone column to manufacturers table');
  } else {
    console.log('ℹ️ phone column already exists');
  }
  db.close();
} catch (err) {
  console.error('❌ Error:', err.message);
  process.exit(1);
}
