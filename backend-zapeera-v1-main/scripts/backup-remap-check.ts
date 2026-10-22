/**
 * Backup remap self-check (pure — no DB).
 *
 * Builds a tiny fixture business (category → product → batch, a sale
 * with an FBR config + a deferred folio link) and proves that
 * remapRow rewrites every FK through the id map, maps user refs to
 * the caller/matched accounts, strips the FBR token, nulls uuids,
 * defers cycle FKs into fixups, and nullifies unmapped optional refs.
 *
 * Run: npx ts-node scripts/backup-remap-check.ts
 */
import {
  BACKUP_TABLES,
  RemapContext,
  buildIdMap,
  normalizeBackupBusinesses,
  remapRow,
  stripSecrets,
  validateBackupEnvelope
} from '../src/utils/backup.util';

let failures = 0;
const check = (label: string, cond: boolean) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};

let counter = 0;
const gen = () => `new-${++counter}`;

const OLD = {
  business: 'biz-old',
  branch: 'br-old',
  category: 'cat-old',
  product: 'prod-old',
  batch: 'batch-old',
  owner: 'user-owner-old',
  staff: 'user-staff-old',
  folio: 'folio-old',
  sale: 'sale-old'
};

const tables: Record<string, any[]> = {
  branches: [{ id: OLD.branch, name: 'Main Branch', companyId: OLD.business }],
  categories: [{ id: OLD.category, name: 'Painkillers', companyId: OLD.business, branchId: OLD.branch, createdBy: OLD.owner }],
  products: [
    {
      id: OLD.product,
      name: 'Panadol 500mg Tablet',
      sku: 'PAN-500',
      categoryId: OLD.category,
      branchId: OLD.branch,
      companyId: OLD.business,
      createdBy: OLD.owner,
      uuid: 'uuid-must-not-survive'
    }
  ],
  batches: [
    { id: OLD.batch, batchNo: 'B1', productId: OLD.product, branchId: OLD.branch, companyId: OLD.business, quantity: 40 }
  ],
  folios: [{ id: OLD.folio, companyId: OLD.business, roomId: 'room-not-in-fixture', saleId: OLD.sale, guestName: 'Guest' }],
  sales: [
    {
      id: OLD.sale,
      companyId: OLD.business,
      branchId: OLD.branch,
      userId: OLD.staff, // staff account not recreated → caller fallback
      salespersonId: OLD.staff, // optional user ref → null when unmapped
      membershipId: 'membership-of-skipped-staff', // nullifyIfUnmapped
      folioId: OLD.folio,
      totalAmount: 1200
    }
  ],
  fbrConfig: [{ id: 'fbr-old', companyId: OLD.business, enabled: true, apiToken: 'SECRET-TOKEN' }]
};

// ── export-side secret stripping ─────────────────────────────────────
const fbrSpec = BACKUP_TABLES.find((t) => t.key === 'fbrConfig')!;
const stripped = stripSecrets(fbrSpec, tables.fbrConfig[0]);
check('FBR apiToken is null after export stripping', stripped.apiToken === null);
check('FBR non-secret fields survive stripping', stripped.enabled === true);

// ── id map + remap ───────────────────────────────────────────────────
const allIds = [OLD.business, ...Object.values(tables).flat().map((r: any) => r.id)];
const idMap = buildIdMap(allIds, gen);
const ctx: RemapContext = {
  idMap,
  userMap: new Map([[OLD.owner, 'caller-1']]), // owner matched to the caller; staff NOT matched
  callerId: 'caller-1',
  moduleMap: new Map()
};
const specFor = (key: string) => BACKUP_TABLES.find((t) => t.key === key)!;

const cat = remapRow(specFor('categories'), tables.categories[0], ctx);
check('category gets a new id', cat.row.id === idMap.get(OLD.category));
check('category.companyId rewrites to the new business id', cat.row.companyId === idMap.get(OLD.business));
check('category.branchId rewrites to the new branch id', cat.row.branchId === idMap.get(OLD.branch));
check('category.createdBy (owner) maps to the caller', cat.row.createdBy === 'caller-1');

const prod = remapRow(specFor('products'), tables.products[0], ctx);
check('product.categoryId follows the category remap', prod.row.categoryId === idMap.get(OLD.category));
check('product uuid is nulled (global-unique)', prod.row.uuid === null);
check('product plain fields pass through', prod.row.sku === 'PAN-500' && prod.row.name === 'Panadol 500mg Tablet');

const batch = remapRow(specFor('batches'), tables.batches[0], ctx);
check('batch.productId follows the product remap', batch.row.productId === idMap.get(OLD.product));
check('batch quantity passes through', batch.row.quantity === 40);

const folio = remapRow(specFor('folios'), tables.folios[0], ctx);
check('folio.saleId is deferred (nulled on insert)', folio.row.saleId === null);
check('folio fixup carries the NEW sale id', folio.fixups.saleId === idMap.get(OLD.sale));

const sale = remapRow(specFor('sales'), tables.sales[0], ctx);
check('sale.folioId rewrites (folio imported before sales)', sale.row.folioId === idMap.get(OLD.folio));
check('sale.userId (unmatched staff, required) falls back to the caller', sale.row.userId === 'caller-1');
check('sale.salespersonId (unmatched staff, optional) becomes null', sale.row.salespersonId === null);
check('sale.membershipId (unmapped) is nullified, not left dangling', sale.row.membershipId === null);

const fbr = remapRow(specFor('fbrConfig'), stripped, ctx);
check('FBR config restores with token still null', fbr.row.apiToken === null);
check('FBR config companyId rewrites', fbr.row.companyId === idMap.get(OLD.business));

// ── envelope validation + shape normalization ────────────────────────
check(
  'envelope accepts a business file',
  validateBackupEnvelope({ format: 'zapeera-backup', version: 1, tables: {} }).ok
);
check(
  'envelope rejects a wrong format',
  !validateBackupEnvelope({ format: 'other', version: 1, tables: {} }).ok
);
check(
  'envelope rejects a wrong version',
  !validateBackupEnvelope({ format: 'zapeera-backup', version: 99, tables: {} }).ok
);
const normalized = normalizeBackupBusinesses({
  format: 'zapeera-backup',
  version: 1,
  business: { id: OLD.business },
  tables
});
check('single-business file normalizes to one entry', normalized.length === 1 && normalized[0].business.id === OLD.business);

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
