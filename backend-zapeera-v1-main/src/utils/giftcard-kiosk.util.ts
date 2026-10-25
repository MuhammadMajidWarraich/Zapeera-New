// Gift cards / eWallet + self-ordering kiosk (Wave C9 — gap item 9,
// retail only).
//
// Pure helpers over a Prisma-shaped client so the money rules are
// unit-testable with a stubbed DB (tests/giftcard-kiosk.util.test.ts):
//   · the pack gate (GIFT_CARD_KIOSK_PACK add-on — see
//     addon-limits.service)
//   · gift-card purchase / redemption with the NO-DOUBLE-SPEND proof:
//     a redemption is a GUARDED decrement (updateMany with
//     `balance >= amount`) inside the sale transaction. The pre-read
//     balance check gives the friendly 400; the guard is what makes
//     concurrent redemptions safe — a second redemption that lost the
//     race matches zero rows and fails with 409 instead of overdrawing
//     the card. A card can never go negative.
//   · the same guarded-decrement rule for the eWallet. The wallet and
//     the gift-card ledgers are SEPARATE tables that are never mixed:
//     a gift-card redemption writes only GiftCardTransaction rows, a
//     wallet spend only WalletTransaction rows.
//   · kiosk cart resolution — prices and stock come from the server,
//     NEVER from the client payload (same rule as item 5's online
//     store: resolveStoreCart). Kiosk sells BASE units only, at the
//     FEFO-first batch's selling price, and REFUSES prescription-only
//     items in v1 (a kiosk cannot take or review a prescription —
//     those stay counter sales).
//
// What the kiosk is: an in-store customer-facing screen on a branch
// tablet. It is public (no staff login on the tablet) like the online
// storefront, branch-scoped by the branch id in the path, and gated
// by the pack. An order is a REAL sale through the POS createSale
// handler (kiosk.controller calls it with a synthetic staff request,
// channel KIOSK, cash, PENDING — pay at the counter), exactly the
// way item 5's store checkout reuses createSale. There is deliberately
// no parallel sales pipeline.

import { getEffectiveLimits } from '../services/addon-limits.service';

export const GIFT_CARD_KIOSK_ADDON = 'GIFT_CARD_KIOSK_PACK' as const;

/** Kiosk checkout is pay-at-counter only in v1 — no card terminal on the kiosk. */
export const KIOSK_PAYMENT_METHOD = 'CASH' as const;

/** A kiosk caller may not order more than this of one product per order. */
export const KIOSK_MAX_LINE_QUANTITY = 999;

/** Gift-card statuses (GiftCard.status). */
export const GIFT_CARD_STATUSES = ['ACTIVE', 'EXHAUSTED', 'EXPIRED', 'VOIDED'] as const;

/** Domain error carrying an HTTP status (same shape as sale.controller's HttpError). */
export class GiftCardKioskError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'GiftCardKioskError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * THE pack gate. Every gift-card / wallet / kiosk route must call this
 * — never re-derive the add-on check inline. The single source is
 * getEffectiveLimits.
 */
export async function isGiftCardKioskEnabled(prisma: any, businessId: string): Promise<boolean> {
  const limits = await getEffectiveLimits(prisma, businessId);
  return limits.giftCardKioskAllowed;
}

/** Gift-card codes are case-insensitive on input; stored upper-case. */
export function normalizeGiftCardCode(code: unknown): string {
  return String(code || '').trim().toUpperCase();
}

/**
 * A new card code: `GC-` + 8 characters from an unambiguous alphabet
 * (no 0/O, 1/I). ~2.8 trillion combinations; the purchase path also
 * retries on a unique-code collision, so a birthday hit cannot fail
 * the sale.
 */
export function generateGiftCardCode(random: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let suffix = '';
  for (let i = 0; i < 8; i++) suffix += alphabet[Math.floor(random() * alphabet.length)];
  return `GC-${suffix.slice(0, 4)}-${suffix.slice(4)}`;
}

