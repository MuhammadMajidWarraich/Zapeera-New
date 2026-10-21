import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import Joi from 'joi';
import { AuthRequest, getUserRole } from '../middleware/auth.middleware';

// ─── Tax classes (Wave B5) ──────────────────────────────────────────────
// Management CRUD for the rate groups the sale engine (tax.util.ts)
// applies at checkout. Conventions mirror the promotion controller:
//   · Tenancy: every query is scoped to the caller's business (A-02);
//     an id from another tenant reads as "not found".
//   · Writes are OWNER/MANAGER/ADMIN only (in-controller gate); every
//     sales role can read the list (the POS/product forms need it).
//   · DELETE is soft (isActive = false): past sales snapshot the
//     class name/rate onto their SaleTaxLine rows, and products that
//     still point at a retired class fall back to the company's
//     default handling at sale time.
//   · Exactly one class per company is the default: setting a class
//     as default clears the flag on its siblings in the same write.
//     Retiring (DELETE) the current default is BLOCKED while other
//     active classes exist — set another class as default first — so
//     a company never silently loses its chosen default; retiring the
//     ONLY class is allowed and returns the company to the plain
//     defaultTax-setting behaviour.
//
// Module gating: the router guards with checkModule('sales') and the
// route-policy registry maps /api/tax-classes to the sales.invoices
// resource key — no new module/submodule key is introduced.

const resolveTaxClassCompanyId = (req: AuthRequest): string =>
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  req.membership?.business_id ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const taxClassScopeWhere = (req: AuthRequest, id: string): any => ({
  id,
  companyId: resolveTaxClassCompanyId(req)
});

const requireManagerRole = (req: AuthRequest, res: Response): boolean => {
  const role = getUserRole(req);
  if (!['OWNER', 'MANAGER', 'ADMIN'].includes(role)) {
    res.status(403).json({
      success: false,
      message: 'Only the owner or a manager can manage tax classes'
    });
    return false;
  }
  return true;
};

const createTaxClassSchema = Joi.object({
  name: Joi.string().trim().min(1).max(120).required(),
  rate: Joi.number().min(0).max(100).required(),
  isDefault: Joi.boolean().optional(),
  isActive: Joi.boolean().optional()
});

const updateTaxClassSchema = Joi.object({
  name: Joi.string().trim().min(1).max(120).optional(),
  rate: Joi.number().min(0).max(100).optional(),
  isDefault: Joi.boolean().optional(),
  isActive: Joi.boolean().optional()
}).min(1);

/** Name uniqueness is per company and includes retired classes. */
const nameClash = async (prisma: any, companyId: string, name: string, exceptId?: string) => {
  const clash = await prisma.taxClass.findFirst({
    where: {
      companyId,
      name,
      ...(exceptId ? { id: { not: exceptId } } : {})
    },
    select: { id: true }
  });
  return Boolean(clash);
};

