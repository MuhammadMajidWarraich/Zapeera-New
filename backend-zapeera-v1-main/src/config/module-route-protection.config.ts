/**
 * Module Route Protection Configuration
 * Maps API routes to required modules for access control
 *
 * SECURITY: This is the authoritative mapping of which module is required
 * for each route group. Backend middleware enforces this.
 *
 * Modules in the system (from `modules` table):
 *   pos, sales, inventory, suppliers, customers, purchases,
 *   staff, reports, business_management, expenses, subscription
 */

export const MODULE_ROUTE_MAP: Record<string, string> = {
  // Inventory Management (products, batches, shelves, categories, suppliers, manufacturers)
  '/api/inventory': 'inventory',
  '/api/products': 'inventory',
  '/api/batches': 'inventory',
  '/api/shelves': 'inventory',
  '/api/categories': 'inventory',
  '/api/suppliers': 'inventory',
  '/api/manufacturers': 'inventory',

  // Sales & POS
  '/api/sales': 'sales',
  '/api/pos': 'pos',
  '/api/refunds': 'sales',
  '/api/customers': 'customers',

  // Purchases
  '/api/purchases': 'purchases',

  // Staff Management (employees, attendance, shifts, commissions)
  '/api/staff': 'staff',
  '/api/attendance': 'staff',
  '/api/shifts': 'staff',
  '/api/scheduled-shifts': 'staff',
  '/api/commissions': 'staff',

  // Reports & Analytics
  '/api/reports': 'reports',

  // Business Management (settings, roles, billing, admin)
  '/api/settings': 'business_management',
  '/api/billing-profiles': 'business_management',
  '/api/roles': 'business_management',
  '/api/admin': 'business_management',

  // Expenses
  '/api/expenses': 'expenses',
};

/**
 * Routes that are ALWAYS accessible (no module check required)
 * These are core system routes needed for basic app functionality
 */
export const ALWAYS_ALLOWED_ROUTES: string[] = [
  // Auth & user management
  '/api/auth',
  '/api/users/me',
  '/api/users/profile',
  '/api/users/change-password',

  // Core infrastructure — needed before any module can be evaluated
  '/api/companies',
  '/api/branches',
  '/api/invitations',
  '/api/subscription',
  '/api/business-types',
  '/api/modules',
  '/api/module-access',

  // System
  '/api/sync',
  '/api/sse',
  '/api/health',
  '/api/payments/manual',
];

/** Convert versioned API paths to the canonical authorization policy path. */
export function normalizeModulePolicyPath(path: string): string {
  const withoutQuery = String(path || '').split('?')[0];
  const normalizedVersion = withoutQuery.replace(/^\/api\/v\d+(?=\/|$)/i, '/api');
  return normalizedVersion.length > 1 ? normalizedVersion.replace(/\/+$/, '') : normalizedVersion;
}

/**
 * Routes that require authentication but no specific module
 */
export const AUTH_ONLY_ROUTES: string[] = [
  '/api/users',
];

/**
 * Backoffice routes (admin only, separate from module access)
 */
export const BACKOFFICE_ROUTES: string[] = [
  '/api/backoffice',
];

/**
 * Check if a route should skip module checks
 */
export function shouldSkipModuleCheck(path: string): boolean {
  const policyPath = normalizeModulePolicyPath(path);
  if (ALWAYS_ALLOWED_ROUTES.some(route => policyPath === route || policyPath.startsWith(route + '/'))) {
    return true;
  }
  if (BACKOFFICE_ROUTES.some(route => policyPath.startsWith(route))) {
    return true;
  }
  return false;
}

/**
 * Get required module for a route path
 * Returns null if no module required
 */
export function getRequiredModule(path: string): string | null {
  const policyPath = normalizeModulePolicyPath(path);
  if (shouldSkipModuleCheck(policyPath)) {
    return null;
  }

  for (const [routePrefix, moduleName] of Object.entries(MODULE_ROUTE_MAP)) {
    if (policyPath === routePrefix || policyPath.startsWith(routePrefix + '/')) {
      return moduleName;
    }
  }

  return null;
}

/**
 * Module display names (for error messages)
 */
export const MODULE_DISPLAY_NAMES: Record<string, string> = {
  inventory: 'Inventory Management',
  sales: 'Sales',
  pos: 'Point of Sale',
  customers: 'Customer Management',
  purchases: 'Purchase Management',
  suppliers: 'Supplier Management',
  staff: 'Staff Management',
  reports: 'Reports & Analytics',
  business_management: 'Business Management',
  expenses: 'Expenses',
  subscription: 'Subscription & Billing',
};

export type ModuleOperation = 'read' | 'create' | 'update' | 'delete' | 'export';

/**
 * Map an HTTP request to the module operation it performs.
 * Operations match the `operations` table keys used by role_permissions_v2.
 * Explicitly named export/download routes resolve to 'export'; everything else
 * is derived from the HTTP method. Returns null when no operation applies.
 */
export function resolveModuleOperation(method: string, path: string): ModuleOperation | null {
  const m = String(method || '').toUpperCase();
  const p = String(path || '');

  // Explicit export endpoints (e.g. /api/reports/export/...)
  if (/\/export(\/|$)/i.test(p) || /\/download(\/|$)/i.test(p)) {
    return 'export';
  }

  if (m === 'POST') return 'create';
  if (m === 'PUT' || m === 'PATCH') return 'update';
  if (m === 'DELETE') return 'delete';
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return 'read';
  return null;
}
