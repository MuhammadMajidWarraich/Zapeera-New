// CRITICAL: Import database initialization FIRST to ensure DATABASE_URL is set
import '../config/database.init';

import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AuthRequest } from '../middleware/auth.middleware';
import Joi from 'joi';
import {
  generateAffiliateCodeCandidate,
  summarizeAffiliateBalance
} from '../utils/affiliate.util';
import { getAffiliateConfig } from '../utils/affiliate-config.util';

/**
 * Affiliate program — affiliate self-service (tenant JWT, route-policy
 * kind 'auth': account-level, deliberately NOT module/business gated —
 * an affiliate may own no business at all).
 *
 *   POST /api/affiliates/join             → create Affiliate (PENDING)
 *   GET  /api/affiliates/me               → profile + config + balance stats
 *   GET  /api/affiliates/me/referrals     → referred businesses
 *   GET  /api/affiliates/me/commissions   → commission rows (paginated)
 *   GET  /api/affiliates/me/payouts       → payout rows (paginated)
 *   POST /api/affiliates/me/payout-request→ request payout of full available balance
 *   PUT  /api/affiliates/me/payout-details→ save payout method/account
 */

const PAYOUT_METHODS = ['BANK_TRANSFER', 'JAZZCASH', 'EASYPAISA'];

const payoutDetailsSchema = Joi.object({
  method: Joi.string().valid(...PAYOUT_METHODS).required(),
  accountTitle: Joi.string().trim().min(3).max(100).required(),
  accountNumber: Joi.string().trim().min(5).max(40).required(),
  bankName: Joi.string().trim().max(100).allow('', null).optional()
});

const getMyAffiliate = async (prisma: any, userId: string) =>
  prisma.affiliate.findUnique({ where: { userId } });

const requireAffiliate = async (req: AuthRequest, res: Response) => {
  const prisma = await getPrisma();
  const affiliate = await getMyAffiliate(prisma, req.user!.id);
  if (!affiliate) {
    res.status(404).json({ success: false, message: 'You have not joined the affiliate program yet' });
    return null;
  }
  return { prisma, affiliate };
};

/** Serialize an affiliate profile + computed stats for the dashboard. */
const buildDashboardPayload = async (prisma: any, affiliate: any) => {
  const [config, commissions, payouts, referralsCount, referredBusinesses] = await Promise.all([
    getAffiliateConfig(prisma),
    prisma.affiliateCommission.findMany({
      where: { affiliateId: affiliate.id },
      select: { amount: true, status: true }
    }),
    prisma.affiliatePayout.findMany({
      where: { affiliateId: affiliate.id },
      select: { amount: true, status: true }
    }),
    prisma.affiliateReferral.count({ where: { affiliateId: affiliate.id } }),
    prisma.affiliateReferral.findMany({
      where: { affiliateId: affiliate.id },
      select: { businessId: true }
    })
  ]);

  // "Active" referred businesses = referred businesses whose
  // subscription is currently ACTIVE or TRIAL (i.e. not lapsed).
  let activeReferredBusinesses = 0;
  if (referredBusinesses.length > 0) {
    activeReferredBusinesses = await prisma.businessSubscription.count({
      where: {
        businessId: { in: referredBusinesses.map((r: any) => r.businessId) },
        status: { in: ['ACTIVE', 'TRIAL'] }
      }
    });
  }

  const balance = summarizeAffiliateBalance(commissions, payouts);
  return {
    affiliate: {
      id: affiliate.id,
      code: affiliate.code,
      status: affiliate.status,
      commissionRate: affiliate.commissionRate,
      effectiveRate: affiliate.commissionRate ?? config.defaultRate,
      payoutDetails: affiliate.payoutDetails ?? null,
      createdAt: affiliate.createdAt
    },
    config: { defaultRate: config.defaultRate, minPayout: config.minPayout },
    stats: {
      referralsCount: referralsCount,
      activeReferredBusinesses,
      ...balance,
      canRequestPayout:
        affiliate.status === 'ACTIVE' && balance.availableBalance >= config.minPayout && !!affiliate.payoutDetails
    },
    // The public signup URL carrying this affiliate's code. The app is
    // served on the app host; /signup is the register route (AuthContainer).
    referralLink: `https://app.zapeera.seikho.online/signup?ref=${affiliate.code}`
  };
};

