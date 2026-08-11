/**
 * Canonical Authorization Service tests (Phase 8).
 *
 * Unit tests against an in-memory Prisma fake. Coverage:
 *  - owner / manager / cashier / custom role grants
 *  - cross-tenant (business) isolation
 *  - business type gate, plan entitlement (module + page + read-only),
 *    business override, role gate, data scope
 *  - every subscription state (incl. expired-period and past-due derivation)
 *  - billing/account whitelist for inactive subscriptions
 *  - dependency chains (transitive + cycle fail-closed)
 *  - shared cache invalidation via policyVersion bumps
 *  - the universal middleware translating decisions into HTTP responses
 */

import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  authorizeBusinessAction,
  resolveEffectiveSubscriptionState,
  isBillingWhitelisted,
  invalidateAuthPolicyCache,
} from '../src/services/authorization.service';

// ── Dataset helpers ────────────────────────────────────────────────────────

const NOW = Date.now();
const FUTURE = new Date(NOW + 30 * 24 * 3600 * 1000);
const PAST = new Date(NOW - 30 * 24 * 3600 * 1000);

interface Dataset {
  businesses: Map<string, any>;
  memberships: Map<string, any>;
  roles: Map<string, any>;
  rolePermissions: any[];
  plans: Map<string, any>;
  planEntitlements: any[];
  businessTypes: Map<string, any>;
  btModules: any[];
  btPages: any[];
  overrides: any[];
  modules: any[];
  pages: any[];
  dependencies: any[];
}

const MODULES = [
  { id: 'm-sub', key: 'subscription', isCore: true, updatedAt: new Date(NOW) },
  { id: 'm-dash', key: 'dashboard', isCore: true, updatedAt: new Date(NOW) },
  { id: 'm-inv', key: 'inventory', isCore: false, updatedAt: new Date(NOW) },
  { id: 'm-sales', key: 'sales', isCore: false, updatedAt: new Date(NOW) },
  { id: 'm-cust', key: 'customers', isCore: false, updatedAt: new Date(NOW) },
  { id: 'm-bm', key: 'business_management', isCore: false, updatedAt: new Date(NOW) },
  { id: 'm-staff', key: 'staff', isCore: false, updatedAt: new Date(NOW) },
  { id: 'm-ax', key: 'a-x', isCore: false, updatedAt: new Date(NOW) },
  { id: 'm-ay', key: 'a-y', isCore: false, updatedAt: new Date(NOW) },
  { id: 'm-top', key: 'm-top', isCore: false, updatedAt: new Date(NOW) },
];

const PAGES = [
  { id: 'p-inv-products', moduleId: 'm-inv', key: 'products', updatedAt: new Date(NOW) },
  { id: 'p-inv-categories', moduleId: 'm-inv', key: 'categories', updatedAt: new Date(NOW) },
  { id: 'p-sales-invoices', moduleId: 'm-sales', key: 'invoices', updatedAt: new Date(NOW) },
  { id: 'p-sales-refunds', moduleId: 'm-sales', key: 'refunds', updatedAt: new Date(NOW) },
  { id: 'p-cust', moduleId: 'm-cust', key: 'customers', updatedAt: new Date(NOW) },
  { id: 'p-bm-settings', moduleId: 'm-bm', key: 'settings', updatedAt: new Date(NOW) },
  { id: 'p-bm-roles', moduleId: 'm-bm', key: 'roles', updatedAt: new Date(NOW) },
  { id: 'p-bm-billing', moduleId: 'm-bm', key: 'billing', updatedAt: new Date(NOW) },
  { id: 'p-staff', moduleId: 'm-staff', key: 'staff', updatedAt: new Date(NOW) },
];

