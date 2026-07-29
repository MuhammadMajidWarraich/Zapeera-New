/**
 * Fix sync variables in route files - use getters from sync service instead of local variables
 */

const fs = require('fs');
const path = require('path');
const glob = require('glob');

const ROUTES_DIR = path.join(__dirname, '..', 'routes');

console.log('🔧 Fixing sync variables in route files...\n');

// Find all route files
const routeFiles = glob.sync('*.routes.js', { cwd: ROUTES_DIR });

routeFiles.forEach(fileName => {
  const filePath = path.join(ROUTES_DIR, fileName);
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Remove local variable declarations
  content = content.replace(/\/\/ Variables from sync service that routes need\s+let syncInProgress = false;\s+let lastSyncTime = null;\s+let offlineQueue = \[\];\s+/g, '');
  
  // Replace variable usage with getters
  content = content.replace(/\bsyncInProgress\b/g, 'getSyncInProgress()');
  content = content.replace(/\blastSyncTime\b/g, 'getLastSyncTime()');
  content = content.replace(/\bofflineQueue\b/g, 'getOfflineQueue()');
  
  // Add getters to deps destructuring
  if (content.includes('getPgClient, getIsOnline')) {
    content = content.replace(
      /getPgClient, getIsOnline([,\s}])/,
      'getPgClient, getIsOnline, getSyncInProgress, getLastSyncTime, getOfflineQueue$1'
    );
  }
  
  fs.writeFileSync(filePath, content);
  console.log(`  ✅ Fixed ${fileName}`);
});

console.log('\n✅ All route files fixed!');

