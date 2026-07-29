/**
 * Admin Service
 * Business logic for admin operations
 * Extracted from embedded-server.js
 */

const adminRepository = require('../repositories/admin/admin.repository');
const { getDataFilter } = require('../../utils/helpers');

/**
 * List admins
 */
async function listAdmins(context, deps) {
  const { query, getDataFilter } = deps;
  const { user, query: queryParams } = context;
  
  const filter = getDataFilter(user, queryParams.branchId, queryParams.companyId);
  return adminRepository.findAll(deps, filter, queryParams);
}

/**
 * Get admin by ID
 */
async function getAdminById(id, deps) {
  return adminRepository.findById(id, deps);
}

/**
 * Create admin
 */
async function createAdmin(data, deps) {
  return adminRepository.create(data, deps);
}

/**
 * Update admin
 */
async function updateAdmin(id, data, deps) {
  return adminRepository.update(id, data, deps);
}

/**
 * Delete admin
 */
async function deleteAdmin(id, deps) {
  return adminRepository.delete(id, deps);
}

module.exports = {
  listAdmins,
  createAdmin,
  updateAdmin,
  deleteAdmin
};