function defaultDataset(): Dataset {
  const roles = new Map<string, any>([
    ['r-owner', { id: 'r-owner', name: 'OWNER', permissionState: 'CONFIGURED', policyVersion: 1, updatedAt: new Date(NOW) }],
    ['r-mgr', { id: 'r-mgr', name: 'MANAGER', permissionState: 'CONFIGURED', policyVersion: 1, updatedAt: new Date(NOW) }],
    ['r-cashier', { id: 'r-cashier', name: 'CASHIER', permissionState: 'CONFIGURED', policyVersion: 1, updatedAt: new Date(NOW) }],
    ['r-custom', { id: 'r-custom', name: 'CUSTOM_ROLE', permissionState: 'CONFIGURED', policyVersion: 1, updatedAt: new Date(NOW) }],
    ['r-mgr-b2', { id: 'r-mgr-b2', name: 'MANAGER', permissionState: 'CONFIGURED', policyVersion: 1, updatedAt: new Date(NOW) }],
  ]);

  const plans = new Map<string, any>([
    [
      'p1',
      { id: 'p1', permissionState: 'CONFIGURED', policyVersion: 1, updatedAt: new Date(NOW) },
    ],
  ]);

  const businesses = new Map<string, any>([
    [
      'b1',
      {
        id: 'b1',
        businessType: 'RETAIL',
        policyVersion: 1,
        updatedAt: new Date(NOW),
        businessSubscription: {
          status: 'ACTIVE',
          billingStatus: 'PAID',
          currentPeriodEnd: FUTURE,
          planId: 'p1',
          updatedAt: new Date(NOW),
          plan: plans.get('p1'),
        },
      },
    ],
    [
      'b2',
      {
        id: 'b2',
        businessType: 'RETAIL',
        policyVersion: 1,
        updatedAt: new Date(NOW),
        businessSubscription: {
          status: 'ACTIVE',
          billingStatus: 'PAID',
          currentPeriodEnd: FUTURE,
          planId: 'p1',
          updatedAt: new Date(NOW),
          plan: plans.get('p1'),
        },
      },
    ],
  ]);

  const memberships = new Map<string, any>([
    ['u-owner:b1', { id: 'm-owner', userId: 'u-owner', businessId: 'b1', status: 'ACTIVE', roleId: 'r-owner', branches: [] }],
    ['u-mgr:b1', { id: 'm-mgr', userId: 'u-mgr', businessId: 'b1', status: 'ACTIVE', roleId: 'r-mgr', branches: [] }],
    ['u-cashier:b1', { id: 'm-cashier', userId: 'u-cashier', businessId: 'b1', status: 'ACTIVE', roleId: 'r-cashier', branches: [] }],
    ['u-custom:b1', { id: 'm-custom', userId: 'u-custom', businessId: 'b1', status: 'ACTIVE', roleId: 'r-custom', branches: [] }],
    ['u-mgr:b2', { id: 'm-mgr-b2', userId: 'u-mgr', businessId: 'b2', status: 'ACTIVE', roleId: 'r-mgr-b2', branches: [] }],
  ]);

  return {
    businesses,
    memberships,
    roles,
    rolePermissions: [
      { id: 'rp1', roleId: 'r-mgr', modulePageId: 'p-inv-products', operationKey: 'read', allowed: true, scope: 'BUSINESS' },
      { id: 'rp2', roleId: 'r-mgr', modulePageId: 'p-inv-products', operationKey: 'create', allowed: true, scope: 'BUSINESS' },
      { id: 'rp3', roleId: 'r-mgr', modulePageId: 'p-inv-products', operationKey: 'update', allowed: true, scope: 'BUSINESS' },
      { id: 'rp4', roleId: 'r-cashier', modulePageId: 'p-inv-products', operationKey: 'read', allowed: true, scope: 'BUSINESS' },
      { id: 'rp5', roleId: 'r-custom', modulePageId: 'p-sales-invoices', operationKey: 'read', allowed: true, scope: 'BUSINESS' },
      { id: 'rp6', roleId: 'r-custom', modulePageId: 'p-sales-invoices', operationKey: 'create', allowed: true, scope: 'BUSINESS' },
      { id: 'rp7', roleId: 'r-mgr-b2', modulePageId: 'p-inv-products', operationKey: 'read', allowed: false, scope: 'BUSINESS' },
    ],
    plans,
    planEntitlements: [
      { id: 'pe1', planId: 'p1', moduleKey: 'inventory', pageKey: null, entitlementLevel: 'FULL' },
      { id: 'pe2', planId: 'p1', moduleKey: 'sales', pageKey: 'invoices', entitlementLevel: 'FULL' },
      { id: 'pe3', planId: 'p1', moduleKey: 'customers', pageKey: null, entitlementLevel: 'FULL' },
      { id: 'pe4', planId: 'p1', moduleKey: 'business_management', pageKey: null, entitlementLevel: 'FULL' },
      { id: 'pe5', planId: 'p1', moduleKey: 'staff', pageKey: null, entitlementLevel: 'FULL' },
    ],
    businessTypes: new Map<string, any>([['bt-retail', { id: 'bt-retail', name: 'RETAIL', updatedAt: new Date(NOW) }]]),
    btModules: [
      { businessTypeId: 'bt-retail', moduleId: 'm-inv', isEnabled: true, moduleKey: 'inventory' },
      { businessTypeId: 'bt-retail', moduleId: 'm-sales', isEnabled: true, moduleKey: 'sales' },
      { businessTypeId: 'bt-retail', moduleId: 'm-cust', isEnabled: true, moduleKey: 'customers' },
      { businessTypeId: 'bt-retail', moduleId: 'm-bm', isEnabled: true, moduleKey: 'business_management' },
      { businessTypeId: 'bt-retail', moduleId: 'm-staff', isEnabled: true, moduleKey: 'staff' },
    ],
    btPages: [],
    overrides: [],
    modules: MODULES,
    pages: PAGES,
    dependencies: [],
  };
}

