/**
 * Script to create clean embedded-server.js
 * Extracts core functions and creates minimal server file
 */

const fs = require('fs');
const path = require('path');

const EMBEDDED_SERVER_PATH = path.join(__dirname, '..', 'embedded-server.js');
const OUTPUT_DIR = path.join(__dirname, '..');

console.log('🚀 Creating clean embedded-server.js...\n');

// Read original file
const content = fs.readFileSync(EMBEDDED_SERVER_PATH, 'utf8');
const lines = content.split('\n');

// Extract function implementation
function extractFunction(functionName) {
  const patterns = [
    new RegExp(`^(async\\s+)?function\\s+${functionName}\\s*\\(`),
    new RegExp(`^const\\s+${functionName}\\s*=\\s*(async\\s+)?function`),
    new RegExp(`^const\\s+${functionName}\\s*=\\s*\\([^)]*\\)\\s*=>`),
    new RegExp(`^let\\s+${functionName}\\s*=\\s*(async\\s+)?function`)
  ];
  
  let startIdx = -1;
  let braceCount = 0;
  let inFunction = false;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (!inFunction) {
      for (const pattern of patterns) {
        if (pattern.test(line)) {
          startIdx = i;
          inFunction = true;
          braceCount = (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
          break;
        }
      }
    } else {
      braceCount += (line.match(/\{/g) || []).length - (line.match(/\}/g) || []).length;
      
      if (braceCount === 0) {
        return lines.slice(startIdx, i + 1).join('\n');
      }
    }
  }
  
  return null;
}

// Create core database service first
console.log('📝 Creating core services/database.service.js...');

const dbFunctions = ['loadSqlJs', 'initDatabase', 'saveDatabase', 'query', 'run', 
  'getActiveDatabase', 'insertIntoActiveDatabase', 'queryActiveDatabase', 
  'updateInActiveDatabase', 'deleteInActiveDatabase', 'insertIntoSqlite', 
  'querySqlite', 'updateInSqlite', 'deleteInSqlite', 'getSQLiteColumns',
  'mapRowForPostgreSQL', 'getPostgreSQLColumns', 'createRecordPostgreSQLFirst'];

let dbServiceContent = `/**
 * Core Database Service
 * SQLite database operations - extracted from embedded-server.js
 */

const fs = require('fs');
const path = require('path');
const { uuid, now, normalizeValue } = require('../utils/helpers');
const { setDatabasePath: setDbPath, getDatabasePath, getDataDir } = require('../config/database.config');

let db = null;
let SQL = null;

`;

// Extract database functions
dbFunctions.forEach(funcName => {
  const funcCode = extractFunction(funcName);
  if (funcCode) {
    dbServiceContent += funcCode + '\n\n';
  }
});

dbServiceContent += `
function getDatabase() {
  return db;
}

function getSQL() {
  return SQL;
}

module.exports = {
  loadSqlJs,
  initDatabase,
  saveDatabase,
  query,
  run,
  getDatabase,
  getSQL,
  getActiveDatabase,
  insertIntoActiveDatabase,
  queryActiveDatabase,
  updateInActiveDatabase,
  deleteInActiveDatabase,
  insertIntoSqlite,
  querySqlite,
  updateInSqlite,
  deleteInSqlite,
  getSQLiteColumns,
  mapRowForPostgreSQL,
  getPostgreSQLColumns,
  createRecordPostgreSQLFirst
};
`;

fs.writeFileSync(path.join(OUTPUT_DIR, 'services', 'database.service.js'), dbServiceContent);
console.log('✅ Created services/database.service.js');

// Create core sync service
console.log('📝 Creating core services/sync.service.js...');

const syncFunctions = ['connectPostgreSQL', 'checkPostgreSQLConnection', 'syncTableToPostgreSQL',
  'syncAllToPostgreSQL', 'pullTableFromPostgreSQL', 'pullAllFromPostgreSQL',
  'syncFromPostgreSQL', 'processOfflineQueue', 'startPeriodicSync',
  'markTableForPush', 'handleDataChange', 'loadOfflineQueue',
  'saveOfflineQueue', 'queueOfflineOperation', 'pgRowToSqlite'];

let syncServiceContent = `/**
 * Core Sync Service
 * PostgreSQL synchronization - extracted from embedded-server.js
 */

const fs = require('fs');
const path = require('path');
const { uuid, now, normalizeValue, pgRowToSqlite } = require('../utils/helpers');
const { getDataDir } = require('../config/database.config');
const { REMOTE_DATABASE_URL, SYNC_CONFIG } = require('../config/sync.config');

let pgClient = null;
let isOnline = false;
let syncInProgress = false;
let lastSyncTime = null;
const QUEUE_PATH = path.join(getDataDir(), 'sync-queue.json');
let offlineQueue = [];
let lastPullTimestamps = {};

`;

// Extract sync functions
syncFunctions.forEach(funcName => {
  const funcCode = extractFunction(funcName);
  if (funcCode) {
    syncServiceContent += funcCode + '\n\n';
  }
});

