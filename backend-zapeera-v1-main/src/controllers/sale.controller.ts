// CRITICAL: Import database initialization FIRST to ensure DATABASE_URL is set
import '../config/database.init';

import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { CreateSaleData, SaleResponse, PaymentStatus } from '../models/sale.model';
import { AuthRequest, buildBranchWhereClause, getUserRole } from '../middleware/auth.middleware';
import { notifySaleChange } from '../routes/sse.routes';
import { syncAfterOperation, pullLatestFromLive } from '../utils/sync-helper';
import { isMissingTableError } from '../utils/membership-bridge.util';
import { getLoyaltyPointValue, recordLoyaltyTransaction, loyaltyPointsEarnedForSale } from '../utils/loyalty.util';
import { evaluatePromotions, normalizeCouponCode, resolveCouponPromotion, PromoLineInput, PromotionEvaluation } from '../utils/promotion.util';
import { computeSaleTax, serializeTaxBreakdown, IMPLICIT_DEFAULT_CLASS_NAME, TaxGroup } from '../utils/tax.util';
import { enqueueFbrForSale, attemptImmediateFbr } from '../services/fbr.service';
import { createNotification } from './notification.controller';
import Joi from 'joi';

// Tender methods a sale (or one split-tender allocation) can be paid
// with — Wave B1. JAZZCASH/EASYPAISA are first-class alongside the
// original four; MOBILE is kept for backward compatibility.
export const SALE_PAYMENT_METHODS = ['CASH', 'CARD', 'JAZZCASH', 'EASYPAISA', 'BANK_TRANSFER', 'MOBILE'] as const;

// Validation schemas
const createSaleSchema = Joi.object({
  customerId: Joi.string().allow(null),
  branchId: Joi.string().required(),
  items: Joi.array().items(
    Joi.object({
      productId: Joi.string().required(),
      quantity: Joi.number().min(1).required(),
      saleType: Joi.string().valid('UNIT', 'BOX', 'unit', 'box').optional(),
      unitsDeducted: Joi.number().min(1).optional(),
      unitsPerBox: Joi.number().min(1).optional(),
      unitPrice: Joi.number().positive().required(),
      batchId: Joi.string().allow(null, ''), // Link to specific batch
      batchNumber: Joi.string().allow(''), // Keep for backward compatibility
      expiryDate: Joi.string().allow(''),
      discountPercentage: Joi.number().min(0).max(100).optional(), // Item-level discount
      discountAmount: Joi.number().min(0).optional(), // Item-level discount amount
      totalPrice: Joi.number().min(0).optional() // Item total after discount
    })
  ).min(1).required(),
  paymentMethod: Joi.string().valid(...SALE_PAYMENT_METHODS).required(),
  // Split tender (Wave B1): optional per-method allocations. When
  // present, their sum must equal the amount paid (validated against
  // the server-computed paidAmount in createSale); when absent, a
  // single allocation is synthesized from paymentMethod + paidAmount.
  payments: Joi.array().items(
    Joi.object({
      method: Joi.string().valid(...SALE_PAYMENT_METHODS).required(),
      amount: Joi.number().positive().required(),
      reference: Joi.string().allow('', null).max(120).optional()
    })
  ).optional(),
  // Loyalty redemption (Wave B3): points the customer spends on this
  // sale. Requires customerId; validated against the customer's
  // balance inside the sale transaction. The PKR value per point
  // comes from the `loyaltyPointValue` setting (default 1).
  loyaltyPointsToRedeem: Joi.number().integer().min(1).optional(),
  // Promotions (Wave B4): a coupon code is the only promotion input a
  // client may send. The discount is always computed server-side by
  // the promotions engine; there is deliberately no client-sent
  // promotion discount field anywhere in this schema.
  couponCode: Joi.string().trim().max(64).allow('', null).optional(),
  paymentStatus: Joi.string().valid('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED').optional(),
  discountAmount: Joi.number().min(0).default(0),
  discountPercentage: Joi.number().min(0).max(100).default(0),
  paidAmount: Joi.number().min(0).default(0), // Amount paid by customer
  returnedAmount: Joi.number().min(0).default(0), // Amount returned/refunded
  saleDate: Joi.date().optional()
});

// Domain error carrying an HTTP status: business-rule failures (insufficient
// stock, expired batch, ...) must surface as 4xx, not 500 (A-12). The
// handlers' catch blocks honor `statusCode` when present, mirroring the
// AppError shape used by src/middleware/error.middleware.ts.
class HttpError extends Error {
  statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

const isMissingMembershipColumnError = (error: any): boolean => {
  const message = String(error?.message || '').toLowerCase();
  return (
    isMissingTableError(error) ||
    message.includes('membershipId') ||
    message.includes('no such column') ||
    message.includes('unknown column')
  );
};

export const getSales = async (req: AuthRequest, res: Response) => {
  try {
    // 🔄 PULL LATEST FROM LIVE DATABASE FIRST (skip in PostgreSQL mode or if connection pool is exhausted)
    // In PostgreSQL mode, data is already in PostgreSQL, so no sync needed
    const isPostgreSQLMode = process.env.USE_POSTGRESQL === 'true';
    if (!isPostgreSQLMode) {
      try {
        // Use timeout to prevent hanging on sync operations
        await Promise.race([
          Promise.all([
            pullLatestFromLive('sale').catch(err => {
              console.log('[Sync] Pull sales failed:', err.message);
              return null;
            }),
            pullLatestFromLive('saleItem').catch(err => {
              console.log('[Sync] Pull saleItems failed:', err.message);
              return null;
            })
          ]),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Sync timeout')), 1000))
        ]).catch(err => {
          if (err.message !== 'Sync timeout') {
            console.log('[Sync] Sync operation failed, continuing without sync:', err.message);
          }
        });
      } catch (syncError: any) {
        console.log('[Sync] Skipping sync due to error:', syncError.message);
        // Continue without sync - data might already be up to date
      }
    } else {
      console.log('[Sync] ⏭️  PostgreSQL mode - No pull needed (data already in PostgreSQL)');
    }

    const prisma = await getPrisma();
    const {
      page = 1,
      limit = 10,
      startDate = '',
      endDate = '',
      branchId = '',
      customerId = '',
      paymentMethod = ''
    } = req.query;

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    // Build where clause with data isolation
    const where: any = buildBranchWhereClause(req, {});

    // Additional branch filter only if not already filtered by buildBranchWhereClause
    const userRole = getUserRole(req);
    if (branchId && userRole !== 'MANAGER') {
      where.branchId = branchId;
    }

    if (customerId) {
      where.customerId = customerId;
    }

    if (paymentMethod) {
      where.paymentMethod = paymentMethod;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        // Add 23:59:59 to end date to include the entire day
        const endDateWithTime = new Date(endDate as string);
        endDateWithTime.setHours(23, 59, 59, 999);
        where.createdAt.lte = endDateWithTime;
      }
    }

    let sales: any[];
    let total: number;
    
    try {
      [sales, total] = await Promise.all([
      prisma.sale.findMany({
        where,
        skip,
        take,
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              phone: true,
              totalPurchases: true,
              loyaltyPoints: true,
              isVIP: true,
              lastVisit: true
            }
          },
          user: {
            select: {
              id: true,
              name: true,
              username: true
            }
          },
          branch: {
            select: {
              id: true,
              name: true
            }
          },
          items: {
              select: {
                id: true,
                saleId: true,
                productId: true,
                batchId: true,
                quantity: true,
                unitPrice: true,
                totalPrice: true,
                unitsDeducted: true,
                unitsPerBox: true,
                saleType: true,
                batchNumber: true,
                expiryDate: true,
                product: {
                  select: {
                    id: true,
                    name: true,
                  }
                }
              }
            },
            receipts: {
              select: {
                receiptNumber: true,
                printedAt: true
              }
            },
            payments: true,
            taxLines: true
          },
          orderBy: { createdAt: 'desc' }
        }),
        prisma.sale.count({ where })
      ]);
    } catch (error: any) {
      console.error('❌ Error fetching sales:', error);
      console.error('❌ Error code:', error?.code);
      console.error('❌ Error message:', error?.message);
      console.error('❌ Where clause:', JSON.stringify(where, null, 2));
      
      // If error is related to connection pool, return empty result instead of crashing
      if (error?.code === 'P2037' || error?.message?.includes('connection slots') || error?.message?.includes('connection pool')) {
        console.error('⚠️ Database connection pool exhausted, returning empty result');
        return res.json({
          success: true,
          data: {
            sales: [],
            pagination: {
              page: Number(page),
              limit: Number(limit),
              total: 0,
              pages: 0
            }
          }
        });
      }
      
      // If error is related to batch or reportReason, try without batch relation
      if (error?.message?.includes('reportReason') || error?.message?.includes('batch')) {
        console.log('⚠️ Retrying sales query without batch relations...');
        [sales, total] = await Promise.all([
          prisma.sale.findMany({
            where,
            skip,
            take,
            include: {
              customer: {
                select: {
                  id: true,
                  name: true,
                  phone: true,
                  totalPurchases: true,
                  loyaltyPoints: true,
                  isVIP: true,
                  lastVisit: true
                }
              },
              user: {
                select: {
                  id: true,
                  name: true,
                  username: true
                }
              },
              branch: {
                select: {
                  id: true,
                  name: true
                }
              },
              items: {
                select: {
                  id: true,
                  saleId: true,
                  productId: true,
                  batchId: true,
                  quantity: true,
                  unitPrice: true,
                  totalPrice: true,
                  unitsDeducted: true,
                  unitsPerBox: true,
                  saleType: true,
                  batchNumber: true,
                  expiryDate: true,
              product: {
                select: {
                  id: true,
                  name: true,
                }
              }
            }
          },
          receipts: {
            select: {
              receiptNumber: true,
              printedAt: true
            }
          },
          payments: true,
          taxLines: true
        },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.sale.count({ where })
    ]);
      } else {
        throw error;
      }
    }

    return res.json({
      success: true,
      data: {
        // Tax classes (Wave B5): every sale carries its per-class
        // breakdown alongside the stored tax lines.
        sales: sales.map((s: any) => ({ ...s, taxBreakdown: serializeTaxBreakdown(s) })),
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      }
    });
  } catch (error: any) {
    console.error('❌ Get sales error:', error);
    console.error('❌ Error details:', {
      message: error?.message,
      code: error?.code,
      stack: error?.stack?.substring(0, 500)
    });
    
    // If connection pool error, return empty result instead of crashing
    if (error?.code === 'P2037' || error?.message?.includes('connection slots') || error?.message?.includes('connection pool')) {
      console.error('⚠️ Database connection pool exhausted, returning empty result');
      return res.json({
        success: true,
        data: {
          sales: [],
          pagination: {
            page: Number(req.query.page) || 1,
            limit: Number(req.query.limit) || 10,
            total: 0,
            pages: 0
          }
        }
      });
    }
    
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error?.message : undefined
    });
  }
};

