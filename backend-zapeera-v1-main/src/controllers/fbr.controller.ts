// ─── FBR POS fiscal integration (Wave B7) ──────────────────────────────
// Endpoints for the per-business FBR (IMS) configuration and the
// fiscal queue. Conventions mirror the tax-class controller (B5):
//   · Tenancy: every query is scoped to the caller's business (A-02).
//   · Config WRITES and manual retries are OWNER/MANAGER/ADMIN only
//     (in-controller gate); reads are open to every sales role (the
//     Invoices list needs the status summary).
//   · The API token is WRITE-ONLY over this API: PUT accepts it, no
//     response ever contains it (reads expose `hasToken` only), and
//     it is never logged. An absent/empty apiToken on PUT keeps the
//     stored one; `clearApiToken: true` wipes it.
//   · "Test connection" posts NOTHING fiscal: in TEST mode it is a
//     pure local config check; in SANDBOX/PRODUCTION it additionally
//     probes the IMS endpoint with a bare GET (any HTTP response —
//     even a 404/405 — proves reachability; a network error fails).

import { Response } from 'express';
import axios from 'axios';
import Joi from 'joi';
import { getPrisma } from '../utils/db.util';
import { AuthRequest, getUserRole } from '../middleware/auth.middleware';
import { getFbrConfig, retryFbrForSale } from '../services/fbr.service';
import { FBR_ENDPOINTS, FbrEnvironment } from '../utils/fbr.util';

const resolveFbrCompanyId = (req: AuthRequest): string =>
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  req.membership?.business_id ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const requireManagerRole = (req: AuthRequest, res: Response): boolean => {
  const role = getUserRole(req);
  if (!['OWNER', 'MANAGER', 'ADMIN'].includes(role)) {
    res.status(403).json({
      success: false,
      message: 'Only the owner or a manager can manage FBR settings or retry fiscal postings'
    });
    return false;
  }
  return true;
};

/** The only config shape the API ever returns — no token, ever. */
const serializeConfig = (config: any) => ({
  enabled: config?.enabled ?? false,
  posId: config?.posId ?? '',
  environment: (config?.environment as FbrEnvironment) ?? 'TEST',
  sellerName: config?.sellerName ?? '',
  sellerStrn: config?.sellerStrn ?? '',
  hasToken: Boolean(config?.apiToken),
  updatedAt: config?.updatedAt ?? null
});

export const getFbrConfigHandler = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveFbrCompanyId(req);
    const config = await getFbrConfig(prisma, companyId);
    return res.json({ success: true, data: serializeConfig(config) });
  } catch (error: any) {
    console.error('Get FBR config error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to load FBR configuration' });
  }
};

const updateFbrConfigSchema = Joi.object({
  enabled: Joi.boolean().optional(),
  posId: Joi.string().trim().max(32).allow('').optional(),
  apiToken: Joi.string().trim().max(512).allow('').optional(),
  clearApiToken: Joi.boolean().optional(),
  environment: Joi.string().valid('TEST', 'SANDBOX', 'PRODUCTION').optional(),
  sellerName: Joi.string().trim().max(200).allow('').optional(),
  sellerStrn: Joi.string().trim().max(64).allow('').optional()
}).min(1);

export const updateFbrConfigHandler = async (req: AuthRequest, res: Response) => {
  try {
    if (!requireManagerRole(req, res)) return;
    const { error, value } = updateFbrConfigSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ success: false, message: error.details[0].message });
    }
    const prisma = await getPrisma();
    const companyId = resolveFbrCompanyId(req);
    const existing = await getFbrConfig(prisma, companyId);

    const merged = {
      enabled: value.enabled ?? existing?.enabled ?? false,
      posId: value.posId !== undefined ? value.posId || null : existing?.posId ?? null,
      environment: value.environment ?? existing?.environment ?? 'TEST',
      sellerName: value.sellerName !== undefined ? value.sellerName || null : existing?.sellerName ?? null,
      sellerStrn: value.sellerStrn !== undefined ? value.sellerStrn || null : existing?.sellerStrn ?? null
    };
    // Token: explicit clear wins; a non-empty value replaces; an
    // absent/empty value keeps whatever is stored.
    let apiToken: string | null | undefined = undefined;
    if (value.clearApiToken) apiToken = null;
    else if (value.apiToken) apiToken = value.apiToken;
    const effectiveToken = apiToken !== undefined ? apiToken : existing?.apiToken ?? null;

    if (merged.enabled) {
      if (!merged.posId) {
        return res.status(400).json({
          success: false,
          message: 'A POS ID is required to enable FBR POS — FBR issues one per registered till'
        });
      }
      if (merged.environment !== 'TEST' && !effectiveToken) {
        return res.status(400).json({
          success: false,
          message: `An API token is required for the ${merged.environment} environment (TEST mode needs none)`
        });
      }
    }

    const saved = await prisma.fbrConfig.upsert({
      where: { companyId },
      create: {
        companyId,
        ...merged,
        apiToken: apiToken !== undefined ? apiToken : null,
        updatedBy: req.user?.id || null
      },
      update: {
        ...merged,
        ...(apiToken !== undefined ? { apiToken } : {}),
        updatedBy: req.user?.id || null
      }
    });
    return res.json({ success: true, data: serializeConfig(saved), message: 'FBR POS settings saved' });
  } catch (error: any) {
    console.error('Update FBR config error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to save FBR configuration' });
  }
};

