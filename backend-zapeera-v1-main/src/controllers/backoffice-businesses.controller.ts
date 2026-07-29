import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { adminAuthenticate, adminRoleGuard, logAdminAction, AdminAuthRequest } from '../middleware/admin-auth.middleware';

/**
 * Get all businesses with subscription details
 */
export const getAllBusinesses = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { status, search } = req.query;
    
    const where: any = {};
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } }
      ];
    }
    
    const businesses = await prisma.business.findMany({
      where,
      include: {
        _count: {
          select: {
            branches: true,
            memberships: true
          }
        },
        memberships: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                username: true
              }
            },
            role: {
              select: {
                id: true,
                name: true
              }
            }
          }
        },
        businessSubscription: true
      },
      orderBy: { createdAt: 'desc' }
    });

    // Enrich with subscription status and owner info
    const enrichedBusinesses = (businesses as any[]).map(business => {
      const latestSubscription = business.businessSubscription;
      // Find owner from memberships (user with OWNER role)
      const ownerMembership = business.memberships?.find((m: any) => 
        m.role?.name === 'OWNER' || m.role?.name === 'owner'
      );
      const owner = ownerMembership?.user || null;
      
      // Count staff (all memberships except owner)
      const staffCount = business.memberships?.filter((m: any) => 
        m.role?.name !== 'OWNER' && m.role?.name !== 'owner'
      ).length || 0;
      
      return {
        ...business,
        owner: owner ? {
          id: owner.id,
          name: owner.name,
          email: owner.email
        } : null,
        staffCount,
        subscription: latestSubscription ? {
          id: latestSubscription.id,
          status: latestSubscription.status,
          isTrial: latestSubscription.isTrial || false,
          planName: latestSubscription.plan?.name || 'Unknown',
          amount: latestSubscription.plan?.price || 0,
          startedAt: latestSubscription.startDate || latestSubscription.createdAt,
          endsAt: latestSubscription.endDate
        } : null,
        subscriptionStatus: latestSubscription?.status || 'NONE',
        isTrial: latestSubscription?.isTrial || false
      };
    });

    return res.json({
      success: true,
      data: enrichedBusinesses
    });
  } catch (error: any) {
    console.error('Get all businesses error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Get business by ID with full details
 */
export const getBusinessById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const prisma = await getPrisma();
    
    const business = await prisma.business.findUnique({
      where: { id },
      include: {
        branches: {
          select: {
            id: true,
            name: true,
            address: true,
            phone: true,
            isActive: true
          }
        },
        memberships: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                username: true
              }
            },
            role: {
              select: {
                name: true
              }
            }
          }
        },
        businessSubscription: {
          include: {
            plan: true
          }
        }
      }
    });

    if (!business) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    return res.json({
      success: true,
      data: business
    });
  } catch (error: any) {
    console.error('Get business error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Update business details
 */
export const updateBusiness = async (req: AdminAuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, address, phone, email, website, businessType, isActive } = req.body;

    const prisma = await getPrisma();

    const existingBusiness = await prisma.business.findUnique({
      where: { id }
    });

    if (!existingBusiness) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    const business = await prisma.business.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(address !== undefined && { address }),
        ...(phone !== undefined && { phone }),
        ...(email !== undefined && { email }),
        ...(website !== undefined && { website }),
        ...(businessType !== undefined && { businessType }),
        ...(isActive !== undefined && { isActive })
      }
    });

    // Log admin action
    await logAdminAction(
      req.admin!.id,
      'UPDATE_BUSINESS',
      'Company',
      business.id,
      {
        businessId: business.id,
        businessName: business.name
      }
    );

    return res.json({
      success: true,
      message: 'Business updated successfully',
      data: business
    });
  } catch (error: any) {
    console.error('Update business error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Deactivate/Activate business
 */
export const toggleBusinessStatus = async (req: AdminAuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (isActive === undefined) {
      return res.status(400).json({
        success: false,
        message: 'isActive status is required'
      });
    }

    const prisma = await getPrisma();

    const business = await prisma.business.update({
      where: { id },
      data: { isActive }
    });

    // Log admin action
    await logAdminAction(
      req.admin!.id,
      'TOGGLE_BUSINESS_STATUS',
      'Company',
      business.id,
      {
        businessId: business.id,
        businessName: business.name,
        isActive
      }
    );

    return res.json({
      success: true,
      message: `Business ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: business
    });
  } catch (error: any) {
    console.error('Toggle business status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Get business statistics
 */
export const getBusinessStats = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    
    const totalBusinesses = await prisma.business.count();
    const activeBusinesses = await prisma.business.count({
      where: { isActive: true }
    });
    
    const activeSubscriptions = await prisma.businessSubscription.count({
      where: { status: 'ACTIVE' }
    });
    
    const trialSubscriptions = await prisma.businessSubscription.count({
      where: { status: 'TRIAL' }
    });
    
    const expiredSubscriptions = await prisma.businessSubscription.count({
      where: { status: 'EXPIRED' }
    });

    return res.json({
      success: true,
      data: {
        totalBusinesses,
        activeBusinesses,
        inactiveBusinesses: totalBusinesses - activeBusinesses,
        activeSubscriptions,
        trialSubscriptions,
        expiredSubscriptions
      }
    });
  } catch (error: any) {
    console.error('Get business stats error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Delete business by ID
 */
export const deleteBusiness = async (req: AdminAuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const prisma = await getPrisma();

    const existingBusiness = await prisma.business.findUnique({
      where: { id }
    });

    if (!existingBusiness) {
      return res.status(404).json({
        success: false,
        message: 'Business not found'
      });
    }

    // Delete related records first (branches, memberships, subscriptions)
    await prisma.$transaction([
      prisma.businessSubscription.deleteMany({ where: { businessId: id } }),
      prisma.membership.deleteMany({ where: { businessId: id } }),
      prisma.branch.deleteMany({ where: { companyId: id } }),
      prisma.business.delete({ where: { id } })
    ]);

    // Log admin action
    await logAdminAction(
      req.admin!.id,
      'DELETE_BUSINESS',
      'Company',
      id,
      {
        businessId: id,
        businessName: existingBusiness.name
      }
    );

    return res.json({
      success: true,
      message: 'Business deleted successfully'
    });
  } catch (error: any) {
    console.error('Delete business error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};
