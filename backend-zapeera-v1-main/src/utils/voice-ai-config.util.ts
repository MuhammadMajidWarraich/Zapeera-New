/**
 * Voice Assistant AI layer — plan quotas + platform safety cap.
 *
 * Stored in the existing Settings key-value table under a reserved
 * owner, following the platform precedent set by the affiliate program
 * (affiliate-config.util: createdBy 'global_affiliate') and global
 * pricing (createdBy 'global_pricing'). Rows are seeded lazily: when a
 * key is absent the documented default below applies, and the
 * backoffice voice-AI endpoints (GET/PUT /api/backoffice/voice-ai/config)
 * upsert the rows — that is what makes the values backoffice-editable.
 *
 *   PLAN_TOKEN_QUOTAS — JSON map { planId: monthlyTokenLimit }. The
 *     limit is stored in TOKENS (the cost truth: every provider call
 *     consumes prompt + completion tokens against the shared free-tier
 *     pool). Calls are tracked alongside for display.
 *     Defaults: Trial 100k, Starter 300k, Growth 900k, Scale 3M tokens
 *     per month ≈ 75 / 225 / 675 / 2,250 AI commands at ~1,350 tokens
 *     per command (system prompt + utterance + structured reply).
 *   DAILY_TOKEN_CAP — platform-wide tokens per day (Asia/Karachi)
 *     across ALL businesses, so one tenant cannot drain the shared
 *     free-tier daily pool. Default 450,000 (≈ the primary free model's
 *     500k tokens/day with headroom).
 */

export const VOICE_AI_SETTINGS_OWNER = 'global_voice_ai';
export const VOICE_AI_PLAN_QUOTAS_KEY = 'PLAN_TOKEN_QUOTAS';
export const VOICE_AI_DAILY_CAP_KEY = 'DAILY_TOKEN_CAP';

export const DEFAULT_PLAN_TOKEN_QUOTAS: Record<string, number> = {
  'single-trial': 100_000,
  'single-starter': 300_000,
  'single-growth': 900_000,
  'single-scale': 3_000_000
};

/** A plan with no configured quota gets the conservative Trial floor. */
export const FALLBACK_PLAN_TOKEN_QUOTA = 100_000;

export const DEFAULT_DAILY_TOKEN_CAP = 450_000;

/** Display estimate: one AI command ≈ this many tokens end to end. */
export const TOKENS_PER_COMMAND_ESTIMATE = 1350;

const MAX_QUOTA_VALUE = 100_000_000;
const MAX_DAILY_CAP = 10_000_000;

export interface VoiceAiConfig {
  planQuotas: Record<string, number>;
  dailyTokenCap: number;
}

function cleanQuotaValue(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const v = Math.floor(n);
  return v >= 0 && v <= MAX_QUOTA_VALUE ? v : null;
}

function parseQuotas(raw: string | null | undefined): Record<string, number> {
  if (!raw) return { ...DEFAULT_PLAN_TOKEN_QUOTAS };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...DEFAULT_PLAN_TOKEN_QUOTAS };
    }
    const out: Record<string, number> = { ...DEFAULT_PLAN_TOKEN_QUOTAS };
    for (const [planId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const v = cleanQuotaValue(value);
      if (planId && planId.length <= 64 && v !== null) out[planId] = v;
    }
    return out;
  } catch {
    return { ...DEFAULT_PLAN_TOKEN_QUOTAS };
  }
}

function parseDailyCap(raw: string | null | undefined): number {
  if (raw == null) return DEFAULT_DAILY_TOKEN_CAP;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_DAILY_TOKEN_CAP;
  const v = Math.floor(n);
  return v >= 0 && v <= MAX_DAILY_CAP ? v : DEFAULT_DAILY_TOKEN_CAP;
}

/** The monthly token limit for a plan (fallback floor when unmapped). */
export function quotaForPlan(config: VoiceAiConfig, planId: string | null | undefined): number {
  if (planId && typeof config.planQuotas[planId] === 'number') {
    return config.planQuotas[planId];
  }
  return FALLBACK_PLAN_TOKEN_QUOTA;
}

export async function getVoiceAiConfig(prisma: any): Promise<VoiceAiConfig> {
  try {
    const rows = await prisma.settings.findMany({
      where: {
        createdBy: VOICE_AI_SETTINGS_OWNER,
        key: { in: [VOICE_AI_PLAN_QUOTAS_KEY, VOICE_AI_DAILY_CAP_KEY] }
      }
    });
    const byKey = new Map<string, string>(rows.map((r: any) => [r.key, r.value]));
    return {
      planQuotas: parseQuotas(byKey.get(VOICE_AI_PLAN_QUOTAS_KEY)),
      dailyTokenCap: parseDailyCap(byKey.get(VOICE_AI_DAILY_CAP_KEY))
    };
  } catch {
    // Config must never break the voice path — fall back to defaults.
    return {
      planQuotas: { ...DEFAULT_PLAN_TOKEN_QUOTAS },
      dailyTokenCap: DEFAULT_DAILY_TOKEN_CAP
    };
  }
}

export async function setVoiceAiConfig(
  prisma: any,
  patch: { planQuotas?: Record<string, unknown>; dailyTokenCap?: unknown }
): Promise<VoiceAiConfig> {
  const current = await getVoiceAiConfig(prisma);

  if (patch.planQuotas && typeof patch.planQuotas === 'object' && !Array.isArray(patch.planQuotas)) {
    const merged: Record<string, number> = { ...current.planQuotas };
    for (const [planId, value] of Object.entries(patch.planQuotas)) {
      const v = cleanQuotaValue(value);
      if (planId && planId.length <= 64 && v !== null) merged[planId] = v;
    }
    await prisma.settings.upsert({
      where: { createdBy_key: { createdBy: VOICE_AI_SETTINGS_OWNER, key: VOICE_AI_PLAN_QUOTAS_KEY } },
      create: {
        createdBy: VOICE_AI_SETTINGS_OWNER,
        key: VOICE_AI_PLAN_QUOTAS_KEY,
        value: JSON.stringify(merged),
        description: 'Voice AI: monthly token quota per subscription planId (JSON map)'
      },
      update: {
        value: JSON.stringify(merged),
        description: 'Voice AI: monthly token quota per subscription planId (JSON map)'
      }
    });
  }

  const cap = cleanQuotaValue(patch.dailyTokenCap);
  if (patch.dailyTokenCap !== undefined && cap !== null && cap <= MAX_DAILY_CAP) {
    await prisma.settings.upsert({
      where: { createdBy_key: { createdBy: VOICE_AI_SETTINGS_OWNER, key: VOICE_AI_DAILY_CAP_KEY } },
      create: {
        createdBy: VOICE_AI_SETTINGS_OWNER,
        key: VOICE_AI_DAILY_CAP_KEY,
        value: String(cap),
        description: 'Voice AI: platform-wide token cap per day (Asia/Karachi) across all businesses'
      },
      update: {
        value: String(cap),
        description: 'Voice AI: platform-wide token cap per day (Asia/Karachi) across all businesses'
      }
    });
  }

  return getVoiceAiConfig(prisma);
}
