import { Router } from 'express';
import {
  getCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerPurchaseHistory
} from '../controllers/customer.controller';
import { authenticate } from '../middleware/auth.middleware';
import { resolveBranch, resolveBusiness, resolveMembership, checkPermission } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
// NOTE: checkModule('customers') removed - customers are core infrastructure
// needed by ALL businesses regardless of module configuration.

// Get customers (permission guarded)
router.get('/', checkPermission('read_customer'), getCustomers);
router.get('/:id', checkPermission('read_customer'), getCustomer);
router.get('/:id/purchase-history', checkPermission('read_customer'), getCustomerPurchaseHistory);

// Customer management (permission guarded)
router.post('/', checkPermission('create_customer'), createCustomer);
router.put('/:id', checkPermission('update_customer'), updateCustomer);
router.delete('/:id', checkPermission('delete_customer'), deleteCustomer);

export default router;
