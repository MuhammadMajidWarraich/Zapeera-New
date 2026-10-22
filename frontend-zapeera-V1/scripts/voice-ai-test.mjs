/**
 * Voice AI-path self-test (plain Node, no test framework, NO API key).
 *
 * The provider is MOCKED: fixture envelopes below stand in for real
 * model replies (they are the exact shapes the backend proxy validates
 * and forwards). This test covers the client half of the AI path:
 *   1. the utterances that must REACH the AI layer do return "unknown"
 *      from the untouched rule parser (the AI is fallback-only);
 *   2. envelope resolution / intent sanitizing mirrors the backend
 *      whitelist, caps and multi-intent safety rules;
 *   3. proxy statuses map to the right client behaviour (quota notice
 *      vs graceful parser-only degradation).
 *
 * Run: node scripts/voice-ai-test.mjs
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = mkdtempSync(join(tmpdir(), 'voice-ai-test-'));

execFileSync(
  process.execPath,
  [
    join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    join(root, 'src', 'features', 'voice', 'intents.ts'),
    join(root, 'src', 'features', 'voice', 'ai-intent.ts'),
    '--outDir', outDir,
    '--module', 'commonjs',
    '--target', 'es2020',
    '--skipLibCheck',
  ],
  { stdio: 'inherit' },
);

const require = createRequire(import.meta.url);
const { parseUtterance } = require(join(outDir, 'intents.js'));
const { resolveAiEnvelope, sanitizeAiIntent, mapAiStatus } = require(join(outDir, 'ai-intent.js'));

let passed = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`✓ ${name}`);
  } else {
    failures.push(`✗ ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`);
  }
}

// ─── 1. These utterances reach the AI layer (parser says "unknown") ──
check(
  '"change its category to multiple" is unknown to the parser',
  parseUtterance('change its category to multiple').type === 'unknown'
);
check(
  '"mujhe do panadol chahiye" (Roman Urdu) is unknown to the parser',
  parseUtterance('mujhe do panadol chahiye').type === 'unknown'
);
check(
  '"sara data delete kar do" is unknown to the parser',
  parseUtterance('sara data delete kar do').type === 'unknown'
);
check(
  '"us cheez ka rate batao" (ambiguous) is unknown to the parser',
  parseUtterance('us cheez ka rate batao').type === 'unknown'
);
// …while a plain parser command NEVER reaches the AI layer:
check(
  '"sell 2 paracetamol" stays with the parser',
  parseUtterance('sell 2 paracetamol').type === 'create_sale'
);

// ─── 2. Mocked provider envelopes ────────────────────────────────────
// (a) The category case: the model must clarify, not act — a product
// has exactly ONE category.
const categoryReply = resolveAiEnvelope({
  kind: 'clarify',
  message: 'Ek product ki sirf ek hi category ho sakti hai. Aap kis ek category mein rakhna chahte hain?',
});
check(
  'category example → clarify (no blind action)',
  categoryReply?.kind === 'clarify' && categoryReply.message.includes('ek hi category'),
  categoryReply
);

// (b) Roman-Urdu free-form sale request → structured sale intent.
const saleReply = resolveAiEnvelope({
  kind: 'intent',
  intent: { type: 'create_sale', productQuery: 'panadol', quantity: 2 },
});
check(
  'Roman-Urdu sale → create_sale panadol x2',
  saleReply?.kind === 'intent' &&
    saleReply.intent.type === 'create_sale' &&
    saleReply.intent.productQuery === 'panadol' &&
    saleReply.intent.quantity === 2,
  saleReply
);

// (c) Ambiguous request → clarify.
const ambiguousReply = resolveAiEnvelope({
  kind: 'clarify',
  message: 'Kis cheez ka rate check karoon? Product ka naam bata dein.',
});
check('ambiguous request → clarify', ambiguousReply?.kind === 'clarify', ambiguousReply);

// (d) Out-of-scope request → polite refusal message.
const refusalReply = resolveAiEnvelope({
  kind: 'message',
  message: 'Maazrat, main data delete nahi kar sakta. Main sale, stock check, product ya category add, aur reports mein madad kar sakta hoon.',
});
check(
  'out-of-scope request → polite refusal message',
  refusalReply?.kind === 'message' && refusalReply.message.includes('delete nahi kar sakta'),
  refusalReply
);

// (e) Read-only chain stays a chain (max 3, in order).
const chainReply = resolveAiEnvelope({
  kind: 'actions',
  intents: [{ type: 'today_report' }, { type: 'low_stock' }],
});
check(
  'read-only chain preserved',
  chainReply?.kind === 'actions' && chainReply.intents.length === 2 && chainReply.intents[0].type === 'today_report',
  chainReply
);

// (f) A write hiding in a list collapses to the single write — the
// confirm card handles writes one at a time, never batched.
const mixedReply = resolveAiEnvelope({
  kind: 'actions',
  intents: [{ type: 'today_report' }, { type: 'create_sale', productQuery: 'panadol', quantity: 1 }],
});
check(
  'write inside a list reduces to the single write intent',
  mixedReply?.kind === 'intent' && mixedReply.intent.type === 'create_sale',
  mixedReply
);

// (g) Sanitizer abuse cases — nothing outside the parser's schema can
// ever reach the executor.
check('delete_everything intent rejected', sanitizeAiIntent({ type: 'delete_everything' }) === null);
check('AI cannot emit confirm', sanitizeAiIntent({ type: 'confirm' }) === null);
check(
  'absurd quantity rejected',
  sanitizeAiIntent({ type: 'create_sale', productQuery: 'panadol', quantity: 999999 }) === null
);
check(
  'navigate to a non-whitelisted target rejected',
  sanitizeAiIntent({ type: 'navigate', target: 'settings' }) === null
);
check(
  'garbage envelope rejected',
  resolveAiEnvelope({ kind: 'intent', intent: { type: 'refund', amount: 500 } }) === null
);
check('non-object envelope rejected', resolveAiEnvelope('just text') === null);

// ─── 3. Provider-down / quota statuses → client behaviour ────────────
check("status 'ok' → ok", mapAiStatus('ok') === 'ok');
check("status 'quota_exceeded' → quota notice", mapAiStatus('quota_exceeded') === 'quota');
check("provider unconfigured → degrade to parser-only", mapAiStatus('unconfigured') === 'unavailable');
check("provider rate-limited → degrade to parser-only", mapAiStatus('rate_limited') === 'unavailable');
check("provider error → degrade to parser-only", mapAiStatus('error') === 'unavailable');
check("platform daily cap → degrade to parser-only", mapAiStatus('daily_cap') === 'unavailable');
check('missing status → degrade to parser-only', mapAiStatus(undefined) === 'unavailable');

console.log(`\nVoice AI test: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
