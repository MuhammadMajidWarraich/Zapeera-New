// ─── Integrations framework — service (feature/integration-framework) ─────
// Business logic for IntegrationConnection / IntegrationSyncLog. Thin
// controllers call these; tests call these directly with a stub prisma.
//
// Tenancy: every function is scoped to (businessId, provider) — the
// composite unique key. Credentials are encrypted before storage and
// decrypted only here, inside the backend process, for handler calls.
// NOTHING in this file returns credentials to a caller: serialized views
// expose hasCredentials only (same write-only precedent as FBR).
import {
  decryptIntegrationCredentials,
  encryptIntegrationCredentials,
  isIntegrationEncryptionConfigured
} from '../utils/integration-encryption.util';
import {
  getIntegrationHandler,
  getProviderEntry,
  isKnownProvider,
  isProviderConnectable,
  listProviders
} from '../integrations/registry';
import { IntegrationError } from '../integrations/vendor-client';
import type {
  IntegrationConnectionStatus,
  IntegrationConnectionView,
  IntegrationProviderId,
  IntegrationProviderWithStatus,
  IntegrationSyncConfig,
  IntegrationSyncDirection,
  IntegrationSyncEntity,
  IntegrationSyncResult
} from '../integrations/types';
import { DEFAULT_SYNC_CONFIG } from '../integrations/types';

export function normalizeSyncConfig(input: unknown): IntegrationSyncConfig {
  const raw = (input ?? {}) as Partial<IntegrationSyncConfig>;
  const bool = (v: unknown): boolean => v === true;
  const direction: IntegrationSyncDirection =
    raw.direction === 'in' || raw.direction === 'out' || raw.direction === 'both'
      ? raw.direction
      : DEFAULT_SYNC_CONFIG.direction;
  // Provider-specific config is preserved verbatim (empty strings drop
  // to undefined). Added 2026-10-24 for google-sheets (spreadsheetId +
  // branchId); other providers ignore these keys.
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
  return {
    syncProducts: bool(raw.syncProducts),
    syncStock: bool(raw.syncStock),
    syncOrders: bool(raw.syncOrders),
    syncCustomers: bool(raw.syncCustomers),
    direction,
    spreadsheetId: str(raw.spreadsheetId),
    branchId: str(raw.branchId)
  };
}

function parseStoredConfig(stored: string | null | undefined): IntegrationSyncConfig {
  if (!stored) return { ...DEFAULT_SYNC_CONFIG };
  try {
    return normalizeSyncConfig(JSON.parse(stored));
  } catch {
    return { ...DEFAULT_SYNC_CONFIG };
  }
}

function serializeConnection(row: any): IntegrationConnectionView {
  const config = parseStoredConfig(row?.config);
  return {
    provider: row.provider as IntegrationProviderId,
    status: (row.status as IntegrationConnectionStatus) || 'disconnected',
    hasCredentials: Boolean(row?.encryptedCredentials),
    config,
    lastSyncAt: row?.lastSyncAt ? new Date(row.lastSyncAt).toISOString() : null,
    lastError: row?.lastError ?? null,
    updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null
  };
}

/** All registry providers + this business's connection state. */
export async function listProvidersWithStatus(
  prisma: any,
  businessId: string
): Promise<IntegrationProviderWithStatus[]> {
  const rows: any[] = await prisma.integrationConnection.findMany({ where: { businessId } });
  const byProvider = new Map<string, any>(rows.map((row) => [String(row.provider), row]));
  return listProviders().map((entry) => {
    const row = byProvider.get(entry.id);
    return {
      ...entry,
      connectable: isProviderConnectable(entry.id),
      status: ((row?.status as IntegrationConnectionStatus) || 'disconnected') as IntegrationConnectionStatus,
      hasCredentials: Boolean(row?.encryptedCredentials),
      config: row ? parseStoredConfig(row.config) : null,
      lastSyncAt: row?.lastSyncAt ? new Date(row.lastSyncAt).toISOString() : null,
      lastError: row?.lastError ?? null
    };
  });
}

function requireKnownProvider(provider: string): IntegrationProviderId {
  if (!isKnownProvider(provider)) {
    throw new IntegrationError(
      'UNKNOWN_PROVIDER',
      `Unknown integration provider "${provider}".`
    );
  }
  return provider as IntegrationProviderId;
}

function requireHandler(provider: IntegrationProviderId) {
  const handler = getIntegrationHandler(provider);
  if (!handler) {
    throw new IntegrationError(
      'NOT_IMPLEMENTED',
      `${getProviderEntry(provider)?.displayName ?? provider} is not built yet — its sync handler is not registered.`
    );
  }
  return handler;
}

/**
 * Connect (or reconnect) a provider. Verifies the credentials against
 * the vendor FIRST via handler.connect — nothing is stored until the
 * vendor accepts them. A failed verification stores status 'error'
 * (without credentials) and throws.
 */
