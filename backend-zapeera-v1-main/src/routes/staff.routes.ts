import express from 'express';
import {
  getStaff,
  getStaffMember,
  createStaff,
  updateStaff,
  deleteStaff,
  getStaffStats
} from '../controllers/staff.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership, checkPermission } from '../middleware/multitenancy.middleware';

const router = express.Router();

// All staff routes require authentication and membership
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('business_management'));

// Staff CRUD operations (permission guarded)
router.get('/', checkPermission('read_staff'), getStaff);
router.get('/stats', checkPermission('read_staff'), getStaffStats);
router.get('/:id', checkPermission('read_staff'), getStaffMember);
router.post('/', checkPermission('create_staff'), createStaff);
router.put('/:id', checkPermission('update_staff'), updateStaff);
router.delete('/:id', checkPermission('delete_staff'), deleteStaff);

export default router;
