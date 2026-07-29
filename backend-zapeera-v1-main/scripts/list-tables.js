const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), '.zapeera', 'data', 'zapeera.db');
const db = new Database(dbPath);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('Tables in database (' + tables.length + '):');
tables.forEach(t => console.log('  -', t.name));

const mfr = tables.find(t => /manufacturer/i.test(t.name));
if (mfr) {
  console.log('\n✅ Found manufacturer table:', mfr.name);
  const cols = db.prepare(`PRAGMA table_info(${mfr.name})`).all();
  console.log('Columns:', cols.map(c => c.name).join(', '));
} else {
  console.log('\n❌ No manufacturer table found');
}
db.close();
