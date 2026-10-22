// ─── Backup & Restore service ────────────────────────────────────────
// Export: serialize one business (or every business a user owns) into
// the versioned JSON format defined in utils/backup.util.ts.
// Restore: create a NEW business "<name> (Restored)" under the caller
// and import every table with full ID remapping, in dependency order,
// inside ONE transaction per business — any table failure rolls the
// whole business back and the error names the table.
//
// Restore semantics (also stated in the UI):
//   · The restored business starts on the TRIAL plan (14 days, same as
//     a fresh signup). Subscriptions and payment proofs are NOT copied.
//   · Staff accounts are NOT recreated (passwords never travel). A
//     member whose email matches an existing Zapeera account is
//     re-linked with their role; everyone else is reported in
//     `skippedStaff` so the owner can re-invite them.
//   · Globally-unique identifiers that would collide with the original
//     business in the same database (product SKU/barcode, customer
//     phone, sale invoice number, receipt number, staff employee id)
//     get a "~R…" suffix and a warning — history is never overwritten.
//   · The FBR config is restored with its API token CLEARED (null) —
//     the owner re-enters it under Settings → FBR POS.

import { createId } from '@paralleldrive/cuid2';
import fs from 'fs';
import path from 'path';
import {
  BACKUP_SAFETY_DIR,
  isSafetySnapshotFileName,
  safetySnapshotFileName
} from '../utils/backup-safety.util';
import {
  BACKUP_FORMAT,
  BACKUP_TABLES,
  BACKUP_VERSION,
  SESSION_SETTINGS_KEY,
  BackupTableSpec,
  RemapContext,
  buildIdMap,
  normalizeBackupBusinesses,
  remapRow,
  stripSecrets,
  validateBackupEnvelope
} from '../utils/backup.util';
import { ensureStandardRoles } from './standard-roles.service';

const genId = (): string => createId();

export interface CallerInfo {
  id: string;
  email: string;
  name?: string;
}

export interface RestoreBusinessResult {
  businessId: string;
  name: string;
  counts: Record<string, number>;
  skippedStaff: Array<{ email: string; name?: string; roleName?: string }>;
  warnings: string[];
}

// ─── Export ──────────────────────────────────────────────────────────

interface ExportCtx {
  businessId: string;
  branchIds: string[];
  purchaseIds: string[];
  saleIds: string[];
  prescriptionIds: string[];
  refundIds: string[];
  stockTakeIds: string[];
  scheduledShiftIds: string[];
}

type Row = Record<string, any>;

async function exportBusinessTables(prisma: any, business: Row): Promise<Record<string, Row[]>> {
  const B = business.id;
  const branches: Row[] = await prisma.branch.findMany({ where: { companyId: B } });
  const branchIds = branches.map((b) => b.id);
  const ctx: ExportCtx = {
    businessId: B,
    branchIds,
    purchaseIds: [],
    saleIds: [],
    prescriptionIds: [],
    refundIds: [],
    stockTakeIds: [],
    scheduledShiftIds: []
  };
  const byBranch = { branchId: { in: branchIds } };
  const byCompanyOrBranch = { OR: [{ companyId: B }, { branchId: { in: branchIds } }] };

  const tables: Record<string, Row[]> = {};
  const put = (key: string, rows: Row[]) => {
    tables[key] = rows;
  };

  put('branches', branches);
  put('roles', await prisma.role.findMany({ where: { businessId: B } }));
  const roleIds = (tables.roles as Row[]).map((r) => r.id);
  put('rolePermissionsV2', roleIds.length ? await prisma.rolePermissionV2.findMany({ where: { roleId: { in: roleIds } } }) : []);

  // Members — a SAFE projection (no user rows, no password hashes):
  // email + name + role name + branch links + the staff profile.
  const memberships = await prisma.membership.findMany({
    where: { businessId: B },
    include: {
      user: { select: { email: true, name: true, username: true } },
      role: { select: { name: true } },
      branches: { select: { branchId: true } },
      staffProfile: true
    }
  });
  put(
    'members',
    memberships.map((m: any) => ({
      id: m.id,
      userId: m.userId,
      email: m.user?.email || '',
      name: m.user?.name || '',
      username: m.user?.username || '',
      roleName: m.role?.name || 'OWNER',
      status: m.status,
      invitedBy: m.invitedBy ?? null,
      branchIds: (m.branches || []).map((b: any) => b.branchId),
      staffProfile: m.staffProfile || null
    }))
  );

  put('categories', await prisma.category.findMany({ where: byCompanyOrBranch }));
  put('expenseCategories', await prisma.expenseCategory.findMany({ where: byCompanyOrBranch }));
  put('manufacturers', await prisma.manufacturer.findMany({ where: byCompanyOrBranch }));
  put('suppliers', await prisma.supplier.findMany({ where: byCompanyOrBranch }));
  put('shelves', await prisma.shelf.findMany({ where: byCompanyOrBranch }));
  put('taxClasses', await prisma.taxClass.findMany({ where: { companyId: B } }));
  put('products', await prisma.product.findMany({ where: { companyId: B } }));
  put('productVariants', await prisma.productVariant.findMany({ where: { companyId: B } }));
  put('batches', await prisma.batch.findMany({ where: { companyId: B } }));
  put('customers', await prisma.customer.findMany({ where: { companyId: B } }));
  put('promotions', await prisma.promotion.findMany({ where: { companyId: B } }));

  const purchases: Row[] = await prisma.purchase.findMany({ where: { companyId: B } });
  ctx.purchaseIds = purchases.map((p) => p.id);
  put('purchases', purchases);
  put('purchaseItems', ctx.purchaseIds.length ? await prisma.purchaseItem.findMany({ where: { purchaseId: { in: ctx.purchaseIds } } }) : []);

  const productIds = (tables.products as Row[]).map((p) => p.id);
  put('stockMovements', productIds.length ? await prisma.stockMovement.findMany({ where: { productId: { in: productIds } } }) : []);
  put('stockTransfers', await prisma.stockTransfer.findMany({ where: { companyId: B } }));
  const transferIds = (tables.stockTransfers as Row[]).map((t) => t.id);
  put('stockTransferItems', transferIds.length ? await prisma.stockTransferItem.findMany({ where: { transferId: { in: transferIds } } }) : []);

  const stockTakes: Row[] = await prisma.stockTake.findMany({ where: { companyId: B } });
  ctx.stockTakeIds = stockTakes.map((t) => t.id);
  put('stockTakes', stockTakes);
  put('stockTakeLines', ctx.stockTakeIds.length ? await prisma.stockTakeLine.findMany({ where: { stockTakeId: { in: ctx.stockTakeIds } } }) : []);

  const prescriptions: Row[] = await prisma.prescription.findMany({ where: { companyId: B } });
  ctx.prescriptionIds = prescriptions.map((p) => p.id);
  put('prescriptions', prescriptions);
  put('prescriptionItems', ctx.prescriptionIds.length ? await prisma.prescriptionItem.findMany({ where: { prescriptionId: { in: ctx.prescriptionIds } } }) : []);

  put('patients', await prisma.patient.findMany({ where: { companyId: B } }));
  put('doctors', await prisma.doctor.findMany({ where: { companyId: B } }));
  put('roomTypes', await prisma.roomType.findMany({ where: { companyId: B } }));
  put('rooms', await prisma.room.findMany({ where: { companyId: B } }));
  put('reservations', await prisma.reservation.findMany({ where: { companyId: B } }));
  put('folios', await prisma.folio.findMany({ where: { companyId: B } }));
  const folioIds = (tables.folios as Row[]).map((f) => f.id);

  const sales: Row[] = await prisma.sale.findMany({ where: { companyId: B } });
  ctx.saleIds = sales.map((s) => s.id);
  put('sales', sales);
  const inSales = { saleId: { in: ctx.saleIds } };
  put('saleItems', ctx.saleIds.length ? await prisma.saleItem.findMany({ where: inSales }) : []);
  put('salePayments', ctx.saleIds.length ? await prisma.salePayment.findMany({ where: inSales }) : []);
  put('salePromotions', ctx.saleIds.length ? await prisma.salePromotion.findMany({ where: inSales }) : []);
  put('saleTaxLines', ctx.saleIds.length ? await prisma.saleTaxLine.findMany({ where: inSales }) : []);
  put('receipts', ctx.saleIds.length ? await prisma.receipt.findMany({ where: inSales }) : []);

  const refunds: Row[] = ctx.saleIds.length
    ? await prisma.refund.findMany({ where: { originalSaleId: { in: ctx.saleIds } } })
    : [];
  ctx.refundIds = refunds.map((r) => r.id);
  put('refunds', refunds);
  put('refundItems', ctx.refundIds.length ? await prisma.refundItem.findMany({ where: { refundId: { in: ctx.refundIds } } }) : []);

  put('customerLedgerEntries', await prisma.customerLedgerEntry.findMany({ where: { companyId: B } }));
  put('loyaltyTransactions', await prisma.loyaltyTransaction.findMany({ where: { companyId: B } }));
  put('appointments', await prisma.appointment.findMany({ where: { companyId: B } }));
  put('doctorSettlements', await prisma.doctorSettlement.findMany({ where: { companyId: B } }));
  put('folioCharges', folioIds.length ? await prisma.folioCharge.findMany({ where: { folioId: { in: folioIds } } }) : []);
  put('folioPayments', folioIds.length ? await prisma.folioPayment.findMany({ where: { folioId: { in: folioIds } } }) : []);

  put('attendance', await prisma.attendance.findMany({ where: byBranch }));
  put('shifts', await prisma.shift.findMany({ where: byBranch }));
  put('commissions', await prisma.commission.findMany({ where: byBranch }));
  const scheduledShifts: Row[] = await prisma.scheduledShift.findMany({ where: byBranch });
  ctx.scheduledShiftIds = scheduledShifts.map((s) => s.id);
  put('scheduledShifts', scheduledShifts);
  put('scheduledShiftUsers', ctx.scheduledShiftIds.length ? await prisma.scheduledShiftUser.findMany({ where: { scheduledShiftId: { in: ctx.scheduledShiftIds } } }) : []);

  const fbrSpec = BACKUP_TABLES.find((t) => t.key === 'fbrConfig')!;
  const fbrConfig = await prisma.fbrConfig.findMany({ where: { companyId: B } });
  put('fbrConfig', fbrConfig.map((row: Row) => stripSecrets(fbrSpec, row)));

  // Business modules: annotate the global module NAME so the restore
  // can resolve module ids in the target installation's catalog.
  const moduleIds = await prisma.businessModule.findMany({ where: { businessId: B }, select: { moduleId: true } });
  const overrideRows: Row[] = await prisma.businessModuleOverride.findMany({ where: { businessId: B } });
  const allModuleIds = Array.from(new Set([...moduleIds.map((m: any) => m.moduleId), ...overrideRows.map((r) => r.moduleId)]));
  const modules = allModuleIds.length ? await prisma.module.findMany({ where: { id: { in: allModuleIds } }, select: { id: true, name: true } }) : [];
  const moduleNameById = new Map(modules.map((m: any) => [m.id, m.name]));
  const businessModules: Row[] = await prisma.businessModule.findMany({ where: { businessId: B } });
  put('businessModules', businessModules.map((r) => ({ ...r, __moduleName: moduleNameById.get(r.moduleId) || null })));
  put('businessModuleOverrides', overrideRows.map((r) => ({ ...r, __moduleName: moduleNameById.get(r.moduleId) || null })));

  put('billingProfiles', await prisma.billingProfile.findMany({ where: { businessId: B } }));

  // Settings are stored per business-creator user (createdBy). The
  // live-session row holds session TOKENS — never exported.
  const settingsOwner = business.createdBy || null;
  const settings = settingsOwner
    ? await prisma.settings.findMany({ where: { createdBy: settingsOwner, key: { not: SESSION_SETTINGS_KEY } } })
    : [];
  put('settings', settings);

  return tables;
}

