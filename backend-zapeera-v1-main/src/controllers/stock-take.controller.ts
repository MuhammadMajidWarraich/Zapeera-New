import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import Joi from 'joi';
import { AuthRequest, getUserRole } from '../middleware/auth.middleware';
import { completionAdjustments, lineVariance, summarizeStockTake } from '../utils/stock-take.util';

// ─── Stock-takes (Wave C6 — Retail pack) ─────────────────────────────
// A formal physical count of one branch. The session is OPEN while
// counting; each counted batch becomes a line whose systemQty is the
// batch quantity AT THE MOMENT OF THE COUNT. Completing the session
// posts every counted line's variance in ONE transaction: the batch
// quantity is SET to the counted quantity and a STOCK_TAKE_ADJUSTMENT
// stock movement records the signed variance (the StockMovement types
// are free strings — TRANSFER_OUT / TRANSFER_IN from the transfers
// module are the precedent). Uncounted lines are never touched.
// At most one OPEN session per branch: two counts fighting over the
// same batches would snapshot against each other (409
// STOCK_TAKE_ALREADY_OPEN).
//
// Movement TYPE: 'STOCK_TAKE_ADJUSTMENT' (new) — quantity is the
// SIGNED variance (negative = shrinkage), reference is the stock-take
// id, and the line remembers its movement id.

const resolveStockTakeCompanyId = (req: AuthRequest): string =>
  req.membership?.business_id ||
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const requireManagerRole = (req: AuthRequest, res: Response, action: string): boolean => {
  const role = getUserRole(req);
  if (!['OWNER', 'MANAGER', 'ADMIN'].includes(role)) {
    res.status(403).json({
      success: false,
      message: `Only the owner or a manager can ${action}`
    });
    return false;
  }
  return true;
};

const createStockTakeSchema = Joi.object({
  branchId: Joi.string().required(),
  note: Joi.string().trim().max(500).allow('', null).optional()
});

const upsertLineSchema = Joi.object({
  batchId: Joi.string().required(),
  countedQty: Joi.number().integer().min(0).required()
});

const lineInclude = {
  product: { select: { id: true, name: true, sku: true } },
  batch: {
    select: {
      id: true,
      batchNo: true,
      expireDate: true,
      variantId: true,
      variant: { select: { id: true, name: true } }
    }
  }
};

const serializeTake = (take: any) => {
  const lines = (take.lines || []).map((line: any) => ({
    ...line,
    // For an OPEN session the variance is a live preview; once
    // COMPLETED it is the frozen column written by completion.
    variance: take.status === 'COMPLETED'
      ? line.variance
      : lineVariance(line.systemQty, line.countedQty)
  }));
  return { ...take, lines, summary: summarizeStockTake(lines) };
};

const findScopedTake = async (prisma: any, req: AuthRequest, id: string) =>
  prisma.stockTake.findFirst({
    where: { id, companyId: resolveStockTakeCompanyId(req) },
    include: { lines: { include: lineInclude, orderBy: { createdAt: 'asc' } } }
  });

// Open a counting session for a branch. One OPEN session per branch.
export const createStockTake = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = createStockTakeSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(d => d.message)
      });
    }

    const companyId = resolveStockTakeCompanyId(req);
    const branch = await prisma.branch.findFirst({
      where: { id: value.branchId, companyId },
      select: { id: true, name: true }
    });
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found in this business' });

    const open = await prisma.stockTake.findFirst({
      where: { companyId, branchId: branch.id, status: 'OPEN' },
      select: { id: true, createdAt: true }
    });
    if (open) {
      return res.status(409).json({
        success: false,
        message: 'A stock-take is already open for this branch — complete or cancel it before starting another',
        code: 'STOCK_TAKE_ALREADY_OPEN',
        data: { openStockTakeId: open.id }
      });
    }

    const take = await prisma.stockTake.create({
      data: {
        companyId,
        branchId: branch.id,
        status: 'OPEN',
        startedBy: req.user?.id || null,
        note: value.note ? String(value.note).trim() || null : null
      },
      include: { lines: true }
    });
    return res.status(201).json({ success: true, data: serializeTake(take) });
  } catch (error: any) {
    console.error('[StockTakes] POST error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to open stock-take' });
  }
};

