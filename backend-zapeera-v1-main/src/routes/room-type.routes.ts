import { Router } from 'express';
import {
  createRoomType,
  getRoomTypes,
  getRoomTypeById,
  updateRoomType,
  deactivateRoomType
} from '../controllers/room-type.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication. Room types ride the ROOMS
// module (rooms.rooms in the route-policy registry — a room type is
// configuration of the rooms register, not a register of its own),
// following the Wave C4 clinic-pack precedent. DELETE is a soft
// deactivate and is additionally gated to OWNER/MANAGER inside the
// controller.
//
// MOUNT (server.ts, both prefixes):
//   import roomTypeRoutes from './routes/room-type.routes';
//   app.use('/api/v1/room-types', roomTypeRoutes);
//   app.use('/api/room-types', roomTypeRoutes);
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('rooms'));

router.post('/', createRoomType);
router.get('/', getRoomTypes);
router.get('/:id', getRoomTypeById);
router.put('/:id', updateRoomType);
router.delete('/:id', deactivateRoomType);

export default router;
