import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { syncAfterOperation, pullLatestFromLive } from '../utils/sync-helper';
import { AuthRequest, buildBranchWhereClause } from '../middleware/auth.middleware';
import Joi from 'joi';

const createStaffSchema = Joi.object({
  name: Joi.string().required(),
  email: Joi.string().email().required(),
  phone: Joi.string().optional().allow(''),
  password: Joi.string().optional().allow(''),
  role: Joi.string().optional().default('STAFF'),
  branchId: Joi.string().required(),
  businessId: Joi.string().optional(),
  designation: Joi.string().optional().allow(''),
  department: Joi.string().optional().allow(''),
  employmentType: Joi.string().valid('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN').default('FULL_TIME'),
  salary: Joi.number().min(0).optional().allow(null, ''),
  salaryType: Joi.string().valid('MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY').default('MONTHLY'),
  joiningDate: Joi.string().optional(),
  bankName: Joi.string().optional().allow(''),
  bankAccountNumber: Joi.string().optional().allow(''),
  bankBranchName: Joi.string().optional().allow(''),
  cnicNumber: Joi.string().optional().allow(''),
  cnicExpiry: Joi.string().optional(),
  passportNumber: Joi.string().optional().allow(''),
  emergencyContactName: Joi.string().optional().allow(''),
  emergencyContactPhone: Joi.string().optional().allow(''),
  emergencyContactRelation: Joi.string().optional().allow(''),
  reportingManagerId: Joi.string().optional().allow(''),
  shiftPreference: Joi.string().optional().allow(''),
  weeklyOffDays: Joi.string().optional().allow(''),
  annualLeaveBalance: Joi.number().min(0).optional().default(0),
  sickLeaveBalance: Joi.number().min(0).optional().default(0),
  casualLeaveBalance: Joi.number().min(0).optional().default(0),
  notes: Joi.string().optional().allow('')
});

const updateStaffSchema = Joi.object({
  designation: Joi.string().allow(''),
  department: Joi.string().allow(''),
  employmentType: Joi.string().valid('FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'),
  salary: Joi.number().min(0).allow(null),
  salaryType: Joi.string().valid('MONTHLY', 'WEEKLY', 'DAILY', 'HOURLY'),
  joiningDate: Joi.string(),
  bankName: Joi.string().allow(''),
  bankAccountNumber: Joi.string().allow(''),
  bankBranchName: Joi.string().allow(''),
  cnicNumber: Joi.string().allow(''),
  cnicExpiry: Joi.string(),
  passportNumber: Joi.string().allow(''),
  emergencyContactName: Joi.string().allow(''),
  emergencyContactPhone: Joi.string().allow(''),
  emergencyContactRelation: Joi.string().allow(''),
  reportingManagerId: Joi.string().allow(''),
  shiftPreference: Joi.string().allow(''),
  weeklyOffDays: Joi.string().allow(''),
  annualLeaveBalance: Joi.number().min(0),
  sickLeaveBalance: Joi.number().min(0),
  casualLeaveBalance: Joi.number().min(0),
  documents: Joi.string().allow(''),
  notes: Joi.string().allow(''),
  performanceRating: Joi.number().min(0).max(5),
  isActive: Joi.boolean()
});

