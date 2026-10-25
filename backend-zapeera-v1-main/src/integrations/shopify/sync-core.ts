// ─── Shopify integration — sync core (feature/integration-shopify) ───────
// The shared sync/import logic used by the handler (manual syncs) and by
// the webhook receiver (single-order import, inventory reconcile).
//
// TENANCY — one Shopify store maps to ONE Zapeera branch, enforced here:
// every product/batch/customer/sale query in this file is scoped to
// (businessId, branchId). Nothing in this module ever reads another
// branch's products or stock. The branch comes from the connection
// config (config.branchId) or, when unset, the business's first active
// branch — see resolveBranchId.
//
// SALES go through the EXISTING createSale handler (./sale-import.ts),
// never a parallel writer: imported sales decrement stock via the same
// FEFO batch path, get receipts/khata/loyalty/tax treatment, and are
// tagged channel='shopify' + externalOrderId=<Shopify numeric order id>
// inside the sale transaction (unique index backstop).
import { IntegrationError } from '../vendor-client';
import type { IntegrationSyncContext, IntegrationSyncResult } from '../types';
import {
  bulkCreateVariants,
  bulkUpdateVariants,
  createShopifyProduct,
  fetchShopifyOrder,
  indexShopifyVariantsBySku,
  listShopifyOrders,
  listShopifyProducts,
  requireShopifyCredentials,
  resolveLocationId,
  setInventoryQuantities,
  shopifyGidToId,
  updateShopifyProduct,
  type ShopifyOrder,
  type ShopifyProduct,
  type ShopifyVariantInput
} from './client';
import {
  buildShopifyVariantInput,
  mapOrderFinancials,
  mapPaymentMethod,
  normalizeCustomerPhone,
  shopifyCustomerName
} from './mapping';
import {
  createSaleThroughExistingPath,
  SaleImportError,
  type ImportedSaleInput,
  type SaleCreationFn
} from './sale-import';

export interface ShopifySyncDeps {
  /** Override the sale creator (tests inject a stub). Defaults to the real path. */
  createSale?: SaleCreationFn;
}

/** TEST-ONLY override for the sale creator (the handler interface carries
 * no deps, so tests cannot inject through it). Never set in production. */
let testSaleCreator: SaleCreationFn | null = null;
export function __setTestSaleCreator(fn: SaleCreationFn | null): void {
  testSaleCreator = fn;
}

function saleCreator(deps: ShopifySyncDeps): SaleCreationFn {
  return deps.createSale ?? testSaleCreator ?? createSaleThroughExistingPath;
}

// ─── Branch + owner resolution ────────────────────────────────────────────

/** The one branch this store maps to (config branchId, else first active branch). */
export async function resolveBranchId(
  prisma: any,
  businessId: string,
  config: IntegrationSyncContext['config']
): Promise<{ id: string; name: string }> {
  if (config?.branchId) {
    const branch = await prisma.branch.findFirst({
      where: { id: config.branchId, companyId: businessId },
      select: { id: true, name: true }
    });
    if (!branch) {
      throw new IntegrationError(
        'SYNC_FAILED',
        'shopify: the branch mapped to this store was not found in this business. Reconnect and pick a branch that exists.'
      );
    }
    return { id: branch.id, name: branch.name };
  }
  const branches = await prisma.branch.findMany({
    where: { companyId: businessId, isActive: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, name: true },
    take: 1
  });
  if (!branches || branches.length === 0) {
    throw new IntegrationError(
      'SYNC_FAILED',
      'shopify: this business has no active branch to map the store to. Create a branch first.'
    );
  }
  return { id: branches[0].id, name: branches[0].name };
}

/** The business owner — the actor (cashier) recorded on imported sales. */
export async function resolveOwnerUserId(prisma: any, businessId: string): Promise<string> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { createdBy: true }
  });
  if (!business?.createdBy) {
    throw new IntegrationError(
      'SYNC_FAILED',
      'shopify: the business owner could not be resolved, so imported sales have no cashier. Reconnect the store.'
    );
  }
  return String(business.createdBy);
}

