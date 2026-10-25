import React, { useMemo } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter, Routes, Route, Navigate, useParams } from "react-router-dom";
import { AdminProvider } from "./contexts/AdminContext";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { useMembershipRole } from "./hooks/useMembershipRole";
import { DashboardDataProvider } from "./contexts/DashboardDataContext";
import AuthContainer from "./components/auth/AuthContainer";
import MainLayout from "./components/layout/MainLayout";
import NotFound from "./pages/NotFound";
import BusinessTypeGuard from "./components/auth/BusinessTypeGuard";
import ZapeeraLayout from "./components/layout/ZapeeraLayout";
import RoleBasedRoot from "./components/auth/RoleBasedRoot";
import { useRealtimeNotifications } from "./hooks/useRealtimeNotifications";
import AuthStatus from "./components/auth/AuthStatus";
import { useAdmin } from "./contexts/useAdmin";
import BusinessSlugGate from "./components/auth/BusinessSlugGate";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { ModuleGuard, AutoModuleGuard } from "./components/auth/ModuleGuard";
import { RuntimeProvider } from "./contexts/RuntimeProvider";
import { BrandingProvider } from "./contexts/BrandingContext";
import JoinPartnerPage from "./components/auth/JoinPartnerPage";
import { SyncProvider } from "./contexts/SyncProvider";
import { NotificationProvider } from "./contexts/NotificationContext";


