import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import Joi from 'joi';
import { AuthRequest, getUserRole } from '../middleware/auth.middleware';
import {
  PROVINCIAL_AUTHORITIES,
  PROVINCIAL_AUTHORITY_NAMES,
  authorityForProvince,
  isProvincialAuthority,
  ProvincialAuthority
} from '../utils/provincial-tax.util';

// ─── Provincial tax config (Gap program item 1) ────────────────────────
// Per-business (and per-branch) PRA / SRB / KPRA / BRA configuration:
// which provincial authority applies, its registration number and its
// rate. Conventions mirror the tax-class controller:
//   · Tenancy: every query is scoped to the caller's business (A-02);
//     an id from another tenant reads as "not found".
//   · Writes are OWNER ONLY (the task's rule for tax settings —
//     stricter than tax classes, which allow OWNER/MANAGER/ADMIN).
//     Reads are OWNER/MANAGER/ADMIN (the Settings screen + the
//     summary report); the POS never needs the config — the server
//     resolves it at sale time and snapshots the result onto the
//     sale's provincial tax lines.
//   · DELETE is a retire (enabled = false), like tax classes: past
//     sales snapshot authority/rate onto their SaleProvincialTaxLine
//     rows, and retiring a config never rewrites that history.
//   · At most one ENABLED config per (company, branchId) scope:
//     enabling a config disables its enabled siblings in the same
//     scope in the same write, so sale-time resolution (branch row,
//     else business row) is always unambiguous.
//   · No plan/add-on gate: tax classes and FBR carry none, and the
//     task forbids silently inventing a paywall. Provincial tax is
//     available on every plan that has the sales module, exactly like
//     the tax classes it sits beside.
//
// Module gating: the router guards with checkModule('sales') and the
// route-policy registry maps /api/provincial-tax to the sales.invoices
// resource key — no new module/submodule key is introduced.

const resolveCompanyId = (req: AuthRequest): string =>
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  req.membership?.business_id ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const scopeWhere = (req: AuthRequest, id: string): any => ({
  id,
  companyId: resolveCompanyId(req)
});

const requireOwner = (req: AuthRequest, res: Response): boolean => {
  if (getUserRole(req) !== 'OWNER') {
    res.status(403).json({
      success: false,
      message: 'Only the business owner can manage provincial tax settings'
    });
    return false;
  }
  return true;
};

const requireManagerRole = (req: AuthRequest, res: Response): boolean => {
  const role = getUserRole(req);
  if (!['OWNER', 'MANAGER', 'ADMIN'].includes(role)) {
    res.status(403).json({
      success: false,
      message: 'Only the owner or a manager can view provincial tax settings'
    });
    return false;
  }
  return true;
};

const configSchema = Joi.object({
  authority: Joi.string().valid(...PROVINCIAL_AUTHORITIES).required(),
  registrationNumber: Joi.string().trim().max(64).allow('', null).optional(),
  rate: Joi.number().min(0).max(100).required(),
  branchId: Joi.string().allow(null).optional(),
  enabled: Joi.boolean().optional()
});

const updateConfigSchema = Joi.object({
  authority: Joi.string().valid(...PROVINCIAL_AUTHORITIES).optional(),
  registrationNumber: Joi.string().trim().max(64).allow('', null).optional(),
  rate: Joi.number().min(0).max(100).optional(),
  branchId: Joi.string().allow(null).optional(),
  enabled: Joi.boolean().optional()
}).min(1);

/** The branch must exist in this business when a branch row is named. */
const assertBranchInCompany = async (prisma: any, companyId: string, branchId: string | null | undefined) => {
  if (!branchId) return true;
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, companyId },
    select: { id: true }
  });
  return Boolean(branch);
};

/** Disable every other ENABLED config in the same (company, branch) scope. */
const disableScopeSiblings = async (tx: any, companyId: string, branchId: string | null, exceptId?: string) =>
  tx.provincialTaxConfig.updateMany({
    where: {
      companyId,
      branchId,
      enabled: true,
      ...(exceptId ? { id: { not: exceptId } } : {})
    },
    data: { enabled: false }
  });

const serializeConfig = (row: any) => ({
  ...row,
  authorityName: PROVINCIAL_AUTHORITY_NAMES[row.authority as ProvincialAuthority] ?? row.authority,
  province: row.authority === 'PRA' ? 'Punjab'
    : row.authority === 'SRB' ? 'Sindh'
    : row.authority === 'KPRA' ? 'Khyber Pakhtunkhwa'
    : row.authority === 'BRA' ? 'Balochistan' : null
});

