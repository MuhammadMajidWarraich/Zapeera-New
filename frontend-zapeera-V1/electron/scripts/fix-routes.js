/**
 * Fix routes/index.js - Remove merge conflicts and fix variable references
 */

const fs = require('fs');
const path = require('path');

const ROUTES_FILE = path.join(__dirname, '..', 'routes', 'index.js');

console.log('🔧 Fixing routes/index.js...\n');

let content = fs.readFileSync(ROUTES_FILE, 'utf8');

// Remove merge conflict markers
content = content.replace(/^<<<<<<< HEAD\n/gm, '');
content = content.replace(/^=======\n/gm, '');
content = content.replace(/^>>>>>>> [^\n]+\n/gm, '');

// Fix variable references - add to deps destructuring
const depsLine = content.match(/const \{ [^}]+\} = deps;/);
if (depsLine) {
  // Add missing variables to deps
  const depsToAdd = ['db', 'DB_PATH', 'pgClient', 'isOnline', 'Client'];
  const currentDeps = depsLine[0];
  
  // Check if already present
  let newDeps = currentDeps;
  depsToAdd.forEach(dep => {
    if (!currentDeps.includes(dep)) {
      // Add before closing brace
      newDeps = newDeps.replace(/\} = deps;/, `${dep}, } = deps;`);
    }
  });
  
  content = content.replace(currentDeps, newDeps);
}

// Replace variable references in routes
// db -> getDatabase()
content = content.replace(/\bdb\b(?!\w)/g, 'getDatabase()');
// DB_PATH -> getDatabasePath()
content = content.replace(/\bDB_PATH\b/g, 'getDatabasePath()');
// pgClient -> getPgClient()
content = content.replace(/\bpgClient\b(?!\w)/g, 'getPgClient()');
// isOnline -> getIsOnline()
content = content.replace(/\bisOnline\b(?!\w)/g, 'getIsOnline()');

// Fix Client references - need to require pg
content = content.replace(/const Client = new Client\(/g, 'const { Client } = require(\'pg\');\n    const pgClient = new Client(');
content = content.replace(/new Client\(/g, 'new (require(\'pg\').Client)(');

// Add getDatabase, getPgClient, getIsOnline to deps destructuring if not present
if (!content.includes('getDatabase')) {
  content = content.replace(/(const \{ [^}]+)(\} = deps;)/, '$1, getDatabase$2');
}
if (!content.includes('getPgClient')) {
  content = content.replace(/(const \{ [^}]+)(\} = deps;)/, '$1, getPgClient$2');
}
if (!content.includes('getIsOnline')) {
  content = content.replace(/(const \{ [^}]+)(\} = deps;)/, '$1, getIsOnline$2');
}

fs.writeFileSync(ROUTES_FILE, content);
console.log('✅ Fixed routes/index.js');
console.log('   - Removed merge conflict markers');
console.log('   - Fixed variable references');
console.log('   - Added missing deps');

