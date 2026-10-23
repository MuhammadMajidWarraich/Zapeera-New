/**
 * Backup & Restore Routes (desktop embedded server)
 *
 * The web backend shipped Backup & Restore in the Oct 22–23 program
 * (backend-zapeera-v1-main: routes/backup.routes.ts +
 * services/backup.service.ts + utils/backup.util.ts) but the desktop
 * embedded server never got the module, so Settings → Backup & Restore
 * failed on desktop with "Endpoint not found: GET /api/backup/export".
 *
 * This module mirrors the web implementation faithfully against the
 * local SQLite schema:
 *   GET  /api/backup/export            one owned business (download)
 *   GET  /api/backup/export-account    every owned business (download)
 *   POST /api/backup/restore           create NEW business(es), or
 *        { mode:'update', backup, targets } update existing ones
 *   POST /api/backup/restore-preview   dry-run diff for update mode
 *   GET  /api/backup/safety-backups    snapshots taken before updates
 *   GET  /api/backup/safety-backups/:id/download
 *
 * Same file format (zapeera-backup v1), same semantics:
 *   · OWNER-only.
 *   · Secrets NEVER exported: user rows travel only as member
 *     projections (email/name/role — no password hashes), card_details
 *     is not a covered table, the session/settings secret keys are
 *     excluded, and there is deliberately NO local FBR table (the FBR
 *     token never leaves the server by design), so no FBR secret can
 *     ever be in a desktop backup.
 *   · Restore-as-new starts the business on TRIAL; subscriptions and
 *     payment history are not copied; staff accounts are NOT recreated
 *     (members whose email matches a local account are re-linked,
 *     everyone else is reported in skippedStaff).
 *   · Update mode never deletes; a safety backup of the target is
 *     stored on disk + indexed in backup_safety_snapshots BEFORE any
 *     write.
 *
 * Deliberate simplifications vs the web service (documented, not
 * silent): cross-business update mode inserts backup rows under fresh
 * ids for ALL tables (the web additionally natural-key-merges
 * branches/roles/tax classes/promotions/rooms); the local settings
 * table is global-per-install (key UNIQUE), so settings import keeps
 * the web's "never overwrite an existing key" rule install-wide.
 */

const fs = require('fs');
const path = require('path');

const BACKUP_FORMAT = 'zapeera-backup';
const BACKUP_VERSION = 1;
const SECRET_SETTING_KEYS = new Set(['active_sessions_v1', 'zapeera_cloud_access_token', 'zapeera_cloud_api_url']);

const USER_REF_FIELDS = new Set([
  'userId', 'createdBy', 'updatedBy', 'refundedBy', 'salespersonId', 'managerId',
  'invitedBy', 'startedBy', 'completedBy', 'reportingManagerId', 'receivedBy',
  'paidBy', 'approvedBy', 'processedBy', 'checkedInBy', 'voidedBy', 'requestedBy'
]);
const OPTIONAL_USER_REF_FIELDS = new Set([
  'salespersonId', 'managerId', 'invitedBy', 'reportingManagerId', 'completedBy',
  'receivedBy', 'paidBy', 'approvedBy', 'processedBy', 'checkedInBy', 'voidedBy',
  'requestedBy', 'updatedBy'
]);

