/**
 * Inventory Service
 * Business logic for inventory operations
 * Extracted from embedded-server.js
 */

const inventoryRepository = require('../repositories/inventory/inventory.repository');
const { getDataFilter } = require('../../utils/helpers');

/**
 * List inventorys
 */
async function listInventorys(context, deps) {
  const { query, getDataFilter } = deps;
  const { user, query: queryParams } = context;
  
  const filter = getDataFilter(user, queryParams.branchId, queryParams.companyId);
  return inventoryRepository.findAll(deps, filter, queryParams);
}

/**
 * Get inventory by ID
 */
async function getInventoryById(id, deps) {
  return inventoryRepository.findById(id, deps);
}

/**
 * Create inventory
 */
async function createInventory(data, deps) {
  return inventoryRepository.create(data, deps);
}

/**
 * Update inventory
 */
async function updateInventory(id, data, deps) {
  return inventoryRepository.update(id, data, deps);
}

/**
 * Delete inventory
 */
async function deleteInventory(id, deps) {
  return inventoryRepository.delete(id, deps);
}

module.exports = {
  getInventorySummary,
  getInventoryProducts,
  getLowStock,
  getInventoryReports
};
