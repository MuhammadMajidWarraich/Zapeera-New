// ─── PostEx sync handler (feature/integration-postex) ─────────────────────
// Implements IntegrationSyncHandler for provider 'postex' (registry entry
// already exists: clientId, clientSecret*, companyCode; OAuth 2.0).
//
// What it does — the evidenced PostEx surface (Odoo listing, research §12):
//   connect / getStatus — OAuth token grant (the cheap vendor read; no
//     separate "account" endpoint is evidenced, and the grant itself
//     validates all three credentials).
//   createShipment — book a shipment from a Zapeera sale, fetch the AWB
//     label URL when the vendor returns one, store the tracking number +
//     carrier status on the sale (Sale.postexTrackingNumber /
//     Sale.postexShipmentStatus — the FBR fbrInvoiceNumber/fbrStatus
//     precedent; no parallel shipment ledger).
//   getTracking — real-time status + full history; refreshes the stored
//     carrier status on the sale when one matches the tracking number.
//   cancelShipment / createReturnShipment — cancel an active shipment, or
//     book a return leg for a delivered one (new tracking number; the
//     outbound tracking on the sale is left untouched).
//   processPostExWebhook — the receiver for PostEx push updates (route in
//     src/routes/postex-webhook.routes.ts).
//
// Webhook verification gap (honest limitation): PostEx evidences webhook
// support but publishes NO verification mechanism (no signature header or
// secret scheme in any doc we could access). The receiver therefore does
// NOT verify a signature — it only ever updates the carrier-status string
// on the sale whose tracking number matches, never money, stock or
// credentials. Add HMAC verification here the moment PostEx documents it,
// and say so in the UI copy until then (see IntegrationsSection).
//
// COD rule (Odoo FAQ, evidenced): COD is auto-computed from the linked
// sale order's total; prepaid orders carry COD 0. The service computes
// the unpaid balance (total − paid − returned); this handler only maps
// the input it is given — see buildPostExOrderPayload.

import { IntegrationError, mapVendorError } from '../vendor-client';
import type {
  CreateShipmentInput,
  IntegrationSyncContext,
  IntegrationSyncHandler,
  IntegrationSyncResult,
  ShipmentResult,
  TrackingResult
} from '../types';
import { PostExClient, postExCredentialsFromRecord } from './client';
import type { PostExOrderPayload } from './client';

export interface PostExHandlerOptions {
  /** Injectable fetch (tests stub this — never hits live PostEx). */
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Explicit API base URL (tests). Production reads POSTEX_API_BASE_URL. */
  baseUrl?: string;
}

/** Map the vendor-neutral shipment input to the PostEx order payload. */
export function buildPostExOrderPayload(input: CreateShipmentInput): PostExOrderPayload {
  // Recipient phone/address are nullable on the shared input (walk-in
  // placeholders) but PostEx requires them — validateShipmentInput
  // enforces this before this builder runs; guard here too so the
  // exported builder is independently safe (and so tsc can narrow).
  if (!input.recipient?.phone?.trim() || !input.recipient?.address?.trim()) {
    throw new IntegrationError(
      'SYNC_FAILED',
      'postex: the customer needs a name, phone number and delivery address before a shipment can be booked.'
    );
  }
  return {
    orderRef: input.orderRef,
    recipientName: input.recipient.name,
    recipientPhone: input.recipient.phone,
    recipientAddress: input.recipient.address,
    ...(input.recipient.city ? { recipientCity: input.recipient.city } : {}),
    paymentMethod: input.paymentMethod,
    codAmount: input.codAmount,
    ...(input.parcel?.pieces !== undefined ? { pieces: input.parcel.pieces } : {}),
    ...(input.parcel?.weightKg !== undefined ? { weightKg: input.parcel.weightKg } : {}),
    ...(input.parcel?.description ? { description: input.parcel.description } : {}),
    ...(input.sender?.name ? { senderName: input.sender.name } : {}),
    ...(input.sender?.phone ? { senderPhone: input.sender.phone } : {}),
    ...(input.sender?.address ? { senderAddress: input.sender.address } : {})
  };
}

function validateShipmentInput(input: CreateShipmentInput): void {
  if (!input?.orderRef?.trim()) {
    throw new IntegrationError('SYNC_FAILED', 'postex: a sale/invoice reference is required to book a shipment.');
  }
  if (!input.recipient?.name?.trim() || !input.recipient?.phone?.trim() || !input.recipient?.address?.trim()) {
    throw new IntegrationError(
      'SYNC_FAILED',
      'postex: the customer needs a name, phone number and delivery address before a shipment can be booked.'
    );
  }
  if (!Number.isFinite(input.codAmount) || input.codAmount < 0) {
    throw new IntegrationError('SYNC_FAILED', 'postex: the COD amount must be zero or more.');
  }
}

