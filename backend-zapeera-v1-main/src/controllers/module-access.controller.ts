/**
 * Module Access Controller
 * API endpoints for module access management
 */

import { Request, Response } from 'express';
import { moduleAccessService } from '../services/module-access.service';

interface AuthRequest extends Request {
  user?: {
    id: string;
    selectedCompanyId?: string;
    companyId?: string;
  };
}

/**
 * Get all enabled modules for current business context
 * Used by frontend to build navigation
 */
export async function getMyModuleAccess(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    const businessId = req.headers['x-company-id'] as string || req.user?.selectedCompanyId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
      });
    }

    if (!businessId) {
      return res.status(400).json({
        success: false,
        error: 'NO_BUSINESS_CONTEXT',
        message: 'Business context required',
      });
    }

    const access = await moduleAccessService.getUserModuleAccess(userId, businessId);

    if (!access) {
      return res.status(403).json({
        success: false,
        error: 'ACCESS_DENIED',
        message: 'You do not have access to this business',
      });
    }

    return res.json({
      success: true,
      data: {
        allowedModules: access.allowedModules,
        modules: access.modules,
      },
    });
  } catch (error) {
    console.error('[ModuleAccessController] Error getting module access:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Error retrieving module access',
    });
  }
}

/**
 * Check if user has access to a specific module
 */
export async function checkModuleAccess(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    const businessId = req.headers['x-company-id'] as string || req.user?.selectedCompanyId;
    const { moduleKey } = req.params;

    if (!userId || !businessId) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_CONTEXT',
        message: 'User and business context required',
      });
    }

    const result = await moduleAccessService.checkAccess(userId, businessId, moduleKey);

    return res.json({
      success: true,
      data: {
        moduleKey,
        allowed: result.allowed,
        reason: result.reason,
      },
    });
  } catch (error) {
    console.error('[ModuleAccessController] Error checking module access:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Error checking module access',
    });
  }
}

/**
 * Batch check multiple modules
 */
export async function batchCheckModuleAccess(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    const businessId = req.headers['x-company-id'] as string || req.user?.selectedCompanyId;
    const { modules } = req.body;

    if (!userId || !businessId) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_CONTEXT',
        message: 'User and business context required',
      });
    }

    if (!Array.isArray(modules)) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_REQUEST',
        message: 'modules array required in body',
      });
    }

    const results: Record<string, boolean> = {};

    for (const moduleKey of modules) {
      const result = await moduleAccessService.checkAccess(userId, businessId, moduleKey);
      results[moduleKey] = result.allowed;
    }

    return res.json({
      success: true,
      data: {
        results,
        allowedModules: Object.entries(results)
          .filter(([, allowed]) => allowed)
          .map(([key]) => key),
      },
    });
  } catch (error) {
    console.error('[ModuleAccessController] Error in batch check:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Error checking module access',
    });
  }
}

/**
 * Get all available modules in the system (for admin/upgrade UI)
 */
export async function getAllModules(req: AuthRequest, res: Response) {
  try {
    const modules = await moduleAccessService.getAllModules();

    return res.json({
      success: true,
      data: modules,
    });
  } catch (error) {
    console.error('[ModuleAccessController] Error getting all modules:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Error retrieving modules',
    });
  }
}

/**
 * Get module details with access info for current business
 */
export async function getModuleDetails(req: AuthRequest, res: Response) {
  try {
    const userId = req.user?.id;
    const businessId = req.headers['x-company-id'] as string || req.user?.selectedCompanyId;
    const { moduleKey } = req.params;

    if (!userId || !businessId) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_CONTEXT',
        message: 'User and business context required',
      });
    }

    const [moduleDetails, accessCheck] = await Promise.all([
      moduleAccessService.getModuleDetails(moduleKey),
      moduleAccessService.checkAccess(userId, businessId, moduleKey),
    ]);

    if (!moduleDetails) {
      return res.status(404).json({
        success: false,
        error: 'MODULE_NOT_FOUND',
        message: 'Module not found',
      });
    }

    return res.json({
      success: true,
      data: {
        module: moduleDetails,
        access: {
          allowed: accessCheck.allowed,
          reason: accessCheck.reason,
        },
      },
    });
  } catch (error) {
    console.error('[ModuleAccessController] Error getting module details:', error);
    return res.status(500).json({
      success: false,
      error: 'SERVER_ERROR',
      message: 'Error retrieving module details',
    });
  }
}