// List sessions for the business (newest first), each with its
// register summary. Optional branchId / status filters.
export const getStockTakes = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveStockTakeCompanyId(req);
    const where: any = { companyId };
    if (req.query.branchId) where.branchId = String(req.query.branchId);
    if (req.query.status) where.status = String(req.query.status).toUpperCase();

    const takes = await prisma.stockTake.findMany({
      where,
      include: {
        branch: { select: { id: true, name: true } },
        lines: { select: { batchId: true, productId: true, systemQty: true, countedQty: true, variance: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    return res.json({ success: true, data: takes.map(serializeTake) });
  } catch (error: any) {
    console.error('[StockTakes] GET error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to load stock-takes' });
  }
};

// One session with its count lines and variance preview/summary.
export const getStockTake = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const take = await findScopedTake(prisma, req, req.params.id);
    if (!take) return res.status(404).json({ success: false, message: 'Stock-take not found' });

    const withBranch = await prisma.stockTake.findUnique({
      where: { id: take.id },
      select: { branch: { select: { id: true, name: true } } }
    });
    return res.json({ success: true, data: { ...serializeTake(take), branch: withBranch?.branch ?? null } });
  } catch (error: any) {
    console.error('[StockTakes] GET one error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to load stock-take' });
  }
};

// Count (or re-count) one batch in an OPEN session. systemQty is
// snapshotted from the batch at this moment — a re-count re-snapshots,
// because the count moment is when the count is entered.
export const upsertStockTakeLine = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = upsertLineSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(d => d.message)
      });
    }

    const companyId = resolveStockTakeCompanyId(req);
    const take = await prisma.stockTake.findFirst({
      where: { id: req.params.id, companyId },
      select: { id: true, status: true, branchId: true }
    });
    if (!take) return res.status(404).json({ success: false, message: 'Stock-take not found' });
    if (take.status !== 'OPEN') {
      return res.status(409).json({
        success: false,
        message: 'This stock-take is no longer open — its lines are frozen',
        code: 'STOCK_TAKE_NOT_OPEN'
      });
    }

    const batch = await prisma.batch.findFirst({
      where: { id: value.batchId, companyId, branchId: take.branchId },
      select: { id: true, productId: true, quantity: true }
    });
    if (!batch) {
      return res.status(404).json({
        success: false,
        message: 'Batch not found in this stock-take\'s branch'
      });
    }

    const line = await prisma.stockTakeLine.upsert({
      where: { uq_stockTakeLine_take_batch: { stockTakeId: take.id, batchId: batch.id } },
      create: {
        stockTakeId: take.id,
        productId: batch.productId,
        batchId: batch.id,
        systemQty: batch.quantity,
        countedQty: value.countedQty
      },
      update: {
        systemQty: batch.quantity,
        countedQty: value.countedQty
      },
      include: lineInclude
    });
    return res.status(201).json({
      success: true,
      data: { ...line, variance: lineVariance(line.systemQty, line.countedQty) }
    });
  } catch (error: any) {
    console.error('[StockTakes] LINE error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to record the count' });
  }
};

// Remove a counted line from an OPEN session (a mis-scan correction;
// the batch itself is never touched until completion).
export const deleteStockTakeLine = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveStockTakeCompanyId(req);
    const take = await prisma.stockTake.findFirst({
      where: { id: req.params.id, companyId },
      select: { id: true, status: true }
    });
    if (!take) return res.status(404).json({ success: false, message: 'Stock-take not found' });
    if (take.status !== 'OPEN') {
      return res.status(409).json({
        success: false,
        message: 'This stock-take is no longer open — its lines are frozen',
        code: 'STOCK_TAKE_NOT_OPEN'
      });
    }

    const line = await prisma.stockTakeLine.findFirst({
      where: { id: req.params.lineId, stockTakeId: take.id },
      select: { id: true }
    });
    if (!line) return res.status(404).json({ success: false, message: 'Stock-take line not found' });

    await prisma.stockTakeLine.delete({ where: { id: line.id } });
    return res.json({ success: true, message: 'Line removed from the stock-take' });
  } catch (error: any) {
    console.error('[StockTakes] LINE DELETE error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to remove the line' });
  }
};

