/**
 * Centralized Configuration Constants
 * 
 * SECURITY: All hardcoded values are centralized here to ensure:
 * 1. Single source of truth for business logic constants
 * 2. Easy modification without widespread code changes
 * 3. Type safety through const assertions
 * 4. Clear visibility into system configuration
 */

// ============================================================================
// PLAN CONFIGURATION
// ============================================================================

export const PLANS = {
  TRIAL: 'single-trial',
  STARTER: 'single-starter',
  GROWTH: 'single-growth',
  SCALE: 'single-scale',
} as const;

export type PlanId = typeof PLANS[keyof typeof PLANS];

// Plan hierarchy for auto-upgrade logic
export const PLAN_HIERARCHY: PlanId[] = [
  PLANS.TRIAL,
  PLANS.STARTER,
  PLANS.GROWTH,
  PLANS.SCALE,
];

// Plans that only allow OWNER dashboard access
export const OWNER_ONLY_PLANS: readonly PlanId[] = [
  PLANS.TRIAL,
  PLANS.STARTER,
];

// Plan display names
export const PLAN_DISPLAY_NAMES: Record<PlanId, string> = {
  [PLANS.TRIAL]: 'Trial',
  [PLANS.STARTER]: 'Starter',
  [PLANS.GROWTH]: 'Growth',
  [PLANS.SCALE]: 'Scale',
};

// ============================================================================
// ROLE CONFIGURATION
// ============================================================================

export const ROLES = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  CASHIER: 'CASHIER',
  SUPER_ADMIN: 'SUPER_ADMIN',
  USER: 'USER',
} as const;

export type RoleName = typeof ROLES[keyof typeof ROLES];

// Roles that have full access within their business context
export const FULL_ACCESS_ROLES: readonly RoleName[] = [
  ROLES.OWNER,
  ROLES.ADMIN,
];

// Standard membership roles (not platform-level)
export const MEMBERSHIP_ROLES: readonly RoleName[] = [
  ROLES.OWNER,
  ROLES.MANAGER,
  ROLES.CASHIER,
  ROLES.USER,
];

// Roles that can access dashboard
export const DASHBOARD_ACCESS_ROLES: readonly RoleName[] = [
  ROLES.OWNER,
  ROLES.MANAGER,
  ROLES.CASHIER,
];

// Type alias for backward compatibility
export type AllowedDashboardAccessRole = typeof DASHBOARD_ACCESS_ROLES[number];

// Roles that can manage users
export const USER_MANAGEMENT_ROLES: readonly RoleName[] = [
  ROLES.OWNER,
  ROLES.ADMIN,
  ROLES.MANAGER,
];

// ============================================================================
// MODULE CONFIGURATION
// ============================================================================

export const MODULES = {
  SALES: 'sales',
  INVENTORY: 'inventory',
  CUSTOMERS: 'customers',
  SUPPLIERS: 'suppliers',
  PURCHASES: 'purchases',
  BUSINESS_MANAGEMENT: 'business_management',
  EXPENSES: 'expenses',
  REPORTS: 'reports',
  SUBSCRIPTION: 'subscription',
} as const;

export type ModuleKey = typeof MODULES[keyof typeof MODULES];

// Default modules for each plan tier
export const DEFAULT_PLAN_MODULES: Record<PlanId, ModuleKey[]> = {
  [PLANS.TRIAL]: [
    MODULES.SALES,
    MODULES.INVENTORY,
    MODULES.CUSTOMERS,
    MODULES.REPORTS,
  ],
  [PLANS.STARTER]: [
    MODULES.SALES,
    MODULES.INVENTORY,
    MODULES.CUSTOMERS,
    MODULES.REPORTS,
    MODULES.BUSINESS_MANAGEMENT,
  ],
  [PLANS.GROWTH]: [
    MODULES.SALES,
    MODULES.INVENTORY,
    MODULES.CUSTOMERS,
    MODULES.SUPPLIERS,
    MODULES.PURCHASES,
    MODULES.REPORTS,
    MODULES.BUSINESS_MANAGEMENT,
    MODULES.EXPENSES,
  ],
  [PLANS.SCALE]: [
    MODULES.SALES,
    MODULES.INVENTORY,
    MODULES.CUSTOMERS,
    MODULES.SUPPLIERS,
    MODULES.PURCHASES,
    MODULES.REPORTS,
    MODULES.BUSINESS_MANAGEMENT,
    MODULES.EXPENSES,
    MODULES.SUBSCRIPTION,
  ],
};

// ============================================================================
// PERMISSION CONFIGURATION
// ============================================================================

export const RESOURCES = {
  SALES: 'sales',
  PRODUCTS: 'products',
  CATEGORIES: 'categories',
  CUSTOMERS: 'customers',
  SUPPLIERS: 'suppliers',
  USERS: 'users',
  STAFF: 'staff',
  BRANCHES: 'branches',
  INVENTORY: 'inventory',
  REFUNDS: 'refunds',
  RECEIPTS: 'receipts',
  REPORTS: 'reports',
  DASHBOARD: 'dashboard',
  SETTINGS: 'settings',
  PURCHASES: 'purchases',
  BATCHES: 'batches',
  SHELVES: 'shelves',
  MANUFACTURERS: 'manufacturers',
  INVOICES: 'invoices',
} as const;

export type Resource = typeof RESOURCES[keyof typeof RESOURCES];

export const ACTIONS = {
  CREATE: 'create',
  READ: 'read',
  UPDATE: 'update',
  DELETE: 'delete',
  MANAGE: 'manage',
  EXPORT: 'export',
  IMPORT: 'import',
} as const;

export type Action = typeof ACTIONS[keyof typeof ACTIONS];

