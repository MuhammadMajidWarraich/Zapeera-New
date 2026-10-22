import { Router } from 'express';
import {
  getMyPartner,
  getMyPartnerBusinesses,
  updateMyPartnerBranding
} from '../controllers/partner.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// ─── Partner portal (White-label Feature 3) ───────────────────────────
// Account-level endpoints for the /partner page in the main app. The
// caller's identity as a partner admin is resolved from the partner's
// adminUserId inside the controller (404 NOT_A_PARTNER_ADMIN for
// everyone else). No business context / module gate applies — this is
// the reseller's own portal, like the /zapeera account area.
// Route-policy registry maps /api/partners to kind 'auth'.
//
// MOUNT (server.ts, both prefixes):
//   import partnerRoutes from './routes/partner.routes';
//   app.use('/api/v1/partners', partnerRoutes);
//   app.use('/api/partners', partnerRoutes);
router.use(authenticate);

router.get('/me', getMyPartner);
router.get('/me/businesses', getMyPartnerBusinesses);
router.put('/me/branding', updateMyPartnerBranding);

export default router;
