import { Router } from 'express';
import {
  joinAffiliate,
  getMyAffiliateDashboard,
  getMyReferrals,
  getMyCommissions,
  getMyPayouts,
  requestPayout,
  updatePayoutDetails
} from '../controllers/affiliate.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Affiliate self-service: authenticated account-level routes. There is
// deliberately NO module/business gate here — an affiliate is a plain
// registered user who may own no business at all (route-policy kind
// 'auth', see config/route-policy.registry.ts), exactly like support.
router.use(authenticate);

router.post('/join', joinAffiliate);
router.get('/me', getMyAffiliateDashboard);
router.get('/me/referrals', getMyReferrals);
router.get('/me/commissions', getMyCommissions);
router.get('/me/payouts', getMyPayouts);
router.post('/me/payout-request', requestPayout);
router.put('/me/payout-details', updatePayoutDetails);

export default router;