function fakePrisma(ds: Dataset) {
  const maxOf = (rows: any[]) =>
    rows.length > 0
      ? new Date(Math.max(...rows.map((r) => new Date(r.updatedAt || NOW).getTime())))
      : null;

  const btRows = (arg0: any) => {
    const value = String(arg0 || '');
    return [...ds.businessTypes.values()].filter(
      (r) => String(r.id) === value || String(r.name).toLowerCase() === value.toLowerCase()
    );
  };

  return {
    business: {
      findUnique: async ({ where }: any) => ds.businesses.get(where.id) || null,
    },
    membership: {
      findUnique: async ({ where }: any) => {
        const key = where.unique_user_business || {};
        const m = ds.memberships.get(`${key.userId}:${key.businessId}`);
        if (!m) return null;
        return {
          ...m,
          role: m.roleId ? ds.roles.get(m.roleId) || null : null,
          branches: m.branches || [],
        };
      },
    },
    plan: {
      findUnique: async ({ where }: any) => ds.plans.get(where.id) || null,
    },
    rolePermissionV2: {
      findMany: async ({ where }: any) => ds.rolePermissions.filter((p) => p.roleId === where.roleId),
    },
    planEntitlement: {
      findMany: async ({ where }: any) => ds.planEntitlements.filter((e) => e.planId === where.planId),
    },
    businessModuleOverride: {
      findMany: async ({ where }: any) => ds.overrides.filter((o) => o.businessId === where.businessId),
    },
    moduleDefinition: {
      findMany: async () => ds.modules,
    },
    modulePage: {
      findMany: async () => ds.pages,
    },
    moduleDependency: {
      findMany: async ({ where }: any) => {
        const rows = ds.dependencies.filter((d) => (where?.isHardDependency === true ? d.isHardDependency === true : true));
        return rows.map((d) => ({
          ...d,
          dependsOn: ds.modules.find((m) => m.id === d.dependsOnModuleId) || null,
        }));
      },
    },
    $queryRaw: async (query: TemplateStringsArray, ...args: any[]) => {
      const sql = query.join('?').toLowerCase();
      if (sql.includes('from business_types')) {
        return btRows(args[0]);
      }
      if (sql.includes('from business_type_modules')) {
        if (sql.includes('max(')) return [{ m: maxOf(ds.btModules) }];
        const btId = String(args[0] || '');
        return ds.btModules.filter((r) => r.businessTypeId === btId);
      }
      if (sql.includes('from business_type_pages')) {
        if (sql.includes('max(')) return [{ m: maxOf(ds.btPages) }];
        const btId = String(args[0] || '');
        return ds.btPages.filter((r) => r.businessTypeId === btId);
      }
      if (sql.includes('from business_module_overrides')) {
        return [{ m: maxOf(ds.overrides) }];
      }
      if (sql.includes('from module_definitions')) {
        return [{ m: maxOf(ds.modules) }];
      }
      if (sql.includes('from module_pages')) {
        return [{ m: maxOf(ds.pages) }];
      }
      return [];
    },
  } as any;
}

