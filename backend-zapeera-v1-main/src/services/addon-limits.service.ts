/**
 * Subscription Add-ons — catalogue, plan-inclusion matrix and the ONE
 * effective-limits function every gate must use.
 *
 * Product contract: ZAPEERA_ADDONS_PROPOSAL_2026-10-24 (approved by
 * Muhammad 2026-10-24, prices finalized the same day against the
 * competitor analysis):
 *
 *   - Trial and Starter are OWNER-ONLY: no staff seats, no staff/HR
 *     system. Staff starts at Growth — or on Starter via the HR Pack.
 *   - Add-ons: HR_PACK Rs 1,500/mo (incl. 5 staff seats, Starter),
 *     EXTRA_SEAT Rs 500/mo, EXTRA_BRANCH Rs 1,500/mo, REPORTS_PACK
 *     Rs 800/mo, FINANCE_PACK Rs 1,000/mo, VOICE_BOOSTER Rs 500/mo
 *     (+300k voice tokens), WHATSAPP_PACK Rs 800/mo (one per business;
 *     reminders/statements/bulk sharing — the basic single-receipt
 *     WhatsApp share stays included in Starter and is NOT gated here).
 *   - Paid plans only: nothing can be purchased on the 15-day trial.
 *   - Prices are MONTHLY ONLY (no annual pricing, no discount). A
 *     client may prepay whole months (1/3/6/12 in the UI; the API
 *     accepts any positive integer): charge = monthly price × months,
 *     paid-through extends by that many 30-day cycles. An add-on's
 *     paid-through never extends past the plan's own paid-through
 *     horizon (see computeAddonPeriodEnd).
 *   - ONLINE_STORE_PACK and PRESCRIPTION_UPLOAD_PACK (Wave C5 —
 *     gap item 5, split 2026-10-25 on Muhammad's correction: the
 *     store and the prescription upload are TWO separate packs) are
 *     priced since 2026-10-25 (Muhammad's order, competitor-based):
 *     the store is Rs 500/mo — CloudPOS charges PKR 5,000/yr for
 *     the store (~Rs 417/mo annualised), rounded to a monthly-flexible
 *     Rs 500 with no setup fee and no lock-in; prescription upload is
 *     Rs 1,000/mo — undercutting CloudPOS's PKR 15,000/yr (Rs 1,250/mo)
 *     by 20%. The gates (onlineStoreAllowed /
 *     prescriptionUploadAllowed) work off the granted rows.
 *
 * The plan-inclusion matrix below is the single source for what each
 * plan includes on its own; it MIRRORS the public pricing page
 * (zapeera.seikho.online/pricing — per-plan cards + comparison matrix).
 * If the pricing page changes, change this matrix in the same commit.
 *
 * Persistence: SubscriptionAddon rows (prisma/subscription_addons) —
 * one row per (business, type); cancel is a status flip, rows are
 * never deleted. The legacy settings-based 'addon_assignment'
 * entitlements (extra_user / extra_branch / feature_* in
 * subscription-entitlements.util) are a SEPARATE older system used for
 * pricing display; they are not read here and grant nothing here.
 */

import { PLANS, PLAN_DISPLAY_NAMES, PlanId } from '../config/constants';
import { getVoiceAiConfig, quotaForPlan } from '../utils/voice-ai-config.util';

export const ADDON_TYPES = [
  'HR_PACK',
  'EXTRA_SEAT',
  'EXTRA_BRANCH',
  'REPORTS_PACK',
  'FINANCE_PACK',
  'VOICE_BOOSTER',
  'WHATSAPP_PACK',
  'ONLINE_STORE_PACK',
  'PRESCRIPTION_UPLOAD_PACK',
] as const;
export type AddonType = (typeof ADDON_TYPES)[number];

export interface AddonCatalogueEntry {
  type: AddonType;
  name: string;
  description: string;
  /** PKR per month. Stackable add-ons are priced per unit. */
  priceMonthly: number;
  stackable: boolean;
  unitLabel?: string;
  /**
   * True while the price is UNDECIDED: the entry is listed but cannot
   * be purchased (see checkAddonPurchasable) until the price is set.
   * Never treat priceMonthly 0 on such an entry as "free". No
   * catalogue entry is pending today (the last two —
   * ONLINE_STORE_PACK and PRESCRIPTION_UPLOAD_PACK — were priced
   * 2026-10-25); the flag is kept for any future unpriced pack.
   */
  pricingPending?: boolean;
}

