import { SidebarProvider } from "@/components/ui/sidebar";
import { RoleBasedSidebar } from "@/components/layout/RoleBasedSidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { LogOut, User, Building2, Plus, Building, ChevronDown, ArrowLeft, AlertTriangle, Menu } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { SidebarContext } from "@/components/layout/sidebar-context";
import { apiService } from "@/services/api";
import { withBusinessSlug } from "@/utils/business-routes";
import { useMembershipRole } from "@/hooks/useMembershipRole";
import { useBusinessModules } from "@/hooks/useBusinessModules";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import { SyncStatusBadge } from "@/components/SyncStatusIndicator";
import VoiceAssistant from "@/features/voice/VoiceAssistant";

interface MainLayoutProps {
  children: React.ReactNode;
}

const MainLayout = ({ children }: MainLayoutProps) => {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const { selectedBranch, selectedBranchId, selectedCompanyId, selectedCompany, setSelectedCompanyId, setSelectedBranchId, allCompanies, ownedCompanies, sharedCompanies, allBranches, refreshBranches } = useAdmin();
  // L-6 fix (2026-10-26): hide "+ New Sale" when the POS page is denied for
  // the selected business type (e.g. HOTEL) — it used to link to a page
  // that 403s. isSubModuleHidden returns false while the modules are
  // loading, so the button never flickers out for legitimate users.
  const { isSubModuleHidden } = useBusinessModules(selectedCompanyId);
  const membershipRole = useMembershipRole();

  // Backwards-compatible alias: some components expect `allBusinesses`
  const allBusinesses = allCompanies || [];
  const allCompaniesRef = useRef(allBusinesses);
  allCompaniesRef.current = allBusinesses;

  const effectiveRole = (membershipRole || (user?.role as any) || '').toString().toUpperCase();
  const canShowContextSwitchers = Boolean(user) && ['OWNER', 'MANAGER', 'CASHIER'].includes(effectiveRole);

  const [isLoading, setIsLoading] = useState(false);
  const [isSharedBusinessLocked, setIsSharedBusinessLocked] = useState(false);
  const [subscriptionGate, setSubscriptionGate] = useState<
    'unknown' | 'active' | 'grace' | 'inactive_owned' | 'inactive_shared'
  >('unknown');

  // Get businessSlug from URL pathname (e.g., /business/my-business/dashboard)
  const navigate = useNavigate();
  const location = useLocation();

  const urlBusinessSlug = useMemo(() => {
    const match = location.pathname.match(/\/business\/([^\/]+)/);
    return match ? match[1] : '';
  }, [location.pathname]);

  const companyFromUrl = useMemo(() => {
    if (!urlBusinessSlug || !allCompanies) return null;
    return allCompanies.find((company: any) => String(company.slug || '').toLowerCase() === String(urlBusinessSlug).toLowerCase()) || null;
  }, [urlBusinessSlug, allCompanies]);

  const effectiveCompanyId = companyFromUrl?.id || selectedCompanyId || null;

  const businessSlug = useMemo(() => {
    // Priority: URL slug > context slug
    if (urlBusinessSlug) return urlBusinessSlug;
    const c =
      selectedCompany || allCompanies.find((x) => x.id === selectedCompanyId);
    return String((c as { slug?: string | null })?.slug || "").trim();
  }, [selectedCompany, allCompanies, selectedCompanyId, urlBusinessSlug]);

  const [currentDateTime, setCurrentDateTime] = useState(new Date());
  const hasTriggeredBranchRefresh = useRef<string | false>(false); // Prevent infinite refresh calls

  // CRITICAL FIX: Reload branches when company changes to ensure dropdown is populated
  // IMPORTANT: Only refresh once per company change to prevent infinite loops
  useEffect(() => {
    if (selectedCompanyId && user?.role === 'OWNER') {
      // Only refresh if we haven't already triggered for this company
      if (!hasTriggeredBranchRefresh.current || hasTriggeredBranchRefresh.current !== selectedCompanyId) {
        hasTriggeredBranchRefresh.current = selectedCompanyId;
        // Use setTimeout to prevent immediate re-trigger
        const timeoutId = setTimeout(() => {
          refreshBranches();
        }, 500); // Increased delay to prevent rapid calls
        return () => clearTimeout(timeoutId);
      }
    } else {
      // Reset when company is cleared
      hasTriggeredBranchRefresh.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompanyId]);
  
  // Branch caching disabled - branches will load fresh from AdminContext
  useEffect(() => {
    if (user?.role === 'OWNER' && allBranches.length === 0) {
      const timeoutId = setTimeout(() => {
        refreshBranches();
      }, 500);
      return () => clearTimeout(timeoutId);
    }
  }, []);

  // Desktop sync/connectivity is now tracked via SyncProvider + RuntimeContext

  useEffect(() => {
    let isMounted = true;

    const enforceSubscriptionAccess = async () => {
      if (!effectiveCompanyId) return;

      try {
        const entitlement = await apiService.getBusinessEntitlements(effectiveCompanyId);
        if (!isMounted || !entitlement.success) return;

        const entitlementSummary = entitlement.data && typeof entitlement.data === 'object' && 'isSubscribed' in entitlement.data
          ? entitlement.data as any
          : entitlement.data as any;

        if (entitlementSummary?.isSubscribed) {
          const status = (entitlementSummary.subscriptionStatus || '').toString().toUpperCase();
          if (status === 'GRACE') {
            setSubscriptionGate('grace');
          } else {
            setSubscriptionGate('active');
          }
          return;
        }

        // Subscription inactive
        const company = allCompaniesRef.current.find(c => c.id === effectiveCompanyId);
        const isShared = company && company.createdBy !== user?.id && company.createdBy !== null;
        if (isShared) {
          setSubscriptionGate('inactive_shared');
          const subject = entitlement.data?.subscriptionStatus?.toString().toLowerCase();
          let description = "The business owner's subscription has expired. Access to this business is restricted until they upgrade.";
          if (subject === 'grace') {
            description = "The business owner's subscription is in grace period. Access is limited until they renew.";
          } else if (subject === 'pending' || subject?.includes('pending')) {
            description = "The business owner's subscription is pending approval. Access is limited until approval completes.";
          }
          navigate('/zapeera/my-businesses');
          toast({
            title: subject === 'grace' ? "Subscription Grace Period" : "Subscription Expired",
            description,
            variant: "destructive",
          });
          return;
        }

        setSubscriptionGate('inactive_owned');

        // Owned business: hard-gate everything except the business subscription page.
        // Render subscription under the business slug so renewal happens in the correct context.
        const targetPath = businessSlug
          ? `/business/${encodeURIComponent(businessSlug)}/subscription`
          : '/zapeera/my-businesses';

        if (location.pathname !== targetPath) {
          navigate(targetPath, { replace: true });
        }
      } catch (error) {
        console.error('Subscription access check failed in MainLayout:', error);
      }
    };

    void enforceSubscriptionAccess();

    return () => {
      isMounted = false;
    };
  }, [user?.role, user?.id, effectiveCompanyId, businessSlug, navigate, toast]);

  useEffect(() => {
    if (subscriptionGate !== 'inactive_owned') return;

    const targetPath = businessSlug
      ? `/business/${encodeURIComponent(businessSlug)}/subscription`
      : '/zapeera/my-businesses';

    if (location.pathname !== targetPath) {
      navigate(targetPath, { replace: true });
    }
  }, [subscriptionGate, businessSlug, location.pathname, navigate]);

  const isOnBusinessSubscriptionPage = useMemo(() => {
    if (!businessSlug) return false;
    const expected = `/business/${encodeURIComponent(businessSlug)}/subscription`;
    return location.pathname === expected;
  }, [businessSlug, location.pathname]);

  const handleCompanySwitch = async (companyId: string) => {
    const targetCompany = allCompanies.find((c: any) => String(c.id) === String(companyId));
    if (!targetCompany) return;

    // Set the selected company FIRST
    setSelectedCompanyId(companyId);

    // Start loading animation
    setIsLoading(true);

    // Navigate to the same business-scoped route under the new slug (or to dashboard).
    try {
      const target = allCompanies.find((c: any) => String(c.id) === String(companyId));
      const slug = String(target?.slug || '').trim();
      if (slug) {
        const parts = (location.pathname || '').split('/').filter(Boolean);
        let nextPath = withBusinessSlug(slug, '/');
        if (parts[0] === 'business' && parts[1]) {
          const rest = parts.slice(2);
          nextPath = `/business/${encodeURIComponent(slug)}/${rest.length ? rest.join('/') : 'dashboard'}`;
        }
        if (nextPath && nextPath !== location.pathname) {
          navigate(nextPath, { replace: true });
        }
      }
    } catch {
      // ignore
    }

    // CRITICAL FIX: Instead of reloading page (which causes logout), trigger custom event
    // All components listen to this event and refresh their data
    // This preserves user session and doesn't cause logout
    setTimeout(() => {
      // Trigger custom event for all components to listen and refresh
      window.dispatchEvent(new CustomEvent('branchOrCompanyChanged', {
        detail: { type: 'company', companyId }
      }));

      // Also trigger a more specific event for company change
      window.dispatchEvent(new CustomEvent('companyChanged', {
        detail: { companyId }
      }));

      // Stop loading after a short delay (allows animation to show)
      setTimeout(() => {
        setIsLoading(false);
      }, 800);
    }, 100);
  };

  const handleBranchSwitch = (branchId: string) => {

    // CRITICAL: Prevent duplicate calls
    if (branchId === 'all' && selectedBranchId === null) {
      return;
    }
    if (branchId !== 'all' && selectedBranchId === branchId) {
      return;
    }

    // Start loading animation
    setIsLoading(true);

    if (branchId === 'all') {
      setSelectedBranchId(null);
    } else {
      setSelectedBranchId(branchId);
    }

    // CRITICAL FIX: Instead of reloading page (which causes logout), trigger custom event
    // All components listen to this event and refresh their data
    // This preserves user session and doesn't cause logout
    // IMPORTANT: Use setTimeout to prevent immediate re-trigger
    setTimeout(() => {
      // Trigger custom event for all components to listen and refresh
      window.dispatchEvent(new CustomEvent('branchOrCompanyChanged', {
        detail: { type: 'branch', branchId }
      }));

      // Also trigger a more specific event for branch change
      window.dispatchEvent(new CustomEvent('branchChanged', {
        detail: { branchId }
      }));

      // Stop loading after a short delay (allows animation to show)
      setTimeout(() => {
        setIsLoading(false);
      }, 800);
    }, 100);
  };
  const [isCollapsed, setIsCollapsed] = useState(() => {
    // Initialize from localStorage if available
    const saved = localStorage.getItem('sidebar-collapsed');
    return saved ? JSON.parse(saved) : false;
  });

  // Mobile (<lg) sidebar drawer state — sidebar is off-canvas on small screens
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile drawer whenever the route changes
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Save sidebar state to localStorage when it changes
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', JSON.stringify(isCollapsed));
  }, [isCollapsed]);

  if (subscriptionGate === 'inactive_owned') {
    // While redirecting, avoid flashing the rest of the dashboard UI.
    if (!isOnBusinessSubscriptionPage) {
      return null;
    }

    // Subscription page should be accessible even when expired, but the rest of the
    // business dashboard chrome should be hidden.
    return <div className="safe-bars min-h-screen w-full bg-[#f0f2f7] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">{children}</div>;
  }

  // Context switchers (2026-10-26): the SAME two dropdowns render in
  // the desktop header AND in the mobile context bar below — one
  // definition, two placements. Below md the header had no room for
  // them, so they used to be `hidden … md:inline-flex`, which left
  // pages like Purchase Orders stuck on "Choose a branch in the
  // header" with no way to choose. The trigger is always inline-flex;
  // the wrappers below carry the breakpoint visibility.
  const branchSwitcher = (
    <>
{/* Branch Selection Dropdown for Admins */}
{/* CRITICAL FIX: Show dropdown when company is selected, even if branches haven't loaded yet */}
{canShowContextSwitchers && selectedCompanyId && (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        className="inline-flex max-w-[128px] items-center gap-2 rounded-[10px] border border-border bg-card px-3 py-2 text-[13px] font-semibold text-muted-foreground shadow-sm transition-colors hover:border-border hover:text-foreground md:max-w-[160px] md:px-4"
      >
        <Building2 className="sel-icon h-4 w-4 shrink-0 text-muted-foreground opacity-60" />
        <span className="max-w-[160px] truncate">
        {(() => {
          // CRITICAL FIX: Get branch name from allBranches or cache IMMEDIATELY
          // This prevents "Loading..." from showing on refresh
          if (selectedBranchId) {
            // Try to find branch in allBranches first
            const branch = allBranches?.find((b: any) => b.id === selectedBranchId);
            if (branch) {
              return branch.name;
            }
            
            // If not found in allBranches, try cache IMMEDIATELY (for refresh scenario)
            try {
              const currentUserData = JSON.parse(localStorage.getItem('zapeera_user') || '{}');
              const cacheKey = `cached_branches_${currentUserData.id || 'default'}_${selectedCompanyId || 'all'}`;
              const cachedData = localStorage.getItem(cacheKey);
              if (cachedData) {
                const parsed = JSON.parse(cachedData);
                const cachedBranch = parsed.branches?.find((b: any) => b.id === selectedBranchId);
                if (cachedBranch) {
                  return cachedBranch.name;
                }
              }
            } catch (e) {
              // Ignore cache read errors
            }
            
            // Last resort: try to get from saved branch selection
            try {
              const currentUserData = JSON.parse(localStorage.getItem('zapeera_user') || '{}');
              const savedBranchId = localStorage.getItem(`selected_branch_${currentUserData.id}`);
              if (savedBranchId === selectedBranchId) {
                // Branch ID matches saved selection, but name not found
                // Return a generic name instead of "Loading..."
                return 'Branch';
              }
            } catch (e) {
              // Ignore
            }
            
            // Only show "Loading..." if we truly don't have the branch name
            return 'Loading...';
          }
          return 'All branches';
        })()}
        </span>
        <ChevronDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-48 rounded-2xl border border-black/5">
      {(() => {
        // CRITICAL FIX: Get branches from allBranches OR cache if not loaded yet
        let branchesToUse = allBranches || [];
        
        // If branches not loaded yet, try to get from cache IMMEDIATELY
        if (!branchesToUse || branchesToUse.length === 0) {
          try {
            const currentUserData = JSON.parse(localStorage.getItem('zapeera_user') || '{}');
            const cacheKey = `cached_branches_${currentUserData.id || 'default'}_${selectedCompanyId || 'all'}`;
            const cachedData = localStorage.getItem(cacheKey);
            if (cachedData) {
              const parsed = JSON.parse(cachedData);
              if (parsed.branches && parsed.branches.length > 0) {
                branchesToUse = parsed.branches;
              }
            }
          } catch (e) {
            // Ignore cache read errors
          }
        }
        
        // CRITICAL FIX: Filter branches based on user's allowed branch IDs
        // This ensures managers/cashiers only see branches shared with them
  const effectiveRole = (membershipRole || user?.role || '').toString().toUpperCase();
        let allowedBranchIds: string[] = [];
        
        if (effectiveRole !== 'OWNER' && effectiveRole !== 'ADMIN' && effectiveRole !== 'USER') {
          allowedBranchIds = Array.isArray(user?.membership?.branchIds)
            ? user.membership.branchIds.map((id: any) => String(id))
            : (user?.branchId ? [String(user.branchId)] : []);
          
          if (allowedBranchIds.length > 0) {
            branchesToUse = branchesToUse.filter((branch: any) => allowedBranchIds.includes(String(branch.id)));
          }
        }
        
        // CRITICAL FIX: Handle both branch.companyId and branch.company?.id
        // If no company selected, show all branches
        let filteredBranches = branchesToUse;
        if (selectedCompanyId) {
          filteredBranches = branchesToUse.filter((branch: any) => {
            const branchCompanyId = branch.companyId || branch.company?.id;
            const matches = branchCompanyId === selectedCompanyId;
            return matches;
          });
        }

        // Show "All branches" only if there are multiple branches
        const showAllBranchesOption = filteredBranches.length > 1;

        return (
          <>
            {showAllBranchesOption && (
              <DropdownMenuItem
                onClick={() => handleBranchSwitch('all')}
                className="cursor-pointer"
              >
                <Building2 className="w-4 h-4 mr-2 text-amber-600" />
                <span>All branches</span>
              </DropdownMenuItem>
            )}
            {filteredBranches.length > 0 ? (
              filteredBranches.map((branch: any) => (
                <DropdownMenuItem
                  key={branch.id}
                  onClick={() => handleBranchSwitch(branch.id)}
                  className="cursor-pointer"
                >
                  <Building2 className="w-4 h-4 mr-2 text-amber-600" />
                  <span>{branch.name}</span>
                </DropdownMenuItem>
              ))
            ) : branchesToUse && branchesToUse.length > 0 ? (
              // Branches loaded but none match the selected company
              <DropdownMenuItem disabled className="text-gray-400">
                <span>No branches found for this business</span>
              </DropdownMenuItem>
            ) : (
              // Branches not loaded yet - show message
              <DropdownMenuItem disabled className="text-gray-400">
                <span>Loading branches...</span>
              </DropdownMenuItem>
            )}
          </>
        );
      })()}
    </DropdownMenuContent>
  </DropdownMenu>
)}
    </>
  );
  const businessSwitcher = (
    <>
{/* Switch Business Button for Admins */}
{canShowContextSwitchers && allCompanies && allCompanies.length > 0 && (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button
        type="button"
        className="inline-flex max-w-[140px] items-center gap-2 rounded-[10px] border border-border bg-card px-3 py-2 text-[13px] font-semibold text-muted-foreground shadow-sm transition-colors hover:text-foreground md:max-w-[220px] md:px-4"
      >
        <Building className="sel-icon h-4 w-4 shrink-0 opacity-60" />
        <span className="truncate">
          {selectedCompanyId
            ? allCompanies.find((c: any) => c.id === selectedCompanyId)?.name || 'Business'
            : 'Business'}
        </span>
        <ChevronDown className="ml-1 h-4 w-4 shrink-0 opacity-50" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-56 rounded-2xl border border-black/5">
      {ownedCompanies.length > 0 && (
        <>
          <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground">My Businesses</DropdownMenuLabel>
          {ownedCompanies
            .map((company: any) => (
            <DropdownMenuItem
              key={company.id}
              onClick={() => handleCompanySwitch(company.id)}
              className="cursor-pointer"
            >
              <Building className="w-4 h-4 mr-2 text-blue-600" />
              <span className="truncate">{company.name}</span>
            </DropdownMenuItem>
          ))}
        </>
      )}

      {sharedCompanies.length > 0 && (
        <>
          {ownedCompanies.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground">Shared Businesses</DropdownMenuLabel>
          {sharedCompanies
            .map((company: any) => (
            <DropdownMenuItem
              key={company.id}
              onClick={() => handleCompanySwitch(company.id)}
              className="cursor-pointer"
            >
              <Building className="w-4 h-4 mr-2 text-blue-600" />
              <span className="flex min-w-0 flex-1 items-center justify-between gap-2">
                <span className="truncate">{company.name}</span>
                {company.memberRole && (
                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {String(company.memberRole)}
                  </span>
                )}
              </span>
            </DropdownMenuItem>
          ))}
        </>
      )}

      {(!ownedCompanies?.length && !sharedCompanies?.length) &&
        allCompanies.map((company: any) => (
          <DropdownMenuItem
            key={company.id}
            onClick={() => handleCompanySwitch(company.id)}
            className="cursor-pointer"
          >
            <Building className="w-4 h-4 mr-2 text-blue-600" />
            <span className="truncate">{company.name}</span>
          </DropdownMenuItem>
        ))}
    </DropdownMenuContent>
  </DropdownMenu>
)}
    </>
  );

  return (
    <SidebarProvider>
      <SidebarContext.Provider value={{ isCollapsed, setIsCollapsed, mobileOpen, setMobileOpen }}>
        <div className="safe-bars flex h-screen w-full overflow-hidden bg-[#f0f2f7] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
          <RoleBasedSidebar />

          {/* Mobile drawer backdrop */}
          {mobileOpen && (
            <div
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
              onClick={() => setMobileOpen(false)}
              aria-hidden
            />
          )}

          <div
            className={cn(
              'flex h-full min-w-0 flex-1 flex-col transition-all duration-300',
              // Sidebar is off-canvas below lg, so no margin there.
              isCollapsed ? 'lg:ml-[72px]' : 'lg:ml-[272px]',
            )}
          >
            <header className="sticky top-0 z-10 flex h-[72px] shrink-0 items-center justify-between border-b border-black/[0.04] bg-white/70 px-4 backdrop-blur-xl backdrop-saturate-150 sm:px-6 lg:px-11">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setMobileOpen(true)}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-black/[0.06] bg-white text-[#4a5578] lg:hidden"
                  aria-label="Open menu"
                >
                  <Menu className="h-5 w-5" />
                </button>
                {!isSubModuleHidden('sales', 'pos') && (
                <button
                  type="button"
                  onClick={() => navigate(withBusinessSlug(businessSlug || null, "/point-of-sale"))}
                  className="inline-flex items-center gap-1.5 rounded-[10px] bg-primary px-5 py-2 text-[13px] font-semibold text-primary-foreground shadow-soft transition-all hover:-translate-y-px hover:bg-primary/90 hover:shadow-medium"
                >
                  <Plus className="h-4 w-4 stroke-[2.5]" strokeLinecap="round" />
                  New Sale
                </button>
                )}

                <SyncStatusBadge />
              </div>
              <div className="flex items-center gap-2.5">

                {/* Branch + business switchers — desktop slot (hidden below md; the mobile bar below renders the same elements). */}
                <div className="hidden md:block">{branchSwitcher}</div>
                <div className="hidden md:block">{businessSwitcher}</div>

                {membershipRole && (
                  <div className="hidden flex-col items-end sm:flex">
                    <span className="rounded-full bg-[#1a52c5]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#1a52c5]">
                      {membershipRole}
                    </span>
                  </div>
                )}

                {/* Profile Icon Dropdown - Visible to all users */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="grid h-[38px] w-[38px] shrink-0 place-items-center overflow-hidden rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-sm font-bold text-white shadow-[0_2px_10px_rgba(26,82,197,0.25)] outline-none ring-offset-2 transition-opacity hover:opacity-95 focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {user?.profileImage ? (
                        <img src={user.profileImage} alt="" className="h-full w-full object-cover" />
                      ) : (
                        (user?.name || user?.email || 'U').charAt(0).toUpperCase()
                      )}
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56 rounded-2xl border border-black/5">
                    <DropdownMenuLabel className="font-normal">
                      <div className="flex flex-col space-y-1">
                        <p className="text-sm font-medium leading-none">{user?.name || 'User'}</p>
                        <p className="text-xs leading-none text-muted-foreground">{user?.email || 'No email'}</p>
                        {membershipRole && (
                          <div className="mt-1.5 inline-flex w-fit items-center rounded-full bg-[#1a52c5]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#1a52c5]">
                            {membershipRole}
                          </div>
                        )}
                      </div>
                    </DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => navigate('/settings')} className="cursor-pointer">
                      <User className="w-4 h-4 mr-2" />
                      Edit Profile
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => navigate('/zapeera')} className="cursor-pointer">
                      <ArrowLeft className="w-4 h-4 mr-2" />
                      Back to Dashboard
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={logout} className="cursor-pointer text-red-600 focus:text-red-600">
                      <LogOut className="w-4 h-4 mr-2" />
                      Logout
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </header>
            {/* Mobile context bar (2026-10-26): business + branch
                switchers on phones. The empty states (e.g. Purchase
                Orders: "Choose a branch in the header") point at the
                header, so the switchers live here — a second header
                row — not hidden in the hamburger drawer. md+ hides
                this row; the desktop header above is unchanged. */}
            {canShowContextSwitchers && (
              <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-black/[0.04] bg-white/70 px-4 py-2 backdrop-blur-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:hidden">
                {branchSwitcher}
                {businessSwitcher}
              </div>
            )}

            {subscriptionGate === 'grace' && (
              <div className="flex items-center gap-2.5 bg-amber-50 border-b border-amber-200 px-5 py-2.5 text-sm text-amber-800">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                <span className="flex-1">
                  <strong>Grace Period</strong> — Your subscription has expired but you have temporary access. Please renew to avoid service interruption.
                </span>
                <button
                  onClick={() => navigate(withBusinessSlug(businessSlug || null, '/subscription'))}
                  className="shrink-0 rounded-lg bg-amber-600 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-700 transition-colors"
                >
                  Renew Now
                </button>
              </div>
            )}

            <main className="relative flex-1 overflow-y-auto bg-[#f0f2f7]">
              {/* Loading Animation - Starts from branch selector and flows down */}
              {isLoading && (
                <div className="absolute inset-0 z-50 pointer-events-none">
                  {/* Animated loading bar that flows from top to bottom */}
                  <div 
                    className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-80"
                    style={{
                      animation: 'loadingFlow 0.8s ease-in-out',
                      boxShadow: '0 0 10px rgba(59, 130, 246, 0.5)'
                    }}
                  />
                  {/* Subtle left-right shimmer effect */}
                  <div 
                    className="absolute top-0 left-0 right-0 bottom-0 bg-gradient-to-r from-transparent via-blue-50/30 to-transparent opacity-50"
                    style={{
                      animation: 'shimmer 1.2s ease-in-out infinite',
                      transform: 'translateX(-100%)'
                    }}
                  />
                </div>
              )}
              <div className={isLoading ? 'opacity-95 transition-opacity duration-300' : 'opacity-100 transition-opacity duration-300'}>
                <ErrorBoundary>
                  {children}
                </ErrorBoundary>
              </div>
            </main>
          </div>
        </div>
        <VoiceAssistant />
      </SidebarContext.Provider>
    </SidebarProvider>
  );
};

export default MainLayout;
