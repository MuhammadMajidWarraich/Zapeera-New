import { Router } from 'express';
import {
  getDashboardStats,
  getSalesChart,
  getAdminDashboardStats,
  getTopSellingProducts,
  getSalesByPaymentMethod
} from '../controllers/dashboard.controller';
import {
  getHotelDashboard,
  getClinicDashboard,
  getPharmacyDashboard,
  getRetailDashboard
} from '../controllers/dashboard-type.controller';
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
// Type-specific workspace dashboards (additive; /stats shape untouched)
router.get('/hotel', getHotelDashboard);
router.get('/clinic', getClinicDashboard);
router.get('/pharmacy', getPharmacyDashboard);
router.get('/retail', getRetailDashboard);
router.get('/chart', getSalesChart);
router.get('/admin-stats', getAdminDashboardStats);
router.get('/top-products', getTopSellingProducts);
router.get('/sales-by-payment', getSalesByPaymentMethod);

export default router;
