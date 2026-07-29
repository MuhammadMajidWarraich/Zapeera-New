import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { createSearchConditions } from '../utils/query-helper';
import { AuthRequest } from '../middleware/auth.middleware';
import { syncAfterOperation, pullLatestFromLive } from '../utils/sync-helper';
import Joi from 'joi';

// Validation schemas
const createSupplierSchema = Joi.object({
  name: Joi.string().required(),
  contactPerson: Joi.string().required(),
  phone: Joi.string().required(),
  email: Joi.string().email().allow('', null).optional(),
  address: Joi.string().allow('', null).optional(),
  manufacturerId: Joi.string().allow('', null).optional()
}).unknown(true);

const updateSupplierSchema = Joi.object({
  name: Joi.string(),
  contactPerson: Joi.string(),
  phone: Joi.string(),
  email: Joi.string().email().allow('', null).optional(),
  address: Joi.string().allow('', null).optional(),
  manufacturerId: Joi.string().allow('', null).optional(),
  isActive: Joi.boolean()
}).unknown(true);

export const getSuppliers = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { page = 1, limit = 50, search = '', manufacturerId = '' } = req.query;

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const where: any = {};

    // Get context from headers (set by frontend)
    const selectedCompanyId = req.headers['x-company-id'] as string;
    const selectedBranchId = req.headers['x-branch-id'] as string;
    const userBranchId = req.user?.branchId;
    const userCompanyId = req.user?.companyId;

    const targetBranchId = selectedBranchId || userBranchId || null;
    const targetCompanyId = selectedCompanyId || userCompanyId || null;

    console.log('📦 getSuppliers:', { targetBranchId, targetCompanyId, manufacturerId });

    if (targetBranchId) {
      where.branchId = targetBranchId;
    } else if (targetCompanyId) {
      where.companyId = targetCompanyId;
    } else {
      where.branchId = 'no-access';
    }

    // Filter suppliers by manufacturer if manufacturerId is provided
    if (manufacturerId) {
      where.manufacturerId = manufacturerId;
    }

    if (search) {
      // Only search in fields that exist in the database
      // Email and address may not exist if migration hasn't been run yet
      const searchFields = ['name', 'contactPerson', 'phone'];
      // Try to include email and address if they exist (will be handled gracefully by Prisma)
      try {
        const searchConditions = createSearchConditions(
          searchFields,
          search as string
        );
        if (searchConditions.OR) {
          where.OR = searchConditions.OR;
        }
      } catch (searchError) {
        // If search fails (e.g., due to missing columns), fallback to basic search
        console.warn('Search error, using fallback:', searchError);
        where.OR = [
          { name: { contains: search as string, mode: 'insensitive' } },
          { contactPerson: { contains: search as string, mode: 'insensitive' } },
          { phone: { contains: search as string, mode: 'insensitive' } }
        ];
      }
    }

    const [suppliers, total] = await Promise.all([
      prisma.supplier.findMany({
        where,
        skip,
        take,
        include: {
          manufacturer: {
            select: {
              id: true,
              name: true,
              country: true
            }
          },
          _count: {
            select: {
              products: true
            }
          }
        },
        orderBy: { name: 'asc' }
      }),
      prisma.supplier.count({ where })
    ]);

    return res.json({
      success: true,
      data: {
        suppliers,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      }
    });
  } catch (error: any) {
    console.error('Get suppliers error:', error);
    console.error('Error details:', {
      message: error?.message,
      code: error?.code,
      meta: error?.meta
    });
    
    // If error is due to missing columns (email/address), return empty results instead of error
    // This allows the app to continue working while migration is pending
    if (error?.message?.includes('email') || error?.message?.includes('address') || 
        error?.code === 'P2021' || error?.code === 'P2001' || 
        error?.meta?.column_name?.includes('email') || error?.meta?.column_name?.includes('address')) {
      console.warn('⚠️ Database columns (email/address) may not exist yet. Returning empty results.');
      return res.json({
        success: true,
        data: {
          suppliers: [],
          pagination: {
            page: Number(req.query.page || 1),
            limit: Number(req.query.limit || 50),
            total: 0,
            pages: 0
          }
        },
        warning: 'Database migration may be required. Please run: npx prisma db push'
      });
    }
    
    return res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error?.message : undefined
    });
  }
};

