// CRITICAL: Import database initialization FIRST to ensure DATABASE_URL is set
import '../config/database.init';

import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AdminAuthRequest, logAdminAction } from '../middleware/admin-auth.middleware';
import Joi from 'joi';
import { getAffiliateConfig, setAffiliateConfig } from '../utils/affiliate-config.util';

/**
 * Affiliate program — BACKOFFICE (platform admin; router-guarded by
 * adminAuthenticate, route-policy prefix /api/backoffice).
 *
 *   GET   /api/backoffice/affiliates                 list + per-affiliate totals
 *   PATCH /api/backoffice/affiliates/:id             status (approve/suspend) + rate override
 *   POST  /api/backoffice/affiliates/attribute       manual attribution { code|affiliateId, businessId }
 *   GET   /api/backoffice/affiliate-commissions      list/filter
 *   POST  /api/backoffice/affiliate-commissions/:id/void
 *   POST  /api/backoffice/affiliate-commissions/:id/approve
 *   GET   /api/backoffice/affiliate-payouts          list/filter
 *   POST  /api/backoffice/affiliate-payouts/:id/process { decision: PAID|REJECTED, note? }
 *   GET   /api/backoffice/affiliates/config          global rate + min payout
 *   PUT   /api/backoffice/affiliates/config          update global config
 */

const updateAffiliateSchema = Joi.object({
  status: Joi.string().valid('PENDING', 'ACTIVE', 'SUSPENDED').optional(),
  commissionRate: Joi.number().min(0).max(100).allow(null).optional()
}).min(1);

const attributeSchema = Joi.object({
  affiliateId: Joi.string().optional(),
  code: Joi.string().trim().max(20).optional(),
  businessId: Joi.string().required()
}).or('affiliateId', 'code');

const configSchema = Joi.object({
  defaultRate: Joi.number().min(0).max(100).optional(),
  minPayout: Joi.number().min(0).optional()
}).min(1);

