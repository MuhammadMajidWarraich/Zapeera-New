import { Request, Response } from 'express';
import Joi from 'joi';
import { getPrisma } from '../utils/db.util';
import { slugifyPartnerName } from '../utils/partner.util';

// ─── Backoffice: white-label partners (Feature 3) ─────────────────────
// Platform-admin management of reseller partners, behind the
// backoffice router (adminAuthenticate + role guard in the router).
// Creating a partner designates its admin by EMAIL: the email must
// belong to an existing Zapeera user account (the partner admin signs
// in to the normal app and opens /partner — v1 has exactly one admin
// per partner). Suspending a partner stops its branding from resolving
// and blocks new attributions, without touching existing businesses'
// partnerId (reactivation restores everything).

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const createPartnerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).required(),
  slug: Joi.string().trim().lowercase().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80).optional().messages({
    'string.pattern.base': 'Slug may only contain lowercase letters, numbers and dashes'
  }),
  adminEmail: Joi.string().trim().email().required(),
  logoUrl: Joi.string().max(2_500_000).allow('', null).optional(),
  primaryColor: Joi.string().pattern(HEX_COLOR).allow('', null).optional(),
  supportEmail: Joi.string().trim().email().max(160).allow('', null).optional(),
  tagline: Joi.string().trim().max(160).allow('', null).optional()
});

const updatePartnerSchema = Joi.object({
  name: Joi.string().trim().min(2).max(120).optional(),
  adminEmail: Joi.string().trim().email().optional(),
  status: Joi.string().valid('ACTIVE', 'SUSPENDED').optional(),
  logoUrl: Joi.string().max(2_500_000).allow('', null).optional(),
  primaryColor: Joi.string().pattern(HEX_COLOR).allow('', null).optional(),
  supportEmail: Joi.string().trim().email().max(160).allow('', null).optional(),
  tagline: Joi.string().trim().max(160).allow('', null).optional()
});

const shapeAdminPartner = (partner: any) => ({
  id: partner.id,
  name: partner.name,
  slug: partner.slug,
  logoUrl: partner.logoUrl || null,
  primaryColor: partner.primaryColor || null,
  supportEmail: partner.supportEmail || null,
  tagline: partner.tagline || null,
  status: partner.status,
  adminUserId: partner.adminUserId,
  pendingAdminEmail: partner.pendingAdminEmail || null,
  admin: partner.admin
    ? { id: partner.admin.id, name: partner.admin.name, email: partner.admin.email }
    : null,
  businessCount: partner._count?.businesses ?? 0,
  createdAt: partner.createdAt,
  updatedAt: partner.updatedAt
});

async function resolveAdminUser(prisma: any, email: string, res: Response): Promise<any | null> {
  const user = await prisma.zapeeraUser.findUnique({
    where: { email: email.toLowerCase() },
    select: { id: true, name: true, email: true }
  });
  if (!user) {
    res.status(400).json({
      success: false,
      code: 'PARTNER_ADMIN_NOT_FOUND',
      message: `No Zapeera user account exists with email ${email}. The partner admin must register first.`
    });
    return null;
  }
  return user;
}

