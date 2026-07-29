import { Router } from 'express';
import {
  getShelves,
  getShelf,
  createShelf,
  updateShelf,
  deleteShelf
} from '../controllers/shelf.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership, checkPermission } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('inventory'));

// Get shelves (module check only)
router.get('/', getShelves);
router.get('/:id', getShelf);

// Shelf management (module check only)
router.post('/', createShelf);
router.put('/:id', updateShelf);
router.delete('/:id', deleteShelf);

export default router;