// Create a provincial tax config (business-level, or per-branch)
export const createProvincialTaxConfig = async (req: AuthRequest, res: Response) => {
  try {
    if (!requireOwner(req, res)) return;
    const prisma = await getPrisma();
    const { error, value } = configSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }
    const companyId = resolveCompanyId(req);
    const branchId = value.branchId || null;
    if (!(await assertBranchInCompany(prisma, companyId, branchId))) {
      return res.status(400).json({ success: false, message: 'Branch not found in this business' });
    }
    const enabled = value.enabled !== undefined ? value.enabled : true;
    const config = await prisma.$transaction(async (tx: any) => {
      if (enabled) await disableScopeSiblings(tx, companyId, branchId);
      return tx.provincialTaxConfig.create({
        data: {
          companyId,
          branchId,
          authority: value.authority,
          registrationNumber: value.registrationNumber?.trim() || null,
          rate: value.rate,
          enabled,
          createdBy: req.user?.id || null
        }
      });
    });
    return res.status(201).json({
      success: true,
      data: serializeConfig(config),
      message: 'Provincial tax configured successfully'
    });
  } catch (error: any) {
    console.error('Create provincial tax config error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// List configs for the caller's business (business row + branch rows)
export const getProvincialTaxConfigs = async (req: AuthRequest, res: Response) => {
  try {
    if (!requireManagerRole(req, res)) return;
    const prisma = await getPrisma();
    const { branchId } = req.query;
    const where: any = { companyId: resolveCompanyId(req) };
    if (branchId !== undefined) where.branchId = String(branchId) === 'null' ? null : String(branchId);
    const configs = await prisma.provincialTaxConfig.findMany({
      where,
      include: { branch: { select: { id: true, name: true } } },
      orderBy: [{ branchId: 'asc' }, { authority: 'asc' }]
    });
    return res.json({
      success: true,
      data: configs.map(serializeConfig),
      // The province → authority map, so the Settings screen can
      // suggest the right authority instead of the owner guessing.
      authorities: PROVINCIAL_AUTHORITIES.map(a => ({
        authority: a,
        name: PROVINCIAL_AUTHORITY_NAMES[a],
        province: a === 'PRA' ? 'Punjab' : a === 'SRB' ? 'Sindh' : a === 'KPRA' ? 'Khyber Pakhtunkhwa' : 'Balochistan'
      }))
    });
  } catch (error) {
    console.error('Get provincial tax configs error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get one config (tenancy-scoped)
export const getProvincialTaxConfigById = async (req: AuthRequest, res: Response) => {
  try {
    if (!requireManagerRole(req, res)) return;
    const prisma = await getPrisma();
    const config = await prisma.provincialTaxConfig.findFirst({
      where: scopeWhere(req, req.params.id),
      include: { branch: { select: { id: true, name: true } } }
    });
    if (!config) {
      return res.status(404).json({ success: false, message: 'Provincial tax configuration not found' });
    }
    return res.json({ success: true, data: serializeConfig(config) });
  } catch (error) {
    console.error('Get provincial tax config error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Update a config. Rate/authority edits apply to FUTURE sales only —
// past sales keep the snapshots stored on their provincial tax lines.
export const updateProvincialTaxConfig = async (req: AuthRequest, res: Response) => {
  try {
    if (!requireOwner(req, res)) return;
    const prisma = await getPrisma();
    const { error, value } = updateConfigSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }
    const companyId = resolveCompanyId(req);
    const existing = await prisma.provincialTaxConfig.findFirst({
      where: scopeWhere(req, req.params.id)
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Provincial tax configuration not found' });
    }
    const nextBranchId = value.branchId !== undefined ? (value.branchId || null) : existing.branchId;
    if (!(await assertBranchInCompany(prisma, companyId, nextBranchId))) {
      return res.status(400).json({ success: false, message: 'Branch not found in this business' });
    }
    const nextEnabled = value.enabled !== undefined ? value.enabled : existing.enabled;
    const data: any = {};
    if (value.authority !== undefined) data.authority = value.authority;
    if (value.registrationNumber !== undefined) data.registrationNumber = value.registrationNumber?.trim() || null;
    if (value.rate !== undefined) data.rate = value.rate;
    if (value.branchId !== undefined) data.branchId = value.branchId || null;
    if (value.enabled !== undefined) data.enabled = value.enabled;
    const config = await prisma.$transaction(async (tx: any) => {
      if (nextEnabled) await disableScopeSiblings(tx, companyId, nextBranchId, existing.id);
      return tx.provincialTaxConfig.update({ where: { id: existing.id }, data });
    });
    return res.json({
      success: true,
      data: serializeConfig(config),
      message: 'Provincial tax configuration updated successfully'
    });
  } catch (error) {
    console.error('Update provincial tax config error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Delete = retire (enabled = false). Past sales keep their snapshots.
export const deleteProvincialTaxConfig = async (req: AuthRequest, res: Response) => {
  try {
    if (!requireOwner(req, res)) return;
    const prisma = await getPrisma();
    const existing = await prisma.provincialTaxConfig.findFirst({
      where: scopeWhere(req, req.params.id)
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Provincial tax configuration not found' });
    }
    const config = await prisma.provincialTaxConfig.update({
      where: { id: existing.id },
      data: { enabled: false }
    });
    return res.json({
      success: true,
      data: serializeConfig(config),
      message: 'Provincial tax configuration retired'
    });
  } catch (error) {
    console.error('Delete provincial tax config error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ─── Per-authority tax summary report ──────────────────────────────────
// Totals of the provincial tax actually charged, grouped by authority
// (PRA / SRB / KPRA / BRA), over a date range, optionally one branch.
// Reads the SNAPSHOT rows on sales (SaleProvincialTaxLine), so a
// config edited mid-period never rewrites the period's figures.
// FBR tax is deliberately NOT in this report: it has its own advanced
// tax report, and the two authorities' money must never be mixed.
export const getProvincialTaxSummary = async (req: AuthRequest, res: Response) => {
  try {
    if (!requireManagerRole(req, res)) return;
    const prisma = await getPrisma();
    const companyId = resolveCompanyId(req);
    const { from, to, branchId } = req.query;
    const saleWhere: any = { companyId };
    if (branchId) saleWhere.branchId = String(branchId);
    if (from || to) {
      saleWhere.createdAt = {};
      if (from) saleWhere.createdAt.gte = new Date(String(from));
      if (to) saleWhere.createdAt.lte = new Date(String(to));
    }
    const lines = await prisma.saleProvincialTaxLine.findMany({
      where: { sale: saleWhere },
      select: {
        saleId: true,
        authority: true,
        authorityName: true,
        registrationNumber: true,
        rate: true,
        taxableAmount: true,
        taxAmount: true
      }
    });
    const byAuthority = new Map<string, {
      authority: string;
      authorityName: string;
      registrationNumber: string | null;
      rates: number[];
      saleIds: Set<string>;
      taxableAmount: number;
      taxAmount: number;
    }>();
    for (const line of lines) {
      const key = line.authority;
      let entry = byAuthority.get(key);
      if (!entry) {
        entry = {
          authority: line.authority,
          authorityName: line.authorityName,
          registrationNumber: line.registrationNumber ?? null,
          rates: [],
          saleIds: new Set(),
          taxableAmount: 0,
          taxAmount: 0
        };
        byAuthority.set(key, entry);
      }
      entry.saleIds.add(line.saleId);
      if (!entry.rates.includes(Number(line.rate))) entry.rates.push(Number(line.rate));
      entry.taxableAmount += Number(line.taxableAmount) || 0;
      entry.taxAmount += Number(line.taxAmount) || 0;
    }
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const byAuthorityOut = [...byAuthority.values()]
      .map(e => ({
        authority: e.authority,
        authorityName: e.authorityName,
        registrationNumber: e.registrationNumber,
        rates: e.rates,
        salesCount: e.saleIds.size,
        taxableAmount: round2(e.taxableAmount),
        taxAmount: round2(e.taxAmount)
      }))
      .sort((a, b) => a.authority.localeCompare(b.authority));
    return res.json({
      success: true,
      data: {
        from: from ? String(from) : null,
        to: to ? String(to) : null,
        branchId: branchId ? String(branchId) : null,
        byAuthority: byAuthorityOut,
        totals: {
          salesCount: new Set(lines.map(l => l.saleId)).size,
          taxableAmount: round2(byAuthorityOut.reduce((s, e) => s + e.taxableAmount, 0)),
          taxAmount: round2(byAuthorityOut.reduce((s, e) => s + e.taxAmount, 0))
        }
      }
    });
  } catch (error) {
    console.error('Provincial tax summary error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Suggest the authority for a free-text province (Settings helper).
export const suggestProvincialAuthority = async (req: AuthRequest, res: Response) => {
  const province = typeof req.query.province === 'string' ? req.query.province : '';
  const authority = authorityForProvince(province);
  return res.json({
    success: true,
    data: {
      province,
      authority,
      authorityName: authority ? PROVINCIAL_AUTHORITY_NAMES[authority] : null
    }
  });
};

export { isProvincialAuthority };
