import { Router } from 'express';
import {
  createProvincialTaxConfig,
  getProvincialTaxConfigs,
  getProvincialTaxConfigById,
  updateProvincialTaxConfig,
  deleteProvincialTaxConfig,
  getProvincialTaxSummary,
  suggestProvincialAuthority
} from '../controllers/provincial-tax.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication. Provincial tax (PRA / SRB / KPRA /
// BRA) lives under the sales module — it is an invoice-money rule, so
// it shares the sales.invoices resource key (same precedent as tax
// classes and FBR); no new module/submodule key is introduced. Config
// writes are additionally gated to OWNER inside the controller (the
// task's rule for tax settings); reads are OWNER/MANAGER/ADMIN.
//
// MOUNT (server.ts — applied alongside the other routers, in both
// prefixes):
//   import provincialTaxRoutes from './routes/provincial-tax.routes';
//   app.use('/api/v1/provincial-tax', provincialTaxRoutes);
//   app.use('/api/provincial-tax', provincialTaxRoutes);
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('sales'));

// Static paths BEFORE /:id so they are not captured as an id.
router.get('/summary', getProvincialTaxSummary);
router.get('/suggest-authority', suggestProvincialAuthority);

router.post('/', createProvincialTaxConfig);
router.get('/', getProvincialTaxConfigs);
router.get('/:id', getProvincialTaxConfigById);
router.put('/:id', updateProvincialTaxConfig);
router.delete('/:id', deleteProvincialTaxConfig);

export default router;
