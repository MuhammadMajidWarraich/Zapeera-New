/**
 * Universal Module Protection Middleware
 * Automatically applies module access control to all API routes
 *
 * SECURITY: This middleware wraps all route handlers and enforces
 * module-based access control at the HTTP layer.
 */

import { Request, Response, NextFunction } from 'express';
import { getRequiredModule, shouldSkipModuleCheck, MODULE_DISPLAY_NAMES } from '../config/module-route-protection.config';
import { checkModuleAccess } from './module-access.middleware';
import { authenticate } from './auth.middleware';

interface AuthRequest extends Request {
  user?: {
    id: string;
    selectedCompanyId?: string;
    companyId?: string;
  };
}

interface AccessCacheEntry {
  allowed: boolean;
  error?: string;
  timestamp: number;
}

/**
 * Cache for module access checks to reduce DB queries
 * Key: userId:businessId:moduleKey
 * TTL: 5 minutes
 * SECURITY FIX: Added max size limit to prevent memory leaks
 */
const accessCache = new Map<string, AccessCacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 10000; // Maximum entries to prevent memory leak

function getCacheKey(userId: string, businessId: string, moduleKey: string): string {
  return `${userId}:${businessId}:${moduleKey}`;
}

function getCachedAccess(userId: string, businessId: string, moduleKey: string): AccessCacheEntry | null {
  const key = getCacheKey(userId, businessId, moduleKey);
  const cached = accessCache.get(key);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached;
  }

  // Clean up expired entry
  if (cached) {
    accessCache.delete(key);
  }

  return null;
}

function setCachedAccess(userId: string, businessId: string, moduleKey: string, entry: AccessCacheEntry): void {
  const key = getCacheKey(userId, businessId, moduleKey);
  
  // SECURITY FIX: Enforce cache size limit to prevent memory leaks
  if (accessCache.size >= MAX_CACHE_SIZE) {
    // Evict oldest entries (first 10% of max size)
    const entriesToEvict = Math.floor(MAX_CACHE_SIZE * 0.1);
    const entries = Array.from(accessCache.entries());
    // Sort by timestamp ascending (oldest first)
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
    // Remove oldest entries
    for (let i = 0; i < entriesToEvict && i < entries.length; i++) {
      accessCache.delete(entries[i][0]);
    }
    console.log(`[Universal Protection] 🧹 Evicted ${entriesToEvict} old cache entries`);
  }
  
  accessCache.set(key, entry);
}

/**
 * Universal module protection middleware
 * Automatically checks module access for every request
 */
export async function universalModuleProtection(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const startTime = Date.now();
  const path = (req.originalUrl || req.path || '').split('?')[0];

  try {
    // Skip always-allowed routes before trying to authenticate public endpoints.
    if (shouldSkipModuleCheck(path)) {
      return next();
    }

    // Get required module for this route.
    const requiredModule = getRequiredModule(path);

    if (!requiredModule) {
      // No specific module required.
      return next();
    }

    if (!req.user?.id) {
      return authenticate(req as any, res, (authError?: any) => {
        if (authError) return next(authError);
        return enforceModuleAccess(req, res, next, path, requiredModule, startTime);
      });
    }

    return enforceModuleAccess(req, res, next, path, requiredModule, startTime);
  } catch (error) {
    console.error('[Universal Protection] Error:', error);
    // Fail secure - block access if check fails
    return res.status(500).json({
      success: false,
      error: 'MODULE_CHECK_ERROR',
      message: 'Unable to verify module access. Please try again.',
    });
  }
}

async function enforceModuleAccess(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
  path: string,
  requiredModule: string,
  startTime: number
) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // Extract business context
    const businessId =
      req.headers['x-company-id'] as string ||
      req.user?.selectedCompanyId ||
      req.user?.companyId;

    if (!businessId) {
      console.warn(`[Universal Protection] ❌ No business context for ${path}`);
      return res.status(400).json({
        success: false,
        error: 'NO_BUSINESS_CONTEXT',
        message: 'Business context required (X-Business-ID header)',
      });
    }

    const userId = req.user.id;

    // Check cache first
    const cached = getCachedAccess(userId, businessId, requiredModule);

    if (cached !== null) {
      if (!cached.allowed) {
        console.warn(`[Universal Protection] ❌ BLOCKED (cached): ${path} for user ${userId} | error=${cached.error}`);
        if (cached.error === 'NO_MEMBERSHIP') {
          return res.status(401).json({
            success: false,
            error: 'NO_MEMBERSHIP',
            message: 'You are not a member of this business',
          });
        }

        return res.status(403).json({
          success: false,
          error: 'MODULE_NOT_ALLOWED',
          message: `This feature (${MODULE_DISPLAY_NAMES[requiredModule] || requiredModule}) is not enabled in your subscription`,
          module: requiredModule,
        });
      }
      // Cached allowed - proceed
      return next();
    }

    // Check module access
    const accessResult = await checkModuleAccess(userId, businessId, requiredModule);

    // Cache the result
    setCachedAccess(userId, businessId, requiredModule, {
      allowed: accessResult.allowed,
      error: accessResult.error,
      timestamp: Date.now(),
    });

    const duration = Date.now() - startTime;

    if (!accessResult.allowed) {
      console.warn(`[Universal Protection] ❌ BLOCKED: ${path} | Module: ${requiredModule} | User: ${userId} | ${duration}ms`);

      if (accessResult.error === 'NO_MEMBERSHIP') {
        return res.status(401).json({
          success: false,
          error: 'NO_MEMBERSHIP',
          message: 'You are not a member of this business',
        });
      }

      return res.status(403).json({
        success: false,
        error: 'MODULE_NOT_ALLOWED',
        message: `This feature (${MODULE_DISPLAY_NAMES[requiredModule] || requiredModule}) is not enabled in your subscription. Please upgrade your plan.`,
        module: requiredModule,
        upgradeUrl: '/subscription',
      });
    }

    // Access granted
    console.log(`[Universal Protection] ✅ ALLOWED: ${path} | Module: ${requiredModule} | User: ${userId} | ${duration}ms`);

    // Attach module info to request for downstream use
    (req as any).requiredModule = requiredModule;

    return next();
  } catch (error) {
    console.error('[Universal Protection] Error:', error);
    // Fail secure - block access if check fails
    return res.status(500).json({
      success: false,
      error: 'MODULE_CHECK_ERROR',
      message: 'Unable to verify module access. Please try again.',
    });
  }
}

/**
 * Clear module access cache (call after module changes)
 */
export function clearModuleAccessCache(userId?: string, businessId?: string): void {
  if (!userId && !businessId) {
    accessCache.clear();
    console.log('[Universal Protection] 🗑️ Cleared all module access cache');
    return;
  }

  // Clear specific entries
  for (const [key] of accessCache) {
    if ((userId && key.startsWith(`${userId}:`)) ||
        (businessId && key.includes(`:${businessId}:`))) {
      accessCache.delete(key);
    }
  }

  console.log(`[Universal Protection] 🗑️ Cleared cache for user ${userId || 'all'}, business ${businessId || 'all'}`);
}

/**
 * Express app wrapper - applies universal protection to all routes
 */
export function applyUniversalModuleProtection(app: any): void {
  // Apply to all API routes
  app.use('/api', universalModuleProtection);

  console.log('[Universal Protection] 🔒 Module protection enabled for all API routes');
}
