import { Router } from 'express';
import {
  createAppointment,
  getAppointments,
  getAppointmentById,
  updateAppointmentStatus,
  completeVisit
} from '../controllers/appointment.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication. Appointments are their OWN
// module (appointments.appointments in the route-policy registry),
// following the Wave C1 prescriptions precedent. complete-visit
// internally runs the sale engine, which re-validates the sale under
// its own module gates — a caller needs appointments access to reach
// it and sales access for the billing to succeed.
//
// MOUNT (server.ts, both prefixes):
//   import appointmentRoutes from './routes/appointment.routes';
//   app.use('/api/v1/appointments', appointmentRoutes);
//   app.use('/api/appointments', appointmentRoutes);
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('appointments'));

router.post('/', createAppointment);
router.get('/', getAppointments);
router.get('/:id', getAppointmentById);
router.patch('/:id/status', updateAppointmentStatus);
router.post('/:id/complete-visit', completeVisit);

export default router;
