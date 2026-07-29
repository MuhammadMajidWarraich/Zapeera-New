/**
 * Employee Service
 * Business logic for employee operations
 * Extracted from embedded-server.js
 */

const employeeRepository = require('../repositories/employee/employee.repository');
const { getDataFilter } = require('../../utils/helpers');

/**
 * List employees
 */
async function listEmployees(context, deps) {
  const { query, getDataFilter } = deps;
  const { user, query: queryParams } = context;
  
  const filter = getDataFilter(user, queryParams.branchId, queryParams.companyId);
  return employeeRepository.findAll(deps, filter, queryParams);
}

/**
 * Get employee by ID
 */
async function getEmployeeById(id, deps) {
  return employeeRepository.findById(id, deps);
}

/**
 * Create employee
 */
async function createEmployee(data, deps) {
  return employeeRepository.create(data, deps);
}

/**
 * Update employee
 */
async function updateEmployee(id, data, deps) {
  return employeeRepository.update(id, data, deps);
}

/**
 * Delete employee
 */
async function deleteEmployee(id, deps) {
  return employeeRepository.delete(id, deps);
}

module.exports = {
  listEmployees,
  getEmployeeById,
  createEmployee,
  updateEmployee,
  deleteEmployee
};
