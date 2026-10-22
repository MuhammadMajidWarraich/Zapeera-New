// Self-check for the Voice Assistant AI layer.
// Run: npx ts-node --transpile-only scripts/voice-ai-selfcheck.ts
// Exits non-zero on the first failed invariant group.
//
// No provider key and no database are needed: the service is exercised
// with an in-memory fake Prisma and a stubbed fetch, which is exactly
// what the production wiring injects (real Prisma + global fetch).
//
// Cases:
//  1. PKT period/day keying across the UTC boundary (month rollover).
//  2. Envelope validation — whitelist, caps, write-reduction of mixed
//     action lists, the "category to multiple" clarify passthrough.
//  3. Quota gate decisions (plan limit, platform daily cap).
//  4. Orchestration with a mocked provider:
//     a. unconfigured → 'unconfigured', provider never called
//     b. quota available → AI action flows; usage increments from the
//        provider's usage fields (month + day rows, source marked)
//     c. quota exhausted → 'quota_exceeded', provider NOT called
//     d. plan upgrade mid-month → same month usage, new limit allows
//     e. primary 429 → fallback serves; usage recorded once, source =
//        fallback provider
//     f. no usage block in response → estimated tokens, estimatedCalls
//     g. platform daily cap reached → 'daily_cap', provider NOT called
//     h. unparseable output from both providers → 'error', estimated
//        usage still recorded (pool cannot be drained untracked)

import {
  pktPeriodKey,
  pktDayKey,
  validateAiEnvelope,
  validateAiIntent,
  decideAiGate,
  estimateTokens
} from '../src/services/voice-ai-core';
import { parseWithAi, VoiceAiProviderConfig } from '../src/services/voice-ai.service';
import {
  DEFAULT_PLAN_TOKEN_QUOTAS,
  DEFAULT_DAILY_TOKEN_CAP,
  VoiceAiConfig
} from '../src/utils/voice-ai-config.util';

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`✓ ${name}`);
  } else {
    failures++;
    console.error(`✗ ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`);
  }
}

// ─── 1. PKT keying ───────────────────────────────────────────────────
// 2026-10-31 20:30 UTC = 2026-11-01 01:30 PKT → November period.
check('period: Oct 31 20:30Z is November in PKT', pktPeriodKey(new Date('2026-10-31T20:30:00Z')) === '2026-11');
check('day: Oct 31 20:30Z is Nov 1 in PKT', pktDayKey(new Date('2026-10-31T20:30:00Z')) === '2026-11-01');
// 2026-10-31 18:59 UTC = 2026-10-31 23:59 PKT → still October.
check('period: Oct 31 18:59Z is still October in PKT', pktPeriodKey(new Date('2026-10-31T18:59:00Z')) === '2026-10');
check('day: Oct 31 18:59Z is Oct 31 in PKT', pktDayKey(new Date('2026-10-31T18:59:00Z')) === '2026-10-31');

// ─── 2. Envelope validation ──────────────────────────────────────────
const sale = validateAiEnvelope({
  kind: 'intent',
  intent: { type: 'create_sale', productQuery: 'panadol', quantity: 2 }
});
check('valid sale intent passes', sale?.kind === 'intent' && sale.intent.type === 'create_sale');

const clarify = validateAiEnvelope({
  kind: 'clarify',
  message: 'Ek product ki sirf ek hi category ho sakti hai.'
});
check('category clarify passes through untouched', clarify?.kind === 'clarify');

check('unknown action type rejected', validateAiIntent({ type: 'delete_everything' }) === null);
check('confirm cannot be proposed by AI', validateAiIntent({ type: 'confirm' }) === null);
check(
  'absurd quantity rejected',
  validateAiIntent({ type: 'create_sale', productQuery: 'panadol', quantity: 999999 }) === null
);
check(
  'bad navigate target rejected',
  validateAiIntent({ type: 'navigate', target: 'settings' }) === null
);
check(
  'overlong product name rejected',
  validateAiIntent({ type: 'add_product', name: 'x'.repeat(200) }) === null
);

const mixed = validateAiEnvelope({
  kind: 'actions',
  intents: [
    { type: 'today_report' },
    { type: 'create_sale', productQuery: 'panadol', quantity: 1 },
    { type: 'low_stock' }
  ]
});
check(
  'mixed read+write list reduces to the single write (confirm-first)',
  mixed?.kind === 'intent' && mixed.intent.type === 'create_sale',
  mixed
);

