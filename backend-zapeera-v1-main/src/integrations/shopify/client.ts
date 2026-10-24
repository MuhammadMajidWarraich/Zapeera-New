// ─── Shopify integration — Admin API client (feature/integration-shopify) ──
// GraphQL-first Admin API client. Every call goes through withVendorRetry
// + mapVendorError (framework §6); nothing here ever logs credentials.
//
// ENDPOINTS (verified against shopify.dev docs 2026-10-24; see
// ~/workspace/zapeera/integrations/API_RESEARCH_2026-10-24.md §1):
//   Admin API base: https://{shop}.myshopify.com/admin/api/2026-04/graphql.json
//   Auth: X-Shopify-Access-Token (offline Admin API access token, shpat_…)
//   Products:  productCreate (initial variant only) + productVariantsBulkCreate
//              (strategy REMOVE_STANDALONE_VARIANT) for creates;
//              productUpdate + productVariantsBulkUpdate for updates.
//              Variant SKU lives in inventoryItem.sku; inventory at create
//              goes in inventoryQuantities [{locationId, availableQuantity}]
//              (InventoryLevelInput — create-only, NOT accepted by bulk update).
//   Inventory: inventorySetQuantities (absolute set; 2026-04 REQUIRES the
//              @idempotent directive + an explicit changeFromQuantity per
//              quantity — null opts out of the compare-and-swap check).
//   Orders:    orders query (status:open, sortKey CREATED_AT) + order query.
//   Locations: locations query (first location = the store's default).
// REST is NOT used for the Admin API. The only REST call in this
// integration is the OAuth token exchange (POST /admin/oauth/access_token),
// which Shopify documents as a REST endpoint (see ./oauth.ts).
//
// API VERSION: pinned to 2026-04 — the newest version whose
// inventorySetQuantities idempotency + changeFromQuantity rules are
// confirmed in the public docs (see the InventoryAdjustmentGroup doc:
// "@idempotent required as of 2026-04; changeFromQuantity mandatory,
// null opts out"). Bump only after re-checking the docs.
import { IntegrationError, mapVendorError, withVendorRetry } from '../vendor-client';

export const SHOPIFY_API_VERSION = '2026-04';

/** Access scopes this integration needs (requested at OAuth install). */
export const SHOPIFY_SCOPES = [
  'read_products',
  'write_products',
  'read_inventory',
  'write_inventory',
  'read_orders',
  'read_customers',
  'read_fulfillments',
  'read_locations'
].join(',');

export interface ShopifyCredentials {
  shopDomain: string;
  accessToken: string;
  /** Optional override: a Shopify location GID to stock into. */
  locationId?: string;
}

export interface ShopifyMoney {
  amount: string;
  currencyCode: string;
}

export interface ShopifyVariant {
  id: string;
  sku: string | null;
  price: string;
  barcode: string | null;
  inventoryItem: { id: string } | null;
}

export interface ShopifyProduct {
  id: string;
  title: string;
  status: string;
  variants: ShopifyVariant[];
}

export interface ShopifyLocation {
  id: string;
  name: string;
}

export interface ShopifyOrderCustomer {
  id: string | null;
  email: string | null;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string | null;
}

export interface ShopifyOrderLineItem {
  id: string;
  title: string;
  sku: string | null;
  quantity: number;
  originalUnitPrice: number;
  discountedUnitPrice: number;
  totalDiscount: number;
  variantId: string | null;
  variantSku: string | null;
  productId: string | null;
}

export interface ShopifyOrder {
  id: string;
  /** Numeric order id (the REST id / the number in the GID). */
  numericId: string;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  financialStatus: string;
  fulfillmentStatus: string | null;
  currencyCode: string;
  subtotal: number;
  totalDiscounts: number;
  totalTax: number;
  totalShipping: number;
  total: number;
  totalOutstanding: number;
  totalRefunded: number;
  paymentGatewayNames: string[];
  email: string | null;
  customer: ShopifyOrderCustomer | null;
  lineItems: ShopifyOrderLineItem[];
  fulfillments: Array<{ status: string; trackingNumber: string | null; trackingCompany: string | null }>;
  refundsTotal: number;
}

const GID_RE = /^gid:\/\/shopify\/\w+\/(\d+)$/;

