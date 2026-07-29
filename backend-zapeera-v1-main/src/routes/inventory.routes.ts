import { Router } from 'express';
import {
  getInventorySummary,
  getInventoryByBatches,
  getInventoryReports
} from '../controllers/inventory.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership, checkPermission } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('inventory'));

// Inventory routes
router.get('/summary', checkPermission('inventory.read'), getInventorySummary);
router.get('/batches', checkPermission('inventory.read'), getInventoryByBatches);
router.get('/reports', checkPermission('inventory.read'), getInventoryReports);

export default router;
