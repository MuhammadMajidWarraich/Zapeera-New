// ─── Shopify integration — webhook receiver (feature/integration-shopify) ─
// Shopify signs every webhook with HMAC-SHA256 (base64) over the RAW
// request body, using the app's API secret key, sent as
// X-Shopify-Hmac-Sha256 (docs: "Verify webhooks"). Verification is
// mandatory and happens BEFORE any processing; the raw body is stashed
// by the JSON parser in server.ts (req.rawBody) because the parsed
// object cannot reproduce the signed bytes.
//
// TOPICS (registered by the merchant — see SHOPIFY_SETUP.md):
//   orders/create            -> import that order (idempotent, same code
//                               as the manual importOrders run).
//   orders/cancelled         -> mark the imported sale CANCELLED (status
//                               only; stock is NOT auto-restored —
//                               a cancelled order's goods may already be
//                               picked; restocking is a manual step).
//   products/update          -> LOG ONLY. Zapeera is the product source
//                               of truth; a Shopify-side edit is
//                               overwritten by the next product push.
//                               There is no product import in v1.
//   inventory_levels/update  -> reconcile: read Shopify's level for the
//                               variant, compare with Zapeera's branch
//                               stock, and push Zapeera's level back when
//                               they differ (Zapeera owns stock). A push
//                               that lands makes the levels equal, so a
//                               re-delivery of our own change is a no-op
//                               — the handler converges, it never loops.
//   refunds/create           -> status sync only: add the refunded amount
//                               to the imported sale's returnedAmount and
//                               mark it REFUNDED when fully refunded.
//                               Stock is NOT restocked automatically
//                               (a refund does not prove a return).
//
// Shopify retries a failed delivery 19 times over 48h, then disables
// the subscription — so processing is IDEMPOTENT everywhere (order
// import by external order id; inventory reconcile by level equality;
// refund status by amount) and the route acknowledges 200 as soon as
// the HMAC checks out, then processes asynchronously (Shopify allows
// 5 seconds per delivery).
import * as crypto from 'crypto';
import { decryptIntegrationCredentials } from '../../utils/integration-encryption.util';
import { normalizeSyncConfig } from '../../services/integration.service';
import {
  fetchInventoryItem,
  requireShopifyCredentials,
  setInventoryQuantities,
  shopifyIdToGid,
  type ShopifyCredentials
} from './client';
import {
  fetchAndImportShopifyOrder,
  findImportedSale,
  loadBranchCatalog,
  poolStock,
  resolveBranchId,
  resolveOwnerUserId
} from './sync-core';

