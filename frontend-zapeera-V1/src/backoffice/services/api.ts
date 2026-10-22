import { config } from '@/lib/config';
import {
  DashboardStats,
  Business,
  BusinessDetails,
  User,
  Subscription,
  Plan,
  BusinessType,
  Module,
  Role,
  PaymentProof,
  BackofficeCommission,
  BackofficeCommissionStats,
  AuditLog,
  SupportTicket,
  SupportTicketMessage,
  ContentPage,
  Announcement,
  FeatureFlag,
  SystemHealth,
  BackofficeAdmin,
  BackofficePartner,
} from '../types';

const BASE_URL = config.backoffice.baseUrl;

function getCSRFToken(): string | null {
  try {
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'csrf-token' || name === 'XSRF-TOKEN') {
        return decodeURIComponent(value);
      }
    }
  } catch { /* ignore */ }
  return null;
}

function authHeaders(): Record<string, string> {
  const csrf = getCSRFToken();
  return {
    'Content-Type': 'application/json',
    ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
  };
}

async function request<T>(path: string, options?: RequestInit): Promise<{ success: boolean; data: T; message?: string }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...options?.headers },
    credentials: 'include',
  });
  const json = await res.json();
  if (!json.success && !json.data) {
    throw new Error(json.message || 'Request failed');
  }
  return json;
}