function auth(ds: Dataset) {
  const prisma = fakePrisma(ds);
  return (userId: string, businessId: string, resourceKey: string, action: string, options?: any) =>
    authorizeBusinessAction(prisma, userId, businessId, resourceKey, action, options);
}

describe('resolveEffectiveSubscriptionState', () => {
  it('derives EXPIRED from an ACTIVE row with an elapsed period', () => {
    expect(resolveEffectiveSubscriptionState({ status: 'ACTIVE', billingStatus: 'PAID', currentPeriodEnd: PAST })).toBe('EXPIRED');
  });

  it('derives PAST_DUE from an ACTIVE row with unpaid billing', () => {
    expect(resolveEffectiveSubscriptionState({ status: 'ACTIVE', billingStatus: 'UNPAID', currentPeriodEnd: FUTURE })).toBe('PAST_DUE');
  });

  it('keeps ACTIVE/TRIAL/GRACE and hard-blocked states', () => {
    expect(resolveEffectiveSubscriptionState({ status: 'ACTIVE', billingStatus: 'PAID', currentPeriodEnd: FUTURE })).toBe('ACTIVE');
    expect(resolveEffectiveSubscriptionState({ status: 'TRIAL', billingStatus: 'PAID', currentPeriodEnd: FUTURE })).toBe('TRIAL');
    expect(resolveEffectiveSubscriptionState({ status: 'GRACE', billingStatus: 'UNPAID', currentPeriodEnd: FUTURE })).toBe('GRACE');
    expect(resolveEffectiveSubscriptionState({ status: 'SUSPENDED' })).toBe('SUSPENDED');
    expect(resolveEffectiveSubscriptionState({ status: 'CANCELLED' })).toBe('CANCELLED');
    expect(resolveEffectiveSubscriptionState(null)).toBe('NONE');
  });
});

describe('isBillingWhitelisted', () => {
  it('whitelists subscription/dashboard/account resources for inactive states', () => {
    expect(isBillingWhitelisted('subscription.plans')).toBe(true);
    expect(isBillingWhitelisted('dashboard.overview')).toBe(true);
    expect(isBillingWhitelisted('account.settings')).toBe(true);
    expect(isBillingWhitelisted('inventory.products')).toBe(false);
  });
});

describe('authorizeBusinessAction — role layer', () => {
  let ds: Dataset;
  beforeEach(() => {
    ds = defaultDataset();
    invalidateAuthPolicyCache();
  });

  it('allows the OWNER (protected system role) full access', async () => {
    const decision = await auth(ds)('u-owner', 'b1', 'inventory.products', 'create');
    expect(decision.allowed).toBe(true);
    expect(decision.scope).toBe('BUSINESS');
  });

  it('allows a MANAGER with the exact page+operation grant', async () => {
    const decision = await auth(ds)('u-mgr', 'b1', 'inventory.products', 'create');
    expect(decision.allowed).toBe(true);
  });

  it('denies a CASHIER without the operation grant (page-level isolation)', async () => {
    const denied = await auth(ds)('u-cashier', 'b1', 'inventory.products', 'create');
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('OPERATION_DENIED');
    const allowed = await auth(ds)('u-cashier', 'b1', 'inventory.products', 'read');
    expect(allowed.allowed).toBe(true);
  });

  it('grants a custom role only its configured resource', async () => {
    const allowed = await auth(ds)('u-custom', 'b1', 'sales.invoices', 'create');
    expect(allowed.allowed).toBe(true);
    const denied = await auth(ds)('u-custom', 'b1', 'customers.customers', 'read');
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('OPERATION_DENIED');
  });

  it('never merges operations across pages of the same module (sales.invoices vs sales.refunds)', async () => {
    const allowed = await auth(ds)('u-custom', 'b1', 'sales.invoices', 'create');
    expect(allowed.allowed).toBe(true);
    const denied = await auth(ds)('u-custom', 'b1', 'sales.refunds', 'read');
    expect(denied.allowed).toBe(false);
  });

  it('denies when the role has no published policy (UNCONFIGURED), even for the owner path', async () => {
    const ds2 = defaultDataset();
    ds2.roles.get('r-mgr')!.permissionState = 'UNCONFIGURED';
    const decision = await auth(ds2)('u-mgr', 'b1', 'inventory.products', 'read');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('OPERATION_DENIED');
  });

  it('denies when the membership is missing or not ACTIVE (no owner synthesis)', async () => {
    expect((await auth(ds)('u-stranger', 'b1', 'inventory.products', 'read')).reason).toBe('NO_ACTIVE_MEMBERSHIP');
    const ds2 = defaultDataset();
    ds2.memberships.get('u-owner:b1')!.status = 'INACTIVE';
    const decision = await auth(ds2)('u-owner', 'b1', 'inventory.products', 'read');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('NO_ACTIVE_MEMBERSHIP');
  });
});

