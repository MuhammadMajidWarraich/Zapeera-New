import { Router } from 'express';
import { createParkedSale, getParkedSales, getParkedSale, deleteParkedSale } from '../controllers/parked-sale.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, checkPermission, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication — same chain as the sale routes.
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('sales'));

// Parked (held) POS sales. Parking/discarding is part of making a
// sale, so both sit behind create_sale — the same roles that can
// create invoices can park, resume and discard held orders.
router.get('/', checkPermission('read_sale'), getParkedSales);
router.get('/:id', checkPermission('read_sale'), getParkedSale);
router.post('/', checkPermission('create_sale'), createParkedSale);
router.delete('/:id', checkPermission('create_sale'), deleteParkedSale);
// Discard as a POST action (the platform's tenant convention — cf.
// /:id/check-out, /:id/restock): the universal authorization layer
// resolves raw DELETE to the `delete` operation, which in the role
// matrix only OWNER holds, while parking itself is a create-level
// action. Every role that can park must also be able to discard, so
// the UI discards and consumes through this route; DELETE remains
// available for OWNER/API use.
router.post('/:id/discard', checkPermission('create_sale'), deleteParkedSale);

export default router;
