// Public online pharmacy storefront (Wave C5 — gap item 5).
//
// NO authentication: customers have no Zapeera account. Security rests
// on three things, all enforced here (never in the frontend):
//   1. The branch id in the path is the store key — a cuid, unguessable,
//      and every query is scoped to that ONE branch (a customer never
//      sees another branch's catalog, stock or prescriptions).
//   2. The ONLINE_STORE_PACK add-on gate — the whole storefront answers
//      403 STORE_NOT_ENABLED until the business holds the pack.
//   3. Server-side pricing — checkout resolves prices/stock from the
//      branch's batches (online-store.util); client-sent prices are
//      never read, let alone trusted.
//
// Checkout creates a REAL sale through the POS createSale handler
// (same FEFO deduction, tax, promotions, loyalty, FBR queue, invoice
// number) — there is deliberately no parallel sales pipeline. The
// order is cash on delivery (paymentStatus PENDING, paidAmount 0,
// sale status PENDING) so it lands in the staff's online-orders queue
// (GET /sales?channel=ONLINE_STORE&status=PENDING). The sale is rung
// up as the business OWNER (the only user a public order can
// attribute to) with channel ONLINE_STORE + delivery fields.
//
// Prescription upload attaches to the EXISTING prescription module:
// the upload creates a Prescription row with source ONLINE_UPLOAD and
// reviewStatus PENDING (no items yet — the pharmacist transcribes the
// paper prescription during review). Dispensing is blocked until a
// pharmacist marks it REVIEWED (see prescriptionReviewBlock + the
// gate in sale.controller); checkout with a PENDING/REJECTED
// prescription is refused, so the flow is upload → review → checkout.

import { Request, Response } from 'express';
import Joi from 'joi';
import { getPrisma } from '../utils/db.util';
import { createSearchConditions } from '../utils/query-helper';
import {
  isOnlineStoreEnabled,
  resolveStoreBranch,
  resolveStoreCart,
  prescriptionReviewBlock,
  StoreError,
  STORE_PAYMENT_METHOD,
  type StoreBranch,
} from '../utils/online-store.util';
import { createSale } from './sale.controller';

const STORE_NOT_ENABLED = {
  success: false,
  code: 'STORE_NOT_ENABLED',
  message: 'This branch does not have the Online Pharmacy Store enabled yet.',
};

/** Resolve the store branch + gate; answers 404/403 directly. Returns null when answered. */
const requireStore = async (
  req: Request,
  res: Response
): Promise<StoreBranch | null> => {
  const prisma = await getPrisma();
  const branch = await resolveStoreBranch(prisma, String(req.params.branchId || ''));
  if (!branch) {
    res.status(404).json({ success: false, message: 'Store not found' });
    return null;
  }
  if (!(await isOnlineStoreEnabled(prisma, branch.companyId))) {
    res.status(403).json(STORE_NOT_ENABLED);
    return null;
  }
  return branch;
};

const sendStoreError = (res: Response, error: unknown) => {
  if (error instanceof StoreError) {
    return res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
      ...(error.details !== undefined ? { details: error.details } : {}),
    });
  }
  console.error('Store error:', error);
  return res.status(500).json({ success: false, message: 'Internal server error' });
};

// ─── Store info ──────────────────────────────────────────────────────────

/** GET /api/store/:branchId — public storefront header (business + branch). */
export const getStoreInfo = async (req: Request, res: Response) => {
  try {
    const branch = await requireStore(req, res);
    if (!branch) return;
    return res.json({
      success: true,
      data: {
        business: { id: branch.company.id, name: branch.company.name, slug: branch.company.slug },
        branch: { id: branch.id, name: branch.name, address: branch.address, phone: branch.phone, email: branch.email },
        onlineStoreEnabled: true,
        currency: 'PKR',
        paymentMethods: ['CASH_ON_DELIVERY'],
      },
    });
  } catch (error) {
    return sendStoreError(res, error);
  }
};

// ─── Catalog ─────────────────────────────────────────────────────────────

