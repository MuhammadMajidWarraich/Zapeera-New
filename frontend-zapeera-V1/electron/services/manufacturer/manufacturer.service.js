/**
 * Manufacturer Service
 * Business logic for manufacturer operations
 * Extracted from embedded-server.js
 */

const manufacturerRepository = require('../repositories/manufacturer/manufacturer.repository');
const { getDataFilter } = require('../../utils/helpers');

/**
 * List manufacturers
 */
async function listManufacturers(context, deps) {
  const { query, getDataFilter } = deps;
  const { user, query: queryParams } = context;
  
  const filter = getDataFilter(user, queryParams.branchId, queryParams.companyId);
  return manufacturerRepository.findAll(deps, filter, queryParams);
}

/**
 * Get manufacturer by ID
 */
async function getManufacturerById(id, deps) {
  return manufacturerRepository.findById(id, deps);
}

/**
 * Create manufacturer
 */
async function createManufacturer(data, deps) {
  return manufacturerRepository.create(data, deps);
}

/**
 * Update manufacturer
 */
async function updateManufacturer(id, data, deps) {
  return manufacturerRepository.update(id, data, deps);
}

/**
 * Delete manufacturer
 */
async function deleteManufacturer(id, deps) {
  return manufacturerRepository.delete(id, deps);
}

module.exports = {
  listManufacturers,
  getManufacturerById,
  createManufacturer,
  updateManufacturer,
  deleteManufacturer
};
