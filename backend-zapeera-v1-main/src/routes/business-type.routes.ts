import { Router } from 'express';
import {
  getBusinessTypes,
  getBusinessTypesWithCounts,
  getModules,
  createBusinessType,
  updateBusinessType,
  updateBusinessTypeModules,
  updateBusinessTypeModule,
  deleteBusinessType
} from '../controllers/business-type.controller';
import { authenticate } from '../middleware/auth.middleware';
import { adminAuthenticate, adminRoleGuard } from '../middleware/admin-auth.middleware';

const router = Router();

// Public authenticated routes for fetching business types
router.get('/', getBusinessTypesWithCounts);
router.get('/with-counts', getBusinessTypesWithCounts);

// Protected admin routes
router.post('/', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN'), createBusinessType);
router.get('/modules', adminAuthenticate, getModules);
router.patch('/:id', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN'), updateBusinessType);
router.put('/:id/modules', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN'), updateBusinessTypeModules);
router.patch('/:id/modules/:moduleId', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN'), updateBusinessTypeModule);
router.delete('/:id', adminAuthenticate, adminRoleGuard('SUPER_ADMIN'), deleteBusinessType);

export default router;
