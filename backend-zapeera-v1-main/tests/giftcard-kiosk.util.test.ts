// Gift cards / eWallet + kiosk (Wave C9 — gap item 9) — money-rule tests.
//
// The stub below emulates the Prisma calls the util makes, with the
// SAME semantics a real database gives:
//   · findFirst returns a SNAPSHOT copy of the row at call time (so a
//     pre-read balance can be stale under concurrency — exactly the
//     race the guarded decrement exists to catch);
//   · updateMany's where-guard + decrement apply synchronously in one
//     step (like a real DB row update), so two concurrent redemptions
//     cannot both pass the guard on the same balance.
//
// What these tests prove:
//   · a card can never go negative, even under concurrent redemption
//     (the guard, not the pre-check, is what saves the balance —
//     the pre-checks all read the stale pre-race balance);
//   · wallet and gift-card ledgers are separate (a redeem writes no
//     wallet rows and vice versa);
//   · branch/business scope: a code from another business is 404;
//   · expiry / voided / exhausted handling;
//   · kiosk cart: server-side prices, stock checks, Rx refusal.

import { describe, it, expect } from '@jest/globals';
import {
  GiftCardKioskError,
  generateGiftCardCode,
  giftCardRedeemBlock,
  isGiftCardKioskEnabled,
  purchaseGiftCardAtomic,
  redeemGiftCardAtomic,
  resolveKioskBranch,
  resolveKioskCart,
  spendWalletAtomic,
  topUpWalletAtomic,
} from '../src/utils/giftcard-kiosk.util';

type Row = Record<string, any>;

