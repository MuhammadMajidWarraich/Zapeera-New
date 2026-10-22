// ─── Backup & Restore (Feature: business/account backup) ─────────────
// Pure helpers for the backup file format: the table catalogue (in
// dependency order — parents before children, mirroring the sync
// service's ordering), secret stripping for export, and the ID-remap
// pass used at restore time. Everything in this file is a pure
// function over plain objects so it can be self-checked without a DB
// (scripts/backup-remap-check.ts).
//
// FILE FORMAT (version 1):
//   {
//     format: 'zapeera-backup', version: 1, kind: 'business'|'account',
//     exportedAt: ISO string,
//     exportedFrom: { businessId, businessName },        // business kind
//     business: { ...Business row },                     // business kind
//     tables: { <key>: [rows] },                         // business kind
//     businesses: [ { business, tables } ]               // account kind
//   }
//
// SECRETS — never written to a backup file, ever:
//   · ZapeeraUser.password (user rows are never exported at all;
//     members travel as {email, name, roleName, status, branchIds})
//   · FbrConfig.apiToken (config row exported, token forced to null)
//   · BusinessInvitation.token (invitations are NOT exported)
//   · Settings 'active_sessions_v1' row (live session tokens)
//   · card_details / payment credentials (never exported)
//   · DeviceActivation rows (device fingerprints; machine-bound)
//
// DELIBERATELY NOT EXPORTED (documented in the UI + restore summary):
//   · BusinessSubscription + PaymentProof — a restored business starts
//     on the TRIAL plan; subscriptions/payments are never copied.
//   · FbrInvoiceQueue — server-side fiscal processing state; the sale
//     rows themselves carry the issued FBR numbers as mirrors.

export const BACKUP_FORMAT = 'zapeera-backup';
export const BACKUP_VERSION = 1;

/** Settings key holding live session tokens — a secret, never exported. */
export const SESSION_SETTINGS_KEY = 'active_sessions_v1';

export interface BackupTableSpec {
  /** Key inside tables{} in the backup file. */
  key: string;
  /** Prisma delegate name (camelCase model), null for pseudo tables. */
  delegate: string | null;
  /** Fields removed from rows at export AND dropped at import. */
  strip?: string[];
  /** Fields forced to null at import (dangling-by-design references). */
  nullify?: string[];
  /**
   * Fields nulled on insert and repaired by a fix-up pass once every
   * table is in (breaks FK cycles: reservation↔folio, folio→sale).
   */
  defer?: string[];
  /**
   * Fields set to null when their value does not resolve through the
   * id map (e.g. Sale.membershipId pointing at a staff membership that
   * was skipped because the staff account was not recreated).
   */
  nullifyIfUnmapped?: string[];
}

/**
 * The business's tables in IMPORT (dependency) order. The exporter
 * walks the same list, so a backup file's tables are always stored
 * parent-first. Pseudo tables (delegate: null) are handled by the
 * backup service: `members` (matched by email at restore) and
 * `settings` (owner-user key/value rows).
 */
