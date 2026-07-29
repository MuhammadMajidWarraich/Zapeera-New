/**
 * Promotion Service
 * Business logic for promotion operations
 * Extracted from embedded-server.js
 */

const promotionRepository = require('../repositories/promotion/promotion.repository');
const { getDataFilter } = require('../../utils/helpers');

/**
 * List promotions
 */
async function listPromotions(context, deps) {
  const { query, getDataFilter } = deps;
  const { user, query: queryParams } = context;
  
  const filter = getDataFilter(user, queryParams.branchId, queryParams.companyId);
  return promotionRepository.findAll(deps, filter, queryParams);
}

/**
 * Get promotion by ID
 */
async function getPromotionById(id, deps) {
  return promotionRepository.findById(id, deps);
}

/**
 * Create promotion
 */
async function createPromotion(data, deps) {
  return promotionRepository.create(data, deps);
}

/**
 * Update promotion
 */
async function updatePromotion(id, data, deps) {
  return promotionRepository.update(id, data, deps);
}

/**
 * Delete promotion
 */
async function deletePromotion(id, deps) {
  return promotionRepository.delete(id, deps);
}

module.exports = {
  listPromotions
};
