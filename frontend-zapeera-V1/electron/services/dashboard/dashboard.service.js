/**
 * Dashboard Service
 * Business logic for dashboard operations
 * Extracted from embedded-server.js
 */

const dashboardRepository = require('../repositories/dashboard/dashboard.repository');
const { getDataFilter } = require('../../utils/helpers');

/**
 * List dashboards
 */
async function listDashboards(context, deps) {
  const { query, getDataFilter } = deps;
  const { user, query: queryParams } = context;
  
  const filter = getDataFilter(user, queryParams.branchId, queryParams.companyId);
  return dashboardRepository.findAll(deps, filter, queryParams);
}

/**
 * Get dashboard by ID
 */
async function getDashboardById(id, deps) {
  return dashboardRepository.findById(id, deps);
}

/**
 * Create dashboard
 */
async function createDashboard(data, deps) {
  return dashboardRepository.create(data, deps);
}

/**
 * Update dashboard
 */
async function updateDashboard(id, data, deps) {
  return dashboardRepository.update(id, data, deps);
}

/**
 * Delete dashboard
 */
async function deleteDashboard(id, deps) {
  return dashboardRepository.delete(id, deps);
}

module.exports = {
  getDashboardStats,
  getDashboardChart,
  getAdminStats
};
