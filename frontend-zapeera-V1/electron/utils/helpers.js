/**
 * Helper Utilities
 * Extracted from embedded-server.js
 */

const crypto = require('crypto');

function uuid() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function getWeekNumber(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - (d.getDay() + 6) % 7);
  const week1 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + (week1.getDay() + 6) % 7) / 7);
}

function getDateFromWeek(year, week) {
  const simple = new Date(year, 0, 1 + (week - 1) * 7);
  const dow = simple.getDay();
  const ISOweekStart = simple;
  if (dow <= 4) {
    ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
  } else {
    ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
  }
  return ISOweekStart;
}

function normalizeValue(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (val instanceof Date) return val.toISOString();
  return val;
}

function resolveModule(moduleName) {
  const path = require('path');
  const searchPaths = [
    moduleName,
    path.join(__dirname, '..', '..', 'node_modules', moduleName),
    path.join(__dirname, '..', 'node_modules', moduleName),
    path.join(process.resourcesPath || '', 'app.asar', 'node_modules', moduleName),
    path.join(process.resourcesPath || '', 'app', 'node_modules', moduleName),
    path.join(process.resourcesPath || '', 'zapeera-backend', 'node_modules', moduleName),
  ];

  for (const p of searchPaths) {
    try {
      return require(p);
    } catch (e) {
      continue;
    }
  }

  return require(moduleName);
}

// Helper function to build data isolation filters
function getDataFilter(user, requestedBranchId, requestedCompanyId) {
  const role = user?.role || 'CASHIER';

  // Get from user object (which was set from headers in authMiddleware)
  // Priority: requested (query param) > selected (from headers/user) > user's assigned
  const selectedBranchId = user?.selectedBranchId;
  const selectedCompanyId = user?.selectedCompanyId;

  // Priority: requested (query param) > selected (header/user) > user's assigned
  let branchFilter = requestedBranchId || selectedBranchId || user?.branchId;
  let companyFilter = requestedCompanyId || selectedCompanyId || user?.companyId;

  if (role === 'SUPERADMIN') {
    // SUPERADMIN can see everything, but can filter by request
    branchFilter = requestedBranchId || selectedBranchId || null;
    companyFilter = requestedCompanyId || selectedCompanyId || null;
  } else if (role === 'ADMIN') {
    // ADMIN can see all branches in their company
    companyFilter = requestedCompanyId || selectedCompanyId || user?.companyId;
    branchFilter = requestedBranchId || selectedBranchId || null;
  } else if (role === 'MANAGER') {
    // MANAGER can see their branch only
    branchFilter = requestedBranchId || selectedBranchId || user?.branchId;
    companyFilter = requestedCompanyId || selectedCompanyId || user?.companyId;
  } else {
    // CASHIER can only see their assigned branch
    branchFilter = user?.branchId;
    companyFilter = user?.companyId;
  }

  return {
    branchFilter,
    companyFilter,
    role
  };
}

module.exports = {
  uuid,
  now,
  getWeekNumber,
  getDateFromWeek,
  normalizeValue,
  resolveModule,
  getDataFilter
};
