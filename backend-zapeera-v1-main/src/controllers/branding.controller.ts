import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AuthRequest } from '../middleware/auth.middleware';
import {
  DEFAULT_BRANDING,
  findActivePartnerBySlug,
  partnerToBranding,
  resolveBrandingForBusiness
} from '../utils/partner.util';

// ─── Public branding resolution (White-label Feature 3) ───────────────
// GET /api/branding powers every branded surface before and after login:
//   · ?slug=<partner-slug>  → that ACTIVE partner's public branding
//     (join links / partner landing), or the default when the slug is
//     unknown or the partner is suspended.
//   · authenticated, no slug → the branding of the partner behind the
//     caller's current business (X-Business-ID header), or the default
//     for direct Zapeera businesses.
//   · anonymous, no slug    → the default Zapeera branding.
// The response also carries a `viewer` block when authenticated so the
// app shell can show the Partner Portal entry exactly when the signed-
// in user is a partner admin (v1: the partner's adminUserId).
//
// The route is classified 'public' in the route-policy registry (the
// pre-login surfaces need it); identity is OPTIONAL and resolved by the
// router's soft-auth middleware — a missing/invalid token simply means
// "anonymous", never an error.

export const getBranding = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();

    const slugParam = typeof req.query.slug === 'string' ? req.query.slug : '';
    let branding = { ...DEFAULT_BRANDING };

    if (slugParam) {
      const partner = await findActivePartnerBySlug(prisma, slugParam);
      branding = partnerToBranding(partner);
    } else if (req.user?.id) {
      const businessId =
        (req.headers['x-business-id'] as string) ||
        (req.headers['x-company-id'] as string) ||
        req.user.selectedCompanyId ||
        req.user.companyId ||
        null;
      branding = await resolveBrandingForBusiness(prisma, businessId);
    }

    // Viewer block: is the signed-in user a partner admin?
    let viewer: {
      isPartnerAdmin: boolean;
      partnerSlug: string | null;
      partnerStatus: string | null;
    } = { isPartnerAdmin: false, partnerSlug: null, partnerStatus: null };

    if (req.user?.id) {
      const own = await prisma.partner.findFirst({
        where: { adminUserId: req.user.id },
        orderBy: { createdAt: 'asc' },
        select: { slug: true, status: true }
      });
      if (own) {
        viewer = {
          isPartnerAdmin: true,
          partnerSlug: own.slug,
          partnerStatus: own.status
        };
      }
    }

    res.json({ success: true, data: { ...branding, viewer } });
  } catch (error: any) {
    // Branding must never break the app shell: on any failure, serve
    // the default branding (exactly the pre-white-label product).
    console.error('Branding resolution error:', error?.message || error);
    res.json({
      success: true,
      data: {
        ...DEFAULT_BRANDING,
        viewer: { isPartnerAdmin: false, partnerSlug: null, partnerStatus: null }
      }
    });
  }
};
