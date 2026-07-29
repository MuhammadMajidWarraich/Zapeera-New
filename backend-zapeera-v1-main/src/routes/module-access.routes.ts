/**
 * Module Access Routes
 * API endpoints for module access management
 */

import { Router } from 'express';
import {
  getMyModuleAccess,
  checkModuleAccess,
  batchCheckModuleAccess,
  getAllModules,
  getModuleDetails,
} from '../controllers/module-access.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get current user's module access for selected business
router.get('/me', getMyModuleAccess);

// Get all modules in the system (for upgrade prompts/admin UI)
router.get('/all', getAllModules);

// Batch check multiple modules
router.post('/batch-check', batchCheckModuleAccess);

// Check single module access
router.get('/check/:moduleKey', checkModuleAccess);

// Get module details with access info
router.get('/details/:moduleKey', getModuleDetails);

export default router;
