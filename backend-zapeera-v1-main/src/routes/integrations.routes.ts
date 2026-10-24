import { Router } from 'express';
import {
  connectIntegrationHandler,
  disconnectIntegrationHandler,
  getIntegrationStatusHandler,
  listIntegrationLogsHandler,
  listIntegrationsHandler,
  triggerIntegrationSyncHandler
} from '../controllers/integrations.controller';
import { authenticate } from '../middleware/auth.middleware';
import { resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';
import { requireRole } from '../middleware/role.middleware';
import { startGoogleSheetsOAuthHandler } from '../integrations/google-sheets/oauth-routes';

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
// Google Sheets OAuth start (authenticated, OWNER/MANAGER — the router
// gate above). The callback lives in server.ts, before the universal
// module protection middleware: Google redirects the browser there with
// no Zapeera session, so it cannot go through this router's auth.
router.get('/google-sheets/oauth/start', startGoogleSheetsOAuthHandler);
router.post('/:provider/connect', connectIntegrationHandler);
router.post('/:provider/disconnect', disconnectIntegrationHandler);
router.get('/:provider/status', getIntegrationStatusHandler);
router.post('/:provider/sync', triggerIntegrationSyncHandler);
router.get('/:provider/logs', listIntegrationLogsHandler);

export default router;
