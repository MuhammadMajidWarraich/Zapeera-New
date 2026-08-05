import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { syncAfterOperation, pullLatestFromLive } from '../utils/sync-helper';
import { AuthRequest, buildBranchWhereClause } from '../middleware/auth.middleware';
import Joi from 'joi';

// Validation schemas
const createStaffSchema = Joi.object({
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  phone: Joi.string().optional().allow(''),
  address: Joi.string().optional().allow(''),
  position: Joi.string().required(),
  department: Joi.string().optional().allow(''),
  salary: Joi.number().min(0).optional().allow(null, ''),
  hireDate: Joi.string().required(), // Changed to string to accept ISO date strings
  status: Joi.string().valid('ACTIVE', 'INACTIVE', 'TERMINATED', 'ON_LEAVE').default('ACTIVE'),
  branchId: Joi.string().required(),
  emergencyContactName: Joi.string().optional().allow(''),
  emergencyContactPhone: Joi.string().optional().allow(''),
  emergencyContactRelation: Joi.string().optional().allow('')
});

const updateStaffSchema = Joi.object({
  name: Joi.string(),
  email: Joi.string().email(),
  phone: Joi.string().allow(''),
  address: Joi.string().allow(''),
  position: Joi.string(),
  department: Joi.string().allow(''),
  salary: Joi.number().min(0),
  hireDate: Joi.string(), // Changed to string to accept ISO date strings
  status: Joi.string().valid('ACTIVE', 'INACTIVE', 'TERMINATED', 'ON_LEAVE'),
  branchId: Joi.string(),
  emergencyContactName: Joi.string().allow(''),
  emergencyContactPhone: Joi.string().allow(''),
  emergencyContactRelation: Joi.string().allow(''),
  isActive: Joi.boolean()
});

// Generate unique staff ID
const generateStaffId = async (prisma: any): Promise<string> => {
  const lastStaff = await prisma.staff.findFirst({
    orderBy: { staffId: 'desc' }
  });

  if (!lastStaff) {
    return 'STF001';
  }

  const lastNumber = parseInt(lastStaff.staffId.replace('STF', ''));
  const newNumber = lastNumber + 1;
  return `STF${newNumber.toString().padStart(3, '0')}`;
};

