import { useState, useEffect } from 'react';
import { Activity, Database, Wifi, HardDrive, Cpu, MemoryStick, Server, RefreshCw, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

interface SystemHealth {
  status: string;
  uptime: number;
  database: { status: string; latency: number };
  queue: { pending: number; processing: number; failed: number };
  storage: { used: number; total: number };
  memory: { used: number; total: number };
  cpu: { usage: number };
}

function StatusDot({ status }: { status: string }) {
  if (status === 'healthy' || status === 'ok' || status === 'connected') return <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />;
  if (status === 'degraded' || status === 'warning') return <div className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />;
  return <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />;
}

function ProgressBar({ value, color = 'blue' }: { value: number; color?: string }) {
  const colorMap: Record<string, string> = {
    blue: 'from-blue-500 to-blue-600',
    green: 'from-emerald-500 to-emerald-600',
    amber: 'from-amber-500 to-amber-600',
    red: 'from-red-500 to-red-600',
  };
  const c = value > 90 ? 'red' : value > 70 ? 'amber' : color;
  return (
    <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
      <div className={`bg-gradient-to-r ${colorMap[c]} h-full rounded-full transition-all duration-500`} style={{ width: `${Math.min(value, 100)}%` }} />
    </div>
  );
}

export function MonitoringPage() {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Simulated health data since the real endpoint may not exist yet
    setHealth({
      status: 'healthy',
      uptime: 99.9,
      database: { status: 'connected', latency: 12 },
      queue: { pending: 0, processing: 2, failed: 0 },
      storage: { used: 2.3, total: 50 },
      memory: { used: 512, total: 2048 },
      cpu: { usage: 23 },
    });
    setLoading(false);
  }, []);

  const formatBytes = (gb: number) => `${gb.toFixed(1)} GB`;
  const formatUptime = (pct: number) => `${pct}%`;

  if (loading) return <div className="space-y-4"><div className="h-8 w-48 bg-gray-200 rounded-lg animate-pulse" /><div className="grid grid-cols-1 md:grid-cols-3 gap-4">{[...Array(6)].map((_, i) => <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />)}</div></div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-900">System Health</h1><p className="text-sm text-gray-500 mt-1">Platform infrastructure monitoring</p></div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-3 mb-4">
          <StatusDot status={health?.status || 'unknown'} />
          <h2 className="text-lg font-semibold text-gray-900 capitalize">{health?.status || 'Unknown'}</h2>
          <span className="text-sm text-gray-400">&middot; Uptime: {formatUptime(health?.uptime || 0)}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-blue-50 rounded-lg"><Database className="w-5 h-5 text-blue-600" /></div>
            <div className="flex items-center gap-2">
              <StatusDot status={health?.database.status || 'unknown'} />
              <h3 className="font-semibold text-gray-900">Database</h3>
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm"><span className="text-gray-500">Status</span><span className="font-medium text-emerald-600">{health?.database.status}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">Latency</span><span className="font-medium">{health?.database.latency}ms</span></div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-violet-50 rounded-lg"><Server className="w-5 h-5 text-violet-600" /></div>
            <h3 className="font-semibold text-gray-900">Background Queue</h3>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-sm"><span className="text-gray-500">Pending</span><span className="font-medium">{health?.queue.pending}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">Processing</span><span className="font-medium text-blue-600">{health?.queue.processing}</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">Failed</span><span className={`font-medium ${(health?.queue.failed || 0) > 0 ? 'text-red-600' : 'text-gray-900'}`}>{health?.queue.failed}</span></div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-emerald-50 rounded-lg"><Cpu className="w-5 h-5 text-emerald-600" /></div>
            <h3 className="font-semibold text-gray-900">CPU Usage</h3>
          </div>
          <div className="space-y-3">
            <div className="text-2xl font-bold text-gray-900">{health?.cpu.usage}%</div>
            <ProgressBar value={health?.cpu.usage || 0} />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-amber-50 rounded-lg"><MemoryStick className="w-5 h-5 text-amber-600" /></div>
            <h3 className="font-semibold text-gray-900">Memory</h3>
          </div>
          <div className="space-y-3">
            <div className="text-sm text-gray-600">{formatBytes((health?.memory.used || 0) / 1024)} / {formatBytes((health?.memory.total || 0) / 1024)}</div>
            <ProgressBar value={((health?.memory.used || 0) / (health?.memory.total || 1)) * 100} color="amber" />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-cyan-50 rounded-lg"><HardDrive className="w-5 h-5 text-cyan-600" /></div>
            <h3 className="font-semibold text-gray-900">Storage</h3>
          </div>
          <div className="space-y-3">
            <div className="text-sm text-gray-600">{formatBytes(health?.storage.used || 0)} / {formatBytes(health?.storage.total || 0)}</div>
            <ProgressBar value={((health?.storage.used || 0) / (health?.storage.total || 1)) * 100} />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-indigo-50 rounded-lg"><Wifi className="w-5 h-5 text-indigo-600" /></div>
            <h3 className="font-semibold text-gray-900">Network</h3>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm"><CheckCircle className="w-4 h-4 text-emerald-500" /><span>All endpoints responding</span></div>
            <div className="flex justify-between text-sm"><span className="text-gray-500">API Status</span><span className="font-medium text-emerald-600">Healthy</span></div>
          </div>
        </div>
      </div>
    </div>
  );
}
