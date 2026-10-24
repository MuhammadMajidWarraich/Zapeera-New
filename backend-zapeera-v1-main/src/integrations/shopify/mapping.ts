// ─── Shopify integration — mapping (feature/integration-shopify) ─────────
// Pure mapping between Zapeera shapes and Shopify shapes. No I/O, no
// Prisma — every function here is unit-tested with fixtures in
// tests/shopify.test.ts.
//
// JOIN KEYS (the whole sync stands on these):
//   Product <-> Shopify product: Zapeera Product.sku (globally unique)
//   Variant <-> Shopify variant: ProductVariant.sku (unique per branch by
//     convention — see resolveVariantSku); Shopify variant SKU lives in
//     inventoryItem.sku.
//   Order  <-> Zapeera sale:     Sale.channel='shopify' +
//     Sale.externalOrderId=<Shopify numeric order id> (unique index).
//
// STOCK IS BASE UNITS: Batch.quantity has always been a base-unit count
// (unit engine, src/utils/unit.util.ts), so the stock pushed to Shopify
// is the plain SUM of the branch's active batches in the product/variant
// pool — no pack/strip conversion. Prices are per BASE unit too
// (Batch.sellingPrice), so the Shopify variant price is the pool's
// latest batch selling price (+ the variant's priceDelta).
import type { ShopifyOrder, ShopifyVariantInput } from './client';

/** Shopify allows at most 3 options per product — extra attributes are dropped (and named). */
export const MAX_SHOPIFY_OPTIONS = 3;

/**
 * Zapeera variant attributes ({size, color, ...}) -> Shopify optionValues.
 * Keys are sorted for determinism; option names are Title-Cased for the
 * storefront ("size" -> "Size"). Returns the values plus any dropped keys.
 */
export function attributesToOptionValues(
  attributes: Record<string, unknown> | null | undefined
): { optionValues: Array<{ optionName: string; name: string }>; dropped: string[] } {
  const entries = Object.entries(attributes ?? {})
    .map(([key, value]) => ({ key, value: String(value ?? '').trim() }))
    .filter((e) => e.key.trim() !== '' && e.value !== '');
  entries.sort((a, b) => a.key.localeCompare(b.key));
  const kept = entries.slice(0, MAX_SHOPIFY_OPTIONS);
  const titleCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return {
    optionValues: kept.map((e) => ({ optionName: titleCase(e.key), name: e.value })),
    dropped: entries.slice(MAX_SHOPIFY_OPTIONS).map((e) => e.key)
  };
}

/** Money: number -> Shopify price string with 2 decimals. */
export function toShopifyPrice(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return (Math.round(n * 100) / 100).toFixed(2);
}

/**
 * The Shopify variant input for one Zapeera product/variant.
 * `poolPrice` is the latest active batch sellingPrice of the variant's
 * pool (base units); the variant's priceDelta adjusts it. When the
 * product has no variants, the caller passes the single base variant
 * (optionValues empty, sku = product sku).
 */
export function buildShopifyVariantInput(input: {
  shopifyVariantId?: string;
  attributes?: Record<string, unknown> | null;
  sku: string | null;
  barcode?: string | null;
  poolPrice: number;
  priceDelta?: number;
  stock: number;
  locationId: string;
  /** True on the create path (inventoryQuantities is create-only). */
  forCreate: boolean;
}): { variantInput: ShopifyVariantInput; droppedOptions: string[] } {
  const { optionValues, dropped } = attributesToOptionValues(input.attributes);
  const price = toShopifyPrice(input.poolPrice + (input.priceDelta ?? 0));
  const variantInput: ShopifyVariantInput = {
    price,
    barcode: input.barcode ?? null,
    sku: input.sku
  };
  if (input.shopifyVariantId) variantInput.id = input.shopifyVariantId;
  if (optionValues.length > 0) variantInput.optionValues = optionValues;
  if (input.forCreate) {
    variantInput.inventoryQuantities = [
      { locationId: input.locationId, availableQuantity: Math.max(0, Math.floor(input.stock)) }
    ];
  }
  return { variantInput, droppedOptions: dropped };
}

// ─── Order -> sale financial mapping ──────────────────────────────────────
// Shopify money: line prices are pre-tax; order total = subtotal -
// discounts + tax + shipping. Zapeera's createSale recomputes the total
// from the lines with its OWN tax engine (defaultTax setting) and has
// no shipping field, so an imported sale's total matches Shopify's
// exactly only when Shopify tax + shipping are both zero (the usual PK
// case: no tax configured, COD/free delivery). Any gap is reported in
// the import message — never silently forced into line prices.

