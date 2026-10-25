// ─── Integrations framework — controller (feature/integration-framework) ─
// Thin handlers over src/services/integration.service.ts. Tenancy mirrors
// the FBR controller: business id from the request context (never from
// the body), and credentials are WRITE-ONLY — no response or log in this
// file ever contains them (Joi validation errors are returned without
// echoing the credentials object).
import { Response } from 'express';
import Joi from 'joi';
import { getPrisma } from '../utils/db.util';
import { AuthRequest } from '../middleware/auth.middleware';
import { IntegrationError } from '../integrations/vendor-client';
import {
  cancelShipment,
  connectProvider,
  disconnectProvider,
  getConnectionStatus,
  inquireIntegrationPayment,
  listProvidersWithStatus,
  listSyncLogs,
  refundIntegrationPayment,
  getShipmentTracking,
  returnShipment,
} from '../services/integration.service';

const resolveIntegrationBusinessId = (req: AuthRequest): string =>
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  req.membership?.business_id ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const ERROR_STATUS: Record<string, number> = {
  UNKNOWN_PROVIDER: 404,
  NOT_IMPLEMENTED: 501,
  NOT_CONNECTED: 409,
  ENCRYPTION_NOT_CONFIGURED: 500,
  VENDOR_AUTH: 502,
  VENDOR_UNREACHABLE: 502,
  VENDOR_RATE_LIMIT: 502,
  VENDOR_ERROR: 502,
  SYNC_FAILED: 502
};

const handleError = (res: Response, error: unknown) => {
  if (error instanceof IntegrationError) {
    return res.status(ERROR_STATUS[error.code] ?? 500).json({
      success: false,
      code: error.code,
      message: error.message
    });
  }
  // eslint-disable-next-line no-console
  console.error('[Integrations] unexpected error:', error instanceof Error ? error.message : error);
  return res.status(500).json({
    success: false,
    code: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred.'
  });
};

const connectSchema = Joi.object({
  credentials: Joi.object().min(1).required(),
  config: Joi.object({
    syncProducts: Joi.boolean(),
    syncStock: Joi.boolean(),
    syncOrders: Joi.boolean(),
    syncCustomers: Joi.boolean(),
    direction: Joi.string().valid('in', 'out', 'both'),
    // One store maps to one branch: the id of the ONE branch the
    // store maps to (WooCommerce refuses to sync when unset with
    // several active branches; Shopify resolves the first active
    // branch when absent; Daraz resolves the single active branch
    // and fails loudly on multi-branch businesses; Google Sheets
    // exports one branch when set, all branches when absent).
    branchId: Joi.string().allow(null, '').optional(),
    // Daraz: the Daraz category id used when creating listings
    // (optional; see IntegrationSyncConfig).
    darazCategoryId: Joi.string().optional(),
    // Provider-specific config (google-sheets, 2026-10-24): target
    // spreadsheet id. Preserved verbatim by normalizeSyncConfig;
    // other providers ignore this key.
    spreadsheetId: Joi.string().trim().max(200).optional()
  }).optional()
});

const paymentSchema = Joi.object({
  saleId: Joi.string().required(),
  amount: Joi.number().positive().required(),
  method: Joi.string().valid('mobile-account', 'bank-account', 'otc', 'card').required(),
  mobileNumber: Joi.string().allow('', null).optional(),
  cnicLast6: Joi.string().allow('', null).optional(),
  bankId: Joi.string().allow('', null).optional(),
  accountNo: Joi.string().allow('', null).optional(),
  cnic: Joi.string().allow('', null).optional(),
  email: Joi.string().allow('', null).optional(),
  otp: Joi.string().allow('', null).optional(),
  billReference: Joi.string().allow('', null).optional(),
  description: Joi.string().allow('', null).optional()
});

const syncSchema = Joi.object({
  entity: Joi.string()
    .valid('product', 'stock', 'order', 'customer', 'payment', 'shipment', 'export')
    .optional(),
  direction: Joi.string().valid('in', 'out').optional(),
  // Sale id or invoice number — required only for entity 'shipment'
  // (the service builds the shipment from that sale).
  saleRef: Joi.string()
    .trim()
    .max(64)
    .when('entity', { is: 'shipment', then: Joi.required(), otherwise: Joi.optional() }),
  // Required when entity is 'payment' — the payment initiation payload.
  payment: paymentSchema.optional()
});

const inquireSchema = Joi.object({
  txnRefNo: Joi.string().required()
});

const refundSchema = Joi.object({
  saleId: Joi.string().required(),
  txnRefNo: Joi.string().required(),
  amount: Joi.number().positive().required(),
  method: Joi.string().valid('mobile-account', 'card', 'otc').required(),
  // Merchant's own wallet MPIN for a mobile-account refund — per call
  // only, never stored (it is NOT part of the connection credentials).
  merchantMpin: Joi.string().allow('', null).optional(),
  voucherId: Joi.string().allow('', null).optional(),
  cnic: Joi.string().allow('', null).optional()
});

const trackingNumberParam = Joi.string().trim().min(1).max(64).required();

export const listIntegrationsHandler = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const providers = await listProvidersWithStatus(prisma, resolveIntegrationBusinessId(req));
    return res.json({ success: true, data: { providers } });
  } catch (error) {
    return handleError(res, error);
  }
};

export const connectIntegrationHandler = async (req: AuthRequest, res: Response) => {
  try {
    const { error, value } = connectSchema.validate(req.body ?? {});
    if (error) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        // Never echo the submitted credentials back in an error message.
        message: 'Invalid connect request: credentials object and optional config booleans are expected.'
      });
    }
    const prisma = await getPrisma();
    const connection = await connectProvider(
      prisma,
      resolveIntegrationBusinessId(req),
      req.params.provider,
      value.credentials,
      value.config
    );
    return res.json({ success: true, data: connection });
  } catch (error) {
    return handleError(res, error);
  }
};

