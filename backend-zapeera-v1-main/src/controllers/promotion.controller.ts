import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import Joi from 'joi';
import { AuthRequest, getUserRole } from '../middleware/auth.middleware';
import {
  PromotionLike,
  PromoLineInput,
  evaluatePromotions,
  normalizeCouponCode,
  resolveCouponPromotion,
  PROMOTION_TYPES,
  PROMOTION_SCOPES
} from '../utils/promotion.util';

// ─── Promotions & coupons (Wave B4) ─────────────────────────────────────
// Management CRUD for the offers the sale engine (promotion.util.ts)
// evaluates at checkout, plus the POS coupon-preview endpoint.
// Conventions mirror the transfer controller (A9):
//   · Tenancy: every query is scoped to the caller's business (A-02);
//     an id from another tenant reads as "not found".
//   · Writes are OWNER/MANAGER/ADMIN only (in-controller gate, the
//     khata-adjustment precedent) — cashiers can only READ the list
//     and call /validate, which the POS needs at the counter.
//   · DELETE is soft (isActive = false): promotions carry redemption
//     history (SalePromotion rows), so they are never hard-deleted.
//
// Module gating: the router guards with checkModule('sales') and the
// route-policy registry maps /api/promotions to the sales.invoices
// resource key — no new module/submodule key is introduced.

const resolvePromotionCompanyId = (req: AuthRequest): string =>
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  req.membership?.business_id ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const promotionScopeWhere = (req: AuthRequest, id: string): any => ({
  id,
  companyId: resolvePromotionCompanyId(req)
});

const requireManagerRole = (req: AuthRequest, res: Response): boolean => {
  const role = getUserRole(req);
  if (!['OWNER', 'MANAGER', 'ADMIN'].includes(role)) {
    res.status(403).json({
      success: false,
      message: 'Only the owner or a manager can manage promotions'
    });
    return false;
  }
  return true;
};

const promotionInclude = {
  category: { select: { id: true, name: true } },
  product: { select: { id: true, name: true, barcode: true } }
};

const createPromotionSchema = Joi.object({
  name: Joi.string().trim().min(1).max(120).required(),
  type: Joi.string().valid(...PROMOTION_TYPES).required(),
  value: Joi.number().min(0).optional(),
  buyQty: Joi.number().integer().min(1).allow(null).optional(),
  getQty: Joi.number().integer().min(1).allow(null).optional(),
  scope: Joi.string().valid(...PROMOTION_SCOPES).default('ALL'),
  categoryId: Joi.string().allow(null, '').optional(),
  productId: Joi.string().allow(null, '').optional(),
  code: Joi.string().trim().max(64).allow(null, '').optional(),
  minBill: Joi.number().min(0).allow(null).optional(),
  startsAt: Joi.date().allow(null).optional(),
  endsAt: Joi.date().allow(null).optional(),
  usageLimit: Joi.number().integer().min(1).allow(null).optional(),
  isActive: Joi.boolean().optional()
});

const updatePromotionSchema = Joi.object({
  name: Joi.string().trim().min(1).max(120).optional(),
  type: Joi.string().valid(...PROMOTION_TYPES).optional(),
  value: Joi.number().min(0).optional(),
  buyQty: Joi.number().integer().min(1).allow(null).optional(),
  getQty: Joi.number().integer().min(1).allow(null).optional(),
  scope: Joi.string().valid(...PROMOTION_SCOPES).optional(),
  categoryId: Joi.string().allow(null, '').optional(),
  productId: Joi.string().allow(null, '').optional(),
  code: Joi.string().trim().max(64).allow(null, '').optional(),
  minBill: Joi.number().min(0).allow(null).optional(),
  startsAt: Joi.date().allow(null).optional(),
  endsAt: Joi.date().allow(null).optional(),
  usageLimit: Joi.number().integer().min(1).allow(null).optional(),
  isActive: Joi.boolean().optional()
}).min(1);

/**
 * Cross-field rules Joi cannot express on its own. Returns a plain
 * message or null. `merged` is the would-be promotion (the request
 * body merged over the stored row on updates).
 */
