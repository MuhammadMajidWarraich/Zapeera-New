import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import { getPrisma } from '../utils/db.util';
import { AuthRequest } from '../middleware/auth.middleware';
import { AdminAuthRequest, logAdminAction } from '../middleware/admin-auth.middleware';
import { emailService } from '../services/email.service';
import { notifyPaymentProofStatusChange } from '../routes/sse.routes';
import {
  applyApprovedPaymentProofSubscription,
  pricingPlanIdForPlatformPlan,
} from '../utils/manual-payment-subscription.util';

// ─── Constants ─────────────────────────────────────────────────────────────────

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'payment-proofs');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const VALID_METHODS = ['BANK_TRANSFER', 'EASYPAISA', 'JAZZCASH'] as const;
const AMOUNT_TOLERANCE_PERCENT = 5;   // ±5% of plan price is acceptable
const MAX_SUBMISSIONS_PER_DAY = 3;

// ─── Multer ────────────────────────────────────────────────────────────────────

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `proof_${Date.now()}_${Math.random().toString(36).slice(2, 6)}${ext}`);
  },
});

const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  allowed.includes(file.mimetype)
    ? cb(null, true)
    : cb(new Error('Only JPEG, PNG, WEBP or PDF files are allowed'));
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

function hashFile(filePath: string): string {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function safeUnlink(filePath?: string) {
  if (filePath) try { fs.unlinkSync(filePath); } catch {}
}

function todayStart(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUSINESS-FACING ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/payments/manual/submit
 * Business submits a payment proof (screenshot + metadata).
 *
 * Fraud / validation rules enforced:
 *  1. Screenshot is required
 *  2. method must be BANK_TRANSFER | EASYPAISA | JAZZCASH
 *  3. amount must be within ±5% of plan price
 *  4. Only ONE active PENDING proof per business at a time
 *  5. Max 3 submissions per business per calendar day
 *  6. Duplicate screenshot hash is flagged and rejected
 *  7. Duplicate (same amount + same referenceNote) is flagged
 */
export const submitPaymentProof = async (req: AuthRequest, res: Response): Promise<void> => {
  const filePath = req.file?.path;
  try {
    // ── Rule 1: screenshot required ──────────────────────────────────────────
    if (!req.file) {
      res.status(400).json({ success: false, message: 'Receipt screenshot is required' });
      return;
    }

    const { businessId, planId, amount, method, referenceNote } = req.body;

    // ── Rule 0: required fields ───────────────────────────────────────────────
    if (!businessId || !planId || !amount || !method) {
      safeUnlink(filePath);
      res.status(400).json({ success: false, message: 'businessId, planId, amount, and method are required' });
      return;
    }

    // ── Rule 2: valid method ─────────────────────────────────────────────────
    if (!VALID_METHODS.includes(method as any)) {
      safeUnlink(filePath);
      res.status(400).json({
        success: false,
        message: `Invalid method. Must be one of: ${VALID_METHODS.join(', ')}`
      });
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      safeUnlink(filePath);
      res.status(400).json({ success: false, message: 'amount must be a positive number' });
      return;
    }

    const prisma = await getPrisma();

    // ── Verify plan exists ────────────────────────────────────────────────────
    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) {
      safeUnlink(filePath);
      res.status(404).json({ success: false, message: `Plan '${planId}' not found` });
      return;
    }

    // ── Rule 3: amount tolerance ──────────────────────────────────────────────
    const planPrice = (plan as any).price as number;
    if (planPrice > 0) {
      const tolerance = planPrice * (AMOUNT_TOLERANCE_PERCENT / 100);
      if (Math.abs(parsedAmount - planPrice) > tolerance) {
        safeUnlink(filePath);
        res.status(400).json({
          success: false,
          message: `Amount PKR ${parsedAmount.toLocaleString()} does not match plan price PKR ${planPrice.toLocaleString()} (±${AMOUNT_TOLERANCE_PERCENT}%)`
        });
        return;
      }
    }

    // ── Rule 4: only one pending proof per business ───────────────────────────
    const pending = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM payment_proofs
      WHERE "businessId" = ${businessId} AND status = 'PENDING'
      LIMIT 1
    `;
    if (pending.length > 0) {
      safeUnlink(filePath);
      res.status(409).json({
        success: false,
        message: 'You already have a payment proof under review. Please wait for admin approval before submitting again.',
        code: 'PENDING_EXISTS'
      });
      return;
    }

    // ── Rule 5: max 3 submissions per day ────────────────────────────────────
    const todayRows = await prisma.$queryRaw<{ cnt: number }[]>`
      SELECT COUNT(*) as cnt FROM payment_proofs
      WHERE "businessId" = ${businessId}
        AND "createdAt" >= ${todayStart()}
    `;
    const todayCount = Number(todayRows[0]?.cnt ?? 0);
    if (todayCount >= MAX_SUBMISSIONS_PER_DAY) {
      safeUnlink(filePath);
      res.status(429).json({
        success: false,
        message: `You have reached the limit of ${MAX_SUBMISSIONS_PER_DAY} submissions today. Please try again tomorrow.`,
        code: 'DAILY_LIMIT_EXCEEDED'
      });
      return;
    }

    // ── Rule 6: screenshot hash duplicate check ───────────────────────────────
    const fileHash = hashFile(req.file.path);
    const hashDup = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM payment_proofs
      WHERE "screenshotHash" = ${fileHash}
      LIMIT 1
    `;
    if (hashDup.length > 0) {
      safeUnlink(filePath);
      res.status(409).json({
        success: false,
        message: 'This screenshot has already been submitted. Please upload a new, unedited screenshot.',
        code: 'DUPLICATE_SCREENSHOT'
      });
      return;
    }

    // ── Rule 7: duplicate reference + amount ──────────────────────────────────
    if (referenceNote) {
      const refDup = await prisma.$queryRaw<{ id: string }[]>`
        SELECT id FROM payment_proofs
        WHERE "referenceNote" = ${String(referenceNote)}
          AND amount = ${parsedAmount}
          AND status != 'REJECTED'
        LIMIT 1
      `;
      if (refDup.length > 0) {
        safeUnlink(filePath);
        res.status(409).json({
          success: false,
          message: 'A submission with this transaction reference and amount already exists.',
          code: 'DUPLICATE_REFERENCE'
        });
        return;
      }
    }

    // ── Insert proof ──────────────────────────────────────────────────────────
    const screenshotUrl = `payment-proofs/${req.file.filename}`;
    const now = new Date().toISOString();
    const id = `pp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    await prisma.$executeRawUnsafe(
      `INSERT INTO payment_proofs
         (id, "businessId", "planId", amount, currency, method, "referenceNote",
          "screenshotUrl", "screenshotHash", status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'PKR', $5, $6, $7, $8, 'PENDING', $9, $10)`,
      id, businessId, planId, parsedAmount, method,
      referenceNote || null, screenshotUrl, fileHash, now, now
    );

    console.log(`[PaymentProof] ✅ Submitted id=${id} biz=${businessId} plan=${planId} method=${method} amount=${parsedAmount}`);

    res.status(201).json({
      success: true,
      message: 'Payment proof submitted successfully. Our team will verify and activate your subscription within 24 hours.',
      data: { id, status: 'PENDING' }
    });
  } catch (error: any) {
    safeUnlink(filePath);
    console.error('[PaymentProof] submitPaymentProof error:', error);
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
};

/**
 * GET /api/payments/manual/my?businessId=xxx
 * Returns all proofs for a business with status and admin feedback.
 */
export const getMyPaymentProofs = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { businessId } = req.query;
    if (!businessId) {
      res.status(400).json({ success: false, message: 'businessId is required' });
      return;
    }

    const prisma = await getPrisma();
    const rows = await prisma.$queryRaw<any[]>`
      SELECT pp.id, pp."businessId", pp."planId", pp.amount, pp.currency,
             pp.method, pp."referenceNote", pp."screenshotUrl",
             pp.status, pp."rejectionReason", pp."reviewedAt",
             pp."createdAt", pp."updatedAt",
             p.name as "planName", p.price as "planPrice"
      FROM payment_proofs pp
      JOIN platform_plans p ON p.id = pp."planId"
      WHERE pp."businessId" = ${String(businessId)}
      ORDER BY pp."createdAt" DESC
    `;

    res.json({ success: true, data: rows });
  } catch (error: any) {
    console.error('[PaymentProof] getMyPaymentProofs error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN-FACING ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/payments/manual/admin
 * List all proofs. Optional query: status, businessId, dateFrom, dateTo
 */
export const getAllPaymentProofs = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status, businessId, dateFrom, dateTo } = req.query;
    const prisma = await getPrisma();

    // Build WHERE clauses dynamically using raw
    let where = '1=1';
    const params: any[] = [];
    let paramIdx = 1;

    if (status)     { where += ` AND pp.status = $${paramIdx++}`; params.push(String(status)); }
    if (businessId) { where += ` AND pp."businessId" = $${paramIdx++}`; params.push(String(businessId)); }
    if (dateFrom)   { where += ` AND pp."createdAt" >= $${paramIdx++}`; params.push(String(dateFrom)); }
    if (dateTo)     { where += ` AND pp."createdAt" <= $${paramIdx++}`; params.push(String(dateTo)); }

    const sql = `
      SELECT pp.id, pp."businessId", pp."planId", pp.amount, pp.currency,
             pp.method, pp."referenceNote", pp."screenshotUrl",
             pp.status, pp."rejectionReason", pp."reviewedBy", pp."reviewedAt",
             pp."createdAt",
             c.name  as "businessName",
             c.email as "businessEmail",
             p.name  as "planName",
             p.price as "planPrice"
      FROM payment_proofs pp
      JOIN businesses c ON c.id = pp."businessId"
      JOIN platform_plans p ON p.id = pp."planId"
      WHERE ${where}
      ORDER BY pp."createdAt" DESC
    `;

    const rows = await prisma.$queryRawUnsafe<any[]>(sql, ...params);

    // Summary counts
    const allRows = rows as any[];
    const counts = {
      total: allRows.length,
      pending: allRows.filter((r: any) => r.status === 'PENDING').length,
      approved: allRows.filter((r: any) => r.status === 'APPROVED').length,
      rejected: allRows.filter((r: any) => r.status === 'REJECTED').length,
    };

    res.json({ success: true, data: rows, counts });
  } catch (error: any) {
    console.error('[PaymentProof] getAllPaymentProofs error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

/**
 * POST /api/payments/manual/admin/:proofId/approve
 * Approve proof → activate subscription for 30 days.
 */
export const approvePaymentProof = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { proofId } = req.params;
    const prisma = await getPrisma();
    const now = new Date();
    const nowIso = now.toISOString();

    // Load proof
    const proofRows = await prisma.$queryRaw<any[]>`
      SELECT * FROM payment_proofs WHERE id = ${proofId} LIMIT 1
    `;
    if (!proofRows.length) {
      res.status(404).json({ success: false, message: 'Payment proof not found' });
      return;
    }
    const proof = proofRows[0];

    if (proof.status !== 'PENDING') {
      res.status(409).json({ success: false, message: `Proof is already ${proof.status}` });
      return;
    }

    // Load plan
    const plan = await prisma.plan.findUnique({ where: { id: proof.planId } });
    if (!plan) {
      res.status(404).json({ success: false, message: 'Plan associated with this proof was not found' });
      return;
    }

    const pricingPlanId = pricingPlanIdForPlatformPlan(plan);

    console.log(`[PaymentProof] Plan details: name="${plan.name}", pricingPlanId="${pricingPlanId}", originalPlanId="${proof.planId}"`);

    // 1. Touch proof only. It is marked APPROVED after all subscription writes succeed.
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE payment_proofs
         SET "updatedAt" = $1
         WHERE id = $2 AND status = 'PENDING'`,
        nowIso, proofId
      );
      console.log(`[PaymentProof] Step 1: Payment proof validated for approval`);
    } catch (error) {
      console.error('[PaymentProof] Step 1 failed:', error);
      res.status(500).json({ success: false, message: 'Failed to update payment proof status' });
      return;
    }

    // 2. Activate subscription everywhere the app reads subscription state.
    let subId: string;
    let periodEnd: Date;
    try {
      const applied = await applyApprovedPaymentProofSubscription(prisma, {
        proofId,
        businessId: proof.businessId,
        platformPlan: {
          id: plan.id,
          name: plan.name,
          durationDays: (plan as any).durationDays,
        },
        assignedBy: req.admin!.id,
        activatedAt: now,
      });
      subId = applied.subscriptionId;
      periodEnd = applied.periodEnd;
      console.log(`[PaymentProof] Step 2: Subscription state updated`);
    } catch (error) {
      console.error('[PaymentProof] Step 2 failed:', error);
      res.status(500).json({ success: false, message: 'Failed to activate subscription for business' });
      return;
    }

    // 5. Link proof → subscription
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE payment_proofs
         SET status = 'APPROVED', "reviewedBy" = $1, "reviewedAt" = $2,
             "subscriptionId" = $3, "updatedAt" = $4
         WHERE id = $5`,
        req.admin!.id, nowIso, subId, nowIso, proofId
      );
      console.log(`[PaymentProof] Step 3: Payment proof approved and linked to subscription`);
    } catch (error) {
      console.error('[PaymentProof] Step 3 failed:', error);
      res.status(500).json({ success: false, message: 'Failed to link proof to subscription' });
      return;
    }

    await logAdminAction(req.admin!.id, 'APPROVE_PAYMENT_PROOF', 'PaymentProof', proofId, {
      businessId: proof.businessId,
      planId: proof.planId,
      pricingPlanId,
      amount: proof.amount,
      method: proof.method,
      periodEnd: periodEnd.toISOString()
    });

    console.log(`[PaymentProof] ✅ APPROVED id=${proofId} biz=${proof.businessId} plan=${proof.planId} until=${periodEnd.toISOString()}`);

    // Send email notification to business owner
    try {
      const business = await prisma.business.findUnique({
        where: { id: proof.businessId },
        select: { name: true, email: true }
      });
      if (business?.email) {
        await emailService.sendPaymentProofApprovalEmail(
          business.email,
          business.name,
          business.name,
          (plan as any).name,
          proof.amount,
          nowIso
        );
      }
    } catch (emailError) {
      console.error('[PaymentProof] Failed to send approval email:', emailError);
      // Don't fail the request if email fails
    }

    // Send SSE notification to business owner
    try {
      notifyPaymentProofStatusChange(
        proof.businessId,
        'APPROVED',
        {
          id: proofId,
          planName: (plan as any).name,
          amount: proof.amount
        }
      );
    } catch (sseError) {
      console.error('[PaymentProof] Failed to send SSE notification:', sseError);
      // Don't fail the request if SSE fails
    }

    res.json({
      success: true,
      message: `Subscription activated on plan '${(plan as any).name}' until ${periodEnd.toLocaleDateString()}`,
      data: {
        proofId,
        businessId: proof.businessId,
        planId: pricingPlanId,
        planName: (plan as any).name,
        status: 'ACTIVE',
        currentPeriodStart: nowIso,
        currentPeriodEnd: periodEnd.toISOString()
      }
    });
  } catch (error: any) {
    console.error('[PaymentProof] approvePaymentProof error:', error);
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
};

/**
 * POST /api/payments/manual/admin/:proofId/reject
 * Body: { reason: string }
 */
export const rejectPaymentProof = async (req: AdminAuthRequest, res: Response): Promise<void> => {
  try {
    const { proofId } = req.params;
    const { reason } = req.body;

    if (!reason || String(reason).trim().length < 3) {
      res.status(400).json({ success: false, message: 'A rejection reason is required (min 3 characters)' });
      return;
    }

    const prisma = await getPrisma();
    const nowIso = new Date().toISOString();

    const proofRows = await prisma.$queryRaw<any[]>`
      SELECT id, status FROM payment_proofs WHERE id = ${proofId} LIMIT 1
    `;
    if (!proofRows.length) {
      res.status(404).json({ success: false, message: 'Payment proof not found' });
      return;
    }
    if (proofRows[0].status !== 'PENDING') {
      res.status(409).json({ success: false, message: `Proof is already ${proofRows[0].status}` });
      return;
    }

    await prisma.$executeRawUnsafe(
      `UPDATE payment_proofs
       SET status = 'REJECTED', "reviewedBy" = $1, "reviewedAt" = $2,
           "rejectionReason" = $3, "updatedAt" = $4
       WHERE id = $5`,
      req.admin!.id, nowIso, String(reason).trim(), nowIso, proofId
    );

    await logAdminAction(req.admin!.id, 'REJECT_PAYMENT_PROOF', 'PaymentProof', proofId, { reason });

    console.log(`[PaymentProof] ❌ REJECTED id=${proofId} reason="${reason}"`);

    // Send email notification to business owner with rejection reason
    try {
      const business = await prisma.business.findUnique({
        where: { id: proofRows[0].businessId },
        select: { name: true, email: true }
      });
      if (business?.email) {
        const plan = await prisma.plan.findUnique({ where: { id: proofRows[0].planId } });
        await emailService.sendPaymentProofRejectionEmail(
          business.email,
          business.name,
          business.name,
          (plan as any)?.name || 'Unknown Plan',
          proofRows[0].amount,
          String(reason).trim()
        );
      }
    } catch (emailError) {
      console.error('[PaymentProof] Failed to send rejection email:', emailError);
      // Don't fail the request if email fails
    }

    // Send SSE notification to business owner
    try {
      const plan = await prisma.plan.findUnique({ where: { id: proofRows[0].planId } });
      notifyPaymentProofStatusChange(
        proofRows[0].businessId,
        'REJECTED',
        {
          id: proofId,
          planName: (plan as any)?.name || 'Unknown Plan',
          amount: proofRows[0].amount
        },
        String(reason).trim()
      );
    } catch (sseError) {
      console.error('[PaymentProof] Failed to send SSE notification:', sseError);
      // Don't fail the request if SSE fails
    }

    res.json({ success: true, message: 'Payment proof rejected' });
  } catch (error: any) {
    console.error('[PaymentProof] rejectPaymentProof error:', error);
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
};

// ─── Screenshot serving ────────────────────────────────────────────────────────

/**
 * GET /api/payments/manual/screenshot/:filename  (admin-only)
 * GET /uploads/payment-proofs/:filename           (static, admin-only behind auth)
 */
export const serveScreenshot = (req: Request, res: Response): void => {
  const { filename } = req.params;
  // Prevent path traversal
  const safe = path.basename(filename);
  const filePath = path.join(UPLOAD_DIR, safe);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ success: false, message: 'File not found' });
    return;
  }
  res.sendFile(filePath);
};
