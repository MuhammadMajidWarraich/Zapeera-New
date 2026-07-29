


import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { createSearchConditions } from '../utils/query-helper';
import { CreateCustomerData, UpdateCustomerData } from '../models/customer.model';
import { AuthRequest } from '../middleware/auth.middleware';
import { notifyCustomerChange } from '../routes/sse.routes';
import { syncAfterOperation, pullLatestFromLive } from '../utils/sync-helper';
import Joi from 'joi';

// Validation schemas
const createCustomerSchema = Joi.object({
  name: Joi.string().required(),
  phone: Joi.string().required(),
  email: Joi.string().email().allow('').optional(),
  address: Joi.string().allow('').optional(),
  branchId: Joi.string().allow('').optional() // Optional - will be taken from user context if not provided
});

const updateCustomerSchema = Joi.object({
  name: Joi.string(),
  phone: Joi.string(),
  email: Joi.string().email().allow(''),
  address: Joi.string().allow(''),
  isVIP: Joi.boolean(),
  isActive: Joi.boolean()
});

export const getCustomers = async (req: AuthRequest, res: Response) => {
  try {
    // 🔄 PULL LATEST FROM LIVE DATABASE FIRST
    await pullLatestFromLive('customer').catch(err => console.log('[Sync] Pull customers:', err.message));

    const prisma = await getPrisma();
    const {
      page = 1,
      limit = 10,
      search = '',
      branchId = '',
      vip = false,
      createdByRole = ''  // New parameter for filtering by creator role
    } = req.query;

    // Log user context for debugging
    console.log('🔍 getCustomers - User context:', {
      id: req.user?.id,
      role: req.user?.role,
      createdBy: req.user?.createdBy,
      branchId: req.user?.branchId,
      companyId: req.user?.companyId,
      selectedBranchId: req.user?.selectedBranchId,
      selectedCompanyId: req.user?.selectedCompanyId
    });

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    // Build where clause with data isolation
    const where: any = {
      isActive: true
    };

    // CRITICAL: Filter by companyId to prevent data leakage between businesses
    const businessId = req.business_id || req.headers['x-company-id'] as string;
    if (businessId) {
      where.companyId = businessId;
    } else {
      // If no business context, return empty results
      console.warn('⚠️ getCustomers - No business context found, returning empty results');
      return res.json({
        success: true,
        data: {
          customers: [],
          pagination: { page: Number(page), limit: Number(limit), total: 0, pages: 0 }
        },
        warning: 'No business context found. Please ensure you are properly authenticated.'
      });
    }

    // Filter by branchId if available (for manager/cashier roles)
    const contextBranchId = req.branch_id || req.headers['x-branch-id'] as string;
    if (contextBranchId) {
      where.branchId = contextBranchId;
    }

    // Allow override branchId from query params for admin users
    if (req.query.branchId && typeof req.query.branchId === 'string' && req.query.branchId.trim() !== '') {
      where.branchId = req.query.branchId as string;
    }

    if (vip === 'true') {
      where.isVIP = true;
    }

    if (search) {
      // Use database-agnostic search helper for case-insensitive search
      const searchConditions = createSearchConditions(
        ['name', 'phone', 'email'],
        search as string
      );
      if (searchConditions.OR) {
        where.OR = searchConditions.OR;
      }
    }

    // Filter by creator role if specified
    if (createdByRole && typeof createdByRole === 'string' && createdByRole.trim() !== '') {
      const normalizedRole = createdByRole.trim().toUpperCase();
      const businessId =
        (req.headers['x-company-id'] as string) ||
        req.business_id ||
        req.user?.selectedCompanyId ||
        req.user?.companyId ||
        null;

      const memberships = businessId
        ? await prisma.membership.findMany({
            where: {
              businessId: String(businessId),
              status: 'ACTIVE',
              role: { is: { name: normalizedRole } }
            },
            select: { userId: true }
          })
        : [];

      const userIds = memberships.map(m => m.userId);

      // Then filter customers by createdBy matching these user IDs
      if (userIds.length > 0) {
        // Get the base createdBy filter for data isolation
        const baseCreatedBy = req.user?.createdBy || req.user?.id;

        if (baseCreatedBy) {
          // If there's a base filter, use AND to combine both conditions
          // Customers must be created by the current admin AND by users with the specified role
          where.AND = [
            { createdBy: baseCreatedBy },
            { createdBy: { in: userIds } }
          ];
          // Remove the single createdBy condition since we're using AND now
          delete where.createdBy;
        } else {
          where.createdBy = { in: userIds };
        }
      } else {
        // If no users with that role exist, return empty results
        return res.json({
          success: true,
          data: {
            customers: [],
            pagination: { page: Number(page), limit: Number(limit), total: 0, pages: 0 }
          }
        });
      }
    }

    console.log('Customer query where clause:', where);
    console.log('Customer query pagination:', { skip, take });
    console.log('Filter by creator role:', createdByRole);

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip,
        take,
        include: {
          branch: {
            select: {
              id: true,
              name: true
            }
          },
          sales: {
            select: {
              id: true,
              totalAmount: true,
              createdAt: true
            },
            orderBy: { createdAt: 'desc' },
            take: 5
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.customer.count({ where })
    ]);

    console.log('Found customers:', customers.length);
    console.log('Total customers in database:', total);
    console.log('Customer details:', customers.map(c => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      branchId: c.branchId,
      isActive: c.isActive,
      totalPurchases: c.totalPurchases,
      loyaltyPoints: c.loyaltyPoints
    })));

    return res.json({
      success: true,
      data: {
        customers,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      }
    });
  } catch (error: any) {
    console.error('❌ Get customers error:', error);
    console.error('❌ Error details:', {
      message: error.message,
      stack: error.stack,
      user: req.user
    });
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

export const getCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    // CRITICAL: Filter by companyId to prevent data leakage between businesses
    const businessId = req.business_id || req.headers['x-company-id'] as string;
    const where: any = { id };

    if (businessId) {
      where.companyId = businessId;
    } else {
      // If no business context, return error
      console.warn('⚠️ getCustomer - No business context found');
      return res.status(400).json({
        success: false,
        message: 'Business context required'
      });
    }

    const customer = await prisma.customer.findUnique({
      where,
      include: {
        branch: {
          select: {
            id: true,
            name: true
          }
        },
        sales: {
          include: {
            items: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                  }
                }
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    return res.json({
      success: true,
      data: customer
    });
  } catch (error) {
    console.error('Get customer error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const createCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    console.log('📝 Customer creation request received');
    console.log('📝 Request body:', JSON.stringify(req.body, null, 2));
    console.log('📝 User context:', {
      id: req.user?.id,
      role: req.user?.role,
      branchId: req.user?.branchId,
      companyId: req.user?.companyId,
      selectedBranchId: req.user?.selectedBranchId,
      selectedCompanyId: req.user?.selectedCompanyId,
      createdBy: req.user?.createdBy
    });

    // Normalize empty strings to undefined for optional fields
    const normalizedBody = {
      ...req.body,
      phone: req.body.phone?.trim().replace(/\\+$/, '') || req.body.phone, // Remove trailing backslashes
      email: req.body.email?.trim() || undefined,
      address: req.body.address?.trim() || undefined,
      branchId: req.body.branchId?.trim() || undefined,
    };

    const { error } = createCustomerSchema.validate(normalizedBody);
    if (error) {
      console.log('Customer validation error:', error.details);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    // Get branchId from request context (multi-tenant)
    let branchId = normalizedBody.branchId || req.branch_id || (req.membership?.branch_ids?.length ? req.membership.branch_ids[0] : undefined);
    let companyId: string | undefined = req.business_id || req.membership?.business_id;

    console.log('🔍 Initial branch/company context:', { branchId, companyId });
    console.log('🔍 Request context:', {
      business_id: req.business_id,
      branch_id: req.branch_id,
      membership: req.membership
    });

    // No need to lookup from user since context is from membership

    // If still no branchId, try to get the first branch for the user's company
    if (!branchId && companyId) {
      console.log('🔍 Looking for first branch for company:', companyId);
      const firstBranch = await prisma.branch.findFirst({
        where: {
          companyId: companyId,
          isActive: true
        },
        select: { id: true, companyId: true }
      });

      console.log('🔍 First branch found:', firstBranch);

      if (firstBranch) {
        branchId = firstBranch.id;
        companyId = firstBranch.companyId;
        console.log('🔍 Updated branch/company from first branch:', { branchId, companyId });
      }
    }

    // If still no branchId, try to find any active branch (last resort)
    if (!branchId) {
      console.log('🔍 No branchId found, looking for any active branch...');
      const anyBranch = await prisma.branch.findFirst({
        where: { isActive: true },
        select: { id: true, companyId: true },
        orderBy: { createdAt: 'asc' }
      });

      if (anyBranch) {
        branchId = anyBranch.id;
        companyId = anyBranch.companyId;
        console.log('🔍 Using first available branch:', { branchId, companyId });
      }
    }

    if (!branchId || !companyId) {
      console.error('❌ Missing branch or company context:', { branchId, companyId });
      console.error('❌ User context:', req.user);
      return res.status(400).json({
        success: false,
        message: 'Branch and company context required. Please ensure you have proper access permissions and that at least one branch exists in the system.',
        error: 'MISSING_BRANCH_CONTEXT',
        details: {
          branchId: branchId || null,
          companyId: companyId || null,
          userRole: req.user?.role,
          userBranchId: req.user?.branchId,
          userCompanyId: req.user?.companyId
        }
      });
    }

    // Get the branch to find the companyId (verify branch exists)
    console.log('🔍 Verifying branch exists:', branchId);
    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { companyId: true }
    });

    if (!branch) {
      console.error('❌ Branch not found:', branchId);
      return res.status(400).json({
        success: false,
        message: 'Branch not found'
      });
    }

    console.log('✅ Branch verified:', { branchId, companyId: branch.companyId });

    // Use companyId from branch to ensure consistency
    const finalCompanyId = branch.companyId;

    const customerData: CreateCustomerData = {
      ...normalizedBody,
      branchId
    };

    // Check if phone already exists (globally, since phone is unique in schema)
    const existingCustomer = await prisma.customer.findFirst({
      where: {
        phone: customerData.phone
      }
    });

    console.log('🔍 Existing customer check for phone:', customerData.phone, 'Result:', existingCustomer ? existingCustomer.id : 'Not found');

    if (existingCustomer) {
      // Return existing customer instead of failing
      console.log('ℹ️  Customer already exists, returning existing customer:', existingCustomer.id);
      return res.status(200).json({
        success: true,
        data: existingCustomer,
        message: 'Customer already exists'
      });
    }

    console.log('🔍 Creating customer with data:', {
      name: customerData.name,
      phone: customerData.phone,
      email: customerData.email,
      address: customerData.address,
      branchId: branchId,
      companyId: finalCompanyId,
      createdBy: req.user?.createdBy || req.user?.id
    });

    const customer = await prisma.customer.create({
      data: {
        name: customerData.name,
        phone: customerData.phone,
        email: customerData.email || null,
        address: customerData.address || null,
        branchId: branchId,
        companyId: finalCompanyId,
        createdBy: req.user?.createdBy || req.user?.id || 'default-admin-id'
      },
      include: {
        branch: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    console.log('✅ Customer created successfully:', customer.id);

    // Send real-time notification to all users of the same admin
    const createdBy = req.user?.createdBy || req.user?.id;
    if (createdBy) {
      notifyCustomerChange(createdBy, 'created', customer);
    }

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('customer', 'create', customer).catch(err => {
      console.error('[Sync] Customer create sync failed:', err.message);
    });

    return res.status(201).json({
      success: true,
      data: customer,
      message: 'Customer created successfully'
    });
  } catch (error: any) {
    console.error('❌ Create customer error:', error);
    console.error('❌ Error details:', {
      message: error.message,
      code: error.code,
      meta: error.meta,
      stack: error.stack,
      user: req.user
    });

    // Provide more specific error messages
    if (error.code === 'P2002') {
      // Unique constraint violation
      return res.status(400).json({
        success: false,
        message: 'A customer with this phone number already exists',
        error: 'DUPLICATE_PHONE'
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      errorCode: error.code || 'UNKNOWN_ERROR'
    });
  }
};

export const updateCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const { error } = updateCustomerSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    // CRITICAL: Filter by companyId to prevent data leakage between businesses
    const businessId = req.business_id || req.headers['x-company-id'] as string;
    const where: any = { id };

    if (businessId) {
      where.companyId = businessId;
    } else {
      // If no business context, return error
      console.warn('⚠️ updateCustomer - No business context found');
      return res.status(400).json({
        success: false,
        message: 'Business context required'
      });
    }

    const updateData: UpdateCustomerData = req.body;

    // Check if customer exists (with business isolation)
    const existingCustomer = await prisma.customer.findUnique({
      where
    });

    if (!existingCustomer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Check if phone already exists for this business (if being updated)
    if (updateData.phone && updateData.phone !== existingCustomer.phone) {
      const phoneExists = await prisma.customer.findFirst({
        where: {
          phone: updateData.phone,
          companyId: businessId,
          id: { not: id }
        }
      });

      if (phoneExists) {
        return res.status(400).json({
          success: false,
          message: 'Customer with this phone number already exists'
        });
      }
    }

    const customer = await prisma.customer.update({
      where: { id },
      data: updateData,
      include: {
        branch: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('customer', 'update', customer).catch(err => {
      console.error('[Sync] Customer update sync failed:', err.message);
    });

    return res.json({
      success: true,
      data: customer
    });
  } catch (error) {
    console.error('Update customer error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const deleteCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    // CRITICAL: Filter by companyId to prevent data leakage between businesses
    const businessId = req.business_id || req.headers['x-company-id'] as string;
    const where: any = { id };

    if (businessId) {
      where.companyId = businessId;
    } else {
      // If no business context, return error
      console.warn('⚠️ deleteCustomer - No business context found');
      return res.status(400).json({
        success: false,
        message: 'Business context required'
      });
    }

    const customer = await prisma.customer.findUnique({
      where
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Soft delete
    const deletedCustomer = await prisma.customer.update({
      where,
      data: { isActive: false }
    });

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('customer', 'update', deletedCustomer).catch(err => {
      console.error('[Sync] Customer delete sync failed:', err.message);
    });

    return res.json({
      success: true,
      message: 'Customer deleted successfully'
    });
  } catch (error) {
    console.error('Delete customer error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getCustomerPurchaseHistory = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const { page = 1, limit = 10 } = req.query;

    // CRITICAL: Filter by companyId to prevent data leakage between businesses
    const businessId = req.business_id || req.headers['x-company-id'] as string;
    const where: any = { id };

    if (businessId) {
      where.companyId = businessId;
    } else {
      // If no business context, return error
      console.warn('⚠️ getCustomerPurchaseHistory - No business context found');
      return res.status(400).json({
        success: false,
        message: 'Business context required'
      });
    }

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    // Check if customer exists (with business isolation)
    const customer = await prisma.customer.findUnique({
      where,
      select: { id: true, name: true, phone: true }
    });

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found'
      });
    }

    // Get customer's sales history
    const [sales, total] = await Promise.all([
      prisma.sale.findMany({
        where: { customerId: id },
        skip,
        take,
        include: {
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          },
          user: {
            select: {
              name: true,
              username: true
            }
          },
          branch: {
            select: {
              name: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.sale.count({ where: { customerId: id } })
    ]);

    // Calculate customer stats
    const customerStats = await prisma.sale.aggregate({
      where: { customerId: id },
      _sum: {
        totalAmount: true,
        subtotal: true,
        taxAmount: true
      },
      _count: {
        id: true
      }
    });

    return res.json({
      success: true,
      data: {
        customer,
        sales,
        stats: {
          totalPurchases: customerStats._count.id,
          totalSpent: customerStats._sum.totalAmount || 0,
          averageOrder: customerStats._count.id > 0 ? (customerStats._sum.totalAmount || 0) / customerStats._count.id : 0
        },
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get customer purchase history error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};
