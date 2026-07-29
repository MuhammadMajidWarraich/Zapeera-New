/**
 * Settings Service
 * Business logic for settings operations
 * Extracted from embedded-server.js
 */

const settingsRepository = require('../repositories/settings/settings.repository');
const { getDataFilter } = require('../../utils/helpers');

/**
 * List settingss
 */
async function listSettingss(context, deps) {
  const { query, getDataFilter } = deps;
  const { user, query: queryParams } = context;
  
  const filter = getDataFilter(user, queryParams.branchId, queryParams.companyId);
  return settingsRepository.findAll(deps, filter, queryParams);
}

/**
 * Get settings by ID
 */
async function getSettingsById(id, deps) {
  return settingsRepository.findById(id, deps);
}

/**
 * Create settings
 */
async function createSettings(data, deps) {
  return settingsRepository.create(data, deps);
}

/**
 * Update settings
 */
async function updateSettings(id, data, deps) {
  return settingsRepository.update(id, data, deps);
}

/**
 * Delete settings
 */
async function deleteSettings(id, deps) {
  return settingsRepository.delete(id, deps);
}

module.exports = {
  getSettings,
  updateSettings
};
