import { Router } from 'express';
import { recordWastage, getWastageRecords, getWastageReport } from '../controllers/wastage.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, checkPermission, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// Wastage / damage recording (v1.0.22) — inventory module: recording
// a write-off rewrites batch quantities, so it needs update_product;
// reads need read_product. The static /report path sits BEFORE any
// /:id route (there is none today, but the order is load-bearing if
// one is ever added).
//
// MOUNT (server.ts, both prefixes):
//   import wastageRoutes from './routes/wastage.routes';
//   app.use('/api/v1/wastage', wastageRoutes);
//   app.use('/api/wastage', wastageRoutes);
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('inventory'));

router.post('/', checkPermission('update_product'), recordWastage);
router.get('/report', checkPermission('read_product'), getWastageReport);
router.get('/', checkPermission('read_product'), getWastageRecords);

export default router;