export const getSupplier = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    // Build where clause with data isolation
    const where: any = { id };

    // Data isolation based on user role
    if (req.user?.role === 'OWNER') {
      // For OWNER users, use their own ID as createdBy (self-referencing)
      where.createdBy = req.user.id;
    } else if (req.user?.createdBy) {
      // Other users see suppliers from their admin
      where.createdBy = req.user.createdBy;
    } else if (req.user?.id) {
      // Fallback to user ID if no createdBy
      where.createdBy = req.user.id;
    } else {
      // No access if no user context
      where.createdBy = 'non-existent-admin-id';
    }

    const supplier = await prisma.supplier.findFirst({
      where,
      include: {
        manufacturer: {
          select: {
            id: true,
            name: true,
            country: true
          }
        },
        _count: {
          select: {
            products: true
          }
        }
      }
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    return res.json({
      success: true,
      data: supplier
    });
  } catch (error) {
    console.error('Get supplier error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const createSupplier = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    console.log('🔍 Create supplier request body:', req.body);
    const { error, value } = createSupplierSchema.validate(req.body, { stripUnknown: true });
    if (error) {
      console.log('🔍 Validation error:', error.details);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const { name, contactPerson, phone, email, address, manufacturerId, branchId: branchIdFromBody } = value;

    // Get context from headers
    const selectedCompanyId = req.headers['x-company-id'] as string;
    const selectedBranchId = req.headers['x-branch-id'] as string;

    // Determine branchId and companyId
    let branchId = branchIdFromBody || selectedBranchId || req.user?.branchId;
    let companyId = selectedCompanyId || req.user?.companyId;

    // If branchId is provided but no companyId, get companyId from branch
    if (branchId && !companyId) {
      const branch = await prisma.branch.findUnique({
        where: { id: branchId },
        select: { companyId: true }
      });
      companyId = branch?.companyId || undefined;
    }

    if (!branchId) {
      console.error('❌ Branch ID is missing. Headers:', { selectedBranchId, selectedCompanyId });
      console.error('❌ User branchId:', req.user?.branchId);
      return res.status(400).json({
        success: false,
        message: 'Branch is required. Please select a branch first.'
      });
    }

    // Verify branch exists
    const branchExists = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, companyId: true }
    });

    if (!branchExists) {
      console.error('❌ Branch not found:', branchId);
      return res.status(400).json({
        success: false,
        message: 'Selected branch does not exist. Please select a valid branch.'
      });
    }

    // Use branch's companyId if companyId is not provided
    if (!companyId && branchExists.companyId) {
      companyId = branchExists.companyId;
    }

    // Check if supplier with this name already exists in this branch
    const existingSupplier = await prisma.supplier.findFirst({
      where: {
        name: name,
        branchId: branchId
      }
    });

    if (existingSupplier) {
      return res.status(400).json({
        success: false,
        message: 'Supplier with this name already exists in this branch'
      });
    }

    console.log('✅ Creating supplier with data:', {
      name,
      contactPerson,
      phone,
      email: email || null,
      address: address || null,
      manufacturerId: manufacturerId || null,
      branchId,
      companyId,
      createdBy: req.user?.createdBy || req.user?.id
    });

    // Prepare data object - only include fields that exist
    const supplierData: any = {
      name,
      contactPerson,
      phone,
      manufacturerId: manufacturerId && manufacturerId.trim() !== '' ? manufacturerId : null,
      branchId: branchId,
      companyId: companyId || null,
      createdBy: req.user?.createdBy || req.user?.id || 'default-admin-id'
    };

    // Only add email/address if they're provided (handle case where columns might not exist)
    if (email && email.trim() !== '') {
      supplierData.email = email.trim();
    }
    if (address && address.trim() !== '') {
      supplierData.address = address.trim();
    }

    const supplier = await prisma.supplier.create({
      data: supplierData
    });

    console.log('✅ Supplier created successfully:', supplier.id);

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('supplier', 'create', supplier).catch(err => {
      console.error('[Sync] Supplier create sync failed:', err.message);
    });

    return res.status(201).json({
      success: true,
      data: supplier
    });
  } catch (error: any) {
    console.error('Create supplier error:', error);
    console.error('Error details:', {
      message: error?.message,
      code: error?.code,
      meta: error?.meta,
      stack: error?.stack
    });
    
    // Return more detailed error in development
    const errorMessage = process.env.NODE_ENV === 'development' 
      ? error?.message || 'Internal server error'
      : 'Internal server error';
    
    return res.status(500).json({
      success: false,
      message: errorMessage,
      error: process.env.NODE_ENV === 'development' ? {
        code: error?.code,
        meta: error?.meta,
        details: error?.message
      } : undefined
    });
  }
};

