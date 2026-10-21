/**
 * Voice command intent parser for the Zapeera Voice Assistant.
 *
 * Pure, deterministic, framework-free module (no React / no imports) so it can
 * be unit-tested in plain Node. It converts a raw utterance (English, Roman
 * Urdu, or a mix) into a structured intent consumed by executor.ts.
 *
 * Supported intents: add_product, add_category, find_product, check_stock,
 * low_stock, expiring, create_sale, today_report, navigate, confirm, cancel,
 * help, unknown.
 */

export type NavTarget =
  | 'dashboard'
  | 'pos'
  | 'products'
  | 'sales'
  | 'reports'
  | 'inventory'
  | 'categories'
  | 'customers';

export type VoiceIntent =
  | { type: 'add_product'; name: string; price?: number }
  | { type: 'add_category'; name: string }
  | { type: 'find_product'; query: string }
  | { type: 'check_stock'; query: string }
  | { type: 'low_stock' }
  | { type: 'expiring' }
  | { type: 'create_sale'; productQuery: string; quantity: number; unitPrice?: number }
  | { type: 'today_report' }
  | { type: 'navigate'; target: NavTarget }
  | { type: 'confirm' }
  | { type: 'cancel' }
  | { type: 'help' }
  | { type: 'unknown'; raw: string };

/** Number words the parser understands (converted to digits during normalize). */
const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

/** Common Urdu-script words (from ur-PK recognition) mapped to Roman Urdu. */
const URDU_SCRIPT_MAP: Record<string, string> = {
  'اسٹاک': 'stock',
  'سٹاک': 'stock',
  'بتاؤ': 'batao',
  'بتاو': 'batao',
  'کتنا': 'kitna',
  'کتنی': 'kitni',
  'کھولو': 'kholo',
  'کھول': 'kholo',
  'بیچو': 'becho',
  'شامل': 'shamil',
  'آج': 'aaj',
  'رپورٹ': 'report',
  'سیل': 'sell',
};

/**
 * Normalize an utterance: lowercase, map Urdu-script keywords, strip
 * punctuation, and convert number words ("two", "sixty", "one hundred
 * twenty") into digits so slot extraction can rely on plain numbers.
 */
