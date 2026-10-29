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
  // CORS (QA fix 2026-10-19, Track C 1.1/1.6): the previous config reflected
  // ANY Origin with credentials, so any web page open in the shop's browser
  // could call this local API cross-origin. The desktop renderer is loaded
  // via loadFile (Origin "null" / file://) in production and from a loopback
  // dev server in development; the main process calls over loopback with no
  // Origin header. Allowlist exactly those — nothing else gets CORS access.
  const LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;
  app.use(cors({
    origin(origin, callback) {
      if (!origin || origin === 'null' || origin === 'file://') {
        return callback(null, true); // local non-browser clients + file:// renderer
      }
      if (LOOPBACK_ORIGIN.test(origin)) {
        return callback(null, true); // loopback dev servers / local tooling
      }
      return callback(null, false); // any other web origin: no CORS grant
    },
    credentials: true
  }));
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

  // REMOVED (QA fix 2026-10-19, Track C 1.6): the unauthenticated
  // GET /api/debug/cloud endpoint. It exposed cloud connectivity state and
  // the configured cloud API URL to any local process or (via the old
  // reflect-any-origin CORS) any web page. No legitimate flow calls it —
  // the /health endpoint above covers liveness checks.

  // Create auth middleware
  const { createAuthMiddleware } = authService;
  const { query } = databaseService;
  const authMiddleware = createAuthMiddleware(query);

  // Initialize all services with database deps
  const serviceDeps = { ...databaseService, ...syncService, ...require('./utils/helpers'), getDataDir };
  deviceService.init(serviceDeps);
  sessionService.init(serviceDeps);
  // Wire the sync engine's database handle. Without this, sync.service's
  // query/run stay null and provisionPendingBusinesses() silently returns 0
  // while pullChangesFromCloud() iterates zero businesses — the engine looks
  // "Online" and ticks every 5s but never downloads anything, on any login.
  syncService.initDatabaseFunctions(databaseService);
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

  // Initialize the database BEFORE listening. Routes must never observe a
  // not-yet-initialized database: database.service.query() fails soft to []
  // while `db` is null, so a session/login landing in that window reads
  // "no such session" and the app mistakes a healthy saved session for an
  // expired one. The first boot after an over-the-top update is the slowest
  // (cold caches, AV scanning the new binaries, sql.js loading the whole DB
  // file), so that is exactly when the boot-time session validation used to
  // fire inside the window — and the user was thrown to the login screen
  // despite a valid session. Awaiting init here removes the window: the
  // port answers only once the data is readable. A failed init (genuinely
  // corrupt DB) still falls through to listen, preserving the old fail-soft
  // surface; the app's boot flow then decides recoverability via the saved
  // cloud session instead of a blind wipe.
  try {
    console.log('[Server] Initializing database...');
    await databaseService.initDatabase();
    console.log('[Server] ✅ Database initialized');
  } catch (e) {
    console.error('[Server] ⚠️ Database initialization failed:', e.message);
  }

  // Start server
  return new Promise((resolve, reject) => {
    try {
      server = app.listen(port, '127.0.0.1', () => {
        console.log(`[Server] ✅ Server listening on http://127.0.0.1:${port}`);
        console.log(`[Server] ✅ Health check: http://127.0.0.1:${port}/health`);
        console.log(`[Server] ✅ API: http://127.0.0.1:${port}/api`);

        // Cloud/sync wiring still runs in the background — it does network
        // work and must not delay the port (the database no longer does).
        setImmediate(async () => {
          try {
            // Set up cloud API sync
            const cloudApi = require('./services/cloud-api.service');
            syncService.setCloudApi(cloudApi);
            syncQueueService.setCloudApi && syncQueueService.setCloudApi(cloudApi);
            syncAccountService.setCloudApi && syncAccountService.setCloudApi(cloudApi);
            syncBusinessService.setCloudApi && syncBusinessService.setCloudApi(cloudApi);
            syncInventoryService.setCloudApi && syncInventoryService.setCloudApi(cloudApi);

            // Restore persisted cloud credentials so entitlement lookups and sync
            // keep working after an app restart (set during provision-session).
            try {
              const savedToken = databaseService.query("SELECT value FROM settings WHERE key = 'zapeera_cloud_access_token'");
              const savedUrl = databaseService.query("SELECT value FROM settings WHERE key = 'zapeera_cloud_api_url'");
              if (savedToken && savedToken.length > 0 && savedToken[0].value) {
                cloudApi.setAuthToken(savedToken[0].value);
              }
              if (savedUrl && savedUrl.length > 0 && savedUrl[0].value) {
                cloudApi.setCloudApiUrl(savedUrl[0].value);
              }
              if (savedToken && savedToken.length > 0 && savedToken[0].value) {
                console.log('[Server] ✅ Restored cloud credentials from settings');
              }
            } catch (credErr) {
              console.warn('[Server] Cloud credential restore warning:', credErr.message);
            }

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
