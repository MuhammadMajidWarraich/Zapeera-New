/**
 * Universal Module Protection Middleware (Phase 4 rewrite).
 *
 * Applies the canonical authorization decision to every /api request:
 *
 *   1. Resolve the route policy from the complete registry
 *      (src/config/route-policy.registry.ts).
 *   2. Unclassified routes FAIL CLOSED in production (403 UNMAPPED_ROUTE).
 *   3. Tenant-protected resources (`module` kind) are authorized through
 *      authorizeBusinessAction() — the SAME canonical resolver used by the
 *      module controller, so the frontend and the API can never disagree on
 *      what is allowed (shared versioned cache, Issue 10).
 *   4. Responses are structured: 401 for missing auth/membership, 403 with
 *      the exact denial reason for everything else.
 *
 * The frontend (sidebar/guards) is UX only — this middleware is the
 * authoritative gate for API access.
 */

import { Request, Response, NextFunction } from 'express';
import { resolveRoutePolicy, normalizePolicyPath } from '../config/route-policy.registry';
import { resolveModuleOperation } from '../config/module-route-protection.config';
import { authorizeBusinessAction } from '../services/authorization.service';
import { getPrisma } from '../utils/db.util';
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

function isProduction(): boolean {
  return String(process.env.NODE_ENV).toLowerCase() === 'production';
}

/**
 * Universal module protection middleware.
 */
export async function universalModuleProtection(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const path = normalizePolicyPath(req.originalUrl || req.path || '');

  try {
    const policy = resolveRoutePolicy(path);

    if (!policy) {
      // FAIL CLOSED: unclassified endpoint.
      if (isProduction()) {
        logger.warn(`[Universal Protection] ⛔ UNMAPPED ROUTE BLOCKED (no policy): ${path}`);
        return res.status(403).json({
          success: false,
          error: 'UNMAPPED_ROUTE',
          message: 'This endpoint has no authorization policy. Contact support.',
        });
      }
      logger.warn(`[Universal Protection] ⚠️  Unmapped route (no policy) — allowed outside production: ${path}`);
      logger.warn('[Universal Protection]    Add it to src/config/route-policy.registry.ts.');
      return next();
    }

    switch (policy.kind) {
      case 'public':
      case 'backoffice':
        // Router-level middleware enforces auth for backoffice; public routes
        // are explicitly classified.
        return next();

      case 'auth':
      case 'auth-core':
      case 'billing':
        // Authenticated account/core endpoints: ensure a user is present;
        // routers apply their own membership/branch guards.
        if (req.user?.id) {
          return next();
        }
        return authenticate(req as any, res, (authError?: any) => {
          if (authError) return next(authError);
          return next();
        });

      case 'module': {
        const action = resolveModuleOperation(req.method, path) || 'read';

        if (!req.user?.id) {
          return authenticate(req as any, res, (authError?: any) => {
            if (authError) return next(authError);
            return enforceResourceAccess(req, res, next, path, policy.resourceKey, action);
          });
        }

        return enforceResourceAccess(req, res, next, path, policy.resourceKey, action);
      }

      default:
        return next();
    }
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

async function enforceResourceAccess(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
  path: string,
  resourceKey: string,
  action: string
) {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // Extract business context
    const businessId =
      req.business_id ||
      req.membership?.business_id ||
      (req.headers['x-business-id'] as string) ||
      (req.headers['x-company-id'] as string) ||
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
    const prisma = await getPrisma();

    const branchId = (req.headers['x-branch-id'] as string) || undefined;

    const decision = await authorizeBusinessAction(prisma, userId, businessId, resourceKey, action, {
      branchId,
    });

    if (!decision.allowed) {
      logger.warn(
        `[Universal Protection] BLOCKED: ${req.method} ${path} | resource=${resourceKey} action=${action} | user=${userId} | reason=${decision.reason}`
      );

      if (decision.reason === 'NO_ACTIVE_MEMBERSHIP') {
        return res.status(401).json({
          success: false,
          error: 'NO_ACTIVE_MEMBERSHIP',
          message: 'You are not an active member of this business',
        });
      }

      const [moduleKey] = decision.resourceKey.split('.');

      const upgradeHint =
        decision.reason === 'PLAN_NOT_ENTITLED' || decision.reason === 'SUBSCRIPTION_INACTIVE';

      return res.status(403).json({
        success: false,
        error: decision.reason,
        message: upgradeHint
          ? `This feature is not included in your current subscription. Please upgrade your plan.`
          : `Access denied for ${decision.resourceKey}.${decision.action}`,
        module: moduleKey,
        resourceKey: decision.resourceKey,
        action: decision.action,
        upgradeUrl: upgradeHint ? '/subscription' : undefined,
      });
    }

    // Attach the canonical decision for downstream use
    (req as any).requiredModule = decision.moduleKey;
    (req as any).requiredPage = decision.resourceKey.split('.')[1] || 'overview';
    (req as any).authDecision = decision;

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
 * Legacy alias kept for controllers that clear the module access cache.
 * The shared authorization cache is version-keyed; clearing is a
 * belt-and-suspenders measure (Issue 10).
 */
export function clearModuleAccessCache(_userId?: string, _businessId?: string): void {
  const { invalidateAuthPolicyCache } = require('../services/authorization.service');
  invalidateAuthPolicyCache();
  logger.debug('[Universal Protection] Cleared shared authorization cache');
}

/**
 * Enforce role-based operation permissions for a request (LEGACY helper).
 *
 * The universal middleware now authorizes through the canonical service
 * (authorizeBusinessAction), which resolves the exact (resource, action)
 * permission — this helper is retained for tests and callers that operate on
 * precomputed operation lists.
 */
export function enforceOperation(
  method: string,
  path: string,
  allowedOperations?: string[],
  fallbackFullOps?: boolean
): { success: boolean; error: string; message: string; operation: string } | null {
  const operation = resolveModuleOperation(method, path);
  if (!operation || operation === 'read') {
    return null;
  }

  if (fallbackFullOps) {
    return null;
  }

  if (!allowedOperations || !allowedOperations.includes(operation)) {
    logger.warn(`[Universal Protection] OPERATION BLOCKED: ${operation} ${method} ${path} (allowed=${(allowedOperations || []).join(',') || 'none'})`);
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
 * Express app wrapper - applies universal protection to all API routes
 */
export function applyUniversalModuleProtection(app: any): void {
  app.use('/api', universalModuleProtection);
  logger.info('[Universal Protection] Module protection enabled for all API routes');
}