describe('authorizeBusinessAction — cross-tenant isolation', () => {
  let ds: Dataset;
  beforeEach(() => {
    ds = defaultDataset();
    invalidateAuthPolicyCache();
  });

  it('does not leak grants from one business into another for the same user', async () => {
    // u-mgr is a read+create MANAGER in b1, but in b2 the same role has no grants.
    const inB1 = await auth(ds)('u-mgr', 'b1', 'inventory.products', 'create');
    expect(inB1.allowed).toBe(true);
    const inB2 = await auth(ds)('u-mgr', 'b2', 'inventory.products', 'create');
    expect(inB2.allowed).toBe(false);
    expect(inB2.reason).toBe('OPERATION_DENIED');
  });
});

describe('authorizeBusinessAction — commercial layers', () => {
  let ds: Dataset;
  beforeEach(() => {
    ds = defaultDataset();
    invalidateAuthPolicyCache();
  });

  it('denies modules not enabled for the business type', async () => {
    ds.btModules = ds.btModules.filter((m) => m.moduleId !== 'm-inv');
    const decision = await auth(ds)('u-owner', 'b1', 'inventory.products', 'read');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('BUSINESS_TYPE_DENIED');
  });

  it('denies pages explicitly disabled for the business type', async () => {
    ds.btPages = [{ businessTypeId: 'bt-retail', pageId: 'p-inv-products', isEnabled: false }];
    const decision = await auth(ds)('u-owner', 'b1', 'inventory.products', 'read');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('BUSINESS_TYPE_DENIED');
  });

  it('denies when the plan is UNCONFIGURED (default deny, no fallback)', async () => {
    ds.plans.get('p1')!.permissionState = 'UNCONFIGURED';
    const decision = await auth(ds)('u-owner', 'b1', 'inventory.products', 'create');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('PLAN_NOT_ENTITLED');
  });

  it('denies a CONFIGURED plan with zero entitlements', async () => {
    ds.planEntitlements = [];
    const decision = await auth(ds)('u-owner', 'b1', 'inventory.products', 'create');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('PLAN_NOT_ENTITLED');
  });

  it('denies a resource-level NONE entitlement while other pages stay entitled', async () => {
    ds.planEntitlements.push({ id: 'pe-x', planId: 'p1', moduleKey: 'sales', pageKey: 'refunds', entitlementLevel: 'NONE' });
    const denied = await auth(ds)('u-owner', 'b1', 'sales.refunds', 'read');
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('PLAN_NOT_ENTITLED');
    const allowed = await auth(ds)('u-owner', 'b1', 'sales.invoices', 'read');
    expect(allowed.allowed).toBe(true);
  });

  it('enforces LIMITED (read-only) plan entitlement', async () => {
    ds.planEntitlements = ds.planEntitlements.filter((e) => !(e.moduleKey === 'inventory'));
    ds.planEntitlements.push({ id: 'pe-x', planId: 'p1', moduleKey: 'inventory', pageKey: null, entitlementLevel: 'LIMITED' });
    const read = await auth(ds)('u-owner', 'b1', 'inventory.products', 'read');
    expect(read.allowed).toBe(true);
    const write = await auth(ds)('u-owner', 'b1', 'inventory.products', 'create');
    expect(write.allowed).toBe(false);
    expect(write.reason).toBe('PLAN_NOT_ENTITLED');
  });

  it('denies when the business override disables the module', async () => {
    ds.overrides = [{ businessId: 'b1', moduleId: 'm-inv', enabled: false }];
    const decision = await auth(ds)('u-owner', 'b1', 'inventory.products', 'read');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('BUSINESS_OVERRIDE_DENIED');
  });
});

