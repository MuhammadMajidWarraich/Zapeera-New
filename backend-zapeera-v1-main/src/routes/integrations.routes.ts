import { Router } from 'express';
import {
  connectIntegrationHandler,
  disconnectIntegrationHandler,
  getIntegrationStatusHandler,
  inquireIntegrationPaymentHandler,
  listIntegrationLogsHandler,
  listIntegrationsHandler,
  refundIntegrationPaymentHandler,
  triggerIntegrationSyncHandler
} from '../controllers/integrations.controller';
import { authenticate } from '../middleware/auth.middleware';
import { resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';
import { requireRole } from '../middleware/role.middleware';

const router = Router();

// Integrations framework (feature/integration-framework).
// Business-scoped, OWNER/MANAGER only on EVERY route (the router gate;
// the service never trusts the caller beyond this). Credentials are
// write-only: POST /:provider/connect accepts them, no GET ever returns
// them, and they are never logged.
//
// MOUNT (server.ts, both prefixes):
//   app.use('/api/v1/integrations', integrationsRoutes);
//   app.use('/api/integrations', integrationsRoutes);
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(requireRole('OWNER', 'MANAGER'));

router.get('/', listIntegrationsHandler);
router.post('/:provider/connect', connectIntegrationHandler);
router.post('/:provider/disconnect', disconnectIntegrationHandler);
router.get('/:provider/status', getIntegrationStatusHandler);
router.post('/:provider/sync', triggerIntegrationSyncHandler);
// Payment rails (JazzCash): inquiry + refund are not sync runs, so
// they have their own routes. Payments go through POST /:provider/sync
// with { entity: 'payment', payment: {...} }.
router.post('/:provider/inquire', inquireIntegrationPaymentHandler);
router.post('/:provider/refund', refundIntegrationPaymentHandler);
router.get('/:provider/logs', listIntegrationLogsHandler);

export default router;
