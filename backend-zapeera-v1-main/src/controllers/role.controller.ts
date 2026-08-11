import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { isBusinessCreator } from '../utils/membership-bridge.util';
import { ROLE_PERMISSIONS, getRolePermissions as getRolePermissionsConfig, getAccessibleResources as getAccessibleResourcesConfig, getAllowedActions as getAllowedActionsConfig, hasPermission } from '../config/permissions';
import { AuthRequest } from '../middleware/auth.middleware';
import { syncAfterOperation, pullLatestFromLive } from '../utils/sync-helper';

// Get all available roles and their permissions
export const getRoles = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    // Allow access for backoffice admins (SUPER_ADMIN or ADMIN)
    const adminRole = (req as any).adminRole ? String((req as any).adminRole).toUpperCase() : '';
    if (adminRole === 'SUPER_ADMIN' || adminRole === 'ADMIN') {
      // Transform roles to include moduleAccess object
      const transformedRoles = ROLE_PERMISSIONS.map((role: any) => ({
        ...role,
        moduleAccess: {} // Initialize with empty module access
      }));
      // Return as object keyed by role name for easier frontend access
      const rolesObject = transformedRoles.reduce((acc: any, role: any) => {
        acc[role.role] = role;
        return acc;
      }, {});
      res.json({
        success: true,
        data: rolesObject
      });
      return;
    }

    // Check if user has admin-level role (OWNER or higher)
    const membershipRole = req.membership?.role_name ? String(req.membership.role_name).toUpperCase() : '';
    if (membershipRole !== 'OWNER') {
      res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient permissions.'
      });
      return;
    }

    // Transform roles to include moduleAccess object
    const transformedRoles = ROLE_PERMISSIONS.map((role: any) => ({
      ...role,
      moduleAccess: {} // Initialize with empty module access
    }));

    // Return as object keyed by role name for easier frontend access
    const rolesObject = transformedRoles.reduce((acc: any, role: any) => {
      acc[role.role] = role;
      return acc;
    }, {});

    res.json({
      success: true,
      data: rolesObject
    });
  } catch (error: any) {
    console.error('Get roles error:', error);
    console.error('Error stack:', error?.stack);
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error',
      error: error?.name
    });
  }
};

// Get permissions for a specific role
export const getRolePermissions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const { role } = req.params;

    // Check if user has admin-level role (OWNER or higher)
    const membershipRole = req.membership?.role_name ? String(req.membership.role_name).toUpperCase() : '';
    if (membershipRole !== 'OWNER') {
      res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient permissions.'
      });
      return;
    }

    const permissions = getRolePermissionsConfig(role);
    const accessibleResources = getAccessibleResourcesConfig(role);

    res.json({
      success: true,
      data: {
        role,
        permissions,
        accessibleResources
      }
    });
  } catch (error) {
    console.error('Get role permissions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get user's current permissions
export const getUserPermissions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    // Get role from membership (business-scoped)
    const membershipRole = req.membership?.role_name ? String(req.membership.role_name).toUpperCase() : '';
    const { branchId } = req.user;
    const permissions = getRolePermissionsConfig(membershipRole);
    const accessibleResources = getAccessibleResourcesConfig(membershipRole);

    res.json({
      success: true,
      data: {
        user: {
          role: membershipRole,
          branchId
        },
        permissions,
        accessibleResources
      }
    });
  } catch (error) {
    console.error('Get user permissions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Check if user has specific permission
export const checkPermission = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const { resource, action } = req.query;
    const membershipRole = req.membership?.role_name ? String(req.membership.role_name).toUpperCase() : '';
    const { branchId } = req.user;
    const targetBranchId = req.query.targetBranchId as string;
    const isOwnData = req.query.isOwnData === 'true';

    if (!resource || !action) {
      res.status(400).json({
        success: false,
        message: 'Resource and action parameters are required'
      });
      return;
    }

    const hasAccess = hasPermission(membershipRole, resource as string, action as string, branchId, targetBranchId, isOwnData);

    res.json({
      success: true,
      data: {
        hasAccess,
        user: { role: membershipRole, branchId },
        permission: { resource, action, targetBranchId, isOwnData }
      }
    });
  } catch (error) {
    console.error('Check permission error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get allowed actions for a resource
export const getAllowedActions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const { resource } = req.params;
    const membershipRole = req.membership?.role_name ? String(req.membership.role_name).toUpperCase() : '';

    const allowedActions = getAllowedActionsConfig(membershipRole, resource);

    res.json({
      success: true,
      data: {
        resource,
        userRole: membershipRole,
        allowedActions
      }
    });
  } catch (error) {
    console.error('Get allowed actions error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update user role
export const updateUserRole = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    // Check if user has admin-level role (OWNER or higher)
    const membershipRole = req.membership?.role_name ? String(req.membership.role_name).toUpperCase() : '';
    if (membershipRole !== 'OWNER') {
      res.status(403).json({
        success: false,
        message: 'Access denied. Insufficient permissions.'
      });
      return;
    }

    const { userId } = req.params;
    const { role: roleRaw, businessId } = req.body;
    const role = typeof roleRaw === 'string' ? roleRaw.trim().toUpperCase() : '';

    if (!businessId) {
      res.status(400).json({
        success: false,
        message: 'businessId is required in request body'
      });
      return;
    }

    if (!['OWNER', 'USER', 'MANAGER', 'CASHIER'].includes(role)) {
      res.status(400).json({
        success: false,
        message: 'Invalid role. Must be one of: OWNER, USER, MANAGER, CASHIER (business-scoped only)'
      });
      return;
    }

    // The business creator must stay OWNER: demoting them removes the
    // business's ownership entirely.
    const prisma = await getPrisma();
    if (role !== 'OWNER' && (await isBusinessCreator(prisma, businessId, userId))) {
      res.status(400).json({
        success: false,
        message: 'The business creator cannot be demoted from OWNER'
      });
      return;
    }

    // Update membership role instead of user table
    // First, find or create the role
    
    // First, find or create the role
    let roleRecord = await prisma.role.findFirst({
      where: {
        businessId: businessId,
        name: role
      }
    });
    
    if (!roleRecord) {
      roleRecord = await prisma.role.create({
        data: {
          businessId: businessId,
          name: role
        }
      });
    }

    // Update the membership with the new role
    const updatedMembership = await prisma.membership.update({
      where: {
        unique_user_business: {
          userId: userId,
          businessId: businessId
        }
      },
      data: { roleId: roleRecord.id },
      select: {
        id: true,
        userId: true,
        businessId: true,
        roleId: true,
        status: true
      }
    });

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('membership', 'update', updatedMembership).catch(err => {
      console.error('[Sync] Membership role update sync failed:', err.message);
    });

    res.json({
      success: true,
      data: updatedMembership,
      message: 'User role updated in business membership successfully'
    });
  } catch (error) {
    console.error('Update user role error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};