function makeStub(overrides: Partial<Row> = {}) {
  const giftCards = new Map<string, Row>();
  const giftCardTxns: Row[] = [];
  const wallets = new Map<string, Row>(); // keyed by customerId
  const walletTxns: Row[] = [];
  const customers = new Map<string, Row>([['cust-1', { id: 'cust-1', companyId: 'biz-1' }]]);
  const branches = new Map<string, Row>([
    [
      'branch-1',
      {
        id: 'branch-1',
        companyId: 'biz-1',
        name: 'Main',
        address: null,
        phone: null,
        email: null,
        isActive: true,
        company: { id: 'biz-1', name: 'Test Pharmacy', slug: null, businessType: 'PHARMACY' },
      },
    ],
  ]);
  const products = new Map<string, Row>([
    [
      'prod-1',
      {
        id: 'prod-1',
        name: 'Paracetamol 500mg',
        requiresPrescription: false,
        batches: [{ id: 'b-1', quantity: 50, sellingPrice: 20, expireDate: new Date('2027-01-01') }],
      },
    ],
    [
      'prod-rx',
      {
        id: 'prod-rx',
        name: 'Amoxicillin 250mg',
        requiresPrescription: true,
        batches: [{ id: 'b-2', quantity: 10, sellingPrice: 100, expireDate: new Date('2027-01-01') }],
      },
    ],
  ]);
  let addonRows: Row[] = overrides.addonRows ?? [
    { type: 'GIFT_CARD_KIOSK_PACK', status: 'ACTIVE', periodEnd: null, quantity: 1 },
  ];
  let sub: Row | null = overrides.sub ?? {
    planId: 'GROWTH',
    status: 'ACTIVE',
    currentPeriodEnd: new Date('2027-01-01'),
    trialEndsAt: null,
  };

  const giftCard = {
    findFirst: async ({ where }: any) => {
      for (const c of giftCards.values()) {
        if (where.code && c.code !== where.code) continue;
        if (where.companyId && c.companyId !== where.companyId) continue;
        if (where.id && c.id !== where.id) continue;
        return { ...c }; // SNAPSHOT — a concurrent writer can move the real row after this read
      }
      return null;
    },
    updateMany: async ({ where, data }: any) => {
      // Guard + decrement apply in ONE synchronous step (DB semantics).
      for (const c of giftCards.values()) {
        if (where.id && c.id !== where.id) continue;
        if (where.status && c.status !== where.status) continue;
        if (where.balance?.gte !== undefined && !(c.balance >= where.balance.gte)) continue;
        if (data.balance?.decrement !== undefined) c.balance = Math.round((c.balance - data.balance.decrement) * 100) / 100;
        return { count: 1 };
      }
      return { count: 0 };
    },
    update: async ({ where, data }: any) => {
      const c = giftCards.get(where.id);
      if (!c) throw new Error('not found');
      Object.assign(c, data);
      return { ...c };
    },
    create: async ({ data }: any) => {
      for (const c of giftCards.values()) {
        if (c.code === data.code) {
          const e: any = new Error('Unique constraint failed on the fields: (`code`)');
          e.code = 'P2002';
          throw e;
        }
      }
      const row = { id: `gc-${giftCards.size + 1}`, ...data };
      giftCards.set(row.id, row);
      return { ...row };
    },
  };
  const giftCardTransaction = {
    create: async ({ data }: any) => {
      const row = { id: `gct-${giftCardTxns.length + 1}`, ...data };
      giftCardTxns.push(row);
      return row;
    },
  };
  const customerWallet = {
    findFirst: async ({ where }: any) => {
      const w = wallets.get(where.customerId);
      if (!w) return null;
      if (where.companyId && w.companyId !== where.companyId) return null;
      return { ...w }; // snapshot
    },
    updateMany: async ({ where, data }: any) => {
      for (const w of wallets.values()) {
        if (where.id && w.id !== where.id) continue;
        if (where.balance?.gte !== undefined && !(w.balance >= where.balance.gte)) continue;
        if (data.balance?.decrement !== undefined) w.balance = Math.round((w.balance - data.balance.decrement) * 100) / 100;
        return { count: 1 };
      }
      return { count: 0 };
    },
    upsert: async ({ where, update, create }: any) => {
      const existing = wallets.get(where.customerId);
      if (existing) {
        if (update.balance?.increment !== undefined) {
          existing.balance = Math.round((existing.balance + update.balance.increment) * 100) / 100;
        }
        return { ...existing };
      }
      const row = { id: `w-${wallets.size + 1}`, ...create };
      wallets.set(row.customerId, row);
      return { ...row };
    },
  };
  const walletTransaction = {
    create: async ({ data }: any) => {
      const row = { id: `wt-${walletTxns.length + 1}`, ...data };
      walletTxns.push(row);
      return row;
    },
  };
  const prisma: any = {
    businessSubscription: { findUnique: async () => (sub ? { ...sub } : null) },
    subscriptionAddon: { findMany: async () => addonRows.map((r) => ({ ...r })) },
    settings: { findMany: async () => [] },
    giftCard,
    giftCardTransaction,
    walletTransaction,
    customerWallet,
    customer: {
      findFirst: async ({ where }: any) => {
        const c = customers.get(where.id);
        if (!c) return null;
        if (where.companyId && c.companyId !== where.companyId) return null;
        return { ...c };
      },
    },
    branch: {
      findUnique: async ({ where }: any) => {
        const b = branches.get(where.id);
        return b ? { ...b, company: { ...b.company } } : null;
      },
    },
    product: {
      findMany: async ({ where }: any) => {
        const ids: string[] = where?.id?.in ?? [];
        return ids
          .map((id) => products.get(id))
          .filter((p): p is Row => !!p && where.branchId === 'branch-1' && where.companyId === 'biz-1')
          .map((p) => ({ ...p, batches: p.batches.map((b: Row) => ({ ...b })) }));
      },
    },
  };
  return { prisma, giftCards, giftCardTxns, wallets, walletTxns, setAddonRows: (r: Row[]) => (addonRows = r), setSub: (s: Row | null) => (sub = s) };
}

async function buyCard(stub: ReturnType<typeof makeStub>, value = 1000) {
  return purchaseGiftCardAtomic(stub.prisma, {
    companyId: 'biz-1',
    branchId: 'branch-1',
    value,
    paymentMethod: 'CASH',
    createdBy: 'user-1',
  });
}

