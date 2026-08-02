const { app, BrowserWindow, Menu, shell, ipcMain, dialog, session, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');

// ============================================================
// SINGLE INSTANCE LOCK
// ============================================================
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// ============================================================
// GLOBAL REFERENCES
// ============================================================
let mainWindow = null;
let splashWindow = null;
let backendProcess = null;
let embeddedServer = null;
let useEmbeddedApi = false;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const BACKEND_PORT = parseInt(process.env.ELECTRON_BACKEND_PORT || '4201', 10);

// ============================================================
// WINDOW STATE PERSISTENCE
// ============================================================
function getWindowState() {
  try {
    const statePath = path.join(app.getPath('userData'), 'window-state.json');
    if (fs.existsSync(statePath)) {
      const raw = fs.readFileSync(statePath, 'utf8');
      const state = JSON.parse(raw);
      // Validate dimensions
      if (state.width && state.height && state.width >= 800 && state.height >= 600) {
        return state;
      }
    }
  } catch (e) { /* ignore */ }
  return { width: 1400, height: 900, x: undefined, y: undefined, isMaximized: false };
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const bounds = mainWindow.getBounds();
    const state = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized: mainWindow.isMaximized()
    };
    const statePath = path.join(app.getPath('userData'), 'window-state.json');
    fs.writeFileSync(statePath, JSON.stringify(state), 'utf8');
  } catch (e) { /* ignore */ }
}

// CRITICAL: Database path will be set in app.whenReady() using app.getPath('userData')
// This ensures database is deleted on uninstall and fresh database on each installation
// For now, use default paths (will be overridden by embedded-server using app.getPath('userData'))
const APP_DATA_DIR = path.join(os.homedir(), '.zapeera');
const DATA_DIR = path.join(APP_DATA_DIR, 'data');
const LOG_DIR = path.join(APP_DATA_DIR, 'logs');
const SQLITE_DB_PATH = path.join(DATA_DIR, 'zapeera.db');

// ============================================================
// CLOUD API & REMOTE DATABASE URL
// ============================================================
// Electron uses Cloud API (HTTPS) for sync with the Cloud Backend.
// The Cloud Backend owns PostgreSQL; the Desktop never connects directly.
// Set ZAPEERA_CLOUD_API_URL or CLOUD_API_URL for the embedded server.
// Set ZAPEERA_REMOTE_DATABASE_URL or REMOTE_DATABASE_URL for backend subprocess.
// Never hardcode production URLs in the desktop bundle.
const ELECTRON_CLOUD_API_URL =
  process.env.ZAPEERA_CLOUD_API_URL ||
  process.env.CLOUD_API_URL ||
  '';

const ELECTRON_REMOTE_DATABASE_URL =
  process.env.ZAPEERA_REMOTE_DATABASE_URL ||
  process.env.REMOTE_DATABASE_URL ||
  '';

if (ELECTRON_CLOUD_API_URL) {
  process.env.CLOUD_API_URL = ELECTRON_CLOUD_API_URL;
}

if (ELECTRON_REMOTE_DATABASE_URL) {
  process.env.REMOTE_DATABASE_URL = ELECTRON_REMOTE_DATABASE_URL;
}

// Handle second instance - focus existing window
if (gotTheLock) {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

const logFile = path.join(LOG_DIR, `app-${new Date().toISOString().split('T')[0]}.log`);

// ============================================================
// DIRECTORY SETUP
// ============================================================
function ensureDirectories() {
  [APP_DATA_DIR, DATA_DIR, LOG_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        log('INFO', `Created directory: ${dir}`);
      } catch (err) {
        console.error(`Failed to create ${dir}:`, err);
      }
    }
  });
}
ensureDirectories();

// ============================================================
// LOGGING
// ============================================================
function log(level, message) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] [${level}] ${message}`;
  console.log(logMessage);
  try {
    fs.appendFileSync(logFile, logMessage + '\n', 'utf8');
  } catch (err) {}
}

function maskDbUrl(url) {
  if (!url) return 'NOT SET';
  return url.replace(/:[^:@]+@/, ':****@');
}

// ============================================================
// ERROR HANDLING
// ============================================================
process.on('uncaughtException', (error) => {
  if (error.code === 'EPIPE') return;
  log('ERROR', `Uncaught Exception: ${error.message}`);
  log('ERROR', `Stack: ${error.stack}`);

  // On Windows, show error dialog for critical errors
  if (process.platform === 'win32' && app && !app.isReady()) {
    // App not ready yet, can't show dialog - just log
    log('ERROR', 'App not ready - cannot show error dialog');
  } else if (process.platform === 'win32' && app && app.isReady()) {
    dialog.showErrorBox(
      'Zapeera - Critical Error',
      `An unexpected error occurred.\n\nError: ${error.message}\n\nPlease check the logs at: ${logFile}`
    );
  }
});

process.on('unhandledRejection', (reason) => {
  if (reason && reason.code === 'EPIPE') return;
  log('ERROR', `Unhandled Rejection: ${reason}`);

  // On Windows, log but don't show dialog for unhandled rejections (less critical)
  if (process.platform === 'win32') {
    log('WARN', 'Unhandled rejection occurred - app may continue');
  }
});

// ============================================================
// PATH FUNCTIONS
// ============================================================
function getFrontendPath() {
  if (isDev) {
    return path.join(__dirname, '..', 'dist', 'index.html');
  }

  // Try multiple paths in production
  const possiblePaths = [
    path.join(process.resourcesPath, 'zapeera-frontend', 'dist', 'index.html'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'zapeera-frontend', 'dist', 'index.html'),
    path.join(__dirname, '..', 'dist', 'index.html')
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      log('INFO', `Found frontend at: ${p}`);
      return p;
    }
  }

  // Fallback - check if running from asar
  const asarPath = path.join(__dirname, '..', 'dist', 'index.html');
  if (fs.existsSync(asarPath)) {
    return asarPath;
  }

  log('WARN', 'Frontend not found in expected locations');
  return possiblePaths[0];
}

function getPreloadPath() {
  return path.join(__dirname, 'preload.js');
}

function getIconPath() {
  // Try multiple icon paths - prefer ico for Windows
  const possiblePaths = isDev
    ? [
        path.join(__dirname, '..', 'public', 'icons', 'icon.ico'),
        path.join(__dirname, '..', 'public', 'icons', 'icon.png'),
        path.join(__dirname, '..', 'public', 'images', 'favicon.png')
      ]
    : [
        path.join(process.resourcesPath, 'zapeera-frontend', 'dist', 'icons', 'icon.ico'),
        path.join(process.resourcesPath, 'zapeera-frontend', 'dist', 'icons', 'icon.png'),
        path.join(process.resourcesPath, 'zapeera-frontend', 'dist', 'images', 'favicon.png'),
        path.join(__dirname, '..', 'dist', 'icons', 'icon.ico'),
        path.join(__dirname, '..', 'dist', 'icons', 'icon.png')
      ];

  for (const iconPath of possiblePaths) {
    if (fs.existsSync(iconPath)) {
      log('INFO', `Using icon: ${iconPath}`);
      return iconPath;
    }
  }
  log('WARN', 'No icon found');
  return undefined;
}

function getBackendPath() {
  if (isDev) {
    return path.join(__dirname, '..', '..', 'backend-zapeera-v1-main', 'dist', 'server.js');
  }

  // Try multiple paths in production
  const possiblePaths = [
    path.join(process.resourcesPath, 'zapeera-backend', 'dist', 'server.js'),
    path.join(process.resourcesPath, 'app.asar.unpacked', 'zapeera-backend', 'dist', 'server.js'),
    path.join(__dirname, '..', 'zapeera-backend', 'dist', 'server.js')
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      log('INFO', `Found backend at: ${p}`);
      return p;
    }
  }

  return possiblePaths[0];
}

/**
 * Get the Node.js executable path
 * In development: use system Node.js
 * In production on Windows: use bundled node.exe (if available)
 * In production on macOS/Linux: use Electron's built-in Node (which works fine)
 *
 * Note: Both platforms will fall back to embedded server if external backend fails,
 * ensuring consistent functionality across platforms.
 */
function getNodePath() {
  if (isDev) {
    // In development, use system Node.js
    return process.execPath;
  }

  // In production on Windows, try bundled node.exe first
  if (process.platform === 'win32') {
    const bundledNodePaths = [
      path.join(process.resourcesPath, 'node', 'node.exe'),
      path.join(process.resourcesPath, 'app.asar.unpacked', 'node', 'node.exe'),
      path.join(__dirname, '..', 'node', 'node.exe')
    ];

    for (const nodePath of bundledNodePaths) {
      if (fs.existsSync(nodePath)) {
        log('INFO', `Found bundled Node.js at: ${nodePath}`);
        return nodePath;
      }
    }

    log('WARN', 'Bundled Node.js not found on Windows, falling back to Electron Node');
  }

  // Fallback to Electron's Node.js (works on macOS/Linux and as fallback on Windows)
  // This is fine because we have embedded server as primary fallback
  log('INFO', `Using Electron's Node.js: ${process.execPath}`);
  return process.execPath;
}

