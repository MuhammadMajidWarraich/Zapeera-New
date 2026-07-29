import { createContext, useContext, useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { apiService } from '@/services/api';
import { useAuth } from './AuthContext';
import { AdminContext, type AdminContextType, type Branch, type Company } from './admin-context';
import { normalizeAppRole, type AppUserRole } from '@/utils/app-role';
import { readStoredUser } from '@/lib/session-storage';

const getSavedSelection = (savedUserString: string): { companyId: string | null; branchId: string | null } => {
  // Caching disabled - always return null to force fresh selection
  return { companyId: null, branchId: null };
};

interface AdminProviderProps {
  children: ReactNode;
}

export const AdminProvider: React.FC<AdminProviderProps> = ({ children }) => {
  // Guard against calling useAuth outside of provider
  let authContext;
  try {
    authContext = useAuth();
  } catch (error) {
    // If useAuth fails, return children without context functionality
    console.warn('AdminProvider: useAuth failed, rendering without context');
    return <>{children}</>;
  }

  const { isAuthenticated, user } = authContext;
  const initialSelection = getSavedSelection(JSON.stringify(user));
  const [selectedBusinessId, setSelectedBusinessId] = useState<string | null>(initialSelection.companyId);
  const [selectedBranchId, setSelectedBranchId] = useState<string | null>(initialSelection.branchId);
  const [allBusinesses, setAllBusinesses] = useState<Company[]>([]);
  const [ownedCompanies, setOwnedCompanies] = useState<Company[]>([]);
  const [sharedCompanies, setSharedCompanies] = useState<Company[]>([]);
  const [allBranches, setAllBranches] = useState<Branch[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasInitialized, setHasInitialized] = useState(false); // Track if initial setup is done
  
  // CRITICAL: Use refs to prevent duplicate API calls
  const isLoadingCompaniesRef = useRef(false);
  const isLoadingBranchesRef = useRef(false);


  const selectedCompany = selectedBusinessId
    ? allBusinesses.find(company => company.id === selectedBusinessId) || null
    : null;

  const selectedBranch = selectedBranchId
    ? allBranches.find(branch => branch.id === selectedBranchId) || null
    : null;

  const effectiveCompanyId = selectedBusinessId || (user?.companyId ? String(user.companyId) : null);
  const effectiveBranchId = selectedBranchId || (user?.membership?.branchIds?.[0] || user?.branchId ? String(user?.membership?.branchIds?.[0] || user?.branchId) : null);

  // Helper function to get user's role in the selected business context
  const getMembershipRole = useCallback((): string | null => {
    if (!user || !user.membership) return null;
    if (selectedBusinessId && user.membership.businessId !== selectedBusinessId) return null;
    return user.membership.roleName?.toUpperCase() || null;
  }, [user, selectedBusinessId]);

  const accessibleCompanyIds = useMemo(() => {
    const ids = new Set<string>();
    if (user?.companyId) {
      ids.add(String(user.companyId));
    }
    if (Array.isArray(user?.memberships)) {
      user.memberships.forEach((membership: any) => {
        if (membership?.businessId) {
          ids.add(String(membership.businessId));
        }
      });
    }
    return ids;
  }, [user]);

  const canAccessCompany = useCallback(
    (companyId: string | null) => {
      if (!companyId) return false;
      if (accessibleCompanyIds.has(companyId)) return true;
      const rec = allBusinesses.find((c) => String(c.id) === String(companyId));
      if (rec && user?.id && String(rec.createdBy || '') === String(user.id)) {
        return true;
      }
      return false;
    },
    [accessibleCompanyIds, allBusinesses, user?.id]
  );

  // Sync AuthContext membership when restoring selection from localStorage (or when company changes externally).
  useEffect(() => {
    if (!isAuthenticated || !user) return;

    const currentBusinessId = user.membership?.businessId ? String(user.membership.businessId) : null;
    const selectedId = selectedBusinessId ? String(selectedBusinessId) : null;

    if (!selectedId && !currentBusinessId) return;
    if (selectedId && currentBusinessId === selectedId) return;

    // If the companies list has not loaded yet, defer syncing membership
    // to AuthContext. This avoids attempting to activate a membership when
    // we don't yet know company ownership or memberRole.
    if (allBusinesses.length === 0) {
      return;
    }

    if (selectedId && !canAccessCompany(selectedId)) {
      console.warn('🏢 [AdminContext] Restored selected company is not accessible, clearing it:', selectedId);
      setSelectedBusinessId(null);
      return;
    }

    try {
      const rec = selectedId ? allBusinesses.find((c) => String(c.id) === String(selectedId)) : null;
      let fallbackRole: AppUserRole | null = null;
      if (selectedId && rec) {
        if (String(rec.createdBy || '') === String(user.id)) {
          fallbackRole = 'OWNER';
        } else if (rec.memberRole) {
          fallbackRole = normalizeAppRole(String(rec.memberRole)) as AppUserRole;
        }
      }
      authContext.setActiveMembershipForBusiness(selectedId, fallbackRole);
    } catch {
      // ignore
    }
  }, [isAuthenticated, user, selectedBusinessId, allBusinesses, authContext]);

  const refreshCompanies = useCallback(async () => {
    if (!isAuthenticated) {
      return;
    }

    // CRITICAL: Prevent duplicate calls - check if already loading
    if (isLoading) {
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      // Skip regular API calls if in backoffice (uses different auth system)
      if (localStorage.getItem('backofficeToken') || window.location.pathname.startsWith('/backoffice')) {
        setAllBusinesses([]);
        setOwnedCompanies([]);
        setSharedCompanies([]);
        setAllBranches([]);
        setIsLoading(false);
        return;
      }

      const membershipRole = getMembershipRole();
      const effectiveRole = membershipRole || String(user?.role || '').toUpperCase();
      const role = String(effectiveRole || '').toUpperCase();
      let loadedCompanies: any[] = [];
      
      const response = await apiService.getMyCompanies();
      if (response.success && response.data) {
        const owned = (response.data.owned || []).map((c: any) => ({ ...c, accessType: 'owned' as const }));
        const shared = (response.data.shared || []).map((c: any) => ({ ...c, accessType: 'shared' as const }));
        loadedCompanies = [...owned, ...shared] as any;
        setOwnedCompanies(owned as any);
        setSharedCompanies(shared as any);
        setAllBusinesses(loadedCompanies);
      } else {
        const fallback = await apiService.getCompanies();
        if (fallback.success && fallback.data) {
          loadedCompanies = fallback.data || [];
          try {
            const owned = loadedCompanies.filter((c: any) => String(c?.createdBy || '') === String(user?.id || ''));
            const shared = loadedCompanies.filter((c: any) => String(c?.createdBy || '') !== String(user?.id || ''));
            setOwnedCompanies(owned as any);
            setSharedCompanies(shared as any);
          } catch {
            setOwnedCompanies([]);
            setSharedCompanies([]);
          }
          setAllBusinesses(loadedCompanies);
        } else {
          setError('Failed to load companies');
        }
      }

      // CRITICAL FIX: Auto-select first company if none is selected and user has access to companies
      // Auto-select first company if user has exactly one
      if (loadedCompanies.length === 1 && !selectedBusinessId) {
        const onlyCompanyId = loadedCompanies[0].id;
        setSelectedBusinessId(onlyCompanyId);
        
        // Selection persistence disabled
      }
    } catch (err) {
      console.error('Error loading companies:', err);
      setError('Failed to load companies');
    } finally {
      isLoadingCompaniesRef.current = false;
      setIsLoading(false);
    }
  }, [isAuthenticated, getMembershipRole, selectedBusinessId, user?.id, user?.role]);

  const refreshBranches = useCallback(async () => {
    // Skip regular API calls if in backoffice (uses different auth system)
    if (localStorage.getItem('backofficeToken') || window.location.pathname.startsWith('/backoffice')) return;

    if (!isAuthenticated) {
      return;
    }

    const membershipRole = getMembershipRole();
    const role = String(membershipRole || '').toUpperCase();
    // In multi-business mode, branches are business-scoped; avoid overwriting cache with empty results.
    if (role === 'OWNER' && !selectedBusinessId) {
      return;
    }

    // CRITICAL: Prevent duplicate calls and infinite loops
    if (isLoadingBranchesRef.current) {
      return;
    }

    try {
      isLoadingBranchesRef.current = true;
      // Don't show loading - load in background
      setError(null);

      const response = await apiService.getBranches();

      if (response.success && response.data) {
        const branchesData = Array.isArray(response.data) ? response.data : response.data.branches;
        let allowedBranchIds = Array.isArray(user?.membership?.branchIds)
          ? user.membership.branchIds.map((branchId) => String(branchId))
          : [];
        if (allowedBranchIds.length === 0 && (role === 'MANAGER' || role === 'CASHIER') && user?.branchId) {
          allowedBranchIds = [String(user.branchId)];
        }
        const roleAllowsAllBranches = role === 'OWNER' || role === 'ADMIN' || role === 'USER';
        const scopedBranchesData = roleAllowsAllBranches || allowedBranchIds.length === 0
          ? branchesData
          : (branchesData || []).filter((branch: any) => allowedBranchIds.includes(String(branch.id)));
        if (scopedBranchesData && scopedBranchesData.length > 0) {
          setAllBranches(scopedBranchesData);
          if (selectedBranchId && !scopedBranchesData.some((branch: any) => String(branch.id) === String(selectedBranchId))) {
            setSelectedBranchId(scopedBranchesData[0]?.id || null);
          }
        } else {
          setAllBranches([]);
          if (selectedBranchId) {
            setSelectedBranchId(null);
          }
        }

        // Branch caching removed - no longer caching in localStorage
      } else {
        setError('Failed to load branches');
      }
    } catch (err: any) {
      // Gracefully handle permission/module errors (403) - fall back to cached branches
      const errMsg = err?.message || '';
      if (errMsg.includes('Permission denied') || errMsg.includes('Module') || errMsg.includes('disabled')) {
        // Gracefully handle 403 - use cached data if available
      } else {
        console.warn('Branch loading issue:', errMsg);
      }
      // Don't set error state for 403s - the cached branches are still valid
      // Don't set loading - silent fail in background
    } finally {
      isLoadingBranchesRef.current = false;
    }
  }, [isAuthenticated, user?.id, getMembershipRole, selectedBusinessId]); // Removed selectedBranchId dependency to prevent infinite loop

  

  // Prefetch core datasets after branch/company selection so tabs feel instant
  // CRITICAL FIX: Fetch enabled modules FIRST, then only prefetch for enabled modules
  // This prevents 403 "Module X is disabled" errors from flooding the console
  useEffect(() => {
    // Skip regular API calls if in backoffice (uses different auth system)
    if (localStorage.getItem('backofficeToken') || window.location.pathname.startsWith('/backoffice')) return;

    if (!isAuthenticated || !user) return;

    const effectiveCompanyId = selectedBusinessId || user.companyId;
    // If no business context and no fallback company, skip prefetch
    if (!effectiveCompanyId) return;

    let cancelled = false;

    const runPrefetch = async () => {
      try {
        // Run immediately (no idle delay) so tabs feel instant after selection
        setTimeout(async () => {
          if (cancelled) return;
          try {
            const { canAccess, hasPermission } = authContext;
            const tasks: Promise<any>[] = [];

            // CRITICAL: Fetch enabled modules FIRST to avoid 403 errors
            let enabledModules: Record<string, boolean> = {};
            try {
              const modulesResponse = await (apiService as any).getEnabledModules(effectiveCompanyId);
              if (modulesResponse.success && Array.isArray(modulesResponse.data)) {
                enabledModules = modulesResponse.data.reduce((acc: Record<string, boolean>, item: any) => {
                  acc[String(item.name).toLowerCase()] = Boolean(item.enabled);
                  return acc;
                }, {});
              }
            } catch (e) {
              console.warn('Prefetch: Failed to fetch enabled modules, skipping all prefetch', e);
              return; // Don't prefetch anything if we can't determine which modules are enabled
            }

            if (cancelled) return;

            const isModuleEnabled = (moduleName: string) => Boolean(enabledModules[moduleName.toLowerCase()]);

            // Sales: require 'sales' module + resource 'sales' action 'read'
            try {
              if (isModuleEnabled('sales') && canAccess && hasPermission && canAccess('sales') && hasPermission('sales', 'read')) {
                tasks.push(apiService.getSales({ 
                  page: 1, 
                  limit: 50, 
                  ...(selectedBranchId ? { branchId: selectedBranchId } : {}),
                  ...(selectedBusinessId ? { companyId: selectedBusinessId } : {}),
                }));
              }
            } catch (e) {
              console.warn('Prefetch: sales check failed, skipping', e);
            }

            // Products - requires 'inventory' module
            try {
              if (isModuleEnabled('inventory') && canAccess && hasPermission && (canAccess('products') || canAccess('inventory')) && hasPermission('products', 'read')) {
                tasks.push(apiService.getProducts({ 
                  page: 1, 
                  limit: 50, 
                  ...(selectedBranchId ? { branchId: selectedBranchId } : {}),
                  ...(selectedBusinessId ? { companyId: selectedBusinessId } : {}),
                }));
              }
            } catch (e) {
              console.warn('Prefetch: products check failed, skipping', e);
            }

            // Categories - requires 'inventory' module
            try {
              if (isModuleEnabled('inventory') && canAccess && hasPermission && canAccess('categories') && hasPermission('categories', 'read')) {
                tasks.push(apiService.getCategories({ page: 1, limit: 200, ...(selectedBranchId ? { branchId: selectedBranchId } : {}) } as any));
              }
            } catch (e) {
              console.warn('Prefetch: categories check failed, skipping', e);
            }

            // Suppliers - requires 'suppliers' module
            try {
              if (isModuleEnabled('suppliers') && canAccess && hasPermission && canAccess('suppliers') && hasPermission('suppliers', 'read')) {
                tasks.push(apiService.getSuppliers({
                  page: 1,
                  limit: 100,
                  ...(selectedBranchId ? { branchId: selectedBranchId } : {}),
                  ...(selectedBusinessId ? { companyId: selectedBusinessId } : {}),
                }).then((response: any) => {
                  if (!response.success) {
                    const message = String(response.message || '').toLowerCase();
                    if (message.includes('403') || message.includes('forbidden') || message.includes('permission denied')) {
                      return {
                        success: false,
                        data: {
                          suppliers: [],
                          pagination: { page: 1, limit: 100, total: 0, pages: 0 },
                        },
                      } as any;
                    }
                  }
                  return response;
                }).catch((e: any) => {
                  if (e?.response?.status === 403 || e?.status === 403) {
                    return {
                      success: false,
                      data: {
                        suppliers: [],
                        pagination: { page: 1, limit: 100, total: 0, pages: 0 },
                      },
                    } as any;
                  }
                  throw e;
                }));
              }
            } catch (e) {
              console.warn('Prefetch: suppliers check failed, skipping', e);
            }

            // Manufacturers - requires 'inventory' module
            try {
              if (isModuleEnabled('inventory') && canAccess && hasPermission && hasPermission('manufacturers', 'read')) {
                tasks.push(apiService.getManufacturers({ 
                  page: 1, 
                  limit: 100, 
                  active: true,
                  ...(selectedBusinessId ? { companyId: selectedBusinessId } : {}),
                }));
              }
            } catch (e) {
              console.warn('Prefetch: manufacturers check failed, skipping', e);
            }

            // Shelves - requires 'inventory' module
            try {
              if (isModuleEnabled('inventory') && canAccess && hasPermission && hasPermission('shelves', 'read')) {
                tasks.push(apiService.getShelves({ 
                  page: 1, 
                  limit: 100,
                  ...(selectedBusinessId ? { companyId: selectedBusinessId } : {}),
                  ...(selectedBranchId ? { branchId: selectedBranchId } : {}),
                } as any));
              }
            } catch (e) {
              console.warn('Prefetch: shelves check failed, skipping', e);
            }

            // Batches - requires 'inventory' module
            try {
              if (isModuleEnabled('inventory') && canAccess && hasPermission && hasPermission('batches', 'read')) {
                tasks.push(apiService.getBatches({ 
                  page: 1, 
                  limit: 100, 
                  isActive: true,
                  ...(selectedBranchId ? { branchId: selectedBranchId } : {}),
                  ...(selectedBusinessId ? { companyId: selectedBusinessId } : {}),
                }));
              }
            } catch (e) {
              console.warn('Prefetch: batches check failed, skipping', e);
            }

            // Purchases - requires 'purchases' module
            try {
              if (isModuleEnabled('purchases') && canAccess && hasPermission && hasPermission('purchases', 'read')) {
                tasks.push(apiService.getPurchases({ 
                  page: 1, 
                  limit: 10,
                  ...(selectedBranchId ? { branchId: selectedBranchId } : {}),
                  ...(selectedBusinessId ? { companyId: selectedBusinessId } : {}),
                } as any));
              }
            } catch (e) {
              console.warn('Prefetch: purchases check failed, skipping', e);
            }

            if (tasks.length > 0) {
              void Promise.allSettled(tasks);
            }
          } catch (e) {
            console.error('Prefetch internal error:', e);
          }
        }, 0);
      } catch {
        // silent
      }
    };

    // Prefetch after selection changes
    runPrefetch();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, user, selectedBusinessId, selectedBranchId]);

  // Memoize the context getter function
  // Use selectedBranchId directly (not effectiveBranchId) so "All Branches" sends no X-Branch-ID header
  const contextGetter = useCallback(() => ({
    companyId: effectiveCompanyId || undefined,
    branchId: selectedBranchId || undefined
  }), [effectiveCompanyId, selectedBranchId]);

  // Set up API context getter
  // useLayoutEffect ensures this runs BEFORE child component useEffects,
  // preventing race conditions where API requests use stale branch/company headers
  useLayoutEffect(() => {
    apiService.setContextGetter(contextGetter);
  }, [contextGetter]);

  // Reset hasInitialized when user logs out
  useEffect(() => {
    if (!isAuthenticated) {
      setHasInitialized(false);
      setSelectedBusinessId(null);
      setSelectedBranchId(null);
    }
  }, [isAuthenticated]);

  // Load saved selections from localStorage on mount - ONLY ONCE per login
  useEffect(() => {
    // Skip regular API calls if in backoffice (uses different auth system)
    if (localStorage.getItem('backofficeToken') || window.location.pathname.startsWith('/backoffice')) return;

    if (isAuthenticated && user && !hasInitialized) {
      // Mark as initialized to prevent re-running this logic
      setHasInitialized(true);

      const hasBusinessAccess = user.businessAccessGranted !== false;
      if (!hasBusinessAccess) {
        setSelectedBusinessId(null);
        setSelectedBranchId(null);
        return;
      }

      // For managers and cashiers, automatically set their assigned branch
      const membershipRole = user.membership?.roleName?.toUpperCase();
      if ((membershipRole === 'MANAGER' || membershipRole === 'CASHIER') && user.branchId) {
        setSelectedBranchId(user.branchId);
        if (user.companyId) {
          setSelectedBusinessId(user.companyId);
        }
      } else if (membershipRole === 'OWNER' || !membershipRole) {
        // Selection persistence disabled - always start fresh
      }
      // Users have membership-based roles per business

      // Load companies and branches
      refreshCompanies();
      // Load branches immediately on mount (no cache)
      refreshBranches();
    }
  }, [isAuthenticated, user, hasInitialized, refreshCompanies, refreshBranches]);

  // Save company selection to localStorage
  const handleSetSelectedBusinessId = useCallback((companyId: string | null) => {
    const membershipRole = getMembershipRole();
    // For managers, prevent company selection changes
    if (membershipRole === 'MANAGER') {
      // Allow managers to be pinned to their own assigned company (needed for slug-based URLs)
      const normalizedTarget = companyId ? String(companyId) : null;
      const normalizedAssigned = user?.companyId ? String(user.companyId) : null;
      if (normalizedTarget && normalizedAssigned && normalizedTarget === normalizedAssigned) {
        // Allowed
      } else {
        console.warn('🏢 Manager cannot change company selection');
        return;
      }
    }

    const normalizedTarget = companyId ? String(companyId) : null;
    if (
      normalizedTarget &&
      !canAccessCompany(normalizedTarget) &&
      allBusinesses.length > 0
    ) {
      console.warn('🏢 Cannot select inaccessible company:', normalizedTarget);
      return;
    }

    // Selection persistence disabled
    setSelectedBusinessId(companyId);

    // Keep AuthContext membership in sync with selected business (permissions + role-based UI).
    try {
      const rec = companyId ? allBusinesses.find((c) => String(c.id) === String(companyId)) : null;
      let fallbackRole: AppUserRole | null = null;
      if (companyId && user?.id && rec) {
        if (String(rec.createdBy || '') === String(user.id)) {
          fallbackRole = 'OWNER';
        } else if (rec.memberRole) {
          fallbackRole = normalizeAppRole(String(rec.memberRole)) as AppUserRole;
        }
      }

      // Avoid activating a membership before company metadata has loaded.
      // When slug selection happens before allBusinesses is fetched, the business can be valid,
      // but we cannot infer its role or access until the company record is available.
      if (companyId && allBusinesses.length === 0) {
      } else {
        authContext.setActiveMembershipForBusiness(companyId, fallbackRole);
      }
    } catch {
      // ignore
    }
    if (user) {
      if (companyId) {
        const rec = allBusinesses.find((c) => String(c.id) === String(companyId));
        const membership = Array.isArray(user?.memberships)
          ? user.memberships.find((m: { roleName?: string; businessId?: string }) => String(m.businessId) === String(companyId))
          : null;

        const targetRole = normalizeAppRole(
          String(membership?.roleName || (rec as any)?.memberRole || user?.membership?.roleName || ''),
        );

        const pinnedBranchId =
          (rec as any)?.memberBranchId ||
          (Array.isArray(membership?.branchIds) && membership.branchIds.length === 1 ? membership.branchIds[0] : null) ||
          null;

        if ((targetRole === 'MANAGER' || targetRole === 'CASHIER') && pinnedBranchId) {
          setSelectedBranchId(String(pinnedBranchId));
        }

        // CRITICAL FIX: Reload branches when company changes to update dropdown
        // Use setTimeout to ensure state has updated before reloading
        setTimeout(() => {
          refreshBranches();
        }, 100);
      } else {
        // Clear branch selection when company is cleared
        setSelectedBranchId(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, selectedBusinessId, selectedBranchId, getMembershipRole, allBusinesses, authContext]); // Removed allBranches from dependencies to prevent infinite loop

  // Save branch selection to localStorage
  const handleSetSelectedBranchId = useCallback((branchId: string | null) => {
    const normalizedBranchId = branchId === 'all' ? null : branchId;
    const membershipRole = getMembershipRole();

    // For managers, only allow their assigned branch
    if (membershipRole === 'MANAGER') {
      if (normalizedBranchId !== user?.branchId) {
        if (user?.branchId) {
          setSelectedBranchId(user.branchId);
        }
        return;
      }
    }

    const branchInfo = normalizedBranchId ? allBranches.find((branch) => branch.id === normalizedBranchId) : null;
    const branchCompanyId = branchInfo?.companyId || null;

    if (branchCompanyId && branchCompanyId !== selectedBusinessId) {
      setSelectedBusinessId(branchCompanyId);
    }

    setSelectedBranchId(normalizedBranchId);
  }, [user, selectedBranchId, selectedBusinessId, getMembershipRole]);

  useEffect(() => {
    if (!selectedBranchId || !allBranches || allBranches.length === 0) {
      return;
    }

    const branchInfo = allBranches.find((branch) => branch.id === selectedBranchId);
    if (!branchInfo?.companyId) {
      return;
    }

    if (!selectedBusinessId || selectedBusinessId !== branchInfo.companyId) {
      setSelectedBusinessId(branchInfo.companyId);
    }
  }, [selectedBranchId, allBranches, selectedBusinessId, user]);

  const value: AdminContextType = useMemo(() => ({
    selectedCompanyId: selectedBusinessId,
    setSelectedCompanyId: handleSetSelectedBusinessId,
    selectedBusinessId,
    setSelectedBusinessId: handleSetSelectedBusinessId,
    selectedBranchId,
    setSelectedBranchId: handleSetSelectedBranchId,
    effectiveCompanyId,
    effectiveBusinessId: effectiveCompanyId,
    effectiveBranchId,
    allCompanies: allBusinesses,
    allBusinesses,
    ownedCompanies,
    ownedBusinesses: ownedCompanies,
    sharedCompanies,
    sharedBusinesses: sharedCompanies,
    allBranches,
    selectedCompany,
    selectedBusiness: selectedCompany,
    selectedBranch,
    isLoading,
    error,
    refreshCompanies,
    refreshBusinesses: refreshCompanies,
    refreshBranches,
    getMembershipRole
  }), [
    selectedBusinessId,
    handleSetSelectedBusinessId,
    selectedBranchId,
    handleSetSelectedBranchId,
    effectiveCompanyId,
    effectiveBranchId,
    allBusinesses,
    ownedCompanies,
    sharedCompanies,
    allBranches,
    selectedCompany,
    selectedBranch,
    isLoading,
    error,
    refreshCompanies,
    refreshBranches,
    getMembershipRole
  ]);

  return (
    <AdminContext.Provider value={value}>
      {children}
    </AdminContext.Provider>
  );
};
