/**
 * Branch Service
 * Business logic for branch operations
 * Extracted from embedded-server.js
 */

const branchRepository = require('../repositories/branch/branch.repository');
const { getDataFilter } = require('../../utils/helpers');

/**
 * List branchs
 */
async function listBranchs(context, deps) {
  const { query, getDataFilter } = deps;
  const { user, query: queryParams } = context;
  
  const filter = getDataFilter(user, queryParams.branchId, queryParams.companyId);
  return branchRepository.findAll(deps, filter, queryParams);
}

/**
 * Get branch by ID
 */
async function getBranchById(id, deps) {
  return branchRepository.findById(id, deps);
}

/**
 * Create branch
 */
async function createBranch(data, deps) {
  return branchRepository.create(data, deps);
}

/**
 * Update branch
 */
async function updateBranch(id, data, deps) {
  return branchRepository.update(id, data, deps);
}

/**
 * Delete branch
 */
async function deleteBranch(id, deps) {
  return branchRepository.delete(id, deps);
}

module.exports = {
  listBranches,
  getBranchById,
  createBranch,
  updateBranch,
  deleteBranch
};
