/**
 * Subscription Add-ons — EMBEDDED (desktop) mirror of the web backend's
 * src/services/addon-limits.service.ts. Same catalogue, same plan-inclusion
 * matrix, same effective-limits semantics, same error codes/messages, so the
 * desktop app behaves identically to the cloud for add-ons and for the
 * Trial/Starter owner-only gates.
 *
 * Deliberate desktop differences (data sources only — never semantics):
 *  - The business's plan comes from the synced `memberships` table
 *    (subscriptionPlan / subscriptionStatus), the same source the embedded
 *    subscription routes already use. Memberships carry no period end, so
 *    computeAddonPeriod is called with planPeriodEnd = null (add-on periods
 *    then run the full requested months from purchase).
 *  - Staff seats are counted from the local `users` table (the rows the
 *    desktop staff screens create): users of the company excluding the
 *    company creator and OWNER/ADMIN roles — the web counts memberships to
 *    the same effect.
 *  - Voice quotas use the shipped defaults (the web reads a Backoffice-
 *    editable config synced from the cloud; the defaults are identical).
 *
 * Add-on rows live in the local `subscription_addons` table (see
 * database.service.js). Purchases made on desktop activate immediately
 * (embedded convention); the web tenant flow can return PENDING when direct
 * activation is disabled there — the row/response shapes are the same.
 */

const ADDON_TYPES = [
  'HR_PACK',
  'EXTRA_SEAT',
  'EXTRA_BRANCH',
  'REPORTS_PACK',
  'FINANCE_PACK',
  'VOICE_BOOSTER',
  'WHATSAPP_PACK',
];

const ADDON_CATALOGUE = {
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
};

const HR_PACK_INCLUDED_SEATS = 5;
const VOICE_BOOSTER_TOKENS = 300000;
/** One billing "month" everywhere in the product: a 30-day cycle. */
const ADDON_MONTH_DAYS = 30;

const PLAN_DISPLAY_NAMES = {
  'single-trial': 'Trial',
  'single-starter': 'Starter',
  'single-growth': 'Growth',
  'single-scale': 'Scale',
};

/** What each plan includes WITHOUT add-ons. Mirrors the web matrix + pricing page. */
const PLAN_INCLUSIONS = {
  'single-trial': {
    maxBranches: 1,
    staffSeats: 0,
    staff: false,
    finance: false,
    advancedReports: false,
    multiBranchReports: false,
  },
  'single-starter': {
    maxBranches: 1,
    staffSeats: 0,
    staff: false,
    finance: false,
    advancedReports: false,
    multiBranchReports: false,
  },
  'single-growth': {
    maxBranches: 3,
    staffSeats: 20,
    staff: true,
    finance: true,
    advancedReports: true,
    multiBranchReports: false,
  },
  'single-scale': {
    maxBranches: 10,
    staffSeats: 100,
    staff: true,
    finance: true,
    advancedReports: true,
    multiBranchReports: true,
  },
};

/** Default monthly voice-AI token quotas per plan (mirror of the web defaults). */
const PLAN_VOICE_QUOTAS = {
  'single-trial': 100000,
  'single-starter': 300000,
  'single-growth': 900000,
  'single-scale': 3000000,
};

function isAddonType(value) {
  return typeof value === 'string' && ADDON_TYPES.includes(value);
}

/** A row grants its capability while ACTIVE, or CANCEL_PENDING until its paid-through date. */
function isAddonRowEffective(row, now = new Date()) {
  const status = String((row && row.status) || '').toUpperCase();
  if (status === 'ACTIVE' || status === 'CANCEL_PENDING') {
    if (row.periodEnd && new Date(row.periodEnd).getTime() <= now.getTime()) return false;
    return true;
  }
  return false;
}

