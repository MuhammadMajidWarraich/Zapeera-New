// ─── JazzCash payment rail (feature/integration-jazzcash) ─────────────────
// Implements IntegrationSyncHandler for provider 'jazzcash' (registry
// entry already exists: merchantId, password*, salt*; HMAC-signing).
//
// VENDOR EVIDENCE — JazzCash Payment Gateway Integration Guide v4.2
// (sandbox.jazzcash.com.pk/SandboxDocumentation/v4.2/, ApiReferences.html)
// + the vendor's sandbox onboarding mail ("API Docs JazzCash.pdf").
// Amounts are PKR major units at this layer; paisas (x100) only on the
// wire (see ./client.ts). No real money moves in the sandbox by default:
// JAZZCASH_ENVIRONMENT must be 'production' on the server for the live
// host, and live needs live merchant credentials.
//
// WHAT THIS RAIL DOES
//   connect / getStatus — verifies MerchantID + Password + Salt with a
//     Status-Inquiry probe (see verifyCredentialsWithInquiryProbe).
//     JazzCash publishes NO cheap "get account" read; the probe is the
//     honest substitute and the code says so.
//   processPayment — MWALLET (REST v2.0) and OTC (REST v1.1) via
//     Payment/DoTransaction; card via the signed page-redirection form
//     (no card data ever touches this server); bank-account NOT
//     implemented — its Validate-Customer / Pay endpoint URLs are not
//     published in the public docs (see processBankAccountPayment).
//     A CONFIRMED payment is recorded on the SAME sale ledger a cash
//     payment lands on: SalePayment { method: 'JAZZCASH', reference:
//     JazzCash RRN } + Sale.paidAmount / paymentStatus / paymentMethod.
//     Pending/failed payments record NOTHING.
//   inquirePayment — PaymentInquiry/Inquire; pp_PaymentResponseCode
//     '121' is the completed-transaction signal (the guide: "To confirm
//     the transaction status, the pp_PaymentResponseCode parameter will
//     be considered").
//   refundPayment — MWALLET refund (domwalletrefundtransaction, needs
//     the merchant's own MPIN per call, never stored) and card refund
//     (authorize/Refund). Creates NO local Refund row — the refund
//     controller owns that; this only moves the money back. OTC voucher
//     refund is NOT implemented (endpoint URL not published).
//   IPN / Return — handleJazzCashIpn / handleJazzCashReturn (called by
//     the public routes in src/routes/jazzcash-ipn.routes.ts). Every
//     callback is hash-verified against the connection's salt; a
//     confirmed IPN is reconciled through Status Inquiry and recorded
//     idempotently (same IPN twice = one SalePayment). JazzCash retries
//     a failed IPN 3 times; a 000 ack stops the retries.
//
// NEVER LOG a request/response body: IPN payloads carry pp_Password in
// plaintext. Only txnRefNo + outcome codes are logged, and only by the
// controller.
import { decryptIntegrationCredentials } from '../../utils/integration-encryption.util';
import { registerIntegrationHandler } from '../registry';
import type {
  IntegrationPaymentInquiryResult,
  IntegrationPaymentRequest,
  IntegrationPaymentResult,
  IntegrationRefundRequest,
  IntegrationRefundResult,
  IntegrationSyncContext,
  IntegrationSyncHandler
} from '../types';
import { IntegrationError } from '../vendor-client';
import { computeJazzCashSecureHash, verifyJazzCashSecureHash } from './secure-hash';
import {
  JAZZCASH_COMPLETED_CODE,
  JAZZCASH_INVALID_CREDENTIALS_CODE,
  JAZZCASH_NOT_FOUND_CODE,
  JAZZCASH_OTC_WAITING_CODE,
  JAZZCASH_PATHS,
  JAZZCASH_PENDING_CODE,
  JAZZCASH_REFUNDED_CODE,
  JAZZCASH_SUCCESS_CODE,
  formatTxnDateTime,
  fromPaisa,
  jazzCashBaseUrl,
  newTxnRefNo,
  pp,
  paymentResponseCodeOf,
  postToJazzCash,
  responseCodeOf,
  responseMessageOf,
  sanitizeDescription,
  toPaisa
} from './client';

export interface JazzCashCredentials {
  merchantId: string;
  password: string;
  salt: string;
}

function parseCredentials(credentials: Record<string, unknown>): JazzCashCredentials {
  const merchantId = String(credentials.merchantId ?? '').trim();
  const password = String(credentials.password ?? '');
  const salt = String(credentials.salt ?? '');
  if (!merchantId || !password || !salt) {
    throw new IntegrationError(
      'VENDOR_AUTH',
      'jazzcash: Merchant ID, password and integrity salt are all required. Reconnect with all three.'
    );
  }
  return { merchantId, password, salt };
}

