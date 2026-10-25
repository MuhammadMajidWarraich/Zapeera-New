// ─── WooCommerce ↔ Zapeera mapping (feature/integration-woocommerce) ─────
// Pure functions only — no prisma, no fetch, no sale engine — so they are
// unit-testable without a store or a database. Vendor field shapes are
// from the WooCommerce REST API v3 docs
// (https://developer.woocommerce.com/docs/apis/rest-api/ + the v3
// reference): money arrives as DECIMAL STRINGS ("21.99"), ids are
// integers, order statuses are pending | processing | on-hold |
// completed | cancelled | refunded | failed.
//
// DIRECTIONS
//   out: Zapeera product (+ variants) → WooCommerce product (+ variations)
//   out: Zapeera branch stock (base units) → WooCommerce stock_quantity
//   in:  WooCommerce order → Zapeera sale (via the existing createSale
//        engine — see ./sale-invoker.ts, never a parallel writer)
//
// MAPPING RULES (the honest ones — see README.md for the full list)
//   · Products match by SKU on both sides (Zapeera Product.sku is
//     globally unique; WooCommerce enforces SKU uniqueness per store).
//   · Zapeera has no product-level price — the price pushed is the
//     sellingPrice of the FEFO batch the POS would sell (earliest-expiry
//     active batch with stock), falling back to the newest batch.
//   · Stock is counted in BASE units (Batch.quantity) — the base-unit
//     engine (unitsPerPack / unitsPerStrip) only describes packaging,
//     never the count.
//   · A WooCommerce order line quantity is treated as BASE units: the
//     store sells single units. A merchant selling packs on WooCommerce
//     must sell them as separate SKUs (one SKU per pack size).
//   · Imported sale totals are RECOMPUTED by Zapeera's sale engine from
//     the line prices — WooCommerce shipping charges and WooCommerce tax
//     are not carried over (Zapeera sales have no shipping-line field
//     and tax is computed by the local tax engine).

/** Idempotency key + channel tag for an imported sale. Stored on the sale
 *  itself as Sale.channel + Sale.externalOrderId (the same tag Shopify
 *  and Daraz use — the (companyId, channel, externalOrderId) unique
 *  index makes a re-import collide instead of duplicating). */
export const WOOCOMMERCE_CHANNEL = 'woocommerce';

export function wooOrderReference(orderId: number): string {
  return `${WOOCOMMERCE_CHANNEL}:${orderId}`;
}

export function parseWooOrderId(reference: string | null | undefined): number | null {
  if (!reference) return null;
  const match = /^woocommerce:(\d+)$/.exec(reference.trim());
  return match ? Number(match[1]) : null;
}

/** WooCommerce decimal-string money ("21.99") → number. Comma decimals
 *  (some locales) are tolerated. NaN → null so callers can fail loudly. */
