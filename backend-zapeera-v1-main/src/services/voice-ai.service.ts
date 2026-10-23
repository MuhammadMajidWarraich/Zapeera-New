/**
 * Voice Assistant AI layer — provider proxy + usage accounting.
 *
 * Thin server-side proxy: the provider API key lives ONLY in the server
 * environment (VOICE_AI_*) and never reaches the frontend bundle. The
 * frontend rule parser stays the first pass; this service is called
 * only for utterances the parser returned "unknown" for.
 *
 * Flow for one AI parse:
 *   1. Resolve providers from env (primary + optional fallback). None
 *      configured → status 'unconfigured' (frontend degrades to the
 *      parser with an honest note). No usage is recorded: no AI call
 *      was made.
 *   2. Quota gate BEFORE any provider call: the business's current
 *      plan limit (settings-backed, backoffice-editable) vs its usage
 *      this Asia/Karachi calendar month, plus the platform-wide daily
 *      token cap. Denied → distinct status, provider NEVER called, no
 *      usage recorded.
 *   3. Call the primary provider (OpenAI-compatible chat completions);
 *      on ANY failure (429, HTTP error, network, unparseable output)
 *      try the fallback once. The reply is validated against the strict
 *      action whitelist in voice-ai-core — the model proposes, the app
 *      disposes; write actions still pass the frontend confirm card.
 *   4. Record usage for the command exactly once, from the SERVING
 *      provider's usage block when present; otherwise estimated tokens
 *      with estimatedCalls incremented and lastProvider marking the
 *      source. Provider rejections (429/5xx) record nothing: the
 *      provider consumed no tokens and produced no action.
 *
 * The server remains the source of truth: stock, totals, permissions
 * and module/type gates are all enforced downstream exactly as for
 * parser-produced intents.
 */

import {
  AiEnvelope,
  buildAiSystemPrompt,
  buildAiUserPrompt,
  decideAiGate,
  estimateTokens,
  extractJsonObject,
  extractProviderUsage,
  pktDayKey,
  pktPeriodKey,
  validateAiEnvelope
} from './voice-ai-core';
import {
  VoiceAiConfig,
  getVoiceAiConfig,
  quotaForPlan,
  TOKENS_PER_COMMAND_ESTIMATE
} from '../utils/voice-ai-config.util';

export type AiParseStatus =
  | 'ok'
  | 'unconfigured'
  | 'quota_exceeded'
  | 'daily_cap'
  | 'rate_limited'
  | 'error';

export interface AiUsageSummary {
  period: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  tokensUsed: number;
  tokenLimit: number;
  approxCommandLimit: number;
  percentUsed: number;
}

export interface AiParseResult {
  status: AiParseStatus;
  envelope?: AiEnvelope;
  provider?: string;
  usage?: AiUsageSummary;
}

// ─── Providers (all OpenAI-compatible chat-completions) ──────────────

export interface VoiceAiProviderConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Whether the provider reliably honours response_format json_object. */
  jsonMode: boolean;
}

const PROVIDER_DEFAULTS: Record<
  string,
  { baseUrl: string | null; model: string; jsonMode: boolean }
> = {
  // Recommended primary: free developer tier, no card, contractually
  // never trains on customer data. 8B default = the pool economics pick
  // (500k tokens/day, 14,400 requests/day on the free tier); switch
  // VOICE_AI_MODEL to llama-3.3-70b-versatile for higher parse quality
  // at ~5x the token-pool cost.
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant', jsonMode: true },
  // Recommended fallback: Workers AI free allocation (10k Neurons/day),
  // no training on customer content, zero retention. Needs an account
  // id (VOICE_AI_ACCOUNT_ID / VOICE_AI_FALLBACK_ACCOUNT_ID).
  cloudflare: { baseUrl: null, model: '@cf/meta/llama-3.1-8b-instruct-fp8-fast', jsonMode: false },
  // Supported but NOT recommended as primary: the AI Studio free tier
  // may use submitted content to improve Google's products.
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', jsonMode: true },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'meta-llama/llama-3.3-70b-instruct:free', jsonMode: true }
};

