import { Routes, Route, Navigate } from 'react-router-dom';
import { BackofficeAuthProvider, useBackofficeAuth } from './auth/BackofficeAuthContext';
import { BackofficeLayout } from './layout/BackofficeLayout';
import { BackofficeLoginPage } from './pages/dashboard/BackofficeLogin';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { BusinessesPage } from './pages/tenant/businesses/BusinessesPage';
import { BusinessDetailPage } from './pages/tenant/businesses/BusinessDetailPage';
import { UsersPage } from './pages/tenant/users/UsersPage';
import { MembershipsPage } from './pages/tenant/memberships/MembershipsPage';
import { BusinessTypesPage } from './pages/platform/business-types/BusinessTypesPage';
import { ModulesPage } from './pages/platform/modules/ModulesPage';
import { PlansPage } from './pages/platform/plans/PlansPage';
import { RolesPage } from './pages/platform/roles/RolesPage';
import { FeatureFlagsPage } from './pages/platform/feature-flags/FeatureFlagsPage';
import { FinancePage } from './pages/finance/FinancePage';
import { PaymentProofsPage } from './pages/finance/PaymentProofsPage';
import { SupportPage } from './pages/support/SupportPage';
import { SupportTicketsPage } from './pages/support/SupportTicketsPage';
import { AnnouncementsPage } from './pages/support/AnnouncementsPage';
import { MonitoringPage } from './pages/monitoring/MonitoringPage';
import { AuditPage } from './pages/audit/AuditPage';
import { ContentPage } from './pages/content/ContentPage';
import { SettingsPage } from './pages/system/SettingsPage';
import { SystemPage } from './pages/system/SystemPage';
import { ProfilePage } from './pages/profile/ProfilePage';
import { NotFoundPage } from './pages/NotFoundPage';

function ProtectedBackofficeRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useBackofficeAuth();
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-4" />
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/backoffice/login" replace />;
  return <>{children}</>;
}

export function BackofficeRouter() {
  return (
    <BackofficeAuthProvider>
      <Routes>
        <Route path="login" element={<BackofficeLoginPage />} />
        <Route path="/" element={
          <ProtectedBackofficeRoute>
            <BackofficeLayout><DashboardPage /></BackofficeLayout>
          </ProtectedBackofficeRoute>
        } />
        <Route path="dashboard" element={
          <ProtectedBackofficeRoute>
            <BackofficeLayout><DashboardPage /></BackofficeLayout>
          </ProtectedBackofficeRoute>
        } />
        <Route path="businesses" element={
          <ProtectedBackofficeRoute>
            <BackofficeLayout><BusinessesPage /></BackofficeLayout>
          </ProtectedBackofficeRoute>
        } />
        <Route path="businesses/:id" element={
          <ProtectedBackofficeRoute>
            <BackofficeLayout><BusinessDetailPage /></BackofficeLayout>
          </ProtectedBackofficeRoute>
        } />
        <Route path="users" element={
          <ProtectedBackofficeRoute>
            <BackofficeLayout><UsersPage /></BackofficeLayout>
          </ProtectedBackofficeRoute>
        } />
        <Route path="memberships" element={
          <ProtectedBackofficeRoute>
            <BackofficeLayout><MembershipsPage /></BackofficeLayout>
          </ProtectedBackofficeRoute>
        } />
        <Route path="business-types" element={
          <ProtectedBackofficeRoute>
            <BackofficeLayout><BusinessTypesPage /></BackofficeLayout>
          </ProtectedBackofficeRoute>
        } />
        <Route path="modules" element={
          <ProtectedBackofficeRoute>
            <BackofficeLayout><ModulesPage /></BackofficeLayout>
          </ProtectedBackofficeRoute>
        } />
        <Route path="plans" element={
          <ProtectedBackofficeRoute>
            <BackofficeLayout><PlansPage /></BackofficeLayout>
          </ProtectedBackofficeRoute>
        } />
        <Route path="roles" element={
          <ProtectedBackofficeRoute>
            <BackofficeLayout><RolesPage /></BackofficeLayout>
          </ProtectedBackofficeRoute>
        } />
        <Route path="feature-flags" element={
          <ProtectedBackofficeRoute>
            <BackofficeLayout><FeatureFlagsPage /></BackofficeLayout>
          </ProtectedBackofficeRoute>
        } />
        <Route path="finance" element={
          <ProtectedBackofficeRoute>
            <BackofficeLayout><FinancePage /></BackofficeLayout>
          </ProtectedBackofficeRoute>
        } />
        <Route path="payment-proofs" element={
          <ProtectedBackofficeRoute>
            <BackofficeLayout><PaymentProofsPage /></BackofficeLayout>
          </ProtectedBackofficeRoute>
        } />
        <Route path="support" element={
          <ProtectedBackofficeRoute>
            <BackofficeLayout><SupportPage /></BackofficeLayout>
          </ProtectedBackofficeRoute>
        } />
        <Route path="support/tickets" element={
          <ProtectedBackofficeRoute>
            <BackofficeLayout><SupportTicketsPage /></BackofficeLayout>
          </ProtectedBackofficeRoute>
        } />
        <Route path="announcements" element={
          <ProtectedBackofficeRoute>
            <BackofficeLayout><AnnouncementsPage /></BackofficeLayout>
          </ProtectedBackofficeRoute>
        } />
        <Route path="monitoring" element={
          <ProtectedBackofficeRoute>
            <BackofficeLayout><MonitoringPage /></BackofficeLayout>
          </ProtectedBackofficeRoute>
        } />
        <Route path="audit" element={
          <ProtectedBackofficeRoute>
            <BackofficeLayout><AuditPage /></BackofficeLayout>
          </ProtectedBackofficeRoute>
        } />
        <Route path="content" element={
          <ProtectedBackofficeRoute>
            <BackofficeLayout><ContentPage /></BackofficeLayout>
          </ProtectedBackofficeRoute>
        } />
        <Route path="settings" element={
          <ProtectedBackofficeRoute>
            <BackofficeLayout><SettingsPage /></BackofficeLayout>
          </ProtectedBackofficeRoute>
        } />
        <Route path="system" element={
          <ProtectedBackofficeRoute>
            <BackofficeLayout><SystemPage /></BackofficeLayout>
          </ProtectedBackofficeRoute>
        } />
        <Route path="profile" element={
          <ProtectedBackofficeRoute>
            <BackofficeLayout><ProfilePage /></BackofficeLayout>
          </ProtectedBackofficeRoute>
        } />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </BackofficeAuthProvider>
  );
}
