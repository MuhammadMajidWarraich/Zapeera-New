import React, { createContext, useContext, useState, useCallback, useRef, useMemo } from 'react';

interface DashboardCache {
  data: any;
  timestamp: number;
  companyId?: string | null;
  branchId?: string | null;
}

interface DashboardDataContextType {
  // Cache management
  getCachedData: (companyId: string | null, branchId: string | null) => DashboardCache | null;
  setCachedData: (companyId: string | null, branchId: string | null, data: any) => void;
  clearCache: () => void;
  clearCacheForContext: (companyId: string | null, branchId: string | null) => void;
  
  // Loading states
  isLoading: (companyId: string | null, branchId: string | null) => boolean;
  setLoading: (companyId: string | null, branchId: string | null, loading: boolean) => void;
  
  // Cache validity (5 minutes default)
  isCacheValid: (cache: DashboardCache | null, maxAge?: number) => boolean;
  
  // Force refresh flag
  shouldRefresh: (companyId: string | null, branchId: string | null) => boolean;
  markAsRefreshed: (companyId: string | null, branchId: string | null) => void;
}

const DashboardDataContext = createContext<DashboardDataContextType | undefined>(undefined);

export const useDashboardData = () => {
  const context = useContext(DashboardDataContext);
  if (context === undefined) {
    throw new Error('useDashboardData must be used within a DashboardDataProvider');
  }
  return context;
};

interface DashboardDataProviderProps {
  children: React.ReactNode;
  cacheMaxAge?: number; // in milliseconds, default 5 minutes
}

export const DashboardDataProvider: React.FC<DashboardDataProviderProps> = ({ 
  children, 
  cacheMaxAge = 5 * 60 * 1000 // 5 minutes default
}) => {
  // Cache storage: key format "companyId_branchId"
  const cacheRef = useRef<Map<string, DashboardCache>>(new Map());
  const loadingStatesRef = useRef<Map<string, boolean>>(new Map());
  const refreshFlagsRef = useRef<Map<string, boolean>>(new Map());

  // Generate cache key
  const getCacheKey = useCallback((companyId: string | null, branchId: string | null) => {
    return `${companyId || 'all'}_${branchId || 'all'}`;
  }, []);

  // Get cached data - DISABLED: Always return null to disable data caching
  const getCachedData = useCallback((companyId: string | null, branchId: string | null): DashboardCache | null => {
    return null;
  }, []);

  // Set cached data - DISABLED: No-op to disable data caching
  const setCachedData = useCallback((companyId: string | null, branchId: string | null, data: any) => {
    // No-op - caching disabled
  }, []);

  // Clear all cache
  const clearCache = useCallback(() => {
    cacheRef.current.clear();
    loadingStatesRef.current.clear();
    refreshFlagsRef.current.clear();
    console.log('🗑️ Cleared all dashboard cache');
  }, []);

  // Clear cache for specific context
  const clearCacheForContext = useCallback((companyId: string | null, branchId: string | null) => {
    const key = getCacheKey(companyId, branchId);
    cacheRef.current.delete(key);
    loadingStatesRef.current.delete(key);
    refreshFlagsRef.current.delete(key);
    console.log(`🗑️ Cleared cache for ${key}`);
  }, [getCacheKey]);

  // Check if data is loading
  const isLoading = useCallback((companyId: string | null, branchId: string | null): boolean => {
    const key = getCacheKey(companyId, branchId);
    return loadingStatesRef.current.get(key) || false;
  }, [getCacheKey]);

  // Set loading state
  const setLoading = useCallback((companyId: string | null, branchId: string | null, loading: boolean) => {
    const key = getCacheKey(companyId, branchId);
    if (loading) {
      loadingStatesRef.current.set(key, true);
    } else {
      loadingStatesRef.current.delete(key);
    }
  }, [getCacheKey]);

  // Check if cache is valid
  const isCacheValid = useCallback((cache: DashboardCache | null, maxAge?: number): boolean => {
    if (!cache) return false;
    const age = Date.now() - cache.timestamp;
    const validAge = maxAge || cacheMaxAge;
    return age < validAge;
  }, [cacheMaxAge]);

  // Check if should refresh (force refresh flag)
  const shouldRefresh = useCallback((companyId: string | null, branchId: string | null): boolean => {
    const key = getCacheKey(companyId, branchId);
    return refreshFlagsRef.current.get(key) || false;
  }, [getCacheKey]);

  // Mark as refreshed (clear refresh flag)
  const markAsRefreshed = useCallback((companyId: string | null, branchId: string | null) => {
    const key = getCacheKey(companyId, branchId);
    refreshFlagsRef.current.set(key, false);
  }, [getCacheKey]);

  // Memoize context value to prevent unnecessary re-renders
  const value = useMemo<DashboardDataContextType>(() => ({
    getCachedData,
    setCachedData,
    clearCache,
    clearCacheForContext,
    isLoading,
    setLoading,
    isCacheValid,
    shouldRefresh,
    markAsRefreshed
  }), [
    getCachedData,
    setCachedData,
    clearCache,
    clearCacheForContext,
    isLoading,
    setLoading,
    isCacheValid,
    shouldRefresh,
    markAsRefreshed
  ]);

  return (
    <DashboardDataContext.Provider value={value}>
      {children}
    </DashboardDataContext.Provider>
  );
};

