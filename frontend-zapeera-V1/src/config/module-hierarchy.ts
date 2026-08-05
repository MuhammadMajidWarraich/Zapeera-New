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
  Package,
  Building2,
  UserCog,
  Clock,
  Wallet,
  Users,
  BarChart3,
  CreditCard,
  Monitor,
  Settings,
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
        if (!page.roles.includes(role)) return false;

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