const crossFieldError = (merged: any): string | null => {
  if (merged.type === 'PERCENT') {
    if (!(merged.value > 0) || merged.value > 100) {
      return 'A PERCENT promotion needs a value between 0 and 100';
    }
  }
  if (merged.type === 'FLAT') {
    if (!(merged.value > 0)) {
      return 'A FLAT promotion needs a value above 0';
    }
  }
  if (merged.type === 'BUY_X_GET_Y') {
    if (!merged.buyQty || merged.buyQty < 1 || !merged.getQty || merged.getQty < 1) {
      return 'A BUY_X_GET_Y promotion needs buyQty and getQty of at least 1';
    }
  }
  if (merged.scope === 'CATEGORY' && !merged.categoryId) {
    return 'A CATEGORY promotion needs a category';
  }
  if (merged.scope === 'PRODUCT' && !merged.productId) {
    return 'A PRODUCT promotion needs a product';
  }
  if (merged.startsAt && merged.endsAt
    && new Date(merged.endsAt).getTime() <= new Date(merged.startsAt).getTime()) {
    return 'endsAt must be after startsAt';
  }
  return null;
};

/** Verify scope targets belong to the caller's business (A-02). */
const scopeTargetError = async (prisma: any, companyId: string, merged: any): Promise<string | null> => {
  if (merged.scope === 'CATEGORY' && merged.categoryId) {
    const category = await prisma.category.findFirst({
      where: { id: merged.categoryId, companyId },
      select: { id: true }
    });
    if (!category) return 'Category not found in this business';
  }
  if (merged.scope === 'PRODUCT' && merged.productId) {
    const product = await prisma.product.findFirst({
      where: { id: merged.productId, companyId },
      select: { id: true }
    });
    if (!product) return 'Product not found in this business';
  }
  return null;
};

