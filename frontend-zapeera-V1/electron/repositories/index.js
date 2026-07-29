/**
 * Repositories Index
 * Export all repositories
 */

const productRepository = require('./product/product.repository');
const categoryRepository = require('./category/category.repository');
const companyRepository = require('./company/company.repository');
const branchRepository = require('./branch/branch.repository');
const customerRepository = require('./customer/customer.repository');
const supplierRepository = require('./supplier/supplier.repository');
const manufacturerRepository = require('./manufacturer/manufacturer.repository');
const shelfRepository = require('./shelf/shelf.repository');
const batchRepository = require('./batch/batch.repository');
const purchaseRepository = require('./purchase/purchase.repository');
const saleRepository = require('./sale/sale.repository');
const refundRepository = require('./refund/refund.repository');
const employeeRepository = require('./employee/employee.repository');
const dashboardRepository = require('./dashboard/dashboard.repository');
const inventoryRepository = require('./inventory/inventory.repository');
const receiptRepository = require('./receipt/receipt.repository');
const promotionRepository = require('./promotion/promotion.repository');
const gift-cardRepository = require('./gift-card/gift-card.repository');
const settingsRepository = require('./settings/settings.repository');
const roleRepository = require('./role/role.repository');
const adminRepository = require('./admin/admin.repository');
const authRepository = require('./auth/auth.repository');
const activationRepository = require('./activation/activation.repository');
const syncRepository = require('./sync/sync.repository');
const debugRepository = require('./debug/debug.repository');

module.exports = {
  productRepository,
  categoryRepository,
  companyRepository,
  branchRepository,
  customerRepository,
  supplierRepository,
  manufacturerRepository,
  shelfRepository,
  batchRepository,
  purchaseRepository,
  saleRepository,
  refundRepository,
  employeeRepository,
  dashboardRepository,
  inventoryRepository,
  receiptRepository,
  promotionRepository,
  gift-cardRepository,
  settingsRepository,
  roleRepository,
  adminRepository,
  authRepository,
  activationRepository,
  syncRepository,
  debugRepository
};
