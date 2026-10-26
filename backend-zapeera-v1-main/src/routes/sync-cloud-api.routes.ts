import { Router } from 'express';
import {
  cloudSyncAccount,
  cloudProvisionBusiness,
  cloudPushOperations,
  cloudPullChanges,
  cloudPrecheckSale,
  cloudSyncReviewSummary,
  cloudSyncReviewList,
  cloudSyncReviewResolve,
  cloudRunReconciliation,
  cloudListReconciliations,
  cloudCreateStockTakesFromReconciliation,
  cloudResolveReconciliation
} from '../controllers/sync-cloud-api.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.use(authenticate);

router.post('/account', cloudSyncAccount);
router.post('/business/provision', cloudProvisionBusiness);
router.post('/operations/push', cloudPushOperations);
router.get('/changes', cloudPullChanges);

// R2: cloud-authoritative pre-check before an online desktop sale.
router.post('/sales/precheck', cloudPrecheckSale);

// R3: offline-sales review list (oversold / offline / never-replayed).
router.get('/review/summary', cloudSyncReviewSummary);
router.get('/review', cloudSyncReviewList);
router.post('/review/:saleId/resolve', cloudSyncReviewResolve);

// R7: nightly stock reconciliation runs.
router.post('/reconciliations/run', cloudRunReconciliation);
router.get('/reconciliations', cloudListReconciliations);
router.post('/reconciliations/:id/create-stock-take', cloudCreateStockTakesFromReconciliation);
router.post('/reconciliations/:id/resolve', cloudResolveReconciliation);

export default router;
