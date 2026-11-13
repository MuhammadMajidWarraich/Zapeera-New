import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import Joi from 'joi';
import { AuthRequest } from '../middleware/auth.middleware';
import { resolveServiceChargeConfig } from '../utils/service-charge.util';

// ─── POS service-charge configuration (v1.0.22) ──────────────────────
// One config per scope: business-wide (branchId null) or one branch.
// The branch row wins over the business row (resolveServiceChargeConfig
// — the same rule the sale engine applies). PERCENT takes `percentage`
// of the post-discount bill; FIXED takes `fixedAmount`. applyByDefault
// auto-applies at the POS; the cashier can still toggle per sale.
// The per-sale result is stored on the Sale — this API only holds the
// rule. No plan/add-on gate.

const resolveConfigCompanyId = (req: AuthRequest): string =>
  req.membership?.business_id ||
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const serviceChargeSchema = Joi.object({
  branchId: Joi.string().allow(null, '').optional(),
  enabled: Joi.boolean().optional(),
  chargeType: Joi.string().valid('PERCENT', 'FIXED').optional(),
  percentage: Joi.number().min(0).max(100).allow(null).optional(),
  fixedAmount: Joi.number().min(0).allow(null).optional(),
  applyByDefault: Joi.boolean().optional(),
});

function cleanPayload(value: any) {
  const data: any = {};
  if (value.branchId !== undefined) data.branchId = value.branchId || null;
  if (value.enabled !== undefined) data.enabled = value.enabled;
  if (value.chargeType !== undefined) data.chargeType = value.chargeType;
  if (value.percentage !== undefined) data.percentage = value.percentage;
  if (value.fixedAmount !== undefined) data.fixedAmount = value.fixedAmount;
  if (value.applyByDefault !== undefined) data.applyByDefault = value.applyByDefault;
  return data;
}

export const getServiceChargeConfigs = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveConfigCompanyId(req);
    const rows = await prisma.serviceChargeConfig.findMany({
      where: { companyId },
      include: { branch: { select: { id: true, name: true } } },
      orderBy: [{ branchId: 'asc' }],
    });
    return res.json({ success: true, data: rows });
  } catch (error: any) {
    console.error('Get service charge configs error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const getEffectiveServiceChargeConfig = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveConfigCompanyId(req);
    const { branchId } = req.query as any;
    const rows = await prisma.serviceChargeConfig.findMany({ where: { companyId } });
    const effective = resolveServiceChargeConfig(rows as any[], branchId || null);
    return res.json({ success: true, data: effective });
  } catch (error: any) {
    console.error('Get effective service charge config error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Upsert by scope: one row per (companyId, branchId). A second save
// for the same scope updates the row instead of duplicating it.
export const upsertServiceChargeConfig = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = serviceChargeSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: 'Validation error', errors: error.details.map((d) => d.message) });
    }
    const companyId = resolveConfigCompanyId(req);
    const data = cleanPayload(value);
    if (data.branchId) {
      const branch = await prisma.branch.findFirst({ where: { id: data.branchId, companyId }, select: { id: true } });
      if (!branch) return res.status(400).json({ success: false, message: 'Branch was not found in this business' });
    }
    const branchId = data.branchId ?? null;
    const existing = await prisma.serviceChargeConfig.findFirst({ where: { companyId, branchId } });
    const row = existing
      ? await prisma.serviceChargeConfig.update({ where: { id: existing.id }, data, include: { branch: { select: { id: true, name: true } } } })
      : await prisma.serviceChargeConfig.create({ data: { ...data, companyId, branchId, createdBy: req.user?.id || null }, include: { branch: { select: { id: true, name: true } } } });
    return res.json({ success: true, data: row });
  } catch (error: any) {
    console.error('Upsert service charge config error:', error);
    return res.status(500).json({ success: false, message: error?.message || 'Internal server error' });
  }
};

export const deleteServiceChargeConfig = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveConfigCompanyId(req);
    const existing = await prisma.serviceChargeConfig.findFirst({ where: { id: req.params.id, companyId }, select: { id: true } });
    if (!existing) return res.status(404).json({ success: false, message: 'Service charge config not found' });
    await prisma.serviceChargeConfig.delete({ where: { id: existing.id } });
    return res.json({ success: true, message: 'Service charge config deleted' });
  } catch (error: any) {
    console.error('Delete service charge config error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
