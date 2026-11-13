import { Router } from 'express';
import {
  createQuotation,
  getQuotations,
  getQuotation,
  updateQuotation,
  deleteQuotation,
  markQuotationSent,
  acceptQuotation,
  rejectQuotation,
  convertQuotation,
} from '../controllers/quotation.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, checkPermission, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// Quotations/estimates (v1.0.22) — the sales module's permission set:
// a quotation is a pre-sale document, so it rides the sale
// permissions (read_sale / create_sale / update_sale / delete_sale).
// No plan/add-on gate.
//
// MOUNT (server.ts, both prefixes):
//   import quotationRoutes from './routes/quotation.routes';
//   app.use('/api/v1/quotations', quotationRoutes);
//   app.use('/api/quotations', quotationRoutes);
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('sales'));

router.post('/', checkPermission('create_sale'), createQuotation);
router.get('/', checkPermission('read_sale'), getQuotations);
router.get('/:id', checkPermission('read_sale'), getQuotation);
router.put('/:id', checkPermission('update_sale'), updateQuotation);
router.delete('/:id', checkPermission('delete_sale'), deleteQuotation);
router.post('/:id/mark-sent', checkPermission('update_sale'), markQuotationSent);
router.post('/:id/accept', checkPermission('update_sale'), acceptQuotation);
router.post('/:id/reject', checkPermission('update_sale'), rejectQuotation);
router.post('/:id/convert', checkPermission('create_sale'), convertQuotation);

export default router;
