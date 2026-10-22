import { Request, Response } from 'express';
import Joi from 'joi';
import { getPrisma } from '../utils/db.util';
import { AuthRequest } from '../middleware/auth.middleware';
import { slugifyPartnerName, uniquePartnerSlug } from '../utils/partner.util';

// ─── White-label partner applications ─────────────────────────────────
// Muhammad's order (2026-10-22): partners were previously created only
// by a Backoffice admin. Now a prospective reseller can APPLY:
//   · POST /api/partners/apply               — public marketing-site form
//   · POST /api/partners/apply-authenticated — signed-in user, in-app
//   · GET  /api/partners/my-application      — the caller's latest one
// Applications land as PENDING rows; Backoffice reviews them on the
// Partners page:
//   · GET  /api/backoffice/partner-applications
//   · POST /api/backoffice/partner-applications/:id/approve
//   · POST /api/backoffice/partner-applications/:id/reject
//
// APPROVE creates the partner from the application (companyName →
// partner name, slug derived + uniquified via uniquePartnerSlug — the
// same slug machinery Backoffice partner creation uses). Admin
// assignment mirrors createPartner's email designation, extended for
// the case createPartner rejects: when NO Zapeera user owns the
// application email yet, the partner is created with pendingAdminEmail
// set and adminUserId null; claimPendingPartnerAdmins (partner.util)
// resolves the claim when that user signs up / first loads the portal.

const applicationSchema = Joi.object({
  companyName: Joi.string().trim().min(2).max(120).required(),
  contactName: Joi.string().trim().min(2).max(120).required(),
  email: Joi.string().trim().email().max(160).required(),
  phone: Joi.string().trim().min(5).max(40).required(),
  website: Joi.string().trim().max(300).allow('', null).optional(),
  message: Joi.string().trim().max(2000).allow('', null).optional(),
  // Honeypot (the marketing form's hidden "company_website" field, the
  // contact-form pattern): humans never fill it; bots do.
  company_website: Joi.string().allow('').optional()
});

const rejectSchema = Joi.object({
  reason: Joi.string().trim().min(3).max(500).required()
});

const shapeApplication = (a: any) => ({
  id: a.id,
  companyName: a.companyName,
  contactName: a.contactName,
  email: a.email,
  phone: a.phone,
  website: a.website || null,
  message: a.message || null,
  source: a.source,
  status: a.status,
  applicantUserId: a.applicantUserId || null,
  applicant: a.applicantUser
    ? { id: a.applicantUser.id, name: a.applicantUser.name, email: a.applicantUser.email }
    : null,
  rejectionReason: a.rejectionReason || null,
  reviewedById: a.reviewedById || null,
  reviewedAt: a.reviewedAt || null,
  createdPartnerId: a.createdPartnerId || null,
  createdPartner: a.createdPartner
    ? { id: a.createdPartner.id, name: a.createdPartner.name, slug: a.createdPartner.slug }
    : null,
  createdAt: a.createdAt,
  updatedAt: a.updatedAt
});

/** Shared guards + insert for both apply surfaces. Returns either an
 *  HTTP-shaped failure ({ status, body }) or the created application. */
async function createApplication(
  prisma: any,
  value: any,
  source: 'WEB' | 'APP',
  applicantUserId: string | null
): Promise<{ status: number; body: any }> {
  const email = String(value.email).toLowerCase();

  // This email already belongs to a partner (as its admin account or as
  // a not-yet-claimed admin designation) — applying again is pointless.
  const existingPartner = await prisma.partner.findFirst({
    where: {
      OR: [
        { admin: { email } },
        { pendingAdminEmail: email }
      ]
    },
    select: { id: true }
  });
  if (existingPartner) {
    return {
      status: 409,
      body: {
        success: false,
        code: 'ALREADY_PARTNER',
        message: 'This email already belongs to a Zapeera partner. Sign in and open the Partner Portal instead.'
      }
    };
  }

  const approvedApplication = await prisma.partnerApplication.findFirst({
    where: { email, status: 'APPROVED' },
    select: { id: true }
  });
  if (approvedApplication) {
    return {
      status: 409,
      body: {
        success: false,
        code: 'ALREADY_PARTNER',
        message: 'This email already belongs to a Zapeera partner. Sign in and open the Partner Portal instead.'
      }
    };
  }

  const pending = await prisma.partnerApplication.findFirst({
    where: { email, status: 'PENDING' },
    select: { id: true }
  });
  if (pending) {
    return {
      status: 409,
      body: {
        success: false,
        code: 'APPLICATION_ALREADY_PENDING',
        message: 'An application with this email is already under review. We will get back to you — no need to apply again.'
      }
    };
  }

  const application = await prisma.partnerApplication.create({
    data: {
      companyName: value.companyName,
      contactName: value.contactName,
      email,
      phone: value.phone,
      website: value.website || null,
      message: value.message || null,
      source,
      applicantUserId: applicantUserId || null,
      status: 'PENDING'
    }
  });

  return { status: 201, body: { success: true, data: shapeApplication(application) } };
}

