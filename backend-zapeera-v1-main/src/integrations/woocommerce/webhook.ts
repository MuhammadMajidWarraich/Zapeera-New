// ─── WooCommerce webhook receiver (feature/integration-woocommerce) ──────
// WooCommerce delivers order/product events by POSTing JSON to a delivery
// URL the merchant registers in WP Admin → WooCommerce → Settings →
// Advanced → Webhooks (or via POST /wp-json/wc/v3/webhooks).
//
// SIGNATURE — CORRECTION TO THE BRIEF: the brief said the signature is
// "signed with the consumer secret". That is wrong per WooCommerce's own
// webhook docs: every delivery carries X-WC-Webhook-Signature, a
// base64 HMAC-SHA256 of the RAW request body keyed by the PER-WEBHOOK
// SECRET the merchant sets when creating the webhook — the consumer
// secret is never used. Verifying against the consumer secret would
// reject every genuine delivery. This receiver verifies against the
// webhook secret, stored encrypted alongside the other credentials
// (registry field `webhookSecret`, optional — a webhook created without
// a secret cannot be verified and its deliveries are rejected).
// Verification uses crypto.timingSafeEqual; the raw body is required,
// which is why server.ts mounts this router with express.raw BEFORE
// the JSON body parsers.
//
// TOPICS
//   order.created / order.updated → re-fetch the order and import it
//     (idempotent — a retry re-delivers the same order, which the
//     Sale.uuid tag deduplicates). Gated by config.syncOrders.
//   product.updated → re-push that one product from Zapeera (Zapeera is
//     the master for products; a WooCommerce-side edit is overwritten
//     on the next push). Gated by config.syncProducts.
//   anything else (incl. the creation ping) → 200, ignored.
// A non-2xx response makes WooCommerce retry, and WooCommerce
// auto-disables a webhook after 5 consecutive failures — so failures
// are answered 500 only when the work genuinely failed.
//
// ROUTE (mounted in server.ts, BEFORE auth/CSRF/module protection — a
// webhook carries no session; the HMAC IS the authentication):
//   POST /api/v1/integrations/webhooks/woocommerce/:businessId
//   POST /api/integrations/webhooks/woocommerce/:businessId
// The :businessId is the Zapeera business the store is bound to. It is
// not a secret — it only selects the connection; the signature decides
// whether the delivery is genuine.

import * as crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { getPrisma } from '../../utils/db.util';
import { decryptIntegrationCredentials } from '../../utils/integration-encryption.util';
import { normalizeSyncConfig } from '../../services/integration.service';
import { IntegrationError } from '../vendor-client';
import { WooCommerceClient, parseWooCredentials } from './client';
import {
  importWooOrder,
  pushWooProduct,
  resolveBoundBranch,
  loadOneProductForPush
} from './handler';
import type { WcOrder } from './mapping';

/**
 * Verify a WooCommerce delivery: base64(HMAC-SHA256(rawBody, secret))
 * against the X-WC-Webhook-Signature header, compared in constant time.
 * Any missing/empty input fails closed.
 */
