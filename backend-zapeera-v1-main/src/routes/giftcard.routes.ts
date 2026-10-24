import { Router } from 'express';
import {
  purchaseGiftCard,
  listGiftCards,
  lookupGiftCardByCode,
  getGiftCard,
  voidGiftCard,
} from '../controllers/giftcard.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// Staff gift-card endpoints (Wave C9 — gap item 9). All routes
// require authentication + the sales module; every handler
// re-checks the GIFT_CARD_KIOSK_PACK add-on gate and scopes to the
// caller's business. Redemption is NOT here — it happens as tender
// on a POS sale (see sale.controller).
//
// MOUNT (server.ts — both prefixes):
//   app.use('/api/v1/gift-cards', giftCardRoutes);
//   app.use('/api/gift-cards', giftCardRoutes);
//
//   POST   /                    sell a gift card at the counter
//   GET    /                    list cards (branchId/status/search)
//   GET    /code/:code          look up by code (POS tender lookup)
//   GET    /:id                 one card + its ledger rows
//   POST   /:id/void            void a card (OWNER/MANAGER/ADMIN)
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('sales'));

router.post('/', purchaseGiftCard);
router.get('/', listGiftCards);
router.get('/code/:code', lookupGiftCardByCode);
router.get('/:id', getGiftCard);
router.post('/:id/void', voidGiftCard);

export default router;
