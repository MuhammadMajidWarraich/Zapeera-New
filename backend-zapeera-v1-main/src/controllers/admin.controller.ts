import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { getPrisma } from '../utils/db.util';
import Joi from 'joi';
import { notifyUserDeactivation, notifyUserReactivation } from '../routes/sse.routes';
import { AuthRequest } from '../middleware/auth.middleware';
import { syncAfterOperation, pullLatestFromLive } from '../utils/sync-helper';
import { migrateLegacyUserContextToMemberships } from '../utils/migration.util';

// Validation schemas
const createAdminSchema = Joi.object({
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  phone: Joi.string().allow('').optional(),
  company: Joi.string().required(),
  plan: Joi.string().valid('basic', 'premium', 'enterprise').default('basic'),
  password: Joi.string().min(6).required()
});

const updateAdminSchema = Joi.object({
  name: Joi.string(),
  email: Joi.string().email(),
  phone: Joi.string(),
  company: Joi.string(),
  plan: Joi.string().valid('basic', 'premium', 'enterprise'),
  isActive: Joi.boolean()
});

const getBusinessOwnerUserIds = async (prisma: any): Promise<string[]> => {
  const ownerIds = new Set<string>();

  const selfOwnedUsers = await prisma.$queryRaw<any[]>`
    SELECT DISTINCT "createdBy" AS id
    FROM businesses
    WHERE "createdBy" IS NOT NULL
  `;
  selfOwnedUsers.forEach((user: any) => {
    if (user?.id) {
      ownerIds.add(String(user.id));
    }
  });

  // CompanyMember model is deprecated. Access logic moved entirely to memberships and Company.createdBy.

  const membershipOwners = await prisma.$queryRaw<any[]>`
    SELECT DISTINCT m."userId"
    FROM memberships m
    LEFT JOIN roles r ON r.id = m."roleId"
    WHERE m.status = 'ACTIVE'
      AND r.name = 'OWNER'
  `;
  membershipOwners.forEach((row: any) => {
    if (row?.userId) {
      ownerIds.add(String(row.userId));
    }
  });

  return Array.from(ownerIds);
};

const isBusinessOwner = async (prisma: any, userId: string): Promise<boolean> => {
  const [selfOwnedUserCount, membershipOwnerRows] = await Promise.all([
    prisma.business.count({
      where: {
        createdBy: userId,
        isActive: true
      }
    }),
    prisma.$queryRaw<any[]>`
      SELECT 1
      FROM memberships m
      LEFT JOIN roles r ON r.id = m."roleId"
      WHERE m."userId" = ${userId}
        AND m.status = 'ACTIVE'
        AND r.name = 'OWNER'
      LIMIT 1
    `
  ]);

  return selfOwnedUserCount > 0 || membershipOwnerRows.length > 0;
};

