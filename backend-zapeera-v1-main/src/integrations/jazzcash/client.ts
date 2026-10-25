// ─── JazzCash vendor client ───────────────────────────────────────────────
// Endpoint + wire helpers for the JazzCash Payment Gateway REST APIs
// (Sandbox Documentation v4.2,
// https://sandbox.jazzcash.com.pk/SandboxDocumentation/v4.2/index.html
// and ApiReferences.html).
//
// ENDPOINT EVIDENCE — which URLs are vendor-published vs corroborated:
//   VERIFIED (vendor's own sandbox guide / ApiReferences):
//     PaymentInquiry/Inquire, Purchase/domwalletrefundtransaction,
//     authorize/Refund, 4.0/purchase/domwallettransactionviatoken,
//     CustomerPortal/transactionmanagement/merchantform (page redirect).
//   CORROBORATED (two independent implementations + the same
//   /ApplicationAPI/API/* path family as the verified endpoints; NOT on
//   the vendor's public reference pages): Payment/DoTransaction, used
//   for MWALLET + OTC initiation. Confirm it on the first sandbox call
//   (the sandbox API-testing UI shows the exact URL per operation) —
//   it is a single constant below, so a correction is one line.
//   NOT PUBLISHED anywhere public (do not guess): the Bank Account
//   Validate-Customer / Pay / Get-Banks URLs and the OTC voucher-refund
//   URL. Those flows throw NOT_IMPLEMENTED until the URLs are confirmed
//   in the sandbox API-testing UI. See index.ts.
//
// Money: JazzCash amounts are paisas (PKR x 100, no decimal point — the
// gateway treats the last two digits as the decimal). This module is
// the ONLY place that converts; the handler interface speaks PKR.
import { IntegrationError, mapVendorError, withVendorRetry } from '../vendor-client';

export const JAZZCASH_SANDBOX_BASE = 'https://sandbox.jazzcash.com.pk';
export const JAZZCASH_PRODUCTION_BASE = 'https://payments.jazzcash.com.pk';

/** REST operation paths (no leading host). */
export const JAZZCASH_PATHS = {
  /** Payment initiation (MWALLET + OTC). See evidence note above. */
  doTransaction: '/ApplicationAPI/API/Payment/DoTransaction',
  /** Transaction status inquiry. */
  inquiry: '/ApplicationAPI/API/PaymentInquiry/Inquire',
  /** Mobile-account (MWALLET) refund. */
  mwalletRefund: '/ApplicationAPI/API/Purchase/domwalletrefundtransaction',
  /** Card (direct-pay) refund. */
  cardRefund: '/ApplicationAPI/API/authorize/Refund',
  /** Mobile-account payment via a previously linked wallet token (v4.0). */
  tokenPayment: '/ApplicationAPI/API/4.0/purchase/domwallettransactionviatoken',
  /** Page-redirection merchant form (card + OTC via hosted page). */
  merchantForm: '/CustomerPortal/transactionmanagement/merchantform/'
} as const;

/**
 * Sandbox by default — a provider build must NEVER move real money
 * unless the deployment opts in. Set JAZZCASH_ENVIRONMENT=production
 * on the server to use the live host (with live merchant credentials).
 */
export function resolveJazzCashEnvironment(): 'sandbox' | 'production' {
  return String(process.env.JAZZCASH_ENVIRONMENT || '').toLowerCase() === 'production'
    ? 'production'
    : 'sandbox';
}

export function jazzCashBaseUrl(environment?: 'sandbox' | 'production'): string {
  const env = environment ?? resolveJazzCashEnvironment();
  return env === 'production' ? JAZZCASH_PRODUCTION_BASE : JAZZCASH_SANDBOX_BASE;
}

/** PKR rupees -> JazzCash paisas string (no decimal point). */
export function toPaisa(amountPkr: number): string {
  return String(Math.round(amountPkr * 100));
}

/** JazzCash paisas -> PKR rupees. */
export function fromPaisa(paisa: string | number): number {
  return Math.round(Number(paisa) || 0) / 100;
}

