import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AuthRequest, buildBranchWhereClause, buildBranchWhereClauseForRelation } from '../middleware/auth.middleware';
import { notifyRefundChange } from '../routes/sse.routes';
import { SALE_PAYMENT_METHODS } from './sale.controller';
import { syncAfterOperation, pullLatestFromLive } from '../utils/sync-helper';
import Joi from 'joi';

// Utility function to convert BigInt, Decimal, and Date values to strings for JSON serialization
function serializeBigInt(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'bigint') {
    return obj.toString();
  }

  if (obj instanceof Date) {
    return obj.toISOString();
  }

  // Handle Prisma Decimal values
  if (obj && typeof obj === 'object' && obj.constructor && obj.constructor.name === 'Decimal') {
    return obj.toString();
  }

  // Handle Prisma Decimal values (alternative check)
  if (obj && typeof obj === 'object' && obj.toString && typeof obj.toString === 'function' && obj.constructor && obj.constructor.name === 'i') {
    return obj.toString();
  }

  if (Array.isArray(obj)) {
    return obj.map(serializeBigInt);
  }

  if (typeof obj === 'object') {
    // Check if it's a Date-like object (Prisma sometimes returns Date-like objects)
    if (obj.constructor && obj.constructor.name === 'Date') {
      return new Date(obj).toISOString();
    }
    const serialized: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        serialized[key] = serializeBigInt(obj[key]);
      }
    }
    return serialized;
  }

  return obj;
}

interface RefundItem {
  productId: string;
  quantity: number;
  unitsDeducted?: number;
  // Accepted in requests for backward compatibility but NEVER used for
  // pricing — refund amounts come from the stored sale items (A-03).
  unitPrice?: number;
  reason: string;
}

interface CreateRefundData {
  originalSaleId: string;
  refundReason: string;
  items: RefundItem[];
  // NOTE: no `refundedBy` — the acting user is always req.user.id (A-07).
}

const createRefundSchema = Joi.object({
  originalSaleId: Joi.string().optional(), // Optional - can use invoiceNumber instead
  invoiceNumber: Joi.string().optional(), // Optional - can use originalSaleId instead
  refundReason: Joi.string().required(),
  items: Joi.array().items(
    Joi.object({
      productId: Joi.string().required(),
      quantity: Joi.number().positive().required(),
      unitsDeducted: Joi.number().positive().optional(),
      unitPrice: Joi.number().positive().optional(), // Ignored — see RefundItem note
      reason: Joi.string().required(),
      batchId: Joi.string().allow(null, '').optional(), // Optional batch ID for stock return
      saleItemId: Joi.string().allow(null, '').optional() // Optional sale item ID
    })
  ).min(1).required(),
  // Refund tender (Wave B1): which tender the money goes back through.
  // Optional — defaults to the original sale's largest allocation
  // method (or its headline paymentMethod for pre-B1 sales).
  refundMethod: Joi.string().valid(...SALE_PAYMENT_METHODS).optional(),
  refundReference: Joi.string().allow('', null).max(120).optional()
  // NOTE: no `refundedBy` field — a client-supplied value is not accepted;
  // the refund is always attributed to the authenticated caller (A-07).
}).or('originalSaleId', 'invoiceNumber'); // At least one must be provided

