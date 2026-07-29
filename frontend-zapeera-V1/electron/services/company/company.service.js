/**
 * Company Service
 * Business logic for company operations
 * Extracted from embedded-server.js
 */

const companyRepository = require('../repositories/company/company.repository');
const { getDataFilter } = require('../../utils/helpers');

/**
 * List companys
 */
async function listCompanys(context, deps) {
  const { query, getDataFilter } = deps;
  const { user, query: queryParams } = context;
  
  const filter = getDataFilter(user, queryParams.branchId, queryParams.companyId);
  return companyRepository.findAll(deps, filter, queryParams);
}

/**
 * Get company by ID
 */
async function getCompanyById(id, deps) {
  return companyRepository.findById(id, deps);
}

/**
 * Create company
 */
async function createCompany(data, deps) {
  return companyRepository.create(data, deps);
}

/**
 * Update company
 */
async function updateCompany(id, data, deps) {
  return companyRepository.update(id, data, deps);
}

/**
 * Delete company
 */
async function deleteCompany(id, deps) {
  return companyRepository.delete(id, deps);
}

module.exports = {
  listCompanies,
  getCompanyById,
  createCompany,
  updateCompany,
  deleteCompany
};
