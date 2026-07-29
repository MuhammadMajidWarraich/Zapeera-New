import { Router } from 'express';
import {
  cloudSyncAccount,
  cloudProvisionBusiness,
  cloudPushOperations,
  cloudPullChanges
} from '../controllers/sync-cloud-api.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticate);

router.post('/account', cloudSyncAccount);
router.post('/business/provision', cloudProvisionBusiness);
router.post('/operations/push', cloudPushOperations);
router.get('/changes', cloudPullChanges);

export default router;
