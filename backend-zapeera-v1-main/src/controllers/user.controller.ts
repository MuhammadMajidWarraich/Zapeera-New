import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { getPrisma, isSQLite } from '../utils/db.util';
import { CreateUserData, UpdateUserData } from '../models/user.model';
import { AuthRequest } from '../middleware/auth.middleware';
import { AdminAuthRequest, logAdminAction } from '../middleware/admin-auth.middleware';
import { syncAfterOperation, pullLatestFromLive } from '../utils/sync-helper';
import { createSearchConditions, withBusinessScope } from '../utils/query-helper';
import { validateStaffCreationAllowance } from '../utils/subscription-entitlements.util';
import { ensureBusinessRole, upsertMembership, upsertMembershipBranch, deleteMembershipByUserBusiness, isMissingTableError } from '../utils/membership-bridge.util';
import Joi from 'joi';

// Validation schemas
const createUserSchema = Joi.object({
  username: Joi.string().min(3).max(30).required(),
  email: Joi.string().pattern(/^[^\s@]+@[^\s@]+$/).required().messages({
    'string.pattern.base': 'Email must contain @ symbol'
  }),
  password: Joi.string().min(6).required(),
  name: Joi.string().required(),
  role: Joi.string().valid('MANAGER', 'CASHIER').required(),
  branchId: Joi.string().allow(null, '').optional()
});

const updateUserSchema = Joi.object({
  username: Joi.string().min(3).max(30),
  email: Joi.string().email({ tlds: { allow: false } }),
  password: Joi.string().min(6),
  name: Joi.string(),
  role: Joi.string().valid('MANAGER', 'CASHIER'),
  branchId: Joi.string(),
  isActive: Joi.boolean()
});