export const listAffiliates = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

    const where: any = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { code: { contains: search, mode: 'insensitive' } },
        { user: { email: { contains: search, mode: 'insensitive' } } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
        { user: { username: { contains: search, mode: 'insensitive' } } }
      ];
    }

    const affiliates = await prisma.affiliate.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, name: true, email: true, username: true } },
        _count: { select: { referrals: true } }
      }
    });

    const ids = affiliates.map((a: any) => a.id);
    const commissions = ids.length
      ? await prisma.affiliateCommission.groupBy({
          by: ['affiliateId', 'status'],
          where: { affiliateId: { in: ids } },
          _sum: { amount: true }
        })
      : [];

    const earnedByAffiliate = new Map<string, number>();
    for (const row of commissions as any[]) {
      if (row.status === 'VOID') continue;
      earnedByAffiliate.set(row.affiliateId, (earnedByAffiliate.get(row.affiliateId) || 0) + (row._sum.amount || 0));
    }

    res.json({
      success: true,
      data: affiliates.map((a: any) => ({
        id: a.id,
        code: a.code,
        status: a.status,
        commissionRate: a.commissionRate,
        payoutDetails: a.payoutDetails ?? null,
        createdAt: a.createdAt,
        user: a.user,
        referralsCount: a._count.referrals,
        totalEarned: Math.round((earnedByAffiliate.get(a.id) || 0) * 100) / 100
      }))
    });
  } catch (error: any) {
    console.error('[BackofficeAffiliates] listAffiliates error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const updateAffiliate = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { error, value } = updateAffiliateSchema.validate(req.body);
    if (error) {
      res.status(400).json({ success: false, message: 'Validation error', errors: error.details.map((d) => d.message) });
      return;
    }
    const prisma = await getPrisma();
    const existing = await prisma.affiliate.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      res.status(404).json({ success: false, message: 'Affiliate not found' });
      return;
    }

    const updated = await prisma.affiliate.update({
      where: { id: existing.id },
      data: {
        ...(value.status !== undefined ? { status: value.status } : {}),
        ...(value.commissionRate !== undefined ? { commissionRate: value.commissionRate } : {})
      }
    });

    await logAdminAction(req.admin!.id, 'UPDATE_AFFILIATE', 'Affiliate', existing.id, {
      code: existing.code,
      status: value.status ?? existing.status,
      commissionRate: value.commissionRate !== undefined ? value.commissionRate : existing.commissionRate
    });

    res.json({ success: true, message: 'Affiliate updated', data: updated });
  } catch (error: any) {
    console.error('[BackofficeAffiliates] updateAffiliate error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const attributeBusiness = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { error, value } = attributeSchema.validate(req.body);
    if (error) {
      res.status(400).json({ success: false, message: 'Validation error', errors: error.details.map((d) => d.message) });
      return;
    }
    const prisma = await getPrisma();

    const affiliate = value.affiliateId
      ? await prisma.affiliate.findUnique({ where: { id: value.affiliateId } })
      : await prisma.affiliate.findUnique({ where: { code: value.code.trim().toUpperCase().replace(/^ZAP-/, '') } });
    if (!affiliate) {
      res.status(404).json({ success: false, message: 'Affiliate not found' });
      return;
    }

    const business = await prisma.business.findUnique({
      where: { id: value.businessId },
      select: { id: true, name: true, createdBy: true }
    });
    if (!business) {
      res.status(404).json({ success: false, message: 'Business not found' });
      return;
    }

    const existing = await prisma.affiliateReferral.findUnique({ where: { businessId: business.id } });
    if (existing) {
      res.status(409).json({
        success: false,
        message: 'This business is already attributed to an affiliate',
        data: { referralId: existing.id, affiliateId: existing.affiliateId }
      });
      return;
    }

    const referral = await prisma.affiliateReferral.create({
      data: { affiliateId: affiliate.id, businessId: business.id, referredUserId: business.createdBy ?? null }
    });

    await logAdminAction(req.admin!.id, 'ATTRIBUTE_BUSINESS_TO_AFFILIATE', 'AffiliateReferral', referral.id, {
      affiliateId: affiliate.id,
      code: affiliate.code,
      businessId: business.id,
      businessName: business.name
    });

    res.status(201).json({ success: true, message: 'Business attributed to affiliate', data: referral });
  } catch (error: any) {
    console.error('[BackofficeAffiliates] attributeBusiness error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const listAffiliateCommissions = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const where: any = {};
    if (typeof req.query.status === 'string' && req.query.status) where.status = req.query.status;
    if (typeof req.query.affiliateId === 'string' && req.query.affiliateId) where.affiliateId = req.query.affiliateId;
    if (typeof req.query.businessId === 'string' && req.query.businessId) where.businessId = req.query.businessId;

    const [rows, total] = await Promise.all([
      prisma.affiliateCommission.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          affiliate: { include: { user: { select: { name: true, email: true } } } },
          business: { select: { name: true } }
        }
      }),
      prisma.affiliateCommission.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        commissions: rows.map((c: any) => ({
          id: c.id,
          affiliateId: c.affiliateId,
          affiliateCode: c.affiliate?.code ?? null,
          affiliateName: c.affiliate?.user?.name ?? null,
          affiliateEmail: c.affiliate?.user?.email ?? null,
          businessId: c.businessId,
          businessName: c.business?.name ?? null,
          sourceRef: c.sourceRef,
          basisAmount: c.basisAmount,
          rateApplied: c.rateApplied,
          amount: c.amount,
          status: c.status,
          createdAt: c.createdAt,
          paidAt: c.paidAt
        })),
        pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }
      }
    });
  } catch (error: any) {
    console.error('[BackofficeAffiliates] listAffiliateCommissions error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const setCommissionStatus = async (
  req: AdminAuthRequest,
  res: Response,
  nextStatus: 'APPROVED' | 'VOID' | 'PAID'
): Promise<void> => {
  const prisma = await getPrisma();
  const commission = await prisma.affiliateCommission.findUnique({ where: { id: req.params.id } });
  if (!commission) {
    res.status(404).json({ success: false, message: 'Commission not found' });
    return;
  }
  if (commission.status === 'PAID' || commission.status === 'VOID') {
    res.status(409).json({ success: false, message: `Commission is already ${commission.status} and cannot change` });
    return;
  }
  const updated = await prisma.affiliateCommission.update({
    where: { id: commission.id },
    data: { status: nextStatus, ...(nextStatus === 'PAID' ? { paidAt: new Date() } : {}) }
  });
  await logAdminAction(req.admin!.id, `AFFILIATE_COMMISSION_${nextStatus}`, 'AffiliateCommission', commission.id, {
    affiliateId: commission.affiliateId,
    businessId: commission.businessId,
    amount: commission.amount,
    sourceRef: commission.sourceRef
  });
  res.json({ success: true, message: `Commission ${nextStatus.toLowerCase()}`, data: updated });
};

export const approveAffiliateCommission = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    await setCommissionStatus(req, res, 'APPROVED');
  } catch (error: any) {
    console.error('[BackofficeAffiliates] approveAffiliateCommission error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const voidAffiliateCommission = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    await setCommissionStatus(req, res, 'VOID');
  } catch (error: any) {
    console.error('[BackofficeAffiliates] voidAffiliateCommission error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const listAffiliatePayouts = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const where: any = {};
    if (typeof req.query.status === 'string' && req.query.status) where.status = req.query.status;
    if (typeof req.query.affiliateId === 'string' && req.query.affiliateId) where.affiliateId = req.query.affiliateId;

    const [rows, total] = await Promise.all([
      prisma.affiliatePayout.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          affiliate: {
            include: { user: { select: { name: true, email: true } } }
          }
        }
      }),
      prisma.affiliatePayout.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        payouts: rows.map((p: any) => ({
          id: p.id,
          affiliateId: p.affiliateId,
          affiliateCode: p.affiliate?.code ?? null,
          affiliateName: p.affiliate?.user?.name ?? null,
          affiliateEmail: p.affiliate?.user?.email ?? null,
          payoutDetails: p.affiliate?.payoutDetails ?? null,
          amount: p.amount,
          status: p.status,
          note: p.note,
          processedBy: p.processedBy,
          processedAt: p.processedAt,
          createdAt: p.createdAt
        })),
        pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }
      }
    });
  } catch (error: any) {
    console.error('[BackofficeAffiliates] listAffiliatePayouts error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const processPayoutSchema = Joi.object({
  decision: Joi.string().valid('PAID', 'REJECTED').required(),
  note: Joi.string().trim().max(500).allow('', null).optional()
});