export async function buildBusinessBackup(prisma: any, business: Row): Promise<any> {
  const tables = await exportBusinessTables(prisma, business);
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    kind: 'business',
    exportedAt: new Date().toISOString(),
    exportedFrom: { businessId: business.id, businessName: business.name },
    business,
    tables
  };
}

export async function buildAccountBackup(prisma: any, businesses: Row[]): Promise<any> {
  const entries = [];
  for (const business of businesses) {
    entries.push({ business, tables: await exportBusinessTables(prisma, business) });
  }
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    kind: 'account',
    exportedAt: new Date().toISOString(),
    businesses: entries
  };
}

/** Businesses the user OWNS (creator, or an OWNER membership). */
export async function findOwnedBusinesses(prisma: any, userId: string): Promise<Row[]> {
  const [created, ownerMemberships] = await Promise.all([
    prisma.business.findMany({ where: { createdBy: userId } }),
    prisma.membership.findMany({
      where: { userId, status: 'ACTIVE', role: { name: 'OWNER' } },
      select: { businessId: true }
    })
  ]);
  const ids = new Set<string>(created.map((b: Row) => b.id));
  for (const m of ownerMemberships) ids.add(m.businessId);
  if (ids.size === created.length) return created;
  const missing = Array.from(ids).filter((id) => !created.some((b: Row) => b.id === id));
  const extra = missing.length ? await prisma.business.findMany({ where: { id: { in: missing } } }) : [];
  return [...created, ...extra];
}

export async function assertBusinessOwner(prisma: any, userId: string, business: Row | null): Promise<boolean> {
  if (!business) return false;
  if (business.createdBy === userId) return true;
  const membership = await prisma.membership.findFirst({
    where: { userId, businessId: business.id, status: 'ACTIVE' },
    include: { role: { select: { name: true } } }
  });
  return membership?.role?.name === 'OWNER';
}

// ─── Restore ─────────────────────────────────────────────────────────

async function uniqueBusinessName(tx: any, base: string): Promise<string> {
  let candidate = base;
  let n = 2;
  while (await tx.business.findUnique({ where: { name: candidate }, select: { id: true } })) {
    candidate = `${base} ${n++}`;
  }
  return candidate;
}

async function uniqueSlug(tx: any, slug: string | null): Promise<string | null> {
  if (!slug) return null;
  let candidate = `${slug}-restored`;
  let n = 2;
  while (await tx.business.findUnique({ where: { slug: candidate }, select: { id: true } })) {
    candidate = `${slug}-restored-${n++}`;
  }
  return candidate;
}

