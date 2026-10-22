/**
 * Voice Assistant AI layer — pure core (no I/O, no imports).
 *
 * The rule parser in the frontend remains the FIRST pass: it is instant,
 * free and offline. Only utterances it cannot handle ("unknown") reach
 * this AI layer. The model proposes a STRUCTURED action in exactly the
 * parser's action schema; the same frontend executor + confirm cards
 * dispose of it. The model never gets DB/API write access.
 *
 * Everything in this file is deterministic and unit-testable in plain
 * Node (see scripts/voice-ai-selfcheck.ts):
 *   - envelope / intent validation (strict whitelist + value caps)
 *   - provider-response JSON + usage extraction
 *   - token estimation for responses without a usage block
 *   - Asia/Karachi period/day keying for usage accounting
 *   - the quota gate decision (per-plan monthly + platform daily cap)
 *   - the system prompt that constrains the model to the schema
 */

// ─── Action schema (mirrors frontend features/voice/intents.ts) ──────

export type AiIntent =
  | { type: 'add_product'; name: string; price?: number; category?: string }
  | { type: 'add_category'; name: string }
  | { type: 'find_product'; query: string }
  | { type: 'check_stock'; query: string }
  | { type: 'low_stock' }
  | { type: 'expiring' }
  | { type: 'create_sale'; productQuery: string; quantity: number; unitPrice?: number }
  | { type: 'today_report' }
  | { type: 'navigate'; target: string };

export type AiEnvelope =
  | { kind: 'intent'; intent: AiIntent }
  | { kind: 'actions'; intents: AiIntent[] }
  | { kind: 'clarify'; message: string }
  | { kind: 'message'; message: string };

/** Read-only intents — safe to chain several in one reply. */
export const READ_ONLY_AI_INTENTS: ReadonlySet<string> = new Set([
  'find_product',
  'check_stock',
  'low_stock',
  'expiring',
  'today_report',
  'navigate'
]);

/** Write intents — executed one at a time, always behind a confirm card. */
const WRITE_AI_INTENTS: ReadonlySet<string> = new Set([
  'add_product',
  'add_category',
  'create_sale'
]);

export const AI_NAV_TARGETS: readonly string[] = [
  'dashboard',
  'pos',
  'products',
  'sales',
  'reports',
  'inventory',
  'categories',
  'customers'
];

const MAX_TEXT = 80; // product names / queries
const MAX_CATEGORY = 40;
const MAX_MESSAGE = 300; // clarify / message text
const MAX_PRICE = 10_000_000; // PKR
const MAX_QUANTITY = 10_000;
const MAX_ACTIONS = 3; // read-only chain length

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || text.length > max) return null;
  return text;
}

/** undefined = field absent (ok), null = present but invalid (reject). */
function cleanPrice(value: unknown): number | undefined | null {
  if (value === undefined || value === null) return undefined;
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > MAX_PRICE) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Validate one model-proposed intent against the whitelist. Anything the
 * rule parser could not produce (confirm/cancel/help/unknown, deletes,
 * refunds, settings changes, …) is rejected outright — the AI may only
 * ever propose the parser's own action set.
 */
export function validateAiIntent(raw: unknown): AiIntent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  switch (r.type) {
    case 'add_product': {
      const name = cleanText(r.name, MAX_TEXT);
      if (!name) return null;
      const price = cleanPrice(r.price);
      if (price === null) return null;
      let category: string | undefined;
      if (r.category !== undefined && r.category !== null) {
        const c = cleanText(r.category, MAX_CATEGORY);
        if (!c) return null;
        category = c;
      }
      return {
        type: 'add_product',
        name,
        ...(price !== undefined ? { price } : {}),
        ...(category ? { category } : {})
      };
    }
    case 'add_category': {
      const name = cleanText(r.name, MAX_CATEGORY);
      return name ? { type: 'add_category', name } : null;
    }
    case 'find_product': {
      const query = cleanText(r.query ?? r.productQuery, MAX_TEXT);
      return query ? { type: 'find_product', query } : null;
    }
    case 'check_stock': {
      const query = cleanText(r.query ?? r.productQuery, MAX_TEXT);
      return query ? { type: 'check_stock', query } : null;
    }
    case 'low_stock':
      return { type: 'low_stock' };
    case 'expiring':
      return { type: 'expiring' };
    case 'create_sale': {
      const productQuery = cleanText(r.productQuery ?? r.query, MAX_TEXT);
      if (!productQuery) return null;
      let quantity = 1;
      if (r.quantity !== undefined && r.quantity !== null) {
        const q = typeof r.quantity === 'string' ? Number(r.quantity) : r.quantity;
        if (typeof q !== 'number' || !Number.isInteger(q) || q < 1 || q > MAX_QUANTITY) return null;
        quantity = q;
      }
      const unitPrice = cleanPrice(r.unitPrice ?? r.price);
      if (unitPrice === null) return null;
      return {
        type: 'create_sale',
        productQuery,
        quantity,
        ...(unitPrice !== undefined ? { unitPrice } : {})
      };
    }
    case 'today_report':
      return { type: 'today_report' };
    case 'navigate': {
      const target = typeof r.target === 'string' ? r.target.toLowerCase().trim() : '';
      if (!AI_NAV_TARGETS.includes(target)) return null;
      return { type: 'navigate', target };
    }
    default:
      return null;
  }
}

