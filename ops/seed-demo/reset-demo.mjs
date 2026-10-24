/**
 * Zapeera public live-demo: golden-state seed + nightly reset.
 *
 * Runs INSIDE the backend container (docker exec) so it uses the live
 * DATABASE_URL and the app's own generated Prisma client. Everything the
 * demo business contains is created through the REAL HTTP API (register /
 * login / companies / products / batches / sales / backoffice plan
 * assign), so the demo data is indistinguishable from organic data and
 * every number the UI shows is computed by the real app. The wipe phase
 * is the only direct-DB part: it deletes every row owned by the demo
 * user's businesses (children first), then the seed phase rebuilds the
 * golden dataset from scratch. Idempotent: safe to run any time.
 *
 * Required env (backend container env / VM .env — never commit values):
 *   DEMO_USER_EMAIL            the demo account's email
 *   DEMO_USER_PASSWORD         the demo account's password
 *   DEMO_SEED_ADMIN_EMAIL      backoffice admin email (plan assignment)
 *   DEMO_SEED_ADMIN_PASSWORD   backoffice admin password
 * Optional:
 *   DEMO_API_BASE              default http://127.0.0.1:4200/api
 */

const API = process.env.DEMO_API_BASE || 'http://127.0.0.1:4200/api';
const DEMO_EMAIL = String(process.env.DEMO_USER_EMAIL || '').trim().toLowerCase();
const DEMO_PASSWORD = process.env.DEMO_USER_PASSWORD || '';
const BO_EMAIL = process.env.DEMO_SEED_ADMIN_EMAIL || '';
const BO_PASSWORD = process.env.DEMO_SEED_ADMIN_PASSWORD || '';

function fail(msg) {
  console.error(`[seed-demo] FATAL: ${msg}`);
  process.exit(1);
}

if (!DEMO_EMAIL || !DEMO_PASSWORD) fail('DEMO_USER_EMAIL / DEMO_USER_PASSWORD are not set');
if (!BO_EMAIL || !BO_PASSWORD) fail('DEMO_SEED_ADMIN_EMAIL / DEMO_SEED_ADMIN_PASSWORD are not set');

/* ------------------------------------------------------------------ */
/* Golden dataset                                                      */
/* ------------------------------------------------------------------ */

const CATEGORIES = ['Pain Relief', 'Antibiotics', 'Vitamins & Supplements', 'First Aid', 'Personal Care'];

const SUPPLIER = {
  name: 'MediSupply Pakistan',
  contactPerson: 'Ahmed Raza',
  phone: '+92 321 5551234',
  email: 'orders@medisupply.pk',
  address: '14-B Industrial Estate, Lahore',
};

const SHELF = { name: 'Shelf A1', description: 'Main dispensing shelf', location: 'Counter 1' };

