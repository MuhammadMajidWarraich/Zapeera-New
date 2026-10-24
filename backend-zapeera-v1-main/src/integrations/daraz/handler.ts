// ─── Daraz sync handler (feature/integration-daraz) ────────────────────────
// Implements IntegrationSyncHandler for provider 'daraz' (registry entry
// already exists: hmac-signing, docs https://open.daraz.com/).
//
// DIRECTIONS
//   out  syncProducts — create/update Daraz listings from branch products
//   out  syncStock    — hourly push of price + base-unit stock
//   in   importOrders — POLLING (Daraz publishes no webhooks): fetch
//        new/updated orders every ~15 min, import as Zapeera sales
//   out  createShipment — the generic per-sale fulfilment step:
//        mark one imported Daraz order 'packed' (ready-to-ship is NOT
//        auto-applied — see below)
//
// TENANCY — ONE Daraz seller shop maps to ONE Zapeera branch. Every
// query is scoped to (businessId, branchId): products, batches and
// sales never cross branches, and another branch's stock can never leak
// into this shop. The branch resolves from config.branchId, else from
// the business's single active branch; a multi-branch business without
// an explicit branchId fails loudly instead of guessing.
//
// SALES — imported orders go through the EXISTING sale engine
// (createSale, the same handler the POS/appointment/folio flows use),
// so FEFO batch deduction, tax, loyalty, receipts and stock movements
// are identical to a counter sale. The handler lends createSale a
// synthetic request (the appointment/folio precedent) because a poll
// has no HTTP request. No parallel sales writer exists.
//
// CUSTOMER — the buyer is matched/created by phone (for CRM), but the
// imported sale itself is a WALK-IN sale (customerId null). Reason: a
// Daraz COD order's receivable is owed by DARAZ (marketplace
// settlement), not by the end customer; attaching the customer would
// make createSale post a false SALE_DUE (udhaar) onto that customer's
// khata. The sale is tagged channel='daraz' + the Daraz order id, so
// settlement reconciliation finds it. If the product decision changes,
// the one-line change is `customerId: customer?.id ?? null` in
// buildSalePayload below.
//
// IDEMPOTENCY — (companyId, channel, externalOrderId) is unique on
// Sale (schema, both prisma files). importOrders checks before creating
// and the stamp step catches the P2002 race. The same Daraz order can
// never create a second sale.
//
// POLLING — importOrders is one poll run. The cursor
// (darazLastOrderPollAt) lives in the connection row's raw config JSON
// and advances only past orders that resolved (imported / duplicate /
// terminal status); a failed order holds the cursor back so the next
// poll retries it. The scheduler that runs the poll is NOT in this
// branch — see README § "Scheduling hook (for the deploy wave)".
// Manual trigger: POST /api/integrations/daraz/sync { entity: 'order' }.
//
// SHIPMENTS — createShipment is per-sale (the generic shape): the
// service builds CreateShipmentInput from the Zapeera sale and the
// handler marks that sale's Daraz order 'packed'. Nothing auto-packs:
// the human triggering the shipment (sale screen / manual sync with
// saleRef) is the packing acknowledgement. 'ready_to_ship' (courier
// handover) is deliberately NOT set here — it needs the packing/
// handover UI the wave builds next.
//
// TOKENS — the framework stores exactly the credentials submitted at
// connect time, so the seller pastes the OAuth access + refresh tokens
// into the connect dialog (flow in README §1). The client auto-refreshes
// an expired access token mid-sync and this handler persists the
// rotated tokens (encrypted) back to the connection row.

import { DarazClient } from './client';
import type {
  DarazCredentials,
  DarazOrder,
  DarazRefreshedTokens
} from './client';
import { encryptIntegrationCredentials } from '../../utils/integration-encryption.util';
import { IntegrationError } from '../vendor-client';
import type {
  CreateShipmentInput,
  IntegrationSyncContext,
  IntegrationSyncHandler,
  IntegrationSyncResult
} from '../types';