/**
 * Validate a full model reply envelope.
 *
 * Multi-intent safety rule: read-only chains are allowed (max 3). If ANY
 * write intent sneaks into a list, the reply is reduced to the FIRST
 * write as a single intent — writes always go one at a time through the
 * confirm card, never batched.
 */
export function validateAiEnvelope(raw: unknown): AiEnvelope | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  if (r.kind === 'clarify' || r.kind === 'message') {
    const message = cleanText(r.message, MAX_MESSAGE);
    return message ? { kind: r.kind, message } : null;
  }

  if (r.kind === 'intent') {
    const intent = validateAiIntent(r.intent);
    return intent ? { kind: 'intent', intent } : null;
  }

  if (r.kind === 'actions') {
    if (!Array.isArray(r.intents)) return null;
    const valid = r.intents
      .map((item) => validateAiIntent(item))
      .filter((item): item is AiIntent => item !== null);
    if (!valid.length) return null;
    const firstWrite = valid.find((item) => WRITE_AI_INTENTS.has(item.type));
    if (firstWrite) return { kind: 'intent', intent: firstWrite };
    const reads = valid.slice(0, MAX_ACTIONS);
    return reads.length === 1
      ? { kind: 'intent', intent: reads[0] }
      : { kind: 'actions', intents: reads };
  }

  return null;
}

// ─── Provider response handling ──────────────────────────────────────

