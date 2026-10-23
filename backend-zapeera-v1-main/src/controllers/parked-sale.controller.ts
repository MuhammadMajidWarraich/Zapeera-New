/**
 * Parked Sale (POS "Hold") Controller
 *
 * A cashier parks the in-progress POS cart and resumes it later from
 * the held-orders list of the same branch. The full cart state is
 * stored verbatim in `payload` (JSON) so resume can restore the cart
 * EXACTLY — lines (product/batch/quantity/prices/discounts, unit
 * levels, variants), the attached customer, patient + prescription,
 * coupon and loyalty inputs. `itemCount`/`grandTotal` are display
 * snapshots for the list; the resumed sale's totals are always
 * recomputed by the normal sale flow.
 *
 * Tenancy follows the sale routes' conventions: the business context
 * comes from the multitenancy middleware (X-Business-ID + membership),
 * every query is scoped to that business, and a parked sale belonging
 * to another business is indistinguishable from a missing one (404).
 * A parked row is deleted by the frontend (DELETE) only after the
 * resumed sale's invoice exists — or when the cashier discards it.
 */

import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AuthRequest } from '../middleware/auth.middleware';
import Joi from 'joi';

// One cart line. The cart carries many more fields than the sale
// minimum (batch snapshots, unit-level data, variant names, dosage
// instructions…); they are persisted verbatim so resume is lossless,
// so only the identity fields are shape-checked here.
const parkedLineSchema = Joi.object({
  productId: Joi.string().required(),
  quantity: Joi.number().positive().required(),
}).unknown(true);

const createParkedSaleSchema = Joi.object({
  branchId: Joi.string().required(),
  customerId: Joi.string().allow(null, '').optional(),
  label: Joi.string().trim().max(120).allow('', null).optional(),
  // Display snapshots. itemCount is re-derived from the lines when
  // absent; grandTotal falls back to the lines' totalPrice sum.
  itemCount: Joi.number().integer().min(0).optional(),
  grandTotal: Joi.number().min(0).optional(),
  payload: Joi.object({
    items: Joi.array().items(parkedLineSchema).min(1).required(),
  }).unknown(true).required(),
});

