/**
 * Build the Prisma datasource URL.
 *
 * Neon's connection-pooler endpoint (`.pooler.` host) is PgBouncer in
 * "transaction" mode. Prisma's Rust engine must talk to PgBouncer with the
 * `pgbouncer=true` flag, otherwise it uses the extended query protocol with
 * prepared statements, which transaction-mode pooling cannot support and
 * tears the connection down mid-request (intermittent 500s / resets).
 *
 * This keeps every `new PrismaClient(...)` on the same normalized URL.
 * Direct (non-pooled) and SQLite (`file:`) URLs are returned untouched.
 */
export function buildPrismaUrl(url?: string): string {
  const raw = url && url.trim().length > 0
    ? url
    : (process.env.DATABASE_URL || process.env.REMOTE_DATABASE_URL || '');

  if (!/^postgres(ql)?:\/\//i.test(raw)) return raw;

  try {
    const parsed = new URL(raw);
    const hostname = parsed.hostname || '';
    const isPooled = hostname.includes('pooler') || hostname.includes('pgbouncer');

    if (isPooled && !parsed.searchParams.has('pgbouncer')) {
      parsed.searchParams.set('pgbouncer', 'true');
    }
    // ALWAYS bound the pool — pooled or direct. Prisma's default limit
    // (2 x detected CPUs + 1, and container CPU detection can see the
    // physical host's many cores) let the several PrismaClient instances
    // in this codebase pin ALL of Postgres' connections (observed live
    // 2026-10-20, Round 2: 100/100 slots ESTABLISHED, psql refused with
    // "too many clients", intermittent API 503s under load). An explicit
    // connection_limit in the URL is always respected, never overridden.
    if (!parsed.searchParams.has('connection_limit')) {
      parsed.searchParams.set('connection_limit', process.env.PG_CONNECTION_LIMIT || '10');
    }
    if (!parsed.searchParams.has('pool_timeout')) {
      parsed.searchParams.set('pool_timeout', process.env.PG_POOL_TIMEOUT || '20');
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}

export function isPostgresUrl(value: string): boolean {
  return /^postgres(ql)?:\/\//i.test(String(value || ''));
}