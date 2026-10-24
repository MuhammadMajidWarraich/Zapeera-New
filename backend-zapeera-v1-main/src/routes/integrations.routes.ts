import { Router } from 'express';
import {
  connectIntegrationHandler,
  cancelShipmentHandler,
  disconnectIntegrationHandler,
  getIntegrationStatusHandler,
  getShipmentTrackingHandler,
  listIntegrationLogsHandler,
  listIntegrationsHandler,
  returnShipmentHandler,
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
router.get('/:provider/logs', listIntegrationLogsHandler);
// Shipment routes (feature/integration-postex): on-demand tracking /
// cancel / return for logistics providers that implement them.
router.get('/:provider/shipment/:trackingNumber', getShipmentTrackingHandler);
router.post('/:provider/shipment/:trackingNumber/cancel', cancelShipmentHandler);
router.post('/:provider/shipment/:trackingNumber/return', returnShipmentHandler);

export default router;