// key (in the backup file) → local table + how its rows are scoped to a
// business. Order is dependency order (parents before children).
const TABLE_SPECS = [
  { key: 'branches', table: 'branches', scope: 'company' },
  { key: 'categories', table: 'categories', scope: 'companyOrBranch' },
  { key: 'manufacturers', table: 'manufacturers', scope: 'companyOrBranch' },
  { key: 'suppliers', table: 'suppliers', scope: 'companyOrBranch' },
  { key: 'shelves', table: 'shelves', scope: 'companyOrBranch' },
  { key: 'taxClasses', table: 'tax_classes', scope: 'company' },
  { key: 'products', table: 'products', scope: 'company' },
  { key: 'productVariants', table: 'product_variants', scope: 'company' },
  { key: 'batches', table: 'batches', scope: 'company' },
  { key: 'customers', table: 'customers', scope: 'company' },
  { key: 'promotions', table: 'promotions', scope: 'company' },
  { key: 'purchases', table: 'purchases', scope: 'company' },
  { key: 'purchaseItems', table: 'purchase_items', scope: 'parent', parentKey: 'purchases', fk: 'purchaseId' },
  { key: 'stockMovements', table: 'stock_movements', scope: 'company' },
  { key: 'stockTransfers', table: 'stock_transfers', scope: 'company' },
  { key: 'stockTransferItems', table: 'stock_transfer_items', scope: 'parent', parentKey: 'stockTransfers', fk: 'transferId' },
  { key: 'stockTakes', table: 'stock_takes', scope: 'company' },
  { key: 'stockTakeLines', table: 'stock_take_lines', scope: 'parent', parentKey: 'stockTakes', fk: 'stockTakeId' },
  { key: 'prescriptions', table: 'prescriptions', scope: 'company' },
  { key: 'prescriptionItems', table: 'prescription_items', scope: 'parent', parentKey: 'prescriptions', fk: 'prescriptionId' },
  { key: 'patients', table: 'patients', scope: 'company' },
  { key: 'doctors', table: 'doctors', scope: 'company' },
  { key: 'roomTypes', table: 'room_types', scope: 'company' },
  { key: 'rooms', table: 'rooms', scope: 'company' },
  { key: 'reservations', table: 'reservations', scope: 'company', defer: ['folioId'] },
  { key: 'folios', table: 'folios', scope: 'company', defer: ['saleId'] },
  { key: 'sales', table: 'sales', scope: 'company' },
  { key: 'saleItems', table: 'sale_items', scope: 'parent', parentKey: 'sales', fk: 'saleId' },
  { key: 'salePayments', table: 'sale_payments', scope: 'parent', parentKey: 'sales', fk: 'saleId' },
  { key: 'salePromotions', table: 'sale_promotions', scope: 'parent', parentKey: 'sales', fk: 'saleId' },
  { key: 'saleTaxLines', table: 'sale_tax_lines', scope: 'parent', parentKey: 'sales', fk: 'saleId' },
  { key: 'receipts', table: 'receipts', scope: 'company' },
  { key: 'refunds', table: 'refunds', scope: 'company' },
  { key: 'refundItems', table: 'refund_items', scope: 'parent', parentKey: 'refunds', fk: 'refundId' },
  { key: 'customerLedgerEntries', table: 'customer_ledger_entries', scope: 'company' },
  { key: 'loyaltyTransactions', table: 'loyalty_transactions', scope: 'company' },
  { key: 'appointments', table: 'appointments', scope: 'company' },
  { key: 'doctorSettlements', table: 'doctor_settlements', scope: 'company' },
  { key: 'folioCharges', table: 'folio_charges', scope: 'parent', parentKey: 'folios', fk: 'folioId' },
  { key: 'folioPayments', table: 'folio_payments', scope: 'parent', parentKey: 'folios', fk: 'folioId' },
  { key: 'attendance', table: 'attendance', scope: 'companyOrBranch' },
  { key: 'shifts', table: 'shifts', scope: 'companyOrBranch' },
  { key: 'commissions', table: 'commissions', scope: 'companyOrBranch' },
  { key: 'scheduledShifts', table: 'scheduled_shifts', scope: 'companyOrBranch' },
  { key: 'scheduledShiftUsers', table: 'scheduled_shift_users', scope: 'parent', parentKey: 'scheduledShifts', fk: 'scheduledShiftId' }
];

