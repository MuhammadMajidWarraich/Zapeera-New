// ─── Google Sheets provider — OAuth start + callback HTTP handlers ───
// The START route lives inside the authenticated integrations router
// (OWNER/MANAGER only, like every other integration route). The
// CALLBACK route is registered in server.ts BEFORE the universal module
// protection middleware on purpose: Google redirects the merchant's
// browser here with no Zapeera session, so it cannot carry a Bearer
// token. The callback is self-authenticating instead:
//   - `state` is an AES-256-GCM blob (INTEGRATION_ENCRYPTION_KEY)
//     minted at start time, carrying the business id + the merchant's
//     spreadsheet/branch picks, expiring after 10 minutes;
//   - the authorization `code` is single-use and bound to the exact
//     redirect URI registered in Google Cloud Console;
//   - the code exchange needs the server-side client secret, which
//     never leaves the server.
// The callback never renders tokens and never puts them in the redirect
// URL — it redirects the browser to the frontend Settings page with only
// ?integration=google-sheets&oauth=connected|error.

import { Request, Response } from 'express';
import { getPrisma } from '../../utils/db.util';
import { AuthRequest } from '../../middleware/auth.middleware';
import { IntegrationError } from '../vendor-client';
import { connectProvider } from '../../services/integration.service';
import {
  buildAuthorizationUrl,
  buildOAuthState,
  exchangeAuthorizationCode,
  parseOAuthState
} from './oauth';

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

// Mirrors the business-id resolver in controllers/integrations.controller.ts.
const resolveIntegrationBusinessId = (req: AuthRequest): string =>
  req.business_id ||
  (req.headers['x-company-id'] as string) ||
  req.membership?.business_id ||
  (req.headers['x-business-id'] as string) ||
  req.user?.selectedCompanyId ||
  req.user?.companyId ||
  'no-business-context';

const frontendSettingsUrl = (params: Record<string, string>): string => {
  const query = new URLSearchParams({ integration: 'google-sheets', ...params }).toString();
  const base = (process.env.FRONTEND_URL ?? '').trim().replace(/\/$/, '');
  // Desktop (embedded server serves the UI itself): FRONTEND_URL is
  // unset, so a relative redirect lands on the same origin.
  return base ? `${base}/settings?${query}` : `/settings?${query}`;
};

/**
 * GET /api/integrations/google-sheets/oauth/start (authenticated).
 * Query: ?spreadsheetId=…&branchId=… (both optional — blank spreadsheet
 * means "create one on first export"). Returns { authUrl } — the
 * frontend navigates the whole page to it (Google consent screen).
 */
export const startGoogleSheetsOAuthHandler = async (req: AuthRequest, res: Response) => {
  try {
    const businessId = resolveIntegrationBusinessId(req);
    if (!businessId || businessId === 'no-business-context') {
      return res.status(400).json({
        success: false,
        code: 'VALIDATION_ERROR',
        message: 'No business context — open Settings from inside a business first.'
      });
    }
    const spreadsheetId =
      typeof req.query.spreadsheetId === 'string' && req.query.spreadsheetId.trim()
        ? req.query.spreadsheetId.trim().slice(0, 200)
        : undefined;
    const branchId =
      typeof req.query.branchId === 'string' && req.query.branchId.trim()
        ? req.query.branchId.trim().slice(0, 100)
        : undefined;
    // buildOAuthState throws when the encryption key is unset, and
    // buildAuthorizationUrl throws when the OAuth client env is unset —
    // both fail loudly here, before the merchant leaves for Google.
    const state = buildOAuthState({ businessId, spreadsheetId, branchId });
    const authUrl = buildAuthorizationUrl(state);
    return res.json({ success: true, data: { authUrl } });
  } catch (error) {
    if (error instanceof IntegrationError) {
      return res.status(ERROR_STATUS[error.code] ?? 500).json({
        success: false,
        code: error.code,
        message: error.message
      });
    }
    // eslint-disable-next-line no-console
    console.error('[Google Sheets OAuth] unexpected start error:', error instanceof Error ? error.message : error);
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Could not start the Google connect flow.'
    });
  }
};

/**
 * GET /api/v1/integrations/google-sheets/oauth/callback (UNAUTHENTICATED
 * — see the header comment). Google redirects here with ?code=&state=
 * (or ?error=access_denied when the merchant declines). Exchanges the
 * code, verifies the tokens with a cheap vendor read via connectProvider,
 * stores them encrypted, then redirects to Settings.
 */
export const googleSheetsOAuthCallbackHandler = async (req: Request, res: Response) => {
  const fail = (message: string) =>
    res.redirect(frontendSettingsUrl({ oauth: 'error', oauthMessage: message.slice(0, 200) }));
  try {
    const googleError = typeof req.query.error === 'string' ? req.query.error : undefined;
    if (googleError) {
      return fail(
        googleError === 'access_denied'
          ? 'Google sign-in was cancelled.'
          : `Google sign-in failed (${googleError}).`
      );
    }
    const code = typeof req.query.code === 'string' ? req.query.code : undefined;
    const rawState = typeof req.query.state === 'string' ? req.query.state : undefined;
    if (!code || !rawState) {
      return fail('Google did not return an authorization code. Try connecting again.');
    }
    const state = parseOAuthState(rawState);
    const tokens = await exchangeAuthorizationCode(code);
    const prisma = await getPrisma();
    await connectProvider(prisma, state.businessId, 'google-sheets', tokens as unknown as Record<string, unknown>, {
      spreadsheetId: state.spreadsheetId,
      branchId: state.branchId,
      direction: 'out'
    });
    return res.redirect(frontendSettingsUrl({ oauth: 'connected' }));
  } catch (error) {
    const message =
      error instanceof IntegrationError
        ? error.message
        : 'Google sign-in could not be completed. Try connecting again.';
    // eslint-disable-next-line no-console
    console.error('[Google Sheets OAuth] callback failed:', message);
    return fail(message);
  }
};
