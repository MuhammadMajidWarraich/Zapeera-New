import { BackofficeRole } from '../types';

export const BACKOFFICE_PERMISSIONS = {
  dashboard: { read: 'dashboard.read' },
  businesses: {
    read: 'business.read',
    create: 'business.create',
    update: 'business.update',
    delete: 'business.delete',
    manage: 'business.manage',
  },
  users: {
    read: 'user.read',
    create: 'user.create',
    update: 'user.update',
    delete: 'user.delete',
    manage: 'user.manage',
  },
  subscriptions: {
    read: 'subscription.read',
    manage: 'subscription.manage',
  },
  plans: { manage: 'plan.manage' },
  modules: { manage: 'module.manage' },
  businessTypes: { manage: 'business-type.manage' },
  roles: { manage: 'role.manage' },
  finance: {
    read: 'finance.read',
    manage: 'finance.manage',
  },
  support: {
    read: 'support.read',
    manage: 'support.manage',
    impersonate: 'impersonation.start',
    endImpersonation: 'impersonation.end',
  },
  audit: { read: 'audit.read' },
  monitoring: { read: 'monitoring.read' },
  content: { manage: 'content.manage' },
  system: { manage: 'system.manage' },
  settings: { manage: 'settings.manage' },
  featureFlags: { manage: 'feature-flags.manage' },
} as const;

export type BackofficePermissionMap = typeof BACKOFFICE_PERMISSIONS;

const ROLE_PERMISSIONS: Record<BackofficeRole, string[]> = {
  SUPER_ADMIN: [
    'dashboard.read',
    'business.read', 'business.create', 'business.update', 'business.delete', 'business.manage',
    'user.read', 'user.create', 'user.update', 'user.delete', 'user.manage',
    'subscription.read', 'subscription.manage',
    'plan.manage',
    'module.manage',
    'business-type.manage',
    'role.manage',
    'finance.read', 'finance.manage',
    'support.read', 'support.manage', 'impersonation.start', 'impersonation.end',
    'audit.read',
    'monitoring.read',
    'content.manage',
    'system.manage',
    'settings.manage',
    'feature-flags.manage',
  ],
  ADMIN: [
    'dashboard.read',
    'business.read', 'business.update',
    'user.read', 'user.update',
    'subscription.read', 'subscription.manage',
    'plan.manage',
    'module.manage',
    'business-type.manage',
    'finance.read',
    'support.read', 'support.manage', 'impersonation.start', 'impersonation.end',
    'audit.read',
    'monitoring.read',
    'content.manage',
    'settings.manage',
  ],
  FINANCE: [
    'dashboard.read',
    'business.read',
    'user.read',
    'subscription.read', 'subscription.manage',
    'plan.read',
    'finance.read', 'finance.manage',
    'audit.read',
  ],
  SUPPORT: [
    'dashboard.read',
    'business.read',
    'user.read',
    'subscription.read',
    'support.read', 'support.manage', 'impersonation.start', 'impersonation.end',
    'audit.read',
    'monitoring.read',
  ],
  HR: [
    'dashboard.read',
    'user.read', 'user.update',
    'audit.read',
    'settings.manage',
  ],
  VIEWER: [
    'dashboard.read',
    'business.read',
    'user.read',
    'subscription.read',
    'audit.read',
    'monitoring.read',
  ],
};

export function getPermissionsForRole(role: BackofficeRole): string[] {
  return ROLE_PERMISSIONS[role] || [];
}

export function hasPermission(role: BackofficeRole, permission: string): boolean {
  return getPermissionsForRole(role).includes(permission);
}

export function hasAnyPermission(role: BackofficeRole, permissions: string[]): boolean {
  return permissions.some(p => hasPermission(role, p));
}

export function hasAllPermissions(role: BackofficeRole, permissions: string[]): boolean {
  return permissions.every(p => hasPermission(role, p));
}