describe('gift-card purchase', () => {
  it('creates the card with full balance + a PURCHASE ledger row', async () => {
    const stub = makeStub();
    const card = await buyCard(stub, 500);
    expect(card.code).toMatch(/^GC-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(card.balance).toBe(500);
    expect(card.status).toBe('ACTIVE');
    expect(stub.giftCardTxns).toHaveLength(1);
    expect(stub.giftCardTxns[0]).toMatchObject({ type: 'PURCHASE', amount: 500, balanceAfter: 500 });
  });

  it('rejects a zero/negative value', async () => {
    const stub = makeStub();
    await expect(buyCard(stub, 0)).rejects.toMatchObject({ code: 'GIFT_CARD_INVALID_AMOUNT' });
  });

  it('generates distinct codes', () => {
    const codes = new Set(Array.from({ length: 200 }, () => generateGiftCardCode()));
    expect(codes.size).toBe(200);
  });
});

describe('gift-card redemption (no double-spend)', () => {
  it('redeems partially, keeps the remainder, writes a REDEEM row', async () => {
    const stub = makeStub();
    const card = await buyCard(stub, 1000);
    const res = await redeemGiftCardAtomic(stub.prisma, {
      code: card.code,
      companyId: 'biz-1',
      amount: 350,
      saleId: 'sale-1',
    });
    expect(res).toMatchObject({ amount: 350, balanceAfter: 650 });
    expect(stub.giftCards.get(card.id)?.balance).toBe(650);
    expect(stub.giftCardTxns.filter((t) => t.type === 'REDEEM')).toHaveLength(1);
    expect(stub.giftCardTxns[1]).toMatchObject({ amount: -350, balanceAfter: 650, saleId: 'sale-1' });
    // The wallet ledger is untouched by a gift-card redemption.
    expect(stub.walletTxns).toHaveLength(0);
  });

  it('marks the card EXHAUSTED when the balance hits zero', async () => {
    const stub = makeStub();
    const card = await buyCard(stub, 200);
    await redeemGiftCardAtomic(stub.prisma, { code: card.code, companyId: 'biz-1', amount: 200, saleId: 'sale-1' });
    expect(stub.giftCards.get(card.id)?.status).toBe('EXHAUSTED');
    expect(stub.giftCards.get(card.id)?.balance).toBe(0);
  });

  it('refuses more than the balance (400) and leaves the balance untouched', async () => {
    const stub = makeStub();
    const card = await buyCard(stub, 100);
    await expect(
      redeemGiftCardAtomic(stub.prisma, { code: card.code, companyId: 'biz-1', amount: 101, saleId: 'sale-1' })
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_GIFT_CARD_BALANCE', statusCode: 400 });
    expect(stub.giftCards.get(card.id)?.balance).toBe(100);
    expect(stub.giftCardTxns.filter((t) => t.type === 'REDEEM')).toHaveLength(0);
  });

  it('refuses an expired card (422)', async () => {
    const stub = makeStub();
    const card = await purchaseGiftCardAtomic(stub.prisma, {
      companyId: 'biz-1',
      branchId: 'branch-1',
      value: 100,
      expiresAt: new Date('2020-01-01'),
    });
    await expect(
      redeemGiftCardAtomic(stub.prisma, { code: card.code, companyId: 'biz-1', amount: 10, saleId: 'sale-1' })
    ).rejects.toMatchObject({ code: 'GIFT_CARD_EXPIRED', statusCode: 422 });
  });

  it('refuses a voided card (422)', async () => {
    const stub = makeStub();
    const card = await buyCard(stub, 100);
    stub.giftCards.get(card.id)!.status = 'VOIDED';
    await expect(
      redeemGiftCardAtomic(stub.prisma, { code: card.code, companyId: 'biz-1', amount: 10, saleId: 'sale-1' })
    ).rejects.toMatchObject({ code: 'GIFT_CARD_VOIDED', statusCode: 422 });
    expect(giftCardRedeemBlock({ status: 'VOIDED', balance: 100 })).toMatchObject({ code: 'GIFT_CARD_VOIDED' });
  });

  it('a code from another business is 404, not a balance leak', async () => {
    const stub = makeStub();
    const card = await buyCard(stub, 100);
    await expect(
      redeemGiftCardAtomic(stub.prisma, { code: card.code, companyId: 'biz-OTHER', amount: 10, saleId: 'sale-1' })
    ).rejects.toMatchObject({ code: 'GIFT_CARD_NOT_FOUND', statusCode: 404 });
  });

  it('CONCURRENT redemptions cannot exceed the balance: 5× PKR 300 against PKR 1000 → exactly 3 succeed, balance never negative', async () => {
    const stub = makeStub();
    const card = await buyCard(stub, 1000);
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        redeemGiftCardAtomic(stub.prisma, {
          code: card.code,
          companyId: 'biz-1',
          amount: 300,
          saleId: `sale-${i + 1}`,
        })
      )
    );
    const ok = attempts.filter((a) => a.status === 'fulfilled');
    const failed = attempts.filter((a) => a.status === 'rejected') as PromiseRejectedResult[];
    expect(ok).toHaveLength(3);
    expect(failed).toHaveLength(2);
    // The losers fail on the GUARD (409 race), not on a stale
    // pre-check: every pre-check read the pre-race balance of 1000.
    for (const f of failed) {
      expect((f.reason as GiftCardKioskError).code).toBe('GIFT_CARD_REDEEM_RACE');
      expect((f.reason as GiftCardKioskError).statusCode).toBe(409);
    }
    const finalBalance = stub.giftCards.get(card.id)?.balance;
    expect(finalBalance).toBe(100);
    expect(finalBalance).toBeGreaterThanOrEqual(0);
    const redeemed = stub.giftCardTxns.filter((t) => t.type === 'REDEEM').reduce((s, t) => s + -t.amount, 0);
    expect(redeemed).toBe(900); // ledger total == balance moved, never more
  });
});

