/**
 * Voice Assistant AI layer — client-side envelope handling.
 *
 * Pure module (type-only import from intents.ts) so it can be unit
 * tested in plain Node — see scripts/voice-ai-test.mjs.
 *
 * The backend proxy already validates the model's reply against the
 * action whitelist; this module RE-validates independently before
 * anything reaches the executor, so a compromised or buggy response
 * can never smuggle an action the rule parser could not produce.
 * Rules mirror the backend (voice-ai-core.ts):
 *   - whitelist = exactly the parser's action set (no confirm/cancel/
 *     help/unknown, no deletes/refunds/settings)
 *   - value caps on names, prices, quantities
 *   - read-only chains allowed (max 3); any write in a list reduces
 *     the reply to that single write (confirm card handles it)
 */

import type { NavTarget, VoiceIntent } from './intents';

export type AiEnvelope =
  | { kind: 'intent'; intent: VoiceIntent }
  | { kind: 'actions'; intents: VoiceIntent[] }
  | { kind: 'clarify'; message: string }
  | { kind: 'message'; message: string };

export const READ_ONLY_AI_INTENTS: ReadonlySet<string> = new Set([
  'find_product',
  'check_stock',
  'low_stock',
  'expiring',
  'today_report',
  'navigate',
]);

const WRITE_AI_INTENTS: ReadonlySet<string> = new Set([
  'add_product',
  'add_category',
  'create_sale',
]);

const NAV_TARGETS: readonly string[] = [
  'dashboard',
  'pos',
  'products',
  'sales',
  'reports',
  'inventory',
  'categories',
  'customers',
];

const MAX_TEXT = 80;
const MAX_CATEGORY = 40;
const MAX_MESSAGE = 300;
const MAX_PRICE = 10_000_000;
const MAX_QUANTITY = 10_000;
const MAX_ACTIONS = 3;

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

/** Validate one AI-proposed intent; returns null when not whitelisted. */
export function sanitizeAiIntent(raw: unknown): VoiceIntent | null {
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
        ...(category ? { category } : {}),
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
        ...(unitPrice !== undefined ? { unitPrice } : {}),
      };
    }
    case 'today_report':
      return { type: 'today_report' };
    case 'navigate': {
      const target = typeof r.target === 'string' ? r.target.toLowerCase().trim() : '';
      if (!NAV_TARGETS.includes(target)) return null;
      return { type: 'navigate', target: target as NavTarget };
    }
    default:
      return null;
  }
}

/** Validate a full AI envelope from the proxy; null when unusable. */
export function resolveAiEnvelope(raw: unknown): AiEnvelope | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  if (r.kind === 'clarify' || r.kind === 'message') {
    const message = cleanText(r.message, MAX_MESSAGE);
    return message ? { kind: r.kind, message } : null;
  }

  if (r.kind === 'intent') {
    const intent = sanitizeAiIntent(r.intent);
    return intent ? { kind: 'intent', intent } : null;
  }

  if (r.kind === 'actions') {
    if (!Array.isArray(r.intents)) return null;
    const valid = r.intents
      .map((item) => sanitizeAiIntent(item))
      .filter((item): item is VoiceIntent => item !== null);
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

/**
 * Map a proxy status to the client-side handling bucket:
 *   'ok'          → an envelope follows
 *   'quota'       → plan quota exhausted: honest quota notice
 *   'unavailable' → unconfigured / daily cap / rate limited / error:
 *                   degrade to parser-only with the honest note
 */
export function mapAiStatus(status: unknown): 'ok' | 'quota' | 'unavailable' {
  if (status === 'ok') return 'ok';
  if (status === 'quota_exceeded') return 'quota';
  return 'unavailable';
}

/** Shown when the plan's monthly AI quota is finished. */
export const AI_QUOTA_MESSAGE =
  'Is mahine ka AI quota khatam ho gaya hai — basic commands chalti rahengi. Mukhtasar command try karein, jaise "sell 2 panadol".';

/** Shown when the AI layer itself is unavailable (parser still works). */
export const AI_UNAVAILABLE_MESSAGE =
  'AI samajh abhi dastiyab nahi hai — mukhtasar command try karein.';