/** Extract the first JSON object from a model reply (fences tolerated). */
export function extractJsonObject(text: string): unknown | null {
  if (!text) return null;
  let t = String(text).trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** OpenAI-compatible usage block → { tokensIn, tokensOut } (or null). */
export function extractProviderUsage(json: any): { tokensIn: number; tokensOut: number } | null {
  const u = json?.usage;
  if (!u || typeof u !== 'object') return null;
  const tokensIn = Number(u.prompt_tokens ?? u.input_tokens);
  const tokensOut = Number(u.completion_tokens ?? u.output_tokens);
  if (!Number.isFinite(tokensIn) || !Number.isFinite(tokensOut)) return null;
  return {
    tokensIn: Math.max(0, Math.round(tokensIn)),
    tokensOut: Math.max(0, Math.round(tokensOut))
  };
}

/** Rough token estimate (≈4 chars/token) when a provider reports none. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(String(text || '').length / 4));
}

// ─── Usage accounting keys (Asia/Karachi calendar) ───────────────────

function pktParts(date: Date): { year: string; month: string; day: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '';
  return { year: get('year'), month: get('month'), day: get('day') };
}

/** Monthly accounting period, e.g. "2026-10" (PKT). Rollover = new key. */
export function pktPeriodKey(date: Date = new Date()): string {
  const p = pktParts(date);
  return `${p.year}-${p.month}`;
}

/** Daily accounting key, e.g. "2026-10-22" (PKT) for the platform cap. */
export function pktDayKey(date: Date = new Date()): string {
  const p = pktParts(date);
  return `${p.year}-${p.month}-${p.day}`;
}

// ─── Quota gate ──────────────────────────────────────────────────────

export type AiGateReason = 'quota_exceeded' | 'daily_cap';

/**
 * Decide BEFORE any provider call whether this business may use the AI
 * layer. The plan limit applies to the business's own month usage; the
 * daily cap protects the shared free-tier pool platform-wide. A plan
 * change mid-month takes effect immediately because the caller always
 * passes the CURRENT plan's limit against the same month's usage.
 */
export function decideAiGate(input: {
  monthTokensUsed: number;
  monthTokenLimit: number;
  platformDayTokensUsed: number;
  platformDayTokenCap: number;
}): { allow: true } | { allow: false; reason: AiGateReason } {
  if (input.monthTokensUsed >= input.monthTokenLimit) {
    return { allow: false, reason: 'quota_exceeded' };
  }
  if (input.platformDayTokenCap > 0 && input.platformDayTokensUsed >= input.platformDayTokenCap) {
    return { allow: false, reason: 'daily_cap' };
  }
  return { allow: true };
}

// ─── Prompt ──────────────────────────────────────────────────────────

export function buildAiSystemPrompt(businessType?: string | null): string {
  const typeLine = businessType
    ? `Business context: this business is of type "${businessType}". Only propose actions that make sense for it.`
    : 'Business context: a small retail business.';
  return [
    'You are the intent parser for Zapeera, a business-management app used by small shops, pharmacies, clinics and hotels in Pakistan. The user speaks to a voice assistant in English, Urdu, or Roman Urdu (Urdu written in Latin letters), often mixed. Convert the user command into EXACTLY ONE JSON object. Output JSON only — no markdown, no explanation, no extra text.',
    '',
    'The JSON object must be one of:',
    '{"kind":"intent","intent":{...}} — a single command.',
    '{"kind":"actions","intents":[...]} — ONLY when the user asks for two or three READ-ONLY lookups in one sentence. Never put a write action in a list.',
    '{"kind":"clarify","message":"..."} — the command is ambiguous or rests on a wrong assumption. Ask ONE short question in the same language style as the user (an English/Roman-Urdu mix is fine).',
    '{"kind":"message","message":"..."} — the request is outside what the assistant can do. Politely decline in the user\'s language style and name what IS possible.',
    '',
    'Intent objects (the ONLY allowed types):',
    '{"type":"add_product","name":"...","price":<number, optional>,"category":"<one category, optional>"}',
    '{"type":"add_category","name":"..."}',
    '{"type":"find_product","query":"..."}',
    '{"type":"check_stock","query":"..."}',
    '{"type":"low_stock"}',
    '{"type":"expiring"}',
    '{"type":"create_sale","productQuery":"...","quantity":<integer>,"unitPrice":<number, optional>}',
    '{"type":"today_report"}',
    '{"type":"navigate","target":"dashboard|pos|products|sales|reports|inventory|categories|customers"}',
    '',
    'Rules:',
    '- Prices are Pakistani Rupees (Rs). If the user gives no price, omit the field. Quantity defaults to 1.',
    '- A product has EXACTLY ONE category in Zapeera. If the user asks to give a product multiple categories (e.g. "change its category to multiple"), answer with kind "clarify": explain a product can have only one category and ask which single category they mean.',
    '- Write actions (add_product, add_category, create_sale) are returned one at a time and are always confirmed by the user inside the app. If a sentence asks for a write plus lookups, return only the write as kind "intent".',
    '- You cannot delete anything, give refunds, change prices of existing products, manage staff, change settings, or order stock. Such requests get kind "message" with a polite refusal.',
    '- Never invent product names, prices, or stock figures. The app itself checks stock and totals.',
    typeLine,
    '',
    'Examples:',
    'User: "mujhe do panadol chahiye" → {"kind":"intent","intent":{"type":"create_sale","productQuery":"panadol","quantity":2}}',
    'User: "aaj ki sale aur low stock batao" → {"kind":"actions","intents":[{"type":"today_report"},{"type":"low_stock"}]}',
    'User: "change its category to multiple" → {"kind":"clarify","message":"Ek product ki sirf ek hi category ho sakti hai. Aap kis ek category mein rakhna chahte hain?"}',
    'User: "sara data delete kar do" → {"kind":"message","message":"Maazrat, main data delete nahi kar sakta. Main sale, stock check, product ya category add, aur reports mein madad kar sakta hoon."}',
    'User: "woh wali cheez ka stock batao" → {"kind":"clarify","message":"Kis cheez ka stock check karoon? Product ka naam bata dein."}'
  ].join('\n');
}

export function buildAiUserPrompt(utterance: string, businessType?: string | null): string {
  return `Business type: ${businessType || 'general'}\nUser command: ${utterance}`;
}