export const getStaff = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const {
      page = 1,
      limit = 10,
      search = '',
      status = '',
      branchId = '',
      isActive = true
    } = req.query;

    console.log('Getting staff with params:', { page, limit, search, status, branchId, isActive });

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    // Build where clause with data isolation
    const where: any = buildBranchWhereClause(req, {});

    if (isActive !== 'all') {
      where.isActive = isActive === 'true';
    }

    if (branchId) {
      where.branchId = branchId;
    }

    console.log('Where clause:', where);

    if (status) {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { email: { contains: search } },
        { staffId: { contains: search } },
        { position: { contains: search } }
      ];
    }

    const [staff, total] = await Promise.all([
      prisma.staff.findMany({
        where,
        skip,
        take,
        include: {
          branch: {
            select: {
              id: true,
              name: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.staff.count({ where })
    ]);

    console.log('Found staff:', staff.length, 'Total:', total);

    return res.json({
      success: true,
      data: {
        staff,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      }
    });
  } catch (error) {
    console.error('Error fetching staff:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getStaffMember = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    const staff = await prisma.staff.findFirst({
      where: buildBranchWhereClause(req, { id }),
      include: {
        branch: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: 'Staff not found'
      });
    }

    return res.json({
      success: true,
      data: staff
    });
  } catch (error) {
    console.error('Error fetching staff:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const createStaff = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    console.log('Creating staff with data:', req.body);

    const { error } = createStaffSchema.validate(req.body);
    if (error) {
      console.log('Validation error:', error.details);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const staffData = req.body;

    // Check if staff with email already exists
    const existingStaff = await prisma.staff.findUnique({
      where: { email: staffData.email }
    });

    if (existingStaff) {
      return res.status(400).json({
        success: false,
        message: 'Staff with this email already exists'
      });
    }

    // Check if branch exists and resolve companyId
    const branch = await prisma.branch.findUnique({
      where: { id: staffData.branchId },
      select: { id: true, companyId: true }
    });

    if (!branch) {
      return res.status(400).json({
        success: false,
        message: 'Branch not found'
      });
    }

    // Security: Ensure branch belongs to user's company context
    const userCompanyId = (req.headers['x-company-id'] as string) || req.membership?.business_id;
    if (userCompanyId && branch.companyId !== userCompanyId) {
       return res.status(403).json({
         success: false,
         message: 'Unauthorized: Branch belongs to another business'
       });
    }

    // Generate unique staff ID
    const staffId = await generateStaffId(prisma);

    // Create staff
    const staff = await prisma.staff.create({
      data: {
        ...staffData,
        staffId,
        companyId: branch.companyId,
        hireDate: new Date(staffData.hireDate),
        salary: staffData.salary && staffData.salary > 0 ? staffData.salary : null
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

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('staff', 'create', staff).catch(err => {
      console.error('[Sync] Staff create sync failed:', err.message);
    });

    return res.status(201).json({
      success: true,
      data: staff,
      message: 'Staff created successfully'
    });
  } catch (error) {
    console.error('Error creating staff:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const updateStaff = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const { error } = updateStaffSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const updateData = req.body;

    // Check if staff exists and belongs to user's business
    const existingStaff = await prisma.staff.findFirst({
      where: buildBranchWhereClause(req, { id })
    });

    if (!existingStaff) {
      return res.status(404).json({
        success: false,
        message: 'Staff not found'
      });
    }

    // Check if email is being changed and if it already exists
    if (updateData.email && updateData.email !== existingStaff.email) {
      const emailExists = await prisma.staff.findUnique({
        where: { email: updateData.email }
      });

      if (emailExists) {
        return res.status(400).json({
          success: false,
          message: 'Staff with this email already exists'
        });
      }
    }

    // Check if branch exists (if being changed)
    if (updateData.branchId && updateData.branchId !== existingStaff.branchId) {
      const branch = await prisma.branch.findUnique({
        where: { id: updateData.branchId }
      });

      if (!branch) {
        return res.status(400).json({
          success: false,
          message: 'Branch not found'
        });
      }
    }

    // Update staff
    const staff = await prisma.staff.update({
      where: { id },
      data: {
        ...updateData,
        hireDate: updateData.hireDate ? new Date(updateData.hireDate) : undefined
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

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('staff', 'update', staff).catch(err => {
      console.error('[Sync] Staff update sync failed:', err.message);
    });

    return res.json({
      success: true,
      data: staff,
      message: 'Staff updated successfully'
    });
  } catch (error) {
    console.error('Error updating staff:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const deleteStaff = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    // Check if staff exists and belongs to user's business
    const existingStaff = await prisma.staff.findFirst({
      where: buildBranchWhereClause(req, { id })
    });

    if (!existingStaff) {
      return res.status(404).json({
        success: false,
        message: 'Staff not found'
      });
    }

    // Soft delete by setting isActive to false
    const deletedStaff = await prisma.staff.update({
      where: { id },
      data: { isActive: false }
    });

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('staff', 'update', deletedStaff).catch(err => {
      console.error('[Sync] Staff delete sync failed:', err.message);
    });

    return res.json({
      success: true,
      message: 'Staff deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting staff:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getStaffStats = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { branchId } = req.query;

    const where: any = buildBranchWhereClause(req, { isActive: true });
    if (branchId) {
      where.branchId = branchId;
    }

    const [
      totalStaff,
      activeStaff,
      inactiveStaff,
      terminatedStaff,
      onLeaveStaff
    ] = await Promise.all([
      prisma.staff.count({ where }),
      prisma.staff.count({ where: { ...where, status: 'ACTIVE' } }),
      prisma.staff.count({ where: { ...where, status: 'INACTIVE' } }),
      prisma.staff.count({ where: { ...where, status: 'TERMINATED' } }),
      prisma.staff.count({ where: { ...where, status: 'ON_LEAVE' } })
    ]);

    return res.json({
      success: true,
      data: {
        totalStaff,
        activeStaff,
        inactiveStaff,
        terminatedStaff,
        onLeaveStaff
      }
    });
  } catch (error) {
    console.error('Error fetching staff stats:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};