export const ADDON_CATALOGUE: Record<AddonType, AddonCatalogueEntry> = {
  HR_PACK: {
    type: 'HR_PACK',
    name: 'HR Pack',
    description:
      'The full staff/HR system on an owner-only plan: staff accounts, roles & permissions and attendance. Includes 5 staff seats.',
    priceMonthly: 1500,
    stackable: false,
  },
  EXTRA_SEAT: {
    type: 'EXTRA_SEAT',
    name: 'Extra Staff Seat',
    description: 'One more staff seat beyond the staff seats your plan (or HR Pack) already includes.',
    priceMonthly: 500,
    stackable: true,
    unitLabel: 'seat',
  },
  EXTRA_BRANCH: {
    type: 'EXTRA_BRANCH',
    name: 'Extra Branch',
    description: 'One more branch beyond your plan’s branch limit.',
    priceMonthly: 1500,
    stackable: true,
    unitLabel: 'branch',
  },
  REPORTS_PACK: {
    type: 'REPORTS_PACK',
    name: 'Advanced Reports Pack',
    description:
      'Real-profit deep reports (true batch-cost profit, margin breakdowns). On Growth it also unlocks multi-branch consolidated reporting.',
    priceMonthly: 800,
    stackable: false,
  },
  FINANCE_PACK: {
    type: 'FINANCE_PACK',
    name: 'Finance Pack',
    description:
      'The bookkeeping toolkit: expense tracking & categories, income/expense ledger, day-end cash closing, supplier payment tracking, tax reports and the profit & loss statement.',
    priceMonthly: 1000,
    stackable: false,
  },
  VOICE_BOOSTER: {
    type: 'VOICE_BOOSTER',
    name: 'Voice AI Booster',
    description: '+300,000 voice-AI tokens per month on top of your plan’s voice quota.',
    priceMonthly: 500,
    stackable: true,
    unitLabel: 'booster',
  },
  WHATSAPP_PACK: {
    type: 'WHATSAPP_PACK',
    name: 'WhatsApp Pack',
    description:
      'The WhatsApp layer beyond basic receipt sharing: khata/payment reminders, customer statements on WhatsApp and bulk bill sharing.',
    priceMonthly: 800,
    stackable: false,
  },
  ONLINE_STORE_PACK: {
    type: 'ONLINE_STORE_PACK',
    name: 'Online Pharmacy Store',
    description:
      'Customer-facing online pharmacy storefront for a branch (browse/search the branch catalog, cart, cash-on-delivery checkout into a real sale). Prescription upload is a separate pack.',
    // Priced 2026-10-25 (Muhammad's order, competitor-based):
    // Rs 500/mo. CloudPOS reference: store PKR 5,000/yr (~Rs 417/mo
    // annualised) — Zapeera rounds to Rs 500/mo, monthly-flexible,
    // no setup fee, no lock-in.
    priceMonthly: 500,
    stackable: false,
  },
  PRESCRIPTION_UPLOAD_PACK: {
    type: 'PRESCRIPTION_UPLOAD_PACK',
    name: 'Prescription Upload',
    description:
      'Let patients upload prescription photos from the online storefront for pharmacist review before dispensing (upload, review queue, approve/reject with transcription). Needs the Online Pharmacy Store for checkout.',
    // Priced 2026-10-25 (Muhammad's order, competitor-based):
    // Rs 1,000/mo. CloudPOS reference: prescription upload
    // PKR 15,000/yr (Rs 1,250/mo) — Zapeera undercuts by 20%.
    priceMonthly: 1000,
    stackable: false,
  },
};

export const HR_PACK_INCLUDED_SEATS = 5;
export const VOICE_BOOSTER_TOKENS = 300_000;
/** One billing "month" everywhere in the product: a 30-day cycle. */
export const ADDON_MONTH_DAYS = 30;

export interface PlanInclusion {
  maxBranches: number;
  /** Staff seats included in the plan itself. The OWNER never counts. */
  staffSeats: number;
  staff: boolean;
  finance: boolean;
  advancedReports: boolean;
  multiBranchReports: boolean;
}

/**
 * What each plan includes WITHOUT add-ons. Mirrors the pricing page
 * (see file header). Staff seats: Trial 0 / Starter 0 / Growth 20 /
 * Scale 100. Voice quotas are NOT here — they live in the
 * backoffice-editable voice-AI config (voice-ai-config.util).
 */
