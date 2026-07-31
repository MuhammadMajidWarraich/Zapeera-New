import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AuthRequest } from '../middleware/auth.middleware';
import { syncAfterOperation, pullLatestFromLive } from '../utils/sync-helper';
import Joi from 'joi';
import { validateBranchCreationAllowance } from '../utils/subscription-entitlements.util';
import { validateBranchCreationAllowanceV2 } from '../utils/subscription-v2-limits.util';
import { isMissingTableError } from '../utils/membership-bridge.util';

// Validation schemas
const createBranchSchema = Joi.object({
  name: Joi.string().required(),
  address: Joi.string().required(),
  phone: Joi.string().required(),
  email: Joi.string().email().required(),
  companyId: Joi.string().required(),
  managerId: Joi.string().allow(null)
});

const updateBranchSchema = Joi.object({
  name: Joi.string(),
  address: Joi.string(),
  phone: Joi.string(),
  email: Joi.string().email(),
  companyId: Joi.string(),
  managerId: Joi.string().allow(null),
  isActive: Joi.boolean()
});

// Filter branches by user role - ADMIN only sees branches of their companies
export const getBranches = async (req: AuthRequest, res: Response) => {
  try {
    // 🔄 PULL LATEST FROM LIVE DATABASE FIRST
    await Promise.all([
      pullLatestFromLive('branch').catch(err => console.log('[Sync] Pull branches:', err.message)),
      pullLatestFromLive('company').catch(err => console.log('[Sync] Pull companies:', err.message))
    ]);

    const prisma = await getPrisma();
    const { page = 1, limit = 10, search = '' } = req.query;
    const user = req.user;

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const where: any = {
      isActive: true
    };

    // CRITICAL FIX: Apply company context filtering - ALWAYS filter by companyId when provided
    // Headers take priority (set by frontend when business is selected)
    const headerCompanyId = req.headers['x-company-id'] as string;
    const selectedCompanyId = headerCompanyId || req.user?.selectedCompanyId;

    console.log('🏢 getBranches - Company context:', {
      headerCompanyId,
      selectedCompanyId,
      userCompanyId: req.user?.companyId,
      role: req.user?.role
    });

    // Resolve role in selected business context (prevents global-role leakage across businesses)
    let effectiveRole = String(req.user?.role || '').toUpperCase();
    if (selectedCompanyId && selectedCompanyId.trim() !== '' && req.user?.id) {
      try {
        const companyCtx = await prisma.business.findUnique({
          where: { id: selectedCompanyId },
          select: { id: true, createdBy: true }
        });
        if (companyCtx?.createdBy && String(companyCtx.createdBy) === String(req.user.id)) {
          effectiveRole = 'OWNER';
        } else if (
          req.membership?.business_id === selectedCompanyId &&
          req.membership.status === 'ACTIVE' &&
          req.membership.role_name
        ) {
          effectiveRole = String(req.membership.role_name).toUpperCase();
        }
      } catch (ctxErr) {
        console.warn('⚠️ getBranches role-context fallback to global role:', ctxErr);
      }
    }

    // CRITICAL FIX: ALWAYS filter by companyId when provided (strict isolation)
    // When a business is selected, selectedCompanyId will be set from headers
    if (selectedCompanyId && selectedCompanyId.trim() !== '') {
      // STRICT: Only show branches from the selected company (prevent data leakage)
      where.companyId = selectedCompanyId;

      // Enforce membership branch access (v2). Owners see all branches.
      if (
        effectiveRole !== 'OWNER' &&
        req.membership?.id &&
        !String(req.membership.id).startsWith('legacy:')
      ) {
        const allowedBranchIds = req.membership.branch_ids || [];

        if (allowedBranchIds.length > 0) {
          where.id = { in: allowedBranchIds };
        } else {
          where.id = 'no-access';
        }
      }
      console.log('🏢 STRICT filtering branches by selected company:', selectedCompanyId, '(prevents data leakage)');
    } else {
      // If no company selected from headers, filter by user role
      if (effectiveRole === 'OWNER' || effectiveRole === 'USER') {
        // Strict isolation: owner/user must choose a company context to avoid accidental cross-business leakage.
        where.id = 'no-company-selected';
        console.log('🏢 OWNER/USER - no selected company, returning empty to prevent cross-business leakage');
      } else if (effectiveRole === 'MANAGER' || effectiveRole === 'CASHIER') {
        // MANAGER/CASHIER can only see their assigned branch
        const branchId = (req.headers['x-branch-id'] as string) || (user as any)?.branchId || null;
        if (branchId) {
          where.id = branchId;
          console.log('🏢 MANAGER/CASHIER - showing only their branch:', branchId);
        } else {
          where.id = 'no-access';
        }
      } else {
        where.id = 'no-access';
      }
    }

    if (search) {
      where.OR = [
        { name: { contains: search } },
        { address: { contains: search } },
        { phone: { contains: search } },
        { email: { contains: search } }
      ];
    }

    const [branches, total] = await Promise.all([
      prisma.branch.findMany({
        where,
        skip,
        take,
        include: {
          company: {
            select: {
              id: true,
              name: true
            }
          },
          _count: {
            select: {
              products: true,
              customers: true,
              sales: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.branch.count({ where })
    ]);

    // Count staff per branch via MembershipBranch (single query for all branches)
    const branchIds = branches.map((b: any) => b.id);
    let userCountMap = new Map();
    try {
      const allMembershipBranches = await prisma.membershipBranch.findMany({
        where: { branchId: { in: branchIds } },
        select: { branchId: true }
      });
      for (const mb of allMembershipBranches) {
        userCountMap.set(mb.branchId, (userCountMap.get(mb.branchId) || 0) + 1);
      }
    } catch (err) {
      console.log('Could not count staff per branch:', err);
    }

    // Fetch manager info for branches
    // First check managerId, then look for any MANAGER role user assigned to this branch
    const enhancedBranches = await Promise.all(
      branches.map(async (branch: any) => {
        let manager = null;

        // First, try to get manager by managerId if set
        if (branch.managerId) {
          try {
            const managerUser = await prisma.zapeeraUser.findUnique({
              where: { id: branch.managerId },
              select: {
                id: true,
                name: true,
                email: true,
              }
            });
            manager = managerUser;
          } catch (err) {
            console.log('Could not find manager with id:', branch.managerId);
          }
        }

        // If no manager found by managerId, look for any user with MANAGER role in this branch
        if (!manager) {
          try {
            console.log(`Looking for MANAGER in branch: ${branch.id} (${branch.name})`);
            const branchManagerMembership = await prisma.membership.findFirst({
              where: {
                businessId: branch.companyId,
                status: 'ACTIVE',
                role: { is: { name: 'MANAGER' } },
                branches: { some: { branchId: branch.id } }
              },
              include: {
                user: { select: { id: true, name: true, email: true } },
                role: { select: { name: true } }
              }
            });

            const branchManager = branchManagerMembership?.user
              ? { ...branchManagerMembership.user, role: branchManagerMembership.role?.name || 'MANAGER' }
              : null;
            console.log(`Branch ${branch.name} - Manager query result:`, branchManager);
            if (branchManager) {
              manager = branchManager;
              console.log(`✅ Found MANAGER for branch ${branch.name}: ${branchManager.name}`);
            }
          } catch (err) {
            console.log('Error finding branch manager:', err);
          }
        }

        return {
          ...branch,
          _count: {
            ...branch._count,
            users: userCountMap.get(branch.id) || 0
          },
          manager: manager
        };
      })
    );

    return res.json({
      success: true,
      data: {
        branches: enhancedBranches,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      }
    });
  } catch (error) {
    console.error('Get branches error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getBranch = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    const branch = await prisma.branch.findUnique({
      where: { id },
      include: {
        company: {
          select: {
            id: true,
            name: true
          }
        },
        _count: {
          select: {
            products: true,
            customers: true,
            sales: true
          }
        }
      }
    });

    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found'
      });
    }

    const selectedCompanyId =
      (req.headers['x-company-id'] as string) ||
      req.business_id ||
      req.user?.selectedCompanyId ||
      req.user?.companyId ||
      null;

    if (selectedCompanyId && String(branch.companyId) !== String(selectedCompanyId)) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found'
      });
    }

    const role = String(req.user?.role || '').toUpperCase();
    if (role !== 'OWNER') {
      const membershipId = req.membership?.id ? String(req.membership.id) : null;

      if (membershipId && !membershipId.startsWith('legacy:')) {
        try {
          const allowed = await prisma.$queryRaw<any[]>`
            SELECT 1 as allowed
            FROM membership_branches
            WHERE "membershipId" = ${membershipId}
              AND "branchId" = ${String(branch.id)}
            LIMIT 1
          `;
          if (!allowed[0]) {
            return res.status(403).json({
              success: false,
              message: 'Membership is not allowed to access this branch.'
            });
          }
        } catch (accessErr: any) {
          if (!isMissingTableError(accessErr)) {
            throw accessErr;
          }
        }
      } else if (req.membership?.branch_ids && !req.membership.branch_ids.includes(String(branch.id))) {
        return res.status(403).json({
          success: false,
          message: 'Branch access denied for selected context.'
        });
      }
    }

    return res.json({
      success: true,
      data: branch
    });
  } catch (error) {
    console.error('Get branch error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const createBranch = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error } = createBranchSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const { name, address, phone, email, companyId, managerId } = req.body;

    // Verify that the company exists
    const company = await prisma.business.findUnique({
      where: { id: companyId }
    });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found'
      });
    }

    const companyBusinessType = String(company.businessType || 'PHARMACY').toUpperCase() as 'PHARMACY' | 'STORE' | 'HOTEL' | 'CLINIC';
    const companyOwnerId = String(company.createdBy || req.user?.id || '');
    if (!companyOwnerId) {
      return res.status(400).json({
        success: false,
        message: 'Business owner could not be resolved for entitlement checks'
      });
    }

    const branchAllowance = await validateBranchCreationAllowance(prisma, {
      companyId: company.id,
      ownerUserId: companyOwnerId,
      businessType: companyBusinessType,
    });
    const branchAllowanceV2 = await validateBranchCreationAllowanceV2(prisma as any, {
      businessId: company.id,
      ownerUserId: companyOwnerId,
    });
    
    console.log('[Branch] Validation results:', {
      v1Allowed: branchAllowance.allowed,
      v2Allowed: branchAllowanceV2.allowed,
      v1Message: branchAllowance.allowed ? 'OK' : (branchAllowance as any).message,
      v2Message: branchAllowanceV2.allowed ? 'OK' : (branchAllowanceV2 as any).message,
    });
    
    // CRITICAL FIX: If V2 passes (active subscription found), allow creation even if V1 fails
    // This handles case where subscription exists in business_subscriptions but plan not in settings
    if (branchAllowanceV2.allowed) {
      console.log('[Branch] ✅ Branch creation allowed (V2 validation passed - active subscription found)');
    } else if (branchAllowance.allowed) {
      console.log('[Branch] ✅ Branch creation allowed (V1 validation passed)');
    } else {
      // Both validations failed - reject
      const failedV1 = !branchAllowance.allowed ? (branchAllowance as any).message : null;
      const failedV2 = !branchAllowanceV2.allowed ? (branchAllowanceV2 as any).message : null;
      const errorMsg = failedV1 || failedV2 || 'Unable to verify branch creation rights';
      const statusCode = (!branchAllowanceV2.allowed) ? branchAllowanceV2.statusCode : (branchAllowance as any).statusCode;
      console.error('[Branch] ❌ Branch creation denied:', { failedV1, failedV2 });
      return res.status(statusCode || 403).json({
        success: false,
        message: errorMsg,
        ...((!branchAllowanceV2.allowed) ? (branchAllowanceV2 as any).details : (branchAllowance as any).details)
      });
    }

    // NOTE: Removed access check - any user can create branch in any company

    // Check if branch name already exists for this company
    const existingBranch = await prisma.branch.findFirst({
      where: {
        name: name,
        companyId: companyId
      }
    });

    if (existingBranch) {
      return res.status(400).json({
        success: false,
        message: 'Branch with this name already exists in this company'
      });
    }

    // CRITICAL FIX: Ensure only one manager per branch
    // If managerId is provided, validate:
    // 1. The user exists and has MANAGER role
    // 2. The manager is not already assigned to another branch
    // 3. This branch doesn't already have a manager
    if (managerId) {
      // Check if user exists and is a MANAGER
      const managerUser = await prisma.zapeeraUser.findUnique({
        where: { id: managerId },
        select: { id: true }
      });

      if (!managerUser) {
        return res.status(400).json({
          success: false,
          message: 'Manager user not found'
        });
      }

      const managerMembership = await prisma.membership.findFirst({
        where: {
          userId: managerId,
          businessId: companyId,
          status: 'ACTIVE',
          role: { is: { name: 'MANAGER' } }
        },
        include: { role: { select: { name: true } } }
      });

      if (!managerMembership) {
        return res.status(400).json({
          success: false,
          message: 'Selected user is not a MANAGER. Only users with MANAGER role can be assigned as branch manager.'
        });
      }

      // Check if this manager is already assigned to another branch
      const existingManagerBranch = await prisma.branch.findFirst({
        where: {
          managerId: managerId,
          isActive: true
        }
      });

      if (existingManagerBranch) {
        return res.status(400).json({
          success: false,
          message: `This manager is already assigned to branch "${existingManagerBranch.name}". A manager can only be assigned to one branch at a time.`
        });
      }
    }

    const branch = await prisma.branch.create({
      data: {
        name,
        address,
        phone,
        email,
        companyId,
        managerId,
        createdBy: req.user?.id
      },
      include: {
        company: {
          select: {
            id: true,
            name: true
          }
        }
      }
    });

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('branch', 'create', branch).catch(err => {
      console.error('[Sync] Branch create sync failed:', err.message);
    });

    return res.status(201).json({
      success: true,
      data: branch
    });
  } catch (error) {
    console.error('Create branch error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorDetails = error instanceof Error ? (error.stack || '') : '';
    console.error('Create branch error details:', errorDetails);
    return res.status(500).json({
      success: false,
      message: 'Internal server error: ' + errorMessage,
      details: errorDetails.substring(0, 200) // Truncate stack trace for response
    });
  }
};

