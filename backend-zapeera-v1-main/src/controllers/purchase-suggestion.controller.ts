import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import Joi from 'joi';
import { AuthRequest } from '../middleware/auth.middleware';
import { syncAfterOperation } from '../utils/sync-helper';
import {
  computeSuggestion,
  assertTransition,
  type SuggestionStatus,
} from '../utils/purchase-suggestion.util';

// ─── Purchase suggestions (Gap Item 4) ───────────────────────────────────────
// Persisted auto-purchase proposals. Generation ONLY writes
// PurchaseSuggestion + PurchaseSuggestionLine rows — it NEVER creates a
// Purchase, a Batch, or any stock movement. A Purchase is created ONLY
// by an explicit approve call (POST /:id/approve), which runs the same
// create-from-suggestions flow as the C3 one-click order
// (POST /purchases/draft-from-suggestions): real purchase, stock lands,
// paidAmount 0 -> status PENDING ("ordered, unpaid").
// Branch-scoped; FEFO-aware (sellable stock excludes expired batches;
// expiring-within-30d stock is tracked per line and can upgrade the
// reason to EXPIRING_STOCK).

const resolveCompanyId = (req: AuthRequest): string =>
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  req.membership?.business_id ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const resolveBranchId = (req: AuthRequest): string | undefined =>
  req.branch_id ||
  (req.headers['x-branch-id'] as string | undefined) ||
  req.user?.selectedBranchId ||
  req.user?.branchId ||
  undefined;

const EXPIRY_WINDOW_DAYS = 30;
const STALE_SUGGESTION_DAYS = 7;

const generateSchema = Joi.object({
  branchId: Joi.string().optional(),
  // Days ahead that counts as "expiring soon" for the EXPIRING_STOCK
  // modifier. Default 30.
  expiryWindowDays: Joi.number().integer().min(1).max(180).optional(),
});

const rejectSchema = Joi.object({
  reason: Joi.string().max(500).optional().allow(''),
});

// Unit engine (Wave C2) — same pack conversion as
// purchase.controller purchaseLineStock: a purchase line's quantity is
// in PACKS and its unitPrice is the price of ONE pack; the batch always
// records BASE units (packs x unitsPerPack) at per-base-unit prices.
function packToBase(
  product: { unitsPerPack?: number | null } | null | undefined,
  item: { quantity: number; unitPrice: number }
): { baseQty: number; purchasePrice: number; sellingPrice: number; totalBoxes?: number; unitsPerBox?: number } {
  const perPack = product?.unitsPerPack && product.unitsPerPack > 1 ? product.unitsPerPack : 1;
  if (perPack <= 1) {
    return { baseQty: item.quantity, purchasePrice: item.unitPrice, sellingPrice: item.unitPrice * 1.2 };
  }
  const perUnitCost = item.unitPrice / perPack;
  return {
    baseQty: item.quantity * perPack,
    purchasePrice: perUnitCost,
    sellingPrice: perUnitCost * 1.2,
    totalBoxes: item.quantity,
    unitsPerBox: perPack,
  };
}

