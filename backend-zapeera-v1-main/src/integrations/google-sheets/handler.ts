// ─── Google Sheets provider — sync handler (feature/integration-google-sheets) ─
// EXPORT-ONLY provider: Zapeera data -> a Google Sheet the merchant
// picks (spreadsheet id in the connection config). One tab per entity —
// Sales, Stock, Customers, Khata — header row + APPENDED rows (append,
// never overwrite: history is never touched, a repeat export adds a
// fresh snapshot stamped with its "Exported At" time). When the merchant
// has no spreadsheet, the handler creates one via the API and records
// its id back into the connection config.
//
// Branch scope: exports are per-business AND per-branch. config.branchId
// picks one branch; without it every branch exports and EVERY row
// carries its Branch in column A, so branches never mix silently.
//
// Auth: OAuth 2.0 (primary, see ./oauth.ts) or service account
// (documented alternative). Tokens are stored encrypted by the framework
// and refreshed silently; a refreshed token is persisted back to the
// connection row during exportData (connect/getStatus have no DB hook
// in the framework, so they refresh in-memory only).
//
// Honest limitations (also on the registry card): Google Sheets has NO
// native webhooks — export is manual ("Export now") or triggered, NOT
// live-synced. A repeat export appends a new snapshot; it does not
// deduplicate against previous runs.

import { encryptIntegrationCredentials } from '../../utils/integration-encryption.util';
import { registerIntegrationHandler } from '../registry';
import type {
  IntegrationSyncContext,
  IntegrationSyncHandler,
  IntegrationSyncResult
} from '../types';
import { IntegrationError } from '../vendor-client';
import { GoogleSheetsClient } from './client';
import { GOOGLE_SHEETS_MAX_ROWS_PER_ENTITY, GOOGLE_SHEETS_TABS } from './constants';
import {
  CUSTOMER_HEADERS,
  KHATA_HEADERS,
  SALES_HEADERS,
  STOCK_HEADERS,
  mapCustomerRow,
  mapKhataRow,
  mapSaleRow,
  mapStockRow
} from './mapping';
import { revokeToken } from './oauth';

const PROVIDER = 'google-sheets' as const;

