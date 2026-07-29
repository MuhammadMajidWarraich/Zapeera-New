/**
 * Batch Service
 * Business logic for batch operations
 * Extracted from embedded-server.js
 */

const batchRepository = require('../repositories/batch/batch.repository');
const { getDataFilter } = require('../../utils/helpers');

/**
 * List batchs
 */
async function listBatchs(context, deps) {
  const { query, getDataFilter } = deps;
  const { user, query: queryParams } = context;
  
  const filter = getDataFilter(user, queryParams.branchId, queryParams.companyId);
  return batchRepository.findAll(deps, filter, queryParams);
}

/**
 * Get batch by ID
 */
async function getBatchById(id, deps) {
  return batchRepository.findById(id, deps);
}

/**
 * Create batch
 */
async function createBatch(data, deps) {
  return batchRepository.create(data, deps);
}

/**
 * Update batch
 */
async function updateBatch(id, data, deps) {
  return batchRepository.update(id, data, deps);
}

/**
 * Delete batch
 */
async function deleteBatch(id, deps) {
  return batchRepository.delete(id, deps);
}

module.exports = {
  listBatches,
  getBatchById,
  createBatch,
  updateBatch,
  deleteBatch,
  listBatchesByProduct
};