describe('authorizeBusinessAction — subscription states', () => {
  let ds: Dataset;
  beforeEach(() => {
    ds = defaultDataset();
    invalidateAuthPolicyCache();
  });

  const setState = (status: string, overrides: any = {}) => {
    const sub = ds.businesses.get('b1')!.businessSubscription;
    Object.assign(sub, { status, billingStatus: 'PAID', currentPeriodEnd: FUTURE, ...overrides });
  };

  it('allows TRIAL fully', async () => {
    setState('TRIAL');
    expect((await auth(ds)('u-owner', 'b1', 'inventory.products', 'create')).allowed).toBe(true);
  });

  it('allows read-only in GRACE and blocks writes', async () => {
    setState('GRACE');
    expect((await auth(ds)('u-owner', 'b1', 'inventory.products', 'read')).allowed).toBe(true);
    const write = await auth(ds)('u-owner', 'b1', 'inventory.products', 'create');
    expect(write.allowed).toBe(false);
    expect(write.reason).toBe('SUBSCRIPTION_INACTIVE');
  });

  it.each(['SUSPENDED', 'EXPIRED', 'CANCELLED'])('blocks commercial access when %s', async (status) => {
    setState(status);
    const decision = await auth(ds)('u-owner', 'b1', 'inventory.products', 'read');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('SUBSCRIPTION_INACTIVE');
  });

  it('blocks when ACTIVE but the period has elapsed (EXPIRED)', async () => {
    setState('ACTIVE', { currentPeriodEnd: PAST });
    const decision = await auth(ds)('u-owner', 'b1', 'inventory.products', 'read');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('SUBSCRIPTION_INACTIVE');
  });

  it('blocks when ACTIVE but unpaid (PAST_DUE)', async () => {
    setState('ACTIVE', { billingStatus: 'UNPAID' });
    const decision = await auth(ds)('u-owner', 'b1', 'inventory.products', 'read');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('SUBSCRIPTION_INACTIVE');
  });

  it('blocks when there is no subscription at all', async () => {
    ds.businesses.get('b1')!.businessSubscription = null;
    const decision = await auth(ds)('u-owner', 'b1', 'inventory.products', 'read');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('SUBSCRIPTION_INACTIVE');
  });

  it('keeps billing/account resources reachable when the subscription is inactive', async () => {
    ds.businesses.get('b1')!.businessSubscription = null;
    const subscription = await auth(ds)('u-owner', 'b1', 'subscription.plans', 'read');
    expect(subscription.allowed).toBe(true);
    const dashboard = await auth(ds)('u-owner', 'b1', 'dashboard.overview', 'read');
    expect(dashboard.allowed).toBe(true);
  });
});

