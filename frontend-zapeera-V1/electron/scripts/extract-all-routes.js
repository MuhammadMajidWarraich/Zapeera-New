/**
 * Extract all routes from embedded-server.js.backup
 * Create routes/index.js with registerAllRoutes function
 */

const fs = require('fs');
const path = require('path');

const BACKUP_PATH = path.join(__dirname, '..', 'embedded-server.js.backup');
const ROUTES_DIR = path.join(__dirname, '..', 'routes');

console.log('🚀 Extracting all routes from backup...\n');

// Create routes directory
if (!fs.existsSync(ROUTES_DIR)) {
  fs.mkdirSync(ROUTES_DIR, { recursive: true });
  console.log('✅ Created routes directory');
}

// Read backup file
const content = fs.readFileSync(BACKUP_PATH, 'utf8');
const lines = content.split('\n');

// Find all route definitions
const routes = [];
let currentRoute = null;
let braceCount = 0;
let inRoute = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  // Match route definitions
  const routeMatch = line.match(/app\.(get|post|put|delete|patch)\(['"]([^'"]+)['"]/);
  
  if (routeMatch) {
    // Save previous route if exists
    if (currentRoute) {
      routes.push(currentRoute);
    }
    
    // Start new route
    currentRoute = {
      method: routeMatch[1],
      path: routeMatch[2],
      startLine: i + 1,
      code: [line],
      hasAuth: line.includes('authMiddleware')
    };
    inRoute = true;
    braceCount = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
  } else if (inRoute && currentRoute) {
    currentRoute.code.push(line);
    braceCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
    
    if (braceCount === 0) {
      currentRoute.endLine = i + 1;
      routes.push(currentRoute);
      currentRoute = null;
      inRoute = false;
    }
  }
}

// Save last route if exists
if (currentRoute) {
  routes.push(currentRoute);
}

console.log(`✅ Found ${routes.length} routes\n`);

// Group routes by domain
const routeGroups = {};
routes.forEach(route => {
  const pathParts = route.path.split('/');
  const domain = pathParts[2] || 'other'; // /api/domain/...
  
  if (!routeGroups[domain]) {
    routeGroups[domain] = [];
  }
  routeGroups[domain].push(route);
});

console.log('📊 Routes by domain:');
Object.keys(routeGroups).forEach(domain => {
  console.log(`   ${domain}: ${routeGroups[domain].length} routes`);
});

// Create routes/index.js
const routesIndexContent = `/**
 * Routes Index
 * Register all API routes
 * Extracted from embedded-server.js.backup
 */

function registerAllRoutes(app, authMiddleware, deps) {
  const { query, run, getDatabase, getActiveDatabase, insertIntoActiveDatabase, 
          queryActiveDatabase, updateInActiveDatabase, deleteInActiveDatabase,
          handleDataChange, getDataFilter, uuid, now, hashPassword, generateToken,
          verifyToken, getDeviceId, getDeviceInfo, REMOTE_DATABASE_URL, SYNC_CONFIG,
          connectPostgreSQL, checkPostgreSQLConnection, syncAllToPostgreSQL,
          pullAllFromPostgreSQL, processOfflineQueue, startPeriodicSync,
          markTableForPush, queueOfflineOperation, loadOfflineQueue, saveOfflineQueue,
          createRecordPostgreSQLFirst, mapRowForPostgreSQL, getPostgreSQLColumns,
          getSQLiteColumns, pgRowToSqlite, normalizeValue, getWeekNumber, getDateFromWeek,
          getDatabasePath, getDataDir, OFFLINE_ACCESS_HOURS, bcryptjs } = deps;

  console.log('[Routes] Registering ${routes.length} routes...');

${routes.map(route => {
  const code = route.code.join('\n');
  // Indent code properly (add 2 spaces to each line)
  const indentedCode = code.split('\n').map(l => '  ' + l).join('\n');
  
  return `  // ${route.method.toUpperCase()} ${route.path} (line ${route.startLine})
${indentedCode}`;
}).join('\n\n')}

  console.log('[Routes] ✅ All routes registered');
}

module.exports = {
  registerAllRoutes
};
`;

fs.writeFileSync(path.join(ROUTES_DIR, 'index.js'), routesIndexContent);
console.log('\n✅ Created routes/index.js');
console.log(`   Total routes: ${routes.length}`);
console.log(`   Domains: ${Object.keys(routeGroups).length}`);