// name, category, sellingPrice, costPrice, quantity, minStock, requiresPrescription, expiryMonthsFromNow
const PRODUCTS = [
  ['Paracetamol 500mg', 'Pain Relief', 60, 45, 140, 20, false, 18],
  ['Panadol Extra 500mg', 'Pain Relief', 95, 72, 85, 20, false, 16],
  ['Ibuprofen 400mg', 'Pain Relief', 120, 92, 64, 15, false, 14],
  ['Diclofenac 50mg', 'Pain Relief', 140, 108, 52, 15, false, 12],
  ['Aspirin 300mg', 'Pain Relief', 45, 34, 90, 20, false, 20],
  ['Amoxicillin 250mg', 'Antibiotics', 180, 140, 48, 12, true, 11],
  ['Amoxicillin 500mg', 'Antibiotics', 260, 205, 36, 12, true, 10],
  ['Azithromycin 500mg', 'Antibiotics', 420, 330, 24, 8, true, 13],
  ['Cefixime 400mg', 'Antibiotics', 550, 435, 18, 8, true, 9],
  ['Ciprofloxacin 500mg', 'Antibiotics', 380, 298, 22, 8, true, 12],
  ['Metronidazole 400mg', 'Antibiotics', 150, 116, 30, 10, true, 15],
  ['Vitamin C 1000mg', 'Vitamins & Supplements', 450, 340, 40, 10, false, 17],
  ['Vitamin D3 5000 IU', 'Vitamins & Supplements', 850, 655, 28, 8, false, 19],
  ['Multivitamin Daily', 'Vitamins & Supplements', 1250, 960, 20, 6, false, 15],
  ['Calcium + D3 Tablets', 'Vitamins & Supplements', 680, 520, 33, 10, false, 16],
  ['Iron + Folic Acid', 'Vitamins & Supplements', 320, 245, 44, 12, false, 14],
  ['ORS Electrolyte Sachets', 'First Aid', 25, 18, 200, 40, false, 22],
  ['Antiseptic Liquid 250ml', 'First Aid', 340, 262, 26, 8, false, 21],
  ['Bandage Roll 3in', 'First Aid', 60, 44, 75, 20, false, 24],
  ['Cotton Wool 100g', 'First Aid', 110, 82, 58, 15, false, 24],
  ['Surgical Gloves (Box)', 'First Aid', 950, 730, 12, 15, false, 1], // near expiry + low stock: real alerts
  ['Digital Thermometer', 'First Aid', 550, 415, 15, 5, false, 30],
  ['Cetirizine 10mg', 'Pain Relief', 80, 60, 96, 20, false, 15],
  ['Loratadine 10mg', 'Pain Relief', 110, 84, 48, 15, false, 13],
  ['Omeprazole 20mg', 'Pain Relief', 210, 162, 54, 12, false, 12],
  ['Esomeprazole 40mg', 'Pain Relief', 390, 302, 26, 10, false, 11],
  ['Antacid Suspension 200ml', 'Pain Relief', 260, 198, 31, 10, false, 10],
  ['Cough Syrup 120ml', 'Pain Relief', 240, 184, 29, 10, false, 9],
  ['Honey Lemon Lozenges', 'Pain Relief', 150, 112, 67, 15, false, 18],
  ['Salbutamol Inhaler', 'Pain Relief', 680, 528, 14, 6, true, 8],
  ['Metformin 500mg', 'Antibiotics', 130, 100, 88, 20, true, 16],
  ['Glimepiride 2mg', 'Antibiotics', 240, 186, 41, 12, true, 13],
  ['Amlodipine 5mg', 'Antibiotics', 160, 122, 63, 15, true, 17],
  ['Losartan 50mg', 'Antibiotics', 290, 224, 37, 12, true, 14],
  ['Atorvastatin 20mg', 'Antibiotics', 340, 264, 29, 10, true, 12],
  ['Insulin Glargine 100 IU/ml', 'Antibiotics', 2450, 1960, 8, 10, true, 2], // near expiry + low stock
  ['Blood Glucose Test Strips', 'First Aid', 1450, 1130, 16, 6, false, 7],
  ['BP Monitor (Digital)', 'First Aid', 3850, 2980, 6, 8, false, 36],
  ['Baby Diapers (Pack)', 'Personal Care', 1150, 885, 21, 8, false, 20],
  ['Sunscreen SPF 50', 'Personal Care', 890, 685, 19, 8, false, 15],
];

const CUSTOMERS = [
  ['Muhammad Imran', '+92 300 1112233', 'imran.demo@example.com', 'House 12, Block C, Model Town, Lahore'],
  ['Fatima Noor', '+92 321 4445566', 'fatima.demo@example.com', 'Flat 4-B, Askari 11, Lahore'],
  ['Ali Hassan', '+92 333 7778899', 'ali.demo@example.com', 'Street 8, DHA Phase 5, Lahore'],
  ['Ayesha Khan', '+92 301 2223344', 'ayesha.demo@example.com', 'House 45, Johar Town, Lahore'],
  ['Usman Tariq', '+92 322 9990011', 'usman.demo@example.com', 'Main Bazaar Road, Gulberg, Lahore'],
  ['Hira Shahid', '+92 345 6667788', 'hira.demo@example.com', 'House 3, Valencia Town, Lahore'],
];