export const PLAN_INCLUSIONS: Record<PlanId, PlanInclusion> = {
  [PLANS.TRIAL]: {
    maxBranches: 1,
    staffSeats: 0,
    staff: false,
    finance: false,
    advancedReports: false,
    multiBranchReports: false,
  },
  [PLANS.STARTER]: {
    maxBranches: 1,
    staffSeats: 0,
    staff: false,
    finance: false,
    advancedReports: false,
    multiBranchReports: false,
  },
  [PLANS.GROWTH]: {
    maxBranches: 3,
    staffSeats: 20,
    staff: true,
    finance: true,
    advancedReports: true,
    multiBranchReports: false,
  },
  [PLANS.SCALE]: {
    maxBranches: 10,
    staffSeats: 100,
    staff: true,
    finance: true,
    advancedReports: true,
    multiBranchReports: true,
  },
};

const TRIAL_INCLUSION = PLAN_INCLUSIONS[PLANS.TRIAL];

export function isAddonType(value: unknown): value is AddonType {
  return typeof value === 'string' && (ADDON_TYPES as readonly string[]).includes(value);
}

/** A row grants its capability while ACTIVE, or CANCEL_PENDING until its paid-through date. */
export function isAddonRowEffective(row: { status: string; periodEnd: Date | string | null }, now = new Date()): boolean {
  const status = String(row.status || '').toUpperCase();
  if (status === 'ACTIVE') {
    // An ACTIVE row whose paid-through date has passed grants nothing
    // until it is renewed (re-purchase) — same rule as subscriptions.
    if (row.periodEnd && new Date(row.periodEnd).getTime() <= now.getTime()) return false;
    return true;
  }
  if (status === 'CANCEL_PENDING') {
    if (row.periodEnd && new Date(row.periodEnd).getTime() <= now.getTime()) return false;
    return true;
  }
  return false;
}

export interface ActiveAddon {
  type: AddonType;
  quantity: number;
  status: string;
  periodEnd: Date | null;
}

export interface EffectiveLimits {
  businessId: string;
  planId: string;
  planName: string;
  /** False when the business has no subscription row (still setting up) — inclusions fall back to Trial. */
  hasSubscription: boolean;
  isTrial: boolean;
  maxBranches: number;
  /** Total staff seats (plan + HR Pack + extra seats). Owner excluded. */
  maxStaffSeats: number;
  staffAllowed: boolean;
  financeAllowed: boolean;
  advancedReportsAllowed: boolean;
  multiBranchReportsAllowed: boolean;
  whatsappPack: boolean;
  /**
   * Online store (Wave C5 — gap item 5): true while an
   * ONLINE_STORE_PACK row is effective for the business. Gates the
   * public storefront (catalog / checkout) and the storefront half
   * of the staff Online Store page. The pack is NOT included in any
   * plan — it is add-on-only, priced Rs 500/mo since 2026-10-25.
   */
  onlineStoreAllowed: boolean;
  /**
   * Prescription upload (Wave C5 — gap item 5, split 2026-10-25):
   * true while a PRESCRIPTION_UPLOAD_PACK row is effective for the
   * business. Gates the public prescription upload + status check
   * and the review-queue half of the staff Online Store page. A
   * separate pack from the store itself — same add-on-only rule,
   * priced Rs 1,000/mo since 2026-10-25.
   */
  prescriptionUploadAllowed: boolean;
  /** Monthly voice-AI token quota: plan quota (voice-AI config) + boosters. */
  voiceTokenQuota: number;
  /** Sum of monthly add-on prices (catalogue price × quantity). */
  monthlyAddonSpend: number;
  addons: ActiveAddon[];
}

async function getBusinessPlan(prisma: any, businessId: string) {
  const sub = await prisma.businessSubscription.findUnique({
    where: { businessId },
    select: { planId: true, status: true, currentPeriodEnd: true, trialEndsAt: true },
  });
  return sub as
    | { planId: string; status: string; currentPeriodEnd: Date | null; trialEndsAt: Date | null }
    | null;
}

function resolveInclusion(planId: string | null | undefined): { planId: PlanId; inclusion: PlanInclusion } {
  const known = (Object.values(PLANS) as string[]).includes(String(planId || ''));
  const resolved = (known ? String(planId) : PLANS.TRIAL) as PlanId;
  return { planId: resolved, inclusion: PLAN_INCLUSIONS[resolved] || TRIAL_INCLUSION };
}

/**
 * THE effective-limits function. Every add-on/plan gate in the backend
 * must go through this — never re-derive plan + add-on math inline.
 */
