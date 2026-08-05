import { Router } from 'express';
import {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  activateUser,
  updateBusinessAccess,
  getBusinessStaff,
  checkUserExists
} from '../controllers/user.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership, checkPermission } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get users (permission guarded)
router.get('/', checkPermission('read_user'), getUsers);
router.get('/:id', checkPermission('read_user'), getUser);

// User management (permission guarded)
router.get('/check-exists', checkPermission('create_user'), checkUserExists);
router.post('/', checkPermission('create_user'), createUser);
router.put('/:id', checkPermission('update_user'), updateUser);
// Hard delete is Super Admin only; business dashboards remove staff via DELETE /companies/:id/members/:userId
router.delete('/:id', checkPermission('delete_user'), deleteUser);

// User account activation (permission guarded)
router.patch('/:id/activate', checkPermission('activate_user'), activateUser);
router.patch('/:id/business-access', checkPermission('manage_business_access'), updateBusinessAccess);

// Get business staff using memberships (permission guarded + module)
router.get(
  '/:businessId/staff',
  resolveBusiness({ required: false }),
  resolveMembership(),
  resolveBranch({ required: false }),
  checkModule('business_management'),
  checkPermission('read_staff'),
  getBusinessStaff
);

export default router;
