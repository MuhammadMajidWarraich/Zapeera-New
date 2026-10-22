import { useState } from 'react';
import { UserCircle, Shield, Key, Mail, Save } from 'lucide-react';
import { toast } from 'sonner';
import { useBackofficeAuth } from '../../auth/BackofficeAuthContext';
import { backofficeApi } from '../../services/api';

export function ProfilePage() {
  const { admin } = useBackofficeAuth();
  const [activeTab, setActiveTab] = useState('profile');

  // Email change form
  const [newEmail, setNewEmail] = useState('');
  const [emailCurrentPassword, setEmailCurrentPassword] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  // Password change form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const tabs = [
    { id: 'profile', label: 'My Profile', icon: UserCircle },
    { id: 'security', label: 'Security', icon: Shield },
  ];

  const handleEmailChange = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast.error('Enter a valid email address'); return; }
    if (email === admin?.email) { toast.error('That is already your email address'); return; }
    if (!emailCurrentPassword) { toast.error('Enter your current password to confirm'); return; }
    setSavingEmail(true);
    try {
      const res = await backofficeApi.updateProfile({ email, currentPassword: emailCurrentPassword });
      // Keep the cached admin profile in sync, then reload so the auth
      // context (header, sidebar) picks up the new email everywhere.
      try { localStorage.setItem('backofficeAdmin', JSON.stringify(res.data)); } catch { /* ignore */ }
      toast.success('Email updated successfully');
      setTimeout(() => window.location.reload(), 600);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update email');
    } finally {
      setSavingEmail(false);
    }
  };

  const handlePasswordChange = async () => {
    if (!currentPassword) { toast.error('Enter your current password'); return; }
    if (newPassword.length < 8) { toast.error('New password must be at least 8 characters long'); return; }
    if (newPassword !== confirmPassword) { toast.error('New passwords do not match'); return; }
    if (newPassword === currentPassword) { toast.error('New password must be different from the current password'); return; }
    setSavingPassword(true);
    try {
      await backofficeApi.updateProfile({ currentPassword, newPassword });
      toast.success('Password updated successfully');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update password');
    } finally {
      setSavingPassword(false);
    }
  };

  const inputCls = "w-full px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-blue-500/50";

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

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-400 mb-1">Role</p><p className="text-sm font-medium text-gray-900">{admin?.role || 'Unknown'}</p></div>
              <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-400 mb-1">Status</p><p className="text-sm font-medium text-emerald-600">{admin?.isActive ? 'Active' : 'Inactive'}</p></div>
              <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-400 mb-1">Account Created</p><p className="text-sm font-medium text-gray-900">{admin?.createdAt ? new Date(admin.createdAt).toLocaleDateString() : 'N/A'}</p></div>
              <div className="bg-gray-50 rounded-xl p-4"><p className="text-xs text-gray-400 mb-1">Last Login</p><p className="text-sm font-medium text-gray-900">{admin?.lastLoginAt ? new Date(admin.lastLoginAt).toLocaleString() : 'N/A'}</p></div>
            </div>

            <div className="border-t border-gray-100 pt-6 space-y-4">
              <h3 className="text-lg font-semibold text-gray-900">Change Email</h3>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">New Email</label><input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder={admin?.email || 'admin@example.com'} className={inputCls} /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Current Password (to confirm)</label><input type="password" value={emailCurrentPassword} onChange={e => setEmailCurrentPassword(e.target.value)} className={inputCls} /></div>
              <button onClick={handleEmailChange} disabled={savingEmail} className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition text-sm font-medium disabled:opacity-50">
                {savingEmail ? 'Saving...' : <><Mail className="w-4 h-4" /> Update Email</>}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'security' && (
          <div className="space-y-6 max-w-2xl">
            <h3 className="text-lg font-semibold text-gray-900">Change Password</h3>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Current Password</label><input type="password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className={inputCls} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">New Password</label><input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className={inputCls} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">Confirm New Password</label><input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className={inputCls} /></div>
            <button onClick={handlePasswordChange} disabled={savingPassword} className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition text-sm font-medium disabled:opacity-50">
              {savingPassword ? 'Saving...' : <><Key className="w-4 h-4" /> Update Password</>}
            </button>
            <p className="text-xs text-gray-400 flex items-center gap-1"><Save className="w-3.5 h-3.5" /> Changes are saved to your admin account immediately.</p>
          </div>
        )}
      </div>
    </div>
  );
}
