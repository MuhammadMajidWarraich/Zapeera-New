// Gift cards (Wave C9 — gap item 9, retail only).
//
// Staff endpoints for selling gift cards at the counter, looking
// them up, listing them and voiding them. Redemption itself is NOT
// here: a gift card is redeemed as TENDER on a POS sale (payment
// method GIFT_CARD, code in the allocation's reference — see
// sale.controller + giftcard-kiosk.util redeemGiftCardAtomic), so the
// card, the sale and the ledger row always commit or roll back
// together. These endpoints never move money except the purchase
// itself (purchaseGiftCardAtomic: card + PURCHASE row in one tx).
//
// Every handler is branch/business-scoped and gated on the
// GIFT_CARD_KIOSK_PACK add-on (isGiftCardKioskEnabled) — the pack is
// add-on-only, priced Rs 1,000/mo since 2026-10-25.
//
// A gift-card purchase is a LIABILITY (prepaid value owed to the
// holder), not a sale: no Sale row is written, and the purchase
// value never lands in sales revenue. Redemption is the moment the
// value is spent, on a real sale.

import { Response } from 'express';
import Joi from 'joi';
import { getPrisma } from '../utils/db.util';
import { AuthRequest, getUserRole } from '../middleware/auth.middleware';
import {
  GiftCardKioskError,
  isGiftCardKioskEnabled,
  normalizeGiftCardCode,
  purchaseGiftCardAtomic,
} from '../utils/giftcard-kiosk.util';

export const GIFT_CARD_PAYMENT_METHODS = ['CASH', 'CARD', 'JAZZCASH', 'EASYPAISA', 'BANK_TRANSFER', 'MOBILE'] as const;

const purchaseSchema = Joi.object({
  branchId: Joi.string().required(),
  value: Joi.number().positive().required(),
  recipientName: Joi.string().trim().max(120).allow('', null).optional(),
  recipientPhone: Joi.string().trim().max(40).allow('', null).optional(),
  purchasedBy: Joi.string().allow(null, '').optional(),
  paymentMethod: Joi.string()
    .valid(...GIFT_CARD_PAYMENT_METHODS)
    .optional(),
  expiresAt: Joi.date().iso().allow(null, '').optional(),
});

/** Business id for this request: multitenancy middleware first, then the user's selected company. */
export function resolveRequestBusinessId(req: AuthRequest): string | null {
  const fromMiddleware = (req as any).business_id as string | undefined;
  if (fromMiddleware) return String(fromMiddleware);
  if (req.user?.selectedCompanyId) return String(req.user.selectedCompanyId);
  return null;
}

/** 403 unless the pack is enabled for this business. Returns the business id. */
export async function requireGiftCardKiosk(
  req: AuthRequest,
  res: Response
): Promise<string | null> {
  const businessId = resolveRequestBusinessId(req);
  if (!businessId) {
    res.status(400).json({ success: false, message: 'Business context is required.' });
    return null;
  }
  const prisma = await getPrisma();
  if (!(await isGiftCardKioskEnabled(prisma, businessId))) {
    res.status(403).json({
      success: false,
      code: 'GIFT_CARD_KIOSK_NOT_ENABLED',
      message: 'Gift cards, eWallet & Kiosk are not enabled for this business. Enable the add-on to use them.',
    });
    return null;
  }
  return businessId;
}

function sendGiftCardError(res: Response, error: any) {
  if (error instanceof GiftCardKioskError) {
    return res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
      details: error.details || undefined,
    });
  }
  console.error('gift-card error:', error);
  return res.status(500).json({ success: false, message: 'Internal server error' });
}

/** POST /api/gift-cards — sell a new gift card at the counter. */
export const purchaseGiftCard = async (req: AuthRequest, res: Response) => {
  try {
    const businessId = await requireGiftCardKiosk(req, res);
    if (!businessId) return;
    const { error, value } = purchaseSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map((d) => d.message),
      });
    }
    const prisma = await getPrisma();
    const branch = await prisma.branch.findFirst({
      where: { id: value.branchId, companyId: businessId },
      select: { id: true },
    });
    if (!branch) {
      return res.status(400).json({ success: false, message: 'The branch was not found in this business.' });
    }
    if (value.purchasedBy) {
      const customer = await prisma.customer.findFirst({
        where: { id: value.purchasedBy, companyId: businessId },
        select: { id: true },
      });
      if (!customer) {
        return res.status(400).json({ success: false, message: 'The purchasing customer was not found in this business.' });
      }
    }
    const card = await prisma.$transaction((tx: any) =>
      purchaseGiftCardAtomic(tx, {
        companyId: businessId,
        branchId: value.branchId,
        value: value.value,
        recipientName: value.recipientName || null,
        recipientPhone: value.recipientPhone || null,
        purchasedBy: value.purchasedBy || null,
        paymentMethod: value.paymentMethod || null,
        expiresAt: value.expiresAt || null,
        createdBy: req.user?.id || null,
      })
    );
    return res.status(201).json({ success: true, data: card });
  } catch (error) {
    return sendGiftCardError(res, error);
  }
};