/** Suffix globally-unique values that already exist in the target DB. */
async function resolveCollisions(
  tx: any,
  delegate: string,
  rows: Row[],
  field: string,
  warnings: string[],
  label: string
): Promise<void> {
  const values = rows.map((r) => r[field]).filter((v) => typeof v === 'string' && v);
  if (!values.length) return;
  const existing = await tx[delegate].findMany({ where: { [field]: { in: values } }, select: { [field]: true } });
  const taken = new Set(existing.map((r: Row) => r[field]));
  let count = 0;
  for (const row of rows) {
    if (row[field] && taken.has(row[field])) {
      row[field] = `${row[field]}~R${String(row.id).slice(-6)}`;
      count++;
    }
  }
  if (count) warnings.push(`${count} ${label} value(s) already exist in this database and were suffixed with "~R…" in the restored copy.`);
}

async function restoreOneBusiness(
  prisma: any,
  caller: CallerInfo,
  entry: { business: any; tables: Record<string, Row[]> }
): Promise<RestoreBusinessResult> {
  const srcBusiness = entry.business || {};
  const tables = entry.tables || {};

  return prisma.$transaction(
    async (tx: any) => {
      const warnings: string[] = [];
      const counts: Record<string, number> = {};
      const skippedStaff: RestoreBusinessResult['skippedStaff'] = [];

      // ── New business shell ──────────────────────────────────────
      const newBusinessId = genId();
      const idMap = new Map<string, string>();
      if (srcBusiness.id) idMap.set(srcBusiness.id, newBusinessId);

      // Pre-generate new ids for every backed-up row (all tables) so
      // FK remapping resolves in any direction. Membership + staff
      // profile ids are added by the members step below (they only
      // enter the map when the membership is actually recreated).
      for (const spec of BACKUP_TABLES) {
        if (!spec.delegate) continue;
        for (const row of tables[spec.key] || []) {
          if (row?.id && !idMap.has(row.id)) idMap.set(row.id, genId());
        }
      }

      const name = await uniqueBusinessName(tx, `${srcBusiness.name || 'Restored business'} (Restored)`);
      const slug = await uniqueSlug(tx, srcBusiness.slug ?? null);
      const businessData: Row = { ...srcBusiness };
      delete businessData.id;
      businessData.id = newBusinessId;
      businessData.name = name;
      businessData.slug = slug;
      businessData.createdBy = caller.id;
      businessData.uuid = null;
      await tx.business.create({ data: businessData });

      // Module catalog (name → id) for businessModules resolution.
      const moduleRows = await tx.module.findMany({ select: { id: true, name: true } });
      const moduleMap = new Map<string, string>(moduleRows.map((m: Row) => [m.name, m.id]));

      // User map: old user id → account id in this installation.
      const userMap = new Map<string, string>();
      const ctx: RemapContext = { idMap, userMap, callerId: caller.id, moduleMap };

      const recreatedMembershipOldIds = new Set<string>();
      const roleNameToNewId = new Map<string, string>();

      // ── Members step (needs branches + roles id maps; the actual
      // membership rows are created after roles are imported — this
      // step runs in table order below via the 'members' key).
      const restoreMembers = async (): Promise<void> => {
        const members = tables.members || [];
        // Role name → new role id (from the imported roles) with a
        // fallback to roles seeded by ensureStandardRoles.
        for (const roleRow of tables.roles || []) {
          if (roleRow?.name && roleRow?.id && idMap.has(roleRow.id)) {
            roleNameToNewId.set(roleRow.name, idMap.get(roleRow.id)!);
          }
        }
        const seededRoles = await tx.role.findMany({ where: { businessId: newBusinessId }, select: { id: true, name: true } });
        for (const r of seededRoles) if (!roleNameToNewId.has(r.name)) roleNameToNewId.set(r.name, r.id);

        let ownerMembershipCreated = false;
        for (const member of members) {
          const email = String(member.email || '').trim().toLowerCase();
          let resolvedUserId: string | null = null;
          if (email && email === caller.email.toLowerCase()) resolvedUserId = caller.id;
          else if (email) {
            const existing = await tx.zapeeraUser.findUnique({ where: { email }, select: { id: true } });
            if (existing) resolvedUserId = existing.id;
          }
          if (member.userId && resolvedUserId) userMap.set(member.userId, resolvedUserId);

          if (!resolvedUserId) {
            skippedStaff.push({ email: member.email || '', name: member.name, roleName: member.roleName });
            continue;
          }

          const newMembershipId = genId();
          if (member.id) idMap.set(member.id, newMembershipId);
          recreatedMembershipOldIds.add(member.id);
          const roleId = roleNameToNewId.get(member.roleName || 'OWNER') ?? null;
          await tx.membership.create({
            data: {
              id: newMembershipId,
              userId: resolvedUserId,
              businessId: newBusinessId,
              roleId,
              status: member.status || 'ACTIVE',
              invitedBy: null,
              uuid: null
            }
          });
          if (resolvedUserId === caller.id && (member.roleName || 'OWNER') === 'OWNER') ownerMembershipCreated = true;
          counts.members = (counts.members || 0) + 1;

          for (const oldBranchId of member.branchIds || []) {
            const newBranchId = idMap.get(oldBranchId);
            if (newBranchId) {
              await tx.membershipBranch.create({
                data: { id: genId(), membershipId: newMembershipId, branchId: newBranchId }
              });
            }
          }

          const profile = member.staffProfile;
          if (profile) {
            const newProfileId = genId();
            idMap.set(profile.id, newProfileId);
            const profileData: Row = { ...profile, id: newProfileId, membershipId: newMembershipId };
            if (profileData.reportingManagerId) {
              profileData.reportingManagerId = idMap.get(profileData.reportingManagerId) ?? null;
            }
            // employeeId is globally unique — suffix on collision.
            if (profileData.employeeId) {
              const clash = await tx.staffProfile.findUnique({ where: { employeeId: profileData.employeeId }, select: { id: true } });
              if (clash) {
                profileData.employeeId = `${profileData.employeeId}~R${newProfileId.slice(-6)}`;
                warnings.push(`Staff employee id "${profile.employeeId}" already exists and was suffixed in the restored copy.`);
              }
            }
            await tx.staffProfile.create({ data: profileData });
            counts.staffProfiles = (counts.staffProfiles || 0) + 1;
          }
        }

        // Restoring someone else's backup (or a member list without
        // the caller): the caller still becomes the owner.
        if (!ownerMembershipCreated) {
          const ownerRoleId = roleNameToNewId.get('OWNER') ?? null;
          await tx.membership.create({
            data: { id: genId(), userId: caller.id, businessId: newBusinessId, roleId: ownerRoleId, status: 'ACTIVE', uuid: null }
          });
          counts.members = (counts.members || 0) + 1;
        }
      };

      // Rows that belong to staff whose accounts were not recreated
      // cannot be imported (their membership FK would dangle).
      const MEMBERSHIP_FILTERED = new Set(['attendance', 'shifts', 'commissions']);
      const pendingFixups: Array<{ spec: BackupTableSpec; id: string; fixups: Record<string, string> }> = [];

      for (const spec of BACKUP_TABLES) {
        if (spec.key === 'members') {
          // Standard roles first (idempotent) so role resolution also
          // works for backups missing custom roles.
          await ensureStandardRoles(tx, newBusinessId);
          await restoreMembers();
          continue;
        }
        if (spec.key === 'settings') continue; // handled after the loop
        if (!spec.delegate) continue;

        let rows = tables[spec.key] || [];
        if (MEMBERSHIP_FILTERED.has(spec.key)) {
          const before = rows.length;
          rows = rows.filter((r) => r.membershipId && recreatedMembershipOldIds.has(r.membershipId));
          if (rows.length < before) {
            warnings.push(`${before - rows.length} ${spec.key} row(s) belonged to staff accounts that were not recreated and were skipped.`);
          }
        }
        if (spec.key === 'scheduledShiftUsers') {
          const before = rows.length;
          rows = rows.filter((r) => r.userId && userMap.has(r.userId));
          if (rows.length < before) {
            warnings.push(`${before - rows.length} scheduled-shift assignment(s) belonged to staff accounts that were not recreated and were skipped.`);
          }
        }
        if (!rows.length) {
          counts[spec.key] = 0;
          continue;
        }

        const prepared: Row[] = [];
        for (const row of rows) {
          const { row: out, fixups, skipReason } = remapRow(spec, row, ctx);
          if (skipReason) {
            warnings.push(`${spec.key}: skipped a row — ${skipReason}.`);
            continue;
          }
          prepared.push(out);
          if (Object.keys(fixups).length) pendingFixups.push({ spec, id: out.id, fixups });
        }

        // Globally-unique identifier collisions (same-database copy).
        if (spec.key === 'products') {
          await resolveCollisions(tx, 'product', prepared, 'sku', warnings, 'product SKU');
          await resolveCollisions(tx, 'product', prepared, 'barcode', warnings, 'product barcode');
        }
        if (spec.key === 'customers') {
          await resolveCollisions(tx, 'customer', prepared, 'phone', warnings, 'customer phone');
        }
        if (spec.key === 'sales') {
          await resolveCollisions(tx, 'sale', prepared, 'invoiceNumber', warnings, 'sale invoice number');
        }
        if (spec.key === 'receipts') {
          await resolveCollisions(tx, 'receipt', prepared, 'receiptNumber', warnings, 'receipt number');
        }

        try {
          if (prepared.length) await tx[spec.delegate].createMany({ data: prepared });
        } catch (error: any) {
          throw new Error(`Restore failed at table "${spec.key}": ${error?.message || error}`);
        }
        counts[spec.key] = prepared.length;
      }

      // Deferred FK fix-ups (reservation.folioId, folio.saleId).
      for (const pending of pendingFixups) {
        try {
          await tx[pending.spec.delegate!].update({ where: { id: pending.id }, data: pending.fixups });
        } catch (error: any) {
          throw new Error(`Restore failed at table "${pending.spec.key}" (link repair): ${error?.message || error}`);
        }
      }

      // Settings: the creator's key/value rows, re-homed to the
      // caller. Keys the caller already has are kept (never overwrite
      // the caller's live settings) and reported.
      const settingsRows = tables.settings || [];
      let settingsImported = 0;
      let settingsSkipped = 0;
      for (const row of settingsRows) {
        if (!row?.key || row.key === SESSION_SETTINGS_KEY) continue;
        const existing = await tx.settings.findUnique({
          where: { createdBy_key: { createdBy: caller.id, key: row.key } },
          select: { id: true }
        });
        if (existing) {
          settingsSkipped++;
          continue;
        }
        await tx.settings.create({
          data: { id: genId(), createdBy: caller.id, key: row.key, value: row.value, description: row.description ?? null }
        });
        settingsImported++;
      }
      counts.settings = settingsImported;
      if (settingsSkipped) {
        warnings.push(`${settingsSkipped} setting(s) already exist on your account and were not overwritten.`);
      }

      // Trial subscription — subscriptions are never copied from a
      // backup (mirrors the fresh-signup trial in company.controller).
      const trialPlanId = process.env.DEFAULT_TRIAL_PLAN_ID || 'single-trial';
      const isLocalDev = process.env.NODE_ENV === 'development' && process.env.SHORT_TRIAL_DURATIONS === 'true';
      const trialMs = isLocalDev ? 5 * 60 * 1000 : 14 * 24 * 60 * 60 * 1000;
      const trialEndsAt = new Date(Date.now() + trialMs);
      await tx.businessSubscription.create({
        data: { businessId: newBusinessId, planId: trialPlanId, status: 'TRIAL', trialEndsAt, currentPeriodEnd: trialEndsAt }
      });
      warnings.push('The restored business starts on the free TRIAL plan (14 days). Subscriptions and payment history were not copied from the backup.');

      if (!tables.businessModules?.length) {
        warnings.push('This backup carried no module configuration; default modules will be enabled for the restored business.');
      }

      return { businessId: newBusinessId, name, counts, skippedStaff, warnings };
    },
    { timeout: 180_000, maxWait: 30_000 }
  );
}

