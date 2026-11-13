import { Router } from 'express';
import {
  createReceiptTemplate,
  getReceiptTemplates,
  getEffectiveReceiptTemplate,
  updateReceiptTemplate,
  deleteReceiptTemplate,
} from '../controllers/receipt-template.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkPermission, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// Receipt templates (v1.0.22) — the settings pattern (no checkModule,
// settings permissions). The static /effective path sits BEFORE the
// /:id routes. The fixed ownership footer line is NOT part of any
// template payload — the renderer appends it unconditionally.
//
// MOUNT (server.ts, both prefixes):
//   import receiptTemplateRoutes from './routes/receipt-template.routes';
//   app.use('/api/v1/receipt-templates', receiptTemplateRoutes);
//   app.use('/api/receipt-templates', receiptTemplateRoutes);
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));

router.get('/effective', checkPermission('read_settings'), getEffectiveReceiptTemplate);
router.post('/', checkPermission('update_settings'), createReceiptTemplate);
router.get('/', checkPermission('read_settings'), getReceiptTemplates);
router.put('/:id', checkPermission('update_settings'), updateReceiptTemplate);
router.delete('/:id', checkPermission('update_settings'), deleteReceiptTemplate);

export default router;