const publicProductSelect = {
  id: true,
  name: true,
  description: true,
  formula: true,
  sku: true,
  categoryId: true,
  unitsPerPack: true,
  unitsPerStrip: true,
  requiresPrescription: true,
  isActive: true,
  category: { select: { id: true, name: true } },
  batches: {
    where: {
      isActive: true,
      quantity: { gt: 0 },
      OR: [{ expireDate: null }, { expireDate: { gt: new Date() } }],
    },
    select: { quantity: true, sellingPrice: true },
    orderBy: { expireDate: 'asc' as const },
  },
} as const;

const toPublicProduct = (product: any) => {
  const batches = (product.batches || []) as Array<{ quantity: number; sellingPrice: number }>;
  const stock = batches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0);
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    formula: product.formula,
    sku: product.sku,
    category: product.category || null,
    unitsPerPack: product.unitsPerPack,
    unitsPerStrip: product.unitsPerStrip,
    requiresPrescription: !!product.requiresPrescription,
    // FEFO-first batch price — the same price the staff list shows.
    price: Number(batches[0]?.sellingPrice || 0),
    stock,
    inStock: stock > 0,
  };
};

/** GET /api/store/:branchId/products — branch-scoped catalog (active, non-service products only). */
export const getStoreCatalog = async (req: Request, res: Response) => {
  try {
    const branch = await requireStore(req, res);
    if (!branch) return;
    const prisma = await getPrisma();
    const { page = 1, limit = 20, search = '', categoryId = '', inStock = '' } = req.query;
    const take = Math.min(100, Math.max(1, Number(limit) || 20));
    const skip = (Math.max(1, Number(page) || 1) - 1) * take;

    const where: any = {
      branchId: branch.id,
      companyId: branch.companyId,
      isActive: true,
      isService: false,
    };
    if (categoryId) where.categoryId = String(categoryId);
    if (search) {
      const conditions = createSearchConditions(
        ['name', 'barcode', 'sku', 'description', 'formula'],
        String(search)
      );
      if (conditions.OR) where.OR = conditions.OR;
    }

    const [products, total] = await Promise.all([
      prisma.product.findMany({ where, skip, take, select: publicProductSelect, orderBy: { name: 'asc' } }),
      prisma.product.count({ where }),
    ]);
    let listed = products.map(toPublicProduct);
    if (String(inStock) === 'true') listed = listed.filter((p) => p.inStock);

    return res.json({
      success: true,
      data: listed,
      pagination: { page: Number(page) || 1, limit: take, total, pages: Math.ceil(total / take) },
    });
  } catch (error) {
    return sendStoreError(res, error);
  }
};

/** GET /api/store/:branchId/products/:productId — one product, same branch scope. */
export const getStoreProduct = async (req: Request, res: Response) => {
  try {
    const branch = await requireStore(req, res);
    if (!branch) return;
    const prisma = await getPrisma();
    const product = await prisma.product.findFirst({
      where: {
        id: String(req.params.productId || ''),
        branchId: branch.id,
        companyId: branch.companyId,
        isActive: true,
        isService: false,
      },
      select: publicProductSelect,
    });
    if (!product) {
      return res.status(404).json({ success: false, message: 'Product not found in this store' });
    }
    return res.json({ success: true, data: toPublicProduct(product) });
  } catch (error) {
    return sendStoreError(res, error);
  }
};

// ─── Prescription upload + status ────────────────────────────────────────

const uploadPrescriptionSchema = Joi.object({
  patientName: Joi.string().trim().min(1).max(160).required(),
  patientPhone: Joi.string().trim().max(40).allow('', null).optional(),
  doctorName: Joi.string().trim().max(160).allow('', null).optional(),
  doctorReg: Joi.string().trim().max(80).allow('', null).optional(),
  notes: Joi.string().trim().max(1000).allow('', null).optional(),
  // The scan/photo of the paper prescription as a data URI — the same
  // representation the staff register uses for Prescription.imageUrl.
  imageUrl: Joi.string()
    .pattern(/^data:image\/[a-zA-Z0-9.+-]+;base64,/)
    .max(7_000_000)
    .required()
    .messages({ 'string.pattern.base': 'imageUrl must be an image data URI (data:image/...;base64,...)' }),
  issuedDate: Joi.date().optional(),
});