export const BACKUP_TABLES: BackupTableSpec[] = [
  { key: 'branches', delegate: 'branch' },
  { key: 'roles', delegate: 'role' },
  { key: 'rolePermissionsV2', delegate: 'rolePermissionV2' },
  { key: 'members', delegate: null },
  { key: 'categories', delegate: 'category' },
  { key: 'expenseCategories', delegate: 'expenseCategory' },
  { key: 'manufacturers', delegate: 'manufacturer' },
  { key: 'suppliers', delegate: 'supplier' },
  { key: 'shelves', delegate: 'shelf' },
  { key: 'taxClasses', delegate: 'taxClass' },
  { key: 'products', delegate: 'product' },
  { key: 'productVariants', delegate: 'productVariant' },
  { key: 'batches', delegate: 'batch' },
  { key: 'customers', delegate: 'customer' },
  { key: 'promotions', delegate: 'promotion' },
  { key: 'purchases', delegate: 'purchase' },
  { key: 'purchaseItems', delegate: 'purchaseItem' },
  { key: 'stockMovements', delegate: 'stockMovement' },
  { key: 'stockTransfers', delegate: 'stockTransfer' },
  { key: 'stockTransferItems', delegate: 'stockTransferItem' },
  { key: 'stockTakes', delegate: 'stockTake' },
  { key: 'stockTakeLines', delegate: 'stockTakeLine' },
  { key: 'prescriptions', delegate: 'prescription' },
  { key: 'prescriptionItems', delegate: 'prescriptionItem' },
  { key: 'patients', delegate: 'patient' },
  { key: 'doctors', delegate: 'doctor' },
  { key: 'roomTypes', delegate: 'roomType' },
  { key: 'rooms', delegate: 'room' },
  { key: 'reservations', delegate: 'reservation', defer: ['folioId'] },
  { key: 'folios', delegate: 'folio', defer: ['saleId'] },
  { key: 'sales', delegate: 'sale', nullifyIfUnmapped: ['membershipId'] },
  { key: 'saleItems', delegate: 'saleItem' },
  { key: 'salePayments', delegate: 'salePayment' },
  { key: 'salePromotions', delegate: 'salePromotion' },
  { key: 'saleTaxLines', delegate: 'saleTaxLine' },
  { key: 'receipts', delegate: 'receipt' },
  { key: 'refunds', delegate: 'refund' },
  { key: 'refundItems', delegate: 'refundItem' },
  { key: 'customerLedgerEntries', delegate: 'customerLedgerEntry' },
  { key: 'loyaltyTransactions', delegate: 'loyaltyTransaction' },
  { key: 'appointments', delegate: 'appointment' },
  { key: 'doctorSettlements', delegate: 'doctorSettlement' },
  { key: 'folioCharges', delegate: 'folioCharge' },
  { key: 'folioPayments', delegate: 'folioPayment' },
  { key: 'attendance', delegate: 'attendance' },
  { key: 'shifts', delegate: 'shift' },
  { key: 'commissions', delegate: 'commission' },
  { key: 'scheduledShifts', delegate: 'scheduledShift' },
  { key: 'scheduledShiftUsers', delegate: 'scheduledShiftUser' },
  { key: 'fbrConfig', delegate: 'fbrConfig', strip: ['apiToken'] },
  { key: 'businessModules', delegate: 'businessModule' },
  { key: 'businessModuleOverrides', delegate: 'businessModuleOverride' },
  {
    key: 'billingProfiles',
    delegate: 'billingProfile',
    // paymentMethodId points at card_details, which is never restored.
    nullify: ['paymentMethodId']
  },
  { key: 'settings', delegate: null }
];

export const BACKUP_TABLE_KEYS = BACKUP_TABLES.map((t) => t.key);

/**
 * Fields that reference a ZapeeraUser. At restore they are rewritten
 * through the user map (owner → caller; staff → the account matched by
 * email from the members table). Unresolvable REQUIRED user refs fall
 * back to the caller; unresolvable OPTIONAL ones (below) become null.
 */
export const USER_REF_FIELDS = new Set([
  'userId',
  'createdBy',
  'updatedBy',
  'refundedBy',
  'salespersonId',
  'managerId',
  'invitedBy',
  'startedBy',
  'completedBy',
  'reportingManagerId',
  'receivedBy',
  'paidBy',
  'approvedBy',
  'processedBy',
  'checkedInBy',
  'voidedBy',
  'requestedBy'
]);

/** User-ref fields that may safely become null when unresolvable. */
export const OPTIONAL_USER_REF_FIELDS = new Set([
  'salespersonId',
  'managerId',
  'invitedBy',
  'reportingManagerId',
  'completedBy',
  'receivedBy',
  'paidBy',
  'approvedBy',
  'processedBy',
  'checkedInBy',
  'voidedBy',
  'requestedBy',
  'updatedBy'
]);

export type IdGenerator = () => string;

/** Build the old-id → new-id map for a set of old ids. */
export function buildIdMap(oldIds: string[], gen: IdGenerator): Map<string, string> {
  const map = new Map<string, string>();
  for (const id of oldIds) {
    if (id && !map.has(id)) map.set(id, gen());
  }
  return map;
}

export interface RemapContext {
  /** Global old-row-id → new-row-id map for the whole business. */
  idMap: Map<string, string>;
  /** Old user id → new user id (owner/staff matched by email). */
  userMap: Map<string, string>;
  /** The restoring user's id — fallback for required user refs. */
  callerId: string;
  /** Global Module name → target Module row id (businessModules). */
  moduleMap: Map<string, string>;
}

