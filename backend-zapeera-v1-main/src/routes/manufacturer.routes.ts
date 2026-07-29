import { Router } from 'express';
import {
  getManufacturers,
  getManufacturer,
  createManufacturer,
  updateManufacturer,
  deleteManufacturer
} from '../controllers/manufacturer.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBusiness, resolveMembership, checkPermission } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(checkModule('inventory'));

// Get manufacturers (module check only)
router.get('/', getManufacturers);
router.get('/:id', getManufacturer);

// Manufacturer management (module check only)
router.post('/', createManufacturer);
router.put('/:id', updateManufacturer);
router.delete('/:id', deleteManufacturer);

export default router;
