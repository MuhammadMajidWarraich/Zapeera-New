import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useBusinessModules } from '@/hooks/useBusinessModules';
import { useModuleAccessGuard } from '@/hooks/useModuleAccessGuard';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

interface ModuleGuardProps {
  moduleName: string;
  children: React.ReactNode;
}

interface SubModuleGuardProps {
  parentModule: string;
  subModuleKey: string;
  label?: string;
  children: React.ReactNode;
}

/**
 * SubModuleGuard - Protects routes based on sub-module access
 *
 * Checks if a specific sub-module (e.g., POS within Sales) is accessible.
 * Uses the same deny-wins intersection model:
 * - Business Type allows sub-module?
 * - Plan entitles sub-module?
 * - Role allows sub-module?
 * - Parent module accessible?
 */
export const SubModuleGuard: React.FC<SubModuleGuardProps> = ({ parentModule, subModuleKey, label, children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isSubModuleLocked, loading } = useBusinessModules();
  const { user } = useAuth();
  const [isChecking, setIsChecking] = useState(true);
  const [isLocked, setIsLocked] = useState(false);

  useEffect(() => {
    if (loading) {
      setIsChecking(false);
      return;
    }

    if (parentModule && subModuleKey && isSubModuleLocked(parentModule, subModuleKey)) {
      setIsLocked(true);
      setIsChecking(false);
      toast.error('Feature Not Available', {
        description: `${label || subModuleKey} isn't included in your current plan. Upgrade your subscription to access this feature.`,
        action: {
          label: 'Upgrade',
          onClick: () => {
            const slugMatch = location.pathname.match(/^\/business\/([^\/]+)/);
            const upgradePath = slugMatch
              ? `/business/${encodeURIComponent(slugMatch[1])}/subscription`
              : '/zapeera/my-businesses';
            window.location.href = upgradePath;
          },
        },
        duration: 6000,
      });
    } else {
      setIsLocked(false);
      setIsChecking(false);
    }
  }, [parentModule, subModuleKey, isSubModuleLocked, loading, label, location.pathname]);

  if (isChecking || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-muted-foreground">Checking access...</p>
        </div>
      </div>
    );
  }

  if (isLocked) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="mb-4">
            <svg
              className="mx-auto h-12 w-12 text-muted-foreground"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-2">Feature Not Available</h3>
          <p className="text-muted-foreground mb-4">
            {label || subModuleKey} isn't included in your current subscription plan.
            Upgrade your subscription to access this feature.
          </p>
          <div className="space-x-2">
            <button
              onClick={() => navigate(-1)}
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary/90"
            >
              Go Back
            </button>
            <button
              onClick={() => {
                const slugMatch = location.pathname.match(/^\/business\/([^\/]+)/);
                const upgradePath = slugMatch
                  ? `/business/${encodeURIComponent(slugMatch[1])}/subscription`
                  : '/zapeera/my-businesses';
                window.location.href = upgradePath;
              }}
              className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
            >
              View Plans
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

/**
 * ModuleGuard - Protects routes based on module access
 * 
 * Enforces three-layer access control:
 * 1. Business Type Modules (configured by Super Admin)
 * 2. Subscription Plan Modules
 * 3. User Role Permissions
 * 
 * Only modules present in the intersection of all three are accessible.
 */
