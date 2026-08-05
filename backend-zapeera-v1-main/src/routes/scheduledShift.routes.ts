import express from 'express';
import {
  createScheduledShift,
  getScheduledShifts,
  getScheduledShift,
  updateScheduledShift,
  deleteScheduledShift
} from '../controllers/scheduledShift.controller';
import { authenticate } from '../middleware/auth.middleware';
import { resolveBusiness, resolveMembership, resolveBranch } from '../middleware/multitenancy.middleware';

const router = express.Router();

// All scheduled shift routes require authentication and business context
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));

// Scheduled shift operations
router.post('/', createScheduledShift);
router.get('/', getScheduledShifts);
router.get('/:id', getScheduledShift);
router.put('/:id', updateScheduledShift);
router.delete('/:id', deleteScheduledShift);

export default router;
