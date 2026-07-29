import { Router } from 'express';
import { 
  getDashboardStats, 
  getSalesChart, 
  getAdminDashboardStats, 
  getTopSellingProducts, 
  getSalesByPaymentMethod 
} from '../controllers/dashboard.controller';
import { authenticate } from '../middleware/auth.middleware';
import { resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';
import { requireBusinessDashboardAccess } from '../middleware/business-dashboard-access.middleware';

const router = Router();

// All routes require authentication and business membership resolution
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(requireBusinessDashboardAccess);

router.get('/stats', getDashboardStats);
router.get('/chart', getSalesChart);
router.get('/admin-stats', getAdminDashboardStats);
router.get('/top-products', getTopSellingProducts);
router.get('/sales-by-payment', getSalesByPaymentMethod);

export default router;
