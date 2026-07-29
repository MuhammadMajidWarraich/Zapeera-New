/**
 * Sale Service
 * Business logic for sale operations
 * Extracted from embedded-server.js
 */

const saleRepository = require('../repositories/sale/sale.repository');
const { getDataFilter } = require('../../utils/helpers');

/**
 * List sales
 */
async function listSales(context, deps) {
  const { query, getDataFilter } = deps;
  const { user, query: queryParams } = context;
  
  const filter = getDataFilter(user, queryParams.branchId, queryParams.companyId);
  return saleRepository.findAll(deps, filter, queryParams);
}

/**
 * Get sale by ID
 */
async function getSaleById(id, deps) {
  return saleRepository.findById(id, deps);
}

/**
 * Create sale
 */
async function createSale(data, deps) {
  return saleRepository.create(data, deps);
}

/**
 * Update sale
 */
async function updateSale(id, data, deps) {
  return saleRepository.update(id, data, deps);
}

/**
 * Delete sale
 */
async function deleteSale(id, deps) {
  return saleRepository.delete(id, deps);
}

module.exports = {
  listSales,
  getSaleById,
  createSale,
  updateSale
};