export const DARAZ_PROVIDER = 'daraz' as const;

// Daraz order statuses we import as sales. 'canceled' / 'returned' /
// 'failed' are terminal non-sales; anything else unknown is skipped
// (not imported) so an undocumented status can never mint a sale.
const IMPORTABLE_ORDER_STATUSES = new Set(['pending', 'ready_to_ship', 'shipped', 'delivered']);
const TERMINAL_ORDER_STATUSES = new Set(['canceled', 'cancelled', 'returned', 'failed']);

// First poll (no cursor yet) looks back 24h; every poll overlaps the
// cursor by 5 minutes so an order updated at the boundary is not lost.
const FIRST_POLL_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const POLL_CURSOR_OVERLAP_MS = 5 * 60 * 1000;
// Lazada caps offset + limit < 5000; page at 100 (the documented max).
const DARAZ_PAGE_LIMIT = 100;
const PRICE_QUANTITY_BATCH_SIZE = 50;

const DARAZ_CURSOR_KEY = 'darazLastOrderPollAt';

// ─── Credential handling ────────────────────────────────────────────────────

function resolveDarazCredentials(credentials: Record<string, unknown>): DarazCredentials {
  const appKey = asNonEmptyString(credentials.appKey);
  const appSecret = asNonEmptyString(credentials.appSecret);
  const accessToken = asNonEmptyString(credentials.accessToken);
  const refreshToken = asNonEmptyString(credentials.refreshToken);
  if (!appKey || !appSecret || !accessToken) {
    throw new IntegrationError(
      'VENDOR_AUTH',
      'daraz: the stored credentials are incomplete (App Key, App Secret and seller access token are all required). Reconnect the Daraz account.',
      { retryable: false }
    );
  }
  return { appKey, appSecret, accessToken, refreshToken: refreshToken ?? undefined };
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

// ─── Branch + owner resolution ──────────────────────────────────────────────

/**
 * The ONE branch this Daraz shop maps to. config.branchId wins (when it
 * belongs to this business); otherwise the business's single active
 * branch; otherwise fail loudly — never guess, never mix branches.
 */
async function resolveMappedBranch(prisma: any, businessId: string, ctx: IntegrationSyncContext): Promise<{ id: string; name: string }> {
  const configuredId = asNonEmptyString((ctx.config as any)?.branchId);
  if (configuredId) {
    const branch = await prisma.branch.findFirst({
      where: { id: configuredId, companyId: businessId },
      select: { id: true, name: true, isActive: true }
    });
    if (!branch) {
      throw new IntegrationError(
        'SYNC_FAILED',
        `daraz: the configured branch (${configuredId}) does not belong to this business. Fix the Daraz connection config.`
      );
    }
    if (!branch.isActive) {
      throw new IntegrationError('SYNC_FAILED', 'daraz: the configured branch is inactive.');
    }
    return branch;
  }
  const branches = await prisma.branch.findMany({
    where: { companyId: businessId, isActive: true },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' }
  });
  if (branches.length === 1) return branches[0];
  if (branches.length === 0) {
    throw new IntegrationError('SYNC_FAILED', 'daraz: this business has no active branch to map the Daraz shop to.');
  }
  throw new IntegrationError(
    'SYNC_FAILED',
    'daraz: this business has more than one active branch — set branchId in the Daraz connection config so one Daraz shop maps to exactly one branch.'
  );
}

/** The user id createSale books imported sales under: the business owner. */
async function resolveOwnerUserId(prisma: any, businessId: string): Promise<string> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { createdBy: true }
  });
  if (business?.createdBy) {
    const user = await prisma.zapeeraUser.findUnique({
      where: { id: business.createdBy },
      select: { id: true }
    });
    if (user) return user.id;
  }
  const memberships = await prisma.membership.findMany({
    where: { businessId, status: 'ACTIVE' },
    select: { userId: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
    take: 1
  });
  if (memberships.length > 0) return memberships[0].userId;
  throw new IntegrationError(
    'SYNC_FAILED',
    'daraz: no owner user could be resolved for this business, so imported sales have no cashier. Add an active member and retry.'
  );
}