syncServiceContent += `
function getPgClient() {
  return pgClient;
}

function getIsOnline() {
  return isOnline;
}

module.exports = {
  connectPostgreSQL,
  checkPostgreSQLConnection,
  syncTableToPostgreSQL,
  syncAllToPostgreSQL,
  pullTableFromPostgreSQL,
  pullAllFromPostgreSQL,
  syncFromPostgreSQL,
  processOfflineQueue,
  startPeriodicSync,
  markTableForPush,
  handleDataChange,
  loadOfflineQueue,
  saveOfflineQueue,
  queueOfflineOperation,
  getPgClient,
  getIsOnline,
  SYNC_CONFIG,
  REMOTE_DATABASE_URL
};
`;

fs.writeFileSync(path.join(OUTPUT_DIR, 'services', 'sync.service.js'), syncServiceContent);
console.log('✅ Created services/sync.service.js');

// Now create clean embedded-server.js
console.log('\n📝 Creating clean embedded-server.js...');

const cleanServerContent = `/**
 * Clean Embedded Server - Similar to backend server.ts
 * Only essential server setup - all business logic in modules
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// ==================== IMPORTS ====================
// Import utilities
const { resolveModule, now } = require('./utils/helpers');
const { setDatabasePath, getDatabasePath, getDataDir } = require('./config/database.config');

// Import core services
const databaseService = require('./services/database.service');
const syncService = require('./services/sync.service');
const authService = require('./services/auth.service');

// Import Express
const express = resolveModule('express');
const cors = resolveModule('cors');

// Import routes (if routes folder exists)
let registerAllRoutes;
try {
  const routesIndex = require('./routes/index.js');
  registerAllRoutes = routesIndex.registerAllRoutes;
} catch (e) {
  console.log('[Server] ⚠️ Routes folder not found');
  registerAllRoutes = null;
}

// Load device fingerprinting utility
let getDeviceId, getDeviceInfo;
try {
  const deviceUtils = require('./utils/device-fingerprint.js');
  getDeviceId = deviceUtils.getDeviceId;
  getDeviceInfo = deviceUtils.getDeviceInfo;
} catch (e) {
  console.log('[Device] Device fingerprinting utility not available, using fallback');
  const crypto = require('crypto');
  getDeviceId = () => {
    const deviceIdPath = path.join(os.homedir(), '.zapeera', 'device-id.txt');
    if (fs.existsSync(deviceIdPath)) {
      return fs.readFileSync(deviceIdPath, 'utf8').trim();
    }
    const id = 'DEV-' + crypto.randomBytes(8).toString('hex').toUpperCase() + '-' + Date.now().toString(36).toUpperCase();
    const deviceDir = path.dirname(deviceIdPath);
    if (!fs.existsSync(deviceDir)) {
      fs.mkdirSync(deviceDir, { recursive: true });
    }
    fs.writeFileSync(deviceIdPath, id, 'utf8');
    return id;
  };
  getDeviceInfo = () => ({
    deviceId: getDeviceId(),
    fingerprint: crypto.createHash('sha256').update(os.hostname() + os.platform() + os.arch()).digest('hex'),
    platform: os.platform(),
    arch: os.arch(),
    hostname: os.hostname()
  });
}

// ==================== SERVER SETUP ====================
let app = null;
let server = null;

// ==================== START SERVER ====================
async function startServer(port = 4200, userDataPath = null) {
  if (server) {
    console.log('[Server] Already running');
    return server;
  }

  // Set database path if provided
  if (userDataPath) {
    setDatabasePath(userDataPath);
  }

  // Setup Express
  console.log('[Server] Setting up Express...');
  app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // Health check
  app.get('/health', (req, res) => {
    try {
      const db = databaseService.getDatabase();
      const isOnline = syncService.getIsOnline();
      const { REMOTE_DATABASE_URL } = syncService;
      
      const healthResponse = {
        status: 'ok',
        serverReady: true,
        database: 'sqlite',
        path: getDatabasePath(),
        timestamp: now(),
        databaseInitialized: !!db,
        sqliteWorking: !!db,
        postgresqlAvailable: !!REMOTE_DATABASE_URL,
        postgresqlConnected: isOnline
      };

      res.status(200).json(healthResponse);
    } catch (e) {
      console.error('[Health] Health check error:', e.message);
      res.status(200).json({
        status: 'ok',
        serverReady: true,
        message: e.message,
        timestamp: now()
      });
    }
  });

  // Debug endpoint
  app.get('/api/debug/postgresql', async (req, res) => {
    try {
      const { REMOTE_DATABASE_URL } = syncService;
      const isOnline = syncService.getIsOnline();
      const pgClient = syncService.getPgClient();
      
      const result = {
        remoteDatabaseUrl: REMOTE_DATABASE_URL ? REMOTE_DATABASE_URL.replace(/:[^:@]+@/, ':****@') : 'NOT SET',
        isOnline,
        connectionTest: null,
        error: null
      };

      if (pgClient) {
        try {
          await pgClient.query('SELECT 1');
          result.connectionTest = 'SUCCESS';
        } catch (e) {
          result.connectionTest = 'FAILED';
          result.error = e.message;
        }
      }

      res.json({ success: true, ...result });
    } catch (e) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Create auth middleware
  const { createAuthMiddleware } = authService;
  const { query } = databaseService;
  const authMiddleware = createAuthMiddleware(query);

  // Prepare dependencies for routes
  const routeDeps = {
    // Database
    ...databaseService,
    // Sync
    ...syncService,
    // Auth
    ...authService,
    // Utils
    ...require('./utils/helpers'),
    // Config
    getDatabasePath,
    getDataDir,
    // Device
    getDeviceId,
    getDeviceInfo,
    // Constants
    REMOTE_DATABASE_URL: syncService.REMOTE_DATABASE_URL,
    SYNC_CONFIG: syncService.SYNC_CONFIG,
    OFFLINE_ACCESS_HOURS: 72,
    // Additional deps that routes might need
    bcryptjs: require('bcryptjs')
  };

  // Register all routes
  if (registerAllRoutes) {
    console.log('[Server] Registering routes from routes/index.js...');
    registerAllRoutes(app, authMiddleware, routeDeps);
  } else {
    console.log('[Server] ⚠️ Routes not found - some endpoints may not work');
  }

  // Catch-all for unhandled routes
  app.all('/api/*', (req, res) => {
    console.log('[API] Unhandled route:', req.method, req.path);
    res.status(404).json({ 
      success: false, 
      message: \`Endpoint not found: \${req.method} \${req.path}\` 
    });
  });

  // Start server
  return new Promise((resolve, reject) => {
    try {
      server = app.listen(port, '127.0.0.1', () => {
        console.log(\`[Server] ✅ Server listening on http://127.0.0.1:\${port}\`);
        console.log(\`[Server] ✅ Health check: http://127.0.0.1:\${port}/health\`);
        console.log(\`[Server] ✅ API: http://127.0.0.1:\${port}/api\`);
        
        // Initialize database in background
        setImmediate(async () => {
          try {
            console.log('[Server] Initializing database in background...');
            await databaseService.initDatabase();
            console.log('[Server] ✅ Database initialized');
            
            // Load offline queue
            syncService.loadOfflineQueue();
            
            // Check PostgreSQL connection
            if (syncService.REMOTE_DATABASE_URL) {
              syncService.checkPostgreSQLConnection().then(connected => {
                if (connected) {
                  console.log('[Server] ✅ PostgreSQL connected');
                  syncService.startPeriodicSync();
                } else {
                  console.log('[Server] ⚠️ PostgreSQL not available - using SQLite only');
                }
              });
            }
          } catch (e) {
            console.error('[Server] ⚠️ Background initialization error:', e.message);
          }
        });
        
        resolve(server);
      });

      server.on('error', (err) => {
        console.error('[Server] ❌ Server error:', err.message);
        if (err.code === 'EADDRINUSE') {
          console.error(\`[Server] ❌ Port \${port} is already in use!\`);
        }
        reject(err);
      });
    } catch (err) {
      console.error('[Server] ❌ Failed to start server:', err.message);
      reject(err);
    }
  });
}

// ==================== STOP SERVER ====================
function stopServer() {
  if (server) {
    server.close();
    server = null;
  }
  const db = databaseService.getDatabase();
  if (db) {
    databaseService.saveDatabase();
    if (db.close) db.close();
  }
}

// ==================== CHECK FRESH DATABASE ====================
function isFreshDatabase() {
  try {
    const db = databaseService.getDatabase();
    if (!db) return true;
    const testQuery = databaseService.query('SELECT COUNT(*) as count FROM users');
    const userCount = testQuery[0]?.count || 0;
    return userCount === 0;
  } catch (e) {
    return true;
  }
}

// ==================== EXPORTS ====================
module.exports = {
  startServer,
  stopServer,
  setDatabasePath,
  isFreshDatabase
};
`;

// Backup original file
const backupPath = EMBEDDED_SERVER_PATH + '.backup';
if (!fs.existsSync(backupPath)) {
  fs.copyFileSync(EMBEDDED_SERVER_PATH, backupPath);
  console.log('✅ Backed up original to embedded-server.js.backup');
}

// Write clean version
fs.writeFileSync(EMBEDDED_SERVER_PATH, cleanServerContent);
console.log('✅ Created clean embedded-server.js');
console.log('\n📋 Summary:');
console.log('  ✅ Core services created');
console.log('  ✅ Clean embedded-server.js created');
console.log('  ✅ Original backed up to embedded-server.js.backup');
console.log('\n⚠️  Note: You may need to:');
console.log('  1. Create routes/index.js if it doesn\'t exist');
console.log('  2. Update service files with actual implementations');
console.log('  3. Test the application');

