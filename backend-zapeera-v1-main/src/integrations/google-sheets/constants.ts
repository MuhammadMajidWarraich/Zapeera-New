// ─── Google Sheets provider — endpoint + scope constants ───────────────
// Every URL below is from Google's own docs (verified 2026-10-24):
//   Sheets API reference — https://developers.google.com/workspace/sheets/api
//   OAuth 2.0 for Web Server Applications —
//     https://developers.google.com/identity/protocols/oauth2/web-server
//   OAuth 2.0 for Server to Server Applications (service accounts) —
//     https://developers.google.com/identity/protocols/oauth2/service-account
// Do not invent endpoints: if Google moves one, update the doc link here.

/** Google Sheets API v4. */
export const GOOGLE_SHEETS_API_BASE = 'https://sheets.googleapis.com/v4';
/** Google Drive API v3 — used ONLY for the cheap connect verification read. */
export const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';
/** Google OAuth 2.0 authorization endpoint (user consent). */
export const GOOGLE_OAUTH_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
/** Google OAuth 2.0 token endpoint (code exchange + refresh). */
export const GOOGLE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
/** Google OAuth 2.0 token revocation endpoint. */
export const GOOGLE_OAUTH_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';

/**
 * Scopes requested at consent time.
 * - spreadsheets: read/write/append values + create spreadsheets.
 * - drive.file: create files the app owns + list files the app created
 *   (the connect verification read uses Drive files.list pageSize=1 —
 *   the Sheets API has no "list spreadsheets" endpoint, so this is the
 *   cheapest documented read that proves the token works).
 * drive.file is deliberately the narrowest Drive scope: Zapeera never
 * sees the merchant's other Drive files.
 */
export const GOOGLE_SHEETS_SCOPES: string[] = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file'
];

/** One tab per exported entity, in this order. */
export const GOOGLE_SHEETS_TABS = ['Sales', 'Stock', 'Customers', 'Khata'] as const;

/** Cap per entity per export run (one append call per tab). */
export const GOOGLE_SHEETS_MAX_ROWS_PER_ENTITY = 5000;