// Create a tax class
export const createTaxClass = async (req: AuthRequest, res: Response) => {
  try {
    if (!requireManagerRole(req, res)) return;
    const prisma = await getPrisma();
    const { error, value } = createTaxClassSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const companyId = resolveTaxClassCompanyId(req);
    if (await nameClash(prisma, companyId, value.name)) {
      return res.status(409).json({
        success: false,
        message: `A tax class named "${value.name}" already exists in this business`,
        code: 'DUPLICATE_TAX_CLASS_NAME'
      });
    }

    const taxClass = await prisma.$transaction(async (tx: any) => {
      if (value.isDefault) {
        await tx.taxClass.updateMany({
          where: { companyId, isDefault: true },
          data: { isDefault: false }
        });
      }
      return tx.taxClass.create({
        data: {
          companyId,
          name: value.name,
          rate: value.rate,
          isDefault: value.isDefault === true,
          isActive: value.isActive !== undefined ? value.isActive : true
        }
      });
    });

    return res.status(201).json({
      success: true,
      data: taxClass,
      message: 'Tax class created successfully'
    });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'A tax class with this name already exists in this business',
        code: 'DUPLICATE_TAX_CLASS_NAME'
      });
    }
    console.error('Create tax class error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// List tax classes for the caller's business
export const getTaxClasses = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { page = 1, limit = 20, isActive, search } = req.query;

    const where: any = { companyId: resolveTaxClassCompanyId(req) };
    if (isActive !== undefined) where.isActive = String(isActive) === 'true';
    if (search) {
      where.name = { contains: String(search) };
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [taxClasses, total] = await Promise.all([
      prisma.taxClass.findMany({
        where,
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        skip,
        take: Number(limit)
      }),
      prisma.taxClass.count({ where })
    ]);

    return res.json({
      success: true,
      data: taxClasses,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Get tax classes error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get one tax class (tenancy-scoped)
export const getTaxClassById = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const taxClass = await prisma.taxClass.findFirst({
      where: taxClassScopeWhere(req, req.params.id)
    });
    if (!taxClass) {
      return res.status(404).json({ success: false, message: 'Tax class not found' });
    }
    return res.json({ success: true, data: taxClass });
  } catch (error) {
    console.error('Get tax class error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Update a tax class. Rate/name edits apply to FUTURE sales only —
// past sales keep the snapshots stored on their tax lines.
export const updateTaxClass = async (req: AuthRequest, res: Response) => {
  try {
    if (!requireManagerRole(req, res)) return;
    const prisma = await getPrisma();
    const { error, value } = updateTaxClassSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const companyId = resolveTaxClassCompanyId(req);
    const existing = await prisma.taxClass.findFirst({
      where: taxClassScopeWhere(req, req.params.id)
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Tax class not found' });
    }

    if (value.name !== undefined && value.name !== existing.name
      && await nameClash(prisma, companyId, value.name, existing.id)) {
      return res.status(409).json({
        success: false,
        message: `A tax class named "${value.name}" already exists in this business`,
        code: 'DUPLICATE_TAX_CLASS_NAME'
      });
    }

    const data: any = {};
    if (value.name !== undefined) data.name = value.name;
    if (value.rate !== undefined) data.rate = value.rate;
    if (value.isDefault !== undefined) data.isDefault = value.isDefault;
    if (value.isActive !== undefined) data.isActive = value.isActive;

    const taxClass = await prisma.$transaction(async (tx: any) => {
      if (data.isDefault === true) {
        await tx.taxClass.updateMany({
          where: { companyId, isDefault: true, id: { not: existing.id } },
          data: { isDefault: false }
        });
      }
      return tx.taxClass.update({
        where: { id: existing.id },
        data
      });
    });

    return res.json({
      success: true,
      data: taxClass,
      message: 'Tax class updated successfully'
    });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'A tax class with this name already exists in this business',
        code: 'DUPLICATE_TAX_CLASS_NAME'
      });
    }
    console.error('Update tax class error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Delete = retire (soft). The company's DEFAULT class cannot be
// retired while other active classes exist — another class must be
// made default first, so the fallback rate a business chose is never
// lost silently. Retiring the only class is allowed: the company
// returns to the defaultTax-setting behaviour.
export const deleteTaxClass = async (req: AuthRequest, res: Response) => {
  try {
    if (!requireManagerRole(req, res)) return;
    const prisma = await getPrisma();
    const existing = await prisma.taxClass.findFirst({
      where: taxClassScopeWhere(req, req.params.id)
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Tax class not found' });
    }

    if (existing.isDefault && existing.isActive) {
      const otherActive = await prisma.taxClass.count({
        where: {
          companyId: existing.companyId,
          isActive: true,
          id: { not: existing.id }
        }
      });
      if (otherActive > 0) {
        return res.status(400).json({
          success: false,
          message: `"${existing.name}" is the default tax class. Set another class as default before retiring it.`,
          code: 'TAX_CLASS_IS_DEFAULT'
        });
      }
    }

    const taxClass = await prisma.taxClass.update({
      where: { id: existing.id },
      data: { isActive: false, isDefault: false }
    });
    return res.json({
      success: true,
      data: taxClass,
      message: 'Tax class retired'
    });
  } catch (error) {
    console.error('Delete tax class error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
