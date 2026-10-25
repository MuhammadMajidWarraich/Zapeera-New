// Self-ordering kiosk (Wave C9 — gap item 9, retail only).
//
// PUBLIC BY DESIGN, like item 5's online storefront: the in-store
// tablet has no staff login. The branch id in the path is the kiosk
// key (a cuid); every handler re-resolves it, scopes all reads/writes
// to that one branch, and enforces the GIFT_CARD_KIOSK_PACK add-on
// gate before doing anything else. CSRF-exempt by design (see
// csrf.middleware.ts CSRF_EXEMPT_PATHS — same class as the public
// storefront): there is no cookie session to forge.
//
// An order is a REAL sale through the POS createSale handler
// (checkout calls it with a synthetic staff request, channel KIOSK,
// cash, PENDING — pay at the counter), exactly the way item 5's store
// checkout reuses createSale. There is deliberately no parallel
// sales pipeline.
//
// Kiosk rules (v1):
//   · base units only, at the FEFO-first batch's selling price — the
//     cart is re-priced server-side, never trusted from the client;
//   · prescription-only products are NOT listed and cannot be ordered
//     — a kiosk cannot take or review a prescription, so those stay
//     counter sales;
//   · the order is PENDING until staff accept/fulfil it at the
//     counter (staff queue: GET /sales?channel=KIOSK&status=PENDING).

import { Request, Response } from 'express';
import Joi from 'joi';
import { getPrisma } from '../utils/db.util';
import { createSale } from './sale.controller';
import {
  GiftCardKioskError,
  KIOSK_PAYMENT_METHOD,
  KioskBranch,
  isGiftCardKioskEnabled,
  resolveKioskBranch,
  resolveKioskCart,
  availableBatchWhere,
} from '../utils/giftcard-kiosk.util';

const checkoutSchema = Joi.object({
  customerName: Joi.string().trim().max(120).allow('', null).optional(),
  customerPhone: Joi.string().trim().max(40).allow('', null).optional(),
  items: Joi.array()
    .items(
      Joi.object({
        productId: Joi.string().required(),
        quantity: Joi.number().integer().min(1).required(),
      })
    )
    .min(1)
    .required(),
});

function sendKioskError(res: Response, error: any) {
  if (error instanceof GiftCardKioskError) {
    return res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
      details: error.details || undefined,
    });
  }
  console.error('kiosk error:', error);
  return res.status(500).json({ success: false, message: 'Internal server error' });
}

/** Resolve the branch + pack gate. Returns the branch, or sends the error response and returns null. */
async function requireKiosk(req: Request, res: Response): Promise<KioskBranch | null> {
  const prisma = await getPrisma();
  const branch = await resolveKioskBranch(prisma, req.params.branchId);
  if (!branch) {
    res.status(404).json({ success: false, message: 'Kiosk not found.' });
    return null;
  }
  if (!(await isGiftCardKioskEnabled(prisma, branch.companyId))) {
    res.status(403).json({
      success: false,
      code: 'GIFT_CARD_KIOSK_NOT_ENABLED',
      message: 'Self-ordering is not enabled for this branch yet.',
    });
    return null;
  }
  return branch;
}

/** GET /api/kiosk/:branchId — the kiosk's branch info. */
export const getKioskInfo = async (req: Request, res: Response) => {
  try {
    const branch = await requireKiosk(req, res);
    if (!branch) return;
    return res.json({
      success: true,
      data: {
        branchId: branch.id,
        branchName: branch.name,
        companyName: branch.company.name,
        address: branch.address,
        phone: branch.phone,
      },
    });
  } catch (error) {
    return sendKioskError(res, error);
  }
};

/** GET /api/kiosk/:branchId/products — the orderable catalog (no Rx items; server-priced, in-stock first). */
export const getKioskCatalog = async (req: Request, res: Response) => {
  try {
    const branch = await requireKiosk(req, res);
    if (!branch) return;
    const prisma = await getPrisma();
    const { search = '', categoryId = '', inStock = '' } = req.query as Record<string, string>;
    const where: any = {
      branchId: branch.id,
      companyId: branch.companyId,
      isActive: true,
      requiresPrescription: false, // Rx products are counter-only
    };
    if (search) where.name = { contains: String(search).trim() };
    if (categoryId) where.categoryId = categoryId;
    const products = await prisma.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        categoryId: true,
        batches: {
          where: availableBatchWhere(),
          select: { quantity: true, sellingPrice: true, expireDate: true },
          orderBy: { expireDate: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
      take: 500,
    });
    const catalog = products
      .map((p: any) => {
        const batches = p.batches || [];
        const stock = batches.reduce((s: number, b: any) => s + (Number(b.quantity) || 0), 0);
        return {
          id: p.id,
          name: p.name,
          categoryId: p.categoryId,
          // FEFO-first batch price — the same price the staff list shows.
          price: Number(batches[0]?.sellingPrice || 0),
          stock,
          inStock: stock > 0,
        };
      })
      .filter((p: any) => (String(inStock).toLowerCase() === 'true' ? p.inStock : true));
    return res.json({ success: true, data: catalog });
  } catch (error) {
    return sendKioskError(res, error);
  }
};

