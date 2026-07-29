/**
 * Receipt Service
 * Business logic for receipt operations
 * Extracted from embedded-server.js
 */

const receiptRepository = require('../repositories/receipt/receipt.repository');
const { getDataFilter } = require('../../utils/helpers');

/**
 * List receipts
 */
async function listReceipts(context, deps) {
  const { query, getDataFilter } = deps;
  const { user, query: queryParams } = context;
  
  const filter = getDataFilter(user, queryParams.branchId, queryParams.companyId);
  return receiptRepository.findAll(deps, filter, queryParams);
}

/**
 * Get receipt by ID
 */
async function getReceiptById(id, deps) {
  return receiptRepository.findById(id, deps);
}

/**
 * Create receipt
 */
async function createReceipt(data, deps) {
  return receiptRepository.create(data, deps);
}

/**
 * Update receipt
 */
async function updateReceipt(id, data, deps) {
  return receiptRepository.update(id, data, deps);
}

/**
 * Delete receipt
 */
async function deleteReceipt(id, deps) {
  return receiptRepository.delete(id, deps);
}

module.exports = {
  listReceipts,
  getReceiptByNumber
};