/** Numeric id from a Shopify GID ("gid://shopify/Order/123" -> "123"). */
export function shopifyGidToId(gid: string | null | undefined): string | null {
  if (!gid) return null;
  const match = GID_RE.exec(gid);
  return match ? match[1] : null;
}

/** GID from a type + numeric id ("Order", "123" -> "gid://shopify/Order/123"). */
export function shopifyIdToGid(type: string, id: string | number): string {
  return `gid://shopify/${type}/${id}`;
}

/**
 * Normalize a merchant-typed shop domain to its canonical
 * "<subdomain>.myshopify.com" form. Accepts a pasted URL or a bare
 * domain; anything else is a vendor error (never a guess).
 */
export function normalizeShopDomain(input: unknown): string {
  const raw = String(input ?? '').trim().toLowerCase();
  const withoutScheme = raw.replace(/^https?:\/\//, '');
  const host = withoutScheme.split('/')[0].split('?')[0].replace(/\.+$/, '');
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(host)) {
    throw new IntegrationError(
      'VENDOR_ERROR',
      'shopify: the shop domain must look like "mystore.myshopify.com".'
    );
  }
  return host;
}

/** Pull + validate the credentials this module needs. Never logs values. */
export function requireShopifyCredentials(
  credentials: Record<string, unknown>
): ShopifyCredentials {
  const shopDomain = normalizeShopDomain(credentials.shopDomain);
  const accessToken = String(credentials.accessToken ?? '').trim();
  if (!accessToken) {
    throw new IntegrationError(
      'VENDOR_ERROR',
      'shopify: an Admin API access token is required. Connect with OAuth or paste a custom-app token.'
    );
  }
  const locationId =
    typeof credentials.locationId === 'string' && credentials.locationId.trim() !== ''
      ? credentials.locationId.trim()
      : undefined;
  return { shopDomain, accessToken, locationId };
}