/** Attach the vendor signature to a request field set. */
function signedBody(
  creds: JazzCashCredentials,
  fields: Record<string, string>
): Record<string, string> {
  return { ...fields, pp_SecureHash: computeJazzCashSecureHash(fields, creds.salt) };
}

/**
 * Verify a vendor response hash when one is present. A mismatch means
 * the response cannot be trusted — the caller must NOT record money on
 * it. No hash at all is tolerated (some operations omit it) and noted
 * in the message for the sandbox operator to confirm.
 */
function assertResponseHash(body: any, salt: string, what: string): void {
  const received = pp(body, 'pp_SecureHash') || pp(body, 'secureHash');
  if (!received) return;
  if (!verifyJazzCashSecureHash(body, salt, received)) {
    throw new IntegrationError(
      'VENDOR_ERROR',
      `jazzcash: the ${what} response signature could not be verified — the payment was NOT recorded.`
    );
  }
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** The Return URL JazzCash POSTs page-redirection results to. */
export function resolveJazzCashReturnUrl(): string | null {
  const url = String(process.env.JAZZCASH_RETURN_URL || '').trim();
  return url || null;
}

// ─── Credential verification ──────────────────────────────────────────────
// JazzCash publishes no "get merchant" / account read. The cheapest
// vendor round-trip that proves MerchantID + Password + Salt is the
// Status Inquiry API (PaymentInquiry/Inquire — endpoint + shapes are
// vendor-published): it takes { pp_TxnRefNo, pp_MerchantID, pp_Password,
// pp_SecureHash } and returns pp_ResponseCode '000' when the OPERATION
// succeeded, with pp_PaymentResponseCode carrying the transaction
// outcome. We inquire a probe reference that cannot exist
// ('ZV' + timestamp): a 000 operation code proves the credentials
// authenticate (the payment code is then '109', transaction does not
// exist — expected); code '101' proves they do not. This is a real
// vendor round-trip, not a format check — connect() never returns
// { ok: true } without it.
async function verifyCredentialsWithInquiryProbe(
  creds: JazzCashCredentials
): Promise<{ ok: boolean; message: string }> {
  const probeRefNo = newTxnRefNo('ZV');
  const body = await postToJazzCash(
    `${jazzCashBaseUrl()}${JAZZCASH_PATHS.inquiry}`,
    signedBody(creds, {
      pp_TxnRefNo: probeRefNo,
      pp_MerchantID: creds.merchantId,
      pp_Password: creds.password
    })
  );
  const code = responseCodeOf(body);
  if (code === JAZZCASH_SUCCESS_CODE) {
    assertResponseHash(body, creds.salt, 'status inquiry');
    return {
      ok: true,
      message:
        'JazzCash merchant credentials verified (status-inquiry probe accepted by the gateway).'
    };
  }
  if (code === JAZZCASH_INVALID_CREDENTIALS_CODE) {
    return {
      ok: false,
      message: 'JazzCash rejected the merchant credentials (code 101). Check the Merchant ID / password and reconnect.'
    };
  }
  return {
    ok: false,
    message: `JazzCash did not accept the verification probe (response code ${code || 'unknown'}${responseMessageOf(body) ? ` — ${responseMessageOf(body)}` : ''}).`
  };
}

async function callInquiry(creds: JazzCashCredentials, txnRefNo: string): Promise<any> {
  return postToJazzCash(
    `${jazzCashBaseUrl()}${JAZZCASH_PATHS.inquiry}`,
    signedBody(creds, {
      pp_TxnRefNo: txnRefNo,
      pp_MerchantID: creds.merchantId,
      pp_Password: creds.password
    })
  );
}

function inquiryToResult(txnRefNo: string, body: any): IntegrationPaymentInquiryResult {
  const paymentCode = paymentResponseCodeOf(body);
  const status =
    paymentCode === JAZZCASH_COMPLETED_CODE
      ? 'completed'
      : paymentCode === JAZZCASH_REFUNDED_CODE
        ? 'refunded'
        : paymentCode === JAZZCASH_OTC_WAITING_CODE || paymentCode === JAZZCASH_PENDING_CODE
          ? 'pending'
          : paymentCode === JAZZCASH_NOT_FOUND_CODE
            ? 'unknown'
            : 'failed';
  return {
    status,
    responseCode: responseCodeOf(body),
    paymentResponseCode: paymentCode,
    paymentResponseMessage: pp(body, 'pp_PaymentResponseMessage') || responseMessageOf(body),
    retrievalReferenceNo: pp(body, 'pp_RetrievalReferenceNo') || pp(body, 'pp_RetreivalReferenceNo') || null,
    authCode: pp(body, 'pp_AuthCode') || null,
    txnRefNo
  };
}

// ─── Sale ledger (the EXISTING payment path — no parallel ledger) ────────
// Mirrors createSale's tender recording (sale.controller.ts, Wave B1):
// one SalePayment row per tender allocation { method, amount, reference }
// and Sale.paidAmount / paymentStatus / paymentMethod maintained from
// the allocations. 'JAZZCASH' is already a first-class method in
// SALE_PAYMENT_METHODS; the headline is the single tender or 'MIXED'.
async function loadSaleForPayment(prisma: any, businessId: string, saleId: string): Promise<any> {
  const sale = await prisma.sale.findFirst({
    where: { id: saleId, companyId: businessId },
    include: { payments: true }
  });
  if (!sale) {
    throw new Error(`Sale "${saleId}" was not found in this business.`);
  }
  return sale;
}

function assertSaleCanTakePayment(sale: any, amountPkr: number): void {
  if (sale.status === 'REFUNDED' || sale.paymentStatus === 'REFUNDED') {
    throw new Error(`Sale "${sale.id}" has already been refunded and cannot take a payment.`);
  }
  if (!(amountPkr > 0)) {
    throw new Error('Payment amount must be greater than zero.');
  }
  const remaining = round2((sale.totalAmount || 0) - (sale.paidAmount || 0));
  if (amountPkr > remaining + 0.009) {
    throw new Error(
      `Payment of PKR ${amountPkr} exceeds the sale's remaining balance of PKR ${remaining}.`
    );
  }
}

async function recordPaymentOnSale(
  prisma: any,
  sale: any,
  amountPkr: number,
  reference: string
): Promise<{ duplicate: boolean }> {
  // Idempotency: the same JazzCash RRN must never create two allocations.
  // (IPN retries + a manual inquiry racing the IPN both land here.)
  const existing = await prisma.salePayment.findFirst({
    where: { saleId: sale.id, method: 'JAZZCASH', reference }
  });
  if (existing) return { duplicate: true };

  const run = async (tx: any) => {
    await tx.salePayment.create({
      data: {
        saleId: sale.id,
        method: 'JAZZCASH',
        amount: round2(amountPkr),
        reference
      }
    });
    const methods = new Set<string>([
      ...((sale.payments || []) as any[]).map((p: any) => String(p.method)),
      'JAZZCASH'
    ]);
    const newPaid = round2((sale.paidAmount || 0) + amountPkr);
    await tx.sale.update({
      where: { id: sale.id },
      data: {
        paidAmount: newPaid,
        paymentStatus: newPaid >= round2(sale.totalAmount || 0) - 0.009 ? 'COMPLETED' : 'PENDING',
        paymentMethod: methods.size === 1 ? 'JAZZCASH' : 'MIXED'
      }
    });
  };
  if (typeof prisma.$transaction === 'function') {
    await prisma.$transaction(run);
  } else {
    await run(prisma);
  }
  return { duplicate: false };
}

// ─── Payment initiation ───────────────────────────────────────────────────
function basePaymentFields(
  creds: JazzCashCredentials,
  sale: any,
  req: IntegrationPaymentRequest,
  txnRefNo: string,
  txnDateTime: string,
  expiryDateTime: string
): Record<string, string> {
  return {
    pp_Language: 'EN',
    pp_MerchantID: creds.merchantId,
    pp_SubMerchantID: '',
    pp_Password: creds.password,
    pp_TxnRefNo: txnRefNo,
    pp_Amount: toPaisa(req.amount),
    pp_TxnCurrency: 'PKR',
    pp_TxnDateTime: txnDateTime,
    pp_BillReference: req.billReference || sale.invoiceNumber || sale.id,
    pp_Description: sanitizeDescription(
      req.description || `Zapeera sale ${sale.invoiceNumber || sale.id} — JazzCash`
    ),
    pp_TxnExpiryDateTime: expiryDateTime,
    ppmpf_1: sale.id, // merchant field: lets the IPN/Return find this sale
    ppmpf_2: '',
    ppmpf_3: '',
    ppmpf_4: '',
    ppmpf_5: ''
  };
}

function failedPayment(
  req: IntegrationPaymentRequest,
  txnRefNo: string,
  responseCode: string,
  responseMessage: string
): IntegrationPaymentResult {
  return {
    status: 'failed',
    txnRefNo,
    retrievalReferenceNo: null,
    authCode: null,
    responseCode,
    responseMessage,
    amount: req.amount,
    method: req.method,
    saleId: req.saleId
  };
}

/** Mobile Account (MWALLET) — REST v2.0 (CNIC enablement). */
async function processMobileAccountPayment(
  creds: JazzCashCredentials,
  prisma: any,
  sale: any,
  req: IntegrationPaymentRequest
): Promise<IntegrationPaymentResult> {
  if (!req.mobileNumber?.trim()) {
    throw new Error('Customer mobile number is required for a JazzCash mobile-account payment.');
  }
  if (!req.cnicLast6?.trim()) {
    throw new Error('Last 6 digits of the customer CNIC are required for a JazzCash mobile-account payment.');
  }
  const txnRefNo = newTxnRefNo();
  const now = new Date();
  const expiry = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const fields: Record<string, string> = {
    ...basePaymentFields(creds, sale, req, txnRefNo, formatTxnDateTime(now), formatTxnDateTime(expiry)),
    pp_MobileNumber: req.mobileNumber.trim(),
    pp_CNIC: req.cnicLast6.trim(),
    pp_DiscountedAmount: ''
  };
  const body = await postToJazzCash(
    `${jazzCashBaseUrl()}${JAZZCASH_PATHS.doTransaction}`,
    signedBody(creds, fields)
  );
  const code = responseCodeOf(body);
  const message = responseMessageOf(body);
  const rrn = pp(body, 'pp_RetrievalReferenceNo') || pp(body, 'pp_RetreivalReferenceNo') || null;
  if (code === JAZZCASH_SUCCESS_CODE) {
    assertResponseHash(body, creds.salt, 'mobile-account payment');
    await recordPaymentOnSale(prisma, sale, req.amount, rrn || txnRefNo);
    return {
      status: 'success',
      txnRefNo,
      retrievalReferenceNo: rrn,
      authCode: pp(body, 'pp_AuthCode') || null,
      responseCode: code,
      responseMessage: message,
      amount: req.amount,
      method: 'mobile-account',
      saleId: req.saleId
    };
  }
  if (code === JAZZCASH_PENDING_CODE) {
    // 157: wallet payment pending — the customer has not approved it
    // yet (MPIN prompt). Money has NOT moved: record nothing. The
    // caller confirms later via inquirePayment (or the IPN).
    return {
      status: 'pending',
      txnRefNo,
      retrievalReferenceNo: rrn,
      authCode: null,
      responseCode: code,
      responseMessage: message || 'Mobile-account payment is pending customer approval.',
      amount: req.amount,
      method: 'mobile-account',
      saleId: req.saleId,
      nextStep: 'Ask the customer to approve the MPIN prompt, then confirm with status inquiry.'
    };
  }
  return failedPayment(req, txnRefNo, code, message);
}

/** Over-the-counter voucher (OTC) — REST v1.1. */
async function processOtcPayment(
  creds: JazzCashCredentials,
  sale: any,
  req: IntegrationPaymentRequest
): Promise<IntegrationPaymentResult> {
  const txnRefNo = newTxnRefNo();
  const now = new Date();
  const expiry = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const returnUrl = resolveJazzCashReturnUrl();
  const fields: Record<string, string> = {
    pp_Version: '1.1',
    pp_TxnType: 'OTC',
    ...basePaymentFields(creds, sale, req, txnRefNo, formatTxnDateTime(now), formatTxnDateTime(expiry)),
    pp_BankID: '',
    pp_ProductID: '',
    pp_ReturnURL: returnUrl ?? ''
  };
  const body = await postToJazzCash(
    `${jazzCashBaseUrl()}${JAZZCASH_PATHS.doTransaction}`,
    signedBody(creds, fields)
  );
  const code = responseCodeOf(body);
  const message = responseMessageOf(body);
  const rrn = pp(body, 'pp_RetrievalReferenceNo') || pp(body, 'pp_RetreivalReferenceNo') || null;
  if (code === JAZZCASH_OTC_WAITING_CODE || code === JAZZCASH_SUCCESS_CODE) {
    // 124: voucher issued, waiting for over-the-counter payment. No
    // money has moved — record nothing; the IPN / inquiry confirms
    // the cash payment at the retailer later.
    return {
      status: 'pending',
      txnRefNo,
      retrievalReferenceNo: rrn,
      authCode: pp(body, 'pp_AuthCode') || null,
      responseCode: code,
      responseMessage: message || 'Voucher issued — waiting for payment over the counter.',
      amount: req.amount,
      method: 'otc',
      saleId: req.saleId,
      voucherNo: rrn,
      nextStep: 'Give the customer the voucher number; they pay it at any JazzCash retailer.'
    };
  }
  return failedPayment(req, txnRefNo, code, message);
}

/**
 * Bank Account — NOT IMPLEMENTED in v1.
 * The request/response shapes ARE in the public docs (Validate Customer
 * takes bankId/accountNo/CNIC/mobile/email; Pay takes the OTP), but the
 * endpoint URLs for Validate Customer, Pay and Get Banks are NOT
 * published anywhere public — the sandbox API-testing UI shows the URL
 * per operation. Inventing a URL would send customer bank details to a
 * wrong address, so this returns a failed result naming the gap instead
 * of calling anything. Enable it once the URLs are confirmed in the
 * sandbox UI (one constant each in ./client.ts).
 */
function processBankAccountPayment(
  req: IntegrationPaymentRequest
): IntegrationPaymentResult {
  return failedPayment(
    req,
    '',
    '',
    'Bank-account payments are not enabled: the JazzCash Validate-Customer / Pay endpoint URLs are not published in the public docs. Confirm them in the sandbox API-testing UI, then enable the flow.'
  );
}

/**
 * Card — page redirection (hosted form), NOT a server-side card call.
 * JazzCash card payments need 3-D Secure enrollment + payer
 * authentication in the customer's browser; collecting card numbers
 * server-side would put Zapeera in PCI scope for no benefit. We build
 * the SIGNED form fields (Integration Guide v4.2 §5.2 / vendor PHP
 * sample) and hand them back: the caller POSTs the customer to the
 * JazzCash merchant form, JazzCash POSTs the result to the Return URL,
 * and the IPN / inquiry records the payment. Nothing is recorded here.
 */
function processCardPayment(
  creds: JazzCashCredentials,
  sale: any,
  req: IntegrationPaymentRequest
): IntegrationPaymentResult {
  const returnUrl = resolveJazzCashReturnUrl();
  if (!returnUrl) {
    return failedPayment(
      req,
      '',
      '',
      'Card payments need JAZZCASH_RETURN_URL set on the server (the HTTPS URL JazzCash POSTs the result to — it must match the Return URL registered in the JazzCash portal).'
    );
  }
  const txnRefNo = newTxnRefNo();
  const now = new Date();
  const expiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const fields: Record<string, string> = {
    pp_Version: '2.0',
    pp_TxnType: '',
    ...basePaymentFields(creds, sale, req, txnRefNo, formatTxnDateTime(now), formatTxnDateTime(expiry)),
    pp_ReturnURL: returnUrl,
    pp_IsRegisteredCustomer: 'No',
    pp_BankID: '',
    pp_ProductID: ''
  };
  return {
    status: 'redirect',
    txnRefNo,
    retrievalReferenceNo: null,
    authCode: null,
    responseCode: '',
    responseMessage: 'Redirect the customer to JazzCash to pay by card.',
    amount: req.amount,
    method: 'card',
    saleId: req.saleId,
    redirectUrl: `${jazzCashBaseUrl()}${JAZZCASH_PATHS.merchantForm}`,
    redirectFields: signedBody(creds, fields),
    nextStep: 'POST the customer to the JazzCash form with these fields; the result comes back to the Return URL.'
  };
}

// ─── IPN / Return reconciliation ──────────────────────────────────────────
export interface JazzCashIpnOutcome {
  ok: boolean;
  code: string;
  message: string;
  duplicate?: boolean;
  saleId?: string | null;
  txnRefNo?: string;
  retrievalReferenceNo?: string | null;
}

export interface JazzCashReturnOutcome {
  status: 'success' | 'pending' | 'failed';
  saleId?: string | null;
  txnRefNo: string;
  retrievalReferenceNo?: string | null;
  amountPkr?: number;
  message: string;
}

async function resolveCallbackContext(
  prisma: any,
  body: any
): Promise<
  | { ok: true; sale: any; creds: JazzCashCredentials }
  | { ok: false; code: string; message: string }
> {
  const txnRefNo = pp(body, 'pp_TxnRefNo');
  const receivedHash = pp(body, 'pp_SecureHash') || pp(body, 'secureHash');
  if (!txnRefNo || !receivedHash) {
    return { ok: false, code: 'INVALID_CALLBACK', message: 'Callback is missing pp_TxnRefNo or pp_SecureHash.' };
  }
  // The sale is found via ppmpf_1 (set at initiation) or, failing that,
  // via pp_BillReference (the sale invoice number).
  let sale: any = null;
  const saleId = pp(body, 'ppmpf_1');
  if (saleId) {
    sale = await prisma.sale.findFirst({ where: { id: saleId }, include: { payments: true } });
  }
  if (!sale) {
    const billRef = pp(body, 'pp_BillReference');
    if (billRef) {
      sale = await prisma.sale.findFirst({ where: { invoiceNumber: billRef }, include: { payments: true } });
    }
  }
  if (!sale) {
    return { ok: false, code: 'UNKNOWN_SALE', message: `No Zapeera sale matches this callback (txn ${txnRefNo}).` };
  }
  const connection = await prisma.integrationConnection.findUnique({
    where: { businessId_provider: { businessId: sale.companyId, provider: 'jazzcash' } }
  });
  if (!connection?.encryptedCredentials || connection.status !== 'connected') {
    return { ok: false, code: 'NOT_CONNECTED', message: 'No connected JazzCash account for this sale’s business.' };
  }
  const creds = parseCredentials(decryptIntegrationCredentials(connection.encryptedCredentials));
  if (!verifyJazzCashSecureHash(body, creds.salt, receivedHash)) {
    return { ok: false, code: 'BAD_HASH', message: 'Callback signature verification failed — nothing was recorded.' };
  }
  return { ok: true, sale, creds };
}

/** Reconcile one vendor-confirmed transaction against its sale. */
async function reconcileConfirmedPayment(
  prisma: any,
  sale: any,
  creds: JazzCashCredentials,
  txnRefNo: string,
  body: any
): Promise<JazzCashIpnOutcome> {
  const rrn = pp(body, 'pp_RetrievalReferenceNo') || pp(body, 'pp_RetreivalReferenceNo') || null;
  try {
    const inquiryBody = await callInquiry(creds, txnRefNo);
    if (responseCodeOf(inquiryBody) !== JAZZCASH_SUCCESS_CODE) {
      return {
        ok: false,
        code: 'INQUIRY_FAILED',
        message: `Status inquiry did not succeed (code ${responseCodeOf(inquiryBody) || 'unknown'}) — the callback will be retried.`,
        saleId: sale.id,
        txnRefNo,
        retrievalReferenceNo: rrn
      };
    }
    const inquiry = inquiryToResult(txnRefNo, inquiryBody);
    if (inquiry.status === 'completed') {
      const amountPkr = fromPaisa(pp(body, 'pp_Amount') || pp(inquiryBody, 'pp_Amount') || '0');
      const reference = inquiry.retrievalReferenceNo || rrn || txnRefNo;
      const recorded = await recordPaymentOnSale(prisma, sale, amountPkr, reference);
      return {
        ok: true,
        code: recorded.duplicate ? 'DUPLICATE' : 'RECORDED',
        message: recorded.duplicate
          ? 'Payment already recorded — duplicate callback ignored.'
          : `Payment of PKR ${amountPkr} recorded on the sale (RRN ${reference}).`,
        duplicate: recorded.duplicate,
        saleId: sale.id,
        txnRefNo,
        retrievalReferenceNo: reference
      };
    }
    if (inquiry.status === 'refunded') {
      return { ok: true, code: 'REFUNDED', message: 'Transaction is refunded — no payment recorded.', saleId: sale.id, txnRefNo, retrievalReferenceNo: rrn };
    }
    if (inquiry.status === 'pending') {
      return { ok: true, code: 'PENDING', message: 'Transaction still pending at JazzCash — nothing recorded yet.', saleId: sale.id, txnRefNo, retrievalReferenceNo: rrn };
    }
    return {
      ok: false,
      code: 'INQUIRY_UNKNOWN',
      message: `Status inquiry says the transaction is ${inquiry.status} (payment code ${inquiry.paymentResponseCode}) — the callback will be retried.`,
      saleId: sale.id,
      txnRefNo,
      retrievalReferenceNo: rrn
    };
  } catch (error) {
    const message = error instanceof IntegrationError ? error.message : 'Status inquiry failed.';
    return {
      ok: false,
      code: 'INQUIRY_FAILED',
      message: `${message} The callback will be retried.`,
      saleId: sale.id,
      txnRefNo,
      retrievalReferenceNo: rrn
    };
  }
}

/**
 * Handle a JazzCash REST IPN POST body. Returns ok:false when JazzCash
 * should retry (bad hash, unknown sale, inquiry failure — the vendor
 * retries 3 times); ok:true when the notification is settled (recorded,
 * duplicate, refunded, pending, or a non-payment notification). The
 * controller maps this to { pp_ResponseCode: '000' } (stop retrying) or
 * a non-000 code (retry). The body is NEVER logged (it carries
 * pp_Password in plaintext).
 */
export async function handleJazzCashIpn(prisma: any, body: any): Promise<JazzCashIpnOutcome> {
  const ctx = await resolveCallbackContext(prisma, body);
  if (!ctx.ok) return { ok: false, code: ctx.code, message: ctx.message, txnRefNo: pp(body, 'pp_TxnRefNo') || undefined };
  const { sale, creds } = ctx;
  const txnRefNo = pp(body, 'pp_TxnRefNo');
  const code = pp(body, 'pp_ResponseCode');
  const rrn = pp(body, 'pp_RetrievalReferenceNo') || pp(body, 'pp_RetreivalReferenceNo') || null;
  if (code === JAZZCASH_REFUNDED_CODE) {
    return { ok: true, code: 'REFUNDED', message: 'Refund notification acknowledged — no payment recorded.', saleId: sale.id, txnRefNo, retrievalReferenceNo: rrn };
  }
  if (code === JAZZCASH_OTC_WAITING_CODE) {
    return { ok: true, code: 'PENDING', message: 'OTC voucher still waiting for over-the-counter payment.', saleId: sale.id, txnRefNo, retrievalReferenceNo: rrn };
  }
  if (code === JAZZCASH_COMPLETED_CODE) {
    return reconcileConfirmedPayment(prisma, sale, creds, txnRefNo, body);
  }
  // Any other notification (failed transaction, etc.): nothing to
  // record — acknowledge so JazzCash stops retrying.
  return {
    ok: true,
    code: 'IGNORED',
    message: `Non-success payment notification (code ${code || 'unknown'}) acknowledged — nothing recorded.`,
    saleId: sale.id,
    txnRefNo,
    retrievalReferenceNo: rrn
  };
}

/**
 * Handle the page-redirection Return URL POST (card / OTC hosted flow).
 * The portal response uses pp_ResponseCode '000' for a successful
 * payment (not '121' — that is the IPN/inquiry code), so it is
 * reconciled through Status Inquiry the same way as an IPN, and the
 * outcome is rendered as a plain status page by the controller.
 */
export async function handleJazzCashReturn(prisma: any, body: any): Promise<JazzCashReturnOutcome> {
  const txnRefNo = pp(body, 'pp_TxnRefNo');
  const ctx = await resolveCallbackContext(prisma, body);
  if (!ctx.ok) {
    return { status: 'failed', txnRefNo, message: ctx.message };
  }
  const { sale, creds } = ctx;
  const code = responseCodeOf(body);
  if (code !== JAZZCASH_SUCCESS_CODE) {
    return {
      status: 'failed',
      saleId: sale.id,
      txnRefNo,
      message: responseMessageOf(body) || `JazzCash reported the payment as failed (code ${code || 'unknown'}).`
    };
  }
  const outcome = await reconcileConfirmedPayment(prisma, sale, creds, txnRefNo, body);
  if (outcome.ok && (outcome.code === 'RECORDED' || outcome.code === 'DUPLICATE')) {
    return {
      status: 'success',
      saleId: sale.id,
      txnRefNo,
      retrievalReferenceNo: outcome.retrievalReferenceNo ?? null,
      amountPkr: fromPaisa(pp(body, 'pp_Amount') || '0'),
      message: outcome.message
    };
  }
  if (outcome.ok && outcome.code === 'PENDING') {
    return { status: 'pending', saleId: sale.id, txnRefNo, message: outcome.message };
  }
  return { status: 'failed', saleId: sale.id, txnRefNo, message: outcome.message };
}

// ─── The handler ──────────────────────────────────────────────────────────
export const jazzCashHandler: IntegrationSyncHandler = {
  provider: 'jazzcash',

  async connect(credentials) {
    const creds = parseCredentials(credentials);
    return verifyCredentialsWithInquiryProbe(creds);
  },

  // JazzCash has no credential-revocation API: the framework wipes the
  // stored credentials, which is the whole disconnect.
  async disconnect() {
    return undefined;
  },

  async getStatus(credentials) {
    const creds = parseCredentials(credentials);
    return verifyCredentialsWithInquiryProbe(creds);
  },

  async processPayment(ctx: IntegrationSyncContext, req: IntegrationPaymentRequest): Promise<IntegrationPaymentResult> {
    const creds = parseCredentials(ctx.credentials);
    const sale = await loadSaleForPayment(ctx.prisma, ctx.businessId, req.saleId);
    assertSaleCanTakePayment(sale, req.amount);
    switch (req.method) {
      case 'mobile-account':
        return processMobileAccountPayment(creds, ctx.prisma, sale, req);
      case 'otc':
        return processOtcPayment(creds, sale, req);
      case 'bank-account':
        return processBankAccountPayment(req);
      case 'card':
        return processCardPayment(creds, sale, req);
      default:
        throw new Error(`Unsupported JazzCash payment method "${(req as any).method}".`);
    }
  },

  async refundPayment(ctx: IntegrationSyncContext, req: IntegrationRefundRequest): Promise<IntegrationRefundResult> {
    const creds = parseCredentials(ctx.credentials);
    // Scope the refund to a sale in this business; the gateway refund
    // itself is keyed by the original txn reference.
    await loadSaleForPayment(ctx.prisma, ctx.businessId, req.saleId);
    if (!(req.amount > 0)) throw new Error('Refund amount must be greater than zero.');
    if (!req.txnRefNo?.trim()) throw new Error('Original transaction reference (txnRefNo) is required for a refund.');

    if (req.method === 'mobile-account') {
      if (!req.merchantMpin?.trim()) {
        throw new Error('Merchant MPIN is required for a JazzCash mobile-account refund (supplied per call, never stored).');
      }
      const body = await postToJazzCash(
        `${jazzCashBaseUrl()}${JAZZCASH_PATHS.mwalletRefund}`,
        signedBody(creds, {
          pp_TxnRefNo: req.txnRefNo.trim(),
          pp_Amount: toPaisa(req.amount),
          pp_TxnCurrency: 'PKR',
          pp_MerchantID: creds.merchantId,
          pp_Password: creds.password,
          pp_MerchantMPIN: req.merchantMpin.trim()
        })
      );
      const code = responseCodeOf(body);
      if (code !== JAZZCASH_SUCCESS_CODE) {
        return {
          status: 'failed',
          responseCode: code,
          responseMessage: responseMessageOf(body),
          refundAmount: 0,
          totalRefundAmount: null,
          txnRefNo: req.txnRefNo
        };
      }
      assertResponseHash(body, creds.salt, 'mobile-account refund');
      return {
        status: 'success',
        responseCode: code,
        responseMessage: responseMessageOf(body),
        refundAmount: fromPaisa(pp(body, 'pp_RefundAmount') || toPaisa(req.amount)),
        totalRefundAmount: pp(body, 'pp_TotalRefundAmount') ? fromPaisa(pp(body, 'pp_TotalRefundAmount')) : null,
        txnRefNo: req.txnRefNo
      };
    }

    if (req.method === 'card') {
      const body = await postToJazzCash(
        `${jazzCashBaseUrl()}${JAZZCASH_PATHS.cardRefund}`,
        signedBody(creds, {
          pp_TxnRefNo: req.txnRefNo.trim(),
          pp_Amount: toPaisa(req.amount),
          pp_TxnCurrency: 'PKR',
          pp_MerchantID: creds.merchantId,
          pp_Password: creds.password
        })
      );
      // Card refund responses use lowercase field names.
      const code = responseCodeOf(body);
      if (code !== JAZZCASH_SUCCESS_CODE) {
        return {
          status: 'failed',
          responseCode: code,
          responseMessage: responseMessageOf(body),
          refundAmount: 0,
          totalRefundAmount: null,
          txnRefNo: req.txnRefNo
        };
      }
      assertResponseHash(body, creds.salt, 'card refund');
      return {
        status: 'success',
        responseCode: code,
        responseMessage: responseMessageOf(body),
        refundAmount: fromPaisa(pp(body, 'refundAmount') || toPaisa(req.amount)),
        totalRefundAmount: pp(body, 'totalRefundAmount') ? fromPaisa(pp(body, 'totalRefundAmount')) : null,
        txnRefNo: req.txnRefNo
      };
    }

    // OTC voucher refund: the request shape is documented
    // (pp_VoucherID + CNIC + amount) but the endpoint URL is not
    // published in the public docs — see the bank-account note above.
    return {
      status: 'failed',
      responseCode: '',
      responseMessage:
        'OTC voucher refunds are not enabled: the voucher-refund endpoint URL is not published in the public JazzCash docs. Confirm it in the sandbox API-testing UI, then enable the flow (it needs the voucher number from the original OTC payment).',
      refundAmount: 0,
      totalRefundAmount: null,
      txnRefNo: req.txnRefNo
    };
  },

  async inquirePayment(ctx: IntegrationSyncContext, txnRefNo: string): Promise<IntegrationPaymentInquiryResult> {
    const creds = parseCredentials(ctx.credentials);
    if (!txnRefNo?.trim()) throw new Error('Transaction reference (txnRefNo) is required for a status inquiry.');
    const body = await callInquiry(creds, txnRefNo.trim());
    const code = responseCodeOf(body);
    if (code !== JAZZCASH_SUCCESS_CODE) {
      if (code === JAZZCASH_INVALID_CREDENTIALS_CODE) {
        throw new IntegrationError(
          'VENDOR_AUTH',
          'jazzcash: the vendor rejected these credentials (code 101). Check the Merchant ID / password and reconnect.'
        );
      }
      throw new IntegrationError(
        'VENDOR_ERROR',
        `jazzcash: status inquiry failed (response code ${code || 'unknown'}${responseMessageOf(body) ? ` — ${responseMessageOf(body)}` : ''}).`,
        { vendorCode: code || undefined }
      );
    }
    assertResponseHash(body, creds.salt, 'status inquiry');
    return inquiryToResult(txnRefNo.trim(), body);
  }
};

registerIntegrationHandler(jazzCashHandler);
