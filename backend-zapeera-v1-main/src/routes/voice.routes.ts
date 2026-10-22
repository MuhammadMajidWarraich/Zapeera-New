import { Router } from 'express';
import { aiParse, aiUsage } from '../controllers/voice-ai.controller';
import { authenticate } from '../middleware/auth.middleware';
import { resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// Voice Assistant AI layer: authenticated tenant infrastructure inside a
// business workspace (route-policy: 'auth-core', like /api/dashboard).
// The rule parser in the frontend is the first pass — these endpoints
// serve only the AI fallback (ai-parse) and the caller's own usage
// meter (ai-usage). Membership resolution scopes every call to the
// caller's business; the controller re-reads the business type from
// the DB rather than trusting the client payload.
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());

router.post('/ai-parse', aiParse);
router.get('/ai-usage', aiUsage);

export default router;