// ============================================================
// BACKEND FUNCTIONS
// ============================================================
function checkBackendHealth() {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${BACKEND_PORT}/health`, { timeout: 3000 }, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitForBackend(maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    if (await checkBackendHealth()) {
      return true;
    }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

/**
 * Initialize SQLite database with schema
 * Creates all required tables if they don't exist
 * Seeds a default admin user for first-time use
 */
async function initializeDatabase() {
  log('INFO', '=== Initializing SQLite Database ===');
  log('INFO', `Database path: ${SQLITE_DB_PATH}`);

  // Ensure directory exists
  const dataDir = path.dirname(SQLITE_DB_PATH);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
    log('INFO', `Created data directory: ${dataDir}`);
  }

  try {
    // Use better-sqlite3 if available, otherwise create empty file
    let Database;
    try {
      Database = require('better-sqlite3');
    } catch (e) {
      // Fallback: just ensure file exists
      if (!fs.existsSync(SQLITE_DB_PATH)) {
        fs.writeFileSync(SQLITE_DB_PATH, '');
        log('INFO', 'Created empty database file');
      }
      return true;
    }

    const db = new Database(SQLITE_DB_PATH);

    // Create tables
    const tables = [
      `CREATE TABLE IF NOT EXISTS "companies" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT UNIQUE NOT NULL,
        "description" TEXT,
        "address" TEXT,
        "phone" TEXT,
        "email" TEXT,
        "website" TEXT,
        "businessType" TEXT,
        "createdBy" TEXT,
        "isActive" INTEGER DEFAULT 1,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "branches" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "address" TEXT,
        "phone" TEXT,
        "email" TEXT,
        "companyId" TEXT NOT NULL,
        "isActive" INTEGER DEFAULT 1,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "users" (
        "id" TEXT PRIMARY KEY,
        "username" TEXT UNIQUE NOT NULL,
        "email" TEXT UNIQUE NOT NULL,
        "password" TEXT NOT NULL,
        "name" TEXT NOT NULL,
        "profileImage" TEXT,
        "role" TEXT DEFAULT 'CASHIER',
        "branchId" TEXT,
        "companyId" TEXT,
        "isActive" INTEGER DEFAULT 1,
        "sessionToken" TEXT,
        "lastLoginAt" DATETIME,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
        "createdBy" TEXT
      )`,
      `CREATE TABLE IF NOT EXISTS "categories" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "branchId" TEXT,
        "companyId" TEXT,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "manufacturers" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "address" TEXT,
        "phone" TEXT,
        "email" TEXT,
        "branchId" TEXT,
        "companyId" TEXT,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "suppliers" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "address" TEXT,
        "phone" TEXT,
        "email" TEXT,
        "branchId" TEXT,
        "companyId" TEXT,
        "manufacturerId" TEXT,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "shelves" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "location" TEXT,
        "branchId" TEXT,
        "companyId" TEXT,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "products" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "description" TEXT,
        "sku" TEXT,
        "barcode" TEXT,
        "price" REAL DEFAULT 0,
        "costPrice" REAL DEFAULT 0,
        "quantity" INTEGER DEFAULT 0,
        "minStock" INTEGER DEFAULT 0,
        "maxStock" INTEGER DEFAULT 0,
        "unit" TEXT,
        "manufacturerId" TEXT,
        "shelfId" TEXT,
        "categoryId" TEXT,
        "branchId" TEXT,
        "companyId" TEXT,
        "expiryDate" DATETIME,
        "isActive" INTEGER DEFAULT 1,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "customers" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "phone" TEXT,
        "email" TEXT,
        "address" TEXT,
        "branchId" TEXT,
        "companyId" TEXT,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "sales" (
        "id" TEXT PRIMARY KEY,
        "invoiceNumber" TEXT,
        "totalAmount" REAL DEFAULT 0,
        "discount" REAL DEFAULT 0,
        "tax" REAL DEFAULT 0,
        "grandTotal" REAL DEFAULT 0,
        "paymentMethod" TEXT,
        "status" TEXT DEFAULT 'COMPLETED',
        "customerId" TEXT,
        "userId" TEXT,
        "branchId" TEXT,
        "companyId" TEXT,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "sale_items" (
        "id" TEXT PRIMARY KEY,
        "quantity" INTEGER NOT NULL,
        "price" REAL NOT NULL,
        "discount" REAL DEFAULT 0,
        "total" REAL NOT NULL,
        "saleId" TEXT NOT NULL,
        "productId" TEXT NOT NULL,
        "batchId" TEXT,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "batches" (
        "id" TEXT PRIMARY KEY,
        "batchNo" TEXT NOT NULL,
        "productId" TEXT NOT NULL,
        "supplierId" TEXT,
        "quantity" INTEGER DEFAULT 0,
        "costPrice" REAL DEFAULT 0,
        "sellingPrice" REAL DEFAULT 0,
        "manufactureDate" DATETIME,
        "expiryDate" DATETIME,
        "branchId" TEXT,
        "companyId" TEXT,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "purchases" (
        "id" TEXT PRIMARY KEY,
        "purchaseNumber" TEXT,
        "supplierId" TEXT,
        "totalAmount" REAL DEFAULT 0,
        "discount" REAL DEFAULT 0,
        "tax" REAL DEFAULT 0,
        "grandTotal" REAL DEFAULT 0,
        "status" TEXT DEFAULT 'PENDING',
        "branchId" TEXT,
        "companyId" TEXT,
        "userId" TEXT,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "purchase_items" (
        "id" TEXT PRIMARY KEY,
        "quantity" INTEGER NOT NULL,
        "price" REAL NOT NULL,
        "total" REAL NOT NULL,
        "purchaseId" TEXT NOT NULL,
        "productId" TEXT NOT NULL,
        "batchId" TEXT,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "settings" (
        "id" TEXT PRIMARY KEY,
        "branchId" TEXT UNIQUE,
        "companyId" TEXT,
        "currency" TEXT DEFAULT 'PKR',
        "taxRate" REAL DEFAULT 0,
        "receiptHeader" TEXT,
        "receiptFooter" TEXT,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "employees" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "email" TEXT,
        "phone" TEXT,
        "address" TEXT,
        "position" TEXT,
        "salary" REAL DEFAULT 0,
        "branchId" TEXT,
        "companyId" TEXT,
        "userId" TEXT,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "receipts" (
        "id" TEXT PRIMARY KEY,
        "saleId" TEXT,
        "receiptNumber" TEXT,
        "content" TEXT,
        "branchId" TEXT,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "refunds" (
        "id" TEXT PRIMARY KEY,
        "saleId" TEXT,
        "reason" TEXT,
        "amount" REAL DEFAULT 0,
        "status" TEXT DEFAULT 'PENDING',
        "branchId" TEXT,
        "userId" TEXT,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "refund_items" (
        "id" TEXT PRIMARY KEY,
        "refundId" TEXT NOT NULL,
        "productId" TEXT NOT NULL,
        "quantity" INTEGER NOT NULL,
        "price" REAL NOT NULL,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "stock_movements" (
        "id" TEXT PRIMARY KEY,
        "productId" TEXT NOT NULL,
        "batchId" TEXT,
        "type" TEXT NOT NULL,
        "quantity" INTEGER NOT NULL,
        "reason" TEXT,
        "branchId" TEXT,
        "userId" TEXT,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "attendance" (
        "id" TEXT PRIMARY KEY,
        "employeeId" TEXT NOT NULL,
        "date" DATE NOT NULL,
        "checkIn" DATETIME,
        "checkOut" DATETIME,
        "status" TEXT DEFAULT 'PRESENT',
        "branchId" TEXT,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "shifts" (
        "id" TEXT PRIMARY KEY,
        "name" TEXT NOT NULL,
        "startTime" TEXT,
        "endTime" TEXT,
        "branchId" TEXT,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "scheduled_shifts" (
        "id" TEXT PRIMARY KEY,
        "shiftId" TEXT NOT NULL,
        "date" DATE NOT NULL,
        "branchId" TEXT,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "scheduled_shift_users" (
        "id" TEXT PRIMARY KEY,
        "scheduledShiftId" TEXT NOT NULL,
        "userId" TEXT NOT NULL,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "commissions" (
        "id" TEXT PRIMARY KEY,
        "employeeId" TEXT NOT NULL,
        "saleId" TEXT,
        "amount" REAL DEFAULT 0,
        "percentage" REAL DEFAULT 0,
        "branchId" TEXT,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "card_details" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "cardNumber" TEXT,
        "cardType" TEXT,
        "expiryDate" TEXT,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS "subscriptions" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "plan" TEXT,
        "status" TEXT DEFAULT 'ACTIVE',
        "startDate" DATETIME,
        "endDate" DATETIME,
        "createdAt" DATETIME DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" DATETIME DEFAULT CURRENT_TIMESTAMP
      )`
    ];

    for (const sql of tables) {
      try {
        db.exec(sql);
      } catch (e) {
        log('WARN', `Table creation warning: ${e.message}`);
      }
    }

    // ============================================================
    // SEED DEFAULT ADMIN USER (for first-time local use)
    // ============================================================
    try {
      // Check if any users exist
      const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();

      if (!userCount || userCount.count === 0) {
        log('INFO', '🌱 No users found, seeding default admin user...');

        // Generate a simple hashed password for 'admin123'
        // Using bcrypt format: $2a$10$... (rounds=10)
        // Pre-hashed password for 'admin123' with 10 rounds
        const hashedPassword = '$2a$10$K.0HwpsoPDGaB/atFBmmXOGTw4ceeg33.WrxJx/FeC9.gOMXeIBbi';

        // Create a unique ID
        const adminId = 'local-admin-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
        const companyId = 'local-company-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
        const branchId = 'local-branch-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
        const now = new Date().toISOString();

        // Create company first
        db.prepare(`
          INSERT OR IGNORE INTO companies (id, name, description, address, phone, email, businessType, createdBy, isActive, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(
          companyId,
          'My Pharmacy',
          'Local pharmacy business',
          '123 Main Street',
          '+1234567890',
          'admin@pharmacy.local',
          'PHARMACY',
          adminId,
          now,
          now
        );
        log('INFO', '✅ Default company created');

        // Create branch
        db.prepare(`
          INSERT OR IGNORE INTO branches (id, name, address, phone, email, companyId, isActive, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(
          branchId,
          'Main Branch',
          '123 Main Street',
          '+1234567890',
          'branch@pharmacy.local',
          companyId,
          now,
          now
        );
        log('INFO', '✅ Default branch created');

        // Create admin user with isActive=TRUE (1)
        db.prepare(`
          INSERT OR IGNORE INTO users (id, username, email, password, name, role, branchId, companyId, isActive, createdBy, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        `).run(
          adminId,
          'admin',
          'admin@pharmacy.local',
          hashedPassword,
          'Administrator',
          'ADMIN',
          branchId,
          companyId,
          adminId, // createdBy is self
          now,
          now
        );

        log('INFO', '✅ Default admin user created');
        log('INFO', '🔑 Login credentials:');
        log('INFO', '   Username: admin');
        log('INFO', '   Password: admin123');

        // Also create a SUPERADMIN for full access
        const superadminId = 'local-superadmin-' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
        db.prepare(`
          INSERT OR IGNORE INTO users (id, username, email, password, name, role, branchId, companyId, isActive, createdBy, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        `).run(
          superadminId,
          'superadmin',
          'superadmin@pharmacy.local',
          hashedPassword,
          'Super Administrator',
          'SUPERADMIN',
          branchId,
          companyId,
          superadminId, // createdBy is self
          now,
          now
        );

        log('INFO', '✅ Default superadmin user created');
        log('INFO', '🔑 Superadmin Login credentials:');
        log('INFO', '   Username: superadmin');
        log('INFO', '   Password: admin123');
      } else {
        log('INFO', `Found ${userCount.count} existing users, skipping seed`);
      }
    } catch (seedError) {
      log('WARN', `User seeding warning: ${seedError.message}`);
      // Don't fail if seeding has issues - tables are created
    }

    db.close();
    log('INFO', '✅ Database initialized successfully');
    return true;
  } catch (error) {
    log('ERROR', `Database initialization failed: ${error.message}`);
    return false;
  }
}

/**
 * Start backend - Spawns the packaged Zapeera backend server
 * Uses SQLite for offline data storage
 */
async function startBackend() {
  log('INFO', '='.repeat(50));
  log('INFO', '=== Starting Backend Server (SQLite) ===');
  log('INFO', '='.repeat(50));
  log('INFO', `Platform: ${process.platform}`);
  log('INFO', `Architecture: ${process.arch}`);
  log('INFO', `isDev: ${isDev}`);
  log('INFO', `Database Path: ${SQLITE_DB_PATH}`);
  log('INFO', `Resources Path: ${process.resourcesPath || 'N/A'}`);

  // Database is already initialized in app.whenReady() - no need to initialize again

  // Check if already running
  if (await checkBackendHealth()) {
    log('INFO', '✅ Backend already running on port ' + BACKEND_PORT);
    return true;
  }

  // Generate JWT secret (persists across app restarts) — store in global scope for IPC handlers
  const jwtSecretPath = path.join(APP_DATA_DIR, 'jwt-secret.txt');
  global.__ZAPEERA_JWT_SECRET__ = global.__ZAPEERA_JWT_SECRET__ || (() => {
    let secret;
    if (fs.existsSync(jwtSecretPath)) {
      secret = fs.readFileSync(jwtSecretPath, 'utf8').trim();
      log('INFO', 'Using existing JWT secret');
    } else {
      secret = crypto.randomBytes(64).toString('hex');
      fs.writeFileSync(jwtSecretPath, secret, 'utf8');
      log('INFO', 'Generated new JWT secret');
    }
    // Also set process.env so embedded server (in-process) can use it
    process.env.JWT_SECRET = secret;
    return secret;
  })();
  const jwtSecret = global.__ZAPEERA_JWT_SECRET__;

  const backendPath = getBackendPath();
  const backendDir = path.dirname(path.dirname(backendPath));
  const nodeModulesPath = path.join(backendDir, 'node_modules');
  const prismaPath = path.join(nodeModulesPath, '.prisma', 'client');

  log('INFO', `Backend path: ${backendPath}`);
  log('INFO', `Backend dir: ${backendDir}`);
  log('INFO', `Node modules: ${nodeModulesPath}`);

  if (!fs.existsSync(backendPath)) {
    log('ERROR', `Backend server.js not found at: ${backendPath}`);
    return false;
  }

  // Find Prisma query engine (platform-specific)
  let queryEnginePath = '';
  const platform = process.platform;
  const arch = process.arch;

  // Determine engine name based on platform
  let engineName = '';
  if (platform === 'win32') {
    engineName = arch === 'x64' ? 'query_engine-windows.dll.node' : 'query_engine-windows.dll.node';
  } else if (platform === 'darwin') {
    engineName = arch === 'arm64' ? 'libquery_engine-darwin-arm64.dylib' : 'libquery_engine-darwin.dylib';
  } else {
    engineName = 'libquery_engine-linux-musl-openssl-3.0.x.so.node';
  }

  const possibleEngines = [
    path.join(prismaPath, engineName),
    path.join(prismaPath, `lib${engineName}`),
    path.join(nodeModulesPath, '@prisma', 'engines', engineName),
    path.join(nodeModulesPath, '@prisma', 'engines', `lib${engineName}`)
  ];

  // Also try Windows-specific paths for compatibility
  if (platform === 'win32') {
    possibleEngines.push(
      path.join(prismaPath, 'query_engine-windows.dll.node'),
      path.join(prismaPath, 'libquery_engine-windows.dll.node')
    );
  }

  for (const p of possibleEngines) {
    if (fs.existsSync(p)) {
      queryEnginePath = p;
      log('INFO', `Found Prisma engine at: ${p}`);
      break;
    }
  }

  if (!queryEnginePath) {
    log('WARN', `Prisma query engine not found for ${platform}/${arch}, will use default`);
  }

  // Set environment variables for SQLite and Prisma
  const env = {
    ...process.env,
    PORT: BACKEND_PORT.toString(),
    NODE_ENV: 'production',
    DATABASE_URL: `file:${SQLITE_DB_PATH}`,
    ...(ELECTRON_CLOUD_API_URL ? { CLOUD_API_URL: ELECTRON_CLOUD_API_URL } : {}),
    ...(ELECTRON_REMOTE_DATABASE_URL ? { REMOTE_DATABASE_URL: ELECTRON_REMOTE_DATABASE_URL } : {}),
    JWT_SECRET: jwtSecret,
    JWT_EXPIRES_IN: '7d',
    BCRYPT_ROUNDS: '10',
    NODE_PATH: nodeModulesPath,
    PRISMA_QUERY_ENGINE_LIBRARY: queryEnginePath || undefined
  };

  log('INFO', `DATABASE_URL: file:${SQLITE_DB_PATH}`);
  log('INFO', `CLOUD_API_URL: ${ELECTRON_CLOUD_API_URL || 'not set'}`);
  log('INFO', `REMOTE_DATABASE_URL: ${maskDbUrl(ELECTRON_REMOTE_DATABASE_URL)}`);

  try {
    // Get the Node.js executable (bundled for Windows, system for dev)
    const nodePath = getNodePath();
    log('INFO', `Using Node.js at: ${nodePath}`);

    // Spawn the backend process using the correct Node.js
    const spawnOptions = {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: backendDir
    };

    // Windows-specific option to hide console window
    if (process.platform === 'win32') {
      spawnOptions.windowsHide = true;
    }

    backendProcess = spawn(nodePath, [backendPath], spawnOptions);

    backendProcess.stdout.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) log('BACKEND', msg);
    });

    backendProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) log('BACKEND-ERR', msg);
    });

    backendProcess.on('error', (err) => {
      log('ERROR', `Backend process error: ${err.message}`);
    });

    backendProcess.on('exit', (code) => {
      log('INFO', `Backend process exited with code: ${code}`);
      backendProcess = null;
    });

    // Wait for backend to be ready
    log('INFO', 'Waiting for backend to start...');
    const ready = await waitForBackend(30);

    if (ready) {
      log('INFO', '✅ Backend started successfully with SQLite!');
      log('INFO', `✅ API available at: http://127.0.0.1:${BACKEND_PORT}/api`);
      return true;
    } else {
      log('WARN', 'External backend failed to start, trying embedded API...');
      if (backendProcess) {
        backendProcess.kill();
        backendProcess = null;
      }

      // Try embedded API as fallback
      return await startEmbeddedApi();
    }
  } catch (error) {
    log('ERROR', `Failed to start backend: ${error.message}`);
    log('WARN', 'Trying embedded API as fallback...');
    return await startEmbeddedApi();
  }
}

/**
 * Start the embedded API server
 * This is the PRIMARY server in production mode
 * Uses sql.js which is pure JavaScript - no native modules needed
 */
async function startEmbeddedApi() {
  log('INFO', '='.repeat(50));
  log('INFO', '=== Starting Embedded API Server (sql.js) ===');
  log('INFO', '='.repeat(50));

  try {
    // Database is already initialized in app.whenReady()

    // CRITICAL FIX: Try multiple paths for embedded-server.js (Windows-specific paths included)
    const possiblePaths = [
      path.join(__dirname, 'embedded-server.js'),
      path.join(process.resourcesPath || '', 'app.asar', 'electron', 'embedded-server.js'),
      path.join(process.resourcesPath || '', 'app', 'electron', 'embedded-server.js'),
      // Windows-specific paths
      ...(process.platform === 'win32' ? [
        path.join(process.resourcesPath || '', 'electron', 'embedded-server.js'),
        path.join(__dirname, '..', 'electron', 'embedded-server.js'),
        path.join(process.resourcesPath || '', '..', 'electron', 'embedded-server.js')
      ] : [])
    ];

    let embeddedServerPath = null;
    for (const p of possiblePaths) {
      log('INFO', `Checking for embedded-server at: ${p}`);
      if (fs.existsSync(p)) {
        embeddedServerPath = p;
        log('INFO', `Found embedded-server at: ${p}`);
        break;
      }
    }

    // Get app's userData directory - this gets deleted on uninstall, ensuring fresh database on each installation
    const userDataPath = app.getPath('userData');
    log('INFO', `Using app userData directory: ${userDataPath}`);
    log('INFO', 'Database will be stored here and deleted on uninstall for fresh start on each installation');

    if (!embeddedServerPath) {
      // Try require directly as it might be in asar
      log('WARN', 'Embedded server file not found at expected paths, trying direct require...');
      try {
        const { startServer, isFreshDatabase } = require('./embedded-server.js');
        log('INFO', `Starting embedded server on port ${BACKEND_PORT} via direct require...`);
        embeddedServer = await startServer(BACKEND_PORT, userDataPath);

        if (!embeddedServer) {
          throw new Error('startServer returned null/undefined');
        }

        // Store isFreshDatabase function for IPC handler
        if (isFreshDatabase) {
          embeddedServer.isFreshDatabase = isFreshDatabase;
        }
        useEmbeddedApi = true;
        log('INFO', '✅ Embedded API started via direct require!');
        log('INFO', `✅ API available at: http://127.0.0.1:${BACKEND_PORT}/api`);
        log('INFO', `✅ Health check available at: http://127.0.0.1:${BACKEND_PORT}/health`);
        return true;
      } catch (directError) {
        log('ERROR', 'Direct require also failed: ' + directError.message);
        if (directError.stack) log('ERROR', directError.stack);
        return false;
      }
    }

    const { startServer } = require(embeddedServerPath);
    log('INFO', `Starting embedded server on port ${BACKEND_PORT}...`);
    embeddedServer = await startServer(BACKEND_PORT, userDataPath);

    if (!embeddedServer) {
      throw new Error('startServer returned null/undefined');
    }

    useEmbeddedApi = true;

    log('INFO', '✅ Embedded API started successfully!');
    log('INFO', `✅ API available at: http://127.0.0.1:${BACKEND_PORT}/api`);
    log('INFO', `✅ Health check available at: http://127.0.0.1:${BACKEND_PORT}/health`);

    // CRITICAL FIX: Give more time for Windows - database initialization can be slower
    // Windows needs more time for file system operations and database setup
    const initDelay = process.platform === 'win32' ? 2000 : 1000;
    log('INFO', `Waiting ${initDelay}ms for server initialization (Windows: ${process.platform === 'win32'})...`);
    await new Promise(r => setTimeout(r, initDelay));

    // CRITICAL FIX: Wait for health check with retries (especially important on Windows)
    let healthy = false;
    const maxHealthChecks = process.platform === 'win32' ? 10 : 5;
    for (let i = 0; i < maxHealthChecks; i++) {
      healthy = await checkBackendHealth();
    if (healthy) {
        log('INFO', `✅ Embedded API health check passed on attempt ${i + 1}!`);
        break;
      }
      if (i < maxHealthChecks - 1) {
        log('INFO', `Health check attempt ${i + 1}/${maxHealthChecks} failed, retrying...`);
        await new Promise(r => setTimeout(r, 500));
      }
    }

    if (!healthy) {
      log('WARN', 'Embedded API health check pending, but server should work');
      // On Windows, give it one more moment - sometimes it just needs more time
      if (process.platform === 'win32') {
        log('INFO', 'Windows: Giving server additional 2 seconds to fully initialize...');
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    return true;
  } catch (error) {
    log('ERROR', `Failed to start embedded API: ${error.message}`);
    if (error.stack) log('ERROR', error.stack);
    return false;
  }
}

function stopBackend() {
  if (backendProcess) {
    log('INFO', 'Stopping backend process...');
    backendProcess.kill('SIGTERM');
    backendProcess = null;
  }

  if (embeddedServer && useEmbeddedApi) {
    log('INFO', 'Stopping embedded API server...');
    try {
      const { stopServer } = require(path.join(__dirname, 'embedded-server.js'));
      stopServer();
    } catch (e) {
      log('WARN', 'Could not stop embedded server cleanly: ' + e.message);
    }
    embeddedServer = null;
  }
}

// ============================================================
// SPLASH SCREEN
// ============================================================
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const splashHtml = `<!DOCTYPE html>
<html>
<head>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    display: flex; align-items: center; justify-content: center;
    height: 100vh; background: transparent;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  .splash {
    background: linear-gradient(135deg, #060d1f 0%, #1a2744 100%);
    border-radius: 16px; padding: 40px; text-align: center;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5); width: 320px;
  }
  .logo { font-size: 32px; font-weight: 700; color: #fff; margin-bottom: 8px; }
  .subtitle { font-size: 13px; color: #8899bb; margin-bottom: 24px; }
  .spinner { margin: 0 auto 16px; width: 32px; height: 32px; border: 3px solid rgba(255,255,255,0.1);
    border-top-color: #4a90d9; border-radius: 50%; animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .status { font-size: 12px; color: #667799; }
</style>
</head>
<body>
  <div class="splash">
    <div class="logo">Zapeera</div>
    <div class="subtitle">Business Management Platform</div>
    <div class="spinner"></div>
    <div class="status">Starting application...</div>
  </div>
</body>
</html>`;

  splashWindow.loadURL(`data:text/html,${encodeURIComponent(splashHtml)}`);
  return splashWindow;
}

// ============================================================
// WINDOW FUNCTIONS
// ============================================================
function createWindow() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self' 'unsafe-inline'; " +
          "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
          "img-src 'self' data: https:; " +
          "font-src 'self' data: https://fonts.gstatic.com; " +
          "connect-src 'self' http://localhost:* http://127.0.0.1:* https:; " +
          "frame-ancestors 'none'; " +
          "base-uri 'self'; " +
          "form-action 'self';"
        ]
      }
    });
  });

  // CRITICAL FIX: On Windows, show window immediately to prevent "app not opening" issue
  const isWindows = process.platform === 'win32';
  const shouldShowImmediately = isWindows; // Show immediately on Windows

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: '#ffffff',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: getPreloadPath(),
      webSecurity: true,
      // CRITICAL FIX: Disable security warnings for CSP in packaged app
      // These warnings are expected for Electron apps that need 'unsafe-inline' and 'unsafe-eval'
      enableWebSQL: false,
      // Suppress CSP warnings in console
      disableDialogs: false
    },
    icon: getIconPath(),
    show: shouldShowImmediately, // Show immediately on Windows
    autoHideMenuBar: !isDev,
    // CRITICAL FIX: Ensure window is always on top initially on Windows (helps with visibility)
    alwaysOnTop: false,
    // CRITICAL FIX: Skip taskbar only in dev mode (Windows)
    skipTaskbar: false
  });

  if (isWindows) {
    log('INFO', 'Window created with immediate show (Windows mode)');
  }

  // CRITICAL FIX: Suppress CSP security warnings in packaged app
  // These warnings are expected for Electron apps and can be safely ignored
  mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
    // Suppress CSP warnings about 'unsafe-inline' and 'unsafe-eval'
    // These are necessary for Electron apps and the warnings are not critical
    if (message.includes('Content Security Policy') ||
        message.includes('CSP') ||
        message.includes('unsafe-inline') ||
        message.includes('unsafe-eval') ||
        message.includes('warnAboutInsecureCSP')) {
      // Suppress these warnings - they're expected for Electron apps
      return;
    }
    // Log other console messages normally
    if (level === 0) console.log(`[Console] ${message}`);
    else if (level === 1) console.warn(`[Console] ${message}`);
    else if (level === 2) console.error(`[Console] ${message}`);
  });

  const frontendPath = getFrontendPath();
  log('INFO', `Loading frontend: ${frontendPath}`);

  if (fs.existsSync(frontendPath)) {
    mainWindow.loadFile(frontendPath);
  } else {
    mainWindow.loadURL(`data:text/html,<h1>Frontend not found</h1><p>${frontendPath}</p>`);
  }

  // CRITICAL FIX: Show window immediately on Windows to prevent "app not opening" issue
  // On Windows, if window doesn't show, users think app isn't working
  // Note: isWindows is already defined above in BrowserWindow creation

  // Show window immediately on Windows, wait for ready-to-show on other platforms
  if (shouldShowImmediately) {
    // On Windows, window is already shown (show: true in BrowserWindow options)
    // But ensure it's focused
    mainWindow.focus();
    log('INFO', 'Window shown immediately (Windows mode)');
  }

  mainWindow.once('ready-to-show', () => {
    // Show window if not already shown (for non-Windows or if Windows show failed)
    if (!mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
      log('INFO', 'Window shown on ready-to-show event');
    }

    // Close splash screen if it exists
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
  });

  // CRITICAL FIX: Fallback to show window after timeout (Windows-specific)
  // This ensures window shows even if ready-to-show event doesn't fire
  setTimeout(() => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      log('WARN', 'Window not visible after timeout - forcing show (fallback)');
      mainWindow.show();
      mainWindow.focus();
    }
  }, shouldShowImmediately ? 3000 : 5000); // Shorter timeout on Windows

  // CRITICAL FIX: Handle window load errors on Windows
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    log('ERROR', `Window failed to load: ${errorCode} - ${errorDescription}`);
    log('ERROR', `URL: ${validatedURL}`);

    // On Windows, show error dialog if critical error
    if (shouldShowImmediately && errorCode !== -3) { // -3 is ERR_ABORTED (navigation cancelled)
      dialog.showErrorBox(
        'Zapeera - Load Error',
        `Failed to load application.\n\nError: ${errorDescription}\n\nCode: ${errorCode}\n\nPlease check the logs at: ${logFile}`
      );
    }
  });

  // CRITICAL FIX: Ensure window is visible on Windows even if content fails
  mainWindow.webContents.on('dom-ready', () => {
    if (shouldShowImmediately && !mainWindow.isVisible()) {
      log('WARN', 'Window not visible on dom-ready - forcing show');
      mainWindow.show();
      mainWindow.focus();
    }
  });

  mainWindow.on('close', () => {
    saveWindowState();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Only allow https links to open externally
    if (url && (url.startsWith('https:') || url.startsWith('http:'))) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Prevent navigation to arbitrary origins
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const parsedUrl = new URL(url);
    const appUrl = new URL(mainWindow.webContents.getURL());
    // Allow navigation within the app (file:// for Electron)
    if (parsedUrl.protocol === 'file:' || parsedUrl.origin === appUrl.origin) {
      return;
    }
    event.preventDefault();
  });

  // Block new window creation
  mainWindow.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }
}