/** List shape: everything the held-orders UI shows, without payload. */
async function toListItem(prisma: any, row: any) {
  return {
    id: row.id,
    businessId: row.businessId,
    branchId: row.branchId,
    createdById: row.createdById,
    createdByName: row._createdByName ?? null,
    customerId: row.customerId ?? null,
    customerName: row._customerName ?? null,
    label: row.label ?? null,
    itemCount: row.itemCount,
    grandTotal: row.grandTotal,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Batch-resolve cashier + customer display names for a page of rows. */
async function attachNames(prisma: any, businessId: string, rows: any[]) {
  const userIds = [...new Set(rows.map(r => r.createdById).filter(Boolean))];
  const customerIds = [...new Set(rows.map(r => r.customerId).filter(Boolean))];
  const [users, customers] = await Promise.all([
    userIds.length
      ? prisma.zapeeraUser.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
    customerIds.length
      ? prisma.customer.findMany({
          where: { id: { in: customerIds }, companyId: businessId },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);
  const userName = new Map(users.map((u: any) => [u.id, u.name]));
  const customerName = new Map(customers.map((c: any) => [c.id, c.name]));
  for (const row of rows) {
    row._createdByName = userName.get(row.createdById) ?? null;
    row._customerName = row.customerId ? (customerName.get(row.customerId) ?? null) : null;
  }
  return rows;
}

/**
 * POST /api/v1/parked-sales — park the current cart.
 */
export const createParkedSale = async (req: AuthRequest, res: Response) => {
  try {
    const { error, value } = createParkedSaleSchema.validate(req.body, { abortEarly: false });
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: error.details.map(d => d.message),
      });
    }

    const businessId = (req as any).business_id || req.user?.selectedCompanyId;
    if (!businessId) {
      return res.status(400).json({ success: false, message: 'Business context is required' });
    }

    // `any` like the backup service: ParkedSale is new, and the
    // generated client is only regenerated inside the deploy image.
    const prisma: any = await getPrisma();

    // The branch must belong to this business — same scoping rule the
    // sale flow applies to its branchId.
    const branch = await prisma.branch.findFirst({
      where: { id: value.branchId, companyId: businessId },
      select: { id: true },
    });
    if (!branch) {
      return res.status(404).json({ success: false, message: 'Branch not found for this business' });
    }

    // A named customer must belong to this business too.
    let customerId: string | null = null;
    if (value.customerId) {
      const customer = await prisma.customer.findFirst({
        where: { id: value.customerId, companyId: businessId },
        select: { id: true },
      });
      if (!customer) {
        return res.status(400).json({ success: false, message: 'Customer not found for this business' });
      }
      customerId = customer.id;
    }

    const lines: any[] = value.payload.items;
    const derivedItemCount = lines.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
    const derivedTotal = lines.reduce((sum, l) => sum + (Number(l.totalPrice) || 0), 0);
    const itemCount = Number.isInteger(value.itemCount) ? value.itemCount : Math.round(derivedItemCount);
    const grandTotal = typeof value.grandTotal === 'number' ? value.grandTotal : Math.round(derivedTotal * 100) / 100;

    const created = await prisma.parkedSale.create({
      data: {
        businessId,
        branchId: value.branchId,
        createdById: String(req.user?.id || ''),
        customerId,
        label: value.label ? String(value.label).trim() : null,
        payload: value.payload,
        itemCount,
        grandTotal,
      },
    });

    const [withNames] = await attachNames(prisma, businessId, [created]);
    return res.status(201).json({ success: true, data: await toListItem(prisma, withNames) });
  } catch (error: any) {
    console.error('[ParkedSale] Create error:', error);
    return res.status(500).json({ success: false, message: 'Failed to park the sale' });
  }
};

/**
 * GET /api/v1/parked-sales — held orders for this business + branch,
 * newest first. Branch comes from ?branchId=, else the resolved
 * branch context (X-Branch-ID).
 */
export const getParkedSales = async (req: AuthRequest, res: Response) => {
  try {
    const businessId = (req as any).business_id || req.user?.selectedCompanyId;
    if (!businessId) {
      return res.status(400).json({ success: false, message: 'Business context is required' });
    }
    const branchId = (typeof req.query.branchId === 'string' && req.query.branchId) || (req as any).branch_id || undefined;

    // `any` like the backup service: ParkedSale is new, and the
    // generated client is only regenerated inside the deploy image.
    const prisma: any = await getPrisma();
    const rows = await prisma.parkedSale.findMany({
      where: { businessId, ...(branchId ? { branchId } : {}) },
      orderBy: { createdAt: 'desc' },
    });
    await attachNames(prisma, businessId, rows);
    const parkedSales = await Promise.all(rows.map((r: any) => toListItem(prisma, r)));
    return res.json({ success: true, data: { parkedSales } });
  } catch (error: any) {
    console.error('[ParkedSale] List error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load held orders' });
  }
};

/**
 * GET /api/v1/parked-sales/:id — one held order, including the full
 * cart payload (this is what Resume loads).
 */
export const getParkedSale = async (req: AuthRequest, res: Response) => {
  try {
    const businessId = (req as any).business_id || req.user?.selectedCompanyId;
    if (!businessId) {
      return res.status(400).json({ success: false, message: 'Business context is required' });
    }
    // `any` like the backup service: ParkedSale is new, and the
    // generated client is only regenerated inside the deploy image.
    const prisma: any = await getPrisma();
    const row = await prisma.parkedSale.findFirst({
      where: { id: req.params.id, businessId },
    });
    if (!row) {
      return res.status(404).json({ success: false, message: 'Parked sale not found' });
    }
    const [withNames] = await attachNames(prisma, businessId, [row]);
    return res.json({
      success: true,
      data: { ...(await toListItem(prisma, withNames)), payload: row.payload },
    });
  } catch (error: any) {
    console.error('[ParkedSale] Get error:', error);
    return res.status(500).json({ success: false, message: 'Failed to load the parked sale' });
  }
};

/**
 * DELETE /api/v1/parked-sales/:id — discard a held order. Also the
 * consume step: the frontend calls this after a resumed sale's
 * invoice has been created successfully.
 */
export const deleteParkedSale = async (req: AuthRequest, res: Response) => {
  try {
    const businessId = (req as any).business_id || req.user?.selectedCompanyId;
    if (!businessId) {
      return res.status(400).json({ success: false, message: 'Business context is required' });
    }
    // `any` like the backup service: ParkedSale is new, and the
    // generated client is only regenerated inside the deploy image.
    const prisma: any = await getPrisma();
    const row = await prisma.parkedSale.findFirst({
      where: { id: req.params.id, businessId },
      select: { id: true },
    });
    if (!row) {
      return res.status(404).json({ success: false, message: 'Parked sale not found' });
    }
    await prisma.parkedSale.delete({ where: { id: row.id } });
    return res.json({ success: true, data: { id: row.id } });
  } catch (error: any) {
    console.error('[ParkedSale] Delete error:', error);
    return res.status(500).json({ success: false, message: 'Failed to discard the parked sale' });
  }
};