function providerFromEnv(prefix: '' | 'FALLBACK_'): VoiceAiProviderConfig | null {
  const rawName = process.env[`VOICE_AI_${prefix}PROVIDER`];
  const name = (rawName || (prefix === '' ? 'groq' : '')).toLowerCase().trim();
  const apiKey = process.env[`VOICE_AI_${prefix}API_KEY`];
  if (!name || !apiKey) return null;
  const def = PROVIDER_DEFAULTS[name];
  if (!def) return null;
  let baseUrl = def.baseUrl;
  if (name === 'cloudflare') {
    const accountId = process.env[`VOICE_AI_${prefix}ACCOUNT_ID`];
    if (!accountId) return null;
    baseUrl = `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1`;
  }
  if (!baseUrl) return null;
  const model = process.env[`VOICE_AI_${prefix}MODEL`] || def.model;
  return { name, baseUrl, apiKey, model, jsonMode: def.jsonMode };
}

export function resolveVoiceAiProviders(): {
  primary: VoiceAiProviderConfig | null;
  fallback: VoiceAiProviderConfig | null;
} {
  return { primary: providerFromEnv(''), fallback: providerFromEnv('FALLBACK_') };
}

// ─── Provider call ───────────────────────────────────────────────────

type FetchFn = (url: string, init: any) => Promise<any>;

interface ProviderSuccess {
  envelope: AiEnvelope;
  tokensIn: number;
  tokensOut: number;
  estimated: boolean;
  rawContent: string;
}

class ProviderFailure extends Error {
  code: 'RATE_LIMITED' | 'PROVIDER_ERROR' | 'INVALID_OUTPUT';
  /** Raw model text when the provider answered but unparseably. */
  rawContent?: string;
  constructor(code: ProviderFailure['code'], message: string) {
    super(message);
    this.code = code;
  }
}

async function callProvider(
  provider: VoiceAiProviderConfig,
  systemPrompt: string,
  userPrompt: string,
  fetchFn: FetchFn
): Promise<ProviderSuccess> {
  const signal =
    typeof (AbortSignal as any).timeout === 'function'
      ? (AbortSignal as any).timeout(12_000)
      : undefined;

  let res: any;
  try {
    res = await fetchFn(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.1,
        max_tokens: 500,
        ...(provider.jsonMode ? { response_format: { type: 'json_object' } } : {})
      }),
      ...(signal ? { signal } : {})
    });
  } catch (e: any) {
    throw new ProviderFailure('PROVIDER_ERROR', e?.message || 'network error');
  }

  if (res.status === 429) {
    throw new ProviderFailure('RATE_LIMITED', `provider ${provider.name} rate limited`);
  }
  if (!res.ok) {
    throw new ProviderFailure('PROVIDER_ERROR', `provider ${provider.name} HTTP ${res.status}`);
  }

  const json = await res.json().catch(() => null);
  const content = json?.choices?.[0]?.message?.content;
  const parsed = typeof content === 'string' ? extractJsonObject(content) : null;
  const envelope = parsed ? validateAiEnvelope(parsed) : null;
  if (!envelope) {
    const failure = new ProviderFailure(
      'INVALID_OUTPUT',
      `provider ${provider.name} returned unparseable output`
    );
    failure.rawContent = typeof content === 'string' ? content : '';
    throw failure;
  }

  const usage = extractProviderUsage(json);
  if (usage) {
    return { envelope, tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, estimated: false, rawContent: content };
  }
  // No usage block (some free endpoints omit it): estimate and mark it.
  return {
    envelope,
    tokensIn: estimateTokens(systemPrompt + userPrompt),
    tokensOut: estimateTokens(content),
    estimated: true,
    rawContent: content
  };
}

// ─── Usage accounting ────────────────────────────────────────────────

interface UsageRow {
  calls: number;
  tokensIn: number;
  tokensOut: number;
}

