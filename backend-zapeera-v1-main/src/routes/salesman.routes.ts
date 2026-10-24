import express from 'express';
import {
  listSalesmen,
  getSalesmenPerformance,
  getSalesmanPerformance
} from '../controllers/salesman.controller';
import { authenticate } from '../middleware/auth.middleware';
import { resolveBusiness, resolveMembership, resolveBranch } from '../middleware/multitenancy.middleware';
import { requireStaffAllowed } from '../middleware/subscription.middleware';

const router = express.Router();

// Same auth + tenancy stack as the commission routes: every salesman
// read is scoped to the caller's business.
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(requireStaffAllowed());

// Salesman roster (POS picker) and performance views (gap item 7).
// NOTE: /performance must be registered before /:id/performance so
// the literal segment wins over the param.
router.get('/', listSalesmen);
router.get('/performance', getSalesmenPerformance);
router.get('/:id/performance', getSalesmanPerformance);

export default router;
