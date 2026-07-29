/**
 * Customer Service
 * Business logic for customer operations
 * Extracted from embedded-server.js
 */

const customerRepository = require('../repositories/customer/customer.repository');
const { getDataFilter } = require('../../utils/helpers');

/**
 * List customers
 */
async function listCustomers(context, deps) {
  const { query, getDataFilter } = deps;
  const { user, query: queryParams } = context;
  
  const filter = getDataFilter(user, queryParams.branchId, queryParams.companyId);
  return customerRepository.findAll(deps, filter, queryParams);
}

/**
 * Get customer by ID
 */
async function getCustomerById(id, deps) {
  return customerRepository.findById(id, deps);
}

/**
 * Create customer
 */
async function createCustomer(data, deps) {
  return customerRepository.create(data, deps);
}

/**
 * Update customer
 */
async function updateCustomer(id, data, deps) {
  return customerRepository.update(id, data, deps);
}

/**
 * Delete customer
 */
async function deleteCustomer(id, deps) {
  return customerRepository.delete(id, deps);
}

module.exports = {
  listCustomers,
  getCustomerById,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerPurchaseHistory
};
