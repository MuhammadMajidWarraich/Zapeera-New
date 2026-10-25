// ─── Item 5: online pharmacy store + prescription upload ─────────────
// Unit tests over stub Prisma clients — no database needed. They pin
// the rules a public caller must never be able to break:
//   · branch isolation — the cart resolves ONLY against the store
//     branch's products (a customer never sees another branch's stock)
//   · server-side pricing — the price comes from the FEFO-first batch,
//     never from the client payload
//   · stock — an order beyond live (unexpired, qty > 0) stock is refused
//   · review gate — a PENDING/REJECTED prescription can never be
//     dispensed against; REVIEWED (and pre-feature rows) can
//   · gating — ONLINE_STORE_PACK (Rs 500/mo) and
//     PRESCRIPTION_UPLOAD_PACK (Rs 1,000/mo) are priced since
//     2026-10-25 (Muhammad's order, competitor-based) and can be
//     bought; trial still cannot buy add-ons (the two packs are
//     separate since 2026-10-25)
// They also pin the schema fields + route classification the feature
// depends on.

import { describe, it, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  resolveStoreCart,
  resolveStoreBranch,
  prescriptionReviewBlock,
  StoreError,
  STORE_MAX_LINE_QUANTITY,
} from '../src/utils/online-store.util';
import { checkAddonPurchasable, ADDON_CATALOGUE } from '../src/services/addon-limits.service';
import { classifyRoute } from '../src/config/module-route-protection.config';
import { resolveRoutePolicy } from '../src/config/route-policy.registry';

const BRANCH: any = {
  id: 'branch-1',
  companyId: 'company-1',
  name: 'Main Branch',
  address: '1 Test Rd',
  phone: '03000000000',
  email: 'branch@test.pk',
  isActive: true,
  company: { id: 'company-1', name: 'Test Pharmacy', slug: 'test-pharmacy', businessType: 'PHARMACY' },
};

const batch = (quantity: number, sellingPrice: number, expireDate: string | null = null) => ({
  id: `batch-${quantity}-${sellingPrice}`,
  quantity,
  sellingPrice,
  expireDate,
});

const product = (over: Record<string, any>) => ({
  id: 'prod-1',
  name: 'Panadol Extra',
  requiresPrescription: false,
  batches: [batch(10, 50)],
  ...over,
});

/** Minimal Prisma-shaped stub: only the calls the helpers make. */
const stubClient = (products: any[], branchRow: any = BRANCH) => {
  let lastArgs: any = null;
  return {
    client: {
      branch: {
        findUnique: async () => branchRow,
      },
      product: {
        findMany: async (args: any) => {
          lastArgs = args;
          const ids = args.where?.id?.in || [];
          return products.filter((p: any) => ids.includes(p.id));
        },
      },
    },
    getLastArgs: () => lastArgs,
  };
};