export type ShopifySalePayment =
  | 'CASH'
  | 'CARD'
  | 'JAZZCASH'
  | 'EASYPAISA'
  | 'BANK_TRANSFER'
  | 'MOBILE';

/**
 * Shopify payment gateways -> Zapeera tender. COD/manual payments are
 * CASH; JazzCash/Easypaisa by name; bank transfer by name; anything
 * else paid online is CARD. Unknown gateways fall back to CASH so the
 * sale still records (the gateway name rides in the import message).
 */
export function mapPaymentMethod(gatewayNames: string[], financialStatus: string): ShopifySalePayment {
  const joined = gatewayNames.join(' ').toLowerCase();
  if (joined.includes('jazzcash')) return 'JAZZCASH';
  if (joined.includes('easypaisa')) return 'EASYPAISA';
  if (joined.includes('bank')) return 'BANK_TRANSFER';
  if (joined.includes('cash') || joined.includes('cod') || joined.includes('delivery')) return 'CASH';
  if (financialStatus === 'PAID' || financialStatus === 'PARTIALLY_PAID') return 'CARD';
  return 'CASH';
}

export interface MappedOrderFinancials {
  /** Zapeera paymentStatus for the imported sale. */
  paymentStatus: 'PENDING' | 'COMPLETED' | 'REFUNDED';
  /** Amount already paid by the customer (PKR). */
  paidAmount: number;
  /** Amount already refunded (PKR) — stored as Sale.returnedAmount. */
  returnedAmount: number;
  /** Order-level discount (PKR) — createSale's discountAmount. */
  discountAmount: number;
  /** True when the order must NOT be imported as a sale. */
  skip: boolean;
  skipReason?: string;
}

/** Financial status -> Zapeera payment state. Cancelled orders are skipped. */
export function mapOrderFinancials(order: ShopifyOrder): MappedOrderFinancials {
  if (order.cancelledAt) {
    return {
      paymentStatus: 'PENDING',
      paidAmount: 0,
      returnedAmount: 0,
      discountAmount: 0,
      skip: true,
      skipReason: `cancelled in Shopify${order.cancelledAt ? ` (${order.cancelledAt.slice(0, 10)})` : ''}`
    };
  }
  const status = order.financialStatus;
  const refunded = Math.max(0, order.totalRefunded);
  if (status === 'REFUNDED' || status === 'VOIDED') {
    return {
      paymentStatus: 'REFUNDED',
      paidAmount: 0,
      returnedAmount: Math.min(refunded || order.total, order.total),
      discountAmount: Math.round(order.totalDiscounts * 100) / 100,
      skip: false
    };
  }
  if (status === 'PAID') {
    return {
      paymentStatus: 'COMPLETED',
      paidAmount: Math.round((order.total - refunded) * 100) / 100,
      returnedAmount: refunded,
      discountAmount: Math.round(order.totalDiscounts * 100) / 100,
      skip: false
    };
  }
  // PARTIALLY_PAID / AUTHORIZED / PENDING: unpaid (or partly paid) —
  // the unpaid remainder lands on the customer's khata via the normal
  // sale path when a customer is attached (same as an unpaid POS sale).
  const paid = Math.max(0, Math.round((order.total - order.totalOutstanding - refunded) * 100) / 100);
  return {
    paymentStatus: 'PENDING',
    paidAmount: paid,
    returnedAmount: refunded,
    discountAmount: Math.round(order.totalDiscounts * 100) / 100,
    skip: false
  };
}

/** Customer name from a Shopify customer object (falls back to email/phone). */
export function shopifyCustomerName(
  customer: ShopifyOrder['customer'],
  fallback: string
): string {
  const display = customer?.displayName?.trim();
  if (display) return display;
  const first = customer?.firstName?.trim() ?? '';
  const last = customer?.lastName?.trim() ?? '';
  const joined = `${first} ${last}`.trim();
  if (joined) return joined;
  if (customer?.email?.trim()) return customer.email.trim();
  return fallback;
}

/** Normalize a Shopify phone for Zapeera's Customer.phone (unique) lookup. */
export function normalizeCustomerPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/[\s()-]/g, '');
  return cleaned !== '' ? cleaned : null;
}