// ─── Stock (base units) ─────────────────────────────────────────────────────

/**
 * Sellable stock per product in the branch, in BASE units (the unit
 * engine's stock unit — batches already store base units). Only live
 * batches count: quantity > 0, active, and not expired. (createSale's
 * own availability sum does not exclude expired batches, but its batch
 * selection refuses them — for a stock PUSH the sellable figure is the
 * honest one.) Price is the latest batch's selling price in the branch.
 */
async function getBranchStockMap(
  prisma: any,
  branchId: string
): Promise<Map<string, { quantity: number; price: number | null }>> {
  const now = new Date();
  const batches = await prisma.batch.findMany({
    where: { branchId, isActive: true, quantity: { gt: 0 } },
    select: { productId: true, quantity: true, sellingPrice: true, expireDate: true, createdAt: true },
    orderBy: { createdAt: 'desc' }
  });
  const map = new Map<string, { quantity: number; price: number | null }>();
  for (const batch of batches) {
    if (batch.expireDate && new Date(batch.expireDate) < now) continue; // expired stock is not sellable
    const entry = map.get(batch.productId) ?? { quantity: 0, price: null };
    entry.quantity += Number(batch.quantity) || 0;
    if (entry.price === null) entry.price = Number(batch.sellingPrice) || 0;
    map.set(batch.productId, entry);
  }
  return map;
}

// ─── Daraz listing map ──────────────────────────────────────────────────────

async function getDarazListingMap(
  client: DarazClient
): Promise<Map<string, { itemId: string; price: number; quantity: number }>> {
  const map = new Map<string, { itemId: string; price: number; quantity: number }>();
  let offset = 0;
  for (;;) {
    const page = await client.getProducts({ filter: 'all', offset, limit: DARAZ_PAGE_LIMIT });
    for (const product of page.products) {
      for (const sku of product.skus) {
        if (sku.sellerSku) {
          map.set(sku.sellerSku, { itemId: product.itemId, price: sku.price, quantity: sku.quantity });
        }
      }
    }
    offset += page.products.length;
    if (page.products.length < DARAZ_PAGE_LIMIT || offset >= page.totalProducts) break;
  }
  return map;
}

// ─── Sale creation (existing engine, via test seam) ─────────────────────────

export interface DarazSaleLine {
  productId: string;
  quantity: number;
  unitPrice: number;
}

export interface DarazSaleInput {
  branchId: string;
  ownerUserId: string;
  businessId: string;
  lines: DarazSaleLine[];
  saleDate?: string;
}

export type DarazSaleCreator = (input: DarazSaleInput) => Promise<{ saleId: string }>;

/**
 * Default sale creator: invokes the REAL createSale handler in-process
 * with a synthetic request (the appointment/folio precedent — they lend
 * createSale their request; a poll has no request, so we synthesize
 * one). createSale only reads req.body / req.user / req.membership,
 * and its side effects (SSE notify, desktop sync, FBR enqueue) are the
 * same ones any POS sale produces. Lazily imported so unit tests (and
 * any non-sale context) never load the sale controller.
 */