// [productIndex, qty] lines per sale; filled programmatically below.
const SALE_RECIPES = [
  { items: [[0, 2], [22, 1]], customer: 0 },
  { items: [[1, 1], [16, 4]], customer: null },
  { items: [[11, 1], [28, 2]], customer: 1 },
  // NOTE: prescription-only products (requiresPrescription) are NOT sold
  // here — the sale endpoint rightly demands a prescription for them, and
  // the demo seed does not fabricate prescriptions.
  { items: [[22, 1]], customer: 2, discount: 0 },
  { items: [[24, 2], [26, 1]], customer: null },
  { items: [[23, 2], [2, 1]], customer: 3 },
  { items: [[36, 1], [17, 2]], customer: null, paymentMethod: 'CARD' },
  { items: [[18, 3], [19, 2], [16, 2]], customer: 4 },
  { items: [[12, 1]], customer: null, discount: 5 },
  { items: [[15, 1], [13, 1]], customer: 5 },
  { items: [[0, 3], [27, 1]], customer: null },
  { items: [[38, 1], [27, 1]], customer: 1, discount: 10 },
  { items: [[25, 1]], customer: null },
  { items: [[21, 1], [18, 1]], customer: 2 },
];

const EXPENSES = [
  ['Electricity bill — Main Branch', 8450],
  ['Packing material & bags', 2300],
];

/* ------------------------------------------------------------------ */
/* HTTP helpers (battery-proven shapes: Bearer + business headers)     */
/* ------------------------------------------------------------------ */

