import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import Joi from 'joi';
import { AuthRequest } from '../middleware/auth.middleware';
import { syncAfterOperation } from '../utils/sync-helper';

// ─── Inter-branch stock transfers (Roadmap A9) ────────────────────────────
// Replaces the old mock Inventory Transfers UI, which kept branch records
// and transfer state in the browser and never moved stock.
//
// Lifecycle (two-step):
//   CREATE   → status PENDING. Source batch stock is VALIDATED but NOT
//              reserved or moved — the batch stays fully sellable until
//              the transfer is received. (Documented trade-off: a PENDING
//              transfer does not lock stock, so COMPLETE re-validates.)
//   COMPLETE → atomically, in one transaction: decrement each source
//              batch, increment (or create) the matching batch at the
//              destination branch — same batchNo/expiry/prices — link it
//              as the item's destBatch, and write TRANSFER_OUT /
//              TRANSFER_IN stock movements (same StockMovement mechanism
//              sales and refunds use). If any source batch no longer has
//              enough stock, the whole completion fails with 409 and
//              nothing moves.
//   CANCEL    → PENDING only; nothing ever moved, so nothing to reverse.

// Joi schemas for validation
const createTransferSchema = Joi.object({
  fromBranchId: Joi.string().required(),
  toBranchId: Joi.string().required(),
  notes: Joi.string().optional().allow(''),
  items: Joi.array().items(
    Joi.object({
      productId: Joi.string().required(),
      sourceBatchId: Joi.string().required(),
      quantity: Joi.number().integer().min(1).required(),
    })
  ).min(1).required(),
});

// ─── Tenancy scope (QA A-02) ────────────────────────────────────────────────
// Same resolution chain the purchase controller uses; fails closed with a
// sentinel company id when no business context resolves.
const resolveTransferCompanyId = (req: AuthRequest): string =>
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  req.membership?.business_id ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const transferScopeWhere = (req: AuthRequest, id: string): any => ({
  id,
  companyId: resolveTransferCompanyId(req),
});

const transferInclude = {
  fromBranch: { select: { id: true, name: true, address: true } },
  toBranch: { select: { id: true, name: true, address: true } },
  items: {
    include: {
      product: { select: { id: true, name: true, sku: true, barcode: true } },
      sourceBatch: {
        select: { id: true, batchNo: true, quantity: true, expireDate: true },
      },
      destBatch: {
        select: { id: true, batchNo: true, quantity: true, expireDate: true },
      },
    },
  },
};

const generateTransferNumber = (): string => {
  const now = new Date();
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
  const randPart = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `TRF-${datePart}-${randPart}`;
};

class StockConflictError extends Error {}