export function verifyShopifyWebhook(
  rawBody: Buffer,
  hmacHeader: string | null | undefined,
  secret: string
): boolean {
  if (!hmacHeader || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  const a = Buffer.from(hmacHeader, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export interface WebhookOutcome {
  /** HTTP status the receiver SHOULD have answered (the route acks 200 after HMAC). */
  httpStatus: number;
  message: string;
}

interface WebhookInput {
  prisma: any;
  businessId: string;
  rawBody: Buffer;
  hmacHeader: string | null | undefined;
  topic: string | null | undefined;
  shopDomainHeader: string | null | undefined;
  /** X-Shopify-Webhook-Id — stable across Shopify's retries of one delivery. */
  webhookId: string | null | undefined;
  secret: string;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

async function writeLog(
  prisma: any,
  businessId: string,
  direction: 'in' | 'out',
  entity: string,
  status: 'success' | 'partial' | 'failed',
  processed: number,
  failed: number,
  errorMessage: string | null
): Promise<string | null> {
  try {
    const row = await prisma.integrationSyncLog.create({
      data: {
        businessId,
        provider: 'shopify',
        direction,
        entity,
        status,
        recordsProcessed: processed,
        recordsFailed: failed,
        errorMessage: errorMessage ? errorMessage.slice(0, 1000) : null,
        startedAt: new Date(),
        finishedAt: new Date()
      }
    });
    return row?.id ?? null;
  } catch {
    return null;
  }
}

export async function handleShopifyWebhook(input: WebhookInput): Promise<WebhookOutcome> {
  const { prisma, businessId } = input;
  if (!input.secret) {
    return { httpStatus: 500, message: 'Shopify webhooks are not configured on this server (SHOPIFY_API_SECRET missing).' };
  }
  if (!verifyShopifyWebhook(input.rawBody, input.hmacHeader, input.secret)) {
    return { httpStatus: 401, message: 'Webhook HMAC verification failed — ignored.' };
  }
  let payload: any;
  try {
    payload = JSON.parse(input.rawBody.toString('utf8'));
  } catch {
    return { httpStatus: 400, message: 'Webhook body is not valid JSON — ignored.' };
  }

  const topic = input.topic ?? '';
  const row = await prisma.integrationConnection.findUnique({
    where: { businessId_provider: { businessId, provider: 'shopify' } }
  });
  if (!row || row.status !== 'connected' || !row.encryptedCredentials) {
    return { httpStatus: 200, message: 'Shopify is not connected for this business — webhook ignored.' };
  }
  let creds: ShopifyCredentials;
  try {
    creds = requireShopifyCredentials(decryptIntegrationCredentials(row.encryptedCredentials));
  } catch {
    return { httpStatus: 200, message: 'Stored Shopify credentials could not be read — webhook ignored.' };
  }
  if (input.shopDomainHeader && input.shopDomainHeader !== creds.shopDomain) {
    return { httpStatus: 200, message: `Webhook shop ${input.shopDomainHeader} does not match the connected store ${creds.shopDomain} — ignored.` };
  }
  const config = normalizeSyncConfig(row.config ? JSON.parse(row.config) : {});

  try {
    switch (topic) {
      case 'orders/create': {
        if (!config.syncOrders) {
          return { httpStatus: 200, message: 'Order import is off for this connection — webhook ignored.' };
        }
        const branch = await resolveBranchId(prisma, businessId, config);
        const actorUserId = await resolveOwnerUserId(prisma, businessId);
        const orderGid = shopifyIdToGid('Order', String(payload.id));
        const outcome = await fetchAndImportShopifyOrder(prisma, businessId, creds, orderGid, {
          branchId: branch.id,
          branchName: branch.name,
          actorUserId
        });
        const failed = outcome.imported || outcome.alreadyImported || outcome.skipped ? 0 : 1;
        await writeLog(
          prisma,
          businessId,
          'in',
          'order',
          failed ? 'failed' : 'success',
          outcome.imported || outcome.alreadyImported ? 1 : 0,
          failed,
          failed ? outcome.message : null
        );
        return { httpStatus: failed ? 500 : 200, message: outcome.message };
      }

      case 'orders/cancelled': {
        const sale = await findImportedSale(prisma, businessId, String(payload.id));
        if (!sale) {
          return { httpStatus: 200, message: `Order ${payload.id} was cancelled in Shopify but was never imported — nothing to mark.` };
        }
        if (sale.status !== 'CANCELLED') {
          await prisma.sale.update({ where: { id: sale.id }, data: { status: 'CANCELLED' } });
        }
        await writeLog(prisma, businessId, 'in', 'order', 'success', 1, 0, null);
        return { httpStatus: 200, message: `Imported sale ${sale.invoiceNumber ?? sale.id} marked CANCELLED (stock was not restored — restock manually if the goods came back).` };
      }

      case 'products/update': {
        // Read-only by design: Zapeera is the product source of truth.
        // A Shopify-side edit is overwritten by the next product push.
        // eslint-disable-next-line no-console
        console.info(`[Shopify webhook] products/update for ${payload.id} (${payload.title ?? ''}) — no Zapeera write; Zapeera is the product source of truth.`);
        return { httpStatus: 200, message: 'Product edit noted — Zapeera is the product source of truth; the next product push overwrites Shopify-side edits.' };
      }

      case 'inventory_levels/update': {
        if (!config.syncStock) {
          return { httpStatus: 200, message: 'Stock sync is off for this connection — webhook ignored.' };
        }
        const branch = await resolveBranchId(prisma, businessId, config);
        const inventoryItemGid = shopifyIdToGid('InventoryItem', String(payload.inventory_item_id));
        const locationGid = shopifyIdToGid('Location', String(payload.location_id));
        const item = await fetchInventoryItem(creds, inventoryItemGid, locationGid);
        if (!item.sku) {
          await writeLog(prisma, businessId, 'out', 'stock', 'failed', 0, 1, 'Inventory item has no variant SKU — cannot map it to a Zapeera product.');
          return { httpStatus: 500, message: 'Inventory item has no variant SKU — cannot map it to a Zapeera product.' };
        }
        const catalog = await loadBranchCatalog(prisma, businessId, branch.id);
        let zapeeraStock: number | null = null;
        for (const product of catalog) {
          if (product.sku === item.sku) {
            zapeeraStock = poolStock(product.batches, null);
            break;
          }
          const variant = product.variants.find((v) => v.sku === item.sku);
          if (variant) {
            zapeeraStock = poolStock(product.batches, variant.id);
            break;
          }
        }
        if (zapeeraStock === null) {
          await writeLog(prisma, businessId, 'out', 'stock', 'failed', 0, 1, `SKU "${item.sku}" is not a product in the ${branch.name} branch.`);
          return { httpStatus: 500, message: `SKU "${item.sku}" is not a product in the ${branch.name} branch — cannot reconcile.` };
        }
        if (item.available !== null && item.available === zapeeraStock) {
          await writeLog(prisma, businessId, 'out', 'stock', 'success', 0, 0, null);
          return { httpStatus: 200, message: `SKU "${item.sku}" already matches Zapeera stock (${zapeeraStock}) — no push needed.` };
        }
        // The idempotency key is stable per webhook delivery (Shopify
        // retries carry the same X-Shopify-Webhook-Id), so a retried
        // reconcile is deduped instead of applied twice.
        const deliveryKey = input.webhookId ?? `once-${Date.now()}`;
        await setInventoryQuantities(
          creds,
          [{ inventoryItemId: inventoryItemGid, locationId: locationGid, quantity: zapeeraStock }],
          `zapeera-${deliveryKey}-reconcile-${String(payload.inventory_item_id)}`
        );
        await writeLog(prisma, businessId, 'out', 'stock', 'success', 1, 0, null);
        return { httpStatus: 200, message: `SKU "${item.sku}" diverged (Shopify ${item.available}, Zapeera ${zapeeraStock}) — pushed Zapeera's level.` };
      }

      case 'refunds/create': {
        const orderId = String(payload.order_id);
        const sale = await findImportedSale(prisma, businessId, orderId);
        if (!sale) {
          return { httpStatus: 200, message: `Refund for order ${orderId} — that order was never imported, so there is no sale to mark.` };
        }
        const refunded = (payload.transactions ?? [])
          .filter((t: any) => t?.kind === 'refund')
          .reduce((sum: number, t: any) => sum + Number(t?.amount ?? 0), 0);
        const newReturned = round2(Number(sale.returnedAmount ?? 0) + refunded);
        const fullyRefunded = newReturned >= Number(sale.totalAmount ?? 0) - 0.01;
        await prisma.sale.update({
          where: { id: sale.id },
          data: {
            returnedAmount: newReturned,
            paymentStatus: fullyRefunded ? 'REFUNDED' : sale.paymentStatus
          }
        });
        await writeLog(prisma, businessId, 'in', 'order', 'success', 1, 0, null);
        return {
          httpStatus: 200,
          message: `Refund of PKR ${refunded.toFixed(2)} recorded on imported sale ${sale.invoiceNumber ?? sale.id}${fullyRefunded ? ' — fully refunded' : ''} (stock was not restocked — restock manually if the goods came back).`
        };
      }

      default:
        return { httpStatus: 200, message: `Topic "${topic}" is not handled — ignored.` };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    return { httpStatus: 500, message: `Webhook processing failed (${message}) — Shopify will retry.` };
  }
}
