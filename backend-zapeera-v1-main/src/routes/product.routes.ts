import { Router } from 'express';
import {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  bulkImportProducts,
  activateAllProducts,
  getAllProducts,
  bulkDeleteProducts,
  getStockMovements
} from '../controllers/product.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership, checkPermission } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('inventory'));

// Get products (permission guarded)
router.get('/', checkPermission('read_product'), getProducts);
router.get('/all', checkPermission('read_product'), getAllProducts); // Get all products including inactive ones
router.get('/stock-movements', checkPermission('read_product'), getStockMovements); // Get stock movements with date filtering
router.get('/:id', checkPermission('read_product'), getProduct);

// Product management (permission guarded)
router.post('/', checkPermission('create_product'), createProduct);
router.post('/bulk-import', checkPermission('bulk_import_products'), bulkImportProducts);
router.post('/bulk-delete', checkPermission('bulk_delete_products'), bulkDeleteProducts);
router.put('/:id', checkPermission('update_product'), updateProduct);
router.delete('/:id', checkPermission('delete_product'), deleteProduct);

// Activate all products (permission guarded)
router.post('/activate-all', checkPermission('activate_all_products'), activateAllProducts);

export default router;
