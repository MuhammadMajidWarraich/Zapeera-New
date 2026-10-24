import { Router } from 'express';
import {
  getStoreInfo,
  getStoreCatalog,
  getStoreProduct,
  uploadStorePrescription,
  getStorePrescriptionStatus,
  checkoutStoreOrder,
} from '../controllers/store.controller';

const router = Router();

// Public online pharmacy storefront (Wave C5 — gap item 5). NO
// authentication middleware on this router: customers have no
// account. The branch id in the path is the store key (a cuid);
// every handler re-resolves it, scopes all reads/writes to that one
// branch, and enforces the ONLINE_STORE_PACK add-on gate before
// doing anything else. CSRF-exempt by design (see
// csrf.middleware.ts CSRF_EXEMPT_PATHS — same class as the public
// partner application): there is no cookie session to forge.
//
// MOUNT (server.ts, both prefixes):
//   app.use('/api/v1/store', storeRoutes);
//   app.use('/api/store', storeRoutes);
//
//   GET    /:branchId                              store info
//   GET    /:branchId/products                     catalog (search/categoryId/inStock)
//   GET    /:branchId/products/:productId          product detail
//   POST   /:branchId/prescriptions               upload a prescription (review PENDING)
//   GET    /:branchId/prescriptions/:id?phone=     review status of an upload
//   POST   /:branchId/checkout                     COD order → real POS sale

router.get('/:branchId', getStoreInfo);
router.get('/:branchId/products', getStoreCatalog);
router.get('/:branchId/products/:productId', getStoreProduct);
router.post('/:branchId/prescriptions', uploadStorePrescription);
router.get('/:branchId/prescriptions/:id', getStorePrescriptionStatus);
router.post('/:branchId/checkout', checkoutStoreOrder);

export default router;
