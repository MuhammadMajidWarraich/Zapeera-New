import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import Joi from 'joi';
import { AuthRequest } from '../middleware/auth.middleware';
import { syncAfterOperation, pullLatestFromLive } from '../utils/sync-helper';

// Joi schemas for validation
// One line-item shape shared by create and update (Roadmap A10): an update
// that carries `items` sends the SAME payload create accepts — the full
// intended line set — and the backend reconciles stock (see updatePurchase).
const purchaseItemSchema = Joi.object({
  productId: Joi.string().required(),
  quantity: Joi.number().integer().min(1).required(),
  unitPrice: Joi.number().min(0).required(),
  batchNo: Joi.string().optional().allow(''),
  expireDate: Joi.date().iso().optional().allow(null),
  productionDate: Joi.date().iso().optional().allow(null),
});

const createPurchaseSchema = Joi.object({
  supplierId: Joi.string().required(),
  invoiceNo: Joi.string().optional().allow(''),
  purchaseDate: Joi.date().iso().optional(),
  totalAmount: Joi.number().min(0).default(0),
  paidAmount: Joi.number().min(0).default(0),
  notes: Joi.string().optional().allow(''),
  items: Joi.array().items(purchaseItemSchema).min(1).required(),
});

const updatePurchaseSchema = Joi.object({
  supplierId: Joi.string().optional(),
  invoiceNo: Joi.string().optional().allow(''),
  purchaseDate: Joi.date().iso().optional(),
  totalAmount: Joi.number().min(0).optional(),
  paidAmount: Joi.number().min(0).optional(),
  status: Joi.string().valid('PENDING', 'COMPLETED', 'CANCELLED', 'PARTIAL').optional(),
  notes: Joi.string().optional().allow(''),
  // Optional: when present, REPLACES the purchase's lines (full line set,
  // same shape as create) with stock reconciliation — never additive.
  items: Joi.array().items(purchaseItemSchema).min(1).optional(),
});

class StockConflictError extends Error {}

// Unit engine (Wave C2): purchases RECEIVE stock. For a
// pack-structured product (unitsPerPack > 1) a purchase line's
// quantity is expressed in PACKS and its unitPrice is the price of
// ONE pack — that is how suppliers bill. The batch the line lands in
// always records BASE units: quantity = packs x unitsPerPack, and
// purchasePrice / sellingPrice per BASE unit (the basis Batch prices
// have always used — COGS reads batch.purchasePrice x base qty).
// The PurchaseItem itself keeps the supplier's terms (packs, price
// per pack), so purchase totals are unchanged. Unstructured products
// (unitsPerPack 1/null) take the historical path exactly.
interface PurchaseLineStock {
  baseQty: number;
  purchasePrice: number;
  sellingPrice: number;
  totalBoxes?: number;
  unitsPerBox?: number;
}
const purchaseLineStock = (
  product: { unitsPerPack?: number | null } | null | undefined,
  item: { quantity: number; unitPrice: number }
): PurchaseLineStock => {
  const perPack = product?.unitsPerPack && product.unitsPerPack > 1 ? product.unitsPerPack : 1;
  if (perPack <= 1) {
    return { baseQty: item.quantity, purchasePrice: item.unitPrice, sellingPrice: item.unitPrice * 1.2 };
  }
  const perUnitCost = item.unitPrice / perPack;
  return {
    baseQty: item.quantity * perPack,
    purchasePrice: perUnitCost,
    sellingPrice: perUnitCost * 1.2, // Same 20% markup as the legacy path
    totalBoxes: item.quantity,
    unitsPerBox: perPack
  };
};

// The base units a STORED purchase line put into its batch — the
// reversal counterpart of purchaseLineStock, resolved from the
// product's current pack size.
const purchaseLineBaseQty = async (
  tx: any,
  productId: string,
  lineQuantity: number
): Promise<number> => {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { unitsPerPack: true }
  });
  const perPack = product?.unitsPerPack && product.unitsPerPack > 1 ? product.unitsPerPack : 1;
  return lineQuantity * perPack;
};

