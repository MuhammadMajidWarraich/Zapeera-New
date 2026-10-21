import { Router } from 'express';
import {
  createTransfer,
  getTransfers,
  getTransferById,
  completeTransfer,
  cancelTransfer
} from '../controllers/transfer.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication. Transfers live under the inventory
// module (Roadmap A9) — no separate module key is introduced.
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('inventory'));

// Inter-branch transfer routes (module check only)
router.post('/', createTransfer);
router.get('/', getTransfers);
router.get('/:id', getTransferById);
router.post('/:id/complete', completeTransfer);
router.post('/:id/cancel', cancelTransfer);

export default router;