const validationFailure = (res: Response, error: Joi.ValidationError): void => {
  res.status(400).json({
    success: false,
    message: 'Validation error',
    errors: error.details.map((d) => d.message)
  });
};

/** POST /api/partners/apply — PUBLIC (marketing site). Classified
 *  'public' in the route-policy registry; CSRF-exempt like register
 *  (no cookie exists yet). Honeypot-filled submissions get a generic
 *  success response and are silently dropped. */
export const applyPublic = async (req: Request, res: Response): Promise<void> => {
  try {
    const { error, value } = applicationSchema.validate(req.body || {});
    if (error) {
      validationFailure(res, error);
      return;
    }
    if (value.company_website) {
      // Honeypot tripped — pretend success, store nothing.
      res.status(201).json({ success: true, data: { status: 'PENDING' } });
      return;
    }
    const prisma = await getPrisma();
    const result = await createApplication(prisma, value, 'WEB', null);
    res.status(result.status).json(result.body);
  } catch (error: any) {
    console.error('Partner application (public) error:', error?.message || error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/** POST /api/partners/apply-authenticated — signed-in user (in-app).
 *  The account's email is authoritative (it is also where approval
 *  designates the partner admin); contact name defaults to the
 *  account name. */
export const applyAuthenticated = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const user = await prisma.zapeeraUser.findUnique({
      where: { id: req.user?.id },
      select: { id: true, name: true, email: true }
    });
    if (!user) {
      res.status(401).json({ success: false, message: 'Unauthenticated' });
      return;
    }

    const ownPartner = await prisma.partner.findFirst({
      where: { adminUserId: user.id },
      select: { id: true }
    });
    if (ownPartner) {
      res.status(409).json({
        success: false,
        code: 'ALREADY_PARTNER',
        message: 'You already administer a Zapeera partner — open the Partner Portal instead.'
      });
      return;
    }

    const { error, value } = applicationSchema.validate({
      ...(req.body || {}),
      email: user.email,
      contactName: (req.body?.contactName || '').trim() || user.name
    });
    if (error) {
      validationFailure(res, error);
      return;
    }

    const result = await createApplication(prisma, value, 'APP', user.id);
    res.status(result.status).json(result.body);
  } catch (error: any) {
    console.error('Partner application (authenticated) error:', error?.message || error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/** GET /api/partners/my-application — the caller's most recent
 *  application (matched by linked account, falling back to the
 *  account email so a WEB application made before signup is visible). */
export const getMyApplication = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const user = await prisma.zapeeraUser.findUnique({
      where: { id: req.user?.id },
      select: { id: true, email: true }
    });
    if (!user) {
      res.status(401).json({ success: false, message: 'Unauthenticated' });
      return;
    }
    const application = await prisma.partnerApplication.findFirst({
      where: {
        OR: [
          { applicantUserId: user.id },
          { email: user.email.toLowerCase() }
        ]
      },
      orderBy: { createdAt: 'desc' }
    });
    res.json({ success: true, data: { application: application ? shapeApplication(application) : null } });
  } catch (error: any) {
    console.error('Partner application (mine) error:', error?.message || error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── Backoffice review ────────────────────────────────────────────────

/** GET /api/backoffice/partner-applications?status=&page=&limit= */
export const listPartnerApplications = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const status = String(req.query.status || '').toUpperCase();
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '25'), 10) || 25));
    const where: any = {};
    if (['PENDING', 'APPROVED', 'REJECTED'].includes(status)) where.status = status;

    const [total, rows] = await Promise.all([
      prisma.partnerApplication.count({ where }),
      prisma.partnerApplication.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          applicantUser: { select: { id: true, name: true, email: true } },
          createdPartner: { select: { id: true, name: true, slug: true } }
        }
      })
    ]);

    res.json({
      success: true,
      data: {
        applications: rows.map(shapeApplication),
        pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }
      }
    });
  } catch (error: any) {
    console.error('Partner applications (list) error:', error?.message || error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/** POST /api/backoffice/partner-applications/:id/approve — creates the
 *  partner from the application (see header comment for the admin
 *  designation + pending-claim design). */
export const approvePartnerApplication = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const application = await prisma.partnerApplication.findUnique({ where: { id: req.params.id } });
    if (!application) {
      res.status(404).json({ success: false, message: 'Partner application not found' });
      return;
    }
    if (application.status !== 'PENDING') {
      res.status(409).json({
        success: false,
        code: 'APPLICATION_ALREADY_REVIEWED',
        message: `This application was already ${application.status.toLowerCase()}`
      });
      return;
    }

    const email = application.email.toLowerCase();
    const adminId = (req as any).admin?.id || null;

    // A partner for this email may have appeared since the application
    // (manual Backoffice creation / an earlier approval): link to it
    // instead of creating a duplicate.
    let partner = await prisma.partner.findFirst({
      where: { OR: [{ admin: { email } }, { pendingAdminEmail: email }] }
    });

    if (!partner) {
      if (!slugifyPartnerName(application.companyName)) {
        res.status(400).json({ success: false, message: 'Could not derive a slug from the company name' });
        return;
      }
      const slug = await uniquePartnerSlug(prisma, application.companyName);
      // Same email designation as Backoffice createPartner: an existing
      // account becomes the admin instantly; otherwise the partner is
      // created with a pending claim for that email.
      const adminUser = await prisma.zapeeraUser.findUnique({
        where: { email },
        select: { id: true }
      });
      partner = await prisma.partner.create({
        data: {
          name: application.companyName,
          slug,
          adminUserId: adminUser?.id || null,
          pendingAdminEmail: adminUser ? null : email,
          supportEmail: email,
          status: 'ACTIVE'
        }
      });
    }

    const updated = await prisma.partnerApplication.update({
      where: { id: application.id },
      data: {
        status: 'APPROVED',
        reviewedById: adminId,
        reviewedAt: new Date(),
        rejectionReason: null,
        createdPartnerId: partner.id
      },
      include: {
        applicantUser: { select: { id: true, name: true, email: true } },
        createdPartner: { select: { id: true, name: true, slug: true } }
      }
    });

    res.json({
      success: true,
      data: {
        application: shapeApplication(updated),
        partner: { id: partner.id, name: partner.name, slug: partner.slug },
        adminClaimPending: !partner.adminUserId
      }
    });
  } catch (error: any) {
    console.error('Partner applications (approve) error:', error?.message || error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/** POST /api/backoffice/partner-applications/:id/reject { reason } */
export const rejectPartnerApplication = async (req: Request, res: Response): Promise<void> => {
  try {
    const { error, value } = rejectSchema.validate(req.body || {});
    if (error) {
      validationFailure(res, error);
      return;
    }
    const prisma = await getPrisma();
    const application = await prisma.partnerApplication.findUnique({ where: { id: req.params.id } });
    if (!application) {
      res.status(404).json({ success: false, message: 'Partner application not found' });
      return;
    }
    if (application.status !== 'PENDING') {
      res.status(409).json({
        success: false,
        code: 'APPLICATION_ALREADY_REVIEWED',
        message: `This application was already ${application.status.toLowerCase()}`
      });
      return;
    }

    const updated = await prisma.partnerApplication.update({
      where: { id: application.id },
      data: {
        status: 'REJECTED',
        reviewedById: (req as any).admin?.id || null,
        reviewedAt: new Date(),
        rejectionReason: value.reason
      },
      include: {
        applicantUser: { select: { id: true, name: true, email: true } },
        createdPartner: { select: { id: true, name: true, slug: true } }
      }
    });

    res.json({ success: true, data: { application: shapeApplication(updated) } });
  } catch (error: any) {
    console.error('Partner applications (reject) error:', error?.message || error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