describe('store cart resolution (gap item 5)', () => {
  it('prices from the FEFO-first batch and sums stock across batches', async () => {
    const { client } = stubClient([
      product({ batches: [batch(5, 40, '2027-01-01'), batch(7, 55, '2027-06-01')] }),
    ]);
    const cart = await resolveStoreCart(client, BRANCH, [{ productId: 'prod-1', quantity: 3 }]);
    expect(cart.lines).toEqual([
      {
        productId: 'prod-1',
        name: 'Panadol Extra',
        quantity: 3,
        unitPrice: 40,
        lineTotal: 120,
        requiresPrescription: false,
        availableStock: 12,
      },
    ]);
    expect(cart.subtotal).toBe(120);
    expect(cart.hasPrescriptionItems).toBe(false);
  });

  it('merges duplicate lines for one product', async () => {
    const { client } = stubClient([product({})]);
    const cart = await resolveStoreCart(client, BRANCH, [
      { productId: 'prod-1', quantity: 2 },
      { productId: 'prod-1', quantity: 3 },
    ]);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].quantity).toBe(5);
    expect(cart.lines[0].lineTotal).toBe(250);
  });

  it('scopes the product lookup to the store branch and company, live stock only', async () => {
    const stub = stubClient([product({})]);
    await resolveStoreCart(stub.client, BRANCH, [{ productId: 'prod-1', quantity: 1 }]);
    const args = stub.getLastArgs();
    expect(args.where.branchId).toBe('branch-1');
    expect(args.where.companyId).toBe('company-1');
    expect(args.where.isActive).toBe(true);
    // Live stock only: the batch select excludes inactive, empty and
    // expired batches — an expired batch can never price stock.
    const batchWhere = args.select.batches.where;
    expect(batchWhere.isActive).toBe(true);
    expect(batchWhere.quantity).toEqual({ gt: 0 });
    expect(batchWhere.OR).toEqual([{ expireDate: null }, { expireDate: { gt: expect.any(Date) } }]);
  });

  it('flags prescription-only products in the cart', async () => {
    const { client } = stubClient([
      product({ id: 'prod-rx', name: 'Augmentin', requiresPrescription: true, batches: [batch(4, 200)] }),
    ]);
    const cart = await resolveStoreCart(client, BRANCH, [{ productId: 'prod-rx', quantity: 1 }]);
    expect(cart.hasPrescriptionItems).toBe(true);
    expect(cart.prescriptionProductNames).toEqual(['Augmentin']);
  });

  it('refuses a product that is not in this branch (never leaks another branch stock)', async () => {
    const { client } = stubClient([]);
    await expect(resolveStoreCart(client, BRANCH, [{ productId: 'prod-other-branch', quantity: 1 }])).rejects.toMatchObject({
      statusCode: 400,
      code: 'STORE_PRODUCT_NOT_FOUND',
    });
  });

  it('refuses an order beyond live stock, with requested/available', async () => {
    const { client } = stubClient([product({ batches: [batch(2, 50)] })]);
    await expect(resolveStoreCart(client, BRANCH, [{ productId: 'prod-1', quantity: 3 }])).rejects.toMatchObject({
      statusCode: 409,
      code: 'STORE_INSUFFICIENT_STOCK',
    });
    try {
      await resolveStoreCart(client, BRANCH, [{ productId: 'prod-1', quantity: 3 }]);
      throw new Error('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(StoreError);
      expect(e.details).toEqual({ productId: 'prod-1', name: 'Panadol Extra', requested: 3, available: 2 });
    }
  });

  it('refuses an empty cart and out-of-range quantities', async () => {
    const { client } = stubClient([product({})]);
    await expect(resolveStoreCart(client, BRANCH, [])).rejects.toMatchObject({
      statusCode: 400,
      code: 'STORE_CART_EMPTY',
    });
    await expect(resolveStoreCart(client, BRANCH, [{ productId: 'prod-1', quantity: 0 }])).rejects.toMatchObject({
      statusCode: 400,
      code: 'STORE_INVALID_QUANTITY',
    });
    await expect(
      resolveStoreCart(client, BRANCH, [{ productId: 'prod-1', quantity: STORE_MAX_LINE_QUANTITY + 1 }])
    ).rejects.toMatchObject({ statusCode: 400, code: 'STORE_INVALID_QUANTITY' });
  });
});

describe('store branch resolution (gap item 5)', () => {
  it('returns null for a missing branch', async () => {
    const { client } = stubClient([], null);
    expect(await resolveStoreBranch(client, 'nope')).toBeNull();
  });

  it('returns null for an inactive branch', async () => {
    const { client } = stubClient([], { ...BRANCH, isActive: false });
    expect(await resolveStoreBranch(client, 'branch-1')).toBeNull();
  });

  it('resolves an active branch with its company', async () => {
    const { client } = stubClient([]);
    const resolved = await resolveStoreBranch(client, 'branch-1');
    expect(resolved?.id).toBe('branch-1');
    expect(resolved?.company.name).toBe('Test Pharmacy');
  });
});