async function createSaleViaEngine(input: DarazSaleInput): Promise<{ saleId: string }> {
  const { createSale } = await import('../../controllers/sale.controller');
  const payload = {
    branchId: input.branchId,
    // Walk-in by design (see the header comment): the Daraz receivable
    // is owed by Daraz, not the end customer — attaching the customer
    // would post a false SALE_DUE (udhaar) on their khata.
    customerId: null,
    items: input.lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      saleType: 'UNIT'
    })),
    paymentMethod: 'CASH', // COD tender marker — the buyer pays Daraz's courier
    paymentStatus: 'PENDING', // unpaid until Daraz settles (paidAmount 0)
    paidAmount: 0,
    saleDate: input.saleDate
  };
  let status = 500;
  let body: any = null;
  const captureRes: any = {
    status(code: number) {
      status = code;
      return this;
    },
    json(responseBody: any) {
      body = responseBody;
      return this;
    }
  };
  const syntheticReq: any = {
    body: payload,
    user: {
      id: input.ownerUserId,
      createdBy: input.ownerUserId,
      selectedCompanyId: input.businessId,
      selectedBranchId: input.branchId
    },
    membership: undefined
  };
  await createSale(syntheticReq, captureRes);
  if (status !== 201 || !body?.success || !body?.data?.id) {
    const message =
      body?.message ??
      (Array.isArray(body?.errors) ? body.errors.join('; ') : null) ??
      `sale engine returned HTTP ${status}`;
    throw new IntegrationError('SYNC_FAILED', `daraz: the sale engine refused this order (${message}).`);
  }
  return { saleId: String(body.data.id) };
}

// Test seam: handler tests inject a fake sale creator so no DB-backed
// sale engine (and no live Daraz) is ever needed. Production code never
// calls setDarazSaleCreator.
let saleCreator: DarazSaleCreator = createSaleViaEngine;
export function setDarazSaleCreator(fn: DarazSaleCreator | null): void {
  saleCreator = fn ?? createSaleViaEngine;
}

// ─── Connection-row helpers (cursor + token persistence) ────────────────────

async function readConnectionRow(prisma: any, businessId: string): Promise<any | null> {
  return prisma.integrationConnection.findUnique({
    where: { businessId_provider: { businessId, provider: DARAZ_PROVIDER } }
  });
}

function readPollCursor(row: any): Date | null {
  try {
    const parsed = row?.config ? JSON.parse(row.config) : {};
    const raw = parsed?.[DARAZ_CURSOR_KEY];
    if (typeof raw === 'string' && raw) {
      const date = new Date(raw);
      if (!Number.isNaN(date.getTime())) return date;
    }
  } catch {
    // Corrupt config JSON → fall back to the first-poll window.
  }
  return null;
}

async function writePollCursor(prisma: any, businessId: string, cursor: Date): Promise<void> {
  const row = await readConnectionRow(prisma, businessId);
  if (!row) return;
  let parsed: Record<string, unknown> = {};
  try {
    parsed = row.config ? JSON.parse(row.config) : {};
  } catch {
    parsed = {};
  }
  parsed[DARAZ_CURSOR_KEY] = cursor.toISOString();
  await prisma.integrationConnection.update({
    where: { businessId_provider: { businessId, provider: DARAZ_PROVIDER } },
    data: { config: JSON.stringify(parsed) }
  });
}

/** Build a client whose token refreshes are persisted (encrypted) to the row. */
function buildClient(ctx: IntegrationSyncContext): DarazClient {
  const creds = resolveDarazCredentials(ctx.credentials);
  return new DarazClient(creds, {
    fetchFn: darazFetchOverride ?? undefined,
    onTokensRefreshed: async (tokens: DarazRefreshedTokens) => {
      const rotated: Record<string, unknown> = { ...ctx.credentials, accessToken: tokens.accessToken };
      if (tokens.refreshToken) rotated.refreshToken = tokens.refreshToken;
      await ctx.prisma.integrationConnection.update({
        where: { businessId_provider: { businessId: ctx.businessId, provider: DARAZ_PROVIDER } },
        data: { encryptedCredentials: encryptIntegrationCredentials(rotated as Record<string, unknown>) }
      });
    }
  });
}

// Test seam for the HTTP layer (handler tests stub fetch here; the
// client also accepts its own fetchFn — this one keeps the handler's
// default client construction testable without touching credentials).
let darazFetchOverride: typeof fetch | null = null;
export function setDarazFetch(fn: typeof fetch | null): void {
  darazFetchOverride = fn;
}