/**
 * POST /api/store/:branchId/prescriptions — a patient uploads a
 * prescription photo. Creates a Prescription row with NO items yet and
 * reviewStatus PENDING; the pharmacist transcribes the medicines and
 * marks it REVIEWED (or REJECTED) from the staff register. The
 * returned id is what the patient checks out with once reviewed.
 */
export const uploadStorePrescription = async (req: Request, res: Response) => {
  try {
    const branch = await requireStore(req, res);
    if (!branch) return;
    const { error, value } = uploadPrescriptionSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map((detail) => detail.message),
      });
    }
    const prisma = await getPrisma();
    const prescription = await prisma.prescription.create({
      data: {
        companyId: branch.companyId,
        branchId: branch.id,
        patientName: value.patientName,
        patientPhone: value.patientPhone ? String(value.patientPhone).trim() : null,
        doctorName: value.doctorName ? String(value.doctorName).trim() : null,
        doctorReg: value.doctorReg ? String(value.doctorReg).trim() : null,
        notes: value.notes ? String(value.notes).trim() : null,
        imageUrl: value.imageUrl,
        issuedDate: value.issuedDate ? new Date(value.issuedDate) : new Date(),
        source: 'ONLINE_UPLOAD',
        reviewStatus: 'PENDING',
        createdBy: null,
      },
      select: {
        id: true,
        patientName: true,
        reviewStatus: true,
        source: true,
        issuedDate: true,
        createdAt: true,
      },
    });
    return res.status(201).json({
      success: true,
      data: prescription,
      message: 'Prescription uploaded. A pharmacist will review it — you can check out with it once it is approved.',
    });
  } catch (error) {
    return sendStoreError(res, error);
  }
};

/**
 * GET /api/store/:branchId/prescriptions/:id?phone= — the patient
 * checks the review state of their upload. The phone must match the
 * one given at upload (when one was given); a mismatch reads as 404
 * so the endpoint cannot be used to probe other patients' uploads.
 * The image itself is never returned here — it stays staff-side.
 */
