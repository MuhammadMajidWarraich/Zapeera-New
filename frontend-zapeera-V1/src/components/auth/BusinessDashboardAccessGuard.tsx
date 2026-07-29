import { useEffect, useMemo, useState } from "react";
import { apiService } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { normalizeAppRole } from "@/utils/app-role";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription,
  DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { AlertCircle } from "lucide-react";

type DashboardAccessRole = "OWNER" | "USER" | "MANAGER" | "CASHIER";

const isRoleAllowed = (allowed: DashboardAccessRole[] | undefined, role: string | undefined) => {
  if (!role) return false;
  const normalized = role.toUpperCase() as DashboardAccessRole;
  return Array.isArray(allowed) && allowed.includes(normalized);
};

const BusinessDashboardAccessGuard = ({
  companyId,
  children,
}: {
  companyId: string;
  children: React.ReactNode;
}) => {
  const { user } = useAuth();
  const { selectedCompany, selectedCompanyId, allCompanies, isLoading } = useAdmin();
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState(false);
  const [message, setMessage] = useState<string>("Checking access...");
  const navigate = useNavigate();

  const resolvedCompany = useMemo(() => {
    if (selectedCompany && selectedCompany.id === companyId) return selectedCompany;
    if (selectedCompanyId === companyId && selectedCompany) return selectedCompany;
    return allCompanies?.find((c: any) => c?.id === companyId) || null;
  }, [allCompanies, companyId, selectedCompany, selectedCompanyId]);

  const isOwner = Boolean(user?.id && resolvedCompany?.createdBy && String(resolvedCompany.createdBy) === String(user.id));
  const role = normalizeAppRole(user?.role);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!user) {
        setLoading(false);
        setAllowed(false);
        setMessage("Authentication required.");
        return;
      }

      if (isOwner) {
        setLoading(false);
        setAllowed(true);
        return;
      }

      setLoading(true);
      setAllowed(false);
      setMessage("Checking access...");

      try {
        const response = await apiService.getBusinessEntitlements(companyId);
        const entitlement = response?.success ? (response.data as any) : null;

        // The API service returns { success, data: BusinessEntitlementSummary }.
        // Some legacy code paths can also pass a nested payload, so support both shapes.
        const entitlementSummary =
          entitlement && typeof entitlement === 'object' && 'isSubscribed' in entitlement
            ? entitlement
            : entitlement?.data && typeof entitlement.data === 'object' && 'isSubscribed' in entitlement.data
              ? entitlement.data
              : null;

        const plan = entitlementSummary?.plan || null;

        if (!plan) {
          if (cancelled) return;
          setAllowed(false);
          setMessage("A business subscription is required to access the business dashboard.");
          setLoading(false);
          return;
        }

        const hasValidSubscription = Boolean(entitlementSummary?.isSubscribed);
        const subscriptionStatus = String(entitlementSummary?.subscriptionStatus || '').toString().toLowerCase();

        if (!isOwner && !hasValidSubscription) {
          if (cancelled) return;
          setAllowed(false);
          setMessage(
            subscriptionStatus === 'grace'
              ? 'This business subscription is in grace period. Access is limited until the owner renews.'
              : subscriptionStatus === 'expired'
                ? 'This business subscription has expired. Access is restricted until the owner renews.'
                : 'A business subscription is required to access the business dashboard.'
          );
          setLoading(false);
          return;
        }

        // Trial plan allows all staff roles to access the dashboard.
        // The check will naturally fall through to the allowedRoles validation.

        const allowedRoles = plan.dashboardAccessRoles as DashboardAccessRole[] | undefined;
        const ok = isRoleAllowed(allowedRoles, role);

        if (cancelled) return;
        setAllowed(ok);
        setMessage(ok ? "" : "Your role is not allowed to access the business dashboard on this plan.");
        setLoading(false);
      } catch (e) {
        console.error("Business dashboard access check failed:", e);
        if (cancelled) return;
        setAllowed(false);
        setMessage("Failed to verify dashboard access.");
        setLoading(false);
      }
    };

    if (!companyId) {
      setLoading(false);
      setAllowed(true);
      return () => {
        cancelled = true;
      };
    }

    if (isLoading) return () => {
      cancelled = true;
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [companyId, isLoading, isOwner, role, user]);

  const businessRole = useMemo(() => {
    if (isOwner) return "OWNER";
    if (resolvedCompany && 'memberRole' in resolvedCompany && resolvedCompany.memberRole) {
      return String(resolvedCompany.memberRole).toUpperCase();
    }
    return role;
  }, [isOwner, resolvedCompany, role]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <h2 className="text-xl font-bold text-foreground mb-2">Loading...</h2>
          <p className="text-muted-foreground">Verifying dashboard access.</p>
        </div>
      </div>
    );
  }

  if (!allowed) {
    return (
      <>
        {/* 
          CRITICAL: Do NOT render children here when access is denied. 
          This prevents dashboard content from being visible or accessible in the DOM.
        */}
        <div className="flex-1 min-h-[60vh] flex items-center justify-center bg-slate-50/30 backdrop-blur-[2px]">
          {/* Empty state while dialog is showing */}
        </div>
        
        <Dialog open={true}>
          <DialogContent 
            className="max-w-[560px] rounded-[20px] border-0 shadow-2xl"
            onPointerDownOutside={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => e.preventDefault()}
          >
            <DialogHeader>
              <DialogTitle className="text-[#0a1128] flex items-center gap-3 text-2xl font-bold">
                <div className="p-2 rounded-full bg-red-50 text-red-500">
                  <AlertCircle className="w-6 h-6" />
                </div>
                Access Denied
              </DialogTitle>
              <DialogDescription className="text-[#4a5578] pt-4 text-lg leading-relaxed">
                {message}
              </DialogDescription>
            </DialogHeader>
            
            <div className="mt-6 mb-8 rounded-[12px] border border-[#1a52c5]/10 bg-[#1a52c5]/[0.04] px-5 py-4 text-sm text-[#1a52c5] flex items-center justify-between">
              <span className="opacity-70">Your role in this business:</span>
              <span className="font-bold tracking-wide">{businessRole}</span>
            </div>

            <DialogFooter className="sm:justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate('/zapeera/my-businesses')}
                className="h-12 rounded-[12px] border-[rgba(15,23,60,0.12)] px-8 font-semibold text-[#4a5578] hover:bg-[#f0f2f7] transition-colors"
              >
                Switch Business
              </Button>
              <Button
                type="button"
                onClick={() => navigate('/zapeera')}
                className="h-12 rounded-[12px] bg-gradient-to-r from-[#1a52c5] to-[#28c2ce] px-8 font-semibold text-white shadow-lg shadow-blue-500/20 hover:opacity-90 transition-opacity"
              >
                Go to Home
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return <>{children}</>;
};

export default BusinessDashboardAccessGuard;