// ─── Branch catalog (products + variants + batches, branch-scoped) ───────

export interface BranchCatalogVariant {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  attributes: Record<string, unknown> | null;
  priceDelta: number;
}

export interface BranchCatalogBatch {
  variantId: string | null;
  quantity: number;
  sellingPrice: number;
  createdAt: Date | string;
}

export interface BranchCatalogProduct {
  id: string;
  name: string;
  description: string | null;
  sku: string;
  barcode: string | null;
  categoryName: string | null;
  variants: BranchCatalogVariant[];
  batches: BranchCatalogBatch[];
}

export async function loadBranchCatalog(
  prisma: any,
  businessId: string,
  branchId: string
): Promise<BranchCatalogProduct[]> {
  const products = await prisma.product.findMany({
    where: { companyId: businessId, branchId, isActive: true },
    select: { id: true, name: true, description: true, sku: true, barcode: true, categoryId: true }
  });
  if (!products || products.length === 0) return [];
  const productIds = products.map((p: any) => p.id);
  const [variants, batches, categories] = await Promise.all([
    prisma.productVariant.findMany({
      where: { companyId: businessId, productId: { in: productIds }, isActive: true },
      select: {
        id: true,
        productId: true,
        name: true,
        sku: true,
        barcode: true,
        attributes: true,
        priceDelta: true
      }
    }),
    prisma.batch.findMany({
      where: { companyId: businessId, branchId, productId: { in: productIds }, isActive: true },
      select: { productId: true, variantId: true, quantity: true, sellingPrice: true, createdAt: true }
    }),
    prisma.category
      ? prisma.category.findMany({
          where: { companyId: businessId, id: { in: products.map((p: any) => p.categoryId).filter(Boolean) } },
          select: { id: true, name: true }
        })
      : []
  ]);
  const categoryName = new Map<string, string>(
    (categories ?? []).map((c: any) => [c.id, c.name])
  );
  const variantsByProduct = new Map<string, BranchCatalogVariant[]>();
  for (const v of variants ?? []) {
    const list = variantsByProduct.get(v.productId) ?? [];
    list.push({
      id: v.id,
      name: v.name,
      sku: v.sku ?? null,
      barcode: v.barcode ?? null,
      attributes: v.attributes ?? null,
      priceDelta: Number(v.priceDelta ?? 0)
    });
    variantsByProduct.set(v.productId, list);
  }
  const batchesByProduct = new Map<string, BranchCatalogBatch[]>();
  for (const b of batches ?? []) {
    const list = batchesByProduct.get(b.productId) ?? [];
    list.push({
      variantId: b.variantId ?? null,
      quantity: Number(b.quantity ?? 0),
      sellingPrice: Number(b.sellingPrice ?? 0),
      createdAt: b.createdAt
    });
    batchesByProduct.set(b.productId, list);
  }
  return products.map((p: any) => ({
    id: p.id,
    name: p.name,
    description: p.description ?? null,
    sku: p.sku,
    barcode: p.barcode ?? null,
    categoryName: categoryName.get(p.categoryId) ?? null,
    variants: variantsByProduct.get(p.id) ?? [],
    batches: batchesByProduct.get(p.id) ?? []
  }));
}

/** Latest active batch sellingPrice in a pool (null = no priced batch). */
export function poolPrice(batches: BranchCatalogBatch[], variantId: string | null): number | null {
  const priced = batches
    .filter((b) => (b.variantId ?? null) === (variantId ?? null) && b.sellingPrice > 0)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return priced.length > 0 ? priced[0].sellingPrice : null;
}

/** Stock in BASE units: plain sum of the pool's active batch quantities. */
export function poolStock(batches: BranchCatalogBatch[], variantId: string | null): number {
  return batches
    .filter((b) => (b.variantId ?? null) === (variantId ?? null))
    .reduce((sum, b) => sum + Math.max(0, b.quantity), 0);
}