export interface RestoreFileResult {
  restored: RestoreBusinessResult[];
}

export async function restoreBackupFile(prisma: any, caller: CallerInfo, payload: any): Promise<RestoreFileResult> {
  const validation = validateBackupEnvelope(payload);
  if (!validation.ok) {
    const error: any = new Error(validation.message);
    error.code = 'BACKUP_FORMAT_INVALID';
    throw error;
  }
  const entries = normalizeBackupBusinesses(payload);
  const restored: RestoreBusinessResult[] = [];
  for (const entry of entries) {
    restored.push(await restoreOneBusiness(prisma, caller, entry));
  }
  return { restored };
}

// ─── Restore UPDATE mode ─────────────────────────────────────────────
// Muhammad's requirement: a restore must be able to UPDATE THE DATA
// WITHIN A SELECTED BUSINESS (or, for an account file, within the
// caller's account via a per-business mapping) — not only create a new
// business. Update semantics (the core rule):
//   · rows in the backup that match rows in the target are UPDATED to
//     the backup's values;
//   · rows in the backup but missing from the target are RE-CREATED;
//   · rows in the target that are not in the backup are KEPT — an
//     update deletes nothing, ever.
// Matching: when the target IS the business the backup came from, rows
// match by id (identity map, written back with upsert-by-id). For a
// different target, ids are remapped through the full FK graph exactly
// like restore-as-new (plus natural-key merges for roles and module
// rows), still deleting nothing.
//
// Before any update is applied, a SAFETY BACKUP of the target's
// current state is exported and stored server-side
// (BackupSafetySnapshot row + file under uploads/backup-safety/), so
// the pre-update state stays downloadable — and itself restorable.
//
// Secrets guard: backups never carry secrets (FbrConfig.apiToken is
// null in every file). An update therefore NEVER writes a secret
// field from the file: the live FBR token is read before the write
// and re-applied after it. Audit of the covered tables: user rows
// (password / sessionToken / passwordResetToken) are never exported
// at all — members travel as email projections; BusinessInvitation
// (token) is not a covered table; BillingProfile.paymentMethodId is
// nullified at import (card_details is never exported). FbrConfig
// .apiToken is the ONLY secret-bearing field inside a covered table.
//
// Settings rows follow the restore-as-new rule in BOTH modes: keys the
// target's owner already has are never overwritten (live settings win)
// — they are counted as kept, not updated.

export interface UpdateBusinessResult {
  sourceBusinessId: string;
  businessId: string; // target business id
  name: string; // target business name
  sameBusiness: boolean;
  updated: Record<string, number>;
  added: Record<string, number>;
  kept: Record<string, number>;
  updatedTotal: number;
  addedTotal: number;
  keptTotal: number;
  safetySnapshotId: string;
  skippedStaff: Array<{ email: string; name?: string; roleName?: string }>;
  warnings: string[];
}

