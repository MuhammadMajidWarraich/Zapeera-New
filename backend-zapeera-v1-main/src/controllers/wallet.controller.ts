// eWallet (Wave C9 — gap item 9, retail only).
//
// Staff endpoints for the per-customer stored-value wallet: view the
// balance, top it up at the counter (cash/card), list wallets, and
// read the transaction history. Spending is NOT here: a wallet is
// spent as TENDER on a POS sale (payment method EWALLET — see
// sale.controller + giftcard-kiosk.util spendWalletAtomic), so the
// wallet, the sale and the ledger row always commit or roll back
// together.
//
// The wallet ledger (WalletTransaction) is SEPARATE from the
// gift-card ledger (GiftCardTransaction): the two balances are never
// mixed, and no endpoint here touches a gift card.
//
// Every handler is business-scoped and gated on the
// GIFT_CARD_KIOSK_PACK add-on (isGiftCardKioskEnabled).

import { Response } from 'express';
import Joi from 'joi';
import { getPrisma } from '../utils/db.util';
import { AuthRequest } from '../middleware/auth.middleware';
import { GiftCardKioskError, topUpWalletAtomic } from '../utils/giftcard-kiosk.util';
import { requireGiftCardKiosk } from './giftcard.controller';
import { GIFT_CARD_PAYMENT_METHODS } from './giftcard.controller';

const topUpSchema = Joi.object({
  amount: Joi.number().positive().required(),
  method: Joi.string()
    .valid(...GIFT_CARD_PAYMENT_METHODS)
    .optional(),
  note: Joi.string().trim().max(200).allow('', null).optional(),
});

function sendWalletError(res: Response, error: any) {
  if (error instanceof GiftCardKioskError) {
    return res.status(error.statusCode).json({
      success: false,
      code: error.code,
      message: error.message,
      details: error.details || undefined,
    });
  }
  console.error('wallet error:', error);
  return res.status(500).json({ success: false, message: 'Internal server error' });
}

/** GET /api/wallets — all wallets in this business (search by customer name/phone). */
export const listWallets = async (req: AuthRequest, res: Response) => {
  try {
    const businessId = await requireGiftCardKiosk(req, res);
    if (!businessId) return;
    const prisma = await getPrisma();
    const { search = '', page = '1', limit = '50' } = req.query as Record<string, string>;
    const where: any = { companyId: businessId };
    if (search) {
      const q = String(search).trim();
      where.customer = { OR: [{ name: { contains: q } }, { phone: { contains: q } }] };
    }
    const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
    const [wallets, total] = await Promise.all([
      prisma.customerWallet.findMany({
        where,
        include: { customer: { select: { id: true, name: true, phone: true } } },
        orderBy: { updatedAt: 'desc' },
        skip,
        take,
      }),
      prisma.customerWallet.count({ where }),
    ]);
    return res.json({ success: true, data: { wallets, pagination: { page: Number(page) || 1, limit: take, total } } });
  } catch (error) {
    return sendWalletError(res, error);
  }
};

/** GET /api/wallets/customers/:customerId — the wallet (balance 0 + exists:false when never topped up). */
export const getWallet = async (req: AuthRequest, res: Response) => {
  try {
    const businessId = await requireGiftCardKiosk(req, res);
    if (!businessId) return;
    const prisma = await getPrisma();
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.customerId, companyId: businessId },
      select: { id: true, name: true, phone: true },
    });
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found.' });
    }
    const wallet = await prisma.customerWallet.findFirst({
      where: { customerId: customer.id, companyId: businessId },
    });
    return res.json({
      success: true,
      data: {
        customer,
        wallet,
        balance: wallet ? Number(wallet.balance) : 0,
        exists: !!wallet,
      },
    });
  } catch (error) {
    return sendWalletError(res, error);
  }
};

/** POST /api/wallets/customers/:customerId/topup — top up at the counter. */
export const topUpWallet = async (req: AuthRequest, res: Response) => {
  try {
    const businessId = await requireGiftCardKiosk(req, res);
    if (!businessId) return;
    const { error, value } = topUpSchema.validate(req.body);
    if (error) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.details.map((d) => d.message),
      });
    }
    const prisma = await getPrisma();
    const result = await prisma.$transaction((tx: any) =>
      topUpWalletAtomic(tx, {
        customerId: req.params.customerId,
        companyId: businessId,
        amount: value.amount,
        method: value.method || null,
        createdBy: req.user?.id || null,
        note: value.note || null,
      })
    );
    return res.status(201).json({ success: true, data: result });
  } catch (error) {
    return sendWalletError(res, error);
  }
};

/** GET /api/wallets/customers/:customerId/transactions — the wallet statement. */
export const getWalletTransactions = async (req: AuthRequest, res: Response) => {
  try {
    const businessId = await requireGiftCardKiosk(req, res);
    if (!businessId) return;
    const prisma = await getPrisma();
    const { page = '1', limit = '50' } = req.query as Record<string, string>;
    const customer = await prisma.customer.findFirst({
      where: { id: req.params.customerId, companyId: businessId },
      select: { id: true },
    });
    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer not found.' });
    }
    const take = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const skip = (Math.max(Number(page) || 1, 1) - 1) * take;
    const where = { customerId: customer.id, companyId: businessId };
    const [transactions, total] = await Promise.all([
      prisma.walletTransaction.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.walletTransaction.count({ where }),
    ]);
    return res.json({ success: true, data: { transactions, pagination: { page: Number(page) || 1, limit: take, total } } });
  } catch (error) {
    return sendWalletError(res, error);
  }
};
