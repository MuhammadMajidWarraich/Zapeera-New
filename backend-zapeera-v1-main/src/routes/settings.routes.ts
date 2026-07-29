import { Router } from 'express';
import { getSettings, updateSettings, getTaxRate } from '../controllers/settings.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkPermission, resolveBusiness, resolveMembership, resolveBranch } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Get settings (permission guarded)
router.get('/', checkPermission('read_settings'), getSettings);

// Update settings (permission guarded)
router.put('/', checkPermission('update_settings'), updateSettings);

// Get tax rate (for sales calculation - require read_settings permission)
router.get('/tax-rate', resolveBusiness({ required: false }), resolveMembership(), resolveBranch({ required: false }), checkPermission('read_settings'), getTaxRate);

export default router;
