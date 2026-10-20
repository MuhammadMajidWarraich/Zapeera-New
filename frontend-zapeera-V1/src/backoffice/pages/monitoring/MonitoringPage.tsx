import { useState, useEffect, useCallback } from 'react';
import { Database, Wifi, Server, RefreshCw, CheckCircle, XCircle, Info } from 'lucide-react';
import { backofficeApi } from '../../services/api';

type Health = Awaited<ReturnType<typeof backofficeApi.getSystemHealth>>;

function StatusDot({ ok }: { ok: boolean | null }) {
  if (ok === null) return <div className="w-2.5 h-2.5 rounded-full bg-gray-300" />;
  return ok
    ? <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
    : <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />;
}

// A-8: this page previously rendered fully simulated data (hardcoded CPU,
// memory, uptime and queue numbers). It now shows only what the live API
// actually reports via GET /health, plus a client-measured round-trip time.
// Host-level metrics (CPU / memory / disk) and background-queue depths are
// not exposed by the API yet, so they are stated as unavailable instead of
// being invented.
export function MonitoringPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const started = performance.now();
    try {
      const h = await backofficeApi.getSystemHealth();
      setLatencyMs(Math.round(performance.now() - started));
      setHealth(h);
    } catch (e: any) {
      setLatencyMs(null);
      setError(e?.message || 'Could not reach the API health endpoint');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading && !health) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 bg-gray-200 rounded-lg animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">{[...Array(3)].map((_, i) => <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      </div>
    );
  }

  const db = health?.database;
  const apiOk = health?.status === 'ok';
  const dbOk = !!db?.isOnline && db?.status === 'online';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">System Health</h1>
          <p className="text-sm text-gray-500 mt-1">Live status reported by the API health endpoint</p>
        </div>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-center gap-2">
          <XCircle className="w-4 h-4 shrink-0" /> {error}
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-3">
          <StatusDot ok={health ? apiOk : null} />
          <h2 className="text-lg font-semibold text-gray-900">{health ? (apiOk ? 'Healthy' : `Degraded (${health.status})`) : 'Unreachable'}</h2>
          {health?.timestamp && (
            <span className="text-sm text-gray-400">&middot; Last checked {new Date(health.timestamp).toLocaleString()}</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-50 rounded-lg"><Database className="w-5 h-5 text-blue-600" /></div>
            <div className="flex items-center gap-2">
              <StatusDot ok={health ? dbOk : null} />
              <h3 className="font-semibold text-gray-900">Database</h3>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm"><span className="text-gray-500">Status</span><span className="font-medium">{db?.status || '—'}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">Type</span><span className="font-medium">{db?.modeLabel || db?.type || '—'}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">Provider</span><span className="font-medium">{db?.provider || '—'}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">Connectivity check (SELECT 1)</span><span className="font-medium">{db?.select1 || '—'}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">PostgreSQL connected</span><span className="font-medium">{db?.postgresql ? (db.postgresql.connected ? 'Yes' : 'No') : '—'}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">PostgreSQL configured</span><span className="font-medium">{db?.postgresql ? (db.postgresql.configured ? 'Yes' : 'No') : '—'}</span></div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-indigo-50 rounded-lg"><Wifi className="w-5 h-5 text-indigo-600" /></div>
            <h3 className="font-semibold text-gray-900">API</h3>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm">
              {apiOk ? <CheckCircle className="w-4 h-4 text-emerald-500" /> : <XCircle className="w-4 h-4 text-red-500" />}
              <span>{apiOk ? 'Health endpoint responding' : 'Health endpoint not reporting ok'}</span>
            </div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">Status</span><span className="font-medium">{health?.status || '—'}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">Health-check round-trip</span><span className="font-medium">{latencyMs !== null ? `${latencyMs} ms` : '—'}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">Mode match</span><span className="font-medium">{db ? (db.modeMatch ? 'Yes' : 'No') : '—'}</span></div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-violet-50 rounded-lg"><Server className="w-5 h-5 text-violet-600" /></div>
            <h3 className="font-semibold text-gray-900">Host Metrics</h3>
          </div>
          <div className="flex gap-2 text-sm text-gray-500">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>CPU, memory, disk and background-queue metrics are not exposed by the API yet. This card will show them once a metrics endpoint exists — no values are simulated.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
