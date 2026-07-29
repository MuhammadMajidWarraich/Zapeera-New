/**
 * Sync Service
 * Business logic for sync operations
 * Extracted from embedded-server.js
 */

const syncRepository = require('../repositories/sync/sync.repository');
const { getDataFilter } = require('../../utils/helpers');

/**
 * List syncs
 */
async function listSyncs(context, deps) {
  const { query, getDataFilter } = deps;
  const { user, query: queryParams } = context;
  
  const filter = getDataFilter(user, queryParams.branchId, queryParams.companyId);
  return syncRepository.findAll(deps, filter, queryParams);
}

/**
 * Get sync by ID
 */
async function getSyncById(id, deps) {
  return syncRepository.findById(id, deps);
}

/**
 * Create sync
 */
async function createSync(data, deps) {
  return syncRepository.create(data, deps);
}

/**
 * Update sync
 */
async function updateSync(id, data, deps) {
  return syncRepository.update(id, data, deps);
}

/**
 * Delete sync
 */
async function deleteSync(id, deps) {
  return syncRepository.delete(id, deps);
}

module.exports = {
  syncAll,
  pullAll,
  processQueue
};
