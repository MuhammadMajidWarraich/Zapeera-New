/**
 * MODULE HIERARCHY — Static canonical config
 *
 * Layer 1 (Structure): Defines every group and every page in the system.
 * Layer 2 (Module gate): Each entry carries the module key it belongs to.
 *   The business must have that module enabled (from DB via getEnabledModules)
 *   for the entry to appear.
 * Layer 3 (Role gate): Each entry declares which roles can see it.
 *
 * Rendering logic (applied in RoleBasedSidebar):
 *   visible = isModuleEnabled(entry.module) && userRole is in entry.roles
 *
 * Canonical module keys (must match DB modules.name):
 *   sales | inventory | customers | suppliers | purchases |
 *   business_management | expenses | reports | advanced_reports | subscription
 *
 * Special key:
 *   "dashboard" — always enabled (no DB gate needed)
 */

import {
  LayoutDashboard,
  ShoppingCart,
  FileText,
  Receipt,
  TicketPercent,
  Percent,
  Package,
  Building2,
  UserCog,
  Clock,
  Wallet,
  Gift,
  Users,
  BarChart3,
  CreditCard,
  Monitor,
  Settings,
  Briefcase,
  CalendarDays,
  User,
  Bell,
  Stethoscope,
  Store,
  HeartPulse,
  BedDouble,
  CalendarCheck,
  BookOpen,
  ConciergeBell,
  ClipboardList,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type AppRole = 'OWNER' | 'MANAGER' | 'CASHIER';

export interface ModulePage {
  /** Unique key for this page — also used as the path segment */
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
  /** Module this page belongs to. undefined = always visible (e.g. Dashboard) */
  module?: string;
  /** Roles that can see this page. If the role is not listed, the page is hidden. */
  roles: AppRole[];
}

export interface ModuleGroup {
  /** Canonical module key from DB. undefined = always visible group. */
  module?: string;
  label: string;
  icon: LucideIcon;
  /** Section in the sidebar ("main" | "management" | "admin") */
  section: 'main' | 'management' | 'admin';
  /** Roles that can see this group at all. */
  roles: AppRole[];
  pages: ModulePage[];
  enabled?: boolean;
  disabledReason?: 'BUSINESS_TYPE' | 'SUBSCRIPTION_PLAN' | 'ROLE' | null;
}

/**
 * The full static hierarchy.
 * Order here determines sidebar order.
 */
export const MODULE_HIERARCHY: ModuleGroup[] = [
  // ─── Always-visible ───────────────────────────────────────────────────
  {
    // module: 'dashboard' — the backend hierarchy + RoleBasedSidebar.ensureDashboard
    // both identify the dashboard by exactly this key. Keeping it set here makes
    // the static fallback consistent so the dashboard is never rendered twice.
    module: 'dashboard',
    label: 'Dashboard',
    icon: LayoutDashboard,
    section: 'main',
    roles: ['OWNER', 'MANAGER', 'CASHIER'],
    pages: [
      {
        key: 'dashboard',
        label: 'Dashboard',
        href: '/',
        icon: LayoutDashboard,
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
    ],
  },

  // ─── Sales ────────────────────────────────────────────────────────────
  {
    module: 'sales',
    label: 'Sales',
    icon: ShoppingCart,
    section: 'main',
    roles: ['OWNER', 'MANAGER', 'CASHIER'],
    pages: [
      {
        key: 'pos',
        label: 'Point of Sale',
        href: '/point-of-sale',
        icon: ShoppingCart,
        module: 'sales',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
      {
        key: 'invoices',
        label: 'Invoices',
        href: '/invoices',
        icon: FileText,
        module: 'sales',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
      {
        key: 'refunds',
        label: 'Refunds',
        href: '/refunds',
        icon: Receipt,
        module: 'sales',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
      {
        // Promotions & coupons (Wave B4) — managed by OWNER/MANAGER;
        // the page itself also opens read-only for sales roles via
        // the ModuleGuard's invoices mapping.
        key: 'promotions',
        label: 'Promotions',
        href: '/promotions',
        icon: TicketPercent,
        module: 'sales',
        roles: ['OWNER', 'MANAGER'],
      },
      {
        // Tax classes (Wave B5) — managed by OWNER/MANAGER next to
        // Promotions; guarded like the other sales pages via the
        // ModuleGuard's invoices mapping.
        key: 'tax-classes',
        label: 'Tax Classes',
        href: '/tax-classes',
        icon: Percent,
        module: 'sales',
        roles: ['OWNER', 'MANAGER'],
      },
      {
        // Gift Cards & Wallet (Wave C9 — gap item 9): sell gift cards,
        // top up wallets, work the kiosk orders queue. Guarded via
        // the ModuleGuard's POS mapping; voids are OWNER/MANAGER
        // enforced by the API.
        key: 'gift-cards',
        label: 'Gift Cards & Wallet',
        href: '/gift-cards',
        icon: Gift,
        module: 'sales',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
    ],
  },

  // ─── Customers ────────────────────────────────────────────────────────
  {
    module: 'customers',
    label: 'Customers',
    icon: Users,
    section: 'main',
    roles: ['OWNER', 'MANAGER', 'CASHIER'],
    pages: [
      {
        key: 'customers',
        label: 'Customers',
        href: '/customers',
        icon: Users,
        module: 'customers',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
    ],
  },

  // ─── Inventory ────────────────────────────────────────────────────────
  {
    module: 'inventory',
    label: 'Inventory',
    icon: Package,
    section: 'main',
    roles: ['OWNER', 'MANAGER'],
    pages: [
      {
        key: 'products',
        label: 'All Products',
        href: '/products',
        icon: Package,
        module: 'inventory',
        roles: ['OWNER', 'MANAGER'],
      },
      {
        key: 'categories',
        label: 'Categories',
        href: '/categories',
        icon: Package,
        module: 'inventory',
        roles: ['OWNER', 'MANAGER'],
      },
      {
        key: 'manufacturers',
        label: 'Manufacturers',
        href: '/manufacturers',
        icon: Building2,
        module: 'inventory',
        roles: ['OWNER', 'MANAGER'],
      },
      {
        key: 'shelves',
        label: 'Shelves',
        href: '/shelves',
        icon: Package,
        module: 'inventory',
        roles: ['OWNER', 'MANAGER'],
      },
      {
        key: 'batches',
        label: 'Batches',
        href: '/batches',
        icon: Package,
        module: 'inventory',
        roles: ['OWNER', 'MANAGER'],
      },
    ],
  },

  // ─── Stock Takes (Wave C6 — Inventory family) ─────────────────────
  // Own module key (stock_takes), mirroring the backend hierarchy:
  // a formal count is a manager-grade register of its own.
  {
    module: 'stock_takes',
    label: 'Stock Takes',
    icon: ClipboardList,
    section: 'main',
    roles: ['OWNER', 'MANAGER'],
    pages: [
      {
        key: 'stock-takes',
        label: 'Stock Takes',
        href: '/stock-takes',
        icon: ClipboardList,
        module: 'stock_takes',
        roles: ['OWNER', 'MANAGER'],
      },
    ],
  },

  // ─── Purchases ────────────────────────────────────────────────────────
  {
    module: 'purchases',
    label: 'Purchases',
    icon: ShoppingCart,
    section: 'main',
    roles: ['OWNER', 'MANAGER'],
    pages: [
      {
        key: 'order-purchase',
        label: 'Order Purchase',
        href: '/order-purchase',
        icon: ShoppingCart,
        module: 'purchases',
        roles: ['OWNER', 'MANAGER'],
      },
      {
        key: 'reorder-suggestions',
        label: 'Reorder Suggestions',
        href: '/reorder-suggestions',
        icon: ShoppingCart,
        module: 'purchases',
        roles: ['OWNER', 'MANAGER'],
      },
      {
        key: 'purchase-suggestions',
        label: 'Purchase Suggestions',
        href: '/purchase-suggestions',
        icon: ShoppingCart,
        module: 'purchases',
        roles: ['OWNER', 'MANAGER'],
      },
    ],
  },

  // ─── Suppliers ────────────────────────────────────────────────────────
  {
    module: 'suppliers',
    label: 'Suppliers',
    icon: Building2,
    section: 'main',
    roles: ['OWNER', 'MANAGER'],
    pages: [
      {
        key: 'suppliers',
        label: 'Suppliers',
        href: '/suppliers',
        icon: Building2,
        module: 'suppliers',
        roles: ['OWNER', 'MANAGER'],
      },
    ],
  },

  // ─── Employee Portal ───────────────────────────────────────────────────
  {
    module: 'employee_portal',
    label: 'Employee Portal',
    icon: Briefcase,
    section: 'main',
    roles: ['OWNER', 'MANAGER', 'CASHIER'],
    pages: [
      {
        key: 'dashboard',
        label: 'My Dashboard',
        href: '/employee-portal',
        icon: LayoutDashboard,
        module: 'employee_portal',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
      {
        key: 'attendance',
        label: 'My Attendance',
        href: '/employee-portal#attendance',
        icon: Clock,
        module: 'employee_portal',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
      {
        key: 'shifts',
        label: 'My Shifts',
        href: '/employee-portal#shifts',
        icon: CalendarDays,
        module: 'employee_portal',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
      {
        key: 'profile',
        label: 'My Profile',
        href: '/employee-portal#profile',
        icon: User,
        module: 'employee_portal',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
      {
        key: 'notifications',
        label: 'Notifications',
        href: '/employee-portal#notifications',
        icon: Bell,
        module: 'employee_portal',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
    ],
  },

  // ─── Prescriptions (Pharmacy) ───────────────────────────────────────
  // The module key + guard mappings existed long before the page did
  // (Wave C1 finally builds it). Placement mirrors the backend
  // hierarchy: main section, after Employee Portal.
  {
    module: 'prescriptions',
    label: 'Prescriptions',
    icon: Stethoscope,
    section: 'main',
    roles: ['OWNER', 'MANAGER', 'CASHIER'],
    pages: [
      {
        key: 'prescriptions',
        label: 'Prescriptions',
        href: '/prescriptions',
        icon: Stethoscope,
        module: 'prescriptions',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
      // Online store (Wave C5 — gap item 5): staff home for the
      // public storefront — store links, online-orders queue and the
      // prescription review queue. Same module as Prescriptions.
      {
        key: 'online-store',
        label: 'Online Store',
        href: '/online-store',
        icon: Store,
        module: 'prescriptions',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
    ],
  },

  // ─── Clinic family (Wave C4) ────────────────────────────────────────
  // Three sibling modules with their own keys, exactly like
  // Prescriptions — Patients, Doctors, Appointments. Placement mirrors
  // the backend hierarchy: main section, right after Prescriptions,
  // so the sidebar reads as one clinic family. Visibility is the
  // business-type module gate (clinics enable the family).
  {
    module: 'patients',
    label: 'Patients',
    icon: Users,
    section: 'main',
    roles: ['OWNER', 'MANAGER', 'CASHIER'],
    pages: [
      {
        key: 'patients',
        label: 'Patients',
        href: '/patients',
        icon: Users,
        module: 'patients',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
    ],
  },
  {
    module: 'doctors',
    label: 'Doctors',
    icon: HeartPulse,
    section: 'main',
    roles: ['OWNER', 'MANAGER'],
    pages: [
      {
        key: 'doctors',
        label: 'Doctors',
        href: '/doctors',
        icon: HeartPulse,
        module: 'doctors',
        roles: ['OWNER', 'MANAGER'],
      },
    ],
  },
  {
    module: 'appointments',
    label: 'Appointments',
    icon: CalendarDays,
    section: 'main',
    roles: ['OWNER', 'MANAGER', 'CASHIER'],
    pages: [
      {
        key: 'appointments',
        label: 'Appointments',
        href: '/appointments',
        icon: CalendarDays,
        module: 'appointments',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
    ],
  },

  // ─── Hotel family (Wave C5) ─────────────────────────────────────────
  // Four sibling modules with their own keys, exactly like the Clinic
  // family — Front Desk (the day board), Rooms (with room types),
  // Reservations, Folios. Placement mirrors the backend hierarchy:
  // main section, right after the Clinic family, so the sidebar reads
  // as one hotel family. Visibility is the business-type module gate
  // (hotels enable the family).
  {
    module: 'front_desk',
    label: 'Front Desk',
    icon: ConciergeBell,
    section: 'main',
    roles: ['OWNER', 'MANAGER', 'CASHIER'],
    pages: [
      {
        key: 'front-desk',
        label: 'Front Desk',
        href: '/front-desk',
        icon: ConciergeBell,
        module: 'front_desk',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
    ],
  },
  {
    module: 'rooms',
    label: 'Rooms',
    icon: BedDouble,
    section: 'main',
    roles: ['OWNER', 'MANAGER', 'CASHIER'],
    pages: [
      {
        key: 'rooms',
        label: 'Rooms',
        href: '/rooms',
        icon: BedDouble,
        module: 'rooms',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
    ],
  },
  {
    module: 'reservations',
    label: 'Reservations',
    icon: CalendarCheck,
    section: 'main',
    roles: ['OWNER', 'MANAGER', 'CASHIER'],
    pages: [
      {
        key: 'reservations',
        label: 'Reservations',
        href: '/reservations',
        icon: CalendarCheck,
        module: 'reservations',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
    ],
  },
  {
    module: 'folios',
    label: 'Folios',
    icon: BookOpen,
    section: 'main',
    roles: ['OWNER', 'MANAGER', 'CASHIER'],
    pages: [
      {
        key: 'folios',
        label: 'Folios',
        href: '/folios',
        icon: BookOpen,
        module: 'folios',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
    ],
  },

  // ─── Reports & Analytics ──────────────────────────────────────────────
  {
    module: 'reports',
    label: 'Reports & Analytics',
    icon: BarChart3,
    section: 'management',
    roles: ['OWNER', 'MANAGER'],
    pages: [
      {
        key: 'basic_reports',
        label: 'Basic Reports',
        href: '/reports',
        icon: BarChart3,
        module: 'reports',
        roles: ['OWNER', 'MANAGER'],
      },
      {
        key: 'advanced_reports',
        label: 'Advanced Reports',
        href: '/advanced-reports',
        icon: BarChart3,
        module: 'advanced_reports',
        roles: ['OWNER', 'MANAGER'],
      },
      {
        key: 'aging_reports',
        label: 'Aging Reports',
        href: '/aging-reports',
        icon: BarChart3,
        module: 'reports',
        roles: ['OWNER', 'MANAGER'],
      },
      {
        key: 'accounting',
        label: 'Accounting',
        href: '/accounting',
        icon: BarChart3,
        module: 'reports',
        roles: ['OWNER', 'MANAGER'],
      },
    ],
  },

  // ─── Business Management ──────────────────────────────────────────────
  {
    module: 'business_management',
    label: 'Management',
    icon: UserCog,
    section: 'management',
    roles: ['OWNER', 'MANAGER'],
    pages: [
      {
        key: 'branches',
        label: 'Branches',
        href: '/branches',
        icon: Building2,
        module: 'business_management',
        roles: ['OWNER'],
      },
      {
        key: 'staff',
        label: 'Staff',
        href: '/staff',
        icon: UserCog,
        module: 'business_management',
        roles: ['OWNER', 'MANAGER'],
      },
      {
        key: 'shifts',
        label: 'Shifts',
        href: '/shifts',
        icon: Clock,
        module: 'business_management',
        roles: ['OWNER', 'MANAGER'],
      },
      {
        key: 'settings',
        label: 'Business Settings',
        href: '/settings',
        icon: Settings,
        module: 'business_management',
        roles: ['OWNER', 'MANAGER'],
      },
    ],
  },

  // ─── Expenses ─────────────────────────────────────────────────────────
  {
    module: 'expenses',
    label: 'Expenses',
    icon: Wallet,
    section: 'management',
    roles: ['OWNER', 'MANAGER'],
    pages: [
      {
        key: 'expenses',
        label: 'Expenses',
        href: '/expenses',
        icon: Wallet,
        module: 'expenses',
        roles: ['OWNER', 'MANAGER'],
      },
    ],
  },

  // ─── Subscription ─────────────────────────────────────────────────────
  {
    label: 'Subscription',
    icon: CreditCard,
    section: 'management',
     roles: ['OWNER', 'MANAGER', 'CASHIER'],
    pages: [
      {
        key: 'subscription',
        label: 'Subscription & Billing',
        href: '/subscription',
        icon: CreditCard,
         roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
    ],
  },
];

/**
 * Filter the full hierarchy down to what a given user can see.
 * 
 * Logic:
 * - Modules not allowed for business type: HIDDEN completely
 * - Modules not allowed for user role: HIDDEN completely
 * - Modules allowed for business type and user role, but not allowed in subscription plan: SHOWN with LOCK icon
 * - Modules allowed for business type, user role, and subscription plan: SHOWN without lock
 * - Sub-modules denied by plan: SHOWN with LOCK icon (upsell opportunity)
 * - Sub-modules denied by business type or role: HIDDEN
 *
 * @param enabledModules  Map of moduleName → {enabled: boolean, label: string} from useBusinessModules
 * @param userRole        Effective role of the current user
 * @param disabledSubModules Set of disabled submodule keys (format: "module::submodule") — legacy flat set
 * @param subModuleStateMap Optional Map of "module::sub" → {enabled, disabledReason} for per-sub-module denial reasons
 */
export function filterHierarchy(
  enabledModules: Record<string, { enabled: boolean; label: string; icon?: string; disabledReason?: 'BUSINESS_TYPE' | 'SUBSCRIPTION_PLAN' | 'ROLE' | null }>,
  userRole: string,
  disabledSubModules?: Set<string> | string[],
  subModuleStateMap?: Map<string, { enabled: boolean; disabledReason?: 'BUSINESS_TYPE' | 'SUBSCRIPTION_PLAN' | 'ROLE' | 'PARENT_MODULE' | null }>,
): ModuleGroup[] {
  const role = userRole as AppRole;
  const disabledSet =
    disabledSubModules instanceof Set
      ? disabledSubModules
      : new Set((disabledSubModules || []).map((s) => String(s).toLowerCase()));

  const isPageAllowed = (pageModule: string | undefined, pageKey: string) => {
    if (!pageModule) return true;
    const composite = `${pageModule.toLowerCase()}::${pageKey.toLowerCase()}`;

    // Use per-sub-module state map if available (denial-reason-aware)
    if (subModuleStateMap) {
      const state = subModuleStateMap.get(composite);
      if (state) {
        // Hide if denied by business type, role, or parent
        if (!state.enabled && state.disabledReason !== 'SUBSCRIPTION_PLAN') return false;
        // Show if enabled or plan-locked (will render with lock icon)
        return true;
      }
      // No explicit entry — check flat set as fallback
      return !disabledSet.has(composite);
    }

    // Legacy flat set fallback
    return !disabledSet.has(composite);
  };

  const isPagePlanLocked = (pageModule: string | undefined, pageKey: string): boolean => {
    if (!pageModule || !subModuleStateMap) return false;
    const composite = `${pageModule.toLowerCase()}::${pageKey.toLowerCase()}`;
    const state = subModuleStateMap.get(composite);
    return Boolean(state && !state.enabled && state.disabledReason === 'SUBSCRIPTION_PLAN');
  };

  const getModuleState = (moduleKey: string | undefined) => {
    if (!moduleKey) return { enabled: true, disabledReason: null };
    return enabledModules[moduleKey.toLowerCase()] || { enabled: false, disabledReason: null };
  };

  return MODULE_HIERARCHY
    .filter((group) => {
      // V2 backend evaluation is the source of truth for module access.
      if (!group.module) return true;

      const moduleState = getModuleState(group.module);
      if (!moduleState.enabled && moduleState.disabledReason !== 'SUBSCRIPTION_PLAN') {
        return false;
      }

      return true;
    })
    .map((group) => {
      const moduleState = getModuleState(group.module);
      const pages = group.pages.filter((page) => {
        if (!isPageAllowed(page.module, page.key)) return false;
        // NOTE: no static roles[] filtering here. Role access is decided
        // ONLY by the server payload (business type x plan x role,
        // including Backoffice matrix toggles). The hardcoded roles[]
        // lists in MODULE_HIERARCHY are display metadata; using them as a
        // gate let the sidebar disagree with the API (Round-2 sync fix).

        const pageModuleState = getModuleState(page.module);
        if (!pageModuleState.enabled && pageModuleState.disabledReason !== 'SUBSCRIPTION_PLAN') {
          return false;
        }

        return true;
      });

      return {
        ...group,
        enabled: moduleState.enabled,
        disabledReason: moduleState.disabledReason,
        pages,
      };
    })
    .filter((group) => {
      return group.pages.length > 0;
    });
}
