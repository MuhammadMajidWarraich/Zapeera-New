/**
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
const authService = require('./services/auth/auth.service');
const deviceService = require('./services/device.service');
const sessionService = require('./services/session.service');
const syncAccountService = require('./services/sync-account.service');
const syncQueueService = require('./services/sync-queue.service');
const syncBusinessService = require('./services/sync-business.service');
const syncInventoryService = require('./services/sync-inventory.service');
const authRefreshService = require('./services/auth-refresh.service');

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
async function startServer(port = 4201, userDataPath = null) {
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
      const connState = syncService.getConnectionState();
      
      const healthResponse = {
        status: 'ok',
        serverReady: true,
        database: 'sqlite',
        path: getDatabasePath(),
        timestamp: now(),
        databaseInitialized: !!db,
        sqliteWorking: !!db,
        connectionState: connState,
        cloudApiUrl: process.env.CLOUD_API_URL || 'not configured'
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

  // Debug endpoint - cloud connectivity
  app.get('/api/debug/cloud', async (req, res) => {
    try {
      const connState = syncService.getConnectionState();
      const cloudApi = syncService.getCloudApi && syncService.getCloudApi();
      
      const result = {
        connectionState: connState,
        cloudApiUrl: process.env.CLOUD_API_URL || 'not configured',
        healthResult: null,
        error: null
      };

      if (cloudApi) {
        try {
          const health = await cloudApi.checkHealth();
          result.healthResult = health;
        } catch (e) {
          result.healthResult = { reachable: false, error: e.message };
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

  // Initialize all services with database deps
  const serviceDeps = { ...databaseService, ...syncService, ...require('./utils/helpers'), getDataDir };
  deviceService.init(serviceDeps);
  sessionService.init(serviceDeps);
  syncAccountService.init(serviceDeps);
  syncQueueService.init(serviceDeps);
  syncBusinessService.init(serviceDeps);
  syncInventoryService.init(serviceDeps);
  authRefreshService.init(serviceDeps);

  // Backward-compatible stubs for SQLite-only functions
  // sync.service.js already has cloud-based aliases (connectPostgreSQL → checkCloudConnectivity, etc.)
  // These stubs provide SQLite-only versions for functions not covered there.
  const compatStubs = {
    getActiveDatabase: async () => 'sqlite',
    insertIntoActiveDatabase: async (table, data) => {
      const { insertIntoSqlite } = databaseService;
      return insertIntoSqlite ? insertIntoSqlite(table, data) : null;
    },
    queryActiveDatabase: async (table, conditions) => {
      const { querySqlite } = databaseService;
      return querySqlite ? querySqlite(table, conditions) : [];
    },
    updateInActiveDatabase: async (table, data, conditions) => {
      const { updateInSqlite } = databaseService;
      return updateInSqlite ? updateInSqlite(table, data, conditions) : null;
    },
    deleteInActiveDatabase: async (table, conditions, softDelete) => {
      const { deleteInSqlite } = databaseService;
      return deleteInSqlite ? deleteInSqlite(table, conditions, softDelete) : null;
    },
    createRecordPostgreSQLFirst: async (table, data) => {
      const { insertIntoSqlite } = databaseService;
      return insertIntoSqlite ? insertIntoSqlite(table, data) : null;
    },
    getPgClient: () => null,
    mapRowForPostgreSQL: () => ({}),
    getPostgreSQLColumns: async () => [],
    markTableForPush: () => {},
    queueOfflineOperation: () => {},
    saveOfflineQueue: () => {}
  };

  // Prepare dependencies for routes
  const routeDeps = {
    // Database
    ...databaseService,
    getDatabase: databaseService.getDatabase,
    saveDatabase: databaseService.saveDatabase,
    initDatabase: databaseService.initDatabase,
    // Sync
    ...syncService,
    // Sync state accessors (routes need these)
    getSyncInProgress: syncService.getSyncInProgress,
    getLastSyncTime: syncService.getLastSyncTime,
    getOfflineQueue: syncService.getOfflineQueue,
    // Backward-compat stubs
    ...compatStubs,
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
    // Cloud API for sync routes
    cloudApi: require('./services/cloud-api.service'),
    // All services
    deviceService,
    sessionService,
    syncAccountService,
    syncQueueService,
    syncBusinessService,
    syncInventoryService,
    authRefreshService,
    // Constants
    REMOTE_DATABASE_URL: '',
    SYNC_CONFIG: syncService.SYNC_CONFIG,
    CLOUD_API_URL: require('./config/sync.config').CLOUD_API_URL,
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
      message: `Endpoint not found: ${req.method} ${req.path}` 
    });
  });

  // Start server
  return new Promise((resolve, reject) => {
    try {
      server = app.listen(port, '127.0.0.1', () => {
        console.log(`[Server] ✅ Server listening on http://127.0.0.1:${port}`);
        console.log(`[Server] ✅ Health check: http://127.0.0.1:${port}/health`);
        console.log(`[Server] ✅ API: http://127.0.0.1:${port}/api`);
        
        // Initialize database in background
        setImmediate(async () => {
          try {
            console.log('[Server] Initializing database in background...');
            await databaseService.initDatabase();
            console.log('[Server] ✅ Database initialized');

            // Set up cloud API sync
            const cloudApi = require('./services/cloud-api.service');
            syncService.setCloudApi(cloudApi);
            syncQueueService.setCloudApi && syncQueueService.setCloudApi(cloudApi);
            syncAccountService.setCloudApi && syncAccountService.setCloudApi(cloudApi);
            syncBusinessService.setCloudApi && syncBusinessService.setCloudApi(cloudApi);
            syncInventoryService.setCloudApi && syncInventoryService.setCloudApi(cloudApi);

            // Load offline queue and start periodic sync
            syncService.loadOfflineQueue();
            syncService.startPeriodicSync();

            console.log('[Server] ✅ Sync initialized (Cloud API mode - no direct PostgreSQL)');
          } catch (e) {
            console.error('[Server] ⚠️ Background initialization error:', e.message);
          }
        });
        
        resolve(server);
      });

      server.on('error', (err) => {
        console.error('[Server] ❌ Server error:', err.message);
        if (err.code === 'EADDRINUSE') {
          console.error(`[Server] ❌ Port ${port} is already in use!`);
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
