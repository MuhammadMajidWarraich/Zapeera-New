import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getPrisma } from '../utils/db.util';
import { getBusinessEntitlementsSummary, SupportedBusinessType } from '../utils/subscription-entitlements.util';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    username: string;
    email?: string;
    name?: string;
    // DEPRECATED: Context should be derived from req.membership
    branchId?: string;
    companyId?: string;
    createdBy?: string; // For data isolation
    selectedCompanyId?: string; // Currently selected company
    selectedBranchId?: string; // Currently selected branch
    sessionToken?: string; // For single-session + session tracking
    role?: string; // Legacy compatibility: derived from membership or platform role
  };
  business_id?: string;
  branch_id?: string;
  membership?: {
    id: string;
    user_id: string;
    business_id: string;
    role_id?: string | null;
    role_name?: string | null; // Role name resolved from Role table
    status: string;
    // Context helper for branch access
    branch_ids: string[]; 
  };
}

export const authenticate = async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    // SECURITY FIX: Remove AUTH_BYPASS in production for security
    const bypassAuth = process.env.NODE_ENV === 'development' && String(process.env.AUTH_BYPASS || '').toLowerCase() === 'true';

    // 1. Try Authorization header
    let token = req.header('Authorization')?.replace('Bearer ', '');

    // 2. Fallback: try auth-token cookie (parsed manually since cookie-parser is not installed)
    if (!token) {
      const cookies = (req.header('Cookie') || '').split(';').reduce<Record<string, string>>((acc, pair) => {
        const [key, ...rest] = pair.trim().split('=');
        if (key) acc[key.trim()] = rest.join('=').trim();
        return acc;
      }, {});
      token = cookies['auth-token'];
    }

    if (!token) {
      if (bypassAuth) {
        req.user = { id: 'guest', username: 'guest' };
        return next();
      }

      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    // Verify JWT token
    let decoded: any;
    try {
      if (!process.env.JWT_SECRET) {
        console.error('❌ JWT_SECRET is not set');
        return res.status(500).json({ message: 'Server configuration error. JWT_SECRET not set.' });
      }
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (jwtError: any) {
      if (bypassAuth) {
        req.user = { id: 'guest', username: 'guest' };
        return next();
      }

      return res.status(401).json({ success: false, message: 'Invalid token' });
    }

    // Get database client (works with SQLite or PostgreSQL)
    let prisma;
    try {
      prisma = await getPrisma();
    } catch (dbError: any) {
      console.error('❌ Database connection failed:', dbError?.message);
      return res.status(503).json({
        success: false,
        message: 'Database connection failed. Please check your database configuration.'
      });
    }

    // Verify user still exists and is active
    // Support both regular user tokens (userId) and admin tokens (adminId)
    let user;
    let isAdmin = false;

    if (decoded.userId) {
      try {
        user = await prisma.zapeeraUser.findUnique({
          where: { id: decoded.userId },
          select: {
            id: true,
            username: true,
            createdBy: true,
            isActive: true,
            sessionToken: true // For single-session validation
          }
        });
      } catch (userLookupError: any) {
        console.error('❌ User lookup failed:', userLookupError?.message);
        return res.status(503).json({
          success: false,
          message: 'Database query failed. Please check your database connection.'
        });
      }
    } else if (decoded.adminId && decoded.isAdmin) {
      isAdmin = true;
      try {
        const admin = await prisma.backOfficeUser.findUnique({
          where: { id: decoded.adminId },
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true
          }
        });
        if (admin) {
          // Map admin to user shape for compatibility
          user = {
            id: admin.id,
            username: admin.email,
            createdBy: admin.id,
            isActive: admin.isActive,
            sessionToken: null
          };
          // Store admin role on request for role guards
          (req as any).adminRole = admin.role;
        }
      } catch (adminLookupError: any) {
        console.error('❌ Admin lookup failed:', adminLookupError?.message);
        return res.status(503).json({
          success: false,
          message: 'Database query failed. Please check your database connection.'
        });
      }
    }

    if (!user) {
      if (bypassAuth) {
        req.user = { id: 'guest', username: 'guest' };
        return next();
      }

      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    
    // SECURITY: Inactive accounts should never have access
    if (!user.isActive) {
      if (bypassAuth) {
        req.user = { id: 'guest', username: 'guest' };
        return next();
      }

      return res.status(403).json({
        success: false,
        message: 'Account is not active. Please contact the administrator.',
        accountDeactivated: true
      });
    }

    // For users created by others, preserve createdBy; self-creators use their own ID

    // NOTE: Single-session enforcement is disabled so that desktop and web
    // sessions can coexist. Logging in on the desktop no longer invalidates
    // the active web session.

    // Get context headers from frontend
    const selectedCompanyId = req.header('X-Business-ID');
    const selectedBranchId = req.header('X-Branch-ID');

    // For users created by others, preserve createdBy; self-creators use their own ID
    let createdBy = user.createdBy;
    if (!createdBy || createdBy === '') {
      createdBy = user.id;
    }

    req.user = {
      id: user.id,
      username: user.username,
      createdBy: createdBy || undefined,
      selectedCompanyId: selectedCompanyId || undefined,
      selectedBranchId: selectedBranchId || undefined,
      sessionToken: decoded.sessionToken ? String(decoded.sessionToken) : undefined,
      role: isAdmin ? (req as any).adminRole || 'SUPER_ADMIN' : undefined,
    };

    // MULTI-TENANT: Resolve Membership Context
    if (selectedCompanyId) {
      const membership = await prisma.membership.findUnique({
        where: {
          unique_user_business: {
            userId: user.id,
            businessId: selectedCompanyId
          }
        },
        include: {
          role: { select: { name: true } },
          branches: { select: { branchId: true } }
        }
      });

      if (membership && membership.status === 'ACTIVE') {
        const roleName = membership.role?.name || 'OWNER';
        req.membership = {
          id: membership.id,
          user_id: membership.userId,
          business_id: membership.businessId,
          role_id: membership.roleId,
          role_name: roleName,
          status: membership.status,
          branch_ids: membership.branches.map(b => b.branchId)
        };
        // DO NOT overwrite req.user.role here. Use req.membership.role_name instead.
      }
    }

    // Enforce per-business concurrent sessions when a company context is selected.
    try {
      const companyContextId = req.user.selectedCompanyId || (req.headers['x-company-id'] as string | undefined);
      const sessionToken = req.user.sessionToken;

      // Skip concurrent session check if no companyContextId
      if (companyContextId && sessionToken) {
        const ttlMinutes = Number(process.env.SESSION_TTL_MINUTES || 30);
        const ttlMs = Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes * 60 * 1000 : 30 * 60 * 1000;
        const activeSince = new Date(Date.now() - ttlMs);

        const company = await prisma.business.findUnique({
          where: { id: companyContextId },
          select: { id: true, createdBy: true, businessType: true },
        });

        if (company) {
          const ownerUserId = company.createdBy ? String(company.createdBy) : '';
          const isOwner = ownerUserId && ownerUserId === user.id;

          if (!isOwner) {
            const businessType = (String(company.businessType || 'PHARMACY').toUpperCase()) as SupportedBusinessType;
            const entitlement = await getBusinessEntitlementsSummary(prisma, {
              companyId: company.id,
              ownerUserId: ownerUserId || user.id,
              businessType,
            });

            const maxSessions = entitlement?.effectiveLimits?.maxConcurrentSessions ?? null;
            if (maxSessions !== null && typeof maxSessions === 'number') {
              const SESSION_SETTINGS_KEY = 'active_sessions_v1';
              const settingsOwner = `session_company_${company.id}`;
              const now = new Date();

              const existingSetting = await prisma.settings.findUnique({
                where: {
                  createdBy_key: {
                    createdBy: settingsOwner,
                    key: SESSION_SETTINGS_KEY,
                  },
                },
                select: { id: true, value: true },
              });

              let items: Array<{ userId: string; sessionToken: string; lastSeenAt: string }> = [];
              if (existingSetting?.value) {
                try {
                  const parsed = JSON.parse(existingSetting.value) as { items?: unknown };
                  if (Array.isArray((parsed as any)?.items)) {
                    items = (parsed as any).items
                      .filter((entry: any) => entry && typeof entry === 'object')
                      .map((entry: any) => ({
                        userId: String(entry.userId || ''),
                        sessionToken: String(entry.sessionToken || ''),
                        lastSeenAt: String(entry.lastSeenAt || ''),
                      }))
                      .filter(
                        (entry: { userId: string; sessionToken: string; lastSeenAt: string }) =>
                          entry.userId && entry.sessionToken && entry.lastSeenAt
                      );
                  }
                } catch {
                  items = [];
                }
              }

              // Prune expired entries (inactivity TTL)
              items = items.filter((entry) => {
                const lastSeen = new Date(entry.lastSeenAt);
                return Number.isFinite(lastSeen.getTime()) && lastSeen >= activeSince;
              });

              const currentIndex = items.findIndex((entry) => entry.userId === user.id);
              const currentRecord = currentIndex >= 0 ? items[currentIndex] : null;
              const alreadyActive = currentRecord?.sessionToken === sessionToken;

              if (!alreadyActive) {
                // If user was previously active with a different token, replace it (new login kicks old one out)
                if (currentIndex >= 0) {
                  items.splice(currentIndex, 1);
                }

                const freshCapacityItems = ownerUserId
                  ? items.filter((entry) => entry.userId !== ownerUserId)
                  : items;
                const freshUniqueUserIds = Array.from(new Set(freshCapacityItems.map((entry) => entry.userId)));

                if (freshUniqueUserIds.length >= maxSessions) {
                  return res.status(403).json({
                    success: false,
                    message:
                      'Concurrent login limit reached for this business. Please logout another user and try again.',
                    details: { companyId: company.id, maxConcurrentSessions: maxSessions },
                  });
                }

                items.push({ userId: user.id, sessionToken, lastSeenAt: now.toISOString() });
              } else {
                items[currentIndex] = { ...currentRecord!, lastSeenAt: now.toISOString() };
              }

              const payload = JSON.stringify({ items });
              
              // SECURITY FIX: Use transaction to prevent race conditions
              await prisma.$transaction(async (tx) => {
                // Re-read within transaction to ensure consistency
                const currentSetting = await tx.settings.findUnique({
                  where: {
                    createdBy_key: {
                      createdBy: settingsOwner,
                      key: SESSION_SETTINGS_KEY,
                    },
                  },
                  select: { id: true, value: true },
                });
                
                // Merge with any changes made since we last read
                let currentItems: Array<{ userId: string; sessionToken: string; lastSeenAt: string }> = [];
                if (currentSetting?.value) {
                  try {
                    const parsed = JSON.parse(currentSetting.value) as { items?: unknown };
                    if (Array.isArray((parsed as any)?.items)) {
                      currentItems = (parsed as any).items
                        .filter((entry: any) => entry && typeof entry === 'object')
                        .map((entry: any) => ({
                          userId: String(entry.userId || ''),
                          sessionToken: String(entry.sessionToken || ''),
                          lastSeenAt: String(entry.lastSeenAt || ''),
                        }))
                        .filter((entry: { userId: string; sessionToken: string; lastSeenAt: string }) => entry.userId && entry.sessionToken && entry.lastSeenAt);
                    }
                  } catch {
                    currentItems = [];
                  }
                }
                
                // Prune expired entries again within transaction
                const prunedItems = currentItems.filter((entry) => {
                  const lastSeen = new Date(entry.lastSeenAt);
                  return Number.isFinite(lastSeen.getTime()) && lastSeen >= activeSince;
                });
                
                // Merge our new entry with pruned list
                const existingIndex = prunedItems.findIndex(e => e.userId === user.id);
                if (existingIndex >= 0) {
                  prunedItems[existingIndex] = { userId: user.id, sessionToken, lastSeenAt: now.toISOString() };
                } else {
                  prunedItems.push({ userId: user.id, sessionToken, lastSeenAt: now.toISOString() });
                }
                
                const finalPayload = JSON.stringify({ items: prunedItems });
                
                await tx.settings.upsert({
                  where: {
                    createdBy_key: {
                      createdBy: settingsOwner,
                      key: SESSION_SETTINGS_KEY,
                    },
                  },
                  update: {
                    value: finalPayload,
                    updatedAt: now,
                  },
                  create: {
                    createdBy: settingsOwner,
                    key: SESSION_SETTINGS_KEY,
                    value: finalPayload,
                    description: 'Active business sessions for concurrent login enforcement',
                  },
                });
              }, {
                // Transaction options
                isolationLevel: 'Serializable',
                maxWait: 5000,
                timeout: 10000,
              });
            }
          }
        }
      }
    } catch (e) {
      console.warn('[auth] Concurrent session enforcement skipped due to error:', e);
    }

    return next();
  } catch (error: any) {
    console.error('❌ Auth middleware error:', error);
    console.error('❌ Error message:', error?.message);
    console.error('❌ Error stack:', error?.stack);
    const bypassAuth = process.env.NODE_ENV === 'development' && String(process.env.AUTH_BYPASS || '').toLowerCase() === 'true';
    if (bypassAuth) {
      req.user = { id: 'guest', username: 'guest' };
      return next();
    }

    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }
};

