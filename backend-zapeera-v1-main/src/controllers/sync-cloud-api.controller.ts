import { Request, Response } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { getPrisma } from '../utils/db.util';

export const cloudSyncAccount = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const userId = req.user!.id;

    const user = await prisma.zapeeraUser.findUnique({
      where: { id: userId },
      select: { id: true, username: true, email: true, name: true, isActive: true, createdAt: true }
    });
    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    const memberships = await (prisma.membership.findMany as any)({
      where: { userId, status: 'ACTIVE' },
      include: {
        business: {
          select: {
            id: true,
            name: true,
            slug: true,
            businessType: true,
            businessSubscription: {
              select: {
                planId: true,
                status: true
              }
            }
          }
        },
        branches: { include: { branch: { select: { id: true, name: true } } } },
        role: { select: { name: true } }
      }
    }) as any[];

    // Include businesses the user owns (createdBy) even when their membership
    // is not ACTIVE, so desktop shows the exact same list as the web dashboard.
    const ownedBusinesses = await prisma.business.findMany({
      where: { isActive: true, createdBy: userId },
      select: { id: true, name: true, slug: true, businessType: true }
    });

    const membershipBusinessIds = new Set(memberships.map((m: any) => m.businessId));
    const mergedBusinesses = [
      ...memberships.map((m: any) => m.business),
      ...ownedBusinesses.filter((b) => !membershipBusinessIds.has(b.id))
    ];

    const data = {
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        name: user.name,
        displayName: user.name,
        isActive: user.isActive,
        createdAt: user.createdAt
      },
      memberships: memberships.map(m => ({
        id: m.id,
        userId: m.userId,
        businessId: m.businessId,
        role: m.role?.name || 'OWNER',
        businessName: m.business.name,
        businessSlug: m.business.slug || '',
        businessType: m.business.businessType || '',
        status: m.status,
        subscriptionPlan: m.business?.businessSubscription?.planId || '',
        subscriptionStatus: m.business?.businessSubscription?.status || '',
        branchIds: m.branches.map((b: any) => b.branch.id),
        branches: m.branches.map((b: any) => ({ id: b.branch.id, name: b.branch.name }))
      })),
      businesses: mergedBusinesses.map(b => ({
        id: b.id,
        name: b.name,
        slug: b.slug || '',
        businessType: b.businessType || ''
      }))
    };

    res.json({ success: true, data });
  } catch (error: any) {
    console.error('[CloudSync] Account error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const cloudProvisionBusiness = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { businessId } = req.body;

    if (!businessId) {
      res.status(400).json({ success: false, message: 'businessId is required' });
      return;
    }

    const business = await (prisma.business.findUnique as any)({
      where: { id: businessId },
      include: {
        branches: {
          where: { isActive: true },
          include: {
            categories: { where: { isActive: { not: false } } },
            manufacturers: { where: { isActive: true } },
            suppliers: { where: { isActive: true } },
            shelves: true,
            products: {
              where: { isActive: true },
              include: {
                category: true,
                supplier: true,
                batches: { where: { isActive: true } }
              }
            },
            customers: { where: { isActive: true } }
          }
        },
        memberships: {
          where: { userId: req.user!.id, status: 'ACTIVE' },
          include: { role: { select: { name: true } } }
        },
        businessSubscription: true,
        businessModules: { include: { module: true } },
        roles: true
      }
    }) as any;

    if (!business) {
      res.status(404).json({ success: false, message: 'Business not found' });
      return;
    }

    res.json({
      success: true,
      data: {
        business: {
          id: business.id,
          name: business.name,
          slug: business.slug,
          description: business.description,
          address: business.address,
          phone: business.phone,
          email: business.email,
          businessType: business.businessType,
          isActive: business.isActive,
          createdAt: business.createdAt
        },
        branches: business.branches.map((b: any) => ({
          id: b.id,
          name: b.name,
          address: b.address,
          phone: b.phone,
          email: b.email,
          isActive: b.isActive
        })),
        roles: business.roles.map((r: any) => ({
          id: r.id,
          name: r.name
        })),
        subscription: business.businessSubscription ? {
          planId: business.businessSubscription.planId,
          status: business.businessSubscription.status,
          trialEndsAt: business.businessSubscription.trialEndsAt
        } : null,
        modules: business.businessModules.map((bm: any) => ({
          moduleId: bm.moduleId,
          key: bm.module.key,
          enabled: bm.enabled
        })),
        memberships: business.memberships.map((m: any) => ({
          id: m.id,
          userId: m.userId,
          role: m.role?.name || 'OWNER'
        }))
      }
    });
  } catch (error: any) {
    console.error('[CloudSync] Provision error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const cloudPushOperations = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { businessId, operations } = req.body;

    if (!businessId || !operations || !Array.isArray(operations)) {
      res.status(400).json({
        success: false,
        message: 'businessId and operations[] are required'
      });
      return;
    }

    const results: any[] = [];

    for (const op of operations) {
      try {
        const { entityType, entityId, operation, payload, idempotencyKey } = op;

        if (operation === 'DELETE') {
          const model = (prisma as any)[entityType];
          if (model?.delete) {
            await model.delete({ where: { id: entityId } });
          }
          results.push({ id: op.id, status: 'ACCEPTED' });
        } else if (operation === 'CREATE' || operation === 'create') {
          const model = (prisma as any)[entityType];
          if (model?.create && payload) {
            const data = { ...payload, id: entityId, companyId: businessId };
            await model.create({ data });
          }
          results.push({ id: op.id, status: 'ACCEPTED' });
        } else if (operation === 'UPDATE' || operation === 'update') {
          const model = (prisma as any)[entityType];
          if (model?.update && payload) {
            const { id, ...updateData } = payload;
            delete updateData.id;
            await model.update({ where: { id: entityId }, data: updateData });
          }
          results.push({ id: op.id, status: 'ACCEPTED' });
        } else {
          results.push({ id: op.id, status: 'REJECTED', message: `Unknown operation: ${operation}` });
        }
      } catch (opError: any) {
        results.push({ id: op.id, status: 'FAILED', message: opError.message });
      }
    }

    res.json({ success: true, data: { results } });
  } catch (error: any) {
    console.error('[CloudSync] Push error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const cloudPullChanges = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const businessId = req.query.businessId as string;
    const cursor = req.query.cursor as string | undefined;

    if (!businessId) {
      res.status(400).json({ success: false, message: 'businessId is required' });
      return;
    }

    const sinceDate = cursor ? new Date(cursor) : new Date(Date.now() - 86400000);
    const changes: any[] = [];

    const tables = ['product', 'customer', 'sale', 'purchase', 'batch', 'category', 'supplier', 'manufacturer', 'shelf', 'stockMovement'];
    for (const table of tables) {
      try {
        const model = (prisma as any)[table];
        if (!model?.findMany) continue;
        const records = await model.findMany({
          where: {
            companyId: businessId,
            updatedAt: { gte: sinceDate }
          },
          orderBy: { updatedAt: 'asc' },
          take: 100
        });
        for (const record of records) {
          changes.push({
            entityType: table,
            entityId: record.id,
            operation: 'UPSERT',
            data: record,
            timestamp: record.updatedAt
          });
        }
      } catch { }
    }

    const nextCursor = changes.length > 0
      ? new Date(Math.max(...changes.map(c => new Date(c.timestamp).getTime()))).toISOString()
      : cursor;

    res.json({
      success: true,
      data: { changes, nextCursor }
    });
  } catch (error: any) {
    console.error('[CloudSync] Pull error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
};
