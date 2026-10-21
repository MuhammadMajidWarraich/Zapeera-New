// Promotions & coupons engine (Wave B4).
//
// The engine is evaluated SERVER-SIDE inside sale creation — a client
// only ever sends a coupon CODE, never a discount. Automatic
// promotions (code = null) need no client input at all.
//
// ORDER OF APPLICATION (the sale totals pipeline, extending B3):
//   1. Line totals: quantity × unitPrice − item-level discounts
//      → subtotal S.
//   2. BUY_X_GET_Y promotions (line level) → lineDiscount B. Free
//      units are valued at their lines' prices and expressed purely
//      as a discount amount: quantities and stock are NOT altered —
//      free units still leave the shelf and decrement stock exactly
//      like paid ones.
//   3. Manual sale discount (the cashier's discountPercentage /
//      discountAmount) → M, computed against (S − B). With no BXGY
//      offer in play B = 0 and this is exactly the pre-B4 formula.
//   4. Order-level promotion → P: PERCENT/FLAT taken off the scoped
//      share of (S − B − M). At most ONE order-level promotion applies
//      per sale — the coupon whose code the client sent, or, when no
//      code was sent, the single best automatic promotion. Sending a
//      coupon therefore suppresses automatic order-level offers (the
//      customer's explicit choice wins); automatic BUY_X_GET_Y offers
//      still apply alongside a coupon.
//   5. Loyalty redemption (B3) → L, capped at what remains.
//   6. Tax on (S − B − M − P − L) → total.
// Sale.promotionDiscount stores B + P; SalePromotion rows itemize it.
//
// Eligibility: a promotion applies only while isActive, inside its
// startsAt/endsAt window, under its usageLimit, and — for minBill —
// while the cart subtotal S reaches the threshold. A coupon code that
// was EXPLICITLY sent but is unknown/inactive/expired/exhausted/
// below minBill, or that yields no discount on this cart, fails the
// sale with a 400 and a plain-language reason. Automatic promotions
// that are ineligible are silently skipped.
//
// BUY_X_GET_Y pooling: each cart line is claimed by the MOST SPECIFIC
// offer that matches it (PRODUCT > CATEGORY > ALL), so lines never
// feed two offers. Within a pool, every full group of
// (buyQty + getQty) units earns getQty free units, valued at the
// pool's cheapest per-unit prices first. If several offers tie for a
// pool, the one granting the largest discount wins (earliest created
// breaks ties).

export const PROMOTION_TYPES = ['PERCENT', 'FLAT', 'BUY_X_GET_Y'] as const;
export const PROMOTION_SCOPES = ['ALL', 'CATEGORY', 'PRODUCT'] as const;

export interface PromotionLike {
  id: string;
  name: string;
  type: string;
  value: number;
  buyQty?: number | null;
  getQty?: number | null;
  scope: string;
  categoryId?: string | null;
  productId?: string | null;
  code?: string | null;
  minBill?: number | null;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  usageLimit?: number | null;
  usedCount: number;
  isActive: boolean;
  createdAt?: Date | string;
}

export interface PromoLineInput {
  productId: string;
  categoryId: string | null;
  /** Stock units this line deducts (the sale engine's unitsDeducted). */
  units: number;
  /** Line total AFTER item-level discounts (the engine's line total). */
  lineTotal: number;
}

export interface AppliedPromotion {
  promotion: PromotionLike;
  discountAmount: number;
  /** COUPON = unlocked by the sent code · LINE = BUY_X_GET_Y · ORDER = automatic order-level */
  source: 'COUPON' | 'LINE' | 'ORDER';
}

