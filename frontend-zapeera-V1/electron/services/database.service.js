/**
 * Core Database Service
 * SQLite-only database operations for Desktop.
 * PostgreSQL is NEVER accessed directly from Desktop.
 */

const fs = require('fs');
const path = require('path');
const { uuid, now, normalizeValue } = require('../utils/helpers');
const { setDatabasePath: setDbPath, getDatabasePath, getDataDir } = require('../config/database.config');

let db = null;
let SQL = null;
let lastDbError = null;

async function loadSqlJs() {
  if (SQL) return SQL;

  const possiblePaths = [
    // Development paths
    path.join(__dirname, '..', 'node_modules', 'sql.js'),
    path.join(__dirname, 'node_modules', 'sql.js'),
    // Production paths (inside app.asar)
    path.join(process.resourcesPath || '', 'app.asar', 'node_modules', 'sql.js'),
    path.join(process.resourcesPath || '', 'app', 'node_modules', 'sql.js'),
    // Production - backend node_modules (also bundled)
    path.join(process.resourcesPath || '', 'zapeera-backend', 'node_modules', 'sql.js'),
    // Try global require
    'sql.js'
  ];

  for (const p of possiblePaths) {
    try {
      console.log('[SQL.js] Trying:', p);
      const initSqlJs = require(p);
      SQL = await initSqlJs();
      console.log('[SQL.js] ✅ Loaded successfully from:', p);
      return SQL;
    } catch (e) {
      console.log('[SQL.js] ❌ Failed:', p, '-', e.message);
      continue;
    }
  }

  throw new Error('Could not load sql.js from any path');
}

