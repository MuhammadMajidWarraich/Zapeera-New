import { Router } from 'express';
import { authenticate } from '../middleware/auth.middleware';
import { adminAuthenticate, adminRoleGuard } from '../middleware/admin-auth.middleware';
import {
  upload,
  submitPaymentProof,
  getMyPaymentProofs,
  getAllPaymentProofs,
  approvePaymentProof,
  rejectPaymentProof,
  serveScreenshot,
} from '../controllers/payment-proof.controller';

const router = Router();

// ── Business-facing ────────────────────────────────────────────────────────────
// POST /api/payments/manual/submit      multipart: screenshot + body fields
// GET  /api/payments/manual/my          list own submissions + admin feedback
router.post('/submit', authenticate, upload.single('screenshot'), submitPaymentProof);
router.get('/my',      authenticate, getMyPaymentProofs);

// ── Admin-facing ───────────────────────────────────────────────────────────────
// GET  /api/payments/manual/admin                       list all (filterable)
// POST /api/payments/manual/admin/:proofId/approve
// POST /api/payments/manual/admin/:proofId/reject       body: { reason }
router.get('/admin',
  adminAuthenticate,
  getAllPaymentProofs
);
router.post('/admin/:proofId/approve',
  adminAuthenticate,
  adminRoleGuard('SUPER_ADMIN', 'ADMIN', 'FINANCE'),
  approvePaymentProof
);
router.post('/admin/:proofId/reject',
  adminAuthenticate,
  adminRoleGuard('SUPER_ADMIN', 'ADMIN', 'FINANCE'),
  rejectPaymentProof
);

// ── Screenshot serving (admin-only) ───────────────────────────────────────────
// GET /api/payments/manual/screenshot/:filename
router.get('/screenshot/:filename', adminAuthenticate, serveScreenshot);

export default router;
