// ─── JazzCash SecureHash (HMAC-SHA256) ─────────────────────────────────────
// Implements JazzCash Payment Gateway Integration Guide v4.2, §14.2
// ("How is SHA256-HMAC Calculated"), as shipped in the vendor's own
// sandbox onboarding mail (API Docs JazzCash.pdf, "How is HMAC-SHA256
// calculated?"):
//
//   1. The calculation includes all PP fields — every field whose name
//      begins with "pp" (case-insensitive).
//   2. Field VALUES are concatenated in ascending alphabetical order of
//      the field name, joined with '&' after every field except the last.
//      Empty values (null / undefined / '') are SKIPPED — this is what the
//      vendor's own PHP sample does (`if ($HashArray[$i] != "")`) and
//      what the published worked example shows (pp_BankID '' and
//      pp_ProductID '' contribute nothing to the string).
//   3. The Integrity Salt (shared secret) is PREPENDED to that string,
//      joined with '&' as well.
//   4. The string is HMAC-SHA256-hashed with the Integrity Salt as the
//      key (UTF-8), and the output is hex-encoded, UPPERCASE.
//
// Field order subtlety: the vendor's worked example lists ppmpf_1..5
// AFTER pp_TxnRefNo, which is NOT strict ASCII order ('ppmpf' <
// 'pp_Txn...'). The vendor's PHP sample likewise hashes ppmpf_1..5 last.
// So: ppmpf_* fields sort after every other pp_* field (in numeric
// order); all other pp_* fields sort case-insensitively by name.
//
// VERIFIED against four published vendor test vectors (see
// tests/jazzcash.test.ts — each recomputed here in Node before shipping):
//   salt 9208s6wx05, MWALLET-ish field set
//     -> 39ECAACFC30F9AFA1763B7E61EA33AC75977FB2E849A5EE1EDC4016791F3438F
//   salt 3vv9wu3a18, status inquiry {MC25041, sz1v4agvyf, T20220203110109}
//     -> 18494EE9B220CA4ADBE3ED5B597CCBF26E8C6F8BA205A9199A2EC8B87A2C0673
//   salt yxxsz9104y, card refund {10000, MC18746, a880tb6hat, PKR, TREF...}
//     -> EC7D0A8D704E0E0652BF69838FD3DB156C2C6D2F8AEB082A65D64E2EAC139865
//   salt 3vv9wu3a18, MWALLET refund {25000, MC25041, 1234, sz1v4agvyf, PKR, T20220518150213}
//     -> 2C595361C2DA0E502D18BFBAA92CF4740330215E5E8AD0CF4489A64E7400B117
//
// Do NOT "simplify" this to key=value pairs or a plain sorted join: a
// third-party blog's key=value variant contradicts the vendor docs and
// fails all four vectors above.
import * as crypto from 'crypto';

/** Fields that take part in a JazzCash hash: name + string value. */
export type JazzCashHashFields = Record<string, string | number | null | undefined>;

/** True for the pp_* fields the hash covers (ppmpf_* included). */
function isHashField(key: string): boolean {
  return key.toLowerCase().startsWith('pp');
}

/** True for the merchant-defined ppmpf_1..5 fields, which sort last. */
function isMerchantField(key: string): boolean {
  return key.toLowerCase().startsWith('ppmpf_');
}

/**
 * The exact string that gets HMAC'd: salt + '&' + the non-empty pp_*
 * field values in vendor order, joined with '&'.
 * Exported so tests (and the sandbox operator) can eyeball the string.
 */
export function buildJazzCashHashString(
  fields: JazzCashHashFields,
  salt: string
): string {
  const entries = Object.entries(fields).filter(
    ([key, value]) => isHashField(key) && value !== null && value !== undefined && String(value) !== ''
  );
  const regular = entries.filter(([key]) => !isMerchantField(key));
  const merchant = entries.filter(([key]) => isMerchantField(key));
  regular.sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()));
  merchant.sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const values = [...regular, ...merchant].map(([, value]) => String(value));
  return [salt, ...values].join('&');
}

/**
 * pp_SecureHash for a request/response field set. `fields` must NOT
 * contain pp_SecureHash itself (it is the output, never an input).
 */
export function computeJazzCashSecureHash(fields: JazzCashHashFields, salt: string): string {
  const message = buildJazzCashHashString(fields, salt);
  return crypto.createHmac('sha256', salt).update(message, 'utf8').digest('hex').toUpperCase();
}

/**
 * Verify a received hash (request from JazzCash, or a vendor response).
 * `fields` is the full received field set INCLUDING pp_SecureHash /
 * secureHash — the hash fields are excluded automatically. Comparison
 * is timing-safe. Returns false (never throws) for a missing/empty
 * received hash.
 */
export function verifyJazzCashSecureHash(
  fields: JazzCashHashFields,
  salt: string,
  receivedHash?: string | null
): boolean {
  if (!receivedHash) return false;
  const { pp_SecureHash: _pp, secureHash: _lower, ...rest } = fields as Record<string, unknown>;
  void _pp;
  void _lower;
  const expected = computeJazzCashSecureHash(rest as JazzCashHashFields, salt);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const receivedBuf = Buffer.from(String(receivedHash).toUpperCase(), 'utf8');
  if (expectedBuf.length !== receivedBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, receivedBuf);
}
