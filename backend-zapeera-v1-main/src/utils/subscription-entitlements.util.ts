import { PrismaClient, Plan as PrismaPlan } from '@prisma/client';
import {
  PLANS,
  ROLES,
  BUSINESS_TYPES,
  ALL_BUSINESS_TYPES as ALL_BUSINESS_TYPES_CONSTANT,
  DASHBOARD_ACCESS_ROLES,
  PLAN_DISPLAY_NAMES,
  PlanId,
  RoleName,
  BusinessType,
  AllowedDashboardAccessRole,
} from '../config/constants';

// Re-export types for backward compatibility
export type SupportedBusinessType = BusinessType;
export { AllowedDashboardAccessRole };
export type PricingSegment = 'single' | 'multi';
export type SubscriptionAddOnCode =
  | 'extra_branch'
  | 'extra_user'
  | 'feature_pos'
  | 'feature_analytics'
  | 'feature_ai_tools'
  | 'type_pharmacy'
  | 'type_store'
  | 'type_hotel'
  | 'type_clinic';
export type SubscriptionAddOnQuantities = Partial<Record<SubscriptionAddOnCode, number>>;

export interface PricingPlanLimits {
  maxBranches: number | null;
  maxCountersPerBranch: number | null;
  maxConcurrentUsers: number | null;
  maxConcurrentSessions: number | null;
}

export interface PricingPlanPricingModel {
  includedBranchesPerBusiness: number | null;
  includedCountersPerBranch: number | null;
  extraBranchPrice: number | null;
  extraCounterPrice: number | null;
}

export interface PricingPlanDefinition {
  id: string;
  segment: PricingSegment;
  name: string;
  subtitle?: string;
  price: number;
  priceUnit: string;
  badge?: string;
  ctaLabel: string;
  features: string[];
  businessTypes: SupportedBusinessType[];
  limits: PricingPlanLimits;
  pricingModel?: PricingPlanPricingModel;
  /**
   * Roles allowed business dashboard access on this plan (in addition to enforcement in middleware).
   * Typically includes OWNER for shared/staff access; company.createdBy always has owner access.
   */
  dashboardAccessRoles: AllowedDashboardAccessRole[];
  /** Standard module keys enabled by this plan (e.g., 'sales', 'inventory', 'reports') */
  modules: string[];
}

export interface AccountEntitlementSummary {
  userId: string;
  planId: string;
  plan: PricingPlanDefinition;
  isSubscribed: boolean;
  addOns: SubscriptionAddOnQuantities;
  includedLimits: PricingPlanLimits;
  effectiveBusinessTypes: SupportedBusinessType[];
  usage: {
    activeBusinesses: number;
  };
  limits: PricingPlanLimits;
  effectiveLimits: PricingPlanLimits;
  remaining: {
  };
}

export interface BusinessEntitlementSummary {
  companyId: string;
  businessType: SupportedBusinessType;
  planId: string;
  plan: PricingPlanDefinition;
  isSubscribed: boolean;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
  addOns: SubscriptionAddOnQuantities;
  includedLimits: PricingPlanLimits;
  effectiveBusinessTypes: SupportedBusinessType[];
  usage: {
    activeBranches: number;
    activeUsers: number;
    totalUsers: number;
  };
  limits: PricingPlanLimits;
  effectiveLimits: PricingPlanLimits;
  remaining: {
    branches: number | null;
    users: number | null;
  };
  /** Map of module names to enabled status */
  modules: Record<string, boolean>;
}

const GLOBAL_PRICING_SETTINGS_OWNER = 'global_pricing';
const GLOBAL_PRICING_SETTINGS_KEY = 'plans';
const ACCOUNT_ASSIGNMENT_KEY = 'plan_assignment';
const BUSINESS_ASSIGNMENT_KEY = 'plan_assignment';
const ACCOUNT_ADDON_ASSIGNMENT_KEY = 'addon_assignment';
const BUSINESS_ADDON_ASSIGNMENT_KEY = 'addon_assignment';

// Using centralized constants from config/constants.ts
const ALL_BUSINESS_TYPES: SupportedBusinessType[] = ALL_BUSINESS_TYPES_CONSTANT;
const ALL_DASHBOARD_ACCESS_ROLES: AllowedDashboardAccessRole[] = DASHBOARD_ACCESS_ROLES as AllowedDashboardAccessRole[];
const ALL_ADDON_CODES: SubscriptionAddOnCode[] = [
  'extra_branch',
  'extra_user',
  'feature_pos',
  'feature_analytics',
  'feature_ai_tools',
  'type_pharmacy',
  'type_store',
  'type_hotel',
  'type_clinic',
];
const RETIRED_DEFAULT_PLAN_IDS = new Set(['multi-basic', 'multi-recommended', 'multi-unlimited']);

const REQUIRED_SINGLE_PLAN_IDS = [PLANS.TRIAL, PLANS.STARTER, PLANS.GROWTH, PLANS.SCALE] as const;
const REQUIRED_SINGLE_PLAN_ID_SET = new Set<string>(REQUIRED_SINGLE_PLAN_IDS);
const sortRequiredSinglePlans = (plans: PricingPlanDefinition[]) => {
  const order = new Map<string, number>(REQUIRED_SINGLE_PLAN_IDS.map((id, idx) => [id, idx]));
  return [...plans].sort((a, b) => {
    const ao = order.has(a.id) ? order.get(a.id)! : 999;
    const bo = order.has(b.id) ? order.get(b.id)! : 999;
    if (ao !== bo) return ao - bo;
    return a.name.localeCompare(b.name);
  });
};