/** Resolve the user a kiosk order is rung up as: the business OWNER. */
const resolveKioskOwnerId = async (prisma: any, companyId: string): Promise<string | null> => {
  const ownerMembership = await prisma.membership.findFirst({
    where: { businessId: companyId, status: 'ACTIVE', role: { name: 'OWNER' } },
    select: { userId: true },
  });
  if (ownerMembership?.userId) return String(ownerMembership.userId);
  const business = await prisma.business.findUnique({
    where: { id: companyId },
    select: { createdBy: true },
  });
  return business?.createdBy ? String(business.createdBy) : null;
};

/**
 * Call the POS createSale handler with a synthetic staff request.
 * createSale owns the whole sale (validation, FEFO, tax, promotions,
 * invoice number, FBR queue) — the kiosk never re-implements any of
 * it. The synthetic user is the business owner with the kiosk branch
 * as the selected branch, exactly the context a counter sale for this
 * branch would carry.
 */
const runCreateSale = (
  payload: Record<string, unknown>,
  ownerId: string,
  companyId: string,
  branchId: string
): Promise<{ status: number; body: any }> =>
  new Promise((resolvePromise) => {
    const fakeReq: any = {
      body: payload,
      user: { id: ownerId, createdBy: ownerId, selectedCompanyId: companyId, selectedBranchId: branchId },
      headers: {},
      membership: undefined,
    };
    const fakeRes: any = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(data: any) {
        resolvePromise({ status: this.statusCode || 200, body: data });
        return this;
      },
    };
    Promise.resolve(createSale(fakeReq, fakeRes)).catch((error) => {
      console.error('Kiosk checkout createSale threw:', error);
      resolvePromise({ status: 500, body: { success: false, message: 'Internal server error' } });
    });
  });

/**
 * POST /api/kiosk/:branchId/checkout — place an order, pay at the
 * counter. The cart is re-priced server-side; the customer is
 * found-or-created by phone inside this business (a phone owned by
 * ANOTHER business checks out as a guest, never linked; no phone at
 * all is a walk-in). The created sale is a real POS sale with
 * channel KIOSK, paymentStatus PENDING, paidAmount 0.
 */
export const checkoutKioskOrder = async (req: Request, res: Response) => {
  try {
    const branch = await requireKiosk(req, res);
    if (!branch) return;
    const { error, value } = checkoutSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map((detail) => detail.message),
      });
    }
    const prisma = await getPrisma();

    // 1. Server-side cart: prices + stock (never client prices). Rx
    //    items are refused inside resolveKioskCart.
    const cart = await resolveKioskCart(prisma, branch, value.items);

    // 2. Owner (the sale's cashier) + customer (find-or-create by phone).
    const ownerId = await resolveKioskOwnerId(prisma, branch.companyId);
    if (!ownerId) {
      return res.status(500).json({ success: false, message: 'This kiosk has no owner account to place orders under.' });
    }
    const phone = value.customerPhone ? String(value.customerPhone).trim() : '';
    let customerId: string | null = null;
    if (phone) {
      const existingCustomer = await prisma.customer.findUnique({
        where: { phone },
        select: { id: true, companyId: true },
      });
      if (existingCustomer) {
        if (existingCustomer.companyId === branch.companyId) customerId = existingCustomer.id;
        // Another business owns this phone: guest checkout, never linked.
      } else {
        try {
          const created = await prisma.customer.create({
            data: {
              name: value.customerName ? String(value.customerName).trim() : 'Kiosk Customer',
              phone,
              branchId: branch.id,
              companyId: branch.companyId,
              createdBy: ownerId,
            },
          });
          customerId = created.id;
        } catch {
          // Lost a race on the globally-unique phone — guest checkout.
          customerId = null;
        }
      }
    }

    // 3. The real sale, via the POS handler.
    const salePayload: Record<string, unknown> = {
      branchId: branch.id,
      customerId,
      items: cart.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice })),
      paymentMethod: KIOSK_PAYMENT_METHOD,
      paymentStatus: 'PENDING',
      paidAmount: 0,
      channel: 'KIOSK',
    };
    const result = await runCreateSale(salePayload, ownerId, branch.companyId, branch.id);
    return res.status(result.status).json(result.body);
  } catch (error) {
    return sendKioskError(res, error);
  }
};
