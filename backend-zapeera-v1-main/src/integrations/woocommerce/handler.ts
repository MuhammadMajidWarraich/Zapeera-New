// ─── WooCommerce sync handler (feature/integration-woocommerce) ──────────
// Implements IntegrationSyncHandler for provider 'woocommerce' (contract
// §5) against the WooCommerce WP REST API v3. One WooCommerce store maps
// to ONE Zapeera branch — the binding is stored in the connection config
// (IntegrationSyncConfig.branchId) and enforced on every method: only
// that branch's products, stock and customers ever touch the store, and
// only that branch's products can be sold by an imported order.
//
//   connect()     — cheap vendor read: GET /products?per_page=1.
//   syncProducts  — Zapeera → WooCommerce: create/update products
//                   (incl. variants → variations) by SKU.
//   syncStock     — Zapeera → WooCommerce: push base-unit batch stock.
//   importOrders  — WooCommerce → Zapeera sales via the existing
//                   createSale engine (sale-invoker.ts) — FEFO batch
//                   deduction, receipts, khata, tax, FBR all come free.
//                   Idempotent via Sale.uuid = "woocommerce:<orderId>".
//
// Vendor calls: every one through WooCommerceClient (withVendorRetry +
// mapVendorError). No raw vendor error ever reaches the service layer.

import { IntegrationError } from '../vendor-client';
import type {
  IntegrationSyncConfig,
  IntegrationSyncContext,
  IntegrationSyncHandler,
  IntegrationSyncResult
} from '../types';
import { registerIntegrationHandler } from '../registry';
import { WooCommerceClient, parseWooCredentials } from './client';
import * as saleInvoker from './sale-invoker';
import type { SaleActor } from './sale-invoker';
import {
  WOOCOMMERCE_CHANNEL,
  buildSalePayloadFromWooOrder,
  buildWooProductPayload,
  buildWooVariationPayload,
  isImportableWooOrder,
  parseWooMoney,
  wooCustomerName,
  wooOrderReference,
  type MatchedWooLine,
  type WcOrder,
  type WcProduct,
  type WcVariation,
  type ZapeeraProductForPush
} from './mapping';

// ─── Branch binding ─────────────────────────────────────────────────────────

export interface BoundBranch {
  id: string;
  name: string;
}

/**
 * Resolve the ONE branch this store is bound to.
 *   · config.branchId set → it must be an active branch of this business.
 *   · not set + exactly one active branch → that branch (the common case).
 *   · not set + several active branches → fail with a message naming
 *     them: the owner must reconnect with the branchId in the config
 *     (there is no branch picker in the Settings dialog yet — see
 *     README.md).
 * Never silently picks a branch when several exist: a wrong pick would
 * leak another branch's stock into the store.
 */
export async function resolveBoundBranch(
  prisma: any,
  businessId: string,
  config: IntegrationSyncConfig
): Promise<BoundBranch> {
  const branches: Array<{ id: string; name: string }> = await prisma.branch.findMany({
    where: { companyId: businessId, isActive: true },
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' }
  });
  const configured = typeof (config as any)?.branchId === 'string' ? (config as any).branchId.trim() : '';
  if (configured) {
    const match = branches.find((b) => b.id === configured);
    if (!match) {
      throw new IntegrationError(
        'SYNC_FAILED',
        'woocommerce: the branch this store is bound to no longer exists or is inactive. Reconnect WooCommerce and pick a branch.'
      );
    }
    return match;
  }
  if (branches.length === 1) return branches[0];
  if (branches.length === 0) {
    throw new IntegrationError(
      'SYNC_FAILED',
      'woocommerce: this business has no active branch to bind the store to. Create a branch first.'
    );
  }
  throw new IntegrationError(
    'SYNC_FAILED',
    `woocommerce: this business has ${branches.length} active branches (${branches
      .map((b) => b.name)
      .join(', ')}) and the store is not bound to one. Reconnect WooCommerce with the branchId of the branch this store belongs to.`
  );
}

// ─── Sale actor (no logged-in cashier on an import) ─────────────────────────