export async function connectProvider(
  prisma: any,
  businessId: string,
  provider: string,
  credentials: Record<string, unknown>,
  configInput?: unknown
): Promise<IntegrationConnectionView> {
  const id = requireKnownProvider(provider);
  const handler = requireHandler(id);
  if (!isIntegrationEncryptionConfigured()) {
    throw new IntegrationError(
      'ENCRYPTION_NOT_CONFIGURED',
      'INTEGRATION_ENCRYPTION_KEY is not set — integration credentials cannot be stored. Set it on the server (64 hex characters) and try again.'
    );
  }
  if (!credentials || typeof credentials !== 'object' || Object.keys(credentials).length === 0) {
    throw new IntegrationError('VENDOR_ERROR', 'Credentials are required to connect.');
  }
  const config = normalizeSyncConfig(configInput);

  let verified: { ok: boolean; message?: string };
  try {
    verified = await handler.connect(credentials);
  } catch (error) {
    const message =
      error instanceof IntegrationError ? error.message : 'The vendor could not be reached.';
    await prisma.integrationConnection.upsert({
      where: { businessId_provider: { businessId, provider: id } },
      create: {
        businessId,
        provider: id,
        status: 'error',
        encryptedCredentials: null,
        config: JSON.stringify(config),
        lastError: message
      },
      update: { status: 'error', encryptedCredentials: null, config: JSON.stringify(config), lastError: message }
    });
    if (error instanceof IntegrationError) throw error;
    throw new IntegrationError('VENDOR_UNREACHABLE', message);
  }
  if (!verified.ok) {
    const message = verified.message || 'The vendor rejected these credentials.';
    await prisma.integrationConnection.upsert({
      where: { businessId_provider: { businessId, provider: id } },
      create: {
        businessId,
        provider: id,
        status: 'error',
        encryptedCredentials: null,
        config: JSON.stringify(config),
        lastError: message
      },
      update: { status: 'error', encryptedCredentials: null, config: JSON.stringify(config), lastError: message }
    });
    throw new IntegrationError('VENDOR_AUTH', message);
  }

  const encrypted = encryptIntegrationCredentials(credentials);
  const row = await prisma.integrationConnection.upsert({
    where: { businessId_provider: { businessId, provider: id } },
    create: {
      businessId,
      provider: id,
      status: 'connected',
      encryptedCredentials: encrypted,
      config: JSON.stringify(config),
      lastError: null
    },
    update: {
      status: 'connected',
      encryptedCredentials: encrypted,
      config: JSON.stringify(config),
      lastError: null
    }
  });
  return serializeConnection(row);
}

/**
 * Disconnect a provider. The local credential wipe is authoritative and
 * always happens, even if the vendor-side revoke fails — a failed revoke
 * never leaves credentials stored.
 */
export async function disconnectProvider(
  prisma: any,
  businessId: string,
  provider: string
): Promise<IntegrationConnectionView> {
  const id = requireKnownProvider(provider);
  const row = await prisma.integrationConnection.findUnique({
    where: { businessId_provider: { businessId, provider: id } }
  });
  if (row?.encryptedCredentials) {
    const handler = getIntegrationHandler(id);
    if (handler) {
      try {
        await handler.disconnect(decryptIntegrationCredentials(row.encryptedCredentials));
      } catch {
        // Vendor revoke is best-effort; the local wipe below is what matters.
      }
    }
  }
  const updated = row
    ? await prisma.integrationConnection.update({
        where: { businessId_provider: { businessId, provider: id } },
        data: { status: 'disconnected', encryptedCredentials: null, lastError: null }
      })
    : null;
  if (!updated) {
    return {
      provider: id,
      status: 'disconnected',
      hasCredentials: false,
      config: { ...DEFAULT_SYNC_CONFIG },
      lastSyncAt: null,
      lastError: null,
      updatedAt: null
    };
  }
  return serializeConnection(updated);
}

/** Stored status + a live vendor liveness check when connected. */
export async function getConnectionStatus(
  prisma: any,
  businessId: string,
  provider: string
): Promise<IntegrationConnectionView & { remoteOk: boolean | null; remoteMessage: string | null }> {
  const id = requireKnownProvider(provider);
  const row = await prisma.integrationConnection.findUnique({
    where: { businessId_provider: { businessId, provider: id } }
  });
  const base: IntegrationConnectionView = row
    ? serializeConnection(row)
    : {
        provider: id,
        status: 'disconnected',
        hasCredentials: false,
        config: { ...DEFAULT_SYNC_CONFIG },
        lastSyncAt: null,
        lastError: null,
        updatedAt: null
      };
  let remoteOk: boolean | null = null;
  let remoteMessage: string | null = null;
  if (row?.status === 'connected' && row.encryptedCredentials) {
    const handler = getIntegrationHandler(id);
    if (handler) {
      try {
        const remote = await handler.getStatus(decryptIntegrationCredentials(row.encryptedCredentials));
        remoteOk = remote.ok;
        remoteMessage = remote.message ?? null;
      } catch (error) {
        remoteOk = false;
        remoteMessage =
          error instanceof IntegrationError ? error.message : 'The vendor could not be reached.';
      }
    }
  }
  return { ...base, remoteOk, remoteMessage };
}

