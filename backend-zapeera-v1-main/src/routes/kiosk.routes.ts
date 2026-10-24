import { Router } from 'express';
import {
  getKioskInfo,
  getKioskCatalog,
  checkoutKioskOrder,
} from '../controllers/kiosk.controller';

const router = Router();

// Public self-ordering kiosk (Wave C9 — gap item 9, retail only). NO
// authentication middleware on this router: the in-store tablet has
// no staff login. The branch id in the path is the kiosk key (a
// cuid); every handler re-resolves it, scopes all reads/writes to
// that one branch, and enforces the GIFT_CARD_KIOSK_PACK add-on gate
// before doing anything else. CSRF-exempt by design (see
// csrf.middleware.ts CSRF_EXEMPT_PATHS — same class as the public
// storefront): there is no cookie session to forge.
//
// MOUNT (server.ts, both prefixes):
//   app.use('/api/v1/kiosk', kioskRoutes);
//   app.use('/api/kiosk', kioskRoutes);
//
//   GET    /:branchId              kiosk/branch info
//   GET    /:branchId/products     orderable catalog (no Rx items)
//   POST   /:branchId/checkout     order → real POS sale (KIOSK, PENDING, pay at counter)
router.get('/:branchId', getKioskInfo);
router.get('/:branchId/products', getKioskCatalog);
router.post('/:branchId/checkout', checkoutKioskOrder);

export default router;
