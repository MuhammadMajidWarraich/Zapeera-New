import { Router } from 'express';
import {
  createPurchase,
  getPurchases,
  getPurchaseById,
  updatePurchase,
  deletePurchase
} from '../controllers/purchase.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('purchases'));

// Purchase routes (module check only)
router.post('/', createPurchase);
router.get('/', getPurchases);
router.get('/:id', getPurchaseById);
router.put('/:id', updatePurchase);
router.delete('/:id', deletePurchase);

export default router;