describe('authorizeBusinessAction — data scope', () => {
  let ds: Dataset;
  beforeEach(() => {
    ds = defaultDataset();
    invalidateAuthPolicyCache();
  });

  it('enforces OWN scope against the record owner', async () => {
    ds.rolePermissions = ds.rolePermissions.filter((p) => p.roleId !== 'r-mgr');
    ds.rolePermissions.push(
      { id: 'rp-own', roleId: 'r-mgr', modulePageId: 'p-inv-products', operationKey: 'update', allowed: true, scope: 'OWN' }
    );
    const wrongOwner = await auth(ds)('u-mgr', 'b1', 'inventory.products', 'update', { recordOwnerId: 'u-owner' });
    expect(wrongOwner.allowed).toBe(false);
    expect(wrongOwner.reason).toBe('SCOPE_DENIED');
    const own = await auth(ds)('u-mgr', 'b1', 'inventory.products', 'update', { recordOwnerId: 'u-mgr' });
    expect(own.allowed).toBe(true);
  });

  it('enforces ASSIGNED_BRANCH scope against the request branch', async () => {
    ds.rolePermissions = ds.rolePermissions.filter((p) => p.roleId !== 'r-mgr');
    ds.rolePermissions.push(
      { id: 'rp-br', roleId: 'r-mgr', modulePageId: 'p-inv-products', operationKey: 'update', allowed: true, scope: 'ASSIGNED_BRANCH' }
    );
    ds.memberships.get('u-mgr:b1')!.branches = [{ branchId: 'br-1' }];
    const otherBranch = await auth(ds)('u-mgr', 'b1', 'inventory.products', 'update', { branchId: 'br-2' });
    expect(otherBranch.allowed).toBe(false);
    expect(otherBranch.reason).toBe('SCOPE_DENIED');
    const assigned = await auth(ds)('u-mgr', 'b1', 'inventory.products', 'update', { branchId: 'br-1' });
    expect(assigned.allowed).toBe(true);
  });
});

describe('authorizeBusinessAction — dependencies', () => {
  let ds: Dataset;
  beforeEach(() => {
    ds = defaultDataset();
    invalidateAuthPolicyCache();
  });

  it('denies a module whose hard dependency has no effective access', async () => {
    ds.dependencies.push({ moduleId: 'm-sales', dependsOnModuleId: 'm-inv', isHardDependency: true });
    ds.btModules = ds.btModules.filter((m) => m.moduleId !== 'm-inv'); // inventory denied
    const decision = await auth(ds)('u-owner', 'b1', 'sales.invoices', 'read');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('DEPENDENCY_DENIED');
  });

  it('allows a module whose dependency chain is satisfied (transitive)', async () => {
    ds.btModules.push({ businessTypeId: 'bt-retail', moduleId: 'm-top', isEnabled: true, moduleKey: 'm-top' });
    ds.planEntitlements.push({ id: 'pe-top', planId: 'p1', moduleKey: 'm-top', pageKey: null, entitlementLevel: 'FULL' });
    ds.dependencies.push(
      { moduleId: 'm-sales', dependsOnModuleId: 'm-inv', isHardDependency: true },
      { moduleId: 'm-top', dependsOnModuleId: 'm-sales', isHardDependency: true }
    );
    const decision = await auth(ds)('u-owner', 'b1', 'm-top.overview', 'read');
    expect(decision.allowed).toBe(true);
  });

  it('fails closed on dependency cycles', async () => {
    ds.btModules.push(
      { businessTypeId: 'bt-retail', moduleId: 'm-ax', isEnabled: true, moduleKey: 'a-x' },
      { businessTypeId: 'bt-retail', moduleId: 'm-ay', isEnabled: true, moduleKey: 'a-y' }
    );
    ds.planEntitlements.push(
      { id: 'pe-ax', planId: 'p1', moduleKey: 'a-x', pageKey: null, entitlementLevel: 'FULL' },
      { id: 'pe-ay', planId: 'p1', moduleKey: 'a-y', pageKey: null, entitlementLevel: 'FULL' }
    );
    ds.dependencies.push(
      { moduleId: 'm-ax', dependsOnModuleId: 'm-ay', isHardDependency: true },
      { moduleId: 'm-ay', dependsOnModuleId: 'm-ax', isHardDependency: true }
    );
    const decision = await auth(ds)('u-owner', 'b1', 'a-x.overview', 'read');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('DEPENDENCY_DENIED');
  });

  it('skips the dependency check when explicitly requested', async () => {
    ds.dependencies.push({ moduleId: 'm-sales', dependsOnModuleId: 'm-inv', isHardDependency: true });
    ds.btModules = ds.btModules.filter((m) => m.moduleId !== 'm-inv');
    const decision = await auth(ds)('u-owner', 'b1', 'sales.invoices', 'read', { skipDependencyCheck: true });
    expect(decision.allowed).toBe(true);
  });
});

