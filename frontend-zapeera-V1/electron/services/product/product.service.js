/**
 * Product Service
 * Business logic for product operations
 * Extracted from embedded-server.js
 */

const productRepository = require('../repositories/product/product.repository');
const { getDataFilter } = require('../../utils/helpers');

/**
 * List products
 */
async function listProducts(context, deps) {
  const { query, getDataFilter } = deps;
  const { user, query: queryParams } = context;
  
  const filter = getDataFilter(user, queryParams.branchId, queryParams.companyId);
  return productRepository.findAll(deps, filter, queryParams);
}

/**
 * Get product by ID
 */
async function getProductById(id, deps) {
  return productRepository.findById(id, deps);
}

/**
 * Create product
 */
async function createProduct(data, deps) {
  return productRepository.create(data, deps);
}

/**
 * Update product
 */
async function updateProduct(id, data, deps) {
  return productRepository.update(id, data, deps);
}

/**
 * Delete product
 */
async function deleteProduct(id, deps) {
  return productRepository.delete(id, deps);
}

module.exports = {
  listProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct
};
