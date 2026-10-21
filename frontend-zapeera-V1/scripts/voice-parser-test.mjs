/**
 * Voice parser self-test (plain Node, no test framework).
 * Compiles src/features/voice/intents.ts with the project's TypeScript and
 * asserts parseUtterance() output for a battery of utterances.
 * Run: node scripts/voice-parser-test.mjs
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = mkdtempSync(join(tmpdir(), 'voice-parser-test-'));

execFileSync(
  process.execPath,
  [
    join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    join(root, 'src', 'features', 'voice', 'intents.ts'),
    '--outDir', outDir,
    '--module', 'commonjs',
    '--target', 'es2020',
    '--skipLibCheck',
  ],
  { stdio: 'inherit' },
);

const require = createRequire(import.meta.url);
const { parseUtterance } = require(join(outDir, 'intents.js'));

const cases = [
  // [utterance, expectedType, expectedSlots]
  ['add product paracetamol 500mg price 60', 'add_product', { name: 'paracetamol 500mg', price: 60 }],
  ['add product Panadol Extra', 'add_product', { name: 'panadol extra' }],
  ['add a new product name panadol and price for unit rs 100', 'add_product', { name: 'panadol', price: 100 }],
  ['add a new product name panadol and price for unit for be Rs 1 and unit to add hundred', 'add_product', { name: 'panadol', price: 1 }],
  ['add product dettol in category antiseptic price 250', 'add_product', { name: 'dettol', price: 250, category: 'antiseptic' }],
  ['add category Antibiotics', 'add_category', { name: 'antibiotics' }],
  ['create category pain relief', 'add_category', { name: 'pain relief' }],
  ['find panadol', 'find_product', { query: 'panadol' }],
  ['search brufen syrup', 'find_product', { query: 'brufen syrup' }],
  ['paracetamol stock', 'check_stock', { query: 'paracetamol' }],
  ['how much panadol extra in stock', 'check_stock', { query: 'panadol extra' }],
  ['paracetamol kitna hai', 'check_stock', { query: 'paracetamol' }], // Roman Urdu
  ['show low stock', 'low_stock', {}],
  ['low stock batao', 'low_stock', {}], // Roman Urdu
  ['expiring soon', 'expiring', {}],
  ['expiry report', 'expiring', {}],
  ['sell 2 paracetamol', 'create_sale', { productQuery: 'paracetamol', quantity: 2 }],
  ['sell two panadol extra at 40', 'create_sale', { productQuery: 'panadol extra', quantity: 2, unitPrice: 40 }],
  ['sell twenty tablets of brufen', 'create_sale', { productQuery: 'tablets brufen', quantity: 20 }],
  ["today's sales report", 'today_report', {}],
  ['aaj ki report', 'today_report', {}], // Roman Urdu
  ['open pos', 'navigate', { target: 'pos' }],
  ['go to reports', 'navigate', { target: 'reports' }],
  ['kholo products', 'navigate', { target: 'products' }], // Roman Urdu
  ['yes', 'confirm', {}],
  ['confirm karo', 'confirm', {}],
  ['cancel', 'cancel', {}],
  ['what can you do', 'help', {}],
  ['blah blah random words', 'unknown', {}],
];

let passed = 0;
const failures = [];
for (const [utterance, expectedType, slots] of cases) {
  const intent = parseUtterance(utterance);
  const problems = [];
  if (intent.type !== expectedType) problems.push(`type=${intent.type} (want ${expectedType})`);
  for (const [key, value] of Object.entries(slots)) {
    if (intent[key] !== value) problems.push(`${key}=${JSON.stringify(intent[key])} (want ${JSON.stringify(value)})`);
  }
  if (problems.length) {
    failures.push(`✗ "${utterance}" → ${problems.join('; ')}`);
  } else {
    passed++;
    console.log(`✓ "${utterance}" → ${intent.type}`);
  }
}

console.log(`\nVoice parser test: ${passed}/${cases.length} passed`);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
