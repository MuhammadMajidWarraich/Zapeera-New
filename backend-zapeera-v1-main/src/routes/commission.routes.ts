import express from 'express';
import {
  calculateCommission,
  getCommissions,
  getCommission,
  updateCommission,
  getCommissionStats,
  getStaffPerformance
} from '../controllers/commission.controller';
import { authenticate } from '../middleware/auth.middleware';
import { resolveBusiness, resolveMembership, resolveBranch } from '../middleware/multitenancy.middleware';

const router = express.Router();

// All commission routes require authentication and business context
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));

// Commission operations
router.post('/calculate', calculateCommission);
router.get('/', getCommissions);
router.get('/stats', getCommissionStats);
router.get('/performance/:staffId', getStaffPerformance);
router.get('/:id', getCommission);
router.put('/:id', updateCommission);

export default router;