export const testFbrConnectionHandler = async (req: AuthRequest, res: Response) => {
  try {
    if (!requireManagerRole(req, res)) return;
    const prisma = await getPrisma();
    const companyId = resolveFbrCompanyId(req);
    const config = await getFbrConfig(prisma, companyId);
    if (!config?.enabled) {
      return res.json({ success: true, data: { ok: false, message: 'FBR POS is not enabled for this business yet' } });
    }
    if (!config.posId) {
      return res.json({ success: true, data: { ok: false, message: 'POS ID is missing — add it and save first' } });
    }
    if (config.environment === 'TEST') {
      return res.json({
        success: true,
        data: {
          ok: true,
          environment: 'TEST',
          message: 'TEST mode is ready — fiscal numbers are simulated locally and nothing is sent to FBR. No connection test is needed.'
        }
      });
    }
    if (!config.apiToken) {
      return res.json({ success: true, data: { ok: false, message: 'API token is missing — add it and save first' } });
    }
    const endpoint = FBR_ENDPOINTS[config.environment as 'SANDBOX' | 'PRODUCTION'];
    try {
      // Reachability probe only — a bare GET; the IMS API expects
      // POSTs, so any HTTP response (even 404/405) proves the host
      // is reachable. No invoice data is sent.
      const probe = await axios.get(endpoint, { timeout: 10_000, validateStatus: () => true });
      return res.json({
        success: true,
        data: {
          ok: true,
          environment: config.environment,
          message: `FBR ${config.environment} endpoint is reachable (HTTP ${probe.status}). No invoice was posted by this test.`
        }
      });
    } catch (e: any) {
      return res.json({
        success: true,
        data: {
          ok: false,
          environment: config.environment,
          message: `Could not reach the FBR ${config.environment} endpoint: ${e.message}`
        }
      });
    }
  } catch (error: any) {
    console.error('Test FBR connection error:', error.message);
    return res.status(500).json({ success: false, message: 'Connection test failed' });
  }
};

export const getFbrStatusHandler = async (req: AuthRequest, res: Response) => {
  try {
    const prisma = await getPrisma();
    const companyId = resolveFbrCompanyId(req);
    const config = await getFbrConfig(prisma, companyId);
    const grouped = await prisma.fbrInvoiceQueue.groupBy({
      by: ['status'],
      where: { companyId },
      _count: { _all: true }
    });
    const counts: Record<string, number> = { PENDING: 0, SENDING: 0, SENT: 0, TEST: 0, FAILED: 0, SKIPPED: 0 };
    for (const g of grouped) counts[g.status] = g._count._all;
    const recentFailures = await prisma.fbrInvoiceQueue.findMany({
      where: { companyId, status: 'FAILED' },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        saleId: true,
        kind: true,
        attempts: true,
        lastError: true,
        updatedAt: true,
        sale: { select: { invoiceNumber: true } }
      }
    });
    return res.json({
      success: true,
      data: {
        config: serializeConfig(config),
        counts,
        recentFailures: recentFailures.map(f => ({
          id: f.id,
          saleId: f.saleId,
          invoiceNumber: f.sale?.invoiceNumber ?? null,
          kind: f.kind,
          attempts: f.attempts,
          lastError: f.lastError,
          updatedAt: f.updatedAt
        }))
      }
    });
  } catch (error: any) {
    console.error('Get FBR status error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to load FBR status' });
  }
};

export const retryFbrHandler = async (req: AuthRequest, res: Response) => {
  try {
    if (!requireManagerRole(req, res)) return;
    const prisma = await getPrisma();
    const companyId = resolveFbrCompanyId(req);
    const result = await retryFbrForSale(prisma, companyId, req.params.saleId);
    if (!result.ok) {
      const status = result.message === 'Sale not found' ? 404 : 400;
      return res.status(status).json({ success: false, message: result.message });
    }
    return res.json({
      success: true,
      message: result.message,
      data: { queueId: result.row?.id, status: result.row?.status }
    });
  } catch (error: any) {
    console.error('Retry FBR error:', error.message);
    return res.status(500).json({ success: false, message: 'Failed to queue the fiscal retry' });
  }
};