export async function getEffectiveLimits(prisma: any, businessId: string): Promise<EffectiveLimits> {
  const sub = await getBusinessPlan(prisma, businessId);
  const { planId, inclusion } = resolveInclusion(sub?.planId);
  const isTrial = planId === PLANS.TRIAL || String(sub?.status || '').toUpperCase() === 'TRIAL';

  let rows: any[] = [];
  try {
    rows = await prisma.subscriptionAddon.findMany({ where: { businessId } });
  } catch {
    rows = []; // table not yet created on an un-migrated DB — plan-only limits
  }
  const now = new Date();
  const active: ActiveAddon[] = rows
    .filter((r) => isAddonType(r.type) && isAddonRowEffective(r, now))
    .map((r) => ({
      type: r.type as AddonType,
      quantity: Math.max(1, Number(r.quantity) || 1),
      status: String(r.status),
      periodEnd: r.periodEnd ? new Date(r.periodEnd) : null,
    }));
  const qty = (t: AddonType) => active.filter((a) => a.type === t).reduce((s, a) => s + a.quantity, 0);
  const has = (t: AddonType) => qty(t) > 0;

  const hrPack = has('HR_PACK');
  const staffAllowed = inclusion.staff || hrPack;
  const maxStaffSeats =
    inclusion.staffSeats + (hrPack ? HR_PACK_INCLUDED_SEATS : 0) + qty('EXTRA_SEAT');
  const maxBranches = inclusion.maxBranches + qty('EXTRA_BRANCH');
  const financeAllowed = inclusion.finance || has('FINANCE_PACK');
  const advancedReportsAllowed = inclusion.advancedReports || has('REPORTS_PACK');
  const multiBranchReportsAllowed = inclusion.multiBranchReports || has('REPORTS_PACK');
  const whatsappPack = has('WHATSAPP_PACK');
  const onlineStoreAllowed = has('ONLINE_STORE_PACK');
  const prescriptionUploadAllowed = has('PRESCRIPTION_UPLOAD_PACK');

  const voiceConfig = await getVoiceAiConfig(prisma);
  const voiceTokenQuota = quotaForPlan(voiceConfig, planId) + qty('VOICE_BOOSTER') * VOICE_BOOSTER_TOKENS;

  const monthlyAddonSpend = active.reduce(
    (sum, a) => sum + ADDON_CATALOGUE[a.type].priceMonthly * a.quantity,
    0
  );

  return {
    businessId,
    planId,
    planName: PLAN_DISPLAY_NAMES[planId] || planId,
    hasSubscription: !!sub,
    isTrial,
    maxBranches,
    maxStaffSeats: staffAllowed ? maxStaffSeats : 0,
    staffAllowed,
    financeAllowed,
    advancedReportsAllowed,
    multiBranchReportsAllowed,
    whatsappPack,
    onlineStoreAllowed,
    prescriptionUploadAllowed,
    voiceTokenQuota,
    monthlyAddonSpend,
    addons: active,
  };
}

/** Monthly voice-AI token limit for a business (plan quota + boosters). Used by the voice service. */
export async function getVoiceTokenLimit(prisma: any, businessId: string): Promise<number> {
  const limits = await getEffectiveLimits(prisma, businessId);
  return limits.voiceTokenQuota;
}

/** Effective (paid-through, non-cancelled) quantity of one add-on type for a business. */
export async function getEffectiveAddonQuantity(
  prisma: any,
  businessId: string,
  type: AddonType
): Promise<number> {
  try {
    const rows = await prisma.subscriptionAddon.findMany({ where: { businessId, type } });
    const now = new Date();
    return rows
      .filter((r: any) => isAddonRowEffective(r, now))
      .reduce((sum: number, r: any) => sum + Math.max(1, Number(r.quantity) || 1), 0);
  } catch {
    return 0;
  }
}

/**
 * Count the staff seats a business is currently using: ACTIVE
 * memberships that are NOT the owner. A membership is the owner's when
 * its user created the business or its role is OWNER/ADMIN (mirrors the
 * role normalization in multitenancy resolveMembership).
 */
export async function countStaffSeats(prisma: any, businessId: string): Promise<number> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { createdBy: true },
  });
  const memberships = await prisma.membership.findMany({
    where: { businessId, status: 'ACTIVE' },
    select: { userId: true, role: { select: { name: true } } },
  });
  let seats = 0;
  for (const m of memberships) {
    const roleName = String(m.role?.name || '').toUpperCase();
    if (roleName === 'OWNER' || roleName === 'ADMIN') continue;
    if (business?.createdBy && String(m.userId) === String(business.createdBy)) continue;
    seats += 1;
  }
  return seats;
}

