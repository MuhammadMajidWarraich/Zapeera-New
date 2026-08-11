/**
 * Module Route Protection Configuration
 * Maps API routes to required module + page + operation for access control.
 *
 * SECURITY: This is the authoritative mapping of which module AND page are
 * required for each route group. Backend middleware enforces both — a role
 * with `create` on one page of a module is NOT granted `create` on another
 * page of the same module.
 *
 * Modules in the system (from `modules` table):
 *   pos, sales, inventory, suppliers, customers, purchases,
 *   staff, reports, business_management, expenses, subscription
 */

/**
 * Pages available per module. Used to:
 *   - seed module_pages at startup (see modules-v2.util.ts),
 *   - resolve the page for a route (MODULE_PAGE_ROUTE_MAP),
 *   - enforce per-page operation permissions.
 */
export const MODULE_PAGES: Record<string, string[]> = {
  inventory: ['overview', 'products', 'categories', 'manufacturers', 'shelves', 'batches', 'suppliers'],
  sales: ['overview', 'pos', 'invoices', 'refunds'],
  pos: ['overview', 'pos'],
  customers: ['overview', 'customers'],
  purchases: ['overview', 'suppliers', 'order-purchase'],
  staff: ['overview', 'staff', 'attendance', 'shifts', 'commissions'],
  reports: ['overview', 'reports', 'advanced-reports'],
  business_management: ['overview', 'branches', 'staff', 'shifts', 'settings', 'billing', 'roles', 'admin'],
  expenses: ['overview', 'expenses'],
  subscription: ['overview', 'subscription'],
  prescriptions: ['overview', 'prescriptions'],
  employee_portal: ['overview', 'dashboard', 'attendance', 'shifts', 'profile', 'notifications'],
  dashboard: ['overview', 'dashboard'],
};

/**
 * Authoritative route → { module, page } mapping.
 * Page keys MUST come from MODULE_PAGES[module].
 * New business-scoped endpoints MUST be added here (see route-inventory test).
 */
export const MODULE_PAGE_ROUTE_MAP: Record<string, { module: string; page: string }> = {
  // Inventory Management (products, batches, shelves, categories, manufacturers)
  '/api/inventory': { module: 'inventory', page: 'overview' },
  '/api/products': { module: 'inventory', page: 'products' },
  '/api/batches': { module: 'inventory', page: 'batches' },
  '/api/shelves': { module: 'inventory', page: 'shelves' },
  '/api/categories': { module: 'inventory', page: 'categories' },
  '/api/suppliers': { module: 'inventory', page: 'suppliers' },
  '/api/manufacturers': { module: 'inventory', page: 'manufacturers' },

  // Sales & POS
  '/api/sales': { module: 'sales', page: 'invoices' },
  '/api/pos': { module: 'sales', page: 'pos' },
  '/api/refunds': { module: 'sales', page: 'refunds' },
  '/api/customers': { module: 'customers', page: 'customers' },

  // Purchases
  '/api/purchases': { module: 'purchases', page: 'order-purchase' },

  // Staff Management (employees, attendance, shifts, commissions)
  '/api/staff': { module: 'staff', page: 'staff' },
  '/api/attendance': { module: 'staff', page: 'attendance' },
  '/api/shifts': { module: 'staff', page: 'shifts' },
  '/api/scheduled-shifts': { module: 'staff', page: 'shifts' },
  '/api/commissions': { module: 'staff', page: 'commissions' },

  // Reports & Analytics
  '/api/reports': { module: 'reports', page: 'reports' },

  // Business Management (settings, roles, billing, admin)
  '/api/settings': { module: 'business_management', page: 'settings' },
  '/api/billing-profiles': { module: 'business_management', page: 'billing' },
  '/api/roles': { module: 'business_management', page: 'roles' },
  '/api/admin': { module: 'business_management', page: 'admin' },

  // Expenses
  '/api/expenses': { module: 'expenses', page: 'expenses' },
};

/**
 * Backward-compatible module-level map (route prefix → module key).
 * Derived from MODULE_PAGE_ROUTE_MAP — kept for callers that only need the
 * module, never hand-edited.
 */
