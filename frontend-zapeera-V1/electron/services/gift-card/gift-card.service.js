/**
 * Gift-card Service
 * Business logic for gift-card operations
 * Extracted from embedded-server.js
 */

const gift-cardRepository = require('../repositories/gift-card/gift-card.repository');
const { getDataFilter } = require('../../utils/helpers');

/**
 * List gift-cards
 */
async function listGift-cards(context, deps) {
  const { query, getDataFilter } = deps;
  const { user, query: queryParams } = context;
  
  const filter = getDataFilter(user, queryParams.branchId, queryParams.companyId);
  return gift-cardRepository.findAll(deps, filter, queryParams);
}

/**
 * Get gift-card by ID
 */
async function getGift-cardById(id, deps) {
  return gift-cardRepository.findById(id, deps);
}

/**
 * Create gift-card
 */
async function createGift-card(data, deps) {
  return gift-cardRepository.create(data, deps);
}

/**
 * Update gift-card
 */
async function updateGift-card(id, data, deps) {
  return gift-cardRepository.update(id, data, deps);
}

/**
 * Delete gift-card
 */
async function deleteGift-card(id, deps) {
  return gift-cardRepository.delete(id, deps);
}

module.exports = {
  listGiftCards
};
