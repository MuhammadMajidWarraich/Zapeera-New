import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { checkInDevice, getMyDevices } from '../controllers/device.controller';

const router = Router();

// ─── All device-presence routes require authentication ──────────────────
// Presence belongs to the signed-in USER (account level), never to a
// business context: the account dashboard is per-user and a user with no
// business must still be able to see their connected desktops.
router.use(authenticate);

// Desktop app check-in (login + sync-cadence heartbeat)
router.post('/check-in', checkInDevice);

// Caller's devices + connected count (account dashboard card)
router.get('/my', getMyDevices);

export default router;
