import { useAuth } from '../contexts/AuthContext';
import { useAdmin } from '../contexts/useAdmin';
import { normalizeAppRole, type AppUserRole } from '../utils/app-role';

/**
 * Hook to get the current user's role in the selected business context
 * Returns null if no membership exists for the current business
 */
export const useMembershipRole = (): AppUserRole | null => {
  const { user } = useAuth();
  const { effectiveCompanyId, selectedCompanyId, allCompanies } = useAdmin();

  if (!user) {
    return null;
  }

  const businessId = effectiveCompanyId || selectedCompanyId;

  // If we are in a business context, resolve role ONLY from business context.
  // Do not fall back to generic global role (which may be USER) because USER is not a business-scoped role.
  if (businessId) {
    // PRIORITY 1: user.membership is actively maintained by setActiveMembershipForBusiness
    // and reflects the CURRENT business context. This is the most up-to-date source.
    if (user.membership && String(user.membership.businessId) === String(businessId) && user.membership.roleName) {
      return normalizeAppRole(user.membership.roleName);
    }

    // PRIORITY 2: user.memberships array from login (may be stale after role changes)
    const activeMembership = Array.isArray(user.memberships)
      ? user.memberships.find((m) => String(m.businessId) === String(businessId))
      : undefined;

    const roleFromMembership = activeMembership?.roleName
      ? normalizeAppRole(activeMembership.roleName)
      : null;
    if (roleFromMembership) {
      return roleFromMembership;
    }

    // PRIORITY 3: derive from company record (owned/shared) — fresh from API
    const company = allCompanies.find((c) => String(c.id) === String(businessId));
    if (company) {
      if (company.createdBy && String(company.createdBy) === String(user.id)) {
        return 'OWNER';
      }
      if (company.memberRole) {
        return normalizeAppRole(company.memberRole);
      }
    }

    // Unknown in business context
    return null;
  }

  // Outside business context (e.g., platform/Zapeera screens): allow global role fallback.
  if (user.membership?.roleName) {
    return normalizeAppRole(user.membership.roleName);
  }

  return normalizeAppRole(user.role);
};

/**
 * Hook to check if user has a specific role in the current business
 */
export const useHasRole = (roles: string | string[]): boolean => {
  const membershipRole = useMembershipRole();
  if (!membershipRole) return false;

  const rolesArray = Array.isArray(roles) ? roles : [roles];
  return rolesArray.includes(membershipRole);
};

/**
 * Hook to check if user has owner-level access in current business
 */
export const useIsOwner = (): boolean => {
  return useHasRole('OWNER');
};

/**
 * Hook to check if user has manager-level access in current business
 */
export const useIsManager = (): boolean => {
  return useHasRole(['MANAGER', 'OWNER']);
};
