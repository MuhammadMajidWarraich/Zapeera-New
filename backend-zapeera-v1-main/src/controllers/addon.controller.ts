/**
 * Subscription Add-ons — tenant-facing API (mounted under
 * /api/subscription/addons; the route-policy registry classifies the
 * /api/subscription prefix as 'billing', i.e. reachable regardless of
 * subscription state — which is exactly what a locked-out owner needs).
 *
 * Activation model mirrors the plan flow (see subscription.controller
 * activateSubscription): there is no payment gateway in the product —
 * plans are paid offline and activated via payment-proof approval or
 * Backoffice assignment. Add-on purchases therefore behave the same:
 *   - when direct subscription mutations are enabled for the
 *     deployment (non-production + ALLOW_DIRECT_SUBSCRIPTION_MUTATIONS)
 *     the add-on activates immediately;
 *   - otherwise the purchase is recorded as PENDING and the Backoffice
 *     activates it once payment is confirmed (backoffice-addon
 *     controller), exactly like an approved payment proof.
 *
 * Billing duration (Muhammad, 2026-10-24): prices are monthly only,
 * no discounts — but a purchase may prepay whole months; the charge is
 * monthly price × quantity × charged months and the paid-through date
 * extends by that many cycles, capped at the plan's paid-through
 * horizon (see computeAddonPeriod in the limits service).
 */

import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AuthRequest } from '../middleware/auth.middleware';
import {
  ADDON_CATALOGUE,
  AddonType,
  checkAddonPurchasable,
  computeAddonPeriod,
  getEffectiveLimits,
  isAddonType,
  normalizeMonths,
} from '../services/addon-limits.service';

const allowDirectAddonActivation = (): boolean =>
  process.env.NODE_ENV !== 'production' && process.env.ALLOW_DIRECT_SUBSCRIPTION_MUTATIONS === 'true';

export const requireBusinessOwner = async (
  prisma: any,
  userId: string,
  businessId: string
): Promise<boolean> => {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { createdBy: true },
  });
  if (!business) return false;
  if (String(business.createdBy || '') === String(userId)) return true;

  const membership = await prisma.membership.findFirst({
    where: { userId, businessId, status: 'ACTIVE' },
    include: { role: { select: { name: true } } },
  });
  return String(membership?.role?.name || '').toUpperCase() === 'OWNER';
};

const resolveBusinessId = (req: AuthRequest): string | null => {
  const id =
    (req as any).business_id ||
    req.body?.businessId ||
    (req.query?.businessId as string) ||
    req.header('x-business-id');
  return id ? String(id) : null;
};