// Get all admins (Platform Admin only)
export const getAdmins = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { page = 1, limit = 10, search = '' } = req.query;

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const ownerUserIds = await getBusinessOwnerUserIds(prisma);
    if (ownerUserIds.length === 0) {
      res.json({
        success: true,
        data: {
          admins: [],
          pagination: {
            page: Number(page),
            limit: Number(limit),
            total: 0,
            pages: 0
          }
        }
      });
      return;
    }

    const where: any = {
      id: { in: ownerUserIds },
      ...(search && {
        OR: [
          { name: { contains: search as string } },
          { email: { contains: search as string } }
        ]
      })
    };

    const [admins, total] = await Promise.all([
      prisma.zapeeraUser.findMany({
        where,
        skip,
        take,
        include: {
          _count: {
            select: {
              sales: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.zapeeraUser.count({ where })
    ]);

    // Calculate additional stats for each admin
    const adminsWithStats = await Promise.all(
      admins.map(async (admin: any) => {
        // Get the business owned by this admin
        const company = await prisma.business.findFirst({
          where: { createdBy: admin.id, isActive: true },
          select: { id: true, name: true, phone: true, address: true }
        });

        // Get total sales for this admin
        const salesStats = await prisma.sale.aggregate({
          where: { userId: admin.id },
          _sum: { totalAmount: true },
          _count: { id: true }
        });

        // Get total users in all branches of this company
        const userCount = company ? await prisma.membership.count({
          where: {
            businessId: company.id,
            status: 'ACTIVE'
          }
        }) : 0;

        // Get manager count
        const managerCount = company ? await prisma.membership.count({
          where: {
            businessId: company.id,
            role: { name: 'MANAGER' },
            status: 'ACTIVE'
          }
        }) : 0;

        // Get plan info from Settings
        const planSetting = await prisma.settings.findUnique({
          where: {
            createdBy_key: {
              createdBy: `subscription_account_${admin.id}`,
              key: 'plan_assignment'
            }
          }
        });
        let plan = 'basic';
        if (planSetting?.value) {
          try {
            const parsed = JSON.parse(planSetting.value);
            plan = parsed.planId?.split('-').pop() || 'basic';
          } catch (e) {}
        }

        return {
          id: admin.id,
          name: admin.name,
          email: admin.email,
          phone: company?.phone || '',
          company: company?.name || '',
          address: company?.address || '',
          userCount,
          managerCount,
          totalSales: salesStats._sum.totalAmount || 0,
          lastActive: admin.updatedAt.toISOString().split('T')[0],
          status: admin.isActive ? 'active' : 'inactive',
          plan,
          createdAt: admin.createdAt.toISOString().split('T')[0],
          subscriptionEnd: '2024-12-31'
        };
      })
    );

    res.json({
      success: true,
      data: {
        admins: adminsWithStats,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      }
    });
    return;
  } catch (error) {
    console.error('Get admins error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
    return;
  }
};

// Get admin by ID
export const getAdmin = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    const isOwner = await isBusinessOwner(prisma, id);
    if (!isOwner) {
      res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
      return;
    }

    const admin = await prisma.zapeeraUser.findUnique({
      where: { id }
    });

    if (!admin) {
      res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
      return;
    }

    // Get stats for this admin
    const company = await prisma.business.findFirst({
      where: { createdBy: id, isActive: true },
      select: { id: true, name: true, phone: true }
    });

    const salesStats = await prisma.sale.aggregate({
      where: { userId: admin.id },
      _sum: { totalAmount: true },
      _count: { id: true }
    });

    const userCount = company ? await prisma.membership.count({
      where: {
        businessId: company.id,
        status: 'ACTIVE'
      }
    }) : 0;

    const managerCount = company ? await prisma.membership.count({
      where: {
        businessId: company.id,
        role: { name: 'MANAGER' },
        status: 'ACTIVE'
      }
    }) : 0;

    const adminWithStats = {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      phone: company?.phone || '',
      company: company?.name || '',
      userCount,
      managerCount,
      totalSales: salesStats._sum.totalAmount || 0,
      lastActive: admin.updatedAt.toISOString().split('T')[0],
      status: admin.isActive ? 'active' : 'inactive',
      plan: 'premium',
      createdAt: admin.createdAt.toISOString().split('T')[0],
      subscriptionEnd: '2024-12-31'
    };

    res.json({
      success: true,
      data: adminWithStats
    });
  } catch (error) {
    console.error('Get admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Create admin
export const createAdmin = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { error } = createAdminSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
      return;
    }

    const { name, email, phone, company, plan, password } = req.body;

    // Set default phone if empty
    const finalPhone = phone || '+92 300 0000000';

    // Check if admin already exists
    const existingAdmin = await prisma.zapeeraUser.findFirst({
      where: {
        email
      }
    });

    if (existingAdmin) {
      res.status(400).json({
        success: false,
        message: 'Admin with this email or company already exists'
      });
      return;
    }

    // Generate username and hash password
    const username = email.split('@')[0] + '_admin';
    const hashedPassword = await require('bcryptjs').hash(password, parseInt(process.env.BCRYPT_ROUNDS || '12'));

    // Get the current user (super admin) who is creating this admin
    const currentUser = req.user;
    if (!currentUser) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
      return;
    }

    // Create admin user, company, branch, and membership in a transaction
    const result = await prisma.$transaction(async (tx: any) => {
      // Create a new company first
      const newCompany = await tx.business.create({
        data: {
          name: company,
          description: `Company for ${name}`,
          address: 'Default Address',
          phone: finalPhone,
          email,
          businessType: 'STORE',
          createdBy: currentUser.id // Temporary, will be updated below
        }
      });

      // Create a new branch for this admin
      const branch = await tx.branch.create({
        data: {
          name: `${company} - Main Branch`,
          address: 'Default Address',
          phone: finalPhone,
          email,
          companyId: newCompany.id
        }
      });

      // Create admin user
      const admin = await tx.zapeeraUser.create({
        data: {
          username,
          email,
          password: hashedPassword,
          name,
          createdBy: currentUser.id, // Temporary
          isActive: true
        }
      });

      // Update company and admin creator info
      await tx.business.update({
        where: { id: newCompany.id },
        data: { createdBy: admin.id }
      });

      await tx.zapeeraUser.update({
        where: { id: admin.id },
        data: { createdBy: admin.id }
      });

      // Create OWNER role for this business
      const ownerRole = await tx.role.create({
        data: {
          businessId: newCompany.id,
          name: 'OWNER'
        }
      });

      // Create Membership
      const membership = await tx.membership.create({
        data: {
          userId: admin.id,
          businessId: newCompany.id,
          roleId: ownerRole.id,
          status: 'ACTIVE'
        }
      });

      // Link membership to branch
      await tx.$executeRaw`
        INSERT INTO membership_branches ("id", "membershipId", "branchId", "createdAt", "updatedAt")
        VALUES (${randomUUID()}, ${membership.id}, ${branch.id}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `;

      return { admin, company: newCompany, branch };
    });

    const { admin, company: newCompany, branch } = result;

    const adminWithStats = {
      id: admin.id,
      name: admin.name,
      email: admin.email,
      phone: branch?.phone || '',
      company: newCompany?.name || '',
      userCount: 0,
      managerCount: 0,
      totalSales: 0,
      lastActive: admin.updatedAt.toISOString().split('T')[0],
      status: admin.isActive ? 'active' : 'inactive',
      plan,
      createdAt: admin.createdAt.toISOString().split('T')[0],
      subscriptionEnd: '2024-12-31'
    };

    res.status(201).json({
      success: true,
      data: adminWithStats,
      message: 'Admin created successfully'
    });
  } catch (error) {
    console.error('Create admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update admin
export const updateAdmin = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const { error } = updateAdminSchema.validate(req.body);

    if (error) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
      return;
    }

    const updateData = { ...req.body };
    delete (updateData as any).role;

    // Check if admin exists and is a business owner
    const existingAdmin = await prisma.zapeeraUser.findUnique({ where: { id } });
    const isOwner = existingAdmin ? await isBusinessOwner(prisma, id) : false;

    if (!existingAdmin || !isOwner) {
      res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
      return;
    }

    // Update admin
    const admin = await prisma.zapeeraUser.update({
      where: { id },
      data: updateData
    });

    // Update company if company name changed
    if (updateData.company) {
      const company = await prisma.business.findFirst({
        where: { createdBy: id, isActive: true }
      });
      if (company) {
        await prisma.business.update({
          where: { id: company.id },
          data: {
            name: updateData.company,
            phone: updateData.phone || company.phone,
          }
        });
      }
    }

    // Notify user if status changed
    if (updateData.isActive !== undefined) {
      if (updateData.isActive === false) {
        // Admin was deactivated - notify them
        notifyUserDeactivation(id);

        // Also deactivate all users under this admin
        // TODO: Implement membership-based user deactivation when needed
      } else if (updateData.isActive === true) {
        // Admin was reactivated - notify them
        notifyUserReactivation(id);
      }
    }

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('user', 'update', admin).catch(err => {
      console.error('[Sync] Admin update sync failed:', err.message);
    });

    res.json({
      success: true,
      data: admin,
      message: 'Admin updated successfully'
    });
  } catch (error) {
    console.error('Update admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Delete admin
export const deleteAdmin = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    // Check if admin exists and is a business owner
    const existingAdmin = await prisma.zapeeraUser.findUnique({ where: { id } });
    const isOwner = existingAdmin ? await isBusinessOwner(prisma, id) : false;

    if (!existingAdmin || !isOwner) {
      res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
      return;
    }

    console.log(`🗑️  Deleting admin: ${existingAdmin.name} (${existingAdmin.username})...`);

    // Hard delete - permanently remove admin and all related data
    await prisma.$transaction(async (tx) => {
      // Get all products belonging to this admin
      const adminProducts = await tx.product.findMany({
        where: { createdBy: id },
        select: { id: true }
      });

      const productIds = adminProducts.map((p: any) => p.id);

      console.log(`   📊 Found ${productIds.length} products to delete`);

      // Delete in the correct order to avoid foreign key constraints

      // 1. Delete refund items first
      await tx.refundItem.deleteMany({
        where: { createdBy: id }
      });

      // 2. Delete refunds
      await tx.refund.deleteMany({
        where: {
          OR: [
            { refundedBy: id },
            { createdBy: id }
          ]
        }
      });

      // 3. Delete sale items
      await tx.saleItem.deleteMany({
        where: { createdBy: id }
      });

      // 4. Delete receipts
      await tx.receipt.deleteMany({
        where: {
          OR: [
            { userId: id },
            { createdBy: id }
          ]
        }
      });

      // 5. Delete sales
      await tx.sale.deleteMany({
        where: {
          OR: [
            { userId: id },
            { createdBy: id }
          ]
        }
      });

      // 6. Delete stock movements that reference admin's products
      if (productIds.length > 0) {
        await tx.stockMovement.deleteMany({
          where: {
            OR: [
              { createdBy: id },
              { productId: { in: productIds } }
            ]
          }
        });
      } else {
        await tx.stockMovement.deleteMany({
          where: { createdBy: id }
        });
      }

      // 7. Delete customers
      await tx.customer.deleteMany({
        where: { createdBy: id }
      });

      // 8. Delete products
      await tx.product.deleteMany({
        where: { createdBy: id }
      });

      // 9. Delete suppliers
      await tx.supplier.deleteMany({
        where: { createdBy: id }
      });

      // 10. Delete categories
      await tx.category.deleteMany({
        where: { createdBy: id }
      });

      // 11. Delete branches
      await tx.branch.deleteMany({
        where: { createdBy: id }
      });

      // 12. Delete settings
      await tx.settings.deleteMany({
        where: { createdBy: id }
      });

      // 13. Delete all users under this admin (managers, cashiers, etc.) including the admin itself
      await tx.zapeeraUser.deleteMany({
        where: {
          OR: [
            { createdBy: id },
            { createdBy: id },
            { id: id } // Include the admin itself
          ]
        }
      });
    });

    console.log(`✅ Admin ${existingAdmin.name} and all related data deleted successfully`);

    res.json({
      success: true,
      message: 'Admin and all related data permanently deleted from database'
    });
  } catch (error) {
    console.error('Delete admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get admin users
export const getAdminUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { createdBy } = req.params;

    // Check if admin exists and is a business owner
    const admin = await prisma.zapeeraUser.findUnique({
      where: { id: createdBy }
    });

    if (!admin || !(await isBusinessOwner(prisma, createdBy))) {
      res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
      return;
    }

    // Get the business owned by this admin
    const company = await prisma.business.findFirst({
      where: { createdBy: admin.id, isActive: true },
      select: { id: true }
    });

    if (!company) {
      res.json({
        success: true,
        data: []
      });
      return;
    }

    // Get all users who have a membership in this business
    const users = await prisma.zapeeraUser.findMany({
      where: {
        memberships: {
          some: {
            businessId: company.id,
            status: 'ACTIVE'
          }
        },
        isActive: true,
        id: { not: createdBy }
      },
      select: {
        id: true,
        name: true,
        email: true,
        isActive: true,
        createdAt: true,
        updatedAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const roleByUserId = new Map<string, string>();
    try {
      const membershipRoles = await prisma.$queryRaw<any[]>`
        SELECT m."userId", r.name AS roleName
        FROM memberships m
        LEFT JOIN roles r ON r.id = m."roleId"
        WHERE m.status = 'ACTIVE'
          AND m."businessId" = ${company.id}
          AND r.name IN ('MANAGER', 'CASHIER')
      `;
      membershipRoles.forEach(row => {
        if (row?.userId && row?.roleName) {
          roleByUserId.set(String(row.userId), String(row.roleName).toUpperCase());
        }
      });
    } catch (roleQueryError) {
      console.warn('Failed to resolve membership roles for admin users:', roleQueryError);
    }

    const usersWithStats = users.map((user: any) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      adminId: createdBy,
      lastActive: user.updatedAt.toISOString().split('T')[0],
      status: user.isActive ? 'active' : 'inactive',
      role: (roleByUserId.get(user.id) || 'USER') as 'ADMIN' | 'OWNER' | 'MANAGER' | 'CASHIER'
    }));

    res.json({
      success: true,
      data: usersWithStats
    });
  } catch (error) {
    console.error('Get admin users error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get admin dashboard stats
export const getSuperAdminStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const ownerUserIds = await getBusinessOwnerUserIds(prisma);
    const activeOwnerUsers = ownerUserIds.length > 0
      ? await prisma.zapeeraUser.findMany({
          where: {
            id: { in: ownerUserIds },
            isActive: true
          },
          select: { id: true }
        })
      : [];

    const activeOwnerIds = activeOwnerUsers.map(user => user.id);
    const totalAdmins = activeOwnerIds.length;

    const totalUsersWhere: any = {
      isActive: true,
      memberships: {
        some: {}
      }
    };
    if (activeOwnerIds.length > 0) {
      totalUsersWhere.id = { notIn: activeOwnerIds };
    }

    const totalUsers = await prisma.zapeeraUser.count({ where: totalUsersWhere });

    const salesStats = await prisma.sale.aggregate({
      _sum: { totalAmount: true },
      _count: { id: true }
    });

    const pricingPlans = await prisma.plan.findMany();
    
    // Check both ledger and legacy assignments to bridge the gap
    const ledgerSubscriptions = await prisma.businessSubscription.findMany({
      where: { status: { in: ['ACTIVE', 'TRIAL'] } }
    });
    
    const planAssignments = await prisma.settings.findMany({
      where: { key: 'plan_assignment' }
    });

    let totalSubscriptionRevenue = 0;
    let totalSubscriptions = Math.max(ledgerSubscriptions.length, planAssignments.length);
    let newSubscriptionsThisMonth = 0;

    const currentMonthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    if (ledgerSubscriptions.length > 0) {
      ledgerSubscriptions.forEach(sub => {
        const plan = pricingPlans.find(p => p.id === sub.planId);
        if (plan) totalSubscriptionRevenue += plan.price;
        if (sub.createdAt >= currentMonthStart) newSubscriptionsThisMonth++;
      });
    }

    const activePharmacies = await prisma.business.count({
      where: { isActive: true }
    });

    // Top Performing Businesses
    const companies = await prisma.business.findMany({
      where: { isActive: true },
      include: {
        sales: {
          select: { totalAmount: true }
        }
      }
    });

    const topPerformingBusinesses = companies.map(c => ({
      id: c.id,
      name: c.name,
      revenue: c.sales.reduce((sum, s) => sum + (s.totalAmount || 0), 0)
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 5);

    // Subscription Alerts
    const subscriptionAlerts: any[] = [];
    const sevenDaysFromNow = new Date();
    sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

    if (ledgerSubscriptions.length > 0) {
      for (const sub of ledgerSubscriptions) {
        if (sub.currentPeriodEnd && sub.currentPeriodEnd <= sevenDaysFromNow) {
          const biz = await prisma.business.findUnique({ where: { id: sub.businessId }, select: { name: true } });
          const endDateMs = sub.currentPeriodEnd.getTime();
          subscriptionAlerts.push({
            id: sub.id,
            businessName: biz?.name || 'Unknown',
            type: endDateMs < Date.now() ? 'expired' : 'expiring',
            message: endDateMs < Date.now() ? 'Plan Expired' : `Plan expires in ${Math.ceil((endDateMs - Date.now()) / (1000 * 60 * 60 * 24))} days`,
            severity: endDateMs < Date.now() ? 'danger' : 'warning'
          });
        }
      }
    }

    res.json({
      success: true,
      data: {
        totalAdmins,
        totalUsers,
        totalSales: salesStats._sum.totalAmount || 0,
        totalSubscriptions,
        totalSubscriptionRevenue,
        activeSubscriptions: totalSubscriptions,
        newSubscriptionsThisMonth,
        activeAdmins: totalAdmins,
        activePharmacies,
        topPerformingBusinesses,
        subscriptionAlerts
      }
    });
  } catch (error) {
    console.error('Get super admin stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load stats'
    });
  }
};

export const getRecentActivities = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    
    // Get recent user creations as activities
    const recentUsers = await prisma.zapeeraUser.findMany({
      select: {
        id: true,
        username: true,
        name: true,
        email: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    // Get recent company creations as activities
    const recentCompanies = await prisma.business.findMany({
      select: {
        id: true,
        name: true,
        createdAt: true,
        createdBy: true
      },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    // Map to activities format
    const activities = [
      ...recentUsers.map(user => ({
        id: `user_${user.id}`,
        type: 'user_registered' as const,
        message: `User registered: ${user.name}`,
        details: `Email: ${user.email}`,
        timestamp: user.createdAt.toISOString(),
        adminId: undefined,
        adminName: undefined
      })),
      ...recentCompanies.map(company => ({
        id: `company_${company.id}`,
        type: 'company_created' as const,
        message: `Business created: ${company.name}`,
        details: `ID: ${company.id}`,
        timestamp: company.createdAt.toISOString(),
        adminId: company.createdBy,
        adminName: undefined
      }))
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 20);

    res.json({
      success: true,
      data: activities
    });
  } catch (error) {
    console.error('Get recent activities error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to load activities',
      data: []
    });
  }
};



/**
 * PLAN MANAGEMENT
 */
export const getPlans = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const plans = await prisma.plan.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: plans });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch plans' });
  }
};

export const createPlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { name, price, durationDays, isTrial, maxBranches, maxUsers, maxCounters, features } = req.body;
    const plan = await prisma.plan.create({
      data: { name, price, durationDays, isTrial, maxBranches, maxUsers, maxCounters, features }
    });
    res.json({ success: true, data: plan });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to create plan' });
  }
};

export const updatePlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const updateData = req.body;
    const plan = await prisma.plan.update({
      where: { id },
      data: updateData
    });
    res.json({ success: true, data: plan });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update plan' });
  }
};