/** GET /api/gift-cards — list cards (branchId/status/search filters). */
export const listGiftCards = async (req: AuthRequest, res: Response) => {
  try {
    const businessId = await requireGiftCardKiosk(req, res);
    if (!businessId) return;
    const prisma = await getPrisma();
    const { branchId = '', status = '', search = '', page = '1', limit = '50' } = req.query as Record<string, string>;
    const where: any = { companyId: businessId };
    if (branchId) where.branchId = branchId;
    if (status) where.status = String(status).toUpperCase();
    if (search) {
      const q = String(search).trim();
      where.OR = [
        { code: { contains: q } },
        { recipientName: { contains: q } },
        { recipientPhone: { contains: q } },
      ];
    }
    const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
    const [cards, total] = await Promise.all([
      prisma.giftCard.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.giftCard.count({ where }),
    ]);
    return res.json({ success: true, data: { giftCards: cards, pagination: { page: Number(page) || 1, limit: take, total } } });
  } catch (error) {
    return sendGiftCardError(res, error);
  }
};

/** GET /api/gift-cards/code/:code — look a card up by code (POS tender lookup). */
export const lookupGiftCardByCode = async (req: AuthRequest, res: Response) => {
  try {
    const businessId = await requireGiftCardKiosk(req, res);
    if (!businessId) return;
    const prisma = await getPrisma();
    const code = normalizeGiftCardCode(req.params.code);
    const card = await prisma.giftCard.findFirst({
      where: { code, companyId: businessId },
      include: { transactions: { orderBy: { createdAt: 'desc' }, take: 20 } },
    });
    if (!card) {
      return res.status(404).json({ success: false, code: 'GIFT_CARD_NOT_FOUND', message: 'No gift card with this code was found in this business.' });
    }
    return res.json({ success: true, data: card });
  } catch (error) {
    return sendGiftCardError(res, error);
  }
};

/** GET /api/gift-cards/:id — one card with its recent ledger rows. */
export const getGiftCard = async (req: AuthRequest, res: Response) => {
  try {
    const businessId = await requireGiftCardKiosk(req, res);
    if (!businessId) return;
    const prisma = await getPrisma();
    const card = await prisma.giftCard.findFirst({
      where: { id: req.params.id, companyId: businessId },
      include: { transactions: { orderBy: { createdAt: 'desc' }, take: 50 } },
    });
    if (!card) {
      return res.status(404).json({ success: false, message: 'Gift card not found.' });
    }
    return res.json({ success: true, data: card });
  } catch (error) {
    return sendGiftCardError(res, error);
  }
};

/**
 * POST /api/gift-cards/:id/void — void a card (OWNER/MANAGER/ADMIN).
 * The remaining balance is written off with an ADJUSTMENT ledger row
 * (amount −balance) and the balance is zeroed, so the ledger sum and
 * the stored balance stay in step. A voided card can never be
 * redeemed again; voiding an already-voided card is a 409.
 */
export const voidGiftCard = async (req: AuthRequest, res: Response) => {
  try {
    const businessId = await requireGiftCardKiosk(req, res);
    if (!businessId) return;
    const role = getUserRole(req);
    if (!['OWNER', 'MANAGER', 'ADMIN'].includes(role)) {
      return res.status(403).json({ success: false, message: 'Only the owner or a manager can void a gift card.' });
    }
    const prisma = await getPrisma();
    const card = await prisma.giftCard.findFirst({
      where: { id: req.params.id, companyId: businessId },
      select: { id: true, balance: true, status: true },
    });
    if (!card) {
      return res.status(404).json({ success: false, message: 'Gift card not found.' });
    }
    if (String(card.status).toUpperCase() === 'VOIDED') {
      return res.status(409).json({ success: false, code: 'GIFT_CARD_ALREADY_VOIDED', message: 'This gift card is already voided.' });
    }
    const balance = Math.round(Number(card.balance || 0) * 100) / 100;
    const voided = await prisma.$transaction(async (tx: any) => {
      const updated = await tx.giftCard.update({
        where: { id: card.id },
        data: { balance: 0, status: 'VOIDED' },
      });
      if (balance > 0) {
        await tx.giftCardTransaction.create({
          data: {
            giftCardId: card.id,
            companyId: businessId,
            type: 'ADJUSTMENT',
            amount: -balance,
            balanceAfter: 0,
            note: 'Card voided — remaining balance written off',
            createdBy: req.user?.id || null,
          },
        });
      }
      return updated;
    });
    return res.json({ success: true, data: voided });
  } catch (error) {
    return sendGiftCardError(res, error);
  }
};
