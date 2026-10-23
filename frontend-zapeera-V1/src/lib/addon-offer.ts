/**
 * Add-on offers for plan-limit moments.
 *
 * When the backend refuses an action with one of the add-on gate codes
 * (PLAN_STAFF_NOT_INCLUDED, SEAT_LIMIT_REACHED, BRANCH_LIMIT_REACHED…),
 * the UI should offer the matching add-on instead of a dead-end error.
 * The backend body already carries `addon`, `addonName` and
 * `addonPriceMonthly`; this helper turns the code into a consistent,
 * actionable toast that points at Billing → Add-ons.
 */
export interface AddonOffer {
  code: string;
  title: string;
  addonName: string;
  priceMonthly: number;
  hint: string;
}

const OFFERS: Record<string, Omit<AddonOffer, "code">> = {
  PLAN_STAFF_NOT_INCLUDED: {
    title: "Staff accounts aren't in this plan",
    addonName: "HR Pack",
    priceMonthly: 1500,
    hint: "Add the HR Pack (Rs 1,500/mo, includes 5 staff seats) in Billing → Add-ons, or upgrade to Growth.",
  },
  SEAT_LIMIT_REACHED: {
    title: "All staff seats are in use",
    addonName: "Extra Staff Seat",
    priceMonthly: 500,
    hint: "Add an Extra Staff Seat (Rs 500/mo per seat) in Billing → Add-ons, or upgrade your plan.",
  },
  STAFF_LIMIT_REACHED: {
    title: "All staff seats are in use",
    addonName: "Extra Staff Seat",
    priceMonthly: 500,
    hint: "Add an Extra Staff Seat (Rs 500/mo per seat) in Billing → Add-ons, or upgrade your plan.",
  },
  BRANCH_LIMIT_REACHED: {
    title: "Branch limit reached",
    addonName: "Extra Branch",
    priceMonthly: 1500,
    hint: "Add an Extra Branch (Rs 1,500/mo per branch) in Billing → Add-ons, or upgrade your plan.",
  },
  BRANCH_LIMIT_REACHED_V2: {
    title: "Branch limit reached",
    addonName: "Extra Branch",
    priceMonthly: 1500,
    hint: "Add an Extra Branch (Rs 1,500/mo per branch) in Billing → Add-ons, or upgrade your plan.",
  },
  PLAN_FINANCE_NOT_INCLUDED: {
    title: "Finance toolkit isn't in this plan",
    addonName: "Finance Pack",
    priceMonthly: 1000,
    hint: "Add the Finance Pack (Rs 1,000/mo) in Billing → Add-ons, or upgrade to Growth.",
  },
  PLAN_REPORTS_NOT_INCLUDED: {
    title: "Advanced reports aren't in this plan",
    addonName: "Advanced Reports Pack",
    priceMonthly: 800,
    hint: "Add the Advanced Reports Pack (Rs 800/mo) in Billing → Add-ons, or upgrade to Growth.",
  },
};

export function addonOfferForCode(code?: string | null): AddonOffer | null {
  if (!code) return null;
  const offer = OFFERS[code];
  return offer ? { code, ...offer } : null;
}

/**
 * Given an ApiResponse or a caught error, return toast content for the
 * add-on offer when the failure carries a gate code — otherwise null so
 * the caller falls back to its normal error handling.
 */
export function addonOfferToast(source: unknown): { title: string; description: string } | null {
  const anySource = source as any;
  const code: string | undefined =
    anySource?.code || anySource?.error || anySource?.response?.data?.code || anySource?.response?.data?.error;
  const offer = addonOfferForCode(code);
  if (!offer) return null;
  const backendMessage: string | undefined = anySource?.message || anySource?.response?.data?.message;
  return {
    title: offer.title,
    description: `${backendMessage ? `${backendMessage} ` : ""}${offer.hint}`,
  };
}
