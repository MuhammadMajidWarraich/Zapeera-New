// ─── Receipt settings (POS update) ──────────────────────────────────────
// Endpoints for the per-business receipt template + content settings.
// Conventions mirror the FBR config controller:
//   · Tenancy: every query is scoped to the caller's business (A-02).
//   · WRITES are OWNER/MANAGER/ADMIN only (in-controller gate);
//     reads are open to every sales role (the POS needs the settings
//     to print, cashiers included).
//   · `template` must be 'thermal' or 'a4'; anything else is a 400.
//     A stale/unknown value stored previously falls back to 'a4' on
//     read (defensive — see the service's normalizeTemplate).
//   · The fixed footer line ("This invoice is generated using Zapeera
//     …") is NOT a setting — it is hard-coded into both print
//     templates and can never be edited or hidden.

import { Response } from 'express';
import Joi from 'joi';
import { getPrisma } from '../utils/db.util';
import { AuthRequest, getUserRole } from '../middleware/auth.middleware';
import {
  getReceiptSettings,
  serializeReceiptSettings,
  RECEIPT_TEMPLATES
} from '../services/receipt-settings.service';

const resolveReceiptCompanyId = (req: AuthRequest): string =>
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  req.membership?.business_id ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const requireManagerRole = (req: AuthRequest, res: Response): boolean => {
  const role = getUserRole(req);
  if (!['OWNER', 'MANAGER', 'ADMIN'].includes(role)) {
    res.status(403).json({
      success: false,
      message: 'Only the owner or a manager can manage receipt settings'
    });
    return false;
  }
  return true;
};

export const getReceiptSettingsHandler = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveReceiptCompanyId(req);
    const settings = await getReceiptSettings(prisma, companyId);
    return res.json({ success: true, data: settings });
  } catch (error: any) {
    console.error('Get receipt settings error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to load receipt settings' });
  }
};

const updateReceiptSettingsSchema = Joi.object({
  template: Joi.string()
    .valid(...RECEIPT_TEMPLATES)
    .optional(),
  displayName: Joi.string().trim().max(200).allow('', null).optional(),
  tagline: Joi.string().trim().max(300).allow('', null).optional(),
  address: Joi.string().trim().max(500).allow('', null).optional(),
  phone: Joi.string().trim().max(64).allow('', null).optional(),
  email: Joi.string().trim().max(200).allow('', null).optional(),
  website: Joi.string().trim().max(200).allow('', null).optional(),
  footerMessage: Joi.string().trim().max(500).allow('', null).optional(),
  showCashier: Joi.boolean().optional(),
  showCustomer: Joi.boolean().optional(),
  showPrescription: Joi.boolean().optional(),
  showTaxBreakdown: Joi.boolean().optional(),
  showFbr: Joi.boolean().optional(),
  showPayment: Joi.boolean().optional(),
  showItemDetails: Joi.boolean().optional()
}).min(1);

export const updateReceiptSettingsHandler = async (req: AuthRequest, res: Response) => {
  try {
    if (!requireManagerRole(req, res)) return;
    const { error, value } = updateReceiptSettingsSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }
    const prisma = await getPrisma();
    const companyId = resolveReceiptCompanyId(req);
    const existing = await getReceiptSettings(prisma, companyId);

    // Empty-string overrides clear back to null (fall back to the
    // business defaults on the printed receipt).
    const override = (key: keyof typeof existing) =>
      value[key] !== undefined ? value[key] || null : existing[key] ?? null;
    const flag = (key: keyof typeof existing) => (value[key] !== undefined ? value[key] : existing[key] ?? true);

    const merged = {
      template: value.template ?? existing.template,
      displayName: override('displayName'),
      tagline: override('tagline'),
      address: override('address'),
      phone: override('phone'),
      email: override('email'),
      website: override('website'),
      footerMessage: override('footerMessage'),
      showCashier: flag('showCashier'),
      showCustomer: flag('showCustomer'),
      showPrescription: flag('showPrescription'),
      showTaxBreakdown: flag('showTaxBreakdown'),
      showFbr: flag('showFbr'),
      showPayment: flag('showPayment'),
      showItemDetails: flag('showItemDetails')
    };

    const saved = await (prisma as any).receiptSettings.upsert({
      where: { companyId },
      create: { companyId, ...merged, updatedBy: req.user?.id || null },
      update: { ...merged, updatedBy: req.user?.id || null }
    });
    return res.json({
      success: true,
      data: serializeReceiptSettings(saved, companyId),
      message: 'Receipt settings saved'
    });
  } catch (error: any) {
    console.error('Update receipt settings error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to save receipt settings' });
  }
};
