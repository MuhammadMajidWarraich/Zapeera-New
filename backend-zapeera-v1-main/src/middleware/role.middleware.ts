import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from './auth.middleware';
import { hasPermission, RESOURCES, ACTIONS } from '../config/permissions';

// Enhanced role-based authorization middleware - uses business-scoped membership roles
export const requirePermission = (resource: string, action: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No user found.'
      });
    }

    // Enforce membership requirement
    if (!req.membership) {
      return res.status(403).json({
        success: false,
        message: 'No active membership found for selected business.'
      });
    }

    // Get role from membership (business-scoped)
    const membershipRole = req.membership.role_name ? String(req.membership.role_name).toUpperCase() : '';
    const allowedBranchIds = req.membership.branch_ids || [];
    const targetBranchId = req.params.branchId || req.body.branchId || req.query.branchId;
    const isOwnData = req.params.userId === req.user.id || req.body.userId === req.user.id;

    // Check if user has permission
    // For branch access, check if targetBranchId is in allowed branches
    let hasBranchAccess = true;
    if (targetBranchId && allowedBranchIds.length > 0) {
      hasBranchAccess = allowedBranchIds.includes(targetBranchId);
    }

    const hasAccess = hasPermission(membershipRole, resource, action, undefined, targetBranchId, isOwnData) && hasBranchAccess;

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Insufficient permissions for ${action} on ${resource}.`,
        required: { resource, action },
        user: { role: membershipRole, allowedBranchIds }
      });
    }

    // Add permission context to request
    req.permissionContext = {
      resource,
      action,
      userRole: membershipRole,
      allowedBranchIds,
      targetBranchId,
      isOwnData
    };

    return next();
  };
};

// Convenience middleware for common operations
export const requireRead = (resource: string) => requirePermission(resource, ACTIONS.READ);
export const requireCreate = (resource: string) => requirePermission(resource, ACTIONS.CREATE);
export const requireUpdate = (resource: string) => requirePermission(resource, ACTIONS.UPDATE);
export const requireDelete = (resource: string) => requirePermission(resource, ACTIONS.DELETE);
export const requireManage = (resource: string) => requirePermission(resource, ACTIONS.MANAGE);

// Role-specific middleware - checks business-scoped membership role
export const requireRole = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No user found.'
      });
    }

    // Enforce membership requirement
    if (!req.membership) {
      return res.status(403).json({
        success: false,
        message: 'No active membership found for selected business.'
      });
    }

    // Get role from membership (business-scoped)
    const userRole = req.membership.role_name ? String(req.membership.role_name).toUpperCase() : '';

    if (!roles.includes(userRole)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required roles: ${roles.join(', ')}. Your role: ${userRole || 'NONE'}`,
        required: roles,
        user: { role: userRole }
      });
    }

    return next();
  };
};

// Branch access control - uses membership role
export const requireBranchAccess = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No user found.'
    });
  }

  // Enforce membership requirement
  if (!req.membership) {
    return res.status(403).json({
      success: false,
      message: 'No active membership found for selected business.'
    });
  }

  const membershipRole = req.membership.role_name ? String(req.membership.role_name).toUpperCase() : '';
  const { branchId } = req.user;
  const targetBranchId = req.params.branchId || req.body.branchId || req.query.branchId;

  // OWNER role can access all branches within the business
  if (membershipRole === 'OWNER') {
    return next();
  }

  // Other roles can only access their own branch
  if (targetBranchId && targetBranchId !== branchId) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. You can only access your own branch data.',
      user: { role: membershipRole, branchId },
      target: { branchId: targetBranchId }
    });
  }

  return next();
};

// Data ownership check
export const requireOwnership = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Access denied. No user found.'
    });
  }

  const membershipRole = req.membership?.role_name ? String(req.membership.role_name).toUpperCase() : '';
  const targetUserId = req.params.userId || req.body.userId;

  // Users can only access their own data
  if (targetUserId && targetUserId !== req.user.id) {
    return res.status(403).json({
      success: false,
      message: 'Access denied. You can only access your own data.',
      user: { role: membershipRole, id: req.user.id },
      target: { userId: targetUserId }
    });
  }

  return next();
};

// Permission context interface
export interface PermissionContext {
  resource: string;
  action: string;
  userRole: string;
  allowedBranchIds: string[];
  targetBranchId?: string;
  isOwnData: boolean;
}

// Extend AuthRequest to include permission context
declare global {
  namespace Express {
    interface Request {
      permissionContext?: PermissionContext;
    }
  }
}
