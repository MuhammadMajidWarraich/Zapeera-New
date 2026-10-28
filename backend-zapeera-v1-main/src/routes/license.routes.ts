import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { refreshLicense, reportLicenseMismatch } from '../controllers/license.controller';

const router = Router();

// All license routes require authentication. Classified 'auth' in the
// route-policy registry (account-level, like /api/devices and /api/sync)
// and listed in ALWAYS_ALLOWED_ROUTES so the fail-closed gates pass.
router.use(authenticate);

// Re-issue a fresh license token (re-checks subscription + device cap).
router.post('/refresh', refreshLicense);

// Shadow-mode mismatch log hook (license verdict vs legacy verdict).
router.post('/report', reportLicenseMismatch);

export default router;