export const ModuleGuard: React.FC<ModuleGuardProps> = ({ moduleName, children }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isModuleLocked, guardModule, getModuleDisabledReason, loading } = useModuleAccessGuard();
  const { user } = useAuth();
  const [isChecking, setIsChecking] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [disabledReason, setDisabledReason] = useState<string | null>(null);

  useEffect(() => {
    // Don't block during initial loading to prevent flickering
    if (loading) {
      setIsChecking(false);
      return;
    }

    // Check if module is locked (business type + subscription plan restrictions)
    if (moduleName && moduleName.toLowerCase() !== 'subscription' && isModuleLocked(moduleName)) {
      setIsLocked(true);
      // Get disabled reason from hook getter
      const reason = typeof getModuleDisabledReason === 'function' ? getModuleDisabledReason(moduleName) : null;
      setDisabledReason(reason || null);
      setIsChecking(false);
      // Show error message (don't redirect to prevent navigation loops)
      guardModule(moduleName, { showToast: true });
    } else {
      setIsLocked(false);
      setIsChecking(false);
    }
  }, [moduleName, isModuleLocked, guardModule, loading, navigate]);

  // Show loading state while checking
  if (isChecking || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900 mx-auto mb-4"></div>
          <p className="text-muted-foreground">Checking module access...</p>
        </div>
      </div>
    );
  }

  // If module is locked, show locked UI instead of redirecting (prevents navigation loops)
  if (isLocked) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="mb-4">
            <svg 
              className="mx-auto h-12 w-12 text-muted-foreground" 
              fill="none"
              viewBox="0 0 24 24" 
              stroke="currentColor"
            >
              <path 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                strokeWidth={2} 
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" 
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-2">Module Locked</h3>
          <p className="text-muted-foreground mb-4">
            {disabledReason === 'SUBSCRIPTION_PLAN'
              ? 'This module is not available for your current subscription plan.'
              : 'This module is not available for your business type or role.'}
          </p>
          <div className="space-x-2">
            <button
              onClick={() => navigate(-1)}
              className="px-4 py-2 bg-secondary text-secondary-foreground rounded hover:bg-secondary/90"
            >
              Go Back
            </button>
            <button
              onClick={() => {
                const slugMatch = location.pathname.match(/^\/business\/([^\/]+)/);
                const dashboardPath = slugMatch
                  ? `/business/${encodeURIComponent(slugMatch[1])}/dashboard`
                  : '/zapeera';
                navigate(dashboardPath);
              }}
              className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90"
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  // If module is not locked, render children
  return <>{children}</>;
};

/**
 * Route-to-module mapping for automatic module detection
 */
export const ROUTE_TO_MODULE: Record<string, string> = {
  '/point-of-sale': 'sales',
  '/pos': 'sales',
  '/create-invoice': 'sales',
  '/invoices': 'sales',
  '/refunds': 'sales',
  '/inventory-transfers': 'inventory',
  '/products': 'inventory',
  '/inventory': 'inventory',
  '/inventory/categories': 'inventory',
  '/inventory/medical': 'inventory',
  '/inventory/non-medical': 'inventory',
  '/categories': 'inventory',
  '/manufacturers': 'inventory',
  '/shelves': 'inventory',
  '/batches': 'inventory',
  '/customers': 'sales',
  '/suppliers': 'purchases',
  '/order-purchase': 'purchases',
  '/purchases': 'purchases',
  '/reports': 'reports',
  '/advanced-reports': 'reports',
  '/prescriptions': 'prescriptions',
  '/branches': 'business_management',
  '/staff': 'business_management',
  '/shifts': 'business_management',
  '/scheduled-shifts': 'business_management',
  '/attendance': 'business_management',
  '/commissions': 'business_management',
  '/business/expenses': 'expenses',
  '/business/shifts': 'business_management',
  '/expenses': 'expenses',
  '/subscription': 'subscription',
  '/admin/business-subscription': 'subscription',
  '/employee-portal': 'employee_portal',
};

const BUSINESS_SEGMENT_TO_MODULE: Record<string, string> = {
  dashboard: 'dashboard',
  branches: 'business_management',
  staff: 'business_management',
  subscription: 'subscription',
  shifts: 'business_management',
  expenses: 'expenses',
  products: 'inventory',
  categories: 'inventory',
  manufacturers: 'inventory',
  shelves: 'inventory',
  batches: 'inventory',
  suppliers: 'purchases',
  purchases: 'purchases',
  'order-purchase': 'purchases',
  invoices: 'sales',
  refunds: 'sales',
  pos: 'sales',
  customers: 'sales',
  reports: 'reports',
  'advanced-reports': 'reports',
  prescriptions: 'prescriptions',
  'employee-portal': 'employee_portal',
};