export const backofficeApi = {
  // Auth
  login: (email: string, password: string) =>
    fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      credentials: 'include',
    }).then(r => r.json()),

  setup: (email: string, password: string, role?: string) =>
    fetch(`${BASE_URL}/auth/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, role }),
      credentials: 'include',
    }).then(r => r.json()),

  getProfile: (): Promise<{ success: boolean; data: BackofficeAdmin }> =>
    request('/auth/profile'),

  updateProfile: (data: { email?: string; currentPassword: string; newPassword?: string }): Promise<{ success: boolean; data: BackofficeAdmin; message?: string }> =>
    request('/auth/profile', { method: 'PUT', body: JSON.stringify(data) }),

  logout: () =>
    fetch(`${BASE_URL}/auth/logout`, {
      method: 'POST',
      headers: authHeaders(),
      credentials: 'include',
    }).then(r => r.json()),

  // Dashboard
  getDashboardStats: (): Promise<{ success: boolean; data: DashboardStats }> =>
    request('/dashboard/stats'),

  // Businesses
  getBusinesses: (params?: string): Promise<{ success: boolean; data: Business[] }> =>
    request(`/businesses${params ? `?${params}` : ''}`),
  getBusiness: (id: string): Promise<{ success: boolean; data: BusinessDetails }> =>
    request(`/businesses/${id}`),
  getBusinessStats: (): Promise<{ success: boolean; data: any }> =>
    request('/businesses/stats'),
  updateBusiness: (id: string, data: Partial<Business>): Promise<{ success: boolean; data: Business }> =>
    request(`/businesses/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  toggleBusinessStatus: (id: string): Promise<{ success: boolean; data: Business }> =>
    request(`/businesses/${id}/toggle-status`, { method: 'POST' }),
  deleteBusiness: (id: string): Promise<{ success: boolean }> =>
    request(`/businesses/${id}`, { method: 'DELETE' }),

  // Users
  getUsers: (params?: string): Promise<{ success: boolean; data: User[] }> =>
    request(`/users${params ? `?${params}` : ''}`),
  toggleUserStatus: (id: string, isActive: boolean): Promise<{ success: boolean; data: User }> =>
    request(`/users/${id}/toggle-status`, { method: 'POST', body: JSON.stringify({ isActive }) }),
  verifyUserEmail: (id: string): Promise<{ success: boolean; data: any }> =>
    request(`/users/${id}/verify-email`, { method: 'POST' }),
  resendUserVerification: (id: string): Promise<{ success: boolean; data: any }> =>
    request(`/users/${id}/resend-verification`, { method: 'POST' }),

  // Subscriptions
  getSubscriptions: (params?: string): Promise<{ success: boolean; data: Subscription[] }> =>
    request(`/subscriptions${params ? `?${params}` : ''}`),
  getSubscriptionByBusiness: (businessId: string): Promise<{ success: boolean; data: Subscription }> =>
    request(`/subscriptions/business/${businessId}`),
  getBillingSummary: (): Promise<{ success: boolean; data: any }> =>
    request('/subscriptions/billing-summary'),
  assignPlan: (businessId: string, planId: string): Promise<{ success: boolean; data: Subscription }> =>
    request('/subscriptions/assign', { method: 'POST', body: JSON.stringify({ businessId, planId }) }),
  updateSubscriptionStatus: (id: string, status: string): Promise<{ success: boolean }> =>
    request(`/subscriptions/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  cancelSubscription: (id: string): Promise<{ success: boolean }> =>
    request(`/subscriptions/${id}/cancel`, { method: 'POST' }),
  extendTrial: (id: string, days: number): Promise<{ success: boolean }> =>
    request(`/subscriptions/${id}/extend-trial`, { method: 'POST', body: JSON.stringify({ days }) }),

  // Plans
  // White-label partners (Feature 3)
  getPartners: (): Promise<{ success: boolean; data: BackofficePartner[] }> =>
    request('/partners'),
  createPartner: (data: { name: string; adminEmail: string; slug?: string; primaryColor?: string; supportEmail?: string; tagline?: string }): Promise<{ success: boolean; data: BackofficePartner }> =>
    request('/partners', { method: 'POST', body: JSON.stringify(data) }),
  updatePartner: (id: string, data: Partial<{ name: string; status: string; adminEmail: string; primaryColor: string | null; supportEmail: string | null; tagline: string | null }>): Promise<{ success: boolean; data: BackofficePartner }> =>
    request(`/partners/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  reassignBusinessPartner: (businessId: string, partnerId: string | null): Promise<{ success: boolean; data: unknown }> =>
    request(`/businesses/${businessId}/partner`, { method: 'PATCH', body: JSON.stringify({ partnerId }) }),

  getPlans: (): Promise<{ success: boolean; data: Plan[] }> => request('/plans'),
  getPlan: (id: string): Promise<{ success: boolean; data: Plan }> => request(`/plans/${id}`),
  createPlan: (data: Partial<Plan>): Promise<{ success: boolean; data: Plan }> =>
    request('/plans', { method: 'POST', body: JSON.stringify(data) }),
  updatePlan: (id: string, data: Partial<Plan>): Promise<{ success: boolean; data: Plan }> =>
    request(`/plans/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deletePlan: (id: string): Promise<{ success: boolean }> =>
    request(`/plans/${id}`, { method: 'DELETE' }),

  // Business Types
  getBusinessTypes: (): Promise<{ success: boolean; data: BusinessType[] }> => request('/business-types'),
  createBusinessType: (data: Partial<BusinessType>): Promise<{ success: boolean; data: BusinessType }> =>
    request('/business-types', { method: 'POST', body: JSON.stringify(data) }),
  updateBusinessType: (id: string, data: Partial<BusinessType>): Promise<{ success: boolean; data: BusinessType }> =>
    request(`/business-types/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteBusinessType: (id: string): Promise<{ success: boolean }> =>
    request(`/business-types/${id}`, { method: 'DELETE' }),
  updateBusinessTypeModules: (id: string, moduleKeys: string[]): Promise<{ success: boolean; data: any }> =>
    request(`/business-types/${id}/modules`, { method: 'PUT', body: JSON.stringify({ moduleKeys }) }),

  // Modules
  getModules: (): Promise<{ success: boolean; data: Module[] }> => request('/business-modules'),
  getModuleHierarchy: (): Promise<{ success: boolean; data: any[] }> => request('/module-hierarchy'),
  getModulePermissions: (type: 'plans' | 'roles'): Promise<{ success: boolean; data: any }> =>
    request(`/module-permissions/${type}`),
  getPermissionMatrix: (): Promise<{ success: boolean; data: any }> =>
    request('/module-permissions/matrix'),
  getPlanModulePermissions: (): Promise<{ success: boolean; data: any[] }> =>
    request('/module-permissions/plans'),
  updatePlanModulePermissions: (planId: string, modules: string[]): Promise<{ success: boolean; data: any }> =>
    request(`/module-permissions/plans/${planId}`, { method: 'PUT', body: JSON.stringify({ modules }) }),
  updatePlanSubModules: (planId: string, subModules: Record<string, boolean>): Promise<{ success: boolean; data: any }> =>
    request(`/module-permissions/plans/${planId}/sub-modules`, { method: 'PUT', body: JSON.stringify({ subModules }) }),
  getRoleModulePermissions: (): Promise<{ success: boolean; data: any[] }> =>
    request('/module-permissions/roles'),
  updateRoleModulePermissions: (roleName: string, modules: string[]): Promise<{ success: boolean; data: any }> =>
    request(`/module-permissions/roles/${roleName}`, { method: 'PUT', body: JSON.stringify({ modules }) }),
  updateRoleSubModules: (roleName: string, subModules: Record<string, boolean>): Promise<{ success: boolean; data: any }> =>
    request(`/module-permissions/roles/${roleName}/sub-modules`, { method: 'PUT', body: JSON.stringify({ subModules }) }),
  updateBusinessTypeSubModules: (id: string, subModules: Record<string, boolean>): Promise<{ success: boolean; data: any }> =>
    request(`/business-types/${id}/sub-modules`, { method: 'PUT', body: JSON.stringify({ subModules }) }),
  getAllPlans: (): Promise<{ success: boolean; data: any[] }> =>
    request('/module-permissions/plans'),

  // Canonical atomic policies (single source of truth — replaces the legacy
  // module-permissions saves above)
  publishPlanPolicy: (planId: string, modules: Array<{ key: string; entitlementLevel?: string; pages?: Array<{ key: string; entitlementLevel: string }> }>): Promise<{ success: boolean; data: unknown }> =>
    request(`/policies/plans/${planId}`, { method: 'PUT', body: JSON.stringify({ modules }) }),
  publishRolePolicy: (roleId: string, permissions: Array<{ moduleKey: string; pageKey: string; operationKey: string; allowed: boolean; scope?: string }>): Promise<{ success: boolean; data: unknown }> =>
    request(`/policies/roles/${roleId}`, { method: 'PUT', body: JSON.stringify({ permissions }) }),
  getPolicyRoles: (): Promise<{ success: boolean; data: Array<{ id: string; name: string; isSystem: boolean; permissionState: string; policyVersion: number }> }> =>
    request('/policies/roles'),
  publishBusinessTypePolicy: (businessTypeId: string, modules: Array<{ key: string; enabled: boolean; pages?: Array<{ key: string; enabled: boolean }> }>): Promise<{ success: boolean; data: unknown }> =>
    request(`/policies/business-types/${businessTypeId}`, { method: 'PUT', body: JSON.stringify({ modules }) }),
  previewEffectiveAccess: (body: { businessTypeId?: string; planId: string; roleId?: string }): Promise<{ success: boolean; data: unknown }> =>
    request('/policies/preview', { method: 'POST', body: JSON.stringify(body) }),

  // Payment Proofs
  getPaymentProofs: (): Promise<{ success: boolean; data: PaymentProof[] }> =>
    request('/payment-proofs'),
  approvePaymentProof: (id: string): Promise<{ success: boolean }> =>
    request(`/payment-proofs/${id}/approve`, { method: 'POST' }),
  rejectPaymentProof: (id: string, reason: string): Promise<{ success: boolean }> =>
    request(`/payment-proofs/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),

  // Commissions (read-only — tenant commissions are managed inside each business)
  getCommissions: (params?: { page?: number; limit?: number; businessId?: string; status?: string; periodType?: string }): Promise<{ success: boolean; data: { commissions: BackofficeCommission[]; pagination: { page: number; limit: number; total: number; pages: number } } }> => {
    const qs = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== '') qs.append(key, value.toString());
      });
    }
    const query = qs.toString();
    return request(`/commissions${query ? `?${query}` : ''}`);
  },
  getCommissionStats: (businessId?: string): Promise<{ success: boolean; data: BackofficeCommissionStats }> =>
    request(`/commissions/stats${businessId ? `?businessId=${encodeURIComponent(businessId)}` : ''}`),

  // Audit Logs
  getAuditLogs: (params?: string): Promise<{ success: boolean; data: AuditLog[] }> =>
    request(`/logs/actions${params ? `?${params}` : ''}`),
  getLoginLogs: (): Promise<{ success: boolean; data: unknown[] }> => request('/logs/logins'),

  // Impersonation
  startImpersonation: (businessId: string): Promise<{ success: boolean; data: { token: string; session: unknown } }> =>
    request('/impersonate', { method: 'POST', body: JSON.stringify({ businessId }) }),
  validateImpersonation: (token: string): Promise<{ success: boolean; data: unknown }> =>
    request('/impersonate/validate', { method: 'POST', body: JSON.stringify({ token }) }),

  // Support
  getTickets: (params?: string): Promise<{ success: boolean; data: { tickets: SupportTicket[]; pagination: { page: number; limit: number; total: number; pages: number } } }> =>
    request(`/support/tickets${params ? `?${params}` : ''}`),
  getTicket: (id: string): Promise<{ success: boolean; data: SupportTicket }> =>
    request(`/support/tickets/${id}`),
  replyToTicket: (id: string, body: string): Promise<{ success: boolean; data: SupportTicketMessage }> =>
    request(`/support/tickets/${id}/reply`, { method: 'POST', body: JSON.stringify({ body }) }),
  updateTicket: (id: string, data: Partial<{ status: SupportTicket['status']; priority: SupportTicket['priority']; assignedTo: string | null }>): Promise<{ success: boolean; data: SupportTicket }> =>
    request(`/support/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  // Content pages (minimal CMS; public read is GET /api/content/:slug)
  getContentPages: (params?: string): Promise<{ success: boolean; data: ContentPage[] }> =>
    request(`/content/pages${params ? `?${params}` : ''}`),
  getContentPage: (id: string): Promise<{ success: boolean; data: ContentPage }> =>
    request(`/content/pages/${id}`),
  createContentPage: (data: { slug: string; title: string; body: string; status?: ContentPage['status'] }): Promise<{ success: boolean; data: ContentPage }> =>
    request('/content/pages', { method: 'POST', body: JSON.stringify(data) }),
  updateContentPage: (id: string, data: Partial<{ slug: string; title: string; body: string; status: ContentPage['status'] }>): Promise<{ success: boolean; data: ContentPage }> =>
    request(`/content/pages/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteContentPage: (id: string): Promise<{ success: boolean }> =>
    request(`/content/pages/${id}`, { method: 'DELETE' }),
  getAnnouncements: (): Promise<{ success: boolean; data: Announcement[] }> => request('/announcements'),
  createAnnouncement: (data: { title: string; content: string; type: Announcement['type']; status: Announcement['status'] }): Promise<{ success: boolean; data: Announcement }> =>
    request('/announcements', { method: 'POST', body: JSON.stringify(data) }),
  updateAnnouncement: (id: string, data: Partial<{ title: string; content: string; type: Announcement['type']; status: Announcement['status'] }>): Promise<{ success: boolean; data: Announcement }> =>
    request(`/announcements/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteAnnouncement: (id: string): Promise<{ success: boolean }> =>
    request(`/announcements/${id}`, { method: 'DELETE' }),

  // Feature Flags
  getFeatureFlags: (): Promise<{ success: boolean; data: FeatureFlag[] }> => request('/feature-flags'),
  createFeatureFlag: (data: { key: string; name: string; description?: string; enabled?: boolean }): Promise<{ success: boolean; data: FeatureFlag }> =>
    request('/feature-flags', { method: 'POST', body: JSON.stringify(data) }),
  updateFeatureFlag: (id: string, data: Partial<{ key: string; name: string; description: string; enabled: boolean }>): Promise<{ success: boolean; data: FeatureFlag }> =>
    request(`/feature-flags/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteFeatureFlag: (id: string): Promise<{ success: boolean }> =>
    request(`/feature-flags/${id}`, { method: 'DELETE' }),

  // System health — served by the main API's public /health endpoint
  // (middleware/health-checks.ts), which reports live database status.
  getSystemHealth: async (): Promise<{
    status: string;
    timestamp: string;
    database?: {
      type: string;
      mode: string;
      modeLabel: string;
      provider: string;
      status: string;
      isOnline: boolean;
      isOffline?: boolean;
      modeMatch?: boolean;
      select1?: string;
      postgresql: { connected: boolean; configured: boolean };
      sqlite: { connected: boolean; path: string };
    };
  }> => {
    const apiBase = config.api.baseUrl.replace(/\/$/, '');
    const res = await fetch(`${apiBase}/health`, { credentials: 'include' });
    return res.json();
  },
};
