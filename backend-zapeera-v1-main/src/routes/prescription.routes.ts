import { Router } from 'express';
import {
  createPrescription,
  getPrescriptions,
  getPrescriptionById,
  updatePrescription,
  voidPrescription,
  reviewPrescription
} from '../controllers/prescription.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication. Prescriptions are their OWN
// module — the key has existed in the module hierarchy (backend +
// frontend), MODULE_PAGES and permissions since long before this
// router did; the route-policy registry maps /api/prescriptions to
// the prescriptions.prescriptions resource key. DELETE is a VOID
// (legal record — no hard delete) and is additionally gated to
// OWNER/MANAGER inside the controller.
//
// MOUNT (server.ts — applied with the Wave C1 deploy, alongside the
// other routers, in both prefixes):
//   import prescriptionRoutes from './routes/prescription.routes';
//   app.use('/api/v1/prescriptions', prescriptionRoutes);
//   app.use('/api/prescriptions', prescriptionRoutes);
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('prescriptions'));

router.post('/', createPrescription);
router.get('/', getPrescriptions);
router.get('/:id', getPrescriptionById);
router.put('/:id', updatePrescription);
// Pharmacist review (Wave C5 — gap item 5): approve/reject a
// customer upload (transcribing its items); unblocks dispensing.
router.patch('/:id/review', reviewPrescription);
router.delete('/:id', voidPrescription);

export default router;