export const createRefund = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();

    const { error } = createRefundSchema.validate(req.body);
    if (error) {
      res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
      return;
    }

    const { originalSaleId, invoiceNumber, refundReason, items, refundMethod, refundReference } = req.body;

    // The refund is always attributed to the authenticated caller (A-07)
    const actorId = req.user?.id;
    if (!actorId) {
      res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
      return;
    }

    // Scope the sale lookup to the caller's business context (A-02 model:
    // the same scoping the sale list handlers apply). Membership context
    // first, falling back to the caller's selected company — a sale from
    // another tenant is indistinguishable from a missing sale.
    const scope = buildBranchWhereClause(req, {});
    const scopeCompanyId = scope.companyId && scope.companyId !== 'no-business-context'
      ? scope.companyId
      : (req.user?.selectedCompanyId || req.user?.companyId);
    const saleScope = {
      ...(scopeCompanyId ? { companyId: scopeCompanyId } : {}),
      ...(scope.branchId ? { branchId: scope.branchId } : {})
    };

    // Find sale by invoice number or sale ID — always WITH its items, which
    // are the only trusted source for refund quantities and prices (A-03)
    let originalSale = null;
    if (invoiceNumber) {
      // Search by invoice number
      originalSale = await prisma.sale.findFirst({
        where: {
          invoiceNumber: invoiceNumber,
          ...saleScope
        },
        include: {
          items: {
            include: {
              product: true,
              batch: true
            }
          },
          payments: true
        }
      });
    } else if (originalSaleId) {
      // Search by sale ID (backward compatibility)
      originalSale = await prisma.sale.findFirst({
        where: {
          id: originalSaleId,
          ...saleScope
        },
        include: {
          items: {
            include: {
              product: true,
              batch: true
            }
          },
          payments: true
        }
      });
    }

    if (!originalSale) {
      res.status(404).json({
        success: false,
        message: invoiceNumber
          ? `Sale with invoice number "${invoiceNumber}" not found`
          : `Sale with ID "${originalSaleId}" not found`
      });
      return;
    }

    // A fully refunded sale is terminal; a partially refunded one stays
    // refundable for its remaining quantities (A-08)
    if (originalSale.status === 'REFUNDED') {
      res.status(400).json({
        success: false,
        message: 'This sale has already been refunded'
      });
      return;
    }

    // ---- Validate every requested item against the original sale (A-03) --
    // RefundItem rows carry no sale-item link, so prior refunds are tracked
    // per product. Quantities sold are likewise totalled per product.
    const priorRefunds = await prisma.refund.findMany({
      where: { originalSaleId: originalSale.id },
      include: { items: true }
    });
    const alreadyRefundedByProduct = new Map<string, number>();
    for (const prior of priorRefunds) {
      for (const priorItem of prior.items) {
        alreadyRefundedByProduct.set(
          priorItem.productId,
          (alreadyRefundedByProduct.get(priorItem.productId) || 0) + priorItem.quantity
        );
      }
    }

    const soldByProduct = new Map<string, number>();
    for (const saleItem of originalSale.items) {
      soldByProduct.set(
        saleItem.productId,
        (soldByProduct.get(saleItem.productId) || 0) + saleItem.quantity
      );
    }

    const requestedByProduct = new Map<string, number>();
    for (const item of items) {
      requestedByProduct.set(
        item.productId,
        (requestedByProduct.get(item.productId) || 0) + item.quantity
      );
    }

    // Resolve each requested item to the sale line(s) it refunds: by
    // saleItemId when provided, else by productId + batchId, else by
    // productId alone. Split the requested quantity across the matched
    // lines (in sale order), never beyond what a line actually sold.
    interface RefundAllocation {
      saleItem: any;
      quantity: number;
      reason: string;
    }
    const allocations: RefundAllocation[] = [];

    for (const item of items) {
      let matchedLines: any[] = [];
      if (item.saleItemId) {
        const line = originalSale.items.find((si: any) => si.id === item.saleItemId);
        if (line && line.productId === item.productId) {
          matchedLines = [line];
        }
      } else if (item.batchId) {
        const line = originalSale.items.find(
          (si: any) => si.productId === item.productId && si.batchId === item.batchId
        );
        if (line) {
          matchedLines = [line];
        }
      } else {
        matchedLines = originalSale.items.filter((si: any) => si.productId === item.productId);
      }

      if (matchedLines.length === 0) {
        res.status(422).json({
          success: false,
          message: `Product ${item.productId} is not part of sale ${originalSale.invoiceNumber || originalSale.id}; it cannot be refunded against this sale`
        });
        return;
      }

      let remainingForItem = item.quantity;
      for (const line of matchedLines) {
        if (remainingForItem <= 0) break;
        const claimedFromLine = allocations
          .filter(a => a.saleItem.id === line.id)
          .reduce((sum, a) => sum + a.quantity, 0);
        const take = Math.min(line.quantity - claimedFromLine, remainingForItem);
        if (take > 0) {
          allocations.push({ saleItem: line, quantity: take, reason: item.reason });
          remainingForItem -= take;
        }
      }
    }

    // Enforce the refund cap per product:
    // already refunded + requested in this call must not exceed sold (A-03)
    let capError: string | null = null;
    requestedByProduct.forEach((requestedQty, productId) => {
      if (capError) return;
      const soldQty = soldByProduct.get(productId) || 0;
      const alreadyRefunded = alreadyRefundedByProduct.get(productId) || 0;
      if (alreadyRefunded + requestedQty > soldQty) {
        capError = `Refund quantity exceeds the sold quantity for product ${productId}. Sold: ${soldQty}, already refunded: ${alreadyRefunded}, requested: ${requestedQty}`;
      }
    });
    if (capError) {
      res.status(422).json({
        success: false,
        message: capError
      });
      return;
    }

    // Every requested unit must have been allocated to a concrete sale line
    const allocatedByProduct = new Map<string, number>();
    for (const alloc of allocations) {
      allocatedByProduct.set(
        alloc.saleItem.productId,
        (allocatedByProduct.get(alloc.saleItem.productId) || 0) + alloc.quantity
      );
    }
    let allocationError: string | null = null;
    requestedByProduct.forEach((requestedQty, productId) => {
      if (allocationError) return;
      if ((allocatedByProduct.get(productId) || 0) !== requestedQty) {
        allocationError = `Requested refund quantity for product ${productId} cannot be matched against the lines of this sale`;
      }
    });
    if (allocationError) {
      res.status(422).json({
        success: false,
        message: allocationError
      });
      return;
    }

    // Refund amounts come ONLY from the stored sale lines (A-03): a line's
    // effective unit price is totalPrice / quantity, which already carries
    // that line's discount share. Client-sent prices are never used.
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const effectiveUnitPrice = (saleItem: any): number =>
      saleItem.quantity > 0 ? saleItem.totalPrice / saleItem.quantity : saleItem.unitPrice;
    let refundAmount = 0;
    for (const alloc of allocations) {
      refundAmount += round2(alloc.quantity * effectiveUnitPrice(alloc.saleItem));
    }
    refundAmount = round2(refundAmount);

    // Use transaction to ensure data consistency
    const result = await prisma.$transaction(async (tx: any) => {
      // Create refund record — refundedBy/createdBy are the authenticated
      // caller, never client input (A-07)
      // Refund tender (Wave B1): the client's choice when sent, else
      // the original sale's largest tender allocation (its headline
      // paymentMethod for pre-B1 sales without allocations; a stored
      // 'MIXED' headline with no allocations is not a tender → null).
      const largestAllocation = Array.isArray((originalSale as any).payments)
        ? [...(originalSale as any).payments].sort((a: any, b: any) => Number(b.amount || 0) - Number(a.amount || 0))[0]
        : undefined;
      const effectiveRefundMethod = refundMethod
        || largestAllocation?.method
        || (originalSale.paymentMethod && originalSale.paymentMethod !== 'MIXED' ? originalSale.paymentMethod : null);

      const refund = await tx.refund.create({
        data: {
          originalSaleId: originalSale.id,
          refundReason,
          refundMethod: effectiveRefundMethod,
          refundReference: refundReference || null,
          refundedBy: actorId,
          refundAmount,
          createdBy: actorId,
          status: 'PROCESSED',
          processedAt: new Date()
        }
      });

      // Process each validated allocation: one refund item per sale line,
      // priced from the stored line, restocking the batch the units came
      // from — only ever the validated quantities (A-03)
      const refundItems = [];
      for (const alloc of allocations) {
        const saleItem = alloc.saleItem;

        // Stock units to return, derived from the SALE line's own ratio
        // (a BOX line of `quantity` boxes deducted `unitsDeducted` units),
        // never from client-supplied figures
        const unitsPerSoldUnit = saleItem.quantity > 0
          ? (saleItem.unitsDeducted && saleItem.unitsDeducted > 0 ? saleItem.unitsDeducted : saleItem.quantity) / saleItem.quantity
          : 1;
        const unitsToReturn = Math.round(alloc.quantity * unitsPerSoldUnit);

        // Create refund item record at the stored line price
        const refundItem = await tx.refundItem.create({
          data: {
            refundId: refund.id,
            productId: saleItem.productId,
            quantity: alloc.quantity,
            unitPrice: round2(effectiveUnitPrice(saleItem)),
            reason: alloc.reason,
            createdBy: actorId
          }
        });

        // Restock the batch this sale line drew from; only when the line
        // carries no batch do we fall back to the branch's earliest-expiring
        // active batch for the product (previous behaviour)
        let restockBatchId = saleItem.batchId;
        if (!restockBatchId) {
          const activeBatch = await tx.batch.findFirst({
            where: {
              productId: saleItem.productId,
              branchId: originalSale.branchId,
              isActive: true
            },
            orderBy: { expireDate: 'asc' }
          });
          if (activeBatch) {
            restockBatchId = activeBatch.id;
          }
        }

        if (restockBatchId && unitsToReturn > 0) {
          await tx.batch.update({
            where: { id: restockBatchId },
            data: {
              quantity: {
                increment: unitsToReturn
              }
            }
          });
        }

        // Create stock movement record for the return
        await tx.stockMovement.create({
          data: {
            productId: saleItem.productId,
            type: 'RETURN',
            quantity: unitsToReturn,
            reason: `Refund: ${alloc.reason}`,
            reference: `REF-${refund.id}`,
            createdBy: actorId
          }
        });

        refundItems.push(refundItem);
      }

      // Sale status after this refund (A-08): REFUNDED only once every
      // product on the sale is fully refunded; otherwise the sale stays
      // open for the remaining quantities as PARTIALLY_REFUNDED
      const refundedAfterByProduct = new Map<string, number>(alreadyRefundedByProduct);
      for (const alloc of allocations) {
        refundedAfterByProduct.set(
          alloc.saleItem.productId,
          (refundedAfterByProduct.get(alloc.saleItem.productId) || 0) + alloc.quantity
        );
      }
      let fullyRefunded = true;
      soldByProduct.forEach((soldQty, productId) => {
        if ((refundedAfterByProduct.get(productId) || 0) < soldQty) {
          fullyRefunded = false;
        }
      });

      await tx.sale.update({
        where: { id: originalSale.id },
        data: {
          status: fullyRefunded ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
          updatedAt: new Date()
        }
      });

      // Udhaar/khata (Wave B2): when the refunded sale was made on
      // credit, the refund first cancels what the customer still owes
      // on it — only the excess over the outstanding due is money
      // handed back, and only the cancelled part touches the khata.
      // Outstanding on this sale = total − paid − refunds already
      // processed (priorRefunds was read before this transaction, so
      // it does not include the refund being created here).
      if (originalSale.customerId) {
        const priorRefundTotal = priorRefunds.reduce(
          (sum, r) => sum + Number(r.refundAmount || 0),
          0
        );
        const outstandingDue = round2(Math.max(
          0,
          Number(originalSale.totalAmount) - Number(originalSale.paidAmount || 0) - priorRefundTotal
        ));
        const dueReduction = Math.min(refundAmount, outstandingDue);
        if (dueReduction > 0) {
          await tx.customerLedgerEntry.create({
            data: {
              companyId: originalSale.companyId,
              customerId: originalSale.customerId,
              type: 'REFUND',
              amount: -dueReduction,
              note: `Refund against invoice ${originalSale.invoiceNumber || originalSale.id} adjusted in udhaar`,
              saleId: originalSale.id,
              createdBy: actorId
            }
          });
        }
      }

      return { refund, refundItems };
    });

    // Send real-time notification to all users of the same admin
    const createdBy = req.user?.createdBy || req.user?.id;
    if (createdBy) {
      notifyRefundChange(createdBy, 'created', result.refund);
    }

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('refund', 'create', result.refund).catch(err => {
      console.error('[Sync] Refund create sync failed:', err.message);
    });

    res.status(201).json({
      success: true,
      data: {
        refund: result.refund,
        items: result.refundItems
      },
      message: 'Refund processed successfully. Items have been added back to inventory.'
    });

  } catch (error: any) {
    console.error('Create refund error:', error);
    res.status(500).json({
      success: false,
      message: error?.message || 'Internal server error'
    });
  }
};

