import { Router } from 'express';
import {
  createTaxClass,
  getTaxClasses,
  getTaxClassById,
  updateTaxClass,
  deleteTaxClass
} from '../controllers/tax-class.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication. Tax classes live under the sales
// module (they are invoice-money rules) — no separate module key is
// introduced, and the route-policy registry maps /api/tax-classes to
// the sales.invoices resource key. Management writes are additionally
// gated to OWNER/MANAGER inside the controller; every sales role can
// read the list (product forms and the POS need the class names).
//
// MOUNT (server.ts — applied with the Wave B5 deploy, alongside the
// other routers, in both prefixes):
//   import taxClassRoutes from './routes/tax-class.routes';
//   app.use('/api/v1/tax-classes', taxClassRoutes);
//   app.use('/api/tax-classes', taxClassRoutes);
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('sales'));

router.post('/', createTaxClass);
router.get('/', getTaxClasses);
router.get('/:id', getTaxClassById);
router.put('/:id', updateTaxClass);
router.delete('/:id', deleteTaxClass);

export default router;