/**
 * Is this card redeemable right now? Returns the error to throw, or
 * null when redemption may proceed. A missing / null expiresAt means
 * "never expires" (v1 cards are sold without an expiry unless the
 * counter sets one at purchase).
 */
export function giftCardRedeemBlock(
  card: { status?: string | null; balance?: number | null; expiresAt?: Date | string | null } | null,
  now = new Date()
): GiftCardKioskError | null {
  if (!card) return null; // caller reports NOT_FOUND itself
  const status = String(card.status || '').toUpperCase();
  if (status === 'VOIDED') {
    return new GiftCardKioskError(422, 'GIFT_CARD_VOIDED', 'This gift card has been voided and cannot be redeemed.');
  }
  if (status === 'EXPIRED' || (card.expiresAt && new Date(card.expiresAt).getTime() <= now.getTime())) {
    return new GiftCardKioskError(422, 'GIFT_CARD_EXPIRED', 'This gift card has expired and cannot be redeemed.');
  }
  if (status === 'EXHAUSTED' || Number(card.balance || 0) <= 0) {
    return new GiftCardKioskError(422, 'GIFT_CARD_EXHAUSTED', 'This gift card has no balance left.');
  }
  return null;
}

export interface RedeemGiftCardInput {
  code: string;
  companyId: string;
  amount: number;
  saleId: string;
  createdBy?: string | null;
}

export interface RedeemGiftCardResult {
  giftCardId: string;
  code: string;
  amount: number;
  balanceAfter: number;
}

/**
 * Redeem part of a gift card against a sale — THE atomic money
 * operation for gift cards. Must run inside the sale's Prisma
 * transaction (tx), so the sale, the balance move and the ledger row
 * commit or roll back together.
 *
 *   1. Read the card (by code + business — a code from another
 *      business is indistinguishable from a missing code).
 *   2. Friendly pre-checks: voided / expired / exhausted, and
 *      amount > balance → 400 with the balance in the message.
 *   3. THE GUARD: updateMany with `balance >= amount` + status
 *      ACTIVE. If a concurrent redemption already spent the balance,
 *      this matches zero rows → 409 GIFT_CARD_REDEEM_RACE (the POS
 *      retries the sale; the customer is never overcharged and the
 *      card never goes negative).
 *   4. Append the REDEEM ledger row with the balance after.
 */
export async function redeemGiftCardAtomic(
  tx: any,
  input: RedeemGiftCardInput
): Promise<RedeemGiftCardResult> {
  const code = normalizeGiftCardCode(input.code);
  const amount = round2(Number(input.amount) || 0);
  if (!code) {
    throw new GiftCardKioskError(400, 'GIFT_CARD_CODE_REQUIRED', 'A gift card code is required.');
  }
  if (!(amount > 0)) {
    throw new GiftCardKioskError(400, 'GIFT_CARD_INVALID_AMOUNT', 'The gift card amount must be more than zero.');
  }
  const card = await tx.giftCard.findFirst({
    where: { code, companyId: input.companyId },
    select: { id: true, code: true, balance: true, status: true, expiresAt: true },
  });
  if (!card) {
    throw new GiftCardKioskError(404, 'GIFT_CARD_NOT_FOUND', 'No gift card with this code was found in this business.');
  }
  const block = giftCardRedeemBlock(card);
  if (block) throw block;
  const balance = round2(Number(card.balance) || 0);
  if (amount > balance) {
    throw new GiftCardKioskError(
      400,
      'INSUFFICIENT_GIFT_CARD_BALANCE',
      `Gift card balance PKR ${balance.toFixed(2)} is less than the requested PKR ${amount.toFixed(2)}.`,
      { code, balance, requested: amount }
    );
  }
  const updated = await tx.giftCard.updateMany({
    where: { id: card.id, status: 'ACTIVE', balance: { gte: amount } },
    data: { balance: { decrement: amount } },
  });
  if (!updated || updated.count !== 1) {
    // Lost a race with a concurrent redemption: the balance moved
    // under us. Nothing was written; the sale must be retried.
    throw new GiftCardKioskError(
      409,
      'GIFT_CARD_REDEEM_RACE',
      'This gift card was just used by another sale — please retry the sale to re-check the balance.',
      { code }
    );
  }
  const balanceAfter = round2(balance - amount);
  if (balanceAfter <= 0) {
    await tx.giftCard.update({ where: { id: card.id }, data: { status: 'EXHAUSTED' } });
  }
  await tx.giftCardTransaction.create({
    data: {
      giftCardId: card.id,
      companyId: input.companyId,
      type: 'REDEEM',
      amount: -amount,
      balanceAfter,
      saleId: input.saleId,
      note: `Redeemed on sale ${input.saleId}`,
      createdBy: input.createdBy || null,
    },
  });
  return { giftCardId: card.id, code: card.code, amount, balanceAfter };
}

