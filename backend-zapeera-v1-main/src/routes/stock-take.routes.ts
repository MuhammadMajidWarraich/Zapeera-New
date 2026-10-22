import { Router } from 'express';
import {
  createStockTake,
  getStockTakes,
  getStockTake,
  upsertStockTakeLine,
  deleteStockTakeLine,
  completeStockTake,
  cancelStockTake
} from '../controllers/stock-take.controller';
import { authenticate } from '../middleware/auth.middleware';
import { checkModule, resolveBranch, resolveBusiness, resolveMembership } from '../middleware/multitenancy.middleware';

const router = Router();

// All routes require authentication. Stock-takes are their OWN module
// in the Inventory family (stock_takes.stock-takes in the route-policy
// registry), following the Wave C4/C5 pack precedent. Completion is
// additionally OWNER/MANAGER-gated inside the controller — it is the
// step that rewrites batch quantities.
//
// MOUNT (server.ts, both prefixes):
//   import stockTakeRoutes from './routes/stock-take.routes';
//   app.use('/api/v1/stock-takes', stockTakeRoutes);
//   app.use('/api/stock-takes', stockTakeRoutes);
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));
router.use(checkModule('stock_takes'));

router.post('/', createStockTake);
router.get('/', getStockTakes);
router.get('/:id', getStockTake);
router.post('/:id/lines', upsertStockTakeLine);
router.delete('/:id/lines/:lineId', deleteStockTakeLine);
router.post('/:id/complete', completeStockTake);
router.post('/:id/cancel', cancelStockTake);

export default router;
