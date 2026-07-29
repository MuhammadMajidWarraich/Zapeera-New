const initSqlJs = require('sql.js');
const fs = require('fs');
const dbPath = process.env.USERPROFILE + '\\.zapeera\\data\\zapeera.db';

initSqlJs().then(SQL => {
  const db = new SQL.Database(fs.readFileSync(dbPath));

  // zapeera_users
  try {
    const zu = db.exec('SELECT * FROM zapeera_users');
    console.log('--- zapeera_users ---');
    console.log(JSON.stringify(zu, null, 2));
  } catch(e) { console.log('No zapeera_users:', e.message); }

  // businesses
  try {
    const biz = db.exec('SELECT * FROM businesses');
    console.log('\n--- businesses ---');
    console.log(JSON.stringify(biz, null, 2));
  } catch(e) { console.log('No businesses:', e.message); }

  // roles
  try {
    const roles = db.exec('SELECT * FROM roles');
    console.log('\n--- roles ---');
    console.log(JSON.stringify(roles, null, 2));
  } catch(e) { console.log('No roles:', e.message); }

  // companies
  try {
    const co = db.exec('SELECT * FROM companies');
    console.log('\n--- companies ---');
    console.log(JSON.stringify(co, null, 2));
  } catch(e) { console.log('No companies:', e.message); }

  // branches
  try {
    const br = db.exec('SELECT * FROM branches');
    console.log('\n--- branches ---');
    console.log(JSON.stringify(br, null, 2));
  } catch(e) { console.log('No branches:', e.message); }

  db.close();
});