/** JazzCash date-time format: yyyyMMddHHmmss (Asia/Karachi wall time). */
export function formatTxnDateTime(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * Merchant transaction reference: 'ZAP' + timestamp + 3 random digits.
 * JazzCash requires it unique per transaction and <= 20 chars
 * (alphanumeric). The 'ZAP' prefix marks it as a Zapeera reference.
 */
export function newTxnRefNo(prefix = 'ZAP'): string {
  const stamp = formatTxnDateTime().slice(2); // yymmddHHMMSS (12 chars)
  const random = String(Math.floor(Math.random() * 900) + 100);
  return `${prefix}${stamp}${random}`.slice(0, 20);
}

/** JazzCash strips these characters from pp_Description (replaced with a space). */
export function sanitizeDescription(text: string): string {
  return text.replace(/[<>\*=%/:'\\\|"{}]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
}

/**
 * POST a JSON body to a JazzCash endpoint with the framework's retry +
 * error mapping. Returns the parsed JSON body. HTTP errors surface as
 * IntegrationError via mapVendorError (401/403 -> VENDOR_AUTH, 429 ->
 * VENDOR_RATE_LIMIT, 5xx/network -> retryable). A non-JSON or empty
 * body surfaces as VENDOR_ERROR — JazzCash business errors
 * (pp_ResponseCode != '000') are NOT thrown here; the caller maps them,
 * because a declined payment is a result, not a transport failure.
 */
export async function postToJazzCash(url: string, body: Record<string, unknown>): Promise<any> {
  const response = await withVendorRetry('jazzcash', async (signal) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal
    });
    if (!res.ok) {
      const error: any = new Error(`JazzCash HTTP ${res.status}`);
      error.response = { status: res.status };
      throw error;
    }
    return res;
  });
  try {
    return await response.json();
  } catch {
    throw new IntegrationError('VENDOR_ERROR', 'jazzcash: the vendor returned a response that could not be read as JSON.');
  }
}

/** Read a pp_* field tolerating the vendor's mixed casing (pp_X vs pp_x). */
export function pp(body: any, key: string): string {
  if (!body || typeof body !== 'object') return '';
  if (typeof body[key] === 'string' || typeof body[key] === 'number') return String(body[key]);
  const lower = key.toLowerCase();
  for (const k of Object.keys(body)) {
    if (k.toLowerCase() === lower && (typeof body[k] === 'string' || typeof body[k] === 'number')) {
      return String(body[k]);
    }
  }
  return '';
}

/** Vendor operation response code, tolerating pp_ResponseCode / responseCode casing. */
export function responseCodeOf(body: any): string {
  return pp(body, 'pp_ResponseCode') || pp(body, 'responseCode');
}

/** Vendor operation response message, tolerating casing. */
export function responseMessageOf(body: any): string {
  return pp(body, 'pp_ResponseMessage') || pp(body, 'responseMessage') || '';
}

/** Payment-transaction status code from an inquiry response. */
export function paymentResponseCodeOf(body: any): string {
  return pp(body, 'pp_PaymentResponseCode');
}

// ─── JazzCash payment response codes (Integration Guide v4.2, App. I) ────
// 000 success · 121 completed/confirmed · 124 OTC waiting for over-the-
// counter payment · 131 refunded · 157 pending (MWALLET/MIGS) · 101
// invalid merchant credentials · 109 transaction does not exist ·
// 115 invalid hash · 199/999 system error / failed.
export const JAZZCASH_SUCCESS_CODE = '000';
export const JAZZCASH_COMPLETED_CODE = '121';
export const JAZZCASH_OTC_WAITING_CODE = '124';
export const JAZZCASH_REFUNDED_CODE = '131';
export const JAZZCASH_PENDING_CODE = '157';
export const JAZZCASH_NOT_FOUND_CODE = '109';
export const JAZZCASH_INVALID_CREDENTIALS_CODE = '101';

/** Retryable vendor-side failures (system errors / host issues). */
export function isRetryableResponseCode(code: string): boolean {
  return code === '199' || code === '999' || code === '055' || code === '058';
}

export function mapVendorErrorForResponse(code: string, message: string): IntegrationError {
  if (code === JAZZCASH_INVALID_CREDENTIALS_CODE) {
    return new IntegrationError(
      'VENDOR_AUTH',
      'jazzcash: the vendor rejected these credentials (code 101). Check the Merchant ID / password and reconnect.'
    );
  }
  return new IntegrationError(
    'VENDOR_ERROR',
    `jazzcash: the vendor declined the request (code ${code}${message ? ` — ${message.slice(0, 100)}` : ''}).`,
    { vendorCode: code, retryable: isRetryableResponseCode(code) }
  );
}
