const Database = require('better-sqlite3');
const db = new Database('C:\\Users\\Muhammad Majid\\.zapeera\\data\\zapeera.db');

// Check business type case sensitivity
const biz = db.prepare("SELECT id, name, businessType FROM businesses WHERE name LIKE '%Gohar%'").get();
console.log('=== Business Type Lookup Debug ===');
console.log('business.businessType =', JSON.stringify(biz.businessType));

// Exact match (what Prisma findUnique does)
const exactMatch = db.prepare("SELECT * FROM business_types WHERE name = ?").get(biz.businessType);
console.log('Exact match (name = "PHARMACY"):', JSON.stringify(exactMatch));

// Case-insensitive match
const caseMatch = db.prepare("SELECT * FROM business_types WHERE LOWER(name) = LOWER(?)").get(biz.businessType);
console.log('Case-insensitive match:', JSON.stringify(caseMatch));

// All business type names
const allBt = db.prepare("SELECT id, name FROM business_types").all();
console.log('\nAll business_types:');
allBt.forEach(bt => {
  console.log(`  id="${bt.id}" name="${bt.name}" matches="PHARMACY"? ${bt.name === 'PHARMACY'} caseInsensitive=${bt.name.toLowerCase() === 'pharmacy'}`);
});

// Check platform_plans
console.log('\n=== platform_plans ===');
try {
  const pp = db.prepare("SELECT * FROM platform_plans").all();
  console.log(JSON.stringify(pp, null, 2));
} catch(e) { console.log(e.message); }

// Check subscriptions table
console.log('\n=== subscriptions ===');
try {
  const s = db.prepare("SELECT * FROM subscriptions").all();
  console.log(JSON.stringify(s, null, 2));
} catch(e) { console.log(e.message); }

// Check Gohar's subscription with planId
console.log('\n=== Gohar Pharma subscription ===');
const sub = db.prepare("SELECT * FROM business_subscriptions WHERE businessId = ?").get(biz.id);
console.log(JSON.stringify(sub, null, 2));
if (sub && sub.planId) {
  // Check if plan_module_permissions has sales disabled for single-scale
  console.log('\nPlan module permissions for plan:', sub.planId);
  const pmp = db.prepare("SELECT moduleName, enabled FROM plan_module_permissions WHERE planId = ?").all(sub.planId);
  console.log(JSON.stringify(pmp, null, 2));
}

// Check role_module_permissions for OWNER
console.log('\n=== OWNER role module permissions ===');
const ownerPerms = db.prepare("SELECT moduleName, enabled FROM role_module_permissions WHERE roleName = 'OWNER'").all();
console.log(JSON.stringify(ownerPerms, null, 2));

// Check role_module_permissions for single-scale plan
console.log('\n=== single-scale plan module permissions ===');
const scalePerms = db.prepare("SELECT moduleName, enabled FROM plan_module_permissions WHERE planId = 'single-scale'").all();
console.log(JSON.stringify(scalePerms, null, 2));

// Verify the Prisma schema has Plan model  
console.log('\n=== All tables with "plan" in name ===');
const planTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%plan%'").all();
console.log(JSON.stringify(planTables.map(t => t.name)));

// Check if V2 tables exist
console.log('\n=== V2 module tables ===');
const v2Tables = ['module_definitions', 'module_pages', 'operations', 'plan_entitlements', 'business_module_overrides', 'module_dependencies'];
for (const t of v2Tables) {
  try {
    const cnt = db.prepare("SELECT count(*) as cnt FROM " + t).get();
    console.log(t + ':', cnt.cnt, 'rows');
  } catch(e) { console.log(t + ': ERROR -', e.message); }
}

db.close();
