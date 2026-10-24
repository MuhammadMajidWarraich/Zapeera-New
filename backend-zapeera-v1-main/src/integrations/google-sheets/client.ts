// ─── Google Sheets provider — Sheets + Drive API client ───────────────
// Every call goes through withVendorRetry + IntegrationError (framework
// §6). No call here ever logs tokens. The client is deliberately
// fetch-injectable: tests pass a stub fetch, production uses global
// fetch — the module never touches a live Google account in tests.
//
// Endpoints (all verified against Google's docs 2026-10-24):
//   GET    /v4/spreadsheets/{id}                          — metadata/tabs
//   POST   /v4/spreadsheets                               — create spreadsheet
//   POST   /v4/spreadsheets/{id}:batchUpdate              — add a tab
//   GET    /v4/spreadsheets/{id}/values/{range}           — read header row
//   PUT    /v4/spreadsheets/{id}/values/{range}           — write header row
//   POST   /v4/spreadsheets/{id}/values/{range}:append     — append rows
//   GET    /drive/v3/files?pageSize=1                     — connect check

import { IntegrationError, mapVendorError, withVendorRetry } from '../vendor-client';
import { GOOGLE_DRIVE_API_BASE, GOOGLE_SHEETS_API_BASE } from './constants';
import {
  isOAuthCredentials,
  isServiceAccountCredentials,
  mintServiceAccountAccessToken,
  refreshAccessToken,
  type GoogleSheetsOAuthCredentials
} from './oauth';

export interface SpreadsheetInfo {
  spreadsheetId: string;
  title: string;
  sheetTitles: string[];
  spreadsheetUrl?: string;
}

type FetchImpl = typeof fetch;

export class GoogleSheetsClient {
  private readonly fetchImpl: FetchImpl;

  constructor(opts: { fetchImpl?: FetchImpl } = {}) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  // ─── Token resolution ────────────────────────────────────────────────

  /**
   * Resolve a usable access token for this credential set.
   * - Service account: mint a fresh token (1h, no refresh needed).
   * - OAuth: reuse the stored token while it has >60s of life; otherwise
   *   refresh silently. When a refresh happens and onRefreshed is given,
   *   the caller persists the new credentials (the handler does this in
   *   exportData via ctx.prisma; connect/getStatus have no persistence
   *   hook, so they refresh in-memory only — the next export persists).
   * Returns the token plus the credentials that should be stored
   * (identical to the input unless a refresh happened).
   */
  async resolveAccessToken(
    credentials: Record<string, unknown>,
    onRefreshed?: (updated: GoogleSheetsOAuthCredentials) => Promise<void> | void
  ): Promise<{ accessToken: string; credentials: Record<string, unknown> }> {
    if (isServiceAccountCredentials(credentials)) {
      const minted = await mintServiceAccountAccessToken(credentials, this.fetchImpl);
      return { accessToken: minted.accessToken, credentials };
    }
    if (!isOAuthCredentials(credentials)) {
      throw new IntegrationError(
        'VENDOR_AUTH',
        'google-sheets: no Google credentials are stored for this connection. Reconnect Google Sheets.'
      );
    }
    const oauth = credentials as GoogleSheetsOAuthCredentials;
    const freshEnough =
      typeof oauth.accessToken === 'string' &&
      oauth.accessToken.length > 0 &&
      typeof oauth.expiresAt === 'number' &&
      oauth.expiresAt > Date.now() + 60_000;
    if (freshEnough) return { accessToken: oauth.accessToken, credentials };
    if (typeof oauth.refreshToken === 'string' && oauth.refreshToken.length > 0) {
      // Throws VENDOR_AUTH when Google refuses the refresh — the
      // merchant must reconnect (revoked grant / expired refresh token).
      const refreshed = await refreshAccessToken(oauth.refreshToken, oauth, this.fetchImpl);
      const updated: GoogleSheetsOAuthCredentials = { ...oauth, ...refreshed };
      if (onRefreshed) await onRefreshed(updated);
      return { accessToken: refreshed.accessToken, credentials: updated };
    }
    if (typeof oauth.accessToken === 'string' && oauth.accessToken.length > 0) {
      // No expiry recorded (legacy row) — use the token as-is; Google
      // answers 401 if it is dead and the error maps to VENDOR_AUTH.
      return { accessToken: oauth.accessToken, credentials };
    }
    throw new IntegrationError(
      'VENDOR_AUTH',
      'google-sheets: the stored Google token is expired and no refresh token is available. Reconnect Google Sheets.'
    );
  }

  // ─── Low-level call ──────────────────────────────────────────────────

  private async callJson<T>(accessToken: string, url: string, init: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
    if (init.method && init.method !== 'GET') headers['Content-Type'] = 'application/json';
    return withVendorRetry<T>('google-sheets', async (signal) => {
      const res = await this.fetchImpl(url, { ...init, signal, headers });
      if (!res.ok) {
        let detail = '';
        try {
          const parsed: any = await res.json();
          if (typeof parsed?.error?.message === 'string') detail = parsed.error.message;
        } catch {
          // Non-JSON error body — fall through to the status mapping.
        }
        const mapped = mapVendorError(res, 'google-sheets');
        throw new IntegrationError(mapped.code, detail ? `google-sheets: ${detail.slice(0, 200)}` : mapped.message, {
          status: mapped.status,
          retryable: mapped.retryable
        });
      }
      return (await res.json()) as T;
    });
  }

