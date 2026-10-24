// ─── Google Sheets provider — module barrel ────────────────────────────
// Imported (one line) by src/integrations/providers.ts. Importing the
// handler registers it with the framework, which flips the Google Sheets
// card from "Coming soon" to connectable. The OAuth HTTP handlers are
// wired separately: start inside routes/integrations.routes.ts, callback
// in server.ts (before the universal module protection middleware — the
// callback arrives from Google with no Zapeera session).
import './handler';

export { googleSheetsHandler } from './handler';
export { GoogleSheetsClient } from './client';
export {
  buildAuthorizationUrl,
  buildOAuthState,
  exchangeAuthorizationCode,
  getGoogleSheetsOAuthEnv,
  mintServiceAccountAccessToken,
  parseOAuthState,
  refreshAccessToken,
  revokeToken
} from './oauth';
export {
  startGoogleSheetsOAuthHandler,
  googleSheetsOAuthCallbackHandler
} from './oauth-routes';