export const authorize = (...roles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    // Ensure membership exists for business-scoped authorization
    const rawRole = req.membership?.role_name ? String(req.membership.role_name).toUpperCase() : '';
    // Treat ADMIN as OWNER for legacy compatibility
    const membershipRole = rawRole === 'ADMIN' ? 'OWNER' : rawRole;
    if (!membershipRole) {
      return res.status(403).json({ success: false, message: 'Access denied. No membership context found.' });
    }

    const allowed = roles.map(r => String(r || '').toUpperCase()).includes(membershipRole);
    if (allowed) return next();

    return res.status(403).json({ success: false, message: 'Access denied. Insufficient role.' });
  };
};

export const getUserRole = (req: AuthRequest): string => {
  const membershipRole = String(req.membership?.role_name || '').toUpperCase();
  if (membershipRole) {
    return membershipRole;
  }

  const userRole = String(req.user?.role || '').toUpperCase();
  return userRole;
};

/**
 * Helper function to build admin-aware where clauses for data isolation
 * This ensures all database queries are automatically scoped to the correct admin
 */
export const buildAdminWhereClause = (req: AuthRequest, baseWhere: any = {}) => {
  const whereClause = { ...baseWhere };

  // MULTI-TENANT: Use membership context for company isolation
  const selectedCompanyId = req.membership?.business_id || req.headers['x-company-id'] as string;
  const selectedBranchId = req.headers['x-branch-id'] as string;

  // Apply company context filtering if available
  if (selectedCompanyId) {
    whereClause.companyId = selectedCompanyId;
  } else {
    // If no company context is provided for a business-scoped query, we must fail-closed
    // to prevent cross-business data leakage.
    whereClause.companyId = 'no-business-context';
  }

  // Apply branch context filtering if available
  if (selectedBranchId) {
    whereClause.branchId = selectedBranchId;
  }

  // For data createdBy isolation: owners see everything in their business, 
  // but we still support the createdBy field for certain legacy queries.
  // In the new model, we should prefer companyId filtering.
  if (req.user?.createdBy) {
    return {
      ...whereClause,
      createdBy: req.user.createdBy
    };
  }

  return whereClause;
};