const defaultPlans: PricingPlanDefinition[] = [
  {
    id: PLANS.TRIAL,
    segment: 'single',
    name: 'Trial',
    subtitle: 'Try the platform free for 15 days — per business',
    price: 0,
    priceUnit: 'per business / month',
    badge: 'Trial',
    ctaLabel: 'Continue Setup',
    features: [
      'Per Business Pricing',
      '15-day free trial per business',
      'Sales & invoicing',
      'Inventory management',
      'Basic reporting',
      '1 branch, 1 POS counter',
    ],
    businessTypes: ALL_BUSINESS_TYPES,
    limits: {
      maxBranches: 1,
      maxCountersPerBranch: 1,
      maxConcurrentUsers: 1,
      maxConcurrentSessions: 1,
    },
    dashboardAccessRoles: ['OWNER'],
    pricingModel: {
      includedBranchesPerBusiness: 1,
      includedCountersPerBranch: 1,
      extraBranchPrice: 1000,
      extraCounterPrice: 500,
    },
    modules: ['sales', 'inventory', 'reports', 'customers'],
  },
  {
    id: PLANS.STARTER,
    segment: 'single',
    name: 'Starter',
    subtitle: 'Ideal for owner-managed single-branch businesses',
    price: 2500,
    priceUnit: 'per business / month',
    ctaLabel: 'Continue Setup',
    features: [
      'Per Business Pricing',
      '1 branch, 1 POS counter',
      'Single-user mode',
      'Sales & invoicing',
      'Inventory management',
      'Basic reports',
    ],
    businessTypes: ALL_BUSINESS_TYPES,
    limits: {
      maxBranches: 1,
      maxCountersPerBranch: 1,
      maxConcurrentUsers: 1,
      maxConcurrentSessions: 1,
    },
    dashboardAccessRoles: ['OWNER'],
    pricingModel: {
      includedBranchesPerBusiness: 1,
      includedCountersPerBranch: 1,
      extraBranchPrice: 1000,
      extraCounterPrice: 500,
    },
    modules: ['sales', 'inventory', 'reports', 'customers', 'business_management'],
  },
  {
    id: PLANS.GROWTH,
    segment: 'single',
    name: 'Growth',
    price: 5000,
    priceUnit: 'per business / month',
    badge: 'Most Popular',
    ctaLabel: 'Continue Setup',
    features: [
      'Per Business Pricing',
      'Up to 3 branches, 3 POS counters per branch',
      'Staff roles (Owner, Manager, Cashier)',
      'Advanced reports',
      'Multi-branch dashboard',
      'Add-ons: Branch Rs 800, counter Rs 400',
    ],
    businessTypes: ALL_BUSINESS_TYPES,
    limits: {
      maxBranches: 3,
      maxCountersPerBranch: 3,
      maxConcurrentUsers: 3,
      maxConcurrentSessions: 3,
    },
    dashboardAccessRoles: [...ALL_DASHBOARD_ACCESS_ROLES],
    pricingModel: {
      includedBranchesPerBusiness: 3,
      includedCountersPerBranch: 3,
      extraBranchPrice: 800,
      extraCounterPrice: 400,
    },
    modules: ['sales', 'inventory', 'reports', 'customers', 'purchases', 'business_management', 'expenses'],
  },
  {
    id: PLANS.SCALE,
    segment: 'single',
    name: 'Scale',
    price: 10000,
    priceUnit: 'per business / month',
    badge: 'Recommended for Chains',
    ctaLabel: 'Continue Setup',
    features: [
      'Per Business Pricing',
      'Up to 10 branches, unlimited counters',
      'All Growth features',
      'API access',
      'Advanced analytics',
      'Priority support',
    ],
    businessTypes: ALL_BUSINESS_TYPES,
    limits: {
      maxBranches: 10,
      maxCountersPerBranch: null,
      maxConcurrentUsers: null,
      maxConcurrentSessions: null,
    },
    dashboardAccessRoles: [...ALL_DASHBOARD_ACCESS_ROLES],
    pricingModel: {
      includedBranchesPerBusiness: 10,
      includedCountersPerBranch: null,
      extraBranchPrice: null,
      extraCounterPrice: null,
    },
    modules: ['sales', 'inventory', 'reports', 'customers', 'purchases', 'business_management', 'expenses', 'subscription'],
  },
];

export const normalizeBusinessType = (value: unknown): SupportedBusinessType | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  if (!normalized) return null;

  // Backwards/variant compatibility (UI + DB may store extended type values)
  if (normalized === 'DEPARTMENTAL_STORE' || normalized === 'DEPARTMENT_STORE') return BUSINESS_TYPES.STORE;
  if (normalized === 'SUPERMARKET' || normalized === 'GROCERY_STORE') return BUSINESS_TYPES.STORE;

  // Validate the normalized value is a valid business type
  const validTypes: string[] = ALL_BUSINESS_TYPES_CONSTANT;
  if (validTypes.includes(normalized)) {
    return normalized as SupportedBusinessType;
  }

  return null;
};

const normalizeDashboardAccessRole = (value: unknown): AllowedDashboardAccessRole | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toUpperCase();
  const mapped = normalized === 'ADMIN' ? 'OWNER' : normalized;
  return ALL_DASHBOARD_ACCESS_ROLES.includes(mapped as AllowedDashboardAccessRole)
    ? (mapped as AllowedDashboardAccessRole)
    : null;
};

const defaultDashboardAccessRolesForPlanId = (planId: string): AllowedDashboardAccessRole[] => {
  if (planId === PLANS.STARTER || planId === PLANS.TRIAL) return ['OWNER'];
  return [...ALL_DASHBOARD_ACCESS_ROLES];
};

const normalizeLimit = (value: unknown, fallback: number | null): number | null => {
  if (value === null) return null;
  if (value === undefined) return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric < 0) return fallback;
  return Math.floor(numeric);
};

const normalizeMoney = (value: unknown, fallback: number | null): number | null => {
  if (value === null) return null;
  if (value === undefined) return fallback;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (numeric < 0) return fallback;
  return Math.floor(numeric);
};

const cloneLimits = (limits: PricingPlanLimits): PricingPlanLimits => ({
  maxBranches: limits.maxBranches,
  maxCountersPerBranch: limits.maxCountersPerBranch,
  maxConcurrentUsers: limits.maxConcurrentUsers,
  maxConcurrentSessions: limits.maxConcurrentSessions,
});

const addNullableLimit = (base: number | null, add: number): number | null => {
  if (base === null) return null;
  return Math.max(base + add, 0);
};

const normalizeDashboardAccessRoles = (
  value: unknown,
  fallback: AllowedDashboardAccessRole[]
): AllowedDashboardAccessRole[] => {
  if (!Array.isArray(value)) return fallback;
  const roles = value
    .map((entry) => normalizeDashboardAccessRole(entry))
    .filter((entry): entry is AllowedDashboardAccessRole => entry !== null);
  const deduped = Array.from(new Set(roles));
  return deduped.length > 0 ? deduped : fallback;
};

