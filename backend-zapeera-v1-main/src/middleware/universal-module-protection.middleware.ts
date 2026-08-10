/**
 * Universal Module Protection Middleware
 * Automatically applies module access control to all API routes
 *
 * SECURITY: This middleware wraps all route handlers and enforces
 * module-based access control at the HTTP layer.
 */

import { Request, Response, NextFunction } from 'express';
import { getRequiredModule, shouldSkipModuleCheck, MODULE_DISPLAY_NAMES, normalizeModulePolicyPath, resolveModuleOperation } from '../config/module-route-protection.config';
import { checkModuleAccess } from './module-access.middleware';
import { authenticate } from './auth.middleware';
import logger from '../utils/logger';

interface AuthRequest extends Request {
  user?: {
    id: string;
    selectedCompanyId?: string;
    companyId?: string;
  };
  membership?: { business_id?: string };
  business_id?: string;
}

interface AccessCacheEntry {
  allowed: boolean;
  error?: string;
  allowedOperations?: string[];
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
    logger.debug(`[Universal Protection] Evicted ${entriesToEvict} old cache entries`);
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
  const path = normalizeModulePolicyPath(req.originalUrl || req.path || '');

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
    logger.error('[Universal Protection] Error:', { error: String(error) });
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
      req.business_id ||
      req.membership?.business_id ||
      req.headers['x-business-id'] as string ||
      req.headers['x-company-id'] as string ||
      req.user?.selectedCompanyId ||
      req.user?.companyId;

    if (!businessId) {
      logger.warn(`[Universal Protection] No business context for ${path}`);
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
        logger.warn(`[Universal Protection] BLOCKED (cached): ${path} for user ${userId} | error=${cached.error}`);
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

      // Enforce role-based operation permissions (e.g. read-only roles)
      const operationDenied = enforceOperation(req.method, path, cached.allowedOperations);
      if (operationDenied) {
        return res.status(403).json(operationDenied);
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
      allowedOperations: accessResult.allowedOperations,
      timestamp: Date.now(),
    });

    const duration = Date.now() - startTime;

    if (!accessResult.allowed) {
      logger.warn(`[Universal Protection] BLOCKED: ${path} | Module: ${requiredModule} | User: ${userId} | ${duration}ms`);

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
    logger.debug(`[Universal Protection] ALLOWED: ${path} | Module: ${requiredModule} | User: ${userId} | ${duration}ms`);

    // Enforce role-based operation permissions (e.g. read-only roles)
    const operationDenied = enforceOperation(req.method, path, accessResult.allowedOperations);
    if (operationDenied) {
      return res.status(403).json(operationDenied);
    }

    // Attach module info to request for downstream use
    (req as any).requiredModule = requiredModule;

    return next();
  } catch (error) {
    logger.error('[Universal Protection] Error:', { error: String(error) });
    // Fail secure - block access if check fails
    return res.status(500).json({
      success: false,
      error: 'MODULE_CHECK_ERROR',
      message: 'Unable to verify module access. Please try again.',
    });
  }
}
/**
 * Enforce role-based operation permissions for a request.
 * Resolves the operation for the HTTP method/path and blocks the request when
 * the role's allowedOperations do not include it. 'read' is never blocked here
 * (it is the baseline), and requests with no operation mapping pass through.
 * Returns a 403 body when denied, otherwise null.
 */
function enforceOperation(
  method: string,
  path: string,
  allowedOperations?: string[]
): { success: boolean; error: string; message: string; operation: string } | null {
  if (!allowedOperations || !allowedOperations.length) {
    return null;
  }

  const operation = resolveModuleOperation(method, path);
  if (!operation || operation === 'read') {
    return null;
  }

  if (!allowedOperations.includes(operation)) {
    logger.warn(`[Universal Protection] OPERATION BLOCKED: ${operation} ${method} ${path} (allowed=${allowedOperations.join(',')})`);
    return {
      success: false,
      error: 'OPERATION_NOT_ALLOWED',
      message: `You do not have permission to perform this action (${operation})`,
      operation,
    };
  }

  return null;
}

/**
 * Clear module access cache (call after module changes)
 */
export function clearModuleAccessCache(userId?: string, businessId?: string): void {
  if (!userId && !businessId) {
    accessCache.clear();
    logger.debug('[Universal Protection] Cleared all module access cache');
    return;
  }

  // Clear specific entries
  for (const [key] of accessCache) {
    if ((userId && key.startsWith(`${userId}:`)) ||
        (businessId && key.includes(`:${businessId}:`))) {
      accessCache.delete(key);
    }
  }

  logger.debug(`[Universal Protection] Cleared cache for user ${userId || 'all'}, business ${businessId || 'all'}`);
}

/**
 * Express app wrapper - applies universal protection to all routes
 */
export function applyUniversalModuleProtection(app: any): void {
  // Apply to all API routes
  app.use('/api', universalModuleProtection);

  logger.info('[Universal Protection] Module protection enabled for all API routes');
}