describe('prescription review gate (gap item 5)', () => {
  it('blocks a PENDING upload with 422 PRESCRIPTION_NOT_REVIEWED', () => {
    const block = prescriptionReviewBlock({ isActive: true, reviewStatus: 'PENDING' });
    expect(block).toBeInstanceOf(StoreError);
    expect(block?.statusCode).toBe(422);
    expect(block?.code).toBe('PRESCRIPTION_NOT_REVIEWED');
  });

  it('blocks a REJECTED upload with 422 PRESCRIPTION_REJECTED', () => {
    const block = prescriptionReviewBlock({ isActive: true, reviewStatus: 'REJECTED' });
    expect(block?.statusCode).toBe(422);
    expect(block?.code).toBe('PRESCRIPTION_REJECTED');
  });

  it('allows a REVIEWED prescription', () => {
    expect(prescriptionReviewBlock({ isActive: true, reviewStatus: 'REVIEWED' })).toBeNull();
  });

  it('treats a missing reviewStatus as REVIEWED (pre-feature rows)', () => {
    expect(prescriptionReviewBlock({ isActive: true, reviewStatus: null })).toBeNull();
    expect(prescriptionReviewBlock({ isActive: true })).toBeNull();
  });

  it('blocks a voided prescription even when reviewed', () => {
    const block = prescriptionReviewBlock({ isActive: false, reviewStatus: 'REVIEWED' });
    expect(block?.statusCode).toBe(400);
    expect(block?.code).toBe('PRESCRIPTION_VOIDED');
  });
});

describe('online store add-on gating (gap item 5)', () => {
  it('lists the store and prescription-upload packs as separate, priced entries', () => {
    const store = ADDON_CATALOGUE.ONLINE_STORE_PACK;
    const upload = ADDON_CATALOGUE.PRESCRIPTION_UPLOAD_PACK;
    expect(store).toBeDefined();
    expect(upload).toBeDefined();
    expect(store.type).not.toBe(upload.type);
    expect(store.priceMonthly).toBe(500);
    expect(upload.priceMonthly).toBe(1000);
    for (const entry of [store, upload]) {
      expect(entry.pricingPending).toBeFalsy();
      expect(entry.stackable).toBe(false);
    }
  });

  it('allows buying ONLINE_STORE_PACK at Rs 500/mo (no 409)', () => {
    const limits: any = { isTrial: false, planId: 'GROWTH' };
    expect(checkAddonPurchasable(limits, 'ONLINE_STORE_PACK')).toEqual({ ok: true });
  });

  it('allows buying PRESCRIPTION_UPLOAD_PACK at Rs 1,000/mo (no 409)', () => {
    const limits: any = { isTrial: false, planId: 'GROWTH' };
    expect(checkAddonPurchasable(limits, 'PRESCRIPTION_UPLOAD_PACK')).toEqual({ ok: true });
  });

  it('still refuses on trial (trial rule precedes the pricing rule)', () => {
    const limits: any = { isTrial: true, planId: 'TRIAL' };
    expect(checkAddonPurchasable(limits, 'ONLINE_STORE_PACK').ok).toBe(false);
    expect(checkAddonPurchasable(limits, 'PRESCRIPTION_UPLOAD_PACK').ok).toBe(false);
  });
});

describe('schema + route wiring the feature depends on (gap item 5)', () => {
  const read = (name: string) =>
    fs.readFileSync(path.join(__dirname, '..', 'prisma', name), 'utf8');

  it('both schemas carry the prescription review fields', () => {
    for (const name of ['schema.postgresql.prisma', 'schema.sqlite.prisma']) {
      const text = read(name);
      expect(text).toContain('reviewStatus String');
      expect(text).toContain('source       String');
      expect(text).toContain('reviewedBy   String?');
      expect(text).toContain('reviewedAt   DateTime?');
      expect(text).toContain('reviewNote   String?');
    }
  });

  it('both schemas carry the sale channel + delivery fields', () => {
    for (const name of ['schema.postgresql.prisma', 'schema.sqlite.prisma']) {
      const text = read(name);
      expect(text).toContain('channel             String');
      expect(text).toContain('deliveryAddress     String?');
      expect(text).toContain('deliveryPhone       String?');
      expect(text).toContain('deliveryNotes       String?');
      expect(text).toContain('ONLINE_STORE_PACK');
    }
  });

  it('classifies /api/store as a public route in both registries', () => {
    expect(classifyRoute('/api/store')).toBe('bootstrap');
    expect(classifyRoute('/api/v1/store/branch-1/checkout')).toBe('bootstrap');
    expect(resolveRoutePolicy('/api/store')?.kind).toBe('public');
    expect(resolveRoutePolicy('/api/v1/store/branch-1/products')?.kind).toBe('public');
  });
});