function resolveBusinessPlan(query, businessId) {
  const rows = query(
    'SELECT subscriptionPlan, subscriptionStatus FROM memberships WHERE businessId = ? ORDER BY updatedAt DESC LIMIT 1',
    [businessId]
  );
  const row = rows && rows.length > 0 ? rows[0] : null;
  if (!row) return { planId: 'single-trial', status: null, hasSubscription: false };
  const planId = PLAN_INCLUSIONS[row.subscriptionPlan] ? row.subscriptionPlan : 'single-trial';
  return { planId, status: row.subscriptionStatus || null, hasSubscription: true };
}

function getAddonRows(query, businessId) {
  try {
    return query('SELECT * FROM subscription_addons WHERE businessId = ?', [businessId]) || [];
  } catch (e) {
    return []; // table missing on an un-migrated DB — plan-only limits
  }
}

/** THE effective-limits function (desktop mirror). Every add-on/plan gate uses this. */
function getEffectiveLimits(query, businessId) {
  const { planId, status, hasSubscription } = resolveBusinessPlan(query, businessId);
  const inclusion = PLAN_INCLUSIONS[planId];
  const isTrial = planId === 'single-trial' || String(status || '').toUpperCase() === 'TRIAL';

  const now = new Date();
  const active = getAddonRows(query, businessId)
    .filter((r) => isAddonType(r.type) && isAddonRowEffective(r, now))
    .map((r) => ({
      type: r.type,
      quantity: Math.max(1, Number(r.quantity) || 1),
      status: String(r.status),
      periodEnd: r.periodEnd ? new Date(r.periodEnd) : null,
    }));
  const qty = (t) => active.filter((a) => a.type === t).reduce((s, a) => s + a.quantity, 0);
  const has = (t) => qty(t) > 0;

  const hrPack = has('HR_PACK');
  const staffAllowed = inclusion.staff || hrPack;
  const maxStaffSeats = inclusion.staffSeats + (hrPack ? HR_PACK_INCLUDED_SEATS : 0) + qty('EXTRA_SEAT');
  const maxBranches = inclusion.maxBranches + qty('EXTRA_BRANCH');
  const financeAllowed = inclusion.finance || has('FINANCE_PACK');
  const advancedReportsAllowed = inclusion.advancedReports || has('REPORTS_PACK');
  const multiBranchReportsAllowed = inclusion.multiBranchReports || has('REPORTS_PACK');
  const whatsappPack = has('WHATSAPP_PACK');
  const voiceTokenQuota = (PLAN_VOICE_QUOTAS[planId] || 0) + qty('VOICE_BOOSTER') * VOICE_BOOSTER_TOKENS;
  const monthlyAddonSpend = active.reduce(
    (sum, a) => sum + (ADDON_CATALOGUE[a.type] ? ADDON_CATALOGUE[a.type].priceMonthly : 0) * a.quantity,
    0
  );

  return {
    businessId,
    planId,
    planName: PLAN_DISPLAY_NAMES[planId] || planId,
    hasSubscription,
    isTrial,
    maxBranches,
    maxStaffSeats: staffAllowed ? maxStaffSeats : 0,
    staffAllowed,
    financeAllowed,
    advancedReportsAllowed,
    multiBranchReportsAllowed,
    whatsappPack,
    voiceTokenQuota,
    monthlyAddonSpend,
    addons: active,
  };
}

/**
 * Staff seats in use: local users of the company, excluding the company
 * creator and OWNER/ADMIN roles (the web counts memberships to the same
 * effect). Newly created desktop staff carry isActive = 0 until activated,
 * so activation state is NOT a filter here.
 */
function countStaffSeats(query, businessId) {
  const company = query('SELECT createdBy FROM companies WHERE id = ?', [businessId])[0];
  const createdBy = company ? company.createdBy : null;
  const rows = query(
    "SELECT COUNT(*) as c FROM users WHERE companyId = ? AND UPPER(COALESCE(role,'')) NOT IN ('OWNER','ADMIN')",
    [businessId]
  );
  let seats = rows && rows[0] ? Number(rows[0].c) || 0 : 0;
  if (createdBy) {
    const creatorCounted = query(
      "SELECT COUNT(*) as c FROM users WHERE companyId = ? AND id = ? AND UPPER(COALESCE(role,'')) NOT IN ('OWNER','ADMIN')",
      [businessId, createdBy]
    );
    if (creatorCounted && creatorCounted[0] && Number(creatorCounted[0].c) > 0) seats -= 1;
  }
  return Math.max(0, seats);
}