export const processAffiliatePayout = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { error, value } = processPayoutSchema.validate(req.body);
    if (error) {
      res.status(400).json({ success: false, message: 'Validation error', errors: error.details.map((d) => d.message) });
      return;
    }
    const prisma = await getPrisma();
    const payout = await prisma.affiliatePayout.findUnique({ where: { id: req.params.id } });
    if (!payout) {
      res.status(404).json({ success: false, message: 'Payout not found' });
      return;
    }
    if (payout.status !== 'REQUESTED') {
      res.status(409).json({ success: false, message: `Payout is already ${payout.status}` });
      return;
    }

    const updated = await prisma.affiliatePayout.update({
      where: { id: payout.id },
      data: {
        status: value.decision,
        note: value.note || null,
        processedBy: req.admin!.id,
        processedAt: new Date()
      }
    });

    // When a payout is PAID, mark the affiliate's outstanding
    // APPROVED/PENDING commissions as PAID up to the payout amount
    // (oldest first) so commission rows reflect settlement. A REJECTED
    // payout simply frees the reserved balance back to available.
    if (value.decision === 'PAID') {
      let remaining = payout.amount;
      const open = await prisma.affiliateCommission.findMany({
        where: { affiliateId: payout.affiliateId, status: { in: ['PENDING', 'APPROVED'] } },
        orderBy: { createdAt: 'asc' }
      });
      for (const c of open as any[]) {
        if (remaining <= 0) break;
        if (c.amount <= remaining + 0.001) {
          await prisma.affiliateCommission.update({
            where: { id: c.id },
            data: { status: 'PAID', paidAt: new Date() }
          });
          remaining = Math.round((remaining - c.amount) * 100) / 100;
        }
      }
    }

    await logAdminAction(req.admin!.id, `AFFILIATE_PAYOUT_${value.decision}`, 'AffiliatePayout', payout.id, {
      affiliateId: payout.affiliateId,
      amount: payout.amount,
      note: value.note || null
    });

    res.json({ success: true, message: `Payout ${value.decision.toLowerCase()}`, data: updated });
  } catch (error: any) {
    console.error('[BackofficeAffiliates] processAffiliatePayout error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getAffiliateConfigAdmin = async (_req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const config = await getAffiliateConfig(prisma);
    res.json({ success: true, data: config });
  } catch (error: any) {
    console.error('[BackofficeAffiliates] getAffiliateConfigAdmin error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const updateAffiliateConfigAdmin = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { error, value } = configSchema.validate(req.body);
    if (error) {
      res.status(400).json({ success: false, message: 'Validation error', errors: error.details.map((d) => d.message) });
      return;
    }
    const prisma = await getPrisma();
    const config = await setAffiliateConfig(prisma, value);
    await logAdminAction(req.admin!.id, 'UPDATE_AFFILIATE_CONFIG', 'AffiliateConfig', 'global_affiliate', { ...value });
    res.json({ success: true, message: 'Affiliate configuration updated', data: config });
  } catch (error: any) {
    console.error('[BackofficeAffiliates] updateAffiliateConfigAdmin error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