/** Best-effort sale-status write: a vendor success must never be lost to a local write failure. */
async function updateSaleShipment(
  prisma: any,
  where: { id?: string; trackingNumber?: string },
  data: { postexTrackingNumber?: string; postexShipmentStatus?: string }
): Promise<boolean> {
  try {
    if (!prisma?.sale) return false;
    if (where.id) {
      await prisma.sale.update({ where: { id: where.id }, data });
      return true;
    }
    if (where.trackingNumber && prisma.sale.findFirst) {
      const sale = await prisma.sale.findFirst({ where: { postexTrackingNumber: where.trackingNumber } });
      if (!sale) return false;
      await prisma.sale.update({ where: { id: sale.id }, data });
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function createPostExHandler(options: PostExHandlerOptions = {}): IntegrationSyncHandler {
  const clientFor = (credentials: Record<string, unknown>): PostExClient =>
    new PostExClient({
      credentials: postExCredentialsFromRecord(credentials),
      baseUrl: options.baseUrl,
      fetchImpl: options.fetchImpl
    });

  const handler: IntegrationSyncHandler = {
    provider: 'postex',

    async connect(credentials) {
      try {
        const client = clientFor(credentials);
        if (!client.configuredBaseUrl && !process.env.POSTEX_API_BASE_URL && !process.env.POSTEX_SANDBOX_API_BASE_URL) {
          return {
            ok: false,
            message:
              'PostEx API base URL is not configured on this server (POSTEX_API_BASE_URL). ' +
              'Ask PostEx for the API details issued with your merchant account — postex.pk publishes no public docs — and set it, then reconnect.'
          };
        }
        const ok = await client.verifyConnection();
        return ok
          ? { ok: true, message: 'PostEx accepted the credentials.' }
          : { ok: false, message: 'PostEx rejected these credentials.' };
      } catch (error) {
        const mapped = mapVendorError(error, 'postex');
        return { ok: false, message: mapped.message };
      }
    },

    async disconnect() {
      // No vendor-side revoke is evidenced for PostEx OAuth tokens; the
      // framework wipes the stored credentials regardless. Tokens are
      // cached in memory only and die with the process.
      return undefined;
    },

    async getStatus(credentials) {
      try {
        const ok = await clientFor(credentials).verifyConnection();
        return ok
          ? { ok: true, message: 'PostEx reachable.' }
          : { ok: false, message: 'PostEx rejected these credentials.' };
      } catch (error) {
        const mapped = mapVendorError(error, 'postex');
        return { ok: false, message: mapped.message };
      }
    },

    async createShipment(ctx: IntegrationSyncContext, input: CreateShipmentInput): Promise<IntegrationSyncResult> {
      validateShipmentInput(input);
      const client = clientFor(ctx.credentials);
      const created = await client.createOrder(buildPostExOrderPayload(input));
      // Fetch the AWB label URL when the create response did not carry one.
      let labelUrl = created.labelUrl ?? null;
      if (!labelUrl) {
        try {
          labelUrl = await client.getLabelUrl(created.trackingNumber);
        } catch {
          labelUrl = null; // label fetch is best-effort; the booking stands.
        }
      }
      let stored = true;
      if (input.saleId) {
        stored = await updateSaleShipment(ctx.prisma, { id: input.saleId }, {
          postexTrackingNumber: created.trackingNumber,
          postexShipmentStatus: created.status
        });
      }
      const message =
        `PostEx shipment booked — tracking ${created.trackingNumber} (${created.status})` +
        (input.paymentMethod === 'COD' ? `, COD Rs ${input.codAmount}` : ', prepaid') +
        (labelUrl ? ` — AWB label: ${labelUrl}` : ' — no AWB label URL was returned; fetch it from the PostEx dashboard.') +
        (stored ? '' : ' (Could not store the tracking number on the sale — keep this tracking number safe.)');
      return { recordsProcessed: 1, recordsFailed: 0, message };
    },

    async getTracking(ctx: IntegrationSyncContext, trackingNumber: string): Promise<TrackingResult> {
      const clean = String(trackingNumber ?? '').trim();
      if (!clean) {
        throw new IntegrationError('SYNC_FAILED', 'postex: a tracking number is required.');
      }
      const client = clientFor(ctx.credentials);
      const tracking = await client.getTracking(clean);
      await updateSaleShipment(ctx.prisma, { trackingNumber: clean }, {
        postexShipmentStatus: tracking.status
      });
      return tracking;
    },

    async cancelShipment(ctx: IntegrationSyncContext, trackingNumber: string): Promise<IntegrationSyncResult> {
      const clean = String(trackingNumber ?? '').trim();
      if (!clean) {
        throw new IntegrationError('SYNC_FAILED', 'postex: a tracking number is required to cancel a shipment.');
      }
      const client = clientFor(ctx.credentials);
      const result = await client.cancelOrder(clean);
      if (!result.ok) {
        return {
          recordsProcessed: 0,
          recordsFailed: 1,
          message: `PostEx did not confirm the cancellation of ${clean} (status: ${result.status}). Check the PostEx merchant dashboard.`
        };
      }
      await updateSaleShipment(ctx.prisma, { trackingNumber: clean }, {
        postexShipmentStatus: 'CANCELLED'
      });
      return {
        recordsProcessed: 1,
        recordsFailed: 0,
        message: `PostEx shipment ${clean} cancelled.`
      };
    },

    async createReturnShipment(ctx: IntegrationSyncContext, trackingNumber: string): Promise<ShipmentResult> {
      const clean = String(trackingNumber ?? '').trim();
      if (!clean) {
        throw new IntegrationError('SYNC_FAILED', 'postex: a tracking number is required to book a return.');
      }
      const client = clientFor(ctx.credentials);
      const created = await client.createReturn(clean);
      // The return leg gets its own tracking number; the sale keeps the
      // outbound one, so the two legs are never confused.
      return {
        trackingNumber: created.trackingNumber,
        shipmentId: created.shipmentId,
        labelUrl: created.labelUrl,
        status: created.status,
        codAmount: 0
      };
    }
  };

  return handler;
}

/** The registered singleton (production path — env-configured base URL). */
export const postexHandler: IntegrationSyncHandler = createPostExHandler();

export interface PostExWebhookOutcome {
  received: boolean;
  matched: boolean;
  trackingNumber?: string;
  status?: string;
}

/**
 * Process one PostEx webhook payload and update the matching sale's stored
 * carrier status. Payload shape is tolerant (no published schema): the
 * tracking number and status are read from several candidate fields, at
 * the top level or under `data`/`event`.
 *
 * NO signature verification is performed — PostEx publishes no verification
 * mechanism in any doc we could access (see the header comment). The only
 * write this ever makes is a carrier-status string on the sale whose
 * tracking number matches, so a spoofed callback cannot move money, stock
 * or credentials — but treat the stored status as untrusted input and
 * confirm it with a tracking lookup before acting on it.
 */
export async function processPostExWebhook(prisma: any, payload: any): Promise<PostExWebhookOutcome> {
  const body = payload && typeof payload === 'object' ? payload : {};
  const data = body.data && typeof body.data === 'object' ? body.data : body;
  const event = body.event && typeof body.event === 'object' ? body.event : data;
  const trackingNumber =
    [data, event, body]
      .map((obj: any) =>
        typeof obj?.trackingNumber === 'string' && obj.trackingNumber.trim()
          ? obj.trackingNumber.trim()
          : typeof obj?.tracking_number === 'string' && obj.tracking_number.trim()
            ? obj.tracking_number.trim()
            : typeof obj?.cnNumber === 'string' && obj.cnNumber.trim()
              ? obj.cnNumber.trim()
              : typeof obj?.cn_number === 'string' && obj.cn_number.trim()
                ? obj.cn_number.trim()
                : typeof obj?.consignmentNumber === 'string' && obj.consignmentNumber.trim()
                  ? obj.consignmentNumber.trim()
                  : typeof obj?.cn === 'string' && obj.cn.trim()
                    ? obj.cn.trim()
                    : undefined
      )
      .find(Boolean);
  const rawStatus =
    [data, event, body]
      .map((obj: any) =>
        typeof obj?.status === 'string' && obj.status.trim()
          ? obj.status.trim()
          : typeof obj?.orderStatus === 'string' && obj.orderStatus.trim()
            ? obj.orderStatus.trim()
            : typeof obj?.shipmentStatus === 'string' && obj.shipmentStatus.trim()
              ? obj.shipmentStatus.trim()
              : typeof obj?.deliveryStatus === 'string' && obj.deliveryStatus.trim()
                ? obj.deliveryStatus.trim()
                : undefined
      )
      .find(Boolean);
  if (!trackingNumber) return { received: true, matched: false };
  const status = rawStatus ? rawStatus.toUpperCase().replace(/[\s-]+/g, '_') : 'UNKNOWN';
  const stored = await updateSaleShipment(prisma, { trackingNumber }, {
    postexShipmentStatus: status
  });
  return { received: true, matched: stored, trackingNumber, status };
}