export const disconnectIntegrationHandler = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const connection = await disconnectProvider(
      prisma,
      resolveIntegrationBusinessId(req),
      req.params.provider
    );
    return res.json({ success: true, data: connection });
  } catch (error) {
    return handleError(res, error);
  }
};

export const getIntegrationStatusHandler = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const status = await getConnectionStatus(
      prisma,
      resolveIntegrationBusinessId(req),
      req.params.provider
    );
    return res.json({ success: true, data: status });
  } catch (error) {
    return handleError(res, error);
  }
};

export const triggerIntegrationSyncHandler = async (req: AuthRequest, res: Response) => {
  try {
    const { error, value } = syncSchema.validate(req.body ?? {});
    if (error) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Invalid sync request: entity must be product|stock|order|customer|payment|shipment|export and direction in|out.'
      });
    }
    const prisma = await getPrisma();
    const { log, result, payment } = await triggerSync(
      prisma,
      resolveIntegrationBusinessId(req),
      req.params.provider,
      value
    );
    return res.json({
      success: true,
      data: {
        log: {
          id: log.id,
          provider: log.provider,
          direction: log.direction,
          entity: log.entity,
          status: log.status,
          recordsProcessed: log.recordsProcessed,
          recordsFailed: log.recordsFailed,
          errorMessage: log.errorMessage,
          startedAt: log.startedAt,
          finishedAt: log.finishedAt
        },
        result,
        ...(payment ? { payment } : {})
      }
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// Payment-rail calls (JazzCash; generic). Payments themselves go
// through the sync route above (entity 'payment', full payment object
// in the response) — inquiry and refund are separate routes because
// they are not sync runs (no log row, no lastSyncAt).
export const inquireIntegrationPaymentHandler = async (req: AuthRequest, res: Response) => {
  try {
    const { error, value } = inquireSchema.validate(req.body ?? {});
    if (error) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Invalid inquiry request: txnRefNo is required.'
      });
    }
    const prisma = await getPrisma();
    const inquiry = await inquireIntegrationPayment(
      prisma,
      resolveIntegrationBusinessId(req),
      req.params.provider,
      value.txnRefNo
    );
    return res.json({ success: true, data: inquiry });
  } catch (error) {
    return handleError(res, error);
  }
};

export const refundIntegrationPaymentHandler = async (req: AuthRequest, res: Response) => {
  try {
    const { error, value } = refundSchema.validate(req.body ?? {});
    if (error) {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'Invalid refund request: saleId, txnRefNo, a positive amount and a method (mobile-account|card|otc) are required.'
      });
    }
    const prisma = await getPrisma();
    const refund = await refundIntegrationPayment(
      prisma,
      resolveIntegrationBusinessId(req),
      req.params.provider,
      value
    );
    return res.json({ success: true, data: refund });
  } catch (error) {
    return handleError(res, error);
  }
};

export const listIntegrationLogsHandler = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const { logs, total } = await listSyncLogs(
      prisma,
      resolveIntegrationBusinessId(req),
      req.params.provider,
      {
        limit: Number(req.query.limit) || 20,
        offset: Number(req.query.offset) || 0
      }
    );
    return res.json({
      success: true,
      data: {
        logs: logs.map((log: any) => ({
          id: log.id,
          provider: log.provider,
          direction: log.direction,
          entity: log.entity,
          status: log.status,
          recordsProcessed: log.recordsProcessed,
          recordsFailed: log.recordsFailed,
          errorMessage: log.errorMessage,
          startedAt: log.startedAt,
          finishedAt: log.finishedAt
        })),
        total
      }
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── Shipment routes (added by feature/integration-postex) ─────────────────
// On-demand tracking / cancel / return for logistics providers. Same
// OWNER/MANAGER gate as the rest of this router; lookups are read-only
// (no sync-log row). The :trackingNumber param is validated, never logged.
const validateTrackingNumber = (res: Response, raw: unknown): string | null => {
  const { error, value } = trackingNumberParam.validate(raw);
  if (error) {
    res.status(400).json({
      success: false,
      code: 'VALIDATION_ERROR',
      message: 'A tracking number is required.'
    });
    return null;
  }
  return value as string;
};

export const getShipmentTrackingHandler = async (req: AuthRequest, res: Response) => {
  try {
    const trackingNumber = validateTrackingNumber(res, req.params.trackingNumber);
    if (!trackingNumber) return;
    const prisma = await getPrisma();
    const tracking = await getShipmentTracking(
      prisma,
      resolveIntegrationBusinessId(req),
      req.params.provider,
      trackingNumber
    );
    return res.json({ success: true, data: tracking });
  } catch (error) {
    return handleError(res, error);
  }
};

export const cancelShipmentHandler = async (req: AuthRequest, res: Response) => {
  try {
    const trackingNumber = validateTrackingNumber(res, req.params.trackingNumber);
    if (!trackingNumber) return;
    const prisma = await getPrisma();
    const result = await cancelShipment(
      prisma,
      resolveIntegrationBusinessId(req),
      req.params.provider,
      trackingNumber
    );
    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error);
  }
};

export const returnShipmentHandler = async (req: AuthRequest, res: Response) => {
  try {
    const trackingNumber = validateTrackingNumber(res, req.params.trackingNumber);
    if (!trackingNumber) return;
    const prisma = await getPrisma();
    const result = await returnShipment(
      prisma,
      resolveIntegrationBusinessId(req),
      req.params.provider,
      trackingNumber
    );
    return res.json({ success: true, data: result });
  } catch (error) {
    return handleError(res, error);
  }
};