export const getSale = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    // Scope the lookup to the caller's business context exactly like the
    // list handler does (A-02): a sale from another tenant reads as 404.
    const sale = await prisma.sale.findFirst({
      where: buildBranchWhereClause(req, { id }),
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            username: true
          }
        },
        branch: {
          select: {
            id: true,
            name: true,
          }
        },
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                barcode: true
              }
            }
          }
        },
        receipts: {
          select: {
            id: true,
            receiptNumber: true,
            printedAt: true
          }
        },
        payments: true,
        taxLines: true,
        promotions: {
          include: {
            promotion: {
              select: {
                id: true,
                name: true,
                code: true,
                type: true
              }
            }
          }
        }
      }
    });

    if (!sale) {
      return res.status(404).json({
        success: false,
        message: 'Sale not found'
      });
    }

    return res.json({
      success: true,
      data: { ...sale, taxBreakdown: serializeTaxBreakdown(sale) }
    });
  } catch (error) {
    console.error('Get sale error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getSaleByReceiptNumber = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { receiptNumber } = req.params;

    console.log('Looking up receipt number:', receiptNumber);

    // Tenant scope for both the lookup and the debug listing (A-02): never
    // expose or match another business's receipts.
    const scope = buildBranchWhereClause(req, {});
    const saleScope = {
      companyId: scope.companyId,
      ...(scope.branchId ? { branchId: scope.branchId } : {})
    };

    // First, let's see what receipt numbers exist in the database
    const allReceipts = await prisma.receipt.findMany({
      where: {
        sale: saleScope
      },
      select: {
        receiptNumber: true,
        saleId: true
      },
      take: 10
    });
    console.log('Available receipt numbers in database:', allReceipts);

    const sale = await prisma.sale.findFirst({
      where: {
        ...saleScope,
        receipts: {
          some: {
            receiptNumber: receiptNumber
          }
        }
      },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            username: true
          }
        },
        branch: {
          select: {
            id: true,
            name: true,
          }
        },
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                barcode: true
              }
            }
          }
        },
        receipts: {
          select: {
            id: true,
            receiptNumber: true,
            printedAt: true
          }
        },
        payments: true,
        taxLines: true
      }
    });

    if (!sale) {
      return res.status(404).json({
        success: false,
        message: `Sale not found for receipt number: ${receiptNumber}. Available receipts: ${allReceipts.map(r => r.receiptNumber).join(', ')}`
      });
    }

    return res.json({
      success: true,
      data: { ...sale, taxBreakdown: serializeTaxBreakdown(sale) }
    });
  } catch (error) {
    console.error('Get sale by receipt number error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getAvailableReceiptNumbers = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    // Only the caller's own business receipts may be listed (A-02)
    const scope = buildBranchWhereClause(req, {});
    const receipts = await prisma.receipt.findMany({
      where: {
        sale: {
          companyId: scope.companyId,
          ...(scope.branchId ? { branchId: scope.branchId } : {})
        }
      },
      select: {
        id: true,
        receiptNumber: true,
        saleId: true,
        printedAt: true
      },
      orderBy: {
        printedAt: 'desc'
      },
      take: 50
    });

    return res.json({
      success: true,
      data: { receipts }
    });
  } catch (error) {
    console.error('Get available receipt numbers error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const createSale = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    console.log('Sale creation request body:', req.body);
    const { error } = createSaleSchema.validate(req.body);
    if (error) {
      console.log('Sale validation error:', error.details);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const saleData: CreateSaleData = req.body;
    const userId = (req as any).user.id;

    // Get tax rate from settings
    const currentAdminId = req.user?.createdBy || req.user?.id;
    let taxRate = 0; // Tax disabled - set to 0

    if (currentAdminId) {
      try {
        const taxSetting = await prisma.settings.findUnique({
          where: {
            createdBy_key: {
              createdBy: currentAdminId,
              key: 'defaultTax'
            }
          }
        });

        if (taxSetting) {
          taxRate = parseFloat(taxSetting.value);
        }
      } catch (error) {
        console.warn('Could not fetch tax rate from settings, using default:', error);
      }
    }

    // Loyalty point value (Wave B3): PKR per point at redemption, from
    // the same per-admin settings store as defaultTax; default 1.
    const loyaltyPointValue = await getLoyaltyPointValue(prisma, currentAdminId);

    // Promotions (Wave B4): the engine scopes offers by product
    // category, so resolve the cart products' categories up front
    // (ids are global; an unknown product simply gets a null category
    // here and fails properly inside the transaction, as before).
    const promoProductIds = [...new Set(saleData.items.map(item => item.productId))];
    const promoProducts = await prisma.product.findMany({
      where: { id: { in: promoProductIds } },
      select: { id: true, categoryId: true, taxClassId: true }
    });
    const categoryByProductId = new Map<string, string | null>(
      promoProducts.map((p: any) => [p.id, p.categoryId || null])
    );
    // Tax classes (Wave B5): the product's rate group, resolved by the
    // tax engine below from the same pre-fetch.
    const taxClassByProductId = new Map<string, string | null>(
      promoProducts.map((p: any) => [p.id, p.taxClassId || null])
    );
    const promoLines: PromoLineInput[] = [];

    // Calculate totals with item-level discounts — ALWAYS computed
    // server-side (A-04): a client-sent totalPrice is never trusted. Each
    // line total is quantity × unitPrice − item discount, and the sale
    // total below is the sum of the line totals (− sale discount + tax).
    const itemTotals = saleData.items.map(item => {
      const itemSubtotal = item.quantity * item.unitPrice;
      let itemDiscountAmount = 0;

      // Calculate item discount if provided
      if (item.discountPercentage && item.discountPercentage > 0) {
        itemDiscountAmount = itemSubtotal * (item.discountPercentage / 100);
      } else if (item.discountAmount && item.discountAmount > 0) {
        itemDiscountAmount = item.discountAmount;
      }

      const computedTotal = itemSubtotal - itemDiscountAmount;

      if (item.totalPrice !== undefined && item.totalPrice !== null && Math.abs(item.totalPrice - computedTotal) > 0.01) {
        console.warn(`⚠️ [Sales] Ignoring client-supplied totalPrice ${item.totalPrice} for product ${item.productId}; server-computed line total is ${computedTotal}`);
      }

      // Engine line for the promotions stage: units in stock units
      // (the same unitsDeducted rule the transaction applies below).
      const normalizedSaleType = (item.saleType || 'UNIT').toString().toUpperCase();
      const unitsPerBox = item.unitsPerBox && item.unitsPerBox > 0 ? item.unitsPerBox : 1;
      promoLines.push({
        productId: item.productId,
        categoryId: categoryByProductId.get(item.productId) ?? null,
        units: item.unitsDeducted && item.unitsDeducted > 0
          ? item.unitsDeducted
          : (normalizedSaleType === 'BOX' ? item.quantity * unitsPerBox : item.quantity),
        lineTotal: computedTotal
      });

      return computedTotal;
    });

    const subtotal = itemTotals.reduce((sum, total) => sum + total, 0);

    // Promotions (Wave B4): evaluate the company's offers against this
    // cart. The engine (promotion.util.ts) owns the order of
    // application: BUY_X_GET_Y first, then the manual discount against
    // what remains, then the single order-level promotion (the sent
    // coupon, or the best automatic). An explicitly-sent coupon code
    // that is unknown/ineligible — or that grants nothing on this
    // cart — fails the sale with a 400: a customer who typed a code
    // must never be silently charged full price.
    const couponCode = normalizeCouponCode(saleData.couponCode);
    let promotionEvaluation: PromotionEvaluation | null = null;
    let promotionDiscount = 0;
    {
      // Resolve the company exactly the way the transaction below
      // will, so the offers evaluated are the ones that get recorded.
      let promoCompanyId: string | null = null;
      if (req.user?.selectedCompanyId && req.user?.selectedBranchId) {
        promoCompanyId = req.user.selectedCompanyId;
      } else if (saleData.branchId) {
        const branchRow = await prisma.branch.findUnique({
          where: { id: saleData.branchId },
          select: { companyId: true }
        });
        promoCompanyId = branchRow?.companyId || null;
      }
      if (couponCode && !promoCompanyId) {
        throw new HttpError(400, 'Coupon code could not be verified for this sale');
      }
      if (promoCompanyId) {
        let couponPromotion = null;
        if (couponCode) {
          const resolved = await resolveCouponPromotion(prisma, promoCompanyId, couponCode, subtotal);
          if ('error' in resolved) {
            throw new HttpError(400, resolved.error);
          }
          couponPromotion = resolved.promotion;
        }
        const activePromotions = await prisma.promotion.findMany({
          where: { companyId: promoCompanyId, isActive: true },
          orderBy: { createdAt: 'asc' }
        });
        if (activePromotions.length > 0 || couponPromotion) {
          promotionEvaluation = evaluatePromotions({
            promotions: activePromotions,
            couponPromotion,
            lines: promoLines,
            subtotal,
            manualDiscountPercentage: saleData.discountPercentage || 0,
            manualDiscountAmount: saleData.discountAmount || 0
          });
          if (couponPromotion && promotionEvaluation.couponNotApplied) {
            throw new HttpError(400, `Coupon code "${couponCode}" does not apply to the items in this sale`);
          }
          promotionDiscount = promotionEvaluation.totalDiscount;
        }
      }
    }

    // Global discount: a sale-level discountPercentage takes precedence and
    // is converted against the (already item-discounted) subtotal — the same
    // rule the update-sale flow applies. Previously the percentage was stored
    // on the sale record but ignored when computing totals, so a 10% sale
    // discount silently billed the full amount (E2E D-20). Wave B4: when
    // the promotions engine ran, it resolved this same discount against
    // (subtotal − BUY_X_GET_Y discount) per the pipeline order; with no
    // BXGY in play the two formulas are identical.
    const discountAmount = promotionEvaluation
      ? promotionEvaluation.manualDiscount
      : (saleData.discountPercentage && saleData.discountPercentage > 0
        ? subtotal * (saleData.discountPercentage / 100)
        : (saleData.discountAmount || 0));

    // Loyalty redemption (Wave B3): points spent on this sale become
    // an additional discount component — applied AFTER the sale-level
    // discount and BEFORE tax, exactly like discountAmount, so the
    // server-computed total stays the single authority and tax is
    // charged on what the customer actually pays for the goods. The
    // discount is stored separately (Sale.loyaltyDiscount), NOT folded
    // into discountAmount. Two guards live here, before the
    // transaction: redemption needs a customer, and the points' value
    // may not exceed the discounted subtotal (which would drive the
    // bill negative). The balance check itself happens inside the
    // transaction, against the balance read there. Points earned on
    // THIS sale cannot be spent on it — redemption is limited to the
    // pre-sale balance.
    const loyaltyPointsToRedeem = saleData.loyaltyPointsToRedeem
      ? Math.floor(Number(saleData.loyaltyPointsToRedeem))
      : 0;
    let loyaltyDiscount = 0;
    if (loyaltyPointsToRedeem > 0) {
      if (!saleData.customerId) {
        throw new HttpError(400, 'Loyalty points can only be redeemed on a sale with a customer attached');
      }
      loyaltyDiscount = Math.round(loyaltyPointsToRedeem * loyaltyPointValue * 100) / 100;
      // Wave B4: promotions sit between the manual discount and
      // loyalty in the pipeline, so the bill a redemption may absorb
      // is what remains after BOTH discounts.
      if (loyaltyDiscount > subtotal - discountAmount - promotionDiscount + 0.001) {
        throw new HttpError(400, `Loyalty redemption of PKR ${loyaltyDiscount.toFixed(2)} exceeds the discounted bill of PKR ${(subtotal - discountAmount - promotionDiscount).toFixed(2)}`);
      }
    }

    const subtotalAfterDiscount = subtotal - discountAmount - promotionDiscount - loyaltyDiscount;
    // Tax classes (Wave B5): the tax on the discounted base is computed
    // PER CLASS by the tax engine (tax.util.ts) and the sale's taxAmount
    // is the sum of the per-class groups, which are persisted as
    // SaleTaxLine rows in the transaction below. A company with NO tax
    // classes keeps the legacy computation BYTE-IDENTICAL (one implicit
    // "Default" group at the defaultTax setting rate — still written as
    // a tax line, with taxClassId null, so reporting always has data).
    // A company WITH classes gets the engine even for a single group:
    // the engine's single-group path is the same unrounded formula,
    // applied at the resolved (default-class or setting) rate.
    let taxAmount: number;
    let taxGroups: TaxGroup[] = [];
    {
      // Resolve the company exactly the way the promotions stage did.
      let taxCompanyId: string | null = null;
      if (req.user?.selectedCompanyId && req.user?.selectedBranchId) {
        taxCompanyId = req.user.selectedCompanyId;
      } else if (saleData.branchId) {
        const branchRow = await prisma.branch.findUnique({
          where: { id: saleData.branchId },
          select: { companyId: true }
        });
        taxCompanyId = branchRow?.companyId || null;
      }
      let companyTaxClasses: any[] = [];
      if (taxCompanyId) {
        try {
          companyTaxClasses = await prisma.taxClass.findMany({
            where: { companyId: taxCompanyId }
          });
        } catch (taxClassError) {
          console.warn('Could not fetch tax classes, using the default rate:', taxClassError);
          companyTaxClasses = [];
        }
      }
      if (companyTaxClasses.length > 0) {
        const taxResult = computeSaleTax({
          lines: saleData.items.map((item, index) => ({
            lineTotal: itemTotals[index],
            taxClassId: taxClassByProductId.get(item.productId) ?? null
          })),
          classes: companyTaxClasses,
          defaultTaxRate: taxRate,
          subtotal,
          taxableBase: subtotalAfterDiscount
        });
        taxAmount = taxResult.taxAmount;
        taxGroups = taxResult.groups;
      } else {
        taxAmount = subtotalAfterDiscount * (taxRate / 100); // Tax on discounted amount
        taxGroups = [{
          taxClassId: null,
          className: IMPLICIT_DEFAULT_CLASS_NAME,
          rate: taxRate,
          taxableAmount: subtotalAfterDiscount,
          taxAmount
        }];
      }
    }
    const totalAmount = subtotalAfterDiscount + taxAmount;

    // Points this sale earns — the long-standing rule, unchanged:
    // 1 point per full PKR 100 of the FINAL total (so a redemption
    // slightly reduces what the same bill earns). Zero for walk-ins.
    const pointsEarned = saleData.customerId ? Math.floor(totalAmount / 100) : 0;

    // Resolve payment status and the stored paidAmount BEFORE the
    // transaction: the split-tender validation below must mirror
    // exactly the paidAmount the sale will be stored with (the
    // client-sent value, or the full total for a COMPLETED sale).
    const paymentStatus: PaymentStatus = (saleData.paymentStatus || 'COMPLETED') as PaymentStatus;
    const paidAmount = saleData.paidAmount || (paymentStatus === 'COMPLETED' ? totalAmount : 0);

    // Split tender (Wave B1): when the client sends allocations, their
    // sum must equal the amount being paid. When it doesn't, the sale
    // is rejected with a clear 400 instead of storing books that don't
    // balance. The headline paymentMethod becomes 'MIXED' for a
    // multi-method split, or the single allocation's method.
    const round2 = (n: number) => Math.round(n * 100) / 100;
    let allocations: Array<{ method: string; amount: number; reference?: string | null }> | null = null;
    if (Array.isArray(saleData.payments) && saleData.payments.length > 0) {
      allocations = saleData.payments.map(p => ({
        method: String(p.method).toUpperCase(),
        amount: round2(Number(p.amount) || 0),
        reference: p.reference ? String(p.reference) : null
      }));
      const allocatedTotal = round2(allocations.reduce((sum, p) => sum + p.amount, 0));
      if (Math.abs(allocatedTotal - round2(paidAmount)) > 0.01) {
        throw new HttpError(400, `Split payments total PKR ${allocatedTotal.toFixed(2)} must equal the amount paid PKR ${round2(paidAmount).toFixed(2)}`);
      }
    }
    const effectivePaymentMethod = allocations
      ? (new Set(allocations.map(p => p.method)).size > 1 ? 'MIXED' : allocations[0].method)
      : saleData.paymentMethod;

    // Use transaction to ensure data consistency
    // Wrap in try-catch to handle transaction errors gracefully
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
      // Use selected company/branch context if available, otherwise use the provided branchId
      let targetCompanyId: string;
      let targetBranchId: string;

      if (req.user?.selectedCompanyId && req.user?.selectedBranchId) {
        // Use selected company/branch context
        targetCompanyId = req.user.selectedCompanyId;
        targetBranchId = req.user.selectedBranchId;
        console.log('🏢 Using selected company/branch context for sale:', { targetCompanyId, targetBranchId });
      } else {
        // Fallback to provided branchId
        const branch = await tx.branch.findUnique({
          where: { id: saleData.branchId },
          select: { companyId: true }
        });

        if (!branch) {
          throw new Error('Branch not found');
        }

        targetCompanyId = branch.companyId;
        targetBranchId = saleData.branchId;
        console.log('🏢 Using provided branch context for sale:', { targetCompanyId, targetBranchId });
      }

      // Payment status and paidAmount were resolved before the
      // transaction (split-tender validation depends on them).
      const saleStatus = paymentStatus === 'COMPLETED' ? 'COMPLETED' : 'PENDING';
      const returnedAmount = saleData.returnedAmount || 0;

      // Generate invoice number with retry logic to handle race conditions
      const generateUniqueInvoiceNumber = async (attempt: number = 0): Promise<string> => {
        if (attempt > 10) {
          // After 10 attempts, use timestamp-based unique number
          const timestamp = Date.now().toString().slice(-8);
          return `INV-${timestamp}`;
        }

      // Get the last invoice number to increment, or start from 10000
      const lastSale = await tx.sale.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { invoiceNumber: true }
      });

        let baseNumber: number;
      if (lastSale?.invoiceNumber) {
        // Extract number from last invoice (format: INV-XXXXX)
        const match = lastSale.invoiceNumber.match(/INV-(\d+)/);
        if (match) {
            baseNumber = parseInt(match[1], 10);
        } else {
            // Fallback: use random number
            baseNumber = Math.floor(Math.random() * 90000) + 10000;
        }
      } else {
        // First invoice: start from 10000
          baseNumber = 10000;
        }

        // Add attempt offset to handle concurrent requests
        const nextNumber = ((baseNumber + attempt) % 99999) || 10000;
        const invoiceNumber = `INV-${String(nextNumber).padStart(5, '0')}`;

        // Check if invoice number already exists (race condition check)
        const existingSale = await tx.sale.findUnique({
          where: { invoiceNumber: invoiceNumber },
          select: { id: true }
        });

        if (existingSale) {
          // Invoice number exists, retry with incremented attempt
          return generateUniqueInvoiceNumber(attempt + 1);
        }

        return invoiceNumber;
      };

      const invoiceNumber = await generateUniqueInvoiceNumber();

      // Create sale
      let sale;
      try {
        sale = await tx.sale.create({
        data: {
          invoiceNumber: invoiceNumber,
          customerId: saleData.customerId,
          userId: userId,
          branchId: targetBranchId,
          companyId: targetCompanyId,
          createdBy: req.user?.createdBy || req.user?.id || 'default-admin-id',
          subtotal,
          taxAmount,
          discountAmount: discountAmount,
          discountPercentage: saleData.discountPercentage || 0,
          // Loyalty (Wave B3): redemption facts + points earned, so
          // refunds/deletion can reverse exactly (null when n/a).
          loyaltyPointsRedeemed: loyaltyPointsToRedeem > 0 ? loyaltyPointsToRedeem : null,
          loyaltyDiscount: loyaltyDiscount > 0 ? loyaltyDiscount : null,
          loyaltyPointsEarned: saleData.customerId ? pointsEarned : null,
          // Promotions (Wave B4): the engine's total (BXGY + the
          // order-level winner); per-promotion rows are written below.
          promotionDiscount: promotionDiscount > 0 ? promotionDiscount : null,
          totalAmount,
          paidAmount: paidAmount,
          returnedAmount: returnedAmount,
          paymentMethod: effectivePaymentMethod,
          paymentStatus: paymentStatus,
          status: saleStatus,
          saleDate: saleData.saleDate ? new Date(saleData.saleDate) : undefined
        }
      });
      } catch (error: any) {
        // If unique constraint error, retry with new invoice number
        if (error.code === 'P2002' && error.meta?.target?.includes('invoiceNumber')) {
          console.log('⚠️ Invoice number collision detected, retrying with new number...');
          const newInvoiceNumber = await generateUniqueInvoiceNumber(1);
          sale = await tx.sale.create({
            data: {
              invoiceNumber: newInvoiceNumber,
              customerId: saleData.customerId,
              userId: userId,
              branchId: targetBranchId,
              companyId: targetCompanyId,
              createdBy: req.user?.createdBy || req.user?.id || 'default-admin-id',
              subtotal,
              taxAmount,
              discountAmount: discountAmount,
              discountPercentage: saleData.discountPercentage || 0,
              loyaltyPointsRedeemed: loyaltyPointsToRedeem > 0 ? loyaltyPointsToRedeem : null,
              loyaltyDiscount: loyaltyDiscount > 0 ? loyaltyDiscount : null,
              loyaltyPointsEarned: saleData.customerId ? pointsEarned : null,
              promotionDiscount: promotionDiscount > 0 ? promotionDiscount : null,
              totalAmount,
              paidAmount: paidAmount,
              returnedAmount: returnedAmount,
              paymentMethod: effectivePaymentMethod,
              paymentStatus: paymentStatus,
              status: saleStatus,
              saleDate: saleData.saleDate ? new Date(saleData.saleDate) : undefined
            }
          });
        } else {
          throw error;
        }
      }

      const actorMembershipId = req.membership?.id ? String(req.membership.id) : null;
      if (actorMembershipId) {
        try {
          await tx.$executeRaw`
            UPDATE sales
            SET "membershipId" = ${actorMembershipId},
                "updatedAt" = CURRENT_TIMESTAMP,
                "syncStatus" = 'PENDING'
            WHERE id = ${sale.id}
          `;
        } catch (membershipColumnError: any) {
          if (!isMissingMembershipColumnError(membershipColumnError)) {
            throw membershipColumnError;
          }
          console.warn('[Sales] membership_id write skipped (schema not ready):', membershipColumnError?.message || membershipColumnError);
        }
      }

      // Persist the tender allocations (Wave B1) in the same
      // transaction: the client's split when one was sent, otherwise a
      // single synthesized allocation from paymentMethod + paidAmount
      // so every paid sale carries its tender breakdown. Unpaid sales
      // (paidAmount 0) get none — nothing was tendered.
      const paymentsToPersist = allocations
        ?? (paidAmount > 0
          ? [{ method: saleData.paymentMethod, amount: round2(paidAmount), reference: null as string | null }]
          : []);
      if (paymentsToPersist.length > 0) {
        await tx.salePayment.createMany({
          data: paymentsToPersist.map(p => ({
            saleId: sale.id,
            method: p.method,
            amount: p.amount,
            reference: p.reference || null
          }))
        });
      }

      // Promotions (Wave B4): record the redemptions the engine
      // granted and consume one use of each, in the same transaction.
      // The promotions are re-read under the transaction's own
      // company scope and the usage limit is re-checked here: the
      // pre-transaction evaluation could have raced another sale
      // consuming the last use. A coupon that lost that race fails
      // the sale with a 400 (the customer explicitly asked for it);
      // an automatic promotion fails it with a 409 asking for a
      // retry, at which point the engine simply will not offer it.
      // Either way the totals above are never stored unbalanced.
      if (promotionEvaluation && promotionEvaluation.applied.length > 0) {
        for (const appliedPromo of promotionEvaluation.applied) {
          const fresh = await tx.promotion.findFirst({
            where: { id: appliedPromo.promotion.id, companyId: targetCompanyId },
            select: { id: true, code: true, usedCount: true, usageLimit: true }
          });
          if (!fresh) {
            throw new HttpError(409, 'A promotion on this sale is no longer available — please retry');
          }
          if (fresh.usageLimit !== null && fresh.usageLimit !== undefined && fresh.usedCount >= fresh.usageLimit) {
            if (appliedPromo.source === 'COUPON') {
              throw new HttpError(400, `Coupon code "${fresh.code || couponCode || ''}" has reached its usage limit`);
            }
            throw new HttpError(409, 'A promotion on this sale has reached its usage limit — please retry');
          }
          await tx.promotion.update({
            where: { id: fresh.id },
            data: { usedCount: { increment: 1 } }
          });
          await tx.salePromotion.create({
            data: {
              saleId: sale.id,
              promotionId: fresh.id,
              discountAmount: appliedPromo.discountAmount,
              code: fresh.code || null
            }
          });
        }
      }

      // Tax classes (Wave B5): persist the per-class breakdown the
      // engine computed, in the same transaction. The rows snapshot
      // class name + rate, so later class edits never rewrite this
      // sale's tax history; Sale.taxAmount above is their sum.
      if (taxGroups.length > 0) {
        await tx.saleTaxLine.createMany({
          data: taxGroups.map(g => ({
            saleId: sale.id,
            taxClassId: g.taxClassId,
            className: g.className,
            rate: g.rate,
            taxableAmount: g.taxableAmount,
            taxAmount: g.taxAmount
          }))
        });
      }

      // Create sale items and update stock
      const saleItems = [];
      for (let itemIndex = 0; itemIndex < saleData.items.length; itemIndex++) {
        const item = saleData.items[itemIndex];
        const normalizedSaleType = (item.saleType || 'UNIT').toString().toUpperCase();
        const unitsPerBox = item.unitsPerBox && item.unitsPerBox > 0 ? item.unitsPerBox : 1;
        const unitsRequired = item.unitsDeducted && item.unitsDeducted > 0
          ? item.unitsDeducted
          : (normalizedSaleType === 'BOX' ? item.quantity * unitsPerBox : item.quantity);

        // Check product availability
        console.log(`Looking for product with ID: ${item.productId}`);
        const product = await tx.product.findUnique({
          where: { id: item.productId }
        });

        if (!product) {
          // Get all products to see what IDs exist
          const allProducts = await tx.product.findMany({
            select: { id: true, name: true }
          });
          console.log('Available products:', allProducts);
          throw new Error(`Product with ID ${item.productId} not found`);
        }

        // Check stock availability through batches
        // Use explicit select to avoid reportReason column issues
        const availableBatches = await tx.batch.findMany({
          where: {
            productId: item.productId,
            branchId: targetBranchId,
            quantity: { gt: 0 },
            isActive: true
          },
          orderBy: { expireDate: 'asc' }, // FIFO - First In, First Out
          select: {
            id: true,
            productId: true,
            branchId: true,
            batchNo: true,
            quantity: true,
            expireDate: true,
            productionDate: true,
            sellingPrice: true,
            purchasePrice: true,
            isActive: true,
            isReported: true,
            createdAt: true,
            updatedAt: true
          }
        });

        const totalAvailableStock = availableBatches.reduce((sum: number, batch: any) => sum + batch.quantity, 0);

        if (totalAvailableStock < unitsRequired) {
          throw new HttpError(422, `Insufficient stock for ${product.name}. Available: ${totalAvailableStock}, Required: ${unitsRequired}`);
        }

        // Handle batch tracking (require a batch, fallback to FIFO if missing)
        // Use explicit select to avoid reportReason column issues
        let selectedBatch = null as any;
        if (item.batchId) {
          selectedBatch = await tx.batch.findFirst({
            where: {
              id: item.batchId,
              productId: item.productId,
              branchId: targetBranchId,
              isActive: true
            },
            select: {
              id: true,
              productId: true,
              branchId: true,
              batchNo: true,
              quantity: true,
              expireDate: true,
              productionDate: true,
              sellingPrice: true,
              purchasePrice: true,
              isActive: true,
              isReported: true,
              createdAt: true,
              updatedAt: true
            }
          });
          if (!selectedBatch) {
            throw new Error(`Selected batch not found for ${product.name}.`);
          }
          if (selectedBatch.quantity < unitsRequired) {
            throw new HttpError(422, `Insufficient stock in selected batch ${selectedBatch.batchNo}. Available: ${selectedBatch.quantity}, Required: ${unitsRequired}`);
          }
        } else if (item.batchNumber) {
          selectedBatch = await tx.batch.findFirst({
            where: {
              batchNo: item.batchNumber,
              productId: item.productId,
              branchId: targetBranchId,
              quantity: {
                gte: unitsRequired
              },
              isActive: true
            },
            orderBy: { expireDate: 'asc' }, // FIFO - First In, First Out
            select: {
              id: true,
              productId: true,
              branchId: true,
              batchNo: true,
              quantity: true,
              expireDate: true,
              productionDate: true,
              sellingPrice: true,
              purchasePrice: true,
              isActive: true,
              isReported: true,
              createdAt: true,
              updatedAt: true
            }
          });
          if (!selectedBatch) {
            throw new HttpError(422, `Batch ${item.batchNumber} not available with sufficient stock for ${product.name}. Required: ${unitsRequired} units.`);
          }
        } else {
          selectedBatch = await tx.batch.findFirst({
            where: {
              productId: item.productId,
              branchId: targetBranchId,
              quantity: {
                gte: unitsRequired
              },
              isActive: true
            },
            orderBy: { expireDate: 'asc' }, // FIFO - First In, First Out
            select: {
              id: true,
              productId: true,
              branchId: true,
              batchNo: true,
              quantity: true,
              expireDate: true,
              productionDate: true,
              sellingPrice: true,
              purchasePrice: true,
              isActive: true,
              isReported: true,
              createdAt: true,
              updatedAt: true
            }
          });
          if (!selectedBatch) {
            throw new HttpError(422, `No batch available with sufficient stock for ${product.name}. Required: ${unitsRequired} units.`);
          }
        }

        // Never sell expired stock: the batch this line resolves to — the
        // explicitly selected one or the FIFO choice — must be in date
        // (Batch.expireDate, per the Prisma schema).
        if (selectedBatch.expireDate && new Date(selectedBatch.expireDate).getTime() < Date.now()) {
          throw new HttpError(422, `Cannot sell expired batch ${selectedBatch.batchNo} for ${product.name} (expired ${new Date(selectedBatch.expireDate).toISOString().slice(0, 10)})`);
        }

        // Decrement stock atomically (A-16): the update only applies while
        // the batch still holds enough units, so two concurrent sales can
        // no longer both pass the availability check on the same snapshot
        // and drive the batch negative.
        const decrementResult = await tx.batch.updateMany({
          where: {
            id: selectedBatch.id,
            quantity: { gte: unitsRequired }
          },
          data: {
            quantity: { decrement: unitsRequired }
          }
        });

        if (decrementResult.count !== 1) {
          throw new HttpError(422, `Insufficient stock for ${product.name}. Available: ${selectedBatch.quantity}, Required: ${unitsRequired}`);
        }

        // Create sale item — totalPrice is the server-computed line total
        // (quantity × unitPrice − item discount) from itemTotals above
        // (A-04); any client-sent totalPrice was already discarded there.
        const calculatedTotalPrice = itemTotals[itemIndex];

        const saleItem = await tx.saleItem.create({
          data: {
            saleId: sale.id,
            productId: item.productId,
            batchId: selectedBatch.id,
            createdBy: req.user?.createdBy || req.user?.id || 'default-admin-id',
            quantity: item.quantity, // Boxes or units (as entered)
            unitsDeducted: unitsRequired,
            unitsPerBox: unitsPerBox,
            saleType: normalizedSaleType,
            unitPrice: item.unitPrice, // Price per unit or per box (as sent)
            totalPrice: calculatedTotalPrice, // Use provided totalPrice for correct box/unit calculation
            batchNumber: item.batchNumber || selectedBatch.batchNo,
            expiryDate: (() => {
              if (!item.expiryDate || item.expiryDate === 'Invalid Date') return null;
              const date = new Date(item.expiryDate);
              return isNaN(date.getTime()) ? null : date;
            })()
          }
        });

        saleItems.push(saleItem);

        // Update product stock
        // Stock is now managed through batches, no need to update product stock directly

        // Create stock movement
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            type: 'OUT',
            quantity: unitsRequired,
            reason: 'Sale',
            reference: sale.id,
            createdBy: req.user?.createdBy || req.user?.id || 'default-admin-id'
          }
        });
      }

      // Update customer stats if customer exists. Loyalty (Wave B3):
      // a redemption is validated against the balance read HERE,
      // inside the transaction — a pre-transaction check could race a
      // concurrent sale spending the same points. The cached balance
      // moves by (earned − redeemed) in this single update, and the
      // EARN / REDEEM ledger rows are written in the same transaction,
      // so the points ledger and the balance can never diverge.
      if (saleData.customerId) {
        if (loyaltyPointsToRedeem > 0) {
          const redeemingCustomer = await tx.customer.findUnique({
            where: { id: saleData.customerId },
            select: { loyaltyPoints: true }
          });
          if (!redeemingCustomer) {
            throw new HttpError(400, 'Customer not found for loyalty redemption');
          }
          if (loyaltyPointsToRedeem > redeemingCustomer.loyaltyPoints) {
            throw new HttpError(400, `Insufficient loyalty points: ${loyaltyPointsToRedeem} requested but the customer has ${redeemingCustomer.loyaltyPoints}`);
          }
        }
        await tx.customer.update({
          where: { id: saleData.customerId },
          data: {
            totalPurchases: {
              increment: totalAmount
            },
            loyaltyPoints: {
              increment: pointsEarned - loyaltyPointsToRedeem // earn (1 point per 100 PKR) minus points spent on this bill
            },
            lastVisit: new Date()
          }
        });
        if (pointsEarned > 0) {
          await recordLoyaltyTransaction(tx, {
            companyId: targetCompanyId,
            customerId: saleData.customerId,
            type: 'EARN',
            points: pointsEarned,
            saleId: sale.id,
            note: `Earned on invoice ${invoiceNumber}`,
            createdBy: req.user?.createdBy || req.user?.id || null
          });
        }
        if (loyaltyPointsToRedeem > 0) {
          await recordLoyaltyTransaction(tx, {
            companyId: targetCompanyId,
            customerId: saleData.customerId,
            type: 'REDEEM',
            points: -loyaltyPointsToRedeem,
            saleId: sale.id,
            note: `Redeemed on invoice ${invoiceNumber} for PKR ${loyaltyDiscount.toFixed(2)} off`,
            createdBy: req.user?.createdBy || req.user?.id || null
          });
        }
      }

      // Udhaar/khata (Wave B2): the unpaid part of a customer sale is
      // credit the shop has extended — record it on the customer's
      // ledger in this same transaction so the khata can never
      // disagree with the sale. A customer sale paid in full at the
      // counter writes no row.
      const dueAmount = round2(totalAmount - paidAmount);
      if (saleData.customerId && dueAmount > 0) {
        await tx.customerLedgerEntry.create({
          data: {
            companyId: targetCompanyId,
            customerId: saleData.customerId,
            type: 'SALE_DUE',
            amount: dueAmount,
            note: `Udhaar on invoice ${invoiceNumber}`,
            saleId: sale.id,
            createdBy: req.user?.createdBy || req.user?.id || null
          }
        });
      }

      // Generate receipt number - Short format: RCN-XXXXX (4-5 digits)
      // Get the last receipt number to increment, or start from 1
      const lastReceipt = await tx.receipt.findFirst({
        orderBy: { id: 'desc' }, // Use id for ordering since createdAt might not be available
        select: { receiptNumber: true }
      });

      let receiptNumber: string;
      if (lastReceipt?.receiptNumber) {
        // Extract number from last receipt (format: RCN-XXXXX)
        const match = lastReceipt.receiptNumber.match(/RCN-(\d+)/);
        if (match) {
          const lastNumber = parseInt(match[1], 10);
          const nextNumber = (lastNumber + 1) % 99999; // Wrap around at 99999
          receiptNumber = `RCN-${String(nextNumber).padStart(5, '0')}`;
        } else {
          // Fallback: generate random 4-5 digit number
          receiptNumber = `RCN-${String(Math.floor(Math.random() * 90000) + 10000)}`;
        }
      } else {
        // First receipt: start from 10000
        receiptNumber = `RCN-10000`;
      }

      // Create receipt
      const receipt = await tx.receipt.create({
        data: {
          saleId: sale.id,
          userId: userId,
          branchId: saleData.branchId,
          createdBy: req.user?.createdBy || req.user?.id || 'default-admin-id',
          receiptNumber
        }
      });

      return { sale, saleItems, receipt };
      }, {
        timeout: 60000 // 60 seconds timeout for long-running transactions
        // Note: SQLite only supports Serializable isolation level, so we omit isolationLevel
      });
    } catch (error: any) {
      // Handle transaction errors specifically
      if (error.code === 'P2028') {
        console.error('❌ Transaction timeout or connection lost:', error.message);
        return res.status(500).json({
          success: false,
          message: 'Transaction failed due to connection timeout. Please try again.',
          error: 'TRANSACTION_TIMEOUT'
        });
      }
      // Re-throw other errors to be handled by outer catch
      throw error;
    }

    // Fetch complete sale data with relations
    const completeSale = await prisma.sale.findUnique({
      where: { id: result.sale.id },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            totalPurchases: true,
            loyaltyPoints: true,
            isVIP: true,
            lastVisit: true
          }
        },
        user: {
          select: {
            id: true,
            name: true,
            username: true
          }
        },
        branch: {
          select: {
            id: true,
            name: true,
          }
        },
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                barcode: true
              }
            }
          }
        },
        receipts: {
          select: {
            id: true,
            receiptNumber: true,
            printedAt: true
          }
        },
        payments: true,
        taxLines: true,
        promotions: {
          include: {
            promotion: {
              select: {
                id: true,
                name: true,
                code: true,
                type: true
              }
            }
          }
        }
      }
    });

    if (!completeSale) {
      return res.status(500).json({
        success: false,
        message: 'Failed to fetch complete sale data'
      });
    }

    console.log('Complete sale data:', completeSale);
    console.log('Customer in sale:', completeSale.customer);

    // Send real-time notification to all users of the same admin
    const createdBy = req.user?.createdBy || req.user?.id;
    if (createdBy) {
      notifySaleChange(createdBy, 'created', completeSale);
    }

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('sale', 'create', completeSale).catch(err => {
      console.error('[Sync] Sale create sync failed:', err.message);
    });

    // Create notification for the sale
    createNotification({
      userId: createdBy || userId,
      businessId: req.membership?.business_id || req.headers['x-company-id'] as string || undefined,
      type: 'sale_created',
      title: 'New Sale Recorded',
      body: `Sale #${completeSale.invoiceNumber || completeSale.id?.slice(-8)} recorded for Rs. ${completeSale.totalAmount || 0}`,
      actionUrl: `/invoices`,
      metadata: { saleId: completeSale.id, amount: completeSale.totalAmount },
    }).catch(() => {});

    // FBR POS (Wave B7): the sale has committed — create its fiscal
    // outbox row (awaited, but the service is internally guarded and
    // returns null on any problem, so this can never fail or block
    // the sale) and kick an immediate posting attempt. The 201
    // carries the fiscal status so the POS receipt can show
    // "Fiscal: Pending" right away; the FBR number itself lands
    // asynchronously and appears on the invoice/reprint.
    let fbrStatus: string | null = completeSale.fbrStatus ?? null;
    let fbrInvoiceNumber: string | null = completeSale.fbrInvoiceNumber ?? null;
    const fbrRow = await enqueueFbrForSale(prisma, completeSale.id);
    if (fbrRow) {
      fbrStatus = fbrRow.status;
      attemptImmediateFbr(fbrRow.id);
    }

    return res.status(201).json({
      success: true,
      data: {
        ...completeSale,
        receiptNumber: result.receipt.receiptNumber,
        // Loyalty (Wave B3): friendly aliases over the stored columns
        // (loyaltyDiscount / loyaltyPointsRedeemed /
        // loyaltyPointsEarned ride along in the spread above) so POS
        // and receipt consumers get plain numbers, never null.
        loyaltyDiscount: completeSale.loyaltyDiscount ?? 0,
        pointsRedeemed: completeSale.loyaltyPointsRedeemed ?? 0,
        pointsEarned: completeSale.loyaltyPointsEarned ?? 0,
        // Promotions (Wave B4): the engine's total as a plain number
        // plus the per-promotion breakdown for receipts.
        promotionDiscount: completeSale.promotionDiscount ?? 0,
        appliedPromotions: (completeSale.promotions || []).map((sp: any) => ({
          promotionId: sp.promotionId,
          name: sp.promotion?.name || null,
          code: sp.code ?? sp.promotion?.code ?? null,
          type: sp.promotion?.type || null,
          discountAmount: sp.discountAmount
        })),
        // Tax classes (Wave B5): the per-class breakdown behind
        // taxAmount (one implicit "Default" group for classless sales).
        taxBreakdown: serializeTaxBreakdown(completeSale),
        // FBR POS (Wave B7): fiscal status at response time (the
        // number itself is filled in asynchronously by the worker).
        fbrStatus,
        fbrInvoiceNumber
      }
    });
  } catch (error) {
    console.error('Create sale error:', error);
    // Typed domain errors (insufficient stock, expired batch) carry their
    // own HTTP status (A-12); everything else stays a 500.
    const statusCode = (error as any)?.statusCode;
    return res.status(typeof statusCode === 'number' ? statusCode : 500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error'
    });
  }
};

