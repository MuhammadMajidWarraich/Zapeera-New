import { Router } from 'express';
import {
  createReservation,
  getAvailability,
  getReservations,
  getReservationById,
  updateReservation,
  updateReservationStatus,
  checkInReservation
} from '../controllers/reservation.controller';
import {
  handleReservationDocumentUpload,
  uploadReservationDocument,
  serveReservationDocument
} from '../controllers/reservation-document.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication. Reservations are their OWN
// module (reservations.reservations in the route-policy registry),
// following the Wave C4 clinic-pack precedent. /availability is
// registered before /:id so the literal segment wins. Check-in is a
// flow endpoint (it opens the folio), not a status change.
//
// MOUNT (server.ts, both prefixes):
//   import reservationRoutes from './routes/reservation.routes';
//   app.use('/api/v1/reservations', reservationRoutes);
//   app.use('/api/reservations', reservationRoutes);
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('reservations'));

router.post('/', createReservation);
// Guest documents (CNIC scan + person photos): upload first, then the
// returned ref is attached by create/update. Serving is scoped to the
// owning reservation + business — there is no static path to a file.
router.post('/documents/upload', handleReservationDocumentUpload, uploadReservationDocument);
router.get('/availability', getAvailability);
router.get('/', getReservations);
router.get('/:id', getReservationById);
router.get('/:id/documents/:filename', serveReservationDocument);
router.put('/:id', updateReservation);
router.patch('/:id/status', updateReservationStatus);
router.post('/:id/check-in', checkInReservation);

export default router;
