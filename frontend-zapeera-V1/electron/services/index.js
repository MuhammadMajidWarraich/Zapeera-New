/**
 * Services Index
 * Export all services
 */

const productService = require('./product/product.service');
const categoryService = require('./category/category.service');
const companyService = require('./company/company.service');
const branchService = require('./branch/branch.service');
const customerService = require('./customer/customer.service');
const supplierService = require('./supplier/supplier.service');
const manufacturerService = require('./manufacturer/manufacturer.service');
const shelfService = require('./shelf/shelf.service');
const batchService = require('./batch/batch.service');
const purchaseService = require('./purchase/purchase.service');
const saleService = require('./sale/sale.service');
const refundService = require('./refund/refund.service');
const employeeService = require('./employee/employee.service');
const dashboardService = require('./dashboard/dashboard.service');
const inventoryService = require('./inventory/inventory.service');
const receiptService = require('./receipt/receipt.service');
const promotionService = require('./promotion/promotion.service');
const gift-cardService = require('./gift-card/gift-card.service');
const settingsService = require('./settings/settings.service');
const roleService = require('./role/role.service');
const adminService = require('./admin/admin.service');
const authService = require('./auth/auth.service');
const activationService = require('./activation/activation.service');
const syncService = require('./sync/sync.service');
const debugService = require('./debug/debug.service');

module.exports = {
  productService,
  categoryService,
  companyService,
  branchService,
  customerService,
  supplierService,
  manufacturerService,
  shelfService,
  batchService,
  purchaseService,
  saleService,
  refundService,
  employeeService,
  dashboardService,
  inventoryService,
  receiptService,
  promotionService,
  gift-cardService,
  settingsService,
  roleService,
  adminService,
  authService,
  activationService,
  syncService,
  debugService
};
