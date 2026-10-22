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