async function initDatabase() {
  try {
    await loadSqlJs();
  } catch (e) {
    console.error('[DB] Failed to load sql.js:', e.message);
    throw e;
  }

  // Load existing database or create new one
  const DB_PATH = getDatabasePath();
  let dbData = null;
  if (fs.existsSync(DB_PATH)) {
    try {
      dbData = fs.readFileSync(DB_PATH);
      console.log('[DB] Loaded existing database from:', DB_PATH);
    } catch (e) {
      console.log('[DB] Could not load existing database, creating new one');
    }
  } else {
    console.log('[DB] Database file does not exist, creating FRESH database');
    console.log('[DB] This is normal on first run or after uninstall/reinstall');
    console.log('[DB] Fresh database ensures clean start for each installation');
  }

  db = new SQL.Database(dbData);

  // Run migrations for existing databases
  const migrations = [
    // Add username column to users table if it doesn't exist
    `ALTER TABLE users ADD COLUMN username TEXT`,
    // Add sessionToken column if it doesn't exist
    `ALTER TABLE users ADD COLUMN sessionToken TEXT`,
    // Add lastLoginAt column if it doesn't exist
    `ALTER TABLE users ADD COLUMN lastLoginAt TEXT`,
    // Add password reset token columns if they don't exist
    `ALTER TABLE users ADD COLUMN passwordResetToken TEXT`,
    `ALTER TABLE users ADD COLUMN passwordResetExpires TEXT`
  ];

  for (const migration of migrations) {
    try {
      db.run(migration);
      console.log('[DB] Migration applied:', migration.substring(0, 50) + '...');
    } catch (e) {
      // Column already exists or table doesn't exist yet - that's fine
      if (!e.message.includes('duplicate column') && !e.message.includes('no such table')) {
        // Only log if it's not a duplicate column error
      }
    }
  }

  // Update existing users: set username = email where username is null
  try {
    db.run("UPDATE users SET username = email WHERE username IS NULL");
    console.log('[DB] Updated users: username = email where null');
  } catch (e) {
    // Table might not exist yet
  }

  // Create all tables
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, username TEXT, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, name TEXT NOT NULL,
      role TEXT DEFAULT 'ADMIN', isActive INTEGER DEFAULT 0, companyId TEXT, branchId TEXT,
      createdBy TEXT, sessionToken TEXT, passwordResetToken TEXT, passwordResetExpires TEXT, lastLoginAt TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT, address TEXT, phone TEXT, email TEXT,
      businessType TEXT DEFAULT 'PHARMACY', isActive INTEGER DEFAULT 1, createdBy TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS branches (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT, phone TEXT, email TEXT, companyId TEXT NOT NULL,
      managerId TEXT, isActive INTEGER DEFAULT 1, createdBy TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, type TEXT DEFAULT 'GENERAL',
      color TEXT DEFAULT '#3B82F6', branchId TEXT, companyId TEXT,
      isActive INTEGER DEFAULT 1, createdBy TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, genericName TEXT, sku TEXT, barcode TEXT, description TEXT,
      categoryId TEXT, branchId TEXT, companyId TEXT, unitPrice REAL DEFAULT 0, costPrice REAL DEFAULT 0, sellingPrice REAL DEFAULT 0,
      quantity INTEGER DEFAULT 0, minStock INTEGER DEFAULT 10, maxStock INTEGER DEFAULT 1000, unitsPerPack INTEGER DEFAULT 1,
      reorderLevel INTEGER DEFAULT 20, requiresPrescription INTEGER DEFAULT 0, unitType TEXT DEFAULT 'PIECE',
      manufacturerId TEXT, supplierId TEXT, shelfId TEXT, expiryDate TEXT, manufacturingDate TEXT, batchNumber TEXT,
      isActive INTEGER DEFAULT 1, createdBy TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, phone TEXT, address TEXT, branchId TEXT, companyId TEXT,
      loyaltyPoints INTEGER DEFAULT 0, isActive INTEGER DEFAULT 1, createdBy TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS suppliers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, contactPerson TEXT, phone TEXT, email TEXT, address TEXT,
      manufacturerId TEXT, branchId TEXT, companyId TEXT, isActive INTEGER DEFAULT 1, createdBy TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS manufacturers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, website TEXT, country TEXT,
      branchId TEXT, companyId TEXT, isActive INTEGER DEFAULT 1, createdBy TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS shelves (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, location TEXT,
      branchId TEXT, companyId TEXT, isActive INTEGER DEFAULT 1, createdBy TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS batches (
      id TEXT PRIMARY KEY, batchNo TEXT NOT NULL, productId TEXT NOT NULL, branchId TEXT NOT NULL, companyId TEXT NOT NULL,
      supplierId TEXT, supplierName TEXT, barcode TEXT, totalBoxes INTEGER DEFAULT 0, unitsPerBox INTEGER DEFAULT 0,
      quantity INTEGER DEFAULT 0, purchasePrice REAL DEFAULT 0, sellingPrice REAL DEFAULT 0, stockPurchasePrice REAL DEFAULT 0,
      paidAmount REAL DEFAULT 0, supplierOutstanding REAL DEFAULT 0, supplierInvoiceNo TEXT, purchasingMethod TEXT,
      expireDate TEXT, productionDate TEXT, shelfId TEXT, shelfName TEXT, isActive INTEGER DEFAULT 1, isReported INTEGER DEFAULT 0, reportReason TEXT,
      createdBy TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY, invoiceNumber TEXT, receiptNumber TEXT, customerId TEXT, branchId TEXT, companyId TEXT,
      totalAmount REAL DEFAULT 0, discount REAL DEFAULT 0, tax REAL DEFAULT 0, grandTotal REAL DEFAULT 0,
      paidAmount REAL DEFAULT 0, returnedAmount REAL DEFAULT 0,
      paymentMethod TEXT DEFAULT 'CASH', paymentStatus TEXT DEFAULT 'PAID', status TEXT DEFAULT 'COMPLETED',
      notes TEXT, employeeId TEXT, createdBy TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS sale_items (
      id TEXT PRIMARY KEY, saleId TEXT NOT NULL, productId TEXT NOT NULL, batchId TEXT,
      quantity INTEGER DEFAULT 1, unitPrice REAL DEFAULT 0, discount REAL DEFAULT 0, total REAL DEFAULT 0,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY, purchaseNumber TEXT, invoiceNo TEXT, supplierId TEXT, branchId TEXT, companyId TEXT,
      totalAmount REAL DEFAULT 0, paidAmount REAL DEFAULT 0, discount REAL DEFAULT 0, tax REAL DEFAULT 0, grandTotal REAL DEFAULT 0,
      paymentStatus TEXT DEFAULT 'PENDING', status TEXT DEFAULT 'PENDING', notes TEXT, purchaseDate TEXT, createdBy TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS purchase_items (
      id TEXT PRIMARY KEY, purchaseId TEXT NOT NULL, productId TEXT NOT NULL, batchId TEXT,
      quantity INTEGER DEFAULT 1, unitPrice REAL DEFAULT 0, total REAL DEFAULT 0,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY, employeeId TEXT, name TEXT NOT NULL, email TEXT, phone TEXT, address TEXT,
      position TEXT, department TEXT, status TEXT DEFAULT 'ACTIVE',
      salary REAL DEFAULT 0, hireDate TEXT, branchId TEXT, companyId TEXT, userId TEXT,
      isActive INTEGER DEFAULT 1, createdBy TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS refunds (
      id TEXT PRIMARY KEY, saleId TEXT NOT NULL, amount REAL DEFAULT 0, reason TEXT,
      branchId TEXT, companyId TEXT, status TEXT DEFAULT 'COMPLETED', createdBy TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS settings (
      id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, value TEXT, branchId TEXT, companyId TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS attendance (
      id TEXT PRIMARY KEY, employeeId TEXT NOT NULL, date TEXT, checkIn TEXT, checkOut TEXT,
      status TEXT DEFAULT 'PRESENT', notes TEXT, branchId TEXT, companyId TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS shifts (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, startTime TEXT, endTime TEXT, isActive INTEGER DEFAULT 1,
      branchId TEXT, companyId TEXT, createdBy TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS scheduled_shifts (
      id TEXT PRIMARY KEY, shiftId TEXT, date TEXT, branchId TEXT, companyId TEXT,
      createdBy TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS scheduled_shift_users (
      id TEXT PRIMARY KEY, scheduledShiftId TEXT, userId TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS commissions (
      id TEXT PRIMARY KEY, userId TEXT, saleId TEXT, amount REAL DEFAULT 0, percentage REAL DEFAULT 0,
      status TEXT DEFAULT 'PENDING', branchId TEXT, companyId TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS receipts (
      id TEXT PRIMARY KEY, saleId TEXT, receiptNumber TEXT, amount REAL DEFAULT 0, paymentMethod TEXT,
      userId TEXT, branchId TEXT, companyId TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS refund_items (
      id TEXT PRIMARY KEY, refundId TEXT NOT NULL, saleItemId TEXT, productId TEXT, quantity INTEGER DEFAULT 1,
      amount REAL DEFAULT 0, reason TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS stock_movements (
      id TEXT PRIMARY KEY, productId TEXT NOT NULL, type TEXT, quantity INTEGER DEFAULT 0,
      reason TEXT, referenceId TEXT, referenceType TEXT, branchId TEXT, companyId TEXT, createdBy TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS card_details (
      id TEXT PRIMARY KEY, saleId TEXT, cardType TEXT, lastFourDigits TEXT, approvalCode TEXT,
      amount REAL DEFAULT 0, userId TEXT, branchId TEXT, companyId TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY, companyId TEXT, plan TEXT DEFAULT 'BASIC', status TEXT DEFAULT 'ACTIVE',
      startDate TEXT, endDate TEXT, amount REAL DEFAULT 0,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS device_activation (
      id TEXT PRIMARY KEY, deviceId TEXT UNIQUE NOT NULL, fingerprint TEXT,
      status TEXT DEFAULT 'ACTIVE', licenseKey TEXT, userId TEXT, companyId TEXT, branchId TEXT,
      activatedBy TEXT, activatedAt TEXT, lastVerifiedAt TEXT, lastVerifiedStatus TEXT DEFAULT 'ACTIVE',
      offlineAccessExpiresAt TEXT, platform TEXT, hostname TEXT, macAddress TEXT,
      notes TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, token TEXT UNIQUE NOT NULL, userId TEXT NOT NULL, deviceId TEXT,
      status TEXT DEFAULT 'ACTIVE', expiresAt TEXT, offlineExpiresAt TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS local_identity (
      id TEXT PRIMARY KEY, cloudUserId TEXT NOT NULL, displayName TEXT, email TEXT, username TEXT,
      lastAuthenticatedAt TEXT, lastCloudValidationAt TEXT, offlineAccessAllowed INTEGER DEFAULT 1,
      localStateVersion INTEGER DEFAULT 1, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS memberships (
      id TEXT PRIMARY KEY, userId TEXT NOT NULL, businessId TEXT NOT NULL, businessName TEXT,
      businessType TEXT, role TEXT, branchIds TEXT, subscriptionPlan TEXT, subscriptionStatus TEXT,
      status TEXT DEFAULT 'ACTIVE', createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS sync_operations (
      id TEXT PRIMARY KEY, businessId TEXT, branchId TEXT, entityType TEXT NOT NULL,
      entityId TEXT, operation TEXT NOT NULL, payload TEXT NOT NULL,
      idempotencyKey TEXT UNIQUE, status TEXT DEFAULT 'PENDING',
      attemptCount INTEGER DEFAULT 0, lastError TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  let tablesCreated = 0;
  let tablesErrors = 0;

  tables.forEach((sql, index) => {
    try {
      db.run(sql);
      tablesCreated++;
      if (index < 5 || index === tables.length - 1) {
        console.log(`[DB] ✅ Table ${index + 1}/${tables.length} created`);
      }
    } catch (e) {
      // Only log if it's not a "table already exists" error
      if (!e.message.includes('already exists') && !e.message.includes('duplicate')) {
        console.error(`[DB] ❌ Table creation error (${index + 1}):`, e.message);
        tablesErrors++;
      } else {
        tablesCreated++; // Table exists, count as success
      }
    }
  });

  saveDatabase();
  console.log(`[DB] ✅ Database initialized: ${tablesCreated}/${tables.length} tables ready`);

  // Verify database is working by testing a query
  try {
    const testQuery = query('SELECT COUNT(*) as count FROM users');
    const userCount = testQuery[0]?.count || 0;
    console.log(`[DB] ✅ Database test successful - SQLite is working`);
    console.log(`[DB] ✅ Users table accessible - ${userCount} users found`);

    // CRITICAL: Detect if this is a fresh database (no users = fresh install)
    if (userCount === 0) {
      console.log('[DB] 🆕 FRESH DATABASE DETECTED - This is a new installation');
      console.log('[DB] 🆕 localStorage will be cleared to prevent auto-login');
      console.log('[DB] 🆕 User will need to login fresh');
    }
  } catch (e) {
    console.error('[DB] ❌ Database test failed:', e.message);
    console.error('[DB] ❌ SQLite may not be working properly');
  }

  // Test a few more critical tables
  const criticalTables = ['companies', 'branches', 'products', 'sales'];
  criticalTables.forEach(table => {
    try {
      query(`SELECT COUNT(*) as count FROM ${table}`);
      console.log(`[DB] ✅ ${table} table accessible`);
    } catch (e) {
      console.error(`[DB] ❌ ${table} table error:`, e.message);
    }
  });

  // Auto-activate device for local use
  try {
    const deviceId = getDeviceId();
    const deviceInfo = getDeviceInfo();
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 10); // 10 years offline access

    // Check if device already activated
    const existing = query('SELECT * FROM device_activation WHERE deviceId = ?', [deviceId]);

    if (!existing || existing.length === 0) {
      // Auto-register and activate device
      run(`
        INSERT INTO device_activation
        (id, deviceId, fingerprint, platform, hostname, status, lastVerifiedAt, lastVerifiedStatus, offlineAccessExpiresAt, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, 'ACTIVE', datetime('now'), 'ACTIVE', ?, datetime('now'), datetime('now'))
      `, [
        'local-' + deviceId,
        deviceId,
        deviceInfo.fingerprint || '',
        deviceInfo.platform || '',
        deviceInfo.hostname || '',
        expiryDate.toISOString()
      ]);
      console.log('[DB] ✅ Device auto-activated for local use');
    } else {
      // Update existing device to ACTIVE if not already
      if (existing[0].status !== 'ACTIVE') {
        run(`
          UPDATE device_activation
          SET status = 'ACTIVE', lastVerifiedStatus = 'ACTIVE', lastVerifiedAt = datetime('now'),
              offlineAccessExpiresAt = ?
          WHERE deviceId = ?
        `, [expiryDate.toISOString(), deviceId]);
        console.log('[DB] ✅ Device status updated to ACTIVE');
      }
    }
  } catch (e) {
    console.log('[DB] Device auto-activation warning:', e.message);
    // Continue anyway - activation check will handle it
  }

  // Add missing columns to existing tables (migration) - Match PostgreSQL schema
  const columnMigrations = [
    // Categories
    'ALTER TABLE categories ADD COLUMN type TEXT DEFAULT "GENERAL"',
    'ALTER TABLE categories ADD COLUMN color TEXT DEFAULT "#3B82F6"',
    // Products
    'ALTER TABLE products ADD COLUMN sellingPrice REAL DEFAULT 0',
    'ALTER TABLE products ADD COLUMN expiryDate TEXT',
    'ALTER TABLE products ADD COLUMN manufacturingDate TEXT',
    'ALTER TABLE products ADD COLUMN batchNumber TEXT',
    'ALTER TABLE products ADD COLUMN formula TEXT',
    // Employees
    'ALTER TABLE employees ADD COLUMN department TEXT',
    'ALTER TABLE employees ADD COLUMN employeeId TEXT',
    // Companies
    'ALTER TABLE companies ADD COLUMN website TEXT',
    // Users
    'ALTER TABLE users ADD COLUMN profileImage TEXT',
    // Sales
    'ALTER TABLE sales ADD COLUMN receiptNumber TEXT',
    // Batches
    'ALTER TABLE batches ADD COLUMN isActive INTEGER DEFAULT 1',
    // Customers
    'ALTER TABLE customers ADD COLUMN isVIP INTEGER DEFAULT 0',
    'ALTER TABLE customers ADD COLUMN totalPurchases REAL DEFAULT 0',
    'ALTER TABLE customers ADD COLUMN lastVisit TEXT'
  ];

  columnMigrations.forEach(sql => {
    try { db.run(sql); } catch (e) { /* Column might already exist */ }
  });

  saveDatabase();
  console.log('[DB] ✅ Migrations applied');

  // Create indexes for sessions and device_activation
  try {
    db.run('CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)');
    db.run('CREATE INDEX IF NOT EXISTS idx_sessions_userId ON sessions(userId)');
    db.run('CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)');
    db.run('CREATE INDEX IF NOT EXISTS idx_device_activation_deviceId ON device_activation(deviceId)');
    db.run('CREATE INDEX IF NOT EXISTS idx_device_activation_userId ON device_activation(userId)');
    db.run('CREATE INDEX IF NOT EXISTS idx_memberships_userId ON memberships(userId)');
    db.run('CREATE INDEX IF NOT EXISTS idx_memberships_businessId ON memberships(businessId)');
    db.run('CREATE INDEX IF NOT EXISTS idx_sync_operations_status ON sync_operations(status)');
    db.run('CREATE INDEX IF NOT EXISTS idx_sync_operations_idempotency ON sync_operations(idempotencyKey)');
    db.run('CREATE INDEX IF NOT EXISTS idx_local_identity_cloudUserId ON local_identity(cloudUserId)');
  } catch (e) {
    console.log('[DB] Index creation warning:', e.message);
  }

  saveDatabase();

  // Create default admin user
  createDefaultAdmin();
}

function saveDatabase() {
  if (db) {
    try {
      const data = db.export();
      const DB_PATH = getDatabasePath();
      fs.writeFileSync(DB_PATH, Buffer.from(data));
    } catch (e) {
      console.error('[DB] Save error:', e.message);
    }
  }
}

function query(sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) results.push(stmt.getAsObject());
    stmt.free();
    return results;
  } catch (e) {
    console.error('[DB Query Error]', sql, e.message);
    return [];
  }
}

function run(sql, params = []) {
  try {
    // Use prepare/step/free pattern for better error handling
    const stmt = db.prepare(sql);
    if (params && params.length > 0) {
      stmt.bind(params);
    }
    stmt.step();
    stmt.free();

    // Save to disk after successful execution
    saveDatabase();
    lastDbError = null;
    return true;
  } catch (e) {
    const errorMsg = e.message || 'Unknown database error';
    console.error('[DB Run Error] SQL:', sql.substring(0, 200));
    console.error('[DB Run Error] Params count:', params ? params.length : 0);
    console.error('[DB Run Error] Params:', params);
    console.error('[DB Run Error] Error:', errorMsg);
    console.error('[DB Run Error] Full error:', e);

    // For debugging: also log the SQL with placeholders replaced (first few only)
    try {
      let debugSql = sql;
      if (params && params.length > 0) {
        let paramIndex = 0;
        debugSql = debugSql.replace(/\?/g, () => {
          if (paramIndex < params.length) {
            const param = params[paramIndex++];
            const value = param === null ? 'NULL' : (typeof param === 'string' ? `'${param.substring(0, 50)}'` : String(param));
            return value;
          }
          return '?';
        });
        console.error('[DB Run Error] Debug SQL (first 500 chars):', debugSql.substring(0, 500));
      }
    } catch (debugError) {
      // Ignore debug errors
    }

    lastDbError = errorMsg;
    return false;
  }
}

async function getActiveDatabase() {
  // CRITICAL: OFFLINE-FIRST APPROACH
  // SQLite is PRIMARY database - all data is stored locally
  // PostgreSQL is OPTIONAL - used for sync when available
  // When offline, SQLite works independently with all synced data
  
  // CRITICAL FIX: Use cached result if available and recent (within 10 seconds)
  // This prevents multiple connection checks when multiple routes call this simultaneously
  const now = Date.now();
  if (cachedDbType && (now - cachedDbTypeTimestamp) < DB_TYPE_CACHE_DURATION) {
    // Return cached result without logging (reduce noise)
    return cachedDbType;
  }

  // CRITICAL: Use lazy-loaded sync service to avoid circular dependency
  const syncService = getSyncService();
  const pgClient = syncService.getPgClient();
  const isOnline = syncService.getIsOnline();

  // CRITICAL FIX: OFFLINE-FIRST - Always prefer SQLite unless PostgreSQL is confirmed online
  // This ensures app works offline with all synced data from SQLite
  let pgAvailable = false;
  if (pgClient && isOnline) {
    // Quick check - don't do full connection check
    // If client exists and isOnline is true, assume it's available
    // This prevents multiple connection attempts from different routes
    pgAvailable = true;
  } else {
    // No cached client or not online - use SQLite (OFFLINE MODE)
    // SQLite has all synced data and works independently
    pgAvailable = false;
  }

  const dbType = pgAvailable ? 'postgresql' : 'sqlite';

  // Cache the result (CRITICAL: This prevents repeated checks)
  cachedDbType = dbType;
  cachedDbTypeTimestamp = now;

  // Log when switching to offline mode (helpful for debugging)
  if (dbType === 'sqlite' && pgClient) {
    console.log('[DB] 🔌 Using SQLite (offline mode) - all synced data available locally');
  }

  return dbType;
}

async function insertIntoActiveDatabase(tableName, data) {
  console.log(`[DB] insertIntoActiveDatabase called for table: ${tableName}`);
  console.log(`[DB] Data keys:`, Object.keys(data));

  const dbType = await getActiveDatabase();
  console.log(`[DB] Active database type: ${dbType}`);

  if (dbType === 'postgresql') {
    // Use PostgreSQL - reuse existing connection (don't force new connection)
    const syncService = getSyncService();
    const client = await syncService.connectPostgreSQL(false); // Don't force - reuse existing
    if (!client) {
      console.log(`[DB] ❌ PostgreSQL client not available, falling back to SQLite`);
      // Fallback to SQLite if PostgreSQL connection fails
      return insertIntoSqlite(tableName, data);
    }

    console.log(`[DB] ✅ PostgreSQL client obtained`);

    try {
      // Step 1: Get PostgreSQL columns
      console.log(`[DB] Getting PostgreSQL columns for table: ${tableName}`);
      const pgColumns = await getPostgreSQLColumns(tableName, client);
      if (!pgColumns || pgColumns.length === 0) {
        console.log(`[DB] ❌ Table ${tableName} not found in PostgreSQL, using SQLite`);
        return insertIntoSqlite(tableName, data);
      }
      console.log(`[DB] PostgreSQL columns (${pgColumns.length}):`, pgColumns.slice(0, 10).join(', '), '...');

      // Step 2: Map SQLite data to PostgreSQL format (handles column name conversion, data type conversion, etc.)
      console.log(`[DB] Mapping data for PostgreSQL...`);
      const mapped = mapRowForPostgreSQL(tableName, data);
      console.log(`[DB] Mapped data keys:`, Object.keys(mapped));

      // Step 3: Filter data to only include columns that exist in PostgreSQL
      const columns = Object.keys(mapped).filter(c => pgColumns.includes(c));
      const values = columns.map(c => mapped[c]);

      console.log(`[DB] Valid columns after filtering (${columns.length}):`, columns);
      console.log(`[DB] Sample values:`, values.slice(0, 3).map((v, i) => `${columns[i]}: ${typeof v === 'string' ? v.substring(0, 30) : v}`));

      if (columns.length === 0) {
        console.log(`[DB] ❌ No valid columns for ${tableName} after mapping, using SQLite`);
        console.log(`[DB] Mapped keys:`, Object.keys(mapped));
        console.log(`[DB] PostgreSQL columns:`, pgColumns);
        return insertIntoSqlite(tableName, data);
      }

      // Step 4: Check if record already exists (for UPSERT behavior)
      let result;
      try {
        const checkQuery = await client.query(`SELECT id FROM "${tableName}" WHERE id = $1`, [mapped.id || data.id]);
        const recordExists = checkQuery.rows && checkQuery.rows.length > 0;

        if (recordExists) {
          // UPDATE existing record
          console.log(`[DB] Record exists, performing UPDATE...`);
          const updateColumns = columns.filter(c => c !== 'id');
          if (updateColumns.length === 0) {
            console.log(`[DB] ⚠️ No columns to update (only id found), skipping`);
            // Query the existing record and return it
            const existingQuery = await client.query(`SELECT * FROM "${tableName}" WHERE id = $1`, [mapped.id || data.id]);
            return { success: true, data: existingQuery.rows[0], dbType: 'postgresql' };
          }
          const updateSet = updateColumns.map((col, idx) => `"${col}" = $${idx + 2}`).join(', ');
          const updateValues = [mapped.id || data.id, ...updateColumns.map(c => mapped[c])];

          const updateSql = `UPDATE "${tableName}" SET ${updateSet} WHERE id = $1 RETURNING *`;
          console.log(`[DB] UPDATE SQL:`, updateSql.substring(0, 200));
          result = await client.query(updateSql, updateValues);
          console.log(`[DB] ✅ UPDATE successful, rows affected:`, result.rowCount);
        } else {
          // INSERT new record
          console.log(`[DB] Record is new, performing INSERT...`);
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
          const sql = `INSERT INTO "${tableName}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders}) RETURNING *`;
          console.log(`[DB] INSERT SQL:`, sql.substring(0, 200));
          result = await client.query(sql, values);
          console.log(`[DB] ✅ INSERT successful, rows affected:`, result.rowCount);
        }
      } catch (upsertErr) {
        // Fallback: Try ON CONFLICT if UPDATE/INSERT fails
        console.log(`[DB] ⚠️ Direct INSERT/UPDATE failed, trying ON CONFLICT...`, upsertErr.message);
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        const updateSet = columns
          .filter(c => c !== 'id')
          .map((col) => `"${col}" = EXCLUDED."${col}"`)
          .join(', ');

        const sql = `
          INSERT INTO "${tableName}" (${columns.map(c => `"${c}"`).join(', ')})
          VALUES (${placeholders})
          ON CONFLICT (id) DO UPDATE SET ${updateSet}
          RETURNING *
        `;
        result = await client.query(sql, values);
        console.log(`[DB] ✅ INSERT with ON CONFLICT successful`);
      }

      if (!result || !result.rows || result.rows.length === 0) {
        console.log(`[DB] ⚠️ No rows returned from PostgreSQL, falling back to SQLite`);
        return insertIntoSqlite(tableName, data);
      }

      console.log(`[DB] ✅✅✅ Successfully inserted into PostgreSQL!`);
      return { success: true, data: result.rows[0], dbType: 'postgresql' };
    } catch (e) {
      console.error(`[DB] ❌ PostgreSQL insert failed for ${tableName}:`, e.message);
      console.error(`[DB] Error code:`, e.code);
      console.error(`[DB] Error detail:`, e.detail);
      console.error(`[DB] Stack:`, e.stack);
      console.log(`[DB] Falling back to SQLite...`);
      return insertIntoSqlite(tableName, data);
    }
  } else {
    // Use SQLite
    console.log(`[DB] Using SQLite (offline mode)`);
    return insertIntoSqlite(tableName, data);
  }
}

async function queryActiveDatabase(tableName, conditions = {}, options = {}) {
  const dbType = await getActiveDatabase();

  if (dbType === 'postgresql') {
    const syncService = getSyncService();
    const client = await syncService.connectPostgreSQL(false); // Reuse existing connection
    if (!client) {
      return querySqlite(tableName, conditions, options);
    }

    try {
      let sql = `SELECT * FROM "${tableName}" WHERE 1=1`;
      const params = [];
      let paramIndex = 1;

      for (const [key, value] of Object.entries(conditions)) {
        sql += ` AND "${key}" = $${paramIndex}`;
        params.push(value);
        paramIndex++;
      }

      if (options.orderBy) {
        sql += ` ORDER BY "${options.orderBy}" ${options.orderDir || 'DESC'}`;
      }

      if (options.limit) {
        sql += ` LIMIT $${paramIndex}`;
        params.push(options.limit);
        paramIndex++;
      }

      const result = await client.query(sql, params);
      return { success: true, data: result.rows, dbType: 'postgresql' };
    } catch (e) {
      console.log(`[DB] PostgreSQL query failed for ${tableName}, falling back to SQLite:`, e.message);
      return querySqlite(tableName, conditions, options);
    }
  } else {
    return querySqlite(tableName, conditions, options);
  }
}

async function updateInActiveDatabase(tableName, data, conditions) {
  const dbType = await getActiveDatabase();

  if (dbType === 'postgresql') {
    const syncService = getSyncService();
    const client = await syncService.connectPostgreSQL(false); // Reuse existing connection
    if (!client) {
      return updateInSqlite(tableName, data, conditions);
    }

    try {
      const pgColumns = await getPostgreSQLColumns(tableName, client);
      if (!pgColumns || pgColumns.length === 0) {
        console.log(`[DB] Table ${tableName} not found in PostgreSQL, using SQLite`);
        return updateInSqlite(tableName, data, conditions);
      }

      // Build UPDATE query
      const setParts = [];
      const whereParts = [];
      const values = [];
      let paramIndex = 1;

      // Filter data to only include columns that exist in PostgreSQL
      const validColumns = Object.keys(data).filter(c => pgColumns.includes(c));
      for (const col of validColumns) {
        setParts.push(`"${col}" = $${paramIndex}`);
        values.push(data[col]);
        paramIndex++;
      }

      // Build WHERE clause
      for (const [key, value] of Object.entries(conditions)) {
        if (pgColumns.includes(key)) {
          whereParts.push(`"${key}" = $${paramIndex}`);
          values.push(value);
          paramIndex++;
        }
      }

      if (setParts.length === 0) {
        return { success: false, error: 'No valid columns to update' };
      }

      if (whereParts.length === 0) {
        return { success: false, error: 'No conditions provided for update' };
      }

      const sql = `UPDATE "${tableName}" SET ${setParts.join(', ')} WHERE ${whereParts.join(' AND ')} RETURNING *`;
      const result = await client.query(sql, values);

      if (result.rows.length === 0) {
        return { success: false, error: 'No rows updated' };
      }

      return { success: true, data: result.rows[0], dbType: 'postgresql' };
    } catch (e) {
      console.log(`[DB] PostgreSQL update failed for ${tableName}, falling back to SQLite:`, e.message);
      return updateInSqlite(tableName, data, conditions);
    }
  } else {
    return updateInSqlite(tableName, data, conditions);
  }
}

async function deleteInActiveDatabase(tableName, conditions, softDelete = true) {
  if (softDelete) {
    // Soft delete - just update isActive
    return updateInActiveDatabase(tableName, { isActive: false, updatedAt: now() }, conditions);
  } else {
    // Hard delete - actually remove the record
    const dbType = await getActiveDatabase();

    if (dbType === 'postgresql') {
      const syncService = getSyncService();
      const client = await syncService.connectPostgreSQL(false); // Reuse existing connection
      if (!client) {
        return deleteInSqlite(tableName, conditions);
      }

      try {
        const whereParts = [];
        const values = [];
        let paramIndex = 1;

        for (const [key, value] of Object.entries(conditions)) {
          whereParts.push(`"${key}" = $${paramIndex}`);
          values.push(value);
          paramIndex++;
        }

        if (whereParts.length === 0) {
          return { success: false, error: 'No conditions provided for delete' };
        }

        const sql = `DELETE FROM "${tableName}" WHERE ${whereParts.join(' AND ')} RETURNING *`;
        const result = await client.query(sql, values);
        return { success: true, data: result.rows, dbType: 'postgresql' };
      } catch (e) {
        console.log(`[DB] PostgreSQL delete failed for ${tableName}, falling back to SQLite:`, e.message);
        return deleteInSqlite(tableName, conditions);
      }
    } else {
      return deleteInSqlite(tableName, conditions);
    }
  }
}

function insertIntoSqlite(tableName, data) {
  try {
    // CRITICAL FIX: Check which columns exist in the table before inserting
    // This prevents errors when trying to insert into non-existent columns
    let existingColumns = [];
    try {
      const tableInfo = query(`PRAGMA table_info(${tableName})`);
      existingColumns = tableInfo.map(col => col.name.toLowerCase());
      console.log(`[DB] SQLite table ${tableName} has ${existingColumns.length} columns:`, existingColumns.slice(0, 10).join(', '), '...');
    } catch (e) {
      console.error(`[DB] Error checking table info for ${tableName}:`, e.message);
      // If we can't check, try to insert anyway (will fail with clear error)
    }

    // Filter data to only include columns that exist in the table
    let columns = Object.keys(data).filter(k => data[k] !== undefined);

    if (existingColumns.length > 0) {
      // Only include columns that exist in the table
      columns = columns.filter(c => existingColumns.includes(c.toLowerCase()));
      console.log(`[DB] Filtered columns (${columns.length}):`, columns.join(', '));

      // Log any columns that were filtered out
      const filteredOut = Object.keys(data).filter(k => data[k] !== undefined && !existingColumns.includes(k.toLowerCase()));
      if (filteredOut.length > 0) {
        console.log(`[DB] ⚠️ Columns filtered out (don't exist in table):`, filteredOut.join(', '));
      }
    }

    if (columns.length === 0) {
      return { success: false, error: `No valid columns found for table ${tableName}` };
    }

    const values = columns.map(c => data[c]);
    const placeholders = columns.map(() => '?').join(', ');
    const columnList = columns.join(', ');

    const id = data.id || uuid();
    if (!data.id) data.id = id;

    const sql = `INSERT INTO ${tableName} (${columnList}) VALUES (${placeholders})`;
    console.log(`[DB] SQLite INSERT SQL: INSERT INTO ${tableName} (${columnList}) VALUES (${placeholders.substring(0, 100)}...)`);
    const success = run(sql, values);

    if (!success) {
      return { success: false, error: lastDbError || 'Insert failed' };
    }

    // Query back the inserted row
    const inserted = query(`SELECT * FROM ${tableName} WHERE id = ?`, [id])[0];
    return { success: true, data: inserted, dbType: 'sqlite' };
  } catch (e) {
    console.error(`[DB] SQLite insert error for ${tableName}:`, e.message);
    return { success: false, error: e.message };
  }
}

function querySqlite(tableName, conditions = {}, options = {}) {
  try {
    let sql = `SELECT * FROM ${tableName} WHERE 1=1`;
    const params = [];

    for (const [key, value] of Object.entries(conditions)) {
      sql += ` AND ${key} = ?`;
      params.push(value);
    }

    if (options.orderBy) {
      sql += ` ORDER BY ${options.orderBy} ${options.orderDir || 'DESC'}`;
    }

    if (options.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }

    const results = query(sql, params);
    return { success: true, data: results, dbType: 'sqlite' };
  } catch (e) {
    return { success: false, error: e.message, data: [] };
  }
}

function updateInSqlite(tableName, data, conditions) {
  try {
    const setParts = [];
    const whereParts = [];
    const values = [];

    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        setParts.push(`${key} = ?`);
        values.push(value);
      }
    }

    for (const [key, value] of Object.entries(conditions)) {
      whereParts.push(`${key} = ?`);
      values.push(value);
    }

    if (setParts.length === 0) {
      return { success: false, error: 'No data to update' };
    }

    if (whereParts.length === 0) {
      return { success: false, error: 'No conditions provided for update' };
    }

    const sql = `UPDATE ${tableName} SET ${setParts.join(', ')} WHERE ${whereParts.join(' AND ')}`;
    const success = run(sql, values);

    if (!success) {
      return { success: false, error: lastDbError || 'Update failed' };
    }

    // Query back the updated row
    const whereClause = whereParts.map((_, i) => {
      const key = Object.keys(conditions)[i];
      return `${key} = ?`;
    }).join(' AND ');
    const updated = query(`SELECT * FROM ${tableName} WHERE ${whereClause}`, Object.values(conditions));

    return { success: true, data: updated[0] || null, dbType: 'sqlite' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function deleteInSqlite(tableName, conditions) {
  try {
    const whereParts = [];
    const values = [];

    for (const [key, value] of Object.entries(conditions)) {
      whereParts.push(`${key} = ?`);
      values.push(value);
    }

    if (whereParts.length === 0) {
      return { success: false, error: 'No conditions provided for delete' };
    }

    const sql = `DELETE FROM ${tableName} WHERE ${whereParts.join(' AND ')}`;
    const success = run(sql, values);

    return { success: success, dbType: 'sqlite' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getSQLiteColumns(tableName) {
  try {
    const result = query(`PRAGMA table_info(${tableName})`);
    return result.map(r => r.name);
  } catch (e) {
    return [];
  }
}

function mapRowForPostgreSQL(tableName, row) {
  const mapped = { ...row };

  // Handle users table - SQLite doesn't have username, PostgreSQL requires it
  if (tableName === 'users') {
    if (!mapped.username && mapped.email) {
      mapped.username = mapped.email; // Use email as username
    }
    // Convert isActive from INTEGER to boolean
    if (mapped.isActive !== undefined) {
      mapped.isActive = mapped.isActive === 1 || mapped.isActive === true;
    }
    // Add required fields if missing
    if (!mapped.updatedAt) mapped.updatedAt = mapped.createdAt || now();
  }

  // Handle device_activation table - convert camelCase to snake_case for PostgreSQL
  if (tableName === 'device_activation') {
    // Map camelCase SQLite columns to snake_case PostgreSQL columns
    const columnMap = {
      'deviceId': 'device_id',
      'licenseKey': 'license_key',
      'userId': 'user_id',
      'companyId': 'company_id',
      'branchId': 'branch_id',
      'macAddress': 'mac_address',
      'createdAt': 'created_at',
      'updatedAt': 'updated_at',
      'activatedBy': 'activated_by',
      'activatedAt': 'activated_at',
      'lastVerifiedAt': 'last_verified_at',
      'lastVerifiedStatus': 'last_verified_status',
      'offlineAccessExpiresAt': 'offline_access_expires_at'
    };

    for (const [sqliteCol, pgCol] of Object.entries(columnMap)) {
      if (mapped[sqliteCol] !== undefined) {
        mapped[pgCol] = mapped[sqliteCol];
        delete mapped[sqliteCol]; // Remove camelCase version
      }
    }
  }

  // Handle boolean conversions for all tables
  ['isActive', 'isVIP', 'requiresPrescription', 'isReported'].forEach(col => {
    if (mapped[col] !== undefined && mapped[col] !== null) {
      mapped[col] = mapped[col] === 1 || mapped[col] === true || mapped[col] === 'true';
    }
  });

  // Remove phone if it doesn't exist in PostgreSQL schema
  if (tableName === 'users') {
    delete mapped.phone;
  }

  return mapped;
}

async function getPostgreSQLColumns(tableName, client) {
  if (pgColumnsCache[tableName]) return pgColumnsCache[tableName];

  try {
    const result = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = $1 AND table_schema = 'public'
    `, [tableName]);

    pgColumnsCache[tableName] = result.rows.map(r => r.column_name);
    return pgColumnsCache[tableName];
  } catch (e) {
    console.log(`[Sync] Could not get columns for ${tableName}:`, e.message);
    return null;
  }
}

async function createRecordPostgreSQLFirst(tableName, data, pgColumnMap = {}) {
  const syncService = getSyncService();
  const pgClient = await syncService.connectPostgreSQL(false); // Reuse existing connection
  const isOnline = syncService.getIsOnline();
  let record = null;
  let usedDatabase = 'sqlite';

  // Try PostgreSQL first if available
  if (pgClient && isOnline) {
    try {
      // Map column names (SQLite to PostgreSQL)
      const mappedData = { ...data };
      for (const [sqliteCol, pgCol] of Object.entries(pgColumnMap)) {
        if (mappedData[sqliteCol] !== undefined) {
          mappedData[pgCol] = mappedData[sqliteCol];
          if (sqliteCol !== pgCol) delete mappedData[sqliteCol];
        }
      }

      const pgColumns = await getPostgreSQLColumns(tableName, pgClient);
      if (pgColumns && pgColumns.length > 0) {
        const columns = Object.keys(mappedData).filter(c => pgColumns.includes(c));
        const values = columns.map(c => mappedData[c]);

        if (columns.length > 0) {
          const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
          const sql = `INSERT INTO "${tableName}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders}) RETURNING *`;

          const result = await pgClient.query(sql, values);
          if (result.rows && result.rows.length > 0) {
            record = result.rows[0];
            usedDatabase = 'postgresql';
            console.log(`[${tableName}] ✅ Created in PostgreSQL`);
          }
        }
      }
    } catch (pgError) {
      console.log(`[${tableName}] PostgreSQL insert failed, falling back to SQLite:`, pgError.message);
    }
  }

  // Fallback to SQLite if PostgreSQL failed or unavailable
  if (!record) {
    const columns = Object.keys(data).filter(k => data[k] !== undefined);
    const values = columns.map(c => data[c]);
    const placeholders = columns.map(() => '?').join(', ');
    const columnList = columns.join(', ');

    const id = data.id || uuid();
    if (!data.id) data.id = id;

    const sql = `INSERT INTO ${tableName} (${columnList}) VALUES (${placeholders})`;
    const success = run(sql, values);

    if (!success) {
      return { success: false, error: lastDbError || 'Insert failed', dbType: 'sqlite' };
    }

    record = query(`SELECT * FROM ${tableName} WHERE id = ?`, [id])[0];
    usedDatabase = 'sqlite';
    console.log(`[${tableName}] ✅ Created in SQLite`);

    if (!record) {
      return { success: false, error: 'Record created but not found', dbType: 'sqlite' };
    }
  }

  return { success: true, data: record, dbType: usedDatabase };
}


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
  insertIntoSqlite,
  querySqlite,
  updateInSqlite,
  deleteInSqlite,
  getSQLiteColumns,
  insertIntoSQLite: insertIntoSqlite,
  querySQLite: querySqlite,
  updateInSQLite: updateInSqlite,
  deleteInSQLite: deleteInSqlite
};