export const MODULE_ROUTE_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(MODULE_PAGE_ROUTE_MAP).map(([prefix, { module }]) => [prefix, module])
);

/**
 * Routes that are ALWAYS accessible (no module check required).
 * These are core system routes needed for basic app functionality.
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

  // Documented bootstrap exceptions (no module gate yet; auth still applies):
  //   - dashboard: cross-module aggregation used before module gating
  //   - ocr / notifications / barcodes: cross-module helpers
  '/api/dashboard',
  '/api/ocr',
  '/api/notifications',
  '/api/barcodes',

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
 * Route classification used by the fail-closed gate (Issue 5):
 *   - 'bootstrap'  : public/core infrastructure (health, auth, companies…)
 *   - 'auth-only'  : authenticated but no module gate
 *   - 'backoffice' : platform admin portal
 *   - 'business'   : business-scoped, module + page policy required
 * Returns null when the route has NO explicit policy (must fail closed in
 * production so newly added business endpoints can never bypass gating).
 */
export type RouteClassification = 'bootstrap' | 'auth-only' | 'backoffice' | 'business';

export function classifyRoute(path: string): RouteClassification | null {
  const policyPath = normalizeModulePolicyPath(path);

  // Exact API roots serve the API info endpoint — bootstrap.
  if (policyPath === '/api') {
    return 'bootstrap';
  }

  if (BACKOFFICE_ROUTES.some((route) => policyPath === route || policyPath.startsWith(route + '/'))) {
    return 'backoffice';
  }
  if (ALWAYS_ALLOWED_ROUTES.some((route) => policyPath === route || policyPath.startsWith(route + '/'))) {
    return 'bootstrap';
  }
  if (AUTH_ONLY_ROUTES.some((route) => policyPath === route || policyPath.startsWith(route + '/'))) {
    return 'auth-only';
  }
  if (Object.keys(MODULE_PAGE_ROUTE_MAP).some((route) => policyPath === route || policyPath.startsWith(route + '/'))) {
    return 'business';
  }
  return null;
}

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

  for (const [routePrefix, { module }] of Object.entries(MODULE_PAGE_ROUTE_MAP)) {
    if (policyPath === routePrefix || policyPath.startsWith(routePrefix + '/')) {
      return module;
    }
  }

  return null;
}

/**
 * Get the required module PAGE for a route path.
 * Returns null when no page policy applies (no module / skipped route).
 * Pages align with MODULE_PAGES[module] and module_pages rows in the DB.
 */
export function getRequiredPage(path: string): string | null {
  const policyPath = normalizeModulePolicyPath(path);
  if (!getRequiredModule(policyPath)) {
    return null;
  }

  for (const [routePrefix, { page }] of Object.entries(MODULE_PAGE_ROUTE_MAP)) {
    if (policyPath === routePrefix || policyPath.startsWith(routePrefix + '/')) {
      return page;
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

export type ModuleOperation = 'read' | 'create' | 'update' | 'delete' | 'export' | 'approve' | 'print';

/**
 * Map an HTTP request to the module operation it performs.
 * Operations match the `operations` table keys used by role_permissions_v2.
 * Explicitly named export/download/approve/print routes resolve to their
 * operation; everything else is derived from the HTTP method. Returns null
 * when no operation applies.
 */
export function resolveModuleOperation(method: string, path: string): ModuleOperation | null {
  const m = String(method || '').toUpperCase();
  const p = String(path || '');

  // Explicit operation endpoints (must be checked before method fallback).
  if (/\/export(\/|$)/i.test(p) || /\/download(\/|$)/i.test(p)) {
    return 'export';
  }
  if (/\/approve(\/|$)/i.test(p)) {
    return 'approve';
  }
  if (/\/print(\/|$)/i.test(p)) {
    return 'print';
  }

  if (m === 'POST') return 'create';
  if (m === 'PUT' || m === 'PATCH') return 'update';
  if (m === 'DELETE') return 'delete';
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return 'read';
  return null;
}