function adminGraphqlUrl(shopDomain: string): string {
  return `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
}

function moneyAmount(money: { amount?: string | number | null } | null | undefined): number {
  const n = Number(money?.amount ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/**
 * One GraphQL call. HTTP errors are thrown as status-carrying errors so
 * withVendorRetry/mapVendorError classifies them (401/403 -> VENDOR_AUTH,
 * 429 -> VENDOR_RATE_LIMIT, 5xx/network -> retryable). A 200 with a
 * top-level `errors` array is a vendor error, not a retryable failure.
 */
export async function shopifyGraphQL<T = any>(
  creds: ShopifyCredentials,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  return withVendorRetry('shopify', async (signal) => {
    let res: Response;
    try {
      res = await fetch(adminGraphqlUrl(creds.shopDomain), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Shopify-Access-Token': creds.accessToken
        },
        body: JSON.stringify({ query, variables: variables ?? {} }),
        signal
      });
    } catch (error) {
      throw mapVendorError(error, 'shopify');
    }
    if (!res.ok) {
      const error = new Error(`Shopify Admin API HTTP ${res.status}`) as Error & {
        status?: number;
        response?: { status: number };
      };
      error.status = res.status;
      error.response = { status: res.status };
      throw error;
    }
    const json: any = await res.json();
    if (Array.isArray(json?.errors) && json.errors.length > 0) {
      const first = json.errors[0];
      throw new IntegrationError(
        'VENDOR_ERROR',
        `shopify: ${String(first?.message ?? 'the vendor rejected this request').slice(0, 200)}`
      );
    }
    return json.data as T;
  });
}

/** A mutation's userErrors array -> throw (a 200 with failed work). */
export function assertNoUserErrors(
  payload: { userErrors?: Array<{ field?: string[] | null; message?: string }> } | null | undefined,
  what: string
): void {
  const errors = payload?.userErrors ?? [];
  if (errors.length > 0) {
    const detail = errors
      .map((e) => e.message || 'unknown error')
      .slice(0, 3)
      .join('; ');
    throw new IntegrationError('VENDOR_ERROR', `shopify: ${what} failed — ${detail}`.slice(0, 400));
  }
}

// ─── Cheap verification read (connect / getStatus) ─────────────────────────

export async function fetchShop(creds: ShopifyCredentials): Promise<{
  id: string;
  name: string;
  myshopifyDomain: string;
}> {
  const data = await shopifyGraphQL<{ shop: { id: string; name: string; myshopifyDomain: string } }>(
    creds,
    `query { shop { id name myshopifyDomain } }`
  );
  if (!data?.shop?.id) {
    throw new IntegrationError('VENDOR_ERROR', 'shopify: the shop could not be read with these credentials.');
  }
  return data.shop;
}

// ─── Locations ────────────────────────────────────────────────────────────

export async function fetchLocations(creds: ShopifyCredentials): Promise<ShopifyLocation[]> {
  const data = await shopifyGraphQL<{
    locations: { edges: Array<{ node: ShopifyLocation }> };
  }>(
    creds,
    `query { locations(first: 10) { edges { node { id name } } } }`
  );
  return (data?.locations?.edges ?? []).map((e) => e.node).filter((l) => l?.id);
}

/**
 * The location Zapeera stocks into: the credentials' locationId override
 * when set, else the store's first location. One Zapeera branch maps to
 * one Shopify location — a multi-location store uses the first unless
 * the merchant sets the override (see SHOPIFY_SETUP.md).
 */
export async function resolveLocationId(creds: ShopifyCredentials): Promise<string> {
  if (creds.locationId) return creds.locationId;
  const locations = await fetchLocations(creds);
  if (locations.length === 0) {
    throw new IntegrationError(
      'VENDOR_ERROR',
      'shopify: this store has no locations to stock into. Create a location in Shopify first.'
    );
  }
  return locations[0].id;
}

// ─── Products (read: paginated list, matched client-side by SKU) ──────────
// The SKU is the join key between Zapeera and Shopify (Zapeera Product.sku
// is globally unique). We list products and match in code rather than
// relying on Shopify's `sku:` search filter, so a filter-syntax change
// can never silently miss a product.

const PRODUCTS_PAGE_QUERY = `
  query ListProducts($after: String) {
    products(first: 250, after: $after) {
      edges {
        node {
          id title status
          variants(first: 100) {
            edges { node { id sku price barcode inventoryItem { id } } }
          }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

interface ProductsPageResponse {
  products: {
    edges: Array<{ node: any }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

interface OrdersPageResponse {
  orders: {
    edges: Array<{ node: any }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
}

export async function listShopifyProducts(
  creds: ShopifyCredentials,
  maxProducts = 1000
): Promise<ShopifyProduct[]> {
  const products: ShopifyProduct[] = [];
  let after: string | null = null;
  for (;;) {
    const data: ProductsPageResponse = await shopifyGraphQL<ProductsPageResponse>(creds, PRODUCTS_PAGE_QUERY, { after });
    for (const edge of data?.products?.edges ?? []) {
      const node = edge.node;
      products.push({
        id: node.id,
        title: node.title,
        status: node.status,
        variants: (node.variants?.edges ?? []).map((v: any) => ({
          id: v.node.id,
          sku: v.node.sku ?? null,
          price: v.node.price ?? '0',
          barcode: v.node.barcode ?? null,
          inventoryItem: v.node.inventoryItem ?? null
        }))
      });
    }
    if (!data?.products?.pageInfo?.hasNextPage || products.length >= maxProducts) break;
    after = data.products.pageInfo.endCursor;
  }
  return products;
}

/** Index of Shopify variants by SKU (first match wins; SKUs are the join key). */
export function indexShopifyVariantsBySku(
  products: ShopifyProduct[]
): Map<string, { product: ShopifyProduct; variant: ShopifyVariant }> {
  const bySku = new Map<string, { product: ShopifyProduct; variant: ShopifyVariant }>();
  for (const product of products) {
    for (const variant of product.variants) {
      if (variant.sku && !bySku.has(variant.sku)) {
        bySku.set(variant.sku, { product, variant });
      }
    }
  }
  return bySku;
}

// ─── Products (write) ─────────────────────────────────────────────────────

export interface ShopifyVariantInput {
  /** Shopify variant GID — set for updates, omitted for creates. */
  id?: string;
  /** [{ optionName, name }] — max 3 options (Shopify limit). */
  optionValues?: Array<{ optionName: string; name: string }>;
  price: string;
  barcode?: string | null;
  /** SKU + tracked flag (SKU lives under inventoryItem in bulk inputs). */
  sku?: string | null;
  /** Create-only: stock this variant at the location in the same call. */
  inventoryQuantities?: Array<{ locationId: string; availableQuantity: number }>;
}

function variantInputForGraphQL(v: ShopifyVariantInput): Record<string, unknown> {
  const input: Record<string, unknown> = {
    price: v.price,
    inventoryItem: { sku: v.sku ?? undefined, tracked: true }
  };
  if (v.id) input.id = v.id;
  if (v.optionValues && v.optionValues.length > 0) input.optionValues = v.optionValues;
  if (v.barcode) input.barcode = v.barcode;
  // inventoryQuantities is accepted by productVariantsBulkCreate ONLY —
  // bulk update rejects it (docs: "Supported as input with the
  // productVariantsBulkCreate mutation only"), so callers pass it only
  // on creates and use inventorySetQuantities for updates.
  if (v.inventoryQuantities) input.inventoryQuantities = v.inventoryQuantities;
  return input;
}

export async function createShopifyProduct(
  creds: ShopifyCredentials,
  input: { title: string; descriptionHtml?: string; vendor?: string; tags?: string[] }
): Promise<ShopifyProduct> {
  const data = await shopifyGraphQL<{
    productCreate: { product: { id: string; title: string; status: string } | null; userErrors: any[] };
  }>(
    creds,
    `mutation ProductCreate($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product { id title status }
        userErrors { field message }
      }
    }`,
    {
      product: {
        title: input.title,
        descriptionHtml: input.descriptionHtml ?? undefined,
        vendor: input.vendor ?? undefined,
        status: 'ACTIVE',
        tags: input.tags ?? ['zapeera']
      }
    }
  );
  assertNoUserErrors(data?.productCreate, 'product create');
  const product = data?.productCreate?.product;
  if (!product?.id) {
    throw new IntegrationError('VENDOR_ERROR', 'shopify: product create returned no product.');
  }
  return { ...product, variants: [] };
}

export async function updateShopifyProduct(
  creds: ShopifyCredentials,
  productId: string,
  input: { title: string; descriptionHtml?: string; vendor?: string }
): Promise<void> {
  const data = await shopifyGraphQL<{
    productUpdate: { product: { id: string } | null; userErrors: any[] };
  }>(
    creds,
    `mutation ProductUpdate($input: ProductUpdateInput!) {
      productUpdate(input: $input) {
        product { id }
        userErrors { field message }
      }
    }`,
    { input: { id: productId, title: input.title, descriptionHtml: input.descriptionHtml ?? undefined, vendor: input.vendor ?? undefined } }
  );
  assertNoUserErrors(data?.productUpdate, 'product update');
}

export async function bulkCreateVariants(
  creds: ShopifyCredentials,
  productId: string,
  variants: ShopifyVariantInput[],
  strategy?: 'REMOVE_STANDALONE_VARIANT'
): Promise<ShopifyVariant[]> {
  const data = await shopifyGraphQL<{
    productVariantsBulkCreate: {
      productVariants: Array<{ id: string; sku: string | null; price: string; inventoryItem: { id: string } | null }>;
      userErrors: any[];
    };
  }>(
    creds,
    `mutation VariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!, $strategy: ProductVariantsBulkCreateStrategy) {
      productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: $strategy) {
        productVariants { id sku price inventoryItem { id } }
        userErrors { field message }
      }
    }`,
    {
      productId,
      variants: variants.map(variantInputForGraphQL),
      // Only set when the caller just created the product: replace the
      // standalone default variant productCreate made with the real
      // variants (docs' recommended create flow). On the update path
      // the strategy is omitted — existing variants are kept.
      strategy
    }
  );
  assertNoUserErrors(data?.productVariantsBulkCreate, 'variant create');
  return (data?.productVariantsBulkCreate?.productVariants ?? []).map((v) => ({
    id: v.id,
    sku: v.sku,
    price: v.price,
    barcode: null,
    inventoryItem: v.inventoryItem
  }));
}

export async function bulkUpdateVariants(
  creds: ShopifyCredentials,
  productId: string,
  variants: ShopifyVariantInput[]
): Promise<ShopifyVariant[]> {
  const data = await shopifyGraphQL<{
    productVariantsBulkUpdate: {
      productVariants: Array<{ id: string; sku: string | null; price: string; inventoryItem: { id: string } | null }>;
      userErrors: any[];
    };
  }>(
    creds,
    `mutation VariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id sku price inventoryItem { id } }
        userErrors { field message }
      }
    }`,
    { productId, variants: variants.map(variantInputForGraphQL) }
  );
  assertNoUserErrors(data?.productVariantsBulkUpdate, 'variant update');
  return (data?.productVariantsBulkUpdate?.productVariants ?? []).map((v) => ({
    id: v.id,
    sku: v.sku,
    price: v.price,
    barcode: null,
    inventoryItem: v.inventoryItem
  }));
}

// ─── Inventory (absolute set) ─────────────────────────────────────────────

export async function setInventoryQuantities(
  creds: ShopifyCredentials,
  items: Array<{ inventoryItemId: string; locationId: string; quantity: number }>,
  idempotencyKey: string
): Promise<void> {
  if (items.length === 0) return;
  const data = await shopifyGraphQL<{
    inventorySetQuantities: {
      inventoryAdjustmentGroup: { id: string } | null;
      userErrors: any[];
    };
  }>(
    creds,
    `mutation InventorySetQuantities($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
      inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
        inventoryAdjustmentGroup { id }
        userErrors { field message code }
      }
    }`,
    {
      input: {
        name: 'available',
        reason: 'correction',
        referenceDocumentUri: 'https://zapeera.seikho.online/integrations/shopify',
        quantities: items.map((item) => ({
          inventoryItemId: item.inventoryItemId,
          locationId: item.locationId,
          quantity: Math.max(0, Math.floor(item.quantity)),
          // Zapeera is the source of truth for stock: opt out of the
          // compare-and-swap check (null = skip; mandatory to pass
          // explicitly as of API 2026-04).
          changeFromQuantity: null
        }))
      },
      idempotencyKey
    }
  );
  assertNoUserErrors(data?.inventorySetQuantities, 'inventory set');
}

// ─── Orders (read) ────────────────────────────────────────────────────────

const ORDER_FRAGMENT = `
  id name createdAt cancelledAt
  financialStatus fulfillmentStatus
  currencyCode: presentmentCurrencyCode
  subtotalPriceSet { shopMoney { amount } }
  totalDiscountsSet { shopMoney { amount } }
  totalTaxSet { shopMoney { amount } }
  totalShippingPriceSet { shopMoney { amount } }
  totalPriceSet { shopMoney { amount } }
  totalOutstandingSet { shopMoney { amount } }
  totalRefundedSet { shopMoney { amount } }
  paymentGatewayNames
  email
  customer { id email phone firstName lastName displayName }
  lineItems(first: 50) {
    edges { node {
      id title sku quantity
      originalUnitPriceSet { shopMoney { amount } }
      discountedUnitPriceSet { shopMoney { amount } }
      totalDiscountSet { shopMoney { amount } }
      variant { id sku }
      product { id }
    } }
  }
  fulfillments(first: 10) {
    status trackingInfo { number company }
  }
  refunds(first: 10) {
    totalRefundedSet { shopMoney { amount } }
  }
`;

function mapOrderNode(node: any): ShopifyOrder {
  return {
    id: node.id,
    numericId: shopifyGidToId(node.id) ?? String(node.id),
    name: node.name ?? '',
    createdAt: node.createdAt,
    cancelledAt: node.cancelledAt ?? null,
    financialStatus: node.financialStatus ?? 'PENDING',
    fulfillmentStatus: node.fulfillmentStatus ?? null,
    currencyCode: node.currencyCode ?? 'PKR',
    subtotal: moneyAmount(node.subtotalPriceSet?.shopMoney),
    totalDiscounts: moneyAmount(node.totalDiscountsSet?.shopMoney),
    totalTax: moneyAmount(node.totalTaxSet?.shopMoney),
    totalShipping: moneyAmount(node.totalShippingPriceSet?.shopMoney),
    total: moneyAmount(node.totalPriceSet?.shopMoney),
    totalOutstanding: moneyAmount(node.totalOutstandingSet?.shopMoney),
    totalRefunded: moneyAmount(node.totalRefundedSet?.shopMoney),
    paymentGatewayNames: node.paymentGatewayNames ?? [],
    email: node.email ?? null,
    customer: node.customer
      ? {
          id: node.customer.id ?? null,
          email: node.customer.email ?? null,
          phone: node.customer.phone ?? null,
          firstName: node.customer.firstName ?? null,
          lastName: node.customer.lastName ?? null,
          displayName: node.customer.displayName ?? null
        }
      : null,
    lineItems: (node.lineItems?.edges ?? []).map((e: any) => {
      const item = e.node;
      return {
        id: item.id,
        title: item.title ?? '',
        sku: item.sku ?? item.variant?.sku ?? null,
        quantity: Number(item.quantity ?? 0),
        originalUnitPrice: moneyAmount(item.originalUnitPriceSet?.shopMoney),
        discountedUnitPrice: moneyAmount(item.discountedUnitPriceSet?.shopMoney),
        totalDiscount: moneyAmount(item.totalDiscountSet?.shopMoney),
        variantId: item.variant?.id ?? null,
        variantSku: item.variant?.sku ?? null,
        productId: item.product?.id ?? null
      };
    }),
    fulfillments: (node.fulfillments ?? []).map((f: any) => ({
      status: f.status ?? '',
      trackingNumber: f.trackingInfo?.number ?? null,
      trackingCompany: f.trackingInfo?.company ?? null
    })),
    refundsTotal: (node.refunds ?? []).reduce(
      (sum: number, r: any) => sum + moneyAmount(r.totalRefundedSet?.shopMoney),
      0
    )
  };
}

/**
 * Recent open orders, newest first (cancelled/archived excluded by the
 * `status:open` filter). Bounded: at most `maxOrders` per run.
 */
export async function listShopifyOrders(
  creds: ShopifyCredentials,
  maxOrders = 250
): Promise<ShopifyOrder[]> {
  const orders: ShopifyOrder[] = [];
  let after: string | null = null;
  for (;;) {
    const data: OrdersPageResponse = await shopifyGraphQL<OrdersPageResponse>(
      creds,
      `query ListOrders($after: String) {
        orders(first: 50, after: $after, sortKey: CREATED_AT, reverse: true, query: "status:open") {
          edges { node { ${ORDER_FRAGMENT} } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { after }
    );
    for (const edge of data?.orders?.edges ?? []) orders.push(mapOrderNode(edge.node));
    if (!data?.orders?.pageInfo?.hasNextPage || orders.length >= maxOrders) break;
    after = data.orders.pageInfo.endCursor;
  }
  return orders;
}

/** One order by GID (used by the orders/create webhook). Null when gone. */
export async function fetchShopifyOrder(
  creds: ShopifyCredentials,
  orderGid: string
): Promise<ShopifyOrder | null> {
  const data = await shopifyGraphQL<{ order: any }>(
    creds,
    `query FetchOrder($id: ID!) { order(id: $id) { ${ORDER_FRAGMENT} } }`,
    { id: orderGid }
  );
  return data?.order ? mapOrderNode(data.order) : null;
}

// ─── Inventory item lookup (inventory_levels/update webhook) ──────────────

/**
 * Resolve an inventory item to its variant SKU + current available
 * quantity at a location. Used to reconcile a Shopify-side stock change
 * against Zapeera's level for the same variant.
 */
export async function fetchInventoryItem(
  creds: ShopifyCredentials,
  inventoryItemGid: string,
  locationGid: string
): Promise<{ sku: string | null; available: number | null }> {
  const numericId = shopifyGidToId(inventoryItemGid) ?? inventoryItemGid;
  const data = await shopifyGraphQL<{
    inventoryItems: {
      edges: Array<{
        node: {
          variant: { sku: string | null } | null;
          inventoryLevel: { quantities: Array<{ quantity: number }> } | null;
        };
      }>;
    };
  }>(
    creds,
    `query FetchInventoryItem($query: String!, $locationId: ID!) {
      inventoryItems(first: 1, query: $query) {
        edges { node {
          variant { sku }
          inventoryLevel(locationId: $locationId) { quantities(names: ["available"]) { quantity } }
        } }
      }
    }`,
    { query: `id:${numericId}`, locationId: locationGid }
  );
  const node = data?.inventoryItems?.edges?.[0]?.node;
  return {
    sku: node?.variant?.sku ?? null,
    available: node?.inventoryLevel?.quantities?.[0]?.quantity ?? null
  };
}
