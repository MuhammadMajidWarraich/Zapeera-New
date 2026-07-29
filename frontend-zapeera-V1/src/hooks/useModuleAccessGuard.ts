import { useCallback } from 'react';
import { toast } from 'sonner';
import { useBusinessModules } from './useBusinessModules';
import { useAdmin } from '@/contexts/useAdmin';

interface ModuleAccessGuardOptions {
  showToast?: boolean;
  customMessage?: string;
}

/**
 * Hook to guard module access and show upgrade prompts
 * Usage: const guardModule = useModuleAccessGuard();
 *        guardModule('reports', { showToast: true });
 */
export const useModuleAccessGuard = () => {
  const { isModuleLocked, getModuleInfo, getModuleDisabledReason: getDisabledReason, loading } = useBusinessModules();
  const { selectedCompanyId, selectedCompany } = useAdmin();

  // Create a safe version of isModuleLocked that returns false during loading
  const safeIsModuleLocked = useCallback((moduleName?: string) => {
    if (!moduleName) return false;
    if (loading) return false;
    return isModuleLocked(moduleName);
  }, [isModuleLocked, loading]);

  const guardModule = useCallback((
    moduleName: string,
    options: ModuleAccessGuardOptions = {}
  ): { allowed: boolean; reason?: string } => {
    const { showToast = true, customMessage } = options;

    if (!selectedCompanyId) {
      return { allowed: false, reason: 'NO_BUSINESS_CONTEXT' };
    }

    if (loading) {
      return { allowed: false, reason: 'Loading...' };
    }

    if (moduleName.toLowerCase() === 'subscription') {
      return { allowed: true };
    }

    // Check if module is locked
    if (isModuleLocked(moduleName)) {
      const moduleInfo = getModuleInfo(moduleName);

      if (showToast) {
        const message = customMessage || `${moduleInfo?.label || moduleName} is not available in your current subscription plan. Upgrade your subscription to access this feature.`;
        
        toast.error('Feature Not Available', {
          description: message,
          action: {
            label: 'Upgrade',
            onClick: () => {
              const slug = String((selectedCompany as { slug?: string | null } | null)?.slug || '').trim();
              window.location.href = slug
                ? `/business/${encodeURIComponent(slug)}/subscription`
                : '/zapeera/my-businesses';
            },
          },
          duration: 6000,
        });
      }

      return { allowed: false, reason: 'MODULE_LOCKED' };
    }

    return { allowed: true };
  }, [isModuleLocked, getModuleInfo, selectedCompanyId, selectedCompany, loading]);

  const guardModuleWithRedirect = useCallback((
    moduleName: string,
    options: ModuleAccessGuardOptions = {}
  ): boolean => {
    const result = guardModule(moduleName, options);
    
    if (!result.allowed) {
      // If not allowed, don't proceed
      return false;
    }
    
    return true;
  }, [guardModule]);

  return {
    guardModule,
    guardModuleWithRedirect,
    isModuleLocked: safeIsModuleLocked,
    getModuleInfo,
    getModuleDisabledReason: getDisabledReason,
    loading,
  };
};
