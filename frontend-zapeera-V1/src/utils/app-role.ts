// Business roles (for users who have/belong to a business)
// 1. OWNER   - Created the business; full access, no branch restriction
// 2. MANAGER - Invited to manage a branch; branch-scoped management
// 3. CASHIER - Invited for POS/sales; branch-scoped sales only
// Note: USER = Zapeera account with no business yet (not a business role)
export type AppUserRole = 'OWNER' | 'MANAGER' | 'CASHIER';
export type ZapeeraAccountRole = 'USER'; // Registered Zapeera account with no business yet

/**
 * Backoffice roles (separate from customer roles)
 */
export type BackofficeRole = 'ADMIN' | 'FINANCE' | 'SUPPORT' | 'HR';

/**
 * Match backend session semantics: legacy ADMIN → OWNER, removed roles → USER.
 * Backoffice roles are normalized to USER on customer end.
 */
export function normalizeAppRole(role: string | undefined | null): AppUserRole {
  const r = String(role ?? '').trim().toUpperCase();
  
  // Legacy mappings
  if (r === 'ADMIN') return 'OWNER';
  
  // Backoffice roles should not appear on customer end - default to OWNER (safest for platform admins impersonating)
  if (r === 'SUPER_ADMIN' || r === 'FINANCE' || r === 'SUPPORT' || r === 'HR') {
    return 'OWNER';
  }
  
  // Product/Pharmacist roles → OWNER
  if (r === 'PRODUCT_OWNER' || r === 'PHARMACIST') return 'OWNER';
  
  // Valid business roles
  if (r === 'OWNER' || r === 'MANAGER' || r === 'CASHIER') {
    return r;
  }
  
  // Default for any other role (including legacy USER)
  return 'OWNER';
}

/**
 * Check if a role is a business-specific role (requires active subscription)
 */
export function isBusinessRole(role: AppUserRole): boolean {
  return ['OWNER', 'MANAGER', 'CASHIER'].includes(role);
}

/**
 * Get the display name for a role
 */
export function getRoleDisplayName(role: AppUserRole): string {
  const names: Record<AppUserRole, string> = {
    'OWNER': 'Owner',
    'MANAGER': 'Manager',
    'CASHIER': 'Cashier'
  };
  return names[role] || role;
}

/**
 * Get available roles for user creation based on current user's role and subscription
 */
export function getCreatableRoles(currentRole: AppUserRole, subscriptionPlan?: string): AppUserRole[] {
  // USER can only be created by system (registration)
  // Business roles require subscription
  
  if (currentRole === 'OWNER') {
    // Owner can create Manager and Cashier based on subscription limits
    return ['MANAGER', 'CASHIER'];
  }
  
  if (currentRole === 'MANAGER') {
    // Manager can only create Cashier
    return ['CASHIER'];
  }
  
  // Cashier and USER cannot create other users
  return [];
}
