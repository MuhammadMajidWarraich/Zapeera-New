/**
 * Module Hierarchy Configuration
 * 
 * This file defines the complete module/page structure dynamically.
 * Changes here are immediately reflected in the frontend sidebar.
 * 
 * The API endpoint /api/modules/hierarchy serves this configuration
 * filtered by the user's role and business module settings.
 */

export interface SubModuleConfig {
  key: string;
  label: string;
  href: string;
  icon: string; // Icon name from lucide-react
  module: string; // Parent module name
  roles: string[]; // Allowed roles: OWNER, MANAGER, CASHIER, etc.
}

export interface ModuleConfig {
  module: string;
  label: string;
  icon: string;
  section: 'main' | 'management' | 'admin';
  subModules: SubModuleConfig[];
  defaultRoles: string[]; // Default roles that can access this module
  enabled?: boolean;
  disabledReason?: 'BUSINESS_TYPE' | 'SUBSCRIPTION_PLAN' | 'ROLE' | null;
}

/**
 * Complete module hierarchy - editable without frontend rebuild
 */
export const MODULE_HIERARCHY: ModuleConfig[] = [
  // ─── Dashboard ───────────────────────────────────────────────────────
  {
    module: 'dashboard',
    label: 'Dashboard',
    icon: 'LayoutDashboard',
    section: 'main',
    defaultRoles: ['OWNER', 'MANAGER', 'CASHIER'],
    subModules: [
      {
        key: 'dashboard',
        label: 'Dashboard',
        href: '/',
        icon: 'LayoutDashboard',
        module: 'dashboard',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
    ],
  },
  // ─── Sales Module ─────────────────────────────────────────────────────
  {
    module: 'sales',
    label: 'Sales',
    icon: 'ShoppingCart',
    section: 'main',
    defaultRoles: ['OWNER', 'MANAGER', 'CASHIER'],
    subModules: [
      {
        key: 'pos',
        label: 'Point of Sale',
        href: '/pos',
        icon: 'ShoppingCart',
        module: 'sales',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
      {
        key: 'invoices',
        label: 'Invoices',
        href: '/invoices',
        icon: 'FileText',
        module: 'sales',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
      {
        key: 'refunds',
        label: 'Refunds',
        href: '/refunds',
        icon: 'Receipt',
        module: 'sales',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
      {
        key: 'customers',
        label: 'Customers',
        href: '/customers',
        icon: 'Users',
        module: 'sales',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
      {
        // Wave B4. NOTE: 'promotions' is deliberately NOT a new
        // permission submodule — no module-page/role-policy rows are
        // seeded for it, so the access resolver gates it like the
        // other sales pages for OWNER and the API authorizes through
        // the existing sales.invoices resource key (see
        // route-policy.registry.ts). Route guard maps /promotions to
        // the invoices page for the same reason.
        key: 'promotions',
        label: 'Promotions',
        href: '/promotions',
        icon: 'TrendingUp',
        module: 'sales',
        roles: ['OWNER', 'MANAGER'],
      },
      {
        // Wave B5. Same treatment as 'promotions' above: 'tax-classes'
        // is deliberately NOT a new permission submodule — the API
        // authorizes through the existing sales.invoices resource key
        // (see route-policy.registry.ts) and the route guard maps
        // /tax-classes to the invoices page for the same reason.
        key: 'tax-classes',
        label: 'Tax Classes',
        href: '/tax-classes',
        icon: 'Percent',
        module: 'sales',
        roles: ['OWNER', 'MANAGER'],
      },
    ],
  },

  // ─── Inventory Module ─────────────────────────────────────────────────
  {
    module: 'inventory',
    label: 'Inventory',
    icon: 'Package',
    section: 'main',
    defaultRoles: ['OWNER', 'MANAGER', 'CASHIER'],
    subModules: [
      {
        key: 'products',
        label: 'Products',
        href: '/products',
        icon: 'Package',
        module: 'inventory',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
      {
        key: 'categories',
        label: 'Categories',
        href: '/categories',
        icon: 'Layers',
        module: 'inventory',
        roles: ['OWNER', 'MANAGER'],
      },
      {
        key: 'manufacturers',
        label: 'Manufacturers',
        href: '/manufacturers',
        icon: 'Factory',
        module: 'inventory',
        roles: ['OWNER', 'MANAGER'],
      },
      {
        key: 'shelves',
        label: 'Shelves',
        href: '/shelves',
        icon: 'LayoutGrid',
        module: 'inventory',
        roles: ['OWNER', 'MANAGER'],
      },
      {
        key: 'batches',
        label: 'Batches',
        href: '/batches',
        icon: 'Boxes',
        module: 'inventory',
        roles: ['OWNER', 'MANAGER'],
      },
    ],
  },

  // ─── Stock Takes (Wave C6 — Inventory family) ─────────────────────
  // A formal physical count is a manager-grade register of its own,
  // so it carries its own module key (stock_takes.stock-takes in the
  // route-policy registry) while sitting in the Inventory family,
  // right under the Inventory module it audits. Products ride the
  // parent inventory module; the count sessions live here.
  {
    module: 'stock_takes',
    label: 'Stock Takes',
    icon: 'ClipboardList',
    section: 'main',
    defaultRoles: ['OWNER', 'MANAGER'],
    subModules: [
      {
        key: 'stock-takes',
        label: 'Stock Takes',
        href: '/stock-takes',
        icon: 'ClipboardList',
        module: 'stock_takes',
        roles: ['OWNER', 'MANAGER'],
      },
    ],
  },

  // ─── Purchases Module ─────────────────────────────────────────────────
  {
    module: 'purchases',
    label: 'Purchases',
    icon: 'Truck',
    section: 'main',
    defaultRoles: ['OWNER', 'MANAGER'],
    subModules: [
      {
        key: 'suppliers',
        label: 'Suppliers',
        href: '/suppliers',
        icon: 'Truck',
        module: 'purchases',
        roles: ['OWNER', 'MANAGER'],
      },
      {
        key: 'order-purchase',
        label: 'Order Purchase',
        href: '/order-purchase',
        icon: 'ShoppingBag',
        module: 'purchases',
        roles: ['OWNER', 'MANAGER'],
      },
    ],
  },

  // ─── Reports Module ─────────────────────────────────────────────────────
  {
    module: 'reports',
    label: 'Reports',
    icon: 'TrendingUp',
    section: 'main',
    defaultRoles: ['OWNER', 'MANAGER'],
    subModules: [
      {
        key: 'reports',
        label: 'Reports',
        href: '/reports',
        icon: 'TrendingUp',
        module: 'reports',
        roles: ['OWNER', 'MANAGER'],
      },
      {
        key: 'advanced-reports',
        label: 'Advanced Reports',
        href: '/advanced-reports',
        icon: 'BarChart3',
        module: 'reports',
        roles: ['OWNER', 'MANAGER'],
      },
    ],
  },

  // ─── Employee Portal Module ────────────────────────────────────────────
  {
    module: 'employee_portal',
    label: 'Employee Portal',
    icon: 'Briefcase',
    section: 'main',
    defaultRoles: ['OWNER', 'MANAGER', 'CASHIER'],
    subModules: [
      {
        key: 'dashboard',
        label: 'My Dashboard',
        href: '/employee-portal',
        icon: 'LayoutDashboard',
        module: 'employee_portal',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
      {
        key: 'attendance',
        label: 'My Attendance',
        href: '/employee-portal#attendance',
        icon: 'Clock',
        module: 'employee_portal',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
      {
        key: 'shifts',
        label: 'My Shifts',
        href: '/employee-portal#shifts',
        icon: 'CalendarDays',
        module: 'employee_portal',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
      {
        key: 'profile',
        label: 'My Profile',
        href: '/employee-portal#profile',
        icon: 'User',
        module: 'employee_portal',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
      {
        key: 'notifications',
        label: 'Notifications',
        href: '/employee-portal#notifications',
        icon: 'Bell',
        module: 'employee_portal',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
    ],
  },

  // ─── Prescriptions Module (Medical/Pharmacy) ───────────────────────────
  {
    module: 'prescriptions',
    label: 'Prescriptions',
    icon: 'Stethoscope',
    section: 'main',
    defaultRoles: ['OWNER', 'MANAGER', 'CASHIER'],
    subModules: [
      {
        key: 'prescriptions',
        label: 'Prescriptions',
        href: '/prescriptions',
        icon: 'Stethoscope',
        module: 'prescriptions',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
    ],
  },

  // ─── Clinic family (Wave C4) ──────────────────────────────────────────
  // Three sibling modules, each with its own key exactly like
  // prescriptions (patients.patients / doctors.doctors /
  // appointments.appointments in the route-policy registry). They sit
  // together here so the sidebar reads as one clinic family; which
  // business types see them is the usual business-type module gate
  // (business_type_modules, backoffice-managed) — clinics enable the
  // family, everyone else can leave it off.
  {
    module: 'patients',
    label: 'Patients',
    icon: 'Users',
    section: 'main',
    defaultRoles: ['OWNER', 'MANAGER', 'CASHIER'],
    subModules: [
      {
        key: 'patients',
        label: 'Patients',
        href: '/patients',
        icon: 'Users',
        module: 'patients',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
    ],
  },
  {
    module: 'doctors',
    label: 'Doctors',
    icon: 'HeartPulse',
    section: 'main',
    defaultRoles: ['OWNER', 'MANAGER'],
    subModules: [
      {
        key: 'doctors',
        label: 'Doctors',
        href: '/doctors',
        icon: 'HeartPulse',
        module: 'doctors',
        roles: ['OWNER', 'MANAGER'],
      },
    ],
  },
  {
    module: 'appointments',
    label: 'Appointments',
    icon: 'CalendarDays',
    section: 'main',
    defaultRoles: ['OWNER', 'MANAGER', 'CASHIER'],
    subModules: [
      {
        key: 'appointments',
        label: 'Appointments',
        href: '/appointments',
        icon: 'CalendarDays',
        module: 'appointments',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
    ],
  },

  // ─── Hotel family (Wave C5) ─────────────────────────────────────────
  // Four sibling modules, each with its own key exactly like the
  // clinic family (rooms.rooms / reservations.reservations /
  // folios.folios in the route-policy registry; front_desk has no API
  // of its own — its board composes the reservations + folios APIs).
  // They sit together here so the sidebar reads as one hotel family;
  // which business types see them is the usual business-type module
  // gate (business_type_modules, backoffice-managed) — hotels enable
  // the family, everyone else can leave it off.
  {
    module: 'front_desk',
    label: 'Front Desk',
    icon: 'ConciergeBell',
    section: 'main',
    defaultRoles: ['OWNER', 'MANAGER', 'CASHIER'],
    subModules: [
      {
        key: 'front-desk',
        label: 'Front Desk',
        href: '/front-desk',
        icon: 'ConciergeBell',
        module: 'front_desk',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
    ],
  },
  {
    module: 'rooms',
    label: 'Rooms',
    icon: 'BedDouble',
    section: 'main',
    defaultRoles: ['OWNER', 'MANAGER', 'CASHIER'],
    subModules: [
      {
        key: 'rooms',
        label: 'Rooms',
        href: '/rooms',
        icon: 'BedDouble',
        module: 'rooms',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
    ],
  },
  {
    module: 'reservations',
    label: 'Reservations',
    icon: 'CalendarCheck',
    section: 'main',
    defaultRoles: ['OWNER', 'MANAGER', 'CASHIER'],
    subModules: [
      {
        key: 'reservations',
        label: 'Reservations',
        href: '/reservations',
        icon: 'CalendarCheck',
        module: 'reservations',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
    ],
  },
  {
    module: 'folios',
    label: 'Folios',
    icon: 'BookOpen',
    section: 'main',
    defaultRoles: ['OWNER', 'MANAGER', 'CASHIER'],
    subModules: [
      {
        key: 'folios',
        label: 'Folios',
        href: '/folios',
        icon: 'BookOpen',
        module: 'folios',
        roles: ['OWNER', 'MANAGER', 'CASHIER'],
      },
    ],
  },

  // ─── Business Management Module ─────────────────────────────────────────
  {
    module: 'business_management',
    label: 'Business Management',
    icon: 'Building2',
    section: 'management',
    defaultRoles: ['OWNER', 'MANAGER'],
    subModules: [
      {
        key: 'branches',
        label: 'Branches',
        href: '/branches',
        icon: 'Building2',
        module: 'business_management',
        roles: ['OWNER', 'MANAGER'],
      },
      {
        key: 'staff',
        label: 'Staff',
        href: '/staff',
        icon: 'Shield',
        module: 'business_management',
        roles: ['OWNER', 'MANAGER'],
      },
      {
        key: 'shifts',
        label: 'Shifts',
        href: '/shifts',
        icon: 'Clock',
        module: 'business_management',
        roles: ['OWNER', 'MANAGER'],
      },
    ],
  },

  // ─── Expenses Module ────────────────────────────────────────────────────
  {
    module: 'expenses',
    label: 'Expenses',
    icon: 'CreditCard',
    section: 'management',
    defaultRoles: ['OWNER', 'MANAGER'],
    subModules: [
      {
        key: 'expenses',
        label: 'Expenses',
        href: '/expenses',
        icon: 'CreditCard',
        module: 'expenses',
        roles: ['OWNER', 'MANAGER'],
      },
    ],
  },

  // ─── Subscription Module ────────────────────────────────────────────────
  {
    module: 'subscription',
    label: 'Subscription',
    icon: 'CreditCard',
    section: 'management',
    defaultRoles: ['OWNER','MANAGER','CASHIER'],
    subModules: [
      {
        key: 'subscription',
        label: 'Subscription',
        href: '/subscription',
        icon: 'CreditCard',
        module: 'subscription',
        roles: ['OWNER','MANAGER','CASHIER'],
      },
    ],
  },
];

/**
 * Get all available modules (top-level)
 */
export function getAllModules(): string[] {
  return MODULE_HIERARCHY.map(m => m.module);
}

/**
 * Get all sub-modules for a specific module
 */
export function getSubModules(moduleName: string): SubModuleConfig[] {
  const module = MODULE_HIERARCHY.find(m => m.module === moduleName);
  return module?.subModules || [];
}

/**
 * Get module config by name
 */
export function getModuleConfig(moduleName: string): ModuleConfig | undefined {
  return MODULE_HIERARCHY.find(m => m.module === moduleName);
}

/**
 * Get all sub-modules that a specific role can access
 */
export function getAccessibleSubModules(role: string): SubModuleConfig[] {
  const accessible: SubModuleConfig[] = [];
  MODULE_HIERARCHY.forEach(module => {
    module.subModules.forEach(sub => {
      if (sub.roles.includes(role)) {
        accessible.push(sub);
      }
    });
  });
  return accessible;
}

export default MODULE_HIERARCHY;