export const updateSale = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const { discountPercentage, saleDate, notes, paymentStatus } = req.body;

    console.log('Update sale request:', { id, discountPercentage, saleDate, notes, paymentStatus });

    // Validate input
    if (discountPercentage !== undefined && (discountPercentage < 0 || discountPercentage > 100)) {
      return res.status(400).json({
        success: false,
        message: 'Discount percentage must be between 0 and 100'
      });
    }

    // Validate payment status if provided
    if (paymentStatus !== undefined && !['PENDING', 'COMPLETED', 'FAILED', 'REFUNDED'].includes(paymentStatus)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment status. Must be PENDING, COMPLETED, FAILED, or REFUNDED'
      });
    }

    // Get the existing sale — scoped to the caller's business (A-02), so a
    // sale from another tenant reads as "not found", same as the list
    const existingSale = await prisma.sale.findFirst({
      where: buildBranchWhereClause(req, { id }),
      include: {
        items: true,
        taxLines: true,
        customer: true,
        user: true,
        branch: true,
        company: true
      }
    });

    if (!existingSale) {
      return res.status(404).json({
        success: false,
        message: 'Sale not found'
      });
    }

    const userRole = getUserRole(req);

    // Check if user has permission to update this sale
    const canUpdate = userRole === 'OWNER' ||
      (userRole === 'MANAGER' && existingSale.userId === req.user?.id) ||
      (userRole === 'CASHIER' && existingSale.userId === req.user?.id);

    if (!canUpdate) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to update this sale'
      });
    }

    // Calculate new totals if discount percentage changed
    let newDiscountAmount = existingSale.discountAmount;
    let newTaxAmount = existingSale.taxAmount;
    let newTotalAmount = existingSale.totalAmount;
    // Tax classes (Wave B5): the per-class groups behind newTaxAmount
    // when a discount edit recomputes it (null = tax untouched, the
    // stored breakdown stays as created).
    let newTaxGroups: TaxGroup[] | null = null;

    if (discountPercentage !== undefined && discountPercentage !== existingSale.discountPercentage) {
      newDiscountAmount = (existingSale.subtotal * discountPercentage) / 100;
      // Loyalty (Wave B3): the sale's stored loyalty discount is a
      // component of its total (points were already deducted for it),
      // so the recompute must keep subtracting it — dropping it here
      // would silently re-bill the customer for points they spent.
      // Promotions (Wave B4): the stored promotion discount is a
      // component in exactly the same sense (the offers were granted
      // and their usage consumed at creation), so it is subtracted
      // as stored too. The manual percentage keeps this handler's
      // long-standing base (the stored subtotal); a discount edit
      // never re-runs the promotions engine.
      const subtotalAfterDiscount = existingSale.subtotal - newDiscountAmount - Number(existingSale.promotionDiscount || 0) - Number(existingSale.loyaltyDiscount || 0);
      // Recompute tax exactly as the create path does: the admin's
      // defaultTax setting applied to the discounted subtotal. (This used
      // to hard-zero the tax — `subtotalAfterDiscount * 0` — silently
      // wiping tax from every discount-edited invoice.)
      let taxRate = 0;
      const currentAdminId = req.user?.createdBy || req.user?.id;
      if (currentAdminId) {
        try {
          const taxSetting = await prisma.settings.findUnique({
            where: {
              createdBy_key: {
                createdBy: currentAdminId,
                key: 'defaultTax'
              }
            }
          });

          if (taxSetting) {
            taxRate = parseFloat(taxSetting.value);
          }
        } catch (error) {
          console.warn('Could not fetch tax rate from settings, using default:', error);
        }
      }
      // Tax classes (Wave B5): recompute through the same per-class
      // engine createSale uses, over the sale's STORED lines (their
      // totalPrice shares of the stored subtotal), resolving each
      // product's CURRENT class — the same "current rules" basis the
      // legacy code applied by re-reading the current defaultTax. A
      // company with no classes keeps the legacy single-rate formula
      // (and an implicit Default group, so its stored breakdown is
      // refreshed to match). The replacement rows are written after
      // the sale update below.
      let taxClassesForUpdate: any[] = [];
      try {
        taxClassesForUpdate = await prisma.taxClass.findMany({
          where: { companyId: existingSale.companyId }
        });
      } catch (taxClassError) {
        console.warn('Could not fetch tax classes for sale update, using the default rate:', taxClassError);
        taxClassesForUpdate = [];
      }
      if (taxClassesForUpdate.length > 0) {
        const lineProductIds = [...new Set(existingSale.items.map((i: any) => i.productId))];
        const lineProducts = await prisma.product.findMany({
          where: { id: { in: lineProductIds } },
          select: { id: true, taxClassId: true }
        });
        const classByProductId = new Map<string, string | null>(
          lineProducts.map((p: any) => [p.id, p.taxClassId || null])
        );
        const taxResult = computeSaleTax({
          lines: existingSale.items.map((i: any) => ({
            lineTotal: Number(i.totalPrice || 0),
            taxClassId: classByProductId.get(i.productId) ?? null
          })),
          classes: taxClassesForUpdate,
          defaultTaxRate: taxRate,
          subtotal: existingSale.subtotal,
          taxableBase: subtotalAfterDiscount
        });
        newTaxAmount = taxResult.taxAmount;
        newTaxGroups = taxResult.groups;
      } else {
        newTaxAmount = subtotalAfterDiscount * (taxRate / 100); // Tax on discounted amount
        newTaxGroups = [{
          taxClassId: null,
          className: IMPLICIT_DEFAULT_CLASS_NAME,
          rate: taxRate,
          taxableAmount: subtotalAfterDiscount,
          taxAmount: newTaxAmount
        }];
      }
      newTotalAmount = subtotalAfterDiscount + newTaxAmount;
    }

    // Determine new payment status and sale status
    const newPaymentStatus: PaymentStatus = (paymentStatus || existingSale.paymentStatus) as PaymentStatus;
    const newSaleStatus = newPaymentStatus === 'COMPLETED' ? 'COMPLETED' :
      newPaymentStatus === 'PENDING' ? 'PENDING' :
        existingSale.status;

    // Update the sale
    const updatedSale = await prisma.sale.update({
      where: { id },
      data: {
        discountPercentage: discountPercentage !== undefined ? discountPercentage : existingSale.discountPercentage,
        discountAmount: newDiscountAmount,
        taxAmount: newTaxAmount,
        totalAmount: newTotalAmount,
        paymentStatus: newPaymentStatus,
        status: newSaleStatus,
        saleDate: saleDate ? new Date(saleDate) : existingSale.saleDate,
        updatedAt: new Date()
      },
      include: {
        items: {
          include: {
            product: true
          }
        },
        customer: true,
        user: true,
        branch: true,
        company: true,
        receipts: true
      }
    });

    // Tax lines (Wave B5): when the discount edit recomputed the tax,
    // replace the stored per-class rows so the breakdown always sums
    // to the sale's taxAmount. This handler is not transactional (the
    // update above is a single statement), so a failure is logged
    // loudly but never fails the edit itself — the khata pattern.
    if (newTaxGroups) {
      try {
        await prisma.saleTaxLine.deleteMany({ where: { saleId: id } });
        if (newTaxGroups.length > 0) {
          await prisma.saleTaxLine.createMany({
            data: newTaxGroups.map(g => ({
              saleId: id,
              taxClassId: g.taxClassId,
              className: g.className,
              rate: g.rate,
              taxableAmount: g.taxableAmount,
              taxAmount: g.taxAmount
            }))
          });
        }
      } catch (taxLineError) {
        console.error('[Tax] Failed to refresh tax lines for sale', id, taxLineError);
      }
    }

    // Udhaar/khata (Wave B2): updateSale never changes paidAmount, but
    // a discount edit changes the total — and with it the unpaid part
    // of a customer sale. Post the delta as a compensating SALE_DUE
    // row so the ledger keeps matching the sale's outstanding due.
    // Skipped for fully-refunded sales: their due was already settled
    // by REFUND rows, and a delta here would double-count it. This
    // handler is not transactional (the update above is a single
    // statement), so a ledger failure is logged loudly but never
    // allowed to fail the sale edit itself.
    if (existingSale.customerId && existingSale.status !== 'REFUNDED' && newTotalAmount !== existingSale.totalAmount) {
      const paid = Number(existingSale.paidAmount || 0);
      const oldDue = Math.max(0, existingSale.totalAmount - paid);
      const newDue = Math.max(0, newTotalAmount - paid);
      const delta = Math.round((newDue - oldDue) * 100) / 100;
      if (delta !== 0) {
        try {
          await prisma.customerLedgerEntry.create({
            data: {
              companyId: existingSale.companyId,
              customerId: existingSale.customerId,
              type: 'SALE_DUE',
              amount: delta,
              note: `Invoice ${existingSale.invoiceNumber || existingSale.id} total changed by discount edit`,
              saleId: existingSale.id,
              createdBy: req.user?.id || null
            }
          });
        } catch (ledgerError) {
          console.error('[Khata] Failed to post discount-edit delta for sale', existingSale.id, ledgerError);
        }
      }
    }

    // Convert BigInt values to strings for JSON serialization
    const serializedSale = {
      ...updatedSale,
      id: updatedSale.id.toString(),
      userId: updatedSale.userId.toString(),
      branchId: updatedSale.branchId.toString(),
      companyId: updatedSale.companyId.toString(),
      customerId: updatedSale.customerId?.toString() || null,
      subtotal: Number(updatedSale.subtotal),
      taxAmount: Number(updatedSale.taxAmount),
      discountAmount: Number(updatedSale.discountAmount),
      discountPercentage: updatedSale.discountPercentage ? Number(updatedSale.discountPercentage) : null,
      totalAmount: Number(updatedSale.totalAmount),
      paidAmount: Number(updatedSale.paidAmount || 0),
      returnedAmount: Number(updatedSale.returnedAmount || 0),
      createdAt: updatedSale.createdAt.toISOString(),
      updatedAt: updatedSale.updatedAt.toISOString(),
      saleDate: updatedSale.saleDate?.toISOString() || null,
      items: updatedSale.items.map((item: any) => ({
        ...item,
        id: item.id.toString(),
        saleId: item.saleId.toString(),
        productId: item.productId.toString(),
        batchId: item.batchId?.toString() || null,
        createdBy: item.createdBy?.toString() || null,
        quantity: Number(item.quantity),
        unitPrice: Number(item.unitPrice),
        totalPrice: Number(item.totalPrice),
        product: {
          ...item.product,
          id: item.product.id.toString(),
          branchId: item.product.branchId.toString(),
          companyId: item.product.companyId.toString(),
          categoryId: item.product.categoryId?.toString() || null,
          createdBy: item.product.createdBy?.toString() || null,
          // costPrice, sellingPrice, and stock are now managed through batches
          minStock: Number(item.product.minStock),
          maxStock: Number(item.product.maxStock),
          createdAt: item.product.createdAt.toISOString(),
          updatedAt: item.product.updatedAt.toISOString()
        }
      })),
      customer: updatedSale.customer ? {
        ...updatedSale.customer,
        id: updatedSale.customer.id.toString(),
        branchId: updatedSale.customer.branchId.toString(),
        companyId: updatedSale.customer.companyId.toString(),
        createdBy: updatedSale.customer.createdBy?.toString() || null,
        totalPurchases: Number(updatedSale.customer.totalPurchases),
        loyaltyPoints: Number(updatedSale.customer.loyaltyPoints),
        createdAt: updatedSale.customer.createdAt.toISOString(),
        updatedAt: updatedSale.customer.updatedAt.toISOString()
      } : null,
      user: {
        ...updatedSale.user,
        id: updatedSale.user.id.toString(),
        branchId: updatedSale.branchId?.toString() || null,
        companyId: updatedSale.companyId?.toString() || null,
        createdBy: updatedSale.user.createdBy?.toString() || null,
        createdAt: updatedSale.user.createdAt.toISOString(),
        updatedAt: updatedSale.user.updatedAt.toISOString()
      },
      branch: {
        ...updatedSale.branch,
        id: updatedSale.branch.id.toString(),
        companyId: updatedSale.branch.companyId.toString(),
        createdBy: updatedSale.branch.createdBy?.toString() || null,
        createdAt: updatedSale.branch.createdAt.toISOString(),
        updatedAt: updatedSale.branch.updatedAt.toISOString()
      },
      company: {
        ...updatedSale.company,
        id: updatedSale.company.id.toString(),
        createdBy: updatedSale.company.createdBy?.toString() || null,
        createdAt: updatedSale.company.createdAt.toISOString(),
        updatedAt: updatedSale.company.updatedAt.toISOString()
      },
      receipts: updatedSale.receipts.map((receipt: any) => ({
        ...receipt,
        id: receipt.id.toString(),
        saleId: receipt.saleId.toString(),
        printedAt: receipt.printedAt?.toISOString() || null
      })),
      // Tax classes (Wave B5): the fresh groups when the edit
      // recomputed tax, else the breakdown stored at creation.
      taxBreakdown: newTaxGroups
        ? newTaxGroups.map(g => ({
          taxClassId: g.taxClassId,
          className: g.className,
          rate: g.rate,
          taxableAmount: g.taxableAmount,
          taxAmount: g.taxAmount
        }))
        : serializeTaxBreakdown(existingSale)
    };

    // Notify about the update
    const createdBy = req.user?.createdBy || req.user?.id;
    if (createdBy) {
      notifySaleChange(createdBy, 'updated', serializedSale);
    }

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('sale', 'update', updatedSale).catch(err => {
      console.error('[Sync] Sale update sync failed:', err.message);
    });

    return res.json({
      success: true,
      data: serializedSale
    });

  } catch (error) {
    console.error('Update sale error:', error);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error'
    });
  }
};

