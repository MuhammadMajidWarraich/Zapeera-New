// ─── Google Sheets provider — OAuth 2.0 + service-account auth ────────
// Two credential shapes, both stored encrypted by the framework (never
// logged, never returned by any API):
//
//   OAuth 2.0 (PRIMARY — the merchant signs in on Google's own page):
//     { accessToken, refreshToken, expiresAt, tokenType: 'Bearer' }
//     accessToken lives ~1h; refreshToken is exchanged silently for a new
//     one (see refreshAccessToken). Obtained via the authorization-code
//     flow: GET /google-sheets/oauth/start -> Google consent ->
//     GET /google-sheets/oauth/callback -> code exchange -> connect.
//
//   Service account (DOCUMENTED ALTERNATIVE — no merchant sign-in):
//     { serviceAccountEmail, serviceAccountPrivateKey }
//     A short-lived access token is minted on every call by signing a
//     RS256 JWT with the account's private key (google-auth-library NOT
//     required — plain Node crypto). The merchant must share the target
//     spreadsheet with the service-account email, or the export creates
//     a spreadsheet owned by the service account. Use this when one
//     shared company spreadsheet is the target and no per-user consent
//     is wanted. Connected via POST /:provider/connect with the two keys
//     (no UI field for it yet — the Settings dialog is OAuth-only).
//
// Env (server-side, never per-business):
//   GOOGLE_SHEETS_CLIENT_ID / GOOGLE_SHEETS_CLIENT_SECRET — the OAuth
//   2.0 web-application client from Google Cloud Console (Sheets API
//   enabled). GOOGLE_SHEETS_REDIRECT_URI — the exact callback URI
//   registered for that client, e.g.
//   https://<api-host>/api/v1/integrations/google-sheets/oauth/callback
//   Missing values fail loudly at flow start, never silently.

import * as crypto from 'crypto';
import {
  decryptIntegrationSecret,
  encryptIntegrationSecret
} from '../../utils/integration-encryption.util';
import { IntegrationError, mapVendorError, withVendorRetry } from '../vendor-client';
import {
  GOOGLE_OAUTH_AUTH_URL,
  GOOGLE_OAUTH_REVOKE_URL,
  GOOGLE_OAUTH_TOKEN_URL,
  GOOGLE_SHEETS_SCOPES
} from './constants';

export interface GoogleSheetsOAuthCredentials {
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms when the access token expires (from expires_in). */
  expiresAt?: number;
  tokenType?: string;
  /** Index signature: credentials travel as Record<string, unknown> through the framework. */
  [key: string]: unknown;
}

export interface GoogleSheetsServiceAccountCredentials {
  serviceAccountEmail: string;
  serviceAccountPrivateKey: string;
  /** Index signature: credentials travel as Record<string, unknown> through the framework. */
  [key: string]: unknown;
}

export type GoogleSheetsCredentials =
  | GoogleSheetsOAuthCredentials
  | GoogleSheetsServiceAccountCredentials;

export function isServiceAccountCredentials(
  credentials: Record<string, unknown>
): credentials is GoogleSheetsServiceAccountCredentials {
  return (
    typeof credentials.serviceAccountEmail === 'string' &&
    typeof credentials.serviceAccountPrivateKey === 'string'
  );
}

export function isOAuthCredentials(
  credentials: Record<string, unknown>
): credentials is GoogleSheetsOAuthCredentials {
  return typeof credentials.accessToken === 'string' || typeof credentials.refreshToken === 'string';
}

