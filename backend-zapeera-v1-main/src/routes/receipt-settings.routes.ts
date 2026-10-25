import { Router } from 'express';
import {
  getReceiptSettingsHandler,
  updateReceiptSettingsHandler
} from '../controllers/receipt-settings.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication. Receipt settings live under the
// sales module (they shape the printed invoice) — no separate module
// key is introduced, and the route-policy registry maps
// /api/receipt-settings to the sales.invoices resource key (same
// precedent as promotions, tax classes and FBR). Writes are
// additionally gated to OWNER/MANAGER/ADMIN inside the controller;
// reads are open to every sales role (the POS needs the settings to
// print, cashiers included).
//
// MOUNT (server.ts, in both prefixes):
//   import receiptSettingsRoutes from './routes/receipt-settings.routes';
//   app.use('/api/v1/receipt-settings', receiptSettingsRoutes);
//   app.use('/api/receipt-settings', receiptSettingsRoutes);
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('sales'));

router.get('/', getReceiptSettingsHandler);
router.put('/', updateReceiptSettingsHandler);

export default router;
