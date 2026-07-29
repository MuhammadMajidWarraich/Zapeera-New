/**
 * Debug Service
 * Business logic for debug operations
 * Extracted from embedded-server.js
 */

const debugRepository = require('../repositories/debug/debug.repository');
const { getDataFilter } = require('../../utils/helpers');

/**
 * List debugs
 */
async function listDebugs(context, deps) {
  const { query, getDataFilter } = deps;
  const { user, query: queryParams } = context;
  
  const filter = getDataFilter(user, queryParams.branchId, queryParams.companyId);
  return debugRepository.findAll(deps, filter, queryParams);
}

/**
 * Get debug by ID
 */
async function getDebugById(id, deps) {
  return debugRepository.findById(id, deps);
}

/**
 * Create debug
 */
async function createDebug(data, deps) {
  return debugRepository.create(data, deps);
}

/**
 * Update debug
 */
async function updateDebug(id, data, deps) {
  return debugRepository.update(id, data, deps);
}

/**
 * Delete debug
 */
async function deleteDebug(id, deps) {
  return debugRepository.delete(id, deps);
}

module.exports = {
  debugPostgreSQL
};
