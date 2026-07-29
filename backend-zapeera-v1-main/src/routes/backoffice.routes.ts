import { Router } from 'express';
import {
  adminLogin,
  adminLogout,
  createInitialAdmin,
  getAdminProfile
} from '../controllers/backoffice-auth.controller';
import {
  getAllPlans,
  getPlanById,
  createPlan,
  updatePlan,
  deletePlan
} from '../controllers/backoffice-plans.controller';
import {
  getAllSubscriptions,
  getSubscriptionByBusinessId,
  assignPlanToBusiness,
  updateSubscriptionStatus,
  cancelSubscription,
  extendTrial,
  getBillingSummary
} from '../controllers/backoffice-subscriptions.controller';
import {
  getAllBusinesses,
  getBusinessById,
  updateBusiness,
  toggleBusinessStatus,
  getBusinessStats,
  deleteBusiness
} from '../controllers/backoffice-businesses.controller';
import {
  getBusinessTypesWithCounts,
  getModules,
  updateBusinessType,
  deleteBusinessType,
  updateBusinessTypeModules,
  createBusinessType,
  getModuleHierarchyForBackoffice,
} from '../controllers/business-type.controller';
import {
  getPlanModulePermissions,
  updatePlanModulePermissions,
  getRoleModulePermissions,
  updateRoleModulePermissions,
  getModulePermissionMatrix,
  updateBusinessTypeSubModulePermission,
  updatePlanSubModulePermission,
  updateRoleSubModulePermission,
} from '../controllers/module-permissions.controller';
import {
  generateImpersonationToken,
  validateImpersonationToken,
  getAdminActionLogs,
  getAdminLoginLogs
} from '../controllers/backoffice-impersonation.controller';
import {
  getAllBackofficeUsers,
  toggleUserStatus,
  verifyUserEmail,
  resendUserVerification
} from '../controllers/user.controller';
import {
  getDashboardStats
} from '../controllers/backoffice-dashboard.controller';
import {
  adminAuthenticate,
  adminRoleGuard
} from '../middleware/admin-auth.middleware';
import {
  getAllPaymentProofs as getBackofficePaymentProofs,
  approvePaymentProof as approveBackofficePaymentProof,
  rejectPaymentProof as rejectBackofficePaymentProof,
} from '../controllers/payment-proof.controller';
import {
  getSupportTickets,
  getAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} from '../controllers/backoffice-support.controller';
import {
  getFeatureFlags,
  createFeatureFlag,
  updateFeatureFlag,
  deleteFeatureFlag,
} from '../controllers/backoffice-feature-flags.controller';

const router = Router();

/**
 * Admin Authentication Routes
 * Separate from regular user authentication
 */
router.post('/auth/login', adminLogin);
router.post('/auth/logout', adminAuthenticate, adminLogout);

/**
 * Admin Profile Routes
 * Protected by admin authentication
 */
router.get('/auth/profile', adminAuthenticate, getAdminProfile);

/**
 * Admin Setup Routes
 * Public endpoint to create initial admin (no auth required)
 * After first admin is created, this should be disabled or protected
 */
router.post('/auth/setup', createInitialAdmin);

/**
 * Plans Management Routes
 * Protected by admin authentication
 */
