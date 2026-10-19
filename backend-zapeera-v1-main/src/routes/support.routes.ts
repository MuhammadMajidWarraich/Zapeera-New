import { Router } from 'express';
import {
  createSupportTicket,
  getMySupportTickets,
  getMySupportTicket,
  replyToMySupportTicket
} from '../controllers/support.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// All support routes require authentication. Tenancy is enforced inside the
// controller (ticket creator or ACTIVE member of the ticket's business) —
// support must stay reachable regardless of module entitlements or
// subscription state, so there is deliberately no module gate here (route
// policy kind: 'auth', see config/route-policy.registry.ts).
router.use(authenticate);

router.post('/tickets', createSupportTicket);
router.get('/tickets', getMySupportTickets);
router.get('/tickets/:id', getMySupportTicket);
router.post('/tickets/:id/reply', replyToMySupportTicket);

export default router;
