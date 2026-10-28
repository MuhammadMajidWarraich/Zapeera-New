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

// QA fix 2026-10-20 (Agent B2, B-1/B-2): first-run default-admin seeding.
// DEFAULT_ADMIN_PASSWORD_HASH is a TRUE bcrypt('admin123') hash, generated
// with the app's own bcryptjs (hashSync('admin123', 10)) and verified with
// compareSync. The identical constant is used in electron/main.js for its
// (better-sqlite3) seed inserts and as the forced-change fingerprint in both
// files — keep all copies in sync.
// LEGACY_BROKEN_PASSWORD_HASH is the constant older builds shipped while
// CLAIMING it was bcrypt('admin123'); bcryptjs comparison proves it is not
// (B-2), so any account still carrying it can never log in. initDatabase()
// repairs such rows on sight (reset to the true default hash + forced
// password change), which is safe: a bcrypt string equality match can only
// come from the shipped seed, never from a user-chosen password.
const DEFAULT_ADMIN_PASSWORD_HASH = '$2b$10$6R80a9IPRnzCDTqU24D57uJvr0mx.Tz1S6LEiSvpiQMZDWnen9SeG';
const LEGACY_BROKEN_PASSWORD_HASH = '$2a$10$K.0HwpsoPDGaB/atFBmmXOGTw4ceeg33.WrxJx/FeC9.gOMXeIBbi';

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
    `ALTER TABLE users ADD COLUMN passwordResetExpires TEXT`,
    // Add slug column to companies so tenant-scoped routes (/business/:slug) work on desktop
    `ALTER TABLE companies ADD COLUMN slug TEXT`
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
      role TEXT DEFAULT 'ADMIN', isActive INTEGER DEFAULT 0, mustChangePassword INTEGER DEFAULT 0, companyId TEXT, branchId TEXT,
      createdBy TEXT, sessionToken TEXT, passwordResetToken TEXT, passwordResetExpires TEXT, lastLoginAt TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, description TEXT, address TEXT, phone TEXT, email TEXT,
      slug TEXT, businessType TEXT DEFAULT 'PHARMACY', isActive INTEGER DEFAULT 1, createdBy TEXT,
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
      unitsPerStrip INTEGER, reorderQuantity INTEGER, pctCode TEXT,
      reorderLevel INTEGER DEFAULT 20, requiresPrescription INTEGER DEFAULT 0, unitType TEXT DEFAULT 'PIECE',
      manufacturerId TEXT, supplierId TEXT, shelfId TEXT, expiryDate TEXT, manufacturingDate TEXT, batchNumber TEXT,
      additionalBarcodes TEXT, barcodeType TEXT, isGenerated INTEGER DEFAULT 0, isControlled INTEGER DEFAULT 0,
      controlledSchedule TEXT, taxClassId TEXT, isService INTEGER DEFAULT 0, uuid TEXT, syncStatus TEXT DEFAULT 'PENDING',
      isActive INTEGER DEFAULT 1, createdBy TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT, phone TEXT, address TEXT, branchId TEXT, companyId TEXT,
      loyaltyPoints INTEGER DEFAULT 0, creditLimit REAL, isActive INTEGER DEFAULT 1, createdBy TEXT,
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
      expireDate TEXT, productionDate TEXT, shelfId TEXT, shelfName TEXT, variantId TEXT, isActive INTEGER DEFAULT 1, isReported INTEGER DEFAULT 0, reportReason TEXT,
      createdBy TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY, invoiceNumber TEXT, receiptNumber TEXT, customerId TEXT, branchId TEXT, companyId TEXT,
      totalAmount REAL DEFAULT 0, discount REAL DEFAULT 0, tax REAL DEFAULT 0, grandTotal REAL DEFAULT 0,
      paidAmount REAL DEFAULT 0, returnedAmount REAL DEFAULT 0,
      paymentMethod TEXT DEFAULT 'CASH', paymentStatus TEXT DEFAULT 'PAID', status TEXT DEFAULT 'COMPLETED',
      channel TEXT DEFAULT 'POS', saleDate TEXT, subtotal REAL DEFAULT 0, taxAmount REAL DEFAULT 0,
      provincialTaxAmount REAL DEFAULT 0, discountAmount REAL DEFAULT 0, discountPercentage REAL DEFAULT 0,
      loyaltyDiscount REAL, loyaltyPointsEarned INTEGER, loyaltyPointsRedeemed INTEGER, promotionDiscount REAL,
      giftCardAmount REAL, walletAmount REAL, membershipId TEXT, externalOrderId TEXT,
      postexTrackingNumber TEXT, postexShipmentStatus TEXT, deliveryAddress TEXT, deliveryPhone TEXT,
      deliveryNotes TEXT, userId TEXT, uuid TEXT, syncStatus TEXT DEFAULT 'PENDING',
      notes TEXT, employeeId TEXT, prescriptionId TEXT, folioId TEXT, salespersonId TEXT, shiftId TEXT, fbrInvoiceNumber TEXT, fbrStatus TEXT, createdBy TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS sale_items (
      id TEXT PRIMARY KEY, saleId TEXT NOT NULL, productId TEXT NOT NULL, batchId TEXT,
      quantity INTEGER DEFAULT 1, unitPrice REAL DEFAULT 0, discount REAL DEFAULT 0, total REAL DEFAULT 0,
      unitLevel TEXT, unitFactor INTEGER, variantId TEXT, variantName TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS purchases (
      id TEXT PRIMARY KEY, purchaseNumber TEXT, invoiceNo TEXT, supplierId TEXT, branchId TEXT, companyId TEXT,
      totalAmount REAL DEFAULT 0, paidAmount REAL DEFAULT 0, outstanding REAL DEFAULT 0, discount REAL DEFAULT 0, tax REAL DEFAULT 0, grandTotal REAL DEFAULT 0,
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
      id TEXT PRIMARY KEY, staffProfileId TEXT, membershipId TEXT, shiftDate TEXT,
      startTime TEXT, endTime TEXT, openingBalance REAL DEFAULT 0, cashIn REAL DEFAULT 0, cashOut REAL DEFAULT 0,
      expectedBalance REAL, actualBalance REAL, difference REAL, status TEXT DEFAULT 'ACTIVE', notes TEXT,
      name TEXT, isActive INTEGER DEFAULT 1, branchId TEXT, companyId TEXT, createdBy TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS staff_profiles (
      id TEXT PRIMARY KEY, membershipId TEXT UNIQUE, employeeId TEXT UNIQUE,
      designation TEXT, department TEXT, employmentType TEXT DEFAULT 'FULL_TIME',
      salary REAL, salaryType TEXT DEFAULT 'MONTHLY', joiningDate TEXT,
      probationEndDate TEXT, confirmationDate TEXT, resignationDate TEXT,
      terminationDate TEXT, terminationReason TEXT, bankName TEXT,
      bankAccountNumber TEXT, bankBranchName TEXT, cnicNumber TEXT, cnicExpiry TEXT,
      passportNumber TEXT, emergencyContactName TEXT, emergencyContactPhone TEXT,
      emergencyContactRelation TEXT, reportingManagerId TEXT, shiftPreference TEXT,
      weeklyOffDays TEXT, annualLeaveBalance INTEGER DEFAULT 0, sickLeaveBalance INTEGER DEFAULT 0,
      casualLeaveBalance INTEGER DEFAULT 0, documents TEXT, notes TEXT,
      performanceRating REAL, lastReviewDate TEXT, isActive INTEGER DEFAULT 1, isSalesman INTEGER DEFAULT 0,
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
    `CREATE TABLE IF NOT EXISTS subscription_addons (
      id TEXT PRIMARY KEY, businessId TEXT NOT NULL, type TEXT NOT NULL, quantity INTEGER DEFAULT 1,
      status TEXT DEFAULT 'ACTIVE', startedAt TEXT, periodEnd TEXT, cancelledAt TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(businessId, type)
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
    )`,
    // ── Maturity-program tables (Waves A2–C6) ──────────────────────────
    // Column sets mirror the Prisma models exactly (camelCase names) so
    // rows pulled from the cloud apply cleanly. CREATE TABLE IF NOT EXISTS
    // makes this an in-place upgrade for existing installs.
    // FBR tables (fbr_configs/fbr_invoice_queue) are deliberately absent:
    // excluded from sync by design (write-only PRAL token + server queue).
    `CREATE TABLE IF NOT EXISTS stock_transfers (
      id TEXT PRIMARY KEY, transferNumber TEXT, companyId TEXT, fromBranchId TEXT, toBranchId TEXT, status TEXT, notes TEXT, createdBy TEXT, completedBy TEXT, completedAt TEXT, cancelledBy TEXT, cancelledAt TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS stock_transfer_items (
      id TEXT PRIMARY KEY, transferId TEXT, productId TEXT, sourceBatchId TEXT, destBatchId TEXT, quantity INTEGER, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS stock_takes (
      id TEXT PRIMARY KEY, companyId TEXT, branchId TEXT, status TEXT, startedBy TEXT, completedBy TEXT, note TEXT, completedAt TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS stock_take_lines (
      id TEXT PRIMARY KEY, stockTakeId TEXT, productId TEXT, batchId TEXT, systemQty INTEGER, countedQty INTEGER, variance INTEGER, adjustmentMovementId TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS sale_payments (
      id TEXT PRIMARY KEY, saleId TEXT, method TEXT, amount REAL, reference TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS promotions (
      id TEXT PRIMARY KEY, companyId TEXT, name TEXT, type TEXT, value REAL, buyQty INTEGER, getQty INTEGER, scope TEXT, categoryId TEXT, productId TEXT, code TEXT, minBill REAL, startsAt TEXT, endsAt TEXT, usageLimit INTEGER, usedCount INTEGER, isActive INTEGER, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS sale_promotions (
      id TEXT PRIMARY KEY, saleId TEXT, promotionId TEXT, discountAmount REAL, code TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS tax_classes (
      id TEXT PRIMARY KEY, companyId TEXT, name TEXT, rate REAL, isDefault INTEGER, isActive INTEGER, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS sale_tax_lines (
      id TEXT PRIMARY KEY, saleId TEXT, taxClassId TEXT, className TEXT, rate REAL, taxableAmount REAL, taxAmount REAL, createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS customer_ledger_entries (
      id TEXT PRIMARY KEY, companyId TEXT, customerId TEXT, type TEXT, amount REAL, method TEXT, reference TEXT, note TEXT, saleId TEXT, createdBy TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS loyalty_transactions (
      id TEXT PRIMARY KEY, companyId TEXT, customerId TEXT, type TEXT, points INTEGER, saleId TEXT, refundId TEXT, note TEXT, createdBy TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS prescriptions (
      id TEXT PRIMARY KEY, companyId TEXT, branchId TEXT, patientName TEXT, patientPhone TEXT, doctorName TEXT, doctorReg TEXT, notes TEXT, imageUrl TEXT, issuedDate TEXT, reviewNote TEXT, reviewStatus TEXT DEFAULT 'REVIEWED', reviewedAt TEXT, reviewedBy TEXT, source TEXT DEFAULT 'STAFF', isActive INTEGER, voidReason TEXT, voidedAt TEXT, voidedBy TEXT, createdBy TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS prescription_items (
      id TEXT PRIMARY KEY, prescriptionId TEXT, productId TEXT, productName TEXT, quantity REAL, dosage TEXT, durationDays INTEGER, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY, companyId TEXT, branchId TEXT, name TEXT, phone TEXT, age INTEGER, gender TEXT, cnic TEXT, address TEXT, notes TEXT, isActive INTEGER, createdBy TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS doctors (
      id TEXT PRIMARY KEY, companyId TEXT, name TEXT, specialization TEXT, phone TEXT, consultationFee REAL, sharePercent REAL, serviceProductId TEXT, isActive INTEGER, createdBy TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY, companyId TEXT, branchId TEXT, patientId TEXT, doctorId TEXT, appointmentDate TEXT, tokenNumber INTEGER, status TEXT, reason TEXT, notes TEXT, saleId TEXT, prescriptionId TEXT, feeCharged REAL, doctorShareAmount REAL, createdBy TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS doctor_settlements (
      id TEXT PRIMARY KEY, companyId TEXT, doctorId TEXT, periodFrom TEXT, periodTo TEXT, amount REAL, note TEXT, createdBy TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS room_types (
      id TEXT PRIMARY KEY, companyId TEXT, name TEXT, ratePerNight REAL, capacity INTEGER, description TEXT, isActive INTEGER, createdBy TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS rooms (
      id TEXT PRIMARY KEY, companyId TEXT, branchId TEXT, roomTypeId TEXT, number TEXT, floor TEXT, status TEXT, isActive INTEGER, createdBy TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS reservations (
      id TEXT PRIMARY KEY, companyId TEXT, branchId TEXT, guestName TEXT, guestPhone TEXT, guestCnic TEXT, cnicDocumentUrl TEXT, guestPhotoUrls TEXT, roomId TEXT, checkInDate TEXT, checkOutDate TEXT, adults INTEGER, children INTEGER, source TEXT, status TEXT, folioId TEXT, notes TEXT, createdBy TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS folios (
      id TEXT PRIMARY KEY, companyId TEXT, branchId TEXT, reservationId TEXT, roomId TEXT, guestName TEXT, guestPhone TEXT, rateSnapshot REAL, status TEXT, openedAt TEXT, closedAt TEXT, saleId TEXT, writeOffAmount REAL, writeOffNote TEXT, createdBy TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS folio_charges (
      id TEXT PRIMARY KEY, folioId TEXT, description TEXT, amount REAL, kind TEXT, saleId TEXT, chargeDate TEXT, createdBy TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS folio_payments (
      id TEXT PRIMARY KEY, folioId TEXT, amount REAL, method TEXT, paidAt TEXT, note TEXT, createdBy TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS product_variants (
      id TEXT PRIMARY KEY, companyId TEXT, productId TEXT, name TEXT, sku TEXT, barcode TEXT, attributes TEXT, priceDelta REAL, isActive INTEGER, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    // ── Embedded ports (2026-10-28, audit-embedded-fixes) ────────────
    // Tables for the domains ported from the cloud in this release.
    // Column sets mirror the Prisma models (camelCase) so rows pulled
    // from the cloud apply cleanly. Tables the cloud pull feed does not
    // serve yet (parked_sales, expenses, provincial_tax_configs,
    // controlled_dispense_logs, gift_cards) hold locally-created rows
    // only until the feed + push map gain them — see each routes file.
    `CREATE TABLE IF NOT EXISTS parked_sales (
      id TEXT PRIMARY KEY, businessId TEXT NOT NULL, branchId TEXT NOT NULL, createdById TEXT, customerId TEXT, label TEXT, payload TEXT, itemCount INTEGER DEFAULT 0, grandTotal REAL DEFAULT 0, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS expense_categories (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, companyId TEXT NOT NULL, branchId TEXT, isActive INTEGER DEFAULT 1, createdBy TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, vendor TEXT, amount REAL DEFAULT 0, expenseDate TEXT, paymentMethod TEXT DEFAULT 'CASH', reference TEXT, status TEXT DEFAULT 'PENDING', companyId TEXT NOT NULL, branchId TEXT, categoryId TEXT, createdBy TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS provincial_tax_configs (
      id TEXT PRIMARY KEY, companyId TEXT NOT NULL, branchId TEXT, authority TEXT NOT NULL, registrationNumber TEXT, rate REAL DEFAULT 0, enabled INTEGER DEFAULT 1, createdBy TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS controlled_dispense_logs (
      id TEXT PRIMARY KEY, companyId TEXT NOT NULL, branchId TEXT, productId TEXT NOT NULL, batchId TEXT, batchNo TEXT, saleId TEXT, saleItemId TEXT, entryType TEXT DEFAULT 'DISPENSE', quantity INTEGER DEFAULT 0, balanceAfter INTEGER DEFAULT 0, reversesId TEXT, reason TEXT, staffUserId TEXT, staffName TEXT, customerId TEXT, customerName TEXT, prescriptionId TEXT, prescriptionRef TEXT, invoiceNumber TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS gift_cards (
      id TEXT PRIMARY KEY, code TEXT UNIQUE, companyId TEXT NOT NULL, branchId TEXT NOT NULL, initialValue REAL DEFAULT 0, balance REAL DEFAULT 0, recipientName TEXT, recipientPhone TEXT, purchasedBy TEXT, paymentMethod TEXT, status TEXT DEFAULT 'ACTIVE', expiresAt TEXT, createdBy TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS gift_card_transactions (
      id TEXT PRIMARY KEY, giftCardId TEXT NOT NULL, companyId TEXT NOT NULL, type TEXT, amount REAL DEFAULT 0, balanceAfter REAL DEFAULT 0, saleId TEXT, note TEXT, createdBy TEXT, createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS roles (
      id TEXT PRIMARY KEY, businessId TEXT, name TEXT NOT NULL, description TEXT, isSystem INTEGER DEFAULT 0, isActive INTEGER DEFAULT 1, permissionState TEXT DEFAULT 'UNCONFIGURED', policyVersion INTEGER DEFAULT 0, uuid TEXT, syncStatus TEXT DEFAULT 'PENDING', createdAt TEXT DEFAULT CURRENT_TIMESTAMP, updatedAt TEXT DEFAULT CURRENT_TIMESTAMP
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

  // ── v1.0.8 sync-schema upgrade (RC-1b) ──────────────────────────────
  // Columns the cloud has been sending in /api/sync/changes that the
  // local tables never had — computed from the real Medicos pull
  // (733 records, 2026-10-25): 39 missing columns across 5 tables, which
  // made applyChanges fail 397/733 rows silently. The CREATE TABLEs above
  // carry the same columns for fresh installs; existing DBs need ALTERs
  // (CREATE TABLE IF NOT EXISTS never upgrades them). Each ALTER is
  // guarded by a PRAGMA table_info check, so re-runs are no-ops.
  // If ANY column was added, the sync cursors are reset (DELETE
  // sync_cursor_*): pre-fix pulls advanced the cursor past the failed
  // rows, so without a reset the first corrected pull would start after
  // them and skip them forever — the workspace would stay empty.
  const SYNC_SCHEMA_UPGRADES_V108 = [
    // products (9)
    { table: 'products', column: 'additionalBarcodes', definition: 'TEXT' },
    { table: 'products', column: 'barcodeType', definition: 'TEXT' },
    { table: 'products', column: 'isGenerated', definition: 'INTEGER DEFAULT 0' },
    { table: 'products', column: 'isControlled', definition: 'INTEGER DEFAULT 0' },
    { table: 'products', column: 'controlledSchedule', definition: 'TEXT' },
    { table: 'products', column: 'taxClassId', definition: 'TEXT' },
    { table: 'products', column: 'isService', definition: 'INTEGER DEFAULT 0' },
    { table: 'products', column: 'uuid', definition: 'TEXT' },
    { table: 'products', column: 'syncStatus', definition: "TEXT DEFAULT 'PENDING'" },
    // customers (1)
    { table: 'customers', column: 'creditLimit', definition: 'REAL' },
    // sales (23)
    { table: 'sales', column: 'channel', definition: "TEXT DEFAULT 'POS'" },
    { table: 'sales', column: 'deliveryAddress', definition: 'TEXT' },
    { table: 'sales', column: 'deliveryNotes', definition: 'TEXT' },
    { table: 'sales', column: 'deliveryPhone', definition: 'TEXT' },
    { table: 'sales', column: 'discountAmount', definition: 'REAL DEFAULT 0' },
    { table: 'sales', column: 'discountPercentage', definition: 'REAL DEFAULT 0' },
    { table: 'sales', column: 'externalOrderId', definition: 'TEXT' },
    { table: 'sales', column: 'giftCardAmount', definition: 'REAL' },
    { table: 'sales', column: 'loyaltyDiscount', definition: 'REAL' },
    { table: 'sales', column: 'loyaltyPointsEarned', definition: 'INTEGER' },
    { table: 'sales', column: 'loyaltyPointsRedeemed', definition: 'INTEGER' },
    { table: 'sales', column: 'membershipId', definition: 'TEXT' },
    { table: 'sales', column: 'postexShipmentStatus', definition: 'TEXT' },
    { table: 'sales', column: 'postexTrackingNumber', definition: 'TEXT' },
    { table: 'sales', column: 'promotionDiscount', definition: 'REAL' },
    { table: 'sales', column: 'provincialTaxAmount', definition: 'REAL DEFAULT 0' },
    { table: 'sales', column: 'saleDate', definition: 'TEXT' },
    { table: 'sales', column: 'subtotal', definition: 'REAL' },
    { table: 'sales', column: 'syncStatus', definition: "TEXT DEFAULT 'PENDING'" },
    { table: 'sales', column: 'taxAmount', definition: 'REAL DEFAULT 0' },
    { table: 'sales', column: 'userId', definition: 'TEXT' },
    { table: 'sales', column: 'uuid', definition: 'TEXT' },
    { table: 'sales', column: 'walletAmount', definition: 'REAL' },
    // purchases (1)
    { table: 'purchases', column: 'outstanding', definition: 'REAL DEFAULT 0' },
    // prescriptions (5)
    { table: 'prescriptions', column: 'reviewNote', definition: 'TEXT' },
    { table: 'prescriptions', column: 'reviewStatus', definition: "TEXT DEFAULT 'REVIEWED'" },
    { table: 'prescriptions', column: 'reviewedAt', definition: 'TEXT' },
    { table: 'prescriptions', column: 'reviewedBy', definition: 'TEXT' },
    { table: 'prescriptions', column: 'source', definition: "TEXT DEFAULT 'STAFF'" }
  ];
  let v108ColumnsAdded = 0;
  for (const { table, column, definition } of SYNC_SCHEMA_UPGRADES_V108) {
    try {
      const cols = query(`PRAGMA table_info(${table})`);
      if (cols && cols.some((c) => c.name === column)) continue;
    } catch { /* fall through and attempt the ALTER */ }
    try {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      console.log(`[DB] v1.0.8 migration: added ${table}.${column}`);
      v108ColumnsAdded++;
    } catch (e) {
      console.log(`[DB] v1.0.8 migration skipped ${table}.${column}: ${e.message}`);
    }
  }
  if (v108ColumnsAdded > 0) {
    try {
      db.run(`DELETE FROM settings WHERE key LIKE 'sync_cursor_%'`);
      console.log(`[DB] v1.0.8 migration: ${v108ColumnsAdded} column(s) added, sync cursors reset for a full re-pull`);
    } catch (e) {
      console.log('[DB] v1.0.8 migration: cursor reset skipped:', e.message);
    }
  }

  // ── v1.0.9 sync-schema upgrade (RC-1b follow-up) ───────────────────
  // Found by the v1.0.8 laptop verification (2026-10-26): the C5 Probe
  // Hotel epoch pull quarantined after 3 failed ticks on exactly ONE
  // record — reservation cmvjbh1md00vjnl0169babc7d — because the cloud
  // sends two Reservation columns the local table never had:
  // cnicDocumentUrl (guest CNIC scan URL) and guestPhotoUrls (JSON array
  // of guest photo refs). The v1.0.8 allowlist was computed from the
  // Medicos pull only, which contains no reservations, so these were
  // missed. Verified against the Prisma Reservation model: these are the
  // ONLY two fields missing (all other hotel tables match Prisma
  // exactly). Same pattern as v1.0.8: PRAGMA-guarded ALTERs, and a cursor
  // reset when anything is added so the quarantined batch re-pulls and
  // the skipped reservation lands.
  const SYNC_SCHEMA_UPGRADES_V109 = [
    // reservations (2)
    { table: 'reservations', column: 'cnicDocumentUrl', definition: 'TEXT' },
    { table: 'reservations', column: 'guestPhotoUrls', definition: 'TEXT' }
  ];
  let v109ColumnsAdded = 0;
  for (const { table, column, definition } of SYNC_SCHEMA_UPGRADES_V109) {
    try {
      const cols = query(`PRAGMA table_info(${table})`);
      if (cols && cols.some((c) => c.name === column)) continue;
    } catch { /* fall through and attempt the ALTER */ }
    try {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      console.log(`[DB] v1.0.9 migration: added ${table}.${column}`);
      v109ColumnsAdded++;
    } catch (e) {
      console.log(`[DB] v1.0.9 migration skipped ${table}.${column}: ${e.message}`);
    }
  }
  if (v109ColumnsAdded > 0) {
    try {
      db.run(`DELETE FROM settings WHERE key LIKE 'sync_cursor_%'`);
      console.log(`[DB] v1.0.9 migration: ${v109ColumnsAdded} column(s) added, sync cursors reset for a full re-pull`);
    } catch (e) {
      console.log('[DB] v1.0.9 migration: cursor reset skipped:', e.message);
    }
  }

  // Multi-counter sync (R1/R3/R4, 2026-10-26): the cloud Sale row gained
  // replay/review columns. The cloud pull STRIPS them server-side
  // (mapSaleForSQLite) so v1.0.10 desktops keep pulling, but once this
  // migration lands the desktop can receive them on the next pull (and a
  // later server change can lift the strip). Same pattern as v1.0.8/9:
  // PRAGMA-guarded ALTERs + a cursor reset when anything is added.
  // Loose / by-weight selling (Stage 1, 2026-10-26): the cloud Product
  // gains `unitType` ('KG' = sold by the kilo, null = sold by pieces).
  // The CREATE TABLE above already carries the column (fresh installs
  // fine); upgraded DBs need the ALTER, or the cloud sync payload —
  // which carries unitType: null on EVERY changed product
  // (cleanRecordForSQLite does NOT strip nulls) — quarantines the
  // record (v1.0.9 lesson).
  // MERGED V1011 (9 entries: 8 sales + 1 products) — the weight and
  // multi-counter branches each defined their own
  // SYNC_SCHEMA_UPGRADES_V1011; they were combined here at the weight
  // rebase. Do not let one silently overwrite the other.
  // ROLLOUT ORDER: this EXE build + laptop install BEFORE the cloud
  // deploy that ships unitType (or before any product change syncs).
  const SYNC_SCHEMA_UPGRADES_V1011 = [
    // sales (8)
    { table: 'sales', column: 'syncOrigin', definition: 'TEXT' },
    { table: 'sales', column: 'stockReplayedAt', definition: 'TEXT' },
    { table: 'sales', column: 'oversold', definition: 'INTEGER DEFAULT 0' },
    { table: 'sales', column: 'oversellDetail', definition: 'TEXT' },
    { table: 'sales', column: 'offlineSale', definition: 'INTEGER DEFAULT 0' },
    { table: 'sales', column: 'terminalInvoiceNumber', definition: 'TEXT' },
    { table: 'sales', column: 'reviewedAt', definition: 'TEXT' },
    { table: 'sales', column: 'reviewedBy', definition: 'TEXT' },
    // products (1)
    { table: 'products', column: 'unitType', definition: "TEXT DEFAULT 'PIECE'" }
  ];
  let v1011ColumnsAdded = 0;
  for (const { table, column, definition } of SYNC_SCHEMA_UPGRADES_V1011) {
    try {
      const cols = query(`PRAGMA table_info(${table})`);
      if (cols && cols.some((c) => c.name === column)) continue;
    } catch { /* fall through and attempt the ALTER */ }
    try {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      console.log(`[DB] v1.0.11 migration: added ${table}.${column}`);
      v1011ColumnsAdded++;
    } catch (e) {
      console.log(`[DB] v1.0.11 migration skipped ${table}.${column}: ${e.message}`);
    }
  }
  if (v1011ColumnsAdded > 0) {
    try {
      db.run(`DELETE FROM settings WHERE key LIKE 'sync_cursor_%'`);
      console.log(`[DB] v1.0.11 migration: ${v1011ColumnsAdded} column(s) added, sync cursors reset for a full re-pull`);
    } catch (e) {
      console.log('[DB] v1.0.11 migration: cursor reset skipped:', e.message);
    }
  }

  // ── v1.0.12 sync-schema upgrade (shift gaps fix, 2026-10-27, B2/B5) ──
  // The desktop shifts table was a roster stub (name/startTime/endTime/
  // isActive only) — upgraded DBs get the cloud Shift columns so pulled
  // shift rows land instead of quarantining, and sales get shiftId so a
  // sale keeps the shift it was rung under. The staff_profiles table
  // itself is created by the CREATE TABLE above (runs on upgrade too).
  // Same pattern as v1.0.8/9/11: PRAGMA-guarded ALTERs + a cursor reset
  // when anything is added — the reset is REQUIRED here, not just
  // hygiene: staffProfiles and shifts predate the desktop's cursor, so
  // without a full re-pull they would never arrive.
  const SYNC_SCHEMA_UPGRADES_V1012 = [
    // shifts (11)
    { table: 'shifts', column: 'staffProfileId', definition: 'TEXT' },
    { table: 'shifts', column: 'membershipId', definition: 'TEXT' },
    { table: 'shifts', column: 'shiftDate', definition: 'TEXT' },
    { table: 'shifts', column: 'openingBalance', definition: 'REAL DEFAULT 0' },
    { table: 'shifts', column: 'cashIn', definition: 'REAL DEFAULT 0' },
    { table: 'shifts', column: 'cashOut', definition: 'REAL DEFAULT 0' },
    { table: 'shifts', column: 'expectedBalance', definition: 'REAL' },
    { table: 'shifts', column: 'actualBalance', definition: 'REAL' },
    { table: 'shifts', column: 'difference', definition: 'REAL' },
    { table: 'shifts', column: 'status', definition: "TEXT DEFAULT 'ACTIVE'" },
    { table: 'shifts', column: 'notes', definition: 'TEXT' },
    // sales (1)
    { table: 'sales', column: 'shiftId', definition: 'TEXT' }
  ];
  let v1012ColumnsAdded = 0;
  for (const { table, column, definition } of SYNC_SCHEMA_UPGRADES_V1012) {
    try {
      const cols = query(`PRAGMA table_info(${table})`);
      if (cols && cols.some((c) => c.name === column)) continue;
    } catch { /* fall through and attempt the ALTER */ }
    try {
      db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      console.log(`[DB] v1.0.12 migration: added ${table}.${column}`);
      v1012ColumnsAdded++;
    } catch (e) {
      console.log(`[DB] v1.0.12 migration skipped ${table}.${column}: ${e.message}`);
    }
  }
  if (v1012ColumnsAdded > 0) {
    try {
      db.run(`DELETE FROM settings WHERE key LIKE 'sync_cursor_%'`);
      console.log(`[DB] v1.0.12 migration: ${v1012ColumnsAdded} column(s) added, sync cursors reset for a full re-pull`);
    } catch (e) {
      console.log('[DB] v1.0.12 migration: cursor reset skipped:', e.message);
    }
  }

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

  // Device auto-activation REMOVED 2026-10-28 (license rollout,
  // security audit F2). The old block inserted (or re-activated) a
  // device_activation row with offlineAccessExpiresAt = today + 10
  // YEARS on every DB init — self-granted access that the signed
  // license is meant to replace. Device activation is now server-issued
  // license binding only (electron/services/license/). Existing
  // device_activation rows are left untouched (device registration with
  // its 72h offline expiry still happens in
  // device.service.registerDevice() during provisioning); nothing here
  // writes ACTIVE rows any more.

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
    // QA fix 2026-10-19 (Track C C-03): forced password change flag for the
    // seeded default admin accounts and any account still on a known password
    'ALTER TABLE users ADD COLUMN mustChangePassword INTEGER DEFAULT 0',
    // Real TOTP 2FA (2026-10-24): mirrors of the cloud zapeera_users columns
    // for schema parity (the spawned-backend mode uses the Prisma sqlite
    // schema directly; this legacy embedded layer just keeps the columns
    // present — local/offline login does not run the cloud TOTP challenge).
    'ALTER TABLE users ADD COLUMN twoFactorEnabled INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN twoFactorSecret TEXT',
    'ALTER TABLE users ADD COLUMN twoFactorRecoveryCodes TEXT',
    // Sales
    'ALTER TABLE sales ADD COLUMN receiptNumber TEXT',
    // Batches
    'ALTER TABLE batches ADD COLUMN isActive INTEGER DEFAULT 1',
    // Customers
    'ALTER TABLE customers ADD COLUMN isVIP INTEGER DEFAULT 0',
    'ALTER TABLE customers ADD COLUMN totalPurchases REAL DEFAULT 0',
    'ALTER TABLE customers ADD COLUMN lastVisit TEXT',
    // Maturity-program columns on existing tables (Waves B7/C1/C2/C3/C5/C6).
    // products.reorderLevel already exists in the local schema (legacy
    // column, same name as the cloud's C3 field) so it needs no migration.
    'ALTER TABLE products ADD COLUMN unitsPerStrip INTEGER',
    'ALTER TABLE products ADD COLUMN reorderQuantity INTEGER',
    'ALTER TABLE products ADD COLUMN pctCode TEXT',
    // Batches
    'ALTER TABLE batches ADD COLUMN variantId TEXT',
    // Sales — prescription link (C1), folio link (C5), salesperson (C6),
    // FBR mirrors (B7; written by the server, pulled down with the sale)
    'ALTER TABLE sales ADD COLUMN prescriptionId TEXT',
    'ALTER TABLE sales ADD COLUMN folioId TEXT',
    'ALTER TABLE sales ADD COLUMN salespersonId TEXT',
    'ALTER TABLE sales ADD COLUMN fbrInvoiceNumber TEXT',
    'ALTER TABLE sales ADD COLUMN fbrStatus TEXT',
    // Sale items — unit engine (C2) + variant snapshot (C6)
    'ALTER TABLE sale_items ADD COLUMN unitLevel TEXT',
    'ALTER TABLE sale_items ADD COLUMN unitFactor INTEGER',
    'ALTER TABLE sale_items ADD COLUMN variantId TEXT',
    'ALTER TABLE sale_items ADD COLUMN variantName TEXT'
  ];

  columnMigrations.forEach(sql => {
    try { db.run(sql); } catch (e) { /* Column might already exist */ }
  });

  // QA fix 2026-10-19 (Track C C-03): auto-flag EXISTING installs — any
  // account whose stored hash is still the shipped default password's bcrypt
  // hash (a public constant) must change its password at next login. The
  // hash is used here ONLY as a detection fingerprint.
  // QA fix 2026-10-20 (Agent B2, B-2): the fingerprint is now the TRUE
  // bcrypt('admin123') hash, and rows still carrying the LEGACY BROKEN
  // constant are repaired first — their password is reset to the true
  // default hash so the documented admin/admin123 login works, with the
  // forced-change flag set so C-03 still gates the first real session.
  try {
    db.run(
      'UPDATE users SET password = ?, mustChangePassword = 1 WHERE password = ?',
      [DEFAULT_ADMIN_PASSWORD_HASH, LEGACY_BROKEN_PASSWORD_HASH]
    );
    db.run(
      'UPDATE users SET mustChangePassword = 1 WHERE password = ? AND (mustChangePassword IS NULL OR mustChangePassword = 0)',
      [DEFAULT_ADMIN_PASSWORD_HASH]
    );
    console.log('[DB] ✅ Default-password accounts repaired/flagged for forced password change (if any)');
  } catch (e) {
    console.log('[DB] Default-password flagging skipped:', e.message);
  }

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

/**
 * Seed the first-run company / branch / admin / superadmin on a FRESH
 * database (QA fix 2026-10-20, Agent B2, B-1/B-3).
 *
 * This function was called at the end of initDatabase() but never defined,
 * so the embedded server's own seeding threw "createDefaultAdmin is not
 * defined" and a fresh install had NO login-able account. main.js performs
 * the same seed when better-sqlite3 is available, but the packaged app
 * cannot rely on that module (it is not packaged — B-3), so the server
 * seeds its own database here using sql.js, the runtime it actually loads.
 *
 * The seed mirrors main.js exactly (same company/branch names, same
 * accounts) and is idempotent: it runs only when the users table is empty,
 * and every insert is INSERT OR IGNORE, so whichever process seeds first
 * (main.js or this server) wins and the other no-ops — no duplicate-admin
 * crash when both run. Both accounts are created active with
 * mustChangePassword = 1, preserving the C-03 forced-change gate.
 */
function createDefaultAdmin() {
  try {
    const existing = query('SELECT COUNT(*) as count FROM users');
    const userCount = existing[0]?.count || 0;
    if (userCount > 0) {
      console.log(`[DB] ℹ️ ${userCount} user(s) already exist — skipping default admin seed`);
      return;
    }

    console.log('[DB] 🌱 Fresh database — seeding default company, branch, admin and superadmin...');
    const timestamp = now();
    const companyId = uuid();
    const branchId = uuid();
    const adminId = uuid();
    const superadminId = uuid();

    run(`INSERT OR IGNORE INTO companies (id, name, description, address, phone, email, businessType, createdBy, isActive, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [companyId, 'My Pharmacy', 'Local pharmacy business', '123 Main Street', '+1234567890', 'admin@pharmacy.local', 'PHARMACY', adminId, timestamp, timestamp]);

    run(`INSERT OR IGNORE INTO branches (id, name, address, phone, email, companyId, isActive, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      [branchId, 'Main Branch', '123 Main Street', '+1234567890', 'branch@pharmacy.local', companyId, timestamp, timestamp]);

    run(`INSERT OR IGNORE INTO users (id, username, email, password, name, role, branchId, companyId, isActive, mustChangePassword, createdBy, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`,
      [adminId, 'admin', 'admin@pharmacy.local', DEFAULT_ADMIN_PASSWORD_HASH, 'Administrator', 'ADMIN', branchId, companyId, adminId, timestamp, timestamp]);

    run(`INSERT OR IGNORE INTO users (id, username, email, password, name, role, branchId, companyId, isActive, mustChangePassword, createdBy, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`,
      [superadminId, 'superadmin', 'superadmin@pharmacy.local', DEFAULT_ADMIN_PASSWORD_HASH, 'Super Administrator', 'SUPERADMIN', branchId, companyId, superadminId, timestamp, timestamp]);

    saveDatabase();
    console.log('[DB] ✅ Default admin + superadmin seeded (username: admin) — password change REQUIRED at first login');
  } catch (e) {
    console.error('[DB] ❌ createDefaultAdmin failed:', e.message);
  }
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

// v1.0.8 fixup (RC-1c observability): the last error string from run()
// (null after a successful write). Lets the sync engine surface the real
// DB error — e.g. the missing column name — in the per-record failure
// entry instead of a generic 'Database write failed'.
function getLastDbError() {
  return lastDbError;
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
  createDefaultAdmin,
  saveDatabase,
  query,
  run,
  getLastDbError,
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