export const joinAffiliate = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const userId = req.user!.id;

    const existing = await getMyAffiliate(prisma, userId);
    if (existing) {
      res.status(409).json({
        success: false,
        message: 'You already have an affiliate profile',
        data: { code: existing.code, status: existing.status }
      });
      return;
    }

    // Code uniqueness: generate + retry on the unique index (P2002).
    let affiliate: any = null;
    for (let attempt = 0; attempt < 5 && !affiliate; attempt++) {
      try {
        affiliate = await prisma.affiliate.create({
          data: { userId, code: generateAffiliateCodeCandidate(), status: 'PENDING' }
        });
      } catch (error: any) {
        if (error?.code !== 'P2002') throw error;
        // Either the code collided (retry with a new one) or a race
        // created the profile for this user first (stop and report).
        const raced = await getMyAffiliate(prisma, userId);
        if (raced) {
          res.status(409).json({
            success: false,
            message: 'You already have an affiliate profile',
            data: { code: raced.code, status: raced.status }
          });
          return;
        }
      }
    }
    if (!affiliate) {
      res.status(500).json({ success: false, message: 'Could not generate a unique referral code, please try again' });
      return;
    }

    res.status(201).json({
      success: true,
      message: 'Affiliate application received. Your account is pending approval by the Zapeera team.',
      data: { id: affiliate.id, code: affiliate.code, status: affiliate.status }
    });
  } catch (error: any) {
    console.error('[Affiliate] joinAffiliate error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getMyAffiliateDashboard = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const affiliate = await getMyAffiliate(prisma, req.user!.id);
    if (!affiliate) {
      // 200 with hasProfile:false so the dashboard can render the join
      // state without treating it as an error.
      const config = await getAffiliateConfig(prisma);
      res.json({ success: true, data: { hasProfile: false, config } });
      return;
    }
    const payload = await buildDashboardPayload(prisma, affiliate);
    res.json({ success: true, data: { hasProfile: true, ...payload } });
  } catch (error: any) {
    console.error('[Affiliate] getMyAffiliateDashboard error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getMyReferrals = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ctx = await requireAffiliate(req, res);
    if (!ctx) return;
    const { prisma, affiliate } = ctx;

    const referrals = await prisma.affiliateReferral.findMany({
      where: { affiliateId: affiliate.id },
      orderBy: { createdAt: 'desc' },
      include: {
        business: {
          select: {
            id: true,
            name: true,
            businessType: true,
            createdAt: true,
            businessSubscription: { select: { status: true, billingStatus: true, plan: { select: { name: true } } } }
          }
        }
      }
    });

    res.json({
      success: true,
      data: referrals.map((r: any) => ({
        id: r.id,
        businessId: r.businessId,
        businessName: r.business?.name ?? null,
        businessType: r.business?.businessType ?? null,
        signedUpAt: r.createdAt,
        businessCreatedAt: r.business?.createdAt ?? null,
        subscriptionStatus: r.business?.businessSubscription?.status ?? null,
        billingStatus: r.business?.businessSubscription?.billingStatus ?? null,
        planName: r.business?.businessSubscription?.plan?.name ?? null
      }))
    });
  } catch (error: any) {
    console.error('[Affiliate] getMyReferrals error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getMyCommissions = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ctx = await requireAffiliate(req, res);
    if (!ctx) return;
    const { prisma, affiliate } = ctx;

    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const where: any = { affiliateId: affiliate.id };
    if (status) where.status = status;

    const [rows, total] = await Promise.all([
      prisma.affiliateCommission.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { business: { select: { name: true } } }
      }),
      prisma.affiliateCommission.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        commissions: rows.map((c: any) => ({
          id: c.id,
          businessId: c.businessId,
          businessName: c.business?.name ?? null,
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
    console.error('[Affiliate] getMyCommissions error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getMyPayouts = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ctx = await requireAffiliate(req, res);
    if (!ctx) return;
    const { prisma, affiliate } = ctx;

    const payouts = await prisma.affiliatePayout.findMany({
      where: { affiliateId: affiliate.id },
      orderBy: { createdAt: 'desc' },
      take: 50
    });
    res.json({ success: true, data: payouts });
  } catch (error: any) {
    console.error('[Affiliate] getMyPayouts error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const requestPayout = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const ctx = await requireAffiliate(req, res);
    if (!ctx) return;
    const { prisma, affiliate } = ctx;

    if (affiliate.status !== 'ACTIVE') {
      res.status(403).json({ success: false, message: 'Only ACTIVE affiliates can request a payout' });
      return;
    }
    if (!affiliate.payoutDetails) {
      res.status(400).json({ success: false, message: 'Add your payout details before requesting a payout' });
      return;
    }

    const config = await getAffiliateConfig(prisma);
    const [commissions, payouts] = await Promise.all([
      prisma.affiliateCommission.findMany({ where: { affiliateId: affiliate.id }, select: { amount: true, status: true } }),
      prisma.affiliatePayout.findMany({ where: { affiliateId: affiliate.id }, select: { amount: true, status: true } })
    ]);
    const balance = summarizeAffiliateBalance(commissions, payouts);

    if (balance.availableBalance < config.minPayout) {
      res.status(400).json({
        success: false,
        message: `Available balance PKR ${balance.availableBalance} is below the minimum payout of PKR ${config.minPayout}`,
        data: { availableBalance: balance.availableBalance, minPayout: config.minPayout }
      });
      return;
    }

    // One open request at a time — a REQUESTED row already reserves its
    // amount in the available-balance math; a second concurrent request
    // would only confuse processing.
    const openRequest = await prisma.affiliatePayout.findFirst({
      where: { affiliateId: affiliate.id, status: 'REQUESTED' }
    });
    if (openRequest) {
      res.status(409).json({ success: false, message: 'You already have a payout request being processed' });
      return;
    }

    const payout = await prisma.affiliatePayout.create({
      data: { affiliateId: affiliate.id, amount: balance.availableBalance, status: 'REQUESTED' }
    });

    res.status(201).json({
      success: true,
      message: 'Payout requested. The Zapeera team will process it shortly.',
      data: payout
    });
  } catch (error: any) {
    console.error('[Affiliate] requestPayout error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const updatePayoutDetails = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { error, value } = payoutDetailsSchema.validate(req.body);
    if (error) {
      res.status(400).json({ success: false, message: 'Validation error', errors: error.details.map((d) => d.message) });
      return;
    }
    const ctx = await requireAffiliate(req, res);
    if (!ctx) return;
    const { prisma, affiliate } = ctx;

    const updated = await prisma.affiliate.update({
      where: { id: affiliate.id },
      data: {
        payoutDetails: {
          method: value.method,
          accountTitle: value.accountTitle,
          accountNumber: value.accountNumber,
          bankName: value.bankName || null
        }
      }
    });

    res.json({ success: true, message: 'Payout details saved', data: { payoutDetails: updated.payoutDetails } });
  } catch (error: any) {
    console.error('[Affiliate] updatePayoutDetails error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
