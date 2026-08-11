/**
 * Safe port conflict management (Issue 7).
 *
 * NEVER terminates an arbitrary process found listening on a port. A process
 * is only stopped when it is VERIFIED to be a (stale) Zapeera backend via a
 * local health/identity probe. Anything else is reported as 'unknown-owner'
 * so callers can error out or pick another port.
 */

export interface PortOwnerInfo {
  pids: string[];
  confirmedZapeera: boolean;
}

/**
 * Parse `netstat -ano` output (Windows) for LISTENING pids on a specific port.
 * Pure function — unit-testable without running netstat.
 */
export function parseNetstatListeningPids(output: string, port: number): string[] {
  const pids: string[] = [];
  const portSuffix = `:${port}`;
  for (const rawLine of String(output || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || !/LISTENING/i.test(line)) continue;
    const parts = line.split(/\s+/);
    const localAddress = parts[1] || '';
    const pid = parts[parts.length - 1] || '';
    if (!/^\d+$/.test(pid)) continue;
    if (localAddress.endsWith(portSuffix) || localAddress.endsWith(`[::]:${port}`) || localAddress.endsWith(`*:${port}`)) {
      if (!pids.includes(pid)) {
        pids.push(pid);
      }
    }
  }
  return pids;
}

/**
 * Parse `lsof -ti:<port>` output (macOS/Linux) — one pid per line.
 */
export function parseLsofPids(output: string): string[] {
  return String(output || '')
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line));
}

/**
 * Zapeera identity check against a local endpoint's JSON body.
 * Accepts the /health payload (status:ok + database object) or the root
 * handler payload (message containing "Zapeera").
 */
export function isZapeeraHealthPayload(body: unknown): boolean {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  if (b.status === 'ok' && b.database && typeof b.database === 'object') {
    return true;
  }
  if (typeof b.message === 'string' && b.message.includes('Zapeera')) {
    return true;
  }
  return false;
}

/**
 * Probe a local port to confirm it is serving a Zapeera backend.
 * Checks /health, /api/health and / in order; any successful Zapeera-shaped
 * response confirms identity. Never throws — returns false on any failure.
 */
export async function probeIsZapeera(port: number, timeoutMs = 1500): Promise<boolean> {
  const tryUrl = async (url: string): Promise<boolean> => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return false;
      let body: unknown;
      try {
        body = await res.json();
      } catch {
        return false;
      }
      return isZapeeraHealthPayload(body);
    } catch {
      return false;
    }
  };

  return (
    (await tryUrl(`http://127.0.0.1:${port}/health`)) ||
    (await tryUrl(`http://127.0.0.1:${port}/api/health`)) ||
    (await tryUrl(`http://127.0.0.1:${port}/`))
  );
}

/**
 * Find which pids own a listening port and whether they are a verified
 * Zapeera backend. Never kills anything — pure discovery.
 */
export async function findPortOwnerPids(
  port: number,
  execImpl: (command: string, opts?: { encoding?: string; timeout?: number }) => string = execSyncSafe
): Promise<PortOwnerInfo> {
  let pids: string[] = [];
  try {
    if (process.platform === 'win32') {
      const output = String(execImpl(`netstat -ano | findstr :${port}`, { encoding: 'utf8', timeout: 2000 }));
      pids = parseNetstatListeningPids(output, port);
    } else {
      const output = String(execImpl(`lsof -ti:${port}`, { encoding: 'utf8', timeout: 2000 }));
      pids = parseLsofPids(output);
    }
  } catch {
    pids = [];
  }

  if (!pids.length) {
    return { pids: [], confirmedZapeera: false };
  }

  const confirmedZapeera = await probeIsZapeera(port);
  return { pids, confirmedZapeera };
}

/** execSync wrapper that never throws (used by findPortOwnerPids). */
function execSyncSafe(command: string, opts?: { encoding?: string; timeout?: number }): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { execSync } = require('child_process');
  return String(execSync(command, { ...opts, encoding: 'utf8' }));
}