export interface GoogleSheetsOAuthEnv {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

/** Fail loudly when the server-side OAuth client is not configured. */
export function getGoogleSheetsOAuthEnv(): GoogleSheetsOAuthEnv {
  const clientId = (process.env.GOOGLE_SHEETS_CLIENT_ID ?? '').trim();
  const clientSecret = (process.env.GOOGLE_SHEETS_CLIENT_SECRET ?? '').trim();
  const redirectUri = (process.env.GOOGLE_SHEETS_REDIRECT_URI ?? '').trim();
  if (!clientId || !clientSecret || !redirectUri) {
    throw new IntegrationError(
      'VENDOR_ERROR',
      'Google Sheets OAuth is not configured on this server — set GOOGLE_SHEETS_CLIENT_ID, GOOGLE_SHEETS_CLIENT_SECRET and GOOGLE_SHEETS_REDIRECT_URI, then try again.'
    );
  }
  return { clientId, clientSecret, redirectUri };
}

/**
 * Authorization URL for step 1 of the web-server flow.
 * access_type=offline → Google returns a refresh token; prompt=consent
 * → a refresh token is issued even if this Google account already
 * consented once (Google otherwise only returns one on first consent).
 */
export function buildAuthorizationUrl(state: string): string {
  const { clientId, redirectUri } = getGoogleSheetsOAuthEnv();
  const url = new URL(GOOGLE_OAUTH_AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', GOOGLE_SHEETS_SCOPES.join(' '));
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  return url.toString();
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
}

async function postToTokenEndpoint(
  params: Record<string, string>,
  fetchImpl: typeof fetch = fetch
): Promise<TokenResponse> {
  const body = new URLSearchParams(params).toString();
  const data = await withVendorRetry<TokenResponse>('google-sheets', async (signal) => {
    const res = await fetchImpl(GOOGLE_OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal
    });
    if (!res.ok) {
      // Surface Google's own error message (e.g. invalid_grant on a
      // revoked/used code) instead of a bare HTTP status.
      let detail = '';
      try {
        const parsed: any = await res.json();
        if (typeof parsed?.error_description === 'string') detail = parsed.error_description;
        else if (typeof parsed?.error === 'string') detail = parsed.error;
      } catch {
        // Non-JSON error body — fall through to the status mapping.
      }
      const mapped = mapVendorError(res, 'google-sheets');
      throw new IntegrationError(mapped.code, detail ? `google-sheets: ${detail.slice(0, 200)}` : mapped.message, {
        status: mapped.status,
        retryable: mapped.retryable
      });
    }
    return (await res.json()) as TokenResponse;
  });
  return data;
}

/** Step 3 of the web-server flow: exchange the code for tokens. */
export async function exchangeAuthorizationCode(
  code: string,
  fetchImpl: typeof fetch = fetch
): Promise<GoogleSheetsOAuthCredentials> {
  const { clientId, clientSecret, redirectUri } = getGoogleSheetsOAuthEnv();
  const data = await postToTokenEndpoint(
    {
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    },
    fetchImpl
  );
  if (!data.access_token) {
    throw new IntegrationError('VENDOR_AUTH', 'google-sheets: Google did not return an access token.');
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    tokenType: data.token_type ?? 'Bearer'
  };
}

/** Silent refresh (no user interaction). Keeps the old refresh token when Google does not rotate it. */
export async function refreshAccessToken(
  refreshToken: string,
  previous: GoogleSheetsOAuthCredentials,
  fetchImpl: typeof fetch = fetch
): Promise<GoogleSheetsOAuthCredentials> {
  const { clientId, clientSecret } = getGoogleSheetsOAuthEnv();
  const data = await postToTokenEndpoint(
    {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token'
    },
    fetchImpl
  );
  if (!data.access_token) {
    throw new IntegrationError('VENDOR_AUTH', 'google-sheets: Google refused to refresh the access token. Reconnect Google Sheets.');
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? previous.refreshToken,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    tokenType: data.token_type ?? 'Bearer'
  };
}

/** Best-effort revoke (disconnect). Failures are swallowed by the caller — local wipe is authoritative. */
export async function revokeToken(token: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  await withVendorRetry('google-sheets', async (signal) => {
    const res = await fetchImpl(GOOGLE_OAUTH_REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      signal
    });
    if (!res.ok) throw res;
  });
}

// ─── Service-account JWT (no google-auth-library needed) ───────────────

function base64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * Mint a short-lived access token for a service account: sign a RS256
 * JWT (iss = service-account email, aud = token endpoint, scope =
 * the Sheets scopes, exp ≤ 1h) and exchange it with the jwt-bearer
 * grant. Verbatim from Google's "Using OAuth 2.0 for Server to Server
 * Applications" doc.
 */
export async function mintServiceAccountAccessToken(
  credentials: GoogleSheetsServiceAccountCredentials,
  fetchImpl: typeof fetch = fetch
): Promise<{ accessToken: string; expiresAt: number }> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: credentials.serviceAccountEmail,
    scope: GOOGLE_SHEETS_SCOPES.join(' '),
    aud: GOOGLE_OAUTH_TOKEN_URL,
    iat: now,
    exp: now + 3600
  };
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`;
  let signature: Buffer;
  try {
    signature = crypto
      .createSign('RSA-SHA256')
      .update(unsigned)
      .sign(credentials.serviceAccountPrivateKey);
  } catch {
    throw new IntegrationError(
      'VENDOR_AUTH',
      'google-sheets: the service-account private key could not be used to sign the token request. Check the stored service-account key.'
    );
  }
  const assertion = `${unsigned}.${base64url(signature)}`;
  const data = await postToTokenEndpoint(
    {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    },
    fetchImpl
  );
  if (!data.access_token) {
    throw new IntegrationError('VENDOR_AUTH', 'google-sheets: Google did not return an access token for the service account.');
  }
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000
  };
}

// ─── OAuth state (CSRF protection for the callback) ─────────────────────

export interface GoogleSheetsOAuthState {
  /** Business the flow was started for (from the authenticated session). */
  businessId: string;
  /** Spreadsheet the merchant picked in the dialog, if any. */
  spreadsheetId?: string;
  /** Branch the merchant picked in the dialog, if any. */
  branchId?: string;
  /** Epoch ms — state expires 10 minutes after it is issued. */
  exp: number;
}

/** Encrypt the state with the framework key (AES-256-GCM) — tamper-proof and opaque to the browser. */
export function buildOAuthState(state: Omit<GoogleSheetsOAuthState, 'exp'>): string {
  const payload: GoogleSheetsOAuthState = { ...state, exp: Date.now() + 10 * 60 * 1000 };
  return encryptIntegrationSecret(JSON.stringify(payload));
}

/** Decrypt + validate the state Google hands back. Throws on tamper/expiry. */
export function parseOAuthState(state: string): GoogleSheetsOAuthState {
  let parsed: GoogleSheetsOAuthState;
  try {
    parsed = JSON.parse(decryptIntegrationSecret(state)) as GoogleSheetsOAuthState;
  } catch {
    throw new IntegrationError('VENDOR_AUTH', 'google-sheets: the OAuth state could not be verified. Start the Google connect flow again.');
  }
  if (!parsed || typeof parsed.businessId !== 'string' || !parsed.businessId) {
    throw new IntegrationError('VENDOR_AUTH', 'google-sheets: the OAuth state is missing its business. Start the Google connect flow again.');
  }
  if (typeof parsed.exp !== 'number' || parsed.exp < Date.now()) {
    throw new IntegrationError('VENDOR_AUTH', 'google-sheets: the Google connect flow expired (10 minutes). Start it again.');
  }
  return parsed;
}
