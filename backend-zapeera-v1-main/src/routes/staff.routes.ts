import express from 'express';
import {
  getStaff,
  getStaffMember,
  getMyStaffProfile,
  setStaffPin,
  changeMyPin,
  createStaff,
  updateStaff,
  deleteStaff,
  getStaffStats,
  searchUser
} from '../controllers/staff.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership, checkPermission } from '../middleware/multitenancy.middleware';
import { requireStaffAllowed, enforceStaffCreation } from '../middleware/subscription.middleware';

const router = express.Router();

// All staff routes require authentication and membership
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));

// GET /api/staff/me — the caller's OWN staff profile (B1 follow-up).
// Registered BEFORE checkModule/requireStaffAllowed: a cashier has no
// business_management.staff.read grant, and this endpoint is own-only
// by construction (it reads the caller's own membership), so no module
// or permission gate applies. Must stay above '/:id' so 'me' is not
// captured as an id.
router.get('/me', getMyStaffProfile);
// v1.0.19: own-PIN change — own-only by construction, like GET /me, so it
// also sits above the module/permission gates.
router.post('/me/pin', changeMyPin);

router.use(checkModule('business_management'));
router.use(requireStaffAllowed());

// Staff CRUD operations (permission guarded)
router.get('/', checkPermission('read_staff'), getStaff);
router.get('/stats', checkPermission('read_staff'), getStaffStats);
router.post('/search-user', checkPermission('create_staff'), searchUser);
router.get('/:id', checkPermission('read_staff'), getStaffMember);
router.post('/', checkPermission('create_staff'), enforceStaffCreation(), createStaff);
router.put('/:id', checkPermission('update_staff'), updateStaff);
// v1.0.19: owner/manager sets or resets a staff member's counter PIN.
router.put('/:id/pin', checkPermission('update_staff'), setStaffPin);
router.delete('/:id', checkPermission('delete_staff'), deleteStaff);

export default router;