const reads = validateAiEnvelope({
  kind: 'actions',
  intents: [{ type: 'today_report' }, { type: 'low_stock' }, { type: 'expiring' }, { type: 'today_report' }]
});
check('read-only chain capped at 3', reads?.kind === 'actions' && reads.intents.length === 3, reads);

// ─── 3. Gate decisions ───────────────────────────────────────────────
check(
  'gate allows under both limits',
  decideAiGate({ monthTokensUsed: 500, monthTokenLimit: 1000, platformDayTokensUsed: 10, platformDayTokenCap: 100 }).allow
);
check(
  'gate denies at plan limit',
  !decideAiGate({ monthTokensUsed: 1000, monthTokenLimit: 1000, platformDayTokensUsed: 0, platformDayTokenCap: 100 }).allow
);
const capDecision = decideAiGate({
  monthTokensUsed: 0,
  monthTokenLimit: 1000,
  platformDayTokensUsed: 100,
  platformDayTokenCap: 100
});
check('gate denies at platform daily cap', !capDecision.allow && capDecision.reason === 'daily_cap');

// ─── 4. Orchestration with fakes ─────────────────────────────────────

function makeFakePrisma() {
  const settings = new Map<string, string>();
  const subs = new Map<string, string>();
  const month = new Map<string, any>();
  const day = new Map<string, any>();
  const applyUpdate = (row: any, update: any) => {
    for (const [k, v] of Object.entries(update)) {
      if (v && typeof v === 'object' && 'increment' in (v as any)) row[k] = (row[k] || 0) + (v as any).increment;
      else row[k] = v;
    }
  };
  const prisma: any = {
    settings: {
      findMany: async ({ where }: any) =>
        [...settings.entries()]
          .filter(([k]) => k.startsWith(`${where.createdBy}|`) && where.key.in.includes(k.split('|')[1]))
          .map(([k, value]) => ({ key: k.split('|')[1], value })),
      upsert: async ({ where, create, update }: any) => {
        const k = `${where.createdBy_key.createdBy}|${where.createdBy_key.key}`;
        settings.set(k, settings.has(k) ? update.value : create.value);
        return {};
      }
    },
    businessSubscription: {
      findUnique: async ({ where }: any) =>
        subs.has(where.businessId) ? { planId: subs.get(where.businessId) } : null
    },
    businessAiUsage: {
      findUnique: async ({ where }: any) =>
        month.get(`${where.businessId_period.businessId}|${where.businessId_period.period}`) || null,
      upsert: async ({ where, create, update }: any) => {
        const k = `${where.businessId_period.businessId}|${where.businessId_period.period}`;
        const existing = month.get(k);
        if (existing) applyUpdate(existing, update);
        else month.set(k, { ...create });
        return month.get(k);
      }
    },
    businessAiDailyUsage: {
      aggregate: async ({ where }: any) => {
        let tokensIn = 0;
        let tokensOut = 0;
        for (const [k, row] of day.entries()) {
          if (k.endsWith(`|${where.day}`)) {
            tokensIn += row.tokensIn;
            tokensOut += row.tokensOut;
          }
        }
        return { _sum: { tokensIn, tokensOut } };
      },
      upsert: async ({ where, create, update }: any) => {
        const k = `${where.businessId_day.businessId}|${where.businessId_day.day}`;
        const existing = day.get(k);
        if (existing) applyUpdate(existing, update);
        else day.set(k, { ...create });
        return day.get(k);
      }
    },
    __subs: subs,
    __month: month,
    __day: day
  };
  return prisma;
}

const PRIMARY: VoiceAiProviderConfig = {
  name: 'groq',
  baseUrl: 'https://provider.test/v1',
  apiKey: 'test-key',
  model: 'test-model',
  jsonMode: true
};
const FALLBACK: VoiceAiProviderConfig = {
  name: 'cloudflare',
  baseUrl: 'https://fallback.test/v1',
  apiKey: 'test-key',
  model: 'test-model',
  jsonMode: false
};
const CONFIG: VoiceAiConfig = {
  planQuotas: { ...DEFAULT_PLAN_TOKEN_QUOTAS },
  dailyTokenCap: DEFAULT_DAILY_TOKEN_CAP
};
const SALE_JSON = JSON.stringify({
  kind: 'intent',
  intent: { type: 'create_sale', productQuery: 'panadol', quantity: 2 }
});
const okResponse = (content: string, usage?: any) => ({
  status: 200,
  ok: true,
  json: async () => ({ choices: [{ message: { content } }], ...(usage ? { usage } : {}) })
});