/**
 * Route-to-submodule mapping.
 * Maps the last URL segment (or full path) to { parentModule, subModuleKey }.
 * Used by AutoModuleGuard to check sub-module-level access.
 */
interface SubModuleRoute {
  parentModule: string;
  subModuleKey: string;
  label: string;
}

const ROUTE_TO_SUBMODULE: Record<string, SubModuleRoute> = {
  '/pos': { parentModule: 'sales', subModuleKey: 'pos', label: 'Point of Sale' },
  '/point-of-sale': { parentModule: 'sales', subModuleKey: 'pos', label: 'Point of Sale' },
  '/create-invoice': { parentModule: 'sales', subModuleKey: 'invoices', label: 'Invoices' },
  '/invoices': { parentModule: 'sales', subModuleKey: 'invoices', label: 'Invoices' },
  '/refunds': { parentModule: 'sales', subModuleKey: 'refunds', label: 'Refunds' },
  '/customers': { parentModule: 'sales', subModuleKey: 'customers', label: 'Customers' },
  '/products': { parentModule: 'inventory', subModuleKey: 'products', label: 'Products' },
  '/inventory': { parentModule: 'inventory', subModuleKey: 'products', label: 'Products' },
  '/categories': { parentModule: 'inventory', subModuleKey: 'categories', label: 'Categories' },
  '/manufacturers': { parentModule: 'inventory', subModuleKey: 'manufacturers', label: 'Manufacturers' },
  '/shelves': { parentModule: 'inventory', subModuleKey: 'shelves', label: 'Shelves' },
  '/batches': { parentModule: 'inventory', subModuleKey: 'batches', label: 'Batches' },
  '/suppliers': { parentModule: 'purchases', subModuleKey: 'suppliers', label: 'Suppliers' },
  '/order-purchase': { parentModule: 'purchases', subModuleKey: 'order-purchase', label: 'Purchase Orders' },
  '/purchases': { parentModule: 'purchases', subModuleKey: 'order-purchase', label: 'Purchase Orders' },
  '/reports': { parentModule: 'reports', subModuleKey: 'reports', label: 'Reports' },
  '/advanced-reports': { parentModule: 'reports', subModuleKey: 'advanced-reports', label: 'Advanced Reports' },
  '/prescriptions': { parentModule: 'prescriptions', subModuleKey: 'prescriptions', label: 'Prescriptions' },
  '/branches': { parentModule: 'business_management', subModuleKey: 'branches', label: 'Branches' },
  '/staff': { parentModule: 'business_management', subModuleKey: 'staff', label: 'Staff' },
  '/shifts': { parentModule: 'business_management', subModuleKey: 'shifts', label: 'Shifts' },
  '/expenses': { parentModule: 'expenses', subModuleKey: 'expenses', label: 'Expenses' },
  '/business/expenses': { parentModule: 'expenses', subModuleKey: 'expenses', label: 'Expenses' },
  '/business/shifts': { parentModule: 'business_management', subModuleKey: 'shifts', label: 'Shifts' },
  '/subscription': { parentModule: 'subscription', subModuleKey: 'subscription', label: 'Subscription' },
  '/employee-portal': { parentModule: 'employee_portal', subModuleKey: 'dashboard', label: 'Employee Portal' },
};

