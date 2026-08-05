import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import { apiService } from '../services/api';
import { normalizeAppRole, type AppUserRole } from '../utils/app-role';
import { toast } from '../hooks/use-toast';
import { config } from '../lib/config';
import {
  clearStoredSession,
  readStoredUser,
  writeStoredUser,
} from '../lib/session-storage';

interface Membership {
  id: string;
  userId: string;
  businessId: string;
  roleId?: string;
  roleName?: AppUserRole;
  branchIds?: string[];
  status?: string;
}

interface User {
  id: string;
  name: string;
  username: string;
  email?: string;
  profileImage?: string;
  phone?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  dateOfBirth?: string | null;
  bio?: string | null;
  twoFactorEnabled?: boolean;
  role?: string;
  branchId?: string;
  companyId?: string;
  adminId?: string;
  createdBy?: string;
  isActive?: boolean;
  businessAccessGranted?: boolean;
  permissions?: string[];
  membership?: Membership;
  memberships?: Membership[];
  platformRole?: string;
  platformPermissions?: string[];
}

export const getMembershipRole = (user: User | null): AppUserRole | null => {
  if (!user) return null;
  if (user.membership?.roleName) {
    return normalizeAppRole(user.membership.roleName);
  }
  if (user.role) {
    return normalizeAppRole(user.role);
  }
  return null;
};

function normalizeStoredUser(userData: Record<string, unknown>): User {
  const raw = userData as unknown as Partial<User> & { membership?: any; memberships?: any };
  const normalizedMembership = raw.membership
    ? {
        ...(raw.membership as Membership),
        roleName: raw.membership.roleName ? normalizeAppRole(raw.membership.roleName) : undefined,
      }
    : undefined;

  const normalizedMemberships = Array.isArray(raw.memberships)
    ? (raw.memberships as any[])
        .filter(Boolean)
        .map((m) => ({
          ...(m as Membership),
          roleName: (m as any)?.roleName ? normalizeAppRole((m as any).roleName) : undefined,
        }))
    : undefined;

  const normalizedRole = raw.role ? normalizeAppRole(raw.role) : undefined;

  return {
    ...(raw as User),
    role: normalizedRole,
    membership: normalizedMembership,
    memberships: normalizedMemberships,
    profileImage: (raw.profileImage as string) || undefined,
  };
}

export { normalizeAppRole };

