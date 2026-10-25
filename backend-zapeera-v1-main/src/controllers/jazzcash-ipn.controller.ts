// ─── JazzCash vendor callbacks (feature/integration-jazzcash) ─────────────
// Thin handlers over handleJazzCashIpn / handleJazzCashReturn in
// src/integrations/jazzcash. These routes are PUBLIC (no auth — JazzCash
// calls them), so nothing here trusts the body: the hash is verified
// inside the module, and the body is NEVER logged (IPN payloads carry
// pp_Password in plaintext). Only txnRefNo + outcome code reach the log.
import { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { handleJazzCashIpn, handleJazzCashReturn } from '../integrations/jazzcash';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const handleJazzCashIpnRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const outcome = await handleJazzCashIpn(prisma, req.body ?? {});
    // eslint-disable-next-line no-console
    console.log(
      `[JazzCash IPN] txn=${outcome.txnRefNo ?? 'unknown'} ok=${outcome.ok} code=${outcome.code}`
    );
    if (outcome.ok) {
      // 000 = received: JazzCash stops its 3-retry cycle.
      res.json({ pp_ResponseCode: '000', pp_ResponseMessage: 'IPN received successfully' });
    } else {
      // Any non-000 code = failure: JazzCash retries (up to 3 times).
      res.json({
        pp_ResponseCode: '999',
        pp_ResponseMessage: outcome.message.slice(0, 200)
      });
    }
  } catch (error) {
    // Never leak internals to the vendor; a failure response triggers
    // JazzCash's retry, which is the safe direction for money.
    // eslint-disable-next-line no-console
    console.error('[JazzCash IPN] unexpected error:', error instanceof Error ? error.message : error);
    res.json({ pp_ResponseCode: '999', pp_ResponseMessage: 'IPN could not be processed.' });
  }
};

export const handleJazzCashReturnRoute = async (req: Request, res: Response): Promise<void> => {
  try {
    const prisma = await getPrisma();
    const outcome = await handleJazzCashReturn(prisma, req.body ?? {});
    // eslint-disable-next-line no-console
    console.log(
      `[JazzCash Return] txn=${outcome.txnRefNo} status=${outcome.status}`
    );
    const title =
      outcome.status === 'success'
        ? 'Payment successful'
        : outcome.status === 'pending'
          ? 'Payment pending'
          : 'Payment failed';
    const detail = escapeHtml(outcome.message);
    const txn = escapeHtml(outcome.txnRefNo);
    const rrn = outcome.retrievalReferenceNo ? escapeHtml(outcome.retrievalReferenceNo) : '';
    res.status(200).send(
      '<!doctype html><html><head><meta charset="utf-8"><title>' +
        title +
        '</title></head><body style="font-family:sans-serif;max-width:560px;margin:48px auto;padding:0 16px">' +
        `<h1>${title}</h1><p>${detail}</p>` +
        `<p>Transaction reference: ${txn}</p>` +
        (rrn ? `<p>JazzCash reference: ${rrn}</p>` : '') +
        '<p>You can close this page and return to the shop.</p>' +
        '</body></html>'
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[JazzCash Return] unexpected error:', error instanceof Error ? error.message : error);
    res.status(200).send(
      '<!doctype html><html><head><meta charset="utf-8"><title>Payment status unknown</title></head>' +
        '<body style="font-family:sans-serif;max-width:560px;margin:48px auto;padding:0 16px">' +
        '<h1>Payment status unknown</h1>' +
        '<p>The payment result could not be confirmed. Please check with the shop — do not pay twice.</p>' +
        '</body></html>'
    );
  }
};