// Route-level code splitting: heavy screens load on demand instead of in
// the initial bundle. Layouts, guards and auth stay eager so the shell
// renders instantly. (manualChunks stays disabled in vite.config — this
// uses natural dynamic-import chunks, like the Backoffice router.)
const ResetPassword = React.lazy(() => import("./components/auth/ResetPassword"));
const VerifyEmail = React.lazy(() => import("./components/auth/VerifyEmail"));
const POS = React.lazy(() => import("./pages/POS"));
const CreateInvoice = React.lazy(() => import("./pages/CreateInvoice"));
const InventoryPage = React.lazy(() => import("./pages/Inventory"));
const MedicalProductsPage = React.lazy(() => import("./pages/MedicalProducts"));
const NonMedicalProductsPage = React.lazy(() => import("./pages/NonMedicalProducts"));
const CategoriesPage = React.lazy(() => import("./pages/Categories"));
const ManufacturersPage = React.lazy(() => import("./pages/Manufacturers"));
const SuppliersPage = React.lazy(() => import("./pages/Suppliers"));
const ShelvesPage = React.lazy(() => import("./pages/Shelves"));
const CustomersPage = React.lazy(() => import("./pages/Customers"));
const PromotionsPage = React.lazy(() => import("./pages/Promotions"));
const TaxClassesPage = React.lazy(() => import("./pages/TaxClasses"));
const PrescriptionsPage = React.lazy(() => import("./pages/Prescriptions"));
const StorefrontPage = React.lazy(() => import("./pages/Storefront"));
const OnlineStorePage = React.lazy(() => import("./pages/OnlineStore"));
const PatientsPage = React.lazy(() => import("./pages/Patients"));
const DoctorsPage = React.lazy(() => import("./pages/Doctors"));
const AppointmentsPage = React.lazy(() => import("./pages/Appointments"));
const FrontDeskPage = React.lazy(() => import("./pages/FrontDesk"));
const RoomsPage = React.lazy(() => import("./pages/Rooms"));
const ReservationsPage = React.lazy(() => import("./pages/Reservations"));
const FoliosPage = React.lazy(() => import("./pages/Folios"));
const StockTakesPage = React.lazy(() => import("./pages/StockTakes"));
const ReportsPage = React.lazy(() => import("./pages/Reports"));
const AdvancedReportsPage = React.lazy(() => import("./pages/AdvancedReports"));
const ControlledRegisterPage = React.lazy(() => import("./pages/ControlledRegister"));
const AccountingPage = React.lazy(() => import("./pages/Accounting"));
const SettingsPage = React.lazy(() => import("./pages/Settings"));
const ExpenseManagement = React.lazy(() => import("./pages/ExpenseManagement"));
const ShiftManagement = React.lazy(() => import("./pages/ShiftManagement"));
const UserManagement = React.lazy(() => import("./components/admin/UserManagement"));
const ManagerUserManagement = React.lazy(() => import("./components/manager/ManagerUserManagement"));
const BranchManagement = React.lazy(() => import("./components/admin/BranchManagement"));
const BusinessManagement = React.lazy(() => import("./components/admin/BusinessManagement"));
const PartnerPortalPage = React.lazy(() => import("./pages/PartnerPortal"));
const AdminReports = React.lazy(() => import("./components/admin/AdminReports"));
const RoleManagement = React.lazy(() => import("./components/admin/RoleManagement"));
const RoleBasedDashboard = React.lazy(() => import("./components/dashboard/RoleBasedDashboard"));
const Refunds = React.lazy(() => import("./components/pos/Refunds"));
const Invoices = React.lazy(() => import("./components/pos/Invoices"));
const StaffCheckIn = React.lazy(() => import("./components/pos/EmployeeCheckIn"));
const PerformanceTracking = React.lazy(() => import("./components/pos/PerformanceTracking"));
const InventoryTransfers = React.lazy(() => import("./components/inventory/InventoryTransfers"));
const SubscriptionManagement = React.lazy(() => import("./components/admin/SubscriptionManagement"));
const OrderPurchase = React.lazy(() => import("./components/admin/OrderPurchase"));
const ZapeeraDashboard = React.lazy(() => import("./components/dashboard/ZapeeraDashboard"));
const Batches = React.lazy(() => import("./pages/Batches"));
const Purchases = React.lazy(() => import("./pages/Purchases"));
const ReorderSuggestionsPage = React.lazy(() => import("./pages/ReorderSuggestions"));
const PurchaseSuggestionsPage = React.lazy(() => import("./pages/PurchaseSuggestions"));
const AgingReportsPage = React.lazy(() => import("./pages/AgingReports"));
const DesktopLoginFlow = React.lazy(() => import("./components/desktop/DesktopLoginFlow").then(m => ({ default: m.DesktopLoginFlow })));
const InvitationsPage = React.lazy(() => import("./components/user-dashboard/InvitationsPage"));
const ProfileSecurityPage = React.lazy(() => import("./components/user-dashboard/ProfileSecurityPage"));
const BillingPage = React.lazy(() => import("./components/user-dashboard/BillingPage"));
const AffiliatePage = React.lazy(() => import("./pages/Affiliate"));
const BecomePartnerPage = React.lazy(() => import("./pages/BecomePartner"));
const NotificationsListPage = React.lazy(() => import("./components/user-dashboard/NotificationsListPage"));
const NotificationPreferencesPage = React.lazy(() => import("./components/user-dashboard/NotificationPreferencesPage"));
const SupportPage = React.lazy(() => import("./components/user-dashboard/SupportPage"));
const DownloadsPage = React.lazy(() => import("./components/user-dashboard/DownloadsPage"));
const EmployeePortal = React.lazy(() => import("./components/staff/EmployeePortal"));

// Build target: web, desktop, backoffice - replaced at compile time by Vite define
declare const __VITE_APP_TARGET__: string;
const APP_TARGET = typeof __VITE_APP_TARGET__ !== 'undefined' ? __VITE_APP_TARGET__ : 'web';
const IS_DESKTOP = APP_TARGET === 'desktop';
// Replaced at build time: null for desktop, React.lazy(...) for web
const BackofficeRouterLazy = __BACKOFFICE_MARKER__;

const RouteFallback = () => (
  <div className="flex min-h-[50vh] items-center justify-center">
    <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
  </div>
);

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