export interface PromotionEvaluation {
  /** BUY_X_GET_Y discount total. */
  lineDiscount: number;
  /** BXGY discount attributed per input line index. */
  lineDiscountByLine: Map<number, number>;
  /** The manual sale discount, resolved against (subtotal − lineDiscount). */
  manualDiscount: number;
  /** Order-level discount (coupon or best automatic), 0 when none. */
  orderDiscount: number;
  /** lineDiscount + orderDiscount — what Sale.promotionDiscount stores. */
  totalDiscount: number;
  applied: AppliedPromotion[];
  /**
   * True when a coupon code was sent and validated, but the coupon
   * itself granted nothing on this cart (scope matches nothing, or a
   * BUY_X_GET_Y threshold was not reached). Callers that honour
   * explicitly-sent codes must reject in this case.
   */
  couponNotApplied: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Normalize a client-sent coupon code the way codes are stored. */
export const normalizeCouponCode = (raw: unknown): string | null => {
  if (raw === null || raw === undefined) return null;
  const code = String(raw).trim().toUpperCase();
  return code.length > 0 ? code : null;
};

/**
 * Why a promotion cannot be redeemed right now, or null when it can.
 * `subtotal` is the cart's post-item-discount subtotal S (the minBill
 * yardstick). Used strictly for explicitly-sent coupon codes; the
 * automatic path treats any non-null result as "skip silently".
 */
export const promotionEligibilityError = (
  promo: PromotionLike,
  subtotal: number,
  now: Date = new Date()
): string | null => {
  if (!promo.isActive) return 'this promotion is not active';
  if (promo.startsAt && new Date(promo.startsAt).getTime() > now.getTime()) {
    return 'this promotion has not started yet';
  }
  if (promo.endsAt && new Date(promo.endsAt).getTime() < now.getTime()) {
    return 'this promotion has expired';
  }
  if (promo.usageLimit !== null && promo.usageLimit !== undefined && promo.usedCount >= promo.usageLimit) {
    return 'this promotion has reached its usage limit';
  }
  if (promo.minBill !== null && promo.minBill !== undefined && subtotal < promo.minBill) {
    return `this promotion needs a minimum bill of PKR ${Number(promo.minBill).toFixed(2)}`;
  }
  return null;
};

const lineMatchesScope = (promo: PromotionLike, line: PromoLineInput): boolean => {
  if (promo.scope === 'CATEGORY') {
    return !!promo.categoryId && line.categoryId === promo.categoryId;
  }
  if (promo.scope === 'PRODUCT') {
    return !!promo.productId && line.productId === promo.productId;
  }
  return true; // ALL
};

const scopeSpecificity = (promo: PromotionLike): number =>
  promo.scope === 'PRODUCT' ? 3 : promo.scope === 'CATEGORY' ? 2 : 1;

/**
 * Resolve a client-sent coupon code to the company's promotion,
 * strictly: unknown codes and currently-ineligible promotions are
 * errors (the caller turns them into a 400), never silent skips —
 * a customer who typed a code must learn why it did not work.
 */
export const resolveCouponPromotion = async (
  prisma: any,
  companyId: string,
  rawCode: unknown,
  subtotal: number
): Promise<{ promotion: PromotionLike } | { error: string }> => {
  const code = normalizeCouponCode(rawCode);
  if (!code) return { error: 'Coupon code is empty' };
  const promotion = await prisma.promotion.findFirst({
    where: { companyId, code }
  });
  if (!promotion) {
    return { error: `Coupon code "${code}" was not found` };
  }
  const eligibility = promotionEligibilityError(promotion, subtotal);
  if (eligibility) {
    return { error: `Coupon code "${code}" cannot be used: ${eligibility}` };
  }
  return { promotion };
};

/** Discount one BUY_X_GET_Y promotion grants over one pool of lines. */
const evaluateBxgyPool = (
  promo: PromotionLike,
  pool: Array<{ line: PromoLineInput; index: number }>
): { discount: number; perLine: Map<number, number> } => {
  const perLine = new Map<number, number>();
  const buyQty = promo.buyQty || 0;
  const getQty = promo.getQty || 0;
  if (buyQty < 1 || getQty < 1 || pool.length === 0) {
    return { discount: 0, perLine };
  }
  const groupSize = buyQty + getQty;
  const totalUnits = pool.reduce((sum, entry) => sum + entry.line.units, 0);
  let freeUnits = Math.floor(totalUnits / groupSize) * getQty;
  if (freeUnits <= 0) return { discount: 0, perLine };

  // Free units are valued at the pool's cheapest per-unit prices
  // first (the standard BXGY convention), attributed per line so the
  // order-level scoped bases can net them out again.
  const cheapestFirst = [...pool].sort((a, b) => {
    const unitA = a.line.units > 0 ? a.line.lineTotal / a.line.units : 0;
    const unitB = b.line.units > 0 ? b.line.lineTotal / b.line.units : 0;
    return unitA - unitB;
  });
  let discount = 0;
  for (const entry of cheapestFirst) {
    if (freeUnits <= 0) break;
    const freeHere = Math.min(freeUnits, entry.line.units);
    if (freeHere <= 0) continue;
    const unitValue = entry.line.units > 0 ? entry.line.lineTotal / entry.line.units : 0;
    const amount = round2(freeHere * unitValue);
    if (amount > 0) {
      perLine.set(entry.index, round2((perLine.get(entry.index) || 0) + amount));
      discount += amount;
    }
    freeUnits -= freeHere;
  }
  return { discount: round2(discount), perLine };
};

/**
 * Evaluate the full promotions pipeline for one cart. Pure — the
 * caller fetches the company's active promotions and (when a code was
 * sent) the strictly-resolved coupon promotion, and applies the
 * result inside the sale transaction.
 */
export const evaluatePromotions = (args: {
  /** All ACTIVE promotions of the company (any type, coded or not). */
  promotions: PromotionLike[];
  /** The promotion the sent coupon code resolved to, or null. */
  couponPromotion: PromotionLike | null;
  lines: PromoLineInput[];
  /** S — sum of line totals after item-level discounts. */
  subtotal: number;
  /** Raw manual-discount inputs, createSale semantics. */
  manualDiscountPercentage: number;
  manualDiscountAmount: number;
  now?: Date;
}): PromotionEvaluation => {
  const now = args.now || new Date();
  const applied: AppliedPromotion[] = [];
  const lineDiscountByLine = new Map<number, number>();

  // ── Stage 1: BUY_X_GET_Y (line level) ─────────────────────────────
  // Candidates: automatic offers, plus the coupon offer when the sent
  // code unlocked a BXGY promotion. Automatic candidates that are
  // currently ineligible are skipped; the coupon was already
  // strictly validated by the caller.
  const bxgyCandidates = args.promotions.filter((promo) => {
    if (promo.type !== 'BUY_X_GET_Y') return false;
    if (promo.code !== null && promo.code !== undefined) {
      return !!args.couponPromotion && promo.id === args.couponPromotion.id;
    }
    return promotionEligibilityError(promo, args.subtotal, now) === null;
  });

  // Claim each line for its most specific matching offer's pool.
  const pools = new Map<string, { candidates: PromotionLike[]; lines: Array<{ line: PromoLineInput; index: number }> }>();
  args.lines.forEach((line, index) => {
    const matching = bxgyCandidates.filter((promo) => lineMatchesScope(promo, line));
    if (matching.length === 0) return;
    const bestSpecificity = Math.max(...matching.map(scopeSpecificity));
    const poolKey = bestSpecificity === 3
      ? `PRODUCT:${line.productId}`
      : bestSpecificity === 2
        ? `CATEGORY:${line.categoryId}`
        : 'ALL';
    const poolCandidates = matching.filter((promo) => scopeSpecificity(promo) === bestSpecificity);
    if (!pools.has(poolKey)) {
      pools.set(poolKey, { candidates: poolCandidates, lines: [] });
    }
    pools.get(poolKey)!.lines.push({ line, index });
  });

  let lineDiscount = 0;
  for (const pool of pools.values()) {
    let winner: { promo: PromotionLike; discount: number; perLine: Map<number, number> } | null = null;
    for (const promo of pool.candidates) {
      const result = evaluateBxgyPool(promo, pool.lines);
      if (result.discount > 0 && (!winner || result.discount > winner.discount)) {
        winner = { promo, discount: result.discount, perLine: result.perLine };
      }
    }
    if (winner) {
      lineDiscount = round2(lineDiscount + winner.discount);
      for (const [index, amount] of winner.perLine) {
        lineDiscountByLine.set(index, round2((lineDiscountByLine.get(index) || 0) + amount));
      }
      applied.push({
        promotion: winner.promo,
        discountAmount: winner.discount,
        source: args.couponPromotion && winner.promo.id === args.couponPromotion.id ? 'COUPON' : 'LINE'
      });
    }
  }

  // ── Stage 2: manual discount against (S − B) ──────────────────────
  const afterLines = Math.max(0, round2(args.subtotal - lineDiscount));
  const manualDiscount = args.manualDiscountPercentage > 0
    ? (afterLines * args.manualDiscountPercentage) / 100
    : Math.min(Math.max(0, args.manualDiscountAmount || 0), afterLines);

  // ── Stage 3: order-level promotion against the scoped share of S2 ─
  const s2 = Math.max(0, round2(afterLines - manualDiscount));
  const orderBase = (promo: PromotionLike): number => {
    if (promo.scope === 'ALL') return s2;
    let scopedNet = 0;
    args.lines.forEach((line, index) => {
      if (lineMatchesScope(promo, line)) {
        scopedNet += line.lineTotal - (lineDiscountByLine.get(index) || 0);
      }
    });
    // The manual discount is spread across the bill proportionally,
    // so a scoped offer discounts its share of the post-manual base.
    const ratio = afterLines > 0 ? s2 / afterLines : 0;
    return Math.max(0, round2(scopedNet * ratio));
  };
  const orderDiscountFor = (promo: PromotionLike, base: number): number => {
    const raw = promo.type === 'PERCENT'
      ? (base * promo.value) / 100
      : Math.min(promo.value, base);
    return Math.max(0, Math.min(round2(raw), s2));
  };

  let orderDiscount = 0;
  let orderPromo: PromotionLike | null = null;
  if (s2 > 0) {
    if (args.couponPromotion && args.couponPromotion.type !== 'BUY_X_GET_Y') {
      orderPromo = args.couponPromotion;
      orderDiscount = orderDiscountFor(orderPromo, orderBase(orderPromo));
    } else if (!args.couponPromotion) {
      for (const promo of args.promotions) {
        if (promo.code !== null && promo.code !== undefined) continue;
        if (promo.type !== 'PERCENT' && promo.type !== 'FLAT') continue;
        if (promotionEligibilityError(promo, args.subtotal, now)) continue;
        const discount = orderDiscountFor(promo, orderBase(promo));
        // Strictly greater wins, so the earliest-created offer (the
        // caller's list is createdAt-ascending) takes ties.
        if (discount > orderDiscount) {
          orderDiscount = discount;
          orderPromo = promo;
        }
      }
    }
  }
  // A zero discount never counts as applied — for a coupon that is
  // exactly what makes couponNotApplied true below, so the caller can
  // reject it with a clear "does not apply" 400.
  if (orderPromo && orderDiscount > 0) {
    applied.push({
      promotion: orderPromo,
      discountAmount: orderDiscount,
      source: args.couponPromotion && orderPromo.id === args.couponPromotion.id ? 'COUPON' : 'ORDER'
    });
  } else {
    orderDiscount = 0;
  }

  const couponNotApplied = !!args.couponPromotion
    && !applied.some((entry) => entry.promotion.id === args.couponPromotion!.id);

  return {
    lineDiscount,
    lineDiscountByLine,
    manualDiscount,
    orderDiscount,
    totalDiscount: round2(lineDiscount + orderDiscount),
    applied,
    couponNotApplied
  };
};