export type AddonPurchaseCheck =
  | { ok: true }
  | { ok: false; statusCode: number; code: string; message: string };

/**
 * Can this business buy (or renew / re-quantity) this add-on right now?
 * Encodes proposal rules 1 (paid plans only) + per-add-on buyability.
 */
export function checkAddonPurchasable(
  limits: EffectiveLimits,
  type: AddonType
): AddonPurchaseCheck {
  if (limits.isTrial) {
    return {
      ok: false,
      statusCode: 403,
      code: 'ADDON_TRIAL_NOT_ALLOWED',
      message: 'Add-ons are available on paid plans. Finish your 15-day free trial or upgrade to a paid plan first.',
    };
  }
  const already = (msg: string): AddonPurchaseCheck => ({
    ok: false,
    statusCode: 409,
    code: 'ADDON_ALREADY_INCLUDED',
    message: msg,
  });
  switch (type) {
    case 'HR_PACK':
      if (PLAN_INCLUSIONS[limits.planId as PlanId]?.staff) {
        return already('Your plan already includes the full staff/HR system.');
      }
      return { ok: true };
    case 'EXTRA_SEAT':
      if (!limits.staffAllowed) {
        return {
          ok: false,
          statusCode: 409,
          code: 'ADDON_REQUIRES_STAFF_ACCESS',
          message: 'Extra staff seats need staff access first — add the HR Pack, or upgrade to Growth.',
        };
      }
      return { ok: true };
    case 'EXTRA_BRANCH':
      return { ok: true };
    case 'REPORTS_PACK':
      if (
        PLAN_INCLUSIONS[limits.planId as PlanId]?.advancedReports &&
        PLAN_INCLUSIONS[limits.planId as PlanId]?.multiBranchReports
      ) {
        return already('Your plan already includes all advanced reports.');
      }
      return { ok: true };
    case 'FINANCE_PACK':
      if (PLAN_INCLUSIONS[limits.planId as PlanId]?.finance) {
        return already('Your plan already includes the finance toolkit.');
      }
      return { ok: true };
    case 'VOICE_BOOSTER':
      return { ok: true };
    case 'WHATSAPP_PACK':
      return { ok: true };
    case 'ONLINE_STORE_PACK':
    case 'PRESCRIPTION_UPLOAD_PACK':
      // Priced 2026-10-25 (Muhammad's order, competitor-based):
      // store Rs 500/mo, upload Rs 1,000/mo — purchasable. The 409
      // ADDON_PRICING_PENDING branch that lived here was removed
      // with the pricing; the refusal path itself stays for any
      // future unpriced pack via entry.pricingPending.
      return { ok: true };
    default:
      return { ok: false, statusCode: 400, code: 'ADDON_UNKNOWN_TYPE', message: 'Unknown add-on.' };
  }
}

/**
 * Paid-through date for a purchase of `months` whole months starting
 * now. Rule (Muhammad's billing-duration refinement): an add-on is
 * bought in whole months UP TO the plan's current paid-through
 * horizon — if the plan is paid through sooner than now + months, the
 * add-on's paid-through caps at the plan's currentPeriodEnd and only
 * the whole months that fit are charged (minimum 1).
 */
export function computeAddonPeriod(
  now: Date,
  months: number,
  planPeriodEnd: Date | null
): { periodEnd: Date; chargedMonths: number } {
  const wanted = new Date(now.getTime() + months * ADDON_MONTH_DAYS * 24 * 60 * 60 * 1000);
  if (!planPeriodEnd || planPeriodEnd.getTime() >= wanted.getTime()) {
    return { periodEnd: wanted, chargedMonths: months };
  }
  if (planPeriodEnd.getTime() <= now.getTime()) {
    // Plan already past its paid-through date (renewal pending): the
    // add-on still sells in whole months from now; the plan renewal
    // will re-align horizons. Charge the requested months.
    return { periodEnd: wanted, chargedMonths: months };
  }
  const fitMonths = Math.max(
    1,
    Math.floor((planPeriodEnd.getTime() - now.getTime()) / (ADDON_MONTH_DAYS * 24 * 60 * 60 * 1000))
  );
  return { periodEnd: planPeriodEnd, chargedMonths: Math.min(months, fitMonths) };
}

export function normalizeMonths(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const m = Math.floor(n);
  return m >= 1 && m <= 36 ? m : null;
}
