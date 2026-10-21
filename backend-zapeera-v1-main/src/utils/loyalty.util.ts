// Loyalty points helpers (Wave B3).
//
// Customer.loyaltyPoints is the cached points balance; the
// LoyaltyTransaction table is its append-only ledger. INVARIANT: every
// code path that changes the cached balance writes the matching ledger
// row (same signed delta) inside the SAME database transaction. The
// two helpers here are the only write/read points for that pairing:
//
//   - getLoyaltyPointValue: the PKR value of one point at redemption,
//     from the admin's `loyaltyPointValue` settings row (the same
//     per-admin key/value store `defaultTax` lives in). Missing,
//     unparsable or non-positive values fall back to 1 PKR per point —
//     redemption can never be silently zeroed by a bad setting.
//   - recordLoyaltyTransaction: writes ONE ledger row through the
//     caller's transaction client. The caller owns the matching
//     Customer.loyaltyPoints update in that same transaction.
//
// The earn rule is NOT here on purpose: it stays the long-standing
// formula at its existing call sites — Math.floor(totalAmount / 100),
// 1 point per full PKR 100 of a sale's final total.

export const LOYALTY_POINT_VALUE_SETTING_KEY = 'loyaltyPointValue';
export const DEFAULT_LOYALTY_POINT_VALUE = 1;

export const getLoyaltyPointValue = async (
  prisma: any,
  adminId: string | undefined | null
): Promise<number> => {
  if (!adminId) return DEFAULT_LOYALTY_POINT_VALUE;
  try {
    const setting = await prisma.settings.findUnique({
      where: {
        createdBy_key: {
          createdBy: adminId,
          key: LOYALTY_POINT_VALUE_SETTING_KEY
        }
      }
    });
    if (setting) {
      const parsed = parseFloat(setting.value);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  } catch (error) {
    console.warn('Could not fetch loyalty point value setting, using default:', error);
  }
  return DEFAULT_LOYALTY_POINT_VALUE;
};

export interface LoyaltyTransactionData {
  companyId: string;
  customerId: string;
  type: 'EARN' | 'REDEEM' | 'REVERSAL' | 'ADJUST';
  /** Signed delta that the caller applies to Customer.loyaltyPoints. */
  points: number;
  saleId?: string | null;
  refundId?: string | null;
  note?: string | null;
  createdBy?: string | null;
}

/**
 * Writes one loyalty ledger row via the caller's transaction client.
 * Zero-point movements write no row (callers guard on this too); the
 * cached balance is the caller's responsibility in the same tx.
 */
export const recordLoyaltyTransaction = async (
  tx: any,
  data: LoyaltyTransactionData
): Promise<void> => {
  if (!data.points) return;
  await tx.loyaltyTransaction.create({
    data: {
      companyId: data.companyId,
      customerId: data.customerId,
      type: data.type,
      points: data.points,
      saleId: data.saleId || null,
      refundId: data.refundId || null,
      note: data.note || null,
      createdBy: data.createdBy || null
    }
  });
};

/**
 * Points a sale earned under the unchanged earn rule. Prefers the
 * value stored on the sale at creation (Wave B3+ sales) and falls back
 * to recomputing it from the final total for pre-B3 sales, whose earn
 * was credited by the same formula.
 */
export const loyaltyPointsEarnedForSale = (sale: {
  loyaltyPointsEarned?: number | null;
  totalAmount?: number | null;
}): number => {
  if (sale.loyaltyPointsEarned !== null && sale.loyaltyPointsEarned !== undefined) {
    return sale.loyaltyPointsEarned;
  }
  return Math.floor(Number(sale.totalAmount || 0) / 100);
};
