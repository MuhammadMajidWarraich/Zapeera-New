import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import Joi from 'joi';
import { AuthRequest, getUserRole } from '../middleware/auth.middleware';
import { createSale, SALE_PAYMENT_METHODS } from './sale.controller';
import {
  DAY_MS,
  folioChargeProductName,
  folioChargeProductSku,
  normalizeHotelDate,
  roomNightProductName,
  roomNightProductSku,
  round2,
  sameUtcDay,
  summarizeFolioCharges
} from '../utils/hotel.util';

// ─── Folios (Wave C5 — Hotel pack) ───────────────────────────────────
// The folio is the stay's bill and the hotel's money truth for it:
//   balance = Σ FolioCharge.amount − Σ FolioPayment.amount
// computed from the rows on every read, never stored. Charges arrive
// three ways: room nights posted by check-in / the night-audit
// action (ROOM_NIGHT at the folio's rateSnapshot), POS sales charged
// to the room (SERVICE with saleId — written by the sale engine in
// its own transaction, see sale.controller), and desk-added charges
// (SERVICE / MANUAL here). Payments are advances and settlements;
// a NEGATIVE payment is a refund of guest money back out (manager
// only, note required) so an overpaid folio can be made whole
// honestly instead of being force-closed in credit.
//
// Check-out settles the folio (final payment, or an explicit
// OWNER/MANAGER write-off of the remainder) and produces ONE
// checkout invoice through the real sale engine: the folio-NATIVE
// charges (room nights aggregated at the snapshot rate + each desk
// charge) as isService lines — the C4 mechanism — so the invoice
// deducts no stock. POS sales charged to the room are NOT re-billed:
// they are already invoices; the folio merely carried their debt.
// Folio rates/charges are the final settled amounts; the invoice
// runs the sale engine exactly as a POS sale does (documented in
// the roadmap: PMS-lite does not run a separate tax regime).

const resolveFolioCompanyId = (req: AuthRequest): string =>
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  req.membership?.business_id ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const folioScopeWhere = (req: AuthRequest, id: string): any => ({
  id,
  companyId: resolveFolioCompanyId(req)
});

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

const folioInclude = {
  room: {
    select: {
      id: true,
      number: true,
      floor: true,
      status: true,
      roomType: { select: { id: true, name: true, ratePerNight: true } }
    }
  },
  reservation: {
    select: { id: true, checkInDate: true, checkOutDate: true, status: true, source: true }
  }
};

const withSummary = (folio: any): any => {
  const charges = folio.charges || [];
  const payments = folio.payments || [];
  return { ...folio, summary: summarizeFolioCharges(charges, payments) };
};

const HOTEL_SERVICES_CATEGORY_NAME = 'Services';

/**
 * Find-or-create one of the auto-managed service products the
 * checkout invoice rides on (identity = SKU, globally unique):
 *   ROOMNIGHT-<roomTypeId>  "Room Night — <type name>"
 *   FOLIOCHG-<chargeId>     the charge's own description
 * Mirrors the clinic pack's ensureDoctorServiceProduct exactly,
 * including the shared find-or-created "Services" category.
 */
export const ensureHotelServiceProduct = async (
  prisma: any,
  args: {
    companyId: string;
    branchId: string;
    sku: string;
    name: string;
    description: string;
    createdBy?: string | null;
  }
): Promise<any> => {
  const { companyId, branchId, sku } = args;

  let product = await prisma.product.findFirst({ where: { sku } });
  if (product && product.companyId !== companyId) product = null;

  if (!product) {
    let category = await prisma.category.findFirst({
      where: { companyId, branchId, name: HOTEL_SERVICES_CATEGORY_NAME }
    });
    if (!category) {
      category = await prisma.category.create({
        data: {
          name: HOTEL_SERVICES_CATEGORY_NAME,
          description: 'Consultations and other non-stock services',
          type: 'GENERAL',
          companyId,
          branchId,
          createdBy: args.createdBy || null
        }
      });
    }
    try {
      product = await prisma.product.create({
        data: {
          name: args.name,
          sku,
          description: args.description,
          categoryId: category.id,
          branchId,
          companyId,
          createdBy: args.createdBy || null,
          isService: true,
          isActive: true,
          minStock: 0
        }
      });
    } catch (createError: any) {
      if (createError?.code !== 'P2002') throw createError;
      product = await prisma.product.findFirst({ where: { sku, companyId } });
      if (!product) throw createError;
    }
  } else {
    const patch: any = {};
    if (product.name !== args.name) patch.name = args.name;
    if (!product.isService) patch.isService = true;
    if (!product.isActive) patch.isActive = true;
    if (Object.keys(patch).length > 0) {
      product = await prisma.product.update({ where: { id: product.id }, data: patch });
    }
  }
  return product;
};