export const deactivatePlan = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    await prisma.plan.update({
      where: { id },
      data: { isActive: false }
    });
    res.json({ success: true, message: 'Plan deactivated' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to deactivate plan' });
  }
};

/**
 * SUBSCRIPTION MANAGEMENT
 */
export const getSubscriptions = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const subscriptions = await prisma.businessSubscription.findMany({
      include: {
        business: {
          select: {
            id: true,
            name: true,
            businessType: true,
            createdBy: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    const plans = await prisma.plan.findMany();
    const ownerIds = [...new Set(subscriptions.map(s => s.business.createdBy).filter(Boolean))] as string[];
    const owners = await prisma.zapeeraUser.findMany({
      where: { id: { in: ownerIds } },
      select: { id: true, name: true, email: true }
    });

    const now = new Date();
    const data = subscriptions.map(sub => {
      const plan = plans.find(p => p.id === sub.planId);
      const owner = owners.find(o => o.id === sub.business.createdBy);
      
      // Calculate actual subscription status based on dates
      const endDate = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : new Date(0);
      const isPeriodValid = endDate.getTime() > now.getTime();
      const daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));
      
      // Determine effective status: if database status is ACTIVE/TRIAL but period expired, show as EXPIRED
      let effectiveStatus = sub.status;
      if ((sub.status === 'ACTIVE' || sub.status === 'TRIAL') && !isPeriodValid) {
        effectiveStatus = 'EXPIRED';
      }
      
      return {
        id: sub.id,
        businessId: sub.businessId,
        businessName: sub.business.name,
        businessType: (sub.business as any).businessType || 'retail',
        ownerName: owner?.name || 'Unknown',
        ownerEmail: owner?.email || 'Unknown',
        planName: plan?.name || 'Unknown',
        planId: sub.planId,
        status: effectiveStatus,
        startDate: sub.createdAt,
        endDate: sub.currentPeriodEnd,
        daysRemaining,
        amount: plan?.price || 0
      };
    });

    res.json({ success: true, data });
  } catch (error) {
    console.error('Get subscriptions error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch subscriptions' });
  }
};

