import { Router } from 'express';
import {
  getBatches,
  getBatchById,
  createBatch,
  updateBatch,
  deleteBatch,
  getNearExpiryBatches,
  restockBatch,
  getLowStockBatches
} from '../controllers/batch.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership, checkPermission } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('inventory'));

// Batch routes (module check only)
router.get('/', getBatches);
router.get('/low-stock', getLowStockBatches);
router.get('/near-expiry', getNearExpiryBatches);
router.get('/:id', getBatchById);
router.post('/', createBatch);
router.put('/:id', updateBatch);
router.post('/:id/restock', restockBatch);
router.delete('/:id', deleteBatch);

export default router;
