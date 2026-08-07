import express from 'express';
import {
  checkIn,
  checkOut,
  getAttendance,
  getTodayAttendance,
  updateAttendance,
  getAttendanceStats
} from '../controllers/attendance.controller';
import { authenticate } from '../middleware/auth.middleware';
import { resolveBusiness, resolveMembership, resolveBranch } from '../middleware/multitenancy.middleware';

const router = express.Router();

// All attendance routes require authentication and business context
router.use(authenticate);
router.use(resolveBusiness({ required: false }));
router.use(resolveMembership());
router.use(resolveBranch({ required: false }));

// Attendance operations
router.post('/check-in', checkIn);
router.post('/check-out', checkOut);
router.get('/', getAttendance);
router.get('/today/:staffProfileId', getTodayAttendance);
router.get('/stats', getAttendanceStats);
router.put('/:id', updateAttendance);

export default router;
