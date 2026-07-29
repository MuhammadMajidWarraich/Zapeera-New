/**
 * Supplier Service
 * Business logic for supplier operations
 * Extracted from embedded-server.js
 */

const supplierRepository = require('../repositories/supplier/supplier.repository');
const { getDataFilter } = require('../../utils/helpers');

/**
 * List suppliers
 */
async function listSuppliers(context, deps) {
  const { query, getDataFilter } = deps;
  const { user, query: queryParams } = context;
  
  const filter = getDataFilter(user, queryParams.branchId, queryParams.companyId);
  return supplierRepository.findAll(deps, filter, queryParams);
}

/**
 * Get supplier by ID
 */
async function getSupplierById(id, deps) {
  return supplierRepository.findById(id, deps);
}

/**
 * Create supplier
 */
async function createSupplier(data, deps) {
  return supplierRepository.create(data, deps);
}

/**
 * Update supplier
 */
async function updateSupplier(id, data, deps) {
  return supplierRepository.update(id, data, deps);
}

/**
 * Delete supplier
 */
async function deleteSupplier(id, deps) {
  return supplierRepository.delete(id, deps);
}

module.exports = {
  listSuppliers,
  getSupplierById,
  createSupplier,
  updateSupplier,
  deleteSupplier
};