// Complete the session: post every counted line's variance in ONE
// transaction (batch SET to the counted quantity + a signed
// STOCK_TAKE_ADJUSTMENT movement), freeze the lines, close the
// session. OWNER/MANAGER — this is the step that rewrites stock.
export const completeStockTake = async (req: AuthRequest, res: Response) => {
  try {
    if (!requireManagerRole(req, res, 'complete a stock-take')) return;
    const prisma = await getPrisma();
    const companyId = resolveStockTakeCompanyId(req);
    const take = await findScopedTake(prisma, req, req.params.id);
    if (!take) return res.status(404).json({ success: false, message: 'Stock-take not found' });
    if (take.status !== 'OPEN') {
      return res.status(409).json({
        success: false,
        message: 'This stock-take is no longer open',
        code: 'STOCK_TAKE_NOT_OPEN'
      });
    }

    const adjustments = completionAdjustments(take.lines || []);
    const countedLines = (take.lines || []).filter((l: any) => l.countedQty !== null && l.countedQty !== undefined);
    if (countedLines.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Nothing has been counted in this stock-take yet',
        code: 'STOCK_TAKE_NO_COUNTS'
      });
    }

    const completedBy = req.user?.id || null;
    const result = await prisma.$transaction(async (tx: any) => {
      for (const adj of adjustments) {
        const updated = await tx.batch.updateMany({
          where: { id: adj.batchId, companyId },
          data: { quantity: adj.countedQty }
        });
        if (updated.count !== 1) {
          throw new Error(`Batch ${adj.batchId} could not be adjusted — it no longer belongs to this business`);
        }
        const movement = await tx.stockMovement.create({
          data: {
            productId: adj.productId,
            type: 'STOCK_TAKE_ADJUSTMENT',
            quantity: adj.variance,
            reason: `Stock take ${take.id} — counted ${adj.countedQty} vs system ${adj.systemQty}`,
            reference: take.id,
            createdBy: completedBy || 'system'
          }
        });
        await tx.stockTakeLine.updateMany({
          where: { stockTakeId: take.id, batchId: adj.batchId },
          data: { variance: adj.variance, adjustmentMovementId: movement.id }
        });
      }
      // Freeze zero-variance counted lines too (variance 0, no movement).
      for (const line of countedLines) {
        if (line.variance === null || line.variance === undefined) {
          const v = lineVariance(line.systemQty, line.countedQty);
          if (v === 0) {
            await tx.stockTakeLine.update({ where: { id: line.id }, data: { variance: 0 } });
          }
        }
      }
      return tx.stockTake.update({
        where: { id: take.id },
        data: { status: 'COMPLETED', completedBy, completedAt: new Date() },
        include: { lines: { include: lineInclude, orderBy: { createdAt: 'asc' } } }
      });
    });

    return res.json({
      success: true,
      data: serializeTake(result),
      message: `Stock-take completed — ${adjustments.length} batch(es) adjusted`
    });
  } catch (error: any) {
    console.error('[StockTakes] COMPLETE error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to complete the stock-take' });
  }
};

// Cancel an OPEN session. No stock effect — counts are discarded.
export const cancelStockTake = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveStockTakeCompanyId(req);
    const take = await prisma.stockTake.findFirst({
      where: { id: req.params.id, companyId },
      select: { id: true, status: true }
    });
    if (!take) return res.status(404).json({ success: false, message: 'Stock-take not found' });
    if (take.status !== 'OPEN') {
      return res.status(409).json({
        success: false,
        message: 'This stock-take is no longer open',
        code: 'STOCK_TAKE_NOT_OPEN'
      });
    }

    const updated = await prisma.stockTake.update({
      where: { id: take.id },
      data: { status: 'CANCELLED' }
    });
    return res.json({ success: true, data: updated, message: 'Stock-take cancelled — no stock was changed' });
  } catch (error: any) {
    console.error('[StockTakes] CANCEL error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to cancel the stock-take' });
  }
};