export interface SpendWalletInput {
  customerId: string;
  companyId: string;
  amount: number;
  saleId: string;
  createdBy?: string | null;
}

export interface SpendWalletResult {
  walletId: string;
  customerId: string;
  amount: number;
  balanceAfter: number;
}

/**
 * Spend part of a customer's eWallet against a sale — the wallet
 * twin of redeemGiftCardAtomic, same guarded-decrement proof, same
 * transaction. Writes only WalletTransaction rows: the wallet ledger
 * and the gift-card ledger are never mixed.
 */
export async function spendWalletAtomic(tx: any, input: SpendWalletInput): Promise<SpendWalletResult> {
  const amount = round2(Number(input.amount) || 0);
  if (!input.customerId) {
    throw new GiftCardKioskError(400, 'WALLET_CUSTOMER_REQUIRED', 'An eWallet spend needs the sale customer.');
  }
  if (!(amount > 0)) {
    throw new GiftCardKioskError(400, 'WALLET_INVALID_AMOUNT', 'The wallet amount must be more than zero.');
  }
  const wallet = await tx.customerWallet.findFirst({
    where: { customerId: input.customerId, companyId: input.companyId },
    select: { id: true, customerId: true, balance: true },
  });
  if (!wallet) {
    throw new GiftCardKioskError(
      404,
      'WALLET_NOT_FOUND',
      'This customer has no eWallet in this business yet — top it up at the counter first.',
      { customerId: input.customerId }
    );
  }
  const balance = round2(Number(wallet.balance) || 0);
  if (amount > balance) {
    throw new GiftCardKioskError(
      400,
      'INSUFFICIENT_WALLET_BALANCE',
      `Wallet balance PKR ${balance.toFixed(2)} is less than the requested PKR ${amount.toFixed(2)}.`,
      { customerId: input.customerId, balance, requested: amount }
    );
  }
  const updated = await tx.customerWallet.updateMany({
    where: { id: wallet.id, balance: { gte: amount } },
    data: { balance: { decrement: amount } },
  });
  if (!updated || updated.count !== 1) {
    throw new GiftCardKioskError(
      409,
      'WALLET_SPEND_RACE',
      'This wallet was just used by another sale — please retry the sale to re-check the balance.',
      { customerId: input.customerId }
    );
  }
  const balanceAfter = round2(balance - amount);
  await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      customerId: input.customerId,
      companyId: input.companyId,
      type: 'SPEND',
      amount: -amount,
      balanceAfter,
      saleId: input.saleId,
      note: `Spent on sale ${input.saleId}`,
      createdBy: input.createdBy || null,
    },
  });
  return { walletId: wallet.id, customerId: input.customerId, amount, balanceAfter };
}

export interface TopUpWalletInput {
  customerId: string;
  companyId: string;
  amount: number;
  method?: string | null;
  createdBy?: string | null;
  note?: string | null;
}

