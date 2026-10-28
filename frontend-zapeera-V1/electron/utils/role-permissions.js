/**
 * Role-based permissions matrix — embedded port of
 * backend-zapeera-v1-main/src/config/permissions.ts (verbatim).
 * Served by /api/roles (the RoleManagement page reads the static
 * matrix, keyed by role name) and used by the roles routes for
 * getRolePermissions / getUserPermissions / check-permission /
 * resources/:resource/actions.
 */
const RESOURCES = {
  USERS: 'users',
  STAFF: 'staff',
  BRANCHES: 'branches',
  PRODUCTS: 'products',
  CATEGORIES: 'categories',
  SUPPLIERS: 'suppliers',
  STOCK_MOVEMENTS: 'stock_movements',
  SALES: 'sales',
  RECEIPTS: 'receipts',
  REFUNDS: 'refunds',
  REPORTS: 'reports',
  DASHBOARD: 'dashboard',
  ANALYTICS: 'analytics',
  SETTINGS: 'settings',
  INTEGRATIONS: 'integrations',
  BACKUP: 'backup',
  PRESCRIPTIONS: 'prescriptions',
  CUSTOMERS: 'customers',
  MEDICATION_HISTORY: 'medication_history',
  PATIENTS: 'patients',
  DOCTORS: 'doctors',
  APPOINTMENTS: 'appointments',
  ROOMS: 'rooms',
  RESERVATIONS: 'reservations',
  FOLIOS: 'folios',
  FRONT_DESK: 'front_desk',
  STOCK_TAKES: 'stock_takes',
  SHIFTS: 'shifts',
  SCHEDULED_SHIFTS: 'scheduled_shifts',
  ATTENDANCE: 'attendance',
  COMMISSIONS: 'commissions',
  PAYMENTS: 'payments',
  BILLING: 'billing'
};

const ACTIONS = {
  CREATE: 'create',
  READ: 'read',
  UPDATE: 'update',
  DELETE: 'delete',
  APPROVE: 'approve',
  REJECT: 'reject',
  EXPORT: 'export',
  IMPORT: 'import',
  MANAGE: 'manage'
};

