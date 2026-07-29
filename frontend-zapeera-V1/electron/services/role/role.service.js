/**
 * Role Service
 * Business logic for role operations
 * Extracted from embedded-server.js
 */

const roleRepository = require('../repositories/role/role.repository');
const { getDataFilter } = require('../../utils/helpers');

/**
 * List roles
 */
async function listRoles(context, deps) {
  const { query, getDataFilter } = deps;
  const { user, query: queryParams } = context;
  
  const filter = getDataFilter(user, queryParams.branchId, queryParams.companyId);
  return roleRepository.findAll(deps, filter, queryParams);
}

/**
 * Get role by ID
 */
async function getRoleById(id, deps) {
  return roleRepository.findById(id, deps);
}

/**
 * Create role
 */
async function createRole(data, deps) {
  return roleRepository.create(data, deps);
}

/**
 * Update role
 */
async function updateRole(id, data, deps) {
  return roleRepository.update(id, data, deps);
}

/**
 * Delete role
 */
async function deleteRole(id, deps) {
  return roleRepository.delete(id, deps);
}

module.exports = {
  listRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRole
};