// Create a promotion
export const createPromotion = async (req: AuthRequest, res: Response) => {
  try {
    if (!requireManagerRole(req, res)) return;
    const prisma = await getPrisma();
    const { error, value } = createPromotionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const companyId = resolvePromotionCompanyId(req);
    const data: any = {
      companyId,
      name: value.name,
      type: value.type,
      value: value.type === 'BUY_X_GET_Y' ? 0 : (value.value || 0),
      buyQty: value.type === 'BUY_X_GET_Y' ? value.buyQty : null,
      getQty: value.type === 'BUY_X_GET_Y' ? value.getQty : null,
      scope: value.scope || 'ALL',
      categoryId: value.scope === 'CATEGORY' ? (value.categoryId || null) : null,
      productId: value.scope === 'PRODUCT' ? (value.productId || null) : null,
      code: normalizeCouponCode(value.code),
      minBill: value.minBill ?? null,
      startsAt: value.startsAt ? new Date(value.startsAt) : null,
      endsAt: value.endsAt ? new Date(value.endsAt) : null,
      usageLimit: value.usageLimit ?? null,
      isActive: value.isActive !== undefined ? value.isActive : true
    };

    const crossError = crossFieldError(data);
    if (crossError) {
      return res.status(400).json({ success: false, message: crossError });
    }
    const targetError = await scopeTargetError(prisma, companyId, data);
    if (targetError) {
      return res.status(400).json({ success: false, message: targetError });
    }
    if (data.code) {
      const existing = await prisma.promotion.findFirst({
        where: { companyId, code: data.code },
        select: { id: true }
      });
      if (existing) {
        return res.status(409).json({
          success: false,
          message: `A promotion with code "${data.code}" already exists in this business`,
          code: 'DUPLICATE_COUPON_CODE'
        });
      }
    }

    const promotion = await prisma.promotion.create({
      data,
      include: promotionInclude
    });

    return res.status(201).json({
      success: true,
      data: promotion,
      message: 'Promotion created successfully'
    });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'A promotion with this code already exists in this business',
        code: 'DUPLICATE_COUPON_CODE'
      });
    }
    console.error('Create promotion error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// List promotions for the caller's business
export const getPromotions = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { page = 1, limit = 20, type, isActive, search } = req.query;

    const where: any = { companyId: resolvePromotionCompanyId(req) };
    if (type) where.type = type;
    if (isActive !== undefined) where.isActive = String(isActive) === 'true';
    if (search) {
      const term = String(search);
      where.OR = [
        { name: { contains: term } },
        { code: { contains: term.toUpperCase() } }
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [promotions, total] = await Promise.all([
      prisma.promotion.findMany({
        where,
        include: promotionInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit)
      }),
      prisma.promotion.count({ where })
    ]);

    return res.json({
      success: true,
      data: promotions,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Get promotions error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get one promotion (tenancy-scoped)
export const getPromotionById = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const promotion = await prisma.promotion.findFirst({
      where: promotionScopeWhere(req, req.params.id),
      include: promotionInclude
    });
    if (!promotion) {
      return res.status(404).json({ success: false, message: 'Promotion not found' });
    }
    return res.json({ success: true, data: promotion });
  } catch (error) {
    console.error('Get promotion error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Update a promotion (usedCount is engine-owned and never editable)
export const updatePromotion = async (req: AuthRequest, res: Response) => {
  try {
    if (!requireManagerRole(req, res)) return;
    const prisma = await getPrisma();
    const { error, value } = updatePromotionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const companyId = resolvePromotionCompanyId(req);
    const existing = await prisma.promotion.findFirst({
      where: promotionScopeWhere(req, req.params.id)
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Promotion not found' });
    }

    // Merge over the stored row so cross-field rules see the final
    // shape (e.g. switching type PERCENT → BUY_X_GET_Y must bring its
    // quantities in the same request or already have them stored).
    const merged: any = { ...existing, ...value };
    if (merged.type === 'BUY_X_GET_Y') merged.value = 0;
    if (merged.scope !== 'CATEGORY') merged.categoryId = null;
    if (merged.scope !== 'PRODUCT') merged.productId = null;
    if (value.code !== undefined) merged.code = normalizeCouponCode(value.code);
    if (value.categoryId !== undefined) merged.categoryId = value.categoryId || null;
    if (value.productId !== undefined) merged.productId = value.productId || null;

    const crossError = crossFieldError(merged);
    if (crossError) {
      return res.status(400).json({ success: false, message: crossError });
    }
    const targetError = await scopeTargetError(prisma, companyId, merged);
    if (targetError) {
      return res.status(400).json({ success: false, message: targetError });
    }
    if (merged.code && merged.code !== existing.code) {
      const clash = await prisma.promotion.findFirst({
        where: { companyId, code: merged.code, id: { not: existing.id } },
        select: { id: true }
      });
      if (clash) {
        return res.status(409).json({
          success: false,
          message: `A promotion with code "${merged.code}" already exists in this business`,
          code: 'DUPLICATE_COUPON_CODE'
        });
      }
    }

    const data: any = {
      name: merged.name,
      type: merged.type,
      value: merged.type === 'BUY_X_GET_Y' ? 0 : merged.value,
      buyQty: merged.type === 'BUY_X_GET_Y' ? merged.buyQty : null,
      getQty: merged.type === 'BUY_X_GET_Y' ? merged.getQty : null,
      scope: merged.scope,
      categoryId: merged.scope === 'CATEGORY' ? merged.categoryId : null,
      productId: merged.scope === 'PRODUCT' ? merged.productId : null,
      code: merged.code,
      minBill: merged.minBill ?? null,
      startsAt: merged.startsAt ? new Date(merged.startsAt) : null,
      endsAt: merged.endsAt ? new Date(merged.endsAt) : null,
      usageLimit: merged.usageLimit ?? null,
      isActive: merged.isActive
    };

    const promotion = await prisma.promotion.update({
      where: { id: existing.id },
      data,
      include: promotionInclude
    });

    return res.json({
      success: true,
      data: promotion,
      message: 'Promotion updated successfully'
    });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({
        success: false,
        message: 'A promotion with this code already exists in this business',
        code: 'DUPLICATE_COUPON_CODE'
      });
    }
    console.error('Update promotion error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Delete = deactivate (soft). Promotions carry redemption history
// (SalePromotion rows), so a hard delete would destroy the audit
// trail behind past receipts; deactivation stops new redemptions.
export const deletePromotion = async (req: AuthRequest, res: Response) => {
  try {
    if (!requireManagerRole(req, res)) return;
    const prisma = await getPrisma();
    const existing = await prisma.promotion.findFirst({
      where: promotionScopeWhere(req, req.params.id)
    });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Promotion not found' });
    }
    const promotion = await prisma.promotion.update({
      where: { id: existing.id },
      data: { isActive: false },
      include: promotionInclude
    });
    return res.json({
      success: true,
      data: promotion,
      message: 'Promotion deactivated'
    });
  } catch (error) {
    console.error('Delete promotion error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

const validateCouponSchema = Joi.object({
  code: Joi.string().trim().max(64).required(),
  items: Joi.array().items(
    Joi.object({
      productId: Joi.string().required(),
      quantity: Joi.number().min(1).required(),
      unitPrice: Joi.number().positive().required(),
      saleType: Joi.string().valid('UNIT', 'BOX', 'unit', 'box').optional(),
      unitsDeducted: Joi.number().min(1).optional(),
      unitsPerBox: Joi.number().min(1).optional(),
      discountPercentage: Joi.number().min(0).max(100).optional(),
      discountAmount: Joi.number().min(0).optional()
    })
  ).optional(),
  discountPercentage: Joi.number().min(0).max(100).default(0),
  discountAmount: Joi.number().min(0).default(0),
  subtotal: Joi.number().min(0).optional()
});

/**
 * POS coupon preview: is this code redeemable on this cart, and what
 * would it (approximately) grant? Runs the very same engine sale
 * creation runs, so the estimate matches the server's own math; the
 * sale itself remains authoritative. Business-invalid codes return
 * 200 with valid:false + a plain-language reason (the POS shows it
 * inline); only malformed requests are 400s.
 */
export const validateCoupon = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = validateCouponSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const companyId = resolvePromotionCompanyId(req);
    const hasItems = Array.isArray(value.items) && value.items.length > 0;

    // Build engine lines exactly the way createSale does (line total
    // after item discounts; units in stock units).
    let lines: PromoLineInput[] = [];
    let subtotal = 0;
    if (hasItems) {
      const productIds = [...new Set(value.items.map((item: any) => item.productId))];
      const products = await prisma.product.findMany({
        where: { id: { in: productIds }, companyId },
        select: { id: true, categoryId: true }
      });
      const categoryByProduct = new Map(products.map((p: any) => [p.id, p.categoryId || null]));
      lines = value.items.map((item: any) => {
        const itemSubtotal = item.quantity * item.unitPrice;
        let itemDiscount = 0;
        if (item.discountPercentage && item.discountPercentage > 0) {
          itemDiscount = itemSubtotal * (item.discountPercentage / 100);
        } else if (item.discountAmount && item.discountAmount > 0) {
          itemDiscount = item.discountAmount;
        }
        const normalizedSaleType = (item.saleType || 'UNIT').toString().toUpperCase();
        const unitsPerBox = item.unitsPerBox && item.unitsPerBox > 0 ? item.unitsPerBox : 1;
        const units = item.unitsDeducted && item.unitsDeducted > 0
          ? item.unitsDeducted
          : (normalizedSaleType === 'BOX' ? item.quantity * unitsPerBox : item.quantity);
        return {
          productId: item.productId,
          categoryId: categoryByProduct.get(item.productId) ?? null,
          units,
          lineTotal: itemSubtotal - itemDiscount
        };
      });
      subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    } else if (value.subtotal !== undefined) {
      subtotal = value.subtotal;
    } else {
      return res.status(400).json({
        success: false,
        message: 'Provide either the cart items or a subtotal to validate against'
      });
    }

    const resolved = await resolveCouponPromotion(prisma, companyId, value.code, subtotal);
    if ('error' in resolved) {
      return res.json({
        success: true,
        data: { valid: false, reason: resolved.error }
      });
    }
    const coupon = resolved.promotion as PromotionLike;

    if (!hasItems && (coupon.type === 'BUY_X_GET_Y' || coupon.scope !== 'ALL')) {
      return res.json({
        success: true,
        data: {
          valid: false,
          reason: 'This coupon applies to specific items — the cart items are needed to check it',
          promotion: coupon
        }
      });
    }

    const promotions = await prisma.promotion.findMany({
      where: { companyId, isActive: true },
      orderBy: { createdAt: 'asc' }
    });
    const evaluation = evaluatePromotions({
      promotions,
      couponPromotion: coupon,
      lines,
      subtotal,
      manualDiscountPercentage: value.discountPercentage || 0,
      manualDiscountAmount: value.discountAmount || 0
    });

    if (evaluation.couponNotApplied) {
      return res.json({
        success: true,
        data: {
          valid: false,
          reason: `Coupon code "${coupon.code}" does not apply to the items in this sale`,
          promotion: coupon
        }
      });
    }

    const couponDiscount = evaluation.applied
      .filter(entry => entry.promotion.id === coupon.id)
      .reduce((sum, entry) => sum + entry.discountAmount, 0);

    return res.json({
      success: true,
      data: {
        valid: true,
        promotion: coupon,
        // What this coupon itself grants, and the total promotion
        // discount the sale would carry (automatic BUY_X_GET_Y offers
        // may add to it — exactly as at checkout).
        estimatedDiscount: Math.round(couponDiscount * 100) / 100,
        estimatedTotalPromotionDiscount: evaluation.totalDiscount
      }
    });
  } catch (error) {
    console.error('Validate coupon error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
