import { useState } from 'react';
import { Flag, ToggleLeft, ToggleRight, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface FeatureFlagItem {
  id: string;
  key: string;
  name: string;
  description: string;
  enabled: boolean;
  environment: string;
}

const INITIAL_FLAGS: FeatureFlagItem[] = [
  { id: '1', key: 'maintenance_mode', name: 'Maintenance Mode', description: 'Enable maintenance mode to show a maintenance page to all users', enabled: false, environment: 'all' },
  { id: '2', key: 'new_checkout', name: 'New Checkout Flow', description: 'Enable the redesigned checkout experience', enabled: false, environment: 'staging' },
  { id: '3', key: 'advanced_reports_v2', name: 'Advanced Reports V2', description: 'Enable the new advanced reporting engine', enabled: false, environment: 'all' },
  { id: '4', key: 'offline_sync', name: 'Offline Sync', description: 'Enable offline data synchronization for Electron apps', enabled: true, environment: 'all' },
  { id: '5', key: 'ocr_scanning', name: 'OCR Invoice Scanning', description: 'Enable OCR-based invoice scanning feature', enabled: true, environment: 'production' },
  { id: '6', key: 'multi_branch', name: 'Multi-Branch Support', description: 'Enable multi-branch management for businesses', enabled: true, environment: 'all' },
  { id: '7', key: 'email_notifications', name: 'Email Notifications', description: 'Enable automated email notifications for subscriptions and billing', enabled: true, environment: 'all' },
  { id: '8', key: 'trial_extensions', name: 'Trial Extensions', description: 'Allow administrators to extend trial periods', enabled: true, environment: 'all' },
];

export function FeatureFlagsPage() {
  const [flags, setFlags] = useState<FeatureFlagItem[]>(INITIAL_FLAGS);
  const [loading, setLoading] = useState(false);

  const toggleFlag = (id: string) => {
    setFlags(prev => prev.map(f => f.id === id ? { ...f, enabled: !f.enabled } : f));
    const flag = flags.find(f => f.id === id);
    toast.success(`Feature "${flag?.name}" ${flag?.enabled ? 'disabled' : 'enabled'}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Feature Flags</h1>
          <p className="text-sm text-gray-500 mt-1">Toggle platform features on and off</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {flags.map(flag => (
          <div key={flag.id} className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow">
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3 flex-1">
                <div className={`p-2 rounded-lg ${flag.enabled ? 'bg-emerald-50' : 'bg-gray-100'}`}>
                  <Flag className={`w-5 h-5 ${flag.enabled ? 'text-emerald-600' : 'text-gray-400'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900 text-sm">{flag.name}</h3>
                    <span className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-500 rounded">{flag.environment}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{flag.description}</p>
                  <code className="inline-block mt-2 px-2 py-0.5 bg-gray-50 text-gray-500 text-[10px] font-mono rounded">{flag.key}</code>
                </div>
              </div>
              <button
                onClick={() => toggleFlag(flag.id)}
                className={`ml-4 p-0.5 rounded-lg transition-colors ${flag.enabled ? 'bg-emerald-100' : 'bg-gray-200'}`}
              >
                {flag.enabled
                  ? <ToggleRight className="w-10 h-6 text-emerald-600" />
                  : <ToggleLeft className="w-10 h-6 text-gray-400" />}
              </button>
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100">
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${flag.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>
                {flag.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