export async function resolveSaleActor(prisma: any, businessId: string): Promise<SaleActor> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { createdBy: true }
  });
  if (business?.createdBy) {
    const owner = await prisma.zapeeraUser.findUnique({
      where: { id: business.createdBy },
      select: { id: true }
    });
    if (owner) {
      const membership = await prisma.membership.findFirst({
        where: { businessId, userId: owner.id, status: 'ACTIVE' },
        select: { id: true }
      });
      return { userId: owner.id, membershipId: membership?.id ?? null };
    }
  }
  const membership = await prisma.membership.findFirst({
    where: { businessId, status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
    select: { id: true, userId: true }
  });
  if (!membership) {
    throw new IntegrationError(
      'SYNC_FAILED',
      'woocommerce: no active member exists for this business, so an imported sale has no cashier to attribute it to.'
    );
  }
  return { userId: membership.userId, membershipId: membership.id };
}

// ─── Stock + price from batches (base units) ─────────────────────────────────

async function branchStockFor(
  prisma: any,
  productId: string,
  branchId: string,
  variantId: string | null
): Promise<number> {
  const batches: Array<{ quantity: number }> = await prisma.batch.findMany({
    where: { productId, branchId, isActive: true, variantId },
    select: { quantity: true }
  });
  return batches.reduce((sum, b) => sum + (b.quantity || 0), 0);
}

/**
 * The selling price per base unit from the FEFO batch the POS would sell
 * (earliest-expiry active batch with stock; null expiry sorts last),
 * falling back to the newest active batch. `variantId` scopes the
 * batches: a string scopes to that variant's pool, null to the base
 * pool, undefined to every batch of the product. Null when the product
 * has no batch at all — such a product cannot be priced for WooCommerce.
 */