export const assignSubscription = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { businessId, planId, manualEndDate } = req.body;

    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) {
      res.status(404).json({ success: false, message: 'Plan not found' });
      return;
    }

    // Mark previous active subscriptions as REPLACED
    await prisma.businessSubscription.updateMany({
      where: { businessId, status: { in: ['ACTIVE', 'TRIAL'] } },
      data: { status: 'REPLACED', updatedAt: new Date() }
    });

    const startDate = new Date();
    const endDate = manualEndDate ? new Date(manualEndDate) : new Date();
    if (!manualEndDate) {
      endDate.setDate(endDate.getDate() + plan.durationDays);
    }

    const subscription = await prisma.businessSubscription.create({
      data: {
        businessId,
        planId,
        currentPeriodEnd: endDate,
        status: plan.isTrial ? 'TRIAL' : 'ACTIVE'
      }
    });

    res.json({ success: true, data: subscription });
  } catch (error) {
    console.error('Assign subscription error:', error);
    res.status(500).json({ success: false, message: 'Failed to assign subscription' });
  }
};

export const cancelSubscription = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    await prisma.businessSubscription.update({
      where: { id },
      data: { status: 'CANCELLED' }
    });
    res.json({ success: true, message: 'Subscription cancelled' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to cancel subscription' });
  }
};

