import { Router } from 'express';
import {
  createPatient,
  getPatients,
  getPatientById,
  updatePatient,
  deactivatePatient
} from '../controllers/patient.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication. Patients are their OWN module
// (patients.patients in the route-policy registry), following the
// Wave C1 prescriptions precedent. DELETE is a soft deactivate and
// is additionally gated to OWNER/MANAGER inside the controller.
//
// MOUNT (server.ts, both prefixes):
//   import patientRoutes from './routes/patient.routes';
//   app.use('/api/v1/patients', patientRoutes);
//   app.use('/api/patients', patientRoutes);
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('patients'));

router.post('/', createPatient);
router.get('/', getPatients);
router.get('/:id', getPatientById);
router.put('/:id', updatePatient);
router.delete('/:id', deactivatePatient);

export default router;