export const normalizeAddOnQuantities = (raw: unknown): SubscriptionAddOnQuantities => {
  if (!raw || typeof raw !== 'object') return {};
  const source = raw as Record<string, unknown>;
  const normalized: SubscriptionAddOnQuantities = {};

  for (const code of ALL_ADDON_CODES) {
    const value = source[code];
    if (value === undefined || value === null || value === '') continue;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) continue;
    const quantity = Math.floor(numeric);
    if (quantity > 0) {
      normalized[code] = quantity;
    }
  }

  return normalized;
};

export const computeEffectiveBusinessTypes = (
  planBusinessTypes: SupportedBusinessType[],
  addOns: SubscriptionAddOnQuantities
): SupportedBusinessType[] => {
  const set = new Set<SupportedBusinessType>(planBusinessTypes);
  if ((addOns.type_pharmacy || 0) > 0) set.add('PHARMACY');
  if ((addOns.type_store || 0) > 0) set.add('STORE');
  if ((addOns.type_hotel || 0) > 0) set.add('HOTEL');
  if ((addOns.type_clinic || 0) > 0) set.add('CLINIC');
  
  // If the plan supports ALL, then all types are allowed
  // For now, we allow all types if any are present in the database
  return Array.from(set);
};

export const computeEffectiveLimits = (
  baseLimits: PricingPlanLimits,
  addOns: SubscriptionAddOnQuantities
): PricingPlanLimits => {
  const effective = cloneLimits(baseLimits);
  effective.maxBranches = addNullableLimit(baseLimits.maxBranches, addOns.extra_branch || 0);
  effective.maxConcurrentUsers = addNullableLimit(baseLimits.maxConcurrentUsers, addOns.extra_user || 0);
  effective.maxConcurrentSessions = addNullableLimit(baseLimits.maxConcurrentSessions, addOns.extra_user || 0);
  return effective;
};


export const normalizePricingPlan = (raw: unknown): PricingPlanDefinition | null => {
  if (!raw || typeof raw !== 'object') return null;
  const plan = raw as Record<string, unknown>;

  const id = typeof plan.id === 'string' && plan.id.trim() ? plan.id.trim() : '';
  const segment: PricingSegment = plan.segment === 'multi' ? 'multi' : 'single';
  const name = typeof plan.name === 'string' && plan.name.trim() ? plan.name.trim() : '';
  const price = Number(plan.price);
  const priceUnit = typeof plan.priceUnit === 'string' && plan.priceUnit.trim() ? plan.priceUnit.trim() : 'per month';
  const ctaLabel = typeof plan.ctaLabel === 'string' && plan.ctaLabel.trim() ? plan.ctaLabel.trim() : 'Get Started';
  const features = Array.isArray(plan.features) ? plan.features.filter((f): f is string => typeof f === 'string').map(f => f.trim()).filter(Boolean) : [];
  const modules = Array.isArray(plan.modules) ? plan.modules.filter((m): m is string => typeof m === 'string').map(m => m.trim().toLowerCase()).filter(Boolean) : [];

  if (!id || !name || !Number.isFinite(price)) {
    return null;
  }

  const businessTypes = Array.isArray(plan.businessTypes)
    ? plan.businessTypes
        .map((type) => normalizeBusinessType(type))
        .filter((type): type is SupportedBusinessType => type !== null)
    : [];

  const normalizedBusinessTypes: SupportedBusinessType[] =
    businessTypes.length > 0
      ? Array.from(new Set(businessTypes))
      : ['PHARMACY', 'STORE'];
  const limitsRaw = plan.limits && typeof plan.limits === 'object' ? (plan.limits as Record<string, unknown>) : {};
  const pricingModelRaw =
    plan.pricingModel && typeof plan.pricingModel === 'object'
      ? (plan.pricingModel as Record<string, unknown>)
      : {};
  const normalizedLimits: PricingPlanLimits = {
    maxBranches: normalizeLimit(limitsRaw.maxBranches, segment === 'single' ? 1 : null),
    maxCountersPerBranch: normalizeLimit(limitsRaw.maxCountersPerBranch, segment === 'single' ? 1 : 3),
    maxConcurrentUsers: normalizeLimit(limitsRaw.maxConcurrentUsers, segment === 'single' ? 1 : 10),
    maxConcurrentSessions: normalizeLimit(limitsRaw.maxConcurrentSessions, segment === 'single' ? 1 : 10),
  };
  const normalizedPricingModel: PricingPlanPricingModel = {
    includedBranchesPerBusiness: normalizeLimit(
      pricingModelRaw.includedBranchesPerBusiness,
      normalizedLimits.maxBranches
    ),
    includedCountersPerBranch: normalizeLimit(
      pricingModelRaw.includedCountersPerBranch,
      normalizedLimits.maxCountersPerBranch
    ),
    extraBranchPrice: normalizeMoney(pricingModelRaw.extraBranchPrice, null),
    extraCounterPrice: normalizeMoney(pricingModelRaw.extraCounterPrice, null),
  };

  const dashboardAccessRoles = normalizeDashboardAccessRoles(
    plan.dashboardAccessRoles,
    defaultDashboardAccessRolesForPlanId(id)
  );

  return {
    id,
    segment,
    name,
    subtitle: typeof plan.subtitle === 'string' && plan.subtitle.trim() ? plan.subtitle.trim() : undefined,
    price: Math.max(0, Math.floor(price)),
    priceUnit,
    badge: typeof plan.badge === 'string' && plan.badge.trim() ? plan.badge.trim() : undefined,
    ctaLabel,
    features,
    businessTypes: normalizedBusinessTypes,
    limits: normalizedLimits,
    pricingModel: normalizedPricingModel,
    dashboardAccessRoles,
    modules: modules.length > 0 ? Array.from(new Set(modules)) : (defaultPlans.find(p => p.id === id)?.modules || ['sales', 'inventory', 'reports', 'customers', 'business_management']),
  };
};

export const normalizePricingPlans = (rawPlans: unknown): PricingPlanDefinition[] => {
  if (!Array.isArray(rawPlans)) return defaultPlans;
  const normalized = rawPlans
    .map((plan) => normalizePricingPlan(plan))
    .filter((plan): plan is PricingPlanDefinition => plan !== null)
    .filter((plan) => !RETIRED_DEFAULT_PLAN_IDS.has(plan.id));

  const singlePlans = normalized.filter((plan) => plan.segment === 'single' && REQUIRED_SINGLE_PLAN_ID_SET.has(plan.id));
  const merged = new Map<string, PricingPlanDefinition>();
  for (const plan of singlePlans) merged.set(plan.id, plan);
  for (const plan of defaultPlans) {
    if (plan.segment === 'single' && REQUIRED_SINGLE_PLAN_ID_SET.has(plan.id) && !merged.has(plan.id)) {
      merged.set(plan.id, plan);
    }
  }

  const mergedArray = Array.from(merged.values());
  return mergedArray.length > 0 ? sortRequiredSinglePlans(mergedArray) : defaultPlans;
};