/**
 * Run the real sale engine for the checkout invoice, in-process —
 * the clinic pack's invokeCreateSale pattern, unchanged: the request
 * lends its auth/tenancy context with the body swapped, and the
 * caller's branch context is pinned to the folio's branch.
 */
const invokeCreateSale = async (
  req: AuthRequest,
  companyId: string,
  payload: any
): Promise<{ status: number; body: any }> => {
  const originalBody = (req as any).body;
  const originalUser = (req as any).user;
  let status = 500;
  let body: any = null;
  const captureRes: any = {
    status(code: number) {
      status = code;
      return this;
    },
    json(responseBody: any) {
      body = responseBody;
      return this;
    }
  };
  try {
    (req as any).body = payload;
    if (originalUser && payload.branchId) {
      (req as any).user = {
        ...originalUser,
        selectedCompanyId: companyId,
        selectedBranchId: payload.branchId
      };
    }
    await createSale(req as any, captureRes);
  } finally {
    (req as any).body = originalBody;
    (req as any).user = originalUser;
  }
  return { status, body };
};

const addChargeSchema = Joi.object({
  description: Joi.string().trim().min(1).max(300).required(),
  amount: Joi.number().positive().required(),
  kind: Joi.string().valid('SERVICE', 'MANUAL').default('MANUAL')
});

const addPaymentSchema = Joi.object({
  amount: Joi.number().invalid(0).required(),
  method: Joi.string().valid(...SALE_PAYMENT_METHODS).required(),
  note: Joi.string().trim().max(300).allow('', null).optional()
});

const postNightChargeSchema = Joi.object({
  date: Joi.date().optional()
});

const checkOutSchema = Joi.object({
  payment: Joi.object({
    amount: Joi.number().positive().required(),
    method: Joi.string().valid(...SALE_PAYMENT_METHODS).required(),
    note: Joi.string().trim().max(300).allow('', null).optional()
  }).optional(),
  writeOff: Joi.boolean().optional(),
  writeOffNote: Joi.string().trim().max(500).allow('', null).optional()
});

