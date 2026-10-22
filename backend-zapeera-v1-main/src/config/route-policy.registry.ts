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
  // The payment-proof ADMIN subpaths live under the tenant prefix but are
  // backoffice-cookie routes (adminAuthenticate + role guard run in the
  // router). Classified 'auth', the universal gate demanded a TENANT JWT
  // and the whole admin proof flow (list/approve/reject/screenshot) was
  // unreachable — E2E P4-7. Longest-prefix wins, so these take precedence.
  { prefix: '/api/payments/manual/admin', policy: { kind: 'backoffice' } },
  { prefix: '/api/payments/manual/screenshot', policy: { kind: 'backoffice' } },

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
  // Support tickets: authenticated, deliberately NOT module/billing gated —
  // support is how a locked-out tenant asks for help. Tenancy is enforced in
  // the controller (creator or ACTIVE member of the ticket's business).
  { prefix: '/api/support', policy: { kind: 'auth' } },
  // Public read of backoffice-managed content pages (PUBLISHED only).
  { prefix: '/api/content', policy: { kind: 'public' } },
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
  { prefix: '/api/transfers', policy: { kind: 'module', resourceKey: 'inventory.overview' } },
  // Stock-take (Wave C6): its own module key in the Inventory family
  // (stock_takes.stock-takes) — a formal count is a manager-grade
  // register of its own, not a products sub-page.
  { prefix: '/api/stock-takes', policy: { kind: 'module', resourceKey: 'stock_takes.stock-takes' } },

  // ── Sales & POS module ────────────────────────────────────────────────────
  { prefix: '/api/sales', policy: { kind: 'module', resourceKey: 'sales.invoices' } },
  { prefix: '/api/pos', policy: { kind: 'module', resourceKey: 'sales.pos' } },
  { prefix: '/api/refunds', policy: { kind: 'module', resourceKey: 'sales.refunds' } },
  // Promotions & coupons (Wave B4): invoice-money rules, so they share
  // the sales.invoices page key of the sale surface they modify (no new
  // submodule key is introduced — same precedent as transfers mapping
  // to inventory.overview). Cashiers reach POST /promotions/validate
  // through the sale-create permission they already hold; management
  // writes are additionally gated to OWNER/MANAGER in the controller.
  { prefix: '/api/promotions', policy: { kind: 'module', resourceKey: 'sales.invoices' } },
  // Tax classes (Wave B5): also invoice-money rules, so they share the
  // same sales.invoices key on the same precedent; management writes
  // are additionally gated to OWNER/MANAGER in the controller.
  { prefix: '/api/tax-classes', policy: { kind: 'module', resourceKey: 'sales.invoices' } },
  // FBR POS fiscal integration (Wave B7): fiscalizes invoices, so it
  // shares the sales.invoices key on the same precedent; config writes
  // and manual retries are additionally gated to OWNER/MANAGER in the
  // controller.
  { prefix: '/api/fbr', policy: { kind: 'module', resourceKey: 'sales.invoices' } },

  // ── Customers (sub-module of Sales in the canonical V2 hierarchy) ───────
  // There is no standalone 'customers' module in module_definitions; the
  // hierarchy models Customers as sales::customers. Mapping this prefix to
  // 'customers.customers' denied every request with BUSINESS_TYPE_DENIED.
  { prefix: '/api/customers', policy: { kind: 'module', resourceKey: 'sales.customers' } },

  // ── Purchases module ──────────────────────────────────────────────────────
  { prefix: '/api/purchases', policy: { kind: 'module', resourceKey: 'purchases.order-purchase' } },

  // ── Staff / HR (no standalone 'staff' module exists in the V2 model; ─────
  // staff pages live under business_management, attendance/shift self-service
  // under employee_portal — the same split the module hierarchy uses.
  // 'staff.*' keys could never resolve and denied every request.)
  { prefix: '/api/staff', policy: { kind: 'module', resourceKey: 'business_management.staff' } },
  { prefix: '/api/attendance', policy: { kind: 'module', resourceKey: 'employee_portal.attendance' } },
  { prefix: '/api/shifts', policy: { kind: 'module', resourceKey: 'business_management.shifts' } },
  { prefix: '/api/scheduled-shifts', policy: { kind: 'module', resourceKey: 'employee_portal.shifts' } },
  { prefix: '/api/commissions', policy: { kind: 'module', resourceKey: 'business_management.staff' } },

  // ── Reports module ────────────────────────────────────────────────────────
  { prefix: '/api/reports', policy: { kind: 'module', resourceKey: 'reports.reports' } },

  // ── Business management module ────────────────────────────────────────────
  { prefix: '/api/settings', policy: { kind: 'module', resourceKey: 'business_management.settings' } },
  { prefix: '/api/billing-profiles', policy: { kind: 'module', resourceKey: 'business_management.billing' } },
  { prefix: '/api/roles', policy: { kind: 'module', resourceKey: 'business_management.roles' } },
  { prefix: '/api/admin', policy: { kind: 'module', resourceKey: 'business_management.admin' } },

  // ── Expenses module ───────────────────────────────────────────────────────
  { prefix: '/api/expenses', policy: { kind: 'module', resourceKey: 'expenses.expenses' } },

  // ── Prescriptions module (Wave C1 — Pharmacy pack) ───────────────────
  // Its own module key (prescriptions.prescriptions), declared in the
  // hierarchy + MODULE_PAGES from early on; the API arrives in C1.
  { prefix: '/api/prescriptions', policy: { kind: 'module', resourceKey: 'prescriptions.prescriptions' } },

  // ── Clinic pack (Wave C4) ────────────────────────────────────────────
  // Three sibling modules (the Clinic family), each with its own key
  // exactly like prescriptions: patients.patients, doctors.doctors,
  // appointments.appointments. Declared in the module hierarchy +
  // MODULE_PAGES in the same wave as their APIs.
  { prefix: '/api/patients', policy: { kind: 'module', resourceKey: 'patients.patients' } },
  { prefix: '/api/doctors', policy: { kind: 'module', resourceKey: 'doctors.doctors' } },
  { prefix: '/api/appointments', policy: { kind: 'module', resourceKey: 'appointments.appointments' } },

  // ── Hotel pack (Wave C5) ─────────────────────────────────────────────
  // Four sibling modules (the Hotel family), each with its own key
  // exactly like the clinic pack: rooms.rooms, reservations.
  // reservations, folios.folios. Room types ride the rooms module
  // (a room type is rooms configuration, not its own register). The
  // Front Desk board has no API of its own — it composes the
  // reservations + folios endpoints — so it needs no entry here.
  { prefix: '/api/room-types', policy: { kind: 'module', resourceKey: 'rooms.rooms' } },
  { prefix: '/api/rooms', policy: { kind: 'module', resourceKey: 'rooms.rooms' } },
  { prefix: '/api/reservations', policy: { kind: 'module', resourceKey: 'reservations.reservations' } },
  { prefix: '/api/folios', policy: { kind: 'module', resourceKey: 'folios.folios' } },

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