const ROLE_PERMISSIONS = [
  {
    role: 'OWNER',
    description: 'Business owner - Full control over their own businesses and staff',
    permissions: [
      { resource: RESOURCES.USERS, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.STAFF, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.BRANCHES, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.PRODUCTS, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.CATEGORIES, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.SUPPLIERS, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.SALES, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.REPORTS, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.DASHBOARD, actions: [ACTIONS.READ], conditions: { branchId: true } },
      { resource: RESOURCES.SETTINGS, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.COMMISSIONS, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.CUSTOMERS, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.REFUNDS, actions: [ACTIONS.MANAGE], conditions: { branchId: true } }
    ]
  },
  {
    role: 'USER',
    description: 'Registered user - same operational scope as owner when managing a business (promoted to OWNER when creating a business)',
    permissions: [
      { resource: RESOURCES.USERS, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.STAFF, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.BRANCHES, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.PRODUCTS, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.CATEGORIES, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.SUPPLIERS, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.SALES, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.REPORTS, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.DASHBOARD, actions: [ACTIONS.READ], conditions: { branchId: true } },
      { resource: RESOURCES.SETTINGS, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.COMMISSIONS, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.CUSTOMERS, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.REFUNDS, actions: [ACTIONS.MANAGE], conditions: { branchId: true } }
    ]
  },
  {
    role: 'MANAGER',
    description: 'Manager - Manages one store/branch operations',
    permissions: [
      { resource: RESOURCES.USERS, actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE], conditions: { branchId: true } },
      { resource: RESOURCES.STAFF, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.PRODUCTS, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.CATEGORIES, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.SUPPLIERS, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.SALES, actions: [ACTIONS.CREATE, ACTIONS.READ, ACTIONS.UPDATE], conditions: { branchId: true } },
      { resource: RESOURCES.REPORTS, actions: [ACTIONS.READ, ACTIONS.EXPORT], conditions: { branchId: true } },
      { resource: RESOURCES.DASHBOARD, actions: [ACTIONS.READ], conditions: { branchId: true } },
      { resource: RESOURCES.REFUNDS, actions: [ACTIONS.READ, ACTIONS.APPROVE, ACTIONS.REJECT], conditions: { branchId: true, limit: 1000 } },
      { resource: RESOURCES.CUSTOMERS, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.COMMISSIONS, actions: [ACTIONS.READ], conditions: { branchId: true } },
      { resource: RESOURCES.SHIFTS, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.SCHEDULED_SHIFTS, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.ATTENDANCE, actions: [ACTIONS.MANAGE], conditions: { branchId: true } },
      { resource: RESOURCES.SETTINGS, actions: [ACTIONS.READ], conditions: { branchId: true } },
      { resource: RESOURCES.INTEGRATIONS, actions: [], conditions: {} },
      { resource: RESOURCES.BACKUP, actions: [], conditions: {} }
    ]
  },
  {
    role: 'CASHIER',
    description: 'Cashier - Handles customer checkout and frontend sales',
    permissions: [
      { resource: RESOURCES.SALES, actions: [ACTIONS.CREATE, ACTIONS.READ], conditions: { branchId: true } },
      { resource: RESOURCES.RECEIPTS, actions: [ACTIONS.CREATE, ACTIONS.READ], conditions: { branchId: true } },
      { resource: RESOURCES.REFUNDS, actions: [ACTIONS.CREATE, ACTIONS.READ], conditions: { branchId: true, limit: 100 } },
      { resource: RESOURCES.PRODUCTS, actions: [ACTIONS.READ], conditions: { branchId: true } },
      { resource: RESOURCES.CUSTOMERS, actions: [ACTIONS.READ, ACTIONS.CREATE, ACTIONS.UPDATE], conditions: { branchId: true } },
      { resource: RESOURCES.CATEGORIES, actions: [ACTIONS.READ], conditions: { branchId: true } },
      { resource: RESOURCES.DASHBOARD, actions: [ACTIONS.READ], conditions: { branchId: true } },
      { resource: RESOURCES.REPORTS, actions: [ACTIONS.READ], conditions: { branchId: true, ownData: true } },
      { resource: RESOURCES.USERS, actions: [], conditions: {} },
      { resource: RESOURCES.STAFF, actions: [], conditions: {} },
      { resource: RESOURCES.SETTINGS, actions: [], conditions: {} },
      { resource: RESOURCES.SUPPLIERS, actions: [], conditions: {} },
      { resource: RESOURCES.STOCK_MOVEMENTS, actions: [], conditions: {} },
      { resource: RESOURCES.COMMISSIONS, actions: [], conditions: {} }
    ]
  }
];

function getRolePermissions(role) {
  const roleConfig = ROLE_PERMISSIONS.find((r) => r.role === String(role || '').toUpperCase());
  return roleConfig ? roleConfig.permissions : [];
}

function hasPermission(userRole, resource, action, userBranchId, targetBranchId, isOwnData = false) {
  const permissions = getRolePermissions(userRole);
  const permission = permissions.find((p) => p.resource === resource);
  if (!permission) return false;
  if (!permission.actions.includes(action) && !permission.actions.includes(ACTIONS.MANAGE)) return false;
  if (permission.conditions) {
    const { branchId, ownData } = permission.conditions;
    if (branchId === true && userBranchId && targetBranchId && userBranchId !== targetBranchId) return false;
    if (ownData === true && !isOwnData) return false;
  }
  return true;
}

function getAccessibleResources(role) {
  return getRolePermissions(role).filter((p) => p.actions.length > 0).map((p) => p.resource);
}

function getAllowedActions(role, resource) {
  const permission = getRolePermissions(role).find((p) => p.resource === resource);
  return permission ? permission.actions : [];
}

module.exports = {
  RESOURCES,
  ACTIONS,
  ROLE_PERMISSIONS,
  getRolePermissions,
  hasPermission,
  getAccessibleResources,
  getAllowedActions
};