async function main() {
  // 4a. Unconfigured
  {
    const prisma = makeFakePrisma();
    let fetchCalls = 0;
    const result = await parseWithAi(
      {
        prisma,
        providers: { primary: null, fallback: null },
        config: CONFIG,
        fetchFn: async () => {
          fetchCalls++;
          return okResponse(SALE_JSON);
        }
      },
      { businessId: 'biz-1', utterance: 'do panadol bech do' }
    );
    check('4a unconfigured status', result.status === 'unconfigured', result.status);
    check('4a provider never called', fetchCalls === 0);
  }

  // 4b. Happy path — usage from provider fields
  {
    const prisma = makeFakePrisma();
    prisma.__subs.set('biz-1', 'single-growth');
    let fetchCalls = 0;
    const result = await parseWithAi(
      {
        prisma,
        providers: { primary: PRIMARY, fallback: null },
        config: CONFIG,
        fetchFn: async () => {
          fetchCalls++;
          return okResponse(SALE_JSON, { prompt_tokens: 800, completion_tokens: 60 });
        }
      },
      { businessId: 'biz-1', businessType: 'PHARMACY', utterance: 'mujhe do panadol chahiye' }
    );
    check('4b status ok', result.status === 'ok', result.status);
    check('4b envelope is the sale', result.envelope?.kind === 'intent' && result.envelope.intent.type === 'create_sale');
    check('4b provider called once', fetchCalls === 1);
    const period = pktPeriodKey();
    const row = prisma.__month.get(`biz-1|${period}`);
    check('4b month row recorded', !!row, [...prisma.__month.keys()]);
    check('4b tokensIn from usage block', row?.tokensIn === 800, row);
    check('4b tokensOut from usage block', row?.tokensOut === 60, row);
    check('4b calls = 1, not estimated', row?.calls === 1 && row?.estimatedCalls === 0, row);
    check('4b source marked (lastProvider)', row?.lastProvider === 'groq', row);
    const dayRow = prisma.__day.get(`biz-1|${pktDayKey()}`);
    check('4b day row mirrors the call', dayRow?.tokensIn === 800 && dayRow?.calls === 1, dayRow);
    check('4b summary reflects usage', result.usage?.tokensUsed === 860 && result.usage?.tokenLimit === 900_000, result.usage);
  }

  // 4c + 4d. Quota exhausted, then plan upgrade mid-month
  {
    const prisma = makeFakePrisma();
    prisma.__subs.set('biz-1', 'single-trial'); // 100k limit
    const period = pktPeriodKey();
    prisma.__month.set(`biz-1|${period}`, {
      businessId: 'biz-1',
      period,
      calls: 74,
      tokensIn: 90_000,
      tokensOut: 10_000,
      estimatedCalls: 0,
      lastProvider: 'groq'
    });
    let fetchCalls = 0;
    const fetchFn = async () => {
      fetchCalls++;
      return okResponse(SALE_JSON, { prompt_tokens: 800, completion_tokens: 60 });
    };
    const denied = await parseWithAi(
      { prisma, providers: { primary: PRIMARY, fallback: null }, config: CONFIG, fetchFn },
      { businessId: 'biz-1', utterance: 'do panadol bech do' }
    );
    check('4c quota_exceeded at the trial limit', denied.status === 'quota_exceeded', denied.status);
    check('4c provider NOT called when quota exhausted', fetchCalls === 0);
    check('4c no usage recorded for the denied call', prisma.__month.get(`biz-1|${period}`)?.calls === 74);

    prisma.__subs.set('biz-1', 'single-growth'); // upgrade: 900k limit, same month
    const allowed = await parseWithAi(
      { prisma, providers: { primary: PRIMARY, fallback: null }, config: CONFIG, fetchFn },
      { businessId: 'biz-1', utterance: 'do panadol bech do' }
    );
    check('4d plan upgrade raises the limit for the same month', allowed.status === 'ok', allowed.status);
    check('4d usage continues on the same month row', prisma.__month.get(`biz-1|${period}`)?.calls === 75);
  }

  // 4e. Primary 429 → fallback serves
  {
    const prisma = makeFakePrisma();
    prisma.__subs.set('biz-1', 'single-growth');
    const seen: string[] = [];
    const result = await parseWithAi(
      {
        prisma,
        providers: { primary: PRIMARY, fallback: FALLBACK },
        config: CONFIG,
        fetchFn: async (url: string) => {
          seen.push(url);
          if (url.startsWith(PRIMARY.baseUrl)) return { status: 429, ok: false, json: async () => ({}) };
          return okResponse(SALE_JSON, { prompt_tokens: 500, completion_tokens: 40 });
        }
      },
      { businessId: 'biz-1', utterance: 'do panadol bech do' }
    );
    check('4e fallback serves after primary 429', result.status === 'ok' && result.provider === 'cloudflare', result);
    check('4e both providers attempted in order', seen.length === 2 && seen[0].startsWith(PRIMARY.baseUrl), seen);
    const row = prisma.__month.get(`biz-1|${pktPeriodKey()}`);
    check('4e usage recorded once, source = fallback', row?.calls === 1 && row?.lastProvider === 'cloudflare' && row?.tokensIn === 500, row);
  }

  // 4f. No usage block → estimation
  {
    const prisma = makeFakePrisma();
    prisma.__subs.set('biz-1', 'single-growth');
    const result = await parseWithAi(
      {
        prisma,
        providers: { primary: PRIMARY, fallback: null },
        config: CONFIG,
        fetchFn: async () => okResponse(SALE_JSON) // no usage block
      },
      { businessId: 'biz-1', utterance: 'do panadol bech do' }
    );
    const row = prisma.__month.get(`biz-1|${pktPeriodKey()}`);
    check('4f status ok without usage block', result.status === 'ok', result.status);
    check('4f estimated call marked', row?.estimatedCalls === 1, row);
    check('4f estimated tokens recorded (>0)', (row?.tokensIn || 0) > 0 && (row?.tokensOut || 0) > 0, row);
    check('4f estimate uses the chars/4 heuristic', row?.tokensOut === estimateTokens(SALE_JSON), row);
  }

  // 4g. Platform daily cap
  {
    const prisma = makeFakePrisma();
    prisma.__subs.set('biz-1', 'single-scale'); // own quota is huge
    const day = pktDayKey();
    prisma.__day.set(`other-biz|${day}`, {
      businessId: 'other-biz',
      day,
      calls: 300,
      tokensIn: DEFAULT_DAILY_TOKEN_CAP,
      tokensOut: 0,
      estimatedCalls: 0,
      lastProvider: 'groq'
    });
    let fetchCalls = 0;
    const result = await parseWithAi(
      {
        prisma,
        providers: { primary: PRIMARY, fallback: null },
        config: CONFIG,
        fetchFn: async () => {
          fetchCalls++;
          return okResponse(SALE_JSON);
        }
      },
      { businessId: 'biz-1', utterance: 'do panadol bech do' }
    );
    check('4g daily_cap when the shared pool is drained', result.status === 'daily_cap', result.status);
    check('4g provider NOT called at the daily cap', fetchCalls === 0);
  }

  // 4h. Unparseable output from both providers
  {
    const prisma = makeFakePrisma();
    prisma.__subs.set('biz-1', 'single-growth');
    const result = await parseWithAi(
      {
        prisma,
        providers: { primary: PRIMARY, fallback: FALLBACK },
        config: CONFIG,
        fetchFn: async () => okResponse('Sorry, I cannot do that.') // no JSON at all
      },
      { businessId: 'biz-1', utterance: 'do panadol bech do' }
    );
    check('4h garbage from both providers → error status', result.status === 'error', result.status);
    const row = prisma.__month.get(`biz-1|${pktPeriodKey()}`);
    check('4h consumed tokens still accounted (estimated)', row?.calls === 2 && row?.estimatedCalls === 2, row);
  }

  console.log(
    failures === 0
      ? '\nVoice AI self-check: ALL PASSED'
      : `\nVoice AI self-check: ${failures} FAILURE(S)`
  );
  if (failures) process.exit(1);
}

main().catch((e) => {
  console.error('Voice AI self-check crashed', e);
  process.exit(1);
});
