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
  AuditLog,
  SupportTicket,
  Announcement,
  FeatureFlag,
  SystemHealth,
  BackofficeAdmin,
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

  // Payment Proofs
  getPaymentProofs: (): Promise<{ success: boolean; data: PaymentProof[] }> =>
    request('/payment-proofs'),
  approvePaymentProof: (id: string): Promise<{ success: boolean }> =>
    request(`/payment-proofs/${id}/approve`, { method: 'POST' }),
  rejectPaymentProof: (id: string, reason: string): Promise<{ success: boolean }> =>
    request(`/payment-proofs/${id}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),

  // Audit Logs
  getAuditLogs: (params?: string): Promise<{ success: boolean; data: AuditLog[] }> =>
    request(`/logs/actions${params ? `?${params}` : ''}`),
  getLoginLogs: (): Promise<{ success: boolean; data: any[] }> => request('/logs/logins'),

  // Impersonation
  startImpersonation: (businessId: string): Promise<{ success: boolean; data: { token: string; session: any } }> =>
    request('/impersonate', { method: 'POST', body: JSON.stringify({ businessId }) }),
  validateImpersonation: (token: string): Promise<{ success: boolean; data: any }> =>
    request('/impersonate/validate', { method: 'POST', body: JSON.stringify({ token }) }),

  // Support
  getTickets: (): Promise<{ success: boolean; data: SupportTicket[] }> => request('/support/tickets'),
  getAnnouncements: (): Promise<{ success: boolean; data: Announcement[] }> => request('/announcements'),
};