async function api(method, path, { token, businessId, branchId, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (businessId) {
    headers['x-business-id'] = businessId;
    headers['x-company-id'] = businessId;
  }
  if (branchId) headers['x-branch-id'] = branchId;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try { json = text ? JSON.parse(text) : {}; } catch { /* keep status only */ }
  return { status: res.status, json };
}

function expect(cond, what, detail) {
  if (!cond) fail(`${what} — ${detail}`);
  console.log(`[seed-demo] ok: ${what}`);
}

/* ------------------------------------------------------------------ */
/* Phase 1: ensure the demo user exists, verified, and can log in      */
/* ------------------------------------------------------------------ */

async function ensureDemoUser(prisma) {
  let login = await api('POST', '/auth/login', {
    body: { usernameOrEmail: DEMO_EMAIL, password: DEMO_PASSWORD },
  });

  if (login.status === 403 && login.json?.emailNotVerified) {
    const user = await prisma.zapeeraUser.findUnique({ where: { email: DEMO_EMAIL } });
    if (user?.emailVerificationToken) {
      const v = await api('GET', `/auth/verify-email?token=${encodeURIComponent(user.emailVerificationToken)}`);
      console.log(`[seed-demo] email verify via real flow: http=${v.status}`);
    }
    login = await api('POST', '/auth/login', {
      body: { usernameOrEmail: DEMO_EMAIL, password: DEMO_PASSWORD },
    });
  }

  if (login.status === 401) {
    // Not registered yet — register through the real flow, then verify.
    const reg = await api('POST', '/auth/register', {
      body: {
        username: 'zapeera-demo',
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
        name: 'Zapeera Demo',
      },
    });
    expect(reg.status === 201 || reg.status === 200, 'demo user register', `http=${reg.status} ${JSON.stringify(reg.json).slice(0, 200)}`);
    const user = await prisma.zapeeraUser.findUnique({ where: { email: DEMO_EMAIL } });
    if (user?.emailVerificationToken) {
      const v = await api('GET', `/auth/verify-email?token=${encodeURIComponent(user.emailVerificationToken)}`);
      console.log(`[seed-demo] email verify via real flow: http=${v.status}`);
    }
    login = await api('POST', '/auth/login', {
      body: { usernameOrEmail: DEMO_EMAIL, password: DEMO_PASSWORD },
    });
  }

  expect(login.status === 200 && login.json?.data?.accessToken, 'demo user login', `http=${login.status}`);
  return { token: login.json.data.accessToken, userId: login.json.data.user.id };
}

/* ------------------------------------------------------------------ */
/* Phase 2: wipe every row owned by the demo user's businesses         */
/* ------------------------------------------------------------------ */

async function wipeDemoBusinesses(prisma, userId) {
  const memberships = await prisma.membership.findMany({
    where: { userId },
    include: { business: { select: { id: true, createdBy: true } }, role: { select: { name: true } } },
  });
  const businessIds = [
    ...new Set(
      memberships
        .filter((m) => m.role?.name === 'OWNER' || m.business?.createdBy === userId)
        .map((m) => m.businessId)
    ),
  ];
  if (!businessIds.length) {
    console.log('[seed-demo] wipe: no demo businesses yet — nothing to do');
    return;
  }

  const safe = async (label, fn) => {
    try { await fn(); } catch (e) { console.warn(`[seed-demo] wipe step ${label} skipped: ${e.message}`); }
  };

  for (const bid of businessIds) {
    const sales = await prisma.sale.findMany({ where: { companyId: bid }, select: { id: true } });
    const saleIds = sales.map((s) => s.id);
    const purchases = await prisma.purchase.findMany({ where: { companyId: bid }, select: { id: true } });
    const purchaseIds = purchases.map((p) => p.id);
    const prescriptions = await prisma.prescription.findMany({ where: { companyId: bid }, select: { id: true } });
    const prescriptionIds = prescriptions.map((p) => p.id);
    const products = await prisma.product.findMany({ where: { companyId: bid }, select: { id: true } });
    const productIds = products.map((p) => p.id);
    const stockTakes = await prisma.stockTake.findMany({ where: { companyId: bid }, select: { id: true } });
    const stockTakeIds = stockTakes.map((s) => s.id);
    const tickets = await prisma.supportTicket.findMany({ where: { businessId: bid }, select: { id: true } });
    const ticketIds = tickets.map((t) => t.id);
    const refunds = saleIds.length ? await prisma.refund.findMany({ where: { originalSaleId: { in: saleIds } }, select: { id: true } }) : [];
    const refundIds = refunds.map((r) => r.id);
    const folios = await prisma.folio.findMany({ where: { companyId: bid }, select: { id: true } });
    const folioIds = folios.map((f) => f.id);
    const mems = await prisma.membership.findMany({ where: { businessId: bid }, select: { id: true } });
    const membershipIds = mems.map((m) => m.id);

    // Grandchildren / line items first.
    await safe('saleItem', () => prisma.saleItem.deleteMany({ where: { saleId: { in: saleIds } } }));
    await safe('salePayment', () => prisma.salePayment.deleteMany({ where: { saleId: { in: saleIds } } }));
    await safe('salePromotion', () => prisma.salePromotion.deleteMany({ where: { saleId: { in: saleIds } } }));
    await safe('saleTaxLine', () => prisma.saleTaxLine.deleteMany({ where: { saleId: { in: saleIds } } }));
    await safe('fbrInvoiceQueue', () => prisma.fbrInvoiceQueue.deleteMany({ where: { companyId: bid } }));
    await safe('receipt', () => prisma.receipt.deleteMany({ where: { companyId: bid } }));
    await safe('refundItem', () => prisma.refundItem.deleteMany({ where: { refundId: { in: refundIds } } }));
    await safe('refund', () => prisma.refund.deleteMany({ where: { id: { in: refundIds } } }));
    await safe('prescriptionItem', () => prisma.prescriptionItem.deleteMany({ where: { prescriptionId: { in: prescriptionIds } } }));
    await safe('purchaseItem', () => prisma.purchaseItem.deleteMany({ where: { purchaseId: { in: purchaseIds } } }));
    await safe('stockTakeLine', () => prisma.stockTakeLine.deleteMany({ where: { stockTakeId: { in: stockTakeIds } } }));
    await safe('stockTransferItem', () => prisma.stockTransferItem.deleteMany({ where: { productId: { in: productIds } } }));
    await safe('stockMovement', () => prisma.stockMovement.deleteMany({ where: { productId: { in: productIds } } }));
    await safe('folioCharge', () => prisma.folioCharge.deleteMany({ where: { folioId: { in: folioIds } } }));
    await safe('folioPayment', () => prisma.folioPayment.deleteMany({ where: { folioId: { in: folioIds } } }));
    await safe('supportTicketMessage', () => prisma.supportTicketMessage.deleteMany({ where: { ticketId: { in: ticketIds } } }));
    await safe('membershipBranch', () => prisma.membershipBranch.deleteMany({ where: { membershipId: { in: membershipIds } } }));
    await safe('staffProfile', () => prisma.staffProfile.deleteMany({ where: { membershipId: { in: membershipIds } } }));
    await safe('attendance', () => prisma.attendance.deleteMany({ where: { membershipId: { in: membershipIds } } }));
    await safe('shift', () => prisma.shift.deleteMany({ where: { membershipId: { in: membershipIds } } }));
    await safe('commission', () => prisma.commission.deleteMany({ where: { membershipId: { in: membershipIds } } }));

    // Business-scoped parents (companyId === business id in this codebase).
    const byCompany = [
      'sale', 'prescription', 'purchase', 'stockTake', 'stockTransfer', 'customerLedgerEntry',
      'loyaltyTransaction', 'batch', 'productVariant', 'customer', 'appointment', 'folio',
      'reservation', 'room', 'roomType', 'doctorSettlement', 'doctor', 'patient',
      'prescription', 'promotion', 'taxClass', 'fbrConfig', 'deviceActivation',
      'syncProcessedOperation', 'expense', 'product', 'category', 'expenseCategory',
      'manufacturer', 'supplier', 'shelf',
    ];
    // productVariant hangs off productId, not companyId — handled explicitly.
    for (const model of byCompany) {
      if (model === 'productVariant') continue;
      await safe(model, () => prisma[model].deleteMany({ where: { companyId: bid } }));
    }
    await safe('productVariant', () => prisma.productVariant.deleteMany({ where: { productId: { in: productIds } } }));
    await safe('product-retry', () => prisma.product.deleteMany({ where: { companyId: bid } }));

    // Platform tables keyed by businessId.
    const byBusiness = [
      'parkedSale', 'backupSafetySnapshot', 'businessAiUsage', 'businessAiDailyUsage',
      'subscriptionAddon', 'businessSubscription', 'billingProfile', 'paymentProof',
      'affiliateReferral', 'affiliateCommission', 'emailNotification',
      'businessModuleOverride', 'businessModule', 'businessInvitation', 'supportTicket',
      'notification',
    ];
    for (const model of byBusiness) {
      await safe(model, () => prisma[model].deleteMany({ where: { businessId: bid } }));
    }

    await safe('membership', () => prisma.membership.deleteMany({ where: { businessId: bid } }));
    await safe('role', () => prisma.role.deleteMany({ where: { businessId: bid } }));
    await safe('branch', () => prisma.branch.deleteMany({ where: { companyId: bid } }));
    await prisma.business.delete({ where: { id: bid } });
    console.log(`[seed-demo] wipe: business ${bid} removed`);
  }
}

/* ------------------------------------------------------------------ */
/* Phase 3: seed the golden dataset through the real API               */
/* ------------------------------------------------------------------ */

async function assignGrowthPlan(businessId) {
  // Backoffice session: cookie jar + CSRF cookie → header (proven flow).
  const jar = new Map();
  const capture = (res) => {
    const setCookies = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    for (const c of setCookies) {
      const [pair] = c.split(';');
      const idx = pair.indexOf('=');
      if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  };
  const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

  const loginRes = await fetch(`${API}/backoffice/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: BO_EMAIL, password: BO_PASSWORD }),
  });
  capture(loginRes);
  expect(loginRes.status === 200, 'backoffice login', `http=${loginRes.status}`);
  const csrf = jar.get('csrf-token');
  expect(!!csrf, 'backoffice csrf cookie', 'missing');

  const res = await fetch(`${API}/backoffice/subscriptions/assign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: cookieHeader(),
      'X-CSRF-Token': csrf,
    },
    body: JSON.stringify({ businessId, planId: 'single-growth' }),
  });
  const json = await res.json().catch(() => ({}));
  expect(res.status === 200, 'assign Growth plan', `http=${res.status} ${JSON.stringify(json).slice(0, 160)}`);
}