/**
 * Helper function to build branch-aware where clauses
 * This ensures all database queries are automatically scoped to the correct branch
 */
export const buildBranchWhereClause = (req: AuthRequest, baseWhere: any = {}) => {
  const whereClause = { ...baseWhere };

  const selectedCompanyId = req.membership?.business_id || req.headers['x-company-id'] as string;
  const selectedBranchId = req.headers['x-branch-id'] as string;

  if (selectedCompanyId) {
    whereClause.companyId = selectedCompanyId;
  } else {
    whereClause.companyId = 'no-business-context';
  }

  // Role-based branch filtering
  const role = req.membership?.role_name?.toUpperCase() || '';

  if (role === 'OWNER' || role === 'ADMIN') {
    if (selectedBranchId) {
      whereClause.branchId = selectedBranchId;
    }
    return whereClause;
  }

  // MANAGER/CASHIER: Limit to their assigned branches
  if (req.membership?.branch_ids && req.membership.branch_ids.length > 0) {
    if (selectedBranchId && req.membership.branch_ids.includes(selectedBranchId)) {
      whereClause.branchId = selectedBranchId;
    } else {
      // If no branch selected or selected branch not allowed, limit to all allowed branches
      whereClause.branchId = { in: req.membership.branch_ids };
    }
  }

  return whereClause;
};

