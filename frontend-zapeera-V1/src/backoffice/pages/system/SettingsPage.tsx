import { useState } from 'react';
import { Settings, Bell, Shield, Mail, Database, Save } from 'lucide-react';
import { toast } from 'sonner';

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState('general');
  const [saving, setSaving] = useState(false);

  const tabs = [
    { id: 'general', label: 'General', icon: Settings },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'email', label: 'Email', icon: Mail },
    { id: 'system', label: 'System', icon: Database },
  ];

  const handleSave = async () => { setSaving(true); await new Promise(r => setTimeout(r, 800)); setSaving(false); toast.success('Settings saved successfully'); };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-900">Settings</h1><p className="text-sm text-gray-500 mt-1">Manage backoffice preferences and configurations</p></div>
        <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-cyan-500 text-white font-medium rounded-xl hover:opacity-90 transition shadow-lg shadow-blue-500/25 disabled:opacity-50">
          {saving ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> Save Changes</>}
        </button>
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === tab.id ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        {activeTab === 'general' && (
          <div className="space-y-6 max-w-2xl">
            <h3 className="text-lg font-semibold text-gray-900">General Settings</h3>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Platform Name</label><input defaultValue="Zapeera" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/50" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Support Email</label><input defaultValue="support@zapeera.com" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/50" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Support Phone</label><input defaultValue="+923107100663" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/50" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Default Timezone</label><select defaultValue="Asia/Karachi" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/50"><option>Asia/Karachi</option><option>UTC</option></select></div>
          </div>
        )}
        {activeTab === 'notifications' && (
          <div className="space-y-6 max-w-2xl">
            <h3 className="text-lg font-semibold text-gray-900">Notification Settings</h3>
            {['Email notifications for new signups', 'Payment proof alerts', 'Subscription expiry reminders', 'System health alerts', 'Daily summary digest'].map((item, i) => (
              <label key={i} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
                <span className="text-sm text-gray-700">{item}</span>
                <div className={`w-11 h-6 rounded-full transition-colors ${i < 3 ? 'bg-blue-500' : 'bg-gray-300'} relative cursor-pointer`}><div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform shadow ${i < 3 ? 'translate-x-[22px]' : 'translate-x-0.5'}`} /></div>
              </label>
            ))}
          </div>
        )}
        {activeTab === 'security' && (
          <div className="space-y-6 max-w-2xl">
            <h3 className="text-lg font-semibold text-gray-900">Security Settings</h3>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Session Timeout (minutes)</label><input type="number" defaultValue={60} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/50" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Max Login Attempts</label><input type="number" defaultValue={5} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/50" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Password Minimum Length</label><input type="number" defaultValue={8} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/50" /></div>
          </div>
        )}
        {activeTab === 'email' && (
          <div className="space-y-6 max-w-2xl">
            <h3 className="text-lg font-semibold text-gray-900">Email Configuration</h3>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">SMTP Host</label><input placeholder="smtp.zapeera.com" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/50" /></div>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">SMTP Port</label><input defaultValue={587} className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/50" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Encryption</label><select className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm"><option>TLS</option><option>SSL</option><option>None</option></select></div>
            </div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">From Address</label><input defaultValue="noreply@zapeera.com" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/50" /></div>
          </div>
        )}
        {activeTab === 'system' && (
          <div className="space-y-6 max-w-2xl">
            <h3 className="text-lg font-semibold text-gray-900">System Information</h3>
            <div className="grid grid-cols-2 gap-4">
              {[{ label: 'App Version', value: '1.0.0' }, { label: 'Node.js', value: typeof process !== 'undefined' ? process.version : 'N/A' }, { label: 'Database', value: 'SQLite / PostgreSQL' }, { label: 'Environment', value: import.meta.env.MODE || 'development' }].map(item => (
                <div key={item.label} className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-500 mb-1">{item.label}</p><p className="text-sm font-medium text-gray-900">{item.value}</p></div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
