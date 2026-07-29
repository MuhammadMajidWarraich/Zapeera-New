import { Request, Response } from 'express';
import Joi from 'joi';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getPrisma } from '../utils/db.util';
import { AuthRequest } from '../middleware/auth.middleware';
import { syncAfterOperation, pullLatestFromLive } from '../utils/sync-helper';
import { validateStaffCreationAllowance } from '../utils/subscription-entitlements.util';
import {
  deleteMembershipByUserBusiness,
  ensureBusinessRole,
  isMissingTableError,
  listBusinessMembershipUsers,
  upsertMembership,
  upsertMembershipBranch,
} from '../utils/membership-bridge.util';
import {
  validateMembershipInviteAllowanceV2,
} from '../utils/subscription-v2-limits.util';

function slugifyBusinessName(input: string): string {
  const raw = String(input || '').trim().toLowerCase();
  const slug = raw
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  return slug || 'business';
}

async function generateUniqueCompanySlug(
  prisma: Awaited<ReturnType<typeof getPrisma>>,
  baseSlug: string,
  opts?: { ignoreCompanyId?: string }
): Promise<string> {
  const normalizedBase = slugifyBusinessName(baseSlug);
  let candidate = normalizedBase;
  for (let i = 0; i < 50; i++) {
    const existing = await prisma.business.findFirst({
      where: {
        slug: candidate,
        ...(opts?.ignoreCompanyId ? { id: { not: opts.ignoreCompanyId } } : {}),
      },
      select: { id: true },
    });
    if (!existing) return candidate;
    candidate = `${normalizedBase}-${i + 2}`;
  }
  return `${normalizedBase}-${Date.now().toString(36)}`;
}

// Validation schemas
const createCompanySchema = Joi.object({
  name: Joi.string().min(2).max(100).required(),
  description: Joi.string().max(500).optional(),
  address: Joi.string().max(200).optional(),
  phone: Joi.string().max(20).optional(),
  email: Joi.string().email().optional(),
  businessType: Joi.string().max(100).optional(),
  createdByUserId: Joi.string().optional()
});

const updateCompanySchema = Joi.object({
  name: Joi.string().min(2).max(100).optional(),
  description: Joi.string().max(500).optional(),
  address: Joi.string().max(200).optional(),
  phone: Joi.string().max(20).optional(),
  email: Joi.string().email().optional(),
  businessType: Joi.string().max(100).optional()
});

const businessStaffInviteSchema = Joi.object({
  userId: Joi.string().optional(),
  email: Joi.string().email().optional(),
  role: Joi.string().valid('MANAGER', 'CASHIER').required(),
  branchId: Joi.string().allow(null, '').optional(),
}).xor('userId', 'email');

const companyInclude = {
  branches: {
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      address: true,
      phone: true,
      email: true,
    }
  },
  _count: {
    select: {
      branches: true,
      memberships: true,
      employees: true,
      products: true
    }
  }
};

