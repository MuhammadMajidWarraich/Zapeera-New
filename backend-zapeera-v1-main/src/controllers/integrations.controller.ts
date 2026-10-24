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
  connectProvider,
  disconnectProvider,
  getConnectionStatus,
  listProvidersWithStatus,
  listSyncLogs,
  triggerSync
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
    // Daraz: the one branch its shop maps to + the Daraz category id
    // used when creating listings (optional; see IntegrationSyncConfig).
    branchId: Joi.string().optional(),
    darazCategoryId: Joi.string().optional()
  }).optional()
});

const syncSchema = Joi.object({
  entity: Joi.string()
    .valid('product', 'stock', 'order', 'customer', 'payment', 'shipment')
    .optional(),
  direction: Joi.string().valid('in', 'out').optional(),
  // Required when entity is 'shipment': sale id or invoice number.
  saleRef: Joi.string().optional()
});

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
        message: 'Invalid sync request: entity must be product|stock|order|customer|payment|shipment and direction in|out.'
      });
    }
    const prisma = await getPrisma();
    const { log, result } = await triggerSync(
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
        result
      }
    });
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
