import { Router } from 'express';
import {
  getSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSupplier
} from '../controllers/supplier.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership, checkPermission } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('inventory'));

// Get suppliers (module check only - no specific permission check needed)
router.get('/', getSuppliers);
router.get('/:id', getSupplier);

// Supplier management (module check only - no specific permission check needed)
router.post('/', createSupplier);
router.put('/:id', updateSupplier);
router.delete('/:id', deleteSupplier);

export default router;