export const updateBranch = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const { error } = updateBranchSchema.validate(req.body);

    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const updateData = req.body;

    // Check if branch exists
    const existingBranch = await prisma.branch.findUnique({
      where: { id }
    });

    if (!existingBranch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found'
      });
    }

    // Check if name already exists for this admin (if being updated)
    if (updateData.name && updateData.name !== existingBranch.name) {
      const nameExists = await prisma.branch.findFirst({
        where: {
          name: updateData.name,
          createdBy: req.user?.createdBy || req.user?.id
        }
      });

      if (nameExists) {
        return res.status(400).json({
          success: false,
          message: 'Branch with this name already exists'
        });
      }
    }

    // CRITICAL FIX: Ensure only one manager per branch
    // If managerId is being updated, validate:
    // 1. The user exists and has MANAGER role
    // 2. The manager is not already assigned to another branch (unless it's the same branch)
    // 3. If removing manager (managerId = null), that's allowed
    if (updateData.managerId !== undefined) {
      if (updateData.managerId === null) {
        // Removing manager is allowed
        // No validation needed
      } else {
        // Check if user exists and is a MANAGER
        const managerUser = await prisma.zapeeraUser.findUnique({
          where: { id: updateData.managerId },
          select: { id: true }
        });

        if (!managerUser) {
          return res.status(400).json({
            success: false,
            message: 'Manager user not found'
          });
        }

        const managerBusinessId = String(updateData.companyId || existingBranch.companyId);
        const managerMembership = await prisma.membership.findFirst({
          where: {
            userId: updateData.managerId,
            businessId: managerBusinessId,
            status: 'ACTIVE',
            role: { is: { name: 'MANAGER' } }
          },
          include: { role: { select: { name: true } } }
        });

        if (!managerMembership) {
          return res.status(400).json({
            success: false,
            message: 'Selected user is not a MANAGER. Only users with MANAGER role can be assigned as branch manager.'
          });
        }

        // Check if this manager is already assigned to another branch (not this one)
        const existingManagerBranch = await prisma.branch.findFirst({
          where: {
            managerId: updateData.managerId,
            isActive: true,
            id: { not: id } // Exclude current branch
          }
        });

        if (existingManagerBranch) {
          return res.status(400).json({
            success: false,
            message: `This manager is already assigned to branch "${existingManagerBranch.name}". A manager can only be assigned to one branch at a time.`
          });
        }
      }
    }

    const branch = await prisma.branch.update({
      where: { id },
      data: updateData
    });

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    // CRITICAL: Run sync in background and don't let it block the response
    // This prevents sync errors from affecting the branch update
    syncAfterOperation('branch', 'update', branch).catch(err => {
      console.error('[Sync] Branch update sync failed:', err.message);
      // Don't throw - sync failure shouldn't affect the update operation
    });

    return res.json({
      success: true,
      data: branch,
      message: 'Branch updated successfully'
    });
  } catch (error) {
    console.error('Update branch error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const deleteBranch = async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    const branch = await prisma.branch.findUnique({
      where: { id }
    });

    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found'
      });
    }

    // Soft delete
    const deletedBranch = await prisma.branch.update({
      where: { id },
      data: { isActive: false }
    });

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('branch', 'update', deletedBranch).catch(err => {
      console.error('[Sync] Branch delete sync failed:', err.message);
    });

    return res.json({
      success: true,
      message: 'Branch deleted successfully'
    });
  } catch (error) {
    console.error('Delete branch error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};
