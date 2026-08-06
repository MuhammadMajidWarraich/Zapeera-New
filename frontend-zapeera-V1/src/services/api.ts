import { config } from '../lib/config';
import {
  clearStoredSession,
  readStoredUser,
  USER_STORAGE_KEY,
  writeStoredUser,
} from '../lib/session-storage';
import { waitForBackend } from '../utils/backendHealthCheck';
import { normalizeAppRole } from '../utils/app-role';

const API_BASE_URL = config.api.baseUrl;
const API_TIMEOUT = config.api.timeout;
const DEBUG_MODE = config.debug.enabled;
const LOG_LEVEL = config.debug.logLevel;

// Track if backend is ready
let backendReady = false;
let backendCheckPromise: Promise<boolean> | null = null;

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  message?: string;
}

export class ApiService {
  private baseURL: string;
  private timeout: number;
  private contextGetter: (() => { companyId?: string | number; branchId?: string | number }) | null = null;
  private authRequestLocks = new Map<string, Promise<any>>();
  private pendingRequests = new Map<string, Promise<any>>();
  private lastRequestTime = new Map<string, number>();
  private _suppressAuthRequired = false;
  private _accessToken: string | null = null;

  constructor(baseURL: string) {
    this.baseURL = baseURL;
    this.timeout = API_TIMEOUT;
  }

  set suppressAuthRequired(val: boolean) { this._suppressAuthRequired = val; }

  get accessToken(): string | null { return this._accessToken; }

  setAccessToken(token: string | null): void {
    this._accessToken = token;
  }

  setContextGetter(getter: (() => { companyId?: string; branchId?: string }) | null) {
    this.contextGetter = getter;
  }

