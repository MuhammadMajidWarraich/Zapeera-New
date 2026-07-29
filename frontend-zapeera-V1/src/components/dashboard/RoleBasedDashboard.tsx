import { useEffect, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { useMembershipRole } from "@/hooks/useMembershipRole";
import { normalizeAppRole } from "@/utils/app-role";
import { useParams } from "react-router-dom";
import MainLayout from "../layout/MainLayout";
import BusinessDashboard from "./BusinessDashboard";
import ZapeeraDashboard from "./ZapeeraDashboard";
import BusinessDashboardAccessGuard from "../auth/BusinessDashboardAccessGuard";

const RoleBasedDashboard = () => {
  const { user } = useAuth();
  const { selectedCompanyId, setSelectedCompanyId, allCompanies } = useAdmin();
  const membershipRole = useMembershipRole();
  const { businessSlug } = useParams();

  if (!user) {
    return <div>Loading...</div>;
  }

  // Prefer platform role when present, because platform-only users should land on the platform dashboard.
  const platformRole = user.platformRole ? normalizeAppRole(user.platformRole) : undefined;
  const userRole = platformRole || membershipRole || 'OWNER';

  const isBusinessSlugRoute = Boolean(businessSlug?.trim());

  const slugCompany = useMemo(() => {
    if (!businessSlug) return null;
    return allCompanies.find((company: any) => company.slug === businessSlug) || null;
  }, [businessSlug, allCompanies]);

  const resolvedCompanyId = selectedCompanyId || slugCompany?.id || (isBusinessSlugRoute ? null : user.companyId);

  // Ensure slug route selects the correct business in context when the company is already loaded.
  useEffect(() => {
    if (isBusinessSlugRoute && slugCompany?.id && selectedCompanyId !== slugCompany.id) {
      setSelectedCompanyId(slugCompany.id);
    }
  }, [isBusinessSlugRoute, selectedCompanyId, setSelectedCompanyId, slugCompany?.id]);

  if (isBusinessSlugRoute && !resolvedCompanyId) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading business context…</p>
        </div>
      </div>
    );
  }

  // Route based on user role
  switch (userRole) {
    case 'OWNER':
      if (isBusinessSlugRoute) {
        const companyId = resolvedCompanyId as string;
        return (
          <MainLayout>
            <BusinessDashboardAccessGuard companyId={companyId}>
              <BusinessDashboard />
            </BusinessDashboardAccessGuard>
          </MainLayout>
        );
      }
      // For business owners/admins: always land on the user-level dashboard after login.
      return <ZapeeraDashboard />;
    case 'MANAGER':
    case 'CASHIER':
      // Staff are always assigned to a specific branch/company
      // CRITICAL: Use user.companyId and user.branchId for staff access
      // They don't need to select a company - they're already assigned
      const staffCompanyId = selectedCompanyId || user.companyId;
      if (staffCompanyId) {
        return (
          <MainLayout>
            <BusinessDashboardAccessGuard companyId={staffCompanyId}>
              <BusinessDashboard />
            </BusinessDashboardAccessGuard>
          </MainLayout>
        );
      }
      // No company assigned - show error or default dashboard
      return <ZapeeraDashboard />;
    default:
      return (
        <MainLayout>
          <BusinessDashboard />
        </MainLayout>
      );
  }
};

export default RoleBasedDashboard;