  // ─── Verification read ───────────────────────────────────────────────

  /**
   * The cheap vendor read connect()/getStatus() verify with. The Sheets
   * API has no "list spreadsheets" endpoint, so this is Drive files.list
   * with pageSize=1 under the drive.file scope — it returns only files
   * this app created, which is exactly the proof that the token works.
   */
  async verifyConnection(accessToken: string): Promise<boolean> {
    const url = `${GOOGLE_DRIVE_API_BASE}/files?pageSize=1&fields=files(id)`;
    await this.callJson<{ files?: Array<{ id: string }> }>(accessToken, url);
    return true;
  }

  // ─── Spreadsheets ────────────────────────────────────────────────────

  async getSpreadsheet(accessToken: string, spreadsheetId: string): Promise<SpreadsheetInfo> {
    const url =
      `${GOOGLE_SHEETS_API_BASE}/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
      `?fields=properties.title,sheets.properties.title,spreadsheetUrl`;
    const data = await this.callJson<any>(accessToken, url);
    return {
      spreadsheetId,
      title: String(data?.properties?.title ?? ''),
      sheetTitles: Array.isArray(data?.sheets)
        ? data.sheets.map((s: any) => String(s?.properties?.title ?? '')).filter(Boolean)
        : [],
      spreadsheetUrl: typeof data?.spreadsheetUrl === 'string' ? data.spreadsheetUrl : undefined
    };
  }

  async createSpreadsheet(accessToken: string, title: string, tabs: string[]): Promise<SpreadsheetInfo> {
    const data = await this.callJson<any>(accessToken, `${GOOGLE_SHEETS_API_BASE}/spreadsheets`, {
      method: 'POST',
      body: JSON.stringify({
        properties: { title },
        sheets: tabs.map((t) => ({ properties: { title: t } }))
      })
    });
    const id = String(data?.spreadsheetId ?? '');
    if (!id) {
      throw new IntegrationError('VENDOR_ERROR', 'google-sheets: Google did not return a spreadsheet id when creating the export spreadsheet.');
    }
    return {
      spreadsheetId: id,
      title: String(data?.properties?.title ?? title),
      sheetTitles: Array.isArray(data?.sheets)
        ? data.sheets.map((s: any) => String(s?.properties?.title ?? '')).filter(Boolean)
        : tabs,
      spreadsheetUrl: typeof data?.spreadsheetUrl === 'string' ? data.spreadsheetUrl : undefined
    };
  }

  async addSheet(accessToken: string, spreadsheetId: string, title: string): Promise<void> {
    await this.callJson(accessToken, `${GOOGLE_SHEETS_API_BASE}/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] })
    });
  }

  // ─── Values ──────────────────────────────────────────────────────────

  private range(tab: string, a1: string): string {
    // A1 notation with the tab quoted (tab names are ours, but quoting is
    // the documented-safe form when a title contains spaces).
    return encodeURIComponent(`'${tab}'!${a1}`);
  }

  /** First row of a tab (the header row), or [] when the tab is empty. */
  async getFirstRow(accessToken: string, spreadsheetId: string, tab: string): Promise<Array<string | number>> {
    const data = await this.callJson<any>(
      accessToken,
      `${GOOGLE_SHEETS_API_BASE}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${this.range(tab, 'A1:Z1')}`
    );
    const values = Array.isArray(data?.values) ? data.values : [];
    return values.length > 0 ? values[0] : [];
  }

  /** Write the header row (row 1). Used ONLY when the tab has no header yet — never on append runs. */
  async writeHeaderRow(
    accessToken: string,
    spreadsheetId: string,
    tab: string,
    header: string[]
  ): Promise<void> {
    await this.callJson(
      accessToken,
      `${GOOGLE_SHEETS_API_BASE}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${this.range(tab, 'A1:Z1')}?valueInputOption=USER_ENTERED`,
      {
        method: 'PUT',
        body: JSON.stringify({ range: `'${tab}'!A1:Z1`, majorDimension: 'ROWS', values: [header] })
      }
    );
  }

  /**
   * Append rows after the last row of the tab's table.
   * insertDataOption=INSERT_ROWS is what makes this append-not-overwrite:
   * new rows are inserted; existing history is never touched.
   */
  async appendRows(
    accessToken: string,
    spreadsheetId: string,
    tab: string,
    rows: Array<Array<string | number>>
  ): Promise<number> {
    if (rows.length === 0) return 0;
    const data = await this.callJson<any>(
      accessToken,
      `${GOOGLE_SHEETS_API_BASE}/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${this.range(tab, 'A1')}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
      {
        method: 'POST',
        body: JSON.stringify({ range: `'${tab}'!A1`, majorDimension: 'ROWS', values: rows })
      }
    );
    const updatedRows = Number(data?.updates?.updatedRows);
    return Number.isFinite(updatedRows) ? updatedRows : rows.length;
  }

  /** Create the tab if missing, then write the header row if the tab is empty. */
  async ensureTabWithHeader(
    accessToken: string,
    spreadsheetId: string,
    tab: string,
    header: string[],
    knownSheetTitles: string[]
  ): Promise<void> {
    if (!knownSheetTitles.includes(tab)) {
      await this.addSheet(accessToken, spreadsheetId, tab);
    }
    const firstRow = await this.getFirstRow(accessToken, spreadsheetId, tab);
    if (firstRow.length === 0) {
      await this.writeHeaderRow(accessToken, spreadsheetId, tab, header);
    }
  }
}
