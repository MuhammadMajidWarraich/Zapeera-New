/**
 * Shelf Service
 * Business logic for shelf operations
 * Extracted from embedded-server.js
 */

const shelfRepository = require('../repositories/shelf/shelf.repository');
const { getDataFilter } = require('../../utils/helpers');

/**
 * List shelfs
 */
async function listShelfs(context, deps) {
  const { query, getDataFilter } = deps;
  const { user, query: queryParams } = context;
  
  const filter = getDataFilter(user, queryParams.branchId, queryParams.companyId);
  return shelfRepository.findAll(deps, filter, queryParams);
}

/**
 * Get shelf by ID
 */
async function getShelfById(id, deps) {
  return shelfRepository.findById(id, deps);
}

/**
 * Create shelf
 */
async function createShelf(data, deps) {
  return shelfRepository.create(data, deps);
}

/**
 * Update shelf
 */
async function updateShelf(id, data, deps) {
  return shelfRepository.update(id, data, deps);
}

/**
 * Delete shelf
 */
async function deleteShelf(id, deps) {
  return shelfRepository.delete(id, deps);
}

module.exports = {
  listShelves,
  getShelfById,
  createShelf,
  updateShelf,
  deleteShelf
};
