import React, { useContext } from 'react';
import { useAuth, getMembershipRole } from '@/contexts/AuthContext';
import { AdminContext } from '@/contexts/admin-context';
import { normalizeAppRole } from '@/utils/app-role';

interface RoleGuardProps {
  children: React.ReactNode;
  roles?: string[];
  resource?: string;
  action?: string;
  fallback?: React.ReactNode;
  requireAll?: boolean; // If true, user must have ALL roles, otherwise ANY role
}

export const RoleGuard: React.FC<RoleGuardProps> = ({
  children,
  roles = [],
  resource,
  action,
  fallback = null,
  requireAll = false
}) => {
  const { user, hasPermission, canAccess } = useAuth();
  // Fail-safe: RoleGuard must never crash the page if AdminContext is temporarily unavailable.
  const adminCtx = useContext(AdminContext);
  const selectedCompanyId = adminCtx?.selectedCompanyId ?? null;
  const selectedCompany = adminCtx?.selectedCompany ?? null;
  const allCompanies = adminCtx?.allCompanies ?? [];

  if (!user) {
    return <>{fallback}</>;
  }

  // Check role-based access (customer-facing roles only: USER, OWNER, MANAGER, CASHIER)
  if (roles.length > 0) {
    const normalizedUserRole = getMembershipRole(user);
    const resolvedSelectedCompany =
      selectedCompany || allCompanies.find((company: any) => company.id === selectedCompanyId) || null;
    const ownsAnyBusiness = Boolean(
      user?.id && allCompanies.some((company: any) => String(company?.createdBy || '') === String(user.id))
    );
    const contextRole = (() => {
      if (!selectedCompanyId || !resolvedSelectedCompany) return normalizedUserRole;
      if (
        resolvedSelectedCompany.createdBy &&
        String(resolvedSelectedCompany.createdBy) === String(user.id)
      ) {
        return 'OWNER';
      }
      const memberRole = (resolvedSelectedCompany as any)?.memberRole;
      if (memberRole) return normalizeAppRole(String(memberRole));
      return normalizedUserRole;
    })();

    const normalizedRequired = roles.map((role) => normalizeAppRole(String(role)));
    
    // Effective role for customer end (no SUPERADMIN)
    const effectiveRole = selectedCompanyId
      ? contextRole
      : ownsAnyBusiness
        ? 'OWNER'
        : normalizedUserRole;
        
    const hasRequiredRole = requireAll
      ? normalizedRequired.every((role) => role === effectiveRole)
      : normalizedRequired.includes(effectiveRole);

    if (!hasRequiredRole) {
      return <>{fallback}</>;
    }
  }

  // Check resource-based access
  if (resource) {
    const canAccessResource = canAccess(resource);

    // Debug logging for SUPERADMIN resources
    if (resource === 'admin_payments' || resource === 'admin_management') {
      console.log('🔍 RoleGuard Resource Debug - Resource:', resource, 'Can access:', canAccessResource, 'User role:', getMembershipRole(user));
    }

    // Debug logging for Refunds and Sales resources
    if (resource === 'refunds' || resource === 'sales') {
      console.log(`🔍 ${resource.toUpperCase()} RoleGuard Debug - Resource:`, resource, 'Action:', action, 'Can access:', canAccessResource, 'User role:', getMembershipRole(user));
    }

    if (!canAccessResource) {
      return <>{fallback}</>;
    }

    // Check specific action permission
    if (action && !hasPermission(resource, action)) {
      return <>{fallback}</>;
    }
  }

  return <>{children}</>;
};

// Convenience components for common use cases (customer roles only)
export const AdminOnly: React.FC<{ children: React.ReactNode; fallback?: React.ReactNode }> = ({
  children,
  fallback = null
}) => (
  <RoleGuard roles={['OWNER']} fallback={fallback}>
    {children}
  </RoleGuard>
);

export const ManagerOnly: React.FC<{ children: React.ReactNode; fallback?: React.ReactNode }> = ({
  children,
  fallback = null
}) => (
  <RoleGuard roles={['MANAGER', 'OWNER']} fallback={fallback}>
    {children}
  </RoleGuard>
);

export const StaffOnly: React.FC<{ children: React.ReactNode; fallback?: React.ReactNode }> = ({
  children,
  fallback = null
}) => (
  <RoleGuard roles={['MANAGER', 'OWNER']} fallback={fallback}>
    {children}
  </RoleGuard>
);

export const CashierOnly: React.FC<{ children: React.ReactNode; fallback?: React.ReactNode }> = ({
  children,
  fallback = null
}) => (
  <RoleGuard roles={['CASHIER', 'MANAGER', 'OWNER']} fallback={fallback}>
    {children}
  </RoleGuard>
);

// Resource-based guards
export const CanManageUsers: React.FC<{ children: React.ReactNode; fallback?: React.ReactNode }> = ({
  children,
  fallback = null
}) => (
  <RoleGuard resource="users" action="manage" fallback={fallback}>
    {children}
  </RoleGuard>
);

export const CanManageProducts: React.FC<{ children: React.ReactNode; fallback?: React.ReactNode }> = ({
  children,
  fallback = null
}) => (
  <RoleGuard resource="products" action="manage" fallback={fallback}>
    {children}
  </RoleGuard>
);

export const CanViewReports: React.FC<{ children: React.ReactNode; fallback?: React.ReactNode }> = ({
  children,
  fallback = null
}) => (
  <RoleGuard resource="reports" action="read" fallback={fallback}>
    {children}
  </RoleGuard>
);

export const CanManageSettings: React.FC<{ children: React.ReactNode; fallback?: React.ReactNode }> = ({
  children,
  fallback = null
}) => (
  <RoleGuard resource="settings" action="manage" fallback={fallback}>
    {children}
  </RoleGuard>
);

// Hook for programmatic permission checking (customer roles only)
export const usePermissions = () => {
  const { hasPermission, hasRole, canAccess, user } = useAuth();

  return {
    hasPermission,
    hasRole,
    canAccess,
    user,
    isOwner: hasRole(['OWNER']),
    isManager: hasRole(['MANAGER', 'OWNER']),
    isStaff: hasRole(['MANAGER', 'OWNER']),
    isCashier: hasRole(['CASHIER', 'MANAGER', 'OWNER'])
  };
};
