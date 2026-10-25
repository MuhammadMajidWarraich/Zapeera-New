/**
 * Subscription Add-ons — Backoffice (platform admin) management.
 *
 * Mirrors the plan-assignment pattern (backoffice-subscriptions
 * assignPlanToBusiness): the admin is the payment authority, so an
 * assignment activates immediately (status ACTIVE), a tenant's
 * PENDING purchase can be activated from here, and removal cancels
 * immediately (status CANCELLED — rows are never deleted).
 */

import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AdminAuthRequest } from '../middleware/admin-auth.middleware';
import { ADDON_CATALOGUE, getEffectiveLimits, isAddonType } from '../services/addon-limits.service';
import { applyAddonPurchase } from './addon.controller';

/** GET /api/backoffice/subscriptions/:businessId/addons */
export const listBusinessAddonsAdmin = async (req: AdminAuthRequest, res: Response) => {
  try {
    const businessId = String(req.params.businessId || '');
    if (!businessId) return res.status(400).json({ success: false, message: 'businessId is required' });
    const prisma = await getPrisma();
    const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true, name: true } });
    if (!business) return res.status(404).json({ success: false, message: 'Business not found' });
    const rows = await (prisma as any).subscriptionAddon.findMany({
      where: { businessId },
      orderBy: { createdAt: 'asc' },
    });
    const limits = await getEffectiveLimits(prisma as any, businessId);
    return res.json({
      success: true,
      data: {
        business,
        planId: limits.planId,
        planName: limits.planName,
        monthlyAddonSpend: limits.monthlyAddonSpend,
        limits: {
          maxBranches: limits.maxBranches,
          maxStaffSeats: limits.maxStaffSeats,
          staffAllowed: limits.staffAllowed,
          financeAllowed: limits.financeAllowed,
          advancedReportsAllowed: limits.advancedReportsAllowed,
          multiBranchReportsAllowed: limits.multiBranchReportsAllowed,
          whatsappPack: limits.whatsappPack,
          onlineStoreAllowed: limits.onlineStoreAllowed,
          // Prescription upload is its own pack (Wave C5 — gap item 5, split 2026-10-25)
          prescriptionUploadAllowed: limits.prescriptionUploadAllowed,
          voiceTokenQuota: limits.voiceTokenQuota,
        },
        addons: rows.map((r: any) => ({
          ...r,
          name: ADDON_CATALOGUE[r.type as keyof typeof ADDON_CATALOGUE]?.name || r.type,
          priceMonthly: ADDON_CATALOGUE[r.type as keyof typeof ADDON_CATALOGUE]?.priceMonthly ?? null,
        })),
      },
    });
  } catch (error: any) {
    console.error('listBusinessAddonsAdmin error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/** POST /api/backoffice/subscriptions/:businessId/addons — assign / activate / adjust. */
export const assignAddonToBusiness = async (req: AdminAuthRequest, res: Response) => {
  try {
    const businessId = String(req.params.businessId || '');
    const { type, quantity, months } = req.body || {};
    if (!businessId) return res.status(400).json({ success: false, message: 'businessId is required' });
    if (!isAddonType(type)) {
      return res.status(400).json({ success: false, code: 'ADDON_UNKNOWN_TYPE', message: 'Unknown add-on type.' });
    }
    const prisma = await getPrisma();
    const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true } });
    if (!business) return res.status(404).json({ success: false, message: 'Business not found' });

    const result = await applyAddonPurchase(prisma as any, {
      businessId,
      type,
      quantity,
      months,
      activate: true,
      enforcePurchasable: false, // admin is the payment authority (can also comp/grant)
    });
    if (!result.ok) {
      return res.status(result.statusCode).json({ success: false, code: result.code, message: result.message });
    }
    return res.json({
      success: true,
      message: `${ADDON_CATALOGUE[type].name} assigned.`,
      data: {
        addon: result.addon,
        upfrontAmount: result.upfrontAmount,
        chargedMonths: result.chargedMonths,
        periodEnd: result.periodEnd,
      },
    });
  } catch (error: any) {
    console.error('assignAddonToBusiness error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/** DELETE /api/backoffice/subscriptions/:businessId/addons/:type — immediate cancel. */
export const removeAddonFromBusiness = async (req: AdminAuthRequest, res: Response) => {
  try {
    const businessId = String(req.params.businessId || '');
    const type = String(req.params.type || '');
    if (!businessId) return res.status(400).json({ success: false, message: 'businessId is required' });
    if (!isAddonType(type)) {
      return res.status(400).json({ success: false, code: 'ADDON_UNKNOWN_TYPE', message: 'Unknown add-on type.' });
    }
    const prisma = await getPrisma();
    const existing = await (prisma as any).subscriptionAddon.findUnique({
      where: { unique_business_addon_type: { businessId, type } },
    });
    if (!existing) return res.status(404).json({ success: false, code: 'ADDON_NOT_FOUND', message: 'Add-on not found for this business.' });
    const addon = await (prisma as any).subscriptionAddon.update({
      where: { id: existing.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    return res.json({ success: true, message: `${ADDON_CATALOGUE[type].name} removed.`, data: { addon } });
  } catch (error: any) {
    console.error('removeAddonFromBusiness error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