// ─── Phone + customer matching ──────────────────────────────────────────────

function normalizePhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[\s\-().]/g, '');
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Match a Daraz buyer by phone; create the customer record when new
 * (CRM). Customer.phone is globally unique in the schema, so a phone
 * that belongs to ANOTHER business throws P2002 on create — in that
 * case we fall back to no customer (the sale stays walk-in) rather
 * than failing the whole order.
 */
async function matchOrCreateCustomer(
  prisma: any,
  businessId: string,
  branchId: string,
  ownerUserId: string,
  order: DarazOrder
): Promise<{ id: string } | null> {
  const phone =
    normalizePhone(order.addressShipping?.phone) ??
    normalizePhone(order.addressShipping?.phone2) ??
    normalizePhone(order.addressBilling?.phone);
  if (!phone) return null;
  const existing = await prisma.customer.findFirst({
    where: { phone, companyId: businessId },
    select: { id: true }
  });
  if (existing) return existing;
  const name =
    [order.customerFirstName, order.customerLastName].filter(Boolean).join(' ').trim() ||
    [order.addressShipping?.firstName, order.addressShipping?.lastName].filter(Boolean).join(' ').trim() ||
    'Daraz Customer';
  try {
    return await prisma.customer.create({
      data: {
        name,
        phone,
        branchId,
        companyId: businessId,
        createdBy: ownerUserId
      },
      select: { id: true }
    });
  } catch (error: any) {
    if (error?.code === 'P2002') return null; // phone belongs to another business
    throw error;
  }
}

