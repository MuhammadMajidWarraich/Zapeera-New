/**
 * Canonical Authorization Service (Phases 2–3).
 *
 * Single reusable decision point for the whole application. Access is granted
 * only when EVERY relevant layer allows it:
 *
 *   business type  → subscription state → plan entitlement → business override
 *   → active membership → role permission (exact resource + action) → data scope
 *   → module dependencies (effective access)
 *
 * The final decision is returned as a structured object with an exact reason,
 * so API responses and audit logging are consistent everywhere.
 *
 * Design rules enforced here:
 *  - Default deny when configuration is missing or ambiguous.
 *  - "Configured with zero enabled permissions" = deny-all, never "absent".
 *    (Plan/Role permissionState: UNCONFIGURED vs CONFIGURED.)
 *  - Operations are NEVER merged across pages/resources: permission to create
 *    `sales.invoices` grants nothing on `sales.refunds`.
 *  - Subscription status is checked before plan entitlements:
 *      ACTIVE / TRIAL            → full access
 *      GRACE                     → read-only access
 *      SUSPENDED / EXPIRED /
 *      CANCELLED / PAST_DUE      → commercial resources denied; only the
 *                                  explicit billing/account whitelist remains.
 *  - The business creator (business.createdBy) acts as ACTIVE OWNER even
 *    without a memberships row (mirrors resolveMembership in the
 *    multitenancy middleware). The OWNER role is protected: it is never
 *    subject to the role-permission gate (but still obeys business type /
 *    subscription / plan / override layers).
 *  - Dependencies evaluate the dependency's EFFECTIVE access for the same
 *    business/user; cycles are detected and fail closed.
 */

import { authPolicyCache } from '../utils/auth-policy-cache';
import { isModuleApplicableToBusinessType } from '../utils/module-applicability.util';

/** The business's type key for industry-applicability checks (raw column
 *  first — it holds the canonical id/name — then the resolved type row). */
function contextBusinessTypeKey(context: AuthContext): string | null {
  return (
    context.business?.businessType ??
    context.businessType?.name ??
    context.businessType?.id ??
    null
  );
}

export type AccessReason =
  | 'ALLOWED'
  | 'NO_ACTIVE_MEMBERSHIP'
  | 'BUSINESS_TYPE_DENIED'
  | 'SUBSCRIPTION_INACTIVE'
  | 'PLAN_NOT_ENTITLED'
  | 'BUSINESS_OVERRIDE_DENIED'
  | 'ROLE_DENIED'
  | 'OPERATION_DENIED'
  | 'SCOPE_DENIED'
  | 'DEPENDENCY_DENIED'
  | 'UNKNOWN_ERROR';

export interface AuthDecision {
  allowed: boolean;
  reason: AccessReason;
  moduleKey: string;
  resourceKey: string;
  action: string;
  scope: string;
  policyVersion: string;
}

export interface AuthorizeOptions {
  branchId?: string;
  recordOwnerId?: string;
  skipDependencyCheck?: boolean;
  /** Internal: recursion path for dependency cycle detection. */
  _visited?: Set<string>;
}

export const FULL_OPERATION_SET = ['read', 'create', 'update', 'delete', 'export', 'approve', 'print'];

export const VALID_OPERATION_KEYS = new Set(FULL_OPERATION_SET);

export const PERMISSION_SCOPES = ['OWN', 'ASSIGNED_BRANCH', 'ALL_BRANCHES', 'BUSINESS'] as const;
export type PermissionScope = (typeof PERMISSION_SCOPES)[number];

/**
 * Subscription states eligible for commercial resource access.
 * GRACE is eligible for READ ONLY (enforced in authorizeResourceAction).
 */
export const SUBSCRIPTION_STATES = ['ACTIVE', 'TRIAL', 'GRACE', 'SUSPENDED', 'EXPIRED', 'CANCELLED'] as const;
export type SubscriptionState = (typeof SUBSCRIPTION_STATES)[number];

export type EffectiveSubscriptionState = 'ACTIVE' | 'TRIAL' | 'GRACE' | 'PAST_DUE' | 'SUSPENDED' | 'EXPIRED' | 'CANCELLED' | 'NONE';

/**
 * Resources always reachable regardless of subscription status (account
 * lifecycle access). These are billing/account/support/export paths.
 */
export function isBillingWhitelisted(resourceKey: string): boolean {
  const key = String(resourceKey || '').toLowerCase();
  const [moduleKey] = key.split('.');
  return moduleKey === 'subscription' || moduleKey === 'dashboard' || key.startsWith('account.');
}

/**
 * Resolve the effective subscription state from the stored row.
 * ACTIVE + expired period → EXPIRED; ACTIVE + unpaid billing → PAST_DUE.
 */
