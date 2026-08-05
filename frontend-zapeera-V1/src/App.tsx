import React from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Routes, Route, Navigate } from "react-router-dom";
import { AdminProvider } from "./contexts/AdminContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { useMembershipRole } from "./hooks/useMembershipRole";
import { DashboardDataProvider } from "./contexts/DashboardDataContext";
import AuthContainer from "./components/auth/AuthContainer";
import ResetPassword from "./components/auth/ResetPassword";
import VerifyEmail from "./components/auth/VerifyEmail";
import MainLayout from "./components/layout/MainLayout";
import Index from "./pages/Index";
import POS from "./pages/POS";
import CreateInvoice from "./pages/CreateInvoice";
import InventoryPage from "./pages/Inventory";
import MedicalProductsPage from "./pages/MedicalProducts";
import NonMedicalProductsPage from "./pages/NonMedicalProducts";
import CategoriesPage from "./pages/Categories";
import ManufacturersPage from "./pages/Manufacturers";
import SuppliersPage from "./pages/Suppliers";
import ShelvesPage from "./pages/Shelves";
import CustomersPage from "./pages/Customers";
import ReportsPage from "./pages/Reports";
import AdvancedReportsPage from "./pages/AdvancedReports";
import SettingsPage from "./pages/Settings";
import ExpenseManagement from "./pages/ExpenseManagement";
import ShiftManagement from "./pages/ShiftManagement";
import NotFound from "./pages/NotFound";
import UserManagement from "./components/admin/UserManagement";
import ManagerUserManagement from "./components/manager/ManagerUserManagement";
import BranchManagement from "./components/admin/BranchManagement";
import BusinessManagement from "./components/admin/BusinessManagement";
import AdminReports from "./components/admin/AdminReports";
import RoleManagement from "./components/admin/RoleManagement";
import RoleBasedDashboard from "./components/dashboard/RoleBasedDashboard";
import { RoleBasedSidebar } from "./components/layout/RoleBasedSidebar";
import Refunds from "./components/pos/Refunds";
import Invoices from "./components/pos/Invoices";
import StaffCheckIn from "./components/pos/EmployeeCheckIn";
import PerformanceTracking from "./components/pos/PerformanceTracking";
import InventoryTransfers from "./components/inventory/InventoryTransfers";
import SubscriptionManagement from "./components/admin/SubscriptionManagement";
import OrderPurchase from "./components/admin/OrderPurchase";
import ZapeeraDashboard from "./components/dashboard/ZapeeraDashboard";
import BusinessTypeGuard from "./components/auth/BusinessTypeGuard";
import ZapeeraLayout from "./components/layout/ZapeeraLayout";
import Batches from "./pages/Batches";
import Purchases from "./pages/Purchases";
import RoleBasedRoot from "./components/auth/RoleBasedRoot";
import { useRealtimeNotifications } from "./hooks/useRealtimeNotifications";
import AuthStatus from "./components/auth/AuthStatus";
import { useAdmin } from "./contexts/useAdmin";
import BusinessSlugGate from "./components/auth/BusinessSlugGate";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { ModuleGuard, AutoModuleGuard } from "./components/auth/ModuleGuard";
import { RuntimeProvider } from "./contexts/RuntimeProvider";
import { SyncProvider } from "./contexts/SyncProvider";
import { DesktopLoginFlow } from "./components/desktop/DesktopLoginFlow";
import InvitationsPage from "./components/user-dashboard/InvitationsPage";
import ProfileSecurityPage from "./components/user-dashboard/ProfileSecurityPage";
import BillingPage from "./components/user-dashboard/BillingPage";
import NotificationsPage from "./components/user-dashboard/NotificationsPage";
import NotificationsListPage from "./components/user-dashboard/NotificationsListPage";
import NotificationPreferencesPage from "./components/user-dashboard/NotificationPreferencesPage";
import { NotificationProvider } from "./contexts/NotificationContext";
import SupportPage from "./components/user-dashboard/SupportPage";
import DownloadsPage from "./components/user-dashboard/DownloadsPage";