export const deleteSale = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    // Get the existing sale — scoped to the caller's business (A-02), so a
    // sale from another tenant reads as "not found", same as the list
    const existingSale = await prisma.sale.findFirst({
      where: buildBranchWhereClause(req, { id }),
      include: {
        items: true,
        customer: true,
        user: true,
        branch: true,
        company: true,
        receipts: true
      }
    });

    if (!existingSale) {
      return res.status(404).json({
        success: false,
        message: 'Sale not found'
      });
    }

    const userRole = getUserRole(req);

    // Check if user has permission to delete this sale
    const canDelete = userRole === 'OWNER' ||
      (userRole === 'MANAGER' && existingSale.userId === req.user?.id) ||
      (userRole === 'CASHIER' && existingSale.userId === req.user?.id);

    if (!canDelete) {
      return res.status(403).json({
        success: false,
        message: 'You do not have permission to delete this sale'
      });
    }

    // Use transaction to ensure data consistency
    await prisma.$transaction(async (tx: any) => {
      // Delete sale items first (foreign key constraint)
      await tx.saleItem.deleteMany({
        where: { saleId: id }
      });

      // Delete receipts
      await tx.receipt.deleteMany({
        where: { saleId: id }
      });

      // Restore stock from batches if sale was completed
      if (existingSale.status === 'COMPLETED') {
        for (const item of existingSale.items) {
          if (item.batchId) {
            // Restore quantity to batch
            // Update batch quantity - use raw SQL directly to avoid reportReason column issues
            await tx.$executeRawUnsafe(
              `UPDATE batches 
               SET quantity = quantity + ${item.quantity},
                   "updatedAt" = CURRENT_TIMESTAMP
               WHERE id = '${item.batchId}'`
            );

            // Create stock movement for restoration
            await tx.stockMovement.create({
              data: {
                productId: item.productId,
                type: 'IN',
                quantity: item.quantity,
                reason: 'Sale Deletion - Stock Restored',
                reference: id,
                createdBy: req.user?.createdBy || req.user?.id || 'default-admin-id'
              }
            });
          }
        }

        // Update customer stats if customer exists. Loyalty (Wave
        // B3): reverse what this sale STILL contributes to the points
        // balance — its earned points minus any earn a refund already
        // clawed back, and its redeemed points minus any a refund
        // already re-credited (the sale's REVERSAL rows are summed by
        // sign) — so a refund-then-delete never reverses the same
        // points twice. With no prior refunds the earn side is exactly
        // the old decrement (floor(total/100)); the redeemed points
        // also come back, since the sale is treated as never having
        // happened. The clawback is floored at what the balance (after
        // the re-credit) still holds — points already spent on later
        // bills are gone — and only the actual reversed amounts are
        // ledgered, in this same transaction.
        if (existingSale.customerId) {
          const earnedForSale = loyaltyPointsEarnedForSale(existingSale);
          const redeemedForSale = existingSale.loyaltyPointsRedeemed || 0;
          const priorReversals = await tx.loyaltyTransaction.findMany({
            where: { saleId: id, type: 'REVERSAL' },
            select: { points: true }
          });
          const alreadyClawed = priorReversals
            .filter((r: any) => r.points < 0)
            .reduce((sum: number, r: any) => sum - r.points, 0);
          const alreadyRecredited = priorReversals
            .filter((r: any) => r.points > 0)
            .reduce((sum: number, r: any) => sum + r.points, 0);
          const remainingRedeemed = Math.max(0, redeemedForSale - alreadyRecredited);
          const customerRow = await tx.customer.findUnique({
            where: { id: existingSale.customerId },
            select: { loyaltyPoints: true }
          });
          const remainingEarn = Math.min(
            Math.max(0, earnedForSale - alreadyClawed),
            (customerRow?.loyaltyPoints || 0) + remainingRedeemed
          );

          await tx.customer.update({
            where: { id: existingSale.customerId },
            data: {
              totalPurchases: {
                decrement: existingSale.totalAmount
              },
              loyaltyPoints: {
                increment: remainingRedeemed - remainingEarn
              }
            }
          });
          if (remainingEarn > 0) {
            await recordLoyaltyTransaction(tx, {
              companyId: existingSale.companyId,
              customerId: existingSale.customerId,
              type: 'REVERSAL',
              points: -remainingEarn,
              saleId: id,
              note: `Invoice ${existingSale.invoiceNumber || id} deleted — earned points reversed`,
              createdBy: req.user?.id || null
            });
          }
          if (remainingRedeemed > 0) {
            await recordLoyaltyTransaction(tx, {
              companyId: existingSale.companyId,
              customerId: existingSale.customerId,
              type: 'REVERSAL',
              points: remainingRedeemed,
              saleId: id,
              note: `Invoice ${existingSale.invoiceNumber || id} deleted — redeemed points restored`,
              createdBy: req.user?.id || null
            });
          }
        }
      }

      // Udhaar/khata (Wave B2): reverse whatever this sale still
      // contributes to the customer's due — the SUM of its own ledger
      // rows (SALE_DUE posts minus REFUND offsets) — so deleting the
      // sale cannot leave phantom udhaar behind. Runs for every sale
      // status: a PENDING credit sale carries due too, even though the
      // stock/stats reversal above is COMPLETED-only. The row's
      // saleId is SetNull by the delete below; its note keeps the
      // invoice number readable on the statement.
      if (existingSale.customerId) {
        const saleLedger = await tx.customerLedgerEntry.aggregate({
          where: {
            saleId: id,
            type: { in: ['SALE_DUE', 'REFUND'] }
          },
          _sum: { amount: true }
        });
        const netSaleDue = Math.round((saleLedger._sum.amount || 0) * 100) / 100;
        if (netSaleDue > 0) {
          await tx.customerLedgerEntry.create({
            data: {
              companyId: existingSale.companyId,
              customerId: existingSale.customerId,
              type: 'SALE_DUE',
              amount: -netSaleDue,
              note: `Invoice ${existingSale.invoiceNumber || id} deleted — udhaar reversed`,
              saleId: id,
              createdBy: req.user?.id || null
            }
          });
        }
      }

      // Promotions (Wave B4): a deleted sale never happened, so the
      // uses it consumed go back — one decrement per SalePromotion
      // row (the rows themselves cascade away with the sale below).
      // Runs for every status: usage was consumed at creation time
      // regardless of payment status, symmetrically.
      const salePromoRows = await tx.salePromotion.findMany({
        where: { saleId: id },
        select: { promotionId: true }
      });
      for (const row of salePromoRows) {
        await tx.promotion.updateMany({
          where: { id: row.promotionId, usedCount: { gt: 0 } },
          data: { usedCount: { decrement: 1 } }
        });
      }

      // Delete the sale
      await tx.sale.delete({
        where: { id }
      });
    }, {
      timeout: 60000 // 60 seconds timeout for long-running transactions
      // Note: SQLite only supports Serializable isolation level, so we omit isolationLevel
    });

    // Send real-time notification
    const createdBy = req.user?.createdBy || req.user?.id;
    if (createdBy) {
      notifySaleChange(createdBy, 'deleted', existingSale);
    }

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('sale', 'delete', existingSale).catch(err => {
      console.error('[Sync] Sale delete sync failed:', err.message);
    });

    return res.json({
      success: true,
      message: 'Sale deleted successfully'
    });
  } catch (error) {
    console.error('Delete sale error:', error);
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error'
    });
  }
};