const normalizePlanFeatures = (features: unknown): string[] => {
  if (Array.isArray(features)) {
    return features
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item): item is string => Boolean(item));
  }
  if (typeof features === 'string') {
    return features
      .split('\n')
      .map((item) => item.trim())
      .filter((item) => Boolean(item));
  }
  return [];
};

const pricingPlanDefinitionFromDbPlan = (plan: PrismaPlan): PricingPlanDefinition | null => {
  if (!plan) return null;
  
  const features = normalizePlanFeatures(plan.features);
  const isTrial = Boolean(plan.isTrial);
  const normalizedId = String(plan.id).trim();

  // Determine modules based on plan level
  let modules: string[] = ['sales', 'inventory', 'reports', 'customers'];
  if (normalizedId === PLANS.TRIAL) {
    modules = ['sales', 'inventory', 'reports', 'customers'];
  } else if (normalizedId === PLANS.STARTER) {
    modules = ['sales', 'inventory', 'reports', 'customers', 'business_management'];
  } else if (normalizedId === PLANS.GROWTH) {
    modules = ['sales', 'inventory', 'reports', 'customers', 'purchases', 'business_management', 'expenses'];
  } else if (normalizedId === PLANS.SCALE) {
    modules = ['sales', 'inventory', 'reports', 'customers', 'purchases', 'business_management', 'expenses', 'subscription'];
  }

  return {
    id: normalizedId,
    segment: 'single',
    name: plan.name || 'Unnamed Plan',
    subtitle: undefined,
    price: Math.max(0, Math.floor(plan.price || 0)),
    priceUnit: 'per month',
    badge: isTrial ? 'Trial' : undefined,
    ctaLabel: isTrial ? 'Continue Setup' : 'Subscribe',
    features,
    businessTypes: ALL_BUSINESS_TYPES,
    limits: {
      maxBranches: plan.maxBranches ?? null,
      maxCountersPerBranch: plan.maxCounters ?? null,
      maxConcurrentUsers: plan.maxUsers ?? null,
      maxConcurrentSessions: null,
    },
    pricingModel: {
      includedBranchesPerBusiness: plan.maxBranches ?? null,
      includedCountersPerBranch: plan.maxCounters ?? null,
      extraBranchPrice: null,
      extraCounterPrice: null,
    },
    dashboardAccessRoles: isTrial || !plan.maxUsers || plan.maxUsers <= 1 ? ['OWNER'] : ALL_DASHBOARD_ACCESS_ROLES,
    modules,
  };
};

export const loadPricingPlans = async (prisma: PrismaClient): Promise<PricingPlanDefinition[]> => {
  try {
    const dbPlans = await prisma.plan.findMany({
      where: { isActive: true },
      orderBy: { price: 'asc' },
    });

    if (dbPlans.length > 0) {
      return dbPlans.map(pricingPlanDefinitionFromDbPlan).filter((p): p is PricingPlanDefinition => p !== null);
    }
  } catch (error) {
    console.warn('[Subscription] Failed to load pricing plans from DB, falling back to settings:', error);
  }

  const setting = await prisma.settings.findUnique({
    where: {
      createdBy_key: {
        createdBy: GLOBAL_PRICING_SETTINGS_OWNER,
        key: GLOBAL_PRICING_SETTINGS_KEY,
      },
    },
  });

  if (!setting?.value) return defaultPlans;

  try {
    return normalizePricingPlans(JSON.parse(setting.value));
  } catch {
    return defaultPlans;
  }
};

const accountAssignmentOwner = (userId: string) => `subscription_account_${userId}`;
const businessAssignmentOwner = (companyId: string) => `subscription_business_${companyId}`;

const getAddOnAssignment = async (
  prisma: PrismaClient,
  ownerKey: string,
  settingsKey: string
) => {
  const assignment = await prisma.settings.findUnique({
    where: {
      createdBy_key: {
        createdBy: ownerKey,
        key: settingsKey,
      },
    },
  });

  if (!assignment?.value) {
    return null;
  }

  try {
    const parsed = JSON.parse(assignment.value) as { items?: SubscriptionAddOnQuantities };
    return normalizeAddOnQuantities(parsed?.items);
  } catch {
    return null;
  }
};

const getAccountPlanAssignment = async (prisma: PrismaClient, userId: string) => {
  const assignment = await prisma.settings.findUnique({
    where: {
      createdBy_key: {
        createdBy: accountAssignmentOwner(userId),
        key: ACCOUNT_ASSIGNMENT_KEY,
      },
    },
  });

  if (!assignment?.value) {
    return null;
  }

  try {
    const parsed = JSON.parse(assignment.value) as { planId?: string };
    return parsed?.planId ? parsed : null;
  } catch {
    return null;
  }
};

export const resolveAccountPlan = async (
  prisma: PrismaClient,
  userId: string,
  plans: PricingPlanDefinition[]
): Promise<{ plan: PricingPlanDefinition; isSubscribed: boolean }> => {
  const assignment = await getAccountPlanAssignment(prisma, userId);
  if (assignment?.planId) {
    const matched = plans.find((plan) => plan.id === assignment.planId);
    if (matched) {
      return { plan: matched, isSubscribed: true };
    }
  }

  return {
    plan: plans.find((plan) => plan.id === PLANS.STARTER) || plans[0],
    isSubscribed: false,
  };
};

export const assignAccountPlan = async (
  prisma: PrismaClient,
  userId: string,
  planId: string,
  assignedBy: string
): Promise<void> => {
  const payload = {
    planId,
    assignedBy,
    assignedAt: new Date().toISOString(),
  };

  await prisma.settings.upsert({
    where: {
      createdBy_key: {
        createdBy: accountAssignmentOwner(userId),
        key: ACCOUNT_ASSIGNMENT_KEY,
      },
    },
    update: {
      value: JSON.stringify(payload),
      updatedAt: new Date(),
    },
    create: {
      createdBy: accountAssignmentOwner(userId),
      key: ACCOUNT_ASSIGNMENT_KEY,
      value: JSON.stringify(payload),
      description: 'Account-level subscription plan assignment',
    },
  });
};