async function fefoUnitPrice(
  prisma: any,
  productId: string,
  branchId: string,
  variantId?: string | null
): Promise<number | null> {
  const withStock: Array<{ sellingPrice: number; expireDate: Date | null; createdAt: Date }> =
    await prisma.batch.findMany({
      where: {
        productId,
        branchId,
        isActive: true,
        quantity: { gt: 0 },
        ...(variantId === undefined ? {} : { variantId })
      },
      select: { sellingPrice: true, expireDate: true, createdAt: true }
    });
  if (withStock.length > 0) {
    withStock.sort((a, b) => {
      const aExp = a.expireDate ? new Date(a.expireDate).getTime() : Number.POSITIVE_INFINITY;
      const bExp = b.expireDate ? new Date(b.expireDate).getTime() : Number.POSITIVE_INFINITY;
      if (aExp !== bExp) return aExp - bExp;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
    return withStock[0].sellingPrice;
  }
  const newest: Array<{ sellingPrice: number }> = await prisma.batch.findMany({
    where: {
      productId,
      branchId,
      isActive: true,
      ...(variantId === undefined ? {} : { variantId })
    },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { sellingPrice: true }
  });
  return newest.length > 0 ? newest[0].sellingPrice : null;
}

function parseVariantAttributes(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    out[key] = String(value);
  }
  return out;
}

async function loadProductsForPush(
  prisma: any,
  businessId: string,
  branchId: string
): Promise<ZapeeraProductForPush[]> {
  const products: any[] = await prisma.product.findMany({
    where: { companyId: businessId, branchId, isActive: true },
    include: { variants: { where: { isActive: true }, orderBy: { createdAt: 'asc' } } },
    orderBy: { name: 'asc' }
  });
  const out: ZapeeraProductForPush[] = [];
  for (const product of products) {
    const built = await buildProductForPush(prisma, branchId, product);
    if (built) out.push(built);
  }
  return out;
}

/** Build the push shape for one already-loaded product row (+ variants). */
async function buildProductForPush(
  prisma: any,
  branchId: string,
  product: any
): Promise<ZapeeraProductForPush | null> {
  if (!product) return null;
  const variants: ZapeeraProductForPush['variants'] = [];
  for (const variant of product.variants ?? []) {
    variants.push({
      id: variant.id,
      name: variant.name,
      sku: variant.sku ?? null,
      priceDelta: variant.priceDelta ?? 0,
      attributes: parseVariantAttributes(variant.attributes),
      stockQuantity: await branchStockFor(prisma, product.id, branchId, variant.id),
      unitPrice: await fefoUnitPrice(prisma, product.id, branchId, variant.id)
    });
  }
  return {
    id: product.id,
    name: product.name,
    description: product.description ?? null,
    sku: product.sku,
    unitPrice: await fefoUnitPrice(prisma, product.id, branchId),
    stockQuantity: await branchStockFor(prisma, product.id, branchId, null),
    variants
  };
}

/**
 * Load ONE product by SKU for a webhook product.updated push. Returns
 * null when the SKU is not an active product of the bound branch.
 */
export async function loadOneProductForPush(
  prisma: any,
  businessId: string,
  branchId: string,
  sku: string
): Promise<ZapeeraProductForPush | null> {
  const product = await prisma.product.findUnique({
    where: { sku },
    include: { variants: { where: { isActive: true }, orderBy: { createdAt: 'asc' } } }
  });
  if (!product || product.companyId !== businessId || product.branchId !== branchId || !product.isActive) {
    return null;
  }
  return buildProductForPush(prisma, branchId, product);
}

// ─── WooCommerce lookups (SKU is the join key on both sides) ────────────────

async function findWcProductBySku(client: WooCommerceClient, sku: string): Promise<WcProduct | null> {
  const found = await client.request<WcProduct[]>(
    'GET',
    `/products?sku=${encodeURIComponent(sku)}&per_page=1`
  );
  // Defensive: if the store ever ignored the sku filter, never update a
  // product whose SKU does not match — that would overwrite the wrong item.
  if (found.length > 0 && found[0].sku === sku) return found[0];
  return null;
}

async function findWcVariationBySku(
  client: WooCommerceClient,
  wcProductId: number,
  sku: string
): Promise<WcVariation | null> {
  const variations = await client.request<WcVariation[]>(
    'GET',
    `/products/${wcProductId}/variations?per_page=100`
  );
  return variations.find((v) => v.sku === sku) ?? null;
}

// ─── Outbound: push one product / one product's stock ────────────────────────

/**
 * Push a single Zapeera product to WooCommerce (create or update by SKU),
 * then its variants as variations (matched by SKU; variants without a
 * SKU are skipped — they cannot be matched on a later push or on an
 * order import — and reported in the returned note).
 */
export async function pushWooProduct(
  client: WooCommerceClient,
  product: ZapeeraProductForPush
): Promise<{ wcProductId: number; note?: string }> {
  if (product.unitPrice === null) {
    throw new Error(
      `no priced batch in this branch — give "${product.name}" (SKU ${product.sku}) a batch with a selling price first`
    );
  }
  const existing = await findWcProductBySku(client, product.sku);
  let wcProduct: WcProduct;
  if (existing) {
    wcProduct = await client.request<WcProduct>(
      'PUT',
      `/products/${existing.id}`,
      buildWooProductPayload(product)
    );
  } else {
    wcProduct = await client.request<WcProduct>('POST', '/products', buildWooProductPayload(product));
  }
  const skipped: string[] = [];
  for (const variant of product.variants) {
    if (!variant.sku) {
      skipped.push(variant.name);
      continue;
    }
    const payload = buildWooVariationPayload(product, variant);
    const existingVariation = await findWcVariationBySku(client, wcProduct.id, variant.sku);
    if (existingVariation) {
      await client.request('PUT', `/products/${wcProduct.id}/variations/${existingVariation.id}`, payload);
    } else {
      await client.request('POST', `/products/${wcProduct.id}/variations`, payload);
    }
  }
  return {
    wcProductId: wcProduct.id,
    note: skipped.length > 0 ? `variants without a SKU skipped: ${skipped.join(', ')}` : undefined
  };
}

export async function pushWooStock(client: WooCommerceClient, product: ZapeeraProductForPush): Promise<void> {
  const existing = await findWcProductBySku(client, product.sku);
  if (!existing) {
    throw new Error(
      `no WooCommerce product with SKU ${product.sku} — run the Products sync first so the product exists`
    );
  }
  if (product.variants.length === 0) {
    await client.request('PUT', `/products/${existing.id}`, {
      manage_stock: true,
      stock_quantity: product.stockQuantity
    });
    return;
  }
  for (const variant of product.variants) {
    if (!variant.sku) continue;
    const wcVariation = await findWcVariationBySku(client, existing.id, variant.sku);
    if (!wcVariation) {
      throw new Error(
        `no WooCommerce variation with SKU ${variant.sku} for "${product.name}" — run the Products sync first`
      );
    }
    await client.request('PUT', `/products/${existing.id}/variations/${wcVariation.id}`, {
      manage_stock: true,
      stock_quantity: variant.stockQuantity
    });
  }
}

// ─── Inbound: customers + order lines ────────────────────────────────────────

async function matchOrCreateCustomer(
  prisma: any,
  businessId: string,
  branchId: string,
  actorUserId: string,
  order: WcOrder
): Promise<string> {
  const phone = (order.billing?.phone || '').trim();
  const email = (order.billing?.email || '').trim();
  if (phone) {
    const byPhone = await prisma.customer.findFirst({ where: { companyId: businessId, phone } });
    if (byPhone) return byPhone.id;
  }
  if (email) {
    const byEmail = await prisma.customer.findFirst({ where: { companyId: businessId, email } });
    if (byEmail) return byEmail.id;
  }
  const name = wooCustomerName(order);
  const addressParts = [order.billing?.address_1, order.billing?.city].filter(Boolean);
  // Customer.phone is globally @unique: a phone that belongs to another
  // business's customer must never attach that customer here — so on a
  // unique clash we fall back to a per-order placeholder phone instead.
  const candidates = phone ? [phone, `${WOOCOMMERCE_CHANNEL}-order-${order.id}`] : [`${WOOCOMMERCE_CHANNEL}-order-${order.id}`];
  for (const candidatePhone of candidates) {
    try {
      const created = await prisma.customer.create({
        data: {
          name,
          phone: candidatePhone,
          email: email || null,
          address: addressParts.length > 0 ? addressParts.join(', ') : null,
          branchId,
          companyId: businessId,
          createdBy: actorUserId
        }
      });
      return created.id;
    } catch (error: any) {
      if (error?.code === 'P2002' && candidatePhone !== candidates[candidates.length - 1]) continue;
      throw error;
    }
  }
  throw new Error('Could not create a customer for this WooCommerce order.');
}

/**
 * Match every WooCommerce line to a Zapeera product in the BOUND branch
 * by SKU (variation lines also match their variant by variation SKU).
 * Any line that cannot be matched fails the WHOLE order — a partial sale
 * would silently drop items the customer paid for. No sale is created
 * for a failed order.
 */
async function matchOrderLines(
  prisma: any,
  client: WooCommerceClient,
  businessId: string,
  branchId: string,
  order: WcOrder
): Promise<MatchedWooLine[]> {
  const matched: MatchedWooLine[] = [];
  const unmatched: string[] = [];
  for (const line of order.line_items ?? []) {
    let lineError: string | null = null;
    let sku = (line.sku || '').trim();
    if (!sku) {
      try {
        const wcProduct = await client.request<WcProduct>('GET', `/products/${line.product_id}`);
        sku = (wcProduct.sku || '').trim();
      } catch {
        lineError = `${line.name} (WooCommerce product #${line.product_id} has no SKU)`;
      }
    }
    let product: any = null;
    if (!lineError) {
      product = await prisma.product.findUnique({
        where: { sku },
        select: { id: true, branchId: true, companyId: true, isActive: true, name: true }
      });
      if (!product || product.companyId !== businessId || product.branchId !== branchId || !product.isActive) {
        lineError = `${line.name} (SKU ${sku} is not a product of this branch)`;
      }
    }
    let variantId: string | null = null;
    if (!lineError && line.variation_id) {
      try {
        const wcVariation = await client.request<WcVariation>(
          'GET',
          `/products/${line.product_id}/variations/${line.variation_id}`
        );
        const variationSku = (wcVariation.sku || '').trim();
        if (!variationSku) {
          lineError = `${line.name} (variation has no SKU)`;
        } else {
          const variant = await prisma.productVariant.findFirst({
            where: { productId: product.id, companyId: businessId, sku: variationSku },
            select: { id: true, isActive: true }
          });
          if (!variant || !variant.isActive) {
            lineError = `${line.name} (variation SKU ${variationSku} is not a variant of this product)`;
          } else {
            variantId = variant.id;
          }
        }
      } catch {
        lineError = `${line.name} (variation #${line.variation_id} could not be read from WooCommerce)`;
      }
    }
    if (!lineError) {
      const unitPrice = parseWooMoney(line.price);
      if (unitPrice === null || unitPrice < 0 || !Number.isInteger(line.quantity) || line.quantity < 1) {
        lineError = `${line.name} (bad price or quantity in the WooCommerce order)`;
      } else {
        matched.push({ productId: product.id, variantId, quantity: line.quantity, unitPrice });
      }
    }
    if (lineError) unmatched.push(lineError);
  }
  if (unmatched.length > 0) {
    throw new IntegrationError(
      'SYNC_FAILED',
      `woocommerce: order #${order.id} was NOT imported — these lines cannot be matched to this branch's products: ${unmatched.join('; ')}. Fix the SKUs and re-sync; no sale was created.`
    );
  }
  if (matched.length === 0) {
    throw new IntegrationError(
      'SYNC_FAILED',
      `woocommerce: order #${order.id} has no importable lines, so no sale was created.`
    );
  }
  return matched;
}

// ─── Inbound: import one order (shared by importOrders + the webhook) ───────

// In-process per-business serialisation: two deliveries of the same order
// (webhook retry + manual sync) must never both pass the idempotency
// check and create two sales. This is a single-server lock — a
// multi-instance deployment would also need the Sale.uuid unique guard
// (see the P2002 branch below).
const importQueues = new Map<string, Promise<unknown>>();

function runSerialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = importQueues.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  importQueues.set(
    key,
    next.then(
      () => undefined,
      () => undefined
    )
  );
  return next;
}

