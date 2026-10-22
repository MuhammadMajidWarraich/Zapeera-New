import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useAdmin } from "@/contexts/useAdmin";
import { useAuth } from "@/contexts/AuthContext";
import type { Company } from "@/contexts/admin-context";

/**
 * Resolves the workspace company exactly the way BusinessDashboard does:
 * the /business/:slug route wins, then the AdminContext selection, then
 * the signed-in user's own company. Shared by every typed dashboard so
 * they all agree on which business (and branch) is on screen.
 */
export function useWorkspaceCompany() {
  const location = useLocation();
  const { user } = useAuth();
  const {
    selectedCompanyId,
    selectedBranchId,
    allCompanies,
    allBranches,
    selectedCompany,
    selectedBranch,
  } = useAdmin();

  const businessSlugFromUrl = useMemo(() => {
    const match = location.pathname.match(/\/business\/([^/]+)/);
    return match ? match[1] : "";
  }, [location.pathname]);

  const companyByUrlSlug = useMemo(() => {
    if (!businessSlugFromUrl) return null;
    return allCompanies.find((c: Company) => c.slug === businessSlugFromUrl) || null;
  }, [businessSlugFromUrl, allCompanies]);

  const displayCompany: Company | null = companyByUrlSlug || selectedCompany || null;

  const effectiveCompanyId =
    companyByUrlSlug?.id ||
    selectedCompanyId ||
    (businessSlugFromUrl ? null : user?.companyId) ||
    null;

  const effectiveBranchId =
    selectedBranchId || (!selectedCompanyId && user?.branchId ? user.branchId : null);

  const businessType = String(displayCompany?.businessType || "").trim().toUpperCase();

  return {
    displayCompany,
    businessSlug: displayCompany?.slug || businessSlugFromUrl || null,
    effectiveCompanyId,
    effectiveBranchId,
    selectedBranch,
    allBranches,
    businessType,
  };
}
