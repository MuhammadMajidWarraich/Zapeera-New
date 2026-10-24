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
import {
  getAccountingPnl,
  getPnlComparison,
  getReceivablesAgeing,
  getPayables,
  getCashbook
} from '../controllers/accounting-report.controller';
import {
  listBankAccounts,
  createBankAccount,
  updateBankAccount,
  listStatements,
  createStatement,
  getStatement,
  autoMatchStatement,
  matchStatementLine,
  unmatchStatementLine,
  ignoreStatementLine,
  listReconciliations,
  createReconciliation,
  completeReconciliation
} from '../controllers/bank-reconciliation.controller';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { requireBusinessDashboardAccess } from '../middleware/business-dashboard-access.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership, checkPermission } from '../middleware/multitenancy.middleware';
import { requireAdvancedReports, requireMultiBranchReports, requireFinanceAllowed } from '../middleware/subscription.middleware';

const router = Router();

// All routes require authentication
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('reports'));
// Add-on plan gates: /advanced/* needs advanced reports (Reports Pack or
// Growth+), /advanced/branch additionally needs multi-branch reporting
// (Reports Pack on Growth, inherent on Scale), /accounting/* is the
// finance toolkit (Finance Pack or Growth+).
router.use('/advanced/branch', requireMultiBranchReports());
router.use('/advanced', requireAdvancedReports());
router.use('/accounting', requireFinanceAllowed());

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

// Accounting-lite (Wave B8): read-only P&L / ageing / payables / cashbook
router.get('/accounting/pnl', checkPermission('reports.read'), getAccountingPnl);
router.get('/accounting/pnl/compare', checkPermission('reports.read'), getPnlComparison);
router.get('/accounting/receivables-ageing', checkPermission('reports.read'), getReceivablesAgeing);
router.get('/accounting/payables', checkPermission('reports.read'), getPayables);
router.get('/accounting/cashbook', checkPermission('reports.read'), getCashbook);

// Bank reconciliation (Wave B — Item 8): accounts, statements, matching,
// per-period reconciliation state. Same Finance Pack / Growth+ gate as
// the rest of /accounting/* above.
router.get('/accounting/bank-accounts', checkPermission('reports.read'), listBankAccounts);
router.post('/accounting/bank-accounts', checkPermission('reports.read'), createBankAccount);
router.patch('/accounting/bank-accounts/:id', checkPermission('reports.read'), updateBankAccount);
router.get('/accounting/statements', checkPermission('reports.read'), listStatements);
router.post('/accounting/statements', checkPermission('reports.read'), createStatement);
router.get('/accounting/statements/:id', checkPermission('reports.read'), getStatement);
router.post('/accounting/statements/:id/auto-match', checkPermission('reports.read'), autoMatchStatement);
router.post('/accounting/statements/:id/lines/:lineId/match', checkPermission('reports.read'), matchStatementLine);
router.post('/accounting/statements/:id/lines/:lineId/unmatch', checkPermission('reports.read'), unmatchStatementLine);
router.post('/accounting/statements/:id/lines/:lineId/ignore', checkPermission('reports.read'), ignoreStatementLine);
router.get('/accounting/reconciliations', checkPermission('reports.read'), listReconciliations);
router.post('/accounting/reconciliations', checkPermission('reports.read'), createReconciliation);
router.post('/accounting/reconciliations/:id/complete', checkPermission('reports.read'), completeReconciliation);

export default router;
