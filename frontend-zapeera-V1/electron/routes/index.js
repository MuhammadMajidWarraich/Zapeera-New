/**
 * Routes Index
 * Register all API routes from domain-specific files
 */

const { registerActivationRoutes } = require('./activation.routes');
const { registerAdminRoutes } = require('./admin.routes');
const { registerAttendanceRoutes } = require('./attendance.routes');
const { registerAuthRoutes } = require('./auth.routes');
const { registerBatchesRoutes } = require('./batches.routes');
const { registerBranchesRoutes } = require('./branches.routes');
const { registerBusinessTypesRoutes } = require('./business-types.routes');
const { registerCategoriesRoutes } = require('./categories.routes');
const { registerCommissionsRoutes } = require('./commissions.routes');
const { registerCompaniesRoutes } = require('./companies.routes');
const { registerCustomersRoutes } = require('./customers.routes');
const { registerDashboardRoutes } = require('./dashboard.routes');
const { registerDebugRoutes } = require('./debug.routes');
const { registerEmployeesRoutes } = require('./employees.routes');
const { registerGiftcardsRoutes } = require('./gift-cards.routes');
const { registerInventoryRoutes } = require('./inventory.routes');
const { registerManufacturersRoutes } = require('./manufacturers.routes');
const { registerModulesRoutes } = require('./modules.routes');
const { registerOtherRoutes } = require('./other.routes');
const { registerProductsRoutes } = require('./products.routes');
const { registerPromotionsRoutes } = require('./promotions.routes');
const { registerPurchasesRoutes } = require('./purchases.routes');
const { registerReceiptsRoutes } = require('./receipts.routes');
const { registerRefundsRoutes } = require('./refunds.routes');
const { registerReportsRoutes } = require('./reports.routes');
const { registerSalesRoutes } = require('./sales.routes');
const { registerSettingsRoutes } = require('./settings.routes');
const { registerShelvesRoutes } = require('./shelves.routes');
const { registerShiftsRoutes } = require('./shifts.routes');
const { registerSseRoutes } = require('./sse.routes');
const { registerSuppliersRoutes } = require('./suppliers.routes');
const { registerSubscriptionRoutes } = require('./subscription.routes');
const { registerSyncRoutes } = require('./sync.routes');
const { registerSyncAccountRoutes } = require('./sync-account.routes');
const { registerSyncQueueRoutes } = require('./sync-queue.routes');
const { registerUsersRoutes } = require('./users.routes');

function registerAllRoutes(app, authMiddleware, deps) {
  console.log('[Routes] Registering routes from domain-specific files...');

  registerActivationRoutes(app, authMiddleware, deps);
  registerAdminRoutes(app, authMiddleware, deps);
  registerAttendanceRoutes(app, authMiddleware, deps);
  registerAuthRoutes(app, authMiddleware, deps);
  registerBatchesRoutes(app, authMiddleware, deps);
  registerBranchesRoutes(app, authMiddleware, deps);
  registerBusinessTypesRoutes(app, authMiddleware, deps);
  registerCategoriesRoutes(app, authMiddleware, deps);
  registerCommissionsRoutes(app, authMiddleware, deps);
  registerCompaniesRoutes(app, authMiddleware, deps);
  registerCustomersRoutes(app, authMiddleware, deps);
  registerDashboardRoutes(app, authMiddleware, deps);
  registerDebugRoutes(app, authMiddleware, deps);
  registerEmployeesRoutes(app, authMiddleware, deps);
  registerGiftcardsRoutes(app, authMiddleware, deps);
  registerInventoryRoutes(app, authMiddleware, deps);
  registerManufacturersRoutes(app, authMiddleware, deps);
  registerModulesRoutes(app, authMiddleware, deps);
  registerOtherRoutes(app, authMiddleware, deps);
  registerProductsRoutes(app, authMiddleware, deps);
  registerPromotionsRoutes(app, authMiddleware, deps);
  registerPurchasesRoutes(app, authMiddleware, deps);
  registerReceiptsRoutes(app, authMiddleware, deps);
  registerRefundsRoutes(app, authMiddleware, deps);
  registerReportsRoutes(app, authMiddleware, deps);
  registerSalesRoutes(app, authMiddleware, deps);
  registerSettingsRoutes(app, authMiddleware, deps);
  registerShelvesRoutes(app, authMiddleware, deps);
  registerShiftsRoutes(app, authMiddleware, deps);
  registerSseRoutes(app, authMiddleware, deps);
  registerSuppliersRoutes(app, authMiddleware, deps);
  registerSubscriptionRoutes(app, authMiddleware, deps);
  registerSyncRoutes(app, authMiddleware, deps);
  registerSyncAccountRoutes(app, authMiddleware, deps);
  registerSyncQueueRoutes(app, authMiddleware, deps);
  registerUsersRoutes(app, authMiddleware, deps);

  console.log('[Routes] ✅ All routes registered');
}

module.exports = {
  registerAllRoutes
};
