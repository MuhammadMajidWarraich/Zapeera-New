import { useState, useEffect, useCallback } from 'react';
import { RefreshCw, Zap, Server, Database, Clock, Activity } from 'lucide-react';
import { toast } from 'sonner';
import { backofficeApi } from '../../services/api';

type Health = Awaited<ReturnType<typeof backofficeApi.getSystemHealth>>;

// This page previously showed a fake "Clear Cache" action, a maintenance-mode
// toggle that only changed local state, and a hardcoded list of "running"
// background services. None of those were connected to anything. It now shows
// only facts read live from the API's /health endpoint.
export function SystemPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const h = await backofficeApi.getSystemHealth();
      setHealth(h);
    } catch (e: any) {
      setError(e?.message || 'Could not reach the API health endpoint');
      toast.error('Failed to load system status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const apiUp = health?.status === 'ok';
  const db = health?.database;
  const dbConnected = !!db && (db.postgresql.connected || db.sqlite.connected);

  const envInfo = [
    { label: 'Platform', value: 'Zapeera Admin Portal', icon: Zap },
    { label: 'API Server', value: health ? (apiUp ? 'Healthy' : `Degraded (${health.status})`) : 'Unknown', icon: Server },
    { label: 'Database', value: db ? `${db.type} (${db.modeLabel || db.mode})` : 'Unknown', icon: Database },
    { label: 'Last Checked', value: health?.timestamp ? new Date(health.timestamp).toLocaleString() : '—', icon: Clock },
  ];

  const services = [
    {
      name: 'API Server',
      status: health ? (apiUp ? 'healthy' : 'degraded') : 'unknown',
      description: apiUp ? 'Responding normally on the health endpoint' : 'Health endpoint reports a problem or is unreachable',
    },
    {
      name: 'Database',
      status: health ? (dbConnected ? 'connected' : 'disconnected') : 'unknown',
      description: db ? `${db.type} via Prisma provider "${db.provider}" — connection status: ${db.status}` : 'No database information reported',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-900">System Overview</h1><p className="text-sm text-gray-500 mt-1">Live platform status from the API health endpoint</p></div>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 transition text-sm font-medium disabled:opacity-50"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
      </div>

      {error && !health && (
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-sm text-red-700">{error}</div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Environment</h3>
          <div className="space-y-3">
            {envInfo.map(item => (
              <div key={item.label} className="flex items-center gap-3">
                <div className="p-1.5 bg-gray-100 rounded-lg"><item.icon className="w-4 h-4 text-gray-500" /></div>
                <div className="flex-1"><p className="text-xs text-gray-400">{item.label}</p><p className="text-sm font-medium text-gray-900">{loading ? 'Loading…' : item.value}</p></div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2"><Activity className="w-4 h-4 text-gray-400" /> Service Status</h3>
          <div className="space-y-3">
            {services.map(s => (
              <div key={s.name} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
                <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${s.status === 'healthy' || s.status === 'connected' ? 'bg-emerald-500' : s.status === 'unknown' ? 'bg-gray-300' : 'bg-red-500'}`} />
                <div>
                  <p className="text-sm font-medium text-gray-700">{s.name}</p>
                  <p className="text-xs text-gray-400">{loading ? 'Checking…' : s.description}</p>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded mt-1 inline-block ${s.status === 'healthy' || s.status === 'connected' ? 'bg-emerald-100 text-emerald-700' : s.status === 'unknown' ? 'bg-gray-100 text-gray-500' : 'bg-red-100 text-red-700'}`}>{loading ? '…' : s.status}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-4">Only services the health endpoint actually reports are listed here.</p>
        </div>
      </div>
    </div>
  );
}