export const updateSupplier = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    console.log('🔍 Update supplier request body:', req.body);
    const { error, value } = updateSupplierSchema.validate(req.body, { stripUnknown: true });

    if (error) {
      console.log('🔍 Update validation error:', error.details);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const updateData = { ...value };

    // Handle empty manufacturerId
    if (updateData.manufacturerId && updateData.manufacturerId.trim() === '') {
      updateData.manufacturerId = null;
    }

    // Handle empty email and address
    if (updateData.email !== undefined) {
      updateData.email = updateData.email && updateData.email.trim() !== '' ? updateData.email.trim() : null;
    }
    if (updateData.address !== undefined) {
      updateData.address = updateData.address && updateData.address.trim() !== '' ? updateData.address.trim() : null;
    }

    // Build where clause with data isolation
    const where: any = { id };

    // Data isolation based on user role
    if (req.user?.role === 'OWNER') {
      // For OWNER users, use their own ID as createdBy (self-referencing)
      where.createdBy = req.user.id;
    } else if (req.user?.createdBy) {
      // Other users see suppliers from their admin
      where.createdBy = req.user.createdBy;
    } else if (req.user?.id) {
      // Fallback to user ID if no createdBy
      where.createdBy = req.user.id;
    } else {
      // No access if no user context
      where.createdBy = 'non-existent-admin-id';
    }

    // Check if supplier exists
    const existingSupplier = await prisma.supplier.findFirst({
      where
    });

    if (!existingSupplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    // Note: Suppliers are shared across all branches under the same admin
    // No need to check for duplicates as suppliers can have the same name across different contexts

    console.log('🔍 Update data being sent to Prisma:', updateData);
    
    const supplier = await prisma.supplier.update({
      where: { id },
      data: updateData
    });

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('supplier', 'update', supplier).catch(err => {
      console.error('[Sync] Supplier update sync failed:', err.message);
    });

    return res.json({
      success: true,
      data: supplier
    });
  } catch (error: any) {
    console.error('Update supplier error:', error);
    console.error('Error details:', {
      message: error?.message,
      code: error?.code,
      meta: error?.meta,
      stack: error?.stack
    });
    return res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error?.message : undefined
    });
  }
};

export const deleteSupplier = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    console.log('🔍 Delete supplier ID:', id);

    // Build where clause with data isolation
    const where: any = { id };

    // Data isolation based on user role
    if (req.user?.role === 'OWNER') {
      // For OWNER users, use their own ID as createdBy (self-referencing)
      where.createdBy = req.user.id;
    } else if (req.user?.createdBy) {
      // Other users see suppliers from their admin
      where.createdBy = req.user.createdBy;
    } else if (req.user?.id) {
      // Fallback to user ID if no createdBy
      where.createdBy = req.user.id;
    } else {
      // No access if no user context
      where.createdBy = 'non-existent-admin-id';
    }

    const supplier = await prisma.supplier.findFirst({
      where,
      include: {
        _count: {
          select: {
            products: true
          }
        }
      }
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: 'Supplier not found'
      });
    }

    // Check if supplier has products
    if (supplier._count.products > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete supplier with existing products'
      });
    }

    await prisma.supplier.delete({
      where: { id }
    });

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('supplier', 'delete', { id }).catch(err => {
      console.error('[Sync] Supplier delete sync failed:', err.message);
    });

    return res.json({
      success: true,
      message: 'Supplier deleted successfully'
    });
  } catch (error) {
    console.error('Delete supplier error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};
