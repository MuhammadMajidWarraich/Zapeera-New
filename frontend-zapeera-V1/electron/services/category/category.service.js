/**
 * Category Service
 * Business logic for category operations
 * Extracted from embedded-server.js
 */

const categoryRepository = require('../repositories/category/category.repository');
const { getDataFilter } = require('../../utils/helpers');

/**
 * List categorys
 */
async function listCategorys(context, deps) {
  const { query, getDataFilter } = deps;
  const { user, query: queryParams } = context;
  
  const filter = getDataFilter(user, queryParams.branchId, queryParams.companyId);
  return categoryRepository.findAll(deps, filter, queryParams);
}

/**
 * Get category by ID
 */
async function getCategoryById(id, deps) {
  return categoryRepository.findById(id, deps);
}

/**
 * Create category
 */
async function createCategory(data, deps) {
  return categoryRepository.create(data, deps);
}

/**
 * Update category
 */
async function updateCategory(id, data, deps) {
  return categoryRepository.update(id, data, deps);
}

/**
 * Delete category
 */
async function deleteCategory(id, deps) {
  return categoryRepository.delete(id, deps);
}

module.exports = {
  listCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory
};