function monthsFromNow(months, dayOffset = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  d.setDate(d.getDate() + dayOffset);
  return d.toISOString().slice(0, 10);
}

/**
 * Bootstrap the demo business row via Prisma — NOT via POST /companies.
 * The demo account is deliberately fenced against business creation
 * (demo-guard.ts), so the seed creates exactly the rows the real
 * create-company flow creates (business + Main Branch + OWNER role +
 * ACTIVE membership, slug 'demo-pharmacy'), then every content row below
 * goes through the real HTTP API as the demo user. Runs on every seed:
 * the wipe phase deletes all demo businesses first.
 */
async function bootstrapDemoBusiness(prisma, userId) {
  const business = await prisma.business.create({
    data: {
      name: 'Demo Pharmacy',
      slug: 'demo-pharmacy',
      businessType: 'PHARMACY',
      address: 'Main Boulevard, Gulberg III, Lahore',
      phone: '+92 300 1234567',
      email: DEMO_EMAIL,
      createdBy: userId,
      isActive: true,
    },
  });
  const branch = await prisma.branch.create({
    data: {
      name: 'Main Branch',
      address: 'Main Boulevard, Gulberg III, Lahore',
      phone: '+92 300 1234567',
      email: DEMO_EMAIL,
      companyId: business.id,
      createdBy: userId,
      isActive: true,
    },
  });
  let role = await prisma.role.findFirst({ where: { businessId: business.id, name: 'OWNER' } });
  if (!role) {
    role = await prisma.role.create({
      data: { businessId: business.id, name: 'OWNER', isSystem: true, isActive: true },
    });
  }
  await prisma.membership.create({
    data: { userId, businessId: business.id, roleId: role.id, status: 'ACTIVE' },
  });
  console.log(`[seed-demo] business bootstrapped: ${business.id} slug=demo-pharmacy branch=${branch.id}`);
  return { businessId: business.id, branchId: branch.id };
}

