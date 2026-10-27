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
import { computeProvincialTax, resolveProvincialTaxConfig, serializeProvincialTaxBreakdown, ProvincialTaxLine } from '../utils/provincial-tax.util';
import { enqueueFbrForSale, attemptImmediateFbr } from '../services/fbr.service';
import { appendControlledDispenseEntries, ControlledDispenseLineInput } from '../services/controlled-medicines.service';
import { isPrescriptionEnforced } from '../utils/prescription.util';
import { resolveSaleLineUnits } from '../utils/unit.util';
import { isWeightSellingAllowedForBusinessType } from '../utils/module-applicability.util';
import { allocateFefo } from '../utils/fefo.util';
import { checkCreditLimit, CREDIT_LIMIT_EXCEEDED, CREDIT_LIMIT_OVERRIDE_ROLES } from '../utils/credit-limit.util';
import { variantBatchWhere } from '../utils/variant.util';
import { createNotification } from './notification.controller';
import Joi from 'joi';
import {
  GiftCardKioskError,
  isGiftCardKioskEnabled,
  redeemGiftCardAtomic,
  spendWalletAtomic,
} from '../utils/giftcard-kiosk.util';

// Tender methods a sale (or one split-tender allocation) can be paid
// with — Wave B1. JAZZCASH/EASYPAISA are first-class alongside the
// original four; MOBILE is kept for backward compatibility.
// GIFT_CARD / EWALLET (Wave C9 — gap item 9) are tender methods too:
// a gift-card redemption (code in the allocation's reference) or an
// eWallet spend (needs the sale's customerId). Both are validated
// inside the sale transaction against the ledger balance — never as
// a discount, never trusted from the client.
export const SALE_PAYMENT_METHODS = ['CASH', 'CARD', 'JAZZCASH', 'EASYPAISA', 'BANK_TRANSFER', 'MOBILE', 'GIFT_CARD', 'EWALLET'] as const;

