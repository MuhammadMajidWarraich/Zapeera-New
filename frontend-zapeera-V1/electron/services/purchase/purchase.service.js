/**
 * Purchase Service
 * Business logic for purchase operations
 * Extracted from embedded-server.js
 */

const purchaseRepository = require('../repositories/purchase/purchase.repository');
const { getDataFilter } = require('../../utils/helpers');

/**
 * List purchases
 */
async function listPurchases(context, deps) {
  const { query, getDataFilter } = deps;
  const { user, query: queryParams } = context;
  
  const filter = getDataFilter(user, queryParams.branchId, queryParams.companyId);
  return purchaseRepository.findAll(deps, filter, queryParams);
}

/**
 * Get purchase by ID
 */
async function getPurchaseById(id, deps) {
  return purchaseRepository.findById(id, deps);
}

/**
 * Create purchase
 */
async function createPurchase(data, deps) {
  return purchaseRepository.create(data, deps);
}

/**
 * Update purchase
 */
async function updatePurchase(id, data, deps) {
  return purchaseRepository.update(id, data, deps);
}

/**
 * Delete purchase
 */
async function deletePurchase(id, deps) {
  return purchaseRepository.delete(id, deps);
}

module.exports = {
  listPurchases,
  getPurchaseById,
  createPurchase
};
