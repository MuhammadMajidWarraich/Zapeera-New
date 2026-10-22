import { Router } from 'express';
import {
  createDoctor,
  getDoctors,
  getDoctorById,
  updateDoctor,
  deactivateDoctor,
  getDoctorSettlementReport,
  createDoctorSettlement,
  getDoctorSettlements
} from '../controllers/doctor.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication. Doctors are their OWN module
// (doctors.doctors in the route-policy registry), following the
// Wave C1 prescriptions precedent. The settlement endpoints live
// under this router and are registered BEFORE '/:id' so 'settlements'
// and 'settlement-report' are never read as a doctor id. Recording a
// payout and deactivating a doctor are additionally gated to
// OWNER/MANAGER inside the controller.
//
// MOUNT (server.ts, both prefixes):
//   import doctorRoutes from './routes/doctor.routes';
//   app.use('/api/v1/doctors', doctorRoutes);
//   app.use('/api/doctors', doctorRoutes);
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('doctors'));

router.get('/settlement-report', getDoctorSettlementReport);
router.post('/settlements', createDoctorSettlement);
router.get('/settlements', getDoctorSettlements);
router.post('/', createDoctor);
router.get('/', getDoctors);
router.get('/:id', getDoctorById);
router.put('/:id', updateDoctor);
router.delete('/:id', deactivateDoctor);

export default router;
