import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import Joi from 'joi';
import { AuthRequest } from '../middleware/auth.middleware';

// ─── Receipt templates (v1.0.22) ─────────────────────────────────────
// Per-business (branchId null) or per-branch receipt presentation.
// Resolution (GET /effective): the branch template wins, else the
// business default (isDefault), else the first business template,
// else null (the renderer falls back to built-in defaults).
//
// HARD RULE: the ownership footer line ("This invoice is generated
// using Zapeera A business management software") is NOT stored here
// and is NOT customizable — the receipt renderer appends it
// unconditionally on every template. footerText is an ADDITIONAL
// custom note shown above the fixed line. Nothing in this API can
// remove or edit the fixed line.

const resolveTemplateCompanyId = (req: AuthRequest): string =>
  req.membership?.business_id ||
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const templateSchema = Joi.object({
  branchId: Joi.string().allow(null, '').optional(),
  name: Joi.string().trim().max(64).default('Default'),
  headerText: Joi.string().trim().max(300).allow('', null).optional(),
  footerText: Joi.string().trim().max(300).allow('', null).optional(),
  logoUrl: Joi.string().trim().max(500).uri().allow('', null).optional(),
  showLogo: Joi.boolean().optional(),
  showCustomerBlock: Joi.boolean().optional(),
  showTaxLines: Joi.boolean().optional(),
  showLoyalty: Joi.boolean().optional(),
  showFooterNote: Joi.boolean().optional(),
  isDefault: Joi.boolean().optional(),
});

const templateInclude = {
  branch: { select: { id: true, name: true } },
} as const;

function cleanPayload(value: any) {
  const data: any = {};
  if (value.branchId !== undefined) data.branchId = value.branchId || null;
  if (value.name !== undefined) data.name = value.name;
  if (value.headerText !== undefined) data.headerText = value.headerText || null;
  if (value.footerText !== undefined) data.footerText = value.footerText || null;
  if (value.logoUrl !== undefined) data.logoUrl = value.logoUrl || null;
  for (const key of ['showLogo', 'showCustomerBlock', 'showTaxLines', 'showLoyalty', 'showFooterNote', 'isDefault']) {
    if (value[key] !== undefined) data[key] = value[key];
  }
  return data;
}

// Only one default per scope: setting a template default clears the
// flag on the other templates of the same scope (same transaction).
async function applySingleDefault(tx: any, companyId: string, branchId: string | null, keepId: string) {
  await tx.receiptTemplate.updateMany({
    where: { companyId, branchId, id: { not: keepId } },
    data: { isDefault: false },
  });
}

export const createReceiptTemplate = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = templateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: 'Validation error', errors: error.details.map((d) => d.message) });
    }
    const companyId = resolveTemplateCompanyId(req);
    const data = cleanPayload(value);
    if (data.branchId) {
      const branch = await prisma.branch.findFirst({ where: { id: data.branchId, companyId }, select: { id: true } });
      if (!branch) return res.status(400).json({ success: false, message: 'Branch was not found in this business' });
    }
    try {
      const created = await prisma.$transaction(async (tx: any) => {
        const row = await tx.receiptTemplate.create({ data: { ...data, companyId, createdBy: req.user?.id || null }, include: templateInclude });
        if (row.isDefault) await applySingleDefault(tx, companyId, row.branchId, row.id);
        return row;
      });
      return res.status(201).json({ success: true, data: created });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        return res.status(409).json({ success: false, message: 'A template with this name already exists for this scope', code: 'TEMPLATE_NAME_TAKEN' });
      }
      throw e;
    }
  } catch (error: any) {
    console.error('Create receipt template error:', error);
    return res.status(500).json({ success: false, message: error?.message || 'Internal server error' });
  }
};

export const getReceiptTemplates = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveTemplateCompanyId(req);
    const { branchId } = req.query as any;
    const where: any = { companyId };
    if (branchId) where.branchId = branchId;
    const rows = await prisma.receiptTemplate.findMany({ where, include: templateInclude, orderBy: [{ branchId: 'asc' }, { name: 'asc' }] });
    return res.json({ success: true, data: rows });
  } catch (error: any) {
    console.error('Get receipt templates error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getEffectiveReceiptTemplate = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveTemplateCompanyId(req);
    const { branchId } = req.query as any;
    let effective = null;
    if (branchId) {
      effective = await prisma.receiptTemplate.findFirst({
        where: { companyId, branchId },
        orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
        include: templateInclude,
      });
    }
    if (!effective) {
      effective = await prisma.receiptTemplate.findFirst({
        where: { companyId, branchId: null },
        orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
        include: templateInclude,
      });
    }
    return res.json({ success: true, data: effective });
  } catch (error: any) {
    console.error('Get effective receipt template error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const updateReceiptTemplate = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = templateSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: 'Validation error', errors: error.details.map((d) => d.message) });
    }
    const companyId = resolveTemplateCompanyId(req);
    const existing = await prisma.receiptTemplate.findFirst({ where: { id: req.params.id, companyId }, select: { id: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Receipt template not found' });
    const data = cleanPayload(value);
    if (data.branchId) {
      const branch = await prisma.branch.findFirst({ where: { id: data.branchId, companyId }, select: { id: true } });
      if (!branch) return res.status(400).json({ success: false, message: 'Branch was not found in this business' });
    }
    try {
      const updated = await prisma.$transaction(async (tx: any) => {
        const row = await tx.receiptTemplate.update({ where: { id: existing.id }, data, include: templateInclude });
        if (row.isDefault) await applySingleDefault(tx, companyId, row.branchId, row.id);
        return row;
      });
      return res.json({ success: true, data: updated });
    } catch (e: any) {
      if (e?.code === 'P2002') {
        return res.status(409).json({ success: false, message: 'A template with this name already exists for this scope', code: 'TEMPLATE_NAME_TAKEN' });
      }
      throw e;
    }
  } catch (error: any) {
    console.error('Update receipt template error:', error);
    return res.status(500).json({ success: false, message: error?.message || 'Internal server error' });
  }
};

export const deleteReceiptTemplate = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveTemplateCompanyId(req);
    const existing = await prisma.receiptTemplate.findFirst({ where: { id: req.params.id, companyId }, select: { id: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Receipt template not found' });
    await prisma.receiptTemplate.delete({ where: { id: existing.id } });
    return res.json({ success: true, message: 'Receipt template deleted' });
  } catch (error: any) {
    console.error('Delete receipt template error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
