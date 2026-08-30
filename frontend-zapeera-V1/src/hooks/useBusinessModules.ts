import { useEffect, useMemo, useState, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { apiService } from '@/services/api';
import { useAdmin } from '@/contexts/useAdmin';

// Dynamic hierarchy types
export interface SubModuleConfig {
  key: string;
  label: string;
  href: string;
  icon: string;
  module: string;
  roles: string[];
}

export interface ModuleConfig {
  module: string;
  label: string;
  displayName?: string;
  icon: string;
  section: 'main' | 'management' | 'admin';
  subModules: SubModuleConfig[];
  defaultRoles: string[];
}

export interface SubModuleState {
  enabled: boolean;
  disabledReason: 'BUSINESS_TYPE' | 'SUBSCRIPTION_PLAN' | 'ROLE' | 'PARENT_MODULE' | null;
}

// API response shapes (minimal — only the fields the hook reads)
interface ModuleEnablementItem {
  name?: string;
  displayName?: string;
  enabled?: boolean;
  sortOrder?: number;
  disabledReason?: string | null;
}

interface SubModuleResultItem {
  module: string;
  key: string;
  enabled: boolean;
  primaryDenialReason?: SubModuleState['disabledReason'] | null;
}

interface ModulesApiResponse {
  success: boolean;
  data?: ModuleEnablementItem[];
  disabledSubModules?: string[];
  subModuleResults?: SubModuleResultItem[];
}

interface HierarchyApiResponse {
  success: boolean;
  data?: {
    hierarchy?: ModuleConfig[];
    lastUpdated?: string;
  };
}

interface BusinessBySlugResponse {
  success: boolean;
  data?: { id: string | number };
}

export interface ModuleState {
  enabled: boolean;
  label: string;
  icon?: string;
  disabledReason?: 'BUSINESS_TYPE' | 'SUBSCRIPTION_PLAN' | 'ROLE' | 'PARENT_MODULE' | null;
}

const ALL_MODULES: Record<string, ModuleState> = {
  dashboard:           { enabled: true, label: 'Dashboard' },  // Dashboard always enabled
  sales:               { enabled: false, label: 'Sales' },
  inventory:           { enabled: false, label: 'Inventory' },
  customers:           { enabled: false, label: 'Customers' },
  suppliers:           { enabled: false, label: 'Suppliers' },
  purchases:           { enabled: false, label: 'Purchases' },
  business_management: { enabled: false, label: 'Management' },
  expenses:            { enabled: false, label: 'Expenses' },
  reports:             { enabled: false, label: 'Reports' },
  advanced_reports:    { enabled: false, label: 'Advanced Reports' },
  subscription:        { enabled: true, label: 'Subscription' },
  pos:                 { enabled: false, label: 'Point of Sale' },
  staff:               { enabled: false, label: 'Staff' },
  branches:            { enabled: false, label: 'Branches' },
  employee_portal:     { enabled: true, label: 'Employee Portal' },
};

/** Read the last-good module hierarchy for a company from localStorage. */
const readHierarchyCache = (companyId: string): ModuleConfig[] | null => {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(`moduleHierarchy_${companyId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch (e) {
    console.warn('[HIERARCHY] Failed to parse cached hierarchy:', e);
    return null;
  }
};

const readHierarchyCacheTimestamp = (companyId: string): string | null => {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(`moduleHierarchyTimestamp_${companyId}`) || null;
  } catch {
    return null;
  }
};

export const useBusinessModules = (companyId?: string) => {
  const { selectedCompanyId, allCompanies } = useAdmin();
  const location = useLocation();
  const businessSlug = useMemo(() => {
    const match = location.pathname.match(/\/business\/([^/]+)/);
    return match ? match[1] : null;
  }, [location.pathname]);
  
  const companyFromUrl = useMemo(() => {
    if (!businessSlug) {
      return null;
    }
    return allCompanies?.find((company) => company.slug === businessSlug) || null;
  }, [businessSlug, allCompanies]);

  const [resolvedSlugCompanyId, setResolvedSlugCompanyId] = useState<string | null | undefined>(undefined);
  const [slugLookupError, setSlugLookupError] = useState<string | null>(null);

  useEffect(() => {
    if (!businessSlug) {
      setResolvedSlugCompanyId(null);
      setSlugLookupError(null);
      return;
    }

    // If the slug resolves via loaded companies, use that first.
    if (companyFromUrl?.id) {
      setResolvedSlugCompanyId(companyFromUrl.id);
      setSlugLookupError(null);
      return;
    }

    // If companies are already loaded and slug does not match, we cannot safely fall back.
    if (allCompanies && allCompanies.length > 0) {
      setResolvedSlugCompanyId(null);
      setSlugLookupError(`Company slug ${businessSlug} not found in loaded companies`);
      return;
    }

    let cancelled = false;
    const lookup = async () => {
      setSlugLookupError(null);
      setResolvedSlugCompanyId(undefined);
      try {
        const response = (await apiService.getBusinessBySlug(businessSlug)) as BusinessBySlugResponse;
        if (!cancelled && response.success && response.data?.id) {
          const id = String(response.data.id);
          setResolvedSlugCompanyId(id);
          return;
        }

        if (!cancelled) {
          setResolvedSlugCompanyId(null);
          setSlugLookupError(`Business slug not found: ${businessSlug}`);
        }
      } catch (error) {
        if (!cancelled) {
          setResolvedSlugCompanyId(null);
          setSlugLookupError(String(error));
          console.error('[MODULES] Error resolving company slug:', error);
        }
      }
    };

    void lookup();
    return () => {
      cancelled = true;
    };
  }, [businessSlug, companyFromUrl?.id, allCompanies]);
  
  const effectiveCompanyId = useMemo(() => {
    return companyId || companyFromUrl?.id || (businessSlug ? resolvedSlugCompanyId : selectedCompanyId);
  }, [companyId, companyFromUrl?.id, selectedCompanyId, businessSlug, resolvedSlugCompanyId]);
  
  const [modules, setModules] = useState<Record<string, ModuleState>>(ALL_MODULES);
  const [moduleOrder, setModuleOrder] = useState<Record<string, number>>({});
  const [disabledSubModules, setDisabledSubModules] = useState<Set<string>>(new Set());
  const [subModuleStateMap, setSubModuleStateMap] = useState<Map<string, SubModuleState>>(new Map());
  const [loading, setLoading] = useState(() => Boolean(businessSlug && !companyId && !companyFromUrl?.id));
  const [refetchTick, setRefetchTick] = useState(0);
  
  // Dynamic hierarchy from backend
  const [hierarchy, setHierarchy] = useState<ModuleConfig[]>([]);
  const [hierarchyLoading, setHierarchyLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const refetch = () => setRefetchTick((t) => t + 1);

  // Track last successfully loaded company to avoid redundant calls
  const lastLoadedCompanyIdRef = useRef<string | null>(null);

  // Set once real module/hierarchy data (network or cache) has been painted.
  // Used so the visible menu is not mis-flagged as "locked" while a fresh
  // fetch is still in flight.
  const dataReadyRef = useRef(false);

  // Safety timeout: force loading to false after 5s so the UI is never permanently stuck
  useEffect(() => {
    if (!loading) return;
    const safetyTimer = setTimeout(() => {
      console.warn('[MODULES] Safety timeout: forcing loading to false after 5s');
      setLoading(false);
      setHierarchyLoading(false);
    }, 5000);
    return () => clearTimeout(safetyTimer);
  }, [loading]);

  // Load basic module enablement + dynamic hierarchy (consolidated)
  useEffect(() => {
    // Skip regular API calls if in backoffice (uses different auth system)
    if (localStorage.getItem('backofficeToken') || window.location.pathname.startsWith('/backoffice')) return;

    let cancelled = false;

    const loadAll = async () => {
      if (!effectiveCompanyId) {
        // If we have a business slug but couldn't resolve the company, clear loading
        if (businessSlug) {
          setLoading(false);
          setHierarchyLoading(false);
        }
        return;
      }

      // Reset the "we have real data" flag when switching companies
      if (lastLoadedCompanyIdRef.current !== effectiveCompanyId) {
        dataReadyRef.current = false;
      }

      // Paint the last-good cached hierarchy immediately so a slow/hung fetch
      // never drops the user onto the partial fallback menu.
      const cached = readHierarchyCache(effectiveCompanyId);
      if (cached && !cancelled) {
        dataReadyRef.current = true;
        setHierarchy(cached);
        setLastUpdated(readHierarchyCacheTimestamp(effectiveCompanyId));
      }

      setLoading(true);
      setHierarchyLoading(true);
      try {
        const [modulesResponse, hierarchyResponse] = await Promise.all([
          apiService.getEnabledModules(effectiveCompanyId),
          apiService.getModuleHierarchy(effectiveCompanyId),
        ]) as [ModulesApiResponse, HierarchyApiResponse];

        if (!cancelled && modulesResponse.success && Array.isArray(modulesResponse.data)) {
          const updatedModules = { ...ALL_MODULES };
          
          modulesResponse.data.forEach((item: ModuleEnablementItem) => {
            const rawName = String(item.name || '').trim().toLowerCase();
            const moduleKey = rawName.replace(/[\s-]+/g, '_');
            const disabledReason = item.disabledReason || null;

            if (updatedModules[moduleKey]) {
              updatedModules[moduleKey] = {
                ...updatedModules[moduleKey],
                enabled: Boolean(item.enabled),
                disabledReason,
              };
            } else {
              updatedModules[moduleKey] = {
                enabled: Boolean(item.enabled),
                label: String(item.displayName || item.name || moduleKey),
                disabledReason,
              };
            }
          });

          const order: Record<string, number> = modulesResponse.data.reduce((acc: Record<string, number>, item: ModuleEnablementItem, idx: number) => {
            const raw = String(item.name || '').trim().toLowerCase();
            const key = raw.replace(/[\s-]+/g, '_');
            acc[key] = typeof item.sortOrder === 'number' ? item.sortOrder : idx;
            return acc;
          }, {});

          setModules(updatedModules);
          setModuleOrder(order);

          const disabled = new Set<string>(
            Array.isArray(modulesResponse.disabledSubModules)
              ? modulesResponse.disabledSubModules.map((s: string) => {
                  const raw = String(s || '').toLowerCase();
                  const parts = raw.split('::');
                  if (parts.length === 2) {
                    const mod = parts[0].replace(/[\s-]+/g, '_');
                    const sub = parts[1];
                    return `${mod}::${sub}`;
                  }
                  return raw.replace(/[\s-]+/g, '_');
                })
              : []
          );
          setDisabledSubModules(disabled);

          // Build per-sub-module state map with denial reasons
          const newStateMap = new Map<string, SubModuleState>();
          if (Array.isArray(modulesResponse.subModuleResults)) {
            for (const smr of modulesResponse.subModuleResults) {
              const compositeKey = `${String(smr.module || '').toLowerCase()}::${String(smr.key || '').toLowerCase()}`;
              newStateMap.set(compositeKey, {
                enabled: Boolean(smr.enabled),
                disabledReason: smr.primaryDenialReason || null,
              });
            }
          } else {
            // Fallback: derive from flat disabledSubModules (all treated as SUBSCRIPTION_PLAN)
            for (const key of disabled) {
              newStateMap.set(key, { enabled: false, disabledReason: 'SUBSCRIPTION_PLAN' });
            }
          }
          setSubModuleStateMap(newStateMap);
        }

        if (!cancelled && hierarchyResponse.success && hierarchyResponse.data?.hierarchy) {
          lastLoadedCompanyIdRef.current = effectiveCompanyId;
          dataReadyRef.current = true;
          
          if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
            try {
              localStorage.setItem(`moduleHierarchy_${effectiveCompanyId}`, JSON.stringify(hierarchyResponse.data.hierarchy));
              localStorage.setItem(`moduleHierarchyTimestamp_${effectiveCompanyId}`, new Date().toISOString());
            } catch (e) {
              console.warn('[HIERARCHY] Failed to store in localStorage:', e);
            }
          }
          
          setHierarchy(hierarchyResponse.data.hierarchy);
          setLastUpdated(hierarchyResponse.data.lastUpdated || new Date().toISOString());
        } else if (!cancelled) {
          const cached = readHierarchyCache(effectiveCompanyId);
          if (cached) {
            dataReadyRef.current = true;
            setHierarchy(cached);
            setLastUpdated(readHierarchyCacheTimestamp(effectiveCompanyId) || new Date().toISOString());
          } else if (lastLoadedCompanyIdRef.current !== effectiveCompanyId || hierarchy.length === 0) {
            setHierarchy([]);
          }
        }
      } catch (error) {
        console.error('useBusinessModules - Error fetching modules/hierarchy:', error);
        const cached = readHierarchyCache(effectiveCompanyId);
        if (cached) {
          dataReadyRef.current = true;
          setHierarchy(cached);
          setLastUpdated(readHierarchyCacheTimestamp(effectiveCompanyId) || new Date().toISOString());
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setHierarchyLoading(false);
        }
      }
    };

    loadAll();
    return () => { cancelled = true; };
    // businessSlug and hierarchy.length are intentionally not in the deps:
    // adding hierarchy.length would restart the fetch every time hierarchy is
    // set, causing a refetch loop; businessSlug changes always flow through
    // effectiveCompanyId, which is already a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveCompanyId, refetchTick]);

  // NOTE: Previously, a 30-second setInterval called refetch() here.
  // Removed because it caused unnecessary cascading re-renders that disrupted
  // in-progress user work (e.g. invoice creation). Module config changes are
  // already handled by the 'modulesUpdated' and 'companyChanged' event listeners below.

  // Re-fetch on the custom event fired by backoffice after saving module changes
  useEffect(() => {
    const onModulesUpdated = () => refetch();
    window.addEventListener('modulesUpdated', onModulesUpdated);
    return () => window.removeEventListener('modulesUpdated', onModulesUpdated);
  }, []);

  // Re-fetch immediately when companyChanged event fires (bypasses React render cycle)
  useEffect(() => {
    const onCompanyChanged = () => refetch();
    window.addEventListener('companyChanged', onCompanyChanged);
    return () => window.removeEventListener('companyChanged', onCompanyChanged);
  }, []);

  const hasModule = useMemo(
    () => (moduleName?: string) => {
      if (!moduleName) return true;
      if (moduleName.toLowerCase() === 'subscription') return true;
      return Boolean(modules[moduleName.toLowerCase()]?.enabled);
    },
    [modules],
  );

  const isModuleLocked = useMemo(
    () => (moduleName?: string) => {
      if (!moduleName) return false;
      const lower = moduleName.toLowerCase();
      if (lower === 'subscription' || lower === 'dashboard') return false;
      // Before any real data is available, treat everything as locked so the
      // default ALL_MODULES state never renders as an unlocked menu.
      if (loading && !dataReadyRef.current) return true;
      const module = modules[lower];
      // If module doesn't exist in the modules object, treat as unlocked
      if (!module) return false;
      // While a menu is already painted (e.g. from cache) and the enablement
      // payload is still loading, don't flag modules as locked from a stale map.
      if (loading && dataReadyRef.current) return false;
      return Boolean(!module.enabled);
    },
    [modules, loading],
  );

  const isSubModuleLocked = useMemo(
    () => (moduleKey: string, subModuleKey: string) => {
      if (!moduleKey || !subModuleKey) return false;
      if (loading) return false;
      const compositeKey = `${moduleKey.toLowerCase()}::${subModuleKey.toLowerCase()}`;
      // Sub-module is "locked" (showing upgrade prompt) only if denied by subscription plan
      const state = subModuleStateMap.get(compositeKey);
      if (state) return !state.enabled && state.disabledReason === 'SUBSCRIPTION_PLAN';
      // Fallback to flat set (all considered plan-locked for backward compat)
      return disabledSubModules.has(compositeKey);
    },
    [disabledSubModules, subModuleStateMap, loading],
  );

  const isSubModuleHidden = useMemo(
    () => (moduleKey: string, subModuleKey: string) => {
      if (!moduleKey || !subModuleKey) return false;
      if (loading) return false;
      const compositeKey = `${moduleKey.toLowerCase()}::${subModuleKey.toLowerCase()}`;
      // Sub-module is "hidden" (not shown at all) if denied by business type, role, or parent
      const state = subModuleStateMap.get(compositeKey);
      if (state) {
        return !state.enabled && state.disabledReason !== 'SUBSCRIPTION_PLAN';
      }
      // Fallback: if in flat set but not in state map, treat as hidden
      return disabledSubModules.has(compositeKey);
    },
    [disabledSubModules, subModuleStateMap, loading],
  );

  const getSubModuleDisabledReason = useMemo(
    () => (moduleKey: string, subModuleKey: string): SubModuleState['disabledReason'] => {
      if (!moduleKey || !subModuleKey) return null;
      const compositeKey = `${moduleKey.toLowerCase()}::${subModuleKey.toLowerCase()}`;
      return subModuleStateMap.get(compositeKey)?.disabledReason || null;
    },
    [subModuleStateMap],
  );

  const getModuleInfo = useMemo(
    () => (moduleName?: string) => {
      if (!moduleName) return null;
      return modules[moduleName.toLowerCase()] || null;
    },
    [modules],
  );

  const getModuleDisabledReason = useMemo(
    () => (moduleName?: string) => {
      if (!moduleName) return null;
      return modules[moduleName.toLowerCase()]?.disabledReason || null;
    },
    [modules],
  );

  return { 
    modules, 
    moduleOrder, 
    disabledSubModules, 
    subModuleStateMap,
    loading: loading || hierarchyLoading, 
    hasModule, 
    isModuleLocked, 
    isSubModuleLocked,
    isSubModuleHidden,
    getSubModuleDisabledReason,
    getModuleInfo, 
    getModuleDisabledReason,
    refetch,
    hierarchy,
    hierarchyLoading,
    lastUpdated,
    hasDynamicHierarchy: hierarchy.length > 0,
  };
};

