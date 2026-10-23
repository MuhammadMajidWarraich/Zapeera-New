/**
 * Branding Routes (White-label Feature 3 — desktop parity fix)
 *
 * The shared frontend calls GET /api/branding on every app-shell load
 * (BrandingContext), but the desktop embedded server never implemented
 * it, so v1.0.4 answered 404 and the renderer logged an error on each
 * load (the UI silently fell back to stock branding).
 *
 * Web contract (backend branding.controller.ts): the route is PUBLIC
 * with optional auth — anonymous/invalid identity is never an error —
 * and it must never break the app shell: on any failure it serves the
 * default branding. Resolution order on the web is partner-by-slug →
 * partner behind the caller's business → default Zapeera branding.
 *
 * The desktop local DB has no partner/branding tables (white-label is
 * a cloud-side feature; local `companies` carries no partnerId), and a
 * desktop install is a direct Zapeera business, so the correct local
 * answer is exactly what the web backend returns for such businesses:
 * DEFAULT_BRANDING plus the non-partner viewer block.
 */

const DEFAULT_BRANDING = {
  productName: 'Zapeera',
  logoUrl: null,
  primaryColor: null,
  tagline: null,
  supportEmail: null,
  partnerSlug: null
};

const DEFAULT_VIEWER = {
  isPartnerAdmin: false,
  partnerSlug: null,
  partnerStatus: null
};

function registerBrandingRoutes(app, authMiddleware, deps) {
  // GET /api/branding — public (no authMiddleware), mirrors the web
  // soft-auth semantics: always 200 with contract-shaped branding.
  app.get('/api/branding', (req, res) => {
    try {
      res.json({
        success: true,
        data: { ...DEFAULT_BRANDING, viewer: { ...DEFAULT_VIEWER } }
      });
    } catch (e) {
      // Branding must never break the app shell — serve the default.
      res.json({
        success: true,
        data: { ...DEFAULT_BRANDING, viewer: { ...DEFAULT_VIEWER } }
      });
    }
  });
}

module.exports = {
  registerBrandingRoutes,
  DEFAULT_BRANDING,
  DEFAULT_VIEWER
};