export function resolveEffectiveSubscriptionState(subscription: any): EffectiveSubscriptionState {
  if (!subscription) return 'NONE';

  const status = String(subscription.status || '').toUpperCase();
  if (status === 'SUSPENDED' || status === 'EXPIRED' || status === 'CANCELLED') {
    return status as EffectiveSubscriptionState;
  }

  if (status === 'GRACE') return 'GRACE';
  if (status === 'TRIAL') return 'TRIAL';
  if (status === 'ACTIVE') {
    const periodEnd = subscription.currentPeriodEnd ? new Date(subscription.currentPeriodEnd).getTime() : null;
    if (periodEnd && Date.now() > periodEnd) return 'EXPIRED';

    const billingStatus = String(subscription.billingStatus || '').toUpperCase();
    if (billingStatus !== 'PAID') return 'PAST_DUE';
    return 'ACTIVE';
  }

  return 'NONE';
}

function stateAllowsWrite(state: EffectiveSubscriptionState): boolean {
  return state === 'ACTIVE' || state === 'TRIAL';
}

// ============================================================
// Context loading (business + membership + all policy layers)
// ============================================================

export interface AuthContext {
  business: any;
  membership: any;
  role: any;
  rolePermissions: any[];
  plan: any;
  planEntitlements: any[];
  subscription: any;
  subscriptionState: EffectiveSubscriptionState;
  businessType: any;
  businessTypeModules: Map<string, { isEnabled: boolean; moduleKey: string }>;
  businessTypeDisabledPages: Set<string>; // pageIds explicitly disabled
  // Backoffice "module permissions" matrix tables (plan_module_permissions,
  // plan_sub_module_permissions, role_module_permissions,
  // role_sub_module_permissions, business_type_sub_module_permissions).
  // These are DENY-ONLY gates layered on top of the published policies:
  // an explicit enabled=false row denies; a missing or enabled row is
  // "no opinion" and never grants anything the policies don't already
  // grant. (Round-2 module sync: the Backoffice UI writes only these
  // tables, so the resolver must honor them or admin toggles do nothing.)
  backofficeGates: {
    planModules: Map<string, boolean>;
    planSubModules: Map<string, boolean>;
    roleModules: Map<string, boolean>;
    roleSubModules: Map<string, boolean>;
    businessTypeSubModules: Map<string, boolean>;
  };
  overrides: Map<string, boolean>; // moduleId → enabled
  moduleDefs: Map<string, any>;
  pagesByModule: Map<string, any[]>;
  pageById: Map<string, any>;
  dependencies: any[];
  fingerprint: string;
  policyVersion: string;
}