export function verifyWooCommerceWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!rawBody || rawBody.length === 0) return false;
  if (!signatureHeader || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(signatureHeader, 'utf8');
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

export interface WebhookDispatchResult {
  action: 'order-imported' | 'order-already-imported' | 'order-skipped' | 'product-pushed' | 'ignored';
  saleId?: string | null;
  detail?: string;
}

/**
 * Dispatch one verified delivery. Writes an IntegrationSyncLog row for
 * order imports and product pushes so the merchant sees webhook work in
 * the Settings → Integrations log panel, exactly like a manual sync.
 */
export async function handleWooCommerceWebhook(
  prisma: any,
  businessId: string,
  topic: string,
  payload: any
): Promise<WebhookDispatchResult> {
  const row = await prisma.integrationConnection.findUnique({
    where: { businessId_provider: { businessId, provider: 'woocommerce' } }
  });
  if (!row || row.status !== 'connected' || !row.encryptedCredentials) {
    throw new IntegrationError(
      'NOT_CONNECTED',
      'woocommerce: this business has no connected WooCommerce store.'
    );
  }
  const credentials = decryptIntegrationCredentials(row.encryptedCredentials);
  const config = normalizeSyncConfig(row.config ? JSON.parse(row.config) : null);
  const branch = await resolveBoundBranch(prisma, businessId, config);

  if (topic === 'order.created' || topic === 'order.updated') {
    if (!config.syncOrders) {
      return { action: 'ignored', detail: 'order sync is disabled in this connection’s config' };
    }
    const orderId = Number(payload?.id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      throw new IntegrationError('SYNC_FAILED', 'woocommerce: webhook payload has no order id.');
    }
    const client = new WooCommerceClient(parseWooCredentials(credentials));
    const order = await client.request<WcOrder>('GET', `/orders/${orderId}`);
    const startedAt = new Date();
    const log = await prisma.integrationSyncLog.create({
      data: {
        businessId,
        provider: 'woocommerce',
        direction: 'in',
        entity: 'order',
        status: 'failed',
        recordsProcessed: 0,
        recordsFailed: 0,
        errorMessage: null,
        startedAt
      }
    });
    try {
      const outcome = await importWooOrder(prisma, businessId, branch.id, credentials, order);
      await prisma.integrationSyncLog.update({
        where: { id: log.id },
        data: {
          status: 'success',
          recordsProcessed: outcome.saleId && !outcome.alreadyImported ? 1 : 0,
          recordsFailed: 0,
          finishedAt: new Date()
        }
      });
      if (outcome.alreadyImported) return { action: 'order-already-imported', saleId: outcome.saleId };
      if (!outcome.saleId) return { action: 'order-skipped', detail: outcome.skippedReason };
      return { action: 'order-imported', saleId: outcome.saleId };
    } catch (error: any) {
      const message = error instanceof IntegrationError ? error.message : String(error?.message ?? error);
      await prisma.integrationSyncLog.update({
        where: { id: log.id },
        data: { status: 'failed', recordsFailed: 1, errorMessage: message.slice(0, 1000), finishedAt: new Date() }
      });
      throw error;
    }
  }

  if (topic === 'product.updated') {
    if (!config.syncProducts) {
      return { action: 'ignored', detail: 'product sync is disabled in this connection’s config' };
    }
    const sku = String(payload?.sku ?? '').trim();
    if (!sku) {
      return { action: 'ignored', detail: 'product payload has no SKU to match' };
    }
    const client = new WooCommerceClient(parseWooCredentials(credentials));
    const product = await loadOneProductForPush(prisma, businessId, branch.id, sku);
    if (!product) {
      return { action: 'ignored', detail: `SKU ${sku} is not a product of this branch` };
    }
    const startedAt = new Date();
    const log = await prisma.integrationSyncLog.create({
      data: {
        businessId,
        provider: 'woocommerce',
        direction: 'out',
        entity: 'product',
        status: 'failed',
        recordsProcessed: 0,
        recordsFailed: 0,
        errorMessage: null,
        startedAt
      }
    });
    try {
      await pushWooProduct(client, product);
      await prisma.integrationSyncLog.update({
        where: { id: log.id },
        data: { status: 'success', recordsProcessed: 1, recordsFailed: 0, finishedAt: new Date() }
      });
      return { action: 'product-pushed' };
    } catch (error: any) {
      const message = error instanceof IntegrationError ? error.message : String(error?.message ?? error);
      await prisma.integrationSyncLog.update({
        where: { id: log.id },
        data: { status: 'failed', recordsFailed: 1, errorMessage: message.slice(0, 1000), finishedAt: new Date() }
      });
      throw error;
    }
  }

  return { action: 'ignored', detail: `topic "${topic || '(none)'}" is not handled` };
}

// ─── Router (mounted in server.ts with express.raw) ─────────────────────────

export const woocommerceWebhookRouter = Router();

woocommerceWebhookRouter.post('/woocommerce/:businessId', async (req: Request, res: Response) => {
  const businessId = String(req.params.businessId || '');
  try {
    if (!businessId) return res.status(400).json({ success: false, message: 'Missing business id in the webhook URL.' });
    const rawBody = req.body as unknown;
    if (!Buffer.isBuffer(rawBody)) {
      // The route must be mounted with express.raw — if the body was
      // already JSON-parsed, the signature can no longer be verified.
      console.error('[WooCommerce webhook] raw body missing — the route is not mounted with express.raw.');
      return res.status(500).json({ success: false, message: 'Webhook receiver misconfigured (raw body unavailable).' });
    }
    const prisma: any = await getPrisma(); // any: the sandbox-generated client is stale (pre-framework); the service layer uses `any` throughout for the same reason.
    const row = await prisma.integrationConnection.findUnique({
      where: { businessId_provider: { businessId, provider: 'woocommerce' } }
    });
    if (!row || row.status !== 'connected' || !row.encryptedCredentials) {
      return res.status(404).json({ success: false, message: 'No connected WooCommerce store for this business.' });
    }
    const credentials = decryptIntegrationCredentials(row.encryptedCredentials);
    const webhookSecret =
      typeof credentials.webhookSecret === 'string' ? credentials.webhookSecret : '';
    if (!webhookSecret) {
      return res.status(401).json({
        success: false,
        message: 'No webhook secret is stored for this connection — add the webhook Secret in the WooCommerce connect dialog (it must match the Secret on the webhook in WooCommerce).'
      });
    }
    const signature = req.headers['x-wc-webhook-signature'];
    const signatureHeader = Array.isArray(signature) ? signature[0] : signature;
    if (!verifyWooCommerceWebhookSignature(rawBody, signatureHeader, webhookSecret)) {
      return res.status(401).json({ success: false, message: 'Invalid webhook signature.' });
    }
    let payload: any;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return res.status(400).json({ success: false, message: 'Webhook body is not valid JSON.' });
    }
    const topicHeader = req.headers['x-wc-webhook-topic'];
    const topic = Array.isArray(topicHeader) ? topicHeader[0] : topicHeader ?? '';
    const result = await handleWooCommerceWebhook(prisma, businessId, topic, payload);
    return res.json({ success: true, data: result });
  } catch (error: any) {
    const message = error instanceof IntegrationError ? error.message : 'Webhook processing failed.';
    const status = error instanceof IntegrationError && error.code === 'NOT_CONNECTED' ? 404 : 500;
    console.error('[WooCommerce webhook] failed:', message);
    return res.status(status).json({ success: false, message });
  }
});
