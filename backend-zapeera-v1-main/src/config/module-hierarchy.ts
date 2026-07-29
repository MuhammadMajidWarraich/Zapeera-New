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
