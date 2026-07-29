import { Router } from 'express';
import { createRefund, getRefunds, getRefundById } from '../controllers/refund.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership, checkPermission } from '../middleware/multitenancy.middleware';

const router = Router();

// All refund routes require authentication + membership
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('sales'));

// Create refund - permission guarded
router.post('/', checkPermission('create_refund'), createRefund);

// Get all refunds - permission guarded
router.get('/', checkPermission('read_refund'), getRefunds);

// Get refund by ID - permission guarded
router.get('/:id', checkPermission('read_refund'), getRefundById);

export default router;