// ============================================================================
// BUSINESS TYPE CONFIGURATION
// ============================================================================

export const BUSINESS_TYPES = {
  PHARMACY: 'PHARMACY',
  STORE: 'STORE',
  HOTEL: 'HOTEL',
  CLINIC: 'CLINIC',
  RESTAURANT: 'RESTAURANT',
  WAREHOUSE: 'WAREHOUSE',
} as const;

export type BusinessType = typeof BUSINESS_TYPES[keyof typeof BUSINESS_TYPES];

export const ALL_BUSINESS_TYPES: BusinessType[] = [
  BUSINESS_TYPES.PHARMACY,
  BUSINESS_TYPES.STORE,
  BUSINESS_TYPES.HOTEL,
  BUSINESS_TYPES.CLINIC,
  BUSINESS_TYPES.RESTAURANT,
  BUSINESS_TYPES.WAREHOUSE,
];

// ============================================================================
// SUBSCRIPTION CONFIGURATION
// ============================================================================

// Trial duration in days
export const TRIAL_DURATION_DAYS = 15;

// Grace period duration in days after subscription expires
export const GRACE_PERIOD_DAYS = 7;

// Default limits per plan
export const PLAN_LIMITS: Record<PlanId, { maxBranches: number | null; maxMembers: number | null }> = {
  [PLANS.TRIAL]: { maxBranches: 1, maxMembers: 1 },
  [PLANS.STARTER]: { maxBranches: 1, maxMembers: 1 },
  [PLANS.GROWTH]: { maxBranches: 3, maxMembers: 3 },
  [PLANS.SCALE]: { maxBranches: 10, maxMembers: null }, // unlimited
};

// ============================================================================
// SECURITY CONFIGURATION
// ============================================================================

// JWT Configuration
export const JWT_CONFIG = {
  // Token expiration time in hours
  EXPIRATION_HOURS: 24,
  // Refresh token expiration in days
  REFRESH_EXPIRATION_DAYS: 7,
  // Algorithm for token signing
  ALGORITHM: 'HS256' as const,
};

// Session Configuration
export const SESSION_CONFIG = {
  // Default TTL in minutes
  DEFAULT_TTL_MINUTES: 30,
  // Maximum concurrent sessions per business (if limited)
  MAX_CONCURRENT_SESSIONS: 100,
};

// Rate Limiting Configuration
export const RATE_LIMIT_CONFIG = {
  // General API rate limit (requests per window)
  API_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  API_MAX_REQUESTS: 100,
  
  // Stricter limits for authentication endpoints
  AUTH_WINDOW_MS: 15 * 60 * 1000, // 15 minutes
  AUTH_MAX_REQUESTS: 5,
  
  // File upload limits
  UPLOAD_WINDOW_MS: 60 * 60 * 1000, // 1 hour
  UPLOAD_MAX_REQUESTS: 50,
};

// Password Configuration
export const PASSWORD_CONFIG = {
  MIN_LENGTH: 6,
  MAX_LENGTH: 128,
  // bcrypt salt rounds
  SALT_ROUNDS: 10,
};

// ============================================================================
// PAGINATION CONFIGURATION
// ============================================================================

export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 10,
  MAX_PAGE_SIZE: 100,
  DEFAULT_PAGE: 1,
};

// ============================================================================
// CACHE CONFIGURATION
// ============================================================================

export const CACHE_CONFIG = {
  // Module access cache TTL in minutes
  MODULE_ACCESS_TTL_MINUTES: 5,
  // Maximum cache entries to prevent memory leaks
  MAX_MODULE_ACCESS_CACHE_SIZE: 10000,
};

// ============================================================================
// SYNC CONFIGURATION
// ============================================================================

export const SYNC_CONFIG = {
  // Sync interval in milliseconds (for background sync)
  BACKGROUND_SYNC_INTERVAL_MS: 30 * 1000, // 30 seconds
  // Sync timeout for operations
  SYNC_TIMEOUT_MS: 5000, // 5 seconds
  // Maximum batch size for sync operations
  MAX_BATCH_SIZE: 100,
};

// ============================================================================
// FILE UPLOAD CONFIGURATION
// ============================================================================

export const UPLOAD_CONFIG = {
  // Maximum file size in bytes (5MB)
  MAX_FILE_SIZE: 5 * 1024 * 1024,
  // Allowed file types
  ALLOWED_TYPES: [
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/pdf',
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
};

// ============================================================================
// ERROR MESSAGES
// ============================================================================

export const ERROR_MESSAGES = {
  // Authentication
  UNAUTHORIZED: 'Unauthorized',
  INVALID_TOKEN: 'Invalid token',
  SESSION_EXPIRED: 'Session expired',
  ACCOUNT_INACTIVE: 'Account is not active',
  
  // Authorization
  PERMISSION_DENIED: 'Permission denied',
  BRANCH_ACCESS_DENIED: 'Access to this branch is not allowed',
  BUSINESS_ACCESS_DENIED: 'Access to this business is not allowed',
  MODULE_NOT_ALLOWED: 'This feature is not enabled in your subscription',
  
  // Business Logic
  BUSINESS_NOT_FOUND: 'Business not found',
  BRANCH_NOT_FOUND: 'Branch not found',
  USER_NOT_FOUND: 'User not found',
  
  // Subscription
  SUBSCRIPTION_EXPIRED: 'Your subscription has expired',
  SUBSCRIPTION_SUSPENDED: 'Your subscription has been suspended',
  PLAN_LIMIT_REACHED: 'You have reached your plan limit',
  
  // General
  INTERNAL_ERROR: 'Internal server error',
  VALIDATION_ERROR: 'Validation error',
  NOT_FOUND: 'Resource not found',
};


