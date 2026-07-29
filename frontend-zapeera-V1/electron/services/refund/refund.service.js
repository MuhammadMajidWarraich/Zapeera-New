/**
 * Refund Service
 * Business logic for refund operations
 * Extracted from embedded-server.js
 */

const refundRepository = require('../repositories/refund/refund.repository');
const { getDataFilter } = require('../../utils/helpers');

/**
 * List refunds
 */
async function listRefunds(context, deps) {
  const { query, getDataFilter } = deps;
  const { user, query: queryParams } = context;
  
  const filter = getDataFilter(user, queryParams.branchId, queryParams.companyId);
  return refundRepository.findAll(deps, filter, queryParams);
}

/**
 * Get refund by ID
 */
async function getRefundById(id, deps) {
  return refundRepository.findById(id, deps);
}

/**
 * Create refund
 */
async function createRefund(data, deps) {
  return refundRepository.create(data, deps);
}

/**
 * Update refund
 */
async function updateRefund(id, data, deps) {
  return refundRepository.update(id, data, deps);
}

/**
 * Delete refund
 */
async function deleteRefund(id, deps) {
  return refundRepository.delete(id, deps);
}

module.exports = {
  listRefunds,
  getRefundById,
  createRefund
};
