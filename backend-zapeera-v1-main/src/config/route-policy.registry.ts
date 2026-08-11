/**
 * Complete API route policy registry (Phase 4).
 *
 * Every route under /api must be classified as one of:
 *
 *   public      — no authentication required (auth endpoints, health, public
 *                 catalog lookups, backoffice login/setup, SSE, ...)
 *   auth        — authenticated account/core endpoint, no module gate
 *                 (user account, companies, notifications, sync, ocr, ...)
 *   auth-core   — authenticated AND requires a business context; routers
 *                 additionally enforce membership/branch (core tenant infra)
 *   billing     — authenticated subscription/account-lifecycle endpoints
 *                 (reachable regardless of subscription state by design)
 *   backoffice  — platform admin portal (guarded by adminAuthenticate in the
 *                 router; public subpaths are listed explicitly)
 *   module      — tenant-protected resource: resolved to an exact
 *                 resourceKey (module.page) and enforced per HTTP operation
 *                 by the universal middleware through the canonical
 *                 authorization service
 *
 * Unknown routes (not in this registry) FAIL CLOSED in production: they
 * receive 403 UNMAPPED_ROUTE, so a newly added business endpoint can never
 * silently bypass authorization. Outside production they log a warning and
 * are allowed so the gap stays visible in dev/test output.
 *
 * The route-inventory test (tests/route-inventory.test.ts) verifies that
 * every prefix registered in server.ts is classified here.
 */

export type RoutePolicy =
  | { kind: 'public' }
  | { kind: 'auth' }
  | { kind: 'auth-core' }
  | { kind: 'billing' }
  | { kind: 'backoffice' }
  | { kind: 'module'; resourceKey: string };

interface RegistryEntry {
  prefix: string;
  policy: RoutePolicy;
}

/**
 * Longest-prefix-first so that specific public/auth subpaths override the
 * broader router prefixes (e.g. /api/auth/login before /api/auth).
 */