describe('authorizeBusinessAction — cache invalidation (versioned fingerprint)', () => {
  let ds: Dataset;
  beforeEach(() => {
    ds = defaultDataset();
    invalidateAuthPolicyCache();
  });

  it('serves a cached decision and invalidates it when policyVersion bumps', async () => {
    const call = auth(ds);
    expect((await call('u-owner', 'b1', 'inventory.products', 'create')).allowed).toBe(true);

    // Republish plan policy: remove the inventory entitlement AND bump the version
    // (exactly what the atomic publish endpoints do).
    ds.planEntitlements = ds.planEntitlements.filter((e) => !(e.moduleKey === 'inventory'));
    ds.plans.get('p1')!.policyVersion += 1;
    ds.plans.get('p1')!.updatedAt = new Date(NOW + 1);

    const decision = await call('u-owner', 'b1', 'inventory.products', 'create');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('PLAN_NOT_ENTITLED');
  });

  it('invalidates on subscription status change', async () => {
    const call = auth(ds);
    expect((await call('u-owner', 'b1', 'inventory.products', 'read')).allowed).toBe(true);

    ds.businesses.get('b1')!.businessSubscription.status = 'SUSPENDED';
    ds.businesses.get('b1')!.businessSubscription.updatedAt = new Date(NOW + 1);

    const decision = await call('u-owner', 'b1', 'inventory.products', 'read');
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('SUBSCRIPTION_INACTIVE');
  });
});

// ── Middleware integration ─────────────────────────────────────────────────

const mockPrismaRef: { current: any } = { current: null };

jest.mock('../src/utils/db.util', () => ({
  getPrisma: async () => mockPrismaRef.current,
  isSQLite: () => true,
  isPostgreSQL: () => false,
  getPrismaSync: () => mockPrismaRef.current,
  disconnectPrisma: async () => undefined,
}));

import { universalModuleProtection } from '../src/middleware/universal-module-protection.middleware';

describe('universal module protection middleware (Phase 4 — HTTP decisions)', () => {
  let ds: Dataset;
  beforeEach(() => {
    ds = defaultDataset();
    mockPrismaRef.current = fakePrisma(ds);
    invalidateAuthPolicyCache();
  });

  function mockRes() {
    const res: any = { statusCode: 0, body: null };
    res.status = (code: number) => {
      res.statusCode = code;
      return res;
    };
    res.json = (body: any) => {
      res.body = body;
      return res;
    };
    return res;
  }

  async function run(url: string, user: any, headers: any = {}, method = 'GET') {
    const req: any = { originalUrl: url, path: url, user, headers, method };
    const res = mockRes();
    let calledNext = false;
    await universalModuleProtection(req, res, () => {
      calledNext = true;
    });
    return { res, calledNext };
  }

  it('lets an entitled owner through a module route', async () => {
    const { res, calledNext } = await run('/api/products', { id: 'u-owner', companyId: 'b1' }, {});
    expect(calledNext).toBe(true);
    expect(res.statusCode).toBe(0);
    expect((res as any).body).toBeNull();
  });

  it('returns 403 PLAN_NOT_ENTITLED with an upgrade hint when the plan does not cover the resource', async () => {
    ds.planEntitlements = [];
    const { res, calledNext } = await run('/api/products', { id: 'u-owner', companyId: 'b1' }, {});
    expect(calledNext).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('PLAN_NOT_ENTITLED');
    expect(res.body.upgradeUrl).toBe('/subscription');
  });

  it('returns 401 NO_ACTIVE_MEMBERSHIP for a user without a membership in the business', async () => {
    const { res, calledNext } = await run('/api/products', { id: 'u-stranger', companyId: 'b1' }, {});
    expect(calledNext).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('NO_ACTIVE_MEMBERSHIP');
  });

  it('maps the role gate to 403 OPERATION_DENIED', async () => {
    const { res, calledNext } = await run('/api/products', { id: 'u-cashier', companyId: 'b1' }, {}, 'POST');
    expect(calledNext).toBe(false);
    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe('OPERATION_DENIED');
    expect(res.body.resourceKey).toBe('inventory.products');
    expect(res.body.action).toBe('create');
  });
});