function registerBackupRoutes(app, authMiddleware, deps) {
  const { query, run, uuid, now, saveDatabase, getDataDir } = deps;

  // NOTE: routes are registered BEFORE the database finishes
  // initializing in embedded-server.js (init runs in a setImmediate
  // after listen), so the safety table cannot be created here — any
  // register-time DB call hits a null database. Create it lazily on
  // first use instead (same reason the routes read schema via PRAGMA
  // at request time rather than caching it).
  let safetyTableReady = false;
  const ensureSafetyTable = () => {
    if (safetyTableReady) return;
    run(`CREATE TABLE IF NOT EXISTS backup_safety_snapshots (
      id TEXT PRIMARY KEY, businessId TEXT, businessName TEXT, ownerId TEXT,
      fileName TEXT, sizeBytes INTEGER, reason TEXT, sourceKind TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    safetyTableReady = true;
  };

  const safetyDir = () => {
    const dir = path.join(getDataDir(), 'backup-safety');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  const tableExists = (table) => query("SELECT name FROM sqlite_master WHERE type='table' AND name = ?", [table]).length > 0;
  const columnsOf = (table) => {
    try { return query(`PRAGMA table_info(${table})`).map(r => r.name); } catch { return []; }
  };

  const codedError = (code, message, status) => { const e = new Error(message); e.code = code; e.status = status; return e; };

  function findOwnedBusinesses(userId) {
    const created = query('SELECT * FROM companies WHERE createdBy = ? AND isActive = 1', [userId]);
    const byId = new Map(created.map(c => [c.id, c]));
    const ownerMemberships = query(
      "SELECT businessId FROM memberships WHERE userId = ? AND status IN ('ACTIVE','DOWNLOADED') AND UPPER(COALESCE(role,'')) = 'OWNER'",
      [userId]
    );
    for (const m of ownerMemberships) {
      if (!byId.has(m.businessId)) {
        const c = query('SELECT * FROM companies WHERE id = ? AND isActive = 1', [m.businessId])[0];
        if (c) byId.set(c.id, c);
      }
    }
    return Array.from(byId.values());
  }

  const isOwner = (userId, business) => {
    if (!business) return false;
    if (business.createdBy === userId) return true;
    const m = query(
      "SELECT id FROM memberships WHERE userId = ? AND businessId = ? AND status IN ('ACTIVE','DOWNLOADED') AND UPPER(COALESCE(role,'')) = 'OWNER'",
      [userId, business.id]
    )[0];
    return !!m;
  };

  // ── Export ────────────────────────────────────────────────────────
  function exportTables(business) {
    const B = business.id;
    const branches = tableExists('branches') ? query('SELECT * FROM branches WHERE companyId = ?', [B]) : [];
    const branchIds = branches.map(b => b.id);
    const tables = {};
    const parentIds = { branches: branchIds };

    const scopedQuery = (spec) => {
      if (!tableExists(spec.table)) return [];
      const cols = columnsOf(spec.table);
      if (spec.scope === 'company') {
        if (!cols.includes('companyId')) return [];
        return query(`SELECT * FROM ${spec.table} WHERE companyId = ?`, [B]);
      }
      if (spec.scope === 'companyOrBranch') {
        const conds = [];
        const params = [];
        if (cols.includes('companyId')) { conds.push('companyId = ?'); params.push(B); }
        if (cols.includes('branchId') && branchIds.length) { conds.push(`branchId IN (${branchIds.map(() => '?').join(',')})`); params.push(...branchIds); }
        if (!conds.length) return [];
        return query(`SELECT * FROM ${spec.table} WHERE ${conds.join(' OR ')}`, params);
      }
      // parent-scoped
      const ids = parentIds[spec.parentKey] || [];
      if (!ids.length || !cols.includes(spec.fk)) return [];
      return query(`SELECT * FROM ${spec.table} WHERE ${spec.fk} IN (${ids.map(() => '?').join(',')})`, ids);
    };

    for (const spec of TABLE_SPECS) {
      const rows = scopedQuery(spec);
      tables[spec.key] = rows;
      parentIds[spec.key] = rows.map(r => r.id);
    }

    // Members — SAFE projection only (never user rows / password hashes).
    const memberships = query('SELECT * FROM memberships WHERE businessId = ?', [B]);
    tables.members = memberships.map(m => {
      const u = query('SELECT email, name, username FROM users WHERE id = ?', [m.userId])[0];
      return {
        id: m.id,
        userId: m.userId,
        email: u?.email || '',
        name: u?.name || '',
        username: u?.username || '',
        roleName: m.role || 'OWNER',
        status: m.status,
        invitedBy: null,
        branchIds: String(m.branchIds || '').split(',').map(x => x.trim()).filter(Boolean),
        staffProfile: null
      };
    });

    // Format-stability keys the desktop schema does not have.
    tables.roles = [];
    tables.rolePermissionsV2 = [];
    tables.expenseCategories = [];
    tables.fbrConfig = []; // no local FBR table by design — nothing to export, no token can leak
    tables.businessModules = [];
    tables.businessModuleOverrides = [];
    tables.billingProfiles = [];

    // Settings: install-global key/value rows, minus every secret key.
    const settings = query('SELECT * FROM settings').filter(r => !SECRET_SETTING_KEYS.has(r.key) && !String(r.key).startsWith('sync_cursor_'));
    tables.settings = settings;
    return tables;
  }

  function buildBusinessBackup(business) {
    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      kind: 'business',
      exportedAt: new Date().toISOString(),
      exportedFrom: { businessId: business.id, businessName: business.name },
      business,
      tables: exportTables(business)
    };
  }

  function resolveBusinessId(req) {
    return req.headers['x-business-id'] || req.headers['x-company-id'] ||
      req.user?.selectedCompanyId || req.user?.companyId || null;
  }

  const sendDownload = (res, payload, filename) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(JSON.stringify(payload, null, 2));
  };
  const dateStamp = () => new Date().toISOString().slice(0, 10);
  const slugify = (name) => (name || 'business').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  app.get('/api/backup/export', authMiddleware, (req, res) => {
    try {
      const businessId = resolveBusinessId(req);
      if (!businessId) return res.status(400).json({ success: false, message: 'Business context is required (X-Business-ID).' });
      const business = query('SELECT * FROM companies WHERE id = ?', [businessId])[0];
      if (!business) return res.status(404).json({ success: false, message: 'Business not found' });
      if (!isOwner(req.user.id, business)) {
        return res.status(403).json({ success: false, message: 'Only the business owner can export a backup', code: 'BACKUP_OWNER_ONLY' });
      }
      return sendDownload(res, buildBusinessBackup(business), `zapeera-backup-${slugify(business.name)}-${dateStamp()}.json`);
    } catch (e) { res.status(500).json({ success: false, message: 'Failed to export backup' }); }
  });

  app.get('/api/backup/export-account', authMiddleware, (req, res) => {
    try {
      const businesses = findOwnedBusinesses(req.user.id);
      if (!businesses.length) return res.status(404).json({ success: false, message: 'You do not own any business to back up' });
      const payload = {
        format: BACKUP_FORMAT,
        version: BACKUP_VERSION,
        kind: 'account',
        exportedAt: new Date().toISOString(),
        businesses: businesses.map(b => ({ business: b, tables: exportTables(b) }))
      };
      return sendDownload(res, payload, `zapeera-account-backup-${dateStamp()}.json`);
    } catch (e) { res.status(500).json({ success: false, message: 'Failed to export account backup' }); }
  });

  // ── Restore helpers ───────────────────────────────────────────────
  function validateEnvelope(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'Backup file must be a JSON object';
    if (payload.format !== BACKUP_FORMAT) return `Not a Zapeera backup file (format must be "${BACKUP_FORMAT}")`;
    if (payload.version !== BACKUP_VERSION) return `Unsupported backup version ${payload.version} (this version of Zapeera restores version ${BACKUP_VERSION})`;
    const hasBusinesses = Array.isArray(payload.businesses) && payload.businesses.length > 0;
    const hasSingle = payload.tables && typeof payload.tables === 'object';
    if (!hasBusinesses && !hasSingle) return 'Backup file contains no business data';
    return null;
  }

  function normalizeEntries(payload) {
    if (Array.isArray(payload.businesses)) {
      return payload.businesses.filter(b => b && typeof b === 'object').map(b => ({ business: b.business || {}, tables: b.tables || {} }));
    }
    return [{ business: payload.business || {}, tables: payload.tables || {} }];
  }

  function uniqueCompanyName(base) {
    let candidate = base;
    let n = 2;
    while (query('SELECT id FROM companies WHERE name = ?', [candidate])[0]) candidate = `${base} ${n++}`;
    return candidate;
  }

  function remapRow(spec, row, ctx, localCols) {
    const out = {};
    const fixups = {};
    const defer = new Set(spec.defer || []);
    for (const [field, raw] of Object.entries(row)) {
      if (!localCols.includes(field)) continue;
      if (field === 'uuid') { out[field] = null; continue; }
      let value = raw;
      if (field === 'id') {
        value = ctx.idMap.get(raw) ?? raw;
      } else if (typeof raw === 'string' && raw) {
        if (defer.has(field)) {
          const mapped = ctx.idMap.get(raw);
          if (mapped) fixups[field] = mapped;
          value = null;
        } else if (USER_REF_FIELDS.has(field)) {
          const mapped = ctx.userMap.get(raw);
          if (mapped) value = mapped;
          else value = OPTIONAL_USER_REF_FIELDS.has(field) ? null : ctx.callerId;
        } else if (ctx.idMap.has(raw)) {
          value = ctx.idMap.get(raw);
        }
      }
      out[field] = value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
    }
    return { row: out, fixups };
  }

  function insertRow(table, row) {
    const cols = Object.keys(row);
    if (!cols.length) return;
    run(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map(c => row[c]));
  }

  function cleanupBusiness(newId, idMap) {
    // Best-effort rollback for create-new when a table fails midway.
    try {
      for (const spec of [...TABLE_SPECS].reverse()) {
        if (!tableExists(spec.table)) continue;
        const cols = columnsOf(spec.table);
        if (cols.includes('companyId')) run(`DELETE FROM ${spec.table} WHERE companyId = ?`, [newId]);
      }
      run('DELETE FROM memberships WHERE businessId = ?', [newId]);
      run('DELETE FROM subscriptions WHERE companyId = ?', [newId]);
      run('DELETE FROM companies WHERE id = ?', [newId]);
      saveDatabase && saveDatabase();
    } catch (e) { console.error('[Backup] cleanup failed:', e.message); }
  }

  function restoreMembers(tables, ctx, newBusinessId, caller, counts, skippedStaff, mode) {
    const members = tables.members || [];
    let ownerCreated = false;
    for (const member of members) {
      const email = String(member.email || '').trim().toLowerCase();
      let resolvedUserId = null;
      if (email && email === String(caller.email || '').toLowerCase()) resolvedUserId = caller.id;
      else if (email) {
        const existing = query('SELECT id FROM users WHERE email = ?', [email])[0];
        if (existing) resolvedUserId = existing.id;
      }
      if (member.userId && resolvedUserId) ctx.userMap.set(member.userId, resolvedUserId);
      if (!resolvedUserId) {
        skippedStaff.push({ email: member.email || '', name: member.name, roleName: member.roleName });
        continue;
      }
      const roleName = member.roleName || member.role || 'OWNER';
      const existingMembership = query('SELECT id FROM memberships WHERE userId = ? AND businessId = ?', [resolvedUserId, newBusinessId])[0];
      if (existingMembership) {
        if (mode === 'update') {
          run('UPDATE memberships SET role = ?, status = ?, updatedAt = ? WHERE id = ?', [roleName, member.status || 'ACTIVE', now(), existingMembership.id]);
          counts.members = (counts.members || 0) + 1;
        }
        if (member.id) ctx.idMap.set(member.id, existingMembership.id);
      } else {
        const mid = uuid();
        if (member.id) ctx.idMap.set(member.id, mid);
        run(`INSERT INTO memberships (id, userId, businessId, businessName, role, branchIds, status, createdAt, updatedAt)
             VALUES (?,?,?,?,?,?,?,?,?)`,
          [mid, resolvedUserId, newBusinessId, ctx.businessName || null, roleName,
           Array.isArray(member.branchIds) ? member.branchIds.map(b => ctx.idMap.get(b) || b).join(',') : (member.branchIds || ''),
           member.status || 'ACTIVE', now(), now()]);
        counts.members = (counts.members || 0) + 1;
      }
      if (resolvedUserId === caller.id && String(roleName).toUpperCase() === 'OWNER') ownerCreated = true;
    }
    if (mode === 'create' && !ownerCreated) {
      run(`INSERT INTO memberships (id, userId, businessId, businessName, role, status, createdAt, updatedAt)
           VALUES (?,?,?,?,?,?,?,?)`,
        [uuid(), caller.id, newBusinessId, ctx.businessName || null, 'OWNER', 'ACTIVE', now(), now()]);
      counts.members = (counts.members || 0) + 1;
    }
  }

  function importSettings(tables, counts) {
    let imported = 0;
    let skipped = 0;
    for (const row of tables.settings || []) {
      if (!row?.key || SECRET_SETTING_KEYS.has(row.key) || String(row.key).startsWith('sync_cursor_')) continue;
      const existing = query('SELECT id FROM settings WHERE key = ?', [row.key])[0];
      if (existing) { skipped++; continue; }
      run('INSERT INTO settings (id, key, value, createdAt, updatedAt) VALUES (?,?,?,?,?)',
        [uuid(), row.key, typeof row.value === 'object' && row.value !== null ? JSON.stringify(row.value) : row.value, now(), now()]);
      imported++;
    }
    counts.settings = imported;
    return skipped;
  }

  // Create-new restore of one business entry.
  function restoreOneBusiness(caller, entry) {
    const src = entry.business || {};
    const tables = entry.tables || {};
    const warnings = [];
    const counts = {};
    const skippedStaff = [];
    const newBusinessId = uuid();
    const idMap = new Map();
    if (src.id) idMap.set(src.id, newBusinessId);
    for (const spec of TABLE_SPECS) {
      for (const row of tables[spec.key] || []) {
        if (row?.id && !idMap.has(row.id)) idMap.set(row.id, uuid());
      }
    }
    const name = uniqueCompanyName(`${src.name || 'Restored business'} (Restored)`);
    const ctx = { idMap, userMap: new Map(), callerId: caller.id, businessName: name };

    try {
      // Company shell — columns filtered to the local schema.
      const companyCols = columnsOf('companies');
      const shell = {};
      for (const [k, v] of Object.entries(src)) if (companyCols.includes(k)) shell[k] = v;
      shell.id = newBusinessId;
      shell.name = name;
      shell.createdBy = caller.id;
      if (companyCols.includes('slug') && shell.slug) {
        let slug = `${shell.slug}-restored`;
        let n = 2;
        while (query('SELECT id FROM companies WHERE slug = ?', [slug])[0]) slug = `${shell.slug}-restored-${n++}`;
        shell.slug = slug;
      }
      if (companyCols.includes('isActive')) shell.isActive = 1;
      shell.createdAt = now();
      shell.updatedAt = now();
      delete shell.uuid;
      insertRow('companies', shell);

      restoreMembers(tables, ctx, newBusinessId, caller, counts, skippedStaff, 'create');

      const pendingFixups = [];
      for (const spec of TABLE_SPECS) {
        const rows = tables[spec.key] || [];
        if (!rows.length || !tableExists(spec.table)) { counts[spec.key] = 0; continue; }
        const localCols = columnsOf(spec.table);
        let inserted = 0;
        for (const row of rows) {
          const { row: out, fixups } = remapRow(spec, row, ctx, localCols);
          // Rows must belong to the NEW business.
          if (localCols.includes('companyId')) out.companyId = newBusinessId;
          try {
            insertRow(spec.table, out);
            inserted++;
            if (Object.keys(fixups).length) pendingFixups.push({ spec, id: out.id, fixups });
          } catch (e) {
            throw new Error(`Restore failed at table "${spec.key}": ${e.message}`);
          }
        }
        counts[spec.key] = inserted;
      }
      for (const pending of pendingFixups) {
        const sets = Object.keys(pending.fixups).map(k => `${k} = ?`).join(', ');
        if (sets) run(`UPDATE ${pending.spec.table} SET ${sets} WHERE id = ?`, [...Object.values(pending.fixups), pending.id]);
      }

      const settingsSkipped = importSettings(tables, counts);
      if (settingsSkipped) warnings.push(`${settingsSkipped} setting(s) already exist on this installation and were not overwritten.`);

      // Trial subscription — subscriptions are never copied (mirrors web).
      try {
        run('INSERT INTO subscriptions (id, companyId, plan, status, startDate, endDate, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)',
          [uuid(), newBusinessId, 'TRIAL', 'TRIAL', now(), new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(), now(), now()]);
      } catch (e) { /* subscriptions table shape varies; non-fatal */ }
      warnings.push('The restored business starts on the free TRIAL plan (15 days). Subscriptions and payment history were not copied from the backup.');
      saveDatabase && saveDatabase();
      return { businessId: newBusinessId, name, counts, skippedStaff, warnings };
    } catch (e) {
      cleanupBusiness(newBusinessId, idMap);
      throw e;
    }
  }

  // ── Update mode ───────────────────────────────────────────────────
  function resolveUpdateTargets(caller, entries, targets) {
    const owned = findOwnedBusinesses(caller.id);
    const ownedById = new Map(owned.map(b => [b.id, b]));
    const resolved = new Map();
    const used = new Map();
    for (const entry of entries) {
      const src = entry.business || {};
      if (!src.id) throw codedError('BACKUP_UPDATE_MAPPING_INVALID', 'A business in this backup file has no id and cannot be mapped to a target.', 400);
      let target;
      const explicit = targets?.[src.id];
      if (explicit) {
        target = ownedById.get(explicit);
        if (!target) throw codedError('BACKUP_TARGET_NOT_OWNED', `Target business for "${src.name || src.id}" is not a business you own.`, 403);
      } else if (ownedById.has(src.id)) {
        target = ownedById.get(src.id);
      } else {
        target = owned.find(b => src.slug && b.slug === src.slug) || owned.find(b => src.name && b.name === src.name);
        if (!target) throw codedError('BACKUP_TARGET_REQUIRED', `Choose a target business for "${src.name || src.id}" — it does not match any business you own.`, 400);
      }
      if (used.has(target.id)) throw codedError('BACKUP_UPDATE_MAPPING_INVALID', `Two businesses in this file map to the same target ("${target.name}"). Map each one to a different business.`, 400);
      used.set(target.id, src.id);
      resolved.set(src.id, target);
    }
    return resolved;
  }

  function storeSafetySnapshot(caller, business, payload, sourceKind) {
    ensureSafetyTable();
    const snapshotId = uuid();
    const fileName = `safety-${snapshotId}.json`;
    const body = JSON.stringify(payload, null, 2);
    fs.writeFileSync(path.join(safetyDir(), fileName), body, 'utf8');
    run(`INSERT INTO backup_safety_snapshots (id, businessId, businessName, ownerId, fileName, sizeBytes, reason, sourceKind, createdAt)
         VALUES (?,?,?,?,?,?,?,?,?)`,
      [snapshotId, business.id, business.name, caller.id, fileName, Buffer.byteLength(body), 'PRE_UPDATE', sourceKind || null, now()]);
    saveDatabase && saveDatabase();
    return snapshotId;
  }

  function computeDiff(entry, target) {
    const targetTables = exportTables(target);
    const tables = entry.tables || {};
    const sameBusiness = entry.business?.id === target.id;
    const perTable = {};
    let skippedMembers = 0;
    // Members by email.
    const backupMembers = tables.members || [];
    const targetMembers = targetTables.members || [];
    const targetEmails = new Set(targetMembers.map(m => String(m.email || '').toLowerCase()).filter(Boolean));
    const backupEmails = backupMembers.map(m => String(m.email || '').toLowerCase()).filter(Boolean);
    let mUpdate = 0, mAdd = 0;
    for (const email of backupEmails) {
      if (targetEmails.has(email)) mUpdate++;
      else {
        const exists = email && query('SELECT id FROM users WHERE email = ?', [email])[0];
        if (exists) mAdd++; else skippedMembers++;
      }
    }
    perTable.members = { update: mUpdate, add: mAdd, kept: Math.max(0, targetMembers.length - mUpdate) };

    for (const spec of TABLE_SPECS) {
      const bRows = tables[spec.key] || [];
      const tRows = targetTables[spec.key] || [];
      if (sameBusiness) {
        const b = new Set(bRows.map(r => r?.id).filter(Boolean));
        const t = new Set(tRows.map(r => r?.id).filter(Boolean));
        perTable[spec.key] = {
          update: [...b].filter(id => t.has(id)).length,
          add: [...b].filter(id => !t.has(id)).length,
          kept: [...t].filter(id => !b.has(id)).length
        };
      } else {
        perTable[spec.key] = { update: 0, add: bRows.length, kept: tRows.length };
      }
    }
    const bKeys = new Set((tables.settings || []).map(r => r?.key).filter(Boolean));
    const tKeys = new Set((targetTables.settings || []).map(r => r?.key).filter(Boolean));
    perTable.settings = { update: 0, add: [...bKeys].filter(k => !tKeys.has(k)).length, kept: (targetTables.settings || []).length };
    return { perTable, skippedMembers };
  }

  function applyUpdate(caller, entry, target) {
    const tables = entry.tables || {};
    const targetTables = exportTables(target);
    const { perTable } = computeDiff(entry, target);
    const sameBusiness = entry.business?.id === target.id;
    const warnings = [];
    const skippedStaff = [];
    const updated = {};
    const added = {};
    const kept = {};
    for (const [k, d] of Object.entries(perTable)) kept[k] = d.kept;

    const idMap = new Map();
    if (entry.business?.id) idMap.set(entry.business.id, target.id);
    for (const spec of TABLE_SPECS) {
      for (const row of tables[spec.key] || []) {
        if (row?.id && !idMap.has(row.id)) idMap.set(row.id, sameBusiness ? row.id : uuid());
      }
    }
    const ctx = { idMap, userMap: new Map(), callerId: caller.id, businessName: target.name };

    const memberCounts = {};
    restoreMembers(tables, ctx, target.id, caller, memberCounts, skippedStaff, 'update');
    if (memberCounts.members) { updated.members = perTable.members.update; added.members = Math.max(0, memberCounts.members - perTable.members.update); }

    const pendingFixups = [];
    for (const spec of TABLE_SPECS) {
      const rows = tables[spec.key] || [];
      if (!rows.length || !tableExists(spec.table)) continue;
      const localCols = columnsOf(spec.table);
      for (const row of rows) {
        const { row: out, fixups } = remapRow(spec, row, ctx, localCols);
        if (localCols.includes('companyId')) out.companyId = target.id;
        try {
          const existing = out.id ? query(`SELECT id FROM ${spec.table} WHERE id = ?`, [out.id])[0] : null;
          if (existing) {
            const sets = Object.keys(out).filter(k => k !== 'id');
            if (sets.length) {
              run(`UPDATE ${spec.table} SET ${sets.map(k => `${k} = ?`).join(', ')} WHERE id = ?`, [...sets.map(k => out[k]), out.id]);
            }
            updated[spec.key] = (updated[spec.key] || 0) + 1;
          } else {
            insertRow(spec.table, out);
            added[spec.key] = (added[spec.key] || 0) + 1;
          }
          if (Object.keys(fixups).length) pendingFixups.push({ spec, id: out.id, fixups });
        } catch (e) {
          throw new Error(`Restore update failed at table "${spec.key}": ${e.message}`);
        }
      }
    }
    for (const pending of pendingFixups) {
      const sets = Object.keys(pending.fixups).map(k => `${k} = ?`).join(', ');
      if (sets) run(`UPDATE ${pending.spec.table} SET ${sets} WHERE id = ?`, [...Object.values(pending.fixups), pending.id]);
    }
    const settingsCounts = {};
    const settingsSkipped = importSettings(tables, settingsCounts);
    if (settingsCounts.settings) added.settings = settingsCounts.settings;
    if (settingsSkipped) warnings.push(`${settingsSkipped} setting(s) already exist and were not overwritten.`);

    saveDatabase && saveDatabase();
    const sum = (bag) => Object.values(bag).reduce((a, b) => a + b, 0);
    return {
      sourceBusinessId: entry.business?.id,
      businessId: target.id,
      name: target.name,
      sameBusiness,
      updated, added, kept,
      updatedTotal: sum(updated), addedTotal: sum(added), keptTotal: sum(kept),
      safetySnapshotId: null, // filled by caller
      skippedStaff, warnings
    };
  }

  app.post('/api/backup/restore', authMiddleware, (req, res) => {
    try {
      const caller = { id: req.user.id, email: req.user.email || '', name: req.user.name };
      if (req.body && req.body.mode === 'update') {
        const payload = req.body.backup;
        const invalid = validateEnvelope(payload);
        if (invalid) return res.status(400).json({ success: false, message: invalid, code: 'BACKUP_FORMAT_INVALID' });
        const entries = normalizeEntries(payload);
        const targetMap = resolveUpdateTargets(caller, entries, req.body.targets || {});
        const updatedResults = [];
        for (const entry of entries) {
          const target = targetMap.get(entry.business?.id);
          const safetyPayload = buildBusinessBackup(target);
          const snapshotId = storeSafetySnapshot(caller, target, safetyPayload, payload.kind || null);
          const result = applyUpdate(caller, entry, target);
          result.safetySnapshotId = snapshotId;
          updatedResults.push(result);
        }
        return res.status(200).json({
          success: true,
          message: updatedResults.length === 1 ? `Business "${updatedResults[0].name}" updated from backup` : `${updatedResults.length} businesses updated from backup`,
          data: { updated: updatedResults }
        });
      }
      const payload = req.body?.backup ?? req.body;
      const invalid = validateEnvelope(payload);
      if (invalid) return res.status(400).json({ success: false, message: invalid, code: 'BACKUP_FORMAT_INVALID' });
      const entries = normalizeEntries(payload);
      const restored = entries.map(entry => restoreOneBusiness(caller, entry));
      return res.status(201).json({
        success: true,
        message: restored.length === 1 ? `Business restored as "${restored[0].name}"` : `${restored.length} businesses restored`,
        data: { restored }
      });
    } catch (e) {
      if (e?.status && e?.code) return res.status(e.status).json({ success: false, message: e.message, code: e.code });
      console.error('[Backup] Restore error:', e.message);
      return res.status(500).json({
        success: false,
        message: e?.message?.startsWith('Restore failed at table') || e?.message?.startsWith('Restore update failed at table') ? e.message : 'Failed to restore backup'
      });
    }
  });

  app.post('/api/backup/restore-preview', authMiddleware, (req, res) => {
    try {
      const caller = { id: req.user.id, email: req.user.email || '', name: req.user.name };
      const payload = req.body?.backup ?? req.body;
      const invalid = validateEnvelope(payload);
      if (invalid) return res.status(400).json({ success: false, message: invalid, code: 'BACKUP_FORMAT_INVALID' });
      const entries = normalizeEntries(payload);
      const targetMap = resolveUpdateTargets(caller, entries, req.body?.targets || {});
      const previews = entries.map(entry => {
        const target = targetMap.get(entry.business?.id);
        const { perTable, skippedMembers } = computeDiff(entry, target);
        const totals = Object.values(perTable).reduce((acc, d) => ({ update: acc.update + d.update, add: acc.add + d.add, kept: acc.kept + d.kept }), { update: 0, add: 0, kept: 0 });
        return {
          sourceBusinessId: entry.business?.id,
          sourceBusinessName: entry.business?.name || '',
          targetBusinessId: target.id,
          targetBusinessName: target.name,
          sameBusiness: entry.business?.id === target.id,
          perTable,
          toUpdate: totals.update,
          toAdd: totals.add,
          keptTargetOnly: totals.kept,
          skippedMembers
        };
      });
      return res.json({ success: true, data: { previews } });
    } catch (e) {
      if (e?.status && e?.code) return res.status(e.status).json({ success: false, message: e.message, code: e.code });
      console.error('[Backup] Preview error:', e.message);
      return res.status(500).json({ success: false, message: 'Failed to preview restore' });
    }
  });

  app.get('/api/backup/safety-backups', authMiddleware, (req, res) => {
    try {
      ensureSafetyTable();
      const caller = { id: req.user.id };
      const owned = findOwnedBusinesses(caller.id);
      const ownedIds = new Set(owned.map(b => b.id));
      const businessId = typeof req.query.businessId === 'string' ? req.query.businessId : undefined;
      if (businessId && !ownedIds.has(businessId)) {
        return res.status(403).json({ success: false, message: 'That business is not a business you own.', code: 'BACKUP_TARGET_NOT_OWNED' });
      }
      const rows = businessId
        ? query('SELECT * FROM backup_safety_snapshots WHERE businessId = ? ORDER BY createdAt DESC LIMIT 100', [businessId])
        : query('SELECT * FROM backup_safety_snapshots WHERE ownerId = ? ORDER BY createdAt DESC LIMIT 100', [caller.id]);
      const snapshots = rows.filter(r => ownedIds.has(r.businessId)).map(r => ({
        id: r.id, businessId: r.businessId, businessName: r.businessName, ownerId: r.ownerId,
        fileName: r.fileName, sizeBytes: r.sizeBytes, reason: r.reason, sourceKind: r.sourceKind, createdAt: r.createdAt
      }));
      return res.json({ success: true, data: { snapshots } });
    } catch (e) { res.status(500).json({ success: false, message: 'Failed to list safety backups' }); }
  });

  app.get('/api/backup/safety-backups/:id/download', authMiddleware, (req, res) => {
    try {
      ensureSafetyTable();
      const snapshot = query('SELECT * FROM backup_safety_snapshots WHERE id = ?', [req.params.id])[0];
      if (!snapshot) return res.status(404).json({ success: false, message: 'That safety backup no longer exists.', code: 'SAFETY_BACKUP_NOT_FOUND' });
      const business = query('SELECT * FROM companies WHERE id = ?', [snapshot.businessId])[0];
      if (!isOwner(req.user.id, business)) {
        return res.status(403).json({ success: false, message: 'Only the business owner can download safety backups', code: 'BACKUP_OWNER_ONLY' });
      }
      if (!/^safety-[A-Za-z0-9-]+\.json$/.test(snapshot.fileName || '')) {
        return res.status(404).json({ success: false, message: 'That safety backup file is missing.', code: 'SAFETY_BACKUP_NOT_FOUND' });
      }
      const filePath = path.join(safetyDir(), snapshot.fileName);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, message: 'That safety backup file is missing.', code: 'SAFETY_BACKUP_NOT_FOUND' });
      }
      const stamp = String(snapshot.createdAt || '').slice(0, 10);
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="zapeera-safety-backup-${slugify(snapshot.businessName)}-${stamp}.json"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return fs.createReadStream(filePath).pipe(res);
    } catch (e) { res.status(500).json({ success: false, message: 'Failed to download safety backup' }); }
  });
}

module.exports = {
  registerBackupRoutes
};
