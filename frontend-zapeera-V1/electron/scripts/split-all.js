/**
 * MASTER SCRIPT - Split embedded-server.js into modular structure
 * Run this script to automatically:
 * 1. Create directory structure
 * 2. Extract all code from embedded-server.js
 * 3. Populate service and repository files
 * 4. Create index files
 * 
 * Usage: node scripts/split-all.js
 */

console.log('🚀 MASTER SCRIPT: Splitting embedded-server.js into modules\n');
console.log('📋 This will:');
console.log('   1. Create services/ and repositories/ structure');
console.log('   2. Extract code from embedded-server.js');
console.log('   3. Populate all domain modules');
console.log('   4. Create index files\n');

// Run all extraction scripts in sequence
const { execSync } = require('child_process');
const path = require('path');

const scriptsDir = __dirname;

try {
  console.log('Step 1: Creating module structure...');
  execSync(`node "${path.join(scriptsDir, 'split-into-modules.js')}"`, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  
  console.log('\nStep 2: Extracting domain code...');
  execSync(`node "${path.join(scriptsDir, 'extract-all-modules.js')}"`, { stdio: 'inherit', cwd: path.join(__dirname, '..') });
  
  console.log('\n✅ ALL DONE!');
  console.log('\n📁 Structure created:');
  console.log('   - services/[domain]/[domain].service.js');
  console.log('   - repositories/[domain]/[domain].repository.js');
  console.log('   - utils/helpers.js');
  console.log('   - config/');
  console.log('\n📝 Next: Update embedded-server.js to import from modules');
  
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}

