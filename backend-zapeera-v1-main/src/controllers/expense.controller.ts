// CRITICAL: Import database initialization FIRST to ensure DATABASE_URL is set
import '../config/database.init';

import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { createSearchConditions } from '../utils/query-helper';
import { AuthRequest } from '../middleware/auth.middleware';
import Joi from 'joi';

// ─── Validation schemas ─────────────────────────────────────────────────────

export const EXPENSE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];
export const EXPENSE_PAYMENT_METHODS = ['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'MOBILE_WALLET', 'OTHER'];

const createExpenseSchema = Joi.object({
  title: Joi.string().trim().max(200).optional().allow(''),
  description: Joi.string().optional().allow('', null),
  vendor: Joi.string().optional().allow('', null),
  amount: Joi.number().positive().required(),
  expenseDate: Joi.date().iso().required(),
  paymentMethod: Joi.string().valid(...EXPENSE_PAYMENT_METHODS).default('CASH'),
  reference: Joi.string().optional().allow('', null),
  status: Joi.string().valid(...EXPENSE_STATUSES).default('PENDING'),
  categoryId: Joi.string().optional().allow('', null),
  branchId: Joi.string().optional().allow('', null)
  // NOTE: companyId is deliberately NOT accepted — tenancy comes from the
  // resolved business context (headers/membership), never from the body.
});

const updateExpenseSchema = Joi.object({
  title: Joi.string().trim().max(200).optional().allow(''),
  description: Joi.string().optional().allow('', null),
  vendor: Joi.string().optional().allow('', null),
  amount: Joi.number().positive().optional(),
  expenseDate: Joi.date().iso().optional(),
  paymentMethod: Joi.string().valid(...EXPENSE_PAYMENT_METHODS).optional(),
  reference: Joi.string().optional().allow('', null),
  status: Joi.string().valid(...EXPENSE_STATUSES).optional(),
  categoryId: Joi.string().optional().allow('', null),
  branchId: Joi.string().optional().allow('', null)
}).min(1);

const createExpenseCategorySchema = Joi.object({
  name: Joi.string().trim().max(120).required(),
  description: Joi.string().optional().allow('', null),
  branchId: Joi.string().optional().allow('', null),
  isActive: Joi.boolean().optional()
});

const updateExpenseCategorySchema = Joi.object({
  name: Joi.string().trim().max(120).optional(),
  description: Joi.string().optional().allow('', null),
  branchId: Joi.string().optional().allow('', null),
  isActive: Joi.boolean().optional()
}).min(1);

// ─── Tenancy scope ──────────────────────────────────────────────────────────
// Same resolution chain as purchase.controller (resolvePurchaseCompanyId):
// the resolved business context wins; the request body is never trusted.

const resolveExpenseCompanyId = (req: AuthRequest): string | null =>
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  req.membership?.business_id ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  null;

/**
 * Branch ids the caller may see/touch inside the resolved company.
 * Returns null for OWNER/ADMIN (whole company), otherwise the membership's
 * assigned branches (or the user's home branch as a legacy fallback).
 */
const resolveAllowedBranchIds = (req: AuthRequest): string[] | null => {
  const role = String(req.membership?.role_name || req.user?.role || '').toUpperCase();
  if (role === 'OWNER' || role === 'ADMIN') return null;
  if (req.membership?.branch_ids && req.membership.branch_ids.length > 0) {
    return req.membership.branch_ids.map((id: string) => String(id));
  }
  if (req.user?.branchId) return [String(req.user.branchId)];
  return null;
};

const requestedBranchId = (req: AuthRequest): string | null => {
  const fromQuery = typeof req.query.branchId === 'string' ? req.query.branchId.trim() : '';
  if (fromQuery) return fromQuery;
  if (req.branch_id) return String(req.branch_id);
  const fromHeader = (req.headers['x-branch-id'] as string) || '';
  return fromHeader.trim() ? fromHeader.trim() : null;
};

/** Verify a branch exists inside the resolved company. */
const branchBelongsToCompany = async (
  prisma: Awaited<ReturnType<typeof getPrisma>>,
  companyId: string,
  branchId: string
): Promise<boolean> => {
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, companyId },
    select: { id: true }
  });
  return !!branch;
};