export const getUsers = async (req: AuthRequest, res: Response) => {
  // IMMEDIATE LOG - This should always appear when function is called
  console.log('🔥🔥🔥 getUsers FUNCTION ENTERED 🔥🔥🔥');
  console.log('🔥 URL:', req.originalUrl);
  console.log('🔥 Method:', req.method);
  console.log('🔥 Query:', req.query);
  console.log('🔥 Headers x-company-id:', req.headers['x-company-id']);
  console.log('🔥 Headers x-branch-id:', req.headers['x-branch-id']);
  
  try {
    // ⚠️ DISABLED: Don't pull from PostgreSQL for users in SQLite mode
    // This was causing newly created users to disappear because:
    // 1. User is created in SQLite (local)
    // 2. Pull from PostgreSQL runs (PostgreSQL might be empty or have old data)
    // 3. Local user gets overwritten or filtered out
    //
    // Users should be synced TO PostgreSQL, not FROM PostgreSQL when in SQLite mode
    // Only pull if explicitly requested or when going online
    // pullLatestFromLive('user').catch(err => console.log('[Sync] Pull users:', err.message));

    const prisma = await getPrisma();
    const {
      page = 1,
      limit = 10,
      search = '',
      role = '',
      branchId = '',
      isActive = undefined // CRITICAL FIX: Default to undefined to show ALL users (both active and inactive)
      // This ensures newly created staff (isActive = false) are visible immediately in PostgreSQL mode
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const where: any = {};
    // NOTE: Role filtering removed - the 'role' field was deprecated from ZapeeraUser
    // and moved to Membership model. Admin users are now filtered via membership-based
    // access control in the business context filtering below.

    // CRITICAL FIX: Get context from headers first (set by frontend), then from user object
    const selectedCompanyId = (req.headers['x-company-id'] as string) || req.user?.selectedCompanyId;
    const selectedBranchId = (req.headers['x-branch-id'] as string) || req.user?.selectedBranchId;

    // Debug: Log user context
    console.log('🔍 getUsers - User context:', {
      userId: req.user?.id,
      role: req.user?.role,
      headerCompanyId: req.headers['x-company-id'],
      headerBranchId: req.headers['x-branch-id'],
      selectedCompanyId,
      selectedBranchId,
      createdBy: req.user?.createdBy,
      queryParams: { page, limit, search, role, branchId, isActive }
    });

    // Resolve role in selected business context (prevents global-role leakage across businesses)
    let effectiveRole = String(req.user?.role || '').toUpperCase();
    
    console.log('🔍 getUsers - Role determination:', {
      rawRole: req.user?.role,
      uppercased: effectiveRole,
      isNull: req.user?.role === null,
      isUndefined: req.user?.role === undefined,
      typeOf: typeof req.user?.role,
      isEmpty: effectiveRole === ''
    });
    
    if (selectedCompanyId && String(selectedCompanyId).trim() !== '' && req.user?.id) {
      try {
        const companyCtx = await prisma.business.findUnique({
          where: { id: String(selectedCompanyId) },
          select: { id: true, createdBy: true }
        });
        if (companyCtx?.createdBy && String(companyCtx.createdBy) === String(req.user.id)) {
          effectiveRole = 'OWNER';
        } else if (
          req.membership?.business_id === String(selectedCompanyId) &&
          req.membership.status === 'ACTIVE' &&
          req.membership.role_name
        ) {
          effectiveRole = String(req.membership.role_name).toUpperCase();
        }
      } catch (ctxErr) {
        console.warn('⚠️ getUsers role-context fallback to global role:', ctxErr);
      }
    }

    // Apply company/branch context filtering
    const membershipScope =
      selectedCompanyId && selectedCompanyId.trim() !== ''
        ? withBusinessScope(selectedCompanyId, { status: 'ACTIVE' })
        : null;

    if (false) {
      if (membershipScope) {
        try {
          const companyOwnerRow = await prisma.business.findUnique({
            where: { id: selectedCompanyId },
            select: { createdBy: true }
          });

          where.AND = [
            {
              OR: [
                membershipScope,
                ...(companyOwnerRow?.createdBy ? [{ id: companyOwnerRow!.createdBy! }] : [])
              ]
            }
          ];

          console.log('🏢 Filtering by company memberships');
        } catch (err: any) {
          console.warn('[getUsers] Membership filter failed:', err.message);
        }
      } else {
        console.log('🏢 No context - returning all users');
      }
    } else if (effectiveRole === 'OWNER') {
      // OWNER: show all members of their selected business
      if (membershipScope) {
        try {
          const companyOwnerRow = await prisma.business.findUnique({
            where: { id: selectedCompanyId },
            select: { createdBy: true }
          });

          where.AND = [
            {
              OR: [
                membershipScope,
                ...(companyOwnerRow?.createdBy ? [{ id: companyOwnerRow!.createdBy! }] : [])
              ]
            }
          ];

          console.log('🏢 OWNER: Filtering by company memberships');
        } catch (err: any) {
          console.warn('[getUsers] OWNER membership filter failed:', err.message);
          // Fallback: show only users created by this owner
          where.id = { in: [] };
        }
      } else {
        // No company context — show only users this user created (safe default)
        const adminUserId = req.user?.id;
        where.createdBy = adminUserId;
        console.log('🏢 OWNER: No selected company - showing users created by owner:', adminUserId);
      }
    } else if (effectiveRole === 'MANAGER' || effectiveRole === 'CASHIER') {
      // Manager/Cashier — only see members of the same business
      if (membershipScope) {
        // CRITICAL FIX: Store membershipScope for later merging with branch filter
        // We cannot use where.AND here because branch filter also uses memberships.some
        // which would create conflicting Prisma query conditions
        (req as any).__managerMembershipScope = membershipScope;
      } else {
        where.id = '__no_match__';
      }
    }

    // Build additional filters that will be combined with AND
    const additionalFilters: any[] = [];

    // CRITICAL FIX: Show ALL users by default (both active and inactive)
    // This ensures newly created staff (isActive = false) are visible immediately
    // Admin can see all users and activate them as needed
    // Only filter by isActive if explicitly provided in query params
    if (isActive !== undefined && isActive !== null && isActive !== '') {
      const isActiveStr = String(isActive).toLowerCase();
      if (isActiveStr === 'true' || isActiveStr === '1') {
        // Show only active users (if explicitly requested)
        additionalFilters.push({ isActive: true });
        console.log('🔍 Filtering: Only active users');
      } else if (isActiveStr === 'false' || isActiveStr === '0') {
        // Show only inactive users (if explicitly requested)
        additionalFilters.push({ isActive: false });
        console.log('🔍 Filtering: Only inactive users');
      }
      // If isActive is provided but not 'true'/'false', show all (no filter)
    } else {
      // Default: Show ALL users (both active and inactive) - don't add filter
      // This ensures newly created staff are visible immediately in both SQLite and PostgreSQL modes
      console.log('🔍 No isActive filter - showing ALL users (active + inactive)');
    }

    // Handle role filter (business-scoped via memberships/roles)
    if (role && typeof role === 'string' && role.trim() !== '') {
      const normalizedRole = role.trim().toUpperCase();
      const companyCtxId =
        selectedCompanyId && String(selectedCompanyId).trim() !== '' ? String(selectedCompanyId).trim() : null;

      if (companyCtxId) {
        try {
          const membershipRows = await prisma.$queryRaw<any[]>`
            SELECT DISTINCT m."userId"
            FROM memberships m
            LEFT JOIN roles r ON r.id = m."roleId" AND (r."businessId" = m."businessId" OR r."businessId" IS NULL)
            WHERE m."businessId" = ${companyCtxId}
              AND m.status = 'ACTIVE'
              AND UPPER(COALESCE(r.name, '')) = ${normalizedRole}
          `;

          const membershipUserIds = (membershipRows || [])
            .map((row) => (row?.userId ? String(row.userId) : ''))
            .filter(Boolean);

          if (normalizedRole === 'OWNER') {
            const companyRow = await prisma.business.findUnique({
              where: { id: companyCtxId },
              select: { createdBy: true },
            });
            if (companyRow?.createdBy) {
              membershipUserIds.push(String(companyRow.createdBy));
            }
          }

          const uniqueIds = Array.from(new Set(membershipUserIds));
          if (uniqueIds.length === 0) {
            additionalFilters.push({ id: 'no-matching-role' });
          } else {
            additionalFilters.push({ id: { in: uniqueIds } });
          }
        } catch (err: any) {
          if (!isMissingTableError(err)) {
            throw err;
          }
        }
      } else {
        console.warn('[getUsers] role filter ignored without selected company context:', normalizedRole);
      }
    }

    // Handle branchId query param (different from header branchId)
    // IMPORTANT: User.branchId is deprecated; branch visibility must be resolved via memberships->branches.
    // CRITICAL FIX: For MANAGER/CASHIER, we must merge branch filter with membershipScope
    // to avoid creating conflicting memberships.some conditions in Prisma query
    if (branchId && typeof branchId === 'string' && branchId.trim() !== '') {
      const managerScope = (req as any).__managerMembershipScope;
      
      if (managerScope && (effectiveRole === 'MANAGER' || effectiveRole === 'CASHIER')) {
        // MANAGER/CASHIER: Merge branch filter into the existing membership scope
        // This avoids creating two separate memberships.some conditions
        where.memberships = {
          some: {
            ...managerScope.memberships.some, // businessId and status from membershipScope
            branches: {
              some: {
                branchId: String(branchId),
              },
            },
          },
        };
        // Clear the stored scope since we've applied it
        delete (req as any).__managerMembershipScope;
        console.log('🔍 MANAGER/CASHIER: Merged branch filter with membership scope');
      } else {
        // OWNER/ADMIN: Add branch filter as additional filter
        additionalFilters.push({
          memberships: {
            some: {
              status: 'ACTIVE',
              branches: {
                some: {
                  branchId: String(branchId),
                },
              },
            },
          },
        } as any);
      }
    }

    // Handle search
    if (search && typeof search === 'string' && search.trim() !== '') {
      const searchConditions = createSearchConditions(
        ['name', 'username', 'email'],
        search
      );
      if (searchConditions.OR) {
        additionalFilters.push({ OR: searchConditions.OR });
      }
    }

    // CRITICAL FIX: Apply manager membership scope if it wasn't already applied (no branchId filter)
    const managerScope = (req as any).__managerMembershipScope;
    if (managerScope && (effectiveRole === 'MANAGER' || effectiveRole === 'CASHIER')) {
      if (!where.memberships) {
        // No branch filter was applied, so we need to apply the base membership scope
        where.memberships = managerScope.memberships;
        console.log('🔍 MANAGER/CASHIER: Applied base membership scope (no branch filter)');
      }
      delete (req as any).__managerMembershipScope;
    }

    // CRITICAL FIX: Match embedded-server - Combine base filters with additional filters
    // For ADMIN users, we already have where.AND = [{ OR: [...] }, ...andConditions]
    // So we just need to add additionalFilters to the existing AND array
    if (additionalFilters.length > 0) {
      if (where.AND && Array.isArray(where.AND)) {
        // We already have AND clause (from ADMIN role), just add additional filters to it
        where.AND.push(...additionalFilters);
        console.log('🔍 Added additional filters to existing AND clause:', JSON.stringify(where, null, 2));
      } else if (where.OR && Array.isArray(where.OR)) {
        // We have OR clause but no AND yet, create AND with OR and additional filters
        where.AND = [
          { OR: where.OR },
          ...additionalFilters
        ];
        delete where.OR;
        console.log('🔍 Combined OR with AND filters:', JSON.stringify(where, null, 2));
      } else {
        // No OR/AND clause, just add additional filters directly
        Object.assign(where, ...additionalFilters);
        console.log('🔍 Using additional filters only:', JSON.stringify(where, null, 2));
      }
    } else {
      // No additional filters - keep structure as-is
      if (where.AND) {
        console.log('🔍 Using AND clause only (no additional filters):', JSON.stringify(where, null, 2));
      } else if (where.OR) {
        console.log('🔍 Using OR clause only (no additional filters):', JSON.stringify(where, null, 2));
      }
    }

    // Debug: Log final where clause
    console.log('🔍 getUsers - Final where clause:', {
      whereClause: JSON.stringify(where),
      whereKeys: Object.keys(where),
      isEmpty: Object.keys(where).length === 0
    });
    console.log('🔍 getUsers - User making request:', {
      id: req.user?.id,
      role: req.user?.role,
      createdBy: req.user?.createdBy,
      branchId: req.user?.branchId
    });

    // CRITICAL DEBUG: Query all users first to see what exists
    const allUsersDebug: any[] = await prisma.zapeeraUser.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        createdBy: true,
        isActive: true,
        businessAccessGranted: true
      } as any,
      take: 50 // Increased to see more users
    });
    console.log('🔍 DEBUG - All users in database:', JSON.stringify(allUsersDebug, null, 2));
    console.log('🔍 DEBUG - Total users found:', allUsersDebug.length);

    // Also check users matching the admin's createdBy
    if (req.user?.role === 'OWNER') {
      const adminCreatedBy = req.user?.createdBy || req.user?.id;
      const adminUserId = req.user?.id;
      const adminUsers = allUsersDebug.filter(u =>
        u.createdBy === adminCreatedBy || u.createdBy === adminUserId
      );
      console.log('🔍 DEBUG - Users matching admin createdBy:', JSON.stringify(adminUsers, null, 2));
      console.log('🔍 DEBUG - Admin createdBy value:', adminCreatedBy);
      console.log('🔍 DEBUG - Admin user ID:', adminUserId);
      console.log('🔍 DEBUG - Users with createdBy = adminCreatedBy:', allUsersDebug.filter(u => u.createdBy === adminCreatedBy).length);
      console.log('🔍 DEBUG - Users with createdBy = adminUserId:', allUsersDebug.filter(u => u.createdBy === adminUserId).length);
    }

    // CRITICAL: Execute query with proper error handling
    let users: any[] = [];
    let total = 0;
    
    try {
      [users, total] = await Promise.all([
        prisma.zapeeraUser.findMany({
          where,
          skip,
          take,
          include: {
            memberships: {
              where: selectedCompanyId ? { businessId: String(selectedCompanyId) } : {},
              include: {
                branches: {
                  select: { branchId: true }
                }
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        }),
        prisma.zapeeraUser.count({ where })
      ]);
    } catch (queryError: any) {
      console.error('🔍 getUsers - Query error:', queryError);
      console.error('🔍 getUsers - Where clause that failed:', JSON.stringify(where, null, 2));
      // If query fails, try a simpler query to see what's wrong
      try {
        const simpleUsers = await prisma.zapeeraUser.findMany({ take: 10 });
        console.log('🔍 Simple query found:', simpleUsers.length, 'users');
      } catch (simpleError: any) {
        console.error('🔍 Simple query also failed:', simpleError.message);
      }
      throw queryError; // Re-throw to be caught by outer try-catch
    }

    console.log('🔍 getUsers - Query result:', {
      found: users.length,
      total,
      userIds: users.map(u => u.id),
      usernames: users.map(u => u.username),
      roles: users.map(u => u.role),
      isActiveValues: users.map(u => u.isActive),
      createdByValues: users.map(u => u.createdBy)
    });

    // Log effective role for debugging
    console.log('🔍 getUsers - Effective role:', {
      globalRole: req.user?.role,
      effectiveRole,
      selectedCompanyId,
      selectedBranchId
    });

    /** Per-company role for staff UI: creator = OWNER; members = MANAGER/CASHIER from company_members (not global User.role). */
    let companyCreatorId: string | null = null;
    const memberRoleByUserId = new Map<string, string>();
    const companyCtxId =
      selectedCompanyId && String(selectedCompanyId).trim() !== ''
        ? String(selectedCompanyId).trim()
        : null;
    if (companyCtxId) {
      try {
        const companyRow = await prisma.business.findUnique({
          where: { id: companyCtxId },
          select: { createdBy: true }
        });
        companyCreatorId = companyRow?.createdBy ? String(companyRow.createdBy) : null;
        const membershipsV2 = await prisma.membership.findMany({
          where: {
            businessId: companyCtxId,
            status: 'ACTIVE'
          },
          include: { role: { select: { name: true } } }
        });
        for (const m of membershipsV2) {
          memberRoleByUserId.set(String(m.userId), String(m.role?.name || 'CASHIER').toUpperCase());
        }
      } catch (ctxErr) {
        console.warn('[getUsers] Company/member context for staffListRole skipped:', ctxErr);
      }
    }
    
    // CRITICAL DEBUG: If no users found but we expect some, log more details
    if (users.length === 0 && req.user?.role === 'OWNER') {
      const adminCreatedBy = req.user?.createdBy || req.user?.id;
      const adminUserId = req.user?.id;
      console.error('⚠️ WARNING: No users found for ADMIN!');
      console.error('⚠️ Admin context:', { adminCreatedBy, adminUserId });
      console.error('⚠️ Where clause:', JSON.stringify(where, null, 2));
      
      // Try to find users with simpler query (just createdBy OR)
      const testUsers = await prisma.zapeeraUser.findMany({
        where: {
          OR: [
            { createdBy: adminCreatedBy },
            { createdBy: adminUserId }
          ]
        },
        take: 10,
        select: {
          id: true,
          username: true,
          email: true,
          createdBy: true,
          isActive: true
        }
      });
      console.error('⚠️ Test query (simple OR) found:', testUsers.length, 'users');
      if (testUsers.length > 0) {
        console.error('⚠️ Test users:', testUsers.map(u => ({ 
          id: u.id, 
          username: u.username, 
          createdBy: u.createdBy, 
          isActive: u.isActive
        })));
        console.error('⚠️ DIAGNOSIS: Users exist but are being filtered out by WHERE clause!');
        console.error('⚠️ Check if branch/company filters are too restrictive');
      } else {
        console.error('⚠️ DIAGNOSIS: No users found even with simple query - users may not exist or createdBy mismatch');
      }
    }

    // Remove password from response and ensure plain JS objects
    const usersWithoutPassword = users.map(user => {
      const { password, ...userFields } = user;

      // Compute per-company staff role
      let staffListRole: string | null = null;
      if (companyCtxId) {
        const uid = String(userFields.id);
        if (companyCreatorId && uid === companyCreatorId) {
          staffListRole = 'OWNER';
        } else {
          const cm = memberRoleByUserId.get(uid);
          if (cm === 'MANAGER' || cm === 'CASHIER') {
            staffListRole = cm;
          }
        }
      }

      // Compute branchId for frontend compatibility (from first membership branch)
      let branchId = (userFields as any).branchId;
      if (!branchId && userFields.memberships && userFields.memberships.length > 0) {
        const membership = userFields.memberships[0];
        if (membership.branches && membership.branches.length > 0) {
          branchId = membership.branches[0].branchId;
        }
      }

      // CRITICAL FIX: Create a plain JS object with all fields properly set
      // Include staffListRole and branchId in the response for frontend to use
      const plainUser: any = {
        ...userFields,
        branchId: branchId,
        staffListRole: staffListRole
      };

      console.log('[getUsers] User mapped:', { id: plainUser.id, username: plainUser.username, staffListRole: plainUser.staffListRole, companyCtxId });

      return plainUser;
    });

    return res.json({
      success: true,
      data: {
        users: JSON.parse(JSON.stringify(usersWithoutPassword)),
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      }
    });
  } catch (error: any) {
    console.error('❌ Get users error:', error);
    console.error('❌ Error stack:', error.stack);
    console.error('❌ Error message:', error.message);
    console.error('❌ Error code:', error.code);
    // Return more details in development
    const isDev = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      ...(isDev && { error: error.message, code: error.code })
    });
  }
};

