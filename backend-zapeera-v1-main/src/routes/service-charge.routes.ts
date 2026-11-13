import { Router } from 'express';
import {
  getServiceChargeConfigs,
  getEffectiveServiceChargeConfig,
  upsertServiceChargeConfig,
  deleteServiceChargeConfig,
} from '../controllers/service-charge.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkPermission, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// POS service-charge configuration (v1.0.22) — the settings pattern
// (no checkModule, settings permissions). POST upserts by scope (one
// row per business/branch). The static /effective path sits BEFORE
// the /:id route.
//
// MOUNT (server.ts, both prefixes):
//   import serviceChargeRoutes from './routes/service-charge.routes';
//   app.use('/api/v1/service-charges', serviceChargeRoutes);
//   app.use('/api/service-charges', serviceChargeRoutes);
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));

router.get('/effective', checkPermission('read_settings'), getEffectiveServiceChargeConfig);
router.post('/', checkPermission('update_settings'), upsertServiceChargeConfig);
router.get('/', checkPermission('read_settings'), getServiceChargeConfigs);
router.delete('/:id', checkPermission('update_settings'), deleteServiceChargeConfig);

export default router;