function nowMs(v: any): number {
  if (!v) return 0;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

/**
 * Compute the policy fingerprint WITHOUT loading the full context.
 * Kept intentionally cheap (a few SELECTs) — this is the price of never
 * serving stale authorization data.
 */
async function computePolicyFingerprint(prisma: any, businessId: string, userId: string): Promise<string> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      businessType: true,
      policyVersion: true,
      updatedAt: true,
      createdBy: true,
      businessSubscription: {
        select: { status: true, billingStatus: true, currentPeriodEnd: true, planId: true, updatedAt: true },
      },
    },
  });
  if (!business) return 'NO_BUSINESS';

  const membership = await prisma.membership.findUnique({
    where: { unique_user_business: { userId, businessId } },
    select: { status: true, updatedAt: true, roleId: true, role: { select: { name: true, permissionState: true, policyVersion: true, updatedAt: true } } },
  });

  const plan = business.businessSubscription?.planId
    ? await prisma.plan.findUnique({
        where: { id: business.businessSubscription.planId },
        select: { permissionState: true, policyVersion: true, updatedAt: true },
      })
    : null;

  let btPart = '';
  if (business.businessType) {
    const btRows = await prisma.$queryRaw<any[]>`
      SELECT id, "updatedAt" FROM business_types
      WHERE id = ${String(business.businessType).trim()} OR LOWER(name) = LOWER(${String(business.businessType).trim()})
      LIMIT 1`;
    if (btRows && btRows.length > 0) {
      const btId = btRows[0].id;
      const modMax = await prisma.$queryRaw<any[]>`SELECT MAX("updatedAt") as m FROM business_type_modules WHERE "businessTypeId" = ${btId}`;
      const pageMax = await prisma.$queryRaw<any[]>`SELECT MAX("updatedAt") as m FROM business_type_pages WHERE "businessTypeId" = ${btId}`;
      btPart = `${nowMs(btRows[0].updatedAt)}:${nowMs(modMax?.[0]?.m)}:${nowMs(pageMax?.[0]?.m)}`;
    }
  }

  const overrideMax = await prisma.$queryRaw<any[]>`SELECT MAX("updatedAt") as m FROM business_module_overrides WHERE "businessId" = ${businessId}`;
  // Backoffice matrix gates freshness (missing tables -> null -> stable part)
  let gatePart = '';
  try {
    const planIdForGates = business.businessSubscription?.planId || null;
    const roleNameForGates = membership?.role?.name ? String(membership.role.name).toUpperCase() : null;
    const planGateMax = planIdForGates
      ? await prisma.$queryRaw<any[]>`SELECT GREATEST((SELECT MAX("updatedAt") FROM plan_module_permissions WHERE "planId" = ${planIdForGates}), (SELECT MAX("updatedAt") FROM plan_sub_module_permissions WHERE "planId" = ${planIdForGates})) as m`
      : null;
    const roleGateMax = roleNameForGates
      ? await prisma.$queryRaw<any[]>`SELECT GREATEST((SELECT MAX("updatedAt") FROM role_module_permissions WHERE UPPER("roleName") = ${roleNameForGates}), (SELECT MAX("updatedAt") FROM role_sub_module_permissions WHERE UPPER("roleName") = ${roleNameForGates})) as m`
      : null;
    gatePart = `${nowMs(planGateMax?.[0]?.m)}:${nowMs(roleGateMax?.[0]?.m)}`;
  } catch { gatePart = ''; }
  const moduleDefMax = await prisma.$queryRaw<any[]>`SELECT MAX("updatedAt") as m FROM module_definitions`;
  const modulePageMax = await prisma.$queryRaw<any[]>`SELECT MAX("updatedAt") as m FROM module_pages`;

  const parts = [
    `b${business.policyVersion}:${nowMs(business.updatedAt)}`,
    `bt${btPart}`,
    `pr${String(business.createdBy ?? '')}`,
    `p${plan ? `${plan.permissionState}:${plan.policyVersion}:${nowMs(plan.updatedAt)}` : 'none'}`,
    `s${nowMs(business.businessSubscription?.updatedAt)}:${business.businessSubscription?.status || ''}:${business.businessSubscription?.billingStatus || ''}`,
    `m${membership ? `${membership.status}:${nowMs(membership.updatedAt)}` : 'none'}`,
    `r${membership?.role ? `${membership.role.permissionState}:${membership.role.policyVersion}:${nowMs(membership.role.updatedAt)}` : 'none'}`,
    `o${nowMs(overrideMax?.[0]?.m)}`,
    `g${gatePart}`,
    `d${nowMs(moduleDefMax?.[0]?.m)}:${nowMs(modulePageMax?.[0]?.m)}`,
  ];

  return parts.join('|');
}

/**
 * Load (or reuse from the shared versioned cache) the full authorization
 * context for (businessId, userId).
 */
