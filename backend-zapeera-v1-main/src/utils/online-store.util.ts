// Online pharmacy store (Wave C5 — gap item 5).
//
// Pure helpers over a Prisma-shaped client so the money/stock rules
// are unit-testable with a stubbed DB (tests/online-store.util.test.ts):
//   · the store gate (ONLINE_STORE_PACK add-on) and the upload gate
//     (PRESCRIPTION_UPLOAD_PACK add-on — see addon-limits.service);
//     the two packs are separate since 2026-10-25
//   · branch resolution — the branch id in the public path IS the store key
//   · cart resolution — prices and stock come from the server, NEVER from
//     the client payload (a public caller must not be able to set prices)
//   · the prescription review-state rule for dispensing
//
// What the store sells: BASE units only (tablets), at the FEFO-first
// batch's selling price — the same price the staff product list shows
// (product.controller: first unexpired batch with quantity > 0).
// Strip/box levels stay POS-only in v1; the unit engine is not exposed
// to anonymous callers.

import { getEffectiveLimits, isAddonRowEffective } from '../services/addon-limits.service';

export const ONLINE_STORE_ADDON = 'ONLINE_STORE_PACK' as const;

/** Gates the public prescription upload + status check (separate pack since 2026-10-25). */
export const PRESCRIPTION_UPLOAD_ADDON = 'PRESCRIPTION_UPLOAD_PACK' as const;

/** Review states a prescription can be in (Prescription.reviewStatus). */
export const PRESCRIPTION_REVIEW_STATUSES = ['PENDING', 'REVIEWED', 'REJECTED'] as const;
export type PrescriptionReviewStatus = (typeof PRESCRIPTION_REVIEW_STATUSES)[number];

/** Store checkout is cash on delivery only in v1 — no online payment gateway. */
export const STORE_PAYMENT_METHOD = 'CASH' as const;

/** A public caller may not order more than this of one product per order. */
export const STORE_MAX_LINE_QUANTITY = 999;

/** Domain error carrying an HTTP status (same shape as sale.controller's HttpError). */
export class StoreError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'StoreError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

/**
 * THE store gate. Every public storefront/checkout route must call
 * this (via requireStore in the controller) — never re-derive the
 * add-on check inline. The single source is getEffectiveLimits.
 * Prescription upload has its own gate below.
 */
export async function isOnlineStoreEnabled(prisma: any, businessId: string): Promise<boolean> {
  const limits = await getEffectiveLimits(prisma, businessId);
  return limits.onlineStoreAllowed;
}

/**
 * THE prescription-upload gate. The public upload + status-check
 * routes must call this (via requirePrescriptionUpload in the
 * controller) — never re-derive the add-on check inline. The single
 * source is getEffectiveLimits.
 */
export async function isPrescriptionUploadEnabled(prisma: any, businessId: string): Promise<boolean> {
  const limits = await getEffectiveLimits(prisma, businessId);
  return limits.prescriptionUploadAllowed;
}

/** True while an ONLINE_STORE_PACK row is effective (re-export for callers that already hold rows). */
export const isOnlineStoreRowEffective = isAddonRowEffective;

/** True while a PRESCRIPTION_UPLOAD_PACK row is effective (re-export for callers that already hold rows). */
export const isPrescriptionUploadRowEffective = isAddonRowEffective;

export interface StoreBranch {
  id: string;
  companyId: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  isActive: boolean;
  company: { id: string; name: string; slug: string | null; businessType: string | null };
}

/**
 * Resolve the branch in the public store path. Returns null when the
 * branch does not exist or is inactive — callers answer 404 either way
 * so an inactive branch is indistinguishable from a missing one.
 */
export async function resolveStoreBranch(prisma: any, branchId: string): Promise<StoreBranch | null> {
  if (!branchId || typeof branchId !== 'string') return null;
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: {
      id: true,
      companyId: true,
      name: true,
      address: true,
      phone: true,
      email: true,
      isActive: true,
      company: { select: { id: true, name: true, slug: true, businessType: true } },
    },
  });
  if (!branch || !branch.isActive || !branch.company) return null;
  return branch as StoreBranch;
}

/** The batch filter the staff product list uses: live stock only. */
export const availableBatchWhere = (now = new Date()) => ({
  isActive: true,
  quantity: { gt: 0 },
  OR: [{ expireDate: null }, { expireDate: { gt: now } }],
});

export interface StoreCartLine {
  productId: string;
  name: string;
  quantity: number;
  /** Server-resolved price: the FEFO-first available batch's selling price. */
  unitPrice: number;
  lineTotal: number;
  requiresPrescription: boolean;
  availableStock: number;
}

export interface ResolvedStoreCart {
  lines: StoreCartLine[];
  subtotal: number;
  hasPrescriptionItems: boolean;
  prescriptionProductNames: string[];
}

