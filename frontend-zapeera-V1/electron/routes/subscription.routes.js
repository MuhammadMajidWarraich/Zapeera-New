/**
 * Subscription Routes
 * Business entitlements for the embedded (desktop) server.
 *
 * Entitlement data is fetched live from the Cloud Backend when a cloud token is
 * available (matching the web dashboard exactly). When offline, a local fallback
 * built from the synced `memberships` table is returned instead of a hardcoded
 * "Free Plan" mock.
 */

// Local plan catalog mirroring the backend's default plans. Shared
// with the license gate (services/license/plan-catalog.js) so both map
// a planId to the same limits.
const { PLAN_CATALOG, EMPTY_LIMITS } = require('../services/license/plan-catalog');
const licenseGate = require('../services/license/license-gate');
const licenseClient = require('../services/license/license-client');

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
            // While online, opportunistically refresh the signed license
            // token (best-effort, never blocks the response; fails soft
            // until the server ships /api/license/refresh).
            try { licenseClient.refreshFromCloud(cloudApi).catch(() => {}); } catch (e) { /* never block */ }
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

      // License shadow gate (2026-10-28): evaluate the stored signed
      // token against the legacy verdict and log any mismatch. SHADOW
      // MODE — the legacy verdict below still decides the response;
      // the license verdict is reported in `licenseShadow` for the
      // deploy-phase review and drives nothing yet. When enforcement
      // flips, this is the call site that switches to the license
      // verdict + resolvePlanLimits(check, planKey).
      let licenseShadow = null;
      try {
        const licenseCheck = licenseGate.checkEntitlement({
          token: licenseClient.getStoredToken(),
          legacyEntitled: isSubscribed,
          legacyPlanId: planKey,
          businessId: companyId,
          deviceId: licenseClient.getDeviceId(),
          installId: licenseClient.getInstallId()
        });
        const licenseLimits = licenseGate.resolvePlanLimits(licenseCheck, planKey);
        licenseShadow = {
          mode: licenseCheck.mode,
          entitled: licenseCheck.licenseEntitled,
          reason: licenseCheck.licenseReason,
          planId: licenseCheck.licensePlanId,
          mismatch: licenseCheck.mismatch,
          inGrace: licenseCheck.inGrace,
          warnings: licenseCheck.warnings,
          // What enforcement would use for limits (diagnostic only).
          licenseLimits: licenseLimits.limits
        };
      } catch (licenseErr) {
        console.warn('[Subscription] License shadow check failed:', licenseErr.message);
      }

      const usage = {
        activeBranches: query('SELECT COUNT(*) as c FROM branches WHERE companyId = ? AND isActive = 1', [companyId])[0]?.c || 0,
        activeUsers: query('SELECT COUNT(*) as c FROM users WHERE companyId = ? AND isActive = 1', [companyId])[0]?.c || 0,
        totalUsers: query('SELECT COUNT(*) as c FROM users WHERE companyId = ?', [companyId])[0]?.c || 0,
      };

      const limits = plan ? plan.limits : EMPTY_LIMITS;
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
          // Diagnostic only (ignored by the frontend): the shadow-mode
          // license verdict for this business. Removed or kept when
          // enforcement flips; never drives the response while shadow.
          licenseShadow,
        },
      });
    } catch (e) {
      console.error('[Subscription] error:', e.message);
      res.status(500).json({ success: false, message: e.message });
    }
  });
}

module.exports = { registerSubscriptionRoutes };
