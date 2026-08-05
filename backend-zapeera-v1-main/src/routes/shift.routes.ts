import express from 'express';
import {
  startShift,
  endShift,
  getShifts,
  getActiveShift,
  updateShift,
  getShiftStats
} from '../controllers/shift.controller';
import { authenticate } from '../middleware/auth.middleware';
import { resolveBusiness, resolveMembership, resolveBranch } from '../middleware/multitenancy.middleware';

const router = express.Router();

// All shift routes require authentication and business context
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));

// Shift operations
router.post('/start', startShift);
router.post('/end', endShift);
router.get('/', getShifts);
router.get('/active/:staffId', getActiveShift);
router.get('/stats', getShiftStats);
router.put('/:id', updateShift);

export default router;
