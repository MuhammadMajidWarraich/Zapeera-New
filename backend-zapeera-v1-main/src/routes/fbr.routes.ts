import { Router } from 'express';
import {
  getFbrConfigHandler,
  updateFbrConfigHandler,
  testFbrConnectionHandler,
  getFbrStatusHandler,
  retryFbrHandler
} from '../controllers/fbr.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication. FBR POS lives under the sales
// module (it fiscalizes invoices) — no separate module key is
// introduced, and the route-policy registry maps /api/fbr to the
// sales.invoices resource key (same precedent as promotions and tax
// classes). Config writes, the connection test and manual retries
// are additionally gated to OWNER/MANAGER inside the controller.
//
// MOUNT (server.ts — applied with the Wave B7 deploy, alongside the
// other routers, in both prefixes):
//   import fbrRoutes from './routes/fbr.routes';
//   app.use('/api/v1/fbr', fbrRoutes);
//   app.use('/api/fbr', fbrRoutes);
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('sales'));

router.get('/config', getFbrConfigHandler);
router.put('/config', updateFbrConfigHandler);
router.post('/config/test-connection', testFbrConnectionHandler);
router.get('/status', getFbrStatusHandler);
router.post('/retry/:saleId', retryFbrHandler);

export default router;