/** GET /api/backoffice/partners — list with admin + business counts. */
export const getAllPartners = async (_req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const partners = await prisma.partner.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        admin: { select: { id: true, name: true, email: true } },
        _count: { select: { businesses: true } }
      }
    });
    res.json({ success: true, data: partners.map(shapeAdminPartner) });
  } catch (error: any) {
    console.error('Backoffice partners (list) error:', error?.message || error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/** POST /api/backoffice/partners — create + designate admin by email. */
export const createPartner = async (req: Request, res: Response): Promise<void> => {
  try {
    const { error, value } = createPartnerSchema.validate(req.body || {});
    if (error) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map((d) => d.message)
      });
      return;
    }

    const prisma = await getPrisma();
    const admin = await resolveAdminUser(prisma, value.adminEmail, res);
    if (!admin) return;

    const slug = value.slug || slugifyPartnerName(value.name);
    if (!slug) {
      res.status(400).json({ success: false, message: 'Could not derive a slug from the partner name' });
      return;
    }
    const existing = await prisma.partner.findUnique({ where: { slug } });
    if (existing) {
      res.status(409).json({
        success: false,
        code: 'PARTNER_SLUG_TAKEN',
        message: `A partner with slug "${slug}" already exists`
      });
      return;
    }

    const partner = await prisma.partner.create({
      data: {
        name: value.name,
        slug,
        adminUserId: admin.id,
        logoUrl: value.logoUrl || null,
        primaryColor: value.primaryColor || null,
        supportEmail: value.supportEmail || null,
        tagline: value.tagline || null,
        status: 'ACTIVE'
      },
      include: {
        admin: { select: { id: true, name: true, email: true } },
        _count: { select: { businesses: true } }
      }
    });

    res.status(201).json({ success: true, data: shapeAdminPartner(partner) });
  } catch (error: any) {
    console.error('Backoffice partners (create) error:', error?.message || error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/** PATCH /api/backoffice/partners/:id — update fields incl. status
 *  (suspend/activate) and admin reassignment (by email). */
export const updatePartner = async (req: Request, res: Response): Promise<void> => {
  try {
    const { error, value } = updatePartnerSchema.validate(req.body || {});
    if (error) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map((d) => d.message)
      });
      return;
    }

    const prisma = await getPrisma();
    const partner = await prisma.partner.findUnique({ where: { id: req.params.id } });
    if (!partner) {
      res.status(404).json({ success: false, message: 'Partner not found' });
      return;
    }

    const data: any = {};
    if (value.name !== undefined) data.name = value.name;
    if (value.status !== undefined) data.status = value.status;
    if (value.logoUrl !== undefined) data.logoUrl = value.logoUrl || null;
    if (value.primaryColor !== undefined) data.primaryColor = value.primaryColor || null;
    if (value.supportEmail !== undefined) data.supportEmail = value.supportEmail || null;
    if (value.tagline !== undefined) data.tagline = value.tagline || null;
    if (value.adminEmail !== undefined) {
      const admin = await resolveAdminUser(prisma, value.adminEmail, res);
      if (!admin) return;
      data.adminUserId = admin.id;
    }

    const updated = await prisma.partner.update({
      where: { id: partner.id },
      data,
      include: {
        admin: { select: { id: true, name: true, email: true } },
        _count: { select: { businesses: true } }
      }
    });

    res.json({ success: true, data: shapeAdminPartner(updated) });
  } catch (error: any) {
    console.error('Backoffice partners (update) error:', error?.message || error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const reassignSchema = Joi.object({
  // null clears the attribution (business becomes a direct Zapeera sale)
  partnerId: Joi.string().allow(null).required()
});

/** PATCH /api/backoffice/businesses/:id/partner — the ONLY way a
 *  business's partner attribution changes after creation. */
export const reassignBusinessPartner = async (req: Request, res: Response): Promise<void> => {
  try {
    const { error, value } = reassignSchema.validate(req.body || {});
    if (error) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map((d) => d.message)
      });
      return;
    }

    const prisma = await getPrisma();
    const business = await prisma.business.findUnique({
      where: { id: req.params.id },
      select: { id: true, partnerId: true }
    });
    if (!business) {
      res.status(404).json({ success: false, message: 'Business not found' });
      return;
    }

    if (value.partnerId) {
      const partner = await prisma.partner.findUnique({ where: { id: value.partnerId } });
      if (!partner) {
        res.status(400).json({ success: false, code: 'PARTNER_NOT_FOUND', message: 'Partner not found' });
        return;
      }
    }

    const updated = await prisma.business.update({
      where: { id: business.id },
      data: { partnerId: value.partnerId || null },
      select: { id: true, name: true, partnerId: true }
    });

    res.json({ success: true, data: updated });
  } catch (error: any) {
    console.error('Backoffice partners (reassign) error:', error?.message || error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