export async function loadAuthContext(prisma: any, businessId: string, userId: string): Promise<AuthContext> {
  const fingerprint = await computePolicyFingerprint(prisma, businessId, userId);
  const cached = authPolicyCache.get<AuthContext>(businessId, userId, fingerprint);
  if (cached) return cached;

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: { businessSubscription: { include: { plan: true } } },
  });
  if (!business) {
    throw new Error(`Business not found: ${businessId}`);
  }

  let membership = await prisma.membership.findUnique({
    where: { unique_user_business: { userId, businessId } },
    include: { role: true, branches: true },
  });

  let role: any = null;
  let rolePermissions: any[] = [];
  if (membership?.roleId) {
    role = membership.role || null;
    try {
      rolePermissions = (await prisma.rolePermissionV2.findMany({
        where: { roleId: membership.roleId },
      })) || [];
    } catch {
      rolePermissions = [];
    }
  }

  if (!membership && business.createdBy && String(business.createdBy) === String(userId)) {
    // Business creator acts as OWNER even without a memberships row. Mirrors
    // resolveMembership() in multitenancy.middleware.ts so both layers agree.
    membership = {
      id: `creator:${userId}:${businessId}`,
      userId,
      businessId,
      status: 'ACTIVE',
      roleId: null,
      role: {
        id: `creator:${userId}`,
        name: 'OWNER',
        permissionState: 'CONFIGURED',
        policyVersion: business.policyVersion,
        updatedAt: business.updatedAt,
      },
      branches: [],
    };
    role = membership.role;
  }

  const subscription = business.businessSubscription || null;
  const plan = subscription?.plan || null;
  let planEntitlements: any[] = [];
  if (plan) {
    try {
      planEntitlements = (await prisma.planEntitlement.findMany({ where: { planId: plan.id } })) || [];
    } catch {
      planEntitlements = [];
    }
  }

  // Business type (id or case-insensitive name match)
  let businessType: any = null;
  let businessTypeIdForGates: string | null = null;
  let businessTypeModules = new Map<string, { isEnabled: boolean; moduleKey: string }>();
  let businessTypeDisabledPages = new Set<string>();
  if (business.businessType) {
    try {
      const btValue = String(business.businessType).trim();
      const btRows = await prisma.$queryRaw<any[]>`
        SELECT id, name FROM business_types
        WHERE id = ${btValue} OR LOWER(name) = LOWER(${btValue})
        LIMIT 1`;
      if (btRows && btRows.length > 0) {
        const btId = btRows[0].id;
        businessTypeIdForGates = String(btId);
        businessType = btRows[0];

        const rawBtModules = await prisma.$queryRaw<any[]>`
          SELECT btm."moduleId", btm."isEnabled", m.key as "moduleKey"
          FROM business_type_modules btm
          LEFT JOIN module_definitions m ON m.id = btm."moduleId"
          WHERE btm."businessTypeId" = ${btId}`;
        for (const row of rawBtModules || []) {
          if (row.moduleKey) businessTypeModules.set(normalizeKey(String(row.moduleKey)), { isEnabled: !!row.isEnabled, moduleKey: row.moduleKey });
        }

        const rawBtPages = await prisma.$queryRaw<any[]>`
          SELECT btp."pageId", btp."isEnabled" FROM business_type_pages btp WHERE btp."businessTypeId" = ${btId}`;
        for (const row of rawBtPages || []) {
          if (!row.isEnabled) businessTypeDisabledPages.add(String(row.pageId));
        }
      }
    } catch {
      businessType = null;
    }
  }

  const overrides = new Map<string, boolean>();
  try {
    const overrideRows = (await prisma.businessModuleOverride.findMany({ where: { businessId } })) || [];
    for (const o of overrideRows) overrides.set(String(o.moduleId), !!o.enabled);
  } catch {
    /* overrides table may not exist in old databases */
  }

  const moduleDefs = new Map<string, any>();
  const pagesByModule = new Map<string, any[]>();
  const pageById = new Map<string, any>();
  try {
    const defs = (await prisma.moduleDefinition.findMany({ where: { isActive: true } })) || [];
    for (const d of defs) moduleDefs.set(normalizeKey(String(d.key || '')), d);

    const pages = (await prisma.modulePage.findMany({ where: { isActive: true } })) || [];
    for (const p of pages) {
      pageById.set(String(p.id), p);
      const list = pagesByModule.get(String(p.moduleId)) || [];
      list.push(p);
      pagesByModule.set(String(p.moduleId), list);
    }
  } catch {
    /* tables may not exist yet */
  }

  let dependencies: any[] = [];
  try {
    dependencies = (await prisma.moduleDependency.findMany({ where: { isHardDependency: true }, include: { dependsOn: true } })) || [];
  } catch {
    dependencies = [];
  }

  // ── Backoffice matrix gates (deny-only) ─────────────────────────────
  const backofficeGates = {
    planModules: new Map<string, boolean>(),
    planSubModules: new Map<string, boolean>(),
    roleModules: new Map<string, boolean>(),
    roleSubModules: new Map<string, boolean>(),
    businessTypeSubModules: new Map<string, boolean>(),
  };
  try {
    if (plan?.id) {
      const rows = await prisma.$queryRaw<any[]>`SELECT "moduleName", enabled FROM plan_module_permissions WHERE "planId" = ${String(plan.id)}`;
      for (const r of rows || []) backofficeGates.planModules.set(normalizeKey(String(r.moduleName || '')), !!r.enabled);
      const subRows = await prisma.$queryRaw<any[]>`SELECT "moduleName", "subModuleKey", enabled FROM plan_sub_module_permissions WHERE "planId" = ${String(plan.id)}`;
      for (const r of subRows || []) backofficeGates.planSubModules.set(`${normalizeKey(String(r.moduleName || ''))}::${normalizeKey(String(r.subModuleKey || ''))}`, !!r.enabled);
    }
  } catch { /* tables may not exist yet — gates stay empty (no opinion) */ }
  try {
    const gateRoleName = String(role?.name || '').toUpperCase();
    if (gateRoleName) {
      const rows = await prisma.$queryRaw<any[]>`SELECT "moduleName", enabled FROM role_module_permissions WHERE UPPER("roleName") = ${gateRoleName}`;
      for (const r of rows || []) backofficeGates.roleModules.set(normalizeKey(String(r.moduleName || '')), !!r.enabled);
      const subRows = await prisma.$queryRaw<any[]>`SELECT "moduleName", "subModuleKey", enabled FROM role_sub_module_permissions WHERE UPPER("roleName") = ${gateRoleName}`;
      for (const r of subRows || []) backofficeGates.roleSubModules.set(`${normalizeKey(String(r.moduleName || ''))}::${normalizeKey(String(r.subModuleKey || ''))}`, !!r.enabled);
    }
  } catch { /* tables may not exist yet */ }
  try {
    if (businessTypeIdForGates) {
      const subRows = await prisma.$queryRaw<any[]>`SELECT "moduleName", "subModuleKey", enabled FROM business_type_sub_module_permissions WHERE "businessTypeId" = ${businessTypeIdForGates}`;
      for (const r of subRows || []) backofficeGates.businessTypeSubModules.set(`${normalizeKey(String(r.moduleName || ''))}::${normalizeKey(String(r.subModuleKey || ''))}`, !!r.enabled);
    }
  } catch { /* tables may not exist yet */ }

  const context: AuthContext = {
    business,
    membership,
    role,
    rolePermissions,
    plan,
    planEntitlements,
    subscription,
    subscriptionState: resolveEffectiveSubscriptionState(subscription),
    businessType,
    businessTypeModules,
    businessTypeDisabledPages,
    backofficeGates,
    overrides,
    moduleDefs,
    pagesByModule,
    pageById,
    dependencies,
    fingerprint,
    policyVersion: fingerprint,
  };

  authPolicyCache.set(businessId, userId, fingerprint, context);
  return context;
}