interface AuthContextType {
  user: User | null;
  login: (user: User) => void;
  logout: () => void;
  isAuthenticated: boolean;
  isInitialized: boolean;
  hasPermission: (resource: string, action: string) => boolean;
  hasRole: (roles: string[]) => boolean;
  canAccess: (resource: string) => boolean;
  checkAuthStatus: () => boolean;
  setActiveMembershipForBusiness: (businessId: string | null, fallbackRoleName?: AppUserRole | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    if (import.meta.env.DEV) {
      const hasUser = readStoredUser();

      if (hasUser) {
        try {
          const parsed = JSON.parse(hasUser);
          if (parsed && typeof parsed === 'object' && parsed.id) {
            const user = normalizeStoredUser(parsed as Record<string, unknown>);
            return {
              user,
              login: () => {},
              logout: () => {},
              isAuthenticated: true,
              isInitialized: true,
              hasPermission: () => false,
              hasRole: () => false,
              canAccess: () => false,
              checkAuthStatus: () => true,
              setActiveMembershipForBusiness: () => {},
            } as AuthContextType;
          }
        } catch {
          console.warn('[useAuth] Invalid stored user in localStorage; clearing session keys');
          try {
            clearStoredSession();
          } catch {
            /* ignore */
          }
        }
      }
    }

    // In production or if no token, throw error as before
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: React.ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const apiBaseUrl = config.api.baseUrl.replace(/\/api$/, '');

  const [user, setUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [lastActivity, setLastActivity] = useState<number>(Date.now());

  // Check for existing session on mount
  useEffect(() => {
    const initializeAuth = async () => {
      const freshInstallChecked = localStorage.getItem('fresh_install_checked');

      // Cookie-only auth: check if user data exists in localStorage (set during login)
      const savedUser = readStoredUser();

      if (savedUser) {
        if (freshInstallChecked === 'true') {
          // User data present and already checked — proceed
        } else {
          localStorage.setItem('fresh_install_checked', 'true');
        }
      } else {
        let isFreshInstall = false;
        try {
          if (typeof window !== 'undefined' && window.electronAPI?.isFreshDatabase) {
            isFreshInstall = await window.electronAPI.isFreshDatabase();
            localStorage.setItem('fresh_install_checked', 'true');

            if (isFreshInstall) {
              localStorage.clear();
              sessionStorage.clear();
              setUser(null);
              setIsAuthenticated(false);
              setIsInitialized(true);
              return;
            } else {
              // not a fresh install
            }
          }
        } catch (e) {
          if (!savedUser) {
            localStorage.clear();
            sessionStorage.clear();
            setUser(null);
            setIsAuthenticated(false);
            setIsInitialized(true);
            return;
          }
        }
      }

      // Continue with normal login flow - restore session from localStorage
      try {
        const isElectron = typeof window !== 'undefined' && typeof window.electronAPI !== 'undefined';
        let restoreUser: Record<string, unknown> | null = null;

        if (savedUser) {
          const userData = JSON.parse(savedUser);
          if (userData && userData.id) {
            restoreUser = userData as Record<string, unknown>;
          } else {
            clearStoredSession();
            setUser(null);
            setIsAuthenticated(false);
          }
        } else {
          setUser(null);
          setIsAuthenticated(false);
        }

        // Desktop: validate the saved local session against the embedded backend
        // BEFORE trusting it. A stale session from an older install (or a reset
        // local database) would otherwise cause a storm of 401s on boot; instead
        // we clear it and fall through to the login screen.
        if (restoreUser && isElectron) {
          try {
            const sessionResult = await apiService.sessionLogin();
            const freshUser = (sessionResult as any)?.data?.user;
            if (sessionResult?.success && freshUser?.id) {
              restoreUser = freshUser as Record<string, unknown>;
            } else {
              restoreUser = null;
            }
          } catch {
            restoreUser = null;
          }
        }

        if (restoreUser) {
          const normalizedUser = normalizeStoredUser(restoreUser);
          setUser(normalizedUser);
          setIsAuthenticated(true);
          writeStoredUser(normalizedUser);
        } else if (savedUser) {
          // Stale/invalid local session — clear it so the app shows the login screen
          clearStoredSession();
          setUser(null);
          setIsAuthenticated(false);
        }
      } catch (error) {
        if (!savedUser) {
          clearStoredSession();
          setUser(null);
          setIsAuthenticated(false);
        } else {
          try {
            const userData = JSON.parse(savedUser || '{}');
            if (userData && userData.id) {
              const normalizedUser = normalizeStoredUser(userData as Record<string, unknown>);
              setUser(normalizedUser);
              setIsAuthenticated(true);
              if (String(userData.role || '').toUpperCase() !== normalizedUser.role) {
                writeStoredUser(normalizedUser);
              }
            }
          } catch (e) {
            clearStoredSession();
            setUser(null);
            setIsAuthenticated(false);
          }
        }
      }

      setIsInitialized(true);
      localStorage.setItem('auth_initialized', 'true');
    };

    initializeAuth();
  }, []);


  const login = useCallback((userData: User) => {
    const normalizedUserData = normalizeStoredUser(userData as unknown as Record<string, unknown>);

    setUser(normalizedUserData);
    setIsAuthenticated(true);

    writeStoredUser(normalizedUserData);
    localStorage.setItem('fresh_install_checked', 'true');

    // Clear admin company selection to force Zapeera screen on fresh login
    if (normalizedUserData.role === 'OWNER') {
      localStorage.removeItem(`selected_company_${normalizedUserData.id}`);
      localStorage.removeItem(`selected_branch_${normalizedUserData.id}`);
      localStorage.setItem(`fresh_admin_login_${normalizedUserData.id}`, 'true');
    }
  }, []);

  const setActiveMembershipForBusiness = useCallback(
    (businessId: string | null, fallbackRoleName?: AppUserRole | null) => {
      setUser((prev) => {
        if (!prev) return prev;

        if (!businessId) {
          const nextUser = { ...prev, membership: undefined };
          try {
            writeStoredUser(nextUser);
          } catch {
            // ignore
          }
          return nextUser;
        }

        const match = Array.isArray(prev.memberships)
          ? prev.memberships.find((m) => String(m.businessId) === String(businessId))
          : undefined;

        const businessIdString = String(businessId);
        const isOwnedBusiness = prev.companyId && String(prev.companyId) === businessIdString && prev.role === 'OWNER';

        const nextRoleName =
          (match?.roleName ? normalizeAppRole(match.roleName) : null) ||
          (fallbackRoleName ? normalizeAppRole(fallbackRoleName) : null) ||
          (isOwnedBusiness ? 'OWNER' : null) ||
          null;

        if (!match && !nextRoleName) {
          console.warn(`[AuthContext] Tried to activate unknown membership for business ${businessId}`);
          return prev;
        }

        const nextMembership: Membership = {
          id: match?.id || '',
          userId: prev.id,
          businessId,
          roleId: match?.roleId,
          roleName: nextRoleName || undefined,
          branchIds: match?.branchIds,
          status: match?.status,
        };

        const nextUser = { ...prev, membership: nextMembership };
        try {
          writeStoredUser(nextUser);
        } catch {
          // ignore
        }
        return nextUser;
      });
    },
    [],
  );

  const logout = useCallback(() => {
    const currentUser = user;
    setUser(null);
    setIsAuthenticated(false);
    clearStoredSession();
    localStorage.removeItem('auth_initialized');

    // Clear admin welcome flag so they can see welcome screen again on next login
    if (currentUser?.role === 'OWNER') {
      localStorage.removeItem(`admin_welcome_seen_${currentUser.id}`);
    }

    // Call backend logout to clear httpOnly cookies (fire-and-forget)
    fetch(`${apiBaseUrl}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {});

    // Navigation to login will be handled by ProtectedRoute or AuthStatus component
    // Do NOT use window.location.href as it breaks file:// URLs in Electron
  }, [user]);

  // Listen for authentication required events
  useEffect(() => {
    const handleAuthRequired = async (event: CustomEvent) => {
      if (!isAuthenticated) return;

      // Try session login first to avoid unnecessary logout on transient 401
      try {
        const sessionResult = await apiService.sessionLogin();
        if (sessionResult.success && sessionResult.data) {
          const { user: refreshedUser } = sessionResult.data as any;
          if (refreshedUser?.id) {
            const normalized = normalizeStoredUser(refreshedUser);
            setUser(normalized);
            writeStoredUser(normalized);
            return;
          }
        }
      } catch {
        // Session login failed, proceed with logout
      }

      logout();
    };

    // Handle session expired due to login from another device
    const handleSessionExpiredAnotherDevice = (event: CustomEvent) => {
      if (isAuthenticated) {
        toast({
          title: "Session Expired",
          description: "You have been logged out because your account was accessed from another device. Only one active session is allowed per user.",
          variant: "destructive",
        });
        logout();
      }
    };

    // Handle account deactivation
    const handleAccountDeactivated = (event: CustomEvent) => {
      if (isAuthenticated) {
        toast({
          title: "Account Deactivated",
          description: "Your account has been deactivated. Please contact the administrator to reactivate your account.",
          variant: "destructive",
        });
        logout();
      }
    };

    window.addEventListener('authRequired', handleAuthRequired as EventListener);
    window.addEventListener('sessionExpiredAnotherDevice', handleSessionExpiredAnotherDevice as EventListener);
    window.addEventListener('accountDeactivated', handleAccountDeactivated as EventListener);

    return () => {
      window.removeEventListener('authRequired', handleAuthRequired as EventListener);
      window.removeEventListener('sessionExpiredAnotherDevice', handleSessionExpiredAnotherDevice as EventListener);
      window.removeEventListener('accountDeactivated', handleAccountDeactivated as EventListener);
    };
  }, [isAuthenticated, logout]);

  // Session timeout: Check for inactivity every minute
  useEffect(() => {
    if (!isAuthenticated) return;

    const SESSION_TIMEOUT_MINUTES = 30; // 30 minutes of inactivity
    const CHECK_INTERVAL = 60000; // Check every minute

    const checkSessionTimeout = () => {
      const now = Date.now();
      const inactiveTime = now - lastActivity;

      if (inactiveTime > SESSION_TIMEOUT_MINUTES * 60 * 1000) {
        // Session expired due to inactivity
        toast({
          title: "Session Expired",
          description: "You have been logged out due to inactivity.",
          variant: "destructive",
        });
        logout();
      }
    };

    const intervalId = setInterval(checkSessionTimeout, CHECK_INTERVAL);

    return () => clearInterval(intervalId);
  }, [isAuthenticated, lastActivity, logout]);

  // Track user activity
  useEffect(() => {
    const handleActivity = () => {
      setLastActivity(Date.now());
    };

    // Track various user activities
    window.addEventListener('mousemove', handleActivity);
    window.addEventListener('keydown', handleActivity);
    window.addEventListener('click', handleActivity);
    window.addEventListener('scroll', handleActivity);

    return () => {
      window.removeEventListener('mousemove', handleActivity);
      window.removeEventListener('keydown', handleActivity);
      window.removeEventListener('click', handleActivity);
      window.removeEventListener('scroll', handleActivity);
    };
  }, []);

  // Periodic account status check (every 60 seconds when authenticated)
  // This checks if the account is still active and forces logout if deactivated
  useEffect(() => {
    if (!isAuthenticated || !user) return;

    const checkAccountStatus = async () => {
      try {
        // Skip regular API calls if in backoffice (uses different auth system)
        if (localStorage.getItem('backofficeToken') || window.location.pathname.startsWith('/backoffice')) return;

        if (!navigator.onLine) {
          return;
        }

        // Send the local (desktop) or web token as Bearer so the embedded server
        // authenticates even when the httpOnly cookie round-trip is unavailable.
        const token = localStorage.getItem('localAccessToken') || localStorage.getItem('token');
        const response = await fetch(`${apiBaseUrl}/api/auth/check-status`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          credentials: 'include',
        });

        const data = await response.json();

        if (data.shouldLogout || data.accountDeactivated || data.isActive === false) {
          window.dispatchEvent(new CustomEvent('accountDeactivated', { detail: data }));
        }
      } catch (error) {
        // Don't logout on network errors
      }
    };

    // Check immediately on login
    checkAccountStatus();

    // Then check every 60 seconds
    const intervalId = setInterval(checkAccountStatus, 60000);

    return () => clearInterval(intervalId);
  }, [isAuthenticated, user]);

  // Role-based permission checking (uses membership-based role)
  const hasPermission = (resource: string, action: string): boolean => {
    if (!user) return false;

    const userRole = getMembershipRole(user);
    if (!userRole) return false;

    // Define role-based permissions
    const rolePermissions: Record<string, Record<string, string[]>> = {
      OWNER: {
        users: ['create', 'read', 'update', 'manage'],
        employees: ['manage'],
        branches: ['manage'],
        products: ['manage'],
        categories: ['manage'],
        suppliers: ['manage'],
        sales: ['manage'],
        reports: ['read', 'export', 'manage'],
        dashboard: ['read'],
        settings: ['read', 'manage'],
        integrations: ['manage'],
        backup: ['manage'],
        commissions: ['read', 'manage'],
        customers: ['manage'],
        refunds: ['manage'],
        invoices: ['read', 'create', 'update'],
        subscription: ['read', 'manage']
      },
      USER: {
        users: ['create', 'read', 'update'],
        employees: ['manage'],
        products: ['manage'],
        categories: ['manage'],
        suppliers: ['manage'],
        sales: ['manage'],
        reports: ['read', 'export'],
        dashboard: ['read'],
        refunds: ['manage'],
        customers: ['manage'],
        commissions: ['read'],
        settings: ['read'],
        invoices: ['read', 'create', 'update'],
        branches: ['manage'],
        subscription: ['read', 'manage']
      },
      MANAGER: {
        users: ['create', 'read', 'update'],
        employees: ['manage'],
        products: ['manage'],
        categories: ['manage'],
        suppliers: ['manage'],
        manufacturers: ['read', 'create', 'update'],
        shelves: ['read', 'create', 'update'],
        batches: ['read', 'create', 'update'],
        purchases: ['read', 'create', 'update'],
        sales: ['create', 'read', 'update'],
        reports: ['read', 'export'],
        dashboard: ['read'],
        refunds: ['read', 'approve', 'reject'],
        customers: ['manage'],
        commissions: ['read'],
        settings: ['read'],
        invoices: ['read', 'create', 'update'],
        shifts: ['manage'],
        scheduledShifts: ['manage'],
        attendance: ['manage']
      },
      CASHIER: {
        sales: ['create', 'read'],
        receipts: ['create', 'read'],
        refunds: ['create', 'read'],
        products: ['read'],
        customers: ['read', 'create', 'update'],
        categories: ['read'],
        dashboard: ['read'],
        reports: ['read'],
        invoices: ['read']
      }
    };

    const userPermissions = rolePermissions[userRole] || {};
    const resourcePermissions = userPermissions[resource] || [];

    return resourcePermissions.includes(action) || resourcePermissions.includes('manage');
  };

  const hasRole = (roles: string[]): boolean => {
    if (!user) return false;
    const userRole = getMembershipRole(user);
    return userRole ? roles.includes(userRole) : false;
  };

  const canAccess = (resource: string): boolean => {
    if (!user) return false;

    const userRole = getMembershipRole(user);
    if (!userRole) return false;

    const accessibleResources: Record<string, string[]> = {
      OWNER: ['users', 'employees', 'branches', 'products', 'categories', 'suppliers', 'sales', 'reports', 'dashboard', 'refunds', 'customers', 'commissions', 'settings', 'invoices', 'subscription'],
      USER: ['users', 'employees', 'branches', 'products', 'categories', 'suppliers', 'sales', 'reports', 'dashboard', 'refunds', 'customers', 'commissions', 'settings', 'invoices', 'subscription'],
      MANAGER: ['users', 'employees', 'products', 'categories', 'suppliers', 'sales', 'reports', 'dashboard', 'refunds', 'customers', 'commissions', 'settings', 'invoices'],
      CASHIER: ['sales', 'receipts', 'refunds', 'products', 'customers', 'categories', 'dashboard', 'reports', 'invoices']
    };

    const userAccessibleResources = accessibleResources[userRole] || [];
    return userAccessibleResources.includes(resource);
  };

  const checkAuthStatus = useCallback((): boolean => {
    // Simply return the current authentication state
    // Don't perform any localStorage checks or logout calls
    const result = isAuthenticated && !!user;
    console.log('🔍 checkAuthStatus: isAuthenticated:', isAuthenticated, 'user:', !!user, 'result:', result);
    return result;
  }, [isAuthenticated, user]);

  const value: AuthContextType = useMemo(() => ({
    user,
    login,
    logout,
    isAuthenticated,
    isInitialized,
    hasPermission,
    hasRole,
    canAccess,
    checkAuthStatus,
    setActiveMembershipForBusiness,
  }), [user, login, logout, isAuthenticated, isInitialized, hasPermission, hasRole, canAccess, checkAuthStatus, setActiveMembershipForBusiness]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
