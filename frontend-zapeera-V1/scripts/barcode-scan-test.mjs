/**
 * Barcode scan engine self-test (plain Node, no test framework).
 * Compiles src/lib/barcode-scan.ts with the project's TypeScript and
 * asserts the burst discrimination, the lookup resolver, and the
 * business-type / setting resolution.
 * Run: node scripts/barcode-scan-test.mjs
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = mkdtempSync(join(tmpdir(), 'barcode-scan-test-'));

execFileSync(
  process.execPath,
  [
    join(root, 'node_modules', 'typescript', 'bin', 'tsc'),
    join(root, 'src', 'lib', 'barcode-scan.ts'),
    '--outDir', outDir,
    '--module', 'commonjs',
    '--target', 'es2020',
    '--skipLibCheck',
  ],
  { stdio: 'inherit' },
);

const require = createRequire(import.meta.url);
const {
  BurstTracker,
  resolveScanLookup,
  isBarcodeApplicableBusinessType,
  resolveBarcodeScanningEnabled,
} = require(join(outDir, 'barcode-scan.js'));

let passed = 0;
let failed = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.error(`✗ ${label}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

function burst(code, gapMs, enterDelayMs = 10) {
  const tracker = new BurstTracker();
  let t = 1000;
  for (const ch of code) {
    tracker.pushChar(ch, t);
    t += gapMs;
  }
  return tracker.pushEnter(t - gapMs + enterDelayMs);
}

// --- Burst discrimination -------------------------------------------------
check('EAN-13 machine burst resolves', burst('8901234567890', 10), '8901234567890');
check('EAN-8 machine burst resolves', burst('12345678', 12), '12345678');
check('generated ZP code resolves', burst('ZP000123', 8), 'ZP000123');
check('batch-style code resolves', burst('B-2026-001', 10), 'B-2026-001');
check('human typing (150ms gaps) is not a scan', burst('8901234567890', 150), null);
check('fast lowercase word is not a scan', burst('panadol', 10), null);
check('words with a space are not a scan', burst('Panadol Extra', 10), null);
check('delayed Enter is not a scan', burst('8901234567890', 10, 900), null);
check('3 chars is too short', burst('123', 10), null);

{
  const tracker = new BurstTracker();
  let t = 0;
  for (const ch of '8901234') { tracker.pushChar(ch, t); t += 10; }
  tracker.invalidate();
  check('invalidated burst does not resolve', tracker.pushEnter(t), null);
}

{
  // Slow start, then the user hits Enter to search manually — no scan.
  const tracker = new BurstTracker();
  let t = 0;
  for (const ch of 'paracetamol') { tracker.pushChar(ch, t); t += 120; }
  check('slow product search + Enter is not a scan', tracker.pushEnter(t), null);
}

// --- Lookup resolution ------------------------------------------------------
const hitProduct = { id: 'p1', name: 'Panadol 500mg', barcode: '8901234567890' };
check(
  'primary match is a hit',
  resolveScanLookup({ success: true, data: { product: hitProduct, batch: { id: 'b1' }, stock: 30, matchType: 'primary' } }, '8901234567890'),
  { type: 'hit', product: hitProduct, batch: { id: 'b1' }, matchType: 'primary', stock: 30 }
);
check(
  'additional match is a hit',
  resolveScanLookup({ success: true, data: { product: hitProduct, batch: null, stock: 5, matchType: 'additional' } }, '111').type,
  'hit'
);
check(
  'batch match is a hit and pins the batch',
  resolveScanLookup({ success: true, data: { product: hitProduct, batch: { id: 'b9' }, stock: 5, matchType: 'batch' } }, 'B-2026-001').batch,
  { id: 'b9' }
);
check(
  'name (fuzzy) match is a MISS for scans',
  resolveScanLookup({ success: true, data: { product: hitProduct, batch: null, stock: 5, matchType: 'name' } }, 'panadol').type,
  'miss'
);
check(
  '404 response is a miss',
  resolveScanLookup({ success: false, message: 'Product not found' }, '0000000000000').type,
  'miss'
);
check('null response is a miss', resolveScanLookup(null, '12345678').type, 'miss');
check(
  'no matchType + exact barcode equality is a hit',
  resolveScanLookup({ success: true, data: { product: hitProduct, batch: null, stock: 1 } }, '8901234567890').type,
  'hit'
);
check(
  'no matchType + no equality is a miss',
  resolveScanLookup({ success: true, data: { product: hitProduct, batch: null, stock: 1 } }, '9999999999999').type,
  'miss'
);

// --- Business-type applicability + setting resolution -----------------------
check('pharmacy applicable', isBarcodeApplicableBusinessType('PHARMACY'), true);
check('departmental store applicable', isBarcodeApplicableBusinessType('DEPARTMENTAL_STORE'), true);
check('retail store applicable', isBarcodeApplicableBusinessType('RETAIL_STORE'), true);
check('hotel not applicable', isBarcodeApplicableBusinessType('HOTEL'), false);
check('clinic not applicable', isBarcodeApplicableBusinessType('CLINIC'), false);
check('unnormalized type still resolves', isBarcodeApplicableBusinessType('departmental store'), true);
check('empty type falls through', isBarcodeApplicableBusinessType(''), true);

check('unset setting defaults ON for pharmacy', resolveBarcodeScanningEnabled(null, 'PHARMACY'), true);
check('explicit false wins', resolveBarcodeScanningEnabled('false', 'PHARMACY'), false);
check('explicit true on retail', resolveBarcodeScanningEnabled('true', 'RETAIL_STORE'), true);
check('hotel is off even when unset', resolveBarcodeScanningEnabled(null, 'HOTEL'), false);
check('hotel is off even when set true', resolveBarcodeScanningEnabled('true', 'HOTEL'), false);
check('boolean false respected', resolveBarcodeScanningEnabled(false, 'DEPARTMENTAL_STORE'), false);

console.log(`\nBarcode scan engine test: ${passed}/${passed + failed} passed`);
if (failed > 0) process.exit(1);