export interface RemappedRow {
  row: Record<string, any>;
  /** Deferred FK repairs: field → new value to set after all inserts. */
  fixups: Record<string, string>;
  /** Non-null when the row must be skipped (e.g. unknown module). */
  skipReason: string | null;
}

/** Remove secret fields from an exported row (export-side defence). */
export function stripSecrets(spec: BackupTableSpec, row: Record<string, any>): Record<string, any> {
  if (!spec.strip?.length) return row;
  const out = { ...row };
  for (const field of spec.strip) {
    if (field in out) out[field] = null;
  }
  return out;
}

/**
 * Rewrite one exported row for insertion into the restored business:
 * new id, every FK that points at another backed-up row rewritten via
 * the global id map, user refs via the user map, module refs via the
 * module map, secrets stripped, globally-unique `uuid`s nulled (the
 * restored rows re-sync under fresh uuids), deferred FKs nulled and
 * reported as fixups. Pure — no DB access.
 */
export function remapRow(
  spec: BackupTableSpec,
  row: Record<string, any>,
  ctx: RemapContext
): RemappedRow {
  const out: Record<string, any> = {};
  const fixups: Record<string, string> = {};
  const defer = new Set(spec.defer || []);
  const nullify = new Set(spec.nullify || []);
  const nullifyIfUnmapped = new Set(spec.nullifyIfUnmapped || []);
  const strip = new Set(spec.strip || []);

  for (const [field, rawValue] of Object.entries(row)) {
    if (strip.has(field)) {
      out[field] = null;
      continue;
    }
    if (field === 'uuid') {
      // Globally unique; the copy must not collide with the original.
      out[field] = null;
      continue;
    }
    if (nullify.has(field)) {
      out[field] = null;
      continue;
    }
    let value = rawValue;

    if (field === 'id') {
      value = ctx.idMap.get(rawValue) ?? rawValue;
    } else if (typeof rawValue === 'string' && rawValue) {
      if (defer.has(field)) {
        const mapped = ctx.idMap.get(rawValue);
        if (mapped) fixups[field] = mapped;
        value = null;
      } else if (USER_REF_FIELDS.has(field)) {
        const mapped = ctx.userMap.get(rawValue);
        if (mapped) value = mapped;
        else value = OPTIONAL_USER_REF_FIELDS.has(field) ? null : ctx.callerId;
      } else if (field === 'moduleId') {
        const name = (row as any).__moduleName;
        const mapped = name ? ctx.moduleMap.get(name) : undefined;
        if (mapped) value = mapped;
        else if (name) return { row: out, fixups, skipReason: `module "${name}" is not in this installation's catalog` };
        // No __moduleName (older/hand-made file): keep the id as-is.
      } else if (ctx.idMap.has(rawValue)) {
        value = ctx.idMap.get(rawValue);
      } else if (nullifyIfUnmapped.has(field)) {
        value = null;
      }
    }
    out[field] = value;
  }

  // __moduleName is an export-side annotation, never a column.
  delete out.__moduleName;
  return { row: out, fixups, skipReason: null };
}

/** Validate the envelope of a parsed backup file. */
export function validateBackupEnvelope(payload: any): { ok: boolean; message?: string } {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, message: 'Backup file must be a JSON object' };
  }
  if (payload.format !== BACKUP_FORMAT) {
    return { ok: false, message: `Not a Zapeera backup file (format must be "${BACKUP_FORMAT}")` };
  }
  if (payload.version !== BACKUP_VERSION) {
    return { ok: false, message: `Unsupported backup version ${payload.version} (this version of Zapeera restores version ${BACKUP_VERSION})` };
  }
  const hasBusinesses = Array.isArray(payload.businesses) && payload.businesses.length > 0;
  const hasSingle = payload.tables && typeof payload.tables === 'object';
  if (!hasBusinesses && !hasSingle) {
    return { ok: false, message: 'Backup file contains no business data' };
  }
  return { ok: true };
}

/** Normalize both file shapes to a list of { business, tables }. */
export function normalizeBackupBusinesses(payload: any): Array<{ business: any; tables: Record<string, any[]> }> {
  if (Array.isArray(payload.businesses)) {
    return payload.businesses
      .filter((b: any) => b && typeof b === 'object')
      .map((b: any) => ({ business: b.business || {}, tables: b.tables || {} }));
  }
  return [{ business: payload.business || {}, tables: payload.tables || {} }];
}