async function seedDemoBusiness(token, prisma, userId) {
  const { businessId, branchId } = await bootstrapDemoBusiness(prisma, userId);

  await assignGrowthPlan(businessId);

  const H = { token, businessId, branchId };

  // Categories.
  const categoryIds = {};
  for (const name of CATEGORIES) {
    const r = await api('POST', '/categories', { ...H, body: { name } });
    expect(r.status === 201 || r.status === 200, `category ${name}`, `http=${r.status}`);
    categoryIds[name] = r.json?.data?.id || r.json?.data?.category?.id;
  }

  // Supplier + shelf.
  const sup = await api('POST', '/suppliers', { ...H, body: SUPPLIER });
  expect(sup.status === 201 || sup.status === 200, 'supplier', `http=${sup.status} ${JSON.stringify(sup.json).slice(0, 160)}`);
  const supplierId = sup.json?.data?.id || sup.json?.data?.supplier?.id;
  const shelfRes = await api('POST', '/shelves', { ...H, body: { ...SHELF, branchId } });
  expect(shelfRes.status === 201 || shelfRes.status === 200, 'shelf', `http=${shelfRes.status} ${JSON.stringify(shelfRes.json).slice(0, 160)}`);
  const shelfId = shelfRes.json?.data?.id || shelfRes.json?.data?.shelf?.id;

  // Products + batches.
  const seeded = []; // {productId, batchId, price}
  for (let i = 0; i < PRODUCTS.length; i++) {
    const [name, category, price, cost, qty, minStock, rx, expiryMonths] = PRODUCTS[i];
    const sku = `DEMO-${String(i + 1).padStart(3, '0')}`;
    const pr = await api('POST', '/products', {
      ...H,
      body: {
        name,
        categoryId: categoryIds[category],
        branchId,
        sku,
        barcode: `89640010${String(10001 + i)}`,
        minStock,
        requiresPrescription: rx,
      },
    });
    expect(pr.status === 201 || pr.status === 200, `product ${name}`, `http=${pr.status} ${JSON.stringify(pr.json).slice(0, 160)}`);
    const productId = pr.json?.data?.id || pr.json?.data?.product?.id;
    expect(!!productId, `product id ${name}`, '');

    const batch = await api('POST', '/batches', {
      ...H,
      body: {
        batchNo: `DP-${2026 + Math.floor(i / 12)}-${String(101 + i)}`,
        productId,
        supplierId,
        supplierName: SUPPLIER.name,
        expireDate: monthsFromNow(expiryMonths),
        productionDate: monthsFromNow(-6),
        shelfId,
        shelfName: SHELF.name,
        purchasePrice: cost,
        sellingPrice: price,
        quantity: qty,
        totalBoxes: Math.max(1, Math.round(qty / 12)),
        unitsPerBox: 12,
      },
    });
    expect(batch.status === 201 || batch.status === 200, `batch ${name}`, `http=${batch.status} ${JSON.stringify(batch.json).slice(0, 200)}`);
    const batchId = batch.json?.data?.id || batch.json?.data?.batch?.id;
    seeded.push({ productId, batchId, price, name });
  }

  // Customers.
  const customerIds = [];
  for (const [name, phone, email, address] of CUSTOMERS) {
    const r = await api('POST', '/customers', { ...H, body: { name, phone, email, address, branchId } });
    expect(r.status === 201 || r.status === 200, `customer ${name}`, `http=${r.status}`);
    customerIds.push(r.json?.data?.id || r.json?.data?.customer?.id);
  }

  // Sales (all land "today" — the API stamps createdAt; that is the
  // truthful option and keeps the dashboard's Today panel real).
  let saleCount = 0;
  for (const recipe of SALE_RECIPES) {
    const items = recipe.items.map(([idx, qty]) => ({
      productId: seeded[idx].productId,
      batchId: seeded[idx].batchId,
      quantity: qty,
      unitPrice: seeded[idx].price,
    }));
    const subtotal = items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
    const discount = recipe.discount || 0;
    const total = Math.round(subtotal * (1 - discount / 100));
    const body = {
      branchId,
      items,
      paidAmount: total,
      paymentMethod: recipe.paymentMethod || 'CASH',
      paymentStatus: 'COMPLETED',
    };
    if (discount) body.discountPercentage = discount;
    if (recipe.customer !== null && recipe.customer !== undefined) {
      body.customerId = customerIds[recipe.customer];
    }
    const r = await api('POST', '/sales', { ...H, body });
    expect(r.status === 201 || r.status === 200, `sale #${saleCount + 1}`, `http=${r.status} ${JSON.stringify(r.json).slice(0, 200)}`);
    saleCount++;
  }

  // A couple of expenses so reports/expenses are not empty.
  const today = new Date().toISOString().slice(0, 10);
  for (const [title, amount] of EXPENSES) {
    const r = await api('POST', '/expenses', {
      ...H,
      body: { title, amount, branchId, expenseDate: today, paymentMethod: 'CASH' },
    });
    expect(r.status === 201 || r.status === 200, `expense ${title}`, `http=${r.status}`);
  }

  return { businessId, branchId, productCount: seeded.length, saleCount };
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function main() {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    const { token, userId } = await ensureDemoUser(prisma);
    await wipeDemoBusinesses(prisma, userId);
    const result = await seedDemoBusiness(token, prisma, userId);

    // Verify golden state through the API.
    const prods = await api('GET', '/products?limit=100', {
      token,
      businessId: result.businessId,
      branchId: result.branchId,
    });
    const list = prods.json?.data?.products || prods.json?.data || [];
    const count = Array.isArray(list) ? list.length : 0;
    expect(count === PRODUCTS.length, 'golden product count', `got ${count}, want ${PRODUCTS.length}`);
    console.log(
      `[seed-demo] DONE business=${result.businessId} branch=${result.branchId} products=${count} sales=${result.saleCount}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => fail(e?.stack || String(e)));