/** A Zapeera variant's Shopify variant input (price/stock from its pool). */
function variantInputForCatalog(
  product: BranchCatalogProduct,
  variant: BranchCatalogVariant | null,
  locationId: string,
  forCreate: boolean
): { input: ShopifyVariantInput; droppedOptions: string[]; unpriced: boolean } {
  const poolBatches = product.batches;
  const variantPoolPrice = variant ? poolPrice(poolBatches, variant.id) : null;
  const basePoolPrice = poolPrice(poolBatches, null);
  const price = variant
    ? (variantPoolPrice ?? basePoolPrice)
    : basePoolPrice;
  if (price === null) return { input: { price: '0' }, droppedOptions: [], unpriced: true };
  const stock = poolStock(poolBatches, variant ? variant.id : null);
  const { variantInput, droppedOptions } = buildShopifyVariantInput({
    attributes: variant?.attributes ?? null,
    sku: variant ? variant.sku : product.sku,
    barcode: variant ? variant.barcode : product.barcode,
    poolPrice: price,
    priceDelta: variant ? variant.priceDelta : 0,
    stock,
    locationId,
    forCreate
  });
  return { input: variantInput, droppedOptions, unpriced: false };
}

// ─── syncProducts (out) ───────────────────────────────────────────────────

export async function syncShopifyProducts(
  ctx: IntegrationSyncContext
): Promise<IntegrationSyncResult> {
  if (!ctx.config?.syncProducts) {
    return {
      recordsProcessed: 0,
      recordsFailed: 0,
      message: 'Products sync is off for this connection — enable "Products" in Settings → Integrations → Shopify.'
    };
  }
  const creds = requireShopifyCredentials(ctx.credentials);
  const branch = await resolveBranchId(ctx.prisma, ctx.businessId, ctx.config);
  const locationId = await resolveLocationId(creds);
  const catalog = await loadBranchCatalog(ctx.prisma, ctx.businessId, branch.id);
  const shopifyProducts = await listShopifyProducts(creds);
  const byVariantSku = indexShopifyVariantsBySku(shopifyProducts);

  let processed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const product of catalog) {
    try {
      // Find the Shopify product via any of this product's SKUs.
      const skus = [product.sku, ...product.variants.map((v) => v.sku).filter(Boolean)] as string[];
      let shopifyProduct: ShopifyProduct | undefined;
      for (const sku of skus) {
        const hit = byVariantSku.get(sku);
        if (hit) {
          shopifyProduct = hit.product;
          break;
        }
      }

      // Variants without an SKU cannot be joined back reliably.
      const missingSku = product.variants.filter((v) => !v.sku);
      if (missingSku.length > 0) {
        throw new Error(
          `variant(s) without an SKU cannot sync: ${missingSku.map((v) => `"${v.name}"`).join(', ')}. Set an SKU on each variant in Zapeera first.`
        );
      }

      // Build every variant input (and validate pricing) BEFORE any
      // Shopify write — a product with an unpriced variant must fail
      // without leaving an orphaned half-created product behind.
      const dropped: string[] = [];
      const plannedInputs: ShopifyVariantInput[] = [];
      const plan = product.variants.length === 0 ? [null] : product.variants;
      for (const variant of plan as Array<BranchCatalogVariant | null>) {
        const built = variantInputForCatalog(product, variant, locationId, true);
        if (built.unpriced) {
          throw new Error(
            variant
              ? `variant "${variant.name}" has no priced batch in this branch — add stock with a selling price first.`
              : 'no priced batch in this branch — add stock with a selling price first.'
          );
        }
        plannedInputs.push(built.input);
        dropped.push(...built.droppedOptions);
      }

      if (!shopifyProduct) {
        // CREATE: product + variants (inventory set in the same bulk call).
        const created = await createShopifyProduct(creds, {
          title: product.name,
          descriptionHtml: product.description ?? undefined,
          tags: ['zapeera', ...(product.categoryName ? [product.categoryName] : [])]
        });
        await bulkCreateVariants(creds, created.id, plannedInputs, 'REMOVE_STANDALONE_VARIANT');
        processed += 1;
        if (dropped.length > 0) {
          failures.push(
            `${product.name}: pushed, but dropped extra options (${[...new Set(dropped)].join(', ')}) — Shopify allows 3 options per product.`
          );
        }
        continue;
      }

      // UPDATE: product fields, then split variants into update/create.
      await updateShopifyProduct(creds, shopifyProduct.id, {
        title: product.name,
        descriptionHtml: product.description ?? undefined
      });
      const existingBySku = new Map(
        shopifyProduct.variants.filter((v) => v.sku).map((v) => [v.sku as string, v])
      );
      const toUpdate: ShopifyVariantInput[] = [];
      const toCreate: ShopifyVariantInput[] = [];
      for (let i = 0; i < plannedInputs.length; i++) {
        const variant = (plan as Array<BranchCatalogVariant | null>)[i];
        const sku = variant ? variant.sku : product.sku;
        const input = plannedInputs[i];
        if (sku && existingBySku.has(sku)) {
          // Bulk update takes the variant id and no inventoryQuantities
          // (create-only) — stock is set explicitly below.
          toUpdate.push({ ...input, id: existingBySku.get(sku)?.id, inventoryQuantities: undefined });
        } else {
          toCreate.push({
            ...input,
            inventoryQuantities: [{ locationId, availableQuantity: Math.max(0, Math.floor(poolStock(product.batches, variant ? variant.id : null))) }]
          });
        }
      }
      if (toUpdate.length > 0) await bulkUpdateVariants(creds, shopifyProduct.id, toUpdate);
      if (toCreate.length > 0) await bulkCreateVariants(creds, shopifyProduct.id, toCreate);
      // Stock for updated variants is NOT set by bulk update
      // (inventoryQuantities is create-only) — set it explicitly.
      if (toUpdate.length > 0) {
        const items = toUpdate
          .map((input) => {
            const existing = existingBySku.get(input.sku as string);
            const variant = (plan as Array<BranchCatalogVariant | null>).find(
              (v) => (v ? v.sku : product.sku) === input.sku
            );
            return {
              inventoryItemId: existing?.inventoryItem?.id ?? '',
              locationId,
              quantity: poolStock(product.batches, variant ? variant.id : null)
            };
          })
          .filter((item) => item.inventoryItemId !== '');
        await setInventoryQuantities(
          creds,
          items,
          `zapeera-${ctx.logId}-product-${shopifyGidToId(shopifyProduct.id) ?? shopifyProduct.id}`
        );
      }
      processed += 1;
      if (dropped.length > 0) {
        failures.push(
          `${product.name}: pushed, but dropped extra options (${[...new Set(dropped)].join(', ')}) — Shopify allows 3 options per product.`
        );
      }
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : 'unknown error';
      failures.push(`${product.name}: ${message}`);
    }
  }

  const messageParts: string[] = [
    `${processed} product(s) pushed to Shopify (${branch.name} branch), ${failed} failed.`
  ];
  if (failures.length > 0) messageParts.push(failures.slice(0, 5).join(' | '));
  return { recordsProcessed: processed, recordsFailed: failed, message: messageParts.join(' ') };
}