const ZERO_ROW: UsageRow = { calls: 0, tokensIn: 0, tokensOut: 0 };

async function getMonthUsage(prisma: any, businessId: string, period: string): Promise<UsageRow> {
  try {
    const row = await prisma.businessAiUsage.findUnique({
      where: { business_period: { businessId, period } }
    });
    if (!row) return { ...ZERO_ROW };
    return { calls: row.calls || 0, tokensIn: row.tokensIn || 0, tokensOut: row.tokensOut || 0 };
  } catch {
    return { ...ZERO_ROW };
  }
}

async function getPlatformDayTokens(prisma: any, day: string): Promise<number> {
  try {
    const agg = await prisma.businessAiDailyUsage.aggregate({
      where: { day },
      _sum: { tokensIn: true, tokensOut: true }
    });
    return (agg?._sum?.tokensIn || 0) + (agg?._sum?.tokensOut || 0);
  } catch {
    return 0;
  }
}

async function recordUsage(
  prisma: any,
  businessId: string,
  tokens: { tokensIn: number; tokensOut: number; estimated: boolean },
  providerName: string
): Promise<void> {
  const now = new Date();
  const period = pktPeriodKey(now);
  const day = pktDayKey(now);
  const create = {
    calls: 1,
    tokensIn: tokens.tokensIn,
    tokensOut: tokens.tokensOut,
    estimatedCalls: tokens.estimated ? 1 : 0,
    lastProvider: providerName
  };
  const update = {
    calls: { increment: 1 },
    tokensIn: { increment: tokens.tokensIn },
    tokensOut: { increment: tokens.tokensOut },
    ...(tokens.estimated ? { estimatedCalls: { increment: 1 } } : {}),
    lastProvider: providerName
  };
  await prisma.businessAiUsage.upsert({
    where: { business_period: { businessId, period } },
    create: { businessId, period, ...create },
    update
  });
  await prisma.businessAiDailyUsage.upsert({
    where: { business_day: { businessId, day } },
    create: { businessId, day, ...create },
    update
  });
}

function makeSummary(row: UsageRow, tokenLimit: number, period: string): AiUsageSummary {
  const tokensUsed = row.tokensIn + row.tokensOut;
  return {
    period,
    calls: row.calls,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    tokensUsed,
    tokenLimit,
    approxCommandLimit: Math.floor(tokenLimit / TOKENS_PER_COMMAND_ESTIMATE),
    percentUsed: tokenLimit > 0 ? Math.min(100, Math.round((tokensUsed / tokenLimit) * 1000) / 10) : 100
  };
}

async function resolvePlanId(prisma: any, businessId: string): Promise<string | null> {
  try {
    const sub = await prisma.businessSubscription.findUnique({
      where: { businessId },
      select: { planId: true }
    });
    return sub?.planId || null;
  } catch {
    return null;
  }
}

// ─── Orchestration ───────────────────────────────────────────────────

export interface VoiceAiDeps {
  prisma: any;
  fetchFn?: FetchFn;
  providers?: { primary: VoiceAiProviderConfig | null; fallback: VoiceAiProviderConfig | null };
  config?: VoiceAiConfig;
}

