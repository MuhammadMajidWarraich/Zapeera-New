/**
 * Module Access Hook
 * Manages module access cache for subscription-based feature restrictions
 */

const moduleAccessCache: Map<string, boolean> = new Map();

/**
 * Clear the module access cache
 * Call this when subscription status changes or after upgrade
 */
export function clearModuleAccessCache(): void {
  moduleAccessCache.clear();
}

/**
 * Check if a module is accessible (with caching)
 */
export function checkModuleAccess(module: string): boolean {
  if (moduleAccessCache.has(module)) {
    return moduleAccessCache.get(module)!;
  }
  
  moduleAccessCache.set(module, false);
  return false;
}

/**
 * Set module access status
 */
export function setModuleAccess(module: string, accessible: boolean): void {
  moduleAccessCache.set(module, accessible);
}