// ─── syncStock (out) ──────────────────────────────────────────────────────

export async function syncShopifyStock(
  ctx: IntegrationSyncContext
): Promise<IntegrationSyncResult> {
  if (!ctx.config?.syncStock) {
    return {
      recordsProcessed: 0,
      recordsFailed: 0,
      message: 'Stock sync is off for this connection — enable "Stock levels" in Settings → Integrations → Shopify.'
    };
  }
  const creds = requireShopifyCredentials(ctx.credentials);
  const branch = await resolveBranchId(ctx.prisma, ctx.businessId, ctx.config);
  const locationId = await resolveLocationId(creds);
  const catalog = await loadBranchCatalog(ctx.prisma, ctx.businessId, branch.id);
  const shopifyProducts = await listShopifyProducts(creds);
  const byVariantSku = indexShopifyVariantsBySku(shopifyProducts);

  let processed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const product of catalog) {
    const plan = product.variants.length === 0 ? [null] : product.variants;
    for (const variant of plan as Array<BranchCatalogVariant | null>) {
      const sku = variant ? variant.sku : product.sku;
      const label = variant ? `${product.name} / ${variant.name}` : product.name;
      try {
        if (!sku) throw new Error('no SKU — set an SKU on the variant first.');
        const hit = byVariantSku.get(sku);
        if (!hit || !hit.variant.inventoryItem?.id) {
          throw new Error('not on Shopify yet — run a product sync first.');
        }
        const quantity = poolStock(product.batches, variant ? variant.id : null);
        await setInventoryQuantities(
          creds,
          [{ inventoryItemId: hit.variant.inventoryItem.id, locationId, quantity }],
          `zapeera-${ctx.logId}-stock-${shopifyGidToId(hit.variant.inventoryItem.id) ?? hit.variant.inventoryItem.id}`
        );
        processed += 1;
      } catch (error) {
        failed += 1;
        failures.push(`${label}: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
  }

  const messageParts: string[] = [
    `${processed} inventory level(s) pushed to Shopify (${branch.name} branch), ${failed} failed.`
  ];
  if (failures.length > 0) messageParts.push(failures.slice(0, 5).join(' | '));
  return { recordsProcessed: processed, recordsFailed: failed, message: messageParts.join(' ') };
}

// ─── importOrders (in) ────────────────────────────────────────────────────

export interface ImportShopifyOrderOutcome {
  /** A new Zapeera sale was created. */
  imported: boolean;
  /** The order was already imported earlier (idempotent skip). */
  alreadyImported: boolean;
  /** The order was skipped (e.g. cancelled) — not an error. */
  skipped: boolean;
  saleId?: string;
  invoiceNumber?: string | null;
  message: string;
}

export async function findImportedSale(
  prisma: any,
  businessId: string,
  externalOrderId: string
): Promise<any | null> {
  return prisma.sale.findFirst({
    where: { companyId: businessId, channel: 'shopify', externalOrderId }
  });
}

/**
 * Import ONE Shopify order as a Zapeera sale. Shared by the manual
 * importOrders run and the orders/create webhook. Idempotent: a sale
 * with this external order id is never created twice (pre-check +
 * the (companyId, channel, externalOrderId) unique index; a concurrent
 * duplicate surfaces as a re-check hit, not a second sale).
 */
export async function importShopifyOrder(
  prisma: any,
  businessId: string,
  creds: ReturnType<typeof requireShopifyCredentials>,
  order: ShopifyOrder,
  opts: {
    branchId: string;
    branchName: string;
    actorUserId: string;
    catalog: BranchCatalogProduct[];
    createSale?: SaleCreationFn;
  }
): Promise<ImportShopifyOrderOutcome> {
  const financials = mapOrderFinancials(order);
  if (financials.skip) {
    return { imported: false, alreadyImported: false, skipped: true, message: `Order ${order.name} skipped — ${financials.skipReason}.` };
  }

  const existing = await findImportedSale(prisma, businessId, order.numericId);
  if (existing) {
    return {
      imported: false,
      alreadyImported: true,
      skipped: false,
      saleId: existing.id,
      invoiceNumber: existing.invoiceNumber ?? null,
      message: `Order ${order.name} already imported as ${existing.invoiceNumber ?? existing.id}.`
    };
  }

  // ── Customer: match by phone, then email; create only when a phone
  // exists (Customer.phone is required + unique). Otherwise walk-in.
  let customerId: string | null = null;
  const phone = normalizeCustomerPhone(order.customer?.phone);
  const email = order.customer?.email?.trim() || order.email?.trim() || null;
  if (phone) {
    const byPhone = await prisma.customer.findFirst({
      where: { companyId: businessId, phone },
      select: { id: true }
    });
    if (byPhone) customerId = byPhone.id;
  }
  if (!customerId && email) {
    const byEmail = await prisma.customer.findFirst({
      where: { companyId: businessId, email },
      select: { id: true }
    });
    if (byEmail) customerId = byEmail.id;
  }
  if (!customerId && phone) {
    const created = await prisma.customer.create({
      data: {
        name: shopifyCustomerName(order.customer, 'Shopify customer'),
        phone,
        email: email ?? null,
        branchId: opts.branchId,
        companyId: businessId,
        createdBy: opts.actorUserId
      },
      select: { id: true }
    });
    customerId = created.id;
  }

  // ── Lines: resolve every Shopify SKU to a branch product/variant.
  // An unresolvable SKU fails the WHOLE order (a partial sale would
  // corrupt money + stock); free (0-price) lines are skipped, because
  // the sale path requires a positive unit price.
  const variantBySku = new Map<string, { product: BranchCatalogProduct; variant: BranchCatalogVariant }>();
  const productBySku = new Map<string, BranchCatalogProduct>();
  for (const product of opts.catalog) {
    productBySku.set(product.sku, product);
    for (const variant of product.variants) {
      if (variant.sku && !variantBySku.has(variant.sku)) {
        variantBySku.set(variant.sku, { product, variant });
      }
    }
  }
  const items: ImportedSaleInput['items'] = [];
  const skippedFree: string[] = [];
  for (const line of order.lineItems) {
    if (!line.sku) {
      return {
        imported: false,
        alreadyImported: false,
        skipped: false,
        message: `Order ${order.name} not imported — line "${line.title}" has no SKU, so it cannot be matched to a Zapeera product.`
      };
    }
    const variantHit = variantBySku.get(line.sku);
    const productHit = variantHit?.product ?? productBySku.get(line.sku);
    if (!productHit) {
      return {
        imported: false,
        alreadyImported: false,
        skipped: false,
        message: `Order ${order.name} not imported — SKU "${line.sku}" ("${line.title}") is not a product in the ${opts.branchName} branch. Add it to Zapeera first.`
      };
    }
    if (line.quantity < 1) continue;
    const unitPrice =
      line.discountedUnitPrice > 0 ? line.discountedUnitPrice : line.originalUnitPrice;
    if (unitPrice <= 0) {
      skippedFree.push(line.title);
      continue;
    }
    items.push({
      productId: productHit.id,
      variantId: variantHit ? variantHit.variant.id : null,
      quantity: Math.floor(line.quantity),
      unitPrice: Math.round(unitPrice * 100) / 100
    });
  }
  if (items.length === 0) {
    return {
      imported: false,
      alreadyImported: false,
      skipped: false,
      message: `Order ${order.name} not imported — no billable lines (${skippedFree.length > 0 ? 'all lines are free/zero-priced' : 'no lines'}).`
    };
  }

  const input: ImportedSaleInput = {
    businessId,
    branchId: opts.branchId,
    actorUserId: opts.actorUserId,
    customerId,
    items,
    paymentMethod: mapPaymentMethod(order.paymentGatewayNames, order.financialStatus),
    paymentStatus: financials.paymentStatus,
    paidAmount: financials.paidAmount,
    returnedAmount: financials.returnedAmount,
    discountAmount: financials.discountAmount,
    saleDate: order.createdAt,
    channel: 'shopify',
    externalOrderId: order.numericId
  };

  let created: { id: string; invoiceNumber?: string | null; totalAmount: number };
  try {
    created = await saleCreator({ createSale: opts.createSale })(input);
  } catch (error) {
    // A concurrent import may have won the race: the unique index
    // rejects the second create — re-check instead of duplicating.
    const raced = await findImportedSale(prisma, businessId, order.numericId);
    if (raced) {
      return {
        imported: false,
        alreadyImported: true,
        skipped: false,
        saleId: raced.id,
        invoiceNumber: raced.invoiceNumber ?? null,
        message: `Order ${order.name} already imported as ${raced.invoiceNumber ?? raced.id} (concurrent import).`
      };
    }
    const detail = error instanceof SaleImportError ? error.message : error instanceof Error ? error.message : 'unknown error';
    return {
      imported: false,
      alreadyImported: false,
      skipped: false,
      message: `Order ${order.name} not imported — ${detail}`
    };
  }

  // Money truth check: Zapeera recomputes the total with its own tax
  // engine and has no shipping field, so a Shopify order with tax or
  // shipping lands with a different total. Report the gap, don't hide it.
  const zapeeraTotal = created.totalAmount;
  const gap = Math.round((order.total - zapeeraTotal) * 100) / 100;
  const fulfillment = order.fulfillmentStatus ? ` Fulfillment: ${order.fulfillmentStatus}.` : '';
  const gapNote =
    Math.abs(gap) > 0.01
      ? ` Note: Shopify total PKR ${order.total.toFixed(2)} (incl. shipping PKR ${order.totalShipping.toFixed(2)} + tax PKR ${order.totalTax.toFixed(2)}) vs Zapeera sale PKR ${zapeeraTotal.toFixed(2)} — shipping/tax are not itemized on imported sales.`
      : '';
  const freeNote =
    skippedFree.length > 0
      ? ` ${skippedFree.length} free line(s) skipped (${skippedFree.join(', ')}) — Zapeera sales need a positive unit price.`
      : '';
  return {
    imported: true,
    alreadyImported: false,
    skipped: false,
    saleId: created.id,
    invoiceNumber: created.invoiceNumber ?? null,
    message: `Order ${order.name} imported as ${created.invoiceNumber ?? created.id}.${fulfillment}${gapNote}${freeNote}`
  };
}

export async function importShopifyOrders(
  ctx: IntegrationSyncContext,
  deps: ShopifySyncDeps = {}
): Promise<IntegrationSyncResult> {
  if (!ctx.config?.syncOrders) {
    return {
      recordsProcessed: 0,
      recordsFailed: 0,
      message: 'Order import is off for this connection — enable "Orders" in Settings → Integrations → Shopify.'
    };
  }
  const creds = requireShopifyCredentials(ctx.credentials);
  const branch = await resolveBranchId(ctx.prisma, ctx.businessId, ctx.config);
  const actorUserId = await resolveOwnerUserId(ctx.prisma, ctx.businessId);
  const catalog = await loadBranchCatalog(ctx.prisma, ctx.businessId, branch.id);
  const orders = await listShopifyOrders(creds);
  // Single-order fetch for orders the list missed (webhook parity): the
  // list is the source here; fetchShopifyOrder is used by webhooks.

  let imported = 0;
  let already = 0;
  let skipped = 0;
  let failed = 0;
  const notes: string[] = [];

  for (const order of orders) {
    const outcome = await importShopifyOrder(ctx.prisma, ctx.businessId, creds, order, {
      branchId: branch.id,
      branchName: branch.name,
      actorUserId,
      catalog,
      createSale: deps.createSale
    });
    if (outcome.imported) imported += 1;
    else if (outcome.alreadyImported) already += 1;
    else if (outcome.skipped) skipped += 1;
    else {
      failed += 1;
      notes.push(outcome.message);
    }
  }

  return {
    recordsProcessed: imported + already,
    recordsFailed: failed,
    message: [
      `${imported} order(s) imported into the ${branch.name} branch, ${already} already imported, ${skipped} skipped, ${failed} failed.`,
      ...notes.slice(0, 5)
    ].join(' ')
  };
}

// ─── Single-order fetch helper (webhooks) ─────────────────────────────────

export async function fetchAndImportShopifyOrder(
  prisma: any,
  businessId: string,
  creds: ReturnType<typeof requireShopifyCredentials>,
  orderGid: string,
  opts: { branchId: string; branchName: string; actorUserId: string; createSale?: SaleCreationFn }
): Promise<ImportShopifyOrderOutcome> {
  const order = await fetchShopifyOrder(creds, orderGid);
  if (!order) {
    return {
      imported: false,
      alreadyImported: false,
      skipped: true,
      message: `Shopify order ${orderGid} no longer exists — nothing to import.`
    };
  }
  const catalog = await loadBranchCatalog(prisma, businessId, opts.branchId);
  return importShopifyOrder(prisma, businessId, creds, order, { ...opts, catalog });
}
