// ─── JazzCash vendor callbacks (feature/integration-jazzcash) ─────────────
// PUBLIC router — JazzCash calls these with no user session, so there is
// NO authenticate / tenancy / role middleware here. Security is the
// SecureHash: every callback is verified against the salt of the
// connection that owns the sale (see src/integrations/jazzcash), and the
// body is never logged (IPN payloads carry pp_Password in plaintext).
//
// Mounted in server.ts BEFORE the authenticated integrations router, on
// the same /api/v1/integrations + /api/integrations prefixes, so only
// these two paths are public and everything else keeps the OWNER/MANAGER
// gate. Both paths are classified { kind: 'public' } in
// src/config/route-policy.registry.ts and listed in ALWAYS_ALLOWED_ROUTES
// (module-route-protection.config.ts) — without those entries the
// fail-closed gates would 403 the callbacks in production.
//
//   POST /jazzcash/ipn    — REST IPN listener. JazzCash retries a failed
//                           IPN 3 times; a 000 ack stops the retries.
//   POST /jazzcash/return — page-redirection Return URL (card / OTC
//                           hosted flow). Renders a plain status page.
import { Router } from 'express';
import {
  handleJazzCashIpnRoute,
  handleJazzCashReturnRoute
} from '../controllers/jazzcash-ipn.controller';

const router = Router();

router.post('/jazzcash/ipn', handleJazzCashIpnRoute);
router.post('/jazzcash/return', handleJazzCashReturnRoute);

export default router;
