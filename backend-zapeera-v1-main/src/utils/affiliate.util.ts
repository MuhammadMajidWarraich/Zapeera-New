import crypto from 'crypto';

/**
 * Affiliate program — pure helpers + DB-touching accrual/attribution.
 *
 * Money rules (kept deliberately boring and auditable):
 *  - A commission accrues ONLY on a real money-in moment: a payment
 *    proof approved by backoffice, or a non-trial plan ASSIGNMENT by
 *    backoffice (the admin is the payment authority there — see
 *    backoffice-subscriptions.controller). Trials never accrue.
 *  - Deduplication is structural: AffiliateCommission.sourceRef is
 *    UNIQUE. The accrual helper swallows the unique-violation (P2002)
 *    and reports `created: false`, so a re-approval, a double click,
 *    or a retried request can never double-accrue.
 *  - Rate resolution: the affiliate's own commissionRate override wins;
 *    otherwise the global default (affiliate-config.util).
 *  - Amounts are percent-of-basis rounded half-up to 2 decimals.
 */

export const AFFILIATE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L ambiguity
export const AFFILIATE_CODE_LENGTH = 8;

/** Generate one candidate referral code (uniqueness is enforced by the DB unique index + retry loop in the caller). */
export function generateAffiliateCodeCandidate(): string {
  const bytes = crypto.randomBytes(AFFILIATE_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < AFFILIATE_CODE_LENGTH; i++) {
    code += AFFILIATE_CODE_ALPHABET[bytes[i] % AFFILIATE_CODE_ALPHABET.length];
  }
  return code;
}

/** Normalize a user-supplied code (URL param / payload) for lookup. */
export function normalizeAffiliateCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().toUpperCase().replace(/^ZAP-/, '').replace(/[^A-Z0-9]/g, '');
  return cleaned.length > 0 ? cleaned : null;
}

export function isPlausibleAffiliateCode(code: string | null): code is string {
  return !!code && code.length >= 4 && code.length <= 16;
}

/** Percent applied for an affiliate: per-affiliate override ?? global default. */
export function resolveCommissionRate(override: number | null | undefined, globalDefault: number): number {
  if (typeof override === 'number' && Number.isFinite(override) && override >= 0) return override;
  return globalDefault;
}

/** Commission amount for a basis at a percent rate — half-up, 2dp. */
export function computeCommissionAmount(basisAmount: number, ratePercent: number): number {
  if (!(basisAmount > 0) || !(ratePercent > 0)) return 0;
  return Math.round(((basisAmount * ratePercent) / 100) * 100) / 100;
}

export interface AffiliateBalanceSummary {
  totalEarned: number; // all non-VOID commissions
  pendingApproval: number; // status PENDING
  approvedUnpaid: number; // status APPROVED, not yet paid out
  paidCommissions: number; // status PAID
  payoutsPaid: number; // AffiliatePayout rows with status PAID
  payoutsRequested: number; // AffiliatePayout rows with status REQUESTED (reserved)
  availableBalance: number; // earned (PENDING+APPROVED+PAID) - payouts PAID - payouts REQUESTED
}

/**
 * Pure balance math over an affiliate's commission + payout rows.
 * A commission marked PAID stays part of totalEarned (it was settled
 * through a payout); the payout rows are what actually reduce the
 * available balance, so available = earned − paid-out − requested.
 */
export function summarizeAffiliateBalance(
  commissions: Array<{ amount: number; status: string }>,
  payouts: Array<{ amount: number; status: string }>
): AffiliateBalanceSummary {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  let totalEarned = 0;
  let pendingApproval = 0;
  let approvedUnpaid = 0;
  let paidCommissions = 0;
  for (const c of commissions) {
    if (c.status === 'VOID') continue;
    totalEarned += c.amount;
    if (c.status === 'PENDING') pendingApproval += c.amount;
    else if (c.status === 'APPROVED') approvedUnpaid += c.amount;
    else if (c.status === 'PAID') paidCommissions += c.amount;
  }
  let payoutsPaid = 0;
  let payoutsRequested = 0;
  for (const p of payouts) {
    if (p.status === 'PAID') payoutsPaid += p.amount;
    else if (p.status === 'REQUESTED') payoutsRequested += p.amount;
  }
  return {
    totalEarned: round2(totalEarned),
    pendingApproval: round2(pendingApproval),
    approvedUnpaid: round2(approvedUnpaid),
    paidCommissions: round2(paidCommissions),
    payoutsPaid: round2(payoutsPaid),
    payoutsRequested: round2(payoutsRequested),
    availableBalance: round2(totalEarned - payoutsPaid - payoutsRequested)
  };
}

