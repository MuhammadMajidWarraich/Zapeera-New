import { Router } from 'express';
import {
  getBranches,
  getBranch,
  createBranch,
  updateBranch,
  deleteBranch
} from '../controllers/branch.controller';
import { authenticate } from '../middleware/auth.middleware';
import { resolveBusiness, resolveMembership, checkModule, checkPermission, resolveBranch } from '../middleware/multitenancy.middleware';
import { enforceBranchLimit, checkSubscription } from '../middleware/subscription.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
// NOTE: checkModule('business_management') intentionally not applied here.
// Branches are core infrastructure needed by ALL businesses (for the business
// switcher, branch dropdown, etc.) regardless of whether the 'business_management' module is enabled.

// Get branches - no permission check needed; all authenticated members can list branches
// (the business switcher and branch dropdown depend on this)
router.get('/', getBranches);
router.get('/:id', getBranch);

// Branch management (permission guarded)
router.post('/', checkPermission('create_branch'), checkSubscription(), enforceBranchLimit(), createBranch);
router.put('/:id', checkPermission('update_branch'), updateBranch);
router.delete('/:id', checkPermission('delete_branch'), deleteBranch);

export default router;
