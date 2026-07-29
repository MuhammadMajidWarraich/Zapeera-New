import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { requireRole } from '../middleware/role.middleware';
import {
  getRoles,
  getRolePermissions,
  getUserPermissions,
  checkPermission,
  getAllowedActions,
  updateUserRole
} from '../controllers/role.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get all available roles (Admin only)
router.get('/', getRoles);

// Get permissions for a specific role
router.get('/roles/:role/permissions', getRolePermissions);

// Get current user's permissions
router.get('/permissions', getUserPermissions);

// Check if user has specific permission
router.get('/check-permission', checkPermission);

// Get allowed actions for a resource
router.get('/resources/:resource/actions', getAllowedActions);

// Update user role
router.put('/users/:userId/role', updateUserRole);

export default router;