export const getRefunds = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const {
      page = 1,
      limit = 10,
      search = '',
      startDate = '',
      endDate = '',
      branchId = ''
    } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    console.log('🔍 getRefunds - User context:', {
      userId: req.user?.id,
      role: req.user?.role,
      branchId: req.user?.branchId,
      companyId: req.user?.companyId,
      createdBy: req.user?.createdBy
    });

    // Build where clause - filter by original sale's branch/company
    const whereClause: any = {};

    // Get the target branch/company based on user role
    let targetBranchId = req.user?.selectedBranchId || req.user?.branchId;
    let targetCompanyId = req.user?.selectedCompanyId || req.user?.companyId;

    // If user has branchId but no companyId, get it from branch
    if (targetBranchId && !targetCompanyId) {
      const branch = await prisma.branch.findUnique({
        where: { id: targetBranchId },
        select: { companyId: true }
      });
      if (branch?.companyId) {
        targetCompanyId = branch.companyId;
      }
    }

    // Filter refunds through their original sale
    if (req.user?.role === 'OWNER') {
      // Admin sees refunds from sales created by them or their staff
      whereClause.originalSale = {
        createdBy: req.user.createdBy || req.user.id
      };
    } else if (req.user?.role === 'MANAGER' && targetBranchId) {
      // Manager sees refunds for their branch
      whereClause.originalSale = {
        branchId: targetBranchId
      };
    } else if (req.user?.role === 'CASHIER' && targetBranchId) {
      // Cashier sees refunds for their branch
      whereClause.originalSale = {
        branchId: targetBranchId
      };
    }

    // Apply branch filter if provided
    if (branchId) {
      whereClause.originalSale = {
        ...whereClause.originalSale,
        branchId: branchId as string
      };
    }

    // Search filter
    if (search) {
      whereClause.OR = [
        { refundReason: { contains: search as string } },
        { id: { contains: search as string } }
      ];
    }

    // Date range filter
    if (startDate || endDate) {
      whereClause.createdAt = {};
      if (startDate) {
        whereClause.createdAt.gte = new Date(startDate as string);
      }
      if (endDate) {
        const endDateWithTime = new Date(endDate as string);
        endDateWithTime.setHours(23, 59, 59, 999);
        whereClause.createdAt.lte = endDateWithTime;
      }
    }

    console.log('🔍 getRefunds - Where clause:', JSON.stringify(whereClause, null, 2));

    const [refunds, total] = await Promise.all([
      prisma.refund.findMany({
        where: whereClause,
        include: {
          originalSale: {
            include: {
              customer: true,
              user: {
                select: {
                  id: true,
                  name: true,
                  username: true
                }
              },
              receipts: true,
              items: {
                include: {
                  product: true
                }
              }
            }
          },
          items: {
            include: {
              product: true
            }
          },
          refundedByUser: {
            select: {
              id: true,
              name: true,
              username: true
            }
          }
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit)
      }),
      prisma.refund.count({ where: whereClause })
    ]);

    console.log('🔍 getRefunds - Found', refunds.length, 'refunds, total:', total);

    const serializedRefunds = serializeBigInt(refunds);

    res.json({
      success: true,
      data: {
        refunds: serializedRefunds,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      }
    });

  } catch (error) {
    console.error('Get refunds error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

export const getRefundById = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    const refund = await prisma.refund.findUnique({
      where: { id },
      include: {
        originalSale: {
          include: {
            customer: true,
            user: true,
            receipts: true,
            items: {
              include: {
                product: true
              }
            }
          }
        },
        items: {
          include: {
            product: true
          }
        },
        refundedByUser: {
          select: {
            id: true,
            name: true,
            username: true
          }
        }
      }
    });

    if (!refund) {
      res.status(404).json({
        success: false,
        message: 'Refund not found'
      });
      return;
    }

    res.json({
      success: true,
      data: serializeBigInt(refund)
    });

  } catch (error) {
    console.error('Get refund by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};