export interface ImportWooOrderOutcome {
  /** Zapeera sale id, or null when the order was skipped (not importable). */
  saleId: string | null;
  alreadyImported: boolean;
  skippedReason?: string;
}

/**
 * Import ONE WooCommerce order as a Zapeera sale. Idempotent: a sale
 * whose uuid is "woocommerce:<orderId>" already exists → return it
 * without creating anything. The uuid tag is written right after
 * createSale commits (createSale's Joi schema rejects unknown fields,
 * so the tag cannot travel inside the payload).
 *
 * NOTE (no-schema-change mapping): Sale has no channel / externalOrderId
 * column, and Sale.uuid is otherwise unused by server code (verified by
 * grep — no server reader). A dedicated Sale.channel + externalOrderId
 * column pair is the cleaner follow-up; until then the uuid carries the
 * tag. If the sync engine ever starts treating Sale.uuid as a UUID,
 * revisit this.
 */
export async function importWooOrder(
  prisma: any,
  businessId: string,
  branchId: string,
  credentials: Record<string, unknown>,
  order: WcOrder
): Promise<ImportWooOrderOutcome> {
  return runSerialized(`${businessId}:${order.id}`, async () => {
    const tag = wooOrderReference(order.id);
    const existing = await prisma.sale.findUnique({
      where: { uuid: tag },
      select: { id: true, branchId: true, companyId: true }
    });
    if (existing) {
      if (existing.companyId !== businessId || existing.branchId !== branchId) {
        throw new IntegrationError(
          'SYNC_FAILED',
          `woocommerce: order #${order.id} was already imported into a different branch — refusing to import it here.`
        );
      }
      return { saleId: existing.id, alreadyImported: true };
    }
    if (!isImportableWooOrder(order)) {
      return { saleId: null, alreadyImported: false, skippedReason: `status "${order.status}" is not imported` };
    }
    const client = new WooCommerceClient(parseWooCredentials(credentials));
    const actor = await resolveSaleActor(prisma, businessId);
    const customerId = await matchOrCreateCustomer(prisma, businessId, branchId, actor.userId, order);
    const matchedLines = await matchOrderLines(prisma, client, businessId, branchId, order);
    const salePayload = buildSalePayloadFromWooOrder(order, matchedLines);
    const { status, body } = await saleInvoker.invokeCreateSale(actor, businessId, branchId, {
      customerId,
      ...salePayload
    });
    if (status !== 201 || !body?.success || !body?.data?.id) {
      const message =
        typeof body?.message === 'string' ? body.message : `sale engine returned HTTP ${status}`;
      throw new IntegrationError(
        'SYNC_FAILED',
        `woocommerce: order #${order.id} could not be imported — ${message}`
      );
    }
    const saleId = String(body.data.id);
    try {
      await prisma.sale.update({ where: { id: saleId }, data: { uuid: tag } });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        // A concurrent run (another process) tagged the same order first:
        // this sale is a duplicate. Report it plainly with the invoice
        // number so the owner can void it — never silently delete sales.
        throw new IntegrationError(
          'SYNC_FAILED',
          `woocommerce: order #${order.id} was imported twice by concurrent runs (invoice ${body.data.invoiceNumber ?? saleId} is the duplicate — please void it).`
        );
      }
      throw new IntegrationError(
        'SYNC_FAILED',
        `woocommerce: order #${order.id} created sale ${body.data.invoiceNumber ?? saleId} but the import tag could not be written (${error?.message ?? 'unknown error'}). Re-importing will duplicate it — check the sale first.`
      );
    }
    return { saleId, alreadyImported: false };
  });
}

