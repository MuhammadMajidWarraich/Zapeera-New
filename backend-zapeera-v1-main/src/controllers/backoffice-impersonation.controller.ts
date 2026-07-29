import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getPrisma } from '../utils/db.util';
import { adminAuthenticate, adminRoleGuard, logAdminAction, AdminAuthRequest } from '../middleware/admin-auth.middleware';

/**
 * Generate impersonation token for admin to access business
 * Admins can access any business by generating a temporary token
 */
export const generateImpersonationToken = async (req: AdminAuthRequest, res: Response) => {
  try {
    const { businessId } = req.body;

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message: 'Business ID is required'
      });
    }

    const prisma = await getPrisma();

    // Verify business exists
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        name: true,
        createdBy: true
      }
    });

    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    // Generate impersonation token
    const impersonationToken = jwt.sign(
      {
        adminId: req.admin!.id,
        businessId: business.id,
        impersonation: true,
        isAdmin: true
      },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '1h' } // Short-lived token for security
    );

    // Log admin action
    await logAdminAction(
      req.admin!.id,
      'IMPERSONATE_BUSINESS',
      'Company',
      business.id,
      {
        businessId: business.id,
        businessName: business.name
      }
    );

    return res.json({
      success: true,
      message: 'Impersonation token generated successfully',
      data: {
        token: impersonationToken,
        businessId: business.id,
        businessName: business.name,
        expiresIn: '1h'
      }
    });
  } catch (error: any) {
    console.error('Generate impersonation token error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Validate impersonation token
 * Used by the main app to verify the impersonation token
 */
export const validateImpersonationToken = async (req: Request, res: Response) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        success: false,
        message: 'Token is required'
      });
    }

    let decoded: any;
    try {
      if (!process.env.JWT_SECRET) {
        return res.status(500).json({
          success: false,
          message: 'Server configuration error'
        });
      }
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError: any) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired token'
      });
    }

    // Verify this is an impersonation token
    if (!decoded.impersonation || !decoded.isAdmin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token type'
      });
    }

    // Verify admin still exists and is active
    const prisma = await getPrisma();
    const admin = await prisma.backOfficeUser.findUnique({
      where: { id: decoded.adminId },
      select: {
        id: true,
        email: true,
        role: true,
        isActive: true
      }
    });

    if (!admin || !admin.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Admin account is inactive or not found'
      });
    }

    // Verify business exists
    const business = await prisma.business.findUnique({
      where: { id: decoded.businessId },
      select: {
        id: true,
        name: true,
        isActive: true
      }
    });

    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    if (!business.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Business is inactive'
      });
    }

    return res.json({
      success: true,
      data: {
        adminId: admin.id,
        adminEmail: admin.email,
        adminRole: admin.role,
        businessId: business.id,
        businessName: business.name,
        impersonation: true
      }
    });
  } catch (error: any) {
    console.error('Validate impersonation token error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Get admin action logs
 */
export const getAdminActionLogs = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { adminId, action, entityType, limit = 50, offset = 0 } = req.query;

    const where: any = {};
    if (adminId) where.adminId = adminId as string;
    if (action) where.action = { contains: action as string, mode: 'insensitive' };
    if (entityType) where.entityType = entityType as string;

    const logs = await prisma.backOfficeActionLog.findMany({
      where,
      include: {
        admin: {
          select: {
            id: true,
            email: true,
            role: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      skip: Number(offset)
    });

    const total = await prisma.backOfficeActionLog.count({ where });

    return res.json({
      success: true,
      data: {
        logs,
        pagination: {
          total,
          limit: Number(limit),
          offset: Number(offset)
        }
      }
    });
  } catch (error: any) {
    console.error('Get admin action logs error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Get admin login logs
 */
export const getAdminLoginLogs = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { adminId, limit = 50, offset = 0 } = req.query;

    const where: any = {};
    if (adminId) where.adminId = adminId as string;

    const logs = await prisma.backOfficeLoginLog.findMany({
      where,
      include: {
        admin: {
          select: {
            id: true,
            email: true,
            role: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      skip: Number(offset)
    });

    const total = await prisma.backOfficeLoginLog.count({ where });

    return res.json({
      success: true,
      data: {
        logs,
        pagination: {
          total,
          limit: Number(limit),
          offset: Number(offset)
        }
      }
    });
  } catch (error: any) {
    console.error('Get admin login logs error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};
