import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getPrisma } from '../utils/db.util';

export interface AdminAuthRequest extends Request {
  admin?: {
    id: string;
    email: string;
    role: string; // SUPER_ADMIN, ADMIN, FINANCE, SUPPORT, HR
  };
}

/**
 * Admin authentication middleware
 * Separate from regular user auth - uses BackOfficeUser model
 */
export const adminAuthenticate = async (req: AdminAuthRequest, res: Response, next: NextFunction) => {
  try {
    // 1. Try Authorization header
    let token = req.header('Authorization')?.replace('Bearer ', '');

    // 2. Fallback: try backoffice-token cookie (parsed manually since cookie-parser is not installed)
    if (!token) {
      const cookies = (req.header('Cookie') || '').split(';').reduce<Record<string, string>>((acc, pair) => {
        const [key, ...rest] = pair.trim().split('=');
        if (key) acc[key.trim()] = rest.join('=').trim();
        return acc;
      }, {});
      token = cookies['backoffice-token'];
    }

    if (!token) {
      return res.status(401).json({ success: false, message: 'Unauthorized - No token provided' });
    }

    // Verify JWT token
    let decoded: any;
    try {
      if (!process.env.JWT_SECRET) {
        console.error('❌ JWT_SECRET is not set');
        return res.status(500).json({ message: 'Server configuration error. JWT_SECRET not set.' });
      }
      decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Verify this is an admin token
      if (!decoded.isAdmin) {
        return res.status(401).json({ success: false, message: 'Unauthorized - Invalid token type' });
      }
    } catch (jwtError: any) {
      return res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }

    // Get database client
    const prisma = await getPrisma();

    // Verify admin user still exists and is active
    const admin = await prisma.backOfficeUser.findUnique({
      where: { id: decoded.adminId },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true
      }
    });

    if (!admin) {
      return res.status(401).json({ success: false, message: 'Unauthorized - Admin not found' });
    }

    if (!admin.isActive) {
      return res.status(401).json({ success: false, message: 'Unauthorized - Admin account is inactive' });
    }

    // Attach admin to request
    req.admin = {
      id: admin.id,
      email: admin.email,
      role: admin.role
    };

    return next();
  } catch (error: any) {
    console.error('❌ Admin auth middleware error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Admin role guard middleware
 * Restricts access to specific admin roles
 */
export const adminRoleGuard = (...allowedRoles: string[]) => {
  return (req: AdminAuthRequest, res: Response, next: NextFunction) => {
    if (!req.admin) {
      return res.status(401).json({ success: false, message: 'Unauthorized - Admin not authenticated' });
    }

    const adminRole = req.admin.role.toUpperCase();
    const roles = allowedRoles.map(r => r.toUpperCase());

    if (roles.includes(adminRole)) {
      return next();
    }

    return res.status(403).json({ 
      success: false, 
      message: 'Access denied - Insufficient admin role',
      requiredRoles: allowedRoles,
      currentRole: req.admin.role
    });
  };
};

/**
 * Log admin action for audit trail
 * Enhanced version: includes IP, device, browser, request ID, old/new values, reason
 */
export interface AdminActionLogOptions {
  ip?: string;
  userAgent?: string;
  requestId?: string;
  oldValue?: any;
  newValue?: any;
  reason?: string;
}

export const logAdminAction = async (
  adminId: string,
  action: string,
  entityType: string,
  entityId?: string,
  metadata?: any,
  options?: AdminActionLogOptions
) => {
  try {
    const prisma = await getPrisma();
    const enrichedMetadata = {
      ...metadata,
      ...(options?.requestId && { requestId: options.requestId }),
      ...(options?.oldValue && { oldValue: options.oldValue }),
      ...(options?.newValue && { newValue: options.newValue }),
      ...(options?.reason && { reason: options.reason }),
      ...(options?.ip && { ip: options.ip }),
      ...(options?.userAgent && { userAgent: options.userAgent }),
    };
    await prisma.backOfficeActionLog.create({
      data: {
        adminId,
        action,
        entityType,
        entityId,
        metadata: enrichedMetadata as any
      }
    });
  } catch (error) {
    console.error('Failed to log admin action:', error);
    // Don't throw - logging failures shouldn't break the main operation
  }
};

/**
 * Convenience wrapper: extract IP + user-agent from an Express Request
 */
export const logAdminActionFromRequest = async (
  req: AdminAuthRequest,
  action: string,
  entityType: string,
  entityId?: string,
  metadata?: any,
  options?: Omit<AdminActionLogOptions, 'ip' | 'userAgent'>
) => {
  return logAdminAction(
    req.admin!.id,
    action,
    entityType,
    entityId,
    metadata,
    {
      ...options,
      ip: req.ip || req.socket.remoteAddress,
      userAgent: req.get('user-agent'),
      requestId: req.get('x-request-id') || options?.requestId,
    }
  );
};

/**
 * Log admin login
 */
export const logAdminLogin = async (
  adminId: string,
  ip?: string,
  userAgent?: string
) => {
  try {
    const prisma = await getPrisma();
    await prisma.backOfficeLoginLog.create({
      data: {
        adminId,
        ip,
        userAgent
      }
    });
  } catch (error) {
    console.error('Failed to log admin login:', error);
    // Don't throw - logging failures shouldn't break the main operation
  }
};
