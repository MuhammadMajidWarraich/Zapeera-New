import { Response } from 'express';
import Joi from 'joi';
import { getPrisma } from '../utils/db.util';
import { AuthRequest } from '../middleware/auth.middleware';

// ─── Partner portal (White-label Feature 3) ───────────────────────────
// Tenant-side endpoints behind /api/partners, used by the /partner page
// in the main app. The portal identity is the partner's adminUserId
// (v1: exactly one admin per partner) — a regular Zapeera account that
// happens to administer a partner. There is NO module gate: like the
// /zapeera account area, this is account-level, not business data. A
// user who administers no partner gets 404 NOT_A_PARTNER_ADMIN so the
// UI can hide the portal entirely.
//
// Partners sell the standard platform plans in v1 — the portal shows
// plan info read-only and offers no partner-level pricing (phase 2),
// and no custom domains (phase 2; the slug join link is the entry).

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const brandingUpdateSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).optional(),
  // logoUrl is a base64 data-URI (client-downscaled to ≤512px JPEG,
  // the profile-photo pattern). Allow '' / null to clear the logo.
  logoUrl: Joi.string().max(2_500_000).allow('', null).optional(),
  primaryColor: Joi.string().pattern(HEX_COLOR).allow('', null).optional().messages({
    'string.pattern.base': 'Primary color must be a hex color like #1F7C47'
  }),
  tagline: Joi.string().trim().max(160).allow('', null).optional(),
  supportEmail: Joi.string().trim().email().max(160).allow('', null).optional()
});

async function requirePartnerAdmin(req: AuthRequest, res: Response): Promise<any | null> {
  const prisma = await getPrisma();
  const partner = await prisma.partner.findFirst({
    where: { adminUserId: req.user?.id },
    orderBy: { createdAt: 'asc' }
  });
  if (!partner) {
    res.status(404).json({
      success: false,
      code: 'NOT_A_PARTNER_ADMIN',
      message: 'This account does not administer a white-label partner'
    });
    return null;
  }
  return partner;
}

const shapePartner = (partner: any) => ({
  id: partner.id,
  name: partner.name,
  slug: partner.slug,
  logoUrl: partner.logoUrl || null,
  primaryColor: partner.primaryColor || null,
  supportEmail: partner.supportEmail || null,
  tagline: partner.tagline || null,
  status: partner.status,
  createdAt: partner.createdAt,
  updatedAt: partner.updatedAt
});

/** GET /api/partners/me — the partner this user administers + totals. */
export const getMyPartner = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const partner = await requirePartnerAdmin(req, res);
    if (!partner) return;

    const prisma = await getPrisma();
    const [businessCount, activeBusinessCount] = await Promise.all([
      prisma.business.count({ where: { partnerId: partner.id } }),
      prisma.business.count({ where: { partnerId: partner.id, isActive: true } })
    ]);

    res.json({
      success: true,
      data: {
        partner: shapePartner(partner),
        totals: { businessCount, activeBusinessCount }
      }
    });
  } catch (error: any) {
    console.error('Partner portal (me) error:', error?.message || error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/** GET /api/partners/me/businesses — businesses attributed to the
 *  partner, with each business's current plan + subscription status
 *  (read-only: plans are the standard platform plans in v1). */
export const getMyPartnerBusinesses = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const partner = await requirePartnerAdmin(req, res);
    if (!partner) return;

    const prisma = await getPrisma();
    const businesses = await prisma.business.findMany({
      where: { partnerId: partner.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        slug: true,
        businessType: true,
        isActive: true,
        createdAt: true,
        businessSubscription: {
          select: {
            status: true,
            billingStatus: true,
            currentPeriodEnd: true,
            plan: { select: { id: true, name: true, price: true } }
          }
        }
      }
    });

    res.json({
      success: true,
      data: businesses.map((b: any) => ({
        id: b.id,
        name: b.name,
        slug: b.slug,
        businessType: b.businessType,
        isActive: b.isActive,
        createdAt: b.createdAt,
        planName: b.businessSubscription?.plan?.name || null,
        planPrice: b.businessSubscription?.plan?.price ?? null,
        subscriptionStatus: b.businessSubscription?.status || null,
        billingStatus: b.businessSubscription?.billingStatus || null,
        currentPeriodEnd: b.businessSubscription?.currentPeriodEnd || null
      }))
    });
  } catch (error: any) {
    console.error('Partner portal (businesses) error:', error?.message || error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/** PUT /api/partners/me/branding — update the partner's own branding.
 *  The slug is NOT editable here: join links carrying it are already
 *  in the wild; Backoffice owns slug-level changes. */
export const updateMyPartnerBranding = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const partner = await requirePartnerAdmin(req, res);
    if (!partner) return;

    const { error, value } = brandingUpdateSchema.validate(req.body || {});
    if (error) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map((d) => d.message)
      });
      return;
    }

    const data: any = {};
    if (value.name !== undefined) data.name = value.name;
    if (value.logoUrl !== undefined) data.logoUrl = value.logoUrl || null;
    if (value.primaryColor !== undefined) data.primaryColor = value.primaryColor || null;
    if (value.tagline !== undefined) data.tagline = value.tagline || null;
    if (value.supportEmail !== undefined) data.supportEmail = value.supportEmail || null;

    const prisma = await getPrisma();
    const updated = await prisma.partner.update({
      where: { id: partner.id },
      data
    });

    res.json({ success: true, data: { partner: shapePartner(updated) } });
  } catch (error: any) {
    console.error('Partner portal (branding update) error:', error?.message || error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
