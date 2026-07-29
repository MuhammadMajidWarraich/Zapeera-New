export type BackofficeRole = 'SUPER_ADMIN' | 'ADMIN' | 'FINANCE' | 'SUPPORT' | 'HR' | 'VIEWER';

export interface BackofficeAdmin {
  id: string;
  email: string;
  role: BackofficeRole;
  isActive: boolean;
  lastLoginAt?: string;
  createdAt?: string;
  permissions?: string[];
}

export interface BackofficePermission {
  resource: string;
  actions: string[];
  description?: string;
}

export interface Business {
  id: string;
  name: string;
  slug?: string;
  email?: string;
  phone?: string;
  address?: string;
  businessType?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
  _count?: {
    branches: number;
    memberships: number;
  };
  owner?: { id: string; name: string; email: string };
  subscription?: Subscription;
}

export interface BusinessDetails extends Business {
  description?: string;
  website?: string;
  createdBy?: string;
  branches?: Branch[];
  members?: BusinessMember[];
}

export interface BusinessMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  status: string;
  joinedAt: string;
}

export interface Branch {
  id: string;
  name: string;
  address?: string;
  phone?: string;
  email?: string;
  isActive: boolean;
}

export interface User {
  id: string;
  name: string;
  email: string;
  username: string;
  isActive: boolean;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt?: string;
  businessesCount: number;
  role?: string;
}

export interface Subscription {
  id: string;
  businessId: string;
  businessName?: string;
  planId: string;
  planName: string;
  planPrice: number;
  status: 'ACTIVE' | 'TRIAL' | 'GRACE' | 'EXPIRED' | 'CANCELLED' | 'SUSPENDED';
  isTrial: boolean;
  trialEndsAt?: string;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  startedAt: string;
  endsAt?: string;
  amount: number;
}

export interface Plan {
  id: string;
  name: string;
  subtitle?: string;
  price: number;
  priceUnit?: string;
  interval?: string;
  badge?: string;
  description?: string;
  features?: string;
  maxStaffMembers?: number;
  maxBranches?: number;
  isActive: boolean;
  moduleRestrictions?: Record<string, ModuleRestriction>;
}

export interface ModuleRestriction {
  enabled: boolean;
  submodules?: Record<string, boolean>;
}

export interface BusinessTypeModule {
  id: string;
  name: string;
  key: string;
  icon?: string;
  description?: string;
  enabled: boolean;
  sortOrder: number;
}

export interface BusinessType {
  id: string;
  name: string;
  description?: string;
  defaultModules?: string[];
  moduleRestrictions?: Record<string, ModuleRestriction>;
  businessCount?: number;
  modulesEnabled?: number;
  modules?: BusinessTypeModule[];
}

export interface Module {
  id: string;
  key: string;
  name: string;
  icon?: string;
  description?: string;
  parentId?: string;
  sortOrder: number;
  isCore: boolean;
  isActive: boolean;
  children?: Module[];
}

export interface PlanModulePermission {
  planId: string;
  planName: string;
  price: number;
  modules: string[];
  subModules?: string[];
  disabledSubModules?: string[];
}

export interface RoleModulePermission {
  roleName: string;
  modules: string[];
  allModules: string[];
  subModules?: string[];
  disabledSubModules?: string[];
}

export interface Role {
  id?: string;
  name: string;
  description?: string;
  permissions: string[];
  moduleAccess?: Record<string, ModuleRestriction>;
  memberCount?: number;
}

export interface PaymentProof {
  id: string;
  businessId: string;
  businessName: string;
  businessEmail: string;
  planId: string;
  planName: string;
  planPrice: number;
  amount: number;
  currency: string;
  method: string;
  referenceNote?: string;
  screenshotUrl: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  adminId: string;
  adminEmail: string;
  adminRole: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldValue?: any;
  newValue?: any;
  ipAddress?: string;
  userAgent?: string;
  reason?: string;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  businessId?: string;
  userId?: string;
  subject: string;
  description: string;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  assignedTo?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  type: 'INFO' | 'WARNING' | 'MAINTENANCE' | 'UPDATE';
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  publishedAt?: string;
  createdBy: string;
  createdAt: string;
}

export interface DashboardStats {
  totalRevenue: number;
  revenueGrowthPercent: number | null;
  totalBusinesses: number;
  activeBusinesses: number;
  inactiveBusinesses: number;
  totalSubscriptions: number;
  activeSubscriptions: number;
  trialSubscriptions: number;
  expiredSubscriptions: number;
  suspendedSubscriptions: number;
  newSubscriptionsThisMonth: number;
  renewalSubscriptions: number;
  newRegistrationsLast30: number;
  totalUsers: number;
  topBusinesses: any[];
  recentActivity: any[];
  subscriptionAlerts: any[];
  recentUsers: any[];
  recentBusinesses: any[];
  growthChart: any[];
  pendingPaymentProofs: number;
}

export interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  environment?: string;
  permissions?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface SystemHealth {
  status: 'healthy' | 'degraded' | 'down';
  uptime: number;
  database: { status: string; latency: number };
  cache: { status: string; hitRate: number };
  queue: { pending: number; processing: number; failed: number };
  storage: { used: number; total: number; percentage: number };
  memory: { used: number; total: number; percentage: number };
  cpu: { usage: number; cores: number };
  lastChecked: string;
}