const BUSINESS_SEGMENT_TO_SUBMODULE: Record<string, SubModuleRoute> = {
  pos: { parentModule: 'sales', subModuleKey: 'pos', label: 'Point of Sale' },
  invoices: { parentModule: 'sales', subModuleKey: 'invoices', label: 'Invoices' },
  refunds: { parentModule: 'sales', subModuleKey: 'refunds', label: 'Refunds' },
  customers: { parentModule: 'sales', subModuleKey: 'customers', label: 'Customers' },
  products: { parentModule: 'inventory', subModuleKey: 'products', label: 'Products' },
  categories: { parentModule: 'inventory', subModuleKey: 'categories', label: 'Categories' },
  manufacturers: { parentModule: 'inventory', subModuleKey: 'manufacturers', label: 'Manufacturers' },
  shelves: { parentModule: 'inventory', subModuleKey: 'shelves', label: 'Shelves' },
  batches: { parentModule: 'inventory', subModuleKey: 'batches', label: 'Batches' },
  suppliers: { parentModule: 'purchases', subModuleKey: 'suppliers', label: 'Suppliers' },
  'order-purchase': { parentModule: 'purchases', subModuleKey: 'order-purchase', label: 'Purchase Orders' },
  reports: { parentModule: 'reports', subModuleKey: 'reports', label: 'Reports' },
  'advanced-reports': { parentModule: 'reports', subModuleKey: 'advanced-reports', label: 'Advanced Reports' },
  prescriptions: { parentModule: 'prescriptions', subModuleKey: 'prescriptions', label: 'Prescriptions' },
  branches: { parentModule: 'business_management', subModuleKey: 'branches', label: 'Branches' },
  staff: { parentModule: 'business_management', subModuleKey: 'staff', label: 'Staff' },
  shifts: { parentModule: 'business_management', subModuleKey: 'shifts', label: 'Shifts' },
  expenses: { parentModule: 'expenses', subModuleKey: 'expenses', label: 'Expenses' },
  subscription: { parentModule: 'subscription', subModuleKey: 'subscription', label: 'Subscription' },
  'employee-portal': { parentModule: 'employee_portal', subModuleKey: 'dashboard', label: 'Employee Portal' },
};

const getModuleFromPath = (pathname: string): string | undefined => {
  const direct = ROUTE_TO_MODULE[pathname];
  if (direct) return direct;

  const businessMatch = pathname.match(/^\/business\/[^/]+\/([^/?#]+)/);
  if (businessMatch?.[1]) {
    return BUSINESS_SEGMENT_TO_MODULE[businessMatch[1]];
  }

  const matchedPrefix = Object.keys(ROUTE_TO_MODULE)
    .sort((a, b) => b.length - a.length)
    .find((key) => pathname.startsWith(`${key}/`));

  return matchedPrefix ? ROUTE_TO_MODULE[matchedPrefix] : undefined;
};

const getSubModuleFromPath = (pathname: string): SubModuleRoute | undefined => {
  const direct = ROUTE_TO_SUBMODULE[pathname];
  if (direct) return direct;

  const businessMatch = pathname.match(/^\/business\/[^/]+\/([^/?#]+)/);
  if (businessMatch?.[1]) {
    return BUSINESS_SEGMENT_TO_SUBMODULE[businessMatch[1]];
  }

  const matchedPrefix = Object.keys(ROUTE_TO_SUBMODULE)
    .sort((a, b) => b.length - a.length)
    .find((key) => pathname.startsWith(`${key}/`));

  return matchedPrefix ? ROUTE_TO_SUBMODULE[matchedPrefix] : undefined;
};

/**
 * AutoModuleGuard - Automatically detects module AND sub-module from current route.
 * First checks parent module access via ModuleGuard.
 * Then checks sub-module access via SubModuleGuard when the route maps to a sub-module.
 */
export const AutoModuleGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const moduleName = getModuleFromPath(location.pathname);
  const subModule = getSubModuleFromPath(location.pathname);

  if (!moduleName) {
    return <>{children}</>;
  }

  return (
    <ModuleGuard moduleName={moduleName}>
      {subModule ? (
        <SubModuleGuard
          parentModule={subModule.parentModule}
          subModuleKey={subModule.subModuleKey}
          label={subModule.label}
        >
          {children}
        </SubModuleGuard>
      ) : (
        children
      )}
    </ModuleGuard>
  );
};