function countBranches(query, businessId) {
  const rows = query('SELECT COUNT(*) as c FROM branches WHERE companyId = ? AND isActive = 1', [businessId]);
  return rows && rows[0] ? Number(rows[0].c) || 0 : 0;
}

/** Can this business buy (or renew / re-quantity) this add-on right now? Port of the web check. */
function checkAddonPurchasable(limits, type) {
  if (limits.isTrial) {
    return {
      ok: false,
      statusCode: 403,
      code: 'ADDON_TRIAL_NOT_ALLOWED',
      message: 'Add-ons are available on paid plans. Finish your 15-day free trial or upgrade to a paid plan first.',
    };
  }
  const already = (message) => ({ ok: false, statusCode: 409, code: 'ADDON_ALREADY_INCLUDED', message });
  const inclusion = PLAN_INCLUSIONS[limits.planId] || PLAN_INCLUSIONS['single-trial'];
  switch (type) {
    case 'HR_PACK':
      if (inclusion.staff) return already('Your plan already includes the full staff/HR system.');
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
      if (inclusion.advancedReports && inclusion.multiBranchReports) {
        return already('Your plan already includes all advanced reports.');
      }
      return { ok: true };
    case 'FINANCE_PACK':
      if (inclusion.finance) return already('Your plan already includes the finance toolkit.');
      return { ok: true };
    case 'VOICE_BOOSTER':
      return { ok: true };
    case 'WHATSAPP_PACK':
      return { ok: true };
    default:
      return { ok: false, statusCode: 400, code: 'ADDON_UNKNOWN_TYPE', message: 'Unknown add-on.' };
  }
}

/**
 * Add-ons are bought in whole months UP TO the plan's current paid-through
 * horizon (port of the web computation; embedded passes planPeriodEnd = null).
 */
function computeAddonPeriod(now, months, planPeriodEnd) {
  const wanted = new Date(now.getTime() + months * ADDON_MONTH_DAYS * 24 * 60 * 60 * 1000);
  if (!planPeriodEnd || planPeriodEnd.getTime() >= wanted.getTime()) {
    return { periodEnd: wanted, chargedMonths: months };
  }
  if (planPeriodEnd.getTime() <= now.getTime()) {
    return { periodEnd: wanted, chargedMonths: months };
  }
  const fitMonths = Math.max(
    1,
    Math.floor((planPeriodEnd.getTime() - now.getTime()) / (ADDON_MONTH_DAYS * 24 * 60 * 60 * 1000))
  );
  return { periodEnd: planPeriodEnd, chargedMonths: Math.min(months, fitMonths) };
}

function normalizeMonths(value) {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const m = Math.floor(n);
  return m >= 1 && m <= 36 ? m : null;
}

function serializeAddon(row) {
  const entry = ADDON_CATALOGUE[row.type];
  return {
    id: row.id,
    businessId: row.businessId,
    type: row.type,
    name: entry ? entry.name : row.type,
    quantity: row.quantity,
    status: row.status,
    priceMonthly: entry ? entry.priceMonthly : null,
    startedAt: row.startedAt,
    periodEnd: row.periodEnd,
    cancelledAt: row.cancelledAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

module.exports = {
  ADDON_TYPES,
  ADDON_CATALOGUE,
  HR_PACK_INCLUDED_SEATS,
  VOICE_BOOSTER_TOKENS,
  ADDON_MONTH_DAYS,
  PLAN_DISPLAY_NAMES,
  PLAN_INCLUSIONS,
  PLAN_VOICE_QUOTAS,
  isAddonType,
  isAddonRowEffective,
  getEffectiveLimits,
  countStaffSeats,
  countBranches,
  checkAddonPurchasable,
  computeAddonPeriod,
  normalizeMonths,
  serializeAddon,
};