  // Get CSRF token from cookie
  private getCSRFToken(): string | null {
    try {
      const cookies = document.cookie.split(';');
      for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'csrf-token' || name === 'XSRF-TOKEN') {
          return decodeURIComponent(value);
        }
      }
    } catch {
      // ignore
    }
    return null;
  }

  private async ensureBackendReadyIfElectron() {
    const isElectron = typeof window !== 'undefined' && typeof window.electronAPI !== 'undefined';
    if (!isElectron) return;

    if (backendReady) return;
    if (!backendCheckPromise) {
      backendCheckPromise = (async () => {
        try {
          await waitForBackend(this.baseURL);
          backendReady = true;
          return true;
        } finally {
          backendCheckPromise = null;
        }
      })();
    }

    await backendCheckPromise;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    await this.ensureBackendReadyIfElectron();

    const url = `${this.baseURL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers = new Headers(options.headers || undefined);
      if (!headers.has('Content-Type') && options.body) {
        headers.set('Content-Type', 'application/json');
      }

      // Add Authorization header from instance token first, then fallback to localStorage
      if (!headers.has('Authorization')) {
        if (this._accessToken) {
          headers.set('Authorization', `Bearer ${this._accessToken}`);
        } else {
          try {
            // Desktop persists the embedded-backend token under 'localAccessToken'
            // (provisioned after cloud login); web uses 'token'. Prefer the local
            // token so desktop API calls authenticate against the embedded server.
            const storedToken = localStorage.getItem('localAccessToken') || localStorage.getItem('token');
            if (storedToken) {
              headers.set('Authorization', `Bearer ${storedToken}`);
            }
          } catch { /* ignore */ }
        }
      }

      try {
        const ctx = this.contextGetter ? this.contextGetter() : null;
        const explicitCompanyId = (options as any)?.companyId ? String((options as any).companyId) : '';
        const explicitBranchId = (options as any)?.branchId ? String((options as any).branchId) : '';
        const companyId = explicitCompanyId || (ctx?.companyId ? String(ctx.companyId) : '');
        const branchId = explicitBranchId || (ctx?.branchId ? String(ctx.branchId) : '');
        if (companyId) headers.set('X-Business-ID', companyId);
        if (branchId && !headers.has('X-Zapeera-Omit-Branch-Context')) headers.set('X-Branch-ID', branchId);
        headers.delete('X-Zapeera-Omit-Branch-Context');
      } catch {
        // ignore
      }

      // Add CSRF token for state-changing requests
      const method = (options.method || 'GET').toUpperCase();
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        const csrfToken = this.getCSRFToken();
        if (csrfToken) {
          headers.set('X-CSRF-Token', csrfToken);
        }
      }

      // Request deduplication - prevent duplicate requests
      // Include X-Business-ID in the key so requests for different companies don't collide
      const requestKey = `${method}:${url}:${headers.get('X-Business-ID') || ''}`;
      if (method === 'GET' && this.pendingRequests.has(requestKey)) {
        return this.pendingRequests.get(requestKey)!;
      }

      // Rate limiting disabled during development to prevent loading delays
      // if (method === 'GET') {
      //   const lastTime = this.lastRequestTime.get(requestKey) || 0;
      //   const now = Date.now();
      //   const minDelay = 100;
      //   if (now - lastTime < minDelay) {
      //     await new Promise(resolve => setTimeout(resolve, minDelay - (now - lastTime)));
      //   }
      //   this.lastRequestTime.set(requestKey, Date.now());
      // }

      let response: Response;
      let text: string;

      // Do NOT retry 429 — each retry counts against the rate limit
      const requestPromise = (async () => {
        response = await fetch(url, { ...options, headers, signal: controller.signal, credentials: 'include' });
        text = await response.text();
        return { response, text };
      })();

      const processedRequestPromise: Promise<ApiResponse<T>> = (async () => {
        const { response: finalResponse, text: finalText } = await requestPromise;
        response = finalResponse;
        text = finalText;

        let data: any = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = text;
        }

        const contentType = response.headers.get('content-type') || '';
        const looksLikeHtml = typeof data === 'string' && data.trim().startsWith('<');
        if (looksLikeHtml || contentType.includes('text/html')) {
          return {
            success: false,
            message: 'Invalid API response: received HTML instead of JSON. Check API base URL and backend connectivity.',
          };
        }

        if (!response.ok) {
          const message = (data && typeof data === 'object' && data.message) ? data.message : `Request failed (${response.status})`;
          const errorCode = (data && typeof data === 'object' && data.error) ? data.error : null;

          // Force logout only for true authentication failures. Do NOT logout for
          // business-membership 401s (errorCode === 'NO_MEMBERSHIP').
          // When _suppressAuthRequired is set (cloud API), never dispatch authRequired.
          if (response.status === 401 && typeof window !== 'undefined' && !this._suppressAuthRequired) {
            const lowerMsg = (message || '').toLowerCase();
            const isInvalidToken = lowerMsg.includes('invalid token') || lowerMsg.includes('invalid token type') || lowerMsg.includes('unauthorized');

            if (errorCode === 'NO_MEMBERSHIP') {
              // Membership issue - do not treat as auth-required (don't logout)
            } else if (errorCode) {
              // Other error codes (unknown) — treat as auth-required
              window.dispatchEvent(new CustomEvent('authRequired', { detail: { message, errorCode } }));
            } else if (isInvalidToken) {
              // Message-based invalid token detection
              window.dispatchEvent(new CustomEvent('authRequired', { detail: { message, errorCode } }));
            } else {
              // Unknown 401 without explicit token error — do not logout to avoid
              // clearing valid sessions for membership-related responses.
            }
          }

          // Handle module access errors
          if (response.status === 403 && errorCode === 'MODULE_NOT_ALLOWED') {
            // Import and call the error handler
            import('./api-error-handler').then(({ handleApiError }) => {
              handleApiError({
                response: {
                  status: 403,
                  data: {
                    success: false,
                    error: 'MODULE_NOT_ALLOWED',
                    message: message,
                    module: data?.module,
                    upgradeUrl: data?.upgradeUrl,
                  },
                },
              } as any);
            });
          }

          return {
            success: false,
            message: message,
            data: (data && typeof data === 'object' && 'data' in data ? data.data : undefined) as any,
          };
        }

        if (data && typeof data === 'object' && 'success' in data) {
          const result = data as ApiResponse<T>;
          if (endpoint.includes('entitlements')) {
          }
          return result;
        }

        const successResult = { success: true, data: data as T };
        if (endpoint.includes('entitlements')) {
        }
        return successResult;
      })();

      if (method === 'GET') {
        this.pendingRequests.set(requestKey, processedRequestPromise);
        processedRequestPromise.finally(() => {
          setTimeout(() => this.pendingRequests.delete(requestKey), 100);
        });
      }

      return await processedRequestPromise;
    } catch (e: any) {
      return { success: false, message: e?.message || 'Request failed' };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Authentication
  async login(credentials: { usernameOrEmail: string; password: string }) {
    // CRITICAL: Request lock to prevent multiple simultaneous login requests
    const lockKey = 'auth:login';
    if (this.authRequestLocks.has(lockKey)) {
      return this.authRequestLocks.get(lockKey)!;
    }

    if (DEBUG_MODE) {
    }

    const loginPromise = (async () => {
      try {
      const response = await this.request<{
        user: {
          id: string;
          username: string;
          name: string;
          email?: string;
          profileImage?: string;
          role: string;
          branchId: string;
          companyId?: string;
          createdBy?: string;
          isActive?: boolean;
          businessAccessGranted?: boolean;
          membership?: {
            id: string;
            roleId?: string | null;
            roleName?: string | null;
            status?: string | null;
          } | null;
          memberships?: Array<{
            id: string;
            businessId: string;
            roleId?: string | null;
            roleName?: string | null;
            branchIds?: string[];
            status?: string | null;
          }>;
          platformRole?: string | null;
          platformPermissions?: string[];
        };
      }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials),
      });

      if (!response) {
        return {
          success: false,
          message: 'No response received from server'
        };
      }

      if (response.success && response.data) {
        const { user, token, sessionToken } = response.data as any;

        // Store JWT token for Authorization header on subsequent requests
        if (token) {
          try {
            localStorage.setItem('token', token);
          } catch { /* ignore */ }
        }

        // Store session token for offline session persistence
        if (sessionToken) {
          try {
            localStorage.setItem('sessionToken', sessionToken);
          } catch { /* ignore */ }
        }

        if (!user || !user.id) {
          return {
            success: false,
            message: 'Invalid user data received from server'
          };
        }

        try {
          const userForStore = {
            ...user,
            role: normalizeAppRole(user.role),
            membership: user.membership
              ? {
                  ...user.membership,
                  roleName: user.membership.roleName ? normalizeAppRole(user.membership.roleName) : undefined,
                }
              : user.membership,
            memberships: Array.isArray(user.memberships)
              ? user.memberships.map((m) => ({
                  ...m,
                  roleName: m.roleName ? normalizeAppRole(m.roleName) : undefined,
                }))
              : user.memberships,
          };
          writeStoredUser(userForStore);
          const storedUser = readStoredUser();

          if (!storedUser) {
            // storage failed; continue but API may fail later
          }
        } catch (storageError: any) {
          return {
            success: false,
            message: 'Failed to save authentication data: ' + storageError?.message
          };
        }
      }

      return response;
    } catch (error: any) {
      // Return error response in expected format
      return {
        success: false,
        message: error?.message || 'Login request failed',
        accountDisabled: error?.response?.accountDisabled || false
      };
      } finally {
        // Always remove lock when done
        this.authRequestLocks.delete(lockKey);
      }
    })();

    // Store the promise in the lock
    this.authRequestLocks.set(lockKey, loginPromise);
    return loginPromise;
  }

  // Offline session login - validates existing session without password
  async sessionLogin() {
    const sessionToken = localStorage.getItem('sessionToken');
    if (!sessionToken) {
      return { success: false, message: 'No session token available', needsReauth: true };
    }

    const response = await this.request<{
      user: any;
      token: string;
      sessionToken: string;
      offline: boolean;
      offlineGrace: boolean;
    }>('/auth/session/login', {
      method: 'POST',
      body: JSON.stringify({ sessionToken }),
    });

    if (response.success && response.data) {
      const { token, sessionToken: newSessionToken } = response.data as any;

      if (token) {
        try { localStorage.setItem('token', token); } catch { }
      }
      if (newSessionToken) {
        try { localStorage.setItem('sessionToken', newSessionToken); } catch { }
      }
    }

    return response;
  }

  // Sync account data from cloud (memberships, businesses, roles)
  async syncAccount() {
    return this.request<{
      localIdentity: any;
      memberships: any[];
      businesses: any[];
      roles: string[];
    }>('/sync/account', {
      method: 'POST',
    });
  }

  async register(userData: {
    username: string;
    email: string;
    password: string;
    name: string;
    role?: string;
    branchId: string;
    branchData?: {
      name: string;
      address: string;
      phone: string;
    };
  }) {
    // CRITICAL: Request lock to prevent multiple simultaneous register requests
    const lockKey = 'auth:register';
    if (this.authRequestLocks.has(lockKey)) {
      return this.authRequestLocks.get(lockKey)!;
    }

    const registerPromise = (async () => {
      try {
        const response = await this.request<{
          user: {
            id: string;
            username: string;
            name: string;
            role: string;
            branchId: string;
            adminId?: string;
          };
        }>('/auth/register', {
          method: 'POST',
          body: JSON.stringify(userData),
        });

        // Only store user data if registration was successful AND user was returned
        // For accounts pending activation, no user data is returned - don't store anything
        if (response.success && response.data && response.data.user) {
          const u = response.data.user;
          const userForStore = { ...u, role: normalizeAppRole(u.role) };
          writeStoredUser(userForStore);
        } else if (response.success) {
          // Registration successful but no token (pending activation) - ensure no stale data
          clearStoredSession();
          localStorage.removeItem('auth_initialized');
        }

        return response;
      } finally {
        // Always remove lock when done
        this.authRequestLocks.delete(lockKey);
      }
    })();

    // Store the promise in the lock
    this.authRequestLocks.set(lockKey, registerPromise);
    return registerPromise;
  }

  async getProfile() {
    return this.request<{
      id: string;
      username: string;
      name: string;
      role: string;
      email: string;
      profileImage?: string;
      phone?: string | null;
      address?: string | null;
      city?: string | null;
      country?: string | null;
      dateOfBirth?: string | null;
      bio?: string | null;
      twoFactorEnabled?: boolean;
      branchId: string;
      branch?: {
        id: string;
        name: string;
      };
    }>('/auth/profile');
  }

  // Forgot Password - Request password reset
  // Accepts either email or username (for consistency with login)
  async forgotPassword(emailOrUsername: string): Promise<{
    success: boolean;
    message: string;
    contactNumber?: string;
  }> {
    const response = await this.request<{
      contactNumber?: string;
    }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({
        email: emailOrUsername, // Backend will check both email and username
        username: emailOrUsername // Send both for backend flexibility
      }),
    });

    // Return the response directly with contactNumber at root level
    return {
      success: response.success,
      message: response.message || 'If an account with that email exists, you will receive a password reset link shortly.',
      contactNumber: response.data?.contactNumber || (response as any).contactNumber
    };
  }

  // Verify Reset Token - Check if reset token is valid
  async verifyResetToken(token: string): Promise<{
    success: boolean;
    message: string;
    data?: { email: string; name: string };
  }> {
    const queryParams = new URLSearchParams({ token });
    const response = await this.request<{
      email: string;
      name: string;
    }>(`/auth/verify-reset-token?${queryParams.toString()}`, {
      method: 'GET',
    });

    return {
      success: response.success,
      message: response.message || '',
      data: response.data
    };
  }

  // Verify Email
  async verifyEmail(token: string): Promise<{
    success: boolean;
    message: string;
    expired?: boolean;
  }> {
    const response = await this.request(`/auth/verify-email?token=${encodeURIComponent(token)}`, {
      method: 'GET',
    });
    return {
      success: response.success,
      message: response.message || '',
      expired: (response as any).expired,
    };
  }

  // Resend Verification Email
  async resendVerificationEmail(email: string): Promise<{
    success: boolean;
    message: string;
  }> {
    const response = await this.request('/auth/resend-verification', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    return {
      success: response.success,
      message: response.message || 'If an account exists, a new verification link has been sent.',
    };
  }

  // Reset Password with Token - Reset password using token from email
  async resetPasswordWithToken(token: string, newPassword: string): Promise<{
    success: boolean;
    message: string;
  }> {
    const response = await this.request('/auth/reset-password-with-token', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    });

    return {
      success: response.success,
      message: response.message || 'Password reset successful'
    };
  }

  // Reset Password (Admin only)
  async resetPassword(data: { userId?: string; email?: string; newPassword: string }) {
    return this.request<{
      email: string;
      name: string;
    }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async changePassword(passwordData: {
    currentPassword: string;
    newPassword: string;
  }) {
    return this.request<{
      success: boolean;
      message: string;
    }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(passwordData),
    });
  }

  async updateProfile(profileData: {
    name?: string;
    username?: string;
    email?: string;
    phone?: string | null;
    address?: string | null;
    city?: string | null;
    country?: string | null;
    dateOfBirth?: string | null;
    bio?: string | null;
    twoFactorEnabled?: boolean;
  }) {
    return this.request<{
      id: string;
      username: string;
      name: string;
      email: string;
      profileImage?: string;
      phone?: string | null;
      address?: string | null;
      city?: string | null;
      country?: string | null;
      dateOfBirth?: string | null;
      bio?: string | null;
      twoFactorEnabled?: boolean;
      role: string;
      branchId: string;
      updatedAt: string;
    }>('/auth/update-profile', {
      method: 'PUT',
      body: JSON.stringify(profileData),
    });
  }

  // Branches
  async getBranches(options?: { skipCache?: boolean }) {
    const headers: Record<string, string> = {};
    if (options?.skipCache) {
      headers['X-Zapeera-Skip-Cache'] = '1';
    }
    headers['X-Zapeera-Omit-Branch-Context'] = '1';

    return this.request<{
      branches: Array<{
        id: string;
        name: string;
        address: string;
        phone: string;
        email: string;
        managerId?: string;
        companyId: string;
        isActive: boolean;
        createdAt: string;
        company?: {
          id: string;
          name: string;
        };
        _count?: {
          users: number;
          products: number;
          customers: number;
        };
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
      pages: number;
    };
  }>('/branches', {
    headers
  });
  }

  // Products
  async getProducts(params?: {
    page?: number;
    limit?: number;
    search?: string;
    category?: string;
    categoryType?: string;
    branchId?: string;
    companyId?: string;
    lowStock?: boolean;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    return this.request<{
      products: Array<{
        id: string;
        name: string;
        description?: string;
        category: { id: string; name: string };
        supplier: { id: string; name: string };
        branch: { id: string; name: string };
        costPrice: number;
        sellingPrice: number;
        stock: number;
        minStock: number;
        maxStock?: number;
        unitType: string;
        unitsPerPack: number;
        barcode?: string;
        requiresPrescription: boolean;
        isActive: boolean;
        createdAt: string;
        updatedAt: string;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/products${query ? `?${query}` : ''}`);
  }

  async getProduct(productId: string) {
    return this.request<{
      id: string;
      name: string;
      description?: string;
      formula?: string;
      category: { id: string; name: string };
      supplier: { id: string; name: string };
      branch: { id: string; name: string };
      costPrice: number;
      sellingPrice: number;
      stock: number;
      minStock: number;
      maxStock?: number;
      unitType: string;
      unitsPerPack: number;
      barcode?: string;
      requiresPrescription: boolean;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
      stockMovements: Array<{
        id: string;
        type: string;
        quantity: number;
        reason?: string;
        reference?: string;
        createdAt: string;
      }>;
    }>(`/products/${productId}`);
  }

  async getStockMovements(params?: {
    page?: number;
    limit?: number;
    productId?: string;
    startDate?: string;
    endDate?: string;
    type?: string;
    branchId?: string;
    companyId?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    return this.request<{
      stockMovements: Array<{
        id: string;
        type: string;
        quantity: number;
        reason?: string;
        reference?: string;
        createdAt: string;
        product: {
          id: string;
          name: string;
          sku?: string;
          unitType: string;
          branch: {
            id: string;
            name: string;
          };
        };
        createdBy?: string;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/products/stock-movements${query ? `?${query}` : ''}`);
  }

  async createProduct(productData: {
    name: string;
    description?: string;
    formula?: string;
    categoryId?: string | null;
    supplierId?: string | null;
    branchId?: string | null;
    barcode?: string | null;
    requiresPrescription?: boolean;
    isActive?: boolean;
    // Temporary fields for backend compatibility
    costPrice?: number;
    sellingPrice?: number;
    stock?: number;
    minStock?: number;
    maxStock?: number;
    unitsPerPack?: number;
  }) {
    return this.request<{
      id: string;
      name: string;
      description?: string;
      formula?: string;
      category: { id: string; name: string };
      supplier: { id: string; name: string };
      branch: { id: string; name: string };
      barcode?: string;
      requiresPrescription: boolean;
      isActive: boolean;
      createdAt: string;
      // Temporary fields for backend compatibility
      costPrice?: number;
      sellingPrice?: number;
      stock?: number;
      minStock?: number;
      maxStock?: number;
      unitsPerPack?: number;
    }>('/products', {
      method: 'POST',
      body: JSON.stringify(productData),
    });
  }

  async bulkImportProducts(products: Array<{
    name: string;
    description?: string;
    categoryId: string;
    categoryName?: string; // For auto-creating categories
    supplierId: string;
    branchId: string;
    costPrice: number;
    sellingPrice: number;
    stock: number;
    minStock?: number;
    maxStock?: number;
    unitType: string;
    unitsPerPack: number;
    barcode?: string;
    requiresPrescription?: boolean;
  }>) {
    return this.request<{
      successful: Array<{
        id: string;
        name: string;
        description?: string;
        category: { id: string; name: string };
        supplier: { id: string; name: string };
        branch: { id: string; name: string };
        costPrice: number;
        sellingPrice: number;
        stock: number;
        minStock: number;
        maxStock?: number;
        unitType: string;
        unitsPerPack: number;
        barcode?: string;
        requiresPrescription: boolean;
        isActive: boolean;
        createdAt: string;
      }>;
      failed: Array<{
        product: any;
        error: string;
      }>;
      total: number;
      successCount: number;
      failureCount: number;
    }>('/products/bulk-import', {
      method: 'POST',
      body: JSON.stringify({ products }),
    });
  }

  async updateProduct(productId: string, productData: {
    name?: string;
    description?: string;
    categoryId?: string;
    supplierId?: string;
    costPrice?: number;
    sellingPrice?: number;
    stock?: number;
    minStock?: number;
    maxStock?: number;
    unitType?: string;
    unitsPerPack?: number;
    barcode?: string;
    requiresPrescription?: boolean;
    isActive?: boolean;
  }) {
    return this.request<{
      id: string;
      name: string;
      description?: string;
      category: { id: string; name: string };
      supplier: { id: string; name: string };
      branch: { id: string; name: string };
      costPrice: number;
      sellingPrice: number;
      stock: number;
      minStock: number;
      maxStock?: number;
      unitType: string;
      unitsPerPack: number;
      barcode?: string;
      requiresPrescription: boolean;
      isActive: boolean;
      updatedAt: string;
    }>(`/products/${productId}`, {
      method: 'PUT',
      body: JSON.stringify(productData),
    });
  }

  async deleteProduct(productId: string) {
    return this.request<{ message: string }>(`/products/${productId}`, {
      method: 'DELETE',
    });
  }

  async bulkDeleteProducts(productIds: string[]) {
    return this.request<{
      message: string;
      data: {
        deletedCount: number;
        deletedProducts: Array<{ id: string; name: string }>
      }
    }>('/products/bulk-delete', {
      method: 'POST',
      body: JSON.stringify({ productIds }),
    });
  }

  async updateStock(productId: string, stockData: {
    type: 'IN' | 'OUT' | 'ADJUSTMENT' | 'RETURN';
    quantity: number;
    reason?: string;
    reference?: string;
  }) {
    return this.request<{
      id: string;
      name: string;
      stock: number;
      category: { id: string; name: string };
      supplier: { id: string; name: string };
      branch: { id: string; name: string };
    }>(`/products/${productId}/stock`, {
      method: 'PATCH',
      body: JSON.stringify(stockData),
    });
  }

  // Customers
  async getCustomers(params?: {
    page?: number;
    limit?: number;
    search?: string;
    branchId?: string;
    companyId?: string;
    vip?: boolean;
    createdByRole?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    const url = query ? `/customers?${query}` : '/customers';
    return this.request<{
      customers: Array<{
        id: string;
        name: string;
        phone: string;
        email?: string;
        address?: string;
        branch: { id: string; name: string };
        totalPurchases: number;
        loyaltyPoints: number;
        isVIP: boolean;
        lastVisit?: string;
        isActive: boolean;
        createdAt: string;
        updatedAt: string;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(url);
  }

  async createCustomer(customerData: {
    name: string;
    phone: string;
    email?: string;
    address?: string;
    branchId: string;
  }) {
    return this.request<{
      id: string;
      name: string;
      phone: string;
      email?: string;
      address?: string;
      branch: { id: string; name: string };
      totalPurchases: number;
      loyaltyPoints: number;
      isVIP: boolean;
      lastVisit?: string;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    }>('/customers', {
      method: 'POST',
      body: JSON.stringify(customerData),
    });
  }

  // Sales
  async createSale(saleData: {
    customerId?: string;
    branchId: string;
    items: Array<{
      productId: string;
      quantity: number;
      unitPrice: number;
      batchNumber?: string;
      expiryDate?: string;
    }>;
    paymentMethod: 'CASH' | 'CARD' | 'MOBILE' | 'BANK_TRANSFER';
    discountAmount?: number;
    discountPercentage?: number;
    saleDate?: string;
  }) {
    return this.request<{
      id: string;
      customer?: {
        id: string;
        name: string;
        phone: string;
        email?: string;
        address?: string;
        totalPurchases: number;
        loyaltyPoints: number;
        isVIP: boolean;
        lastVisit?: string;
      };
      items: Array<{
        id: string;
        product: {
          id: string;
          name: string;
          unitType: string;
          barcode?: string;
        };
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        batchNumber?: string;
        expiryDate?: string;
      }>;
      subtotal: number;
      taxAmount: number;
      discountAmount: number;
      totalAmount: number;
      paymentMethod: string;
      paymentStatus: string;
      status: string;
      createdAt: string;
      receiptNumber: string;
    }>('/sales', {
      method: 'POST',
      body: JSON.stringify(saleData),
    });
  }

  async updateSale(saleId: string, updateData: {
    discountPercentage?: number;
    saleDate?: string;
    notes?: string;
    paymentStatus?: string;
  }) {
    return this.request<{
      id: string;
      invoiceNumber: string;
      customerId?: string;
      userId: string;
      branchId: string;
      subtotal: number;
      taxAmount: number;
      discountAmount: number;
      discountPercentage?: number;
      totalAmount: number;
      paymentMethod: string;
      paymentStatus: string;
      status: string;
      saleDate?: string;
      createdAt: string;
      updatedAt: string;
      receiptNumber: string;
    }>(`/sales/${saleId}`, {
      method: 'PUT',
      body: JSON.stringify(updateData),
    });
  }

  async getSales(params?: {
    page?: number;
    limit?: number;
    startDate?: string;
    endDate?: string;
    branchId?: string;
    companyId?: string;
    customerId?: string;
    paymentMethod?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    return this.request<{
      sales: Array<{
        id: string;
        customerId?: string;
        userId: string;
        branchId: string;
        subtotal: number;
        taxAmount: number;
        discountAmount: number;
        totalAmount: number;
        paymentMethod: string;
        paymentStatus: string;
        status: string;
        createdAt: string;
        customer?: {
          id: string;
          name: string;
          phone: string;
        };
        user: {
          id: string;
          name: string;
          username: string;
        };
        branch: {
          id: string;
          name: string;
        };
        items: Array<{
          id: string;
          productId: string;
          quantity: number;
          unitPrice: number;
          totalPrice: number;
          product: {
            id: string;
            name: string;
            unitType: string;
          };
        }>;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/sales${query ? `?${query}` : ''}`);
  }

  async getSale(id: string) {
    return this.request<{
      id: string;
      customerId?: string;
      userId: string;
      branchId: string;
      subtotal: number;
      taxAmount: number;
      discountAmount: number;
      totalAmount: number;
      paymentMethod: string;
      paymentStatus: string;
      status: string;
      createdAt: string;
      customer?: {
        id: string;
        name: string;
        phone: string;
        email?: string;
        address?: string;
      };
      user: {
        id: string;
        name: string;
        username: string;
      };
      branch: {
        id: string;
        name: string;
        address: string;
      };
      items: Array<{
        id: string;
        productId: string;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        batchNumber?: string;
        expiryDate?: string;
        product: {
          id: string;
          name: string;
          unitType: string;
          barcode?: string;
        };
      }>;
      receipts: Array<{
        id: string;
        receiptNumber: string;
        printedAt?: string;
      }>;
    }>(`/sales/${id}`);
  }

  async getSaleByReceiptNumber(receiptNumber: string) {
    return this.request<{
      id: string;
      customerId?: string;
      userId: string;
      branchId: string;
      subtotal: number;
      taxAmount: number;
      discountAmount: number;
      totalAmount: number;
      paymentMethod: string;
      paymentStatus: string;
      status: string;
      createdAt: string;
      customer?: {
        id: string;
        name: string;
        phone: string;
        email?: string;
        address?: string;
      };
      user: {
        id: string;
        name: string;
        username: string;
      };
      branch: {
        id: string;
        name: string;
        address: string;
      };
      items: Array<{
        id: string;
        productId: string;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        batchNumber?: string;
        expiryDate?: string;
        product: {
          id: string;
          name: string;
          unitType: string;
          barcode?: string;
        };
      }>;
      receipts: Array<{
        id: string;
        receiptNumber: string;
        printedAt?: string;
      }>;
    }>(`/sales/receipt/${receiptNumber}`);
  }

  async getAvailableReceiptNumbers() {
    return this.request<{
      receipts: Array<{
        id: string;
        receiptNumber: string;
        saleId: string;
        printedAt: string;
      }>;
    }>('/sales/receipts');
  }

  // Customer Purchase History
  async getCustomerPurchaseHistory(customerId: string, params?: {
    page?: number;
    limit?: number;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    return this.request<{
      customer: {
        id: string;
        name: string;
        phone: string;
      };
      sales: Array<{
        id: string;
        totalAmount: number;
        subtotal: number;
        taxAmount: number;
        paymentMethod: string;
        createdAt: string;
        items: Array<{
          id: string;
          product: {
            id: string;
            name: string;
            unitType: string;
          };
          quantity: number;
          unitPrice: number;
          totalPrice: number;
        }>;
        user: {
          name: string;
          username: string;
        };
        branch: {
          name: string;
        };
      }>;
      stats: {
        totalPurchases: number;
        totalSpent: number;
        averageOrder: number;
      };
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/customers/${customerId}/purchase-history${query ? `?${query}` : ''}`);
  }

  // Reports
  async getSalesReport(params?: {
    startDate?: string;
    endDate?: string;
    branchId?: string;
    companyId?: string;
    groupBy?: 'day' | 'week' | 'month' | 'year' | 'hour';
    period?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    return this.request<{
      summary: {
        totalSales: number;
        totalRevenue: number;
        totalSubtotal: number;
        totalTax: number;
        totalDiscount: number;
      };
      salesByPaymentMethod: Array<{
        paymentMethod: string;
        _sum: { totalAmount: number };
        _count: { id: number };
      }>;
      topProducts: Array<{
        productId: string;
        _sum: { quantity: number; totalPrice: number };
        product: {
          id: string;
          name: string;
          unitType: string;
          category: { name: string };
        };
      }>;
      salesTrend: Array<{
        createdAt: Date;
        _sum: { totalAmount: number };
        _count: { id: number };
      }>;
    }>(`/reports/sales${query ? `?${query}` : ''}`);
  }

  async getInventoryReport(params?: {
    branchId?: string;
    companyId?: string;
    lowStock?: boolean;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    return this.request<{
      summary: {
        totalProducts: number;
        totalStock: number;
        lowStockCount: number;
      };
      productsByCategory: Array<{
        categoryId: string;
        _sum: { stock: number };
        _count: { id: number };
        category: {
          id: string;
          name: string;
        };
      }>;
      lowStockProducts: Array<{
        id: string;
        name: string;
        stock: number;
        minStock: number;
        category: { name: string };
        supplier: { name: string };
      }>;
    }>(`/reports/inventory${query ? `?${query}` : ''}`);
  }

  async getCustomerReport(params?: {
    startDate?: string;
    endDate?: string;
    branchId?: string;
    vip?: boolean;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    return this.request<{
      summary: {
        totalCustomers: number;
        totalSpent: number;
        totalLoyaltyPoints: number;
        averageSpent: number;
      };
      customersByVIP: Array<{
        isVIP: boolean;
        _count: { id: number };
        _sum: { totalPurchases: number; loyaltyPoints: number };
      }>;
      topCustomers: Array<{
        id: string;
        name: string;
        phone: string;
        totalPurchases: number;
        loyaltyPoints: number;
        lastVisit: string;
        isVIP: boolean;
        _count: { sales: number };
      }>;
      recentCustomers: Array<{
        id: string;
        name: string;
        phone: string;
        createdAt: string;
        totalPurchases: number;
      }>;
    }>(`/reports/customers${query ? `?${query}` : ''}`);
  }

  async getProductPerformanceReport(params?: {
    startDate?: string;
    endDate?: string;
    branchId?: string;
    categoryId?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    return this.request<{
      topProducts: Array<{
        productId: string;
        _sum: { quantity: number; totalPrice: number };
        _count: { id: number };
        product: {
          id: string;
          name: string;
          unitType: string;
          sellingPrice: number;
          stock: number;
          category: { name: string };
          supplier: { name: string };
        };
      }>;
      categoryPerformance: Array<{
        category: string;
        quantity: number;
        revenue: number;
        count: number;
      }>;
    }>(`/reports/products${query ? `?${query}` : ''}`);
  }

  async getExpenses(params?: {
    startDate?: string;
    endDate?: string;
    branchId?: string;
    companyId?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    return this.request<{
      expenses: Array<{
        id: string;
        amount: number;
        category: string;
        description: string;
        date: string;
        branchId?: string;
        companyId?: string;
      }>;
      summary: {
        totalExpenses: number;
        byCategory: Array<{
          category: string;
          total: number;
          count: number;
        }>;
      };
    }>(`/expenses${query ? `?${query}` : ''}`);
  }

  async getAdvancedSalesReport(params?: { startDate?: string; endDate?: string; period?: string; branchId?: string; companyId?: string }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) queryParams.append(key, value.toString());
      });
    }
    return this.request<any>(`/reports/advanced/sales${queryParams.toString() ? `?${queryParams.toString()}` : ''}`);
  }

  async getAdvancedInventoryReport(params?: { branchId?: string; companyId?: string }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) queryParams.append(key, value.toString());
      });
    }
    return this.request<any>(`/reports/advanced/inventory${queryParams.toString() ? `?${queryParams.toString()}` : ''}`);
  }

  async getAdvancedCustomerReport(params?: { startDate?: string; endDate?: string; period?: string; branchId?: string; companyId?: string }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) queryParams.append(key, value.toString());
      });
    }
    return this.request<any>(`/reports/advanced/customers${queryParams.toString() ? `?${queryParams.toString()}` : ''}`);
  }

  async getAdvancedStaffReport(params?: { startDate?: string; endDate?: string; period?: string; branchId?: string; companyId?: string }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) queryParams.append(key, value.toString());
      });
    }
    return this.request<any>(`/reports/advanced/staff${queryParams.toString() ? `?${queryParams.toString()}` : ''}`);
  }

  async getAdvancedFinancialReport(params?: { startDate?: string; endDate?: string; period?: string; branchId?: string; companyId?: string }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) queryParams.append(key, value.toString());
      });
    }
    return this.request<any>(`/reports/advanced/financial${queryParams.toString() ? `?${queryParams.toString()}` : ''}`);
  }

  async getAdvancedPurchaseReport(params?: { startDate?: string; endDate?: string; period?: string; branchId?: string; companyId?: string; supplierId?: string }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) queryParams.append(key, value.toString());
      });
    }
    return this.request<any>(`/reports/advanced/purchases${queryParams.toString() ? `?${queryParams.toString()}` : ''}`);
  }

  async getAdvancedRefundsReport(params?: any) {
    return this.request<any>('/reports/advanced/refunds');
  }

  async getAdvancedExpiryReport(params?: any) {
    return this.request<any>('/reports/advanced/expiry');
  }

  async getAdvancedCategoryReport(params?: any) {
    return this.request<any>('/reports/advanced/category');
  }

  async getAdvancedBranchReport(params?: any) {
    return this.request<any>('/reports/advanced/branch');
  }

  async getAdvancedTaxReport(params?: any) {
    return this.request<any>('/reports/advanced/tax');
  }

  async getAdvancedPaymentTrendsReport(params?: any) {
    return this.request<any>('/reports/advanced/payment-trends');
  }

  async getAdvancedAttendanceReport(params?: any) {
    return this.request<any>('/reports/advanced/attendance');
  }

  async getAdvancedStockMovementsReport(params?: any) {
    return this.request<any>('/reports/advanced/stock-movements');
  }

  async getAdvancedExpenseReport(params?: any) {
    return this.request<any>('/reports/advanced/expense');
  }

  async getAdvancedShiftReport(params?: any) {
    return this.request<any>('/reports/advanced/shift');
  }

  async getAdvancedSupplierReport(params?: any) {
    return this.request<any>('/reports/advanced/supplier');
  }

  async getAdvancedRetentionReport(params?: any) {
    return this.request<any>('/reports/advanced/retention');
  }

  async getAdvancedCommissionReport(params?: any) {
    return this.request<any>('/reports/advanced/commission');
  }

  async getAdvancedProfitReport(params?: any) {
    return this.request<any>('/reports/advanced/profit');
  }

  async getAdvancedCashflowReport(params?: any) {
    return this.request<any>('/reports/advanced/cashflow');
  }

  async getAdvancedBatchReport(params?: any) {
    return this.request<any>('/reports/advanced/batch');
  }

  async getAdvancedDiscountReport(params?: any) {
    return this.request<any>('/reports/advanced/discount');
  }

  async getAdvancedProductReport(params?: any) {
    return this.request<any>('/reports/advanced/product');
  }

  async getAdvancedTurnoverReport(params?: any) {
    return this.request<any>('/reports/advanced/turnover');
  }

  async getAdvancedDailyReport(params?: any) {
    return this.request<any>('/reports/advanced/daily');
  }

  // Admin Management (Platform Admin only)
  async getAdmins(params?: {
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    return this.request<{
      admins: Array<{
        id: string;
        name: string;
        email: string;
        phone: string;
        company: string;
        address: string;
        userCount: number;
        managerCount: number;
        totalSales: number;
        lastActive: string;
        status: 'active' | 'inactive';
        plan: 'basic' | 'premium' | 'enterprise';
        createdAt: string;
        subscriptionEnd: string;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/admin${query ? `?${query}` : ''}`);
  }

  async getAdmin(adminId: string) {
    return this.request<{
      id: string;
      name: string;
      email: string;
      phone: string;
      company: string;
      address: string;
      userCount: number;
      managerCount: number;
      totalSales: number;
      lastActive: string;
      status: 'active' | 'inactive';
      plan: 'basic' | 'premium' | 'enterprise';
      createdAt: string;
      subscriptionEnd: string;
    }>(`/admin/${adminId}`);
  }

  async createAdmin(adminData: {
    name: string;
    email: string;
    phone: string;
    company: string;
    plan: 'basic' | 'premium' | 'enterprise';
    branchId: string | null;
    password: string;
  }) {
    return this.request<{
      id: string;
      name: string;
      email: string;
      phone: string;
      company: string;
      address: string;
      userCount: number;
      managerCount: number;
      totalSales: number;
      lastActive: string;
      status: 'active' | 'inactive';
      plan: 'basic' | 'premium' | 'enterprise';
      createdAt: string;
      subscriptionEnd: string;
    }>('/admin', {
      method: 'POST',
      body: JSON.stringify(adminData),
    });
  }

  // Company API methods
  async getCompanies() {
    return this.request<Array<{
      id: string;
      name: string;
      slug?: string | null;
      description: string | null;
      address: string | null;
      phone: string | null;
      email: string | null;
      website: string | null;
      createdBy: string | null;
      accessType?: 'owned' | 'shared';
      memberRole?: 'MANAGER' | 'CASHIER';
      memberBranchId?: string;
      createdByUser?: {
        id: string;
        name: string;
        email: string;
        role: string;
      } | null;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
      branches: Array<{
        id: string;
        name: string;
        address: string;
        phone: string;
        email: string;
      }>;
      _count: {
        users: number;
        staff: number;
        products: number;
      };
    }>>('/companies');
  }

  async getMyCompanies() {
    return this.request<{
      owned: Array<{
        id: string;
        name: string;
        slug?: string | null;
        description: string | null;
        address: string | null;
        phone: string | null;
        email: string | null;
        createdBy: string | null;
        accessType: 'owned';
      }>;
      shared: Array<{
        id: string;
        name: string;
        slug?: string | null;
        description: string | null;
        address: string | null;
        phone: string | null;
        email: string | null;
        createdBy: string | null;
        accessType: 'shared';
        memberRole?: 'MANAGER' | 'CASHIER';
        memberBranchId?: string;
      }>;
    }>('/companies/my/list');
  }

  async getMyInvitations() {
    return this.request<{
      invitations: Array<{
        invitationId: string;
        token: string;
        businessName: string;
        roleName: string | null;
        status: string;
        expiresAt: string;
      }>;
      count: number;
    }>('/invitations/pending');
  }

  async acceptInvitation(token: string) {
    return this.request<{
      membershipId: string;
      message: string;
    }>('/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  async rejectInvitation(token: string) {
    return this.request<{
      message: string;
    }>('/invitations/reject', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  }

  // ─── Notifications ──────────────────────────────────────────────────────────

  async getNotificationPreferences() {
    return this.request<Record<string, boolean>>('/notifications/preferences');
  }

  async updateNotificationPreference(category: string, enabled: boolean) {
    return this.request<{ category: string; enabled: boolean }>('/notifications/preferences', {
      method: 'PUT',
      body: JSON.stringify({ category, enabled }),
    });
  }

  async bulkUpdateNotificationPreferences(preferences: Record<string, boolean>) {
    return this.request<any>('/notifications/preferences/all', {
      method: 'PUT',
      body: JSON.stringify({ preferences }),
    });
  }

  async getNotifications(options?: { page?: number; limit?: number; unreadOnly?: boolean; businessId?: string }) {
    const params = new URLSearchParams();
    if (options?.page) params.set('page', String(options.page));
    if (options?.limit) params.set('limit', String(options.limit));
    if (options?.unreadOnly) params.set('unreadOnly', 'true');
    if (options?.businessId) params.set('businessId', options.businessId);
    const qs = params.toString();
    return this.request<{
      notifications: Array<{
        id: string;
        userId: string;
        businessId: string | null;
        type: string;
        title: string;
        body: string;
        actionUrl: string | null;
        metadata: any;
        read: boolean;
        createdAt: string;
      }>;
      total: number;
      unreadCount: number;
      page: number;
      limit: number;
      totalPages: number;
    }>(`/notifications${qs ? `?${qs}` : ''}`);
  }

  async getNotificationUnreadCount() {
    return this.request<{ unreadCount: number }>('/notifications/unread-count');
  }

  async markNotificationAsRead(id: string) {
    return this.request<any>(`/notifications/${id}/read`, { method: 'PUT' });
  }

  async markAllNotificationsAsRead() {
    return this.request<any>('/notifications/read-all', { method: 'PUT' });
  }

  async deleteNotification(id: string) {
    return this.request<any>(`/notifications/${id}`, { method: 'DELETE' });
  }

  // ─── Companies ─────────────────────────────────────────────────────────────

  async getCompany(companyId: string) {
    return this.request<{
      id: string;
      name: string;
      slug?: string | null;
      description: string | null;
      address: string | null;
      phone: string | null;
      email: string | null;
      website: string | null;
      createdBy: string | null;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
      branches: Array<{
        id: string;
        name: string;
        address: string;
        phone: string;
        email: string;
        _count: {
          users: number;
          staff: number;
          products: number;
        };
      }>;
      _count: {
        users: number;
        staff: number;
        products: number;
      };
      usageMetrics?: {
        branchesActive: number;
        countersActive: number;
        activeConcurrentSessions: number;
        inventoryItems: number;
        inventoryBreakdown: {
          products: number;
          categories: number;
          manufacturers: number;
          suppliers: number;
          shelves: number;
          batches: number;
        };
      };
    }>(`/companies/${companyId}`);
  }

  async getCompanyBySlug(slug: string) {
    const safe = encodeURIComponent(String(slug || '').trim());
    return this.request<{
      id: string;
      name: string;
      slug?: string | null;
      description: string | null;
      address: string | null;
      phone: string | null;
      email: string | null;
      website: string |null;
      createdBy: string | null;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
      branches: Array<{
        id: string;
        name: string;
        address: string;
        phone: string;
        email: string;
      }>;
      _count: {
        users: number;
        staff: number;
        products: number;
      };
    }>(`/companies/slug/${safe}`);
  }

  async getBusinesses() {
    return this.getCompanies();
  }

  async getBusinessBySlug(slug: string) {
    return this.getCompanyBySlug(slug);
  }

  async createCompany(companyData: {
    name: string;
    description?: string;
    address?: string;
    phone?: string;
    email?: string;
    businessType?: 'PHARMACY' | 'STORE' | 'HOTEL' | 'CLINIC';
    createdByUserId?: string;
  }) {
    return this.request<{
      id: string;
      name: string;
      description: string | null;
      address: string | null;
      phone: string | null;
      email: string | null;
      businessType: string | null;
      createdBy: string | null;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
      branches: Array<any>;
      _count: {
        users: number;
        staff: number;
        products: number;
      };
    }>('/companies', {
      method: 'POST',
      body: JSON.stringify(companyData),
    });
  }

  async createBusiness(businessData: {
    name: string;
    description?: string;
    address?: string;
    phone?: string;
    email?: string;
    businessType?: 'PHARMACY' | 'STORE' | 'HOTEL' | 'CLINIC';
    createdByUserId?: string;
  }) {
    return this.createCompany(businessData);
  }

  async updateCompany(companyId: string, companyData: {
    name?: string;
    description?: string;
    address?: string;
    phone?: string;
    email?: string;
    businessType?: 'PHARMACY' | 'STORE' | 'HOTEL' | 'CLINIC';
  }) {
    return this.request<{
      id: string;
      name: string;
      description: string | null;
      address: string | null;
      phone: string | null;
      email: string | null;
      createdBy: string | null;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
      branches: Array<any>;
      _count: {
        users: number;
        staff: number;
        products: number;
      };
    }>(`/companies/${companyId}`, {
      method: 'PUT',
      body: JSON.stringify(companyData),
    });
  }

  async updateBusiness(businessId: string, businessData: {
    name?: string;
    description?: string;
    address?: string;
    phone?: string;
    email?: string;
    businessType?: 'PHARMACY' | 'STORE' | 'HOTEL' | 'CLINIC';
  }) {
    return this.updateCompany(businessId, businessData);
  }

  async updateCompanyBusinessType(companyId: string, businessTypeData: {
    businessType: 'PHARMACY' | 'STORE' | 'HOTEL' | 'CLINIC';
  }) {
    return this.request<{
      id: string;
      name: string;
      description: string | null;
      address: string | null;
      phone: string | null;
      email: string | null;
      businessType: string | null;
      createdBy: string | null;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
      branches: Array<any>;
      _count: {
        users: number;
        staff: number;
        products: number;
      };
    }>(`/companies/${companyId}/business-type`, {
      method: 'PATCH',
      body: JSON.stringify(businessTypeData),
    });
  }

  async deleteCompany(companyId: string) {
    return this.request<{ message: string }>(`/companies/${companyId}`, {
      method: 'DELETE',
    });
  }

  async deleteBusiness(businessId: string) {
    return this.deleteCompany(businessId);
  }

  async getCompanyStats(companyId: string) {
    return this.request<{
      id: string;
      name: string;
      _count: {
        branches: number;
        users: number;
        staff: number;
        products: number;
        customers: number;
        sales: number;
      };
    }>(`/companies/${companyId}/stats`);
  }

  async updateAdmin(adminId: string, adminData: {
    name?: string;
    email?: string;
    phone?: string;
    company?: string;
    plan?: 'basic' | 'premium' | 'enterprise';
    isActive?: boolean;
  }) {
    return this.request<{
      id: string;
      name: string;
      email: string;
      phone: string;
      company: string;
      address: string;
      userCount: number;
      managerCount: number;
      totalSales: number;
      lastActive: string;
      status: 'active' | 'inactive';
      plan: 'basic' | 'premium' | 'enterprise';
      createdAt: string;
      subscriptionEnd: string;
    }>(`/admin/${adminId}`, {
      method: 'PUT',
      body: JSON.stringify(adminData),
    });
  }

  async deleteAdmin(adminId: string) {
    return this.request<{ message: string }>(`/admin/${adminId}`, {
      method: 'DELETE',
    });
  }

  async getAdminUsers(adminId: string) {
    return this.request<Array<{
      id: string;
      name: string;
      email: string;
      adminId: string;
      lastActive: string;
      status: 'active' | 'inactive';
      role: 'OWNER' | 'MANAGER' | 'CASHIER';
      createdAt: string;
    }>>(`/admin/${adminId}/users`);
  }

  async getSuperAdminStats() {
    return this.request<{
      totalAdmins: number;
      totalUsers: number;
      totalSales: number;
      totalSubscriptions: number;
      totalSubscriptionRevenue: number;
      activeSubscriptions: number;
      newSubscriptionsThisMonth: number;
      activeAdmins: number;
      activePharmacies: number;
      recentAdmins: Array<{
        id: string;
        name: string;
        company: string;
        userCount: number;
        totalSales: number;
      }>;
    }>('/admin/stats');
  }

  async getRecentActivities() {
    return this.request<Array<{
      id: string;
      type: 'admin_created' | 'subscription_updated' | 'payment_received' | 'user_registered' | 'system_alert' | 'branch_added';
      message: string;
      details: string;
      timestamp: string;
      adminId?: string;
      adminName?: string;
    }>>('/admin/activities');
  }

  // Plan Management
  async getPlans() {
    return this.request<any[]>('/admin/plans');
  }

  async createPlan(data: any) {
    return this.request<any>('/admin/plans', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async updatePlan(id: string, data: any) {
    return this.request<any>(`/admin/plans/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data)
    });
  }

  async deactivatePlan(id: string) {
    return this.request<any>(`/admin/plans/${id}`, {
      method: 'DELETE'
    });
  }

  // Subscription Management
  async getSubscriptions() {
    return this.request<any[]>('/admin/subscriptions');
  }

  async assignSubscription(data: { businessId: string; planId: string; manualEndDate?: string }) {
    return this.request<any>('/admin/subscriptions/assign', {
      method: 'POST',
      body: JSON.stringify(data)
    });
  }

  async cancelSubscription(id: string) {
    return this.request<any>(`/admin/subscriptions/cancel/${id}`, {
      method: 'POST'
    });
  }

  async getBillingSummary() {
    return this.request<{
      totalMRR: number;
      totalSubscriptions: number;
      trialCount: number;
      expiredCount: number;
      newBusinessesCount: number;
      growthPercentage: number;
    }>('/admin/billing-summary');
  }

  // Scheduled Shift Management Methods
  async getScheduledShifts() {
    return this.request<Array<{
      id: string;
      name: string;
      startTime: string;
      endTime: string;
      date: string;
      branchId: string;
      branchName: string;
      assignedUsers: Array<{
        id: string;
        name: string;
        role: string;
      }>;
      maxUsers: number;
      status: 'scheduled' | 'active' | 'completed' | 'cancelled';
      notes?: string;
      createdAt: string;
      updatedAt: string;
    }>>('/scheduled-shifts');
  }

  async createShift(shiftData: {
    name: string;
    startTime: string;
    endTime: string;
    date: string;
    branchId: string;
    maxUsers: number;
    notes?: string;
    assignedUserIds: string[];
  }) {
    return this.request<{
      id: string;
      name: string;
      startTime: string;
      endTime: string;
      date: string;
      branchId: string;
      branchName: string;
      assignedUsers: Array<{
        id: string;
        name: string;
        role: string;
      }>;
      maxUsers: number;
      status: 'scheduled' | 'active' | 'completed' | 'cancelled';
      notes?: string;
      createdAt: string;
      updatedAt: string;
    }>('/scheduled-shifts', {
      method: 'POST',
      body: JSON.stringify(shiftData),
    });
  }

  async updateScheduledShift(shiftId: string, shiftData: {
    name: string;
    startTime: string;
    endTime: string;
    date: string;
    branchId: string;
    maxUsers: number;
    notes?: string;
    assignedUserIds: string[];
  }) {
    return this.request<{
      id: string;
      name: string;
      startTime: string;
      endTime: string;
      date: string;
      branchId: string;
      branchName: string;
      assignedUsers: Array<{
        id: string;
        name: string;
        role: string;
      }>;
      maxUsers: number;
      status: 'scheduled' | 'active' | 'completed' | 'cancelled';
      notes?: string;
      createdAt: string;
      updatedAt: string;
    }>(`/scheduled-shifts/${shiftId}`, {
      method: 'PUT',
      body: JSON.stringify(shiftData),
    });
  }

  async deleteShift(shiftId: string) {
    return this.request<{ success: boolean; message: string }>(`/scheduled-shifts/${shiftId}`, {
      method: 'DELETE',
    });
  }

  async checkUserExists(params: { username?: string; email?: string }) {
    const queryParams = new URLSearchParams();
    if (params.username) queryParams.append('username', params.username);
    if (params.email) queryParams.append('email', params.email);
    
    return this.request<{
      exists: boolean;
      data?: {
        id: string;
        name: string;
        email: string;
        username: string;
      }
    }>(`/users/check-exists?${queryParams.toString()}`);
  }

  async getUsers(params?: { page?: number; limit?: number; role?: string; branchId?: string; search?: string }) {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.role) queryParams.append('role', params.role);
    if (params?.branchId) queryParams.append('branchId', params.branchId);
    if (params?.search) queryParams.append('search', params.search);

    const queryString = queryParams.toString();
    const url = queryString ? `/users?${queryString}` : '/users';

    return this.request<{
      users: Array<{
        id: string;
        username: string;
        name: string;
        email: string;
        role: string;
        branchId: string;
        branch: {
          id: string;
          name: string;
        };
        isActive: boolean;
        businessAccessGranted: boolean;
        createdAt: string;
        updatedAt: string;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(url);
  }

  async getUser(userId: string) {
    return this.request<{
      id: string;
      username: string;
      name: string;
      email: string;
      role: string;
      branchId: string;
      branch: {
        id: string;
        name: string;
      };
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    }>(`/users/${userId}`);
  }

  async createUser(userData: {
    username: string;
    email: string;
    password: string;
    name: string;
    role: 'OWNER' | 'MANAGER' | 'CASHIER';
    branchId: string | null;
    companyId?: string | null;
  }) {
    return this.request<{
      id: string;
      username: string;
      name: string;
      email: string;
      role: string;
      branchId: string;
      branch: {
        id: string;
        name: string;
      };
      isActive: boolean;
      businessAccessGranted: boolean;
      createdAt: string;
    }>('/users', {
      method: 'POST',
      body: JSON.stringify(userData),
    });
  }

  async updateUser(userId: string, userData: {
    username?: string;
    email?: string;
    password?: string;
    name?: string;
    role?: 'MANAGER' | 'CASHIER';
    branchId?: string;
    isActive?: boolean;
  }) {
    return this.request<{
      id: string;
      username: string;
      name: string;
      email: string;
      role: string;
      branchId: string;
      branch: {
        id: string;
        name: string;
      };
      isActive: boolean;
      businessAccessGranted: boolean;
      updatedAt: string;
    }>(`/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(userData),
    });
  }

  async deleteUser(userId: string) {
    return this.request<{ message: string }>(`/users/${userId}`, {
      method: 'DELETE',
    });
  }

  /** Remove a user from one business only (does not delete their platform account). */
  async removeCompanyMember(companyId: string, userId: string) {
    return this.request<{ message: string; success?: boolean }>(
      `/companies/${encodeURIComponent(companyId)}/members/${encodeURIComponent(userId)}`,
      { method: 'DELETE' }
    );
  }

  async addCompanyMember(
    companyId: string,
    body: { userId: string; role: 'MANAGER' | 'CASHIER'; branchId?: string }
  ) {
    return this.request<{ success: boolean; message?: string; data?: unknown }>(
      `/companies/${encodeURIComponent(companyId)}/members`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    );
  }

  async getCompanyMembers(
    companyId: string,
    params?: { page?: number; limit?: number; search?: string; role?: string }
  ) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && value !== '') {
          queryParams.append(key, value.toString());
        }
      });
    }

    return this.request<{ success: boolean; data: Array<any>; message?: string }>(
      `/companies/${encodeURIComponent(companyId)}/members${queryParams.toString() ? `?${queryParams.toString()}` : ''}`
    );
  }

  async activateUser(userId: string, isActive: boolean) {
    return this.request<{
      id: string;
      username: string;
      name: string;
      email: string;
      role: string;
      branchId: string;
      isActive: boolean;
      branch?: {
        id: string;
        name: string;
      };
    }>(`/users/${userId}/activate`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    });
  }

  async updateUserBusinessAccess(userId: string, hasBusinessAccess: boolean) {
    return this.request<{
      id: string;
      username: string;
      name: string;
      email: string;
      role: string;
      branchId: string;
      businessAccessGranted: boolean;
      branch?: {
        id: string;
        name: string;
      };
    }>(`/users/${userId}/business-access`, {
      method: 'PATCH',
      body: JSON.stringify({ businessAccessGranted: hasBusinessAccess }),
    });
  }

  // Categories
  async getCategories(params?: {
    page?: number;
    limit?: number;
    search?: string;
    branchId?: string;
    companyId?: string;
    type?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    return this.request<{
      categories: Array<{
        id: string;
        name: string;
        description?: string;
        createdAt: string;
        updatedAt: string;
        _count: {
          products: number;
        };
      }>;
      pagination?: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/categories${query ? `?${query}` : ''}`);
  }

  async getCategory(categoryId: string) {
    return this.request<{
      id: string;
      name: string;
      description: string;
      type: 'medical' | 'non-medical' | 'general';
      parentId?: string;
      isActive: boolean;
      productCount: number;
      color: string;
      icon: string;
      createdAt: string;
      updatedAt: string;
    }>(`/categories/${categoryId}`);
  }

  async createCategory(categoryData: {
    name: string;
    description?: string;
    type?: string;
    color?: string;
    branchId?: string;
  }) {
    return this.request<{
      id: string;
      name: string;
      description?: string;
      type?: string;
      color?: string;
      createdAt: string;
    }>('/categories', {
      method: 'POST',
      body: JSON.stringify(categoryData),
    });
  }

  async updateCategory(categoryId: string, categoryData: {
    name?: string;
    description?: string;
    type?: 'MEDICAL' | 'NON_MEDICAL' | 'GENERAL';
    parentId?: string;
    color?: string;
    icon?: string;
    isActive?: boolean;
  }) {
    return this.request<{
      id: string;
      name: string;
      description: string;
      type: 'MEDICAL' | 'NON_MEDICAL' | 'GENERAL';
      parentId?: string;
      isActive: boolean;
      productCount: number;
      color: string;
      icon: string;
      updatedAt: string;
    }>(`/categories/${categoryId}`, {
      method: 'PUT',
      body: JSON.stringify(categoryData),
    });
  }

  async deleteCategory(categoryId: string) {
    return this.request<{ success: boolean; message: string }>(`/categories/${categoryId}`, {
      method: 'DELETE',
    });
  }

  // Suppliers
  async getSuppliers(params?: {
    page?: number;
    limit?: number;
    search?: string;
    active?: boolean;
    branchId?: string;
    companyId?: string;
    manufacturerId?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== '') {
          queryParams.append(key, value.toString());
        }
      });
    }

    const query = queryParams.toString();
    return this.request<{
      suppliers: Array<{
        id: string;
        name: string;
        contactPerson: string;
        phone: string;
        email: string;
        address: string;
        isActive: boolean;
        createdAt: string;
        updatedAt: string;
        _count: {
          products: number;
        };
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/suppliers${query ? `?${query}` : ''}`);
  }

  async getSupplier(supplierId: string) {
    return this.request<{
      id: string;
      name: string;
      contactPerson: string;
      phone: string;
      email: string;
      address: string;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
      _count: {
        products: number;
      };
    }>(`/suppliers/${supplierId}`);
  }

  async createSupplier(supplierData: {
    name: string;
    contactPerson: string;
    phone: string;
    email?: string;
    address?: string;
    manufacturerId?: string;
    branchId?: string;
  }) {
    return this.request<{
      id: string;
      name: string;
      contactPerson: string;
      phone: string;
      email: string;
      address: string;
      isActive: boolean;
      createdAt: string;
    }>('/suppliers', {
      method: 'POST',
      body: JSON.stringify(supplierData),
    });
  }

  async updateSupplier(supplierId: string, supplierData: {
    name?: string;
    contactPerson?: string;
    phone?: string;
    email?: string;
    address?: string;
    manufacturerId?: string;
    isActive?: boolean;
  }) {
    return this.request<{
      id: string;
      name: string;
      contactPerson: string;
      phone: string;
      email: string;
      address: string;
      isActive: boolean;
      updatedAt: string;
    }>(`/suppliers/${supplierId}`, {
      method: 'PUT',
      body: JSON.stringify(supplierData),
    });
  }

  async deleteSupplier(supplierId: string) {
    return this.request<{ message: string }>(`/suppliers/${supplierId}`, {
      method: 'DELETE',
    });
  }

  // Manufacturer APIs
  async getManufacturers(params?: {
    page?: number;
    limit?: number;
    search?: string;
    active?: boolean;
  }) {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.search) queryParams.append('search', params.search);
    if (params?.active !== undefined) queryParams.append('active', params.active.toString());

    const queryString = queryParams.toString();
    const url = queryString ? `/manufacturers?${queryString}` : '/manufacturers';

    return this.request<{
      manufacturers: Array<{
        id: string;
        name: string;
        description?: string;
        website?: string;
        country?: string;
        isActive: boolean;
        createdAt: string;
        updatedAt: string;
        _count: {
          suppliers: number;
        };
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(url);
  }

  async getManufacturer(manufacturerId: string) {
    return this.request<{
      id: string;
      name: string;
      description?: string;
      website?: string;
      country?: string;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
      _count: {
        suppliers: number;
      };
      suppliers: Array<{
        id: string;
        name: string;
        contactPerson: string;
        phone: string;
        email: string;
        isActive: boolean;
      }>;
    }>(`/manufacturers/${manufacturerId}`);
  }

  async createManufacturer(manufacturerData: {
    name: string;
    description?: string;
    phone?: string;
    website?: string;
    country?: string;
  }) {
    return this.request<{
      id: string;
      name: string;
      description?: string;
      website?: string;
      country?: string;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    }>('/manufacturers', {
      method: 'POST',
      body: JSON.stringify(manufacturerData),
    });
  }

  async updateManufacturer(manufacturerId: string, manufacturerData: {
    name?: string;
    description?: string;
    phone?: string;
    website?: string;
    country?: string;
  }) {
    return this.request<{
      id: string;
      name: string;
      description?: string;
      website?: string;
      country?: string;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
    }>(`/manufacturers/${manufacturerId}`, {
      method: 'PUT',
      body: JSON.stringify(manufacturerData),
    });
  }

  async deleteManufacturer(manufacturerId: string) {
    return this.request<{ message: string }>(`/manufacturers/${manufacturerId}`, {
      method: 'DELETE',
    });
  }

  // Shelf APIs
  async getShelves(params?: {
    page?: number;
    limit?: number;
    search?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.search) queryParams.append('search', params.search);

    const queryString = queryParams.toString();
    const url = queryString ? `/shelves?${queryString}` : '/shelves';

    return this.request<{
      shelves: Array<{
        id: string;
        name: string;
        description?: string;
        location?: string;
        createdAt: string;
        updatedAt: string;
        _count: {
          batches: number;
        };
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(url);
  }

  async getShelf(shelfId: string) {
    return this.request<{
      id: string;
      name: string;
      description?: string;
      location?: string;
      createdAt: string;
      updatedAt: string;
      _count: {
        batches: number;
      };
      batches: Array<{
        id: string;
        batchNo: string;
        product: {
          id: string;
          name: string;
          sku: string;
        };
        quantity: number;
        expireDate?: string;
      }>;
    }>(`/shelves/${shelfId}`);
  }

  async createShelf(shelfData: {
    name: string;
    description?: string;
    location?: string;
  }) {
    return this.request<{
      id: string;
      name: string;
      description?: string;
      location?: string;
      createdAt: string;
      updatedAt: string;
    }>('/shelves', {
      method: 'POST',
      body: JSON.stringify(shelfData),
    });
  }

  async updateShelf(shelfId: string, shelfData: {
    name?: string;
    description?: string;
    location?: string;
  }) {
    return this.request<{
      id: string;
      name: string;
      description?: string;
      location?: string;
      createdAt: string;
      updatedAt: string;
    }>(`/shelves/${shelfId}`, {
      method: 'PUT',
      body: JSON.stringify(shelfData),
    });
  }

  async deleteShelf(shelfId: string) {
    return this.request<{ message: string }>(`/shelves/${shelfId}`, {
      method: 'DELETE',
    });
  }

  // Dashboard APIs
  async getDashboardStats(branchId?: string) {
    const params = new URLSearchParams();
    if (branchId) params.append('branchId', branchId);

    return this.request<{
      todayStats: {
        sales: number;
        revenue: number;
        subtotal: number;
        tax: number;
      };
      totalStats: {
        sales: number;
        revenue: number;
        subtotal: number;
        tax: number;
      };
      inventory: {
        totalProducts: number;
        lowStockProducts: number;
      };
      customers: {
        total: number;
      };
      recentSales: Array<{
        id: string;
        totalAmount: number;
        createdAt: string;
        customer: {
          id: string;
          name: string;
          phone: string;
        };
        user: {
          id: string;
          name: string;
          username: string;
        };
      }>;
    }>(`/dashboard/stats?${params.toString()}`);
  }

  async getSalesChart(branchId?: string, companyId?: string, period: string = '7d', groupBy: string = 'day') {
    const params = new URLSearchParams();
    if (branchId) params.append('branchId', branchId);
    if (companyId) params.append('companyId', companyId);
    params.append('period', period);
    params.append('groupBy', groupBy);

    return this.request<{
      period: string;
      groupBy: string;
      chartData: Array<{
        date?: string;
        week?: string;
        month?: string;
        revenue: number;
        sales: number;
      }>;
    }>(`/dashboard/chart?${params.toString()}`);
  }

  async getLowStockProducts(branchId?: string) {
    const params = new URLSearchParams();
    if (branchId) params.append('branchId', branchId);

    return this.request<{
      products: Array<{
        id: string;
        name: string;
        stock: number;
        minStock: number;
        unitType: string;
        expiryDate?: string;
      }>;
    }>(`/products/low-stock?${params.toString()}`);
  }

  // Admin Dashboard APIs
  async getAdminDashboardStats() {
    return this.request<{
      totalRevenue: number;
      totalSales: number;
      totalUsers: number;
      totalBranches: number;
      recentSales: Array<{
        id: string;
        totalAmount: number;
        createdAt: string;
        customer: {
          id: string;
          name: string;
          phone: string;
        };
        user: {
          id: string;
          name: string;
          username: string;
        };
        branch: {
          id: string;
          name: string;
        };
      }>;
      lowStockProducts: Array<{
        id: string;
        name: string;
        stock: number;
        minStock: number;
        unitType: string;
        expiryDate?: string;
        branch: {
          name: string;
        };
      }>;
      branchPerformance: Array<{
        id: string;
        name: string;
        users: number;
        sales: number;
        revenue: number;
      }>;
      recentUsers: Array<{
        id: string;
        name: string;
        username: string;
        branch: string;
        lastPurchase: string;
        lastPurchaseAmount: number;
      }>;
    }>('/dashboard/admin-stats');
  }

  async getTopSellingProducts(branchId?: string, limit: number = 10) {
    const params = new URLSearchParams();
    if (branchId && branchId !== '') params.append('branchId', branchId);
    params.append('limit', limit.toString());

    return this.request<Array<{
      productId: string;
      product: {
        id: string;
        name: string;
        unitType: string;
        category: {
          name: string;
        };
      };
      totalQuantity: number;
      totalRevenue: number;
      totalSales: number;
    }>>(`/reports/top-products?${params.toString()}`);
  }

  async getSalesByPaymentMethod(branchId?: string, companyId?: string) {
    const params = new URLSearchParams();
    if (branchId && branchId !== '') params.append('branchId', branchId);
    if (companyId && companyId !== '') params.append('companyId', companyId);

    return this.request<Array<{
      paymentMethod: string;
      _sum: {
        totalAmount: number;
      };
      _count: {
        id: number;
      };
    }>>(`/reports/payment-methods?${params.toString()}`);
  }

  async getEnabledModules(companyId?: string) {
    return this.request<Array<{ name: string; enabled: boolean; sortOrder?: number }>>('/modules/enabled', {
      companyId,
    } as RequestInit & { companyId?: string });
  }

  async getModuleHierarchy(companyId?: string) {
    return this.request<{
      hierarchy: Array<{
        module: string;
        label: string;
        displayName?: string;
        icon: string;
        section: 'main' | 'management' | 'admin';
        subModules: Array<{
          key: string;
          label: string;
          href: string;
          icon: string;
          module: string;
          roles: string[];
        }>;
        defaultRoles: string[];
      }>;
      userRole: string;
      businessId: string;
      lastUpdated: string;
    }>('/modules/hierarchy', {
      companyId,
    } as RequestInit & { companyId?: string });
  }

  async getBusinessTypeModules(businessTypeId: string) {
    return this.request<Array<{ name: string; enabled: boolean; sortOrder?: number }>>(`/business-types/${businessTypeId}/modules`);
  }

  async getDashboardData(branchId?: string, companyId?: string) {
    const params = new URLSearchParams();
    if (branchId && branchId !== '') params.append('branchId', branchId);
    if (companyId && companyId !== '') params.append('companyId', companyId);

    const queryString = params.toString();
    const endpoint = queryString ? `/reports/dashboard?${queryString}` : '/reports/dashboard';

    return this.request<{
      today: {
        revenue: number;
        profit: number;
        transactions: number;
        growth: number;
      };
      month: {
        revenue: number;
        profit: number;
        transactions: number;
        growth: number;
      };
      recentSales: Array<{
        id: string;
        totalAmount: number;
        createdAt: string;
        customer: {
          name: string;
          phone: string;
        } | null;
        items: Array<{
          product: {
            name: string;
          };
          quantity: number;
          totalPrice: number;
        }>;
      }>;
    }>(endpoint);
  }

  // Staff Management
  async searchUser(query: string) {
    return this.request<{
      found: boolean;
      user?: {
        id: string;
        name: string;
        email: string;
        phone?: string;
        profileImage?: string;
        isVerified?: boolean;
        createdAt?: string;
      };
    }>('/staff/search-user', {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
  }

  async getStaff(params?: { page?: number; limit?: number; search?: string; status?: string; branchId?: string; companyId?: string; isActive?: boolean }) {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.search) queryParams.append('search', params.search);
    if (params?.status) queryParams.append('status', params.status);
    if (params?.branchId) queryParams.append('branchId', params.branchId);
    if (params?.companyId) queryParams.append('companyId', params.companyId);
    if (params?.isActive !== undefined) queryParams.append('isActive', params.isActive.toString());

    return this.request<{
      staff: Array<{
        id: string;
        employeeId: string;
        designation: string;
        department?: string;
        salary?: number;
        joiningDate: string;
        status: string;
        isActive: boolean;
        createdAt: string;
        updatedAt: string;
        membership: {
          id: string;
          role: { id: string; name: string } | null;
          user: {
            id: string;
            name: string;
            email: string;
            phone?: string;
            profileImage?: string;
          };
          branches: Array<{ id: string; name: string }>;
        };
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/staff?${queryParams.toString()}`);
  }

  async getStaffMember(id: string) {
    return this.request<{
      id: string;
      employeeId: string;
      designation: string;
      department?: string;
      salary?: number;
      joiningDate: string;
      status: string;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
      membership: {
        id: string;
        role: { id: string; name: string } | null;
        user: {
          id: string;
          name: string;
          email: string;
          phone?: string;
          profileImage?: string;
        };
        branches: Array<{ id: string; name: string }>;
      };
    }>(`/staff/${id}`);
  }

  async createStaff(staffData: {
    userId?: string;
    role: string;
    branchId: string;
    employeeId?: string;
    designation: string;
    department?: string;
    salary?: number;
    salaryType?: string;
    employmentType?: string;
    joiningDate?: string;
    status?: string;
    bankName?: string;
    bankAccountNumber?: string;
    cnicNumber?: string;
    emergencyContactName?: string;
    emergencyContactPhone?: string;
    isNewUser?: boolean;
    newUserData?: {
      name: string;
      email: string;
      phone?: string;
      password?: string;
    };
  }) {
    return this.request<{
      id: string;
      employeeId: string;
      designation: string;
      department?: string;
      salary?: number;
      joiningDate: string;
      status: string;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
      membership: {
        id: string;
        role: { id: string; name: string } | null;
        user: {
          id: string;
          name: string;
          email: string;
          phone?: string;
          profileImage?: string;
        };
        branches: Array<{ id: string; name: string }>;
      };
    }>('/staff', {
      method: 'POST',
      body: JSON.stringify(staffData)
    });
  }

  async updateStaff(id: string, staffData: {
    designation?: string;
    department?: string;
    salary?: number;
    joiningDate?: string;
    status?: string;
    isActive?: boolean;
  }) {
    return this.request<{
      id: string;
      employeeId: string;
      designation: string;
      department?: string;
      salary?: number;
      joiningDate: string;
      status: string;
      isActive: boolean;
      createdAt: string;
      updatedAt: string;
      membership: {
        id: string;
        role: { id: string; name: string } | null;
        user: {
          id: string;
          name: string;
          email: string;
          phone?: string;
          profileImage?: string;
        };
        branches: Array<{ id: string; name: string }>;
      };
    }>(`/staff/${id}`, {
      method: 'PUT',
      body: JSON.stringify(staffData)
    });
  }

  async deleteStaff(id: string) {
    return this.request<{ message: string }>(`/staff/${id}`, {
      method: 'DELETE'
    });
  }

  async getStaffStats(branchId?: string, companyId?: string) {
    const params = new URLSearchParams();
    if (branchId) params.append('branchId', branchId);
    if (companyId) params.append('companyId', companyId);

    return this.request<{
      totalStaff: number;
      activeStaff: number;
      inactiveStaff: number;
      terminatedStaff: number;
      onLeaveStaff: number;
    }>(`/staff/stats?${params.toString()}`);
  }

  // Attendance Management
  async checkIn(attendanceData: {
    staffProfileId: string;
    branchId: string;
    notes?: string;
  }) {
    return this.request<{
      id: string;
      staffProfileId: string;
      branchId: string;
      checkIn: string;
      checkOut?: string;
      totalHours?: number;
      status: string;
      notes?: string;
      staffProfile: {
        id: string;
        employeeId: string;
        designation: string;
        membership: {
          user: {
            id: string;
            name: string;
          };
        };
      };
      branch: {
        id: string;
        name: string;
      };
      createdAt: string;
    }>('/attendance/check-in', {
      method: 'POST',
      body: JSON.stringify(attendanceData)
    });
  }

  async checkOut(attendanceData: {
    attendanceId: string;
    notes?: string;
  }) {
    return this.request<{
      id: string;
      staffProfileId: string;
      branchId: string;
      checkIn: string;
      checkOut: string;
      totalHours: number;
      status: string;
      notes?: string;
      staffProfile: {
        id: string;
        employeeId: string;
        designation: string;
        membership: {
          user: {
            id: string;
            name: string;
          };
        };
      };
      branch: {
        id: string;
        name: string;
      };
      createdAt: string;
    }>('/attendance/check-out', {
      method: 'POST',
      body: JSON.stringify(attendanceData)
    });
  }

  async getAttendance(params?: {
    page?: number;
    limit?: number;
    staffProfileId?: string;
    branchId?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    return this.request<{
      attendance: Array<{
        id: string;
        staffProfileId: string;
        branchId: string;
        checkIn: string;
        checkOut?: string;
        totalHours?: number;
        status: string;
        notes?: string;
        staffProfile: {
          id: string;
          employeeId: string;
          designation: string;
          membership: {
            user: {
              id: string;
              name: string;
            };
          };
        };
        branch: {
          id: string;
          name: string;
        };
        createdAt: string;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/attendance?${queryParams.toString()}`);
  }

  async getTodayAttendance(staffProfileId: string) {
    return this.request<{
      id: string;
      staffProfileId: string;
      branchId: string;
      checkIn: string;
      checkOut?: string;
      totalHours?: number;
      status: string;
      notes?: string;
      staffProfile: {
        id: string;
        employeeId: string;
        designation: string;
        membership: {
          user: {
            id: string;
            name: string;
          };
        };
      };
      branch: {
        id: string;
        name: string;
      };
      createdAt: string;
    }>(`/attendance/today/${staffProfileId}`);
  }

  async getAttendanceStats(params?: {
    branchId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    return this.request<{
      totalRecords: number;
      presentCount: number;
      absentCount: number;
      lateCount: number;
      halfDayCount: number;
      leaveCount: number;
    }>(`/attendance/stats?${queryParams.toString()}`);
  }

  // Shift Management
  async startShift(shiftData: {
    staffProfileId: string;
    branchId: string;
    shiftDate: string;
    startTime: string;
    openingBalance?: number;
    notes?: string;
  }) {
    return this.request<{
      id: string;
      staffProfileId: string;
      branchId: string;
      shiftDate: string;
      startTime: string;
      endTime?: string;
      openingBalance: number;
      cashIn: number;
      cashOut: number;
      expectedBalance?: number;
      actualBalance?: number;
      difference?: number;
      status: string;
      notes?: string;
      staffProfile: {
        id: string;
        employeeId: string;
        designation: string;
        membership: {
          user: {
            id: string;
            name: string;
          };
        };
      };
      branch: {
        id: string;
        name: string;
      };
      createdAt: string;
    }>('/shifts/start', {
      method: 'POST',
      body: JSON.stringify(shiftData)
    });
  }

  async endShift(shiftData: {
    shiftId: string;
    endTime: string;
    actualBalance: number;
    notes?: string;
  }) {
    return this.request<{
      id: string;
      staffProfileId: string;
      branchId: string;
      shiftDate: string;
      startTime: string;
      endTime: string;
      openingBalance: number;
      cashIn: number;
      cashOut: number;
      expectedBalance: number;
      actualBalance: number;
      difference: number;
      status: string;
      notes?: string;
      staffProfile: {
        id: string;
        employeeId: string;
        designation: string;
        membership: {
          user: {
            id: string;
            name: string;
          };
        };
      };
      branch: {
        id: string;
        name: string;
      };
      createdAt: string;
    }>('/shifts/end', {
      method: 'POST',
      body: JSON.stringify(shiftData)
    });
  }

  async getShifts(params?: {
    page?: number;
    limit?: number;
    staffProfileId?: string;
    branchId?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    return this.request<{
      shifts: Array<{
        id: string;
        staffProfileId: string;
        branchId: string;
        shiftDate: string;
        startTime: string;
        endTime?: string;
        openingBalance: number;
        cashIn: number;
        cashOut: number;
        expectedBalance?: number;
        actualBalance?: number;
        difference?: number;
        status: string;
        notes?: string;
        staffProfile: {
          id: string;
          employeeId: string;
          designation: string;
          membership: {
            user: {
              id: string;
              name: string;
            };
          };
        };
        branch: {
          id: string;
          name: string;
        };
        createdAt: string;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/shifts?${queryParams.toString()}`);
  }

  async getActiveShift(staffProfileId: string) {
    return this.request<{
      id: string;
      staffProfileId: string;
      branchId: string;
      shiftDate: string;
      startTime: string;
      endTime?: string;
      openingBalance: number;
      cashIn: number;
      cashOut: number;
      expectedBalance?: number;
      actualBalance?: number;
      difference?: number;
      status: string;
      notes?: string;
      staffProfile: {
        id: string;
        employeeId: string;
        designation: string;
        membership: {
          user: {
            id: string;
            name: string;
          };
        };
      };
      branch: {
        id: string;
        name: string;
      };
      createdAt: string;
    }>(`/shifts/active/${staffProfileId}`);
  }

  async updateCashierShift(shiftId: string, shiftData: {
    cashIn?: number;
    cashOut?: number;
    notes?: string;
  }) {
    return this.request<{
      id: string;
      staffProfileId: string;
      branchId: string;
      shiftDate: string;
      startTime: string;
      endTime?: string;
      openingBalance: number;
      cashIn: number;
      cashOut: number;
      expectedBalance?: number;
      actualBalance?: number;
      difference?: number;
      status: string;
      notes?: string;
      staffProfile: {
        id: string;
        employeeId: string;
        designation: string;
        membership: {
          user: {
            id: string;
            name: string;
          };
        };
      };
      branch: {
        id: string;
        name: string;
      };
      createdAt: string;
    }>(`/shifts/${shiftId}`, {
      method: 'PUT',
      body: JSON.stringify(shiftData)
    });
  }

  async getShiftStats(params?: {
    branchId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    return this.request<{
      totalShifts: number;
      activeShifts: number;
      completedShifts: number;
      cancelledShifts: number;
      totalCashIn: number;
      totalCashOut: number;
      totalDifference: number;
    }>(`/shifts/stats?${queryParams.toString()}`);
  }

  // Commission Management
  async calculateCommission(commissionData: {
    staffProfileId: string;
    branchId: string;
    period: string;
    periodType?: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
    baseRate?: number;
    bonusRate?: number;
    notes?: string;
  }) {
    return this.request<{
      id: string;
      staffProfileId: string;
      branchId: string;
      period: string;
      periodType: string;
      totalSales: number;
      totalTransactions: number;
      averageSale: number;
      baseRate: number;
      bonusRate: number;
      totalCommission: number;
      bonusAmount: number;
      totalAmount: number;
      status: string;
      paidAt?: string;
      notes?: string;
      staffProfile: {
        id: string;
        employeeId: string;
        designation: string;
        membership: {
          user: {
            id: string;
            name: string;
          };
        };
      };
      branch: {
        id: string;
        name: string;
      };
      createdAt: string;
    }>('/commissions/calculate', {
      method: 'POST',
      body: JSON.stringify(commissionData)
    });
  }

  async getCommissions(params?: {
    page?: number;
    limit?: number;
    staffProfileId?: string;
    branchId?: string;
    status?: string;
    periodType?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    return this.request<{
      commissions: Array<{
        id: string;
        staffProfileId: string;
        branchId: string;
        period: string;
        periodType: string;
        totalSales: number;
        totalTransactions: number;
        averageSale: number;
        baseRate: number;
        bonusRate: number;
        totalCommission: number;
        bonusAmount: number;
        totalAmount: number;
        status: string;
        paidAt?: string;
        notes?: string;
        staffProfile: {
          id: string;
          employeeId: string;
          designation: string;
          membership: {
            user: {
              id: string;
              name: string;
            };
          };
        };
        branch: {
          id: string;
          name: string;
        };
        createdAt: string;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/commissions?${queryParams.toString()}`);
  }

  async getCommission(commissionId: string) {
    return this.request<{
      id: string;
      staffProfileId: string;
      branchId: string;
      period: string;
      periodType: string;
      totalSales: number;
      totalTransactions: number;
      averageSale: number;
      baseRate: number;
      bonusRate: number;
      totalCommission: number;
      bonusAmount: number;
      totalAmount: number;
      status: string;
      paidAt?: string;
      notes?: string;
      staffProfile: {
        id: string;
        employeeId: string;
        designation: string;
        membership: {
          user: {
            id: string;
            name: string;
          };
        };
      };
      branch: {
        id: string;
        name: string;
      };
      createdAt: string;
    }>(`/commissions/${commissionId}`);
  }

  async updateCommission(commissionId: string, commissionData: {
    status?: 'PENDING' | 'APPROVED' | 'PAID' | 'CANCELLED';
    notes?: string;
  }) {
    return this.request<{
      id: string;
      staffProfileId: string;
      branchId: string;
      period: string;
      periodType: string;
      totalSales: number;
      totalTransactions: number;
      averageSale: number;
      baseRate: number;
      bonusRate: number;
      totalCommission: number;
      bonusAmount: number;
      totalAmount: number;
      status: string;
      paidAt?: string;
      notes?: string;
      staffProfile: {
        id: string;
        employeeId: string;
        designation: string;
        membership: {
          user: {
            id: string;
            name: string;
          };
        };
      };
      branch: {
        id: string;
        name: string;
      };
      createdAt: string;
    }>(`/commissions/${commissionId}`, {
      method: 'PUT',
      body: JSON.stringify(commissionData)
    });
  }

  async getCommissionStats(params?: {
    branchId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    return this.request<{
      totalCommissions: number;
      pendingCommissions: number;
      approvedCommissions: number;
      paidCommissions: number;
      cancelledCommissions: number;
      totalAmount: number;
      totalPaidAmount: number;
    }>(`/commissions/stats?${queryParams.toString()}`);
  }

  async getStaffPerformance(staffProfileId: string, params?: {
    startDate?: string;
    endDate?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined) {
          queryParams.append(key, value.toString());
        }
      });
    }

    return this.request<{
      sales: {
        totalSales: number;
        totalTransactions: number;
        averageSale: number;
      };
      commissions: {
        totalCommissions: number;
        totalAmount: number;
        totalCommission: number;
        totalBonus: number;
      };
      recentCommissions: Array<{
        id: string;
        period: string;
        periodType: string;
        totalAmount: number;
        status: string;
        createdAt: string;
        branch: {
          id: string;
          name: string;
        };
      }>;
    }>(`/commissions/performance/${staffProfileId}?${queryParams.toString()}`);
  }

  // Branch Management

  async getBranch(id: string) {
    return this.request<{
      id: string;
      name: string;
      address: string;
      phone: string;
      email: string;
      managerId?: string;
      isActive: boolean;
      createdAt: string;
      _count: {
        users: number;
        products: number;
        customers: number;
      };
    }>(`/branches/${id}`);
  }

  async createBranch(branchData: {
    name: string;
    address: string;
    phone: string;
    email: string;
    companyId: string;
    managerId?: string;
  }) {
    return this.request<{
      id: string;
      name: string;
      address: string;
      phone: string;
      email: string;
      companyId: string;
      managerId?: string;
      isActive: boolean;
      createdAt: string;
    }>('/branches', {
      method: 'POST',
      body: JSON.stringify(branchData),
    });
  }

  async updateBranch(id: string, branchData: {
    name?: string;
    address?: string;
    phone?: string;
    email?: string;
    managerId?: string;
    isActive?: boolean;
  }) {
    return this.request<{
      id: string;
      name: string;
      address: string;
      phone: string;
      email: string;
      managerId?: string;
      isActive: boolean;
      createdAt: string;
    }>(`/branches/${id}`, {
      method: 'PUT',
      body: JSON.stringify(branchData),
    });
  }

  async deleteBranch(id: string) {
    return this.request<{
      success: boolean;
      message: string;
    }>(`/branches/${id}`, {
      method: 'DELETE',
    });
  }

  // Subscription Management
  async getSubscription() {
    return this.request<{
      remainingDays: number;
      businessId: string;
      planId: string;
      planName: string;
      status: string;
      trialEndsAt: string | null;
      currentPeriodEnd: string | null;
      isSubscribed: boolean;
    }>('/subscription');
  }

  async updateSubscription(subscriptionData: {
    plan: string;
    status?: string;
  }) {
    return this.request<{
      businessId: string;
      planId: string;
      status: string;
    }>('/subscription', {
      method: 'PUT',
      body: JSON.stringify(subscriptionData),
    });
  }

  async getPaymentMethods() {
    return this.request<Array<{
      id: string;
      type: 'card' | 'bank' | 'mobile';
      last4: string;
      brand: string;
      expiryMonth: number;
      expiryYear: number;
      isDefault: boolean;
      holderName: string;
    }>>('/subscription/payment-methods');
  }

  async addPaymentMethod(paymentMethodData: {
    type: 'card' | 'bank' | 'mobile';
    last4: string;
    brand: string;
    expiryMonth: number;
    expiryYear: number;
    holderName: string;
    isDefault?: boolean;
  }) {
    return this.request<{
      id: string;
      type: string;
      last4: string;
      brand: string;
      expiryMonth: number;
      expiryYear: number;
      isDefault: boolean;
      holderName: string;
      createdAt: string;
    }>('/subscription/payment-methods', {
      method: 'POST',
      body: JSON.stringify(paymentMethodData),
    });
  }

  async setDefaultPaymentMethod(methodId: string) {
    return this.request<{ message: string }>(`/subscription/payment-methods/${methodId}/default`, {
      method: 'PUT',
    });
  }

  async deletePaymentMethod(methodId: string) {
    return this.request<{ message: string }>(`/subscription/payment-methods/${methodId}`, {
      method: 'DELETE',
    });
  }

  async getBillingHistory() {
    return this.request<Array<{
      id: string;
      amount: number;
      status: 'success' | 'failed' | 'pending';
      method: string;
      date: string;
      invoiceNumber: string;
      description: string;
    }>>('/subscription/billing-history');
  }

  async downloadInvoice(invoiceId: string) {
    return this.request<{
      invoiceId: string;
      downloadUrl: string;
    }>(`/subscription/invoices/${invoiceId}/download`);
  }

  async getPricingPlans() {
    return this.request<Array<{
      id: string;
      segment: 'single' | 'multi';
      name: string;
      subtitle?: string;
      price: number;
      priceUnit: string;
      badge?: string;
      ctaLabel: string;
      features: string[];
      dashboardAccessRoles?: Array<'OWNER' | 'MANAGER' | 'CASHIER'>;
      businessTypes?: Array<'PHARMACY' | 'STORE' | 'HOTEL' | 'CLINIC'>;
      limits?: {
        maxBranches?: number | null;
        maxCountersPerBranch?: number | null;
        maxConcurrentUsers?: number | null;
        maxConcurrentSessions?: number | null;
      };
      pricingModel?: {
        includedBranchesPerBusiness?: number | null;
        includedCountersPerBranch?: number | null;
        extraBranchPrice?: number | null;
        extraCounterPrice?: number | null;
      };
    }>>('/subscription/pricing-plans');
  }

  async updatePricingPlans(plans: Array<{
    id: string;
    segment: 'single' | 'multi';
    name: string;
    subtitle?: string;
    price: number;
    priceUnit: string;
    badge?: string;
    ctaLabel: string;
    features: string[];
    dashboardAccessRoles?: Array<'OWNER' | 'MANAGER' | 'CASHIER'>;
    businessTypes?: Array<'PHARMACY' | 'STORE' | 'HOTEL' | 'CLINIC'>;
    limits?: {
      maxBranches?: number | null;
      maxCountersPerBranch?: number | null;
      maxConcurrentUsers?: number | null;
      maxConcurrentSessions?: number | null;
    };
    pricingModel?: {
      includedBranchesPerBusiness?: number | null;
      includedCountersPerBranch?: number | null;
      extraBranchPrice?: number | null;
      extraCounterPrice?: number | null;
    };
  }>) {
    return this.request<Array<{
      id: string;
      segment: 'single' | 'multi';
      name: string;
      subtitle?: string;
      price: number;
      priceUnit: string;
      badge?: string;
      ctaLabel: string;
      features: string[];
      dashboardAccessRoles?: Array<'OWNER' | 'MANAGER' | 'CASHIER'>;
      businessTypes?: Array<'PHARMACY' | 'STORE' | 'HOTEL' | 'CLINIC'>;
      limits?: {
        maxBranches?: number | null;
        maxCountersPerBranch?: number | null;
        maxConcurrentUsers?: number | null;
        maxConcurrentSessions?: number | null;
      };
      pricingModel?: {
        includedBranchesPerBusiness?: number | null;
        includedCountersPerBranch?: number | null;
        extraBranchPrice?: number | null;
        extraCounterPrice?: number | null;
      };
    }>>('/subscription/pricing-plans', {
      method: 'PUT',
      body: JSON.stringify({ plans }),
    });
  }

  async getAnnualDiscount() {
    return this.request<{ percent: number }>('/subscription/annual-discount');
  }

  async updateAnnualDiscount(percent: number) {
    return this.request<{ percent: number }>('/subscription/annual-discount', {
      method: 'PUT',
      body: JSON.stringify({ percent }),
    });
  }

  async getBusinessEntitlements(companyId: string) {
    const response = await this.request<{
      companyId: string;
      businessType: 'PHARMACY' | 'STORE' | 'HOTEL' | 'CLINIC';
      planId: string;
      isSubscribed: boolean;
      subscriptionStatus: string | null;
      trialEndsAt: string | null;
      currentPeriodEnd: string | null;
      addOns?: Record<string, number>;
      includedLimits?: {
        maxBranches: number | null;
        maxCountersPerBranch: number | null;
        maxConcurrentUsers: number | null;
      };
      effectiveLimits?: {
        maxBranches: number | null;
        maxCountersPerBranch: number | null;
        maxConcurrentUsers: number | null;
      };
      effectiveBusinessTypes?: Array<'PHARMACY' | 'STORE' | 'HOTEL' | 'CLINIC'>;
      plan: {
        id: string;
        segment: 'single' | 'multi';
        name: string;
        dashboardAccessRoles?: Array<'OWNER' | 'MANAGER' | 'CASHIER'>;
        businessTypes: Array<'PHARMACY' | 'STORE' | 'HOTEL' | 'CLINIC'>;
        limits: {
          maxBranches: number | null;
          maxCountersPerBranch: number | null;
          maxConcurrentUsers: number | null;
        };
      };
      limits: {
        maxBranches: number | null;
        maxCountersPerBranch: number | null;
        maxConcurrentUsers: number | null;
      };
      usage?: {
        activeBranches: number;
        activeUsers: number;
        totalUsers: number;
      };
      remaining?: {
        branches: number | null;
        users: number | null;
      };
    } | null>(`/subscription/entitlements/business/${companyId}`);
    
    return response;
  }

  async updateBusinessEntitlements(companyId: string, payload: { planId: string; addOns?: Record<string, number> }) {
    return this.request<{
      companyId: string;
      businessType: 'PHARMACY' | 'STORE' | 'HOTEL' | 'CLINIC';
      planId: string;
      addOns?: Record<string, number>;
      includedLimits?: {
        maxBranches: number | null;
        maxCountersPerBranch: number | null;
        maxConcurrentUsers: number | null;
      };
      effectiveLimits?: {
        maxBranches: number | null;
        maxCountersPerBranch: number | null;
        maxConcurrentUsers: number | null;
      };
      plan: {
        id: string;
        segment: 'single' | 'multi';
        name: string;
        businessTypes: Array<'PHARMACY' | 'STORE' | 'HOTEL' | 'CLINIC'>;
      };
      limits: {
        maxBranches: number | null;
        maxCountersPerBranch: number | null;
        maxConcurrentUsers: number | null;
      };
      usage?: {
        activeBranches: number;
        activeUsers: number;
      };
      remaining?: {
        branches: number | null;
        users: number | null;
      };
    }>(`/subscription/entitlements/business/${companyId}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  // Logout
  async logout() {
    try {
      await fetch(`${this.baseURL}/auth/logout`, {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // ignore - cookie may already be gone
    }
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }

  // Refunds
  async createRefund(refundData: {
    originalSaleId: string;
    refundReason: string;
    items: Array<{
      productId: string;
      quantity: number;
      unitPrice: number;
      reason: string;
      batchId?: string | null;
      saleItemId?: string | null;
    }>;
    refundedBy: string;
  }) {
    return this.request<{
      refund: {
        id: string;
        originalSaleId: string;
        refundReason: string;
        refundAmount: string | number;
        refundedBy: string;
        status: string;
        processedAt?: string;
        createdAt: string;
        updatedAt: string;
      };
      items: Array<{
        id: string;
        refundId: string;
        productId: string;
        quantity: number;
        unitPrice: number;
        reason: string;
      }>;
    }>('/refunds', {
      method: 'POST',
      body: JSON.stringify(refundData),
    });
  }

  async getRefunds(params?: {
    page?: number;
    limit?: number;
    search?: string;
    startDate?: string;
    endDate?: string;
    branchId?: string;
    companyId?: string;
  }) {
    const queryParams = new URLSearchParams();
    if (params?.page) queryParams.append('page', params.page.toString());
    if (params?.limit) queryParams.append('limit', params.limit.toString());
    if (params?.search) queryParams.append('search', params.search);
    if (params?.startDate) queryParams.append('startDate', params.startDate);
    if (params?.endDate) queryParams.append('endDate', params.endDate);
    if (params?.branchId) queryParams.append('branchId', params.branchId);
    if (params?.companyId) queryParams.append('companyId', params.companyId);

    return this.request<{
      refunds: Array<{
        id: string;
        originalSaleId: string;
        refundReason: string;
        refundAmount: string | number;
        refundedBy: string;
        status: string;
        processedAt?: string;
        createdAt: string;
        updatedAt: string;
        originalSale: {
          id: string;
          receiptNumber?: string;
          totalAmount: number;
          customer?: {
            id: string;
            name: string;
            phone: string;
            email?: string;
            address?: string;
          };
          user: {
            id: string;
            name: string;
            username: string;
          };
          receipts?: Array<{
            id: string;
            receiptNumber: string;
            createdAt: string;
          }>;
        };
        items: Array<{
          id: string;
          productId: string;
          quantity: number;
          unitPrice: number;
          reason: string;
          product: {
            id: string;
            name: string;
            description?: string;
          };
        }>;
        refundedByUser: {
          id: string;
          name: string;
          username: string;
        };
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/refunds?${queryParams.toString()}`);
  }

  async getRefundById(id: string) {
    return this.request<{
      id: string;
      originalSaleId: string;
      refundReason: string;
      refundAmount: string | number;
      refundedBy: string;
      status: string;
      processedAt?: string;
      createdAt: string;
      updatedAt: string;
      originalSale: {
        id: string;
        receiptNumber?: string;
        totalAmount: number;
        customer?: {
          id: string;
          name: string;
          phone: string;
          email?: string;
          address?: string;
        };
        user: {
          id: string;
          name: string;
          username: string;
        };
        items: Array<{
          id: string;
          productId: string;
          quantity: number;
          unitPrice: number;
          product: {
            id: string;
            name: string;
            description?: string;
          };
        }>;
      };
      items: Array<{
        id: string;
        productId: string;
        quantity: number;
        unitPrice: number;
        reason: string;
        product: {
          id: string;
          name: string;
          description?: string;
        };
      }>;
      refundedByUser: {
        id: string;
        name: string;
        username: string;
      };
    }>(`/refunds/${id}`);
  }

  // Batch Management Methods
  async getBatches(params: {
    page?: number;
    limit?: number;
    search?: string;
    isActive?: boolean;
    isReported?: boolean;
    productId?: string;
    branchId?: string;
    companyId?: string;
  } = {}) {
    const queryParams = new URLSearchParams();
    if (params.page) queryParams.append('page', params.page.toString());
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.search) queryParams.append('search', params.search);
    if (params.isActive !== undefined) queryParams.append('isActive', params.isActive.toString());
    if (params.isReported !== undefined) queryParams.append('isReported', params.isReported.toString());
    if (params.productId) queryParams.append('productId', params.productId);
    if (params.branchId) queryParams.append('branchId', params.branchId);
    if (params.companyId) queryParams.append('companyId', params.companyId);

    const queryString = queryParams.toString();
    const endpoint = queryString ? `/batches?${queryString}` : '/batches';

    return this.request<{
      batches: Array<{
        id: string;
        batchNo: string;
        productId: string;
        supplierId?: string;
        supplierName?: string;
        totalBoxes: number;
        unitsPerBox: number;
        totalStock: number;
        costPrice: number;
        sellingPrice: number;
        // New pricing and stock fields
        costPricePerUnit?: number;
        costPricePerBox?: number;
        sellingPricePerUnit?: number;
        sellingPricePerBox?: number;
        stockQuantity?: number;
        minStockLevel?: number;
        stockPurchasePrice: number;
        paidAmount: number;
        supplierOutstanding: number;
        supplierInvoiceNo?: string;
        purchasingMethod?: string;
        expireDate?: string;
        productionDate?: string;
        shelfId?: string;
        shelfName?: string;
        isActive: boolean;
        isReported: boolean;
        createdAt: string;
        updatedAt: string;
        product: {
          id: string;
          name: string;
          sku: string;
          barcode?: string;
        };
        supplier?: {
          id: string;
          name: string;
        };
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(endpoint);
  }

  async getBatchById(id: string) {
    return this.request<{
      id: string;
      batchNo: string;
      productId: string;
      supplierId?: string;
      supplierName?: string;
      totalBoxes: number;
      unitsPerBox: number;
      totalStock: number;
      costPrice: number;
      sellingPrice: number;
      stockPurchasePrice: number;
      paidAmount: number;
      supplierOutstanding: number;
      supplierInvoiceNo?: string;
      purchasingMethod?: string;
      expireDate?: string;
      productionDate?: string;
      shelfId?: string;
      shelfName?: string;
      isActive: boolean;
      isReported: boolean;
      createdAt: string;
      updatedAt: string;
      product: {
        id: string;
        name: string;
        sku: string;
        barcode?: string;
      };
      supplier?: {
        id: string;
        name: string;
        email: string;
        phone: string;
      };
    }>(`/batches/${id}`);
  }

  async createBatch(batchData: {
    batchNo: string;
    productId: string;
    supplierId?: string;
    supplierName?: string;
    totalBoxes?: number;
    unitsPerBox?: number;
    totalStock?: number;
    costPrice?: number;
    sellingPrice?: number;
    stockPurchasePrice?: number;
    paidAmount?: number;
    supplierOutstanding?: number;
    supplierInvoiceNo?: string;
    purchasingMethod?: string;
    expireDate?: string;
    productionDate?: string;
    shelfId?: string;
    shelfName?: string;
    // New pricing and stock fields
    costPricePerUnit?: number;
    costPricePerBox?: number;
    sellingPricePerUnit?: number;
    sellingPricePerBox?: number;
    stockQuantity?: number;
    minStockLevel?: number;
    maxStockLevel?: number;
  }) {
    return this.request<{
      id: string;
      batchNo: string;
      productId: string;
      supplierId?: string;
      supplierName?: string;
      totalBoxes: number;
      unitsPerBox: number;
      totalStock: number;
      costPrice: number;
      sellingPrice: number;
      stockPurchasePrice: number;
      paidAmount: number;
      supplierOutstanding: number;
      supplierInvoiceNo?: string;
      purchasingMethod?: string;
      expireDate?: string;
      productionDate?: string;
      shelfId?: string;
      shelfName?: string;
      isActive: boolean;
      isReported: boolean;
      createdAt: string;
      updatedAt: string;
      product: {
        id: string;
        name: string;
        sku: string;
        barcode?: string;
      };
      supplier?: {
        id: string;
        name: string;
      };
    }>('/batches', {
      method: 'POST',
      body: JSON.stringify(batchData),
    });
  }

  async updateBatch(id: string, batchData: {
    batchNo?: string;
    supplierId?: string;
    supplierName?: string;
    totalBoxes?: number;
    unitsPerBox?: number;
    totalStock?: number;
    costPrice?: number;
    sellingPrice?: number;
    stockPurchasePrice?: number;
    paidAmount?: number;
    supplierOutstanding?: number;
    supplierInvoiceNo?: string;
    purchasingMethod?: string;
    expireDate?: string;
    productionDate?: string;
    shelfId?: string;
    shelfName?: string;
    isActive?: boolean;
    isReported?: boolean;
    // New pricing and stock fields
    stockQuantity?: number;
    costPricePerUnit?: number;
    costPricePerBox?: number;
    sellingPricePerUnit?: number;
    sellingPricePerBox?: number;
    minStockLevel?: number;
  }) {
    return this.request<{
      id: string;
      batchNo: string;
      productId: string;
      supplierId?: string;
      supplierName?: string;
      totalBoxes: number;
      unitsPerBox: number;
      totalStock: number;
      costPrice: number;
      sellingPrice: number;
      stockPurchasePrice: number;
      paidAmount: number;
      supplierOutstanding: number;
      supplierInvoiceNo?: string;
      purchasingMethod?: string;
      expireDate?: string;
      productionDate?: string;
      shelfId?: string;
      shelfName?: string;
      isActive: boolean;
      isReported: boolean;
      createdAt: string;
      updatedAt: string;
      product: {
        id: string;
        name: string;
        sku: string;
        barcode?: string;
      };
      supplier?: {
        id: string;
        name: string;
      };
    }>(`/batches/${id}`, {
      method: 'PUT',
      body: JSON.stringify(batchData),
    });
  }

  async deleteBatch(id: string) {
    return this.request<{
      success: boolean;
      message: string;
    }>(`/batches/${id}`, {
      method: 'DELETE',
    });
  }

  async restockBatch(id: string, restockData: {
    quantity: number;
    notes?: string;
  }) {
    return this.request<{
      success: boolean;
      message: string;
      data: {
        id: string;
        batchNo: string;
        stockQuantity: number;
        updatedAt: string;
      };
    }>(`/batches/${id}/restock`, {
      method: 'POST',
      body: JSON.stringify(restockData),
    });
  }

  async getNearExpiryBatches(days: number = 30) {
    return this.request<Array<{
      id: string;
      batchNo: string;
      productId: string;
      totalStock: number;
      expireDate: string;
      product: {
        id: string;
        name: string;
        sku: string;
      };
    }>>(`/batches/near-expiry?days=${days}`);
  }

  async getLowStockBatches(params: {
    page?: number;
    limit?: number;
    search?: string;
    branchId?: string;
    companyId?: string;
  } = {}) {
    const queryParams = new URLSearchParams();
    if (params.page) queryParams.append('page', params.page.toString());
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.search) queryParams.append('search', params.search);
    if (params.branchId) queryParams.append('branchId', params.branchId);
    if (params.companyId) queryParams.append('companyId', params.companyId);

    const queryString = queryParams.toString();
    const endpoint = queryString ? `/batches/low-stock?${queryString}` : '/batches/low-stock';

    return this.request<{
      batches: Array<{
        id: string;
        batchNo: string;
        productId: string;
        productName: string;
        productSku: string;
        category: string;
        supplier: string;
        branch: {
          id: string;
          name: string;
        };
        currentStock: number;
        totalProductStock: number;
        minStock: number;
        maxStock: number;
        unitPrice: number;
        expireDate?: string;
        productionDate?: string;
        orderQuantity: number;
        isLowStock: boolean;
        isCritical: boolean;
        isNearExpiry: boolean;
        isExpired: boolean;
        reason: string;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(endpoint);
  }

  // Purchase Management Methods
  async getPurchases(params: {
    page?: number;
    limit?: number;
    status?: string;
    supplierId?: string;
  } = {}) {
    const queryParams = new URLSearchParams();
    if (params.page) queryParams.append('page', params.page.toString());
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.status) queryParams.append('status', params.status);
    if (params.supplierId) queryParams.append('supplierId', params.supplierId);

    return this.request<{
      data: Array<{
        id: string;
        supplierId: string;
        invoiceNo?: string;
        purchaseDate: string;
        totalAmount: number;
        paidAmount: number;
        outstanding: number;
        status: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'PARTIAL';
        notes?: string;
        createdAt: string;
        updatedAt: string;
        supplier: {
          id: string;
          name: string;
          contactPerson: string;
          phone: string;
        };
        purchaseItems: Array<{
          id: string;
          productId: string;
          batchId?: string;
          quantity: number;
          unitPrice: number;
          totalPrice: number;
          product: {
            id: string;
            name: string;
            sku: string;
            barcode?: string;
          };
          batch?: {
            id: string;
            batchNo: string;
            quantity: number;
            expireDate?: string;
          };
        }>;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/purchases?${queryParams.toString()}`);
  }

  async getPurchaseById(id: string) {
    return this.request<{
      id: string;
      supplierId: string;
      invoiceNo?: string;
      purchaseDate: string;
      totalAmount: number;
      paidAmount: number;
      outstanding: number;
      status: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'PARTIAL';
      notes?: string;
      createdAt: string;
      updatedAt: string;
      supplier: {
        id: string;
        name: string;
        contactPerson: string;
        phone: string;
        email: string;
        address: string;
      };
      purchaseItems: Array<{
        id: string;
        productId: string;
        batchId?: string;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        product: {
          id: string;
          name: string;
          sku: string;
          barcode?: string;
          unitType: string;
        };
        batch?: {
          id: string;
          batchNo: string;
          quantity: number;
          expireDate?: string;
          productionDate?: string;
        };
      }>;
    }>(`/purchases/${id}`);
  }

  async createPurchase(purchaseData: {
    supplierId: string;
    invoiceNo?: string;
    purchaseDate?: string;
    totalAmount?: number;
    paidAmount?: number;
    notes?: string;
    items: Array<{
      productId: string;
      quantity: number;
      unitPrice: number;
      batchNo?: string;
      expireDate?: string;
      productionDate?: string;
    }>;
  }) {
    return this.request<{
      id: string;
      supplierId: string;
      invoiceNo?: string;
      purchaseDate: string;
      totalAmount: number;
      paidAmount: number;
      outstanding: number;
      status: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'PARTIAL';
      notes?: string;
      createdAt: string;
      updatedAt: string;
      supplier: {
        id: string;
        name: string;
        contactPerson: string;
        phone: string;
      };
      purchaseItems: Array<{
        id: string;
        productId: string;
        batchId?: string;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        product: {
          id: string;
          name: string;
          sku: string;
          barcode?: string;
        };
        batch?: {
          id: string;
          batchNo: string;
          quantity: number;
          expireDate?: string;
        };
      }>;
    }>('/purchases', {
      method: 'POST',
      body: JSON.stringify(purchaseData),
    });
  }

  async updatePurchase(id: string, purchaseData: {
    supplierId?: string;
    invoiceNo?: string;
    purchaseDate?: string;
    totalAmount?: number;
    paidAmount?: number;
    status?: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'PARTIAL';
    notes?: string;
  }) {
    return this.request<{
      id: string;
      supplierId: string;
      invoiceNo?: string;
      purchaseDate: string;
      totalAmount: number;
      paidAmount: number;
      outstanding: number;
      status: 'PENDING' | 'COMPLETED' | 'CANCELLED' | 'PARTIAL';
      notes?: string;
      createdAt: string;
      updatedAt: string;
      supplier: {
        id: string;
        name: string;
        contactPerson: string;
        phone: string;
      };
      purchaseItems: Array<{
        id: string;
        productId: string;
        batchId?: string;
        quantity: number;
        unitPrice: number;
        totalPrice: number;
        product: {
          id: string;
          name: string;
          sku: string;
          barcode?: string;
        };
        batch?: {
          id: string;
          batchNo: string;
          quantity: number;
          expireDate?: string;
        };
      }>;
    }>(`/purchases/${id}`, {
      method: 'PUT',
      body: JSON.stringify(purchaseData),
    });
  }

  async deletePurchase(id: string) {
    return this.request<{
      success: boolean;
      message: string;
    }>(`/purchases/${id}`, {
      method: 'DELETE',
    });
  }

  // Inventory Management Methods
  async getInventorySummary(params: {
    page?: number;
    limit?: number;
    search?: string;
    categoryId?: string;
    companyId?: string;
    lowStock?: boolean;
  } = {}) {
    const queryParams = new URLSearchParams();
    if (params.page) queryParams.append('page', params.page.toString());
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.search) queryParams.append('search', params.search);
    if (params.categoryId) queryParams.append('categoryId', params.categoryId);
    if (params.companyId) queryParams.append('companyId', params.companyId);
    if (params.lowStock) queryParams.append('lowStock', params.lowStock.toString());

    return this.request<{
      data: Array<{
        id: string;
        name: string;
        sku: string;
        barcode?: string;
        stock: number;
        minStock: number;
        costPrice: number;
        sellingPrice: number;
        unitType: string;
        category: {
          id: string;
          name: string;
          type: 'MEDICAL' | 'NON_MEDICAL' | 'GENERAL';
        };
        supplier: {
          id: string;
          name: string;
        };
        batches: Array<{
          id: string;
          batchNo: string;
          quantity: number;
          expireDate?: string;
          purchasePrice: number;
          sellingPrice: number;
        }>;
        totalBatchQuantity: number;
        nearExpiryBatches: number;
        expiredBatches: number;
        isLowStock: boolean;
        stockStatus: 'LOW' | 'MEDIUM' | 'GOOD';
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(`/inventory/summary?${queryParams.toString()}`);
  }

  async getInventoryByBatches(params: {
    page?: number;
    limit?: number;
    search?: string;
    productId?: string;
    nearExpiry?: boolean;
    expired?: boolean;
    branchId?: string;
    companyId?: string;
    isReported?: boolean;
  } = {}) {
    const queryParams = new URLSearchParams();
    if (params.page) queryParams.append('page', params.page.toString());
    if (params.limit) queryParams.append('limit', params.limit.toString());
    if (params.search) queryParams.append('search', params.search);
    if (params.productId) queryParams.append('productId', params.productId);
    if (params.nearExpiry) queryParams.append('nearExpiry', params.nearExpiry.toString());
    if (params.expired) queryParams.append('expired', params.expired.toString());
    if (params.branchId) queryParams.append('branchId', params.branchId);
    if (params.companyId) queryParams.append('companyId', params.companyId);
    if (params.isReported !== undefined) queryParams.append('isReported', params.isReported.toString());

    const queryString = queryParams.toString();
    const endpoint = queryString ? `/inventory/batches?${queryString}` : '/inventory/batches';

    return this.request<{
      data: Array<{
        id: string;
        batchNo: string;
        productId: string;
        quantity: number;
        purchasePrice: number;
        sellingPrice: number;
        expireDate?: string;
        productionDate?: string;
        product: {
          id: string;
          name: string;
          sku: string;
          barcode?: string;
          unitType: string;
          minStock: number;
        };
        supplier: {
          id: string;
          name: string;
        };
        expiryStatus: 'GOOD' | 'WARNING' | 'CRITICAL' | 'EXPIRED';
        daysUntilExpiry?: number;
      }>;
      pagination: {
        page: number;
        limit: number;
        total: number;
        pages: number;
      };
    }>(endpoint);
  }

  async getInventoryReports(companyId?: string) {
    const params = new URLSearchParams();
    if (companyId && companyId !== '') params.append('companyId', companyId);
    const queryString = params.toString();
    const endpoint = queryString ? `/inventory/reports?${queryString}` : '/inventory/reports';
    
    return this.request<{
      totalProducts: number;
      lowStockProducts: number;
      nearExpiryBatches: number;
      expiredBatches: number;
      totalStockValue: number;
      categoryStats: Array<{
        categoryId: string;
        categoryName: string;
        categoryType: 'MEDICAL' | 'NON_MEDICAL' | 'GENERAL';
        productCount: number;
        totalStock: number;
      }>;
    }>(endpoint);
  }

  // Business Type Management
  async getBusinessTypes() {
    return this.request<any[]>('/business-types');
  }

  async getModules() {
    return this.request<any[]>('/business-types/modules');
  }

  async createBusinessType(data: { name: string; description?: string }) {
    return this.request<any>('/business-types', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateBusinessType(id: string, data: { name: string; description?: string }) {
    return this.request<any>(`/business-types/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async updateBusinessTypeModules(id: string, moduleIds: string[]) {
    return this.request<any>(`/business-types/${id}/modules`, {
      method: 'PUT',
      body: JSON.stringify({ moduleIds }),
    });
  }

  async deleteBusinessType(id: string) {
    return this.request<any>(`/business-types/${id}`, {
      method: 'DELETE',
    });
  }

  async submitPaymentProof(formData: FormData) {
    const response = await fetch(`${this.baseURL}/payments/manual/submit`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });
    return response.json();
  }

  async getMyPaymentProofs(businessId: string) {
    return this.request<any[]>(`/payments/manual/my?businessId=${businessId}`);
  }

  async updateBusinessTypeModule(businessTypeId: string, moduleId: string, enabled: boolean) {
    return this.request<any>(`/business-types/${businessTypeId}/modules/${moduleId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
  }

  async updateBusinessTypeSubModule(businessTypeId: string, moduleId: string, subModuleKey: string, disabled: boolean) {
    return this.request<any>(`/business-types/${businessTypeId}/modules/${moduleId}/submodules/${subModuleKey}`, {
      method: 'PATCH',
      body: JSON.stringify({ disabled }),
    });
  }

  async getSubscriptionPlans() {
    return this.request<any[]>('/subscription/pricing-plans');
  }

  async updatePlanModule(planId: string, moduleId: string, enabled: boolean) {
    return this.request<any>(`/subscription-plans/${planId}/modules/${moduleId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
  }

  async updatePlanSubModule(planId: string, moduleId: string, subModuleKey: string, disabled: boolean) {
    return this.request<any>(`/subscription-plans/${planId}/modules/${moduleId}/submodules/${subModuleKey}`, {
      method: 'PATCH',
      body: JSON.stringify({ disabled }),
    });
  }

  async getAllRoles() {
    return this.request<Record<string, any>>('/roles');
  }

  async updateRoleModule(roleId: string, moduleId: string, enabled: boolean) {
    return this.request<any>(`/roles/${roleId}/modules/${moduleId}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
  }

  async updateRoleSubModule(roleId: string, moduleId: string, subModuleKey: string, disabled: boolean) {
    return this.request<any>(`/roles/${roleId}/modules/${moduleId}/submodules/${subModuleKey}`, {
      method: 'PATCH',
      body: JSON.stringify({ disabled }),
    });
  }

  async getAllModules() {
    return this.request<any[]>('/module-access/all');
  }

  async updateModuleStatus(moduleId: string, enabled: boolean) {
    return this.request<any>(`/modules/${moduleId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
  }

  // ==================== BARCODE METHODS ====================

  async lookupBarcode(barcode: string) {
    return this.request<any>('/barcodes/lookup', {
      method: 'POST',
      body: JSON.stringify({ barcode }),
    });
  }

  async generateBarcode(options: { prefix?: string; length?: number; type?: string }) {
    return this.request<any>('/barcodes/generate', {
      method: 'POST',
      body: JSON.stringify(options),
    });
  }

  async validateBarcode(barcode: string, type?: string, excludeProductId?: string) {
    return this.request<any>('/barcodes/validate', {
      method: 'POST',
      body: JSON.stringify({ barcode, type, excludeProductId }),
    });
  }

  async getBarcodeStats() {
    return this.request<any>('/barcodes/stats');
  }

  async getProductBarcodes(productId: string) {
    return this.request<any>(`/barcodes/product/${productId}`);
  }

  async updateProductBarcodes(productId: string, data: {
    barcode?: string;
    additionalBarcodes?: string[];
    barcodeType?: string;
  }) {
    return this.request<any>(`/barcodes/product/${productId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

}

export const apiService = new ApiService(API_BASE_URL);
export default apiService;