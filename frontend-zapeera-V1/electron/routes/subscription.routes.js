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

  // ── Billing proxy (2026-10-28) ──────────────────────────────────
  // The 17 missing subscription endpoints are NOT ported locally:
  // billing state (payment methods, invoices, billing history, plan
  // pricing, add-on purchases, activation) lives only on the cloud —
  // there is no Stripe key, no invoice store, and no payment ledger
  // on the desktop to port against, and a local copy would fabricate
  // billing state. Instead the desktop PROXIES these calls to the
  // cloud when online (same pattern as the entitlements endpoint
  // above: the owner's cloud token, the cloud's own role checks —
  // the pricing/admin writes 403 on the cloud for non-admins). When
  // offline, or with no cloud token, the call fails HONESTLY with
  // 503 CLOUD_UNAVAILABLE instead of a fabricated local answer.
  // The invoice download is the one exception: makeRequest is
  // JSON-only and cannot carry a PDF, so it 501s and points at the
  // web dashboard. /admin/subscriptions* (backoffice) is out of
  // scope — no embedded admin surface calls it.
  const SUBSCRIPTION_PROXY = [
    ['GET', '/api/subscription', null],
    ['PUT', '/api/subscription', null],
    ['GET', '/api/subscription/pricing-plans', null],
    ['PUT', '/api/subscription/pricing-plans', null],
    ['PATCH', '/api/subscription/pricing-plans/:planId/modules/:moduleId', null],
    ['GET', '/api/subscription/annual-discount', null],
    ['PUT', '/api/subscription/annual-discount', null],
    ['PUT', '/api/subscription/entitlements/business/:companyId', null],
    ['GET', '/api/subscription/payment-methods', null],
    ['POST', '/api/subscription/payment-methods', null],
    ['PUT', '/api/subscription/payment-methods/:methodId', null],
    ['PUT', '/api/subscription/payment-methods/:methodId/default', null],
    ['DELETE', '/api/subscription/payment-methods/:methodId', null],
    ['GET', '/api/subscription/addons/catalogue', null],
    ['GET', '/api/subscription/addons', null],
    ['POST', '/api/subscription/addons', null],
    ['POST', '/api/subscription/addons/cancel', null],
    ['POST', '/api/subscription/activate', null],
    ['POST', '/api/subscription/process-payment', null],
    ['GET', '/api/subscription/billing-history', null],
  ];
  function proxyToCloud(method, localPath) {
    return async (req, res) => {
      if (!cloudApi || typeof cloudApi.getAuthToken !== 'function' || !cloudApi.getAuthToken()) {
        return res.status(503).json({
          success: false,
          code: 'CLOUD_UNAVAILABLE',
          message: 'Subscription billing needs an internet connection — sign in to the cloud account and retry. Nothing was charged or changed.'
        });
      }
      // Forward the query string (getBusinessAddons reads businessId
      // from it). The cloud path is req.path — the matched path with
      // :params substituted — NOT the route template (which would send
      // the literal string ":methodId" to the cloud).
      const qIndex = req.originalUrl.indexOf('?');
      const cloudPath = qIndex >= 0 ? req.path + req.originalUrl.slice(qIndex) : req.path;
      try {
        const data = await cloudApi.makeRequest(method, cloudPath, req.body || null, { timeout: 20000 });
        return res.json(data);
      } catch (e) {
        // The cloud answered with an error (validation, 402, 403 …):
        // pass its status + body through so the UI shows the real reason.
        if (e && e.statusCode && e.body) return res.status(e.statusCode).json(e.body);
        console.warn('[Subscription] Cloud proxy failed:', e && e.message);
        return res.status(503).json({
          success: false,
          code: 'CLOUD_UNAVAILABLE',
          message: 'The cloud billing service could not be reached — check the connection and retry. Nothing was charged or changed.'
        });
      }
    };
  }
  for (const [method, localPath] of SUBSCRIPTION_PROXY) {
    const handler = (req, res) => proxyToCloud(method, localPath)(req, res);
    if (method === 'GET') app.get(localPath, authMiddleware, handler);
    else if (method === 'POST') app.post(localPath, authMiddleware, handler);
    else if (method === 'PUT') app.put(localPath, authMiddleware, handler);
    else if (method === 'PATCH') app.patch(localPath, authMiddleware, handler);
    else if (method === 'DELETE') app.delete(localPath, authMiddleware, handler);
  }

  // Invoice download: the cloud returns a PDF and the embedded
  // cloud client is JSON-only, so this cannot be proxied. Honest
  // 501 (not a fabricated file) — the web dashboard downloads it.
  app.get('/api/subscription/invoices/:invoiceId/download', authMiddleware, (req, res) => {
    return res.status(501).json({
      success: false,
      code: 'DOWNLOAD_NOT_SUPPORTED_ON_DESKTOP',
      message: 'Invoice downloads are available on the web dashboard (app.zapeera.seikho.online) — the desktop cannot fetch PDF files from the cloud.'
    });
  });

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
