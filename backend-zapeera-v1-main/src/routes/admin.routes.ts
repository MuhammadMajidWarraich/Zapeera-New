import { Router } from 'express';
import {
  getAdmins,
  getAdmin,
  createAdmin,
  updateAdmin,
  deleteAdmin,
  getAdminUsers,
  getSuperAdminStats,
  getRecentActivities,
  getBillingSummary,
  migrateLegacyUserContextHandler,
  getPlans,
  createPlan,
  updatePlan,
  deactivatePlan,
  getSubscriptions,
  assignSubscription,
  cancelSubscription
} from '../controllers/admin.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);

router.get('/', getAdmins);
router.get('/stats', getSuperAdminStats);
router.get('/activities', getRecentActivities);

// Plan Management
router.get('/plans', getPlans);
router.post('/plans', createPlan);
router.put('/plans/:id', updatePlan);
router.delete('/plans/:id', deactivatePlan);

// Subscription Management
router.get('/subscriptions', getSubscriptions);
router.post('/subscriptions/assign', assignSubscription);
router.post('/subscriptions/cancel/:id', cancelSubscription);

router.get('/billing-summary', getBillingSummary);
router.get('/:createdBy/users', getAdminUsers);
router.post('/', createAdmin);
router.get('/:id', getAdmin);
router.put('/:id', updateAdmin);
router.delete('/:id', deleteAdmin);

// Multi-tenant migration endpoints
router.post('/migrations/user-context-to-memberships', migrateLegacyUserContextHandler);

export default router;