// ─── Tenancy scope (QA A-02) ────────────────────────────────────────────────
// By-id purchase handlers previously fetched by raw id — any authenticated
// user could read/update/delete another tenant's purchases. Scope them to
// the resolved business context (the same chain getPurchases uses); fails
// closed with a sentinel company id when no context resolves.
const resolvePurchaseCompanyId = (req: AuthRequest): string =>
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  req.membership?.business_id ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const purchaseScopeWhere = (req: AuthRequest, id: string): any => ({
  id,
  companyId: resolvePurchaseCompanyId(req),
});

// Get all purchases
export const getPurchases = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { page = 1, limit = 10, status, supplierId } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const headerBranchId = req.headers['x-branch-id'] as string | undefined;
    const headerCompanyId = req.headers['x-company-id'] as string | undefined;

    const where: any = {
      branchId: req.branch_id || headerBranchId || req.user?.selectedBranchId || req.user?.branchId,
      companyId: req.business_id || headerCompanyId || req.user?.selectedCompanyId || req.user?.companyId,
    };

    if (status) {
      where.status = status;
    }

    if (supplierId) {
      where.supplierId = supplierId;
    }

    const [purchases, total] = await Promise.all([
      prisma.purchase.findMany({
        where,
        include: {
          supplier: {
            select: {
              id: true,
              name: true,
              contactPerson: true,
              phone: true,
            },
          },
          purchaseItems: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  sku: true,
                  barcode: true,
                  unitsPerPack: true, // Wave C2 - the detail view labels pack-based quantities
                  unitsPerStrip: true,
                },
              },
              batch: {
                select: {
                  id: true,
                  batchNo: true,
                  quantity: true,
                  expireDate: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.purchase.count({ where }),
    ]);

    return res.json({
      success: true,
      data: purchases,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get purchases error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get purchase by ID
export const getPurchaseById = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    // Tenancy scope (A-02): only purchases of the caller's business resolve.
    const purchase = await prisma.purchase.findFirst({
      where: purchaseScopeWhere(req, id),
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            contactPerson: true,
            phone: true,
          },
        },
        purchaseItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                barcode: true,
                unitsPerPack: true, // Wave C2 - the detail view labels pack-based quantities
                unitsPerStrip: true,
              },
            },
            batch: {
              select: {
                id: true,
                batchNo: true,
                quantity: true,
                expireDate: true,
                productionDate: true,
              },
            },
          },
        },
      },
    });

    if (!purchase) {
      return res.status(404).json({
        success: false,
        message: 'Purchase not found',
      });
    }

    return res.json({
      success: true,
      data: purchase,
    });
  } catch (error) {
    console.error('Get purchase by ID error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Create new purchase
export const createPurchase = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = createPurchaseSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message),
      });
    }

    const purchaseData = value;
    const headerBranchId = req.headers['x-branch-id'] as string | undefined;
    const headerCompanyId = req.headers['x-company-id'] as string | undefined;

    let branchId: string | undefined =
      req.branch_id || headerBranchId;
    let companyId: string | undefined =
      req.business_id || headerCompanyId;

    // Use multi-tenant context from middleware

    if (!branchId || !companyId) {
      return res.status(400).json({
        success: false,
        message: 'Branch and company context required. Please ensure you have proper access permissions.',
      });
    }

    // Verify supplier exists AND belongs to this branch/company (A-02)
    const supplier = await prisma.supplier.findFirst({
      where: {
        id: purchaseData.supplierId,
        OR: [
          { companyId },
          { branchId },
          { branch: { companyId } },
        ],
      },
    });

    if (!supplier) {
      return res.status(400).json({
        success: false,
        message: 'Supplier not found',
      });
    }

    // Calculate total amount
    const totalAmount = purchaseData.items.reduce((sum: number, item: any) => {
      return sum + (item.quantity * item.unitPrice);
    }, 0);

    const result = await prisma.$transaction(async (tx: any) => {
      // Create purchase
      const purchase = await tx.purchase.create({
        data: {
          supplierId: purchaseData.supplierId,
          branchId,
          companyId,
          invoiceNo: purchaseData.invoiceNo,
          purchaseDate: purchaseData.purchaseDate ? new Date(purchaseData.purchaseDate) : new Date(),
          totalAmount,
          paidAmount: purchaseData.paidAmount,
          outstanding: totalAmount - purchaseData.paidAmount,
          status: purchaseData.paidAmount >= totalAmount ? 'COMPLETED' : 'PENDING',
          notes: purchaseData.notes,
          createdBy: req.user?.id,
        },
      });

      // Create purchase items and batches
      const purchaseItems = [];
      let purchaseItemSeq = 1;
      for (const item of purchaseData.items) {
        // Verify product exists AND belongs to this company (A-02)
        const product = await tx.product.findFirst({
          where: { id: item.productId, companyId },
        });

        if (!product) {
          throw new Error(`Product not found: ${item.productId}`);
        }

        // Stock is managed through batches, so EVERY purchase line must
        // land in a batch. When the caller provides no batchNo (typical for
        // general/non-batch-tracked goods), auto-generate one — previously
        // such lines were recorded and paid for but never entered stock,
        // silently losing the inventory (E2E D-17).
        let batchId = null;
        {
          const lineStock = purchaseLineStock(product, item);
          const batch = await tx.batch.create({
            data: {
              batchNo: item.batchNo || `AUTO-${purchase.id.slice(0, 8)}-${purchaseItemSeq++}`,
              productId: item.productId,
              branchId,
              companyId,
              supplierId: purchaseData.supplierId,
              quantity: lineStock.baseQty,
              purchasePrice: lineStock.purchasePrice,
              sellingPrice: lineStock.sellingPrice, // 20% markup over cost, per base unit
              totalBoxes: lineStock.totalBoxes,
              unitsPerBox: lineStock.unitsPerBox,
              expireDate: item.expireDate ? new Date(item.expireDate) : null,
              productionDate: item.productionDate ? new Date(item.productionDate) : null,
              createdBy: req.user?.id,
            },
          });
          batchId = batch.id;

          // Stock is now managed through batches, no need to update product stock directly
        }

        // Create purchase item
        const purchaseItem = await tx.purchaseItem.create({
          data: {
            purchaseId: purchase.id,
            productId: item.productId,
            batchId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.quantity * item.unitPrice,
          },
        });

        purchaseItems.push(purchaseItem);
      }

      return { purchase, purchaseItems };
    });

    // Fetch the complete purchase with relations
    const completePurchase = await prisma.purchase.findUnique({
      where: { id: result.purchase.id },
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            contactPerson: true,
            phone: true,
          },
        },
        purchaseItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                barcode: true,
                unitsPerPack: true, // Wave C2 - the detail view labels pack-based quantities
                unitsPerStrip: true,
              },
            },
            batch: {
              select: {
                id: true,
                batchNo: true,
                quantity: true,
                expireDate: true,
              },
            },
          },
        },
      },
    });

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('purchase', 'create', completePurchase).catch(err => {
      console.error('[Sync] Purchase create sync failed:', err.message);
    });

    return res.status(201).json({
      success: true,
      data: completePurchase,
      message: 'Purchase created successfully',
    });
  } catch (error) {
    console.error('Create purchase error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update purchase
export const updatePurchase = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;
    const { error, value } = updatePurchaseSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message),
      });
    }

    const updateData = value;
    // `items` is not a Purchase column — pull it out of the header payload
    // and handle it as a line-set replacement below.
    const replacementItems = updateData.items;
    delete updateData.items;

    // Check if purchase exists — scoped to the caller's business (A-02).
    // Lines are included because an items-carrying update must reconcile
    // the stock the existing lines put into batches at create time.
    const existingPurchase = await prisma.purchase.findFirst({
      where: purchaseScopeWhere(req, id),
      include: { purchaseItems: true },
    });

    if (!existingPurchase) {
      return res.status(404).json({
        success: false,
        message: 'Purchase not found',
      });
    }

    // Tenancy guard (A-02): re-pointing the purchase to a different supplier
    // is only allowed within the purchase's own branch/company.
    if (updateData.supplierId && updateData.supplierId !== existingPurchase.supplierId) {
      const supplier = await prisma.supplier.findFirst({
        where: {
          id: updateData.supplierId,
          OR: [
            { companyId: existingPurchase.companyId },
            { branchId: existingPurchase.branchId },
            { branch: { companyId: existingPurchase.companyId } },
          ],
        },
        select: { id: true },
      });
      if (!supplier) {
        return res.status(404).json({
          success: false,
          message: 'Supplier not found',
        });
      }
    }

    // ── Line replacement (Roadmap A10) ─────────────────────────────────────
    // CONTRACT: create lands stock in a fresh batch per line immediately,
    // and a purchase's status is a PAYMENT status (PENDING/PARTIAL/
    // COMPLETED), not a receiving state — there is no "not yet received"
    // purchase whose lines could be edited for free. So an update carrying
    // `items` REPLACES the whole line set, atomically:
    //   1. reverse each existing line's batch quantity,
    //   2. delete the old lines,
    //   3. apply the new lines exactly like create (fresh batch per line),
    //   4. recompute totalAmount/outstanding and re-derive payment status
    //      (unless the caller set a status explicitly).
    // Double-application is impossible: the old lines' stock is reversed
    // in the same transaction before the new lines land. If any existing
    // batch no longer holds its line's full quantity (units were sold),
    // the whole update fails with 409 STOCK_CONFLICT and nothing changes.
    // Reversed batches are left in place (possibly at zero) — sales/refund
    // history may reference them; deletePurchase owns full batch cleanup.
    if (replacementItems) {
      let purchase;
      try {
        purchase = await prisma.$transaction(async (tx: any) => {
          // 1. Reverse the stock effect of the existing lines
          for (const oldItem of existingPurchase.purchaseItems) {
            if (!oldItem.batchId) continue;
            const batch = await tx.batch.findUnique({
              where: { id: oldItem.batchId },
            });
            if (!batch) continue;
            // Wave C2: the batch holds BASE units — a structured
            // line put quantity x unitsPerPack in, so the reversal
            // takes the same base amount back out.
            const oldBaseQty = await purchaseLineBaseQty(tx, oldItem.productId, oldItem.quantity);
            if ((batch.quantity || 0) < oldBaseQty) {
              throw new StockConflictError(
                `Cannot replace the lines of this purchase: batch ${batch.batchNo} holds ${batch.quantity || 0} unit(s) but this purchase put ${oldBaseQty} in — some units have already been sold. Nothing was changed.`
              );
            }
            await tx.batch.update({
              where: { id: batch.id },
              data: { quantity: { decrement: oldBaseQty } },
            });
          }

          // 2. Remove the old lines
          await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });

          // 3. Apply the new line set exactly like createPurchase does
          let purchaseItemSeq = 1;
          for (const item of replacementItems) {
            const product = await tx.product.findFirst({
              where: { id: item.productId, companyId: existingPurchase.companyId },
            });
            if (!product) {
              throw new Error(`Product not found: ${item.productId}`);
            }

            const lineStock = purchaseLineStock(product, item);
            const batch = await tx.batch.create({
              data: {
                batchNo: item.batchNo || `AUTO-${id.slice(0, 8)}-${purchaseItemSeq++}`,
                productId: item.productId,
                branchId: existingPurchase.branchId,
                companyId: existingPurchase.companyId,
                supplierId: updateData.supplierId || existingPurchase.supplierId,
                quantity: lineStock.baseQty,
                purchasePrice: lineStock.purchasePrice,
                sellingPrice: lineStock.sellingPrice, // Same 20% markup as create, per base unit
                totalBoxes: lineStock.totalBoxes,
                unitsPerBox: lineStock.unitsPerBox,
                expireDate: item.expireDate ? new Date(item.expireDate) : null,
                productionDate: item.productionDate ? new Date(item.productionDate) : null,
                createdBy: req.user?.id,
              },
            });

            await tx.purchaseItem.create({
              data: {
                purchaseId: id,
                productId: item.productId,
                batchId: batch.id,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                totalPrice: item.quantity * item.unitPrice,
              },
            });
          }

          // 4. Header fields + recomputed totals/payment status
          const newTotal = replacementItems.reduce(
            (sum: number, item: any) => sum + item.quantity * item.unitPrice,
            0
          );
          const paidAmount =
            updateData.paidAmount !== undefined
              ? updateData.paidAmount
              : existingPurchase.paidAmount;
          const headerData: any = {
            ...updateData,
            totalAmount: newTotal,
            paidAmount,
            outstanding: newTotal - paidAmount,
          };
          if (!headerData.status) {
            headerData.status =
              paidAmount >= newTotal ? 'COMPLETED' : paidAmount > 0 ? 'PARTIAL' : 'PENDING';
          }

          return tx.purchase.update({
            where: { id },
            data: headerData,
            include: {
              supplier: {
                select: {
                  id: true,
                  name: true,
                  contactPerson: true,
                  phone: true,
                },
              },
              purchaseItems: {
                include: {
                  product: {
                    select: {
                      id: true,
                      name: true,
                      sku: true,
                      barcode: true,
                      unitsPerPack: true, // Wave C2
                      unitsPerStrip: true,
                    },
                  },
                  batch: {
                    select: {
                      id: true,
                      batchNo: true,
                      quantity: true,
                      expireDate: true,
                    },
                  },
                },
              },
            },
          });
        });
      } catch (err: any) {
        if (err instanceof StockConflictError) {
          return res.status(409).json({
            success: false,
            message: err.message,
            code: 'STOCK_CONFLICT',
          });
        }
        throw err;
      }

      // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
      syncAfterOperation('purchase', 'update', purchase).catch(err => {
        console.error('[Sync] Purchase update sync failed:', err.message);
      });

      return res.json({
        success: true,
        data: purchase,
        message: 'Purchase updated successfully',
      });
    }

    // Calculate outstanding amount
    if (updateData.paidAmount !== undefined) {
      updateData.outstanding = existingPurchase.totalAmount - updateData.paidAmount;

      // Update status based on payment
      if (updateData.paidAmount >= existingPurchase.totalAmount) {
        updateData.status = 'COMPLETED';
      } else if (updateData.paidAmount > 0) {
        updateData.status = 'PARTIAL';
      } else {
        updateData.status = 'PENDING';
      }
    }

    const purchase = await prisma.purchase.update({
      where: { id },
      data: updateData,
      include: {
        supplier: {
          select: {
            id: true,
            name: true,
            contactPerson: true,
            phone: true,
          },
        },
        purchaseItems: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                barcode: true,
                unitsPerPack: true, // Wave C2 - the detail view labels pack-based quantities
                unitsPerStrip: true,
              },
            },
            batch: {
              select: {
                id: true,
                batchNo: true,
                quantity: true,
                expireDate: true,
              },
            },
          },
        },
      },
    });

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('purchase', 'update', purchase).catch(err => {
      console.error('[Sync] Purchase update sync failed:', err.message);
    });

    return res.json({
      success: true,
      data: purchase,
      message: 'Purchase updated successfully',
    });
  } catch (error) {
    console.error('Update purchase error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Delete purchase
export const deletePurchase = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    // Tenancy scope (A-02): only purchases of the caller's business resolve.
    const purchase = await prisma.purchase.findFirst({
      where: purchaseScopeWhere(req, id),
      include: {
        purchaseItems: {
          include: {
            batch: true,
          },
        },
      },
    });

    if (!purchase) {
      return res.status(404).json({
        success: false,
        message: 'Purchase not found',
      });
    }

    await prisma.$transaction(async (tx: any) => {
      // Reverse stock updates for batches
      for (const item of purchase.purchaseItems) {
        // Stock is now managed through batches, no need to update product stock directly
      }

      // Delete purchase items and batches
      await tx.purchaseItem.deleteMany({
        where: { purchaseId: id },
      });

      // Delete batches created for this purchase
      const batchIds = purchase.purchaseItems
        .filter((item: any) => item.batchId)
        .map((item: any) => item.batchId!);

      if (batchIds.length > 0) {
        await tx.batch.deleteMany({
          where: { id: { in: batchIds } },
        });
      }

      // Delete purchase
      await tx.purchase.delete({
        where: { id },
      });
    });

    // 🔄 IMMEDIATE BIDIRECTIONAL SYNC
    syncAfterOperation('purchase', 'delete', { id }).catch(err => {
      console.error('[Sync] Purchase delete sync failed:', err.message);
    });

    return res.json({
      success: true,
      message: 'Purchase deleted successfully',
    });
  } catch (error) {
    console.error('Delete purchase error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
