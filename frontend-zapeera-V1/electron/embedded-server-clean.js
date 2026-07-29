/**
 * Clean Embedded Server - Similar to backend server.ts
 * Only essential server setup code - all business logic in modules
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

// ==================== IMPORTS ====================
// Import utilities
const { resolveModule } = require('./utils/helpers');
const { setDatabasePath, getDatabasePath, getDataDir } = require('./config/database.config');

// Import services
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
  console.log('[Server] Routes folder not found, routes will be registered inline');
  registerAllRoutes = null;
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
      const { getDatabase, getSQL } = databaseService;
      const { getIsOnline } = syncService;
      const { now } = require('./utils/helpers');
      
      const healthResponse = {
        status: 'ok',
        serverReady: true,
        database: 'sqlite',
        path: getDatabasePath(),
        timestamp: now(),
        databaseInitialized: !!getDatabase(),
        sqliteWorking: !!getDatabase(),
        postgresqlConnected: getIsOnline()
      };

      res.status(200).json(healthResponse);
    } catch (e) {
      console.error('[Health] Health check error:', e.message);
      res.status(200).json({
        status: 'ok',
        serverReady: true,
        message: e.message,
        timestamp: require('./utils/helpers').now()
      });
    }
  });

  // Debug endpoint
  app.get('/api/debug/postgresql', async (req, res) => {
    try {
      const { REMOTE_DATABASE_URL } = require('./config/sync.config');
      const { getIsOnline, getPgClient } = syncService;
      
      const result = {
        remoteDatabaseUrl: REMOTE_DATABASE_URL ? REMOTE_DATABASE_URL.replace(/:[^:@]+@/, ':****@') : 'NOT SET',
        isOnline: getIsOnline(),
        connectionTest: null,
        error: null
      };

      const client = getPgClient();
      if (client) {
        try {
          await client.query('SELECT 1');
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
    ...require('./utils/device-fingerprint'),
    // Constants
    REMOTE_DATABASE_URL: require('./config/sync.config').REMOTE_DATABASE_URL,
    SYNC_CONFIG: require('./config/sync.config').SYNC_CONFIG,
    OFFLINE_ACCESS_HOURS: 72
  };

  // Register all routes
  if (registerAllRoutes) {
    console.log('[Server] Registering routes from routes/index.js...');
    registerAllRoutes(app, authMiddleware, routeDeps);
  } else {
    console.log('[Server] ⚠️ Routes not found - registering inline routes...');
    // Register routes inline if routes folder doesn't exist
    // This is a fallback - routes should be in routes/ folder
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
            
            // Check PostgreSQL connection
            if (routeDeps.REMOTE_DATABASE_URL) {
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
  const { getDatabase, saveDatabase } = databaseService;
  const db = getDatabase();
  if (db) {
    saveDatabase();
    if (db.close) db.close();
  }
}

// ==================== CHECK FRESH DATABASE ====================
function isFreshDatabase() {
  try {
    const { getDatabase, query } = databaseService;
    const db = getDatabase();
    if (!db) return true;
    const testQuery = query('SELECT COUNT(*) as count FROM users');
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