export function normalizeUtterance(raw: string): string {
  let text = ` ${String(raw || '').toLowerCase()} `;

  for (const [script, roman] of Object.entries(URDU_SCRIPT_MAP)) {
    text = text.split(script).join(` ${roman} `);
  }

  // Remove punctuation (apostrophes, commas, etc.) but keep word characters.
  text = text.replace(/[.,!?;:'"()\-_/\\]+/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();

  // Convert number words to digits, handling "hundred" as a multiplier.
  const tokens = text.split(' ').filter(Boolean);
  const out: string[] = [];
  let pending = 0;
  let hasPending = false;
  const flush = () => {
    if (hasPending) out.push(String(pending));
    pending = 0;
    hasPending = false;
  };
  for (const tok of tokens) {
    if (tok === 'hundred') {
      pending = (hasPending ? pending : 1) * 100;
      hasPending = true;
      continue;
    }
    const n = NUMBER_WORDS[tok];
    if (n !== undefined) {
      pending += n;
      hasPending = true;
      continue;
    }
    flush();
    out.push(tok);
  }
  flush();
  return out.join(' ');
}

const isBareNumber = (tok: string): boolean => /^\d+$/.test(tok);

/** Filler words stripped when extracting a product name/query. */
const FILLER = new Set([
  'the', 'a', 'an', 'please', 'me', 'show', 'check', 'in', 'is', 'of',
  'how', 'much', 'many', 'hai', 'batao', 'for', 'kitna', 'kitni', 'ki', 'ka',
]);

function cleanQuery(tokens: string[]): string {
  return tokens.filter((t) => !FILLER.has(t)).join(' ').trim();
}

const NAV_KEYWORDS: Array<{ target: NavTarget; words: string[] }> = [
  { target: 'pos', words: ['pos', 'point of sale', 'billing', 'invoice banao'] },
  { target: 'dashboard', words: ['dashboard', 'home'] },
  { target: 'products', words: ['products', 'product', 'medicines', 'medicine'] },
  { target: 'sales', words: ['sales', 'invoices', 'invoice'] },
  { target: 'reports', words: ['reports', 'report'] },
  { target: 'inventory', words: ['inventory', 'stock page'] },
  { target: 'categories', words: ['categories', 'category'] },
  { target: 'customers', words: ['customers', 'customer'] },
];

export const EXAMPLE_COMMANDS: string[] = [
  'Sell 2 paracetamol',
  'Add product Panadol Extra price 45',
  'Add category Antibiotics',
  'Paracetamol stock kitna hai?',
  'Show low stock',
  'Expiring soon batao',
  "Today's sales report",
  'Open POS',
];

/**
 * Parse a raw utterance into a VoiceIntent.
 */
export function parseUtterance(raw: string): VoiceIntent {
  const text = normalizeUtterance(raw);
  if (!text) return { type: 'unknown', raw: String(raw || '') };
  const tokens = text.split(' ').filter(Boolean);
  const has = (...words: string[]) => words.some((w) => tokens.includes(w));
  const startsWithAny = (...words: string[]) => words.some((w) => tokens[0] === w);

  // --- confirm / cancel (short utterances only, so "cancel the sale" style
  // phrases never misfire mid-command) ---
  if (
    ['yes', 'confirm', 'ok', 'okay', 'haan', 'confirm karo', 'yes confirm', 'ok confirm', 'ji', 'ji haan'].includes(text)
  ) {
    return { type: 'confirm' };
  }
  if (['cancel', 'no', 'nahi', 'rehne do', 'cancel karo', 'stop'].includes(text)) {
    return { type: 'cancel' };
  }

  // --- help ---
  if (
    text === 'help' ||
    text.includes('what can you do') ||
    text.includes('commands') ||
    text === 'madad'
  ) {
    return { type: 'help' };
  }

  // --- navigate: "open products", "go to reports", "kholo pos" ---
  if (startsWithAny('open', 'go', 'kholo', 'show') && !text.includes('stock')) {
    const rest = tokens.slice(1).join(' ').replace(/^to\s+/, '');
    for (const { target, words } of NAV_KEYWORDS) {
      if (words.some((w) => rest === w || rest.startsWith(w))) {
        return { type: 'navigate', target };
      }
    }
    if (rest) {
      for (const { target, words } of NAV_KEYWORDS) {
        if (words.some((w) => rest.includes(w))) return { type: 'navigate', target };
      }
    }
  }
  if (has('kholo')) {
    for (const { target, words } of NAV_KEYWORDS) {
      if (words.some((w) => text.includes(w))) return { type: 'navigate', target };
    }
  }

  // --- add category ---
  if (has('category', 'categories') && has('add', 'create', 'new', 'shamil', 'banao')) {
    const idx = Math.max(tokens.indexOf('category'), tokens.indexOf('categories'));
    const name = cleanQuery(tokens.slice(idx + 1)).replace(/^(named|called)\s+/, '');
    if (name) return { type: 'add_category', name };
  }

  // --- add product: "add product paracetamol 500mg price 60" ---
  if (has('product', 'products', 'item') && has('add', 'create', 'new', 'shamil')) {
    const idx = Math.max(
      tokens.indexOf('product'),
      tokens.indexOf('products'),
      tokens.indexOf('item'),
    );
    const rest = tokens.slice(idx + 1);
    let price: number | undefined;
    const nameTokens: string[] = [];
    for (let i = 0; i < rest.length; i++) {
      const tok = rest[i];
      if (tok === 'price' || tok === 'qeemat') {
        const next = rest[i + 1];
        if (next && isBareNumber(next)) price = parseInt(next, 10);
        break;
      }
      if ((tok === 'rs' || tok === 'rupees' || tok === 'rupee') && rest[i + 1] && isBareNumber(rest[i + 1])) {
        price = parseInt(rest[i + 1], 10);
        break;
      }
      if (isBareNumber(tok) && (rest[i + 1] === 'rs' || rest[i + 1] === 'rupees')) {
        price = parseInt(tok, 10);
        break;
      }
      nameTokens.push(tok);
    }
    const name = cleanQuery(nameTokens);
    if (name) return { type: 'add_product', name, ...(price !== undefined ? { price } : {}) };
  }

  // --- create sale: "sell 2 paracetamol", "sell two panadol extra at 40",
  // "paracetamol becho" ---
  if (has('sell', 'becho', 'bech', 'sale')) {
    let quantity = 1;
    let qtySeen = false;
    let unitPrice: number | undefined;
    const queryTokens: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (tok === 'sell' || tok === 'becho' || tok === 'bech' || tok === 'sale') continue;
      if (tok === 'at' || tok === 'rs' || tok === 'rupees') {
        const next = tokens[i + 1];
        if (next && isBareNumber(next)) {
          unitPrice = parseInt(next, 10);
          i++;
        }
        continue;
      }
      if (isBareNumber(tok)) {
        if (!qtySeen) {
          quantity = parseInt(tok, 10);
          qtySeen = true;
        } else if (unitPrice === undefined) {
          unitPrice = parseInt(tok, 10);
        }
        continue;
      }
      queryTokens.push(tok);
    }
    const productQuery = cleanQuery(queryTokens);
    if (productQuery) {
      return {
        type: 'create_sale',
        productQuery,
        quantity,
        ...(unitPrice !== undefined ? { unitPrice } : {}),
      };
    }
  }

  // --- low stock ---
  if ((has('low') && has('stock')) || text.includes('kam stock')) {
    return { type: 'low_stock' };
  }

  // --- expiring ---
  if (has('expiring', 'expiry', 'expired') || text.includes('near expiry')) {
    return { type: 'expiring' };
  }

  // --- today's report: "today's sales", "sales report", "aaj ki report" ---
  if (
    (has('today', 'todays', 'aaj') && has('sales', 'report', 'sale')) ||
    text.includes('sales report')
  ) {
    return { type: 'today_report' };
  }

  // --- check stock: "paracetamol stock", "how much X in stock", "X kitna hai" ---
  if (has('stock') || has('kitna', 'kitni')) {
    const query = cleanQuery(tokens.filter((t) => t !== 'stock'));
    if (query) return { type: 'check_stock', query };
  }

  // --- find product ---
  if (startsWithAny('find', 'search', 'dhundo', 'locate')) {
    const query = cleanQuery(tokens.slice(1));
    if (query) return { type: 'find_product', query };
  }

  return { type: 'unknown', raw: String(raw || '') };
}

/** Human-readable one-line description of an intent (for previews/history). */
export function describeIntent(intent: VoiceIntent): string {
  switch (intent.type) {
    case 'add_product':
      return `Add product "${intent.name}"${intent.price !== undefined ? ` at Rs ${intent.price}` : ''}`;
    case 'add_category':
      return `Add category "${intent.name}"`;
    case 'find_product':
      return `Find "${intent.query}"`;
    case 'check_stock':
      return `Check stock of "${intent.query}"`;
    case 'low_stock':
      return 'Show low stock products';
    case 'expiring':
      return 'Show batches expiring within 30 days';
    case 'create_sale':
      return `Sell ${intent.quantity} × "${intent.productQuery}"${intent.unitPrice !== undefined ? ` at Rs ${intent.unitPrice} each` : ''}`;
    case 'today_report':
      return "Show today's sales report";
    case 'navigate':
      return `Open ${intent.target}`;
    case 'confirm':
      return 'Confirm';
    case 'cancel':
      return 'Cancel';
    case 'help':
      return 'Help';
    default:
      return 'Unknown command';
  }
}