/** Read the connection row's stored config JSON (guarded — a corrupt row must not break the export). */
function parseStoredConfig(stored: unknown): Record<string, unknown> {
  if (typeof stored !== 'string' || !stored) return {};
  try {
    const parsed = JSON.parse(stored) as Record<string, unknown>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function persistCredentials(
  prisma: any,
  businessId: string,
  credentials: Record<string, unknown>
): Promise<void> {
  if (!prisma?.integrationConnection?.update) return;
  await prisma.integrationConnection.update({
    where: { businessId_provider: { businessId, provider: PROVIDER } },
    data: { encryptedCredentials: encryptIntegrationCredentials(credentials) }
  });
}

async function persistSpreadsheetId(
  prisma: any,
  businessId: string,
  spreadsheetId: string
): Promise<void> {
  if (!prisma?.integrationConnection?.findUnique || !prisma?.integrationConnection?.update) return;
  const row = await prisma.integrationConnection.findUnique({
    where: { businessId_provider: { businessId, provider: PROVIDER } }
  });
  if (!row) return;
  const config = { ...parseStoredConfig(row.config), spreadsheetId };
  await prisma.integrationConnection.update({
    where: { businessId_provider: { businessId, provider: PROVIDER } },
    data: { config: JSON.stringify(config) }
  });
}

export const googleSheetsHandler: IntegrationSyncHandler = {
  provider: PROVIDER,

  async connect(credentials) {
    const client = new GoogleSheetsClient();
    const { accessToken } = await client.resolveAccessToken(credentials);
    // Cheap vendor read (Drive files.list pageSize=1 — the Sheets API
    // has no list endpoint). Throws VENDOR_AUTH/VENDOR_UNREACHABLE on
    // failure; ok:true is returned ONLY after the round-trip.
    await client.verifyConnection(accessToken);
    return { ok: true, message: 'Google Sheets reachable' };
  },

  async disconnect(credentials) {
    // Revoke the grant where Google supports it. Best-effort: the
    // framework wipes the stored credentials regardless, and a failed
    // revoke must never block the disconnect.
    try {
      const accessToken = typeof credentials.accessToken === 'string' ? credentials.accessToken : undefined;
      const refreshToken = typeof credentials.refreshToken === 'string' ? credentials.refreshToken : undefined;
      if (refreshToken) await revokeToken(refreshToken);
      else if (accessToken) await revokeToken(accessToken);
    } catch {
      // Swallowed — local credential wipe is authoritative.
    }
  },

  async getStatus(credentials) {
    try {
      const client = new GoogleSheetsClient();
      const { accessToken } = await client.resolveAccessToken(credentials);
      await client.verifyConnection(accessToken);
      return { ok: true, message: 'Google Sheets reachable' };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof IntegrationError
            ? error.message
            : 'google-sheets: Google could not be reached.'
      };
    }
  },

  /**
   * Generic export run (entity 'export', direction 'out'). Exports all
   * four entities in one run, one tab each, appended rows. A single
   * tab failing does not abort the others — its rows count as failed
   * and the run finishes 'partial' with the reason in the message.
   */
  async exportData(ctx: IntegrationSyncContext): Promise<IntegrationSyncResult> {
    const { prisma, businessId } = ctx;
    const config = ctx.config ?? {};
    const branchId = typeof config.branchId === 'string' && config.branchId ? config.branchId : undefined;
    const client = new GoogleSheetsClient();

    // Persist refreshed OAuth tokens back to the connection row so the
    // next run does not have to refresh again.
    const { accessToken } = await client.resolveAccessToken(ctx.credentials, async (updated) => {
      await persistCredentials(prisma, businessId, updated);
    });

    // ── Branch scope ────────────────────────────────────────────────
    const branchNames = new Map<string, string>();
    if (branchId) {
      const branch = await prisma.branch?.findUnique?.({ where: { id: branchId } });
      if (!branch) {
        throw new IntegrationError(
          'SYNC_FAILED',
          'google-sheets: the branch saved in the Google Sheets settings no longer exists. Pick a branch again in Settings → Integrations.'
        );
      }
      branchNames.set(branch.id, String(branch.name ?? branch.id));
    } else {
      const branches: any[] = (await prisma.branch?.findMany?.({ where: { companyId: businessId } })) ?? [];
      for (const b of branches) branchNames.set(String(b.id), String(b.name ?? b.id));
    }
    const branchNameFor = (id: unknown): string => branchNames.get(String(id ?? '')) ?? String(id ?? '');

    // ── Spreadsheet: use the configured one, or create + record it ──
    let spreadsheetId = typeof config.spreadsheetId === 'string' ? config.spreadsheetId : undefined;
    let spreadsheetTitle = '';
    let spreadsheetUrl: string | undefined;
    let sheetTitles: string[] = [];
    if (spreadsheetId) {
      try {
        const info = await client.getSpreadsheet(accessToken, spreadsheetId);
        spreadsheetTitle = info.title;
        spreadsheetUrl = info.spreadsheetUrl;
        sheetTitles = info.sheetTitles;
      } catch (error) {
        if (error instanceof IntegrationError && error.status === 404) {
          throw new IntegrationError(
            'VENDOR_ERROR',
            `google-sheets: the configured spreadsheet (${spreadsheetId}) was not found — it may have been deleted. Clear the spreadsheet id in Settings → Integrations to create a new one.`
          );
        }
        throw error;
      }
    } else {
      const business = await prisma.business?.findUnique?.({ where: { id: businessId }, select: { name: true } });
      const title = business?.name ? `Zapeera Export — ${business.name}` : 'Zapeera Export';
      const created = await client.createSpreadsheet(accessToken, title, [...GOOGLE_SHEETS_TABS]);
      spreadsheetId = created.spreadsheetId;
      spreadsheetTitle = created.title;
      spreadsheetUrl = created.spreadsheetUrl;
      sheetTitles = created.sheetTitles;
      await persistSpreadsheetId(prisma, businessId, spreadsheetId);
    }

    const exportedAt = new Date().toISOString();
    const branchWhere = branchId ? { branchId } : {};

    let recordsProcessed = 0;
    let recordsFailed = 0;
    const failures: string[] = [];
    const perTab: Record<string, number> = {};

    const exportTab = async (
      tab: string,
      header: readonly string[],
      rows: Array<Array<string | number>>
    ): Promise<void> => {
      try {
        await client.ensureTabWithHeader(accessToken, spreadsheetId as string, tab, [...header], sheetTitles);
        const appended = await client.appendRows(accessToken, spreadsheetId as string, tab, rows);
        perTab[tab] = appended;
        recordsProcessed += appended;
      } catch (error) {
        recordsFailed += rows.length;
        perTab[tab] = 0;
        failures.push(
          `${tab}: ${error instanceof IntegrationError ? error.message : 'export failed'}`
        );
      }
    };

    // ── Sales ───────────────────────────────────────────────────────
    const sales: any[] =
      (await prisma.sale?.findMany?.({
        where: { companyId: businessId, ...branchWhere },
        orderBy: { createdAt: 'asc' },
        take: GOOGLE_SHEETS_MAX_ROWS_PER_ENTITY,
        include: { customer: { select: { name: true, phone: true } } }
      })) ?? [];
    await exportTab(
      'Sales',
      SALES_HEADERS,
      sales.map((s) => mapSaleRow(branchNameFor(s.branchId), s, exportedAt))
    );

    // ── Stock (products + their batches, aggregated per product) ────
    const products: any[] =
      (await prisma.product?.findMany?.({
        where: { companyId: businessId, ...branchWhere, isActive: true },
        orderBy: { name: 'asc' },
        take: GOOGLE_SHEETS_MAX_ROWS_PER_ENTITY,
        include: { category: { select: { name: true } } }
      })) ?? [];
    const batches: any[] =
      (await prisma.batch?.findMany?.({
        where: { companyId: businessId, ...branchWhere, isActive: true },
        orderBy: { createdAt: 'desc' }
      })) ?? [];
    const batchesByProduct = new Map<string, any[]>();
    for (const batch of batches) {
      const key = String(batch.productId);
      const list = batchesByProduct.get(key) ?? [];
      list.push(batch);
      batchesByProduct.set(key, list);
    }
    await exportTab(
      'Stock',
      STOCK_HEADERS,
      products.map((p) => {
        const productBatches = batchesByProduct.get(String(p.id)) ?? [];
        const quantity = productBatches.reduce((sum, b) => sum + (Number(b.quantity) || 0), 0);
        // Batches arrive newest-first: the first batch's price is the current selling price.
        const sellingPrice = productBatches.length > 0 ? Number(productBatches[0].sellingPrice) || 0 : 0;
        return mapStockRow(branchNameFor(p.branchId), p, quantity, sellingPrice, exportedAt);
      })
    );

    // ── Customers ───────────────────────────────────────────────────
    const customers: any[] =
      (await prisma.customer?.findMany?.({
        where: { companyId: businessId, ...branchWhere },
        orderBy: { createdAt: 'asc' },
        take: GOOGLE_SHEETS_MAX_ROWS_PER_ENTITY
      })) ?? [];
    await exportTab(
      'Customers',
      CUSTOMER_HEADERS,
      customers.map((c) => mapCustomerRow(branchNameFor(c.branchId), c, exportedAt))
    );

    // ── Khata / credit ledger ───────────────────────────────────────
    const ledger: any[] =
      (await prisma.customerLedgerEntry?.findMany?.({
        where: { companyId: businessId },
        orderBy: { createdAt: 'asc' },
        take: GOOGLE_SHEETS_MAX_ROWS_PER_ENTITY,
        include: { customer: { select: { name: true, phone: true, branchId: true } } }
      })) ?? [];
    const runningByCustomer = new Map<string, number>();
    const khataRows: Array<Array<string | number>> = [];
    for (const entry of ledger) {
      // Ledger rows carry no branch of their own — scope by the
      // customer's branch (never mix branches without the Branch column).
      if (branchId && String(entry.customer?.branchId ?? '') !== branchId) continue;
      const key = String(entry.customerId);
      const running = (runningByCustomer.get(key) ?? 0) + (Number(entry.amount) || 0);
      runningByCustomer.set(key, running);
      khataRows.push(
        mapKhataRow(branchNameFor(entry.customer?.branchId), entry, running, exportedAt)
      );
    }
    await exportTab('Khata', KHATA_HEADERS, khataRows);

    const where = spreadsheetUrl ?? `spreadsheet ${spreadsheetId}`;
    const summary =
      `Exported ${recordsProcessed} rows to "${spreadsheetTitle || 'Google Sheet'}" (${where}) — ` +
      `Sales ${perTab.Sales ?? 0}, Stock ${perTab.Stock ?? 0}, Customers ${perTab.Customers ?? 0}, Khata ${perTab.Khata ?? 0}. ` +
      `Rows are appended; previous exports are kept.`;
    return {
      recordsProcessed,
      recordsFailed,
      message: failures.length > 0 ? `${summary} Failed: ${failures.join('; ')}` : summary
    };
  }
};

// Register at module load (providers.ts imports this module for the side effect).
registerIntegrationHandler(googleSheetsHandler);