// ─── The handler ────────────────────────────────────────────────────────────

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export const darazHandler: IntegrationSyncHandler = {
  provider: DARAZ_PROVIDER,

  async connect(credentials: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> {
    let creds: DarazCredentials;
    try {
      creds = resolveDarazCredentials(credentials);
    } catch {
      return { ok: false, message: 'App Key, App Secret and seller access token are all required.' };
    }
    const client = new DarazClient(creds, { fetchFn: darazFetchOverride ?? undefined });
    try {
      // Cheap vendor read: one product. Never return ok:true without it.
      await client.getProducts({ filter: 'all', offset: 0, limit: 1 });
      return { ok: true, message: 'Connected to Daraz — the seller shop answered.' };
    } catch (error) {
      if (error instanceof IntegrationError && error.code === 'VENDOR_AUTH') {
        return { ok: false, message: error.message };
      }
      throw error;
    }
  },

  async disconnect(_credentials: Record<string, unknown>): Promise<void> {
    // Daraz publishes no token-revoke endpoint; the framework wipes the
    // stored credentials regardless, which is the actual disconnect.
  },

  async getStatus(credentials: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> {
    const client = new DarazClient(resolveDarazCredentials(credentials), {
      fetchFn: darazFetchOverride ?? undefined
    });
    await client.getProducts({ filter: 'all', offset: 0, limit: 1 });
    return { ok: true, message: 'Daraz is reachable and the seller token is accepted.' };
  },

  async syncProducts(ctx: IntegrationSyncContext): Promise<IntegrationSyncResult> {
    const branch = await resolveMappedBranch(ctx.prisma, ctx.businessId, ctx);
    const client = buildClient(ctx);
    const darazCategoryId = asNonEmptyString((ctx.config as any)?.darazCategoryId);
    const products = await ctx.prisma.product.findMany({
      where: { companyId: ctx.businessId, branchId: branch.id, isActive: true },
      select: { id: true, name: true, description: true, sku: true }
    });
    const stockMap = await getBranchStockMap(ctx.prisma, branch.id);
    const listings = await getDarazListingMap(client);

    let processed = 0;
    let failed = 0;
    const failures: string[] = [];
    for (const product of products) {
      const stock = stockMap.get(product.id) ?? { quantity: 0, price: null };
      try {
        if (listings.has(product.sku)) {
          if (stock.price === null) throw new Error('no priced batch in Zapeera');
          await client.updatePriceQuantity([
            { SellerSku: product.sku, price: stock.price, quantity: stock.quantity }
          ]);
        } else if (darazCategoryId) {
          if (stock.price === null) throw new Error('no priced batch in Zapeera');
          await client.createProduct({
            PrimaryCategory: darazCategoryId,
            Attributes: {
              name: product.name,
              short_description: (product.description ?? '').slice(0, 255) || product.name,
              brand: 'No Brand'
            },
            Skus: {
              Sku: [{ SellerSku: product.sku, quantity: stock.quantity, price: stock.price }]
            }
          });
        } else {
          throw new Error(
            'not listed on Daraz and no darazCategoryId is set in the connection config — list it in Seller Center first'
          );
        }
        processed += 1;
      } catch (error) {
        failed += 1;
        failures.push(
          `${product.sku}: ${error instanceof Error ? error.message : 'unknown error'}`
        );
      }
    }
    return {
      recordsProcessed: processed,
      recordsFailed: failed,
      message:
        `Daraz products (${branch.name}): ${processed} synced, ${failed} failed.` +
        (failures.length > 0 ? ` First failures: ${failures.slice(0, 3).join(' | ')}` : '')
    };
  },

  async syncStock(ctx: IntegrationSyncContext): Promise<IntegrationSyncResult> {
    const branch = await resolveMappedBranch(ctx.prisma, ctx.businessId, ctx);
    const client = buildClient(ctx);
    const stockMap = await getBranchStockMap(ctx.prisma, branch.id);
    const listings = await getDarazListingMap(client);

    // Only SKUs already listed on Daraz get a push; unlisted products
    // are syncProducts' job (they need a listing first).
    const updates: Array<{ SellerSku: string; price: number; quantity: number }> = [];
    let failed = 0;
    const failures: string[] = [];
    for (const [sellerSku, listing] of listings) {
      const product = await ctx.prisma.product.findFirst({
        where: { sku: sellerSku, companyId: ctx.businessId, branchId: branch.id },
        select: { id: true }
      });
      if (!product) continue; // a Daraz listing with no Zapeera product in this branch — not ours to push
      const stock = stockMap.get(product.id);
      if (!stock || stock.price === null) {
        failed += 1;
        failures.push(`${sellerSku}: no priced batch in Zapeera`);
        continue;
      }
      updates.push({ SellerSku: sellerSku, price: stock.price, quantity: stock.quantity });
    }
    let processed = 0;
    for (const batch of chunk(updates, PRICE_QUANTITY_BATCH_SIZE)) {
      try {
        await client.updatePriceQuantity(batch);
        processed += batch.length;
      } catch (error) {
        failed += batch.length;
        failures.push(
          `${batch.map((b) => b.SellerSku).join(',')}: ${error instanceof Error ? error.message : 'unknown error'}`
        );
      }
    }
    return {
      recordsProcessed: processed,
      recordsFailed: failed,
      message:
        `Daraz stock push (${branch.name}): ${processed} SKUs updated, ${failed} failed.` +
        (failures.length > 0 ? ` First failures: ${failures.slice(0, 3).join(' | ')}` : '')
    };
  },

  async importOrders(ctx: IntegrationSyncContext): Promise<IntegrationSyncResult> {
    return pollDarazOrders(ctx);
  },

  /**
   * Pack one Daraz order (the generic createShipment shape): the
   * service builds the input from a Zapeera sale, so this method only
   * needs the sale's channel + Daraz order id. A sale that did not
   * come from Daraz fails loudly; an order Daraz already shows as
   * packed (or further along) is an idempotent no-op — never a second
   * pack. 'ready_to_ship' (courier handover) is deliberately NOT set
   * here — it needs the handover step / packing UI.
   */
  async createShipment(
    ctx: IntegrationSyncContext,
    input: CreateShipmentInput
  ): Promise<IntegrationSyncResult> {
    const branch = await resolveMappedBranch(ctx.prisma, ctx.businessId, ctx);
    const client = buildClient(ctx);
    if (!input || input.channel !== 'daraz' || !input.externalOrderId) {
      throw new IntegrationError(
        'SYNC_FAILED',
        'daraz: this sale did not come from Daraz (no Daraz order id), so there is nothing to pack on Daraz.'
      );
    }
    const orderNumber = input.externalOrderId;
    const order = await client.getOrder(orderNumber);
    const status = (order.status || '').toLowerCase();
    if (['packed', 'ready_to_ship', 'shipped', 'delivered'].includes(status)) {
      return {
        recordsProcessed: 0,
        recordsFailed: 0,
        message: `Daraz order ${orderNumber} is already '${order.status}' on Daraz — nothing to pack.`
      };
    }
    if (TERMINAL_ORDER_STATUSES.has(status)) {
      return {
        recordsProcessed: 0,
        recordsFailed: 1,
        message: `Daraz order ${orderNumber} is '${order.status}' on Daraz and cannot be packed.`
      };
    }
    const items = await client.getOrderItems(orderNumber);
    const itemIds = items.map((i) => i.orderItemId).filter(Boolean);
    if (itemIds.length === 0) {
      throw new IntegrationError(
        'SYNC_FAILED',
        `daraz: order ${orderNumber} returned no order items, so it cannot be marked packed.`
      );
    }
    await client.setOrderStatus(itemIds, 'packed');
    return {
      recordsProcessed: 1,
      recordsFailed: 0,
      message: `Daraz order ${orderNumber} (sale ${input.saleInvoiceNumber ?? input.saleId}, ${branch.name}) marked packed on Daraz. 'ready_to_ship' needs the courier handover.`
    };
  }
};

/**
 * One order poll run (the ~15-minute cadence). Also exposed as a plain
 * export so the deploy wave's scheduler job can call it directly; the
 * framework reaches it through importOrders().
 *
 * Pagination + dedup: pages are fetched updated_at ASC; an order number
 * seen twice (list shifting mid-poll) is processed once. The cursor
 * advances only past resolved orders; a failed order holds it back so
 * the next poll retries it after the owner fixes the cause (usually an
 * unmapped SKU).
 */
export async function pollDarazOrders(
  ctx: IntegrationSyncContext
): Promise<IntegrationSyncResult> {
  const branch = await resolveMappedBranch(ctx.prisma, ctx.businessId, ctx);
  const ownerUserId = await resolveOwnerUserId(ctx.prisma, ctx.businessId);
  const client = buildClient(ctx);

  const pollStart = new Date();
  const cursor = readPollCursor(await readConnectionRow(ctx.prisma, ctx.businessId));
  const windowStart = cursor
    ? new Date(cursor.getTime() - POLL_CURSOR_OVERLAP_MS)
    : new Date(pollStart.getTime() - FIRST_POLL_LOOKBACK_MS);

  let processed = 0;
  let failed = 0;
  let skipped = 0;
  const failures: string[] = [];
  const seen = new Set<string>();
  let firstFailedUpdatedAt: Date | null = null;
  let offset = 0;

  for (;;) {
    const page = await client.getOrders({
      updatedAfter: windowStart.toISOString(),
      sortBy: 'updated_at',
      sortDirection: 'ASC',
      offset,
      limit: DARAZ_PAGE_LIMIT
    });
    for (const header of page.orders) {
      if (seen.has(header.orderNumber)) {
        skipped += 1;
        continue;
      }
      seen.add(header.orderNumber);
      const updatedAt = header.updatedAt ? new Date(header.updatedAt) : pollStart;

      if (TERMINAL_ORDER_STATUSES.has(header.status.toLowerCase())) {
        skipped += 1;
        continue;
      }
      if (!IMPORTABLE_ORDER_STATUSES.has(header.status.toLowerCase())) {
        skipped += 1;
        continue;
      }

      // Idempotency: the same Daraz order never creates a second sale.
      const existing = await ctx.prisma.sale.findFirst({
        where: { companyId: ctx.businessId, channel: 'daraz', externalOrderId: header.orderNumber },
        select: { id: true }
      });
      if (existing) {
        skipped += 1;
        continue;
      }

      try {
        const [order, items] = await Promise.all([
          client.getOrder(header.orderNumber),
          client.getOrderItems(header.orderNumber)
        ]);
        if (items.length === 0) throw new Error('Daraz returned no order items');

        // Map every line to a branch-scoped Zapeera product by SKU. One
        // unknown SKU fails the WHOLE order — never create a partial sale.
        const lines: DarazSaleLine[] = [];
        const unknownSkus: string[] = [];
        for (const item of items) {
          const product = await ctx.prisma.product.findFirst({
            where: { sku: item.sellerSku, companyId: ctx.businessId, branchId: branch.id },
            select: { id: true }
          });
          if (!product) {
            unknownSkus.push(item.sellerSku);
            continue;
          }
          lines.push({
            productId: product.id,
            quantity: Math.max(1, Math.floor(item.quantity)),
            unitPrice: item.paidPrice
          });
        }
        if (unknownSkus.length > 0) {
          throw new Error(
            `unknown SKU(s) in this branch: ${[...new Set(unknownSkus)].join(', ')} — map them to Zapeera products first`
          );
        }

        // Buyer record for CRM (the sale itself stays walk-in — see the
        // header comment for why the customer is not attached).
        await matchOrCreateCustomer(ctx.prisma, ctx.businessId, branch.id, ownerUserId, order);

        const { saleId } = await saleCreator({
          branchId: branch.id,
          ownerUserId,
          businessId: ctx.businessId,
          lines,
          saleDate: order.createdAt || undefined
        });

        // Tag the sale: channel + Daraz order id (unique — the P2002
        // catch is the backstop for two polls racing each other).
        try {
          await ctx.prisma.sale.update({
            where: { id: saleId },
            data: { channel: 'daraz', externalOrderId: header.orderNumber }
          });
        } catch (error: any) {
          if (error?.code === 'P2002') {
            throw new Error(
              'duplicate detected while tagging the sale — another poll already imported this order; the untagged duplicate needs manual review'
            );
          }
          throw error;
        }
        processed += 1;
      } catch (error) {
        failed += 1;
        if (!firstFailedUpdatedAt || updatedAt < firstFailedUpdatedAt) {
          firstFailedUpdatedAt = updatedAt;
        }
        failures.push(
          `${header.orderNumber}: ${error instanceof Error ? error.message : 'unknown error'}`
        );
      }
    }
    offset += page.orders.length;
    if (page.orders.length < DARAZ_PAGE_LIMIT || offset >= page.count) break;
  }

  // Advance the cursor: past everything when clean; held back to just
  // before the earliest failed order when something failed, so the next
  // poll retries it. The 5-minute overlap is re-applied on read.
  const newCursor = firstFailedUpdatedAt
    ? new Date(firstFailedUpdatedAt.getTime() - 1000)
    : pollStart;
  const oldCursor = cursor ?? new Date(0);
  if (newCursor > oldCursor) {
    await writePollCursor(ctx.prisma, ctx.businessId, newCursor);
  }

  return {
    recordsProcessed: processed,
    recordsFailed: failed,
    message:
      `Daraz order poll (${branch.name}): ${processed} imported, ${failed} failed, ${skipped} skipped (duplicates / terminal / unknown status).` +
      (failures.length > 0 ? ` First failures: ${failures.slice(0, 3).join(' | ')}` : '')
  };
}