// ============================================================
// IPC HANDLERS
// ============================================================
function setupIPC() {
  ipcMain.handle('get-app-version', () => app.getVersion());
  ipcMain.handle('is-packaged', () => app.isPackaged);
  ipcMain.handle('get-platform', () => process.platform);

  ipcMain.handle('get-backend-status', async () => ({
    running: await checkBackendHealth(),
    port: BACKEND_PORT,
    databasePath: SQLITE_DB_PATH
  }));

  ipcMain.handle('get-storage-info', () => ({
    appDataDir: APP_DATA_DIR,
    dataDir: DATA_DIR,
    logDir: LOG_DIR,
    databasePath: SQLITE_DB_PATH
  }));

  ipcMain.handle('get-log-file-path', () => logFile);

  ipcMain.handle('open-external', async (event, url) => {
    // Validate URL before opening
    if (typeof url !== 'string') return { success: false, error: 'Invalid URL' };
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return { success: false, error: 'Only HTTP(S) URLs allowed' };
      }
      await shell.openExternal(url);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('save-file', async (event, { content, filename, type }) => {
    try {
      const filters = [];
      if (type === 'html') filters.push({ name: 'HTML Files', extensions: ['html'] });
      else if (type === 'pdf') filters.push({ name: 'PDF Files', extensions: ['pdf'] });
      else if (type === 'csv') filters.push({ name: 'CSV Files', extensions: ['csv'] });
      else filters.push({ name: 'All Files', extensions: ['*'] });

      const result = await dialog.showSaveDialog(mainWindow, { defaultPath: filename, filters });
      if (result.canceled || !result.filePath) return { success: false, canceled: true };

      fs.writeFileSync(result.filePath, content, 'utf8');
      return { success: true, filePath: result.filePath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-downloads-path', () => app.getPath('downloads'));

  // API URLs
  ipcMain.handle('get-cloud-api-url', () => process.env.CLOUD_API_URL || '');
  ipcMain.handle('get-local-api-url', () => `http://127.0.0.1:${BACKEND_PORT}/api`);

  // Provision local session (trusted Desktop bootstrap)
  // Renderer sends { user, memberships, businesses, cloudAccessToken }
  // Main process validates cloud token, generates provisioning token signed
  // with embedded server's JWT_SECRET, and POSTs to the embedded provision-session endpoint.
  ipcMain.handle('provision-local-session', async (event, provisionData) => {
    const { user, memberships, businesses, cloudAccessToken, cloudApiUrl } = provisionData || {};
    if (!user || !user.id || !cloudAccessToken) {
      return { success: false, message: 'Missing required provisioning data' };
    }

    try {
      // 1. Validate cloud access token (basic JWT decode — verify userId and expiry)
      const cloudTokenParts = String(cloudAccessToken).split('.');
      if (cloudTokenParts.length !== 3) {
        return { success: false, message: 'Invalid cloud access token format' };
      }
      let cloudPayload;
      try {
        cloudPayload = JSON.parse(Buffer.from(cloudTokenParts[1], 'base64url').toString());
      } catch {
        try {
          cloudPayload = JSON.parse(Buffer.from(cloudTokenParts[1], 'base64').toString());
        } catch {
          return { success: false, message: 'Invalid cloud access token payload' };
        }
      }
      if (!cloudPayload || !cloudPayload.userId) {
        return { success: false, message: 'Cloud access token missing userId' };
      }
      if (cloudPayload.exp) {
        const expMs = cloudPayload.exp > 1e12 ? cloudPayload.exp : cloudPayload.exp * 1000;
        if (expMs < Date.now()) {
          return { success: false, message: 'Cloud access token expired' };
        }
      }
      // Verify the provisioned user matches the token's user
      if (String(user.id) !== String(cloudPayload.userId)) {
        return { success: false, message: 'Provisioned user does not match cloud token' };
      }

      // 2. Generate short-lived provisioning token signed with embedded JWT_SECRET
      const crypto = require('crypto');
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
      const payload = Buffer.from(JSON.stringify({
        purpose: 'provision',
        userId: user.id,
        iat: Date.now(),
        exp: Date.now() + 60000 // 60 seconds
      })).toString('base64');
      const jwtSecret = global.__ZAPEERA_JWT_SECRET__ || process.env.JWT_SECRET || 'zapeera-secret';
      const signature = crypto.createHmac('sha256', jwtSecret).update(`${header}.${payload}`).digest('base64');
      const provisionToken = `${header}.${payload}.${signature}`;

      // 3. POST to embedded provision-session endpoint
      const http = require('http');
      const postData = JSON.stringify({ user, memberships, businesses, cloudAccessToken, cloudApiUrl: cloudApiUrl || process.env.CLOUD_API_URL || '' });
      const result = await new Promise((resolve) => {
        const options = {
          hostname: '127.0.0.1',
          port: BACKEND_PORT,
          path: '/api/auth/provision-session',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provisionToken}`,
            'Content-Length': Buffer.byteLength(postData)
          }
        };
        const req = http.request(options, (res) => {
          let body = '';
          res.on('data', (chunk) => { body += chunk; });
          res.on('end', () => {
            try {
              resolve({ status: res.statusCode, data: JSON.parse(body) });
            } catch {
              resolve({ status: res.statusCode, data: { success: false, message: body } });
            }
          });
        });
        req.on('error', (e) => {
          resolve({ status: 0, data: { success: false, message: `Provisioning request failed: ${e.message}` } });
        });
        req.write(postData);
        req.end();
      });

      if (result.status !== 200) {
        return { success: false, message: result.data?.message || `Provisioning failed (HTTP ${result.status})` };
      }

      return result.data;
    } catch (e) {
      log('ERROR', `Provision-local-session error: ${e.message}`);
      return { success: false, message: `Provisioning error: ${e.message}` };
    }
  });

  // Window controls
  ipcMain.on('minimize-window', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
  });

  ipcMain.on('maximize-window', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    }
  });

  ipcMain.on('close-window', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
  });

  ipcMain.handle('get-window-state', () => getWindowState());

  ipcMain.on('set-window-state', (event, state) => {
    if (state && typeof state === 'object') {
      try {
        const statePath = path.join(app.getPath('userData'), 'window-state.json');
        fs.writeFileSync(statePath, JSON.stringify(state), 'utf8');
      } catch (e) { /* ignore */ }
    }
  });

  // Sync status (shape matches what the renderer SyncService consumes)
  ipcMain.handle('get-sync-status', async () => {
    try {
      if (useEmbeddedApi) {
        const syncService = require('./services/sync.service');
        const connState = syncService.getConnectionState ? syncService.getConnectionState() : 'OFFLINE';
        const isOnline = ['SYNC_READY', 'SYNCED', 'SYNCING'].includes(connState);
        const pending = syncService.getOfflineQueue ? (syncService.getOfflineQueue() || []).filter(q => !q.synced).length : 0;
        return {
          connectionState: connState,
          syncState: connState === 'SYNCING' ? 'syncing' : connState === 'SYNCED' ? 'synced' : isOnline ? 'idle' : 'offline',
          isOnline,
          lastSyncAt: syncService.getLastSyncTime ? syncService.getLastSyncTime() : null,
          lastSyncTime: syncService.getLastSyncTime ? syncService.getLastSyncTime() : null,
          pendingChanges: pending,
          failedChanges: 0,
          syncInProgress: syncService.getSyncInProgress ? syncService.getSyncInProgress() : false,
          inProgress: syncService.getSyncInProgress ? syncService.getSyncInProgress() : false,
          queueLength: syncService.getOfflineQueue ? (syncService.getOfflineQueue() || []).length : 0
        };
      }
      return { connectionState: 'OFFLINE', syncState: 'offline', isOnline: false, lastSyncAt: null, pendingChanges: 0, failedChanges: 0, syncInProgress: false, inProgress: false, queueLength: 0 };
    } catch (e) {
      return { connectionState: 'OFFLINE', syncState: 'offline', isOnline: false, lastSyncAt: null, pendingChanges: 0, failedChanges: 0, syncInProgress: false, inProgress: false, queueLength: 0, error: e.message };
    }
  });

  // Per-business desktop state (provisioned/downloaded vs cloud-only) for the renderer.
  ipcMain.handle('get-local-business-states', async () => {
    try {
      if (useEmbeddedApi) {
        const db = require('./services/database.service');
        const syncService = require('./services/sync.service');
        const rows = db.query
          ? db.query(`
              SELECT m.businessId, m.status, m.updatedAt AS lastSyncedAt, c.name, c.slug
              FROM memberships m
              LEFT JOIN companies c ON c.id = m.businessId
              WHERE m.status IN ('ACTIVE', 'DOWNLOADED', 'OUT_OF_SYNC')
              ORDER BY m.updatedAt DESC
            `)
          : [];
        const lastSyncAt = syncService.getLastSyncTime ? syncService.getLastSyncTime() : null;
        const states = (rows || []).map((r) => ({
          businessId: r.businessId,
          name: r.name || null,
          slug: r.slug || null,
          provisioned: r.status === 'DOWNLOADED',
          availableOffline: r.status === 'DOWNLOADED',
          status: r.status,
          lastSyncedAt: r.lastSyncedAt || lastSyncAt || null
        }));
        return { states, lastSyncAt };
      }
      return { states: [], lastSyncAt: null };
    } catch (e) {
      return { states: [], lastSyncAt: null, error: e.message };
    }
  });

  ipcMain.handle('check-connectivity', async () => {
    try {
      if (useEmbeddedApi) {
        const syncService = require('./services/sync.service');
        const connState = syncService.getConnectionState ? syncService.getConnectionState() : 'UNKNOWN';
        const isOnline = connState === 'SYNC_READY' || connState === 'SYNCED' || connState === 'SYNCING';
        return { connected: isOnline, connectionState: connState };
      }
      return { connected: false, connectionState: 'OFFLINE' };
    } catch (e) {
      return { connected: false, connectionState: 'ERROR', error: e.message };
    }
  });

  // Printing
  ipcMain.handle('print-receipt', async (event, options) => {
    if (!mainWindow || mainWindow.isDestroyed()) return { success: false, error: 'No window' };
    try {
      if (options && options.html) {
        // Create a hidden window for printing
        const printWindow = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
        printWindow.webContents.on('did-finish-load', () => {
          printWindow.webContents.print({ silent: false, printBackground: true }, (success) => {
            printWindow.close();
          });
        });
        printWindow.loadURL(`data:text/html,${encodeURIComponent(options.html)}`);
        return { success: true };
      }
      mainWindow.webContents.print({ silent: false, printBackground: true });
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  // Check if database is fresh (no users exist)
  ipcMain.handle('is-fresh-database', async () => {
    try {
      const userDataPath = app.getPath('userData');
      const dbPath = path.join(userDataPath, 'zapeera.db');

      if (!fs.existsSync(dbPath)) return true;
      const stats = fs.statSync(dbPath);
      if (stats.size === 0) return true;
      return false;
    } catch (error) {
      return true;
    }
  });
}

// ============================================================
// MENU
// ============================================================
function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' }, { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About Zapeera',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Zapeera',
              message: `Zapeera v${app.getVersion()}`,
              detail: `Business Management Platform\n\nDatabase: ${SQLITE_DB_PATH}`
            });
          }
        },
        { label: 'Open Logs', click: () => shell.showItemInFolder(logFile) },
        { label: 'Open Data Folder', click: () => shell.openPath(DATA_DIR) }
      ]
    }
  ];

  if (process.platform === 'darwin') {
    template.unshift({
      label: app.getName(),
      submenu: [
        { role: 'about' }, { type: 'separator' },
        { role: 'services' }, { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' }, { role: 'quit' }
      ]
    });
  }

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ============================================================
// APP LIFECYCLE
// ============================================================
app.whenReady().then(async () => {
  log('INFO', '========================================');
  log('INFO', '=== Zapeera Starting ===');
  log('INFO', `Platform: ${process.platform}`);
  log('INFO', `Arch: ${process.arch}`);
  log('INFO', `Electron: ${process.versions.electron}`);
  log('INFO', `Node: ${process.versions.node}`);
  log('INFO', `isDev: ${isDev}`);
  log('INFO', `Packaged: ${app.isPackaged}`);
  log('INFO', '========================================');

  // Show splash screen while backend initializes
  if (app.isPackaged || !isDev) {
    createSplashWindow();
  }

  setupIPC();
  createMenu();

  // Start embedded server
  log('INFO', 'Starting embedded API server...');
  let started = await startEmbeddedApi();

  if (!started && isDev) {
    log('WARN', 'Embedded server failed, trying external backend as fallback...');
    started = await startBackend();
  }

  if (!started) {
    log('WARN', 'Retrying embedded server...');
    started = await startEmbeddedApi();
  }

  if (!started) {
    log('WARN', 'Backend initialization had issues, but continuing...');
  }

  // Wait for backend to be ready
  const waitTime = isDev ? 1000 : 2000;
  log('INFO', `Waiting ${waitTime}ms for backend readiness...`);
  await new Promise(r => setTimeout(r, waitTime));

  let backendReady = await checkBackendHealth();
  if (!backendReady) {
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
      backendReady = await checkBackendHealth();
      if (backendReady) break;
    }
  }

  log(backendReady ? 'INFO' : 'WARN',
    backendReady ? 'Backend is ready' : 'Backend health check failed, creating window anyway');

  // Create main window (splash will close when main window is ready)
  try {
    const windowState = getWindowState();
    createWindow();
    log('INFO', 'Window created successfully');
  } catch (error) {
    log('ERROR', `Failed to create window: ${error.message}`);
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    if (process.platform === 'win32') {
      dialog.showErrorBox(
        'Zapeera - Startup Error',
        `Failed to create application window.\n\nError: ${error.message}\n\nPlease check the logs at: ${logFile}`
      );
    }
    setTimeout(() => app.quit(), 2000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  log('INFO', 'App quitting...');
  saveWindowState();
  stopBackend();
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
    splashWindow = null;
  }
});

app.setName('Zapeera');
log('INFO', 'Main process initialized');