describe('eWallet', () => {
  it('top-up creates the wallet + TOPUP row; a second top-up increments', async () => {
    const stub = makeStub();
    const first = await topUpWalletAtomic(stub.prisma, {
      customerId: 'cust-1',
      companyId: 'biz-1',
      amount: 500,
      method: 'CASH',
    });
    expect(first.balanceAfter).toBe(500);
    const second = await topUpWalletAtomic(stub.prisma, {
      customerId: 'cust-1',
      companyId: 'biz-1',
      amount: 250,
      method: 'CARD',
    });
    expect(second.balanceAfter).toBe(750);
    expect(stub.walletTxns).toHaveLength(2);
    expect(stub.walletTxns[1]).toMatchObject({ type: 'TOPUP', amount: 250, balanceAfter: 750, method: 'CARD' });
    // The gift-card ledger is untouched by wallet top-ups.
    expect(stub.giftCardTxns).toHaveLength(0);
  });

  it('top-up for an unknown customer is 404', async () => {
    const stub = makeStub();
    await expect(
      topUpWalletAtomic(stub.prisma, { customerId: 'cust-nope', companyId: 'biz-1', amount: 100 })
    ).rejects.toMatchObject({ code: 'WALLET_CUSTOMER_NOT_FOUND', statusCode: 404 });
  });

  it('spend deducts, writes a SPEND row, and refuses over-spend', async () => {
    const stub = makeStub();
    await topUpWalletAtomic(stub.prisma, { customerId: 'cust-1', companyId: 'biz-1', amount: 400 });
    const res = await spendWalletAtomic(stub.prisma, {
      customerId: 'cust-1',
      companyId: 'biz-1',
      amount: 150,
      saleId: 'sale-9',
    });
    expect(res).toMatchObject({ amount: 150, balanceAfter: 250 });
    await expect(
      spendWalletAtomic(stub.prisma, { customerId: 'cust-1', companyId: 'biz-1', amount: 251, saleId: 'sale-10' })
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_WALLET_BALANCE', statusCode: 400 });
    expect(stub.wallets.get('cust-1')?.balance).toBe(250);
  });

  it('spend with no wallet is 404', async () => {
    const stub = makeStub();
    await expect(
      spendWalletAtomic(stub.prisma, { customerId: 'cust-1', companyId: 'biz-1', amount: 10, saleId: 'sale-1' })
    ).rejects.toMatchObject({ code: 'WALLET_NOT_FOUND', statusCode: 404 });
  });

  it('CONCURRENT wallet spends cannot exceed the balance: 4× PKR 300 against PKR 1000 → exactly 3 succeed', async () => {
    const stub = makeStub();
    await topUpWalletAtomic(stub.prisma, { customerId: 'cust-1', companyId: 'biz-1', amount: 1000 });
    const attempts = await Promise.allSettled(
      Array.from({ length: 4 }, (_, i) =>
        spendWalletAtomic(stub.prisma, {
          customerId: 'cust-1',
          companyId: 'biz-1',
          amount: 300,
          saleId: `sale-${i + 1}`,
        })
      )
    );
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(3);
    const failed = attempts.filter((a) => a.status === 'rejected') as PromiseRejectedResult[];
    expect(failed).toHaveLength(1);
    expect((failed[0].reason as GiftCardKioskError).code).toBe('WALLET_SPEND_RACE');
    expect(stub.wallets.get('cust-1')?.balance).toBe(100);
    expect(stub.walletTxns.filter((t) => t.type === 'SPEND')).toHaveLength(3);
  });
});

describe('pack gate', () => {
  it('is enabled while a GIFT_CARD_KIOSK_PACK row is effective', async () => {
    const stub = makeStub();
    expect(await isGiftCardKioskEnabled(stub.prisma, 'biz-1')).toBe(true);
  });

  it('is disabled with no pack row; a trial plan keeps a backoffice-granted pack (purchase is what trial blocks)', async () => {
    const stub = makeStub();
    stub.setAddonRows([]);
    expect(await isGiftCardKioskEnabled(stub.prisma, 'biz-1')).toBe(false);
    // Trial + an ACTIVE pack row (granted by backoffice activation) is
    // still enabled — same rule as item 5's store gate: the trial bar
    // lives in checkAddonPurchasable, not in the gate.
    const trial = makeStub();
    trial.setSub({ planId: 'TRIAL', status: 'TRIAL', currentPeriodEnd: null, trialEndsAt: new Date('2027-01-01') });
    expect(await isGiftCardKioskEnabled(trial.prisma, 'biz-1')).toBe(true);
    trial.setAddonRows([]);
    expect(await isGiftCardKioskEnabled(trial.prisma, 'biz-1')).toBe(false);
  });
});

describe('kiosk branch + cart', () => {
  it('resolves an active branch, 404s a missing one', async () => {
    const stub = makeStub();
    const branch = await resolveKioskBranch(stub.prisma, 'branch-1');
    expect(branch?.id).toBe('branch-1');
    expect(await resolveKioskBranch(stub.prisma, 'branch-nope')).toBeNull();
  });

  it('resolves the cart at server prices (FEFO-first batch) and merges duplicate lines', async () => {
    const stub = makeStub();
    const branch = (await resolveKioskBranch(stub.prisma, 'branch-1'))!;
    const cart = await resolveKioskCart(stub.prisma, branch, [
      { productId: 'prod-1', quantity: 2 },
      { productId: 'prod-1', quantity: 3 },
    ]);
    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0]).toMatchObject({ productId: 'prod-1', quantity: 5, unitPrice: 20, lineTotal: 100 });
    expect(cart.subtotal).toBe(100);
  });

  it('refuses more than available stock (409)', async () => {
    const stub = makeStub();
    const branch = (await resolveKioskBranch(stub.prisma, 'branch-1'))!;
    await expect(resolveKioskCart(stub.prisma, branch, [{ productId: 'prod-1', quantity: 51 }])).rejects.toMatchObject({
      code: 'KIOSK_INSUFFICIENT_STOCK',
      statusCode: 409,
    });
  });

  it('refuses prescription-only items — they stay counter sales', async () => {
    const stub = makeStub();
    const branch = (await resolveKioskBranch(stub.prisma, 'branch-1'))!;
    await expect(resolveKioskCart(stub.prisma, branch, [{ productId: 'prod-rx', quantity: 1 }])).rejects.toMatchObject({
      code: 'KIOSK_PRESCRIPTION_ITEM',
      statusCode: 400,
    });
  });

  it('refuses an unknown product and an empty cart', async () => {
    const stub = makeStub();
    const branch = (await resolveKioskBranch(stub.prisma, 'branch-1'))!;
    await expect(resolveKioskCart(stub.prisma, branch, [{ productId: 'prod-nope', quantity: 1 }])).rejects.toMatchObject({
      code: 'KIOSK_PRODUCT_NOT_FOUND',
    });
    await expect(resolveKioskCart(stub.prisma, branch, [])).rejects.toMatchObject({ code: 'KIOSK_CART_EMPTY' });
  });
});