export const getUser = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    // Build where clause with data isolation
    const where: any = { id };

    // Data isolation: Only allow access to users belonging to the same admin
    // CRITICAL FIX: Match getUsers logic - ADMIN should see users they created
    if (req.user?.role === 'OWNER') {
      // OWNER: Show users created by this admin (match getUsers logic)
      const adminCreatedBy = req.user?.createdBy || req.user?.id;
      const adminUserId = req.user?.id;
      
      where.OR = [
        { createdBy: adminCreatedBy },
        { createdBy: adminUserId }
      ];
    } else if (req.user?.createdBy) {
      where.createdBy = req.user.createdBy;
    } else {
      // If no createdBy, show only users created by this user
      where.createdBy = req.user?.id;
    }

    console.log('[Users] getUser - Query:', {
      userId: id,
      adminId: req.user?.id,
      adminRole: req.user?.role,
      where: JSON.stringify(where)
    });

    const user = await prisma.zapeeraUser.findFirst({
      where,
      include: {
        memberships: {
          include: {
            role: true,
            branches: {
              include: {
                branch: {
                  select: {
                    id: true,
                    name: true,
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!user) {
      console.log('[Users] getUser - User not found or access denied:', {
        userId: id,
        adminId: req.user?.id,
        adminRole: req.user?.role,
        where: JSON.stringify(where)
      });
      return res.status(404).json({
        success: false,
        message: 'User not found or access denied'
      });
    }

    // Remove password from response
    const { password, ...userWithoutPassword } = user;

    console.log('[Users] getUser - User found:', {
      userId: user.id,
      username: user.username,
      createdBy: user.createdBy
    });

    return res.json({
      success: true,
      data: userWithoutPassword
    });
  } catch (error) {
    console.error('Get user error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const checkUserExists = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { username, email } = req.query;
    
    if (!username && !email) {
      return res.status(400).json({ success: false, message: 'Username or email required' });
    }

    const where: any = {};
    if (username) where.username = String(username).toLowerCase().trim();
    if (email) where.email = String(email).toLowerCase().trim();

    // Check globally to prevent duplicate usernames/emails across tenants
    const user = await prisma.zapeeraUser.findFirst({
      where,
      select: { id: true, name: true, email: true, username: true }
    });

    if (user) {
      return res.json({ success: true, exists: true, data: user });
    }

    return res.json({ success: true, exists: false });
  } catch (error) {
    console.error('Check user exists error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const createUser = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    console.log('[Users] ========== STAFF CREATION START ==========');
    console.log('[Users] POST request body:', JSON.stringify(req.body, null, 2));
    console.log('[Users] Current user:', { 
      id: req.user?.id, 
      username: req.user?.username, 
      role: req.user?.role, 
      branchId: req.user?.branchId, 
      companyId: req.user?.companyId 
    });

    // CRITICAL: Match embedded-server logic - extract and normalize email/username
    const { email, username, password: userPassword, name, role = 'CASHIER', branchId, companyId } = req.body;
    
    // Frontend sends both username and email, use username as primary identifier (match embedded-server)
    const userEmail = (email || username || '').toLowerCase().trim();
    const userUsername = (username || email || '').toLowerCase().trim();

    // Validate required fields (match embedded-server validation)
    if (!userEmail || !userEmail.length) {
      console.error('[Users] ❌ Email/username is required but not provided');
      return res.status(400).json({ success: false, message: 'Email/username is required' });
    }

    if (!userPassword || !userPassword.trim()) {
      console.error('[Users] ❌ Password is required but not provided');
      return res.status(400).json({ success: false, message: 'Password is required' });
    }

    if (!name || !name.trim()) {
      console.error('[Users] ❌ Name is required but not provided');
      return res.status(400).json({ success: false, message: 'Name is required' });
    }

    if (!userUsername || !userUsername.length) {
      console.error('[Users] ❌ Username is required but not provided');
      return res.status(400).json({ success: false, message: 'Username is required' });
    }

    // CRITICAL: Match embedded-server - Get context from headers (set by frontend)
    const selectedCompanyId = req.headers['x-company-id'] as string || req.user?.selectedCompanyId;
    const selectedBranchId = req.headers['x-branch-id'] as string || req.user?.selectedBranchId;

    // CRITICAL FIX: Match embedded-server - prioritize branchId from body FIRST, then headers, then user's assigned
    // This ensures staff is created with the correct branch context
    const finalBranchId = branchId || selectedBranchId || req.user?.branchId || null;
    const finalCompanyId = companyId || selectedCompanyId || req.user?.companyId || null;

    console.log('[Users] Branch/Company context:', {
      bodyBranchId: branchId,
      headerBranchId: selectedBranchId,
      userBranchId: req.user?.branchId,
      finalBranchId,
      bodyCompanyId: companyId,
      headerCompanyId: selectedCompanyId,
      userCompanyId: req.user?.companyId,
      finalCompanyId
    });

    const userData: CreateUserData = {
      username: userUsername,
      email: userEmail,
      password: userPassword.trim(),
      name: name.trim(),
      role: role as 'MANAGER' | 'CASHIER',
      branchId: finalBranchId || undefined
    };

    // CRITICAL: Match embedded-server - Check if user already exists by email or username (globally)
    // Get full details to check visibility
    const existingUserByEmail = await prisma.zapeeraUser.findUnique({
      where: { email: userEmail },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        createdBy: true,
        isActive: true,
        businessAccessGranted: true
      }
    });

    const existingUserByUsername = await prisma.zapeeraUser.findUnique({
      where: { username: userUsername },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        createdBy: true,
        isActive: true,
        businessAccessGranted: true
      }
    });

    if (existingUserByUsername && existingUserByUsername.email !== userEmail) {
      return res.status(400).json({
        success: false,
        message: 'Username already exists with a different email address',
        data: {
          existingUserId: existingUserByUsername.id,
          existingUserEmail: existingUserByUsername.email
        }
      });
    }

    let existingUser: any = existingUserByEmail || existingUserByUsername;
    let creatingNewUser = false;

    if (!existingUser) {
      if (!userPassword || !userPassword.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Password is required to create a new user'
        });
      }
      creatingNewUser = true;
    }

    // CRITICAL FIX: Validate only one manager per branch
    // If creating a MANAGER, check if the selected branch already has an active manager
    if (role === 'MANAGER' && finalBranchId) {
      const existingManagerMembership = finalCompanyId
        ? await prisma.membership.findFirst({
            where: {
              businessId: String(finalCompanyId),
              status: 'ACTIVE',
              role: { is: { name: 'MANAGER' } },
              branches: {
                some: {
                  branchId: finalBranchId
                }
              }
            },
            select: {
              id: true,
              userId: true,
              user: { select: { id: true, name: true, username: true } },
              branches: {
                where: { branchId: finalBranchId },
                select: { branch: { select: { name: true } } }
              }
            }
          })
        : null;

      const existingManager = existingManagerMembership?.user || null;

      if (existingManager) {
        // Get branch name for better error message
        const branch = await prisma.branch.findUnique({
          where: { id: finalBranchId },
          select: { name: true }
        });
        const branchName = branch?.name || 'this branch';

        return res.status(400).json({
          success: false,
          message: `Only one manager can be assigned to one branch. Branch "${branchName}" already has a manager (${existingManager.name || existingManager.username}).`,
          data: {
            existingManagerId: existingManager.id,
            existingManagerName: existingManager.name || existingManager.username,
            branchId: finalBranchId,
            branchName: branchName
          }
        });
      }
    }

    // Check if branch exists (only if branchId is provided and not null/empty)
    if (finalBranchId && finalBranchId.trim() !== '') {
      const branch = await prisma.branch.findUnique({
        where: { id: finalBranchId }
      });

      if (!branch) {
        console.error('[Users] ❌ Branch not found:', finalBranchId);
        return res.status(400).json({
          success: false,
          message: 'Branch not found'
        });
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(userData.password, parseInt(process.env.BCRYPT_ROUNDS || '12'));

    // Get the current user ID and createdBy from the request (set by auth middleware)
    const currentUserId = req.user?.id;
    const currentUserAdminId = req.user?.createdBy;
    const currentUserCompanyId = req.user?.companyId;

    // For data isolation: createdBy should be the admin who created this user
    // CRITICAL FIX: Always use the current user's ID as createdBy
    // This ensures the user will appear in queries that check for createdBy = adminUserId
    // The query checks for both adminCreatedBy OR adminUserId, so using adminUserId ensures visibility
    const createdByValue = currentUserId; // Always use current user's ID to ensure visibility

    // CRITICAL: Match embedded-server - Use finalCompanyId (from body > headers > user)
    // Get companyId from branch if not set
    let companyIdValue = finalCompanyId || currentUserCompanyId;
    const branchIdValue = finalBranchId;

    // If we have a branch but no company, get the company from the branch
    if (branchIdValue && !companyIdValue) {
      const branch = await prisma.branch.findUnique({
        where: { id: branchIdValue },
        select: { companyId: true }
      });
      if (branch) {
        companyIdValue = branch.companyId;
      }
    }

    if (!companyIdValue) {
      return res.status(400).json({
        success: false,
        message: 'Company is required to add staff members.',
      });
    }

    const company = await prisma.business.findUnique({
      where: { id: companyIdValue },
      select: {
        id: true,
        createdBy: true,
        businessType: true,
      },
    });

    if (!company) {
      return res.status(404).json({
        success: false,
        message: 'Company not found for staff creation',
      });
    }

    const ownerUserId = String(company.createdBy || req.user?.id || '');
    if (!ownerUserId) {
      return res.status(400).json({
        success: false,
        message: 'Business owner is missing. Cannot validate staff limits.',
      });
    }

    const staffCreationAllowance = await validateStaffCreationAllowance(prisma, {
      companyId: company.id,
      ownerUserId,
      businessType: String(company.businessType || 'PHARMACY').toUpperCase() as 'PHARMACY' | 'STORE' | 'HOTEL' | 'CLINIC',
    });

    if (!staffCreationAllowance.allowed) {
      return res.status(staffCreationAllowance.statusCode).json({
        success: false,
        message: staffCreationAllowance.message,
        ...staffCreationAllowance.details,
      });
    }

    console.log('[Users] Creating staff with context:', {
      currentUserId: req.user?.id,
      createdBy: createdByValue,
      finalBranchId: branchIdValue,
      finalCompanyId: companyIdValue,
      role: userData.role,
      name: userData.name,
      email: userEmail,
      username: userUsername
    });

    // CRITICAL: Match embedded-server - Verify createdBy is set
    if (!createdByValue) {
      console.error('[Users] ❌ CRITICAL: No user ID found in request! Cannot set createdBy.');
      return res.status(500).json({ success: false, message: 'Authentication error: User ID not found' });
    }

    // CRITICAL: Match embedded-server - Log user data before creation
    console.log('[Users] ✅ Creating user with isActive = false (inactive by default - must be activated)');  
    console.log('[Users] User data:', {
      username: userData.username,
      email: userData.email,
      name: userData.name,
      role: userData.role,
      branchId: branchIdValue,
      companyId: companyIdValue,
      createdBy: createdByValue,
      isActive: false
    });

    // Create or reuse user in a transaction to ensure it's committed
    const user = await prisma.$transaction(async (tx) => {
      let targetUser = existingUser;

      if (!targetUser) {
        const newUser = await tx.zapeeraUser.create({
          data: {
            username: userData.username,
            email: userData.email,
            password: hashedPassword,
            name: userData.name,
            // branchId: branchIdValue, // DEPRECATED
            // companyId: companyIdValue, // DEPRECATED
            createdBy: createdByValue,
            isActive: false,
            businessAccessGranted: true
          } as any
        });

        targetUser = newUser;
      } else {
        const updateData: any = {};
        // if (!targetUser.companyId) updateData.companyId = companyIdValue; // DEPRECATED
        // if (!targetUser.branchId && branchIdValue) updateData.branchId = branchIdValue; // DEPRECATED
        if (!targetUser.createdBy) updateData.createdBy = createdByValue;

        if (Object.keys(updateData).length > 0) {
          await tx.zapeeraUser.update({
            where: { id: String(targetUser.id) },
            data: updateData
          });

          targetUser = await tx.zapeeraUser.findUnique({
            where: { id: String(targetUser.id) }
          });
        }
      }

      if (!targetUser) {
        throw new Error('Target user could not be loaded or created');
      }

      // Link staff to business in memberships (v2)
      const roleId = await ensureBusinessRole(tx as any, companyIdValue, userData.role);
      const membershipId = await upsertMembership(tx as any, {
        userId: String(targetUser.id),
        businessId: companyIdValue,
        roleId,
        invitedBy: String(currentUserId || company.createdBy || ''),
        status: 'ACTIVE'
      });

      if (membershipId) {
        await upsertMembershipBranch(tx as any, membershipId, branchIdValue || null);
      }

      return targetUser;
    });

    console.log('[Users] ✅ User created and verified in database:', {
      id: user.id,
      username: user.username,
      email: user.email,
      // branchId: user.branchId, // DEPRECATED
      // companyId: user.companyId, // DEPRECATED
      createdBy: user.createdBy,
      isActive: user.isActive
    });

    // Remove password from response
    const { password: _password, ...userWithoutPassword } = user;

    // CRITICAL: Match embedded-server - Verify staff can be retrieved with the ACTUAL GET query
    // Match the exact query structure used in GET endpoint
    console.log('[Users] 🔍 Verifying staff will be visible in GET query...');
    const adminCreatedByValue = req.user?.createdBy || req.user?.id;
    const adminUserIdValue = req.user?.id;
    const uniqueCreatedBy = [...new Set([adminCreatedByValue, adminUserIdValue])];

    // Test if user will be visible in GET query (match getUsers logic)
    const testWhere: any = {};
    if (req.user?.role === 'OWNER') {
      // Match getUsers logic for OWNER
      testWhere.OR = uniqueCreatedBy.map(cb => ({ createdBy: cb }));
    } else {
      // Manager/Cashier - only see users in their branch
      testWhere.branchId = req.user?.branchId;
    }

    const testResult: any[] = await prisma.zapeeraUser.findMany({
      where: {
        ...testWhere,
        id: user.id
      },
      select: { id: true, name: true, createdBy: true, isActive: true, businessAccessGranted: true } as any
    });

    const foundInTest = testResult.length > 0;
    console.log('[Users] ✅ Verification query result:', {
      found: foundInTest,
      testWhere,
      uniqueCreatedBy,
      userId: user.id,
      allResults: testResult
    });

    if (!foundInTest) {
      console.error('[Users] ⚠️ WARNING: Staff created but may not be visible in GET query!');
      console.error('[Users] This might be a query logic issue. Staff ID:', user.id);
      console.error('[Users] User createdBy:', user.createdBy, 'Admin createdBy:', adminCreatedByValue, 'Admin userId:', adminUserIdValue);
    } else {
      console.log('[Users] ✅ Staff will be visible in GET query');
    }

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC (non-blocking, in background)
    // Don't wait for sync - return immediately so user sees the new user
    syncAfterOperation('user', 'create', userWithoutPassword).catch(err => {
      console.error('[Sync] User create sync failed:', err.message);
    });

    console.log('[Users] ✅ Staff found in database:', { 
      id: user.id, 
      name: user.name, 
      email: user.email, 
      createdBy: user.createdBy 
    });

    // Determine database type and sync status
    const dbType = isSQLite() ? 'SQLite' : 'PostgreSQL';
    const syncedToPostgreSQL = !isSQLite(); // If using PostgreSQL, it's already synced

    return res.status(200).json({
      success: true,
      data: userWithoutPassword,
      message: `User created successfully! Username: ${user.username}`,
      dbType: dbType,
      syncedToPostgreSQL: syncedToPostgreSQL
    });
  } catch (error: any) {
    console.error('Create user error:', error);
    console.error('Error details:', {
      message: error?.message,
      code: error?.code,
      meta: error?.meta
    });

    // Handle specific Prisma errors
    if (error?.code === 'P2002') {
      // Unique constraint violation
      const field = error?.meta?.target?.[0] || 'field';
      return res.status(400).json({
        success: false,
        message: `A user with this ${field} already exists`,
        code: 'USER_EXISTS',
        field
      });
    }

    return res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
};

export const updateUser = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    
    console.log('[Users] ========== UPDATE USER START ==========');
    console.log('[Users] Update request:', {
      userId: id,
      adminId: req.user?.id,
      adminRole: req.user?.role,
      adminCreatedBy: req.user?.createdBy,
      updateData: Object.keys(req.body)
    });

    const { error } = updateUserSchema.validate(req.body);

    if (error) {
      console.log('[Users] ❌ Validation error:', error.details);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const updateData: any = req.body;

    // User existence will be checked by the update operation

    // Access control removed for simplicity

    // CRITICAL FIX: Extract membership context BEFORE deleting from updateData
    const targetRole = updateData.role as string | undefined;
    const targetBranchId = updateData.branchId as string | undefined;
    const targetCompanyId = updateData.companyId as string | undefined;

    // Remove isActive and context fields from updateData (these live in Membership, not ZapeeraUser)
    delete updateData.isActive;
    delete updateData.businessAccessGranted;
    delete updateData.companyId;
    delete updateData.branchId;
    delete updateData.role;

    // CRITICAL FIX: Check if username/email already exists (if being updated)
    // Username must be unique globally, but exclude the user being updated
    if (updateData.username || updateData.email) {
      const where: any = {
        isActive: true,
        id: { not: id } // Exclude the user being updated from duplicate check
      };

      if (updateData.username) {
        // Keep Prisma filter SQLite-compatible (no `mode` on SQLite providers)
        where.username = { equals: updateData.username };
      }
      if (updateData.email) {
        where.email = { equals: updateData.email };
      }

      const userExists = await prisma.zapeeraUser.findFirst({ where });

      if (userExists) {
        const conflictField = updateData.username && userExists.username?.toLowerCase() === updateData.username.toLowerCase() 
          ? 'username' 
          : 'email';
        return res.status(400).json({
          success: false,
          message: `User with this ${conflictField} already exists! Please choose a different ${conflictField}.`
        });
      }
    }

    // Hash password if provided
    if (updateData.password) {
      updateData.password = await bcrypt.hash(updateData.password, parseInt(process.env.BCRYPT_ROUNDS || '12'));
    }

    const user = await prisma.zapeeraUser.update({
      where: { id },
      data: updateData
    });

    // CRITICAL FIX: Update membership role/branch if provided (these live in Membership, not ZapeeraUser)
    if (targetRole || targetBranchId) {
      try {
        // Resolve business context
        const businessContextId =
          targetCompanyId ||
          (req.headers['x-company-id'] as string) ||
          req.user?.selectedCompanyId ||
          req.user?.companyId ||
          null;

        let membershipId: string | null = null;
        let businessId: string | null = null;

        if (businessContextId) {
          businessId = String(businessContextId);
          // Find existing membership for this user+business
          const existingMembership = await prisma.membership.findFirst({
            where: { userId: id, businessId: businessId },
            select: { id: true }
          });
          membershipId = existingMembership?.id || null;
        } else {
          // Fallback: use the user's first active membership
          const firstMembership = await prisma.membership.findFirst({
            where: { userId: id, status: 'ACTIVE' },
            select: { id: true, businessId: true }
          });
          if (firstMembership) {
            membershipId = firstMembership.id;
            businessId = firstMembership.businessId;
          }
        }

        if (businessId) {
          // Update role if provided
          if (targetRole) {
            const roleName = targetRole.toUpperCase();
            const roleId = await ensureBusinessRole(prisma as any, businessId, roleName);
            if (roleId) {
              membershipId = await upsertMembership(prisma as any, {
                userId: id,
                businessId: businessId,
                roleId,
                invitedBy: req.user?.id || null,
                status: 'ACTIVE'
              });
            }
          }

          // Update branch if provided (membershipId may have come from existing membership)
          if (targetBranchId && targetBranchId.trim() !== '' && membershipId) {
            await upsertMembershipBranch(prisma as any, membershipId, targetBranchId);
          }

          console.log('[Users] ✅ Membership updated:', {
            userId: id,
            businessId,
            role: targetRole,
            branchId: targetBranchId,
            membershipId
          });
        } else {
          console.warn('[Users] ⚠️ Could not determine businessId for membership update. Skipping role/branch update.');
        }
      } catch (membershipError: any) {
        console.error('[Users] ❌ Membership update failed:', membershipError.message);
        // Don't fail the whole request if membership update fails
      }
    }

    // Remove password from response
    const { password, ...userWithoutPassword } = user;

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('user', 'update', userWithoutPassword).catch(err => {
      console.error('[Sync] User update sync failed:', err.message);
    });

    console.log('[Users] ✅ User updated successfully:', {
      id: user.id,
      username: user.username,
      email: user.email,
      name: user.name,
    });
    console.log('[Users] ========== UPDATE USER END ==========');

    // CRITICAL: Ensure response contains only single user, not users array
    const finalResponse: any = {
      success: true,
      data: userWithoutPassword, // Single user object, NOT { users: [...] }
      message: 'User updated successfully'
    };
    
    console.log('[Users] ✅ Sending update response:', {
      success: finalResponse.success,
      hasData: !!finalResponse.data,
      dataIsArray: Array.isArray(finalResponse.data),
      dataHasUsers: !!(finalResponse.data as any)?.users,
      dataKeys: finalResponse.data ? Object.keys(finalResponse.data) : [],
      userId: finalResponse.data?.id
    });

    return res.status(200).json(finalResponse);
  } catch (error: any) {
    console.error('[Users] ❌ Update user error:', error);
    console.error('[Users] Error details:', {
      message: error?.message,
      code: error?.code,
      stack: error?.stack
    });
    return res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
};

export const deleteUser = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    // Platform accounts must not be hard-deleted from business dashboards — use
    // DELETE /api/companies/:companyId/members/:userId to remove staff from one business only.
    if (true) {
      return res.status(403).json({
        success: false,
        message:
          'Removing staff only removes their access to this business; it does not delete their platform account. Use “Remove from business” in Staff Management, or ask a Super Admin to delete an account globally.'
      });
    }

    const user = await prisma.zapeeraUser.findUnique({
      where: { id }
    });

    if (!user) {
      // CRITICAL FIX: If user not found, return 200 with info message
      // This allows frontend to remove user from list even if already deleted
      console.log('[Users] ⚠️ User not found (already deleted):', id);
      return res.status(200).json({
        success: true,
        message: 'User was already deleted or does not exist'
      });
    }

    console.log('[Users] 🗑️ Deleting user:', {
      id: user!.id,
      username: user!.username,
      email: user!.email,
    });

    // Hard delete - actually remove the user from database
    await prisma.zapeeraUser.delete({
      where: { id }
    });

    console.log('[Users] ✅ User deleted successfully from database');

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC (non-blocking)
    syncAfterOperation('user', 'delete', { id: user!.id, username: user!.username, email: user!.email }).catch(err => {
      console.error('[Sync] User delete sync failed:', err.message);
    });

    return res.status(200).json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error: any) {
    console.error('Delete user error:', error);
    // If error is "Record to delete does not exist", treat as success (already deleted)
    if (error?.code === 'P2025' || error?.message?.includes('does not exist')) {
      console.log('[Users] ⚠️ User already deleted (Prisma error):', error.message);
      return res.status(200).json({
        success: true,
        message: 'User was already deleted or does not exist'
      });
    }
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const activateUser = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const { isActive } = req.body;

    console.log('[Users] Activate user request:', {
      userId: id,
      isActive,
      adminId: req.user?.id,
      adminRole: req.user?.role
    });

    // Check if user exists
    const user = await prisma.zapeeraUser.findUnique({
      where: { id }
    });

    if (!user) {
      console.log('[Users] User not found for activation:', id);
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (false) {
      return res.status(403).json({
        success: false,
        message: 'Access denied: Only Admin can activate or deactivate user accounts'
      });
    }

    console.log('[Users] Activating user:', {
      userId: user.id,
      username: user.username,
      currentStatus: user.isActive,
      newStatus: isActive
    });

    // Update user active status
    const updatedUser = await prisma.zapeeraUser.update({
      where: { id },
      data: { isActive }
    });

    // Remove password from response
    const { password, ...userWithoutPassword } = updatedUser;

    return res.json({
      success: true,
      data: userWithoutPassword,
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`
    });
  } catch (error) {
    console.error('Activate user error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const updateBusinessAccess = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const { businessAccessGranted } = req.body;

    if (typeof businessAccessGranted !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'businessAccessGranted must be a boolean value'
      });
    }

    const user = await prisma.zapeeraUser.findUnique({
      where: { id }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const businessContextId =
      req.business_id || (req.headers['x-company-id'] as string) || req.user?.selectedCompanyId || req.user?.companyId || null;

    const targetMembership = businessContextId
      ? await prisma.membership.findFirst({
          where: {
            userId: user.id,
            businessId: String(businessContextId),
            status: 'ACTIVE'
          },
          include: { role: { select: { name: true } } }
        })
      : null;

    const targetRole = String(targetMembership?.role?.name || '').toUpperCase();

    // Managers can only change access for cashiers in their own branch
    if (req.user?.role === 'MANAGER') {
      if (targetRole && targetRole !== 'CASHIER') {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You can only manage access for cashiers'
        });
      }

      // if (user.branchId !== req.user?.branchId) { // DEPRECATED lookup
      //   return res.status(403).json({
      //     success: false,
      //     message: 'Access denied: You can only manage access for users in your own branch'
      //   });
      // }
    }

    // Owners can only manage users they created
    if (req.user?.role === 'OWNER') {
      const adminCreatedBy = req.user?.createdBy || req.user?.id;
      const adminUserId = req.user?.id;

      if (user.createdBy !== adminCreatedBy && user.createdBy !== adminUserId) {
        return res.status(403).json({
          success: false,
          message: 'Access denied: You can only manage access for users you created'
        });
      }
    }

    const effectiveBranchId = req.headers['x-branch-id'] as string || null;

    if (businessContextId) {
      const businessIdString = String(businessContextId);
      if (businessAccessGranted) {
        const existingMembership = await prisma.membership.findFirst({
          where: {
            userId: user.id,
            businessId: businessIdString
          },
          include: {
            role: {
              select: {
                name: true
              }
            }
          }
        });

        let roleName = existingMembership?.role?.name
          ? String(existingMembership.role.name).toUpperCase()
          : 'CASHIER';

        if (roleName !== 'MANAGER' && roleName !== 'CASHIER') {
          roleName = 'CASHIER';
        }

        const roleId = await ensureBusinessRole(prisma as any, businessIdString, roleName);
        if (roleId) {
          const membershipId = await upsertMembership(prisma as any, {
            userId: user.id,
            businessId: businessIdString,
            roleId,
            invitedBy: req.user?.id || null,
            status: 'ACTIVE'
          });

          if (membershipId && effectiveBranchId) {
            await upsertMembershipBranch(prisma as any, membershipId, effectiveBranchId);
          }
        } else {
        // Legacy CompanyMember upsert removed.
        }

        // await prisma.zapeeraUser.update({
        //   where: { id },
        //   data: {
        //     companyId: businessIdString,
        //     branchId: effectiveBranchId
        //   }
        // });
      } else {
        await deleteMembershipByUserBusiness(prisma as any, user.id, String(businessContextId));
        // Legacy CompanyMember delete removed.
      }
    }

    const updatedUser = await prisma.zapeeraUser.update({
      where: { id },
      data: { businessAccessGranted } as any
    });

    const { password, ...userWithoutPassword } = updatedUser;

    return res.json({
      success: true,
      data: userWithoutPassword,
      message: `Business access ${businessAccessGranted ? 'granted' : 'revoked'} successfully`
    });
  } catch (error) {
    console.error('Update business access error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Get business staff members using Memberships
 * Returns all staff/users in a business with their membership details and roles
 */
export const getBusinessStaff = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { businessId } = req.params;
    const { page = 1, limit = 10, search = '', role = '' } = req.query;

    if (!businessId || String(businessId).trim() === '') {
      res.status(400).json({
        success: false,
        message: 'businessId is required'
      });
      return;
    }

    // Verify business exists and user has access
    const business = await prisma.business.findUnique({
      where: { id: String(businessId) },
      select: { id: true, createdBy: true }
    });

    if (!business) {
      res.status(404).json({
        success: false,
        message: 'Business not found'
      });
      return;
    }

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    // Query memberships with user and role information
    let query = `
      SELECT
        m.id AS membership_id,
        m."userId" AS user_id,
        m.status AS membership_status,
        m."createdAt" AS created_at,
        u.name AS user_name,
        u.username AS username,
        u.email AS email,
        u."isActive" AS user_is_active,
        r.id AS role_id,
        r.name AS role_name,
        COUNT(DISTINCT mb."branchId") AS branch_count
      FROM memberships m
      INNER JOIN zapeera_users u ON u.id = m."userId"
      LEFT JOIN roles r ON r.id = m."roleId"
      LEFT JOIN membership_branches mb ON mb."membershipId" = m.id
      WHERE m."businessId" = '${String(businessId)}'
    `;

    // Add search filter
    if (search && typeof search === 'string' && search.trim() !== '') {
      const searchTerm = String(search).trim().toLowerCase();
      query += ` AND (
        LOWER(u.name) LIKE '%${searchTerm}%' 
        OR LOWER(u.username) LIKE '%${searchTerm}%' 
        OR LOWER(u.email) LIKE '%${searchTerm}%'
      )`;
    }

    // Add role filter
    if (role && typeof role === 'string' && role.trim() !== '') {
      query += ` AND UPPER(r.name) = '${String(role).toUpperCase()}'`;
    }

    query += ` GROUP BY m.id, u.id, r.id
      ORDER BY created_at DESC
      LIMIT ${take} OFFSET ${skip}`;

    const countQuery = `
      SELECT COUNT(DISTINCT m.id) as total
      FROM memberships m
      INNER JOIN zapeera_users u ON u.id = m."userId"
      LEFT JOIN roles r ON r.id = m."roleId"
      WHERE m."businessId" = '${String(businessId)}'
      ${search && typeof search === 'string' && search.trim() !== '' ? `
        AND (
          LOWER(u.name) LIKE '%${String(search).trim().toLowerCase()}%' 
          OR LOWER(u.username) LIKE '%${String(search).trim().toLowerCase()}%' 
          OR LOWER(u.email) LIKE '%${String(search).trim().toLowerCase()}%'
        )` : ''}
      ${role && typeof role === 'string' && role.trim() !== '' ? `
        AND UPPER(r.name) = '${String(role).toUpperCase()}'` : ''}
    `;

    const [staff, countResult] = await Promise.all([
      prisma.$queryRawUnsafe<any[]>(query),
      prisma.$queryRawUnsafe<any[]>(countQuery)
    ]);

    const total = countResult[0]?.total || 0;

    // Format response - minimal fields for UI (name, email, role, status)
    const formattedStaff = staff.map((member: any) => ({
      name: String(member.user_name || ''),
      email: String(member.email || ''),
      role: member.role_name ? String(member.role_name) : null,
      status: String(member.membership_status || 'ACTIVE')
    }));

    res.json({
      success: true,
      data: formattedStaff,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: Number(total),
        pages: Math.ceil(Number(total) / Number(limit))
      }
    });
    return;
  } catch (error) {
    console.error('Get business staff error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch business staff',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return;
  }
};

/**
 * Get all users for backoffice admin
 * Returns all users with basic info for admin management
 */
export const getAllBackofficeUsers = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { search = '', status = 'all', userType = 'all' } = req.query;

    // Build where clause
    const where: any = {};

    // Apply search filter
    if (search) {
      where.OR = [
        { name: { contains: String(search), mode: 'insensitive' } },
        { email: { contains: String(search), mode: 'insensitive' } },
        { username: { contains: String(search), mode: 'insensitive' } }
      ];
    }

    // Apply status filter
    if (status === 'active') {
      where.isActive = true;
    } else if (status === 'inactive') {
      where.isActive = false;
    }

    // Fetch zapeera users
    const [users, total] = await Promise.all([
      prisma.zapeeraUser.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          username: true,
          isActive: true,
          emailVerified: true,
          createdAt: true,
          updatedAt: true,
          lastLoginAt: true,
          createdBy: true,
          _count: {
            select: {
              memberships: true
            }
          }
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.zapeeraUser.count({ where })
    ]);

    // Transform data for response
    const transformedUsers = users.map(user => {
      return {
        id: user.id,
        name: user.name,
        email: user.email,
        username: user.username,
        status: user.isActive ? 'active' : 'inactive',
        isActive: user.isActive,
        emailVerified: (user as any).emailVerified === true || (user as any).emailVerified === 1,
        createdAt: user.createdAt,
        lastLogin: user.lastLoginAt,
        userType: 'zapeera',
        businessesCount: user._count.memberships
      };
    });

    // Filter by userType if specified
    let filteredUsers = transformedUsers;

    return res.json({
      success: true,
      data: filteredUsers,
      meta: {
        total: filteredUsers.length,
        allTotal: total
      }
    });
  } catch (error) {
    console.error('Get all backoffice users error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch users',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Backoffice: Toggle user active/inactive status
 */
export const toggleUserStatus = async (req: AdminAuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'isActive must be a boolean value'
      });
    }

    const prisma = await getPrisma();

    const user = await prisma.zapeeraUser.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, username: true, isActive: true }
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const updatedUser = await prisma.zapeeraUser.update({
      where: { id },
      data: { isActive },
      select: { id: true, name: true, email: true, username: true, isActive: true, createdAt: true }
    });

    await logAdminAction(
      req.admin!.id,
      'TOGGLE_USER_STATUS',
      'User',
      user.id,
      {
        userId: user.id,
        userName: user.name || user.username,
        userEmail: user.email,
        previousStatus: user.isActive,
        newStatus: isActive
      },
      {
        ip: req.ip,
        userAgent: req.get('user-agent')
      }
    );

    return res.json({
      success: true,
      message: `User ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: updatedUser
    });
  } catch (error) {
    console.error('Toggle user status error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

/**
 * Backoffice: Verify a user's email directly (admin override)
 */
export const verifyUserEmail = async (req: AdminAuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const prisma = await getPrisma();

    const user = await prisma.zapeeraUser.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, username: true, emailVerified: true }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const alreadyVerified = (user as any).emailVerified === true || (user as any).emailVerified === 1;
    if (alreadyVerified) {
      return res.json({ success: true, message: 'Email is already verified', data: { id: user.id, emailVerified: true } });
    }

    await prisma.zapeeraUser.update({
      where: { id },
      data: {
        emailVerified: true,
        emailVerificationToken: null,
        emailVerificationExpires: null
      } as any
    });

    await logAdminAction(
      req.admin!.id,
      'VERIFY_USER_EMAIL',
      'User',
      user.id,
      { userId: user.id, userName: user.name || user.username, userEmail: user.email },
      { ip: req.ip, userAgent: req.get('user-agent') }
    );

    return res.json({
      success: true,
      message: `Email verified for ${user.email}`,
      data: { id: user.id, emailVerified: true }
    });
  } catch (error) {
    console.error('Verify user email error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Backoffice: Resend verification email to a user
 */
export const resendUserVerification = async (req: AdminAuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const crypto = await import('crypto');

    const prisma = await getPrisma();

    const user = await prisma.zapeeraUser.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, emailVerified: true }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const alreadyVerified = (user as any).emailVerified === true || (user as any).emailVerified === 1;
    if (alreadyVerified) {
      return res.json({ success: true, message: 'Email is already verified — no need to resend' });
    }

    const verificationToken = crypto.randomBytes(32).toString('hex');
    const verificationExpires = new Date();
    verificationExpires.setHours(verificationExpires.getHours() + 24);

    await prisma.zapeeraUser.update({
      where: { id },
      data: {
        emailVerificationToken: verificationToken,
        emailVerificationExpires: verificationExpires
      } as any
    });

    let emailSent = false;
    try {
      const { emailService } = await import('../services/email.service');
      emailSent = await emailService.sendVerificationEmail(user.email, user.name, verificationToken);
    } catch (emailErr: any) {
      console.error('Failed to send verification email:', emailErr.message);
    }

    await logAdminAction(
      req.admin!.id,
      'RESEND_USER_VERIFICATION',
      'User',
      user.id,
      { userId: user.id, userName: user.name, userEmail: user.email, emailSent },
      { ip: req.ip, userAgent: req.get('user-agent') }
    );

    return res.json({
      success: true,
      message: emailSent
        ? `Verification email sent to ${user.email}`
        : `Verification token generated but email could not be sent. User can verify manually.`,
      data: { emailSent, verificationToken }
    });
  } catch (error) {
    console.error('Resend user verification error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
