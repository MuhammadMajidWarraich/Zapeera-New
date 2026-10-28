/**
 * Standalone regression tests for the 2026-10-28 embedded ports
 * (item 4) + the M1/M3/L2 fixes + the mustRun write-failure fix.
 * Run:  node electron/routes/embedded-ports.test.js
 * Requires sql.js (frontend node_modules). Exits non-zero on failure.
 *
 * Harness: in-memory sql.js DB with the columns the handlers touch,
 * a fake Express app that runs the middleware chain (auth + module
 * gates), and the real getDataFilter / requireModule / mustRun code.
 * query()/run() mimic database.service.js semantics exactly: query
 * returns [] on error, run returns false on error (never throws).
 */
const assert = require('assert');
const path = require('path');
const { v4: uuid } = require('uuid');

let SQL;
try {
  SQL = require('sql.js');
} catch (e) {
  SQL = require(path.join(__dirname, '..', '..', 'node_modules', 'sql.js'));
}
const { getDataFilter } = require('../utils/helpers');
const { mustRun } = require('../utils/db-write');

async function main() {
  const SQLLib = await SQL();
  const db = new SQLLib.Database();

  const DDL = [
    `CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT, businessType TEXT, isActive INTEGER, createdBy TEXT)`,
    `CREATE TABLE branches (id TEXT PRIMARY KEY, name TEXT, companyId TEXT, isActive INTEGER)`,
    `CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, email TEXT, username TEXT, companyId TEXT, isActive INTEGER, role TEXT)`,
    `CREATE TABLE memberships (id TEXT PRIMARY KEY, userId TEXT, businessId TEXT, businessName TEXT, businessType TEXT, role TEXT, branchIds TEXT, subscriptionPlan TEXT, subscriptionStatus TEXT, status TEXT, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE staff_profiles (id TEXT PRIMARY KEY, membershipId TEXT, employeeId TEXT, designation TEXT, joiningDate TEXT, isActive INTEGER)`,
    `CREATE TABLE shifts (id TEXT PRIMARY KEY, staffProfileId TEXT, membershipId TEXT, branchId TEXT, status TEXT, startTime TEXT, shiftDate TEXT, openingBalance REAL, cashIn REAL, cashOut REAL, expectedBalance REAL, actualBalance REAL, difference REAL, endTime TEXT, notes TEXT, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE categories (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, type TEXT DEFAULT 'GENERAL', color TEXT DEFAULT '#3B82F6', branchId TEXT, companyId TEXT, isActive INTEGER DEFAULT 1, createdBy TEXT, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT NOT NULL, genericName TEXT, sku TEXT, barcode TEXT, description TEXT, categoryId TEXT, branchId TEXT, companyId TEXT, unitPrice REAL DEFAULT 0, costPrice REAL DEFAULT 0, sellingPrice REAL DEFAULT 0, quantity INTEGER DEFAULT 0, minStock INTEGER DEFAULT 10, maxStock INTEGER DEFAULT 1000, unitsPerPack INTEGER DEFAULT 1, unitsPerStrip INTEGER, reorderQuantity INTEGER, pctCode TEXT, reorderLevel INTEGER DEFAULT 20, requiresPrescription INTEGER DEFAULT 0, unitType TEXT DEFAULT 'PIECE', manufacturerId TEXT, supplierId TEXT, shelfId TEXT, expiryDate TEXT, manufacturingDate TEXT, batchNumber TEXT, additionalBarcodes TEXT, barcodeType TEXT, isGenerated INTEGER DEFAULT 0, isControlled INTEGER DEFAULT 0, controlledSchedule TEXT, taxClassId TEXT, isService INTEGER DEFAULT 0, uuid TEXT, syncStatus TEXT DEFAULT 'PENDING', isActive INTEGER DEFAULT 1, createdBy TEXT, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE batches (id TEXT PRIMARY KEY, batchNo TEXT NOT NULL, productId TEXT NOT NULL, branchId TEXT NOT NULL, companyId TEXT NOT NULL, supplierId TEXT, supplierName TEXT, barcode TEXT, totalBoxes INTEGER DEFAULT 0, unitsPerBox INTEGER DEFAULT 0, quantity INTEGER DEFAULT 0, purchasePrice REAL DEFAULT 0, sellingPrice REAL DEFAULT 0, stockPurchasePrice REAL DEFAULT 0, paidAmount REAL DEFAULT 0, supplierOutstanding REAL DEFAULT 0, supplierInvoiceNo TEXT, purchasingMethod TEXT, expireDate TEXT, productionDate TEXT, shelfId TEXT, shelfName TEXT, variantId TEXT, isActive INTEGER DEFAULT 1, isReported INTEGER DEFAULT 0, reportReason TEXT, createdBy TEXT, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE sales (id TEXT PRIMARY KEY, invoiceNumber TEXT, receiptNumber TEXT, customerId TEXT, branchId TEXT, companyId TEXT, totalAmount REAL, discount REAL, tax REAL, grandTotal REAL, paidAmount REAL, returnedAmount REAL, paymentMethod TEXT, paymentStatus TEXT, status TEXT, channel TEXT, saleDate TEXT, subtotal REAL, taxAmount REAL, provincialTaxAmount REAL, discountAmount REAL, discountPercentage REAL, loyaltyDiscount REAL, loyaltyPointsEarned INTEGER, loyaltyPointsRedeemed INTEGER, promotionDiscount REAL, giftCardAmount REAL, walletAmount REAL, membershipId TEXT, externalOrderId TEXT, postexTrackingNumber TEXT, postexShipmentStatus TEXT, deliveryAddress TEXT, deliveryPhone TEXT, deliveryNotes TEXT, userId TEXT, uuid TEXT, syncStatus TEXT, notes TEXT, employeeId TEXT, prescriptionId TEXT, folioId TEXT, salespersonId TEXT, shiftId TEXT, fbrInvoiceNumber TEXT, fbrStatus TEXT, createdBy TEXT, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE sale_items (id TEXT PRIMARY KEY, saleId TEXT, productId TEXT, batchId TEXT, quantity REAL, unitPrice REAL, discount REAL, total REAL, createdAt TEXT)`,
    `CREATE TABLE sale_payments (id TEXT PRIMARY KEY, saleId TEXT, method TEXT, amount REAL, reference TEXT, createdAt TEXT)`,
    `CREATE TABLE stock_movements (id TEXT PRIMARY KEY, productId TEXT, type TEXT, quantity REAL, reason TEXT, referenceId TEXT, referenceType TEXT, branchId TEXT, companyId TEXT, createdBy TEXT, createdAt TEXT)`,
    `CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT, phone TEXT, email TEXT, branchId TEXT, companyId TEXT, isActive INTEGER, createdAt TEXT)`,
    `CREATE TABLE prescriptions (id TEXT PRIMARY KEY, companyId TEXT, branchId TEXT, patientName TEXT, patientPhone TEXT, doctorName TEXT, doctorReg TEXT, notes TEXT, imageUrl TEXT, issuedDate TEXT, reviewStatus TEXT, reviewedBy TEXT, reviewedAt TEXT, reviewNote TEXT, source TEXT, isActive INTEGER, voidReason TEXT, voidedAt TEXT, voidedBy TEXT, createdBy TEXT, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE prescription_items (id TEXT PRIMARY KEY, prescriptionId TEXT, productId TEXT, productName TEXT, quantity REAL, dosage TEXT, durationDays INTEGER, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE parked_sales (id TEXT PRIMARY KEY, businessId TEXT, branchId TEXT, createdById TEXT, customerId TEXT, label TEXT, payload TEXT, itemCount INTEGER, grandTotal REAL, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE patients (id TEXT PRIMARY KEY, companyId TEXT, branchId TEXT, name TEXT, phone TEXT, age INTEGER, gender TEXT, cnic TEXT, address TEXT, notes TEXT, isActive INTEGER, createdBy TEXT, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE doctors (id TEXT PRIMARY KEY, companyId TEXT, branchId TEXT, name TEXT, specialization TEXT, phone TEXT, consultationFee REAL, sharePercent REAL, serviceProductId TEXT, isActive INTEGER, createdBy TEXT, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE appointments (id TEXT PRIMARY KEY, companyId TEXT, branchId TEXT, patientId TEXT, doctorId TEXT, appointmentDate TEXT, tokenNumber INTEGER, status TEXT, reason TEXT, notes TEXT, saleId TEXT, prescriptionId TEXT, feeCharged REAL, doctorShareAmount REAL, createdBy TEXT, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE doctor_settlements (id TEXT PRIMARY KEY, companyId TEXT, branchId TEXT, doctorId TEXT, amount REAL, method TEXT, reference TEXT, settledAt TEXT, createdBy TEXT, createdAt TEXT)`,
    `CREATE TABLE room_types (id TEXT PRIMARY KEY, companyId TEXT, branchId TEXT, name TEXT, ratePerNight REAL, capacity INTEGER, description TEXT, isActive INTEGER, createdBy TEXT, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE rooms (id TEXT PRIMARY KEY, companyId TEXT, branchId TEXT, roomTypeId TEXT, number TEXT, floor TEXT, status TEXT, isActive INTEGER, createdBy TEXT, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE reservations (id TEXT PRIMARY KEY, companyId TEXT, branchId TEXT, roomId TEXT, guestName TEXT, guestPhone TEXT, guestCnic TEXT, cnicDocumentUrl TEXT, guestPhotoUrls TEXT, checkInDate TEXT, checkOutDate TEXT, adults INTEGER, children INTEGER, source TEXT, status TEXT, folioId TEXT, notes TEXT, createdBy TEXT, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE folios (id TEXT PRIMARY KEY, companyId TEXT, branchId TEXT, reservationId TEXT, roomId TEXT, guestName TEXT, guestPhone TEXT, rateSnapshot REAL, status TEXT, openedAt TEXT, closedAt TEXT, saleId TEXT, writeOffAmount REAL, writeOffNote TEXT, createdBy TEXT, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE folio_charges (id TEXT PRIMARY KEY, folioId TEXT, description TEXT, amount REAL, kind TEXT, chargeDate TEXT, saleId TEXT, createdBy TEXT, createdAt TEXT)`,
    `CREATE TABLE folio_payments (id TEXT PRIMARY KEY, folioId TEXT, amount REAL, method TEXT, paidAt TEXT, note TEXT, createdBy TEXT, createdAt TEXT)`,
    `CREATE TABLE expenses (id TEXT PRIMARY KEY, title TEXT, description TEXT, vendor TEXT, amount REAL, expenseDate TEXT, paymentMethod TEXT, reference TEXT, status TEXT, companyId TEXT, branchId TEXT, categoryId TEXT, createdBy TEXT, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE expense_categories (id TEXT PRIMARY KEY, companyId TEXT, branchId TEXT, name TEXT, description TEXT, isActive INTEGER, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE stock_transfers (id TEXT PRIMARY KEY, transferNumber TEXT, companyId TEXT, fromBranchId TEXT, toBranchId TEXT, status TEXT, notes TEXT, createdBy TEXT, completedBy TEXT, completedAt TEXT, cancelledBy TEXT, cancelledAt TEXT, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE stock_transfer_items (id TEXT PRIMARY KEY, transferId TEXT, productId TEXT, sourceBatchId TEXT, destBatchId TEXT, quantity REAL, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE stock_takes (id TEXT PRIMARY KEY, companyId TEXT, branchId TEXT, status TEXT, startedBy TEXT, completedBy TEXT, note TEXT, completedAt TEXT, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE stock_take_lines (id TEXT PRIMARY KEY, stockTakeId TEXT, productId TEXT, batchId TEXT, systemQty REAL, countedQty REAL, variance REAL, adjustmentMovementId TEXT, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE tax_classes (id TEXT PRIMARY KEY, companyId TEXT, name TEXT, rate REAL, isDefault INTEGER, isActive INTEGER, description TEXT, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE provincial_tax_configs (id TEXT PRIMARY KEY, companyId TEXT, branchId TEXT, authority TEXT, authorityName TEXT, registrationNumber TEXT, rate REAL, enabled INTEGER, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE controlled_dispense_logs (id TEXT PRIMARY KEY, companyId TEXT, branchId TEXT, productId TEXT, batchId TEXT, batchNo TEXT, saleId TEXT, saleItemId TEXT, entryType TEXT, quantity INTEGER, balanceAfter INTEGER, reversesId TEXT, reason TEXT, staffUserId TEXT, staffName TEXT, customerId TEXT, customerName TEXT, prescriptionId TEXT, prescriptionRef TEXT, invoiceNumber TEXT, createdAt TEXT)`,
    `CREATE TABLE gift_cards (id TEXT PRIMARY KEY, code TEXT, companyId TEXT, branchId TEXT, initialValue REAL, balance REAL, recipientName TEXT, recipientPhone TEXT, purchasedBy TEXT, paymentMethod TEXT, status TEXT, expiresAt TEXT, createdBy TEXT, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE gift_card_transactions (id TEXT PRIMARY KEY, giftCardId TEXT, companyId TEXT, type TEXT, amount REAL, balanceAfter REAL, note TEXT, createdBy TEXT, createdAt TEXT)`,
    `CREATE TABLE roles (id TEXT PRIMARY KEY, businessId TEXT, name TEXT, description TEXT, isSystem INTEGER, isActive INTEGER, permissionState TEXT, policyVersion INTEGER, createdAt TEXT, updatedAt TEXT)`,
    // Scheduled shifts start as the OLD stub table (id/shiftId/date/
    // branchId/companyId/createdBy) — the route must migrate it.
    `CREATE TABLE scheduled_shifts (id TEXT PRIMARY KEY, shiftId TEXT, date TEXT, branchId TEXT, companyId TEXT, createdBy TEXT, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE scheduled_shift_users (id TEXT PRIMARY KEY, scheduledShiftId TEXT, userId TEXT, createdAt TEXT)`,
    `CREATE TABLE subscription_addons (id TEXT PRIMARY KEY, businessId TEXT, type TEXT, status TEXT, createdAt TEXT)`,
    `CREATE TABLE refunds (id TEXT PRIMARY KEY, saleId TEXT, amount REAL, reason TEXT, branchId TEXT, companyId TEXT, status TEXT, createdBy TEXT, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE refund_items (id TEXT PRIMARY KEY, refundId TEXT, saleItemId TEXT, productId TEXT, quantity INTEGER, amount REAL, reason TEXT, createdAt TEXT, updatedAt TEXT)`,
    `CREATE TABLE purchases (id TEXT PRIMARY KEY, branchId TEXT, companyId TEXT, supplierId TEXT, status TEXT, grandTotal REAL, paidAmount REAL, createdAt TEXT)`,
    `CREATE TABLE purchase_items (id TEXT PRIMARY KEY, purchaseId TEXT, productId TEXT, batchId TEXT, quantity INTEGER, unitPrice REAL, total REAL, createdAt TEXT)`,
    `CREATE TABLE suppliers (id TEXT PRIMARY KEY, name TEXT, companyId TEXT, branchId TEXT, isActive INTEGER)`,
  ];
  for (const sql of DDL) db.run(sql);

  // Same prepare/bind semantics as database.service.js.
  function query(sql, params = []) {
    try {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      const out = [];
      while (stmt.step()) out.push(stmt.getAsObject());
      stmt.free();
      return out;
    } catch (e) { return []; }
  }
  function run(sql, params = []) {
    try {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      stmt.step();
      stmt.free();
      return true;
    } catch (e) { return false; }
  }
  const enqueued = [];
  // Cloud stub for the subscription proxy tests: token null by default
  // (offline → 503); tests flip token/stubResponse to prove passthrough.
  const cloudStub = {
    token: null, stubResponse: null, lastCall: null,
    getAuthToken() { return this.token; },
    async makeRequest(method, path, body) {
      this.lastCall = { method, path, body };
      if (this.stubResponse) return this.stubResponse;
      throw new Error('cloud unreachable (stub)');
    },
  };
  const deps = {
    query, run,
    saveDatabase: () => {},
    handleDataChange: (entityType, op, row) => { enqueued.push({ entityType, op, id: row && row.id }); },
    getDataFilter, uuid, now: () => new Date().toISOString(),
    getIsOnline: () => false,
    cloudApi: cloudStub,
  };

  // Fake Express app: runs the middleware chain in order; the last fn
  // is the handler. Params are extracted from :segments.
  const routes = [];
  const app = {};
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) {
    app[m] = (route, ...fns) => { routes.push({ method: m, route, fns }); };
  }
  const authMiddleware = (req, res, next) => next();
  const { registerParkedSalesRoutes } = require('./parked-sales.routes');
  const { registerBarcodeRoutes } = require('./barcodes.routes');
  const { registerClinicRoutes } = require('./clinic.routes');
  const { registerHotelRoutes } = require('./hotel.routes');
  const { registerTransferRoutes } = require('./transfers.routes');
  const { registerStockTakeRoutes } = require('./stock-takes.routes');
  const { registerTaxClassRoutes } = require('./tax-classes.routes');
  const { registerScheduledShiftRoutes } = require('./scheduled-shifts.routes');
  const { registerPrescriptionsRoutes } = require('./prescriptions.routes');
  const { registerModulesRoutes } = require('./modules.routes');
  const { registerBusinessTypesRoutes } = require('./business-types.routes');
  const { registerPurchasesRoutes } = require('./purchases.routes');
  const { registerStaffRoutes } = require('./staff.routes');
  const { registerUsersRoutes } = require('./users.routes');
  const { registerReportsRoutes } = require('./reports.routes');
  const { registerSalesRoutes } = require('./sales.routes');
  const { registerSubscriptionRoutes } = require('./subscription.routes');
  const { registerCompaniesRoutes } = require('./companies.routes');
  const { registerShiftsRoutes } = require('./shifts.routes');
  for (const fn of [registerParkedSalesRoutes, registerBarcodeRoutes, registerClinicRoutes,
    registerHotelRoutes, registerTransferRoutes, registerStockTakeRoutes, registerTaxClassRoutes,
    registerScheduledShiftRoutes, registerPrescriptionsRoutes, registerModulesRoutes,
    registerBusinessTypesRoutes, registerPurchasesRoutes, registerStaffRoutes, registerUsersRoutes,
    registerReportsRoutes, registerSalesRoutes, registerSubscriptionRoutes, registerCompaniesRoutes,
    registerShiftsRoutes]) {
    fn(app, authMiddleware, deps);
  }

  function matchRoute(pattern, path) {
    const pp = pattern.split('/').filter(Boolean);
    const ap = path.split('/').filter(Boolean);
    if (pp.length !== ap.length) return null;
    const params = {};
    for (let i = 0; i < pp.length; i++) {
      if (pp[i].startsWith(':')) params[pp[i].slice(1)] = decodeURIComponent(ap[i]);
      else if (pp[i] !== ap[i]) return null;
    }
    return params;
  }
  function call(method, path, opts = {}) {
    return new Promise((resolve) => {
      const found = routes.find((r) => r.method === method && matchRoute(r.route, path.split('?')[0]));
      if (!found) return resolve({ statusCode: 404, body: { success: false, message: 'NO ROUTE ' + method + ' ' + path } });
      const req = {
        method, path: path.split('?')[0], params: matchRoute(found.route, path.split('?')[0]),
        query: opts.query || {}, body: opts.body || {}, headers: opts.headers || {},
        user: opts.user || { id: 'u-owner', name: 'Owner', role: 'OWNER', companyId: 'biz-pharm', selectedCompanyId: 'biz-pharm', branchId: 'br-a', selectedBranchId: 'br-a' },
        originalUrl: path,
      };
      let settled = false;
      const res = {
        statusCode: 200, body: null,
        status(c) { this.statusCode = c; return this; },
        json(b) { this.body = b; if (!settled) { settled = true; resolve(this); } return this; },
      };
      const fns = found.fns;
      let i = 0;
      const next = () => {
        if (settled) return;
        if (i >= fns.length) { if (!settled) { settled = true; resolve(res); } return; }
        const fn = fns[i++];
        try {
          const out = fn(req, res, next);
          if (out && typeof out.catch === 'function') out.catch(() => { if (!settled) { settled = true; resolve(res); } });
        } catch (e) { if (!settled) { settled = true; res.statusCode = 500; res.body = { success: false, message: e.message }; resolve(res); } }
      };
      next();
    });
  }

  // ── Seed ────────────────────────────────────────────────────────
  const NOW = '2026-10-28T10:00:00.000Z';
  db.run(`INSERT INTO companies VALUES
    ('biz-pharm','Seikho Medicos','PHARMACY',1,'u-owner'),
    ('biz-clinic','Seikho Clinic','CLINIC',1,'u-owner'),
    ('biz-hotel','Seikho Hotel','HOTEL',1,'u-owner')`);
  db.run(`INSERT INTO branches VALUES
    ('br-a','Main','biz-pharm',1), ('br-b','Gulberg','biz-pharm',1),
    ('br-c','Clinic Main','biz-clinic',1), ('br-h','Hotel Main','biz-hotel',1)`);
  db.run(`INSERT INTO users VALUES
    ('u-owner','Owner','owner@test','owner','biz-pharm',1,'OWNER'),
    ('u-cashier','Cashier','cashier@test','cashier','biz-pharm',1,'CASHIER'),
    ('u-clinic','Clinic Owner','clinic@test','clinic','biz-clinic',1,'OWNER'),
    ('u-hotel','Hotel Owner','hotel@test','hotel','biz-hotel',1,'OWNER'),
    ('u-staff','Staff One','staff@test','staff','biz-pharm',1,'CASHIER')`);
  db.run(`INSERT INTO memberships VALUES
    ('m-owner','u-owner','biz-pharm','Seikho Medicos','PHARMACY','OWNER','["br-a"]',NULL,NULL,'ACTIVE','${NOW}','${NOW}'),
    ('m-cashier','u-cashier','biz-pharm','Seikho Medicos','PHARMACY','CASHIER','["br-a"]',NULL,NULL,'ACTIVE','${NOW}','${NOW}'),
    ('m-staff','u-staff','biz-pharm','Seikho Medicos','PHARMACY','CASHIER','["br-a"]',NULL,NULL,'ACTIVE','${NOW}','${NOW}'),
    ('m-clinic','u-clinic','biz-clinic','Seikho Clinic','CLINIC','OWNER','["br-c"]',NULL,NULL,'ACTIVE','${NOW}','${NOW}'),
    ('m-hotel','u-hotel','biz-hotel','Seikho Hotel','HOTEL','OWNER','["br-h"]',NULL,NULL,'ACTIVE','${NOW}','${NOW}')`);
  db.run(`INSERT INTO staff_profiles VALUES ('sp-staff','m-staff','EMP-1','Cashier','2026-01-01',1)`);
  db.run(`INSERT INTO customers VALUES ('cust-1','Walk-in','03000000000',NULL,'br-a','biz-pharm',1,'${NOW}')`);

  let passed = 0;
  function check(name, cond, extra) {
    assert.ok(cond, name + (extra !== undefined ? ' — got: ' + JSON.stringify(extra) : ''));
    passed++;
    console.log('  ✓ ' + name);
  }

  // ── 0. mustRun: the write-failure fix ──────────────────────────
  console.log('\n[0] mustRun');
  assert.throws(() => mustRun(() => false, 'DELETE FROM x WHERE id = ?', ['1']), /Database write failed/, 'run()=false must throw');
  assert.strictEqual(mustRun(() => true, 'SELECT 1'), true, 'run()=true must pass through');
  passed += 2;
  console.log('  ✓ run()=false throws so compensating rollbacks fire');
  console.log('  ✓ run()=true passes through');

  const ownerPharm = { id: 'u-owner', name: 'Owner', role: 'OWNER', companyId: 'biz-pharm', selectedCompanyId: 'biz-pharm', branchId: 'br-a', selectedBranchId: 'br-a' };
  const cashier = { id: 'u-cashier', name: 'Cashier', role: 'CASHIER', companyId: 'biz-pharm', selectedCompanyId: 'biz-pharm', branchId: 'br-a', selectedBranchId: 'br-a' };
  const clinicOwner = { id: 'u-clinic', name: 'Clinic Owner', role: 'OWNER', companyId: 'biz-clinic', selectedCompanyId: 'biz-clinic', branchId: 'br-c', selectedBranchId: 'br-c' };
  const hotelOwner = { id: 'u-hotel', name: 'Hotel Owner', role: 'OWNER', companyId: 'biz-hotel', selectedCompanyId: 'biz-hotel', branchId: 'br-h', selectedBranchId: 'br-h' };

  // ── 1. Business-type gating: /api/modules/enabled + /business-types/:id/modules ──
  console.log('\n[1] business-type gating');
  let r = await call('get', '/api/modules/enabled', { user: ownerPharm });
  check('pharmacy sees prescriptions enabled', r.body.data.find((m) => m.name === 'prescriptions')?.enabled === true, r.body);
  check('pharmacy does NOT see patients enabled', r.body.data.find((m) => m.name === 'patients')?.enabled === false, r.body);
  check('pharmacy does NOT see rooms enabled', r.body.data.find((m) => m.name === 'rooms')?.enabled === false, r.body);
  r = await call('get', '/api/modules/enabled', { user: clinicOwner });
  check('clinic sees patients enabled', r.body.data.find((m) => m.name === 'patients')?.enabled === true, r.body);
  check('clinic does NOT see prescriptions enabled', r.body.data.find((m) => m.name === 'prescriptions')?.enabled === false, r.body);
  r = await call('get', '/api/business-types/clinic/modules', { user: clinicOwner });
  check('business-types/clinic/modules lists patients enabled', r.body.data.find((m) => m.name === 'patients')?.enabled === true, r.body);
  r = await call('get', '/api/business-types/nope/modules', { user: clinicOwner });
  check('unknown business type 404s', r.statusCode === 404, r.statusCode);
  r = await call('get', '/api/business-types/modules', { user: clinicOwner });
  check('module catalog is non-empty', Array.isArray(r.body.data) && r.body.data.length >= 8, r.body.data?.length);

  // ── 2. Parked sales ────────────────────────────────────────────
  console.log('\n[2] parked sales');
  db.run(`INSERT INTO products (id, name, sku, barcode, additionalBarcodes, branchId, companyId, categoryId, isActive, isService, isControlled, controlledSchedule, quantity, reorderLevel, reorderQuantity, unitsPerPack, unitsPerStrip, costPrice, sellingPrice, unitPrice, taxClassId, minStock, createdAt, updatedAt) VALUES ('p-park','Parked Item','PK-1',NULL,NULL,'br-a','biz-pharm',NULL,1,0,0,NULL,100,NULL,NULL,NULL,NULL,25,25,NULL,NULL,0,'${NOW}','${NOW}')`);
  r = await call('post', '/api/parked-sales', { user: ownerPharm, body: { branchId: 'br-a', label: 'Hold 1', payload: { items: [{ productId: 'p-park', quantity: 2, price: 50 }, { productId: 'p-park', quantity: 1 }] } } });
  check('parked sale created (201)', r.statusCode === 201, r.statusCode);
  const parkedId = r.body.data.parkedSale.id;
  check('itemCount derived (3)', r.body.data.parkedSale.itemCount === 3, r.body.data.parkedSale);
  check('grandTotal derived (2x50 + 1x25 = 125)', r.body.data.parkedSale.grandTotal === 125, r.body.data.parkedSale);
  r = await call('get', '/api/parked-sales', { user: ownerPharm });
  check('list carries the hold', r.body.data.parkedSales.length === 1, r.body.data);
  check('list item has NO payload', r.body.data.parkedSales[0].payload === undefined, Object.keys(r.body.data.parkedSales[0]));
  r = await call('get', `/api/parked-sales/${parkedId}`, { user: ownerPharm });
  check('detail carries the payload', Array.isArray(r.body.data.parkedSale.payload?.items) && r.body.data.parkedSale.payload.items.length === 2, r.body.data);
  r = await call('post', '/api/parked-sales', { user: ownerPharm, body: { branchId: 'br-a', payload: { items: [] } } });
  check('empty items rejected (400)', r.statusCode === 400, r.statusCode);
  r = await call('post', `/api/parked-sales/${parkedId}/discard`, { user: ownerPharm });
  check('discard succeeds', r.statusCode === 200, r.statusCode);
  r = await call('get', `/api/parked-sales/${parkedId}`, { user: ownerPharm });
  check('discarded hold is gone (404)', r.statusCode === 404, r.statusCode);

  // ── 3. Barcode lookup match order ──────────────────────────────
  console.log('\n[3] barcode lookup');
  db.run(`INSERT INTO products (id, name, sku, barcode, additionalBarcodes, branchId, companyId, categoryId, isActive, isService, isControlled, controlledSchedule, quantity, reorderLevel, reorderQuantity, unitsPerPack, unitsPerStrip, costPrice, sellingPrice, unitPrice, taxClassId, minStock, createdAt, updatedAt) VALUES
    ('p-bc1','Primary','BC1-P','BC1001',NULL,'br-a','biz-pharm',NULL,1,0,0,NULL,10,NULL,NULL,NULL,NULL,10,20,NULL,NULL,0,'${NOW}','${NOW}'),
    ('p-bc2','Additional','BC2-P',NULL,'["BC2002"]','br-a','biz-pharm',NULL,1,0,0,NULL,10,NULL,NULL,NULL,NULL,10,20,NULL,NULL,0,'${NOW}','${NOW}'),
    ('p-bc3','BatchCode','BC3-P',NULL,NULL,'br-a','biz-pharm',NULL,1,0,0,NULL,10,NULL,NULL,NULL,NULL,10,20,NULL,NULL,0,'${NOW}','${NOW}'),
    ('p-bc4','SkuOnly','SKU4004',NULL,NULL,'br-a','biz-pharm',NULL,1,0,0,NULL,10,NULL,NULL,NULL,NULL,10,20,NULL,NULL,0,'${NOW}','${NOW}')`);
  db.run(`INSERT INTO batches (id, batchNo, productId, branchId, companyId, supplierId, supplierName, barcode, quantity, purchasePrice, sellingPrice, stockPurchasePrice, expireDate, productionDate, purchasingMethod, shelfId, shelfName, variantId, isActive, createdBy, createdAt, updatedAt) VALUES
    ('bb-1','B1','p-bc1','br-a','biz-pharm',NULL,NULL,NULL,5,10,20,10,'2030-01-01',NULL,NULL,NULL,NULL,NULL,1,'u-owner','${NOW}','${NOW}'),
    ('bb-2','B2','p-bc2','br-a','biz-pharm',NULL,NULL,NULL,3,10,20,10,'2030-01-01',NULL,NULL,NULL,NULL,NULL,1,'u-owner','${NOW}','${NOW}'),
    ('bb-3','B3','p-bc3','br-a','biz-pharm',NULL,NULL,'BC3003',7,10,20,10,'2030-01-01',NULL,NULL,NULL,NULL,NULL,1,'u-owner','${NOW}','${NOW}'),
    ('bb-4','B4','p-bc4','br-a','biz-pharm',NULL,NULL,NULL,2,10,20,10,'2030-01-01',NULL,NULL,NULL,NULL,NULL,1,'u-owner','${NOW}','${NOW}')`);
  r = await call('post', '/api/barcodes/lookup', { user: ownerPharm, body: { barcode: 'BC1001' } });
  check('primary barcode matches', r.body.data.matchType === 'primary' && r.body.data.product.id === 'p-bc1', r.body.data);
  check('primary stock is the batch sum (5)', r.body.data.stock === 5, r.body.data);
  r = await call('post', '/api/barcodes/lookup', { user: ownerPharm, body: { barcode: 'BC2002' } });
  check('additional barcode matches', r.body.data.matchType === 'additional' && r.body.data.product.id === 'p-bc2', r.body.data);
  r = await call('post', '/api/barcodes/lookup', { user: ownerPharm, body: { barcode: 'BC3003' } });
  check('batch barcode matches and pins the batch', r.body.data.matchType === 'batch' && r.body.data.batch.id === 'bb-3', r.body.data);
  r = await call('post', '/api/barcodes/lookup', { user: ownerPharm, body: { barcode: 'SKU4004' } });
  check('SKU matches last', r.body.data.matchType === 'sku' && r.body.data.product.id === 'p-bc4', r.body.data);
  r = await call('post', '/api/barcodes/lookup', { user: ownerPharm, body: { barcode: 'NOPE-999' } });
  check('unknown barcode 404s with Create Product suggestion', r.statusCode === 404 && r.body.suggestion === 'Create Product', r.body);
  r = await call('post', '/api/barcodes/generate', { user: ownerPharm, body: { type: 'EAN13' } });
  check('generated barcode validates', r.statusCode === 200 && typeof r.body.data.barcode === 'string', r.body);
  const genCode = r.body.data.barcode;
  r = await call('post', '/api/barcodes/validate', { user: ownerPharm, body: { barcode: genCode } });
  check('generated EAN13 passes validation', r.body.data?.valid === true, r.body);

  // ── 4. Prescriptions extension ─────────────────────────────────
  console.log('\n[4] prescriptions');
  db.run(`INSERT INTO products (id, name, sku, barcode, additionalBarcodes, branchId, companyId, categoryId, isActive, isService, isControlled, controlledSchedule, quantity, reorderLevel, reorderQuantity, unitsPerPack, unitsPerStrip, costPrice, sellingPrice, unitPrice, taxClassId, minStock, createdAt, updatedAt) VALUES ('p-rx','Amoxicillin','RX-1',NULL,NULL,'br-a','biz-pharm',NULL,1,0,0,NULL,50,NULL,NULL,NULL,NULL,10,100,NULL,NULL,0,'${NOW}','${NOW}')`);
  r = await call('post', '/api/prescriptions', { user: ownerPharm, body: { branchId: 'br-a', patientName: 'Alice', issuedDate: '2026-10-28', items: [{ productId: 'p-rx', quantity: 2 }] } });
  check('prescription created (201, source STAFF)', r.statusCode === 201, r.statusCode);
  const rxId = r.body.data.id;
  check('created prescription is REVIEWED', r.body.data.reviewStatus === 'REVIEWED', r.body.data);
  r = await call('get', `/api/prescriptions/${rxId}`, { user: ownerPharm });
  check('get returns the items', r.body.data.items.length === 1 && r.body.data.items[0].quantity === 2, r.body.data);
  r = await call('put', `/api/prescriptions/${rxId}`, { user: ownerPharm, body: { items: [{ productId: 'p-rx', quantity: 3, dosage: '1x3' }] } });
  check('update replaces the line set wholesale', r.body.data.items.length === 1 && r.body.data.items[0].quantity === 3, r.body.data);
  r = await call('patch', `/api/prescriptions/${rxId}/review`, { user: cashier, body: { decision: 'REJECTED', note: 'no' } });
  check('cashier cannot review (403)', r.statusCode === 403, r.statusCode);
  r = await call('patch', `/api/prescriptions/${rxId}/review`, { user: ownerPharm, body: { decision: 'REJECTED', note: 'unclear handwriting' } });
  check('owner review rejects', r.statusCode === 200 && r.body.data.reviewStatus === 'REJECTED', r.body.data);
  r = await call('delete', `/api/prescriptions/${rxId}`, { user: ownerPharm, body: {} });
  check('void without reason rejected (400)', r.statusCode === 400, r.statusCode);
  r = await call('delete', `/api/prescriptions/${rxId}`, { user: ownerPharm, body: { reason: 'duplicate entry' } });
  check('void with reason succeeds', r.statusCode === 200 && r.body.data.isActive === 0, r.body.data);
  r = await call('delete', `/api/prescriptions/${rxId}`, { user: ownerPharm, body: { reason: 'again' } });
  check('double void rejected (400)', r.statusCode === 400, r.statusCode);
  r = await call('get', '/api/prescriptions', { user: clinicOwner });
  check('prescriptions module gate: clinic gets 403', r.statusCode === 403 && r.body.details?.code === 'MODULE_NOT_APPLICABLE_TO_BUSINESS_TYPE', r.body);

  // ── 5. Clinic: token machine + status machine + complete-visit ──
  console.log('\n[5] clinic');
  r = await call('post', '/api/patients', { user: clinicOwner, body: { name: 'Patient One', phone: '03011111111', branchId: 'br-c' } });
  check('patient created (201)', r.statusCode === 201, r.statusCode);
  const patientId = r.body.data.id;
  r = await call('post', '/api/doctors', { user: clinicOwner, body: { name: 'Dr Ayesha', consultationFee: 1000, sharePercent: 40, branchId: 'br-c' } });
  check('doctor created (201)', r.statusCode === 201, r.statusCode);
  const doctorId = r.body.data.id;
  r = await call('post', '/api/appointments', { user: clinicOwner, body: { patientId, doctorId, appointmentDate: '2026-10-29', branchId: 'br-c' } });
  check('first appointment gets token 1', r.statusCode === 201 && r.body.data.tokenNumber === 1, r.body.data);
  const apptId = r.body.data.id;
  r = await call('post', '/api/appointments', { user: clinicOwner, body: { patientId, doctorId, appointmentDate: '2026-10-29', branchId: 'br-c' } });
  check('second appointment same doctor+day gets token 2', r.statusCode === 201 && r.body.data.tokenNumber === 2, r.body.data);
  r = await call('patch', `/api/appointments/${apptId}/status`, { user: clinicOwner, body: { status: 'COMPLETED' } });
  check('COMPLETED by hand is refused (400)', r.statusCode === 400, r.statusCode);
  r = await call('patch', `/api/appointments/${apptId}/status`, { user: clinicOwner, body: { status: 'CHECKED_IN' } });
  check('check-in works', r.statusCode === 200 && r.body.data.status === 'CHECKED_IN', r.body.data);
  r = await call('post', `/api/appointments/${apptId}/complete-visit`, { user: clinicOwner, body: { feeCharged: 1000, items: [] } });
  check('complete-visit succeeds (201)', r.statusCode === 201, r.statusCode);
  check('visit snapshots fee + 40% doctor share', r.body.data.appointment.feeCharged === 1000 && r.body.data.appointment.doctorShareAmount === 400, r.body.data.appointment);
  check('visit created a sale', r.body.data.sale && r.body.data.sale.grandTotal === 1000, r.body.data.sale);
  check('visit sale totalAmount is the grand total (M3)', r.body.data.sale.totalAmount === 1000, r.body.data.sale);
  r = await call('post', `/api/appointments/${apptId}/complete-visit`, { user: clinicOwner, body: { feeCharged: 1000 } });
  check('double completion refused (400)', r.statusCode === 400, r.statusCode);
  r = await call('get', '/api/patients', { user: ownerPharm });
  check('patients module gate: pharmacy gets 403', r.statusCode === 403, r.statusCode);

  // ── 6. Hotel: overlap, availability, check-in, check-out ───────
  console.log('\n[6] hotel');
  r = await call('post', '/api/room-types', { user: hotelOwner, body: { name: 'Deluxe', ratePerNight: 5000, capacity: 2, branchId: 'br-h' } });
  check('room type created (201)', r.statusCode === 201, r.statusCode);
  const roomTypeId = r.body.data.id;
  r = await call('post', '/api/rooms', { user: hotelOwner, body: { roomTypeId, number: '101', branchId: 'br-h' } });
  check('room created (201)', r.statusCode === 201, r.statusCode);
  const roomId = r.body.data.id;
  r = await call('post', '/api/reservations', { user: hotelOwner, body: { roomId, guestName: 'Guest One', checkInDate: '2026-11-01', checkOutDate: '2026-11-03', branchId: 'br-h' } });
  check('reservation created (201)', r.statusCode === 201, r.statusCode);
  const resvId = r.body.data.id;
  r = await call('post', '/api/reservations', { user: hotelOwner, body: { roomId, guestName: 'Guest Two', checkInDate: '2026-11-02', checkOutDate: '2026-11-04', branchId: 'br-h' } });
  check('overlapping reservation refused (409)', r.statusCode === 409, r.statusCode);
  r = await call('get', '/api/reservations/availability', { user: hotelOwner, query: { from: '2026-11-02', to: '2026-11-04' } });
  const roomAvail = (r.body.data || []).find((x) => x.id === roomId);
  check('overlapping room is not bookable', roomAvail && roomAvail.bookable === false, roomAvail);
  r = await call('get', '/api/reservations/availability', { user: hotelOwner, query: { from: '2026-11-05', to: '2026-11-07' } });
  check('free dates are bookable', (r.body.data || []).find((x) => x.id === roomId)?.bookable === true, r.body.data);
  r = await call('post', `/api/reservations/${resvId}/check-in`, { user: hotelOwner, body: {} });
  check('check-in opens a folio (201)', r.statusCode === 201 && r.body.data.folio.status === 'OPEN', r.body.data);
  const folioId = r.body.data.folio.id;
  check('room is OCCUPIED after check-in', query('SELECT status FROM rooms WHERE id = ?', [roomId])[0].status === 'OCCUPIED');
  check('first night charge posted at the snapshot rate', query('SELECT amount FROM folio_charges WHERE folioId = ?', [folioId])[0].amount === 5000);
  r = await call('post', `/api/folios/${folioId}/check-out`, { user: hotelOwner, body: {} });
  check('check-out with an unpaid balance is refused (400)', r.statusCode === 400 && r.body.code === 'FOLIO_BALANCE_DUE', r.body);
  r = await call('post', `/api/folios/${folioId}/check-out`, { user: hotelOwner, body: { payment: { amount: 5000, method: 'CASH' } } });
  check('check-out with the settling payment succeeds (201)', r.statusCode === 201, r.statusCode);
  check('folio is CLOSED after check-out', query('SELECT status FROM folios WHERE id = ?', [folioId])[0].status === 'CLOSED');
  check('room is DIRTY after check-out', query('SELECT status FROM rooms WHERE id = ?', [roomId])[0].status === 'DIRTY');
  check('reservation is COMPLETED after check-out', query('SELECT status FROM reservations WHERE id = ?', [resvId])[0].status === 'COMPLETED');
  check('check-out created a sale for the night', r.body.data.sale && r.body.data.sale.grandTotal === 5000, r.body.data.sale);
  r = await call('get', '/api/rooms', { user: ownerPharm });
  check('rooms module gate: pharmacy gets 403', r.statusCode === 403, r.statusCode);

  // ── 7. Transfers ───────────────────────────────────────────────
  console.log('\n[7] transfers');
  db.run(`INSERT INTO products (id, name, sku, barcode, additionalBarcodes, branchId, companyId, categoryId, isActive, isService, isControlled, controlledSchedule, quantity, reorderLevel, reorderQuantity, unitsPerPack, unitsPerStrip, costPrice, sellingPrice, unitPrice, taxClassId, minStock, createdAt, updatedAt) VALUES ('p-tr','Transfer Item','TR-1',NULL,NULL,'br-a','biz-pharm',NULL,1,0,0,NULL,10,NULL,NULL,NULL,NULL,50,80,NULL,NULL,0,'${NOW}','${NOW}')`);
  db.run(`INSERT INTO batches (id, batchNo, productId, branchId, companyId, supplierId, supplierName, barcode, quantity, purchasePrice, sellingPrice, stockPurchasePrice, expireDate, productionDate, purchasingMethod, shelfId, shelfName, variantId, isActive, createdBy, createdAt, updatedAt) VALUES ('bt-1','BT-1','p-tr','br-a','biz-pharm',NULL,NULL,NULL,10,50,80,50,'2030-01-01',NULL,NULL,NULL,NULL,NULL,1,'u-owner','${NOW}','${NOW}')`);
  r = await call('post', '/api/transfers', { user: ownerPharm, body: { fromBranchId: 'br-a', toBranchId: 'br-b', items: [{ productId: 'p-tr', sourceBatchId: 'bt-1', quantity: 4 }] } });
  check('transfer created PENDING (201)', r.statusCode === 201 && r.body.data.status === 'PENDING', r.body.data);
  const transferId = r.body.data.id;
  r = await call('post', `/api/transfers/${transferId}/complete`, { user: ownerPharm, body: {} });
  check('transfer completes (200)', r.statusCode === 200, r.statusCode);
  check('source batch decremented (10 -> 6)', query('SELECT quantity FROM batches WHERE id = ?', ['bt-1'])[0].quantity === 6);
  const destBatch = query('SELECT * FROM batches WHERE batchNo = ? AND branchId = ?', ['BT-1', 'br-b'])[0];
  check('destination batch created with the moved qty (4)', destBatch && destBatch.quantity === 4, destBatch);
  check('TRANSFER_OUT + TRANSFER_IN movements written', query("SELECT COUNT(*) as c FROM stock_movements WHERE referenceId = ?", [transferId])[0].c === 2);
  r = await call('post', `/api/transfers/${transferId}/complete`, { user: ownerPharm, body: {} });
  check('double completion refused (409)', r.statusCode === 409, r.statusCode);
  r = await call('post', '/api/transfers', { user: ownerPharm, body: { fromBranchId: 'br-a', toBranchId: 'br-b', items: [{ productId: 'p-tr', sourceBatchId: 'bt-1', quantity: 99 }] } });
  check('over-quantity transfer refused at create (409)', r.statusCode === 409, r.statusCode);
  r = await call('post', '/api/transfers', { user: ownerPharm, body: { fromBranchId: 'br-a', toBranchId: 'br-b', items: [{ productId: 'p-tr', sourceBatchId: 'bt-1', quantity: 1 }] } });
  const transferId2 = r.body.data.id;
  r = await call('post', `/api/transfers/${transferId2}/cancel`, { user: ownerPharm, body: {} });
  check('cancel works on PENDING', r.statusCode === 200 && r.body.data.status === 'CANCELLED', r.body.data);
  r = await call('post', `/api/transfers/${transferId2}/complete`, { user: ownerPharm, body: {} });
  check('cancelled transfer cannot complete (409)', r.statusCode === 409, r.statusCode);

  // ── 8. Stock-takes ─────────────────────────────────────────────
  console.log('\n[8] stock-takes');
  db.run(`INSERT INTO products (id, name, sku, barcode, additionalBarcodes, branchId, companyId, categoryId, isActive, isService, isControlled, controlledSchedule, quantity, reorderLevel, reorderQuantity, unitsPerPack, unitsPerStrip, costPrice, sellingPrice, unitPrice, taxClassId, minStock, createdAt, updatedAt) VALUES ('p-st','Count Item','ST-1',NULL,NULL,'br-a','biz-pharm',NULL,1,0,0,NULL,10,NULL,NULL,NULL,NULL,50,80,NULL,NULL,0,'${NOW}','${NOW}')`);
  db.run(`INSERT INTO batches (id, batchNo, productId, branchId, companyId, supplierId, supplierName, barcode, quantity, purchasePrice, sellingPrice, stockPurchasePrice, expireDate, productionDate, purchasingMethod, shelfId, shelfName, variantId, isActive, createdBy, createdAt, updatedAt) VALUES ('bt-st','BST-1','p-st','br-a','biz-pharm',NULL,NULL,NULL,10,50,80,50,'2030-01-01',NULL,NULL,NULL,NULL,NULL,1,'u-owner','${NOW}','${NOW}')`);
  r = await call('post', '/api/stock-takes', { user: ownerPharm, body: { branchId: 'br-a' } });
  check('stock-take created OPEN (201)', r.statusCode === 201 && r.body.data.status === 'OPEN', r.body.data);
  const takeId = r.body.data.id;
  r = await call('post', '/api/stock-takes', { user: ownerPharm, body: { branchId: 'br-a' } });
  check('second OPEN session for the branch refused (409)', r.statusCode === 409, r.statusCode);
  r = await call('post', `/api/stock-takes/${takeId}/lines`, { user: ownerPharm, body: { batchId: 'bt-st', countedQty: 7 } });
  check('count line snapshots system qty (10)', r.statusCode === 201 && r.body.data.systemQty === 10 && r.body.data.countedQty === 7, r.body.data);
  r = await call('post', `/api/stock-takes/${takeId}/complete`, { user: ownerPharm, body: {} });
  check('stock-take completes (200)', r.statusCode === 200, r.statusCode);
  check('batch qty set to the counted qty (7)', query('SELECT quantity FROM batches WHERE id = ?', ['bt-st'])[0].quantity === 7);
  const stMove = query("SELECT * FROM stock_movements WHERE referenceId = ? AND referenceType = 'STOCK_TAKE'", [takeId])[0];
  check('variance movement written (-3)', stMove && stMove.quantity === -3, stMove);
  r = await call('post', `/api/stock-takes/${takeId}/complete`, { user: ownerPharm, body: {} });
  check('double completion refused (409)', r.statusCode === 409, r.statusCode);

  // ── 9. Tax classes: single default + retire guard ─────────────
  console.log('\n[9] tax classes');
  r = await call('post', '/api/tax-classes', { user: ownerPharm, body: { name: 'GST', rate: 18, isDefault: true } });
  check('first tax class created as default (201)', r.statusCode === 201 && r.body.data.isDefault === true, r.body.data);
  const gstId = r.body.data.id;
  r = await call('post', '/api/tax-classes', { user: ownerPharm, body: { name: 'PST', rate: 5, isDefault: true } });
  check('second default created (201)', r.statusCode === 201, r.statusCode);
  const pstId = r.body.data.id;
  check('first default was cleared', query('SELECT isDefault FROM tax_classes WHERE id = ?', [gstId])[0].isDefault === 0);
  r = await call('delete', `/api/tax-classes/${pstId}`, { user: ownerPharm });
  check('retiring the default while another active class exists is refused (400)', r.statusCode === 400, r.statusCode);
  r = await call('delete', `/api/tax-classes/${gstId}`, { user: ownerPharm });
  check('retiring a non-default class works', r.statusCode === 200, r.statusCode);
  r = await call('delete', `/api/tax-classes/${pstId}`, { user: ownerPharm });
  check('retiring the last default works once no other active class exists', r.statusCode === 200, r.statusCode);

  // ── 10. Scheduled shifts: stub-table migration ────────────────
  console.log('\n[10] scheduled shifts');
  r = await call('post', '/api/scheduled-shifts', { user: ownerPharm, body: { name: 'Morning', date: '2026-10-29', startTime: '09:00', endTime: '17:00', branchId: 'br-a', maxUsers: 3 } });
  check('scheduled shift created (201)', r.statusCode === 201, r.statusCode);
  const schedRow = query('SELECT * FROM scheduled_shifts WHERE id = ?', [r.body.data.id])[0];
  check('migration added name/startTime/endTime/status columns', schedRow && schedRow.name === 'Morning' && schedRow.startTime === '09:00' && schedRow.status === 'SCHEDULED', schedRow);
  r = await call('get', '/api/scheduled-shifts', { user: ownerPharm });
  check('list returns the shift', r.statusCode === 200 && JSON.stringify(r.body).includes('Morning'), r.body);
  r = await call('delete', `/api/scheduled-shifts/${schedRow.id}`, { user: ownerPharm });
  check('scheduled shift deletes (200)', r.statusCode === 200, r.statusCode);

  // ── 11. DELETE asymmetry ───────────────────────────────────────
  console.log('\n[11] DELETE asymmetry');
  db.run(`INSERT INTO products (id, name, sku, barcode, additionalBarcodes, branchId, companyId, categoryId, isActive, isService, isControlled, controlledSchedule, quantity, reorderLevel, reorderQuantity, unitsPerPack, unitsPerStrip, costPrice, sellingPrice, unitPrice, taxClassId, minStock, createdAt, updatedAt) VALUES ('p-pu','Purchase Item','PU-1',NULL,NULL,'br-a','biz-pharm',NULL,1,0,0,NULL,10,NULL,NULL,NULL,NULL,50,80,NULL,NULL,0,'${NOW}','${NOW}')`);
  db.run(`INSERT INTO batches (id, batchNo, productId, branchId, companyId, supplierId, supplierName, barcode, quantity, purchasePrice, sellingPrice, stockPurchasePrice, expireDate, productionDate, purchasingMethod, shelfId, shelfName, variantId, isActive, createdBy, createdAt, updatedAt) VALUES ('bt-pu','BPU-1','p-pu','br-a','biz-pharm',NULL,NULL,NULL,20,50,80,50,'2030-01-01',NULL,NULL,NULL,NULL,NULL,1,'u-owner','${NOW}','${NOW}')`);
  db.run(`INSERT INTO purchases VALUES ('pu-1','br-a','biz-pharm',NULL,'COMPLETED',1600,1600,'${NOW}')`);
  db.run(`INSERT INTO purchase_items VALUES ('pi-1','pu-1','p-pu','bt-pu',20,80,1600,'${NOW}')`);
  r = await call('delete', '/api/purchases/pu-1', { user: cashier });
  check('cashier cannot delete a purchase (403)', r.statusCode === 403, r.statusCode);
  r = await call('delete', '/api/purchases/pu-1', { user: ownerPharm });
  check('owner deletes a purchase (200)', r.statusCode === 200, r.statusCode);
  check('purchase row gone', query('SELECT id FROM purchases WHERE id = ?', ['pu-1']).length === 0);
  check('purchase items gone', query('SELECT id FROM purchase_items WHERE purchaseId = ?', ['pu-1']).length === 0);
  check('its batches gone', query('SELECT id FROM batches WHERE id = ?', ['bt-pu']).length === 0);
  // A batch with sale lines blocks the delete (409).
  db.run(`INSERT INTO batches (id, batchNo, productId, branchId, companyId, supplierId, supplierName, barcode, quantity, purchasePrice, sellingPrice, stockPurchasePrice, expireDate, productionDate, purchasingMethod, shelfId, shelfName, variantId, isActive, createdBy, createdAt, updatedAt) VALUES ('bt-pu2','BPU-2','p-pu','br-a','biz-pharm',NULL,NULL,NULL,5,50,80,50,'2030-01-01',NULL,NULL,NULL,NULL,NULL,1,'u-owner','${NOW}','${NOW}')`);
  db.run(`INSERT INTO purchases VALUES ('pu-2','br-a','biz-pharm',NULL,'COMPLETED',400,400,'${NOW}')`);
  db.run(`INSERT INTO purchase_items VALUES ('pi-2','pu-2','p-pu','bt-pu2',5,80,400,'${NOW}')`);
  db.run(`INSERT INTO sales (id, invoiceNumber, receiptNumber, customerId, branchId, companyId, totalAmount, discount, tax, grandTotal, paidAmount, returnedAmount, paymentMethod, paymentStatus, status, notes, prescriptionId, folioId, salespersonId, shiftId, employeeId, createdBy, createdAt, updatedAt) VALUES ('s-pu','INV-90001','RCN-90001',NULL,'br-a','biz-pharm',400,0,0,400,400,0,'CASH','COMPLETED','COMPLETED',NULL,NULL,NULL,NULL,NULL,NULL,'u-owner','2026-10-28T09:00:00.000Z','2026-10-28T09:00:00.000Z')`);
  db.run(`INSERT INTO sale_items VALUES ('si-pu','s-pu','p-pu','bt-pu2',5,80,0,400,'2026-10-28T09:00:00.000Z')`);
  r = await call('delete', '/api/purchases/pu-2', { user: ownerPharm });
  check('purchase with sold batches refused (409)', r.statusCode === 409 && r.body.code === 'PURCHASE_BATCH_IN_USE', r.body);
  check('blocked purchase still exists', query('SELECT id FROM purchases WHERE id = ?', ['pu-2']).length === 1);
  r = await call('delete', '/api/purchases/nope', { user: ownerPharm });
  check('unknown purchase 404s', r.statusCode === 404, r.statusCode);

  r = await call('delete', '/api/staff/sp-staff', { user: ownerPharm });
  check('staff soft-deleted (200)', r.statusCode === 200, r.statusCode);
  check('staff profile deactivated, not hard-deleted', query('SELECT isActive FROM staff_profiles WHERE id = ?', ['sp-staff'])[0].isActive === 0);
  r = await call('delete', '/api/staff/nope', { user: ownerPharm });
  check('unknown staff 404s', r.statusCode === 404, r.statusCode);

  r = await call('delete', '/api/users/u-staff', { user: ownerPharm });
  check('platform account delete is hard-blocked (403)', r.statusCode === 403 && r.body.message.includes('Remove from business'), r.body);
  check('user row survives the blocked delete', query('SELECT id FROM users WHERE id = ?', ['u-staff']).length === 1);

  r = await call('delete', '/api/companies/biz-pharm/members/u-cashier', { user: ownerPharm });
  check('member removed from the business (200)', r.statusCode === 200, r.statusCode);
  check('membership row gone', query('SELECT id FROM memberships WHERE id = ?', ['m-cashier']).length === 0);
  r = await call('delete', '/api/companies/biz-pharm/members/u-owner', { user: ownerPharm });
  check('business creator cannot be removed (400)', r.statusCode === 400, r.statusCode);

  // ── 12. Reorder-suggestions role gate ──────────────────────────
  console.log('\n[12] reorder-suggestions gate');
  db.run(`INSERT INTO products (id, name, sku, barcode, additionalBarcodes, branchId, companyId, categoryId, isActive, isService, isControlled, controlledSchedule, quantity, reorderLevel, reorderQuantity, unitsPerPack, unitsPerStrip, costPrice, sellingPrice, unitPrice, taxClassId, minStock, createdAt, updatedAt) VALUES ('p-ro','ReorderMe','RO-1',NULL,NULL,'br-a','biz-pharm',NULL,1,0,0,NULL,2,5,10,1,1,50,80,NULL,NULL,0,'${NOW}','${NOW}')`);
  db.run(`INSERT INTO batches (id, batchNo, productId, branchId, companyId, supplierId, supplierName, barcode, quantity, purchasePrice, sellingPrice, stockPurchasePrice, expireDate, productionDate, purchasingMethod, shelfId, shelfName, variantId, isActive, createdBy, createdAt, updatedAt) VALUES ('bro-1','BRO-1','p-ro','br-a','biz-pharm',NULL,NULL,NULL,2,50,80,50,'2030-01-01',NULL,NULL,NULL,NULL,NULL,1,'u-owner','${NOW}','${NOW}')`);
  r = await call('get', '/api/purchases/reorder-suggestions', { user: cashier });
  check('cashier cannot read reorder suggestions (403)', r.statusCode === 403, r.statusCode);
  r = await call('get', '/api/purchases/reorder-suggestions', { user: ownerPharm });
  check('owner reads reorder suggestions (200)', r.statusCode === 200, r.statusCode);
  check('low-stock product is suggested', JSON.stringify(r.body).includes('ReorderMe'), r.body);

  // ── 13. M1: cost-based profit (must run BEFORE the M3 sale) ────
  console.log('\n[13] M1 cost-based profit');
  db.run(`INSERT INTO products (id, name, sku, barcode, additionalBarcodes, branchId, companyId, categoryId, isActive, isService, isControlled, controlledSchedule, quantity, reorderLevel, reorderQuantity, unitsPerPack, unitsPerStrip, costPrice, sellingPrice, unitPrice, taxClassId, minStock, createdAt, updatedAt) VALUES ('p-cost','Costed Item','COST-1',NULL,NULL,'br-a','biz-pharm',NULL,1,0,0,NULL,100,NULL,NULL,NULL,NULL,60,100,NULL,NULL,0,'${NOW}','${NOW}')`);
  db.run(`INSERT INTO batches (id, batchNo, productId, branchId, companyId, supplierId, supplierName, barcode, quantity, purchasePrice, sellingPrice, stockPurchasePrice, expireDate, productionDate, purchasingMethod, shelfId, shelfName, variantId, isActive, createdBy, createdAt, updatedAt) VALUES ('b-cost','BCOST-1','p-cost','br-a','biz-pharm',NULL,NULL,NULL,100,60,100,60,'2030-01-01',NULL,NULL,NULL,NULL,NULL,1,'u-owner','${NOW}','${NOW}')`);
  db.run(`INSERT INTO sales (id, invoiceNumber, receiptNumber, customerId, branchId, companyId, totalAmount, discount, tax, grandTotal, paidAmount, returnedAmount, paymentMethod, paymentStatus, status, notes, prescriptionId, folioId, salespersonId, shiftId, employeeId, createdBy, createdAt, updatedAt) VALUES
    ('s-1','INV-10001','RCN-10001',NULL,'br-a','biz-pharm',1000,0,0,1000,1000,0,'CASH','COMPLETED','COMPLETED',NULL,NULL,NULL,NULL,NULL,NULL,'u-owner','2026-10-28T10:00:00.000Z','2026-10-28T10:00:00.000Z'),
    ('s-2','INV-10002','RCN-10002',NULL,'br-a','biz-pharm',500,0,0,500,500,0,'CASH','COMPLETED','REFUNDED',NULL,NULL,NULL,NULL,NULL,NULL,'u-owner','2026-10-28T12:00:00.000Z','2026-10-28T12:00:00.000Z')`);
  db.run(`INSERT INTO sale_items VALUES
    ('si-1','s-1','p-cost','b-cost',10,100,0,1000,'2026-10-28T10:00:00.000Z'),
    ('si-2','s-2','p-cost','b-cost',5,100,0,500,'2026-10-28T12:00:00.000Z')`);
  db.run(`INSERT INTO refunds VALUES
    ('r-1','s-1',100,'partial','br-a','biz-pharm','COMPLETED','u-owner','2026-10-28T11:00:00.000Z','2026-10-28T11:00:00.000Z'),
    ('r-2','s-2',500,'full','br-a','biz-pharm','COMPLETED','u-owner','2026-10-28T13:00:00.000Z','2026-10-28T13:00:00.000Z')`);
  db.run(`INSERT INTO refund_items VALUES
    ('ri-1','r-1','si-1','p-cost',1,100,'partial','2026-10-28T11:00:00.000Z','2026-10-28T11:00:00.000Z'),
    ('ri-2','r-2','si-2','p-cost',5,500,'full','2026-10-28T13:00:00.000Z','2026-10-28T13:00:00.000Z')`);
  r = await call('get', '/api/reports/dashboard', { user: ownerPharm });
  check('dashboard answers (200)', r.statusCode === 200, r.statusCode);
  // gross: s-1 (1000 - 60x10 = 400) + the §11 sale s-pu (400 - 50x5
  // = 150) = 550; s-2 is REFUNDED so its 200 gross is excluded.
  // Partial-refund margin: ri-1 (100 - 60x1 = 40); ri-2 belongs to
  // the fully-refunded s-2 and is excluded (H1 correction).
  check('today profit is cost-based (550 - 40 = 510), not flat 30%', r.body.data.today.profit === 510, r.body.data.today);
  check('month profit matches', r.body.data.month.profit === 510, r.body.data.month);
  check('today revenue is the non-refunded total (1000 + 400)', r.body.data.today.revenue === 1400, r.body.data.today);

  // ── 14. M3: grand total stored + controlled-dispense hook ──────
  console.log('\n[14] M3 grand total + controlled hook');
  db.run(`INSERT INTO products (id, name, sku, barcode, additionalBarcodes, branchId, companyId, categoryId, isActive, isService, isControlled, controlledSchedule, quantity, reorderLevel, reorderQuantity, unitsPerPack, unitsPerStrip, costPrice, sellingPrice, unitPrice, taxClassId, minStock, createdAt, updatedAt) VALUES ('p-sale','ControlledMed','CS-1',NULL,NULL,'br-a','biz-pharm',NULL,1,0,1,NULL,10,NULL,NULL,NULL,NULL,50,100,NULL,NULL,0,'${NOW}','${NOW}')`);
  db.run(`INSERT INTO batches (id, batchNo, productId, branchId, companyId, supplierId, supplierName, barcode, quantity, purchasePrice, sellingPrice, stockPurchasePrice, expireDate, productionDate, purchasingMethod, shelfId, shelfName, variantId, isActive, createdBy, createdAt, updatedAt) VALUES ('b-sale','BSALE-1','p-sale','br-a','biz-pharm',NULL,NULL,NULL,10,50,100,50,'2030-01-01',NULL,NULL,NULL,NULL,NULL,1,'u-owner','${NOW}','${NOW}')`);
  r = await call('post', '/api/sales', { user: ownerPharm, body: { branchId: 'br-a', companyId: 'biz-pharm', items: [{ productId: 'p-sale', quantity: 2 }], discountAmount: 20, paymentMethod: 'CASH' } });
  check('sale created (201)', r.statusCode === 201, r.statusCode);
  const m3Sale = query('SELECT * FROM sales WHERE id = ?', [r.body.data.id])[0];
  check('totalAmount is the grand total (200 - 20 = 180)', m3Sale && m3Sale.totalAmount === 180, m3Sale);
  check('grandTotal agrees (180)', m3Sale && m3Sale.grandTotal === 180, m3Sale);
  check('batch decremented (10 -> 8)', query('SELECT quantity FROM batches WHERE id = ?', ['b-sale'])[0].quantity === 8);
  const dispense = query("SELECT * FROM controlled_dispense_logs WHERE saleId = ? AND entryType = 'DISPENSE'", [m3Sale.id])[0];
  check('controlled DISPENSE row written', !!dispense, dispense);
  check('dispense balanceAfter is the post-decrement qty (8)', dispense && dispense.balanceAfter === 8 && dispense.quantity === 2, dispense);

  // ── 15. L2: Asia/Karachi stale-day rule ────────────────────────
  console.log('\n[15] L2 Karachi stale day');
  const karachiDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
  const kToday = karachiDay(new Date());
  const kTodayStart = new Date(kToday + 'T00:00:00+05:00');
  const kYesterday = karachiDay(new Date(kTodayStart.getTime() - 24 * 60 * 60 * 1000));
  const oneHourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const staffUser = { id: 'u-staff', name: 'Staff One', role: 'CASHIER', companyId: 'biz-pharm', selectedCompanyId: 'biz-pharm', branchId: 'br-a', selectedBranchId: 'br-a' };
  // A shift opened 00:30 Karachi today is "yesterday" in UTC — the old
  // server-local rule flagged it stale at 00:00 UTC; the Karachi rule
  // must not.
  db.run(`INSERT INTO shifts VALUES ('sh-a','sp-staff','m-staff','br-a','ACTIVE','${oneHourAgo}','${kToday}T00:30:00+05:00',5000,NULL,NULL,NULL,NULL,NULL,NULL,NULL,'${NOW}','${NOW}')`);
  r = await call('get', '/api/shifts/active/sp-staff', { user: staffUser });
  check('shift opened 00:30 Karachi today is NOT stale', r.body.data && r.body.data.isStale === false, r.body.data);
  db.run(`UPDATE shifts SET shiftDate = '${kYesterday}T23:30:00+05:00' WHERE id = 'sh-a'`);
  r = await call('get', '/api/shifts/active/sp-staff', { user: staffUser });
  check('shift opened 23:30 Karachi yesterday IS stale', r.body.data && r.body.data.isStale === true, r.body.data);
  db.run(`UPDATE shifts SET shiftDate = '${kToday}T00:30:00+05:00', startTime = '${new Date(Date.now() - 25 * 3600 * 1000).toISOString()}' WHERE id = 'sh-a'`);
  r = await call('get', '/api/shifts/active/sp-staff', { user: staffUser });
  check('shift open >24h is stale regardless of day', r.body.data && r.body.data.isStale === true, r.body.data);

  // ── 16. Subscription billing proxy ─────────────────────────────
  console.log('\n[16] subscription proxy');
  r = await call('get', '/api/subscription/billing-history', { user: ownerPharm });
  check('offline billing-history fails honestly (503 CLOUD_UNAVAILABLE)', r.statusCode === 503 && r.body.code === 'CLOUD_UNAVAILABLE', r.body);
  cloudStub.token = 'tok-test';
  cloudStub.stubResponse = { success: true, data: [{ id: 'pm-1', type: 'card', last4: '4242' }] };
  r = await call('get', '/api/subscription/payment-methods', { user: ownerPharm });
  check('online payment-methods pass through', r.statusCode === 200 && r.body.data[0].id === 'pm-1', r.body);
  check('proxy forwards the exact cloud path', cloudStub.lastCall && cloudStub.lastCall.path === '/api/subscription/payment-methods', cloudStub.lastCall);
  r = await call('put', '/api/subscription/payment-methods/pm-9/default', { user: ownerPharm, body: {} });
  check('proxy substitutes :param segments in the cloud path', cloudStub.lastCall && cloudStub.lastCall.path === '/api/subscription/payment-methods/pm-9/default', cloudStub.lastCall);
  cloudStub.token = null;
  cloudStub.stubResponse = null;
  r = await call('get', '/api/subscription/invoices/inv-1/download', { user: ownerPharm });
  check('invoice download is an honest 501 (JSON-only proxy)', r.statusCode === 501 && r.body.code === 'DOWNLOAD_NOT_SUPPORTED_ON_DESKTOP', r.body);

  console.log(`\nembedded-ports.test.js: ALL ${passed} CHECKS PASSED`);
}

main().catch((e) => { console.error(e); process.exit(1); });