// Validation schemas
const createSaleSchema = Joi.object({
  customerId: Joi.string().allow(null),
  branchId: Joi.string().required(),
  items: Joi.array().items(
    Joi.object({
      productId: Joi.string().required(),
      // Loose / by-weight selling (Stage 1): a C2 line's `quantity` is
      // the LEVEL quantity, so a kilo line may send 0.5 (kg) — the
      // resolver below still requires quantity x factor to land on a
      // whole number of base units (0.5 x 1000 = 500 g). Lines with no
      // unitLevel keep the historical rule (whole pieces, min 1).
      quantity: Joi.number().when('unitLevel', {
        is: Joi.exist(),
        then: Joi.number().positive().required(),
        otherwise: Joi.number().min(1).required()
      }),
      saleType: Joi.string().valid('UNIT', 'BOX', 'unit', 'box').optional(),
      // Unit engine (Wave C2): the selling level `quantity` is
      // expressed in. Absent = the historical UNIT/BOX contract.
      unitLevel: Joi.string().valid('PACK', 'STRIP', 'UNIT', 'pack', 'strip', 'unit').optional(),
      unitsDeducted: Joi.number().min(1).optional(),
      unitsPerBox: Joi.number().min(1).optional(),
      unitPrice: Joi.number().positive().required(),
      // Product variants (Wave C6): the variant this line sells.
      // Optional — its business rules (variant exists for the
      // product in this business, is active, and the line's batch
      // comes from the variant's pool) live in createSale.
      variantId: Joi.string().allow(null, '').optional(),
      batchId: Joi.string().allow(null, ''), // Link to specific batch
      batchNumber: Joi.string().allow(''), // Keep for backward compatibility
      expiryDate: Joi.string().allow(''),
      discountPercentage: Joi.number().min(0).max(100).optional(), // Item-level discount
      discountAmount: Joi.number().min(0).optional(), // Item-level discount amount
      totalPrice: Joi.number().min(0).optional() // Item total after discount
    })
  ).min(1).required(),
  // 'FOLIO' (Wave C5) is a headline-only marker for charge-to-room
  // sales — never a tender: the payments[] allocations below keep
  // validating against SALE_PAYMENT_METHODS, and a folio sale may
  // not carry allocations at all (enforced in createSale).
  paymentMethod: Joi.string().valid(...SALE_PAYMENT_METHODS, 'FOLIO').required(),
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
  // Prescriptions (Wave C1): the register record this sale dispenses
  // against. Optional in the schema — whether it is REQUIRED is a
  // business rule enforced in createSale (cart contents × the
  // requirePrescriptionAtPos setting), not a shape rule.
  prescriptionId: Joi.string().allow(null, '').optional(),
  // Hotel pack (Wave C5): charge this sale to a guest folio instead
  // of taking payment. Requires paymentMethod 'FOLIO' (and vice
  // versa); the business rules live in createSale next to the other
  // pre-transaction validations.
  folioId: Joi.string().allow(null, '').optional(),
  // Salesperson attribution (Wave C6): the staff member credited
  // with the sale when it is not the cashier. Optional — validated
  // in createSale to be an ACTIVE member of the sale's business.
  salespersonId: Joi.string().allow(null, '').optional(),
  // Credit-limit override (gap item 7): an explicit owner/manager
  // flag allowing this one credit sale to exceed the customer's
  // credit limit. Without it an over-limit credit sale is blocked
  // (402 CREDIT_LIMIT_EXCEEDED). Cashiers cannot override.
  creditLimitOverride: Joi.boolean().optional(),
  // Channel (converged: gap items 5/9 + sales-channel imports):
  // POS / ONLINE_STORE / KIOSK for counter, storefront and kiosk
  // sales; 'shopify' / 'daraz' / 'woocommerce' for imported vendor
  // orders (paired with externalOrderId — the (companyId, channel,
  // externalOrderId) unique index makes re-imports collide instead
  // of duplicating). Delivery details ride with ONLINE_STORE orders.
  // POS clients never send these (the defaults below apply).
  channel: Joi.string().valid('POS', 'ONLINE_STORE', 'KIOSK', 'shopify', 'daraz', 'woocommerce').optional(),
  externalOrderId: Joi.string().trim().max(128).allow(null, '').optional(),
  deliveryAddress: Joi.string().trim().max(500).allow(null, '').optional(),
  deliveryPhone: Joi.string().trim().max(40).allow(null, '').optional(),
  deliveryNotes: Joi.string().trim().max(500).allow(null, '').optional(),
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

// Gift cards / eWallet (Wave C9): the util throws
// GiftCardKioskError, but this handler's catch only passes `code` /
// `details` through for HttpError — convert here so the POS keeps
// its machine-readable error contract for ledger failures.
const asSaleHttpError = (error: any): any => {
  if (error instanceof GiftCardKioskError) {
    const http: any = new HttpError(error.statusCode, error.message);
    http.code = error.code;
    http.details = error.details;
    return http;
  }
  return error;
};

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
      paymentMethod = '',
      channel = '',
      status = '',
      shiftId = ''
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

    // Register shift (2026-10-27, B5): the Shift Summary modal reads
    // one shift's sales only — the collections for the active shift.
    if (shiftId) {
      where.shiftId = shiftId;
    }

    if (paymentMethod) {
      where.paymentMethod = paymentMethod;
    }

    // Online store (Wave C5 — gap item 5) + kiosk (Wave C9 — gap
    // item 9): the staff online/kiosk-orders queues are GET
    // /sales?channel=ONLINE_STORE&status=PENDING and GET
    // /sales?channel=KIOSK&status=PENDING. Values are allow-listed so
    // a junk filter reads as "no filter" rather than silently
    // returning nothing.
    if (channel === 'POS' || channel === 'ONLINE_STORE' || channel === 'KIOSK') {
      where.channel = channel;
    }
    if (status === 'PENDING' || status === 'COMPLETED' || status === 'CANCELLED' || status === 'REFUNDED') {
      where.status = status;
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
                unitLevel: true,
                unitFactor: true,
                batchNumber: true,
                expiryDate: true,
                product: {
                  select: {
                    id: true,
                    name: true,
                    // Loose / by-weight selling (Stage 1): see above.
                    ...( { unitType: true } as any )
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
            taxLines: true,
            provincialTaxLines: true,
            // Prescriptions (Wave C1): the invoice list/detail shows
            // the linked register summary when present.
            prescription: {
              select: {
                id: true,
                patientName: true,
                patientPhone: true,
                doctorName: true,
                doctorReg: true,
                issuedDate: true
              }
            }
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
                  unitLevel: true,
                  unitFactor: true,
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
          taxLines: true,
          provincialTaxLines: true
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
        sales: sales.map((s: any) => ({ ...s, taxBreakdown: serializeTaxBreakdown(s), provincialTaxBreakdown: serializeProvincialTaxBreakdown(s) })),
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
                barcode: true,
                // Loose / by-weight selling (Stage 1): nested product
                // unitType lets stored-line renderers (Invoices /
                // Refunds / reprints) show "0.500 kg", never "tablets".
                // Cast until the Prisma client is regenerated.
                ...( { unitType: true } as any )
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
        provincialTaxLines: true,
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
        },
        // Prescriptions (Wave C1): register summary for the invoice
        // detail; null when the sale dispensed against none.
        prescription: {
          select: {
            id: true,
            patientName: true,
            patientPhone: true,
            doctorName: true,
            doctorReg: true,
            issuedDate: true
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

    // Unit conversion (gap-features item 3): attach the per-batch
    // FEFO allocations to each line (batchNo + expiry + base units
    // taken), so receipts/audits can show which batches a line drew
    // from. Best-effort: a pre-migration DB has no sale_item_batches
    // table (P2021), and the detail then reads exactly as before.
    // NOTE: `saleItemBatch` is typed on the generated client only
    // after `npm run setup:web` regenerates it (deploy does this);
    // the `as any` bridge keeps tsc green in this sandbox.
    try {
      const itemIds = (sale.items as any[]).map((i) => i.id);
      if (itemIds.length > 0) {
        const allocRows = await (prisma as any).saleItemBatch.findMany({
          where: { saleItemId: { in: itemIds } },
          orderBy: { createdAt: 'asc' },
          include: { batch: { select: { batchNo: true, expireDate: true } } }
        });
        const byItem = new Map<string, any[]>();
        for (const row of allocRows) {
          const list = byItem.get(row.saleItemId) || [];
          list.push({ batchId: row.batchId, quantity: row.quantity, batchNo: row.batch?.batchNo || null, expireDate: row.batch?.expireDate || null });
          byItem.set(row.saleItemId, list);
        }
        (sale as any).items = (sale.items as any[]).map((i) => ({ ...i, allocations: byItem.get(i.id) || [] }));
      }
    } catch (e: any) {
      if (e?.code !== 'P2021' && !/sale_item_batches/i.test(String(e?.message || ''))) throw e;
    }

    return res.json({
      success: true,
      data: { ...sale, taxBreakdown: serializeTaxBreakdown(sale), provincialTaxBreakdown: serializeProvincialTaxBreakdown(sale) }
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
                barcode: true,
                // Loose / by-weight selling (Stage 1): nested product
                // unitType lets stored-line renderers (Invoices /
                // Refunds / reprints) show "0.500 kg", never "tablets".
                // Cast until the Prisma client is regenerated.
                ...( { unitType: true } as any )
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
        provincialTaxLines: true
      }
    });

    if (!sale) {
      return res.status(404).json({
        success: false,
        message: `Sale not found for receipt number: ${receiptNumber}. Available receipts: ${allReceipts.map((r: any) => r.receiptNumber).join(', ')}`
      });
    }

    return res.json({
      success: true,
      data: { ...sale, taxBreakdown: serializeTaxBreakdown(sale), provincialTaxBreakdown: serializeProvincialTaxBreakdown(sale) }
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

// Register shift (2026-10-27, B5): the ACTIVE shift id for the cashier
// ringing up this sale, resolved server-side from the caller's
// membership — never from a client-sent id (a client-sent id could
// attach another cashier's shift). Returns null when no shift is open
// for the cashier in this business; the sale is still valid, it simply
// has no shift. Called inside the sale transaction so the shift lookup
// and the sale row are atomic.
async function resolveActiveShiftIdForSale(tx: any, userId: string, companyId: string): Promise<string | null> {
  const profile = await tx.staffProfile.findFirst({
    where: { membership: { userId, businessId: companyId } },
    select: { id: true }
  });
  if (!profile) return null;
  const shift = await tx.shift.findFirst({
    where: { staffProfileId: profile.id, status: 'ACTIVE' },
    orderBy: { startTime: 'desc' },
    select: { id: true }
  });
  return shift?.id ?? null;
}

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
      // NOTE: unitType is cast until the Prisma client is regenerated
      // for the new Product.unitType field (regen is a deploy-time
      // step; the sandbox proxy blocks generate) — same pattern as the
      // isControlled casts elsewhere in this codebase.
      select: { id: true, name: true, categoryId: true, taxClassId: true, requiresPrescription: true, unitsPerPack: true, unitsPerStrip: true, ...( { unitType: true } as any ) }
    });
    const categoryByProductId = new Map<string, string | null>(
      promoProducts.map((p: any) => [p.id, p.categoryId || null])
    );
    // Tax classes (Wave B5): the product's rate group, resolved by the
    // tax engine below from the same pre-fetch.
    const taxClassByProductId = new Map<string, string | null>(
      promoProducts.map((p: any) => [p.id, p.taxClassId || null])
    );
    // Unit engine (Wave C2): pack structure per product, so the
    // promotions stage below can express C2 lines' units in base
    // units with the same server-side factors the transaction uses.
    const unitStructureByProductId = new Map<string, { unitsPerPack: number | null; unitsPerStrip: number | null }>(
      promoProducts.map((p: any) => [p.id, { unitsPerPack: p.unitsPerPack ?? null, unitsPerStrip: p.unitsPerStrip ?? null }])
    );
    const promoLines: PromoLineInput[] = [];

    // Loose / by-weight selling (Stage 1) — business-type gate
    // (standing rule 2026-10-26): weight lines belong to general
    // retail only. Any line whose product is a KG product is denied
    // for a pharmacy, clinic, hotel or any other type with a clean
    // 400 here — before totals, promotions or any write happen. The
    // sale's company is resolved the way the promotion phase below
    // does (selected context, else the sale branch's company).
    if (saleData.items.some((item) => {
      const p = promoProducts.find((pp: any) => pp.id === item.productId);
      return (p as any)?.unitType === 'KG';
    })) {
      let weightCompanyId: string | null = null;
      if (req.user?.selectedCompanyId && req.user?.selectedBranchId) {
        weightCompanyId = req.user.selectedCompanyId;
      } else if (saleData.branchId) {
        const branchRow = await prisma.branch.findUnique({
          where: { id: saleData.branchId },
          select: { companyId: true }
        });
        weightCompanyId = branchRow?.companyId || null;
      }
      const weightCompany = weightCompanyId
        ? await prisma.business.findUnique({ where: { id: weightCompanyId }, select: { businessType: true } })
        : null;
      if (!isWeightSellingAllowedForBusinessType(weightCompany?.businessType)) {
        throw new HttpError(400, `Weight selling is not available for ${weightCompany?.businessType || 'this'} business type — loose/by-weight products belong to general retail (departmental / retail) stores only`);
      }
    }

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
      // Unit engine (Wave C2): a line carrying unitLevel gets its
      // base units from the PRODUCT's structure (server-authoritative),
      // never from client-sent unitsDeducted/unitsPerBox. An unknown
      // product keeps the legacy rule here — the transaction produces
      // its proper not-found error for it below.
      const lineStructure = (item as any).unitLevel ? unitStructureByProductId.get(item.productId) : undefined;
      let promoUnits: number;
      if (lineStructure) {
        const resolved = resolveSaleLineUnits(item as any, lineStructure);
        if ('error' in resolved) {
          throw new HttpError(400, resolved.error);
        }
        promoUnits = resolved.baseQty;
      } else {
        promoUnits = item.unitsDeducted && item.unitsDeducted > 0
          ? item.unitsDeducted
          : (normalizedSaleType === 'BOX' ? item.quantity * unitsPerBox : item.quantity);
      }
      promoLines.push({
        productId: item.productId,
        categoryId: categoryByProductId.get(item.productId) ?? null,
        units: promoUnits,
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
    // Provincial tax (Gap item 1): PRA / SRB / KPRA / BRA alongside
    // FBR, on the SAME post-discount base — but as a SEPARATE amount,
    // never folded into taxAmount (see provincial-tax.util.ts). The
    // branch row wins, else the business row; no config (or a disabled
    // one) → 0, so the invoice is byte-identical to today. A failure
    // resolving the config never fails the sale (the FBR pattern):
    // it logs and the sale proceeds without provincial tax.
    let provincialTaxAmount = 0;
    let provincialTaxGroups: ProvincialTaxLine[] = [];
    {
      let provCompanyId: string | null = null;
      let provBranchId: string | null = null;
      if (req.user?.selectedCompanyId && req.user?.selectedBranchId) {
        provCompanyId = req.user.selectedCompanyId;
        provBranchId = req.user.selectedBranchId;
      } else if (saleData.branchId) {
        const provBranchRow = await prisma.branch.findUnique({
          where: { id: saleData.branchId },
          select: { companyId: true }
        });
        provCompanyId = provBranchRow?.companyId || null;
        provBranchId = saleData.branchId;
      }
      if (provCompanyId) {
        try {
          const provConfigs = await prisma.provincialTaxConfig.findMany({
            where: { companyId: provCompanyId }
          });
          const provResult = computeProvincialTax({
            taxableBase: subtotalAfterDiscount,
            config: resolveProvincialTaxConfig(provConfigs, provBranchId)
          });
          provincialTaxAmount = provResult.provincialTaxAmount;
          provincialTaxGroups = provResult.lines;
        } catch (provincialTaxError) {
          console.warn('Could not compute provincial tax, skipping:', provincialTaxError);
          provincialTaxAmount = 0;
          provincialTaxGroups = [];
        }
      }
    }
    const totalAmount = subtotalAfterDiscount + taxAmount + provincialTaxAmount;

    // Points this sale earns — the long-standing rule, unchanged:
    // 1 point per full PKR 100 of the FINAL total (so a redemption
    // slightly reduces what the same bill earns). Zero for walk-ins.
    const pointsEarned = saleData.customerId ? Math.floor(totalAmount / 100) : 0;

    // Hotel pack (Wave C5) — charge-to-room. A sale may be charged
    // to a guest's OPEN folio instead of being paid at the counter.
    // The representation (deliberately boring, and the one every
    // money report already understands):
    //   · paymentMethod is the marker 'FOLIO' — never a tender, so
    //     no SalePayment allocation is ever written for the sale;
    //   · the sale is stored UNPAID (paymentStatus PENDING,
    //     paidAmount 0) whatever the client sent — no cash is
    //     claimed anywhere, and FBR maps it to a credit sale;
    //   · the debt lives on the folio: a SERVICE FolioCharge of the
    //     sale's total is written inside the sale transaction below;
    //   · the sale carries folioId so the link is queryable both
    //     ways (Sale.folioId ↔ FolioCharge.saleId).
    // Rules: folioId ⇔ paymentMethod 'FOLIO'; no split tender (no
    // money moves); no customerId — a customer sale would ALSO post
    // the unpaid total to the customer's khata (Wave B2), counting
    // the same debt twice. The folio must exist in this business
    // and be OPEN; its branch is re-checked inside the transaction
    // against the sale's resolved branch.
    let folioForSale: { id: string } | null = null;
    {
      const requestedFolioId = saleData.folioId ? String(saleData.folioId) : null;
      const headlineMethod = String(saleData.paymentMethod || '').toUpperCase();
      if (headlineMethod === 'FOLIO' && !requestedFolioId) {
        const e: any = new HttpError(400, 'A sale with payment method FOLIO must name the folio it charges to');
        e.code = 'FOLIO_REQUIRED';
        throw e;
      }
      if (requestedFolioId) {
        if (headlineMethod !== 'FOLIO') {
          const e: any = new HttpError(400, 'A sale charged to a folio must use payment method FOLIO');
          e.code = 'FOLIO_METHOD_REQUIRED';
          throw e;
        }
        if (Array.isArray(saleData.payments) && saleData.payments.length > 0) {
          const e: any = new HttpError(400, 'A folio sale takes no payment — the folio carries the full amount');
          e.code = 'FOLIO_NO_TENDER';
          throw e;
        }
        if (saleData.customerId) {
          const e: any = new HttpError(400, 'A folio sale cannot also be a customer (khata) sale — the debt would be counted twice');
          e.code = 'FOLIO_NO_CUSTOMER';
          throw e;
        }
        let folioCompanyId: string | null = null;
        if (req.user?.selectedCompanyId) {
          folioCompanyId = req.user.selectedCompanyId;
        } else if (saleData.branchId) {
          const branchRow = await prisma.branch.findUnique({
            where: { id: saleData.branchId },
            select: { companyId: true }
          });
          folioCompanyId = branchRow?.companyId || null;
        }
        const folioRow = folioCompanyId
          ? await prisma.folio.findFirst({
              where: { id: requestedFolioId, companyId: folioCompanyId },
              select: { id: true, status: true }
            })
          : null;
        if (!folioRow) {
          const e: any = new HttpError(400, 'The folio for this charge-to-room sale was not found in this business');
          e.code = 'FOLIO_NOT_FOUND';
          throw e;
        }
        if (folioRow.status !== 'OPEN') {
          const e: any = new HttpError(400, 'This folio is closed and can no longer be charged to');
          e.code = 'FOLIO_CLOSED';
          throw e;
        }
        folioForSale = { id: folioRow.id };
      }
    }

    // Resolve payment status and the stored paidAmount BEFORE the
    // transaction: the split-tender validation below must mirror
    // exactly the paidAmount the sale will be stored with (the
    // client-sent value, or the full total for a COMPLETED sale).
    // A folio sale is always stored unpaid (see the block above).
    const paymentStatus: PaymentStatus = (folioForSale
      ? 'PENDING'
      : (saleData.paymentStatus || 'COMPLETED')) as PaymentStatus;
    const paidAmount = folioForSale
      ? 0
      : (saleData.paidAmount || (paymentStatus === 'COMPLETED' ? totalAmount : 0));

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

    // Gift cards / eWallet (Wave C9): GIFT_CARD and EWALLET are
    // tender methods, so they only ever arrive as split-tender
    // allocations — a bare headline method with no allocations
    // cannot name a card, and a wallet spend needs the customer.
    // The pack must be enabled for this business. Balance checks
    // live INSIDE the transaction (the atomic helpers) — a
    // pre-transaction balance read could race a concurrent sale
    // spending the same card/wallet.
    {
      const headlineMethod = String(saleData.paymentMethod || '').toUpperCase();
      const hasLedgerTender = (allocations || []).some(p => p.method === 'GIFT_CARD' || p.method === 'EWALLET');
      if ((headlineMethod === 'GIFT_CARD' || headlineMethod === 'EWALLET') && !allocations) {
        throw new HttpError(400, `A sale paid with ${headlineMethod} must send its tender as a payments[] allocation (gift card: code in the reference; wallet: the sale customer).`);
      }
      if (allocations) {
        for (const allocation of allocations) {
          if (allocation.method === 'GIFT_CARD' && !allocation.reference) {
            throw new HttpError(400, 'A gift card payment must carry the card code in its reference.');
          }
          if (allocation.method === 'EWALLET' && !saleData.customerId) {
            throw new HttpError(400, 'An eWallet payment needs a customer on the sale.');
          }
        }
      }
      if (hasLedgerTender) {
        let ledgerCompanyId: string | null = null;
        if (req.user?.selectedCompanyId) {
          ledgerCompanyId = req.user.selectedCompanyId;
        } else if (saleData.branchId) {
          const branchRow = await prisma.branch.findUnique({
            where: { id: saleData.branchId },
            select: { companyId: true }
          });
          ledgerCompanyId = branchRow?.companyId || null;
        }
        const enabled = ledgerCompanyId
          ? await isGiftCardKioskEnabled(prisma, ledgerCompanyId)
          : false;
        if (!enabled) {
          const e: any = new HttpError(403, 'Gift cards and eWallet are not enabled for this business.');
          e.code = 'GIFT_CARD_KIOSK_NOT_ENABLED';
          throw e;
        }
      }
    }

    // Prescriptions (Wave C1): if the cart holds any product flagged
    // requiresPrescription, the sale must carry a prescription from
    // the register — or, when enforcement is OFF for this business,
    // it proceeds and the response flags prescriptionWarning.
    // Enforcement is the `requirePrescriptionAtPos` setting: an
    // explicit stored value wins; with no row stored it defaults to
    // ON for PHARMACY businesses, OFF for everyone else.
    //
    // Coverage rule (deliberately product-level, NOT quantity-level):
    // every distinct Rx product in the cart must appear among the
    // attached prescription's items. Quantities are not enforced —
    // partial fills against a paper prescription are normal pharmacy
    // practice; the register keeps the prescribed quantities.
    //
    // The errors thrown here carry a machine-readable `code` (and the
    // offending products in `details`) — the outer catch passes both
    // through for HttpErrors so the POS can open its prescription
    // dialog instead of showing a bare toast.
    let prescriptionWarning = false;
    {
      const rxNameByProductId = new Map<string, string>();
      for (const product of promoProducts as any[]) {
        if (product.requiresPrescription) rxNameByProductId.set(product.id, product.name);
      }
      const rxCartProducts = [...new Set(saleData.items.map(item => item.productId))]
        .filter(id => rxNameByProductId.has(id))
        .map(id => ({ id, name: rxNameByProductId.get(id) as string }));
      const attachedId = saleData.prescriptionId ? String(saleData.prescriptionId) : null;

      if (rxCartProducts.length > 0 || attachedId) {
        // Resolve the sale's company + type the same way the promo /
        // tax stages above do.
        let rxCompanyId: string | null = null;
        let rxBusinessType: string | null = null;
        if (req.user?.selectedCompanyId) {
          rxCompanyId = req.user.selectedCompanyId;
          const company = await prisma.business.findUnique({
            where: { id: rxCompanyId },
            select: { businessType: true }
          });
          rxBusinessType = company?.businessType ?? null;
        } else if (saleData.branchId) {
          const branchRow = await prisma.branch.findUnique({
            where: { id: saleData.branchId },
            select: { companyId: true, company: { select: { businessType: true } } }
          });
          rxCompanyId = branchRow?.companyId || null;
          rxBusinessType = branchRow?.company?.businessType ?? null;
        }

        if (attachedId) {
          const attached = rxCompanyId
            ? await prisma.prescription.findFirst({
                where: { id: attachedId, companyId: rxCompanyId },
                include: { items: { select: { productId: true } } }
              })
            : null;
          if (!attached) {
            const e: any = new HttpError(400, 'The attached prescription was not found in this business');
            e.code = 'PRESCRIPTION_NOT_FOUND';
            throw e;
          }
          if (!attached.isActive) {
            const e: any = new HttpError(400, 'The attached prescription has been voided and can no longer be used for a sale');
            e.code = 'PRESCRIPTION_VOIDED';
            throw e;
          }
          // Online store (Wave C5 — gap item 5): a sale may only
          // dispense against a REVIEWED prescription. Customer
          // uploads sit at PENDING until a pharmacist reviews them;
          // REJECTED uploads are refused outright. Staff-entered
          // records are REVIEWED at entry, so counter sales are
          // unaffected. (Pre-feature rows carry the REVIEWED default
          // from the migration, and a missing value reads as REVIEWED.)
          const reviewStatus = String((attached as any).reviewStatus || 'REVIEWED').toUpperCase();
          if (reviewStatus === 'PENDING') {
            const e: any = new HttpError(422, 'This prescription is still waiting for pharmacist review and cannot be dispensed yet');
            e.code = 'PRESCRIPTION_NOT_REVIEWED';
            throw e;
          }
          if (reviewStatus === 'REJECTED') {
            const e: any = new HttpError(422, 'This prescription was reviewed and rejected by the pharmacist and cannot be used for a sale');
            e.code = 'PRESCRIPTION_REJECTED';
            throw e;
          }
          const covered = new Set((attached.items || []).map((i: any) => i.productId));
          const missing = rxCartProducts.filter(p => !covered.has(p.id));
          if (missing.length > 0) {
            const e: any = new HttpError(400, `The attached prescription does not cover: ${missing.map(p => p.name).join(', ')}`);
            e.code = 'PRESCRIPTION_MISMATCH';
            e.details = { products: missing };
            throw e;
          }
        } else if (rxCartProducts.length > 0) {
          const enforced = await isPrescriptionEnforced(prisma, currentAdminId, rxBusinessType);
          if (enforced) {
            const e: any = new HttpError(400, `Prescription required: this sale contains prescription-only items (${rxCartProducts.map(p => p.name).join(', ')}). Attach a prescription to continue.`);
            e.code = 'PRESCRIPTION_REQUIRED';
            e.details = { products: rxCartProducts };
            throw e;
          }
          prescriptionWarning = true;
        }
      }
    }

    // Salesperson attribution (Wave C6): when the POS credits the
    // sale to a salesperson other than the cashier, that user must be
    // an ACTIVE member of the sale's business — an arbitrary user id
    // must never land on a sale (commission aggregation trusts it).
    // Null/absent = the cashier is the seller, exactly as before.
    let salespersonForSale: { id: string } | null = null;
    {
      const requestedSalespersonId = saleData.salespersonId ? String(saleData.salespersonId) : null;
      if (requestedSalespersonId) {
        let salespersonCompanyId: string | null = null;
        if (req.user?.selectedCompanyId) {
          salespersonCompanyId = req.user.selectedCompanyId;
        } else if (saleData.branchId) {
          const branchRow = await prisma.branch.findUnique({
            where: { id: saleData.branchId },
            select: { companyId: true }
          });
          salespersonCompanyId = branchRow?.companyId || null;
        }
        const membership = salespersonCompanyId
          ? await prisma.membership.findFirst({
              where: { userId: requestedSalespersonId, businessId: salespersonCompanyId, status: 'ACTIVE' },
              select: { id: true }
            })
          : null;
        if (!membership) {
          const e: any = new HttpError(400, 'The salesperson for this sale is not an active member of this business');
          e.code = 'SALESPERSON_NOT_IN_BUSINESS';
          throw e;
        }
        salespersonForSale = { id: requestedSalespersonId };
      }
    }

    // Controlled / narcotics register (Gap item 2): snapshots for
    // the register entries - customer name + prescription ref,
    // resolved once before the transaction (reads only; the entries
    // themselves are appended inside the transaction below).
    let customerNameForRegister: string | null = null;
    if (saleData.customerId) {
      const customerRow = await prisma.customer.findUnique({
        where: { id: saleData.customerId },
        select: { name: true },
      });
      customerNameForRegister = customerRow?.name || null;
    }
    let prescriptionRefForRegister: string | null = null;
    if (saleData.prescriptionId) {
      const prescriptionRow = await prisma.prescription.findFirst({
        where: { id: String(saleData.prescriptionId) },
        select: { id: true, doctorName: true },
      });
      if (prescriptionRow) {
        prescriptionRefForRegister = prescriptionRow.doctorName
          ? `Rx ${prescriptionRow.id} (Dr. ${prescriptionRow.doctorName})`
          : `Rx ${prescriptionRow.id}`;
      }
    }
    // Sales-channel import tag (Shopify integration): the channel +
    // vendor order id for an imported sale, or an empty object for a
    // POS/manual sale. Spread into BOTH tx.sale.create calls below
    // (main + invoice-collision retry) via `as any`: the generated
    // Prisma client in this sandbox predates the Sale.channel /
    // Sale.externalOrderId columns (prisma generate cannot run here —
    // CDN failure; the client is regenerated in the VM assembly
    // container at deploy time), so the typed create input does not
    // know these fields yet. The cast keeps tsc green without
    // changing runtime behaviour — at runtime the columns exist and
    // the tag lands inside the sale transaction, atomically with the
    // sale itself, so a re-imported order collides on the
    // (companyId, channel, externalOrderId) unique index instead of
    // duplicating. Never set for POS/manual sales.
    const channelTag =
      saleData.channel || saleData.externalOrderId
        ? {
            channel: saleData.channel ? String(saleData.channel) : null,
            externalOrderId: saleData.externalOrderId ? String(saleData.externalOrderId) : null
          }
        : {};

    // Use transaction to ensure data consistency
    // Wrap in try-catch to handle transaction errors gracefully
    let result;
    try {
      result = await prisma.$transaction(async (tx: any) => {
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

      // Register shift (2026-10-27, B5): tie this sale to the cashier's
      // ACTIVE shift (see resolveActiveShiftIdForSale above). Resolved
      // here, inside the transaction, so it is atomic with the sale.
      const shiftIdForSale = await resolveActiveShiftIdForSale(tx, userId, targetCompanyId);

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
          provincialTaxAmount,
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
          // Prescriptions (Wave C1): validated above (exists in this
          // business, active, covers the cart's Rx items).
          prescriptionId: saleData.prescriptionId || null,
          // Hotel pack (Wave C5): the folio this sale charges to,
          // validated above; the matching FolioCharge is written
          // below in this same transaction.
          folioId: folioForSale ? folioForSale.id : null,
          // Salesperson attribution (Wave C6): validated above to
          // be an ACTIVE member of this business; null = cashier.
          salespersonId: salespersonForSale ? salespersonForSale.id : null,
          // Register shift (2026-10-27, B5): the cashier's ACTIVE
          // shift, resolved inside this transaction above. Null when
          // no shift was open. (tx is `any`, so the generated client
          // predating Sale.shiftId does not trip tsc — the column comes
          // from the schema change, applied at deploy time; see
          // channelTag above for the same pattern.)
          shiftId: shiftIdForSale,
          // Online store (Wave C5 — gap item 5): channel + delivery
          // details. POS sales store the POS default; storefront
          // checkouts send ONLINE_STORE with delivery fields.
          channel: saleData.channel || 'POS',
          deliveryAddress: saleData.deliveryAddress || null,
          deliveryPhone: saleData.deliveryPhone || null,
          deliveryNotes: saleData.deliveryNotes || null,
          // Sales-channel import tag (Shopify integration) — see
          // channelTag above; {} for POS/manual sales. Spread after
          // the explicit channel so an imported order's tag wins.
          ...(channelTag as any),
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
              provincialTaxAmount,
              discountAmount: discountAmount,
              discountPercentage: saleData.discountPercentage || 0,
              loyaltyPointsRedeemed: loyaltyPointsToRedeem > 0 ? loyaltyPointsToRedeem : null,
              loyaltyDiscount: loyaltyDiscount > 0 ? loyaltyDiscount : null,
              loyaltyPointsEarned: saleData.customerId ? pointsEarned : null,
              promotionDiscount: promotionDiscount > 0 ? promotionDiscount : null,
              prescriptionId: saleData.prescriptionId || null,
              folioId: folioForSale ? folioForSale.id : null,
              salespersonId: salespersonForSale ? salespersonForSale.id : null,
              // Register shift (2026-10-27, B5): same shift as the
              // first attempt — resolved once, before the retry.
              shiftId: shiftIdForSale,
              // Online store (Wave C5 — gap item 5): channel + delivery
              // details (same values as the first attempt above).
              channel: saleData.channel || 'POS',
              deliveryAddress: saleData.deliveryAddress || null,
              deliveryPhone: saleData.deliveryPhone || null,
              deliveryNotes: saleData.deliveryNotes || null,
              // Sales-channel import tag (Shopify integration) — see
              // channelTag above; {} for POS/manual sales.
              ...(channelTag as any),
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

      // Hotel pack (Wave C5): a charge-to-room sale posts its total
      // to the folio HERE, in the sale's own transaction, so the
      // guest's bill and the sale can never disagree — if the folio
      // stopped being chargeable (closed meanwhile, or it belongs
      // to another branch) the whole sale rolls back. The folio was
      // validated before the transaction; this is the authoritative
      // re-check under the transaction's own company/branch scope.
      if (folioForSale) {
        const folioRow = await tx.folio.findFirst({
          where: { id: folioForSale.id, companyId: targetCompanyId },
          select: {
            id: true,
            status: true,
            branchId: true,
            room: { select: { number: true } }
          }
        });
        if (!folioRow || folioRow.status !== 'OPEN') {
          throw new HttpError(400, 'The folio for this charge-to-room sale is not open');
        }
        if (folioRow.branchId && folioRow.branchId !== targetBranchId) {
          throw new HttpError(400, 'This folio belongs to a different branch than the sale');
        }
        await tx.folioCharge.create({
          data: {
            folioId: folioRow.id,
            description: `Room ${folioRow.room?.number || ''} — POS sale ${invoiceNumber}`.trim(),
            amount: round2(totalAmount),
            kind: 'SERVICE',
            saleId: sale.id,
            chargeDate: new Date(),
            createdBy: req.user?.createdBy || req.user?.id || null
          }
        });
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

      // Provincial tax (Gap item 1): persist the per-authority lines
      // the engine computed, in the same transaction. The rows snapshot
      // authority/registration/rate, so later config edits never rewrite
      // this sale's provincial history; Sale.provincialTaxAmount above
      // is their sum. No config → no rows, exactly like today.
      if (provincialTaxGroups.length > 0) {
        await tx.saleProvincialTaxLine.createMany({
          data: provincialTaxGroups.map(g => ({
            saleId: sale.id,
            authority: g.authority,
            authorityName: g.authorityName,
            registrationNumber: g.registrationNumber,
            rate: g.rate,
            taxableAmount: g.taxableAmount,
            taxAmount: g.taxAmount
          }))
        });
      }

      // Create sale items and update stock
      const saleItems = [];
      // Controlled / narcotics register (Gap item 2): lines collected
      // here, appended after the loop in this same transaction.
      const controlledLines: ControlledDispenseLineInput[] = [];
      for (let itemIndex = 0; itemIndex < saleData.items.length; itemIndex++) {
        const item = saleData.items[itemIndex];
        const normalizedSaleType = (item.saleType || 'UNIT').toString().toUpperCase();
        const unitsPerBox = item.unitsPerBox && item.unitsPerBox > 0 ? item.unitsPerBox : 1;

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

        // Service items (Wave C4): a product flagged isService is
        // sold but never stocked — a doctor's consultation fee is
        // the first user (its product is auto-ensured by the clinic
        // module). The line skips batch resolution, the stock
        // checks and the deduction entirely and is stored with
        // batchId null + unitsDeducted 0, the shape refunds and
        // reports already read as "no stock moved". The line total
        // is the server-computed itemTotals entry, like every line.
        if ((product as any).isService) {
          // Controlled / narcotics register (Gap item 2): a service
          // line has no batch and no stock movement, so there is
          // nothing the register could balance against - refuse
          // rather than log a batch-less dispense.
          if ((product as any).isControlled) {
            throw new HttpError(400, `Controlled product ${product.name} cannot be sold as a service item - it must dispense from a batch so the controlled-medicines register can record it`);
          }
          const serviceItem = await tx.saleItem.create({
            data: {
              saleId: sale.id,
              productId: item.productId,
              batchId: null,
              // Services (Wave C4) never carry a variant.
              variantId: null,
              variantName: null,
              createdBy: req.user?.createdBy || req.user?.id || 'default-admin-id',
              quantity: item.quantity,
              unitsDeducted: 0,
              unitsPerBox: 1,
              saleType: 'UNIT',
              unitLevel: null,
              unitFactor: null,
              unitPrice: item.unitPrice,
              totalPrice: itemTotals[itemIndex],
              batchNumber: null,
              expiryDate: null
            }
          });
          saleItems.push(serviceItem);
          continue;
        }

        // Unit engine (Wave C2): when the line carries unitLevel, the
        // factor comes from the product itself (server-authoritative)
        // and the line's base quantity is quantity x factor. Client-
        // sent unitsDeducted/unitsPerBox do not apply to C2 lines.
        // Lines without unitLevel keep the historical rule untouched.
        const rawUnitResolution = (item as any).unitLevel !== undefined && (item as any).unitLevel !== null && (item as any).unitLevel !== ''
          ? resolveSaleLineUnits(item as any, product, product.name)
          : null;
        if (rawUnitResolution && 'error' in rawUnitResolution) {
          throw new HttpError(400, rawUnitResolution.error);
        }
        const unitResolution = rawUnitResolution && 'baseQty' in rawUnitResolution ? rawUnitResolution : null;
        const unitsRequired = unitResolution
          ? unitResolution.baseQty
          : (item.unitsDeducted && item.unitsDeducted > 0
            ? item.unitsDeducted
            : (normalizedSaleType === 'BOX' ? item.quantity * unitsPerBox : item.quantity));

        // Product variants (Wave C6): THE ISOLATION RULE — a line
        // naming a variant draws ONLY from that variant's batches; a
        // variant-less line on a product WITH active variants draws
        // ONLY from the base pool (variantId null); a product with no
        // variants adds no constraint at all, so its path below is
        // byte-identical to before (variant.util.variantBatchWhere).
        // An explicitly selected batch outside the pool simply does
        // not resolve, which refuses the sale like any bad batch.
        let lineVariant: { id: string; name: string } | null = null;
        let variantPool: { variantId: string } | { variantId: null } | Record<string, never> = {};
        const requestedVariantId = (item as any).variantId ? String((item as any).variantId) : null;
        if (requestedVariantId) {
          const variantRow = await tx.productVariant.findFirst({
            where: { id: requestedVariantId, productId: item.productId, companyId: targetCompanyId },
            select: { id: true, name: true, isActive: true }
          });
          if (!variantRow) {
            const e: any = new HttpError(400, `Variant not found for ${product.name}`);
            e.code = 'VARIANT_NOT_FOUND';
            throw e;
          }
          if (!variantRow.isActive) {
            const e: any = new HttpError(400, `Variant "${variantRow.name}" of ${product.name} is no longer active`);
            e.code = 'VARIANT_INACTIVE';
            throw e;
          }
          lineVariant = { id: variantRow.id, name: variantRow.name };
          variantPool = variantBatchWhere(lineVariant.id, true);
        } else {
          const activeVariantCount = await tx.productVariant.count({
            where: { productId: item.productId, companyId: targetCompanyId, isActive: true }
          });
          variantPool = variantBatchWhere(null, activeVariantCount > 0);
        }

        // Check stock availability through batches
        // Use explicit select to avoid reportReason column issues
        const availableBatches = await tx.batch.findMany({
          where: {
            productId: item.productId,
            branchId: targetBranchId,
            quantity: { gt: 0 },
            isActive: true,
            ...variantPool
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

        // Batch allocation — multi-batch FEFO (gap-features item 3).
        // A PINNED batch (batchId / batchNumber) keeps its historical
        // single-batch contract: the whole line must fit in that
        // batch, or the sale is refused — a cashier who picks a batch
        // means that batch. An UNPINNED line allocates FEFO across
        // the branch's batches (nearest expiry first, spilling into
        // the next batch when one runs out), so selling 15 loose
        // tablets from batches of 10 + 10, or 1 strip (10 tablets)
        // when the nearest-expiry batch holds only 8, now succeeds
        // instead of failing with "no batch available". The desktop
        // route already plans deductions this way; the web engine
        // now matches it, and persists the plan as SaleItemBatch
        // rows (below) so refunds and sale deletion can return every
        // unit to the batch it actually came from.
        let selectedBatch = null as any;
        let batchAllocations: { batchId: string; qty: number }[] = [];
        if (item.batchId) {
          selectedBatch = await tx.batch.findFirst({
            where: {
              id: item.batchId,
              productId: item.productId,
              branchId: targetBranchId,
              isActive: true,
              ...variantPool
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
          batchAllocations = [{ batchId: selectedBatch.id, qty: unitsRequired }];
        } else if (item.batchNumber) {
          selectedBatch = await tx.batch.findFirst({
            where: {
              batchNo: item.batchNumber,
              productId: item.productId,
              branchId: targetBranchId,
              quantity: {
                gte: unitsRequired
              },
              isActive: true,
              ...variantPool
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
          batchAllocations = [{ batchId: selectedBatch.id, qty: unitsRequired }];
        } else {
          // Unpinned: allocate FEFO across the branch's batches.
          // Expired batches never sell — they are filtered BEFORE
          // allocation (the desktop route does the same), so a good
          // batch behind an expired one is used instead of the sale
          // being refused for the expired batch at the front.
          const sellableBatches = availableBatches.filter(
            (b: any) => !b.expireDate || new Date(b.expireDate).getTime() >= Date.now()
          );
          const sellableStock = sellableBatches.reduce((sum: number, batch: any) => sum + batch.quantity, 0);
          if (sellableStock < unitsRequired) {
            throw new HttpError(422, `Insufficient stock for ${product.name}. Available: ${sellableStock}, Required: ${unitsRequired}`);
          }
          const fefoPlan = allocateFefo(sellableBatches, unitsRequired);
          if (fefoPlan.shortfall > 0) {
            throw new HttpError(422, `Insufficient stock for ${product.name}. Available: ${sellableStock}, Required: ${unitsRequired}`);
          }
          batchAllocations = fefoPlan.allocations;
          selectedBatch = sellableBatches.find((b: any) => b.id === batchAllocations[0].batchId);
        }

        // Never sell expired stock: the batch this line resolves to — the
        // explicitly selected one or the FEFO-first one — must be in date
        // (Batch.expireDate, per the Prisma schema). The unpinned path
        // above already filtered expired batches out, so this check now
        // only ever fires for pinned batches.
        if (selectedBatch.expireDate && new Date(selectedBatch.expireDate).getTime() < Date.now()) {
          throw new HttpError(422, `Cannot sell expired batch ${selectedBatch.batchNo} for ${product.name} (expired ${new Date(selectedBatch.expireDate).toISOString().slice(0, 10)})`);
        }

        // Decrement stock atomically (A-16): each update only applies
        // while its batch still holds enough units, so two concurrent
        // sales can no longer both pass the availability check on the
        // same snapshot and drive a batch negative. The whole sale is
        // one transaction, so a failed later batch rolls the earlier
        // decrements back.
        for (const alloc of batchAllocations) {
          const decrementResult = await tx.batch.updateMany({
            where: {
              id: alloc.batchId,
              quantity: { gte: alloc.qty }
            },
            data: {
              quantity: { decrement: alloc.qty }
            }
          });

          if (decrementResult.count !== 1) {
            throw new HttpError(422, `Insufficient stock for ${product.name}. Available: ${selectedBatch.quantity}, Required: ${unitsRequired}`);
          }
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
            // Product variants (Wave C6): the variant sold + its
            // name snapshot, so history/receipts stay truthful even
            // if the variant is later renamed or deactivated.
            variantId: lineVariant ? lineVariant.id : null,
            variantName: lineVariant ? lineVariant.name : null,
            createdBy: req.user?.createdBy || req.user?.id || 'default-admin-id',
            // Unit engine (Wave C2): C2 lines store quantity as BASE
            // units (== unitsDeducted) plus the level snapshot, so
            // every quantity-keyed consumer reads base units; the
            // entered level quantity is quantity / unitFactor and
            // unitPrice stays the per-LEVEL price, keeping totalPrice
            // the money truth. Legacy lines store quantity as
            // entered, exactly as before.
            quantity: unitResolution ? unitResolution.baseQty : item.quantity,
            unitsDeducted: unitsRequired,
            unitsPerBox: unitResolution && unitResolution.level === 'PACK' ? unitResolution.factor : unitsPerBox,
            saleType: unitResolution
              ? (unitResolution.level === 'PACK' ? 'BOX' : unitResolution.level)
              : normalizedSaleType,
            unitLevel: unitResolution ? unitResolution.level : null,
            unitFactor: unitResolution ? unitResolution.factor : null,
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

        // Persist the FEFO plan (gap-features item 3): one
        // SaleItemBatch row per batch this line drew from, in FEFO
        // order, quantities in base units. SaleItem.batchId above
        // stays the FEFO-first batch, so every existing consumer
        // (receipts, reports, refunds' fallback) reads exactly what
        // it read before; refunds and sale deletion restock from
        // these rows instead of crediting the whole line to one
        // batch. NOTE: `saleItemBatch` is typed on the generated
        // client only after `npm run setup:web` regenerates it from
        // the updated schema (deploy does this — see the build); the
        // `as any` bridge keeps tsc green in this sandbox, where
        // `prisma generate` cannot fetch its engine (egress proxy).
        if (batchAllocations.length > 0) {
          await (tx as any).saleItemBatch.createMany({
            data: batchAllocations.map((a) => ({
              saleItemId: saleItem.id,
              batchId: a.batchId,
              quantity: a.qty
            }))
          });
        }

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

        // Controlled / narcotics register (Gap item 2): collect the
        // line for the append-only dispense log (appended after the
        // loop, in this same transaction). `quantity` is base units
        // (unitsRequired) - the same units the batch was decremented by.
        if ((product as any).isControlled) {
          controlledLines.push({
            saleItemId: saleItem.id,
            productId: item.productId,
            isControlled: true,
            batchId: selectedBatch.id,
            batchNo: selectedBatch.batchNo,
            quantity: unitsRequired,
          });
        }
      }

      // Controlled / narcotics register (Gap item 2): one append-only
      // DISPENSE entry per controlled sale line, in this same
      // transaction - a failed append rolls the sale back, and a
      // completed sale can never miss its register entries. The
      // batch was already decremented above, so each entry's
      // balanceAfter snapshot reads the post-sale stock.
      if (controlledLines.length > 0) {
        let staffNameForRegister: string | null =
          (req.user as any)?.name || (req.user as any)?.fullName || null;
        if (!staffNameForRegister) {
          const staffRow = await tx.zapeeraUser.findUnique({
            where: { id: userId },
            select: { name: true },
          });
          staffNameForRegister = staffRow?.name || null;
        }
        await appendControlledDispenseEntries(tx, {
          companyId: targetCompanyId,
          branchId: targetBranchId,
          saleId: sale.id,
          invoiceNumber,
          staffUserId: userId,
          staffName: staffNameForRegister,
          customerId: saleData.customerId || null,
          customerName: customerNameForRegister,
          prescriptionId: saleData.prescriptionId || null,
          prescriptionRef: prescriptionRefForRegister,
          lines: controlledLines,
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

      // Gift cards / eWallet (Wave C9): redeem the tender
      // allocations inside this same transaction — the guarded
      // decrement in each helper is what makes concurrent redemptions
      // safe (a second sale spending the same card/wallet loses the
      // race with a 409 and the whole sale rolls back; the balance
      // can never go negative). The sale stores the per-ledger totals
      // so reporting can split them out; the per-card/per-wallet
      // detail lives on the ledger rows. Ledger errors are converted
      // to HttpError so the POS keeps its machine-readable code.
      let giftCardTotal = 0;
      let walletTotal = 0;
      if (allocations) {
        for (const allocation of allocations) {
          if (allocation.method === 'GIFT_CARD') {
            try {
              const redeemed = await redeemGiftCardAtomic(tx, {
                code: allocation.reference || '',
                companyId: targetCompanyId,
                amount: allocation.amount,
                saleId: sale.id,
                createdBy: req.user?.createdBy || req.user?.id || null,
              });
              giftCardTotal = round2(giftCardTotal + redeemed.amount);
            } catch (error) {
              throw asSaleHttpError(error);
            }
          } else if (allocation.method === 'EWALLET') {
            try {
              const spent = await spendWalletAtomic(tx, {
                customerId: saleData.customerId as string,
                companyId: targetCompanyId,
                amount: allocation.amount,
                saleId: sale.id,
                createdBy: req.user?.createdBy || req.user?.id || null,
              });
              walletTotal = round2(walletTotal + spent.amount);
            } catch (error) {
              throw asSaleHttpError(error);
            }
          }
        }
      }
      if (giftCardTotal > 0 || walletTotal > 0) {
        await tx.sale.update({
          where: { id: sale.id },
          data: {
            giftCardAmount: giftCardTotal > 0 ? giftCardTotal : null,
            walletAmount: walletTotal > 0 ? walletTotal : null,
          },
        });
      }

      // Udhaar/khata (Wave B2): the unpaid part of a customer sale is
      // credit the shop has extended — record it on the customer's
      // ledger in this same transaction so the khata can never
      // disagree with the sale. A customer sale paid in full at the
      // counter writes no row.
      const dueAmount = round2(totalAmount - paidAmount);
      if (saleData.customerId && dueAmount > 0) {
        // Credit limit (gap item 7): the unpaid part of this sale
        // would add `dueAmount` to the customer's khata. When the
        // customer has a limit and balance + due would exceed it,
        // block the sale (402) unless the request carries an explicit
        // owner/manager override. No limit set = unlimited, exactly
        // as before. Checked inside the transaction so the balance
        // read and the SALE_DUE write below are atomic.
        const creditCheck = await checkCreditLimit(tx, saleData.customerId, targetCompanyId, dueAmount);
        if (creditCheck && !creditCheck.allowed) {
          const overrideAllowed =
            saleData.creditLimitOverride === true &&
            (CREDIT_LIMIT_OVERRIDE_ROLES as readonly string[]).includes(getUserRole(req));
          if (!overrideAllowed) {
            // !allowed implies a limit IS set (checkCreditLimit returns
            // null when there is none), so creditLimit is a number here.
            const limit = creditCheck.creditLimit as number;
            const e: any = new HttpError(
              402,
              `Credit limit exceeded: this sale would take the customer's outstanding khata to PKR ${creditCheck.projectedBalance.toFixed(2)} against a limit of PKR ${limit.toFixed(2)} (current balance PKR ${creditCheck.balance.toFixed(2)}, over by PKR ${creditCheck.overBy.toFixed(2)}). Reduce the credit amount, collect a payment, or ask an owner/manager to approve an override.`
            );
            e.code = CREDIT_LIMIT_EXCEEDED;
            e.details = {
              customerId: saleData.customerId,
              balance: creditCheck.balance,
              creditLimit: limit,
              projectedBalance: creditCheck.projectedBalance,
              overBy: creditCheck.overBy,
              dueAmount
            };
            throw e;
          }
        }
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
      // Base the next number on the numerically-largest existing receipt
      // number and verify the candidate is free before using it. Ordering
      // by id is NOT safe here: rows inserted by backup restore / imports
      // carry fresh cuid2 ids that do not sort by creation time, so
      // "last by id" can name an old receipt whose +1 already exists —
      // that collision (P2002, no retry) used to fail the whole sale.
      let receiptNumber: string | null = null;
      for (let attempt = 0; attempt < 20 && !receiptNumber; attempt++) {
        const topReceipt = await tx.receipt.findFirst({
          orderBy: { receiptNumber: 'desc' },
          select: { receiptNumber: true }
        });

        let candidate: string;
        const match = topReceipt?.receiptNumber?.match(/RCN-(\d+)/);
        if (match) {
          const nextNumber = (parseInt(match[1], 10) + 1 + attempt) % 99999 || 10000; // Wrap around at 99999
          candidate = `RCN-${String(nextNumber).padStart(5, '0')}`;
        } else if (topReceipt) {
          // Fallback: generate random 4-5 digit number
          candidate = `RCN-${String(Math.floor(Math.random() * 90000) + 10000)}`;
        } else {
          // First receipt: start from 10000
          candidate = 'RCN-10000';
        }

        const existingReceipt = await tx.receipt.findUnique({
          where: { receiptNumber: candidate },
          select: { id: true }
        });
        if (!existingReceipt) {
          receiptNumber = candidate;
        }
      }
      if (!receiptNumber) {
        // Defensive fallback (mirrors the invoice-number generator)
        receiptNumber = `RCN-${Date.now().toString().slice(-8)}`;
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
        // Salesperson attribution (Wave C6): surfaced beside the
        // cashier so receipts and history can credit the seller.
        salesperson: {
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
                barcode: true,
                // Loose / by-weight selling (Stage 1): nested product
                // unitType lets stored-line renderers (Invoices /
                // Refunds / reprints) show "0.500 kg", never "tablets".
                // Cast until the Prisma client is regenerated.
                ...( { unitType: true } as any )
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
        provincialTaxLines: true,
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
        },
        // Prescriptions (Wave C1): the register summary the receipt
        // prints ("Rx: <patient> (Dr. <doctor>)"); null when none.
        prescription: {
          select: {
            id: true,
            patientName: true,
            patientPhone: true,
            doctorName: true,
            doctorReg: true,
            issuedDate: true
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
        // Provincial tax (Gap item 1): the per-authority breakdown
        // behind provincialTaxAmount (empty when no config applied).
        provincialTaxBreakdown: serializeProvincialTaxBreakdown(completeSale),
        provincialTaxAmount: completeSale.provincialTaxAmount ?? 0,
        // FBR POS (Wave B7): fiscal status at response time (the
        // number itself is filled in asynchronously by the worker).
        fbrStatus,
        fbrInvoiceNumber,
        // Prescriptions (Wave C1): true when the sale contained
        // prescription-only items but the business has enforcement
        // OFF and no prescription was attached — the POS warns the
        // cashier after the sale. The attached record itself rides
        // along in the spread above as `prescription`.
        prescriptionWarning
      }
    });
  } catch (error) {
    console.error('Create sale error:', error);
    // Typed domain errors (insufficient stock, expired batch) carry their
    // own HTTP status (A-12); everything else stays a 500.
    const statusCode = (error as any)?.statusCode;
    // Domain errors may additionally carry a machine-readable code +
    // structured details (Wave C1 prescriptions: PRESCRIPTION_REQUIRED
    // and friends, with the offending products) — pass them through so
    // clients can react specifically instead of parsing the message.
    // Scoped to HttpError so raw ORM/driver errors never leak theirs.
    const domainCode = error instanceof HttpError ? (error as any).code : undefined;
    const domainDetails = error instanceof HttpError ? (error as any).details : undefined;
    return res.status(typeof statusCode === 'number' ? statusCode : 500).json({
      success: false,
      message: error instanceof Error ? error.message : 'Internal server error',
      ...(domainCode ? { code: domainCode } : {}),
      ...(domainDetails ? { data: domainDetails } : {})
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
        provincialTaxLines: true,
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
    let newProvincialTaxAmount = Number((existingSale as any).provincialTaxAmount || 0);
    // Tax classes (Wave B5): the per-class groups behind newTaxAmount
    // when a discount edit recomputes it (null = tax untouched, the
    // stored breakdown stays as created).
    let newTaxGroups: TaxGroup[] | null = null;
    // Provincial tax (Gap item 1): the fresh groups when a discount
    // edit recomputes it (null = provincial tax untouched, the stored
    // lines stay as created).
    let newProvincialTaxGroups: ProvincialTaxLine[] | null = null;

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
      // Provincial tax (Gap item 1): recompute through the same
      // engine createSale uses, on the new discounted base, resolving
      // the CURRENT config for the sale's branch — the same "current
      // rules" basis the legacy code applied by re-reading the current
      // defaultTax. No config → 0, and the stored lines are replaced
      // with none (a retired config stops charging future edits).
      try {
        const provConfigsForUpdate = await prisma.provincialTaxConfig.findMany({
          where: { companyId: existingSale.companyId }
        });
        const provResultForUpdate = computeProvincialTax({
          taxableBase: subtotalAfterDiscount,
          config: resolveProvincialTaxConfig(provConfigsForUpdate, existingSale.branchId)
        });
        newProvincialTaxAmount = provResultForUpdate.provincialTaxAmount;
        newProvincialTaxGroups = provResultForUpdate.lines;
      } catch (provincialTaxError) {
        console.warn('Could not recompute provincial tax for sale update, keeping stored value:', provincialTaxError);
        newProvincialTaxGroups = null;
      }
      newTotalAmount = subtotalAfterDiscount + newTaxAmount + newProvincialTaxAmount;
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
        provincialTaxAmount: newProvincialTaxAmount,
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

    // Provincial tax (Gap item 1): same replace-the-rows pattern as
    // the tax lines above, so the breakdown always sums to the sale's
    // provincialTaxAmount. newProvincialTaxGroups is null only when
    // the recompute itself failed — then the stored lines stay.
    if (newProvincialTaxGroups) {
      try {
        await prisma.saleProvincialTaxLine.deleteMany({ where: { saleId: id } });
        if (newProvincialTaxGroups.length > 0) {
          await prisma.saleProvincialTaxLine.createMany({
            data: newProvincialTaxGroups.map(g => ({
              saleId: id,
              authority: g.authority,
              authorityName: g.authorityName,
              registrationNumber: g.registrationNumber,
              rate: g.rate,
              taxableAmount: g.taxableAmount,
              taxAmount: g.taxAmount
            }))
          });
        }
      } catch (provTaxLineError) {
        console.error('[Provincial Tax] Failed to refresh provincial tax lines for sale', id, provTaxLineError);
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
      provincialTaxAmount: Number((updatedSale as any).provincialTaxAmount || 0),
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
        : serializeTaxBreakdown(existingSale),
      // Provincial tax (Gap item 1): the fresh lines when the edit
      // recomputed them, else the breakdown stored at creation.
      provincialTaxBreakdown: newProvincialTaxGroups
        ? newProvincialTaxGroups.map(g => ({
          authority: g.authority,
          authorityName: g.authorityName,
          registrationNumber: g.registrationNumber,
          rate: g.rate,
          taxableAmount: g.taxableAmount,
          taxAmount: g.taxAmount
        }))
        : serializeProvincialTaxBreakdown(existingSale)
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
      // Unit conversion (gap-features item 3): load the FEFO
      // allocation rows BEFORE the items are deleted — the rows
      // cascade with their SaleItem, so they must be read first.
      // A pre-migration DB has no sale_item_batches table; the
      // P2021 fallback below then restocks via batchId exactly as
      // before. NOTE: `saleItemBatch` is typed on the generated
      // client only after `npm run setup:web` regenerates it (deploy
      // does this); the `as any` bridge keeps tsc green in this
      // sandbox, where `prisma generate` cannot fetch its engine.
      const allocationsByItem = new Map<string, { batchId: string; qty: number }[]>();
      try {
        const allocRows = await (tx as any).saleItemBatch.findMany({
          where: { saleItemId: { in: existingSale.items.map((i: any) => i.id) } },
          orderBy: { createdAt: 'asc' }
        });
        for (const row of allocRows) {
          const list = allocationsByItem.get(row.saleItemId) || [];
          list.push({ batchId: row.batchId, qty: row.quantity });
          allocationsByItem.set(row.saleItemId, list);
        }
      } catch (e: any) {
        if (e?.code !== 'P2021' && !/sale_item_batches/i.test(String(e?.message || ''))) throw e;
      }

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
          // Restore the BASE units this line deducted — the same
          // unitsDeducted-first rule refunds apply. Wave C2 lines
          // store quantity == unitsDeducted == base, and on
          // UNIT/voice/desktop lines the two are always equal, so
          // only legacy BOX lines change: they now restock fully
          // instead of by their box count.
          const restoreQty = item.unitsDeducted && item.unitsDeducted > 0 ? item.unitsDeducted : item.quantity;
          // Unit conversion (gap-features item 3): a line that drew
          // from several batches restocks EACH batch by its own
          // allocation row (the rows sum to restoreQty); lines
          // without rows — pre-change or desktop-synced — keep the
          // historical single-batch restock via batchId.
          const itemAllocations = allocationsByItem.get(item.id);
          if (itemAllocations && itemAllocations.length > 0) {
            for (const alloc of itemAllocations) {
              // Update batch quantity - use raw SQL directly to avoid reportReason column issues
              await tx.$executeRawUnsafe(
                `UPDATE batches 
                 SET quantity = quantity + ${alloc.qty},
                     "updatedAt" = CURRENT_TIMESTAMP
                 WHERE id = '${alloc.batchId}'`
              );
            }
          } else if (item.batchId) {
            // Update batch quantity - use raw SQL directly to avoid reportReason column issues
            await tx.$executeRawUnsafe(
              `UPDATE batches 
               SET quantity = quantity + ${restoreQty},
                   "updatedAt" = CURRENT_TIMESTAMP
               WHERE id = '${item.batchId}'`
            );
          } else {
            continue;
          }

          // Create stock movement for restoration
          await tx.stockMovement.create({
            data: {
              productId: item.productId,
              type: 'IN',
              quantity: restoreQty,
              reason: 'Sale Deletion - Stock Restored',
              reference: id,
              createdBy: req.user?.createdBy || req.user?.id || 'default-admin-id'
            }
          });
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
