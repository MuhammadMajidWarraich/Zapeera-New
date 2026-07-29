import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import {
  getBillingProfiles,
  getBillingProfile,
  createBillingProfile,
  updateBillingProfile,
  deleteBillingProfile,
  setDefaultBillingProfile
} from '../controllers/billing-profile.controller';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Billing profile routes
router.get('/', getBillingProfiles);
router.get('/:id', getBillingProfile);
router.post('/', createBillingProfile);
router.put('/:id', updateBillingProfile);
router.delete('/:id', deleteBillingProfile);
router.put('/:id/default', setDefaultBillingProfile);

export default router;