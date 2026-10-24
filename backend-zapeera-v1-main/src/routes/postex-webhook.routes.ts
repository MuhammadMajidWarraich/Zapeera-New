// ─── PostEx webhook receiver (feature/integration-postex) ────────────────
// Public (unauthenticated) route — PostEx calls it, not a signed-in user.
// Mounted in server.ts at /api/integrations/postex/webhook (and /api/v1/…),
// listed in ALWAYS_ALLOWED_ROUTES + CSRF_EXEMPT_PATHS so the module gate
// and CSRF middleware let it through. Register this URL in the PostEx
// merchant dashboard as the webhook / callback URL:
//
//   https://<your-zapeera-host>/api/integrations/postex/webhook
//
// ── NO SIGNATURE VERIFICATION (honest limitation) ─────────────────────────
// PostEx evidences webhook support but publishes NO verification mechanism
// (no signature header or shared-secret scheme in any doc we could access,
// 2026-10-24). This receiver therefore accepts the payload as-is and only
// ever updates the carrier-status string on the sale whose tracking number
// matches — never money, stock or credentials. Confirm a status with a
// tracking lookup before acting on it, and add HMAC verification here the
// moment PostEx documents it.
import { Router } from 'express';
import type { Request, Response } from 'express';
import { getPrisma } from '../utils/db.util';
import { processPostExWebhook } from '../integrations/postex/handler';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  try {
    const prisma = await getPrisma();
    const outcome = await processPostExWebhook(prisma, req.body ?? {});
    // Always 200 when the payload was received: PostEx retries on 4xx/5xx,
    // and an unknown tracking number is not a delivery failure.
    return res.json({ success: true, data: outcome });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(
      '[PostEx webhook] failed:',
      error instanceof Error ? error.message : error
    );
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'The webhook could not be processed.'
    });
  }
});

export default router;