// Build target: web, desktop, backoffice - replaced at compile time by Vite define
declare const __VITE_APP_TARGET__: string;
const APP_TARGET = typeof __VITE_APP_TARGET__ !== 'undefined' ? __VITE_APP_TARGET__ : 'web';
const IS_DESKTOP = APP_TARGET === 'desktop';
// Replaced at build time: null for desktop, React.lazy(...) for web
const BackofficeRouterLazy = __BACKOFFICE_MARKER__;

// Configure QueryClient to prevent rate limiting
// Disable refetch on window focus and add request deduplication
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false, // CRITICAL: Disable refetch on focus to prevent rate limiting
      refetchOnMount: false, // Don't refetch on mount if data exists
      refetchOnReconnect: true, // Only refetch on reconnect
      staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
      gcTime: 10 * 60 * 1000, // Keep unused data in cache for 10 minutes (was cacheTime)
      retry: 1, // Only retry once on failure
      retryDelay: 1000, // Wait 1 second before retry
    },
  },
});

// Protected Route Component
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { isAuthenticated } = useAuth();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

// Role-based Protected Route Component
const RoleProtectedRoute = ({
  children,
  allowedRoles,
  allowOwnerOverride = true
}: {
  children: React.ReactNode;
  allowedRoles: string[];
  allowOwnerOverride?: boolean;
}) => {
  const { isAuthenticated, user } = useAuth();
  const { selectedBusinessId, selectedBusiness, allBusinesses, isLoading } = useAdmin();
  const membershipRole = useMembershipRole();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const effectiveRole =
    membershipRole === 'OWNER' && allowedRoles.includes('ADMIN') ? 'ADMIN' : (membershipRole || user?.role || '');
  
  // CRITICAL FIX: If the global role is allowed, but the membership role is not,
  // we should still allow access if they are on a global page (where membershipRole might be restrictive)
  // or if they are a global owner/admin.
  const isGlobalRoleAllowed = user?.role && allowedRoles.includes(user.role);
  const hasRequiredRole = allowedRoles.includes(effectiveRole) || isGlobalRoleAllowed;
  const resolvedSelectedBusiness = selectedBusiness || allBusinesses.find((business) => business.id === selectedBusinessId) || null;
  const isBusinessOwner =
    effectiveRole === 'OWNER' &&
    !!selectedBusinessId &&
    !!resolvedSelectedBusiness?.createdBy &&
    resolvedSelectedBusiness.createdBy === user?.id;

  if (!hasRequiredRole) {
    if (allowOwnerOverride && user?.role === 'OWNER' && selectedBusinessId && !resolvedSelectedBusiness && isLoading) {
      return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
    }

    if (allowOwnerOverride && isBusinessOwner) {
      return <>{children}</>;
    }

    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <h2 className="text-2xl font-bold text-foreground mb-2">Access Denied</h2>
          <p className="text-muted-foreground">
            You don't have permission to access this page.
          </p>
          <p className="text-sm text-muted-foreground mt-2">
            Your role: {user?.role} | Required roles: {allowedRoles.join(', ')}
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

const RedirectToBusinessSubscription = () => {
  const { selectedCompany, allCompanies, selectedCompanyId } = useAdmin();
  const company = selectedCompany || allCompanies.find((company) => company.id === selectedCompanyId);
  const slug = company?.slug?.trim();

  if (slug) {
    return <Navigate to={`/business/${encodeURIComponent(slug)}/subscription`} replace />;
  }

  return <Navigate to="/zapeera/my-businesses" replace />;
};

// Desktop-specific login route with provisioning flow
const LoginRoute = () => {
  const { login } = useAuth();
  const isDesktop = IS_DESKTOP || (typeof window !== 'undefined' && typeof (window as any).electronAPI !== 'undefined');

  if (isDesktop) {
    return <DesktopLoginFlow onLogin={login} />;
  }

  return <AuthContainer />;
};

// Main App Routes Component
const AppRoutes = () => {
  const authContext = useAuth();
  const { isAuthenticated, login } = authContext;

  // Initialize real-time notifications
  useRealtimeNotifications();

  const Router: React.ComponentType<React.PropsWithChildren<any>> =
    typeof window !== 'undefined' && window.location?.protocol === 'file:' ? HashRouter : BrowserRouter;

  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ErrorBoundary>
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/signup" element={<AuthContainer />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-email" element={<VerifyEmail />} />

        {/* Protected Routes - Default redirect to login if not authenticated */}
        <Route path="/" element={
          <AuthStatus fallback={<Navigate to="/login" replace />}>
            <BusinessTypeGuard>
              <RoleBasedRoot />
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/dashboard" element={
          <AuthStatus fallback={<Navigate to="/login" replace />}>
            <BusinessTypeGuard>
              <Navigate to="/zapeera" replace />
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/pos" element={
          <AuthStatus fallback={<Navigate to="/login" replace />}>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <POS />
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/create-invoice" element={
          <AuthStatus fallback={<Navigate to="/login" replace />}>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <CreateInvoice />
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/customers" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <MainLayout>
                  <CustomersPage />
                </MainLayout>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/invoices" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <RoleProtectedRoute allowedRoles={['ADMIN', 'MANAGER', 'CASHIER']}>
                  <MainLayout>
                    <Invoices />
                  </MainLayout>
                </RoleProtectedRoute>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/refunds" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <RoleProtectedRoute allowedRoles={['ADMIN', 'MANAGER', 'CASHIER']}>
                  <MainLayout>
                    <Refunds />
                  </MainLayout>
                </RoleProtectedRoute>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/checkin" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <MainLayout>
                  <StaffCheckIn />
                </MainLayout>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/performance" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <MainLayout>
                  <PerformanceTracking />
                </MainLayout>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        {/* Manager & Admin Routes */}
        <Route path="/inventory-transfers" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <RoleProtectedRoute allowedRoles={['MANAGER', 'ADMIN']}>
                  <MainLayout>
                    <InventoryTransfers />
                  </MainLayout>
                </RoleProtectedRoute>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/inventory" element={
          <AuthStatus fallback={<Navigate to="/login" replace />}>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <RoleProtectedRoute allowedRoles={['ADMIN', 'MANAGER', 'CASHIER']}>
                  <MainLayout>
                    <InventoryPage />
                  </MainLayout>
                </RoleProtectedRoute>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/inventory/categories" element={
          <AuthStatus fallback={<Navigate to="/login" replace />}>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <RoleProtectedRoute allowedRoles={['ADMIN', 'MANAGER', 'CASHIER']}>
                  <MainLayout>
                    <CategoriesPage />
                  </MainLayout>
                </RoleProtectedRoute>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/manufacturers" element={
          <AuthStatus fallback={<Navigate to="/login" replace />}>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <MainLayout>
                  <ManufacturersPage />
                </MainLayout>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/suppliers" element={
          <AuthStatus fallback={<Navigate to="/login" replace />}>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <RoleProtectedRoute allowedRoles={['ADMIN', 'MANAGER', 'CASHIER']}>
                  <MainLayout>
                    <SuppliersPage />
                  </MainLayout>
                </RoleProtectedRoute>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/shelves" element={
          <AuthStatus fallback={<Navigate to="/login" replace />}>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <MainLayout>
                  <ShelvesPage />
                </MainLayout>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/inventory/medical" element={
          <AuthStatus fallback={<Navigate to="/login" replace />}>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <RoleProtectedRoute allowedRoles={['ADMIN', 'MANAGER', 'CASHIER']}>
                  <MainLayout>
                    <MedicalProductsPage />
                  </MainLayout>
                </RoleProtectedRoute>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/inventory/non-medical" element={
          <AuthStatus fallback={<Navigate to="/login" replace />}>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <RoleProtectedRoute allowedRoles={['ADMIN', 'MANAGER', 'CASHIER']}>
                  <MainLayout>
                    <NonMedicalProductsPage />
                  </MainLayout>
                </RoleProtectedRoute>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/batches" element={
          <AuthStatus fallback={<Navigate to="/login" replace />}>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <RoleProtectedRoute allowedRoles={['ADMIN', 'MANAGER', 'CASHIER']}>
                  <MainLayout>
                    <Batches />
                  </MainLayout>
                </RoleProtectedRoute>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/purchases" element={
          <AuthStatus fallback={<Navigate to="/login" replace />}>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <RoleProtectedRoute allowedRoles={['ADMIN', 'MANAGER', 'CASHIER']}>
                  <MainLayout>
                    <Purchases />
                  </MainLayout>
                </RoleProtectedRoute>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/order-purchase" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <RoleProtectedRoute allowedRoles={['ADMIN', 'MANAGER', 'CASHIER']}>
                  <MainLayout>
                    <OrderPurchase />
                  </MainLayout>
                </RoleProtectedRoute>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/reports" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <RoleProtectedRoute allowedRoles={['MANAGER', 'ADMIN']}>
                  <MainLayout>
                    <ReportsPage />
                  </MainLayout>
                </RoleProtectedRoute>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/advanced-reports" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <RoleProtectedRoute allowedRoles={['MANAGER', 'ADMIN']}>
                  <MainLayout>
                    <AdvancedReportsPage />
                  </MainLayout>
                </RoleProtectedRoute>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/expenses" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <RoleProtectedRoute allowedRoles={['MANAGER', 'ADMIN', 'OWNER']}>
                  <MainLayout>
                    <ExpenseManagement />
                  </MainLayout>
                </RoleProtectedRoute>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/shifts" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <RoleProtectedRoute allowedRoles={['MANAGER', 'ADMIN', 'OWNER']}>
                  <MainLayout>
                    <ShiftManagement />
                  </MainLayout>
                </RoleProtectedRoute>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        {/* All Users - Settings */}
        <Route path="/settings" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <ZapeeraLayout>
                  <ProfileSecurityPage />
                </ZapeeraLayout>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/zapeera" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <ZapeeraDashboard />
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/zapeera/invitations" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <ZapeeraLayout>
                  <InvitationsPage />
                </ZapeeraLayout>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/zapeera/billing" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <ZapeeraLayout>
                  <BillingPage />
                </ZapeeraLayout>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/zapeera/notifications" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <ZapeeraLayout>
                  <NotificationsListPage />
                </ZapeeraLayout>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/zapeera/notification-settings" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <ZapeeraLayout>
                  <NotificationPreferencesPage />
                </ZapeeraLayout>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/zapeera/support" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <ZapeeraLayout>
                  <SupportPage />
                </ZapeeraLayout>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/downloads" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <ZapeeraLayout>
                  <DownloadsPage />
                </ZapeeraLayout>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        {/* Zapeera-specific routes that use ZapeeraLayout */}
        <Route path="/zapeera/my-businesses" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <RoleProtectedRoute allowedRoles={['ADMIN', 'MANAGER', 'CASHIER', 'OWNER']}>
                  <ZapeeraLayout>
                    <BusinessManagement />
                  </ZapeeraLayout>
                </RoleProtectedRoute>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/admin/business-subscription" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <RoleProtectedRoute allowedRoles={['ADMIN', 'OWNER']}>
                  <RedirectToBusinessSubscription />
                </RoleProtectedRoute>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/zapeera/subscription" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <RoleProtectedRoute allowedRoles={['ADMIN', 'OWNER']}>
                <RedirectToBusinessSubscription />
              </RoleProtectedRoute>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/zapeera/users" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <RoleProtectedRoute allowedRoles={['ADMIN', 'PRODUCT_OWNER']} allowOwnerOverride={false}>
                <ZapeeraLayout>
                  <UserManagement />
                </ZapeeraLayout>
              </RoleProtectedRoute>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/zapeera/branches" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <RoleProtectedRoute allowedRoles={['ADMIN']} allowOwnerOverride={false}>
                <ZapeeraLayout>
                  <BranchManagement />
                </ZapeeraLayout>
              </RoleProtectedRoute>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        {/* Admin Only Routes */}
        <Route path="/admin/users" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <RoleProtectedRoute allowedRoles={['ADMIN', 'PRODUCT_OWNER', 'MANAGER', 'OWNER']}>
                <MainLayout>
                  <UserManagement />
                </MainLayout>
              </RoleProtectedRoute>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/manager/users" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <RoleProtectedRoute allowedRoles={['MANAGER']}>
                <MainLayout>
                  <ManagerUserManagement />
                </MainLayout>
              </RoleProtectedRoute>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/admin/roles" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <RoleProtectedRoute allowedRoles={['ADMIN', 'PRODUCT_OWNER']} allowOwnerOverride={false}>
                <MainLayout>
                  <RoleManagement />
                </MainLayout>
              </RoleProtectedRoute>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/admin/reports" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <RoleProtectedRoute allowedRoles={['ADMIN']} allowOwnerOverride={false}>
                <MainLayout>
                  <AdminReports />
                </MainLayout>
              </RoleProtectedRoute>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/admin/businesses" element={
          <AuthStatus fallback={<Navigate to="/login" replace />}>
            <BusinessTypeGuard>
              <RoleProtectedRoute allowedRoles={['ADMIN']}>
                <MainLayout>
                  <BusinessManagement />
                </MainLayout>
              </RoleProtectedRoute>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/admin/branches" element={
          <AuthStatus fallback={<Navigate to="/login" replace />}>
            <BusinessTypeGuard>
              <RoleProtectedRoute allowedRoles={['ADMIN', 'OWNER']}>
                <MainLayout>
                  <BranchManagement />
                </MainLayout>
              </RoleProtectedRoute>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/subscription" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <RoleProtectedRoute allowedRoles={['ADMIN', 'OWNER']}>
                <RedirectToBusinessSubscription />
              </RoleProtectedRoute>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/admin/subscription" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <RoleProtectedRoute allowedRoles={['ADMIN', 'OWNER']}>
                <RedirectToBusinessSubscription />
              </RoleProtectedRoute>
            </BusinessTypeGuard>
          </AuthStatus>
        } />


        {/* Business Slug-based Routes */}
        <Route path="/business/:businessSlug/dashboard" element={
          <AuthStatus fallback={<Navigate to="/login" replace />}>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <RoleBasedDashboard />
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/branches" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <RoleProtectedRoute allowedRoles={['ADMIN', 'OWNER']}>
                    <MainLayout>
                      <BranchManagement />
                    </MainLayout>
                  </RoleProtectedRoute>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/staff" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <RoleProtectedRoute allowedRoles={['ADMIN', 'MANAGER', 'OWNER']}>
                    <MainLayout>
                      <UserManagement />
                    </MainLayout>
                  </RoleProtectedRoute>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/subscription" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <RoleProtectedRoute allowedRoles={['ADMIN', 'OWNER']}>
                  <MainLayout>
                    <SubscriptionManagement />
                  </MainLayout>
                </RoleProtectedRoute>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/settings" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <RoleProtectedRoute allowedRoles={['ADMIN','OWNER','MANAGER']}>
                  <MainLayout>
                    <SettingsPage />
                  </MainLayout>
                </RoleProtectedRoute>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/shifts" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <RoleProtectedRoute allowedRoles={['MANAGER', 'ADMIN', 'OWNER']}>
                    <MainLayout>
                      <ShiftManagement />
                    </MainLayout>
                  </RoleProtectedRoute>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/expenses" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <RoleProtectedRoute allowedRoles={['MANAGER', 'ADMIN', 'OWNER']}>
                    <MainLayout>
                      <ExpenseManagement />
                    </MainLayout>
                  </RoleProtectedRoute>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/products" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <RoleProtectedRoute allowedRoles={['ADMIN', 'MANAGER', 'CASHIER', 'OWNER']}>
                    <MainLayout>
                      <InventoryPage />
                    </MainLayout>
                  </RoleProtectedRoute>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/categories" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <RoleProtectedRoute allowedRoles={['ADMIN', 'MANAGER', 'CASHIER', 'OWNER']}>
                    <MainLayout>
                      <CategoriesPage />
                    </MainLayout>
                  </RoleProtectedRoute>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/manufacturers" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <MainLayout>
                    <ManufacturersPage />
                  </MainLayout>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/suppliers" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <RoleProtectedRoute allowedRoles={['ADMIN', 'MANAGER', 'CASHIER', 'OWNER']}>
                    <MainLayout>
                      <SuppliersPage />
                    </MainLayout>
                  </RoleProtectedRoute>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/shelves" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <MainLayout>
                    <ShelvesPage />
                  </MainLayout>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/batches" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <RoleProtectedRoute allowedRoles={['ADMIN', 'MANAGER', 'CASHIER', 'OWNER']}>
                    <MainLayout>
                      <Batches />
                    </MainLayout>
                  </RoleProtectedRoute>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/order-purchase" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <RoleProtectedRoute allowedRoles={['ADMIN', 'MANAGER', 'CASHIER', 'OWNER']}>
                    <MainLayout>
                      <OrderPurchase />
                    </MainLayout>
                  </RoleProtectedRoute>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/invoices" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <RoleProtectedRoute allowedRoles={['ADMIN', 'MANAGER', 'CASHIER', 'OWNER']}>
                    <MainLayout>
                      <Invoices />
                    </MainLayout>
                  </RoleProtectedRoute>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/refunds" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <RoleProtectedRoute allowedRoles={['ADMIN', 'MANAGER', 'CASHIER', 'OWNER']}>
                    <MainLayout>
                      <Refunds />
                    </MainLayout>
                  </RoleProtectedRoute>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/customers" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <MainLayout>
                    <CustomersPage />
                  </MainLayout>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/pos" element={
          <AuthStatus fallback={<Navigate to="/login" replace />}>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <POS />
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/reports" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <RoleProtectedRoute allowedRoles={['MANAGER', 'ADMIN', 'OWNER']}>
                    <MainLayout>
                      <ReportsPage />
                    </MainLayout>
                  </RoleProtectedRoute>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/business/:businessSlug/advanced-reports" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <RoleProtectedRoute allowedRoles={['MANAGER', 'ADMIN', 'OWNER']}>
                    <MainLayout>
                      <AdvancedReportsPage />
                    </MainLayout>
                  </RoleProtectedRoute>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        {/* Backoffice Routes - Only in web/backoffice builds, excluded from desktop */}
        {BackofficeRouterLazy && (
          <Route path="/backoffice/*" element={
            <React.Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" /></div>}>
              <BackofficeRouterLazy />
            </React.Suspense>
          } />
        )}

        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
      </ErrorBoundary>
    </Router>
  );
};

const App = () => {
  const isBackoffice = !IS_DESKTOP && typeof window !== 'undefined' && window.location.pathname.startsWith('/backoffice');

  if (isBackoffice) {
    return (
      <QueryClientProvider client={queryClient}>
        <RuntimeProvider>
          <AuthProvider>
            <NotificationProvider>
              <TooltipProvider>
                <Toaster />
                <Sonner />
                <AppRoutes />
              </TooltipProvider>
            </NotificationProvider>
          </AuthProvider>
        </RuntimeProvider>
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <RuntimeProvider>
        <AuthProvider>
          <AdminProvider>
            <DashboardDataProvider>
              <SyncProvider>
                <NotificationProvider>
                  <TooltipProvider>
                    <Toaster />
                    <Sonner />
                    <AppRoutes />
                  </TooltipProvider>
                </NotificationProvider>
              </SyncProvider>
            </DashboardDataProvider>
          </AdminProvider>
        </AuthProvider>
      </RuntimeProvider>
    </QueryClientProvider>
  );
};

export default App;