const serializeAddon = (row: any) => ({
  id: row.id,
  businessId: row.businessId,
  type: row.type,
  name: ADDON_CATALOGUE[row.type as AddonType]?.name || row.type,
  quantity: row.quantity,
  status: row.status,
  priceMonthly: ADDON_CATALOGUE[row.type as AddonType]?.priceMonthly ?? null,
  pricingPending: ADDON_CATALOGUE[row.type as AddonType]?.pricingPending ?? false,
  startedAt: row.startedAt,
  periodEnd: row.periodEnd,
  cancelledAt: row.cancelledAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/** GET /api/subscription/addons/catalogue — the 8 add-ons with prices (GIFT_CARD_KIOSK_PACK is listed with pricingPending until Muhammad prices it; ONLINE_STORE_PACK is item 5's, same treatment). */
export const getAddonCatalogue = async (_req: AuthRequest, res: Response) => {
  return res.json({ success: true, data: Object.values(ADDON_CATALOGUE) });
};

/** GET /api/subscription/addons?businessId= — the business's add-ons + effective limits. */
export const getBusinessAddons = async (req: AuthRequest, res: Response) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) {
      return res.status(400).json({ success: false, message: 'businessId is required' });
    }
    const prisma = await getPrisma();
    if (!req.user?.id || !(await requireBusinessOwner(prisma, String(req.user.id), businessId))) {
      return res.status(403).json({ success: false, message: 'Only the business owner can view add-ons.' });
    }
    const rows = await (prisma as any).subscriptionAddon.findMany({
      where: { businessId },
      orderBy: { createdAt: 'asc' },
    });
    const limits = await getEffectiveLimits(prisma as any, businessId);
    return res.json({
      success: true,
      data: {
        businessId,
        planId: limits.planId,
        planName: limits.planName,
        isTrial: limits.isTrial,
        limits: {
          maxBranches: limits.maxBranches,
          maxStaffSeats: limits.maxStaffSeats,
          staffAllowed: limits.staffAllowed,
          financeAllowed: limits.financeAllowed,
          advancedReportsAllowed: limits.advancedReportsAllowed,
          multiBranchReportsAllowed: limits.multiBranchReportsAllowed,
          whatsappPack: limits.whatsappPack,
          giftCardKioskAllowed: limits.giftCardKioskAllowed,
          voiceTokenQuota: limits.voiceTokenQuota,
        },
        monthlyAddonSpend: limits.monthlyAddonSpend,
        addons: rows.map(serializeAddon),
      },
    });
  } catch (error: any) {
    console.error('getBusinessAddons error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * Shared purchase/activate core (tenant + Backoffice). `activate`
 * decides the resulting status: tenant purchases are ACTIVE only when
 * direct mutations are enabled (else PENDING); Backoffice assignments
 * are always ACTIVE (admin is the payment authority).
 */
export async function applyAddonPurchase(
  prisma: any,
  params: {
    businessId: string;
    type: AddonType;
    quantity?: number;
    months?: number;
    activate: boolean;
    enforcePurchasable: boolean;
  }
): Promise<
  | { ok: true; addon: any; upfrontAmount: number; chargedMonths: number; periodEnd: Date }
  | { ok: false; statusCode: number; code: string; message: string }
> {
  const { businessId, type } = params;
  const entry = ADDON_CATALOGUE[type];
  const quantity = entry.stackable
    ? Math.min(1000, Math.max(1, Math.floor(Number(params.quantity) || 1)))
    : 1;
  const months = normalizeMonths(params.months ?? 1);
  if (!months) {
    return { ok: false, statusCode: 400, code: 'ADDON_INVALID_MONTHS', message: 'Months must be a whole number between 1 and 36.' };
  }

  const sub = await prisma.businessSubscription.findUnique({
    where: { businessId },
    select: { planId: true, status: true, currentPeriodEnd: true },
  });
  if (!sub) {
    return { ok: false, statusCode: 404, code: 'ADDON_NO_SUBSCRIPTION', message: 'No subscription found for this business.' };
  }

  if (params.enforcePurchasable) {
    const limits = await getEffectiveLimits(prisma, businessId);
    const check = checkAddonPurchasable(limits, type);
    if (!check.ok) return check;
  }

  const now = new Date();
  const { periodEnd, chargedMonths } = computeAddonPeriod(
    now,
    months,
    sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null
  );
  const upfrontAmount = entry.priceMonthly * quantity * chargedMonths;
  const status = params.activate ? 'ACTIVE' : 'PENDING';

  const existing = await prisma.subscriptionAddon.findUnique({
    where: { unique_business_addon_type: { businessId, type } },
  });
  let addon;
  if (existing) {
    addon = await prisma.subscriptionAddon.update({
      where: { id: existing.id },
      data: { quantity, status, periodEnd, cancelledAt: null },
    });
  } else {
    addon = await prisma.subscriptionAddon.create({
      data: { businessId, type, quantity, status, startedAt: now, periodEnd },
    });
  }
  return { ok: true, addon, upfrontAmount, chargedMonths, periodEnd };
}

/** POST /api/subscription/addons — owner buys / adjusts an add-on. */
export const purchaseAddon = async (req: AuthRequest, res: Response) => {
  try {
    const businessId = resolveBusinessId(req);
    const type = req.body?.type;
    if (!businessId) {
      return res.status(400).json({ success: false, message: 'businessId is required' });
    }
    if (!isAddonType(type)) {
      return res.status(400).json({ success: false, code: 'ADDON_UNKNOWN_TYPE', message: 'Unknown add-on type.' });
    }
    const prisma = await getPrisma();
    if (!req.user?.id || !(await requireBusinessOwner(prisma, String(req.user.id), businessId))) {
      return res.status(403).json({ success: false, message: 'Only the business owner can buy add-ons.' });
    }
    const result = await applyAddonPurchase(prisma as any, {
      businessId,
      type,
      quantity: req.body?.quantity,
      months: req.body?.months,
      activate: allowDirectAddonActivation(),
      enforcePurchasable: true,
    });
    if (!result.ok) {
      return res.status(result.statusCode).json({ success: false, code: result.code, message: result.message });
    }
    return res.json({
      success: true,
      message:
        result.addon.status === 'ACTIVE'
          ? `${ADDON_CATALOGUE[type].name} is active.`
          : `${ADDON_CATALOGUE[type].name} requested — it activates once payment is confirmed.`,
      data: {
        addon: serializeAddon(result.addon),
        upfrontAmount: result.upfrontAmount,
        chargedMonths: result.chargedMonths,
        periodEnd: result.periodEnd,
      },
    });
  } catch (error: any) {
    console.error('purchaseAddon error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * POST /api/subscription/addons/cancel — cancel stays effective until
 * the paid-through date (status CANCEL_PENDING); a PENDING request is
 * withdrawn immediately. Data is never touched.
 */
export const cancelAddon = async (req: AuthRequest, res: Response) => {
  try {
    const businessId = resolveBusinessId(req);
    const type = req.body?.type;
    if (!businessId) {
      return res.status(400).json({ success: false, message: 'businessId is required' });
    }
    if (!isAddonType(type)) {
      return res.status(400).json({ success: false, code: 'ADDON_UNKNOWN_TYPE', message: 'Unknown add-on type.' });
    }
    const prisma = await getPrisma();
    if (!req.user?.id || !(await requireBusinessOwner(prisma, String(req.user.id), businessId))) {
      return res.status(403).json({ success: false, message: 'Only the business owner can cancel add-ons.' });
    }
    const existing = await (prisma as any).subscriptionAddon.findUnique({
      where: { unique_business_addon_type: { businessId, type } },
    });
    if (!existing || String(existing.status).toUpperCase() === 'CANCELLED') {
      return res.status(404).json({ success: false, code: 'ADDON_NOT_FOUND', message: 'This add-on is not active for the business.' });
    }
    const now = new Date();
    const nextStatus = String(existing.status).toUpperCase() === 'PENDING' ? 'CANCELLED' : 'CANCEL_PENDING';
    const addon = await (prisma as any).subscriptionAddon.update({
      where: { id: existing.id },
      data: { status: nextStatus, cancelledAt: now },
    });
    return res.json({
      success: true,
      message:
        nextStatus === 'CANCELLED'
          ? `${ADDON_CATALOGUE[type].name} request withdrawn.`
          : `${ADDON_CATALOGUE[type].name} will stay active until ${addon.periodEnd ? new Date(addon.periodEnd).toLocaleDateString() : 'the end of the paid period'}, then switch off. Nothing is deleted.`,
      data: { addon: serializeAddon(addon) },
    });
  } catch (error: any) {
    console.error('cancelAddon error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
