import { Response } from 'express';
import Joi from 'joi';
import { getPrisma } from '../utils/db.util';
import { getVoiceAiConfig, setVoiceAiConfig, quotaForPlan } from '../utils/voice-ai-config.util';
import { pktPeriodKey } from '../services/voice-ai-core';

// ─── Voice Assistant AI layer (backoffice) ───────────────────────────
//   GET /api/backoffice/voice-ai/config   plan token quotas + daily cap
//   PUT /api/backoffice/voice-ai/config   update quotas / cap
//   GET /api/backoffice/voice-ai/usage    per-business usage this month
//
// Quotas live in the Settings table under the 'global_voice_ai' owner
// (voice-ai-config.util), lazily defaulted — the same pattern as the
// affiliate program config. Usage rows come from business_ai_usage,
// written by the tenant proxy (voice-ai.service) on every AI call.

const configSchema = Joi.object({
  planQuotas: Joi.object()
    .pattern(Joi.string().max(64), Joi.number().integer().min(0).max(100_000_000))
    .optional(),
  dailyTokenCap: Joi.number().integer().min(0).max(10_000_000).optional()
}).min(1);

export const getVoiceAiConfigAdmin = async (_req: any, res: Response) => {
  try {
    const prisma: any = await getPrisma();
    const config = await getVoiceAiConfig(prisma);
    const plans = await prisma.plan.findMany({
      select: { id: true, name: true, price: true },
      orderBy: { price: 'asc' }
    });
    return res.json({
      success: true,
      data: {
        dailyTokenCap: config.dailyTokenCap,
        plans: plans.map((p: any) => ({
          id: p.id,
          name: p.name,
          monthlyTokens: quotaForPlan(config, p.id),
          customised: typeof config.planQuotas[p.id] === 'number'
        }))
      }
    });
  } catch (error) {
    console.error('[voice-ai] backoffice config read failed', error);
    return res.status(500).json({ success: false, message: 'Failed to load voice AI configuration' });
  }
};

export const updateVoiceAiConfigAdmin = async (req: any, res: Response) => {
  try {
    const { error, value } = configSchema.validate(req.body || {});
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0]?.message || 'Invalid configuration' });
    }
    const prisma: any = await getPrisma();
    const config = await setVoiceAiConfig(prisma, value);
    return res.json({ success: true, message: 'Voice AI configuration updated', data: config });
  } catch (error) {
    console.error('[voice-ai] backoffice config update failed', error);
    return res.status(500).json({ success: false, message: 'Failed to update voice AI configuration' });
  }
};

export const listVoiceAiUsageAdmin = async (req: any, res: Response) => {
  try {
    const periodRaw = typeof req.query?.period === 'string' ? req.query.period : '';
    const period = /^\d{4}-\d{2}$/.test(periodRaw) ? periodRaw : pktPeriodKey();
    const prisma: any = await getPrisma();
    const config = await getVoiceAiConfig(prisma);

    const rows = await prisma.businessAiUsage.findMany({
      where: { period },
      orderBy: [{ tokensIn: 'desc' }]
    });
    if (!rows.length) {
      return res.json({ success: true, data: { period, businesses: [], totals: { calls: 0, tokensUsed: 0 } } });
    }

    const businessIds = rows.map((r: any) => r.businessId);
    const businesses = await prisma.business.findMany({
      where: { id: { in: businessIds } },
      select: { id: true, name: true }
    });
    const subs = await prisma.businessSubscription.findMany({
      where: { businessId: { in: businessIds } },
      select: { businessId: true, planId: true }
    });
    const planIds = [...new Set(subs.map((s: any) => s.planId))];
    const plans = planIds.length
      ? await prisma.plan.findMany({ where: { id: { in: planIds } }, select: { id: true, name: true } })
      : [];
    const nameByBusiness = new Map<string, string>(businesses.map((b: any) => [b.id, b.name]));
    const planByBusiness = new Map<string, string>(subs.map((s: any) => [s.businessId, s.planId]));
    const nameByPlan = new Map<string, string>(plans.map((p: any) => [p.id, p.name]));

    const list = rows.map((r: any) => {
      const planId = planByBusiness.get(r.businessId) || null;
      const tokenLimit = quotaForPlan(config, planId);
      const tokensUsed = (r.tokensIn || 0) + (r.tokensOut || 0);
      return {
        businessId: r.businessId,
        businessName: nameByBusiness.get(r.businessId) || r.businessId,
        planId,
        planName: planId ? nameByPlan.get(planId) || planId : '—',
        calls: r.calls || 0,
        tokensIn: r.tokensIn || 0,
        tokensOut: r.tokensOut || 0,
        tokensUsed,
        tokenLimit,
        percentUsed: tokenLimit > 0 ? Math.min(100, Math.round((tokensUsed / tokenLimit) * 1000) / 10) : 100,
        estimatedCalls: r.estimatedCalls || 0,
        lastProvider: r.lastProvider || null
      };
    });
    list.sort((a: any, b: any) => b.tokensUsed - a.tokensUsed);

    return res.json({
      success: true,
      data: {
        period,
        businesses: list,
        totals: {
          calls: list.reduce((sum: number, b: any) => sum + b.calls, 0),
          tokensUsed: list.reduce((sum: number, b: any) => sum + b.tokensUsed, 0)
        }
      }
    });
  } catch (error) {
    console.error('[voice-ai] backoffice usage list failed', error);
    return res.status(500).json({ success: false, message: 'Failed to load voice AI usage' });
  }
};
