import { Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { AuthRequest } from '../middleware/auth.middleware';
import { getAiUsageSummary, parseWithAi } from '../services/voice-ai.service';

// ─── Voice Assistant AI layer (tenant) ───────────────────────────────
// POST /api/voice/ai-parse — thin proxy for utterances the frontend
// rule parser could not handle. The provider key never leaves the
// server. Every non-action outcome (unconfigured / quota / provider
// failure) is a SUCCESS response with a distinct status so the client
// can degrade gracefully to parser-only behaviour.
// GET  /api/voice/ai-usage — the caller's own business usage this
// month (Asia/Karachi) vs its plan quota, for the panel meter.

function resolveBusinessId(req: AuthRequest): string | null {
  return (
    (req as any).membership?.business_id ||
    (req as any).business_id ||
    (req.headers['x-business-id'] as string) ||
    (req.headers['x-company-id'] as string) ||
    null
  );
}

export const aiParse = async (req: AuthRequest, res: Response) => {
  try {
    const utterance = typeof req.body?.utterance === 'string' ? req.body.utterance.trim() : '';
    if (!utterance || utterance.length > 500) {
      return res.status(400).json({ success: false, message: 'A short voice command (max 500 characters) is required.' });
    }
    const businessId = resolveBusinessId(req);
    if (!businessId) {
      return res.status(400).json({ success: false, message: 'Business context is required.' });
    }
    const prisma: any = await getPrisma();
    // Business type comes from the DB, never from the client payload —
    // it steers the prompt's module context (e.g. no prescription-style
    // actions outside a pharmacy).
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { businessType: true }
    });
    const result = await parseWithAi(
      { prisma },
      { businessId, businessType: business?.businessType || null, utterance }
    );
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('[voice-ai] aiParse failed', error);
    return res.status(500).json({ success: false, message: 'Voice AI request failed' });
  }
};

export const aiUsage = async (req: AuthRequest, res: Response) => {
  try {
    const businessId = resolveBusinessId(req);
    if (!businessId) {
      return res.status(400).json({ success: false, message: 'Business context is required.' });
    }
    const prisma: any = await getPrisma();
    const summary = await getAiUsageSummary(prisma, businessId);
    return res.json({ success: true, data: summary });
  } catch (error) {
    console.error('[voice-ai] aiUsage failed', error);
    return res.status(500).json({ success: false, message: 'Voice AI usage request failed' });
  }
};
