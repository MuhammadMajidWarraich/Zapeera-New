/**
 * Plan catalog — the desktop's copy of the backend's default plans.
 * Shared by the subscription fallback (subscription.routes.js) and the
 * license gate (license-gate.js) so both map a planId to the same limits.
 *
 * The license payload's planId is the AUTHORITY for the plan once a
 * signed license exists (a local membership row can be edited; a signed
 * token cannot). The legacy membership path uses the same catalog so the
 * two paths agree on limits for a given planId. Unknown planIds map to
 * null limits (no entitlement) — never to a silent default plan.
 */
const PLAN_CATALOG = {
  'single-trial': {
    id: 'single-trial',
    segment: 'single',
    name: 'Trial',
    dashboardAccessRoles: ['OWNER', 'MANAGER', 'CASHIER'],
    businessTypes: ['PHARMACY', 'STORE', 'HOTEL', 'CLINIC'],
    limits: { maxBranches: 1, maxCountersPerBranch: 1, maxConcurrentUsers: 5 },
  },
  'single-starter': {
    id: 'single-starter',
    segment: 'single',
    name: 'Starter',
    dashboardAccessRoles: ['OWNER', 'MANAGER', 'CASHIER'],
    businessTypes: ['PHARMACY', 'STORE', 'HOTEL', 'CLINIC'],
    limits: { maxBranches: 1, maxCountersPerBranch: 1, maxConcurrentUsers: 1 },
  },
  'single-growth': {
    id: 'single-growth',
    segment: 'single',
    name: 'Growth',
    dashboardAccessRoles: ['OWNER', 'MANAGER', 'CASHIER'],
    businessTypes: ['PHARMACY', 'STORE', 'HOTEL', 'CLINIC'],
    limits: { maxBranches: 3, maxCountersPerBranch: 3, maxConcurrentUsers: 20 },
  },
  'single-scale': {
    id: 'single-scale',
    segment: 'single',
    name: 'Scale',
    dashboardAccessRoles: ['OWNER', 'MANAGER', 'CASHIER'],
    businessTypes: ['PHARMACY', 'STORE', 'HOTEL', 'CLINIC'],
    limits: { maxBranches: 10, maxCountersPerBranch: 999, maxConcurrentUsers: 100 },
  },
};

const EMPTY_LIMITS = { maxBranches: null, maxCountersPerBranch: null, maxConcurrentUsers: null };

function planFor(planId) {
  if (!planId || !PLAN_CATALOG[planId]) return null;
  return PLAN_CATALOG[planId];
}

function planLimitsFor(planId) {
  const plan = planFor(planId);
  return plan ? plan.limits : EMPTY_LIMITS;
}

module.exports = { PLAN_CATALOG, EMPTY_LIMITS, planFor, planLimitsFor };
