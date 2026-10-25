// ─── Shopify integration — routes (feature/integration-shopify) ──────────
// Mounted by server.ts at BOTH /api/v1/integrations/shopify and
// /api/integrations/shopify (repo dual-prefix convention).
//
//   GET  /oauth/install?shop=<store>.myshopify.com
//        Authenticated (OWNER/MANAGER) — starts the OAuth flow, redirects
//        to Shopify's authorize page.
//   GET  /oauth/callback?code&shop&state&hmac&timestamp
//        PUBLIC — Shopify's query HMAC + the signed state are the auth
//        (see ./oauth.ts). Finishes the install, then redirects the
//        merchant back to Settings (SHOPIFY_OAUTH_RETURN_URL) or answers
//        with a plain page when no return URL is configured.
//   POST /webhooks/:businessId
//        PUBLIC — the HMAC-SHA256 over the RAW body (X-Shopify-Hmac-Sha256)
//        is the auth. The raw body is stashed by the JSON parser in
//        server.ts (req.rawBody); without it the route fails closed.
//        The route acks 200 as soon as the HMAC checks out (Shopify
//        allows 5s per delivery) and processes asynchronously — see
//        ./webhooks.ts for the topic handling.
import { Request, Response, Router } from 'express';
import { getPrisma } from '../../utils/db.util';
import { authenticate, AuthRequest } from '../../middleware/auth.middleware';
import { resolveBusiness, resolveMembership } from '../../middleware/multitenancy.middleware';
import { requireRole } from '../../middleware/role.middleware';
import { IntegrationError } from '../vendor-client';
import {
  buildAuthorizeUrl,
  getShopifyOAuthConfig,
  handleOAuthCallback
} from './oauth';
import { handleShopifyWebhook, verifyShopifyWebhook } from './webhooks';
import { normalizeShopDomain } from './client';

const router = Router();

// Same business resolution as the integrations controller (FBR
// precedent): request context first, never the request body.
const resolveBusinessId = (req: AuthRequest): string =>
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  req.membership?.business_id ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  '';

router.get(
  '/oauth/install',
  authenticate,
  resolveBusiness({ required: false }),
  resolveMembership(),
  requireRole('OWNER', 'MANAGER'),
  (req: AuthRequest, res: Response) => {
    try {
      const cfg = getShopifyOAuthConfig();
      const businessId = resolveBusinessId(req);
      if (!businessId) {
        return res.status(400).send('Could not determine your business. Open the install from Settings → Integrations → Shopify.');
      }
      const shopDomain = normalizeShopDomain(req.query.shop);
      return res.redirect(buildAuthorizeUrl(cfg, shopDomain, businessId));
    } catch (error) {
      const message =
        error instanceof IntegrationError
          ? error.message
          : 'Could not start the Shopify install.';
      return res.status(400).send(message);
    }
  }
);

router.get('/oauth/callback', async (req: Request, res: Response) => {
  try {
    const outcome = await handleOAuthCallback(
      await getPrisma(),
      req.query as Record<string, string | string[] | undefined>
    );
    const cfg = getShopifyOAuthConfig();
    if (cfg.returnUrl) {
      const joiner = cfg.returnUrl.includes('?') ? '&' : '?';
      return res.redirect(
        `${cfg.returnUrl}${joiner}shopify=${outcome.ok ? 'connected' : 'error'}`
      );
    }
    return res.status(outcome.ok ? 200 : 400).send(
      `<html><body style="font-family:sans-serif;padding:40px"><h1>${outcome.ok ? 'Shopify connected' : 'Shopify connect failed'}</h1><p>${outcome.message}</p><p>Return to Zapeera → Settings → Integrations.</p></body></html>`
    );
  } catch (error) {
    const message =
      error instanceof IntegrationError ? error.message : 'Shopify OAuth is not configured on this server.';
    return res.status(500).send(message);
  }
});

router.post('/webhooks/:businessId', async (req: Request, res: Response) => {
  const rawBody = (req as any).rawBody as Buffer | undefined;
  if (!rawBody) {
    // The JSON parser must stash req.rawBody for this path (server.ts)
    // — without the raw bytes the HMAC cannot be verified, so fail
    // closed instead of processing an unverifiable delivery.
    return res.status(500).json({
      success: false,
      message: 'Webhook raw body was not captured by the server. The integration is misconfigured.'
    });
  }
  let secret: string;
  try {
    secret = getShopifyOAuthConfig().apiSecret;
  } catch {
    return res.status(500).json({ success: false, message: 'Shopify webhooks are not configured on this server.' });
  }
  if (!verifyShopifyWebhook(rawBody, req.get('X-Shopify-Hmac-Sha256'), secret)) {
    return res.status(401).json({ success: false, message: 'Webhook HMAC verification failed.' });
  }
  // Ack fast (Shopify allows 5s), then process asynchronously.
  res.status(200).json({ success: true, received: true });
  const prisma = await getPrisma().catch(() => null);
  if (!prisma) return;
  void handleShopifyWebhook({
    prisma,
    businessId: req.params.businessId,
    rawBody,
    hmacHeader: req.get('X-Shopify-Hmac-Sha256'),
    topic: req.get('X-Shopify-Topic'),
    shopDomainHeader: req.get('X-Shopify-Shop-Domain'),
    webhookId: req.get('X-Shopify-Webhook-Id'),
    secret
  }).catch((error) => {
    // eslint-disable-next-line no-console
    console.error('[Shopify webhook] async processing failed:', error instanceof Error ? error.message : error);
  });
  return;
});

export default router;