// ============================================================
// Layer evaluation
// ============================================================

function normalizeKey(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function resolveResource(context: AuthContext, resourceKey: string): { moduleKey: string; pageKey: string; module: any; page: any } {
  const key = String(resourceKey || '').toLowerCase();
  const [moduleKeyRaw, ...rest] = key.split('.');
  const moduleKey = normalizeKey(moduleKeyRaw);
  const pageKey = rest.length > 0 ? normalizeKey(rest.join('.')) : 'overview';

  const module = context.moduleDefs.get(moduleKey) || null;
  const pages = module ? (context.pagesByModule.get(String(module.id)) || []) : [];
  const page = pages.find((p) => normalizeKey(p.key) === pageKey) || null;

  return { moduleKey, pageKey, module, page };
}

export interface ModuleLevelDecision {
  allowed: boolean;
  reason: AccessReason;
  moduleKey: string;
  scope: string;
}

/**
 * Evaluate ALL layers except role/operation for a module (no user role check).
 * Used for dependency resolution and module-level evaluation.
 */
export async function evaluateModuleLayers(
  prisma: any,
  context: AuthContext,
  module: any,
  action: string,
  options: AuthorizeOptions = {}
): Promise<ModuleLevelDecision> {
  const moduleKey = normalizeKey(module.key || module.name || module.id);
  const scope = 'BUSINESS';

  // ── Membership ───────────────────────────────────────────────────────────
  if (!context.membership || String(context.membership.status).toUpperCase() !== 'ACTIVE') {
    return { allowed: false, reason: 'NO_ACTIVE_MEMBERSHIP', moduleKey, scope };
  }

  // ── Core modules (dashboard, subscription, account) bypass commercial layers
  const isCore = !!module.isCore;
  if (!isCore && moduleKey !== 'subscription') {
    // ── Industry applicability gate (HARD DENY, code-level) ─────────────
    // A module that does not belong to this business's industry (e.g. hotel
    // `rooms` for a PHARMACY) is denied regardless of business_type_modules
    // rows, plan entitlements or overrides. See module-applicability.util.
    if (!isModuleApplicableToBusinessType(moduleKey, contextBusinessTypeKey(context))) {
      return { allowed: false, reason: 'BUSINESS_TYPE_DENIED', moduleKey, scope };
    }

    // ── Business type gate ──────────────────────────────────────────────────
    const btEntry = context.businessTypeModules.get(moduleKey);
    if (!btEntry || !btEntry.isEnabled) {
      return { allowed: false, reason: 'BUSINESS_TYPE_DENIED', moduleKey, scope };
    }

    // ── Subscription state gate ─────────────────────────────────────────────
    const state = context.subscriptionState;
    if (state !== 'ACTIVE' && state !== 'TRIAL' && state !== 'GRACE') {
      return { allowed: false, reason: 'SUBSCRIPTION_INACTIVE', moduleKey, scope };
    }
    if (state === 'GRACE' && action !== 'read') {
      return { allowed: false, reason: 'SUBSCRIPTION_INACTIVE', moduleKey, scope };
    }

    // ── Plan entitlement gate (empty/UNCONFIGURED = deny) ───────────────────
    const planAllows = checkPlanEntitles(context, module);
    if (!planAllows) {
      return { allowed: false, reason: 'PLAN_NOT_ENTITLED', moduleKey, scope };
    }

    // ── Backoffice plan matrix gate (deny-only) ─────────────────────────────
    if (context.backofficeGates.planModules.get(moduleKey) === false) {
      return { allowed: false, reason: 'PLAN_NOT_ENTITLED', moduleKey, scope };
    }

    // ── Business override gate ──────────────────────────────────────────────
    const overrideEnabled = context.overrides.get(String(module.id));
    if (overrideEnabled === false) {
      return { allowed: false, reason: 'BUSINESS_OVERRIDE_DENIED', moduleKey, scope };
    }
  }

  // ── Dependencies (effective access for the same business/user; transitive;
  //    cycles fail closed) ────────────────────────────────────────────────────
  const depCheck = await checkDependencies(prisma, context, module, options);
  if (!depCheck.satisfied) {
    return { allowed: false, reason: 'DEPENDENCY_DENIED', moduleKey, scope };
  }

  return { allowed: true, reason: 'ALLOWED', moduleKey, scope };
}

function checkPlanEntitles(context: AuthContext, module: any): boolean {
  if (!context.plan) return false;
  if (String(context.plan.permissionState || 'UNCONFIGURED').toUpperCase() !== 'CONFIGURED') {
    return false; // no published policy → default deny (never fall back to allow)
  }

  const moduleKey = normalizeKey(module.key || module.name || module.id);
  const moduleRows = context.planEntitlements.filter((e) => normalizeKey(e.moduleKey) === moduleKey && !e.pageKey);

  // Explicit module-level NONE → deny the whole module.
  if (moduleRows.some((e) => String(e.entitlementLevel).toUpperCase() === 'NONE')) {
    return false;
  }

  const moduleLevel = moduleRows.some((e) => {
    const level = String(e.entitlementLevel).toUpperCase();
    return level === 'FULL' || level === 'LIMITED';
  });

  // Page-level rows: if ANY page of this module is entitled, the module is
  // considered entitled (page-level checks apply per resource in the action
  // authorization path).
  const pageRows = context.planEntitlements.filter((e) => normalizeKey(e.moduleKey) === moduleKey && e.pageKey);
  const anyPageEntitled = pageRows.some((e) => String(e.entitlementLevel).toUpperCase() !== 'NONE');

  return moduleLevel || anyPageEntitled;
}

/**
 * Check plan entitlement for an exact resource (module.page).
 * Returns 'ALLOWED' | 'READ_ONLY' | 'DENIED'.
 */
export function checkPlanEntitlesResource(context: AuthContext, moduleKey: string, pageKey: string): 'ALLOWED' | 'READ_ONLY' | 'DENIED' {
  if (!context.plan) return 'DENIED';
  if (String(context.plan.permissionState || 'UNCONFIGURED').toUpperCase() !== 'CONFIGURED') {
    return 'DENIED';
  }

  const pageRow = context.planEntitlements.find(
    (e) => normalizeKey(e.moduleKey) === normalizeKey(moduleKey) && e.pageKey && normalizeKey(e.pageKey) === normalizeKey(pageKey)
  );
  if (pageRow) {
    const level = String(pageRow.entitlementLevel).toUpperCase();
    if (level === 'NONE') return 'DENIED';
    return level === 'LIMITED' ? 'READ_ONLY' : 'ALLOWED';
  }

  const moduleRow = context.planEntitlements.find((e) => normalizeKey(e.moduleKey) === normalizeKey(moduleKey) && !e.pageKey);
  if (moduleRow) {
    const level = String(moduleRow.entitlementLevel).toUpperCase();
    if (level === 'NONE') return 'DENIED';
    return level === 'LIMITED' ? 'READ_ONLY' : 'ALLOWED';
  }

  return 'DENIED';
}

function checkBusinessTypePageAllows(context: AuthContext, page: any | null): boolean {
  if (!page) return true; // page unknown → module-level gate already applied
  return !context.businessTypeDisabledPages.has(String(page.id));
}

/**
 * Check the role's permission for (page, action). Owner bypasses the role
 * permission gate (protected system role), but data scope still applies.
 */
function checkRolePermission(
  context: AuthContext,
  page: any | null,
  action: string
): { allowed: boolean; scope: string } {
  const roleName = String(context.role?.name || '').toUpperCase();

  if (roleName === 'OWNER') {
    return { allowed: true, scope: 'BUSINESS' };
  }

  if (!context.role) return { allowed: false, scope: 'BUSINESS' };
  if (String(context.role.permissionState || 'UNCONFIGURED').toUpperCase() !== 'CONFIGURED') {
    return { allowed: false, scope: 'BUSINESS' }; // no published role policy → default deny
  }

  if (!page) return { allowed: false, scope: 'BUSINESS' };

  const opKey = normalizeKey(action);
  const permission = context.rolePermissions.find(
    (p) => String(p.modulePageId) === String(page.id) && normalizeKey(p.operationKey) === opKey
  );

  if (!permission || !permission.allowed) {
    return { allowed: false, scope: 'BUSINESS' };
  }

  return { allowed: true, scope: String(permission.scope || 'BUSINESS').toUpperCase() };
}

function checkScope(context: AuthContext, scope: string, options: AuthorizeOptions): boolean {
  switch (scope) {
    case 'OWN':
      return !!options.recordOwnerId && String(options.recordOwnerId) === String(context.membership.userId);
    case 'ASSIGNED_BRANCH': {
      if (!options.branchId) return false;
      const branches = context.membership?.branches || [];
      return branches.some((b: any) => String(b.branchId) === String(options.branchId));
    }
    case 'ALL_BRANCHES':
    case 'BUSINESS':
    default:
      return true;
  }
}

/**
 * Evaluate hard dependencies for a module using EFFECTIVE access for the same
 * business and user (not just definition isActive). Cycles fail closed.
 */
async function checkDependencies(
  prisma: any,
  context: AuthContext,
  module: any,
  options: AuthorizeOptions
): Promise<{ satisfied: boolean; missing: string[] }> {
  if (options.skipDependencyCheck) return { satisfied: true, missing: [] };

  const visited = new Set<string>(options._visited || []);
  if (visited.has(String(module.id))) {
    // Cycle detected — fail safely.
    return { satisfied: false, missing: [String(module.key || module.id)] };
  }
  visited.add(String(module.id));

  const deps = context.dependencies.filter((d) => String(d.moduleId) === String(module.id));
  const missing: string[] = [];

  for (const dep of deps) {
    const depModule = dep.dependsOn || context.moduleDefs.get(normalizeKey(dep.dependsOn?.key || ''));
    if (!depModule) {
      missing.push(String(dep.dependsOnModuleId));
      continue;
    }

    const depDecision = await evaluateModuleLayers(prisma, context, depModule, 'read', {
      ...options,
      _visited: visited,
    });
    if (!depDecision.allowed) {
      missing.push(String(depModule.key || depModule.name));
    }
  }

  return { satisfied: missing.length === 0, missing };
}

// ============================================================
// Public API
// ============================================================

/**
 * THE canonical decision point: may `userId` perform `action` on
 * `resourceKey` in `businessId`?
 *
 * resourceKey format: "moduleKey.pageKey" (e.g. "sales.refunds",
 * "inventory.products"). A bare module key resolves to its "overview" page.
 */
export async function authorizeBusinessAction(
  prisma: any,
  userId: string,
  businessId: string,
  resourceKey: string,
  action: string,
  options: AuthorizeOptions = {}
): Promise<AuthDecision> {
  const context = await loadAuthContext(prisma, businessId, userId);
  const { moduleKey, pageKey, module, page } = resolveResource(context, resourceKey);
  const opKey = normalizeKey(action) || 'read';

  const deny = (reason: AccessReason, scope = 'BUSINESS'): AuthDecision => ({
    allowed: false,
    reason,
    moduleKey,
    resourceKey: `${moduleKey}.${pageKey}`,
    action: opKey,
    scope,
    policyVersion: context.policyVersion,
  });

  const allow = (scope = 'BUSINESS'): AuthDecision => ({
    allowed: true,
    reason: 'ALLOWED',
    moduleKey,
    resourceKey: `${moduleKey}.${pageKey}`,
    action: opKey,
    scope,
    policyVersion: context.policyVersion,
  });

  try {
    // ── Layer 0: membership (no synthesized owner identities) ───────────────
    if (!context.membership || String(context.membership.status).toUpperCase() !== 'ACTIVE') {
      return deny('NO_ACTIVE_MEMBERSHIP');
    }

    // ── Layer 1: resource must exist ────────────────────────────────────────
    if (!module) {
      return deny('BUSINESS_TYPE_DENIED');
    }

    const isCore = !!module.isCore || moduleKey === 'subscription';

    if (!isCore) {
      // ── Layer 2a: industry applicability (HARD DENY, code-level) ────────
      // Independent of every DB row: a hotel module on a pharmacy business
      // is denied even if business_type_modules / plan entitlements were
      // (mis)configured to allow it. See module-applicability.util.
      if (!isModuleApplicableToBusinessType(moduleKey, contextBusinessTypeKey(context))) {
        return deny('BUSINESS_TYPE_DENIED');
      }

      // ── Layer 2: business type gate ──────────────────────────────────────
      const btEntry = context.businessTypeModules.get(moduleKey);
      if (!btEntry || !btEntry.isEnabled) {
        return deny('BUSINESS_TYPE_DENIED');
      }

      // ── Layer 3: subscription state gate (before plan) ───────────────────
      const state = context.subscriptionState;
      if (state !== 'ACTIVE' && state !== 'TRIAL' && state !== 'GRACE') {
        return deny('SUBSCRIPTION_INACTIVE');
      }
      if (state === 'GRACE' && opKey !== 'read') {
        return deny('SUBSCRIPTION_INACTIVE');
      }

      // ── Layer 4: plan entitlement (resource level; empty = deny) ──────────
      const planLevel = checkPlanEntitlesResource(context, moduleKey, pageKey);
      if (planLevel === 'DENIED') {
        return deny('PLAN_NOT_ENTITLED');
      }
      if (planLevel === 'READ_ONLY' && opKey !== 'read') {
        return deny('PLAN_NOT_ENTITLED');
      }

      // ── Layer 4b: Backoffice matrix gates (deny-only) ─────────────────────
      // The Backoffice module-permissions screens write these tables; an
      // explicit enabled=false there must deny here too, or admin toggles
      // silently do nothing. Precedence mirrors the payload: type, plan,
      // role. OWNER is exempt from role gates (protected system role).
      const gateKey = `${moduleKey}::${pageKey}`;
      if (context.backofficeGates.businessTypeSubModules.get(gateKey) === false) {
        return deny('BUSINESS_TYPE_DENIED');
      }
      if (context.backofficeGates.planModules.get(moduleKey) === false) {
        return deny('PLAN_NOT_ENTITLED');
      }
      if (context.backofficeGates.planSubModules.get(gateKey) === false) {
        return deny('PLAN_NOT_ENTITLED');
      }
      if (String(context.role?.name || '').toUpperCase() !== 'OWNER') {
        if (context.backofficeGates.roleModules.get(moduleKey) === false) {
          return deny('ROLE_DENIED');
        }
        if (context.backofficeGates.roleSubModules.get(gateKey) === false) {
          return deny('ROLE_DENIED');
        }
      }

      // ── Layer 5: business override ────────────────────────────────────────
      if (context.overrides.get(String(module.id)) === false) {
        return deny('BUSINESS_OVERRIDE_DENIED');
      }

      // ── Layer 6: business type page enablement ────────────────────────────
      if (!checkBusinessTypePageAllows(context, page)) {
        return deny('BUSINESS_TYPE_DENIED');
      }
    }

    // ── Layer 7: role permission (exact resource + action) ─────────────────
    const roleCheck = checkRolePermission(context, page, opKey);
    if (!roleCheck.allowed) {
      return deny('OPERATION_DENIED', roleCheck.scope);
    }

    // ── Layer 8: data scope ─────────────────────────────────────────────────
    if (!checkScope(context, roleCheck.scope, options)) {
      return deny('SCOPE_DENIED', roleCheck.scope);
    }

    // ── Layer 9: dependencies (effective access, cycle-safe) ───────────────
    const depCheck = await checkDependencies(prisma, context, module, options);
    if (!depCheck.satisfied) {
      return deny('DEPENDENCY_DENIED');
    }

    return allow(roleCheck.scope);
  } catch (error: any) {
    console.error('[Authorization Service] Error evaluating access:', String(error?.message || error));
    return deny('UNKNOWN_ERROR');
  }
}

/**
 * Module-level effective access for a business/user (no page/action).
 * Used by the frontend /modules/enabled payload and dependency checks.
 */
export async function evaluateModuleEffectiveAccess(
  prisma: any,
  businessId: string,
  userId: string,
  moduleKey: string,
  options: AuthorizeOptions = {}
): Promise<ModuleLevelDecision> {
  const context = await loadAuthContext(prisma, businessId, userId);

  if (!context.membership || String(context.membership.status).toUpperCase() !== 'ACTIVE') {
    return { allowed: false, reason: 'NO_ACTIVE_MEMBERSHIP', moduleKey: normalizeKey(moduleKey), scope: 'BUSINESS' };
  }

  const module = context.moduleDefs.get(normalizeKey(moduleKey));
  if (!module) {
    return { allowed: false, reason: 'BUSINESS_TYPE_DENIED', moduleKey: normalizeKey(moduleKey), scope: 'BUSINESS' };
  }

  const layerDecision = await evaluateModuleLayers(prisma, context, module, 'read', options);
  if (!layerDecision.allowed) return layerDecision;

  const roleName = String(context.role?.name || '').toUpperCase();
  if (roleName !== 'OWNER') {
    if (!context.role || String(context.role.permissionState || 'UNCONFIGURED').toUpperCase() !== 'CONFIGURED') {
      return { allowed: false, reason: 'ROLE_DENIED', moduleKey: normalizeKey(moduleKey), scope: 'BUSINESS' };
    }
    if (context.backofficeGates.roleModules.get(normalizeKey(moduleKey)) === false) {
      return { allowed: false, reason: 'ROLE_DENIED', moduleKey: normalizeKey(moduleKey), scope: 'BUSINESS' };
    }
  }

  const depCheck = await checkDependencies(prisma, context, module, options);
  if (!depCheck.satisfied) {
    return { allowed: false, reason: 'DEPENDENCY_DENIED', moduleKey: normalizeKey(moduleKey), scope: 'BUSINESS' };
  }

  return { allowed: true, reason: 'ALLOWED', moduleKey: normalizeKey(moduleKey), scope: 'BUSINESS' };
}

export function invalidateAuthPolicyCache(): void {
  authPolicyCache.clear();
}

export function getAuthPolicyCacheStats(): { size: number; maxSize: number; ttlMs: number } {
  return authPolicyCache.getStats();
}