/**
 * Top up a customer's eWallet at the counter. Creates the wallet on
 * first top-up (one wallet per customer per business — customerId is
 * unique). The customer must exist in this business; the increment
 * and the TOPUP ledger row are written in the caller's transaction.
 */
export async function topUpWalletAtomic(tx: any, input: TopUpWalletInput) {
  const amount = round2(Number(input.amount) || 0);
  if (!input.customerId) {
    throw new GiftCardKioskError(400, 'WALLET_CUSTOMER_REQUIRED', 'A wallet top-up needs a customer.');
  }
  if (!(amount > 0)) {
    throw new GiftCardKioskError(400, 'WALLET_INVALID_AMOUNT', 'The top-up amount must be more than zero.');
  }
  const customer = await tx.customer.findFirst({
    where: { id: input.customerId, companyId: input.companyId },
    select: { id: true },
  });
  if (!customer) {
    throw new GiftCardKioskError(404, 'WALLET_CUSTOMER_NOT_FOUND', 'The customer was not found in this business.');
  }
  const wallet = await tx.customerWallet.upsert({
    where: { customerId: input.customerId },
    update: { balance: { increment: amount } },
    create: { customerId: input.customerId, companyId: input.companyId, balance: amount },
  });
  const balanceAfter = round2(Number(wallet.balance) || 0);
  await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      customerId: input.customerId,
      companyId: input.companyId,
      type: 'TOPUP',
      amount,
      balanceAfter,
      method: input.method ? String(input.method).toUpperCase() : null,
      note: input.note || null,
      createdBy: input.createdBy || null,
    },
  });
  return { walletId: wallet.id, customerId: input.customerId, balanceAfter };
}

export interface PurchaseGiftCardInput {
  companyId: string;
  branchId: string;
  value: number;
  recipientName?: string | null;
  recipientPhone?: string | null;
  purchasedBy?: string | null;
  paymentMethod?: string | null;
  expiresAt?: Date | string | null;
  createdBy?: string | null;
}

/**
 * Sell a new gift card at the counter. The card is created with its
 * full value as the opening balance plus a PURCHASE ledger row, in
 * the caller's transaction. Code collisions (unique `code`) are
 * retried with a fresh code — a collision must never fail a sale.
 * Note: a gift-card purchase is a LIABILITY (prepaid value owed to
 * the holder), not a sale — no Sale row is written here, and the
 * purchase value never lands in sales revenue. Redemption is the
 * moment the value is spent, on a real sale.
 */
export async function purchaseGiftCardAtomic(tx: any, input: PurchaseGiftCardInput) {
  const value = round2(Number(input.value) || 0);
  if (!(value > 0)) {
    throw new GiftCardKioskError(400, 'GIFT_CARD_INVALID_AMOUNT', 'The gift card value must be more than zero.');
  }
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateGiftCardCode();
    try {
      const card = await tx.giftCard.create({
        data: {
          code,
          companyId: input.companyId,
          branchId: input.branchId,
          initialValue: value,
          balance: value,
          recipientName: input.recipientName || null,
          recipientPhone: input.recipientPhone || null,
          purchasedBy: input.purchasedBy || null,
          paymentMethod: input.paymentMethod ? String(input.paymentMethod).toUpperCase() : null,
          status: 'ACTIVE',
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          createdBy: input.createdBy || null,
        },
      });
      await tx.giftCardTransaction.create({
        data: {
          giftCardId: card.id,
          companyId: input.companyId,
          type: 'PURCHASE',
          amount: value,
          balanceAfter: value,
          note: 'Gift card purchased at the counter',
          createdBy: input.createdBy || null,
        },
      });
      return card;
    } catch (error: any) {
      // Unique-code collision: fresh code, try again. Anything else
      // is a real failure and must surface.
      if (error?.code === 'P2002') {
        lastError = error;
        continue;
      }
      throw error;
    }
  }
  throw new GiftCardKioskError(
    500,
    'GIFT_CARD_CODE_COLLISION',
    'Could not issue a unique gift card code — please try again.',
    { cause: String((lastError as any)?.message || lastError) }
  );
}

