// ─── Integrations framework — shared vendor-client base (feature/integration-framework) ─
// Timeout, retry-with-backoff and error mapping every provider module
// builds on. Provider code NEVER throws raw axios/fetch errors to the
// service layer — it throws (or maps to) IntegrationError, whose message
// is safe to show to the user (no credentials, no raw vendor payloads).
//
// NOTE: no vendor-specific code lives here. Builders use withVendorRetry
// + mapVendorError around their own vendor calls.

export type IntegrationErrorCode =
  | 'UNKNOWN_PROVIDER'
  | 'NOT_IMPLEMENTED'
  | 'NOT_CONNECTED'
  | 'ENCRYPTION_NOT_CONFIGURED'
  | 'VENDOR_UNREACHABLE'
  | 'VENDOR_AUTH'
  | 'VENDOR_RATE_LIMIT'
  | 'VENDOR_ERROR'
  | 'SYNC_FAILED';

/** Machine-readable code + user-facing message. Never carries credentials. */
export class IntegrationError extends Error {
  readonly code: IntegrationErrorCode;
  readonly vendorCode?: string;
  readonly status?: number;
  readonly retryable: boolean;

  constructor(
    code: IntegrationErrorCode,
    message: string,
    opts: { vendorCode?: string; status?: number; retryable?: boolean } = {}
  ) {
    super(message);
    this.name = 'IntegrationError';
    this.code = code;
    this.vendorCode = opts.vendorCode;
    this.status = opts.status;
    this.retryable = opts.retryable ?? false;
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 8_000;

export interface VendorRetryOptions {
  /** Total attempts = retries + 1. Default 3 retries (4 attempts). */
  retries?: number;
  /** First backoff delay. Doubles each retry, capped at maxDelayMs. Default 500ms. */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Per-attempt timeout (AbortController). Default 15s. */
  timeoutMs?: number;
  /** Extra HTTP statuses to treat as retryable (429 + 5xx always are). */
  retryableStatuses?: number[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number, extra: number[]): boolean {
  return status === 429 || status >= 500 || extra.includes(status);
}

function statusToErrorCode(status: number): IntegrationErrorCode {
  if (status === 401 || status === 403) return 'VENDOR_AUTH';
  if (status === 429) return 'VENDOR_RATE_LIMIT';
  return 'VENDOR_ERROR';
}

/**
 * Map ANY thrown value from a vendor call to an IntegrationError.
 * Handles: axios-style errors (error.response.status/data), fetch
 * Response objects, network/type errors, and already-mapped
 * IntegrationErrors (passed through untouched).
 */
export function mapVendorError(error: unknown, provider: string): IntegrationError {
  if (error instanceof IntegrationError) return error;

  const err = error as any;
  const status: number | undefined =
    typeof err?.response?.status === 'number'
      ? err.response.status
      : typeof err?.status === 'number'
        ? err.status
        : undefined;

  if (status !== undefined) {
    const vendorCode =
      typeof err?.response?.data?.code === 'string'
        ? err.response.data.code
        : typeof err?.response?.data?.error === 'string'
          ? err.response.data.error
          : undefined;
    const code = statusToErrorCode(status);
    const message =
      code === 'VENDOR_AUTH'
        ? `${provider}: the vendor rejected these credentials. Check them and reconnect.`
        : code === 'VENDOR_RATE_LIMIT'
          ? `${provider}: the vendor rate-limited this request. Try again shortly.`
          : `${provider}: the vendor returned HTTP ${status}.`;
    return new IntegrationError(code, message, {
      vendorCode,
      status,
      retryable: status === 429 || status >= 500
    });
  }

  // Network failure / timeout / DNS — no HTTP status at all.
  if (
    err instanceof TypeError ||
    err?.name === 'AbortError' ||
    err?.code === 'ECONNREFUSED' ||
    err?.code === 'ENOTFOUND' ||
    err?.code === 'ETIMEDOUT'
  ) {
    return new IntegrationError(
      'VENDOR_UNREACHABLE',
      `${provider}: could not reach the vendor. Check the connection and try again.`,
      { retryable: true }
    );
  }

  return new IntegrationError(
    'VENDOR_ERROR',
    `${provider}: the vendor call failed (${err?.message ? String(err.message).slice(0, 120) : 'unknown error'}).`,
    { retryable: false }
  );
}

/**
 * Run a vendor call with timeout + exponential-backoff retry.
 * Retries ONLY retryable failures (429, 5xx, network errors, and
 * IntegrationErrors flagged retryable). Auth failures (401/403) and
 * 4xx errors never retry. `fn` receives an AbortSignal already bound
 * to the per-attempt timeout — pass it to fetch/axios.
 */
export async function withVendorRetry<T>(
  provider: string,
  fn: (signal: AbortSignal) => Promise<T>,
  opts: VendorRetryOptions = {}
): Promise<T> {
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const extraStatuses = opts.retryableStatuses ?? [];

  let attempt = 0;
  for (;;) {
    attempt += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fn(controller.signal);
    } catch (rawError) {
      const mapped = mapVendorError(rawError, provider);
      const statusRetryable =
        mapped.status !== undefined && isRetryableStatus(mapped.status, extraStatuses);
      const retryable = mapped.retryable || statusRetryable;
      if (!retryable || attempt > retries) throw mapped;
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      await sleep(delay);
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * fetch() with a per-call timeout. Throws an AbortError (mapped to
 * VENDOR_UNREACHABLE by mapVendorError) when the vendor does not answer
 * in time. Always pass the returned signal through.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
