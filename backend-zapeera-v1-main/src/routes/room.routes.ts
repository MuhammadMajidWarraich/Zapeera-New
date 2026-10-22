import { Router } from 'express';
import {
  createRoom,
  getRooms,
  getRoomById,
  updateRoom,
  updateRoomStatus,
  deactivateRoom
} from '../controllers/room.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication. Rooms are their OWN module
// (rooms.rooms in the route-policy registry), following the Wave C4
// clinic-pack precedent. PATCH /:id/status is the housekeeping
// board move — it can never set or clear OCCUPIED (check-in/out own
// that). DELETE is a soft deactivate, OWNER/MANAGER inside the
// controller.
//
// MOUNT (server.ts, both prefixes):
//   import roomRoutes from './routes/room.routes';
//   app.use('/api/v1/rooms', roomRoutes);
//   app.use('/api/rooms', roomRoutes);
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('rooms'));

router.post('/', createRoom);
router.get('/', getRooms);
router.get('/:id', getRoomById);
router.put('/:id', updateRoom);
router.patch('/:id/status', updateRoomStatus);
router.delete('/:id', deactivateRoom);

export default router;
