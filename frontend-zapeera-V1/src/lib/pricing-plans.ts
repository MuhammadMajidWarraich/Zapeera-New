export type DashboardAccessRole = "OWNER" | "USER" | "MANAGER" | "CASHIER";

export interface PricingPlanPricingModel {
  includedBranchesPerBusiness?: number | null;
  includedCountersPerBranch?: number | null;
  extraBranchPrice?: number | null;
  extraCounterPrice?: number | null;
}

export interface PricingPlan {
  id: string;
  name: string;
  subtitle?: string;
  price: number;
  priceUnit: string;
  badge?: string;
  ctaLabel: string;
  features: string[];
  /**
   * Non-owner roles that can access a business dashboard on this plan.
   * Business owner access is enforced separately (company.createdBy).
   */
  dashboardAccessRoles?: DashboardAccessRole[];
  businessTypes?: Array<"PHARMACY" | "STORE" | "HOTEL" | "CLINIC">;
  limits?: {
    maxBranches?: number | null;
    maxCountersPerBranch?: number | null;
    maxConcurrentUsers?: number | null;
    maxConcurrentSessions?: number | null;
  };
  pricingModel?: PricingPlanPricingModel;
}

const STORAGE_KEY = "zapeera_pricing_plans_v1";
const STORAGE_TS_KEY = "zapeera_pricing_plans_v1_ts";
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PRICING_PLANS_EVENT = "zapeera:pricing-plans-updated";

const normalizeToRequiredPlans = (plans: PricingPlan[]) => {
  const normalizedPlans = (Array.isArray(plans) ? plans : [])
    .filter((plan) => plan && typeof plan.id === "string");

  // Ensure we always include the 4 core plans
  const coreOrder = new Map<string, number>([
    ["single-trial", 0],
    ["single-starter", 1],
    ["single-growth", 2],
    ["single-scale", 3],
  ]);

  const merged = new Map<string, PricingPlan>();
  for (const plan of normalizedPlans) {
    if (!merged.has(plan.id)) {
      merged.set(plan.id, plan);
    }
  }

  // Add default plans if missing
  for (const plan of defaultPricingPlans) {
    if (!merged.has(plan.id)) {
      merged.set(plan.id, plan);
    }
  }

  const result = Array.from(merged.values()).sort((a, b) => {
    const ao = coreOrder.get(a.id) ?? 999;
    const bo = coreOrder.get(b.id) ?? 999;
    return ao - bo;
  });

  return result.length ? result : defaultPricingPlans;
};

export const defaultPricingPlans: PricingPlan[] = [
  {
    id: "single-trial",
    name: "Trial",
    subtitle: "Try the platform before you subscribe",
    price: 0,
    priceUnit: "per month",
    badge: "Trial",
    ctaLabel: "Continue Setup",
    features: [
      "Core Features",
      "Sales & invoicing",
      "Inventory management",
      "Basic reporting",
      "Included branches: 1",
    ],
    dashboardAccessRoles: ["OWNER"],
    pricingModel: {
      includedBranchesPerBusiness: 1,
      includedCountersPerBranch: 1,
      extraBranchPrice: 1000,
      extraCounterPrice: 500,
    },
  },
  {
    id: "single-starter",
    name: "Starter",
    subtitle: "Ideal for owner-managed businesses",
    price: 2500,
    priceUnit: "per month",
    ctaLabel: "Continue Setup",
    features: [
      "Core Features",
      "Included branches: 1",
      "1 POS Counter",
      "Single-user mode",
      "Sales & invoicing",
      "Inventory management",
      "Basic reports",
    ],
    dashboardAccessRoles: ["OWNER"],
    pricingModel: {
      includedBranchesPerBusiness: 1,
      includedCountersPerBranch: 1,
      extraBranchPrice: 1000,
      extraCounterPrice: 500,
    },
  },
  {
    id: "single-growth",
    name: "Growth",
    subtitle: "Best for Growing Businesses",
    price: 5000,
    priceUnit: "per month",
    badge: "Most Popular",
    ctaLabel: "Continue Setup",
    features: [
      "Core + Growth Features",
      "Includes all Core features",
      "Staff roles (Owner, Manager, Cashier)",
      "Advanced reports",
      "Multi-branch dashboard",
      "Included branches: 3",
      "Add-ons: Branch Rs 800, counter Rs 400",
    ],
    dashboardAccessRoles: ["OWNER", "USER", "MANAGER", "CASHIER"],
    pricingModel: {
      includedBranchesPerBusiness: 3,
      includedCountersPerBranch: 3,
      extraBranchPrice: 800,
      extraCounterPrice: 400,
    },
  },
  {
    id: "single-scale",
    name: "Scale",
    subtitle: "For Multi-location Brands",
    price: 10000,
    priceUnit: "per month",
    badge: "Recommended for Chains",
    ctaLabel: "Continue Setup",
    features: [
      "Core + Growth + Scale Features",
      "Includes all Core and Growth features",
      "API access",
      "Advanced analytics",
      "Priority support",
      "Included branches: 10",
    ],
    dashboardAccessRoles: ["OWNER", "USER", "MANAGER", "CASHIER"],
    pricingModel: {
      includedBranchesPerBusiness: 10,
      includedCountersPerBranch: null,
      extraBranchPrice: null,
      extraCounterPrice: null,
    },
  },
];

export const loadPricingPlans = (): PricingPlan[] => {
  if (typeof window === "undefined") return defaultPricingPlans;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPricingPlans;
    const tsRaw = window.localStorage.getItem(STORAGE_TS_KEY);
    if (tsRaw) {
      const cachedAt = Number(tsRaw);
      if (Date.now() - cachedAt > CACHE_MAX_AGE_MS) {
        window.localStorage.removeItem(STORAGE_KEY);
        window.localStorage.removeItem(STORAGE_TS_KEY);
        return defaultPricingPlans;
      }
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return defaultPricingPlans;
    const normalized = normalizeToRequiredPlans(parsed);
    return normalized.length ? normalized : defaultPricingPlans;
  } catch {
    return defaultPricingPlans;
  }
};

export const savePricingPlans = (plans: PricingPlan[]) => {
  if (typeof window === "undefined") return;
  try {
    // Deduplicate by plan ID (keep first occurrence)
    const seenIds = new Set<string>();
    const uniquePlans = (Array.isArray(plans) ? plans : []).filter((plan) => {
      if (seenIds.has(plan.id)) return false;
      seenIds.add(plan.id);
      return true;
    });
    const normalized = normalizeToRequiredPlans(uniquePlans);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    window.localStorage.setItem(STORAGE_TS_KEY, String(Date.now()));
    window.dispatchEvent(new CustomEvent(PRICING_PLANS_EVENT, { detail: normalized }));
  } catch {
    // ignore storage errors
  }
};

export const subscribeToPricingPlanChanges = (callback: (plans: PricingPlan[]) => void) => {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const syncPlans = () => {
    callback(loadPricingPlans());
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key && event.key !== STORAGE_KEY) return;
    syncPlans();
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(PRICING_PLANS_EVENT, syncPlans);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(PRICING_PLANS_EVENT, syncPlans);
  };
};