export interface UpdateBusinessPreview {
  sourceBusinessId: string;
  sourceBusinessName: string;
  targetBusinessId: string;
  targetBusinessName: string;
  sameBusiness: boolean;
  perTable: Record<string, { update: number; add: number; kept: number }>;
  toUpdate: number;
  toAdd: number;
  keptTargetOnly: number;
  skippedMembers: number;
}

function codedError(code: string, message: string, status: number): Error {
  const error: any = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

/** Resolve the confirmed (or default) target for every source business. */
async function resolveUpdateTargets(
  prisma: any,
  caller: CallerInfo,
  entries: Array<{ business: any; tables: Record<string, Row[]> }>,
  targets: Record<string, string>
): Promise<Map<string, Row>> {
  const owned = await findOwnedBusinesses(prisma, caller.id);
  const ownedById = new Map<string, Row>(owned.map((b: Row) => [b.id, b]));
  const resolved = new Map<string, Row>();
  const usedTargets = new Map<string, string>(); // targetId -> sourceId

  for (const entry of entries) {
    const src = entry.business || {};
    if (!src.id) {
      throw codedError('BACKUP_UPDATE_MAPPING_INVALID', 'A business in this backup file has no id and cannot be mapped to a target.', 400);
    }
    let target: Row | undefined;
    const explicit = targets?.[src.id];
    if (explicit) {
      target = ownedById.get(explicit);
      if (!target) {
        throw codedError(
          'BACKUP_TARGET_NOT_OWNED',
          `Target business for "${src.name || src.id}" is not a business you own.`,
          403
        );
      }
    } else if (ownedById.has(src.id)) {
      target = ownedById.get(src.id);
    } else {
      target =
        owned.find((b: Row) => src.slug && b.slug === src.slug) ||
        owned.find((b: Row) => src.name && b.name === src.name);
      if (!target) {
        throw codedError(
          'BACKUP_TARGET_REQUIRED',
          `Choose a target business for "${src.name || src.id}" — it does not match any business you own.`,
          400
        );
      }
    }
    if (!target) {
      throw codedError('BACKUP_TARGET_REQUIRED', `Choose a target business for "${src.name || src.id}".`, 400);
    }
    if (usedTargets.has(target.id)) {
      throw codedError(
        'BACKUP_UPDATE_MAPPING_INVALID',
        `Two businesses in this file map to the same target ("${target.name}"). Map each one to a different business.`,
        400
      );
    }
    usedTargets.set(target.id, src.id);
    resolved.set(src.id, target);
  }
  return resolved;
}

// ─── Safety snapshots ────────────────────────────────────────────────

async function storeSafetySnapshot(
  prisma: any,
  caller: CallerInfo,
  business: Row,
  payload: any,
  sourceKind: string | null
): Promise<Row> {
  const snapshotId = genId();
  const fileName = safetySnapshotFileName(snapshotId);
  const body = JSON.stringify(payload, null, 2);
  await fs.promises.mkdir(BACKUP_SAFETY_DIR, { recursive: true });
  const filePath = path.join(BACKUP_SAFETY_DIR, fileName);
  await fs.promises.writeFile(filePath, body, 'utf8');
  try {
    return await prisma.backupSafetySnapshot.create({
      data: {
        id: snapshotId,
        businessId: business.id,
        businessName: business.name,
        ownerId: caller.id,
        fileName,
        sizeBytes: Buffer.byteLength(body),
        reason: 'PRE_UPDATE',
        sourceKind: sourceKind || null
      }
    });
  } catch (error) {
    await fs.promises.unlink(filePath).catch(() => undefined);
    throw error;
  }
}

export async function listSafetySnapshots(
  prisma: any,
  caller: CallerInfo,
  businessId?: string
): Promise<Row[]> {
  const owned = await findOwnedBusinesses(prisma, caller.id);
  const ownedIds = new Set(owned.map((b: Row) => b.id));
  if (businessId && !ownedIds.has(businessId)) {
    throw codedError('BACKUP_TARGET_NOT_OWNED', 'That business is not a business you own.', 403);
  }
  const rows = await prisma.backupSafetySnapshot.findMany({
    where: businessId ? { businessId } : { OR: [{ ownerId: caller.id }, { businessId: { in: Array.from(ownedIds) } }] },
    orderBy: { createdAt: 'desc' },
    take: 100
  });
  return rows.filter((r: Row) => ownedIds.has(r.businessId));
}

export async function getSafetySnapshotForDownload(
  prisma: any,
  caller: CallerInfo,
  snapshotId: string
): Promise<{ snapshot: Row; filePath: string; downloadName: string }> {
  const snapshot = await prisma.backupSafetySnapshot.findUnique({ where: { id: snapshotId } });
  if (!snapshot) {
    throw codedError('SAFETY_BACKUP_NOT_FOUND', 'That safety backup no longer exists.', 404);
  }
  const business = await prisma.business.findUnique({ where: { id: snapshot.businessId } });
  if (!(await assertBusinessOwner(prisma, caller.id, business))) {
    throw codedError('BACKUP_OWNER_ONLY', 'Only the business owner can download safety backups', 403);
  }
  if (!isSafetySnapshotFileName(snapshot.fileName)) {
    throw codedError('SAFETY_BACKUP_NOT_FOUND', 'That safety backup file is missing.', 404);
  }
  const filePath = path.join(BACKUP_SAFETY_DIR, snapshot.fileName);
  if (!fs.existsSync(filePath)) {
    throw codedError('SAFETY_BACKUP_NOT_FOUND', 'That safety backup file is missing.', 404);
  }
  const slug = (snapshot.businessName || 'business').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const stamp = new Date(snapshot.createdAt).toISOString().slice(0, 10);
  return { snapshot, filePath, downloadName: `zapeera-safety-backup-${slug}-${stamp}.json` };
}

// ─── Dry-run diff (preview) ──────────────────────────────────────────

interface TableDiff {
  update: number;
  add: number;
  kept: number;
}

async function computeUpdateDiff(
  prisma: any,
  entry: { business: any; tables: Record<string, Row[]> },
  targetTables: Record<string, Row[]>,
  sameBusiness: boolean
): Promise<{ perTable: Record<string, TableDiff>; skippedMembers: number }> {
  const perTable: Record<string, TableDiff> = {};
  let skippedMembers = 0;
  const tables = entry.tables || {};
  const idSet = (rows: Row[] | undefined) => new Set((rows || []).map((r) => r?.id).filter(Boolean));

  // Members need email resolution in cross mode (pure on the two
  // exports, plus one read-only user-existence lookup).
  let memberDiff: TableDiff = { update: 0, add: 0, kept: 0 };
  const backupMembers = tables.members || [];
  const targetMembers = targetTables.members || [];
  if (sameBusiness) {
    const b = idSet(backupMembers);
    const t = idSet(targetMembers);
    memberDiff = {
      update: Array.from(b).filter((id) => t.has(id)).length,
      add: Array.from(b).filter((id) => !t.has(id)).length,
      kept: Array.from(t).filter((id) => !b.has(id)).length
    };
  } else {
    const targetEmails = new Set(targetMembers.map((m: Row) => String(m.email || '').trim().toLowerCase()).filter(Boolean));
    const backupEmails = backupMembers.map((m: Row) => String(m.email || '').trim().toLowerCase()).filter(Boolean);
    const existingUsers = backupEmails.length
      ? await prisma.zapeeraUser.findMany({ where: { email: { in: backupEmails } }, select: { email: true } })
      : [];
    const userEmails = new Set(existingUsers.map((u: Row) => String(u.email || '').trim().toLowerCase()));
    for (const email of backupEmails) {
      if (targetEmails.has(email)) memberDiff.update++;
      else if (userEmails.has(email)) memberDiff.add++;
      else skippedMembers++;
    }
    memberDiff.kept = Array.from(targetEmails).filter((e: string) => !backupEmails.includes(e)).length;
  }

  for (const spec of BACKUP_TABLES) {
    if (spec.key === 'members') {
      perTable.members = memberDiff;
      continue;
    }
    const bRows = tables[spec.key] || [];
    const tRows = targetTables[spec.key] || [];
    if (spec.key === 'settings') {
      // Settings are never overwritten in either restore mode.
      const bKeys = new Set(bRows.map((r: Row) => r?.key).filter(Boolean));
      const tKeys = new Set(tRows.map((r: Row) => r?.key).filter(Boolean));
      perTable.settings = {
        update: 0,
        add: Array.from(bKeys).filter((k) => !tKeys.has(k)).length,
        kept: tRows.length
      };
      continue;
    }
    if (sameBusiness) {
      const b = idSet(bRows);
      const t = idSet(tRows);
      perTable[spec.key] = {
        update: Array.from(b).filter((id) => t.has(id)).length,
        add: Array.from(b).filter((id) => !t.has(id)).length,
        kept: Array.from(t).filter((id) => !b.has(id)).length
      };
    } else if (spec.key === 'roles') {
      const tNames = new Set(tRows.map((r: Row) => r?.name).filter(Boolean));
      const matched = bRows.filter((r: Row) => r?.name && tNames.has(r.name)).length;
      perTable.roles = { update: matched, add: bRows.length - matched, kept: tRows.length - matched };
    } else if (spec.key === 'businessModules' || spec.key === 'businessModuleOverrides') {
      const keyOf = (r: Row) => r?.__moduleName || r?.moduleId;
      const tKeys = new Set(tRows.map(keyOf).filter(Boolean));
      const matched = bRows.filter((r: Row) => keyOf(r) && tKeys.has(keyOf(r))).length;
      perTable[spec.key] = { update: matched, add: bRows.length - matched, kept: tRows.length - matched };
    } else {
      perTable[spec.key] = { update: 0, add: bRows.length, kept: tRows.length };
    }
  }
  return { perTable, skippedMembers };
}

export async function previewRestoreUpdate(
  prisma: any,
  caller: CallerInfo,
  payload: any,
  targets: Record<string, string>
): Promise<{ previews: UpdateBusinessPreview[] }> {
  const validation = validateBackupEnvelope(payload);
  if (!validation.ok) {
    throw codedError('BACKUP_FORMAT_INVALID', validation.message || 'Invalid backup file', 400);
  }
  const entries = normalizeBackupBusinesses(payload);
  const targetMap = await resolveUpdateTargets(prisma, caller, entries, targets || {});
  const previews: UpdateBusinessPreview[] = [];
  for (const entry of entries) {
    const target = targetMap.get(entry.business?.id)!;
    const targetPayload = await buildBusinessBackup(prisma, target);
    const sameBusiness = entry.business?.id === target.id;
    const { perTable, skippedMembers } = await computeUpdateDiff(prisma, entry, targetPayload.tables, sameBusiness);
    const totals = Object.values(perTable).reduce(
      (acc, d) => ({ update: acc.update + d.update, add: acc.add + d.add, kept: acc.kept + d.kept }),
      { update: 0, add: 0, kept: 0 }
    );
    previews.push({
      sourceBusinessId: entry.business?.id,
      sourceBusinessName: entry.business?.name || '',
      targetBusinessId: target.id,
      targetBusinessName: target.name,
      sameBusiness,
      perTable,
      toUpdate: totals.update,
      toAdd: totals.add,
      keptTargetOnly: totals.kept,
      skippedMembers
    });
  }
  return { previews };
}

// ─── Apply an update to one business ─────────────────────────────────

const MEMBERSHIP_FILTERED_TABLES = new Set(['attendance', 'shifts', 'commissions']);

/** Globally-unique identifier fields retried with a "~R…" suffix when a
 *  same-business re-create collides with a DIFFERENT live row. */
const UNIQUE_IDENTIFIER_FIELDS: Record<string, string[]> = {
  products: ['sku', 'barcode'],
  customers: ['phone'],
  sales: ['invoiceNumber'],
  receipts: ['receiptNumber']
};

async function applyBusinessUpdate(
  tx: any,
  caller: CallerInfo,
  entry: { business: any; tables: Record<string, Row[]> },
  target: Row,
  targetTables: Record<string, Row[]>
): Promise<Omit<UpdateBusinessResult, 'safetySnapshotId'>> {
  const tables = entry.tables || {};
  const srcBusiness = entry.business || {};
  const targetId = target.id;
  const sameBusiness = srcBusiness.id === targetId;
  const warnings: string[] = [];
  const skippedStaff: UpdateBusinessResult['skippedStaff'] = [];
  const updated: Record<string, number> = {};
  const added: Record<string, number> = {};
  const bump = (bag: Record<string, number>, key: string, n = 1) => {
    bag[key] = (bag[key] || 0) + n;
  };

  const { perTable } = await computeUpdateDiff(tx, entry, targetTables, sameBusiness);
  const kept: Record<string, number> = {};
  for (const [key, d] of Object.entries(perTable)) kept[key] = d.kept;

  // ── Business profile: non-identity fields only. Name, slug, type,
  // creator, partner link and activation state are NEVER changed by an
  // update (identity stays with the live business).
  const PROFILE_FIELDS = ['description', 'address', 'phone', 'email', 'website'];
  const profileData: Row = {};
  for (const field of PROFILE_FIELDS) {
    if (srcBusiness[field] !== undefined) profileData[field] = srcBusiness[field];
  }
  if (Object.keys(profileData).length) {
    await tx.business.update({ where: { id: targetId }, data: profileData });
  }

  // ── ID map: identity for the same business; fresh ids cross-business.
  const idMap = new Map<string, string>();
  if (srcBusiness.id) idMap.set(srcBusiness.id, targetId);
  for (const spec of BACKUP_TABLES) {
    if (!spec.delegate) continue;
    for (const row of tables[spec.key] || []) {
      if (row?.id && !idMap.has(row.id)) idMap.set(row.id, sameBusiness ? row.id : genId());
    }
  }
  const userMap = new Map<string, string>();
  const moduleRows = await tx.module.findMany({ select: { id: true, name: true } });
  const moduleMap = new Map<string, string>(moduleRows.map((m: Row) => [m.name, m.id]));
  const ctx: RemapContext = { idMap, userMap, callerId: caller.id, moduleMap };

  const consumed = new Map<string, Set<string>>();
  const markConsumed = (key: string, oldId: string) => {
    if (!consumed.has(key)) consumed.set(key, new Set());
    consumed.get(key)!.add(oldId);
  };
  const isConsumed = (key: string, oldId: string) => consumed.get(key)?.has(oldId) ?? false;

  // ── Cross-business natural-key pre-merges: roles by name, module
  // rows by resolved module — matched rows are UPDATED in place and
  // their ids registered so children resolve to the live rows.
  if (!sameBusiness) {
    const roleSpec = BACKUP_TABLES.find((t) => t.key === 'roles')!;
    const targetRoles = await tx.role.findMany({ where: { businessId: targetId } });
    const roleByName = new Map<string, Row>(targetRoles.map((r: Row) => [r.name, r]));
    for (const roleRow of tables.roles || []) {
      const existing = roleRow?.name ? roleByName.get(roleRow.name) : null;
      if (existing && roleRow.id) {
        idMap.set(roleRow.id, existing.id);
        const { row: out } = remapRow(roleSpec, roleRow, ctx);
        const { id: _id, ...data } = out;
        await tx.role.update({ where: { id: existing.id }, data });
        bump(updated, 'roles');
        markConsumed('roles', roleRow.id);
      }
    }
    for (const key of ['businessModules', 'businessModuleOverrides']) {
      const spec = BACKUP_TABLES.find((t) => t.key === key)!;
      const delegate = spec.delegate!;
      const existingRows = await tx[delegate].findMany({ where: { businessId: targetId } });
      const byModule = new Map<string, Row>(existingRows.map((r: Row) => [r.moduleId, r]));
      for (const row of tables[key] || []) {
        const moduleId = row.__moduleName ? moduleMap.get(row.__moduleName) : row.moduleId;
        const hit = moduleId ? byModule.get(moduleId) : null;
        if (hit && row.id) {
          idMap.set(row.id, hit.id);
          const { row: out } = remapRow(spec, row, ctx);
          const { id: _id, ...data } = out;
          await tx[delegate].update({ where: { id: hit.id }, data });
          bump(updated, key);
          markConsumed(key, row.id);
        }
      }
    }
  }

  // ── Members: match by account email (same rule as restore-as-new).
  // Existing memberships are updated, missing ones re-created, and the
  // target's other memberships are never removed.
  const usableMembershipOldIds = new Set<string>();
  const applyMembers = async (): Promise<void> => {
    const targetRoles = await tx.role.findMany({
      where: { businessId: targetId },
      select: { id: true, name: true }
    });
    const roleIdByName = new Map<string, string>(targetRoles.map((r: Row) => [r.name, r.id]));

    for (const member of tables.members || []) {
      const email = String(member.email || '').trim().toLowerCase();
      let resolvedUserId: string | null = null;
      if (email && email === caller.email.toLowerCase()) resolvedUserId = caller.id;
      else if (email) {
        const existing = await tx.zapeeraUser.findUnique({ where: { email }, select: { id: true } });
        if (existing) resolvedUserId = existing.id;
      }
      if (member.userId && resolvedUserId) userMap.set(member.userId, resolvedUserId);
      if (!resolvedUserId) {
        skippedStaff.push({ email: member.email || '', name: member.name, roleName: member.roleName });
        continue;
      }

      const roleId = roleIdByName.get(member.roleName || 'OWNER') ?? null;
      const existingMembership = await tx.membership.findUnique({
        where: { unique_user_business: { userId: resolvedUserId, businessId: targetId } }
      });
      let targetMembershipId: string;
      if (existingMembership) {
        targetMembershipId = existingMembership.id;
        await tx.membership.update({
          where: { id: existingMembership.id },
          data: {
            roleId: roleId ?? existingMembership.roleId,
            status: member.status || existingMembership.status
          }
        });
        bump(updated, 'members');
      } else {
        targetMembershipId = sameBusiness && member.id ? member.id : genId();
        const membershipData = {
          userId: resolvedUserId,
          businessId: targetId,
          roleId,
          status: member.status || 'ACTIVE',
          invitedBy: null,
          uuid: null
        };
        try {
          await tx.membership.create({ data: { id: targetMembershipId, ...membershipData } });
        } catch (error: any) {
          if (error?.code !== 'P2002') throw error;
          // The backup's membership id is held by another record in
          // this database (e.g. ownership moved) — fall back to a
          // fresh id; children resolve through the id map either way.
          targetMembershipId = genId();
          await tx.membership.create({ data: { id: targetMembershipId, ...membershipData } });
        }
        bump(added, 'members');
      }
      if (member.id) {
        idMap.set(member.id, targetMembershipId);
        usableMembershipOldIds.add(member.id);
      }

      for (const oldBranchId of member.branchIds || []) {
        const branchId = idMap.get(oldBranchId);
        if (!branchId) continue;
        const link = await tx.membershipBranch.findUnique({
          where: { unique_membership_branch: { membershipId: targetMembershipId, branchId } },
          select: { id: true }
        });
        if (!link) {
          await tx.membershipBranch.create({ data: { id: genId(), membershipId: targetMembershipId, branchId } });
        }
      }

      const profile = member.staffProfile;
      if (profile) {
        const existingProfile = await tx.staffProfile.findUnique({ where: { membershipId: targetMembershipId } });
        const profileData: Row = { ...profile };
        delete profileData.id;
        delete profileData.membershipId;
        if (profileData.reportingManagerId) {
          profileData.reportingManagerId = idMap.get(profileData.reportingManagerId) ?? null;
        }
        if (profileData.employeeId) {
          const clash = await tx.staffProfile.findUnique({
            where: { employeeId: profileData.employeeId },
            select: { id: true, membershipId: true }
          });
          if (clash && clash.membershipId !== targetMembershipId) {
            profileData.employeeId = `${profileData.employeeId}~R${String(profile.id).slice(-6)}`;
            warnings.push(`Staff employee id "${profile.employeeId}" already exists and was suffixed in the update.`);
          }
        }
        if (existingProfile) {
          idMap.set(profile.id, existingProfile.id);
          await tx.staffProfile.update({ where: { id: existingProfile.id }, data: profileData });
          bump(updated, 'staffProfiles');
        } else {
          let newProfileId = sameBusiness && profile.id ? profile.id : genId();
          try {
            await tx.staffProfile.create({ data: { ...profileData, id: newProfileId, membershipId: targetMembershipId } });
          } catch (error: any) {
            if (error?.code !== 'P2002') throw error;
            newProfileId = genId();
            await tx.staffProfile.create({ data: { ...profileData, id: newProfileId, membershipId: targetMembershipId } });
          }
          idMap.set(profile.id, newProfileId);
          bump(added, 'staffProfiles');
        }
      }
    }
  };

  const pendingFixups: Array<{ spec: BackupTableSpec; id: string; fixups: Record<string, string> }> = [];

  for (const spec of BACKUP_TABLES) {
    if (spec.key === 'members') {
      await applyMembers();
      continue;
    }
    if (spec.key === 'settings') continue; // handled after the loop
    if (!spec.delegate) continue;

    let rows = tables[spec.key] || [];
    if (MEMBERSHIP_FILTERED_TABLES.has(spec.key)) {
      const before = rows.length;
      rows = rows.filter((r) => r.membershipId && usableMembershipOldIds.has(r.membershipId));
      if (rows.length < before) {
        warnings.push(`${before - rows.length} ${spec.key} row(s) belonged to staff accounts that were not re-linked and were skipped.`);
      }
    }
    if (spec.key === 'scheduledShiftUsers') {
      const before = rows.length;
      rows = rows.filter((r) => r.userId && userMap.has(r.userId));
      if (rows.length < before) {
        warnings.push(`${before - rows.length} scheduled-shift assignment(s) belonged to staff accounts that were not re-linked and were skipped.`);
      }
    }
    rows = rows.filter((r) => !(r?.id && isConsumed(spec.key, r.id)));
    if (!rows.length) continue;

    // Secrets guard: read the LIVE FBR token before touching the
    // config row — the file's copy is null by design and must never
    // overwrite it.
    let liveFbrToken: string | null = null;
    if (spec.key === 'fbrConfig') {
      const live = await tx.fbrConfig.findUnique({ where: { companyId: targetId }, select: { apiToken: true } });
      liveFbrToken = live?.apiToken ?? null;
    }

    // Prepare (remap) every row first so collision handling sees the
    // final values, exactly like restore-as-new.
    const prepared: Array<{ sourceId: string; out: Row; fixups: Record<string, string> }> = [];
    for (const row of rows) {
      const { row: out, fixups, skipReason } = remapRow(spec, row, ctx);
      if (skipReason) {
        warnings.push(`${spec.key}: skipped a row — ${skipReason}.`);
        continue;
      }
      if (spec.key === 'fbrConfig' && liveFbrToken) out.apiToken = liveFbrToken;
      prepared.push({ sourceId: row.id, out, fixups });
    }

    if (!sameBusiness) {
      const outRows = prepared.map((p) => p.out);
      if (spec.key === 'products') {
        await resolveCollisions(tx, 'product', outRows, 'sku', warnings, 'product SKU');
        await resolveCollisions(tx, 'product', outRows, 'barcode', warnings, 'product barcode');
      }
      if (spec.key === 'customers') await resolveCollisions(tx, 'customer', outRows, 'phone', warnings, 'customer phone');
      if (spec.key === 'sales') await resolveCollisions(tx, 'sale', outRows, 'invoiceNumber', warnings, 'sale invoice number');
      if (spec.key === 'receipts') await resolveCollisions(tx, 'receipt', outRows, 'receiptNumber', warnings, 'receipt number');
    }

    // Same-business existence check (one query per table).
    let existingIds = new Set<string>();
    if (sameBusiness) {
      const ids = prepared.map((p) => p.sourceId).filter(Boolean);
      if (ids.length) {
        const found = await tx[spec.delegate].findMany({ where: { id: { in: ids } }, select: { id: true } });
        existingIds = new Set(found.map((r: Row) => r.id));
      }
    }

    for (const { sourceId, out, fixups } of prepared) {
      const isUpdate = sameBusiness && existingIds.has(sourceId);
      let written = false;
      try {
        if (isUpdate) {
          const { id: _id, ...data } = out;
          await tx[spec.delegate].update({ where: { id: sourceId }, data });
          bump(updated, spec.key);
        } else {
          await tx[spec.delegate].create({ data: out });
          bump(added, spec.key);
        }
        written = true;
      } catch (error: any) {
        if (error?.code !== 'P2002') {
          throw new Error(`Restore update failed at table "${spec.key}": ${error?.message || error}`);
        }
        // Unique-value collision with a DIFFERENT live row.
        const retryFields = UNIQUE_IDENTIFIER_FIELDS[spec.key] || [];
        let recovered = false;
        if (!isUpdate && retryFields.length) {
          const retry = { ...out };
          let touched = false;
          for (const field of retryFields) {
            if (typeof retry[field] === 'string' && retry[field]) {
              retry[field] = `${retry[field]}~R${String(sourceId).slice(-6)}`;
              touched = true;
            }
          }
          if (touched) {
            try {
              await tx[spec.delegate].create({ data: retry });
              bump(added, spec.key);
              warnings.push(`${spec.key}: a row's unique identifier already exists on a different record and was suffixed with "~R…" in the update.`);
              recovered = true;
            } catch {
              recovered = false;
            }
          }
        }
        if (!recovered) {
          warnings.push(`${spec.key}: a row was skipped — its unique value already exists on a different record in this business.`);
        }
        written = recovered;
      }
      // Link repairs apply only to rows that actually landed.
      if (written && Object.keys(fixups).length) {
        pendingFixups.push({ spec, id: out.id, fixups });
      }
    }
  }

  // Deferred FK fix-ups (reservation.folioId, folio.saleId).
  for (const pending of pendingFixups) {
    try {
      await tx[pending.spec.delegate!].update({ where: { id: pending.id }, data: pending.fixups });
    } catch (error: any) {
      throw new Error(`Restore update failed at table "${pending.spec.key}" (link repair): ${error?.message || error}`);
    }
  }

  // Settings: keys the target's creator already has are NEVER
  // overwritten (live settings win, both restore modes); missing keys
  // are added, re-homed to the target business's creator.
  const settingsOwner = target.createdBy || caller.id;
  let settingsSkipped = 0;
  for (const row of tables.settings || []) {
    if (!row?.key || row.key === SESSION_SETTINGS_KEY) continue;
    const existing = await tx.settings.findUnique({
      where: { createdBy_key: { createdBy: settingsOwner, key: row.key } },
      select: { id: true }
    });
    if (existing) {
      settingsSkipped++;
      continue;
    }
    await tx.settings.create({
      data: { id: genId(), createdBy: settingsOwner, key: row.key, value: row.value, description: row.description ?? null }
    });
    bump(added, 'settings');
  }
  if (settingsSkipped) {
    warnings.push(`${settingsSkipped} setting(s) already exist for this business and were not overwritten (a restore never overwrites live settings).`);
  }
  if (!tables.businessModules?.length) {
    warnings.push('This backup carried no module configuration; the business\u2019s current modules were left unchanged.');
  }
  if (tables.fbrConfig?.length) {
    warnings.push('The FBR API token was preserved from the live business — backups never carry secret keys.');
  }

  const sum = (bag: Record<string, number>) => Object.values(bag).reduce((a, b) => a + b, 0);
  return {
    sourceBusinessId: srcBusiness.id,
    businessId: targetId,
    name: target.name,
    sameBusiness,
    updated,
    added,
    kept,
    updatedTotal: sum(updated),
    addedTotal: sum(added),
    keptTotal: sum(kept),
    skippedStaff,
    warnings
  };
}

export async function restoreBackupFileUpdate(
  prisma: any,
  caller: CallerInfo,
  payload: any,
  targets: Record<string, string>
): Promise<{ updated: UpdateBusinessResult[] }> {
  const validation = validateBackupEnvelope(payload);
  if (!validation.ok) {
    throw codedError('BACKUP_FORMAT_INVALID', validation.message || 'Invalid backup file', 400);
  }
  const entries = normalizeBackupBusinesses(payload);
  const targetMap = await resolveUpdateTargets(prisma, caller, entries, targets || {});
  const sourceKind = payload.kind === 'account' ? 'account' : 'business';
  const updated: UpdateBusinessResult[] = [];

  for (const entry of entries) {
    const target = targetMap.get(entry.business?.id)!;
    // Safety first: export the target's CURRENT state and store it
    // before anything is written. If this fails, nothing is applied.
    const currentPayload = await buildBusinessBackup(prisma, target);
    const snapshot = await storeSafetySnapshot(prisma, caller, target, currentPayload, sourceKind);
    const result = await prisma.$transaction(
      async (tx: any) => applyBusinessUpdate(tx, caller, entry, target, currentPayload.tables),
      { timeout: 180_000, maxWait: 30_000 }
    );
    updated.push({ ...result, safetySnapshotId: snapshot.id });
  }
  return { updated };
}
