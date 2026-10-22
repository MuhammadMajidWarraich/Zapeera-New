/**
 * Affiliate program — global configuration.
 *
 * Stored in the existing Settings key-value table under a reserved
 * owner, following the platform precedent set by global pricing
 * (subscription-entitlements.util: createdBy 'global_pricing', key
 * 'plans'). Rows are seeded lazily: when a key is absent the documented
 * default applies, and the backoffice affiliate settings endpoints
 * (GET/PUT /api/backoffice/affiliates/config) upsert the rows, which
 * is what makes the values backoffice-editable.
 *
 *   AFFILIATE_DEFAULT_RATE — percent of each referred payment paid to
 *                            the affiliate when the affiliate has no
 *                            per-affiliate override. Default 20.
 *   AFFILIATE_MIN_PAYOUT   — minimum available balance (PKR) before an
 *                            affiliate may request a payout. Default 5000.
 */

export const AFFILIATE_SETTINGS_OWNER = 'global_affiliate';
export const AFFILIATE_DEFAULT_RATE_KEY = 'AFFILIATE_DEFAULT_RATE';
export const AFFILIATE_MIN_PAYOUT_KEY = 'AFFILIATE_MIN_PAYOUT';

export const AFFILIATE_DEFAULT_RATE = 20; // percent
export const AFFILIATE_MIN_PAYOUT = 5000; // PKR

export interface AffiliateConfig {
  defaultRate: number;
  minPayout: number;
}

function parsePositive(raw: string | null | undefined, fallback: number): number {
  if (raw == null) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export async function getAffiliateConfig(prisma: any): Promise<AffiliateConfig> {
  try {
    const rows = await prisma.settings.findMany({
      where: { createdBy: AFFILIATE_SETTINGS_OWNER, key: { in: [AFFILIATE_DEFAULT_RATE_KEY, AFFILIATE_MIN_PAYOUT_KEY] } }
    });
    const byKey = new Map<string, string>(rows.map((r: any) => [r.key, r.value]));
    return {
      defaultRate: parsePositive(byKey.get(AFFILIATE_DEFAULT_RATE_KEY), AFFILIATE_DEFAULT_RATE),
      minPayout: parsePositive(byKey.get(AFFILIATE_MIN_PAYOUT_KEY), AFFILIATE_MIN_PAYOUT)
    };
  } catch {
    // Config must never break a payment path — fall back to defaults.
    return { defaultRate: AFFILIATE_DEFAULT_RATE, minPayout: AFFILIATE_MIN_PAYOUT };
  }
}

export async function setAffiliateConfig(
  prisma: any,
  patch: { defaultRate?: number; minPayout?: number }
): Promise<AffiliateConfig> {
  const upsert = async (key: string, value: number, description: string) => {
    await prisma.settings.upsert({
      where: { createdBy_key: { createdBy: AFFILIATE_SETTINGS_OWNER, key } },
      create: { createdBy: AFFILIATE_SETTINGS_OWNER, key, value: String(value), description },
      update: { value: String(value), description }
    });
  };
  if (typeof patch.defaultRate === 'number' && Number.isFinite(patch.defaultRate) && patch.defaultRate >= 0 && patch.defaultRate <= 100) {
    await upsert(AFFILIATE_DEFAULT_RATE_KEY, patch.defaultRate, 'Affiliate program: default commission percent when an affiliate has no override');
  }
  if (typeof patch.minPayout === 'number' && Number.isFinite(patch.minPayout) && patch.minPayout >= 0) {
    await upsert(AFFILIATE_MIN_PAYOUT_KEY, patch.minPayout, 'Affiliate program: minimum available balance (PKR) required to request a payout');
  }
  return getAffiliateConfig(prisma);
}
