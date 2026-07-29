/**
 * Activation Service
 * Business logic for activation operations
 * Extracted from embedded-server.js
 */

const activationRepository = require('../repositories/activation/activation.repository');
const { getDataFilter } = require('../../utils/helpers');

/**
 * List activations
 */
async function listActivations(context, deps) {
  const { query, getDataFilter } = deps;
  const { user, query: queryParams } = context;
  
  const filter = getDataFilter(user, queryParams.branchId, queryParams.companyId);
  return activationRepository.findAll(deps, filter, queryParams);
}

/**
 * Get activation by ID
 */
async function getActivationById(id, deps) {
  return activationRepository.findById(id, deps);
}

/**
 * Create activation
 */
async function createActivation(data, deps) {
  return activationRepository.create(data, deps);
}

/**
 * Update activation
 */
async function updateActivation(id, data, deps) {
  return activationRepository.update(id, data, deps);
}

/**
 * Delete activation
 */
async function deleteActivation(id, deps) {
  return activationRepository.delete(id, deps);
}

module.exports = {
  checkActivationStatus,
  activateDevice
};
