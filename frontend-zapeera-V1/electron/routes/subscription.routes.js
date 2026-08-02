/**
 * Subscription Routes
 * Business entitlements for the embedded (desktop) server.
 *
 * Entitlement data is fetched live from the Cloud Backend when a cloud token is
 * available (matching the web dashboard exactly). When offline, a local fallback
 * built from the synced `memberships` table is returned instead of a hardcoded
 * "Free Plan" mock.
 */

// Local plan catalog mirroring the backend's default plans
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

function registerSubscriptionRoutes(app, authMiddleware, deps) {
  const { query, cloudApi } = deps;

  app.get('/api/subscription/entitlements/business/:companyId', authMiddleware, async (req, res) => {
    try {
      const { companyId } = req.params;

      const company = query('SELECT id, name, businessType FROM companies WHERE id = ? AND isActive = 1', [companyId])[0];

      if (!company) {
        return res.status(404).json({ success: false, message: 'Company not found' });
      }

      // 1) Prefer the live cloud entitlement so the desktop matches the web dashboard.
      if (cloudApi && typeof cloudApi.getAuthToken === 'function' && cloudApi.getAuthToken()) {
        try {
          const cloud = await cloudApi.makeRequest(
            'GET',
            `/api/subscription/entitlements/business/${encodeURIComponent(companyId)}`,
            null,
            { timeout: 12000 }
          );
          if (cloud && cloud.success && cloud.data) {
            console.log('[Subscription] ✅ Live cloud entitlement for', companyId, cloud.data.planId, cloud.data.subscriptionStatus);
            return res.json({ success: true, data: cloud.data });
          }
        } catch (cloudErr) {
          console.warn('[Subscription] Cloud entitlement unavailable, using local fallback:', cloudErr.message);
        }
      }

      // 2) Local fallback from the synced memberships table.
      const memberships = query(
        'SELECT subscriptionPlan, subscriptionStatus FROM memberships WHERE businessId = ? ORDER BY updatedAt DESC LIMIT 1',
        [companyId]
      );
      const membership = memberships && memberships.length > 0 ? memberships[0] : null;

      const rawPlanId = membership?.subscriptionPlan || '';
      const rawStatus = membership?.subscriptionStatus || '';
      const planKey = PLAN_CATALOG[rawPlanId] ? rawPlanId : null;
      const plan = planKey ? PLAN_CATALOG[planKey] : null;

      const normalizedStatus = rawStatus ? String(rawStatus).toString().trim().toUpperCase() : null;
      const isActiveStatus = normalizedStatus === 'ACTIVE' || normalizedStatus === 'TRIAL' || normalizedStatus === 'GRACE';
      const isSubscribed = Boolean(plan && isActiveStatus);

      const usage = {
        activeBranches: query('SELECT COUNT(*) as c FROM branches WHERE companyId = ? AND isActive = 1', [companyId])[0]?.c || 0,
        activeUsers: query('SELECT COUNT(*) as c FROM users WHERE companyId = ? AND isActive = 1', [companyId])[0]?.c || 0,
        totalUsers: query('SELECT COUNT(*) as c FROM users WHERE companyId = ?', [companyId])[0]?.c || 0,
      };

      const limits = plan ? plan.limits : { maxBranches: null, maxCountersPerBranch: null, maxConcurrentUsers: null };
      const remaining = plan
        ? {
            branches: limits.maxBranches === null ? null : Math.max(limits.maxBranches - usage.activeBranches, 0),
            users: limits.maxConcurrentUsers === null ? null : Math.max(limits.maxConcurrentUsers - usage.totalUsers, 0),
          }
        : { branches: null, users: null };

      res.json({
        success: true,
        data: {
          companyId,
          businessType: company.businessType || 'PHARMACY',
          planId: plan ? plan.id : null,
          isSubscribed,
          subscriptionStatus: normalizedStatus,
          trialEndsAt: null,
          currentPeriodEnd: null,
          addOns: {},
          plan: plan || null,
          limits,
          effectiveLimits: limits,
          includedLimits: limits,
          usage,
          remaining,
        },
      });
    } catch (e) {
      console.error('[Subscription] error:', e.message);
      res.status(500).json({ success: false, message: e.message });
    }
  });
}

module.exports = { registerSubscriptionRoutes };
