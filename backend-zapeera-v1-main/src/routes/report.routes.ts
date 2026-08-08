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
  getAdvancedRefundsReport,
  getAdvancedExpiryReport,
  getAdvancedCategoryReport,
  getAdvancedBranchReport,
  getAdvancedTaxReport,
  getAdvancedPaymentTrendsReport,
  getAdvancedAttendanceReport,
  getAdvancedStockMovementsReport,
  getAdvancedExpenseReport,
  getAdvancedShiftReport,
  getAdvancedSupplierReport,
  getAdvancedRetentionReport,
  getAdvancedCommissionReport,
  getAdvancedProfitReport,
  getAdvancedCashflowReport,
  getAdvancedBatchReport,
  getAdvancedDiscountReport,
  getAdvancedProductReport,
  getAdvancedTurnoverReport,
  getAdvancedDailyReport,
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
router.get('/advanced/refunds', checkPermission('reports.read'), getAdvancedRefundsReport);
router.get('/advanced/expiry', checkPermission('reports.read'), getAdvancedExpiryReport);
router.get('/advanced/category', checkPermission('reports.read'), getAdvancedCategoryReport);
router.get('/advanced/branch', checkPermission('reports.read'), getAdvancedBranchReport);
router.get('/advanced/tax', checkPermission('reports.read'), getAdvancedTaxReport);
router.get('/advanced/payment-trends', checkPermission('reports.read'), getAdvancedPaymentTrendsReport);
router.get('/advanced/attendance', checkPermission('reports.read'), getAdvancedAttendanceReport);
router.get('/advanced/stock-movements', checkPermission('reports.read'), getAdvancedStockMovementsReport);
router.get('/advanced/expense', checkPermission('reports.read'), getAdvancedExpenseReport);
router.get('/advanced/shift', checkPermission('reports.read'), getAdvancedShiftReport);
router.get('/advanced/supplier', checkPermission('reports.read'), getAdvancedSupplierReport);
router.get('/advanced/retention', checkPermission('reports.read'), getAdvancedRetentionReport);
router.get('/advanced/commission', checkPermission('reports.read'), getAdvancedCommissionReport);
router.get('/advanced/profit', checkPermission('reports.read'), getAdvancedProfitReport);
router.get('/advanced/cashflow', checkPermission('reports.read'), getAdvancedCashflowReport);
router.get('/advanced/batch', checkPermission('reports.read'), getAdvancedBatchReport);
router.get('/advanced/discount', checkPermission('reports.read'), getAdvancedDiscountReport);
router.get('/advanced/product', checkPermission('reports.read'), getAdvancedProductReport);
router.get('/advanced/turnover', checkPermission('reports.read'), getAdvancedTurnoverReport);
router.get('/advanced/daily', checkPermission('reports.read'), getAdvancedDailyReport);

export default router;
