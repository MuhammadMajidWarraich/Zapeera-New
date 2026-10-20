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
import { createNotification } from './notification.controller';
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
    // QA A-09: 128-bit random name — the old `proof_<Date.now()>_<4 base36>`
    // space was small and enumerable while files were publicly served.
    cb(null, `proof_${crypto.randomBytes(16).toString('hex')}${ext}`);
  },
});

// First-pass filter only. The client-supplied mimetype is NOT trusted — the
// real type is verified from magic bytes in submitPaymentProof (detectFileType).
const fileFilter = (_req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  allowed.includes(file.mimetype)
    ? cb(null, true)
    : cb(new Error('Only JPEG, PNG, WEBP or PDF files are allowed'));
};

type DetectedFileType = { ext: string; mime: string };

/**
 * Sniff the real file type from magic bytes (QA A-09). Returns null when the
 * content is not one of the allowed types — regardless of the filename or
 * the client-declared mimetype. This stops e.g. an .html/.svg payload with
 * an `image/png` mimetype from being stored and later served as an image.
 */
function detectFileType(filePath: string): DetectedFileType | null {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(16);
    const read = fs.readSync(fd, buf, 0, 16, 0);
    const b = buf.subarray(0, read);
    if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
      return { ext: '.jpg', mime: 'image/jpeg' };
    }
    if (
      b.length >= 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
    ) {
      return { ext: '.png', mime: 'image/png' };
    }
    if (
      b.length >= 12 &&
      b.toString('ascii', 0, 4) === 'RIFF' &&
      b.toString('ascii', 8, 12) === 'WEBP'
    ) {
      return { ext: '.webp', mime: 'image/webp' };
    }
    if (b.length >= 4 && b.toString('ascii', 0, 4) === '%PDF') {
      return { ext: '.pdf', mime: 'application/pdf' };
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

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

function todayStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
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
  // `let`: the path changes when the stored file is renamed to the canonical
  // extension for its sniffed type (see Rule 1b).
  let filePath = req.file?.path;
  try {
    // ── Rule 1: screenshot required ──────────────────────────────────────────
    if (!req.file) {
      res.status(400).json({ success: false, message: 'Receipt screenshot is required' });
      return;
    }

    // ── Rule 1b: verify the REAL file type from magic bytes (QA A-09) ──────
    // The multer fileFilter only sees the client-declared mimetype. Sniff the
    // stored bytes; on mismatch delete the file and reject. On success force
    // the canonical extension for the detected type so the stored name can
    // never disagree with the content (kills the stored-XSS-via-extension
    // path when the file is later downloaded).
    const detected = detectFileType(req.file.path);
    if (!detected) {
      safeUnlink(filePath);
      res.status(400).json({
        success: false,
        message: 'Uploaded file is not a valid JPEG, PNG, WEBP or PDF file',
        code: 'INVALID_FILE_TYPE',
      });
      return;
    }
    if (path.extname(req.file.filename).toLowerCase() !== detected.ext) {
      const canonicalName = req.file.filename.replace(/\.[^.]*$/, '') + detected.ext;
      const canonicalPath = path.join(UPLOAD_DIR, canonicalName);
      fs.renameSync(req.file.path, canonicalPath);
      req.file.filename = canonicalName;
      req.file.path = canonicalPath;
      filePath = canonicalPath;
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
    const membership = await prisma.membership.findFirst({
      where: {
        userId: String(req.user?.id || ''),
        businessId: String(businessId),
        status: 'ACTIVE',
      },
      select: { id: true },
    });

    if (!membership) {
      // Business creators can submit proof even without a memberships row.
      const business = await prisma.business.findUnique({
        where: { id: String(businessId) },
        select: { createdBy: true },
      });
      const isCreator =
        !!business?.createdBy && String(business.createdBy) === String(req.user?.id || '');

      if (!isCreator) {
        safeUnlink(filePath);
        res.status(403).json({
          success: false,
          message: 'You do not have access to submit a payment proof for this business.',
          code: 'BUSINESS_ACCESS_DENIED',
        });
        return;
      }
    }

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
    const pending = await prisma.paymentProof.findFirst({
      where: { businessId: String(businessId), status: 'PENDING' },
      select: { id: true }
    });
    if (pending) {
      safeUnlink(filePath);
      res.status(409).json({
        success: false,
        message: 'You already have a payment proof under review. Please wait for admin approval before submitting again.',
        code: 'PENDING_EXISTS'
      });
      return;
    }

    // ── Rule 5: max 3 submissions per day ────────────────────────────────────
    // (Prisma model query — the old raw tagged query bound the day-start as
    // TEXT and Postgres rejected `timestamp >= text` with 42883, so EVERY
    // submission failed with 500. Same text-date disease as P3-1/P4-5.)
    const todayCount = await prisma.paymentProof.count({
      where: { businessId: String(businessId), createdAt: { gte: todayStart() } }
    });
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
    const hashDup = await prisma.paymentProof.findFirst({
      where: { screenshotHash: fileHash },
      select: { id: true }
    });
    if (hashDup) {
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
      const refDup = await prisma.paymentProof.findFirst({
        where: { referenceNote: String(referenceNote), amount: parsedAmount, status: { not: 'REJECTED' } },
        select: { id: true }
      });
      if (refDup) {
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
    const id = `pp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    await prisma.paymentProof.create({
      data: {
        id,
        businessId: String(businessId),
        planId: String(planId),
        amount: parsedAmount,
        currency: 'PKR',
        method: String(method),
        referenceNote: referenceNote || null,
        screenshotUrl,
        screenshotHash: fileHash,
        status: 'PENDING'
      }
    });

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

    // QA A-09 follow-up: this list was readable for ANY businessId. Apply
    // the same scope rule as serveMyScreenshot — ACTIVE member or the
    // business creator; anyone else gets an empty list (no existence leak).
    const userId = String(req.user?.id || '');
    const membership = await prisma.membership.findFirst({
      where: { userId, businessId: String(businessId), status: 'ACTIVE' },
      select: { id: true },
    });
    if (!membership) {
      const business = await prisma.business.findUnique({
        where: { id: String(businessId) },
        select: { createdBy: true },
      });
      if (!business?.createdBy || String(business.createdBy) !== userId) {
        res.json({ success: true, data: [] });
        return;
      }
    }

    const proofs = await prisma.paymentProof.findMany({
      where: { businessId: String(businessId) },
      orderBy: { createdAt: 'desc' }
    });
    const planIds = [...new Set(proofs.map((p) => p.planId))];
    const plans = planIds.length
      ? await prisma.plan.findMany({ where: { id: { in: planIds } }, select: { id: true, name: true, price: true } })
      : [];
    const planById = new Map(plans.map((p) => [p.id, p]));
    const rows = proofs.map((pp) => ({
      id: pp.id, businessId: pp.businessId, planId: pp.planId, amount: pp.amount,
      currency: pp.currency, method: pp.method, referenceNote: pp.referenceNote,
      screenshotUrl: pp.screenshotUrl, status: pp.status,
      rejectionReason: pp.rejectionReason, reviewedAt: pp.reviewedAt,
      createdAt: pp.createdAt, updatedAt: pp.updatedAt,
      planName: planById.get(pp.planId)?.name ?? null,
      planPrice: planById.get(pp.planId)?.price ?? null
    }));

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

    // Prisma model query + JS enrichment (the old hand-built raw SQL bound
    // the date filters as TEXT — same 42883 failure class as submit).
    const where: any = {};
    if (status) where.status = String(status);
    if (businessId) where.businessId = String(businessId);
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(String(dateFrom));
      if (dateTo) where.createdAt.lte = new Date(String(dateTo));
    }

    const proofs = await prisma.paymentProof.findMany({ where, orderBy: { createdAt: 'desc' } });
    const bizIds = [...new Set(proofs.map((p) => p.businessId))];
    const planIds = [...new Set(proofs.map((p) => p.planId))];
    const [bizList, planList] = await Promise.all([
      bizIds.length
        ? prisma.business.findMany({ where: { id: { in: bizIds } }, select: { id: true, name: true, email: true } })
        : Promise.resolve([] as any[]),
      planIds.length
        ? prisma.plan.findMany({ where: { id: { in: planIds } }, select: { id: true, name: true, price: true } })
        : Promise.resolve([] as any[])
    ]);
    const bizById = new Map(bizList.map((b: any) => [b.id, b]));
    const planById = new Map(planList.map((p: any) => [p.id, p]));
    const rows = proofs.map((pp) => ({
      id: pp.id, businessId: pp.businessId, planId: pp.planId, amount: pp.amount,
      currency: pp.currency, method: pp.method, referenceNote: pp.referenceNote,
      screenshotUrl: pp.screenshotUrl, status: pp.status,
      rejectionReason: pp.rejectionReason, reviewedBy: pp.reviewedBy,
      reviewedAt: pp.reviewedAt, createdAt: pp.createdAt,
      businessName: bizById.get(pp.businessId)?.name ?? null,
      businessEmail: bizById.get(pp.businessId)?.email ?? null,
      planName: planById.get(pp.planId)?.name ?? null,
      planPrice: planById.get(pp.planId)?.price ?? null
    }));

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
    const proof = await prisma.paymentProof.findUnique({ where: { id: proofId } });
    if (!proof) {
      res.status(404).json({ success: false, message: 'Payment proof not found' });
      return;
    }

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
      await prisma.paymentProof.update({
        where: { id: proofId },
        data: { updatedAt: now }
      });
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
      await prisma.paymentProof.update({
        where: { id: proofId },
        data: {
          status: 'APPROVED',
          reviewedBy: req.admin!.id,
          reviewedAt: now,
          subscriptionId: subId
        }
      });
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

    // Notify business owner
    const ownerUser = await prisma.business.findUnique({ where: { id: proof.businessId }, select: { createdBy: true } });
    if (ownerUser?.createdBy) {
      createNotification({
        userId: ownerUser.createdBy,
        businessId: proof.businessId,
        type: 'billing_payment_approved',
        title: 'Payment Approved',
        body: `Your payment proof has been approved. Subscription activated.`,
        actionUrl: `/business/${proof.businessId}/subscription`,
      }).catch(() => {});
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

    const proof = await prisma.paymentProof.findUnique({
      where: { id: proofId },
      select: { id: true, status: true, businessId: true, planId: true, amount: true }
    });
    if (!proof) {
      res.status(404).json({ success: false, message: 'Payment proof not found' });
      return;
    }
    if (proof.status !== 'PENDING') {
      res.status(409).json({ success: false, message: `Proof is already ${proof.status}` });
      return;
    }

    await prisma.paymentProof.update({
      where: { id: proofId },
      data: {
        status: 'REJECTED',
        reviewedBy: req.admin!.id,
        reviewedAt: new Date(),
        rejectionReason: String(reason).trim()
      }
    });

    await logAdminAction(req.admin!.id, 'REJECT_PAYMENT_PROOF', 'PaymentProof', proofId, { reason });

    console.log(`[PaymentProof] ❌ REJECTED id=${proofId} reason="${reason}"`);

    // Send email notification to business owner with rejection reason
    try {
      const business = await prisma.business.findUnique({
        where: { id: proof.businessId },
        select: { name: true, email: true }
      });
      if (business?.email) {
        const plan = await prisma.plan.findUnique({ where: { id: proof.planId } });
        await emailService.sendPaymentProofRejectionEmail(
          business.email,
          business.name,
          business.name,
          (plan as any)?.name || 'Unknown Plan',
          proof.amount,
          String(reason).trim()
        );
      }
    } catch (emailError) {
      console.error('[PaymentProof] Failed to send rejection email:', emailError);
      // Don't fail the request if email fails
    }

    // Send SSE notification to business owner
    try {
      const plan = await prisma.plan.findUnique({ where: { id: proof.planId } });
      notifyPaymentProofStatusChange(
        proof.businessId,
        'REJECTED',
        {
          id: proofId,
          planName: (plan as any)?.name || 'Unknown Plan',
          amount: proof.amount
        },
        String(reason).trim()
      );
    } catch (sseError) {
      console.error('[PaymentProof] Failed to send SSE notification:', sseError);
      // Don't fail the request if SSE fails
    }

    // Notify business owner
    const proofBusinessId = proof?.businessId;
    if (proofBusinessId) {
      const ownerUser = await prisma.business.findUnique({ where: { id: proofBusinessId }, select: { createdBy: true } });
      if (ownerUser?.createdBy) {
        createNotification({
          userId: ownerUser.createdBy,
          businessId: proofBusinessId,
          type: 'billing_payment_rejected',
          title: 'Payment Rejected',
          body: `Your payment proof has been rejected. Please contact support.`,
          actionUrl: `/zapeera/billing`,
        }).catch(() => {});
      }
    }

    res.json({ success: true, message: 'Payment proof rejected' });
  } catch (error: any) {
    console.error('[PaymentProof] rejectPaymentProof error:', error);
    res.status(500).json({ success: false, message: error.message || 'Internal server error' });
  }
};

// ─── Screenshot serving ────────────────────────────────────────────────────────

/**
 * QA A-09: proof files are NEVER served statically. The old public static
 * mount on /uploads exposed bank-transfer
 * screenshots (financial PII) to anyone who could guess a filename. Files
 * are now served only through these authenticated handlers:
 *
 *   GET /api/payments/manual/screenshot/:filename      platform admin only
 *   GET /api/payments/manual/my/screenshot/:filename   business member/creator
 *
 * Downloads are forced as attachments with nosniff so a stored file can
 * never be rendered inline as active content on the app origin.
 */
function sendProofFile(res: Response, filePath: string): void {
  res.setHeader('Content-Disposition', 'attachment');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(filePath);
}

export const serveScreenshot = (req: Request, res: Response): void => {
  const { filename } = req.params;
  // Prevent path traversal
  const safe = path.basename(filename);
  const filePath = path.join(UPLOAD_DIR, safe);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ success: false, message: 'File not found' });
    return;
  }
  sendProofFile(res, filePath);
};

/**
 * Business-facing screenshot download: the caller must be an ACTIVE member
 * of the business that owns the proof (or its creator) — the same access
 * rule submitPaymentProof enforces. Unknown filenames return 404 so the
 * endpoint cannot be used to probe for other tenants' files.
 */
export const serveMyScreenshot = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const safe = path.basename(req.params.filename);
    const screenshotUrl = `payment-proofs/${safe}`;
    const prisma = await getPrisma();

    const proof = await prisma.paymentProof.findFirst({
      where: { screenshotUrl },
      select: { businessId: true }
    });
    if (!proof) {
      res.status(404).json({ success: false, message: 'File not found' });
      return;
    }
    const businessId = String(proof.businessId);
    const userId = String(req.user?.id || '');

    const membership = await prisma.membership.findFirst({
      where: { userId, businessId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!membership) {
      const business = await prisma.business.findUnique({
        where: { id: businessId },
        select: { createdBy: true },
      });
      if (!business?.createdBy || String(business.createdBy) !== userId) {
        res.status(404).json({ success: false, message: 'File not found' });
        return;
      }
    }

    const filePath = path.join(UPLOAD_DIR, safe);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ success: false, message: 'File not found' });
      return;
    }
    sendProofFile(res, filePath);
  } catch (error: any) {
    console.error('[PaymentProof] serveMyScreenshot error:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
