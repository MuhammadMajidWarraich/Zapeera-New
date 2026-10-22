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
  getStockMovements,
  getMedicineMasterCatalog,
  importMedicineMaster
} from '../controllers/product.controller';
import {
  getProductVariants,
  createProductVariant,
  generateProductVariants,
  updateProductVariant,
  deactivateProductVariant
} from '../controllers/product-variant.controller';
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
// Medicine master catalog (Wave C3) — before /:id so the literal wins
router.get('/master-catalog', checkPermission('read_product'), getMedicineMasterCatalog);
router.get('/:id', checkPermission('read_product'), getProduct);

// Product management (permission guarded)
router.post('/', checkPermission('create_product'), createProduct);
router.post('/import-master', checkPermission('create_product'), importMedicineMaster); // Wave C3
router.post('/bulk-import', checkPermission('bulk_import_products'), bulkImportProducts);
router.post('/bulk-delete', checkPermission('bulk_delete_products'), bulkDeleteProducts);
router.put('/:id', checkPermission('update_product'), updateProduct);
router.delete('/:id', checkPermission('delete_product'), deleteProduct);

// Activate all products (permission guarded)
router.post('/activate-all', checkPermission('activate_all_products'), activateAllProducts);

// Product variants (Wave C6 — Retail pack): the size x colour matrix
// as child resources of the product. DELETE is a soft deactivate.
// Two-segment paths, so they cannot collide with the /:id routes
// above. Permissions mirror the product operations they extend.
router.get('/:id/variants', checkPermission('read_product'), getProductVariants);
router.post('/:id/variants', checkPermission('create_product'), createProductVariant);
router.post('/:id/variants/generate', checkPermission('create_product'), generateProductVariants);
router.put('/:id/variants/:variantId', checkPermission('update_product'), updateProductVariant);
router.delete('/:id/variants/:variantId', checkPermission('delete_product'), deactivateProductVariant);

export default router;