export async function parseWithAi(
  deps: VoiceAiDeps,
  input: { businessId: string; businessType?: string | null; utterance: string }
): Promise<AiParseResult> {
  const fetchFn: FetchFn = deps.fetchFn || ((url, init) => fetch(url, init));
  const providers = deps.providers || resolveVoiceAiProviders();
  if (!providers.primary) {
    return { status: 'unconfigured' };
  }

  const prisma = deps.prisma;
  const config = deps.config || (await getVoiceAiConfig(prisma));
  const planId = await resolvePlanId(prisma, input.businessId);
  const tokenLimit = quotaForPlan(config, planId);

  const now = new Date();
  const period = pktPeriodKey(now);
  const day = pktDayKey(now);
  const monthRow = await getMonthUsage(prisma, input.businessId, period);
  const summaryBefore = makeSummary(monthRow, tokenLimit, period);

  // Quota gate — BEFORE any provider call.
  const gate = decideAiGate({
    monthTokensUsed: monthRow.tokensIn + monthRow.tokensOut,
    monthTokenLimit: tokenLimit,
    platformDayTokensUsed: await getPlatformDayTokens(prisma, day),
    platformDayTokenCap: config.dailyTokenCap
  });
  if (!gate.allow) {
    return {
      status: gate.reason === 'quota_exceeded' ? 'quota_exceeded' : 'daily_cap',
      usage: summaryBefore
    };
  }

  const systemPrompt = buildAiSystemPrompt(input.businessType);
  const userPrompt = buildAiUserPrompt(input.utterance, input.businessType);

  const attempts: VoiceAiProviderConfig[] = [providers.primary];
  if (providers.fallback) attempts.push(providers.fallback);

  let lastFailure: ProviderFailure | null = null;
  for (const provider of attempts) {
    try {
      const success = await callProvider(provider, systemPrompt, userPrompt, fetchFn);
      // Record exactly once, from the serving provider. Recording must
      // never break the answer — swallow accounting errors.
      try {
        await recordUsage(
          prisma,
          input.businessId,
          { tokensIn: success.tokensIn, tokensOut: success.tokensOut, estimated: success.estimated },
          provider.name
        );
      } catch (e) {
        console.error('[voice-ai] usage recording failed', e);
      }
      const after: UsageRow = {
        calls: monthRow.calls + 1,
        tokensIn: monthRow.tokensIn + success.tokensIn,
        tokensOut: monthRow.tokensOut + success.tokensOut
      };
      return {
        status: 'ok',
        envelope: success.envelope,
        provider: provider.name,
        usage: makeSummary(after, tokenLimit, period)
      };
    } catch (e: any) {
      lastFailure =
        e instanceof ProviderFailure ? e : new ProviderFailure('PROVIDER_ERROR', e?.message || 'unknown');
      // An INVALID_OUTPUT reply still consumed tokens at the provider:
      // account for it (estimated) so a misbehaving model cannot drain
      // the shared pool untracked. Transport/HTTP rejections consumed
      // nothing and are not recorded.
      if (lastFailure.code === 'INVALID_OUTPUT') {
        try {
          await recordUsage(
            prisma,
            input.businessId,
            {
              tokensIn: estimateTokens(systemPrompt + userPrompt),
              tokensOut: estimateTokens(lastFailure.rawContent || ''),
              estimated: true
            },
            provider.name
          );
        } catch {
          // accounting is best-effort
        }
      }
    }
  }

  return {
    status: lastFailure?.code === 'RATE_LIMITED' ? 'rate_limited' : 'error',
    usage: summaryBefore
  };
}

/** Tenant-facing usage summary (voice panel meter / settings). */
export async function getAiUsageSummary(
  prisma: any,
  businessId: string
): Promise<{
  configured: boolean;
  planId: string | null;
  period: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  tokensUsed: number;
  tokenLimit: number;
  approxCommandLimit: number;
  approxCommandsUsed: number;
  percentUsed: number;
}> {
  const config = await getVoiceAiConfig(prisma);
  const planId = await resolvePlanId(prisma, businessId);
  const tokenLimit = quotaForPlan(config, planId);
  const period = pktPeriodKey();
  const row = await getMonthUsage(prisma, businessId, period);
  const summary = makeSummary(row, tokenLimit, period);
  return {
    configured: !!resolveVoiceAiProviders().primary,
    planId,
    period,
    calls: summary.calls,
    tokensIn: summary.tokensIn,
    tokensOut: summary.tokensOut,
    tokensUsed: summary.tokensUsed,
    tokenLimit: summary.tokenLimit,
    approxCommandLimit: summary.approxCommandLimit,
    approxCommandsUsed: summary.calls,
    percentUsed: summary.percentUsed
  };
}
