import { Router } from 'express';
import {
  listWallets,
  getWallet,
  topUpWallet,
  getWalletTransactions,
} from '../controllers/wallet.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// Staff eWallet endpoints (Wave C9 — gap item 9). All routes require
// authentication + the sales module; every handler re-checks the
// GIFT_CARD_KIOSK_PACK add-on gate and scopes to the caller's
// business. Spending is NOT here — it happens as tender on a POS
// sale (see sale.controller).
//
// MOUNT (server.ts — both prefixes):
//   app.use('/api/v1/wallets', walletRoutes);
//   app.use('/api/wallets', walletRoutes);
//
//   GET    /                              list wallets (search)
//   GET    /customers/:customerId         balance (+ exists flag)
//   POST   /customers/:customerId/topup   top up at the counter
//   GET    /customers/:customerId/transactions   wallet statement
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('sales'));

router.get('/', listWallets);
router.get('/customers/:customerId', getWallet);
router.post('/customers/:customerId/topup', topUpWallet);
router.get('/customers/:customerId/transactions', getWalletTransactions);

export default router;
