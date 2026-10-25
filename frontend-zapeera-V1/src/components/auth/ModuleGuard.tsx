import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useBusinessModules } from '@/hooks/useBusinessModules';
import { useModuleAccessGuard } from '@/hooks/useModuleAccessGuard';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { navigateToAppPath } from '@/lib/navigate';

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
  const { isSubModuleLocked, isSubModuleHidden, getSubModuleDisabledReason, loading } = useBusinessModules();
  const { user } = useAuth();
  const [isChecking, setIsChecking] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [hiddenReason, setHiddenReason] = useState<string | null>(null);

  useEffect(() => {
    if (loading) {
      setIsChecking(false);
      return;
    }

    // Role / business-type / parent-denied sub-modules are hidden from the
    // sidebar; a direct URL must be blocked too, with an honest reason
    // (no upgrade pitch — the user can't change their role or type).
    if (parentModule && subModuleKey && isSubModuleHidden(parentModule, subModuleKey)) {
      setHiddenReason(getSubModuleDisabledReason(parentModule, subModuleKey) || 'ROLE');
      setIsChecking(false);
      return;
    }
    setHiddenReason(null);

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
            navigateToAppPath(upgradePath);
          },
        },
        duration: 6000,
      });
    } else {
      setIsLocked(false);
      setIsChecking(false);
    }
  }, [parentModule, subModuleKey, isSubModuleLocked, isSubModuleHidden, getSubModuleDisabledReason, loading, label, location.pathname]);

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

  if (hiddenReason) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="text-center max-w-md">
          <h3 className="text-lg font-semibold mb-2">Feature Not Available</h3>
          <p className="text-muted-foreground mb-4">
            {hiddenReason === 'BUSINESS_TYPE'
              ? `${label || subModuleKey} isn't available for this type of business.`
              : hiddenReason === 'PARENT_MODULE'
                ? `${label || subModuleKey} is unavailable because its parent module is disabled.`
                : `Your role doesn't include access to ${label || subModuleKey}. Please ask your business owner if you need it.`}
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
                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
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
                navigateToAppPath(upgradePath);
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
  const { isModuleLocked, guardModule, getModuleDisabledReason, loading, refetch } = useModuleAccessGuard();
  const { user } = useAuth();
  const [isChecking, setIsChecking] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [disabledReason, setDisabledReason] = useState<string | null>(null);
  const retriedRef = useRef(false);

  useEffect(() => {
    // Don't block during initial loading to prevent flickering
    if (loading) {
      setIsChecking(false);
      return;
    }

    // Check if module is locked (business type + subscription plan restrictions)
    if (moduleName && moduleName.toLowerCase() !== 'subscription' && isModuleLocked(moduleName)) {
      // A lock verdict computed the instant loading flips can be stale: the
      // hook's module map may still hold its all-locked default because the
      // enabled-modules response has not been applied yet (or one fetch of
      // the pair settled first). Acting on it immediately flashed a false
      // "not available in your subscription plan" toast + locked screen on
      // modules the tenant actually has. Only trust a lock that is STILL
      // locked after a short settle window; stay on the checking spinner
      // meanwhile.
      setIsChecking(true);
      let secondTimer: ReturnType<typeof setTimeout> | undefined;
      const showLock = () => {
        setIsLocked(true);
        // Get disabled reason from hook getter
        const reason = typeof getModuleDisabledReason === 'function' ? getModuleDisabledReason(moduleName) : null;
        setDisabledReason(reason || null);
        // Show error message (don't redirect to prevent navigation loops)
        guardModule(moduleName, { showToast: true });
        setIsChecking(false);
      };
      const timer = setTimeout(() => {
        if (isModuleLocked(moduleName)) {
          // A lock can also mean the enablement fetch failed (e.g. a
          // transient 503 left the hook on its all-locked default).
          // Refetch once and re-check before believing it — a false
          // "Module Locked" screen for an entitled user is worse than
          // two extra seconds of spinner.
          if (!retriedRef.current && typeof refetch === 'function') {
            retriedRef.current = true;
            Promise.resolve(refetch()).catch(() => undefined);
            secondTimer = setTimeout(() => {
              if (isModuleLocked(moduleName)) {
                showLock();
              } else {
                setIsLocked(false);
                setIsChecking(false);
              }
            }, 2500);
            return;
          }
          showLock();
        } else {
          setIsLocked(false);
          setIsChecking(false);
        }
      }, 1200);
      return () => {
        clearTimeout(timer);
        if (secondTimer) clearTimeout(secondTimer);
      };
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
  // Gift Cards & Wallet (Wave C9 — gap item 9): the staff page rides
  // the sales module — its core job is counter money.
  '/gift-cards': 'sales',
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
  // Promotions (Wave B4) live under Sales, next to invoices/customers.
  '/promotions': 'sales',
  // Tax classes (Wave B5) live under Sales too.
  '/tax-classes': 'sales',
  '/suppliers': 'purchases',
  '/order-purchase': 'purchases',
  '/purchases': 'purchases',
  // Reorder suggestions (Wave C3) live under Purchases.
  '/reorder-suggestions': 'purchases',
  // Purchase suggestions (Gap Item 4) live under Purchases.
  '/purchase-suggestions': 'purchases',
  '/reports': 'reports',
  '/advanced-reports': 'reports',
  // Aging reports (Gap Item 4) live under Reports.
  '/aging-reports': 'reports',
  '/prescriptions': 'prescriptions',
  // Online store (Wave C5 — gap item 5): the staff page rides the
  // prescriptions module — its core job is the Rx review queue.
  '/online-store': 'prescriptions',
  // Clinic family (Wave C4): each register is its own module.
  '/patients': 'patients',
  '/doctors': 'doctors',
  '/appointments': 'appointments',
  // Hotel family (Wave C5): each register is its own module.
  '/front-desk': 'front_desk',
  '/rooms': 'rooms',
  '/reservations': 'reservations',
  '/folios': 'folios',
  '/stock-takes': 'stock_takes',
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
  'reorder-suggestions': 'purchases',
  invoices: 'sales',
  refunds: 'sales',
  pos: 'sales',
  // Gift Cards & Wallet (Wave C9 — gap item 9): rides sales.
  'gift-cards': 'sales',
  customers: 'sales',
  reports: 'reports',
  'advanced-reports': 'reports',
  prescriptions: 'prescriptions',
  // Online store (Wave C5 — gap item 5): rides prescriptions.
  'online-store': 'prescriptions',
  patients: 'patients',
  doctors: 'doctors',
  appointments: 'appointments',
  'front-desk': 'front_desk',
  rooms: 'rooms',
  reservations: 'reservations',
  folios: 'folios',
  'stock-takes': 'stock_takes',
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
  // Promotions (Wave B4): guarded by the invoicing submodule — every
  // role that can sell can see the offers; writes are OWNER/MANAGER
  // enforced by the API. (A first-class 'promotions' permission page
  // would need a Backoffice policy publish; see the backend notes.)
  '/promotions': { parentModule: 'sales', subModuleKey: 'invoices', label: 'Promotions' },
  // Tax classes (Wave B5): guarded by the invoicing submodule, same as
  // Promotions — writes are OWNER/MANAGER enforced by the API.
  '/tax-classes': { parentModule: 'sales', subModuleKey: 'invoices', label: 'Tax Classes' },
  // Gift Cards & Wallet (Wave C9 — gap item 9): guarded by the POS
  // submodule — every role that can sell can use it; voids are
  // OWNER/MANAGER enforced by the API.
  '/gift-cards': { parentModule: 'sales', subModuleKey: 'pos', label: 'Gift Cards & Wallet' },
  '/products': { parentModule: 'inventory', subModuleKey: 'products', label: 'Products' },
  '/inventory': { parentModule: 'inventory', subModuleKey: 'products', label: 'Products' },
  '/categories': { parentModule: 'inventory', subModuleKey: 'categories', label: 'Categories' },
  '/manufacturers': { parentModule: 'inventory', subModuleKey: 'manufacturers', label: 'Manufacturers' },
  '/shelves': { parentModule: 'inventory', subModuleKey: 'shelves', label: 'Shelves' },
  '/batches': { parentModule: 'inventory', subModuleKey: 'batches', label: 'Batches' },
  '/suppliers': { parentModule: 'purchases', subModuleKey: 'suppliers', label: 'Suppliers' },
  '/order-purchase': { parentModule: 'purchases', subModuleKey: 'order-purchase', label: 'Purchase Orders' },
  '/purchases': { parentModule: 'purchases', subModuleKey: 'order-purchase', label: 'Purchase Orders' },
  '/reorder-suggestions': { parentModule: 'purchases', subModuleKey: 'order-purchase', label: 'Reorder Suggestions' },
  '/purchase-suggestions': { parentModule: 'purchases', subModuleKey: 'order-purchase', label: 'Purchase Suggestions' },
  '/reports': { parentModule: 'reports', subModuleKey: 'reports', label: 'Reports' },
  '/advanced-reports': { parentModule: 'reports', subModuleKey: 'advanced-reports', label: 'Advanced Reports' },
  '/aging-reports': { parentModule: 'reports', subModuleKey: 'advanced-reports', label: 'Aging Reports' },
  '/prescriptions': { parentModule: 'prescriptions', subModuleKey: 'prescriptions', label: 'Prescriptions' },
  '/online-store': { parentModule: 'prescriptions', subModuleKey: 'prescriptions', label: 'Online Store' },
  '/patients': { parentModule: 'patients', subModuleKey: 'patients', label: 'Patients' },
  '/doctors': { parentModule: 'doctors', subModuleKey: 'doctors', label: 'Doctors' },
  '/appointments': { parentModule: 'appointments', subModuleKey: 'appointments', label: 'Appointments' },
  '/front-desk': { parentModule: 'front_desk', subModuleKey: 'front-desk', label: 'Front Desk' },
  '/rooms': { parentModule: 'rooms', subModuleKey: 'rooms', label: 'Rooms' },
  '/reservations': { parentModule: 'reservations', subModuleKey: 'reservations', label: 'Reservations' },
  '/folios': { parentModule: 'folios', subModuleKey: 'folios', label: 'Folios' },
  '/stock-takes': { parentModule: 'stock_takes', subModuleKey: 'stock-takes', label: 'Stock Takes' },
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
  // Gift Cards & Wallet (Wave C9 — gap item 9): rides the POS submodule.
  'gift-cards': { parentModule: 'sales', subModuleKey: 'pos', label: 'Gift Cards & Wallet' },
  customers: { parentModule: 'sales', subModuleKey: 'customers', label: 'Customers' },
  products: { parentModule: 'inventory', subModuleKey: 'products', label: 'Products' },
  categories: { parentModule: 'inventory', subModuleKey: 'categories', label: 'Categories' },
  manufacturers: { parentModule: 'inventory', subModuleKey: 'manufacturers', label: 'Manufacturers' },
  shelves: { parentModule: 'inventory', subModuleKey: 'shelves', label: 'Shelves' },
  batches: { parentModule: 'inventory', subModuleKey: 'batches', label: 'Batches' },
  suppliers: { parentModule: 'purchases', subModuleKey: 'suppliers', label: 'Suppliers' },
  'order-purchase': { parentModule: 'purchases', subModuleKey: 'order-purchase', label: 'Purchase Orders' },
  'reorder-suggestions': { parentModule: 'purchases', subModuleKey: 'order-purchase', label: 'Reorder Suggestions' },
  'purchase-suggestions': { parentModule: 'purchases', subModuleKey: 'order-purchase', label: 'Purchase Suggestions' },
  reports: { parentModule: 'reports', subModuleKey: 'reports', label: 'Reports' },
  'advanced-reports': { parentModule: 'reports', subModuleKey: 'advanced-reports', label: 'Advanced Reports' },
  'aging-reports': { parentModule: 'reports', subModuleKey: 'advanced-reports', label: 'Aging Reports' },
  prescriptions: { parentModule: 'prescriptions', subModuleKey: 'prescriptions', label: 'Prescriptions' },
  'online-store': { parentModule: 'prescriptions', subModuleKey: 'prescriptions', label: 'Online Store' },
  patients: { parentModule: 'patients', subModuleKey: 'patients', label: 'Patients' },
  doctors: { parentModule: 'doctors', subModuleKey: 'doctors', label: 'Doctors' },
  appointments: { parentModule: 'appointments', subModuleKey: 'appointments', label: 'Appointments' },
  'front-desk': { parentModule: 'front_desk', subModuleKey: 'front-desk', label: 'Front Desk' },
  rooms: { parentModule: 'rooms', subModuleKey: 'rooms', label: 'Rooms' },
  reservations: { parentModule: 'reservations', subModuleKey: 'reservations', label: 'Reservations' },
  folios: { parentModule: 'folios', subModuleKey: 'folios', label: 'Folios' },
  'stock-takes': { parentModule: 'stock_takes', subModuleKey: 'stock-takes', label: 'Stock Takes' },
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
