import { getPrisma } from './db.util';

// ─── White-label partners (Feature 3) ─────────────────────────────────
// Shared helpers for partner attribution (business creation) and public
// branding resolution (login/register pages, app shell).
//
// Design notes:
//  · A partner is a PLATFORM-level reseller record (like plans and
//    backoffice users), not tenant data — so the Partner model is
//    deliberately NOT wired into the desktop/offline sync table maps:
//    branding is resolved from the cloud at runtime, and a partner's
//    logo/branding never needs to live in a tenant's local database.
//  · Attribution happens exactly once, at business creation, from the
//    slug the signup flow carried (?partner=<slug> / /join/<slug> →
//    localStorage → createCompany payload). Tenants can never change
//    business.partnerId afterwards; Backoffice can reassign.
//  · A SUSPENDED partner stops resolving for NEW attributions and for
//    branding (its businesses fall back to default Zapeera branding)
//    but the partnerId on existing businesses is kept, so reactivation
//    restores the branding exactly as it was.

export interface PublicBranding {
  productName: string;
  logoUrl: string | null;
  primaryColor: string | null;
  tagline: string | null;
  supportEmail: string | null;
  partnerSlug: string | null;
}

/** The stock Zapeera branding — what every surface renders when no
 *  ACTIVE partner applies. Identical to the pre-white-label product. */
export const DEFAULT_BRANDING: PublicBranding = {
  productName: 'Zapeera',
  logoUrl: null,
  primaryColor: null,
  tagline: null,
  supportEmail: null,
  partnerSlug: null
};

export const slugifyPartnerName = (name: string): string =>
  String(name || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

export const normalizePartnerSlug = (slug: unknown): string =>
  typeof slug === 'string' ? slug.trim().toLowerCase() : '';

/** Resolve a slug to an ACTIVE partner (the only kind that can brand
 *  or receive new attributions). Returns null for unknown/suspended. */
export async function findActivePartnerBySlug(prisma: any, slug: unknown) {
  const normalized = normalizePartnerSlug(slug);
  if (!normalized) return null;
  return prisma.partner.findFirst({
    where: { slug: normalized, status: 'ACTIVE' }
  });
}

/** The partner attribution for a new business: the partner id when the
 *  carried slug resolves to an ACTIVE partner, otherwise null (direct
 *  Zapeera sale). Never throws — a bad slug must not block signup. */
export async function resolvePartnerAttribution(
  prisma: any,
  slug: unknown
): Promise<string | null> {
  try {
    const partner = await findActivePartnerBySlug(prisma, slug);
    return partner ? partner.id : null;
  } catch {
    return null;
  }
}

export function partnerToBranding(partner: any): PublicBranding {
  if (!partner || partner.status !== 'ACTIVE') return { ...DEFAULT_BRANDING };
  return {
    productName: partner.name,
    logoUrl: partner.logoUrl || null,
    primaryColor: partner.primaryColor || null,
    tagline: partner.tagline || null,
    supportEmail: partner.supportEmail || null,
    partnerSlug: partner.slug
  };
}

/** Branding for a business: its partner's branding when the business is
 *  attributed to an ACTIVE partner, otherwise the default. */
export async function resolveBrandingForBusiness(
  prisma: any,
  businessId: string | null | undefined
): Promise<PublicBranding> {
  if (!businessId) return { ...DEFAULT_BRANDING };
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { partnerId: true }
  });
  if (!business?.partnerId) return { ...DEFAULT_BRANDING };
  const partner = await prisma.partner.findFirst({
    where: { id: business.partnerId, status: 'ACTIVE' }
  });
  return partnerToBranding(partner);
}

export { getPrisma };