// Create a new transfer (PENDING — validates stock, moves nothing)
export const createTransfer = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = createTransferSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message),
      });
    }

    const companyId = resolveTransferCompanyId(req);
    const { fromBranchId, toBranchId, notes } = value;

    if (fromBranchId === toBranchId) {
      return res.status(400).json({
        success: false,
        message: 'Source and destination branches cannot be the same',
      });
    }

    // Both branches must belong to the caller's business (A-02)
    const [fromBranch, toBranch] = await Promise.all([
      prisma.branch.findFirst({ where: { id: fromBranchId, companyId } }),
      prisma.branch.findFirst({ where: { id: toBranchId, companyId } }),
    ]);

    if (!fromBranch || !toBranch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found',
      });
    }

    // Merge duplicate source-batch lines so validation sees the true total
    const quantityByBatch = new Map<string, number>();
    for (const item of value.items) {
      quantityByBatch.set(
        item.sourceBatchId,
        (quantityByBatch.get(item.sourceBatchId) || 0) + item.quantity
      );
    }

    // Validate every source batch: belongs to this business AND the source
    // branch, matches the claimed product, and currently holds enough stock.
    for (const item of value.items) {
      const batch = await prisma.batch.findFirst({
        where: { id: item.sourceBatchId, companyId, branchId: fromBranchId },
        include: { product: { select: { name: true } } },
      });

      if (!batch) {
        return res.status(400).json({
          success: false,
          message: `Source batch not found in the source branch: ${item.sourceBatchId}`,
        });
      }

      if (batch.productId !== item.productId) {
        return res.status(400).json({
          success: false,
          message: `Batch ${batch.batchNo} does not belong to the selected product`,
        });
      }

      const requestedTotal = quantityByBatch.get(item.sourceBatchId) || 0;
      if ((batch.quantity || 0) < requestedTotal) {
        return res.status(409).json({
          success: false,
          message: `Insufficient stock in batch ${batch.batchNo} (${batch.product?.name || 'product'}): available ${batch.quantity || 0}, requested ${requestedTotal}`,
          code: 'INSUFFICIENT_STOCK',
        });
      }
    }

    const transfer = await prisma.$transaction(async (tx: any) => {
      const created = await tx.stockTransfer.create({
        data: {
          transferNumber: generateTransferNumber(),
          companyId,
          fromBranchId,
          toBranchId,
          status: 'PENDING',
          notes: notes || undefined,
          createdBy: req.user?.id,
        },
      });

      for (const item of value.items) {
        await tx.stockTransferItem.create({
          data: {
            transferId: created.id,
            productId: item.productId,
            sourceBatchId: item.sourceBatchId,
            quantity: item.quantity,
          },
        });
      }

      return created;
    });

    const createdTransfer = await prisma.stockTransfer.findUnique({
      where: { id: transfer.id },
      include: transferInclude,
    });

    syncAfterOperation('stockTransfer', 'create', createdTransfer).catch(err => {
      console.error('[Sync] Transfer create sync failed:', err.message);
    });

    return res.status(201).json({
      success: true,
      data: createdTransfer,
      message: 'Transfer created successfully',
    });
  } catch (error) {
    console.error('Create transfer error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// List transfers for the caller's business
export const getTransfers = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { page = 1, limit = 10, status, fromBranchId, toBranchId } = req.query;

    const where: any = { companyId: resolveTransferCompanyId(req) };
    if (status) where.status = status;
    if (fromBranchId) where.fromBranchId = fromBranchId;
    if (toBranchId) where.toBranchId = toBranchId;

    const skip = (Number(page) - 1) * Number(limit);
    const [transfers, total] = await Promise.all([
      prisma.stockTransfer.findMany({
        where,
        include: transferInclude,
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
      }),
      prisma.stockTransfer.count({ where }),
    ]);

    return res.json({
      success: true,
      data: transfers,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error('Get transfers error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get a single transfer by ID (tenancy-scoped)
export const getTransferById = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    const transfer = await prisma.stockTransfer.findFirst({
      where: transferScopeWhere(req, id),
      include: transferInclude,
    });

    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: 'Transfer not found',
      });
    }

    return res.json({
      success: true,
      data: transfer,
    });
  } catch (error) {
    console.error('Get transfer by ID error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Complete (receive) a transfer — the only step that moves stock
export const completeTransfer = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    const transfer = await prisma.stockTransfer.findFirst({
      where: transferScopeWhere(req, id),
      include: {
        items: true,
        fromBranch: { select: { id: true, name: true } },
        toBranch: { select: { id: true, name: true } },
      },
    });

    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: 'Transfer not found',
      });
    }

    if (transfer.status !== 'PENDING') {
      return res.status(409).json({
        success: false,
        message: `Only a PENDING transfer can be completed (current status: ${transfer.status})`,
        code: 'INVALID_TRANSFER_STATUS',
      });
    }

    const actorId = req.user?.id || 'default-admin-id';

    const updated = await prisma.$transaction(async (tx: any) => {
      for (const item of transfer.items) {
        const sourceBatch = await tx.batch.findFirst({
          where: {
            id: item.sourceBatchId,
            companyId: transfer.companyId,
            branchId: transfer.fromBranchId,
          },
        });

        if (!sourceBatch) {
          throw new StockConflictError(
            `Source batch for one of the transfer items no longer exists`
          );
        }

        // Stock was validated at CREATE but never reserved — re-validate
        // now; if part of it was sold meanwhile, fail the whole completion.
        if ((sourceBatch.quantity || 0) < item.quantity) {
          throw new StockConflictError(
            `Insufficient stock in batch ${sourceBatch.batchNo}: available ${sourceBatch.quantity || 0}, transfer needs ${item.quantity}. Nothing was moved.`
          );
        }

        await tx.batch.update({
          where: { id: sourceBatch.id },
          data: { quantity: { decrement: item.quantity } },
        });

        // Destination batch: merge into the existing batch with the same
        // batchNo + product at the destination branch (the Batch model is
        // unique on [batchNo, productId, branchId]), otherwise create it
        // with the source batch's identity (batchNo/expiry/prices).
        let destBatch = await tx.batch.findFirst({
          where: {
            batchNo: sourceBatch.batchNo,
            productId: item.productId,
            branchId: transfer.toBranchId,
          },
        });

        if (destBatch) {
          destBatch = await tx.batch.update({
            where: { id: destBatch.id },
            data: { quantity: { increment: item.quantity } },
          });
        } else {
          destBatch = await tx.batch.create({
            data: {
              batchNo: sourceBatch.batchNo,
              productId: item.productId,
              branchId: transfer.toBranchId,
              companyId: transfer.companyId,
              supplierId: sourceBatch.supplierId,
              supplierName: sourceBatch.supplierName,
              barcode: sourceBatch.barcode,
              quantity: item.quantity,
              purchasePrice: sourceBatch.purchasePrice,
              sellingPrice: sourceBatch.sellingPrice,
              stockPurchasePrice: sourceBatch.stockPurchasePrice,
              expireDate: sourceBatch.expireDate,
              productionDate: sourceBatch.productionDate,
              purchasingMethod: sourceBatch.purchasingMethod,
              createdBy: actorId,
            },
          });
        }

        await tx.stockTransferItem.update({
          where: { id: item.id },
          data: { destBatchId: destBatch.id },
        });

        // Stock movements on both sides — same mechanism sales/refunds use
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            type: 'TRANSFER_OUT',
            quantity: item.quantity,
            reason: `Transfer ${transfer.transferNumber} to ${transfer.toBranch.name}`,
            reference: transfer.id,
            createdBy: actorId,
          },
        });
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            type: 'TRANSFER_IN',
            quantity: item.quantity,
            reason: `Transfer ${transfer.transferNumber} from ${transfer.fromBranch.name}`,
            reference: transfer.id,
            createdBy: actorId,
          },
        });
      }

      return tx.stockTransfer.update({
        where: { id: transfer.id },
        data: {
          status: 'COMPLETED',
          completedBy: actorId,
          completedAt: new Date(),
        },
        include: transferInclude,
      });
    });

    syncAfterOperation('stockTransfer', 'update', updated).catch(err => {
      console.error('[Sync] Transfer complete sync failed:', err.message);
    });

    return res.json({
      success: true,
      data: updated,
      message: 'Transfer completed — stock moved to the destination branch',
    });
  } catch (error: any) {
    if (error instanceof StockConflictError) {
      return res.status(409).json({
        success: false,
        message: error.message,
        code: 'INSUFFICIENT_STOCK',
      });
    }
    console.error('Complete transfer error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Cancel a PENDING transfer (nothing was reserved, so nothing to reverse)
export const cancelTransfer = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { id } = req.params;

    const transfer = await prisma.stockTransfer.findFirst({
      where: transferScopeWhere(req, id),
    });

    if (!transfer) {
      return res.status(404).json({
        success: false,
        message: 'Transfer not found',
      });
    }

    if (transfer.status !== 'PENDING') {
      return res.status(409).json({
        success: false,
        message: `Only a PENDING transfer can be cancelled (current status: ${transfer.status})`,
        code: 'INVALID_TRANSFER_STATUS',
      });
    }

    const updated = await prisma.stockTransfer.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledBy: req.user?.id,
        cancelledAt: new Date(),
      },
      include: transferInclude,
    });

    syncAfterOperation('stockTransfer', 'update', updated).catch(err => {
      console.error('[Sync] Transfer cancel sync failed:', err.message);
    });

    return res.json({
      success: true,
      data: updated,
      message: 'Transfer cancelled',
    });
  } catch (error) {
    console.error('Cancel transfer error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
