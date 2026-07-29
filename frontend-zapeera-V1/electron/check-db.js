const initSqlJs = require('sql.js');
const fs = require('fs');
const dbPath = process.env.USERPROFILE + '\\.zapeera\\data\\zapeera.db';

initSqlJs().then(SQL => {
  const db = new SQL.Database(fs.readFileSync(dbPath));
  
  // List all tables
  const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  console.log('Tables:', tables[0]?.values.map(r => r[0]).join(', '));

  // Get schemas for key tables
  const schemas = db.exec("SELECT name, sql FROM sqlite_master WHERE type='table' AND name IN ('users', 'companies', 'business_memberships', 'memberships', 'branches', 'staff')");
  if (schemas[0]) {
    schemas[0].values.forEach(r => {
      console.log('\n--- ' + r[0] + ' ---');
      console.log(r[1]);
    });
  }

  // Show users
  const users = db.exec('SELECT * FROM users');
  console.log('\n--- Users data ---');
  console.log(JSON.stringify(users, null, 2));

  // Show companies
  try {
    const companies = db.exec('SELECT * FROM companies');
    console.log('\n--- Companies data ---');
    console.log(JSON.stringify(companies, null, 2));
  } catch(e) { console.log('No companies table'); }

  // Check for membership-like tables
  for (const t of ['business_memberships', 'memberships', 'staff', 'user_businesses']) {
    try {
      const data = db.exec('SELECT * FROM ' + t);
      console.log('\n--- ' + t + ' data ---');
      console.log(JSON.stringify(data, null, 2));
    } catch(e) {}
  }

  db.close();
});