// ── DB-touching helpers ────────────────────────────────────────────────

const isUniqueViolation = (error: any): boolean => error?.code === 'P2002';

export interface AccrueResult {
  created: boolean;
  reason?: 'NO_REFERRAL' | 'AFFILIATE_NOT_ACTIVE' | 'ZERO_AMOUNT' | 'DUPLICATE_SOURCE';
  commissionId?: string;
  amount?: number;
  rateApplied?: number;
}

/**
 * Accrue a commission for a money-in event on a business.
 * Safe to call from any payment path: never throws for business-rule
 * reasons, and a duplicate sourceRef is a silent no-op (dedupe proof).
 * Callers should still wrap in try/catch — an affiliate hiccup must
 * never break a payment flow.
 */
export async function accrueAffiliateCommission(
  prisma: any,
  args: { businessId: string; sourceRef: string; basisAmount: number }
): Promise<AccrueResult> {
  const { businessId, sourceRef, basisAmount } = args;
  if (!(basisAmount > 0)) return { created: false, reason: 'ZERO_AMOUNT' };

  const referral = await prisma.affiliateReferral.findUnique({
    where: { businessId },
    include: { affiliate: true }
  });
  if (!referral) return { created: false, reason: 'NO_REFERRAL' };
  if (referral.affiliate.status !== 'ACTIVE') return { created: false, reason: 'AFFILIATE_NOT_ACTIVE' };

  // Lazy import to avoid a module cycle (config util only needs prisma).
  const { getAffiliateConfig } = await import('./affiliate-config.util');
  const config = await getAffiliateConfig(prisma);
  const rateApplied = resolveCommissionRate(referral.affiliate.commissionRate, config.defaultRate);
  const amount = computeCommissionAmount(basisAmount, rateApplied);
  if (!(amount > 0)) return { created: false, reason: 'ZERO_AMOUNT' };

  try {
    const commission = await prisma.affiliateCommission.create({
      data: {
        affiliateId: referral.affiliateId,
        businessId,
        sourceRef,
        basisAmount,
        rateApplied,
        amount,
        status: 'PENDING'
      }
    });
    return { created: true, commissionId: commission.id, amount, rateApplied };
  } catch (error: any) {
    if (isUniqueViolation(error)) return { created: false, reason: 'DUPLICATE_SOURCE' };
    throw error;
  }
}

/**
 * Create the referral for a business if it is the creator's FIRST
 * business and a valid ACTIVE affiliate code is known (explicit
 * refCode from the create payload, else the code captured at signup).
 * Idempotent: AffiliateReferral.businessId is unique, and a business
 * that is already attributed is left untouched.
 */
export async function attributeFirstBusinessIfReferred(
  prisma: any,
  args: { businessId: string; creatorUserId: string; refCode?: string | null }
): Promise<{ attributed: boolean; reason?: string }> {
  const businessCount = await prisma.business.count({ where: { createdBy: args.creatorUserId } });
  if (businessCount !== 1) return { attributed: false, reason: 'NOT_FIRST_BUSINESS' };

  let code = normalizeAffiliateCode(args.refCode);
  if (!code) {
    const user = await prisma.zapeeraUser.findUnique({
      where: { id: args.creatorUserId },
      select: { signupRefCode: true }
    });
    code = normalizeAffiliateCode(user?.signupRefCode);
  }
  if (!isPlausibleAffiliateCode(code)) return { attributed: false, reason: 'NO_CODE' };

  const affiliate = await prisma.affiliate.findUnique({ where: { code } });
  if (!affiliate) return { attributed: false, reason: 'CODE_NOT_FOUND' };
  if (affiliate.status !== 'ACTIVE') return { attributed: false, reason: 'AFFILIATE_NOT_ACTIVE' };
  if (affiliate.userId === args.creatorUserId) return { attributed: false, reason: 'SELF_REFERRAL' };

  try {
    await prisma.affiliateReferral.create({
      data: { affiliateId: affiliate.id, businessId: args.businessId, referredUserId: args.creatorUserId }
    });
    return { attributed: true };
  } catch (error: any) {
    if (isUniqueViolation(error)) return { attributed: false, reason: 'ALREADY_ATTRIBUTED' };
    throw error;
  }
}