/**
 * Updated Billing Summary to use new Subscription model
 */
export const getBillingSummary = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const activeSubs = await prisma.businessSubscription.findMany({
      where: { status: { in: ['ACTIVE', 'TRIAL'] } }
    });
    const plans = await prisma.plan.findMany();

    let totalMRR = 0;
    let trialCount = 0;
    let expiredCount = await prisma.businessSubscription.count({ where: { status: 'EXPIRED' } });
    
    activeSubs.forEach(sub => {
      const plan = plans.find(p => p.id === sub.planId);
      if (plan && sub.status === 'ACTIVE') {
        totalMRR += plan.price;
      }
      if (sub.status === 'TRIAL') {
        trialCount++;
      }
    });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const newBusinessesCount = await prisma.business.count({
      where: { createdAt: { gte: thirtyDaysAgo } }
    });

    res.json({
      success: true,
      data: {
        totalMRR,
        totalSubscriptions: activeSubs.length,
        trialCount,
        expiredCount,
        newBusinessesCount,
        growthPercentage: 15.2
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to retrieve billing summary' });
  }
};

/**
 * Platform Admin only
 */
export const migrateLegacyUserContextHandler = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const result = await migrateLegacyUserContextToMemberships(prisma);
    
    res.json({
      success: true,
      message: 'Legacy user context migration completed',
      data: result
    });
  } catch (error: any) {
    console.error('Migration error:', error);
    res.status(500).json({
      success: false,
      message: 'Migration failed',
      error: error.message
    });
  }
};