/**
 * Resolve a customer-sent cart against ONE branch's stock. Prices,
 * availability and the Rx flag all come from the server; the client
 * sends only product ids + quantities.
 *
 * Throws StoreError:
 *   400 STORE_CART_EMPTY / STORE_INVALID_QUANTITY / STORE_PRODUCT_NOT_FOUND
 *   409 STORE_INSUFFICIENT_STOCK (with requested/available per product)
 *
 * Duplicate lines for one product are merged (quantities summed).
 */
export async function resolveStoreCart(
  prisma: any,
  branch: StoreBranch,
  items: Array<{ productId: string; quantity: number }>
): Promise<ResolvedStoreCart> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new StoreError(400, 'STORE_CART_EMPTY', 'The cart is empty.');
  }

  const merged = new Map<string, number>();
  for (const item of items) {
    const productId = String((item as any)?.productId || '');
    const quantity = Number((item as any)?.quantity);
    if (!productId) {
      throw new StoreError(400, 'STORE_INVALID_QUANTITY', 'Each cart line needs a product.');
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > STORE_MAX_LINE_QUANTITY) {
      throw new StoreError(
        400,
        'STORE_INVALID_QUANTITY',
        `Quantity for product ${productId} must be a whole number between 1 and ${STORE_MAX_LINE_QUANTITY}.`
      );
    }
    merged.set(productId, (merged.get(productId) || 0) + quantity);
  }

  const productIds = [...merged.keys()];
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, branchId: branch.id, companyId: branch.companyId, isActive: true },
    select: {
      id: true,
      name: true,
      requiresPrescription: true,
      batches: {
        where: availableBatchWhere(),
        select: { id: true, quantity: true, sellingPrice: true, expireDate: true },
        orderBy: { expireDate: 'asc' },
      },
    },
  });
  const byId = new Map<string, any>(products.map((p: any) => [p.id, p]));

  const lines: StoreCartLine[] = [];
  for (const productId of productIds) {
    const product = byId.get(productId);
    if (!product) {
      throw new StoreError(
        400,
        'STORE_PRODUCT_NOT_FOUND',
        'One or more products in the cart are not available from this branch.',
        { productId }
      );
    }
    const batches = (product.batches || []) as Array<{ quantity: number; sellingPrice: number }>;
    const availableStock = batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0);
    const requested = merged.get(productId) as number;
    if (requested > availableStock) {
      throw new StoreError(
        409,
        'STORE_INSUFFICIENT_STOCK',
        `Only ${availableStock} unit(s) of ${product.name} are in stock at this branch.`,
        { productId, name: product.name, requested, available: availableStock }
      );
    }
    // FEFO-first batch price — the same price the staff list shows.
    const unitPrice = Number(batches[0]?.sellingPrice || 0);
    lines.push({
      productId,
      name: product.name,
      quantity: requested,
      unitPrice,
      lineTotal: Math.round(requested * unitPrice * 100) / 100,
      requiresPrescription: !!product.requiresPrescription,
      availableStock,
    });
  }

  const subtotal = Math.round(lines.reduce((sum, l) => sum + l.lineTotal, 0) * 100) / 100;
  const prescriptionProductNames = lines.filter((l) => l.requiresPrescription).map((l) => l.name);
  return { lines, subtotal, hasPrescriptionItems: prescriptionProductNames.length > 0, prescriptionProductNames };
}

/**
 * The dispensing rule for an attached prescription (shared by the POS
 * sale flow and the store checkout pre-check): a sale may only
 * dispense against a REVIEWED prescription. PENDING uploads are still
 * waiting on the pharmacist; REJECTED uploads are refused. A missing /
 * null reviewStatus is treated as REVIEWED (pre-feature rows, which
 * the migration backfills with the REVIEWED default).
 * Returns the StoreError to throw, or null when dispensing may proceed.
 */
export function prescriptionReviewBlock(
  attached: { isActive?: boolean | null; reviewStatus?: string | null } | null
): StoreError | null {
  if (!attached) return null;
  if (attached.isActive === false) {
    return new StoreError(
      400,
      'PRESCRIPTION_VOIDED',
      'The attached prescription has been voided and can no longer be used for a sale.'
    );
  }
  const status = String(attached.reviewStatus || 'REVIEWED').toUpperCase();
  if (status === 'PENDING') {
    return new StoreError(
      422,
      'PRESCRIPTION_NOT_REVIEWED',
      'This prescription is still waiting for pharmacist review and cannot be dispensed yet.'
    );
  }
  if (status === 'REJECTED') {
    return new StoreError(
      422,
      'PRESCRIPTION_REJECTED',
      'This prescription was reviewed and rejected by the pharmacist. It cannot be used for a sale.'
    );
  }
  return null;
}