// Wrapper to pass required props to EmployeePortal
const EmployeePortalWrapper = () => {
  const { user } = useAuth();
  const { selectedCompany, selectedCompanyId, allCompanies } = useAdmin();
  const { businessSlug } = useParams();
  const isBusinessSlugRoute = Boolean(businessSlug?.trim());

  const slugCompany = useMemo(() => {
    if (!businessSlug) return null;
    return allCompanies.find((company: any) => company.slug === businessSlug) || null;
  }, [businessSlug, allCompanies]);

  const company = (isBusinessSlugRoute ? slugCompany : null) || selectedCompany || null;
  const businessId = company?.id || selectedCompanyId || '';

  const portal = (
    <EmployeePortal
      businessId={businessId}
      businessName={company?.name || 'My Business'}
      membershipId={(user as any)?.membership?.id || ''}
    />
  );

  if (isBusinessSlugRoute) {
    return (
      <MainLayout>
        {company?.id ? (
          portal
        ) : (
          <div className="flex items-center justify-center min-h-screen">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
            <p className="text-muted-foreground">Loading business context…</p>
          </div>
        )}
      </MainLayout>
    );
  }

  return portal;
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
      <React.Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={<LoginRoute />} />
        <Route path="/signup" element={<AuthContainer />} />
        {/* White-label partner join link (Feature 3): stores the slug
            and lands on the normal register, partner-branded. */}
        <Route path="/join/:slug" element={<JoinPartnerPage />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/verify-email" element={<VerifyEmail />} />
        {/* Public online pharmacy storefront (Wave C5 — gap item 5):
            no login — a customer opens /store/<branchId>. */}
        <Route path="/store/:branchId" element={<StorefrontPage />} />

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
        <Route path="/promotions" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <MainLayout>
                  <PromotionsPage />
                </MainLayout>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/tax-classes" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <MainLayout>
                  <TaxClassesPage />
                </MainLayout>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/prescriptions" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <MainLayout>
                  <PrescriptionsPage />
                </MainLayout>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        {/* Online Store — staff home for the public storefront
            (Wave C5 — gap item 5): store links, online-orders queue
            and the prescription review queue. Rides the prescriptions
            module (same guard as /prescriptions). */}
        <Route path="/online-store" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <MainLayout>
                  <OnlineStorePage />
                </MainLayout>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/patients" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <MainLayout>
                  <PatientsPage />
                </MainLayout>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/doctors" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <MainLayout>
                  <DoctorsPage />
                </MainLayout>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/appointments" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <MainLayout>
                  <AppointmentsPage />
                </MainLayout>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/front-desk" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <MainLayout>
                  <FrontDeskPage />
                </MainLayout>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/rooms" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <MainLayout>
                  <RoomsPage />
                </MainLayout>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/reservations" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <MainLayout>
                  <ReservationsPage />
                </MainLayout>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/folios" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <MainLayout>
                  <FoliosPage />
                </MainLayout>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/stock-takes" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <MainLayout>
                  <StockTakesPage />
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
        <Route path="/reorder-suggestions" element={
          <AuthStatus fallback={<Navigate to="/login" replace />}>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <RoleProtectedRoute allowedRoles={['ADMIN', 'MANAGER', 'OWNER']}>
                  <MainLayout>
                    <ReorderSuggestionsPage />
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
        <Route path="/controlled-register" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <RoleProtectedRoute allowedRoles={['MANAGER', 'ADMIN']}>
                  <MainLayout>
                    <ControlledRegisterPage />
                  </MainLayout>
                </RoleProtectedRoute>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/purchase-suggestions" element={
          <AuthStatus fallback={<Navigate to="/login" replace />}>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <RoleProtectedRoute allowedRoles={['ADMIN', 'MANAGER', 'OWNER']}>
                  <MainLayout>
                    <PurchaseSuggestionsPage />
                  </MainLayout>
                </RoleProtectedRoute>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/aging-reports" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <RoleProtectedRoute allowedRoles={['MANAGER', 'ADMIN']}>
                  <MainLayout>
                    <AgingReportsPage />
                  </MainLayout>
                </RoleProtectedRoute>
              </AutoModuleGuard>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/accounting" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <AutoModuleGuard>
                <RoleProtectedRoute allowedRoles={['MANAGER', 'ADMIN']}>
                  <MainLayout>
                    <AccountingPage />
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

        <Route path="/employee-portal" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <EmployeePortalWrapper />
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/employee-portal" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <EmployeePortalWrapper />
                </AutoModuleGuard>
              </BusinessSlugGate>
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

        {/* Affiliate program — account-level like billing, but WITHOUT the
            business guards: a pure affiliate may own no business at all,
            and the join flow must stay reachable. */}
        <Route path="/zapeera/affiliate" element={
          <AuthStatus>
            <ZapeeraLayout>
              <AffiliatePage />
            </ZapeeraLayout>
          </AuthStatus>
        } />

        <Route path="/affiliate" element={
          <AuthStatus>
            <ZapeeraLayout>
              <AffiliatePage />
            </ZapeeraLayout>
          </AuthStatus>
        } />

        {/* Become a Partner — white-label reseller application.
            Account-level like affiliate (no business guards): the
            applicant may own no business yet. */}
        <Route path="/zapeera/become-a-partner" element={
          <AuthStatus>
            <ZapeeraLayout>
              <BecomePartnerPage />
            </ZapeeraLayout>
          </AuthStatus>
        } />

        <Route path="/become-a-partner" element={
          <AuthStatus>
            <ZapeeraLayout>
              <BecomePartnerPage />
            </ZapeeraLayout>
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

        {/* Partner portal (Feature 3) — account-level like /zapeera;
            the page itself resolves partner-admin identity and shows
            a plain empty state for everyone else. */}
        <Route path="/partner" element={
          <AuthStatus fallback={<Navigate to="/login" replace />}>
            <ZapeeraLayout>
              <PartnerPortalPage />
            </ZapeeraLayout>
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

        <Route path="/business/:businessSlug/promotions" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <MainLayout>
                    <PromotionsPage />
                  </MainLayout>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/tax-classes" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <MainLayout>
                    <TaxClassesPage />
                  </MainLayout>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/prescriptions" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <MainLayout>
                    <PrescriptionsPage />
                  </MainLayout>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/patients" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <MainLayout>
                    <PatientsPage />
                  </MainLayout>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/doctors" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <MainLayout>
                    <DoctorsPage />
                  </MainLayout>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/appointments" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <MainLayout>
                    <AppointmentsPage />
                  </MainLayout>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/front-desk" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <MainLayout>
                    <FrontDeskPage />
                  </MainLayout>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/rooms" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <MainLayout>
                    <RoomsPage />
                  </MainLayout>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/reservations" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <MainLayout>
                    <ReservationsPage />
                  </MainLayout>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/folios" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <MainLayout>
                    <FoliosPage />
                  </MainLayout>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />

        <Route path="/business/:businessSlug/stock-takes" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <MainLayout>
                    <StockTakesPage />
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
        <Route path="/business/:businessSlug/controlled-register" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <RoleProtectedRoute allowedRoles={['MANAGER', 'ADMIN', 'OWNER']}>
                    <MainLayout>
                      <ControlledRegisterPage />
                    </MainLayout>
                  </RoleProtectedRoute>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/business/:businessSlug/reorder-suggestions" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <RoleProtectedRoute allowedRoles={['MANAGER', 'ADMIN', 'OWNER']}>
                    <MainLayout>
                      <ReorderSuggestionsPage />
                    </MainLayout>
                  </RoleProtectedRoute>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/business/:businessSlug/purchase-suggestions" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <RoleProtectedRoute allowedRoles={['MANAGER', 'ADMIN', 'OWNER']}>
                    <MainLayout>
                      <PurchaseSuggestionsPage />
                    </MainLayout>
                  </RoleProtectedRoute>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/business/:businessSlug/aging-reports" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <RoleProtectedRoute allowedRoles={['MANAGER', 'ADMIN', 'OWNER']}>
                    <MainLayout>
                      <AgingReportsPage />
                    </MainLayout>
                  </RoleProtectedRoute>
                </AutoModuleGuard>
              </BusinessSlugGate>
            </BusinessTypeGuard>
          </AuthStatus>
        } />
        <Route path="/business/:businessSlug/accounting" element={
          <AuthStatus>
            <BusinessTypeGuard>
              <BusinessSlugGate>
                <AutoModuleGuard>
                  <RoleProtectedRoute allowedRoles={['MANAGER', 'ADMIN', 'OWNER']}>
                    <MainLayout>
                      <AccountingPage />
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
      </React.Suspense>
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
          <BrandingProvider>
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
          </BrandingProvider>
        </AuthProvider>
      </RuntimeProvider>
    </QueryClientProvider>
  );
};

export default App;