const listUserSharedMembershipsV2 = async (
  prisma: Awaited<ReturnType<typeof getPrisma>>,
  userId: string
): Promise<Array<{ businessId: string; role: string | null; branchId: string | null }>> => {
  try {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT
        m.businessId AS business_id,
        r.name AS role_name,
        mb.branchId AS branch_id
      FROM memberships m
      LEFT JOIN roles r ON r.id = m.roleId
      LEFT JOIN membership_branches mb ON mb.membershipId = m.id
      WHERE m.userId = ${userId}
        AND m.status = 'ACTIVE'
      ORDER BY m.createdAt DESC
    `;

    const byBusiness = new Map<string, { businessId: string; role: string | null; branchId: string | null }>();
    for (const row of rows) {
      const businessId = String(row.business_id || '');
      if (!businessId || byBusiness.has(businessId)) continue;
      byBusiness.set(businessId, {
        businessId,
        role: row.role_name ? String(row.role_name).toUpperCase() : null,
        branchId: row.branch_id ? String(row.branch_id) : null,
      });
    }

    return Array.from(byBusiness.values());
  } catch (error: any) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
};

const getBusinessMembershipContextV2 = async (
  prisma: Awaited<ReturnType<typeof getPrisma>>,
  businessId: string,
  userId: string
): Promise<{ role: string | null; branchId: string | null } | null> => {
  try {
    const rows = await prisma.$queryRaw<any[]>`
      SELECT
        r.name AS role_name,
        mb.branchId AS branch_id
      FROM memberships m
      LEFT JOIN roles r ON r.id = m.roleId
      LEFT JOIN membership_branches mb ON mb.membershipId = m.id
      WHERE m.businessId = ${businessId}
        AND m.userId = ${userId}
        AND m.status = 'ACTIVE'
      LIMIT 1
    `;
    if (!rows[0]) return null;
    return {
      role: rows[0].role_name ? String(rows[0].role_name).toUpperCase() : null,
      branchId: rows[0].branch_id ? String(rows[0].branch_id) : null,
    };
  } catch (error: any) {
    if (isMissingTableError(error)) return null;
    throw error;
  }
};

// Get all companies for the authenticated user
// Filter by user role - ADMIN only sees their own companies
export const getCompanies = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const user = req.user;

    // 🔄 PULL LATEST FROM LIVE DATABASE FIRST (only if using SQLite mode)
    // If already using PostgreSQL (USE_POSTGRESQL=true), no pull needed - data is already there!
    const isPostgreSQLMode = process.env.USE_POSTGRESQL === 'true';
    if (!isPostgreSQLMode) {
      // Only pull if using SQLite (Electron mode)
      await Promise.all([
        pullLatestFromLive('company').catch(err => console.log('[Sync] Pull companies:', err.message)),
        pullLatestFromLive('branch').catch(err => console.log('[Sync] Pull branches:', err.message))
      ]);
    } else {
      console.log('[Sync] ⏭️  PostgreSQL mode - No pull needed (data already in PostgreSQL)');
    }

    if (!user) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    const userRole = String(req.membership?.role_name || user?.role || '').toUpperCase();
    let companies: any[] = [];

    if (false) {
      companies = await prisma.business.findMany({
        where: { isActive: true },
        include: companyInclude,
        orderBy: { createdAt: 'desc' }
      });
    } else {
      const ownedCompanies = await prisma.business.findMany({
        where: { isActive: true, createdBy: user.id },
        include: companyInclude,
        orderBy: { createdAt: 'desc' }
      });

      const ownedIds = new Set(ownedCompanies.map((c) => c.id));
      const sharedMap = new Map<string, any>();

      try {
        const v2Memberships = await listUserSharedMembershipsV2(prisma, String(user.id));
        if (v2Memberships.length > 0) {
          const businessIds = v2Memberships.map((m) => m.businessId);
          const sharedCompaniesV2 = await prisma.business.findMany({
            where: {
              id: { in: businessIds },
              isActive: true
            },
            include: companyInclude
          });
          const membershipByBusinessId = new Map(v2Memberships.map((m) => [m.businessId, m]));
          for (const company of sharedCompaniesV2) {
            if (!company) continue;
            if (company.createdBy === user.id) continue;
            const member = membershipByBusinessId.get(company.id);
            sharedMap.set(company.id, {
              ...company,
              accessType: 'shared',
              memberRole: member?.role || undefined,
              memberBranchId: member?.branchId || undefined
            });
          }
        }
      } catch (membershipError) {
        console.warn('[Companies] shared-membership lookup failed:', membershipError);
      }


      companies = [
        ...ownedCompanies.map((company) => ({
          ...company,
          accessType: 'owned'
        })),
        ...Array.from(sharedMap.values())
      ];
    }

    // Backfill missing slugs (legacy records; slug is nullable for now)
    try {
      const needingSlug = companies.filter((c: any) => c && c.id && c.name && !c.slug);
      if (needingSlug.length) {
        await Promise.all(
          needingSlug.map(async (c: any) => {
            const desired = slugifyBusinessName(String(c.name));
            const uniqueSlug = await generateUniqueCompanySlug(prisma, desired, { ignoreCompanyId: String(c.id) });
            await prisma.business.update({
              where: { id: String(c.id) },
              data: { slug: uniqueSlug, updatedAt: new Date() },
            });
            c.slug = uniqueSlug;
          })
        );
      }
    } catch (err) {
      console.warn('[Companies] slug backfill skipped:', err);
    }

    const creatorIds = Array.from(
      new Set(companies.map((company) => company.createdBy).filter(Boolean))
    ) as string[];

    const creators = creatorIds.length > 0
      ? await prisma.zapeeraUser.findMany({
          where: { id: { in: creatorIds } },
          select: {
            id: true,
            name: true,
            email: true
          }
        })
      : [];

    const companiesWithCreator = companies.map((company) => ({
      ...company,
      createdByUser: creators.find((creator) => creator.id === company.createdBy) || null
    }));

    console.log(`🏢 Returning ${companiesWithCreator.length} companies for user ${user?.id} (${user?.role})`);
    console.log(`🔍 Found companies:`, companiesWithCreator.map(c => ({ id: c.id, name: c.name, createdBy: c.createdBy })));

    res.json({
      success: true,
      data: companiesWithCreator
    });
  } catch (error) {
    console.error('Get companies error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getMyCompanies = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const user = req.user;

    if (!user?.id) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const owned = await prisma.business.findMany({
      where: { isActive: true, createdBy: user.id },
      include: companyInclude,
      orderBy: { createdAt: 'desc' }
    });

    // Backfill missing slugs for owned companies
    try {
      const ownedNeedingSlug = owned.filter((c: any) => c && c.id && c.name && !c.slug);
      if (ownedNeedingSlug.length) {
        await Promise.all(
          ownedNeedingSlug.map(async (c: any) => {
            const desired = slugifyBusinessName(String(c.name));
            const uniqueSlug = await generateUniqueCompanySlug(prisma, desired, { ignoreCompanyId: String(c.id) });
            await prisma.business.update({
              where: { id: String(c.id) },
              data: { slug: uniqueSlug, updatedAt: new Date() },
            });
            c.slug = uniqueSlug;
          })
        );
      }
    } catch (err) {
      console.warn('[MyCompanies] slug backfill skipped:', err);
    }

    const ownedIds = new Set(owned.map((c) => c.id));
    const sharedMap = new Map<string, any>();

    try {
      const v2Memberships = await listUserSharedMembershipsV2(prisma, String(user.id));
      if (v2Memberships.length > 0) {
        const businessIds = v2Memberships.map((m) => m.businessId);
        const sharedCompaniesV2 = await prisma.business.findMany({
          where: {
            id: { in: businessIds },
            isActive: true
          },
          include: companyInclude
        });
        const membershipByBusinessId = new Map(v2Memberships.map((m) => [m.businessId, m]));
        for (const company of sharedCompaniesV2) {
          if (!company) continue;
          if (company.createdBy === user.id) continue;
          if (ownedIds.has(company.id)) continue;
          const member = membershipByBusinessId.get(company.id);
          sharedMap.set(company.id, {
            ...company,
            memberRole: member?.role || undefined,
            memberBranchId: member?.branchId || undefined,
            accessType: 'shared'
          });
        }
      }
    } catch (membershipError) {
      console.warn('[MyCompanies] shared-membership lookup failed:', membershipError);
    }


    const shared = Array.from(sharedMap.values());

    res.json({
      success: true,
      data: {
        owned: owned.map((company) => ({ ...company, accessType: 'owned' })),
        shared
      }
    });
  } catch (error) {
    console.error('Get my companies error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get a single company by slug (for /b/:slug routing)
export const getCompanyBySlug = async (req: Request, res: Response): Promise<void> => {
  try {
    await Promise.all([
      pullLatestFromLive('company').catch(err => console.log('[Sync] Pull company:', err.message)),
      pullLatestFromLive('branch').catch(err => console.log('[Sync] Pull branches:', err.message))
    ]);

    const prisma = await getPrisma();
    const slug = String(req.params.slug || '').trim().toLowerCase();
    if (!slug) {
      res.status(400).json({ success: false, message: 'Slug is required' });
      return;
    }

    const company = await prisma.business.findFirst({
      where: { slug, isActive: true },
      include: companyInclude,
    });

    if (!company) {
      res.status(404).json({ success: false, message: 'Company not found' });
      return;
    }

    res.json({ success: true, data: company });
  } catch (error) {
    console.error('Get company by slug error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get a single company by ID
// NOTE: Removed access check - all users can view any company
export const getCompany = async (req: Request, res: Response): Promise<void> => {
  try {
    // 🔄 PULL LATEST FROM LIVE DATABASE FIRST (company and related branches)
    await Promise.all([
      pullLatestFromLive('company').catch(err => console.log('[Sync] Pull company:', err.message)),
      pullLatestFromLive('branch').catch(err => console.log('[Sync] Pull branches:', err.message))
    ]);

    const prisma = await getPrisma();
    const { id } = req.params;

    const company = await prisma.business.findUnique({
      where: { id },
      include: {
        branches: {
          where: { isActive: true },
          include: {
            _count: {
              select: {
                membershipBranches: true,
                employees: true,
                products: true
              }
            }
          }
        },
        _count: {
          select: {
            branches: true,
            memberships: true,
            employees: true,
            products: true
          }
        }
      }
    });

    if (!company) {
      res.status(404).json({
        success: false,
        message: 'Company not found'
      });
      return;
    }

    const ttlMinutes = Number(process.env.SESSION_TTL_MINUTES || 30);
    const ttlMs = Number.isFinite(ttlMinutes) && ttlMinutes > 0 ? ttlMinutes * 60 * 1000 : 30 * 60 * 1000;
    const activeSince = new Date(Date.now() - ttlMs);

    const SESSION_SETTINGS_KEY = 'active_sessions_v1';
    const settingsOwner = `session_company_${id}`;

    const [
      countersActive,
      categoriesCount,
      manufacturersCount,
      suppliersCount,
      shelvesCount,
      batchesCount,
      sessionSetting,
    ] = await Promise.all([
      prisma.deviceActivation.count({ where: { companyId: id, status: 'ACTIVE' } }),
      prisma.category.count({
        where: {
          OR: [{ companyId: id }, { branch: { companyId: id } }],
        },
      }),
      prisma.manufacturer.count({
        where: {
          OR: [{ companyId: id }, { branch: { companyId: id } }],
        },
      }),
      prisma.supplier.count({
        where: {
          OR: [{ companyId: id }, { branch: { companyId: id } }],
        },
      }),
      prisma.shelf.count({
        where: {
          OR: [{ companyId: id }, { branch: { companyId: id } }],
        },
      }),
      prisma.batch.count({ where: { companyId: id, isActive: true } }),
      prisma.settings.findUnique({
        where: {
          createdBy_key: {
            createdBy: settingsOwner,
            key: SESSION_SETTINGS_KEY,
          },
        },
        select: { value: true },
      }),
    ]);

    let activeConcurrentSessions = 0;
    let sessionsPruned = false;
    let sessionsItems: Array<{ userId: string; sessionToken: string; lastSeenAt: string }> = [];

    if (sessionSetting?.value) {
      try {
        const parsed = JSON.parse(sessionSetting.value) as { items?: unknown };
        if (Array.isArray((parsed as any)?.items)) {
          sessionsItems = (parsed as any).items
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
        sessionsItems = [];
      }

      const before = sessionsItems.length;
      sessionsItems = sessionsItems.filter((entry) => {
        const lastSeen = new Date(entry.lastSeenAt);
        return Number.isFinite(lastSeen.getTime()) && lastSeen >= activeSince;
      });
      sessionsPruned = sessionsItems.length !== before;

      activeConcurrentSessions = Array.from(new Set(sessionsItems.map((entry) => entry.userId))).length;
    }

    if (sessionsPruned) {
      const now = new Date();
      const payload = JSON.stringify({ items: sessionsItems });
      await prisma.settings.upsert({
        where: {
          createdBy_key: {
            createdBy: settingsOwner,
            key: SESSION_SETTINGS_KEY,
          },
        },
        update: { value: payload, updatedAt: now },
        create: {
          createdBy: settingsOwner,
          key: SESSION_SETTINGS_KEY,
          value: payload,
          description: 'Active business sessions for concurrent login enforcement',
        },
      });
    }

    const productsCount = (company as any)?._count?.products ?? 0;
    const inventoryItems = productsCount + categoriesCount + manufacturersCount + suppliersCount + shelvesCount + batchesCount;

    res.json({
      success: true,
      data: {
        ...(company as any),
        usageMetrics: {
          branchesActive: (company as any).branches?.length ?? 0,
          countersActive,
          activeConcurrentSessions,
          inventoryItems,
          inventoryBreakdown: {
            products: productsCount,
            categories: categoriesCount,
            manufacturers: manufacturersCount,
            suppliers: suppliersCount,
            shelves: shelvesCount,
            batches: batchesCount,
          },
        },
      },
    });
  } catch (error) {
    console.error('Get company error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Create a new company
export const createCompany = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    console.log('🔍 Create company request body:', JSON.stringify(req.body, null, 2));
    console.log('🔍 Create company - User:', req.user?.id, 'Role:', req.user?.role);

    // Check if user is authenticated
    if (!req.user || !req.user.id) {
      console.log('❌ Unauthenticated request');
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    // Normalize empty strings to undefined for optional fields
    const normalizedBody = {
      ...req.body,
      description: req.body.description?.trim() || undefined,
      address: req.body.address?.trim() || undefined,
      phone: req.body.phone?.trim() || undefined,
      email: req.body.email?.trim() || undefined,
      businessType: req.body.businessType
        ? String(req.body.businessType).trim().toUpperCase().replace(/[\s\-]+/g, '_').replace(/_+/g, '_')
        : 'PHARMACY',
    };

    const { error } = createCompanySchema.validate(normalizedBody);
    if (error) {
      console.log('❌ Validation error details:', error.details);
      console.log('❌ Validation errors:', error.details.map(detail => detail.message));
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
      return;
    }

    const userId = req.user.id;
    const { name, description, address, phone, email, businessType, createdByUserId } = normalizedBody as any;
    const createdById = userId;

    console.log('🔍 Creating company with userId:', createdById);

    // Check if company name already exists
    const existingCompany = await prisma.business.findUnique({
      where: { name }
    });

    if (existingCompany) {
      res.status(400).json({
        success: false,
        message: 'Company with this name already exists'
      });
      return;
    }

    if (false) {
      const ownerUser = await prisma.zapeeraUser.findUnique({
        where: { id: createdById },
        select: { id: true, name: true }
      });

      if (!ownerUser) {
        res.status(400).json({
          success: false,
          message: 'Selected user for business ownership was not found'
        });
        return;
      }
    }

    // TRIAL ENFORCEMENT: Check if user has reached trial limit
    // User can only create MAX 1 trial business
    const trialBusinessesCount = await prisma.business.count({
      where: {
        createdBy: createdById,
        businessSubscription: {
          is: {
            status: 'TRIAL'
          }
        }
      }
    });

    if (trialBusinessesCount >= 1) {
      res.status(403).json({
        success: false,
        message: 'Trial limit reached. You have already created a trial business. Please upgrade your existing business to create additional businesses.',
        details: {
          trialBusinessesCount,
          maxTrialBusinesses: 1
        }
      });
      return;
    }

    const normalizedBusinessType = String(businessType || 'PHARMACY').trim().toUpperCase();
    // Business creation is unlimited — each business independently subscribes to a plan.
    // Trial businesses are limited via the trialBusinessesCount check above.

    console.log('🔍 Creating company with data:', {
      name,
      description,
      address,
      phone,
      email,
      businessType,
      createdBy: createdById
    });

    const desiredSlug = slugifyBusinessName(String(name));
    const uniqueSlug = await generateUniqueCompanySlug(prisma, desiredSlug);

    // Log database connection info
    const dbUrl = process.env.DATABASE_URL || 'NOT SET';
    const dbMode = process.env.USE_POSTGRESQL === 'true' ? 'PostgreSQL' : 'SQLite';
    console.log('🔍 Database Info:', {
      mode: dbMode,
      url: dbUrl.replace(/:[^:@]+@/, ':****@'), // Hide password
      userId: userId
    });

    const company = await prisma.business.create({
      data: {
        name,
        slug: uniqueSlug,
        description,
        address,
        phone,
        email,
        businessType: normalizedBusinessType,
        createdBy: createdById,
        isActive: true
      },
      include: {
        branches: true,
        _count: {
          select: {
            memberships: true,
            employees: true,
            products: true
          }
        }
      }
    });

    const isPostgreSQLMode = process.env.USE_POSTGRESQL === 'true';

    // Business creators become OWNER
    if (true) {
      // 1. Create default "Main Branch"
      let mainBranch;
      try {
        mainBranch = await prisma.branch.create({
          data: {
            companyId: company.id,
            name: 'Main Branch',
            address: address || company.address || '',
            phone: phone || company.phone || '',
            email: email || company.email || '',
            isActive: true
          }
        });
        console.log('[Branches] ✅ Main Branch created for business:', company.id);

        // Sync branch if not in PostgreSQL mode
        if (!isPostgreSQLMode) {
          await syncAfterOperation('branch', 'create', mainBranch).catch(err => 
            console.warn('[Sync] Branch sync failed:', err.message)
          );
        }
      } catch (branchErr: any) {
        console.warn('[Branches] ⚠️ Could not create Main Branch:', branchErr?.message || branchErr);
      }

      // 2. User context is handled via memberships; no need to update User record.

      // 3. Resolve/Create OWNER role
      const roleRecord =
        (await prisma.role.findFirst({
          where: { businessId: company.id, name: 'OWNER' }
        })) ||
        (await prisma.role.create({
          data: { businessId: company.id, name: 'OWNER' }
        }));

      // 4. Create Membership
      const membership = await prisma.membership.upsert({
        where: {
          unique_user_business: {
            userId: createdById,
            businessId: company.id
          }
        },
        update: {
          roleId: roleRecord.id,
          status: 'ACTIVE'
        },
        create: {
          userId: createdById,
          businessId: company.id,
          roleId: roleRecord.id,
          status: 'ACTIVE'
        }
      });

      // Sync membership
      if (!isPostgreSQLMode) {
        await syncAfterOperation('membership', 'create', membership).catch(err => 
          console.warn('[Sync] Membership sync failed:', err.message)
        );
      }

      // 5. Link membership to the Main Branch
      if (mainBranch && membership) {
        try {
          const { upsertMembershipBranch } = await import('../utils/membership-bridge.util');
          const membershipBranch = await upsertMembershipBranch(prisma, membership.id, mainBranch.id);
          console.log('[Memberships] ✅ Owner linked to Main Branch:', mainBranch.id);

          // Sync membership branch
          if (!isPostgreSQLMode && membershipBranch) {
            await syncAfterOperation('membershipBranch', 'create', membershipBranch).catch(err => 
              console.warn('[Sync] MembershipBranch sync failed:', err.message)
            );
          }
        } catch (memErr: any) {
          console.warn('[Memberships] ⚠️ Could not link owner to branch:', memErr?.message || memErr);
        }
      }
    }

    console.log('✅ Company created successfully:', {
      id: company.id,
      name: company.name,
      createdBy: company.createdBy
    });

    // Verify company was created in the correct database
    const verifyCompany = await prisma.business.findUnique({
      where: { id: company.id },
      select: { id: true, name: true, createdAt: true }
    });
    console.log('✅ Verified company in database:', verifyCompany);
    console.log('🔍 Database URL used:', process.env.DATABASE_URL?.replace(/:[^:@]+@/, ':****@'));

    // 🔄 SYNC TO POSTGRESQL (only if using SQLite mode)
    // If already using PostgreSQL (USE_POSTGRESQL=true), no sync needed - data is already there!
    if (!isPostgreSQLMode) {
      // Only sync if using SQLite (Electron mode)
      try {
        await syncAfterOperation('company', 'create', company);
        console.log('[Sync] ✅ Company create synced to PostgreSQL');
      } catch (err: any) {
        console.error('[Sync] Company create sync failed:', err.message);
        // Don't fail the request if sync fails
      }
    } else {
      console.log('[Sync] ⏭️  PostgreSQL mode - No sync needed (data already in PostgreSQL)');
    }

    // Enable default modules for this new business (fail silently if modules table missing)
    try {
      const { enableDefaultModulesForBusiness } = await import('../utils/modules.util');
      await enableDefaultModulesForBusiness(company.id);
      console.log('[Modules] ✅ Default modules enabled for business:', company.id);
    } catch (modErr: any) {
      console.warn('[Modules] ⚠️ Could not enable default modules for business:', modErr?.message || modErr);
    }

    // Assign a trial subscription to the new business (fail silently if subscription table missing)
    try {
      const trialPlanId = process.env.DEFAULT_TRIAL_PLAN_ID || 'single-trial';
      const isLocalDev = process.env.NODE_ENV === 'development' && process.env.SHORT_TRIAL_DURATIONS === 'true';

      // Local dev: 5-minute trial; production: 14 days
      const trialMs = isLocalDev ? 5 * 60 * 1000 : 14 * 24 * 60 * 60 * 1000;
      const trialEndsAt = new Date(Date.now() + trialMs);

      await prisma.businessSubscription.create({
        data: {
          businessId: company.id,
          planId: trialPlanId,
          status: 'TRIAL',
          trialEndsAt,
          currentPeriodEnd: trialEndsAt
        }
      });
      console.log(`[Subscriptions] ✅ Trial subscription created for business: ${company.id}, ends at: ${trialEndsAt.toISOString()} (${isLocalDev ? 'LOCAL SHORT' : '14-day'})`);
    } catch (subErr: any) {
      console.warn('[Subscriptions] ⚠️ Could not create trial subscription:', subErr?.message || subErr);
    }

    // Send business creation email asynchronously (don't block response)
    try {
      const owner = await prisma.zapeeraUser.findUnique({
        where: { id: createdById },
        select: { email: true, name: true }
      });
      if (owner?.email) {
        const { emailService } = await import('../services/email.service');
        emailService.sendBusinessCreatedEmail(owner.email, owner.name || 'User', company.name, company.id)
          .then((sent: boolean) => {
            if (sent) console.log(`✅ Business creation email sent to ${owner.email}`);
          })
          .catch((err: any) => console.error('❌ Failed to send business creation email:', err.message));
      }
    } catch (emailErr: any) {
      console.warn('[Email] Could not send business creation email:', emailErr.message);
    }

    res.status(201).json({
      success: true,
      data: company,
      message: 'Company created successfully'
    });
  } catch (error: any) {
    console.error('❌ Create company error:', error);
    console.error('❌ Error details:', {
      message: error.message,
      code: error.code,
      meta: error.meta
    });

    // Handle Prisma unique constraint errors
    if (error.code === 'P2002') {
      res.status(400).json({
        success: false,
        message: 'Company with this name already exists'
      });
      return;
    }

    res.status(500).json({
      success: false,
      message: error.message || 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};

// Update a company
export const updateCompany = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { error } = updateCompanySchema.validate(req.body);
    if (error) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
      return;
    }

    const { id } = req.params;
    const { name, description, address, phone, email, businessType } = req.body;

    // Check if company exists
    const existingCompany = await prisma.business.findUnique({
      where: { id }
    });

    if (!existingCompany) {
      res.status(404).json({
        success: false,
        message: 'Company not found'
      });
      return;
    }

    // NOTE: Removed access check - any user can update any company

    // Check if new name conflicts with existing company
    if (name && name !== existingCompany.name) {
      const nameConflict = await prisma.business.findUnique({
        where: { name }
      });

      if (nameConflict) {
        res.status(400).json({
          success: false,
          message: 'Company with this name already exists'
        });
        return;
      }
    }

    const slugToSet =
      name && !existingCompany.slug
        ? await generateUniqueCompanySlug(prisma, slugifyBusinessName(String(name)), { ignoreCompanyId: String(id) })
        : undefined;

    const company = await prisma.business.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(slugToSet ? { slug: slugToSet } : {}),
        ...(description !== undefined && { description }),
        ...(address !== undefined && { address }),
        ...(phone !== undefined && { phone }),
        ...(email !== undefined && { email }),
        ...(businessType !== undefined && { businessType }),
        updatedAt: new Date() // Ensure updatedAt is set for sync comparison
      },
      include: {
        branches: {
          where: { isActive: true }
        },
        _count: {
          select: {
            memberships: true,
            employees: true,
            products: true
          }
        }
      }
    });

    // 🔄 IMMEDIATE SYNC TO LIVE DATABASE (wait for completion)
    try {
      await syncAfterOperation('company', 'update', company);
      console.log('[Sync] ✅ Company update synced to live');
    } catch (err: any) {
      console.error('[Sync] Company update sync failed:', err.message);
    }

    res.json({
      success: true,
      data: company,
      message: 'Company updated successfully'
    });
  } catch (error) {
    console.error('Update company error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Delete a company (soft delete)
// NOTE: Removed access check - any user can delete any company
export const deleteCompany = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    // Check if company exists
    const existingCompany = await prisma.business.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            branches: true,
            memberships: true,
            employees: true,
            products: true
          }
        }
      }
    });

    if (!existingCompany) {
      res.status(404).json({
        success: false,
        message: 'Company not found'
      });
      return;
    }

    // Check if company has associated data
    const hasData = existingCompany._count.branches > 0 ||
                   existingCompany._count.memberships > 0 ||
                   existingCompany._count.employees > 0 ||
                   existingCompany._count.products > 0;

    if (hasData) {
      res.status(400).json({
        success: false,
        message: 'Cannot delete company with associated branches, users, employees, or products'
      });
      return;
    }

    // Soft delete the company
    const deletedCompany = await prisma.business.update({
      where: { id },
      data: {
        isActive: false,
        updatedAt: new Date()
      }
    });

    // 🔄 IMMEDIATE SYNC TO LIVE DATABASE (wait for completion)
    try {
      await syncAfterOperation('company', 'update', deletedCompany);
      console.log('[Sync] ✅ Company delete synced to live');
    } catch (err: any) {
      console.error('[Sync] Company delete sync failed:', err.message);
    }

    res.json({
      success: true,
      message: 'Company deleted successfully'
    });
  } catch (error) {
    console.error('Delete company error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update company business type
export const updateCompanyBusinessType = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const authReq = req as unknown as AuthRequest;
    const userId = String(authReq.user?.id || '');
    const userRole = String(authReq.membership?.role_name || authReq.user?.role || '').toUpperCase();
    const rawBusinessType = req.body.businessType;

    if (!rawBusinessType) {
      res.status(400).json({ success: false, message: 'businessType is required' });
      return;
    }

    // Normalize to UPPER_SNAKE_CASE (matches how business type ids are stored)
    const businessType = String(rawBusinessType).trim().toUpperCase().replace(/[\s\-]+/g, '_').replace(/_+/g, '_');

    // Validate against DB — any type the super admin created is valid
    const validType = await prisma.businessType.findUnique({ where: { id: businessType } });
    if (!validType) {
      const allTypes = await prisma.businessType.findMany({ select: { id: true } });
      res.status(400).json({
        success: false,
        message: `Invalid business type '${businessType}'. Valid types: ${allTypes.map(t => t.id).join(', ')}`
      });
      return;
    }

    // Check if company exists
    const existingCompany = await prisma.business.findUnique({
      where: { id }
    });

    if (!existingCompany) {
      res.status(404).json({
        success: false,
        message: 'Company not found'
      });
      return;
    }

    // NOTE: Removed access check - any user can update business type

    const company = await prisma.business.update({
      where: { id },
      data: {
        businessType,
        updatedAt: new Date()
      },
      include: {
        branches: {
          where: { isActive: true }
        },
        _count: {
          select: {
            memberships: true,
            employees: true,
            products: true
          }
        }
      }
    });

    // 🔄 IMMEDIATE SYNC TO LIVE DATABASE (wait for completion)
    try {
      await syncAfterOperation('company', 'update', company);
      console.log('[Sync] ✅ Company business type synced to live');
    } catch (err: any) {
      console.error('[Sync] Company business type sync failed:', err.message);
    }

    // Re-sync modules for this business based on its new business type
    try {
      const { enableDefaultModulesForBusiness } = await import('../utils/modules.util');
      await enableDefaultModulesForBusiness(company.id);
      console.log('[Modules] ✅ Modules resynced after business type change:', company.id);
    } catch (modErr: any) {
      console.warn('[Modules] ⚠️ Could not resync modules after type change:', modErr?.message);
    }

    res.json({
      success: true,
      data: company,
      message: 'Business type updated successfully'
    });
  } catch (error) {
    console.error('Update company business type error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const addCompanyMember = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const actor = req.user;
    const { id: companyId } = req.params;

    if (!actor?.id) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const { error } = businessStaffInviteSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map((detail) => detail.message),
      });
      return;
    }

    const actorRole = String(req.membership?.role_name || actor?.role || '').toUpperCase();
    const company = await prisma.business.findUnique({ where: { id: companyId } });
    if (!company || !company.isActive) {
      res.status(404).json({ success: false, message: 'Company not found' });
      return;
    }

    const isBusinessCreator = company.createdBy === actor.id;
    const { userId, email, role, branchId } = req.body as { userId?: string; email?: string; role: 'MANAGER' | 'CASHIER'; branchId?: string };
    const effectiveBranchId = branchId || actor.branchId || null;
    const canAddAsManager =
      actorRole === 'MANAGER' &&
      role === 'CASHIER' &&
      actor.companyId === companyId &&
      Boolean(actor.branchId) &&
      effectiveBranchId === actor.branchId;

    // Business creator always has full staff control for their own business,
    // even if their global role was changed elsewhere.
    const canManageMembers =
      isBusinessCreator ||
      canAddAsManager;
    if (!canManageMembers) {
      res.status(403).json({ success: false, message: 'Only the business creator can manage staff members' });
      return;
    }

    let targetUser = null;
    // Resolve target user by userId or email. If email provided and user missing, create an inactive user
    if (userId) {
      targetUser = await prisma.zapeeraUser.findUnique({ where: { id: userId } });
      if (!targetUser) {
        res.status(404).json({ success: false, message: 'User not found' });
        return;
      }
    } else if (email) {
      const normalizedEmail = String(email).toLowerCase().trim();
      targetUser = await prisma.zapeeraUser.findFirst({ where: { email: normalizedEmail } });
        if (!targetUser) {
          // Create a minimal inactive user account for this email
          const usernameFromEmail = normalizedEmail.split('@')[0] || normalizedEmail;
          const randomPassword = crypto.randomBytes(8).toString('hex');
          const hashed = await bcrypt.hash(randomPassword, parseInt(process.env.BCRYPT_ROUNDS || '12'));
          try {
            targetUser = await prisma.zapeeraUser.create({
              data: {
                username: usernameFromEmail,
                email: normalizedEmail,
                password: hashed,
                name: usernameFromEmail,
                // branchId: effectiveBranchId || null, // DEPRECATED
                // companyId: companyId, // DEPRECATED
                createdBy: actor.id,
                isActive: false,
                businessAccessGranted: true
              }
            });
          } catch (createErr: any) {
            console.error('Error creating invite user:', createErr);
            if (createErr?.code === 'P2002') {
              res.status(400).json({ success: false, message: 'A user with this email already exists' });
              return;
            }
            throw createErr;
          }
        }

      // Ensure targetUser is non-null for TypeScript
      if (!targetUser) {
        res.status(500).json({ success: false, message: 'Failed to resolve or create target user' });
        return;
      }
    }

    const inviteAllowance = await validateMembershipInviteAllowanceV2(prisma, {
      businessId: companyId,
      ownerUserId: String(company.createdBy || actor.id),
    });
    if (!inviteAllowance.allowed) {
      res.status(inviteAllowance.statusCode).json({
        success: false,
        message: inviteAllowance.message,
        ...inviteAllowance.details,
      });
      return;
    }

    const businessType = String(company.businessType || 'PHARMACY').toUpperCase() as 'PHARMACY' | 'STORE' | 'HOTEL' | 'CLINIC';
    const staffAllowance = await validateStaffCreationAllowance(prisma, {
      companyId,
      ownerUserId: String(company.createdBy || actor.id),
      businessType,
    });
    if (!staffAllowance.allowed) {
      res.status(staffAllowance.statusCode).json({
        success: false,
        message: staffAllowance.message,
        ...staffAllowance.details,
      });
      return;
    }

    let membership: any = null;
    const roleId = await ensureBusinessRole(prisma as any, companyId, role);
    const membershipId = await upsertMembership(prisma as any, {
      userId: String(targetUser!.id),
      businessId: companyId,
      roleId,
      invitedBy: actor.id,
      status: 'ACTIVE',
    });

    if (membershipId) {
      await upsertMembershipBranch(prisma as any, membershipId, effectiveBranchId);
      membership = {
        id: membershipId,
        businessId: companyId,
        userId: String(targetUser!.id),
        role,
        branchId: effectiveBranchId,
        status: 'ACTIVE',
      };
    } else {
      // Membership table appears unavailable - do not fallback to legacy company_members.
      // Fail fast and instruct running the migration to enable membership-based access.
      res.status(500).json({
        success: false,
        message: 'Memberships table not available. Please run the membership migration before adding staff.'
      });
      return;
    }

    const preserveGlobalRole = false; // User.role is deprecated in this schema, preserve nothing here.

    // User context is handled via memberships; no need to update User record.

    res.status(201).json({
      success: true,
      message: 'Staff member assigned to business successfully',
      data: membership
    });
  } catch (error) {
    console.error('Add company member error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getCompanyMembers = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const actor = req.user;
    const { id: companyId } = req.params;

    if (!actor?.id) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const actorRole = String(req.membership?.role_name || actor?.role || '').toUpperCase();
    const company = await prisma.business.findUnique({ where: { id: companyId } });
    if (!company || !company.isActive) {
      res.status(404).json({ success: false, message: 'Company not found' });
      return;
    }

    const canViewMembers =
      company.createdBy === actor.id ||
      actor.companyId === companyId;
    if (!canViewMembers) {
      res.status(403).json({ success: false, message: 'Access denied' });
      return;
    }

    const v2Members = await listBusinessMembershipUsers(prisma as any, companyId);
    // Map to minimal staff model expected by UI
    const mapped = v2Members.map((entry) => ({
      userId: entry.userId,
      id: entry.userId,
      username: entry.username || '',
      name: entry.userName || '',
      email: entry.email || '',
      role: entry.role || 'CASHIER',
      isActive: entry.isActive !== undefined ? entry.isActive : true,
      status: entry.status || 'ACTIVE',
      branchId: entry.branchId,
      branch: entry.branchId ? { id: entry.branchId, name: entry.branchName || '' } : null,
      staffListRole: entry.role || 'CASHIER',
      createdAt: entry.createdAt,
      updatedAt: entry.createdAt,
    }));

    res.json({ success: true, data: mapped });
  } catch (error) {
    console.error('Get company members error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/** After removing a user from one company, no User-level context needs syncing. */
async function syncUserAfterRemovedFromCompany(
  prisma: Awaited<ReturnType<typeof getPrisma>>,
  userId: string,
  removedCompanyId: string
): Promise<void> {
  // Membership removal is sufficient.
  return;
}

export const removeCompanyMember = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const actor = req.user;
    const { id: companyId, userId } = req.params;

    if (!actor?.id) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }

    const actorRole = String(req.membership?.role_name || actor?.role || '').toUpperCase();
    const company = await prisma.business.findUnique({ where: { id: companyId } });
    if (!company || !company.isActive) {
      res.status(404).json({ success: false, message: 'Company not found' });
      return;
    }

    const isBusinessCreator = company.createdBy === actor.id;
    const targetMembershipV2 = await getBusinessMembershipContextV2(prisma, companyId, userId);
    const actorMembershipV2 = await getBusinessMembershipContextV2(prisma, companyId, String(actor.id));

    const targetUser = await prisma.zapeeraUser.findUnique({ where: { id: userId } });
    if (!targetUser) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    const actorResolvedRole = String(actorMembershipV2?.role || actorRole || '').toUpperCase();
    const targetResolvedRole = String(targetMembershipV2?.role || '').toUpperCase();
    const targetBranchId = targetMembershipV2?.branchId || null;
    const actorBranchId = actorMembershipV2?.branchId || actor.branchId || null;

    const canManageAsManager =
      actorResolvedRole === 'MANAGER' &&
      targetResolvedRole === 'CASHIER' &&
      Boolean(targetBranchId) &&
      Boolean(actorBranchId) &&
      targetBranchId === actorBranchId;

    // Business creator always has full staff control for their own business.
    const canManageMembers =
      isBusinessCreator ||
      canManageAsManager;

    if (!canManageMembers) {
      res.status(403).json({ success: false, message: 'Only the business creator can remove staff members' });
      return;
    }

    if (userId === company.createdBy) {
      res.status(400).json({ success: false, message: 'Cannot remove the business owner from their own business' });
      return;
    }

    const removedV2 = await deleteMembershipByUserBusiness(prisma as any, userId, companyId);
    if (removedV2) {
      await syncUserAfterRemovedFromCompany(prisma, userId, companyId);
      res.json({
        success: true,
        message: 'Member removed from this business. Their platform account remains active.'
      });
      return;
    }

    // Legacy: no membership row but denormalized user.companyId might have existed
    // Since we've removed User.companyId from schema, we just ensure sync is called for safety if needed
    await syncUserAfterRemovedFromCompany(prisma, userId, companyId);
    res.json({
      success: true,
      message: 'Staff removed from this business. Their login account remains on the platform.'
    });
    return;

    res.status(404).json({ success: false, message: 'User is not assigned to this business as staff' });
  } catch (error) {
    console.error('Remove company member error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get company statistics
// NOTE: Removed access check - any user can view company stats
export const getCompanyStats = async (req: Request, res: Response): Promise<void> => {
  try {
    // 🔄 PULL LATEST FROM LIVE DATABASE FIRST
    await pullLatestFromLive('company').catch(err => console.log('[Sync] Pull company stats:', err.message));

    const prisma = await getPrisma();
    const { id } = req.params;

    // Check if company exists
    const company = await prisma.business.findUnique({
      where: { id }
    });

    if (!company) {
      res.status(404).json({
        success: false,
        message: 'Company not found'
      });
      return;
    }

    // Get statistics
    const stats = await prisma.business.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            branches: true,
            memberships: true,
            employees: true,
            products: true,
            customers: true,
            sales: true
          }
        }
      }
    });

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Get company stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};
