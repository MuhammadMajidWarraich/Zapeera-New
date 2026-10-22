import { Router } from 'express';
import {
  getMyPartner,
  getMyPartnerBusinesses,
  updateMyPartnerBranding
} from '../controllers/partner.controller';
import {
  applyPublic,
  applyAuthenticated,
  getMyApplication
} from '../controllers/partner-application.controller';
import { authenticate } from '../middleware/auth.middleware';
import { createRateLimiter } from '../middleware/rate-limit.middleware';

const router = Router();

// ─── Partner portal (White-label Feature 3) ───────────────────────────
// Account-level endpoints for the /partner page in the main app. The
// caller's identity as a partner admin is resolved from the partner's
// adminUserId inside the controller (404 NOT_A_PARTNER_ADMIN for
// everyone else). No business context / module gate applies — this is
// the reseller's own portal, like the /zapeera account area.
// Route-policy registry maps /api/partners to kind 'auth', with the
// apply endpoint carved out as 'public' (longest prefix wins).
//
// MOUNT (server.ts, both prefixes):
//   import partnerRoutes from './routes/partner.routes';
//   app.use('/api/v1/partners', partnerRoutes);
//   app.use('/api/partners', partnerRoutes);

// ─── Partner applications (2026-10-22) ────────────────────────────────
// The PUBLIC application endpoint MUST be registered before
// router.use(authenticate): the marketing site's Become-a-Partner form
// posts here with no session. Rate-limited per IP (the in-memory
// limiter pattern) + honeypot in the controller as anti-spam.
const applicationRateLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 20,
  message: 'Too many partner applications from this network. Please try again later.'
});

router.post('/apply', applicationRateLimiter, applyPublic);

router.use(authenticate);

router.post('/apply-authenticated', applyAuthenticated);
router.get('/my-application', getMyApplication);
router.get('/me', getMyPartner);
router.get('/me/businesses', getMyPartnerBusinesses);
router.put('/me/branding', updateMyPartnerBranding);

export default router;
