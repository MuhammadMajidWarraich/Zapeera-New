import { useState, useEffect, useCallback } from 'react';
import { Settings, Server, Database, RefreshCw, Info } from 'lucide-react';
import { toast } from 'sonner';
import { backofficeApi } from '../../services/api';
import { config } from '@/lib/config';
import { VoiceAiSection } from './VoiceAiSection';

type Health = Awaited<ReturnType<typeof backofficeApi.getSystemHealth>>;

// There is no platform-settings store or settings endpoint in the backend:
// platform behaviour is configured through server environment variables
// (.env on the host — database mode, email provider, JWT secret, CORS
// origins, …). This page therefore shows the REAL live server configuration
// reported by the API's /health endpoint instead of editable controls that
// would silently save nothing.
export function SettingsPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const h = await backofficeApi.getSystemHealth();
      setHealth(h);
      if (h.status !== 'ok') setError('The API reports a degraded status — see the database details below.');
    } catch (e: any) {
      setError(e?.message || 'Could not reach the API health endpoint');
      toast.error('Failed to load server status');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rows: Array<{ label: string; value: string }> = health ? [
    { label: 'API Status', value: health.status === 'ok' ? 'Healthy' : `Degraded (${health.status})` },
    { label: 'Last Checked', value: health.timestamp ? new Date(health.timestamp).toLocaleString() : '—' },
    { label: 'Database Type', value: health.database?.type || '—' },
    { label: 'Database Mode', value: health.database?.modeLabel || health.database?.mode || '—' },
    { label: 'Prisma Provider', value: health.database?.provider || '—' },
    { label: 'Database Connection', value: health.database?.status || '—' },
    { label: 'PostgreSQL Connected', value: health.database ? (health.database.postgresql.connected ? 'Yes' : health.database.postgresql.configured ? 'No' : 'Not configured') : '—' },
    { label: 'SQLite Connected', value: health.database ? (health.database.sqlite.connected ? 'Yes' : 'No') : '—' },
    { label: 'Server Mode', value: health.database ? (health.database.isOnline ? 'Online' : 'Offline') : '—' },
  ] : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-900">Settings</h1><p className="text-sm text-gray-500 mt-1">Live server configuration (read-only)</p></div>
        <button onClick={load} disabled={loading} className="inline-flex items-center gap-2 px-3 py-2 bg-white border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 transition text-sm font-medium disabled:opacity-50"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh</button>
      </div>

      <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-xl p-4">
        <Info className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
        <p className="text-sm text-blue-800">
          Platform configuration is managed through server environment variables on the host (database mode, email provider,
          CORS origins, JWT secret). There is no in-app settings store, so nothing on this page is editable — the values below
          are read live from the API's health endpoint.
        </p>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4"><Server className="w-5 h-5 text-gray-400" /> Server Status</h3>
        {loading ? (
          <p className="text-sm text-gray-400">Loading server status…</p>
        ) : error && !health ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : (
          <>
            {error && <p className="text-sm text-amber-600 mb-4">{error}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl">
              {rows.map(row => (
                <div key={row.label} className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-500 mb-1">{row.label}</p><p className="text-sm font-medium text-gray-900">{row.value}</p></div>
              ))}
            </div>
          </>
        )}
      </div>

      <VoiceAiSection />

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2 mb-4"><Database className="w-5 h-5 text-gray-400" /> This Admin Panel</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl">
          <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-500 mb-1">Backoffice API</p><p className="text-sm font-medium text-gray-900 break-all">{config.backoffice.baseUrl}</p></div>
          <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-500 mb-1">Build Mode</p><p className="text-sm font-medium text-gray-900">{import.meta.env.MODE}</p></div>
        </div>
        <p className="text-xs text-gray-400 mt-4 flex items-center gap-1"><Settings className="w-3.5 h-3.5" /> To change platform configuration, update the server .env and restart the backend.</p>
      </div>
    </div>
  );
}
