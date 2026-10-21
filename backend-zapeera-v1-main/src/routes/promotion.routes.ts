import { Router } from 'express';
import {
  createPromotion,
  getPromotions,
  getPromotionById,
  updatePromotion,
  deletePromotion,
  validateCoupon
} from '../controllers/promotion.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication. Promotions live under the sales
// module (they are invoice-money rules) — no separate module key is
// introduced, and the route-policy registry maps /api/promotions to
// the sales.invoices resource key. Management writes are additionally
// gated to OWNER/MANAGER inside the controller; every sales role can
// read the list and validate a coupon at the POS.
//
// MOUNT (server.ts — applied with the Wave B4 deploy, alongside the
// other routers, in both prefixes):
//   import promotionRoutes from './routes/promotion.routes';
//   app.use('/api/v1/promotions', promotionRoutes);
//   app.use('/api/promotions', promotionRoutes);
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('sales'));

router.post('/validate', validateCoupon);
router.post('/', createPromotion);
router.get('/', getPromotions);
router.get('/:id', getPromotionById);
router.put('/:id', updatePromotion);
router.delete('/:id', deletePromotion);

export default router;
