import { useState } from 'react';
import { UserCircle, Shield, Key, Moon, Bell, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useBackofficeAuth } from '../../auth/BackofficeAuthContext';

export function ProfilePage() {
  const { admin } = useBackofficeAuth();
  const [activeTab, setActiveTab] = useState('profile');
  const [saving, setSaving] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  const tabs = [
    { id: 'profile', label: 'My Profile', icon: UserCircle },
    { id: 'security', label: 'Security', icon: Shield },
    { id: 'preferences', label: 'Preferences', icon: Moon },
  ];

  const handleSave = async () => { setSaving(true); await new Promise(r => setTimeout(r, 800)); setSaving(false); toast.success('Saved successfully'); };

  return (
    <div className="space-y-6">
      <div><h1 className="text-2xl font-bold text-gray-900">My Profile</h1><p className="text-sm text-gray-500 mt-1">Manage your admin account settings</p></div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${activeTab === tab.id ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            <tab.icon className="w-4 h-4" /> {tab.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        {activeTab === 'profile' && (
          <div className="space-y-6 max-w-2xl">
            <div className="flex items-center gap-4 mb-6">
              <div className="w-16 h-16 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-2xl flex items-center justify-center text-white text-2xl font-bold shadow-lg shadow-blue-500/25">
                {admin?.email?.charAt(0).toUpperCase() || 'A'}
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">{admin?.email?.split('@')[0] || 'Admin'}</h2>
                <p className="text-sm text-gray-500">{admin?.email}</p>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 mt-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">{admin?.role}</span>
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-400 mb-1">Role</p><p className="text-sm font-medium text-gray-900">{admin?.role || 'Unknown'}</p></div>
                <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-400 mb-1">Status</p><p className="text-sm font-medium text-emerald-600">{admin?.isActive ? 'Active' : 'Inactive'}</p></div>
                <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-400 mb-1">Account Created</p><p className="text-sm font-medium text-gray-900">{admin?.createdAt ? new Date(admin.createdAt).toLocaleDateString() : 'N/A'}</p></div>
                <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-400 mb-1">Last Login</p><p className="text-sm font-medium text-gray-900">{admin?.lastLoginAt ? new Date(admin.lastLoginAt).toLocaleString() : 'N/A'}</p></div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'security' && (
          <div className="space-y-6 max-w-2xl">
            <h3 className="text-lg font-semibold text-gray-900">Change Password</h3>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label><input type="password" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/50" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">New Password</label><input type="password" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/50" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label><input type="password" className="w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/50" /></div>
            <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition text-sm font-medium disabled:opacity-50">
              {saving ? 'Saving...' : <><Key className="w-4 h-4" /> Update Password</>}
            </button>
          </div>
        )}

        {activeTab === 'preferences' && (
          <div className="space-y-6 max-w-2xl">
            <h3 className="text-lg font-semibold text-gray-900">Preferences</h3>
            <div className="flex items-center justify-between py-3 border-b border-gray-100">
              <div><p className="text-sm font-medium text-gray-700">Dark Mode</p><p className="text-xs text-gray-400">Switch between light and dark theme</p></div>
              <button onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')} className={`w-11 h-6 rounded-full transition-colors relative ${theme === 'dark' ? 'bg-blue-500' : 'bg-gray-300'}`}><div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform shadow ${theme === 'dark' ? 'translate-x-[22px]' : 'translate-x-0.5'}`} /></button>
            </div>
            {['Email notifications for system alerts', 'Login activity notifications', 'Security event notifications'].map((item, i) => (
              <label key={i} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
                <span className="text-sm text-gray-700">{item}</span>
                <div className={`w-11 h-6 rounded-full transition-colors ${i === 0 ? 'bg-blue-500' : 'bg-gray-300'} relative cursor-pointer`}><div className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform shadow ${i === 0 ? 'translate-x-[22px]' : 'translate-x-0.5'}`} /></div>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