router.get('/plans', adminAuthenticate, getAllPlans);
router.get('/plans/:id', adminAuthenticate, getPlanById);
router.post('/plans', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN'), createPlan);
router.patch('/plans/:id', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN'), updatePlan);
router.delete('/plans/:id', adminAuthenticate, adminRoleGuard('SUPER_ADMIN'), deletePlan);

/**
 * Subscriptions Management Routes
 * Protected by admin authentication
 */
router.get('/subscriptions/billing-summary', adminAuthenticate, getBillingSummary);
router.get('/subscriptions', adminAuthenticate, getAllSubscriptions);
router.get('/subscriptions/business/:businessId', adminAuthenticate, getSubscriptionByBusinessId);
router.post('/subscriptions/assign', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN', 'FINANCE'), assignPlanToBusiness);
router.patch('/subscriptions/:subscriptionId/status', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN', 'FINANCE'), updateSubscriptionStatus);
router.post('/subscriptions/:subscriptionId/cancel', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN', 'FINANCE'), cancelSubscription);
router.post('/subscriptions/:subscriptionId/extend-trial', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN'), extendTrial);

/**
 * Business Types Routes
 * Protected by admin authentication
 */
router.get('/business-types', adminAuthenticate, getBusinessTypesWithCounts);
router.get('/business-types/modules', adminAuthenticate, getModules);
router.get('/business-modules', adminAuthenticate, getModules);
router.get('/module-hierarchy', adminAuthenticate, getModuleHierarchyForBackoffice);
router.post('/business-types', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN'), createBusinessType);
router.patch('/business-types/:id', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN'), updateBusinessType);
router.delete('/business-types/:id', adminAuthenticate, adminRoleGuard('SUPER_ADMIN'), deleteBusinessType);
router.put('/business-types/:id/modules', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN'), updateBusinessTypeModules);

/**
 * Module Permission Routes (Plan & Role tiers)
 */
router.get('/module-permissions/plans', adminAuthenticate, getPlanModulePermissions);
router.put('/module-permissions/plans/:planId', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN'), updatePlanModulePermissions);
router.get('/module-permissions/roles', adminAuthenticate, getRoleModulePermissions);
router.get('/module-permissions/matrix', adminAuthenticate, getModulePermissionMatrix);
router.put('/module-permissions/roles/:roleName', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN'), updateRoleModulePermissions);

// Sub-module permission toggles
router.put('/business-types/:id/sub-modules', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN'), updateBusinessTypeSubModulePermission);
router.put('/module-permissions/plans/:planId/sub-modules', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN'), updatePlanSubModulePermission);
router.put('/module-permissions/roles/:roleName/sub-modules', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN'), updateRoleSubModulePermission);

/**
 * Businesses Management Routes
 * Protected by admin authentication
 */
router.get('/businesses', adminAuthenticate, getAllBusinesses);
router.get('/businesses/stats', adminAuthenticate, getBusinessStats);
router.get('/businesses/:id', adminAuthenticate, getBusinessById);
router.patch('/businesses/:id', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN'), updateBusiness);
router.post('/businesses/:id/toggle-status', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN'), toggleBusinessStatus);
router.delete('/businesses/:id', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN'), deleteBusiness);

/**
 * Dashboard Stats Route
 * Single endpoint powering all Super Admin Dashboard widgets
 */
router.get('/dashboard/stats', adminAuthenticate, getDashboardStats);

/**
 * Users Management Routes
 * Protected by admin authentication
 */
router.get('/users', adminAuthenticate, getAllBackofficeUsers);
router.post('/users/:id/toggle-status', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN'), toggleUserStatus);
router.post('/users/:id/verify-email', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN'), verifyUserEmail);
router.post('/users/:id/resend-verification', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN'), resendUserVerification);

/**
 * Admin Impersonation Routes
 * Protected by admin authentication
 */
router.post('/impersonate', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN'), generateImpersonationToken);
router.post('/impersonate/validate', validateImpersonationToken);

/**
 * Admin Logs Routes
 * Protected by admin authentication
 */
router.get('/logs/actions', adminAuthenticate, getAdminActionLogs);
router.get('/logs/logins', adminAuthenticate, getAdminLoginLogs);

/**
 * Payment Proofs Routes (backoffice convenience wrappers)
 * Delegates to the existing payment-proof.controller
 */
router.get('/payment-proofs', adminAuthenticate, getBackofficePaymentProofs);
router.post('/payment-proofs/:id/approve', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN', 'FINANCE'), (req, res) => {
  // Remap :id → :proofId to match existing controller signature
  (req as any).params.proofId = req.params.id;
  approveBackofficePaymentProof(req as any, res);
});
router.post('/payment-proofs/:id/reject', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN', 'FINANCE'), (req, res) => {
  (req as any).params.proofId = req.params.id;
  rejectBackofficePaymentProof(req as any, res);
});

/**
 * Support Tickets Routes
 */
router.get('/support/tickets', adminAuthenticate, getSupportTickets);

/**
 * Announcements Routes
 */
router.get('/announcements', adminAuthenticate, getAnnouncements);
router.post('/announcements', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN', 'SUPPORT'), createAnnouncement);
router.patch('/announcements/:id', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN', 'SUPPORT'), updateAnnouncement);
router.delete('/announcements/:id', adminAuthenticate, adminRoleGuard('SUPER_ADMIN', 'ADMIN'), deleteAnnouncement);

/**
 * Feature Flags Routes
 */
router.get('/feature-flags', adminAuthenticate, getFeatureFlags);
router.post('/feature-flags', adminAuthenticate, adminRoleGuard('SUPER_ADMIN'), createFeatureFlag);
router.patch('/feature-flags/:id', adminAuthenticate, adminRoleGuard('SUPER_ADMIN'), updateFeatureFlag);
router.delete('/feature-flags/:id', adminAuthenticate, adminRoleGuard('SUPER_ADMIN'), deleteFeatureFlag);

export default router;