// List folios. Filters: status (OPEN default view is the caller's
// choice — no implicit filter), roomId, search (guest name).
export const getFolios = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { page = 1, limit = 100, status, roomId, search } = req.query;

    const where: any = { companyId: resolveFolioCompanyId(req) };
    if (status) where.status = String(status).toUpperCase();
    if (roomId) where.roomId = String(roomId);
    if (search) where.guestName = { contains: String(search) };

    const skip = (Number(page) - 1) * Number(limit);
    const [folios, total] = await Promise.all([
      prisma.folio.findMany({
        where,
        include: {
          ...folioInclude,
          charges: { select: { kind: true, amount: true, saleId: true } },
          payments: { select: { amount: true } }
        },
        orderBy: [{ status: 'desc' }, { openedAt: 'desc' }],
        skip,
        take: Number(limit)
      }),
      prisma.folio.count({ where })
    ]);

    return res.json({
      success: true,
      data: folios.map(withSummary),
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error('Get folios error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get one folio (tenancy-scoped) with full charges + payments and
// the computed summary — the folio detail the desk works from.
export const getFolioById = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const folio = await prisma.folio.findFirst({
      where: folioScopeWhere(req, req.params.id),
      include: {
        ...folioInclude,
        charges: { orderBy: { chargeDate: 'asc' } },
        payments: { orderBy: { paidAt: 'asc' } },
        checkoutSale: {
          select: { id: true, invoiceNumber: true, totalAmount: true, paymentStatus: true }
        }
      }
    });
    if (!folio) {
      return res.status(404).json({ success: false, message: 'Folio not found' });
    }
    return res.json({ success: true, data: withSummary(folio) });
  } catch (error) {
    console.error('Get folio error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/** Load an OPEN folio for a mutation, or write the refusal and return null. */
const loadOpenFolio = async (req: AuthRequest, res: Response): Promise<any | null> => {
  const prisma = await getPrisma();
  const folio = await prisma.folio.findFirst({
    where: folioScopeWhere(req, req.params.id),
    include: { charges: true, payments: true }
  });
  if (!folio) {
    res.status(404).json({ success: false, message: 'Folio not found' });
    return null;
  }
  if (folio.status !== 'OPEN') {
    res.status(400).json({
      success: false,
      message: 'This folio is closed — its bill is final',
      code: 'FOLIO_CLOSED'
    });
    return null;
  }
  return folio;
};

// Add a desk charge (SERVICE / MANUAL) to an open folio. Charges
// are immutable once written — a mistake is corrected by the desk
// before check-out, never by editing history afterwards (check-out
// refuses a closed folio entirely).
export const addFolioCharge = async (req: AuthRequest, res: Response) => {
  try {
    const { error, value } = addChargeSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }
    const folio = await loadOpenFolio(req, res);
    if (!folio) return;

    const prisma = await getPrisma();
    const charge = await prisma.folioCharge.create({
      data: {
        folioId: folio.id,
        description: value.description,
        amount: round2(value.amount),
        kind: value.kind,
        chargeDate: new Date(),
        createdBy: req.user?.createdBy || req.user?.id || null
      }
    });

    return res.status(201).json({
      success: true,
      data: charge,
      message: 'Charge added to the folio'
    });
  } catch (error) {
    console.error('Add folio charge error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Record money against an open folio: an advance or a settlement
// payment (positive), or a refund of guest money (negative —
// OWNER/MANAGER only, note required) so an overpaid folio can be
// brought back to zero truthfully.
export const addFolioPayment = async (req: AuthRequest, res: Response) => {
  try {
    const { error, value } = addPaymentSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }
    if (value.amount < 0) {
      if (!requireManagerRole(req, res, 'refund money from a folio')) return;
      if (!value.note || !String(value.note).trim()) {
        return res.status(400).json({
          success: false,
          message: 'A refund payment (negative amount) must carry a note saying why',
          code: 'REFUND_NOTE_REQUIRED'
        });
      }
    }
    const folio = await loadOpenFolio(req, res);
    if (!folio) return;

    const prisma = await getPrisma();
    const payment = await prisma.folioPayment.create({
      data: {
        folioId: folio.id,
        amount: round2(value.amount),
        method: value.method,
        note: value.note ? String(value.note).trim() : null,
        paidAt: new Date(),
        createdBy: req.user?.createdBy || req.user?.id || null
      }
    });

    return res.status(201).json({
      success: true,
      data: payment,
      message: value.amount < 0 ? 'Refund recorded on the folio' : 'Payment recorded on the folio'
    });
  } catch (error) {
    console.error('Add folio payment error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/** Post one room-night at the snapshot rate for a folio + day, unless that night is already posted. */
const postOneNight = async (
  prisma: any,
  folio: any,
  nightDate: Date,
  createdBy: string | null
): Promise<{ posted: boolean; charge?: any }> => {
  const already = (folio.charges || []).some(
    (c: any) => c.kind === 'ROOM_NIGHT' && sameUtcDay(new Date(c.chargeDate), nightDate)
  );
  if (already) return { posted: false };
  const roomLabel = folio.room
    ? `${folio.room.roomType?.name || 'Room'} ${folio.room.number}`
    : 'Room';
  const charge = await prisma.folioCharge.create({
    data: {
      folioId: folio.id,
      description: `Room night — ${roomLabel} (${nightDate.toISOString().slice(0, 10)})`,
      amount: round2(folio.rateSnapshot),
      kind: 'ROOM_NIGHT',
      chargeDate: nightDate,
      createdBy
    }
  });
  return { posted: true, charge };
};

// Post tonight's room-night charge for one folio (the night-audit
// action). One charge per folio per UTC day: a night already posted
// is a 400, never a duplicate.
export const postNightCharge = async (req: AuthRequest, res: Response) => {
  try {
    const { error, value } = postNightChargeSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }
    const folio = await loadOpenFolio(req, res);
    if (!folio) return;

    const prisma = await getPrisma();
    const full = await prisma.folio.findFirst({
      where: { id: folio.id },
      include: { charges: true, room: { include: { roomType: { select: { name: true } } } } }
    });
    const nightDate = normalizeHotelDate(value.date || new Date());
    const result = await postOneNight(
      prisma, full, nightDate, req.user?.createdBy || req.user?.id || null
    );
    if (!result.posted) {
      return res.status(400).json({
        success: false,
        message: `The room night for ${nightDate.toISOString().slice(0, 10)} is already posted on this folio`,
        code: 'NIGHT_ALREADY_POSTED'
      });
    }

    return res.status(201).json({
      success: true,
      data: result.charge,
      message: 'Room night posted'
    });
  } catch (error) {
    console.error('Post night charge error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// The bulk night-audit action: post tonight's room night on every
// OPEN folio of the business. Folios whose night is already posted
// are skipped (reported), never double-charged.
export const postNightChargesBulk = async (req: AuthRequest, res: Response) => {
  try {
    const { error, value } = postNightChargeSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }
    const prisma = await getPrisma();
    const companyId = resolveFolioCompanyId(req);
    const nightDate = normalizeHotelDate(value.date || new Date());
    const createdBy = req.user?.createdBy || req.user?.id || null;

    const folios = await prisma.folio.findMany({
      where: { companyId, status: 'OPEN' },
      include: {
        charges: { where: { kind: 'ROOM_NIGHT' }, select: { kind: true, chargeDate: true } },
        room: { select: { number: true, roomType: { select: { name: true } } } }
      }
    });

    const posted: any[] = [];
    const skipped: any[] = [];
    for (const folio of folios) {
      const result = await postOneNight(prisma, folio, nightDate, createdBy);
      if (result.posted) {
        posted.push({ folioId: folio.id, chargeId: result.charge.id, amount: result.charge.amount });
      } else {
        skipped.push({ folioId: folio.id, reason: 'NIGHT_ALREADY_POSTED' });
      }
    }

    return res.json({
      success: true,
      data: {
        date: nightDate.toISOString().slice(0, 10),
        posted,
        skipped,
        postedCount: posted.length,
        skippedCount: skipped.length,
        postedTotal: round2(posted.reduce((sum, p) => sum + p.amount, 0))
      },
      message: `Night charges posted for ${posted.length} folio(s)`
    });
  } catch (error) {
    console.error('Bulk night charges error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Check the guest out: settle the folio and close the stay.
//   · An optional final payment is recorded first.
//   · A remaining balance > 0.01 blocks check-out unless the caller
//     sends writeOff with a note (OWNER/MANAGER) — the forgiven
//     amount + reason land on the folio itself.
//   · A credit balance (guest overpaid) blocks check-out too: the
//     desk refunds it as a negative payment first, so the folio
//     closes at exactly zero whenever money was written off as 0.
//   · The checkout invoice (native charges only) is billed through
//     the sale engine BEFORE closing: if billing fails, the folio
//     stays open (any payment recorded above stands, as in C4) and
//     the desk can retry.
export const checkOutFolio = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { error, value } = checkOutSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map(detail => detail.message)
      });
    }

    const companyId = resolveFolioCompanyId(req);
    const folio = await prisma.folio.findFirst({
      where: folioScopeWhere(req, req.params.id),
      include: {
        ...folioInclude,
        charges: { orderBy: { chargeDate: 'asc' } },
        payments: { orderBy: { paidAt: 'asc' } }
      }
    });
    if (!folio) {
      return res.status(404).json({ success: false, message: 'Folio not found' });
    }
    if (folio.status !== 'OPEN') {
      return res.status(400).json({
        success: false,
        message: 'This folio is already closed',
        code: 'FOLIO_CLOSED'
      });
    }

    const createdBy = req.user?.createdBy || req.user?.id || null;

    // 1) The settling payment, if the desk took one now.
    let payments = [...(folio.payments || [])];
    if (value.payment) {
      const payment = await prisma.folioPayment.create({
        data: {
          folioId: folio.id,
          amount: round2(value.payment.amount),
          method: value.payment.method,
          note: value.payment.note ? String(value.payment.note).trim() : 'Paid at check-out',
          paidAt: new Date(),
          createdBy
        }
      });
      payments = [...payments, payment];
    }

    const summary = summarizeFolioCharges(folio.charges || [], payments);

    // 2) Balance gate: settle, or write off explicitly.
    let writeOffAmount: number | null = null;
    let writeOffNote: string | null = null;
    if (summary.balance > 0.01) {
      if (!value.writeOff) {
        return res.status(400).json({
          success: false,
          message: `This folio still has a balance of PKR ${summary.balance.toFixed(2)} — record a payment, or write it off explicitly to check out`,
          code: 'FOLIO_BALANCE_DUE',
          data: { balance: summary.balance }
        });
      }
      if (!requireManagerRole(req, res, 'write off a folio balance')) return;
      if (!value.writeOffNote || !String(value.writeOffNote).trim()) {
        return res.status(400).json({
          success: false,
          message: 'A write-off must carry a note saying why the balance was forgiven',
          code: 'WRITE_OFF_NOTE_REQUIRED'
        });
      }
      writeOffAmount = summary.balance;
      writeOffNote = String(value.writeOffNote).trim();
    } else if (summary.balance < -0.01) {
      return res.status(400).json({
        success: false,
        message: `This folio is PKR ${Math.abs(summary.balance).toFixed(2)} in credit — refund the guest (a negative payment on the folio) before check-out`,
        code: 'FOLIO_IN_CREDIT',
        data: { balance: summary.balance }
      });
    }

    // 3) The checkout invoice for the folio-NATIVE charges.
    let sale: any = null;
    if (summary.nativeTotal > 0) {
      const branchId: string | null =
        folio.branchId || (req.user?.selectedBranchId ? String(req.user.selectedBranchId) : null);
      if (!branchId) {
        return res.status(400).json({
          success: false,
          message: 'No branch context for this folio — open the hotel from a branch first',
          code: 'NO_BRANCH_CONTEXT'
        });
      }

      const nativeCharges = (folio.charges || []).filter((c: any) => !c.saleId);
      const roomType = folio.room?.roomType;
      const saleItems: any[] = [];
      if (summary.roomNightCount > 0 && roomType) {
        const nightProduct = await ensureHotelServiceProduct(prisma, {
          companyId,
          branchId,
          sku: roomNightProductSku(roomType.id),
          name: roomNightProductName(roomType.name),
          description: `Room nights for ${roomType.name} (auto-managed service item)`,
          createdBy
        });
        saleItems.push({
          productId: nightProduct.id,
          quantity: summary.roomNightCount,
          unitPrice: round2(folio.rateSnapshot)
        });
      }
      for (const charge of nativeCharges) {
        if (charge.kind === 'ROOM_NIGHT') continue;
        const chargeProduct = await ensureHotelServiceProduct(prisma, {
          companyId,
          branchId,
          sku: folioChargeProductSku(charge.id),
          name: folioChargeProductName(charge.description),
          description: `Folio charge from folio ${folio.id} (auto-managed service item)`,
          createdBy
        });
        saleItems.push({
          productId: chargeProduct.id,
          quantity: 1,
          unitPrice: round2(charge.amount)
        });
      }

      const lastPayment = payments.length > 0 ? payments[payments.length - 1] : null;
      const payload: any = {
        branchId,
        items: saleItems,
        paymentMethod: value.payment?.method || lastPayment?.method || 'CASH'
      };
      if (writeOffAmount !== null) {
        // The forgiven remainder is genuinely unpaid: the invoice
        // records what was actually covered and stays PENDING.
        payload.paymentStatus = 'PENDING';
        payload.paidAmount = round2(Math.max(0, summary.nativeTotal - writeOffAmount));
      } else {
        // Fully settled: omit paidAmount and the engine stores the
        // invoice's own total as paid (the C4 visit pattern).
        payload.paymentStatus = 'COMPLETED';
      }

      const outcome = await invokeCreateSale(req, companyId, payload);
      if (outcome.status !== 201 || !outcome.body?.success) {
        return res.status(outcome.status || 500).json(
          outcome.body || { success: false, message: 'Check-out billing failed' }
        );
      }
      sale = outcome.body.data;
    }

    // 4) Close the stay: folio CLOSED, room to housekeeping (DIRTY),
    //    the reservation completes.
    const closed = await prisma.$transaction(async (tx: any) => {
      const updatedFolio = await tx.folio.update({
        where: { id: folio.id },
        data: {
          status: 'CLOSED',
          closedAt: new Date(),
          saleId: sale?.id || null,
          writeOffAmount,
          writeOffNote
        },
        include: {
          ...folioInclude,
          charges: { orderBy: { chargeDate: 'asc' } },
          payments: { orderBy: { paidAt: 'asc' } }
        }
      });
      await tx.room.update({
        where: { id: folio.roomId },
        data: { status: 'DIRTY' }
      });
      if (folio.reservationId) {
        await tx.reservation.updateMany({
          where: { id: folio.reservationId, status: 'CHECKED_IN' },
          data: { status: 'COMPLETED' }
        });
      }
      return updatedFolio;
    });

    return res.status(201).json({
      success: true,
      data: { folio: withSummary(closed), sale },
      message: 'Checked out — folio closed'
    });
  } catch (error) {
    console.error('Check-out error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Night-audit-lite: the day's hotel numbers from the folio +
// reservation registers. Definitions (deliberately plain):
//   occupiedRooms      rooms with a folio open at any point that day
//   arrivals           reservations whose check-in day it was and
//                      who actually arrived (CHECKED_IN / COMPLETED)
//   departures         folios closed that day
//   openFolios         folios OPEN right now
//   revenuePosted      Σ folio charges posted that day (chargeDate)
//   paymentsReceived   Σ folio payments taken that day (paidAt)
//   expectedDepartures CHECKED_IN reservations leaving tomorrow
export const getNightAudit = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveFolioCompanyId(req);
    const day = normalizeHotelDate(String(req.query.date || new Date().toISOString().slice(0, 10)));
    const dayEnd = new Date(day.getTime() + DAY_MS);
    const tomorrow = new Date(day.getTime() + DAY_MS);
    const tomorrowEnd = new Date(tomorrow.getTime() + DAY_MS);

    const [
      dayFolios,
      arrivals,
      departures,
      openFolios,
      chargesPosted,
      paymentsReceived,
      expectedDepartures
    ] = await Promise.all([
      prisma.folio.findMany({
        where: {
          companyId,
          openedAt: { lt: dayEnd },
          OR: [{ closedAt: null }, { closedAt: { gte: day } }]
        },
        select: { roomId: true }
      }),
      prisma.reservation.count({
        where: {
          companyId,
          checkInDate: { gte: day, lt: dayEnd },
          status: { in: ['CHECKED_IN', 'COMPLETED'] }
        }
      }),
      prisma.folio.count({
        where: { companyId, closedAt: { gte: day, lt: dayEnd } }
      }),
      prisma.folio.count({ where: { companyId, status: 'OPEN' } }),
      prisma.folioCharge.findMany({
        where: {
          folio: { companyId },
          chargeDate: { gte: day, lt: dayEnd }
        },
        select: { amount: true }
      }),
      prisma.folioPayment.findMany({
        where: {
          folio: { companyId },
          paidAt: { gte: day, lt: dayEnd }
        },
        select: { amount: true }
      }),
      prisma.reservation.count({
        where: {
          companyId,
          checkOutDate: { gte: tomorrow, lt: tomorrowEnd },
          status: 'CHECKED_IN'
        }
      })
    ]);

    return res.json({
      success: true,
      data: {
        date: day.toISOString().slice(0, 10),
        occupiedRooms: new Set(dayFolios.map((f: any) => f.roomId)).size,
        arrivals,
        departures,
        openFolios,
        folioRevenuePosted: round2(chargesPosted.reduce((sum: number, c: any) => sum + (Number(c.amount) || 0), 0)),
        paymentsReceived: round2(paymentsReceived.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0)),
        expectedDepartures
      }
    });
  } catch (error) {
    console.error('Night audit error:', error);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