// ─── The handler ─────────────────────────────────────────────────────────────

async function verifyCredentials(credentials: Record<string, unknown>): Promise<{ ok: boolean; message?: string }> {
  const parsed = parseWooCredentials(credentials);
  const client = new WooCommerceClient(parsed);
  await client.request<unknown[]>('GET', '/products?per_page=1');
  return { ok: true, message: 'WooCommerce store reachable.' };
}

export const woocommerceHandler: IntegrationSyncHandler = {
  provider: 'woocommerce',

  async connect(credentials) {
    return verifyCredentials(credentials);
  },

  // WooCommerce REST API keys cannot be revoked through the API — they
  // are deleted in WP Admin → WooCommerce → Settings → Advanced → REST
  // API. The framework wipes the stored credentials regardless.
  async disconnect() {
    return undefined;
  },

  async getStatus(credentials) {
    return verifyCredentials(credentials);
  },

  async syncProducts(ctx: IntegrationSyncContext): Promise<IntegrationSyncResult> {
    const branch = await resolveBoundBranch(ctx.prisma, ctx.businessId, ctx.config);
    const client = new WooCommerceClient(parseWooCredentials(ctx.credentials));
    const products = await loadProductsForPush(ctx.prisma, ctx.businessId, branch.id);
    let processed = 0;
    let failed = 0;
    const failures: string[] = [];
    const notes: string[] = [];
    for (const product of products) {
      try {
        const { note } = await pushWooProduct(client, product);
        processed += 1;
        if (note) notes.push(`${product.name}: ${note}`);
      } catch (error: any) {
        failed += 1;
        failures.push(`${product.name} (SKU ${product.sku}): ${error?.message ?? 'unknown error'}`);
      }
    }
    return {
      recordsProcessed: processed,
      recordsFailed: failed,
      message:
        `Pushed ${processed} product(s) to WooCommerce for branch "${branch.name}"` +
        (failed > 0 ? `; ${failed} failed: ${failures.slice(0, 5).join('; ')}` : '') +
        (notes.length > 0 ? ` — ${notes.slice(0, 5).join('; ')}` : '')
    };
  },

  async syncStock(ctx: IntegrationSyncContext): Promise<IntegrationSyncResult> {
    const branch = await resolveBoundBranch(ctx.prisma, ctx.businessId, ctx.config);
    const client = new WooCommerceClient(parseWooCredentials(ctx.credentials));
    const products = await loadProductsForPush(ctx.prisma, ctx.businessId, branch.id);
    let processed = 0;
    let failed = 0;
    const failures: string[] = [];
    for (const product of products) {
      try {
        await pushWooStock(client, product);
        processed += 1;
      } catch (error: any) {
        failed += 1;
        failures.push(`${product.name} (SKU ${product.sku}): ${error?.message ?? 'unknown error'}`);
      }
    }
    return {
      recordsProcessed: processed,
      recordsFailed: failed,
      message:
        `Pushed stock for ${processed} product(s) to WooCommerce for branch "${branch.name}"` +
        (failed > 0 ? `; ${failed} failed: ${failures.slice(0, 5).join('; ')}` : '')
    };
  },

  async importOrders(ctx: IntegrationSyncContext): Promise<IntegrationSyncResult> {
    const branch = await resolveBoundBranch(ctx.prisma, ctx.businessId, ctx.config);
    const client = new WooCommerceClient(parseWooCredentials(ctx.credentials));
    // Statuses are also filtered client-side (isImportableWooOrder) —
    // the query param only shrinks the download.
    const orders = await client.listAll<WcOrder>('/orders', {
      status: 'processing,completed',
      orderby: 'date',
      order: 'desc'
    });
    let processed = 0;
    let failed = 0;
    let already = 0;
    let skipped = 0;
    const failures: string[] = [];
    for (const order of orders) {
      try {
        const outcome = await importWooOrder(ctx.prisma, ctx.businessId, branch.id, ctx.credentials, order);
        if (outcome.alreadyImported) already += 1;
        else if (outcome.saleId) processed += 1;
        else skipped += 1;
      } catch (error: any) {
        failed += 1;
        failures.push(
          `order #${order.id}: ${error instanceof IntegrationError ? error.message : error?.message ?? 'unknown error'}`
        );
      }
    }
    return {
      recordsProcessed: processed,
      recordsFailed: failed,
      message:
        `Imported ${processed} WooCommerce order(s) as sales for branch "${branch.name}"` +
        (already > 0 ? `; ${already} already imported` : '') +
        (skipped > 0 ? `; ${skipped} skipped (not importable)` : '') +
        (failed > 0 ? `; ${failed} failed: ${failures.slice(0, 5).join(' | ')}` : '')
    };
  }
};

registerIntegrationHandler(woocommerceHandler);