// ---------------------------------------------------------------------------
// Kiosk catalog / cart (mirrors item 5's online-store.util.ts)
// ---------------------------------------------------------------------------

export interface KioskBranch {
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
 * Resolve the branch in the kiosk path. Returns null when the branch
 * does not exist or is inactive — callers answer 404 either way so
 * an inactive branch is indistinguishable from a missing one.
 */
export async function resolveKioskBranch(prisma: any, branchId: string): Promise<KioskBranch | null> {
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
  return branch as KioskBranch;
}

/** The batch filter the staff product list uses: live stock only. */
export const availableBatchWhere = (now = new Date()) => ({
  isActive: true,
  quantity: { gt: 0 },
  OR: [{ expireDate: null }, { expireDate: { gt: now } }],
});

export interface KioskCartLine {
  productId: string;
  name: string;
  quantity: number;
  /** Server-resolved price: the FEFO-first available batch's selling price. */
  unitPrice: number;
  lineTotal: number;
  availableStock: number;
}

export interface ResolvedKioskCart {
  lines: KioskCartLine[];
  subtotal: number;
}

/**
 * Resolve a kiosk-sent cart against ONE branch's stock. Prices and
 * availability come from the server; the client sends only product
 * ids + quantities.
 *
 * Throws GiftCardKioskError:
 *   400 KIOSK_CART_EMPTY / KIOSK_INVALID_QUANTITY /
 *       KIOSK_PRODUCT_NOT_FOUND / KIOSK_PRESCRIPTION_ITEM
 *   409 KIOSK_INSUFFICIENT_STOCK (with requested/available per product)
 *
 * Duplicate lines for one product are merged (quantities summed).
 * Prescription-only products are refused outright: a kiosk cannot
 * take or review a prescription, so those stay counter sales.
 */
export async function resolveKioskCart(
  prisma: any,
  branch: KioskBranch,
  items: Array<{ productId: string; quantity: number }>
): Promise<ResolvedKioskCart> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new GiftCardKioskError(400, 'KIOSK_CART_EMPTY', 'The cart is empty.');
  }

  const merged = new Map<string, number>();
  for (const item of items) {
    const productId = String((item as any)?.productId || '');
    const quantity = Number((item as any)?.quantity);
    if (!productId) {
      throw new GiftCardKioskError(400, 'KIOSK_INVALID_QUANTITY', 'Each cart line needs a product.');
    }
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > KIOSK_MAX_LINE_QUANTITY) {
      throw new GiftCardKioskError(
        400,
        'KIOSK_INVALID_QUANTITY',
        `Quantity for product ${productId} must be a whole number between 1 and ${KIOSK_MAX_LINE_QUANTITY}.`
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

  const lines: KioskCartLine[] = [];
  for (const productId of productIds) {
    const product = byId.get(productId);
    if (!product) {
      throw new GiftCardKioskError(
        400,
        'KIOSK_PRODUCT_NOT_FOUND',
        'One or more products in the cart are not available from this branch.',
        { productId }
      );
    }
    if (product.requiresPrescription) {
      throw new GiftCardKioskError(
        400,
        'KIOSK_PRESCRIPTION_ITEM',
        `“${product.name}” needs a prescription, so it can only be bought at the counter — please ask a staff member.`,
        { productId, name: product.name }
      );
    }
    const batches = (product.batches || []) as Array<{ quantity: number; sellingPrice: number }>;
    const availableStock = batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0);
    const requested = merged.get(productId) as number;
    if (requested > availableStock) {
      throw new GiftCardKioskError(
        409,
        'KIOSK_INSUFFICIENT_STOCK',
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
      lineTotal: round2(requested * unitPrice),
      availableStock,
    });
  }

  const subtotal = round2(lines.reduce((sum, l) => sum + l.lineTotal, 0));
  return { lines, subtotal };
}