export function parseWooMoney(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const n = Number(raw.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// ─── Vendor shapes (subset we read/write) ─────────────────────────────────

export interface WcProduct {
  id: number;
  name: string;
  slug?: string;
  type: 'simple' | 'variable' | 'grouped' | 'external';
  status: string;
  sku: string;
  regular_price: string;
  manage_stock: boolean;
  stock_quantity: number | null;
  variations?: number[];
}

export interface WcVariation {
  id: number;
  sku: string;
  regular_price: string;
  manage_stock: boolean;
  stock_quantity: number | null;
  attributes?: Array<{ name: string; option: string }>;
}

export interface WcOrderLineItem {
  id: number;
  name: string;
  product_id: number;
  variation_id: number;
  quantity: number;
  sku: string | null;
  price: string;
  total: string;
}

export interface WcOrder {
  id: number;
  number: string;
  status: string;
  date_created: string;
  date_paid: string | null;
  total: string;
  payment_method: string;
  payment_method_title: string;
  billing: {
    first_name: string;
    last_name: string;
    email: string;
    phone: string;
    address_1?: string;
    city?: string;
  };
  line_items: WcOrderLineItem[];
}

// ─── Outbound: Zapeera → WooCommerce ───────────────────────────────────────

export interface ZapeeraProductForPush {
  id: string;
  name: string;
  description: string | null;
  sku: string;
  /** Selling price per base unit, from the FEFO batch (null = unpriced). */
  unitPrice: number | null;
  /** Base-unit stock in the bound branch (sum of active batches). */
  stockQuantity: number;
  variants: Array<{
    id: string;
    name: string;
    sku: string | null;
    priceDelta: number;
    attributes: Record<string, string>;
    /** Base-unit stock of this variant's batches in the bound branch. */
    stockQuantity: number;
    /** Selling price per base unit from this variant's own FEFO batch. */
    unitPrice: number | null;
  }>;
}

/**
 * WooCommerce product payload for a Zapeera product. Variable products
 * carry `attributes` built from the variants' free-form attribute pairs
 * (size / colour / …) so variations can be created against them.
 * `manage_stock` + `stock_quantity` are always pushed: a product Zapeera
 * pushes is a product Zapeera stocks.
 */
export function buildWooProductPayload(product: ZapeeraProductForPush): Record<string, unknown> {
  const isVariable = product.variants.length > 0;
  const payload: Record<string, unknown> = {
    name: product.name,
    type: isVariable ? 'variable' : 'simple',
    status: 'publish',
    sku: product.sku,
    description: product.description ?? '',
    regular_price: product.unitPrice !== null ? product.unitPrice.toFixed(2) : undefined,
    manage_stock: !isVariable,
    stock_quantity: isVariable ? undefined : product.stockQuantity
  };
  if (isVariable) {
    const attributeNames = [...new Set(product.variants.flatMap((v) => Object.keys(v.attributes)))];
    payload.attributes = attributeNames.map((name) => ({
      name,
      options: [...new Set(product.variants.map((v) => v.attributes[name]).filter(Boolean))],
      visible: true,
      variation: true
    }));
  }
  return payload;
}

/** WooCommerce variation payload for one Zapeera variant. The price is
 *  the variant's own FEFO batch price plus its priceDelta (falling back
 *  to the product price when the variant has no batch of its own). */
export function buildWooVariationPayload(
  product: ZapeeraProductForPush,
  variant: ZapeeraProductForPush['variants'][number]
): Record<string, unknown> {
  const base = variant.unitPrice ?? product.unitPrice;
  const price = base !== null ? base + variant.priceDelta : null;
  return {
    sku: variant.sku ?? undefined,
    regular_price: price !== null ? price.toFixed(2) : undefined,
    manage_stock: true,
    stock_quantity: variant.stockQuantity,
    attributes: Object.entries(variant.attributes).map(([name, option]) => ({ name, option }))
  };
}

// ─── Inbound: WooCommerce order → Zapeera sale payload ─────────────────────

/** Order statuses we import. `pending` (unpaid checkout), `on-hold`
 *  (awaiting payment), `cancelled`, `refunded` and `failed` never create
 *  a Zapeera sale — an unpaid or dead order must not decrement stock. */
export const IMPORTABLE_WOO_ORDER_STATUSES = ['processing', 'completed'] as const;

export function isImportableWooOrder(order: WcOrder): boolean {
  return (IMPORTABLE_WOO_ORDER_STATUSES as readonly string[]).includes(order.status);
}

/**
 * WooCommerce payment method id → Zapeera tender. Zapeera's tender enum
 * is CASH | CARD | JAZZCASH | EASYPAISA | BANK_TRANSFER | MOBILE; anything
 * else (PayPal, Stripe, wallet plugins, …) lands in MOBILE — the
 * "other electronic payment" bucket — because inventing a tender would
 * misstate the books. The WooCommerce method title is not stored (no
 * field for it on Sale/SalePayment — see README.md).
 */
export function mapWooPaymentMethod(method: string): string {
  switch (String(method || '').toLowerCase()) {
    case 'cod':
      return 'CASH';
    case 'bacs':
    case 'cheque':
      return 'BANK_TRANSFER';
    case 'card':
    case 'stripe':
    case 'paypal':
      return 'CARD';
    case 'jazzcash':
      return 'JAZZCASH';
    case 'easypaisa':
      return 'EASYPAISA';
    default:
      return 'MOBILE';
  }
}

export interface MatchedWooLine {
  productId: string;
  variantId: string | null;
  quantity: number;
  unitPrice: number;
}

export interface WooSalePayload {
  /** createSale payload (see sale.controller.ts createSaleSchema). */
  items: Array<{
    productId: string;
    quantity: number;
    unitPrice: number;
    saleType: 'UNIT';
    variantId: string | null;
  }>;
  paymentMethod: string;
  paymentStatus: 'COMPLETED' | 'PENDING';
  /** Sales-channel import tag (converged with Shopify/Daraz): the tag
   *  travels inside the createSale payload, so it lands in the same
   *  transaction as the sale itself. */
  channel: string;
  externalOrderId: string;
  /** WooCommerce order creation date — the sale is backdated to it. */
  saleDate: string;
}

/**
 * Build the createSale payload for a WooCommerce order whose lines have
 * already been matched to Zapeera products (by SKU, branch-scoped — see
 * handler.ts). Quantities are base units (see the module header).
 * Paid-ness comes from `date_paid`, not from status: a `processing`
 * order paid by card has date_paid set; a COD `processing` order does
 * not, and is imported UNPAID so the khata carries the due until the
 * rider's cash is collected.
 */
export function buildSalePayloadFromWooOrder(
  order: WcOrder,
  matchedLines: MatchedWooLine[]
): WooSalePayload {
  const paid = Boolean(order.date_paid);
  return {
    items: matchedLines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      saleType: 'UNIT' as const,
      variantId: line.variantId
    })),
    paymentMethod: mapWooPaymentMethod(order.payment_method),
    paymentStatus: paid ? 'COMPLETED' : 'PENDING',
    channel: WOOCOMMERCE_CHANNEL,
    externalOrderId: String(order.id),
    saleDate: order.date_created
  };
}

/** Customer display name from a WooCommerce billing block. */
export function wooCustomerName(order: WcOrder): string {
  const name = `${order.billing?.first_name ?? ''} ${order.billing?.last_name ?? ''}`.trim();
  return name || 'WooCommerce Customer';
}
