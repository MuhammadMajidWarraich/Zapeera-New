import { Router } from 'express';
import {
  getSalesReport,
  getInventoryReport,
  getCustomerReport,
  getProductPerformanceReport,
  getTopSellingProducts,
  getSalesByPaymentMethod,
  getDashboardData
} from '../controllers/report.controller';
import {
  getAdvancedSalesReport,
  getAdvancedInventoryReport,
  getAdvancedCustomerReport,
  getAdvancedStaffReport,
  getAdvancedFinancialReport,
  getAdvancedPurchaseReport,
} from '../controllers/advanced-report.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { requireBusinessDashboardAccess } from '../middleware/business-dashboard-access.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership, checkPermission } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('reports'));

// Reports (membership-permission guarded)
router.get('/sales', checkPermission('reports.read'), getSalesReport);
router.get('/inventory', checkPermission('reports.read'), getInventoryReport);
router.get('/customers', checkPermission('reports.read'), getCustomerReport);
router.get('/products', checkPermission('reports.read'), getProductPerformanceReport);
router.get('/top-products', checkPermission('reports.read'), getTopSellingProducts);
router.get('/payment-methods', checkPermission('reports.read'), getSalesByPaymentMethod);
router.get(
  '/dashboard',
  checkPermission('dashboard.read'),
  requireBusinessDashboardAccess,
  getDashboardData
);

// Advanced Reports
router.get('/advanced/sales', checkPermission('reports.read'), getAdvancedSalesReport);
router.get('/advanced/inventory', checkPermission('reports.read'), getAdvancedInventoryReport);
router.get('/advanced/customers', checkPermission('reports.read'), getAdvancedCustomerReport);
router.get('/advanced/staff', checkPermission('reports.read'), getAdvancedStaffReport);
router.get('/advanced/financial', checkPermission('reports.read'), getAdvancedFinancialReport);
router.get('/advanced/purchases', checkPermission('reports.read'), getAdvancedPurchaseReport);

export default router;