export interface TriggerSyncOptions {
  entity?: IntegrationSyncEntity;
  direction?: IntegrationSyncDirection;
}

const ENTITY_TO_METHOD: Record<
  IntegrationSyncEntity,
  'syncProducts' | 'syncStock' | 'importOrders' | 'exportData' | null
> = {
  product: 'syncProducts',
  stock: 'syncStock',
  order: 'importOrders',
  customer: null, // No handler method in the v1 interface — a builder adds it.
  payment: null,
  shipment: null,
  // Generic export run (added 2026-10-24, google-sheets): dispatches to
  // IntegrationSyncHandler.exportData. Direction defaults to 'out'
  // (see triggerSync below — every non-'order' entity defaults 'out').
  export: 'exportData'
};

/**
 * Manual sync trigger. Dispatches to the provider's handler method for
 * the requested entity and writes an IntegrationSyncLog row for the run
 * (created as 'failed' first, then updated — a crashed run stays failed,
 * never silently successful).
 */
export async function triggerSync(
  prisma: any,
  businessId: string,
  provider: string,
  opts: TriggerSyncOptions = {}
): Promise<{ log: any; result: IntegrationSyncResult }> {
  const id = requireKnownProvider(provider);
  const handler = requireHandler(id);
  const row = await prisma.integrationConnection.findUnique({
    where: { businessId_provider: { businessId, provider: id } }
  });
  if (!row || row.status !== 'connected' || !row.encryptedCredentials) {
    throw new IntegrationError(
      'NOT_CONNECTED',
      `${getProviderEntry(id)?.displayName ?? id} is not connected. Connect it first.`
    );
  }
  const entity: IntegrationSyncEntity = opts.entity ?? 'product';
  const method = ENTITY_TO_METHOD[entity];
  if (!method || typeof (handler as any)[method] !== 'function') {
    throw new IntegrationError(
      'NOT_IMPLEMENTED',
      `${getProviderEntry(id)?.displayName ?? id} does not implement sync for "${entity}" yet.`
    );
  }
  const config = parseStoredConfig(row.config);
  const direction: IntegrationSyncDirection =
    opts.direction ?? (entity === 'order' ? 'in' : 'out');
  const credentials = decryptIntegrationCredentials(row.encryptedCredentials);

  const startedAt = new Date();
  const log = await prisma.integrationSyncLog.create({
    data: {
      businessId,
      provider: id,
      direction,
      entity,
      status: 'failed', // placeholder — updated below; a crashed run stays failed.
      recordsProcessed: 0,
      recordsFailed: 0,
      errorMessage: null,
      startedAt
    }
  });

  try {
    const result: IntegrationSyncResult = await (handler as any)[method]({
      prisma,
      businessId,
      credentials,
      config,
      logId: log.id
    });
    const finishedAt = new Date();
    const status = result.recordsFailed > 0 ? 'partial' : 'success';
    const updatedLog = await prisma.integrationSyncLog.update({
      where: { id: log.id },
      data: {
        status,
        recordsProcessed: result.recordsProcessed,
        recordsFailed: result.recordsFailed,
        errorMessage: null,
        finishedAt
      }
    });
    await prisma.integrationConnection.update({
      where: { businessId_provider: { businessId, provider: id } },
      data: { lastSyncAt: finishedAt, lastError: null }
    });
    return { log: updatedLog, result };
  } catch (error) {
    const message =
      error instanceof IntegrationError
        ? error.message
        : `Sync failed (${error instanceof Error ? error.message : 'unknown error'}).`;
    const failedLog = await prisma.integrationSyncLog.update({
      where: { id: log.id },
      data: { status: 'failed', errorMessage: message.slice(0, 1000), finishedAt: new Date() }
    });
    await prisma.integrationConnection.update({
      where: { businessId_provider: { businessId, provider: id } },
      data: { status: 'error', lastError: message.slice(0, 1000) }
    });
    if (error instanceof IntegrationError) throw error;
    throw new IntegrationError('SYNC_FAILED', message);
  }
}

/** Per-business sync history, newest first. */
export async function listSyncLogs(
  prisma: any,
  businessId: string,
  provider: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<{ logs: any[]; total: number }> {
  const id = requireKnownProvider(provider);
  const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 100);
  const offset = Math.max(Number(opts.offset) || 0, 0);
  const [logs, total] = await Promise.all([
    prisma.integrationSyncLog.findMany({
      where: { businessId, provider: id },
      orderBy: { startedAt: 'desc' },
      take: limit,
      skip: offset
    }),
    prisma.integrationSyncLog.count({ where: { businessId, provider: id } })
  ]);
  return { logs, total };
}
