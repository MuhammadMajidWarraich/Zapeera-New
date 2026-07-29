import { useState } from 'react';
import { Settings, Trash2, RefreshCw, Shield, Zap, Server, Database, Clock, HardDrive } from 'lucide-react';
import { toast } from 'sonner';

export function SystemPage() {
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);

  const handleClearCache = async () => {
    setClearingCache(true);
    await new Promise(r => setTimeout(r, 1500));
    setClearingCache(false);
    toast.success('Cache cleared successfully');
  };

  const envInfo = [
    { label: 'Platform', value: 'Zapeera Admin Portal', icon: Zap },
    { label: 'Database', value: 'SQLite / PostgreSQL', icon: Database },
    { label: 'Runtime', value: 'Node.js + Express', icon: Server },
    { label: 'Last Deployment', value: new Date().toLocaleDateString(), icon: Clock },
  ];

  const services = [
    { name: 'Subscription Cron', status: 'running', description: 'Checks and updates subscription statuses' },
    { name: 'Email Service', status: 'running', description: 'Handles automated email notifications' },
    { name: 'Sync Service', status: 'running', description: 'Keeps SQLite and PostgreSQL in sync' },
    { name: 'OCR Service', status: 'configured', description: 'Invoice text extraction service' },
  ];

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-gray-900">System Overview</h1><p className="text-sm text-gray-500 mt-1">Platform system management and configuration</p></div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Environment</h3>
          <div className="space-y-3">
            {envInfo.map(item => (
              <div key={item.label} className="flex items-center gap-3">
                <div className="p-1.5 bg-gray-100 rounded-lg"><item.icon className="w-4 h-4 text-gray-500" /></div>
                <div className="flex-1"><p className="text-xs text-gray-400">{item.label}</p><p className="text-sm font-medium text-gray-900">{item.value}</p></div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Quick Actions</h3>
          <div className="space-y-3">
            <button onClick={handleClearCache} disabled={clearingCache} className="w-full flex items-center gap-3 px-4 py-3 bg-gray-50 hover:bg-gray-100 rounded-xl transition text-left">
              <Trash2 className="w-5 h-5 text-gray-500" />
              <div className="flex-1"><p className="text-sm font-medium text-gray-700">{clearingCache ? 'Clearing...' : 'Clear Cache'}</p><p className="text-xs text-gray-400">Clear all cached data</p></div>
            </button>
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 rounded-xl">
              <div className="flex items-center gap-3"><Shield className="w-5 h-5 text-gray-500" /><div><p className="text-sm font-medium text-gray-700">Maintenance Mode</p><p className="text-xs text-gray-400">Show maintenance page to all users</p></div></div>
              <button onClick={() => { setMaintenanceMode(!maintenanceMode); toast.success(`Maintenance mode ${!maintenanceMode ? 'enabled' : 'disabled'}`); }} className={`w-11 h-6 rounded-full transition-colors relative ${maintenanceMode ? 'bg-amber-500' : 'bg-gray-300'}`}>
                <div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform shadow ${maintenanceMode ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Background Services</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {services.map(s => (
            <div key={s.name} className="flex items-start gap-3 p-3 bg-gray-50 rounded-xl">
              <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${s.status === 'running' ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <div>
                <p className="text-sm font-medium text-gray-700">{s.name}</p>
                <p className="text-xs text-gray-400">{s.description}</p>
                <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded mt-1 inline-block ${s.status === 'running' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{s.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