// POST /purchases/suggestions/generate — compute fresh suggestions from
// live stock and persist them as PENDING proposals, one per supplier.
// PROOF POINT: this handler performs zero purchase.create / batch.create
// calls — a generated suggestion can never become stock or a payable
// without an explicit approve.
export const generatePurchaseSuggestions = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = generateSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map((d: any) => d.message),
      });
    }
    const companyId = resolveCompanyId(req);
    const branchId = value.branchId || resolveBranchId(req);
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch context required. Please ensure you have proper access permissions.',
      });
    }
    const expiryWindowDays = value.expiryWindowDays || EXPIRY_WINDOW_DAYS;
    const now = new Date();
    const expiryHorizon = new Date(now.getTime() + expiryWindowDays * 86400000);

    // Stale PENDING proposals expire: a suggestion is a snapshot of the
    // stock at generation time, and stock moves daily.
    const staleBefore = new Date(now.getTime() - STALE_SUGGESTION_DAYS * 86400000);
    await prisma.purchaseSuggestion.updateMany({
      where: { companyId, branchId: String(branchId), status: 'PENDING', createdAt: { lt: staleBefore } },
      data: { status: 'EXPIRED' },
    });

    const products = await prisma.product.findMany({
      where: { companyId, branchId: String(branchId), isActive: true, isService: false },
      select: {
        id: true,
        name: true,
        sku: true,
        supplierId: true,
        minStock: true,
        maxStock: true,
        reorderLevel: true,
        reorderQuantity: true,
        unitsPerPack: true,
      },
      orderBy: { name: 'asc' },
    });

    if (products.length === 0) {
      return res.json({ success: true, data: { created: [], totals: { suggestions: 0, lines: 0 } } });
    }

    const productIds = products.map((p: any) => p.id);
    const batches = await prisma.batch.findMany({
      where: { companyId, branchId: String(branchId), productId: { in: productIds }, isActive: true },
      select: {
        productId: true,
        quantity: true,
        purchasePrice: true,
        supplierId: true,
        expireDate: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Per product: raw stock, FEFO sellable stock (non-expired only),
    // expiring-soon stock, latest batch (cost + supplier).
    const perProduct = new Map<string, {
      currentStock: number;
      sellableStock: number;
      expiringStock: number;
      lastCost: number | null;
      latestSupplierId: string | null;
    }>();
    for (const batch of batches as any[]) {
      const entry = perProduct.get(batch.productId) || {
        currentStock: 0,
        sellableStock: 0,
        expiringStock: 0,
        lastCost: null,
        latestSupplierId: null,
      };
      if (entry.lastCost === null) {
        entry.lastCost = batch.purchasePrice ?? null;
        entry.latestSupplierId = batch.supplierId ?? null;
      }
      entry.currentStock += batch.quantity || 0;
      const expired = batch.expireDate && new Date(batch.expireDate) <= now;
      if (!expired) {
        entry.sellableStock += batch.quantity || 0;
        if (batch.expireDate && new Date(batch.expireDate) <= expiryHorizon) {
          entry.expiringStock += batch.quantity || 0;
        }
      }
      perProduct.set(batch.productId, entry);
    }

    // Build proposal lines, grouped by supplier (latest batch's supplier,
    // else the product's default supplier, else unassigned/null).
    const linesBySupplier = new Map<string, Array<Record<string, unknown>>>();
    for (const product of products as any[]) {
      const stock = perProduct.get(product.id) || {
        currentStock: 0,
        sellableStock: 0,
        expiringStock: 0,
        lastCost: null,
        latestSupplierId: null,
      };
      const suggestion = computeSuggestion({
        currentStock: stock.currentStock,
        sellableStock: stock.sellableStock,
        expiringStock: stock.expiringStock,
        reorderLevel: product.reorderLevel ?? null,
        reorderQuantity: product.reorderQuantity ?? null,
        minStock: product.minStock ?? 0,
        maxStock: product.maxStock ?? null,
      });
      if (!suggestion) continue;
      const supplierKey = stock.latestSupplierId || product.supplierId || '__unassigned__';
      const group = linesBySupplier.get(supplierKey) || [];
      group.push({
        productId: product.id,
        currentStock: stock.currentStock,
        sellableStock: stock.sellableStock,
        expiringStock: stock.expiringStock,
        reorderLevel: product.reorderLevel ?? null,
        minStock: product.minStock ?? 0,
        suggestedQty: suggestion.suggestedQty,
        unitCost: stock.lastCost,
        reason: suggestion.reason,
        note:
          suggestion.reason === 'EXPIRING_STOCK'
            ? `${stock.expiringStock} of ${stock.sellableStock} sellable units expire within ${expiryWindowDays} days`
            : suggestion.reason === 'BELOW_REORDER_LEVEL'
              ? `Sellable stock ${stock.sellableStock} at/below reorder level ${product.reorderLevel}`
              : `Sellable stock ${stock.sellableStock} below min stock ${product.minStock}`,
      });
      linesBySupplier.set(supplierKey, group);
    }

    const created = await prisma.$transaction(async (tx: any) => {
      const out: Array<{ id: string; supplierId: string | null; lines: number }> = [];
      for (const [key, lines] of linesBySupplier.entries()) {
        const suggestion = await tx.purchaseSuggestion.create({
          data: {
            companyId,
            branchId: String(branchId),
            supplierId: key === '__unassigned__' ? null : key,
            status: 'PENDING',
            reason: `${lines.length} product(s) need reordering`,
            generatedBy: req.user?.id,
            lines: { create: lines },
          },
          select: { id: true, supplierId: true },
        });
        out.push({ id: suggestion.id, supplierId: suggestion.supplierId, lines: lines.length });
      }
      return out;
    });

    return res.status(201).json({
      success: true,
      data: {
        created,
        totals: {
          suggestions: created.length,
          lines: created.reduce((n: number, c: any) => n + c.lines, 0),
        },
      },
      message: `Generated ${created.length} purchase suggestion(s). Nothing was ordered — approve a suggestion to create a purchase.`,
    });
  } catch (error) {
    console.error('Generate purchase suggestions error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// GET /purchases/suggestions — list proposals (branch-scoped).
export const getPurchaseSuggestions = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveCompanyId(req);
    const branchId = resolveBranchId(req);
    const { status, supplierId, page = 1, limit = 20 } = req.query as any;
    const where: any = { companyId };
    if (branchId) where.branchId = String(branchId);
    if (status) where.status = String(status);
    if (supplierId) where.supplierId = String(supplierId);
    const skip = (Number(page) - 1) * Number(limit);
    const [suggestions, total] = await Promise.all([
      prisma.purchaseSuggestion.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: Number(limit),
        include: {
          supplier: { select: { id: true, name: true, contactPerson: true, phone: true } },
          lines: {
            include: { product: { select: { id: true, name: true, sku: true, unitsPerPack: true, unitsPerStrip: true } } },
          },
        },
      }),
      prisma.purchaseSuggestion.count({ where }),
    ]);
    return res.json({ success: true, data: { suggestions, total, page: Number(page), limit: Number(limit) } });
  } catch (error) {
    console.error('Get purchase suggestions error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// GET /purchases/suggestions/:id
export const getPurchaseSuggestionById = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveCompanyId(req);
    const suggestion = await prisma.purchaseSuggestion.findFirst({
      where: { id: req.params.id, companyId },
      include: {
        supplier: { select: { id: true, name: true, contactPerson: true, phone: true } },
        purchase: { select: { id: true, invoiceNo: true, totalAmount: true, status: true, purchaseDate: true } },
        lines: {
          include: { product: { select: { id: true, name: true, sku: true, unitsPerPack: true, unitsPerStrip: true } } },
        },
      },
    });
    if (!suggestion) {
      return res.status(404).json({ success: false, message: 'Purchase suggestion not found' });
    }
    return res.json({ success: true, data: suggestion });
  } catch (error) {
    console.error('Get purchase suggestion error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// POST /purchases/suggestions/:id/approve — THE ONLY path from a
// suggestion to a Purchase. Requires the suggestion to be PENDING and
// assigned to a supplier; every line needs a price (stored unitCost or
// latest batch cost). Creates the Purchase + batches in ONE transaction
// with the status flip, so an approval can never half-create or
// double-create (a second approve hits assertTransition and 409s).
export const approvePurchaseSuggestion = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveCompanyId(req);
    const suggestion = await prisma.purchaseSuggestion.findFirst({
      where: { id: req.params.id, companyId },
      include: { lines: true },
    });
    if (!suggestion) {
      return res.status(404).json({ success: false, message: 'Purchase suggestion not found' });
    }
    try {
      assertTransition(suggestion.status, 'APPROVED');
    } catch (e: any) {
      return res.status(409).json({ success: false, message: e.message });
    }
    if (!suggestion.supplierId) {
      return res.status(400).json({
        success: false,
        message: 'This suggestion has no supplier assigned. Assign a supplier before approving.',
      });
    }
    const branchId = suggestion.branchId;
    const supplier = await prisma.supplier.findFirst({
      where: { id: suggestion.supplierId, OR: [{ companyId }, { branchId }, { branch: { companyId } }] },
    });
    if (!supplier) {
      return res.status(400).json({ success: false, message: 'Supplier not found' });
    }

    const productIds = (suggestion.lines as any[]).map(l => l.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, companyId },
      select: { id: true, name: true, unitsPerPack: true },
    });
    const productById = new Map((products as any[]).map(p => [p.id, p]));
    const latestBatches = await prisma.batch.findMany({
      where: { companyId, productId: { in: productIds } },
      select: { productId: true, purchasePrice: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    const lastCostByProduct = new Map<string, number>();
    for (const batch of latestBatches as any[]) {
      if (!lastCostByProduct.has(batch.productId)) {
        lastCostByProduct.set(batch.productId, batch.purchasePrice);
      }
    }

    const unpriced: string[] = [];
    const createLines: Array<{ productId: string; quantity: number; unitPrice: number }> = [];
    for (const line of suggestion.lines as any[]) {
      const product = productById.get(line.productId);
      if (!product) {
        return res.status(400).json({ success: false, message: `Product not found: ${line.productId}` });
      }
      const perBaseUnit = line.unitCost ?? lastCostByProduct.get(line.productId);
      if (perBaseUnit === undefined || perBaseUnit === null) {
        unpriced.push(product.name);
        continue;
      }
      const perPack = product.unitsPerPack && product.unitsPerPack > 1 ? product.unitsPerPack : 1;
      if (perPack > 1) {
        const packs = Math.ceil(line.suggestedQty / perPack);
        createLines.push({ productId: line.productId, quantity: packs, unitPrice: perBaseUnit * perPack });
      } else {
        createLines.push({ productId: line.productId, quantity: line.suggestedQty, unitPrice: perBaseUnit });
      }
    }
    if (unpriced.length > 0) {
      return res.status(400).json({
        success: false,
        message: `No purchase cost on record for: ${unpriced.join(', ')}. Add a cost for these lines or receive a purchase for them first.`,
      });
    }

    const totalAmount = createLines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
    const result = await prisma.$transaction(async (tx: any) => {
      const purchase = await tx.purchase.create({
        data: {
          supplierId: suggestion.supplierId as string,
          branchId,
          companyId,
          purchaseDate: new Date(),
          totalAmount,
          paidAmount: 0,
          outstanding: totalAmount,
          status: 'PENDING',
          notes: `Approved from purchase suggestion ${suggestion.id}`,
          createdBy: req.user?.id,
        },
      });
      let seq = 1;
      for (const item of createLines) {
        const product = productById.get(item.productId);
        const lineStock = packToBase(product, item);
        const batch = await tx.batch.create({
          data: {
            batchNo: `AUTO-${purchase.id.slice(0, 8)}-${seq++}`,
            productId: item.productId,
            branchId,
            companyId,
            supplierId: suggestion.supplierId as string,
            quantity: lineStock.baseQty,
            purchasePrice: lineStock.purchasePrice,
            sellingPrice: lineStock.sellingPrice,
            totalBoxes: lineStock.totalBoxes,
            unitsPerBox: lineStock.unitsPerBox,
            createdBy: req.user?.id,
          },
        });
        await tx.purchaseItem.create({
          data: {
            purchaseId: purchase.id,
            productId: item.productId,
            batchId: batch.id,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.quantity * item.unitPrice,
          },
        });
      }
      const updated = await tx.purchaseSuggestion.update({
        where: { id: suggestion.id },
        data: {
          status: 'APPROVED' as SuggestionStatus,
          approvedBy: req.user?.id,
          approvedAt: new Date(),
          purchaseId: purchase.id,
        },
      });
      return { purchase, updated };
    });

    const completePurchase = await prisma.purchase.findUnique({
      where: { id: result.purchase.id },
      include: {
        supplier: { select: { id: true, name: true, contactPerson: true, phone: true } },
        purchaseItems: {
          include: {
            product: { select: { id: true, name: true, sku: true, unitsPerPack: true, unitsPerStrip: true } },
            batch: { select: { id: true, batchNo: true, quantity: true, expireDate: true } },
          },
        },
      },
    });
    syncAfterOperation('purchase', 'create', completePurchase).catch((err: any) => {
      console.error('[Sync] Purchase-from-approved-suggestion sync failed:', err.message);
    });

    return res.status(201).json({
      success: true,
      data: { purchase: completePurchase, suggestion: result.updated },
      message: 'Purchase order created from approved suggestion',
    });
  } catch (error) {
    console.error('Approve purchase suggestion error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// POST /purchases/suggestions/:id/reject — PENDING only, with a reason.
export const rejectPurchaseSuggestion = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = rejectSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map((d: any) => d.message),
      });
    }
    const companyId = resolveCompanyId(req);
    const suggestion = await prisma.purchaseSuggestion.findFirst({
      where: { id: req.params.id, companyId },
    });
    if (!suggestion) {
      return res.status(404).json({ success: false, message: 'Purchase suggestion not found' });
    }
    try {
      assertTransition(suggestion.status, 'REJECTED');
    } catch (e: any) {
      return res.status(409).json({ success: false, message: e.message });
    }
    const updated = await prisma.purchaseSuggestion.update({
      where: { id: suggestion.id },
      data: {
        status: 'REJECTED' as SuggestionStatus,
        rejectedBy: req.user?.id,
        rejectedAt: new Date(),
        rejectReason: value.reason || null,
      },
    });
    return res.json({ success: true, data: updated, message: 'Purchase suggestion rejected' });
  } catch (error) {
    console.error('Reject purchase suggestion error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