export const assignAccountAddOns = async (
  prisma: PrismaClient,
  userId: string,
  addOns: SubscriptionAddOnQuantities,
  assignedBy: string
): Promise<void> => {
  const normalizedAddOns = normalizeAddOnQuantities(addOns);
  const payload = {
    items: normalizedAddOns,
    assignedBy,
    assignedAt: new Date().toISOString(),
  };

  await prisma.settings.upsert({
    where: {
      createdBy_key: {
        createdBy: accountAssignmentOwner(userId),
        key: ACCOUNT_ADDON_ASSIGNMENT_KEY,
      },
    },
    update: {
      value: JSON.stringify(payload),
      updatedAt: new Date(),
    },
    create: {
      createdBy: accountAssignmentOwner(userId),
      key: ACCOUNT_ADDON_ASSIGNMENT_KEY,
      value: JSON.stringify(payload),
      description: 'Account-level subscription add-on assignment',
    },
  });
};

export const getAccountEntitlementsSummary = async (
  prisma: PrismaClient,
  userId: string
): Promise<AccountEntitlementSummary> => {
  const plans = await loadPricingPlans(prisma);
  const resolved = await resolveAccountPlan(prisma, userId, plans);
  const plan = resolved.plan;
  const addOns = (await getAddOnAssignment(
    prisma,
    accountAssignmentOwner(userId),
    ACCOUNT_ADDON_ASSIGNMENT_KEY
  )) || {};
  const effectiveLimits = computeEffectiveLimits(plan.limits, addOns);
  const effectiveBusinessTypes = computeEffectiveBusinessTypes(plan.businessTypes, addOns);
  const activeBusinesses = await prisma.business.count({
    where: {
      createdBy: userId,
      isActive: true,
    },
  });

  // If the user owns a business that has an active subscription (including TRIAL), treat the
  // account as subscribed for UI gating (so new Trial businesses can be managed immediately).
  let hasActiveBusinessSubscription = false;
  try {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT 1 as ok
      FROM business_subscriptions bs
      INNER JOIN businesses c ON c.id = bs."businessId"
      WHERE c."createdBy" = ${userId}
        AND (bs.status = 'ACTIVE' OR bs.status = 'TRIAL' OR bs.status = 'GRACE')
        AND (bs."trialEndsAt" IS NULL OR bs."trialEndsAt" > NOW())
        AND (bs."currentPeriodEnd" IS NULL OR bs."currentPeriodEnd" > NOW())
      LIMIT 1
    `;
    hasActiveBusinessSubscription = Array.isArray(rows) && rows.length > 0;
  } catch {
    hasActiveBusinessSubscription = false;
  }

  return {
    userId,
    planId: plan.id,
    plan,
    isSubscribed: resolved.isSubscribed || hasActiveBusinessSubscription,
    addOns,
    includedLimits: cloneLimits(plan.limits),
    effectiveBusinessTypes,
    usage: {
      activeBusinesses,
    },
    limits: effectiveLimits,
    effectiveLimits,
    remaining: {
    },
  };
};

export const validateBusinessCreationAllowance = async (
  _prisma: PrismaClient,
  _ownerUserId: string,
  _requestedBusinessType: SupportedBusinessType
): Promise<{ allowed: true } | { allowed: false; statusCode: number; message: string; details: Record<string, unknown> }> => {
  // Business creation is unlimited. Each business independently subscribes to a plan.
  return { allowed: true };
};

const normalizePlanIdentifier = (planId: string): string => {
  const value = String(planId || '').trim().toLowerCase();
  if (!value) return value;
  if (value.startsWith('single-') || value.startsWith('multi-')) {
    return value;
  }
  return value.replace(/\s+/g, '-');
};

const getPlanIdentifierCandidates = (planId: string): Set<string> => {
  const normalized = normalizePlanIdentifier(planId);
  const candidates = new Set<string>([normalized]);
  if (normalized.startsWith('single-') || normalized.startsWith('multi-')) {
    candidates.add(normalized.replace(/^(single|multi)-/, ''));
  }
  if (Object.values(PLANS).includes(normalized as PlanId)) {
    const displayName = PLAN_DISPLAY_NAMES[normalized as PlanId];
    if (displayName) {
      candidates.add(displayName.trim().toLowerCase());
      candidates.add(displayName.trim().toLowerCase().replace(/\s+/g, '-'));
    }
  }
  return candidates;
};

const findPricingPlanByIdentifier = (
  plans: PricingPlanDefinition[],
  planIdOrName: string
): PricingPlanDefinition | null => {
  const candidates = getPlanIdentifierCandidates(planIdOrName);
  for (const plan of plans) {
    const planId = String(plan.id || '').trim().toLowerCase();
    const planName = String(plan.name || '').trim().toLowerCase();
    const planNameHyphen = planName.replace(/\s+/g, '-');
    if (
      candidates.has(planId) ||
      candidates.has(planName) ||
      candidates.has(planNameHyphen)
    ) {
      return plan;
    }
  }
  return null;
};

const getPlanModulesFromPermissions = async (
  prisma: PrismaClient,
  planId: string
): Promise<string[]> => {
  try {
    const allModules = await prisma.module.findMany({ select: { id: true, name: true } });
    const moduleNameByLowerName = new Map<string, string>();
    const moduleNameById = new Map<string, string>();
    for (const mod of allModules) {
      const normalizedName = String(mod.name).trim().toLowerCase();
      moduleNameByLowerName.set(normalizedName, normalizedName);
      if (mod.id) {
        moduleNameById.set(String(mod.id).toLowerCase(), normalizedName);
      }
    }

    const rows = await prisma.$queryRaw<any[]>`
      SELECT moduleName
      FROM plan_module_permissions
      WHERE planId = ${planId}
        AND enabled = 1
    `;
    if (!Array.isArray(rows)) return [];

    return rows
      .map((row) => String(row?.moduleName || '').trim())
      .map((rawModuleName) => {
        const lower = rawModuleName.toLowerCase();
        return moduleNameByLowerName.get(lower) || moduleNameById.get(lower) || lower;
      })
      .filter((moduleName): moduleName is string => Boolean(moduleName));
  } catch {
    return [];
  }
};

const getBusinessSubscriptionStatusRecord = async (
  prisma: PrismaClient,
  companyId: string
): Promise<{ status?: string | null; trialEndsAt?: Date | null; currentPeriodEnd?: Date | null } | null> => {
  try {
    const row = await prisma.businessSubscription.findUnique({
      where: { businessId: companyId },
      select: {
        status: true,
        trialEndsAt: true,
        currentPeriodEnd: true,
      },
    });
    if (!row) return null;
    return {
      status: row.status ?? null,
      trialEndsAt: row.trialEndsAt ? new Date(row.trialEndsAt) : null,
      currentPeriodEnd: row.currentPeriodEnd ? new Date(row.currentPeriodEnd) : null,
    };
  } catch {
    return null;
  }
};

export const resolveBusinessPlan = async (
  prisma: PrismaClient,
  companyId: string,
  plans: PricingPlanDefinition[]
): Promise<PricingPlanDefinition | null> => {
  // 1. First check business_subscriptions table (the canonical source)
  try {
    const businessSub = await prisma.$queryRaw<any[]>`
      SELECT "planId"
      FROM business_subscriptions
      WHERE "businessId" = ${companyId}
      LIMIT 1
    `;
    if (businessSub && businessSub.length > 0 && businessSub[0]?.planId) {
      const planId = String(businessSub[0].planId).trim();
      const normalizedPlanId = String(planId).trim();
      const found = findPricingPlanByIdentifier(plans, normalizedPlanId);
      console.log(`[EntitlementDebug] resolveBusinessPlan - business_subscriptions found for ${companyId}: planId=${planId}, normalized=${normalizedPlanId}, matched=${Boolean(found)}`);
      if (found) return found;
    }
  } catch {
    // ignore missing table or other subscription schema issues
  }

  // 2. Then check settings table (for manual assignments)
  const assignment = await prisma.settings.findUnique({
    where: {
      createdBy_key: {
        createdBy: businessAssignmentOwner(companyId),
        key: BUSINESS_ASSIGNMENT_KEY,
      },
    },
  });

  if (assignment?.value) {
    try {
      const parsed = JSON.parse(assignment.value) as { planId?: string };
      if (parsed?.planId) {
        const normalizedPlanId = String(parsed.planId).trim();
        const found = findPricingPlanByIdentifier(plans, normalizedPlanId);
        console.log(`[EntitlementDebug] resolveBusinessPlan - settings assignment found for ${companyId}: planId=${normalizedPlanId}, matched=${Boolean(found)}`);
        if (found) return found;
      }
    } catch {
      // ignore malformed plan assignment
    }
  }

  return null;
};

export const assignBusinessPlan = async (
  prisma: PrismaClient,
  companyId: string,
  planId: string,
  assignedBy: string
): Promise<void> => {
  const normalizedPlanId = String(planId).trim();
  const payload = {
    planId: normalizedPlanId,
    assignedBy,
    assignedAt: new Date().toISOString(),
  };

  await prisma.settings.upsert({
    where: {
      createdBy_key: {
        createdBy: businessAssignmentOwner(companyId),
        key: BUSINESS_ASSIGNMENT_KEY,
      },
    },
    create: {
      createdBy: businessAssignmentOwner(companyId),
      key: BUSINESS_ASSIGNMENT_KEY,
      value: JSON.stringify(payload),
      description: 'Business-level subscription plan assignment',
    },
    update: {
      value: JSON.stringify(payload),
      description: 'Business-level subscription plan assignment',
    },
  });

  // Keep business_subscriptions in sync (business-level subscriptions only)
  try {
    const now = new Date();
    const isTrial = normalizedPlanId === PLANS.TRIAL || normalizedPlanId.toLowerCase().includes('trial');
    const currentPeriodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const trialEndsAt = isTrial ? currentPeriodEnd : null;

    await prisma.businessSubscription.upsert({
      where: { businessId: companyId },
      update: {
        planId: normalizedPlanId,
        status: isTrial ? 'TRIAL' : 'ACTIVE',
        trialEndsAt: trialEndsAt || undefined,
        currentPeriodEnd,
        updatedAt: now,
      },
      create: {
        businessId: companyId,
        planId: normalizedPlanId,
        status: isTrial ? 'TRIAL' : 'ACTIVE',
        trialEndsAt: trialEndsAt || undefined,
        currentPeriodEnd,
      },
    });
  } catch {
    // ignore if table missing in older schemas
  }

  // Sync business modules with the new subscription plan
  try {
    const company = await prisma.business.findUnique({
      where: { id: companyId },
      select: { id: true, createdBy: true, businessType: true }
    });

    if (company) {
      const ownerUserId = company.createdBy || assignedBy;
      const businessType = normalizeBusinessType(company.businessType) || 'PHARMACY';
      await syncBusinessModulesWithSubscription(prisma, {
        companyId: company.id,
        ownerUserId,
        businessType,
      });
    } else {
      console.warn(`[Subscription] Business ${companyId} not found while syncing modules after plan assignment.`);
    }
  } catch (error) {
    console.warn('[Subscription] Failed to sync modules after plan assignment:', error);
  }
};

export const assignBusinessAddOns = async (
  prisma: PrismaClient,
  companyId: string,
  addOns: SubscriptionAddOnQuantities,
  assignedBy: string
): Promise<void> => {
  const normalizedAddOns = normalizeAddOnQuantities(addOns);
  const payload = {
    items: normalizedAddOns,
    assignedBy,
    assignedAt: new Date().toISOString(),
  };

  await prisma.settings.upsert({
    where: {
      createdBy_key: {
        createdBy: businessAssignmentOwner(companyId),
        key: BUSINESS_ADDON_ASSIGNMENT_KEY,
      },
    },
    update: {
      value: JSON.stringify(payload),
      updatedAt: new Date(),
    },
    create: {
      createdBy: businessAssignmentOwner(companyId),
      key: BUSINESS_ADDON_ASSIGNMENT_KEY,
      value: JSON.stringify(payload),
      description: 'Business-level subscription add-on assignment',
    },
  });
};

export const ensureBusinessPlanAssigned = async (
  prisma: PrismaClient,
  params: {
    companyId: string;
    ownerUserId: string;
    businessType: SupportedBusinessType;
  }
): Promise<PricingPlanDefinition> => {
  const plans = await loadPricingPlans(prisma);
  const existingBusinessPlan = await resolveBusinessPlan(prisma, params.companyId, plans);
  if (existingBusinessPlan) return existingBusinessPlan;

  const fallbackPlan =
    plans.find((plan) => plan.businessTypes.includes(params.businessType)) ||
    plans[0];

  await assignBusinessPlan(prisma, params.companyId, fallbackPlan.id, 'system');
  return fallbackPlan;
};

export const getBusinessEntitlementsSummary = async (
  prisma: PrismaClient,
  params: {
    companyId: string;
    ownerUserId: string;
    businessType: SupportedBusinessType;
  }
): Promise<BusinessEntitlementSummary | null> => {
  const plans = await loadPricingPlans(prisma);
  let assignedPlan = await resolveBusinessPlan(prisma, params.companyId, plans);
  console.log(`[EntitlementDebug] getBusinessEntitlementsSummary - initial assignedPlan for ${params.companyId}: ${assignedPlan?.id || 'null'}`);
  if (!assignedPlan) {
    assignedPlan = await ensureBusinessPlanAssigned(prisma, {
      companyId: params.companyId,
      ownerUserId: params.ownerUserId,
      businessType: params.businessType,
    });
    console.log(`[EntitlementDebug] getBusinessEntitlementsSummary - ensureBusinessPlanAssigned result for ${params.companyId}: ${assignedPlan?.id}`);
  }

  if (!assignedPlan) return null;
  const assignedPlanModules = await getPlanModulesFromPermissions(prisma, assignedPlan.id);
  const planModules = assignedPlanModules.length > 0 ? assignedPlanModules : (assignedPlan.modules || []);
  const addOns = (await getAddOnAssignment(
    prisma,
    businessAssignmentOwner(params.companyId),
    BUSINESS_ADDON_ASSIGNMENT_KEY
  )) || {};
  const effectiveLimits = computeEffectiveLimits(assignedPlan.limits, addOns);
  const effectiveBusinessTypes = computeEffectiveBusinessTypes(assignedPlan.businessTypes, addOns);
  const [activeBranches, ownerUser] = await Promise.all([
    prisma.branch.count({
      where: {
        companyId: params.companyId,
        isActive: true,
      },
    }),
    prisma.zapeeraUser.findUnique({
      where: { id: params.ownerUserId },
      select: { id: true, isActive: true },
    }),
  ]);

  // Use Sets to collect unique user IDs from multiple sources
  const activeUserIds = new Set<string>();
  const totalUserIds = new Set<string>();

  const safeMapIds = (rows: any[]) =>
    (Array.isArray(rows) ? rows : [])
      .map((row) => row?.id || row?.userId)
      .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
      .map((value) => value.trim());

  let activeMembershipUserIds: string[] = [];
  let allMembershipUserIds: string[] = [];

  try {
    activeMembershipUserIds = safeMapIds(
      await prisma.$queryRaw<any[]>`
        SELECT DISTINCT "userId" as id
        FROM memberships
        WHERE "businessId" = ${params.companyId}
          AND status = 'ACTIVE'
      `
    );
  } catch {
    activeMembershipUserIds = [];
  }

  try {
    allMembershipUserIds = safeMapIds(
      await prisma.$queryRaw<any[]>`
        SELECT DISTINCT "userId" as id
        FROM memberships
        WHERE "businessId" = ${params.companyId}
      `
    );
  } catch {
    allMembershipUserIds = [];
  }

  for (const userId of activeMembershipUserIds) {
    activeUserIds.add(userId);
    totalUserIds.add(userId);
  }
  for (const userId of allMembershipUserIds) {
    totalUserIds.add(userId);
  }

  if (ownerUser?.isActive) {
    activeUserIds.add(ownerUser.id);
  }
  if (ownerUser?.id) {
    totalUserIds.add(ownerUser.id);
  }

  const activeUsers = activeUserIds.size;
  const totalUsers = totalUserIds.size;

  let subscriptionStatus: string | null = null;
  let trialEndsAt: Date | null = null;
  let currentPeriodEnd: Date | null = null;
  try {
    const subscriptionRecord = await getBusinessSubscriptionStatusRecord(prisma, params.companyId);
    subscriptionStatus = subscriptionRecord?.status ?? null;
    trialEndsAt = subscriptionRecord?.trialEndsAt ?? null;
    currentPeriodEnd = subscriptionRecord?.currentPeriodEnd ?? null;
  } catch {
    subscriptionStatus = null;
    trialEndsAt = null;
    currentPeriodEnd = null;
  }

  const now = new Date();
  const normalizedStatus = subscriptionStatus ? subscriptionStatus.toString().trim().toUpperCase() : null;
  const isTrialValid = !trialEndsAt || trialEndsAt.getTime() > now.getTime();
  const isPeriodValid = !currentPeriodEnd || currentPeriodEnd.getTime() > now.getTime();

  const hasExpired = Boolean(
    normalizedStatus &&
    ['ACTIVE', 'TRIAL'].includes(normalizedStatus) &&
    !isPeriodValid
  );

  if (hasExpired) {
    subscriptionStatus = 'EXPIRED';
  }

  const isActiveStatus = subscriptionStatus === 'ACTIVE' || subscriptionStatus === 'TRIAL' || subscriptionStatus === 'GRACE';
  const isSubscribed = Boolean(isActiveStatus && (isTrialValid || subscriptionStatus === 'GRACE') && isPeriodValid);
  console.log(`[EntitlementDebug] getBusinessEntitlementsSummary - ${params.companyId} -> plan=${assignedPlan.id}, isSubscribed=${isSubscribed}, subscriptionStatus=${subscriptionStatus}, trialEndsAt=${trialEndsAt}, currentPeriodEnd=${currentPeriodEnd}`);

  return {
    companyId: params.companyId,
    businessType: params.businessType,
    planId: assignedPlan.id,
    plan: assignedPlan,
    isSubscribed,
    subscriptionStatus,
    trialEndsAt: trialEndsAt ? trialEndsAt.toISOString() : null,
    currentPeriodEnd: currentPeriodEnd ? currentPeriodEnd.toISOString() : null,
    addOns,
    includedLimits: cloneLimits(assignedPlan.limits),
    effectiveBusinessTypes,
    usage: {
      activeBranches,
      activeUsers,
      totalUsers,
    },
    limits: effectiveLimits,
    effectiveLimits,
    remaining: {
      branches: effectiveLimits.maxBranches === null ? null : Math.max(effectiveLimits.maxBranches - activeBranches, 0),
      users: effectiveLimits.maxConcurrentUsers === null ? null : Math.max(effectiveLimits.maxConcurrentUsers - activeUsers, 0),
    },
    modules: planModules.reduce((acc, mod) => {
      acc[mod.toLowerCase()] = true;
      return acc;
    }, {} as Record<string, boolean>),
  };
};

export const validateStaffCreationAllowance = async (
  prisma: PrismaClient,
  params: {
    companyId: string;
    ownerUserId: string;
    businessType: SupportedBusinessType;
  }
): Promise<{ allowed: true } | { allowed: false; statusCode: number; message: string; details: Record<string, unknown> }> => {
  const entitlement = await getBusinessEntitlementsSummary(prisma, params);
  if (!entitlement || !entitlement.isSubscribed) {
    return {
      allowed: false,
      statusCode: 403,
      message: 'An active business subscription is required to add staff members.',
      details: {
        code: 'BUSINESS_SUBSCRIPTION_REQUIRED',
        companyId: params.companyId,
      },
    };
  }

  const maxUsers = entitlement.effectiveLimits.maxConcurrentUsers;
  if (maxUsers !== null && entitlement.usage.totalUsers >= maxUsers) {
    return {
      allowed: false,
      statusCode: 403,
      message: `Staff limit reached (${maxUsers}) for this business on plan ${entitlement.plan.name}. Please upgrade or add more user capacity.`,
      details: {
        code: 'STAFF_LIMIT_REACHED',
        companyId: params.companyId,
        maxUsers,
        totalUsers: entitlement.usage.totalUsers,
        planId: entitlement.planId,
        planName: entitlement.plan.name,
      },
    };
  }

  return { allowed: true };
};

export const validateBranchCreationAllowance = async (
  prisma: PrismaClient,
  params: {
    companyId: string;
    ownerUserId: string;
    businessType: SupportedBusinessType;
  }
): Promise<{ allowed: true } | { allowed: false; statusCode: number; message: string; details: Record<string, unknown> }> => {
  const entitlement = await getBusinessEntitlementsSummary(prisma, params);
  if (!entitlement || !entitlement.isSubscribed) {
    return {
      allowed: false,
      statusCode: 403,
      message: 'An active business subscription is required before creating branches.',
      details: {
        code: 'BUSINESS_SUBSCRIPTION_REQUIRED',
        companyId: params.companyId,
      },
    };
  }

  const maxBranches = entitlement.effectiveLimits.maxBranches;
  if (maxBranches !== null && entitlement.usage.activeBranches >= maxBranches) {
    return {
      allowed: false,
      statusCode: 403,
      message: `Branch limit reached for this business on plan ${entitlement.plan.name}. Please upgrade or add more branch capacity.`,
      details: {
        code: 'BRANCH_LIMIT_REACHED',
        companyId: params.companyId,
        maxBranches,
        activeBranches: entitlement.usage.activeBranches,
        planId: entitlement.planId,
        planName: entitlement.plan.name,
      },
    };
  }

  return { allowed: true };
};

export const validateUserActivationAllowance = async (
  prisma: PrismaClient,
  params: {
    companyId: string;
    ownerUserId: string;
    businessType: SupportedBusinessType;
    userIdToActivate?: string;
  }
): Promise<{ allowed: true } | { allowed: false; statusCode: number; message: string; details: Record<string, unknown> }> => {
  const entitlement = await getBusinessEntitlementsSummary(prisma, params);
  if (!entitlement || !entitlement.isSubscribed) {
    return {
      allowed: false,
      statusCode: 403,
      message: 'An active business subscription is required to activate staff access.',
      details: {
        code: 'BUSINESS_SUBSCRIPTION_REQUIRED',
        companyId: params.companyId,
      },
    };
  }

  const maxUsers = entitlement.effectiveLimits.maxConcurrentUsers;
  if (maxUsers !== null && entitlement.usage.activeUsers >= maxUsers) {
    return {
      allowed: false,
      statusCode: 403,
      message: `Active user limit reached (${maxUsers}) for this business. Purchase extra user capacity or upgrade your plan.`,
      details: {
        code: 'USER_LIMIT_REACHED',
        companyId: params.companyId,
        maxUsers,
        activeUsers: entitlement.usage.activeUsers,
        planId: entitlement.planId,
        planName: entitlement.plan.name,
        userIdToActivate: params.userIdToActivate,
      },
    };
  }

  return { allowed: true };
};

export const syncBusinessModulesWithSubscription = async (
  prisma: PrismaClient,
  params: {
    companyId: string;
    ownerUserId: string;
    businessType: SupportedBusinessType;
  }
): Promise<void> => {
  const entitlement = await getBusinessEntitlementsSummary(prisma, params);
  if (!entitlement) return;

  try {
    // Get all available modules in the system
    const allModules = await prisma.module.findMany({
      select: { id: true, name: true }
    });

    // Get current business modules
    const currentBusinessModules = await prisma.businessModule.findMany({
      where: { businessId: params.companyId },
      select: { moduleId: true, enabled: true }
    });

    // Create a map of current module states
    const currentModuleMap = new Map(
      currentBusinessModules.map(bm => [bm.moduleId, bm.enabled])
    );

    const planModuleNames = await getPlanModulesFromPermissions(prisma, entitlement.planId);
    const enabledPlanModules = planModuleNames.length > 0
      ? new Set(planModuleNames)
      : new Set(Object.keys(entitlement.modules).filter((k) => entitlement.modules[k]));

    // Sync modules based on active subscription plan
    for (const module of allModules) {
      const moduleKey = String(module.name).toLowerCase();
      const isSubscriptionModule = moduleKey === 'subscription';
      const shouldBeEnabled = isSubscriptionModule || (entitlement.isSubscribed && enabledPlanModules.has(moduleKey));
      const currentlyEnabled = currentModuleMap.get(module.id) || false;

      if (shouldBeEnabled !== currentlyEnabled) {
        await prisma.businessModule.upsert({
          where: {
            unique_business_module: {
              businessId: params.companyId,
              moduleId: module.id
            }
          },
          update: {
            enabled: shouldBeEnabled,
            updatedAt: new Date()
          },
          create: {
            businessId: params.companyId,
            moduleId: module.id,
            enabled: shouldBeEnabled
          }
        });
      }
    }

    console.log(`[Subscription] Synced modules for business ${params.companyId} with plan ${entitlement.planId}`);
  } catch (error) {
    console.error('[Subscription] Failed to sync business modules:', error);
  }
};
