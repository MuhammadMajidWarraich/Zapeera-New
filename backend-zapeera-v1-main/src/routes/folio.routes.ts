import { Router } from 'express';
import {
  getFolios,
  getFolioById,
  addFolioCharge,
  addFolioPayment,
  postNightCharge,
  postNightChargesBulk,
  checkOutFolio,
  getNightAudit
} from '../controllers/folio.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication. Folios are their OWN module
// (folios.folios in the route-policy registry), following the Wave
// C4 clinic-pack precedent. The literal segments /night-audit and
// /post-night-charges-bulk are registered before /:id so they win.
// Check-out internally runs the sale engine, which re-validates the
// sale under its own module gates — a caller needs folios access to
// reach it and sales access for the billing to succeed.
//
// MOUNT (server.ts, both prefixes):
//   import folioRoutes from './routes/folio.routes';
//   app.use('/api/v1/folios', folioRoutes);
//   app.use('/api/folios', folioRoutes);
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('folios'));

router.get('/night-audit', getNightAudit);
router.post('/post-night-charges-bulk', postNightChargesBulk);
router.get('/', getFolios);
router.get('/:id', getFolioById);
router.post('/:id/charges', addFolioCharge);
router.post('/:id/payments', addFolioPayment);
router.post('/:id/post-night-charge', postNightCharge);
router.post('/:id/check-out', checkOutFolio);

export default router;