export const getStorePrescriptionStatus = async (req: Request, res: Response) => {
  try {
    const branch = await requireStore(req, res);
    if (!branch) return;
    const prisma = await getPrisma();
    const prescription = await prisma.prescription.findFirst({
      where: { id: String(req.params.id || ''), branchId: branch.id, companyId: branch.companyId },
      select: {
        id: true,
        patientName: true,
        patientPhone: true,
        reviewStatus: true,
        reviewNote: true,
        issuedDate: true,
        createdAt: true,
        items: {
          select: { productName: true, quantity: true, dosage: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!prescription) {
      return res.status(404).json({ success: false, message: 'Prescription not found' });
    }
    if (prescription.patientPhone) {
      const phone = String(req.query.phone || '').trim();
      if (!phone || phone !== prescription.patientPhone) {
        return res.status(404).json({ success: false, message: 'Prescription not found' });
      }
    }
    const { patientPhone: _patientPhone, ...publicPart } = prescription as any;
    return res.json({ success: true, data: publicPart });
  } catch (error) {
    return sendStoreError(res, error);
  }
};

// ─── Checkout ────────────────────────────────────────────────────────────

const checkoutSchema = Joi.object({
  customerName: Joi.string().trim().min(1).max(160).required(),
  customerPhone: Joi.string().trim().min(6).max(40).required(),
  deliveryAddress: Joi.string().trim().max(500).allow('', null).optional(),
  deliveryNotes: Joi.string().trim().max(500).allow('', null).optional(),
  prescriptionId: Joi.string().allow(null, '').optional(),
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

/** Resolve the user an online order is rung up as: the business OWNER. */
const resolveStoreOwnerId = async (prisma: any, companyId: string): Promise<string | null> => {
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
 * invoice number, FBR queue) — the store never re-implements any of
 * it. The synthetic user is the business owner with the store branch
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
      console.error('Store checkout createSale threw:', error);
      resolvePromise({ status: 500, body: { success: false, message: 'Internal server error' } });
    });
  });

/**
 * POST /api/store/:branchId/checkout — cash-on-delivery order. The
 * cart is re-priced server-side; Rx items need a REVIEWED
 * prescription that covers them (upload → pharmacist review → this
 * checkout); the customer is found-or-created by phone inside this
 * business (a phone owned by ANOTHER business checks out as a guest,
 * never linked). The created sale is a real POS sale with channel
 * ONLINE_STORE, paymentStatus PENDING, paidAmount 0.
 */
export const checkoutStoreOrder = async (req: Request, res: Response) => {
  try {
    const branch = await requireStore(req, res);
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

    // 1. Server-side cart: prices + stock + Rx flags (never client prices).
    const cart = await resolveStoreCart(prisma, branch, value.items);

    // 2. Prescription rule: Rx items need a REVIEWED prescription that
    //    covers them; an attached prescription is review-checked even
    //    when the cart holds no Rx items (createSale re-checks too).
    const prescriptionId = value.prescriptionId ? String(value.prescriptionId) : null;
    if (cart.hasPrescriptionItems && !prescriptionId) {
      throw new StoreError(
        422,
        'PRESCRIPTION_REQUIRED',
        `This order contains prescription-only items (${cart.prescriptionProductNames.join(', ')}). Upload a prescription and wait for pharmacist approval, then check out with it.`
      );
    }
    if (prescriptionId) {
      const attached = await prisma.prescription.findFirst({
        where: { id: prescriptionId, companyId: branch.companyId },
        include: { items: { select: { productId: true } } },
      });
      if (!attached) {
        throw new StoreError(400, 'PRESCRIPTION_NOT_FOUND', 'The attached prescription was not found in this business.');
      }
      if (attached.branchId && attached.branchId !== branch.id) {
        throw new StoreError(400, 'PRESCRIPTION_NOT_FOUND', 'The attached prescription belongs to a different branch.');
      }
      const block = prescriptionReviewBlock(attached);
      if (block) throw block;
      const covered = new Set((attached.items || []).map((i: any) => i.productId));
      const missing = cart.lines.filter((l) => l.requiresPrescription && !covered.has(l.productId));
      if (missing.length > 0) {
        throw new StoreError(
          400,
          'PRESCRIPTION_MISMATCH',
          `The attached prescription does not cover: ${missing.map((l) => l.name).join(', ')}.`,
          { products: missing.map((l) => ({ id: l.productId, name: l.name })) }
        );
      }
    }

    // 3. Owner (the sale's cashier) + customer (find-or-create by phone).
    const ownerId = await resolveStoreOwnerId(prisma, branch.companyId);
    if (!ownerId) {
      return res.status(500).json({ success: false, message: 'This store has no owner account to place orders under.' });
    }
    const phone = String(value.customerPhone).trim();
    let customerId: string | null = null;
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
            name: String(value.customerName).trim(),
            phone,
            address: value.deliveryAddress ? String(value.deliveryAddress).trim() : null,
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

    // 4. The real sale, via the POS handler.
    const salePayload: Record<string, unknown> = {
      branchId: branch.id,
      customerId,
      items: cart.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, unitPrice: l.unitPrice })),
      paymentMethod: STORE_PAYMENT_METHOD,
      paymentStatus: 'PENDING',
      paidAmount: 0,
      prescriptionId: prescriptionId || null,
      channel: 'ONLINE_STORE',
      deliveryAddress: value.deliveryAddress ? String(value.deliveryAddress).trim() : null,
      deliveryPhone: phone,
      deliveryNotes: value.deliveryNotes ? String(value.deliveryNotes).trim() : null,
    };
    const result = await runCreateSale(salePayload, ownerId, branch.companyId, branch.id);
    return res.status(result.status).json(result.body);
  } catch (error) {
    return sendStoreError(res, error);
  }
};