const generateEmployeeId = async (prisma: any): Promise<string> => {
  const last = await prisma.staffProfile.findFirst({
    orderBy: { employeeId: 'desc' }
  });
  if (!last) return 'EMP001';
  const lastNumber = parseInt(last.employeeId.replace('EMP', ''));
  return `EMP${(lastNumber + 1).toString().padStart(3, '0')}`;
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
      department = '',
      isActive = true
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const where: any = {};

    if (isActive !== 'all') {
      where.isActive = isActive === 'true';
    }

    if (department) {
      where.department = department;
    }

    if (status) {
      where.membership = { role: status };
    }

    if (search) {
      where.OR = [
        { employeeId: { contains: search } },
        { designation: { contains: search } },
        { department: { contains: search } },
        { membership: { user: { name: { contains: search } } } },
        { membership: { user: { email: { contains: search } } } }
      ];
    }

    if (branchId) {
      where.membership = {
        ...where.membership,
        branches: { some: { branchId } }
      };
    }

    const [staffProfiles, total] = await Promise.all([
      prisma.staffProfile.findMany({
        where,
        skip,
        take,
        include: {
          membership: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                  phone: true,
                  profileImage: true
                }
              },
              branches: {
                include: {
                  branch: {
                    select: {
                      id: true,
                      name: true
                    }
                  }
                }
              },
              role: {
                select: {
                  id: true,
                  name: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.staffProfile.count({ where })
    ]);

    const staffWithFlatData = staffProfiles.map((sp: any) => ({
      ...sp,
      name: sp.membership?.user?.name || '',
      email: sp.membership?.user?.email || '',
      phone: sp.membership?.user?.phone || '',
      profileImage: sp.membership?.user?.profileImage || null,
      staffId: sp.employeeId,
      position: sp.designation,
      hireDate: sp.joiningDate,
      branch: sp.membership?.branches?.[0]?.branch || null,
      role: sp.membership?.role || null
    }));

    return res.json({
      success: true,
      data: {
        staff: staffWithFlatData,
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

    const staffProfile = await prisma.staffProfile.findFirst({
      where: { id },
      include: {
        membership: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                address: true,
                profileImage: true
              }
            },
            branches: {
              include: {
                branch: {
                  select: {
                    id: true,
                    name: true
                  }
                }
              }
            },
            role: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    });

    if (!staffProfile) {
      return res.status(404).json({
        success: false,
        message: 'Staff not found'
      });
    }

    const flatData = {
      ...staffProfile,
      name: staffProfile.membership?.user?.name || '',
      email: staffProfile.membership?.user?.email || '',
      phone: staffProfile.membership?.user?.phone || '',
      address: staffProfile.membership?.user?.address || '',
      profileImage: staffProfile.membership?.user?.profileImage || null,
      staffId: staffProfile.employeeId,
      position: staffProfile.designation,
      hireDate: staffProfile.joiningDate,
      branch: staffProfile.membership?.branches?.[0]?.branch || null,
      role: staffProfile.membership?.role || null
    };

    return res.json({
      success: true,
      data: flatData
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

    const { error } = createStaffSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const {
      name, email, phone, password, role: roleStr = 'STAFF',
      branchId, businessId: bodyBusinessId,
      designation, department, employmentType, salary, salaryType,
      joiningDate, bankName, bankAccountNumber, bankBranchName,
      cnicNumber, cnicExpiry, passportNumber, emergencyContactName,
      emergencyContactPhone, emergencyContactRelation, reportingManagerId,
      shiftPreference, weeklyOffDays, annualLeaveBalance, sickLeaveBalance,
      casualLeaveBalance, notes
    } = req.body;

    const businessId = bodyBusinessId || req.membership?.business_id;

    if (!businessId) {
      return res.status(400).json({
        success: false,
        message: 'Business ID is required'
      });
    }

    const branch = await prisma.branch.findUnique({
      where: { id: branchId },
      select: { id: true, companyId: true }
    });

    if (!branch) {
      return res.status(400).json({
        success: false,
        message: 'Branch not found'
      });
    }

    const userCompanyId = (req.headers['x-company-id'] as string) || req.membership?.business_id;
    if (userCompanyId && branch.companyId !== userCompanyId) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: Branch belongs to another business'
      });
    }

    let user = await prisma.zapeeraUser.findUnique({ where: { email } });

    if (!user) {
      const bcrypt = require('bcrypt');
      const hashedPassword = password
        ? await bcrypt.hash(password, 10)
        : await bcrypt.hash('Staff@123', 10);

      user = await prisma.zapeeraUser.create({
        data: {
          username: email,
          email,
          password: hashedPassword,
          name,
          phone: phone || null,
          isActive: true
        }
      });
    }

    let membership = await prisma.membership.findFirst({
      where: {
        userId: user.id,
        businessId
      }
    });

    if (!membership) {
      const role = await prisma.role.findFirst({
        where: {
          businessId,
          name: roleStr
        }
      });

      membership = await prisma.membership.create({
        data: {
          userId: user.id,
          businessId,
          roleId: role?.id || null,
          status: 'ACTIVE'
        }
      });
    }

    const existingBranchMembership = await prisma.membershipBranch.findFirst({
      where: {
        membershipId: membership.id,
        branchId
      }
    });

    if (!existingBranchMembership) {
      await prisma.membershipBranch.create({
        data: {
          membershipId: membership.id,
          branchId
        }
      });
    }

    const employeeId = await generateEmployeeId(prisma);

    const staffProfile = await prisma.staffProfile.create({
      data: {
        membershipId: membership.id,
        employeeId,
        designation: designation || null,
        department: department || null,
        employmentType: employmentType || 'FULL_TIME',
        salary: salary && salary > 0 ? salary : null,
        salaryType: salaryType || 'MONTHLY',
        joiningDate: joiningDate ? new Date(joiningDate) : new Date(),
        bankName: bankName || null,
        bankAccountNumber: bankAccountNumber || null,
        bankBranchName: bankBranchName || null,
        cnicNumber: cnicNumber || null,
        cnicExpiry: cnicExpiry ? new Date(cnicExpiry) : null,
        passportNumber: passportNumber || null,
        emergencyContactName: emergencyContactName || null,
        emergencyContactPhone: emergencyContactPhone || null,
        emergencyContactRelation: emergencyContactRelation || null,
        reportingManagerId: reportingManagerId || null,
        shiftPreference: shiftPreference || null,
        weeklyOffDays: weeklyOffDays || null,
        annualLeaveBalance: annualLeaveBalance || 0,
        sickLeaveBalance: sickLeaveBalance || 0,
        casualLeaveBalance: casualLeaveBalance || 0,
        notes: notes || null
      },
      include: {
        membership: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                profileImage: true
              }
            },
            branches: {
              include: {
                branch: {
                  select: {
                    id: true,
                    name: true
                  }
                }
              }
            },
            role: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    });

    syncAfterOperation('staffProfile', 'create', staffProfile).catch((err: any) => {
      console.error('[Sync] StaffProfile create sync failed:', err.message);
    });

    const flatData = {
      ...staffProfile,
      name: staffProfile.membership?.user?.name || '',
      email: staffProfile.membership?.user?.email || '',
      phone: staffProfile.membership?.user?.phone || '',
      profileImage: staffProfile.membership?.user?.profileImage || null,
      staffId: staffProfile.employeeId,
      position: staffProfile.designation,
      hireDate: staffProfile.joiningDate,
      branch: staffProfile.membership?.branches?.[0]?.branch || null,
      role: staffProfile.membership?.role || null
    };

    return res.status(201).json({
      success: true,
      data: flatData,
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

    const existingStaff = await prisma.staffProfile.findFirst({
      where: { id }
    });

    if (!existingStaff) {
      return res.status(404).json({
        success: false,
        message: 'Staff not found'
      });
    }

    const updateData: any = { ...req.body };
    if (updateData.joiningDate) {
      updateData.joiningDate = new Date(updateData.joiningDate);
    }
    if (updateData.cnicExpiry) {
      updateData.cnicExpiry = new Date(updateData.cnicExpiry);
    }

    const staffProfile = await prisma.staffProfile.update({
      where: { id },
      data: updateData,
      include: {
        membership: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
                profileImage: true
              }
            },
            branches: {
              include: {
                branch: {
                  select: {
                    id: true,
                    name: true
                  }
                }
              }
            },
            role: {
              select: {
                id: true,
                name: true
              }
            }
          }
        }
      }
    });

    syncAfterOperation('staffProfile', 'update', staffProfile).catch((err: any) => {
      console.error('[Sync] StaffProfile update sync failed:', err.message);
    });

    const flatData = {
      ...staffProfile,
      name: staffProfile.membership?.user?.name || '',
      email: staffProfile.membership?.user?.email || '',
      phone: staffProfile.membership?.user?.phone || '',
      profileImage: staffProfile.membership?.user?.profileImage || null,
      staffId: staffProfile.employeeId,
      position: staffProfile.designation,
      hireDate: staffProfile.joiningDate,
      branch: staffProfile.membership?.branches?.[0]?.branch || null,
      role: staffProfile.membership?.role || null
    };

    return res.json({
      success: true,
      data: flatData,
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

    const existingStaff = await prisma.staffProfile.findFirst({
      where: { id }
    });

    if (!existingStaff) {
      return res.status(404).json({
        success: false,
        message: 'Staff not found'
      });
    }

    const deletedStaff = await prisma.staffProfile.update({
      where: { id },
      data: { isActive: false }
    });

    syncAfterOperation('staffProfile', 'update', deletedStaff).catch((err: any) => {
      console.error('[Sync] StaffProfile delete sync failed:', err.message);
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
    const { branchId, department } = req.query;

    const where: any = { isActive: true };

    if (department) {
      where.department = department;
    }

    if (branchId) {
      where.membership = {
        branches: { some: { branchId: branchId as string } }
      };
    }

    const [
      totalStaff,
      activeStaff,
      inactiveStaff,
      byDepartment
    ] = await Promise.all([
      prisma.staffProfile.count({ where }),
      prisma.staffProfile.count({ where: { ...where, isActive: true } }),
      prisma.staffProfile.count({ where: { ...where, isActive: false } }),
      prisma.staffProfile.groupBy({
        by: ['department'],
        where,
        _count: { id: true }
      })
    ]);

    return res.json({
      success: true,
      data: {
        totalStaff,
        activeStaff,
        inactiveStaff,
        byDepartment: byDepartment.map((d: any) => ({
          department: d.department || 'Unassigned',
          count: d._count.id
        }))
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