const ENTRIES: RegistryEntry[] = [
  // ── Auth (public subpaths; everything else under /api/auth needs a user) ─
  { prefix: '/api/auth/login', policy: { kind: 'public' } },
  { prefix: '/api/auth/register', policy: { kind: 'public' } },
  { prefix: '/api/auth/signup', policy: { kind: 'public' } },
  { prefix: '/api/auth/forgot-password', policy: { kind: 'public' } },
  { prefix: '/api/auth/verify-reset-token', policy: { kind: 'public' } },
  { prefix: '/api/auth/reset-password-with-token', policy: { kind: 'public' } },
  { prefix: '/api/auth/verify-email', policy: { kind: 'public' } },
  { prefix: '/api/auth/resend-verification', policy: { kind: 'public' } },
  { prefix: '/api/auth/check-status', policy: { kind: 'public' } },
  { prefix: '/api/auth/sse-token', policy: { kind: 'public' } },
  { prefix: '/api/auth', policy: { kind: 'auth' } },

  // ── Users (account management, platform-level) ───────────────────────────
  { prefix: '/api/users', policy: { kind: 'auth' } },

  // ── Subscription / billing (account lifecycle — reachable in any state) ─
  { prefix: '/api/subscription', policy: { kind: 'billing' } },
  { prefix: '/api/payments/manual', policy: { kind: 'auth' } },

  // ── Company / branch / invitation (tenant core) ──────────────────────────
  { prefix: '/api/companies', policy: { kind: 'auth' } },
  { prefix: '/api/branches', policy: { kind: 'auth-core' } },
  { prefix: '/api/invitations/verify', policy: { kind: 'public' } },
  { prefix: '/api/invitations', policy: { kind: 'auth-core' } },

  // ── Business type catalog (public GETs; writes are admin-guarded in router)
  { prefix: '/api/business-types', policy: { kind: 'public' } },

  // ── Module access payloads / hierarchy (tenant core) ─────────────────────
  { prefix: '/api/modules', policy: { kind: 'auth-core' } },
  { prefix: '/api/module-access', policy: { kind: 'auth' } },
  { prefix: '/api/dashboard', policy: { kind: 'auth-core' } },
  { prefix: '/api/barcodes', policy: { kind: 'auth-core' } },

  // ── Cross-module helpers / notifications / sync (authenticated) ──────────
  { prefix: '/api/notifications', policy: { kind: 'auth' } },
  { prefix: '/api/ocr', policy: { kind: 'auth' } },
  { prefix: '/api/sync', policy: { kind: 'auth' } },
  { prefix: '/api/sse', policy: { kind: 'public' } },
  { prefix: '/api/health', policy: { kind: 'public' } },

  // ── Inventory module ──────────────────────────────────────────────────────
  { prefix: '/api/inventory', policy: { kind: 'module', resourceKey: 'inventory.overview' } },
  { prefix: '/api/products', policy: { kind: 'module', resourceKey: 'inventory.products' } },
  { prefix: '/api/categories', policy: { kind: 'module', resourceKey: 'inventory.categories' } },
  { prefix: '/api/suppliers', policy: { kind: 'module', resourceKey: 'inventory.suppliers' } },
  { prefix: '/api/manufacturers', policy: { kind: 'module', resourceKey: 'inventory.manufacturers' } },
  { prefix: '/api/shelves', policy: { kind: 'module', resourceKey: 'inventory.shelves' } },
  { prefix: '/api/batches', policy: { kind: 'module', resourceKey: 'inventory.batches' } },

  // ── Sales & POS module ────────────────────────────────────────────────────
  { prefix: '/api/sales', policy: { kind: 'module', resourceKey: 'sales.invoices' } },
  { prefix: '/api/pos', policy: { kind: 'module', resourceKey: 'sales.pos' } },
  { prefix: '/api/refunds', policy: { kind: 'module', resourceKey: 'sales.refunds' } },

  // ── Customers module ──────────────────────────────────────────────────────
  { prefix: '/api/customers', policy: { kind: 'module', resourceKey: 'customers.customers' } },

  // ── Purchases module ──────────────────────────────────────────────────────
  { prefix: '/api/purchases', policy: { kind: 'module', resourceKey: 'purchases.order-purchase' } },

  // ── Staff module ──────────────────────────────────────────────────────────
  { prefix: '/api/staff', policy: { kind: 'module', resourceKey: 'staff.staff' } },
  { prefix: '/api/attendance', policy: { kind: 'module', resourceKey: 'staff.attendance' } },
  { prefix: '/api/shifts', policy: { kind: 'module', resourceKey: 'staff.shifts' } },
  { prefix: '/api/scheduled-shifts', policy: { kind: 'module', resourceKey: 'staff.shifts' } },
  { prefix: '/api/commissions', policy: { kind: 'module', resourceKey: 'staff.commissions' } },

  // ── Reports module ────────────────────────────────────────────────────────
  { prefix: '/api/reports', policy: { kind: 'module', resourceKey: 'reports.reports' } },

  // ── Business management module ────────────────────────────────────────────
  { prefix: '/api/settings', policy: { kind: 'module', resourceKey: 'business_management.settings' } },
  { prefix: '/api/billing-profiles', policy: { kind: 'module', resourceKey: 'business_management.billing' } },
  { prefix: '/api/roles', policy: { kind: 'module', resourceKey: 'business_management.roles' } },
  { prefix: '/api/admin', policy: { kind: 'module', resourceKey: 'business_management.admin' } },

  // ── Expenses module ───────────────────────────────────────────────────────
  { prefix: '/api/expenses', policy: { kind: 'module', resourceKey: 'expenses.expenses' } },

  // ── Backoffice (platform admin; router-guarded, public login/setup) ──────
  { prefix: '/api/backoffice/auth/login', policy: { kind: 'public' } },
  { prefix: '/api/backoffice/auth/setup', policy: { kind: 'public' } },
  { prefix: '/api/backoffice', policy: { kind: 'backoffice' } },
];

export function normalizePolicyPath(path: string): string {
  const withoutQuery = String(path || '').split('?')[0];
  const normalizedVersion = withoutQuery.replace(/^\/api\/v\d+(?=\/|$)/i, '/api');
  return normalizedVersion.length > 1 ? normalizedVersion.replace(/\/+$/, '') : normalizedVersion;
}

/**
 * Resolve the policy for a request path.
 * Longest matching prefix wins. Returns null when the route is unregistered
 * (must fail closed in production). The bare `/api` info endpoint is public;
 * it is handled explicitly so it can never act as a catch-all that silently
 * classifies unknown routes as public.
 */
export function resolveRoutePolicy(path: string): RoutePolicy | null {
  const policyPath = normalizePolicyPath(path);

  if (policyPath === '/api' || policyPath === '/api/v1') {
    return { kind: 'public' };
  }

  let best: RegistryEntry | null = null;
  for (const entry of ENTRIES) {
    if (policyPath === entry.prefix || policyPath.startsWith(entry.prefix + '/')) {
      if (!best || entry.prefix.length > best.prefix.length) {
        best = entry;
      }
    }
  }
  return best ? best.policy : null;
}

export const ROUTE_POLICY_REGISTRY: ReadonlyArray<{ prefix: string; policy: RoutePolicy }> = ENTRIES;

export const ALL_REGISTERED_POLICY_PREFIXES: string[] = ENTRIES.map((e) => e.prefix);