/**
 * Helper function to build branch-aware where clauses for models that don't have branchId directly
 * This is used for models like Refund that only have branchId through relations
 */
export const buildBranchWhereClauseForRelation = (req: AuthRequest, baseWhere: any = {}) => {
  const whereClause = { ...baseWhere };

  const selectedCompanyId = req.membership?.business_id || (req.headers['x-company-id'] as string);

  // Apply company context filtering if available
  if (selectedCompanyId) {
    whereClause.companyId = selectedCompanyId;
  } else {
    whereClause.companyId = 'no-business-context';
  }

  // With business-scoped roles, check membership role
  const membershipRole = req.membership?.role_name ? String(req.membership.role_name).toUpperCase() : '';

  // OWNER and ADMIN can access all branches within their business scope
  if (membershipRole === 'OWNER' || membershipRole === 'ADMIN') {
    return buildAdminWhereClause(req, whereClause);
  }

  // MANAGER can only access data from their assigned branch
  if (membershipRole === 'MANAGER' && req.user?.branchId) {
    return {
      ...whereClause,
      createdBy: req.user.createdBy
      // Note: branchId will be handled through the relation filter
    };
  }

  // CASHIER can only access data from their assigned branch
  // Note: branchId will be handled through the relation filter
  if (membershipRole === 'CASHIER' && req.user?.branchId) {
    return whereClause;
  }

  // If no admin context, return empty where clause
  return {
    ...whereClause,
    createdBy: 'non-existent-admin-id' // This will return no results
  };
};

/**
 * Middleware to validate that a resource belongs to the user's admin
 * Use this for operations that access specific resources by ID
 */
export const validateResourceOwnership = (resourceType: string) => {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      // With business-scoped roles, all users are checked for resource ownership
      // (no global SUPERADMIN bypass)

      const resourceId = req.params.id;
      if (!resourceId) {
        res.status(400).json({
          success: false,
          message: 'Resource ID required'
        });
        return;
      }

      // Get database client
      const prisma = await getPrisma();
      
      const businessId = req.membership?.business_id || req.headers['x-company-id'] as string;

      // Check if resource belongs to user's current business
      const resource = await (prisma as any)[resourceType].findFirst({
        where: {
          id: resourceId,
          companyId: businessId || 'no-business-context'
        },
        select: { id: true }
      });

      if (!resource) {
        res.status(403).json({
          success: false,
          message: 'Access denied. Resource does not belong to this business.'
        });
        return;
      }

      next();
      return;
    } catch (error) {
      console.error('Resource ownership validation error:', error);
      res.status(500).json({
        success: false,
        message: 'Internal server error'
      });
      return;
    }
  };
};
