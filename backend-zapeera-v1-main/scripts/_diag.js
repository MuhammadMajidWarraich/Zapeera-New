const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(require('os').homedir(), '.zapeera', 'data', 'zapeera.db'));

const bizId = 'cmocb6m13001k1c7kumotvneo';

// Check business_modules columns first
const cols = db.prepare("PRAGMA table_info(business_modules)").all();
console.log('business_modules columns:', cols.map(c => c.name));

const bm = db.prepare("SELECT * FROM business_modules WHERE businessId = ?").all(bizId);
console.log('business_modules for test business:', bm.length, 'rows');
bm.forEach(r => console.log('  ', r));

// Check business_type_modules for RETAIL_STORE
const rtMods = db.prepare("SELECT btm.isEnabled, m.name as modName FROM business_type_modules btm JOIN modules m ON m.id = btm.moduleId JOIN business_types bt ON bt.id = btm.businessTypeId WHERE bt.name = 'RETAIL_STORE' ORDER BY m.name").all();
console.log('\nRETAIL_STORE type modules:', rtMods);

// Check all business types
const bts = db.prepare("SELECT name FROM business_types").all();
console.log('\nAll business types:', bts.map(b => b.name));

// Check membership role for this business
const mem = db.prepare("SELECT m.roleId, r.name as roleName FROM memberships m LEFT JOIN roles r ON r.id = m.roleId WHERE m.businessId = ?").all(bizId);
console.log('Memberships with roles:', mem);

db.close();