/** Verify an expense category exists inside the resolved company. */
const categoryBelongsToCompany = async (
  prisma: Awaited<ReturnType<typeof getPrisma>>,
  companyId: string,
  categoryId: string
) => {
  return prisma.expenseCategory.findFirst({
    where: { id: categoryId, companyId }
  });
};

// ─── Date helpers (local-time, mirroring advanced-report.controller) ───────

const parseDateStart = (value: string): Date | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10), 0, 0, 0, 0);
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
};

const parseDateEnd = (value: string): Date | null => {
  const d = parseDateStart(value);
  if (!d) return null;
  d.setHours(23, 59, 59, 999);
  return d;
};

const toDateOnly = (value: any): string | null => {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const serializeExpense = (expense: any) => {
  const { category, ...rest } = expense;
  return {
    ...rest,
    // The Prisma include also travels under its own key; `category` itself
    // stays the plain name string that existing consumers (Reports.tsx)
    // already read, alongside the .date convenience field.
    categoryRef: category || null,
    category: category?.name || 'Uncategorized',
    date: toDateOnly(expense.expenseDate)
  };
};

const emptyToNull = (value: any): any => (value === '' || value === undefined ? null : value);

// ═══ EXPENSES ═══════════════════════════════════════════════════════════════

/**
 * GET /api/expenses
 * List expenses for the resolved business with branch/category/date/status
 * filters, pagination, and a full-filter summary (total + by category).
 */
export const getExpenses = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveExpenseCompanyId(req);

    const {
      page = 1,
      limit = 200,
      search = '',
      categoryId = '',
      status = '',
      startDate = '',
      endDate = '',
      from = '',
      to = ''
    } = req.query as Record<string, string>;

    const pageNumber = Math.max(1, Number(page) || 1);
    const pageSize = Math.min(1000, Math.max(1, Number(limit) || 200));
    const skip = (pageNumber - 1) * pageSize;

    // Fail closed: no business context -> no data (same posture as the
    // STRICT company filter in getCategories).
    const where: any = { companyId: companyId || 'no-business-context' };

    // Branch scope: explicit request narrows within the caller's allowed set.
    const allowedBranchIds = resolveAllowedBranchIds(req);
    const branchId = requestedBranchId(req);
    if (branchId) {
      if (allowedBranchIds && !allowedBranchIds.includes(branchId)) {
        where.branchId = 'no-branch-access';
      } else {
        where.branchId = branchId;
      }
    } else if (allowedBranchIds) {
      where.branchId = { in: allowedBranchIds };
    }

    if (categoryId && String(categoryId).trim() !== '') {
      where.categoryId = String(categoryId);
    }

    const statusValue = String(status || '').toUpperCase();
    if (EXPENSE_STATUSES.includes(statusValue)) {
      where.status = statusValue;
    }

    const rangeStart = startDate || from;
    const rangeEnd = endDate || to;
    if (rangeStart || rangeEnd) {
      where.expenseDate = {};
      const start = rangeStart ? parseDateStart(String(rangeStart)) : null;
      const end = rangeEnd ? parseDateEnd(String(rangeEnd)) : null;
      if (start) where.expenseDate.gte = start;
      if (end) where.expenseDate.lte = end;
      if (!where.expenseDate.gte && !where.expenseDate.lte) delete where.expenseDate;
    }

    if (search) {
      const searchConditions = createSearchConditions(['title', 'vendor', 'description', 'reference'], String(search));
      if (searchConditions.OR) {
        where.AND = [{ OR: searchConditions.OR }];
      }
    }

    const [expenses, total, totalAggregate, grouped] = await Promise.all([
      prisma.expense.findMany({
        where,
        skip,
        take: pageSize,
        include: {
          category: { select: { id: true, name: true } },
          branch: { select: { id: true, name: true } }
        },
        orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }]
      }),
      prisma.expense.count({ where }),
      prisma.expense.aggregate({ where, _sum: { amount: true } }),
      prisma.expense.groupBy({
        by: ['categoryId'],
        where,
        _sum: { amount: true },
        _count: { id: true }
      })
    ]);

    // Resolve category names for the summary (groupBy only returns ids).
    const categoryIds = grouped
      .map((g: any) => g.categoryId)
      .filter((id: any): id is string => typeof id === 'string' && id !== '');
    const categoryRows = categoryIds.length > 0
      ? await prisma.expenseCategory.findMany({
          where: { id: { in: categoryIds } },
          select: { id: true, name: true }
        })
      : [];
    const categoryNameById = new Map(categoryRows.map((c: any) => [c.id, c.name]));

    const byCategory = grouped
      .map((g: any) => ({
        categoryId: g.categoryId || null,
        category: g.categoryId ? (categoryNameById.get(g.categoryId) || 'Uncategorized') : 'Uncategorized',
        total: g._sum?.amount || 0,
        count: g._count?.id || 0
      }))
      .sort((a: any, b: any) => b.total - a.total);

    return res.json({
      success: true,
      data: {
        expenses: expenses.map(serializeExpense),
        pagination: {
          page: pageNumber,
          limit: pageSize,
          total,
          pages: Math.ceil(total / pageSize)
        },
        summary: {
          totalExpenses: totalAggregate._sum?.amount || 0,
          byCategory
        }
      }
    });
  } catch (error) {
    console.error('Get expenses error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * GET /api/expenses/:id
 */
export const getExpense = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveExpenseCompanyId(req);
    const { id } = req.params;

    const expense = await prisma.expense.findFirst({
      where: { id, companyId: companyId || 'no-business-context' },
      include: {
        category: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } }
      }
    });

    if (!expense) {
      return res.status(404).json({ success: false, message: 'Expense not found' });
    }

    return res.json({ success: true, data: serializeExpense(expense) });
  } catch (error) {
    console.error('Get expense error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * POST /api/expenses
 */
export const createExpense = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();

    const { error, value } = createExpenseSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map((detail: any) => detail.message)
      });
    }

    const companyId = resolveExpenseCompanyId(req);
    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Business context required. Please select a business first.'
      });
    }

    // Branch: body value wins, then the resolved branch context. It must
    // belong to the caller's business and be within the caller's branch set.
    let branchId = emptyToNull(value.branchId) || req.branch_id || emptyToNull(req.headers['x-branch-id'] as string) || null;
    if (branchId) {
      branchId = String(branchId);
      const allowedBranchIds = resolveAllowedBranchIds(req);
      if (allowedBranchIds && !allowedBranchIds.includes(branchId)) {
        return res.status(403).json({ success: false, message: 'You do not have access to this branch.' });
      }
      if (!(await branchBelongsToCompany(prisma, companyId, branchId))) {
        return res.status(400).json({ success: false, message: 'Branch does not belong to this business.' });
      }
    }

    // Category: must belong to the caller's business when provided.
    let category: any = null;
    const categoryId = emptyToNull(value.categoryId);
    if (categoryId) {
      category = await categoryBelongsToCompany(prisma, companyId, String(categoryId));
      if (!category) {
        return res.status(400).json({ success: false, message: 'Expense category not found for this business.' });
      }
    }

    const title =
      (value.title && String(value.title).trim()) ||
      (value.vendor && String(value.vendor).trim()) ||
      category?.name ||
      'Expense';

    const expense = await prisma.expense.create({
      data: {
        title,
        description: emptyToNull(value.description),
        vendor: emptyToNull(value.vendor),
        amount: value.amount,
        expenseDate: parseDateStart(toDateOnly(value.expenseDate) || String(value.expenseDate)) || new Date(value.expenseDate),
        paymentMethod: value.paymentMethod || 'CASH',
        reference: emptyToNull(value.reference),
        status: value.status || 'PENDING',
        companyId,
        branchId,
        categoryId: category ? category.id : null,
        createdBy: req.user?.id || null
      },
      include: {
        category: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } }
      }
    });

    return res.status(201).json({ success: true, data: serializeExpense(expense) });
  } catch (error) {
    console.error('Create expense error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * PUT /api/expenses/:id
 */
export const updateExpense = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    const { error, value } = updateExpenseSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map((detail: any) => detail.message)
      });
    }

    const companyId = resolveExpenseCompanyId(req);
    const existing = await prisma.expense.findFirst({
      where: { id, companyId: companyId || 'no-business-context' }
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Expense not found' });
    }

    const data: any = {};

    if (value.branchId !== undefined) {
      const branchId = emptyToNull(value.branchId);
      if (branchId) {
        const allowedBranchIds = resolveAllowedBranchIds(req);
        if (allowedBranchIds && !allowedBranchIds.includes(String(branchId))) {
          return res.status(403).json({ success: false, message: 'You do not have access to this branch.' });
        }
        if (!(await branchBelongsToCompany(prisma, existing.companyId, String(branchId)))) {
          return res.status(400).json({ success: false, message: 'Branch does not belong to this business.' });
        }
        data.branchId = String(branchId);
      } else {
        data.branchId = null;
      }
    }

    if (value.categoryId !== undefined) {
      const categoryId = emptyToNull(value.categoryId);
      if (categoryId) {
        const category = await categoryBelongsToCompany(prisma, existing.companyId, String(categoryId));
        if (!category) {
          return res.status(400).json({ success: false, message: 'Expense category not found for this business.' });
        }
        data.categoryId = category.id;
      } else {
        data.categoryId = null;
      }
    }

    if (value.title !== undefined) data.title = String(value.title).trim() || existing.title;
    if (value.description !== undefined) data.description = emptyToNull(value.description);
    if (value.vendor !== undefined) data.vendor = emptyToNull(value.vendor);
    if (value.amount !== undefined) data.amount = value.amount;
    if (value.expenseDate !== undefined) {
      data.expenseDate = parseDateStart(toDateOnly(value.expenseDate) || String(value.expenseDate)) || new Date(value.expenseDate);
    }
    if (value.paymentMethod !== undefined) data.paymentMethod = value.paymentMethod;
    if (value.reference !== undefined) data.reference = emptyToNull(value.reference);
    if (value.status !== undefined) data.status = value.status;

    const expense = await prisma.expense.update({
      where: { id },
      data,
      include: {
        category: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true } }
      }
    });

    return res.json({ success: true, data: serializeExpense(expense) });
  } catch (error) {
    console.error('Update expense error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * DELETE /api/expenses/:id
 * Hard delete, matching the category/supplier controllers' norm.
 */
export const deleteExpense = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const companyId = resolveExpenseCompanyId(req);

    const existing = await prisma.expense.findFirst({
      where: { id, companyId: companyId || 'no-business-context' },
      select: { id: true }
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Expense not found' });
    }

    await prisma.expense.delete({ where: { id } });

    return res.json({ success: true, message: 'Expense deleted successfully' });
  } catch (error) {
    console.error('Delete expense error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══ EXPENSE CATEGORIES ═════════════════════════════════════════════════════

/**
 * GET /api/expenses/categories
 * Company-scoped; a branch context narrows to that branch's categories plus
 * company-wide ones (branchId null).
 */
export const getExpenseCategories = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveExpenseCompanyId(req);
    const { search = '', isActive = '' } = req.query as Record<string, string>;

    const where: any = { companyId: companyId || 'no-business-context' };

    const branchId = requestedBranchId(req);
    if (branchId) {
      where.OR = [{ branchId }, { branchId: null }];
    }

    if (isActive === 'true') where.isActive = true;
    if (isActive === 'false') where.isActive = false;

    if (search) {
      const searchConditions = createSearchConditions(['name', 'description'], String(search));
      if (searchConditions.OR) {
        where.AND = [{ OR: searchConditions.OR }];
      }
    }

    const categories = await prisma.expenseCategory.findMany({
      where,
      include: { _count: { select: { expenses: true } } },
      orderBy: { name: 'asc' }
    });

    return res.json({
      success: true,
      data: { categories }
    });
  } catch (error) {
    console.error('Get expense categories error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * POST /api/expenses/categories
 */
export const createExpenseCategory = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();

    const { error, value } = createExpenseCategorySchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map((detail: any) => detail.message)
      });
    }

    const companyId = resolveExpenseCompanyId(req);
    if (!companyId) {
      return res.status(400).json({
        success: false,
        message: 'Business context required. Please select a business first.'
      });
    }

    let branchId = emptyToNull(value.branchId) || req.branch_id || null;
    if (branchId) {
      branchId = String(branchId);
      if (!(await branchBelongsToCompany(prisma, companyId, branchId))) {
        return res.status(400).json({ success: false, message: 'Branch does not belong to this business.' });
      }
    }

    const existing = await prisma.expenseCategory.findFirst({
      where: { companyId, branchId: branchId || null, name: value.name }
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Expense category with this name already exists'
      });
    }

    const category = await prisma.expenseCategory.create({
      data: {
        name: value.name,
        description: emptyToNull(value.description),
        companyId,
        branchId: branchId || null,
        isActive: value.isActive !== undefined ? value.isActive : true,
        createdBy: req.user?.id || null
      },
      include: { _count: { select: { expenses: true } } }
    });

    return res.status(201).json({ success: true, data: category });
  } catch (error) {
    console.error('Create expense category error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * PUT /api/expenses/categories/:id
 */
export const updateExpenseCategory = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    const { error, value } = updateExpenseCategorySchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map((detail: any) => detail.message)
      });
    }

    const companyId = resolveExpenseCompanyId(req);
    const existing = await prisma.expenseCategory.findFirst({
      where: { id, companyId: companyId || 'no-business-context' }
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Expense category not found' });
    }

    const data: any = {};

    if (value.branchId !== undefined) {
      const branchId = emptyToNull(value.branchId);
      if (branchId) {
        if (!(await branchBelongsToCompany(prisma, existing.companyId, String(branchId)))) {
          return res.status(400).json({ success: false, message: 'Branch does not belong to this business.' });
        }
        data.branchId = String(branchId);
      } else {
        data.branchId = null;
      }
    }

    if (value.name !== undefined && value.name !== existing.name) {
      const targetBranchId = data.branchId !== undefined ? data.branchId : existing.branchId;
      const duplicate = await prisma.expenseCategory.findFirst({
        where: {
          companyId: existing.companyId,
          branchId: targetBranchId || null,
          name: value.name,
          id: { not: id }
        }
      });
      if (duplicate) {
        return res.status(400).json({
          success: false,
          message: 'Expense category with this name already exists'
        });
      }
      data.name = value.name;
    }

    if (value.description !== undefined) data.description = emptyToNull(value.description);
    if (value.isActive !== undefined) data.isActive = value.isActive;

    const category = await prisma.expenseCategory.update({
      where: { id },
      data,
      include: { _count: { select: { expenses: true } } }
    });

    return res.json({ success: true, data: category });
  } catch (error) {
    console.error('Update expense category error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * DELETE /api/expenses/categories/:id
 * Expenses keep their history; their categoryId is cleared (nullable FK).
 */
export const deleteExpenseCategory = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const companyId = resolveExpenseCompanyId(req);

    const existing = await prisma.expenseCategory.findFirst({
      where: { id, companyId: companyId || 'no-business-context' },
      select: { id: true }
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Expense category not found' });
    }

    await prisma.expense.updateMany({
      where: { categoryId: id },
      data: { categoryId: null }
    });

    await prisma.expenseCategory.delete({ where: { id } });

    return res.json({ success: true, message: 'Expense category deleted successfully' });
  } catch (error) {
    console.error('Delete expense category error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
