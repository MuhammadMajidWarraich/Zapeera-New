import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Zap, Eye, EyeOff, ArrowRight, CheckCircle2 } from 'lucide-react';
import { useBackofficeAuth } from '../../auth/BackofficeAuthContext';
import { backofficeApi } from '../../services/api';

export function BackofficeLoginPage() {
  const navigate = useNavigate();
  const { login } = useBackofficeAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('ADMIN');
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(email, password);
      navigate('/backoffice/dashboard');
    } catch (err: any) {
      toast.error(err.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const data = await backofficeApi.setup(email, password, role);
      toast.success('Admin account created! Please sign in.');
      setMode('login');
    } catch (err: any) {
      toast.error(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
      <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wMyI+PHBhdGggZD0iTTM2IDM0djItSDI0di0yaDEyek0zNiAyNHYySDI0di0yaDEyeiIvPjwvZz48L2c+PC9zdmc+')] opacity-50" />
      <div className="relative w-full max-w-md mx-4">
        <div className="bg-white/10 backdrop-blur-2xl rounded-3xl p-8 border border-white/10 shadow-2xl">
          <div className="flex items-center justify-center gap-3 mb-8">
            <div className="w-12 h-12 bg-gradient-to-br from-blue-400 to-cyan-300 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/30">
              <Zap className="w-7 h-7 text-white" />
            </div>
            <span className="text-2xl font-bold text-white">Zapeera</span>
          </div>

          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-500/20 rounded-full mb-4">
              <CheckCircle2 className="w-3.5 h-3.5 text-blue-300" />
              <span className="text-xs font-medium text-blue-300">Admin Portal</span>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">
              {mode === 'login' ? 'Welcome back!' : 'Create Account'}
            </h1>
            <p className="text-blue-200/70 text-sm">
              {mode === 'login' ? 'Sign in to manage your platform' : 'Register to get started'}
            </p>
          </div>

          <div className="flex rounded-xl bg-white/5 p-1 mb-6 border border-white/10">
            <button onClick={() => setMode('login')} className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${mode === 'login' ? 'bg-white/10 text-white shadow-sm' : 'text-blue-200/70 hover:text-white'}`}>Sign In</button>
            <button onClick={() => setMode('register')} className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${mode === 'register' ? 'bg-white/10 text-white shadow-sm' : 'text-blue-200/70 hover:text-white'}`}>Register</button>
          </div>

          <form onSubmit={mode === 'login' ? handleLogin : handleRegister} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-blue-200 mb-2">Email Address</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="w-full px-4 py-3.5 bg-white/5 border border-white/10 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition text-sm text-white placeholder-blue-300/50" placeholder="admin@zapeera.com" />
            </div>
            <div>
              <label className="block text-sm font-medium text-blue-200 mb-2">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required minLength={8} className="w-full px-4 py-3.5 bg-white/5 border border-white/10 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition text-sm text-white placeholder-blue-300/50" placeholder="••••••••" />
            </div>
            {mode === 'register' && (
              <div>
                <label className="block text-sm font-medium text-blue-200 mb-2">Admin Role</label>
                <select value={role} onChange={e => setRole(e.target.value)} className="w-full px-4 py-3.5 bg-white/5 border border-white/10 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition text-sm text-white">
                  <option value="SUPER_ADMIN" className="text-gray-900">Super Admin</option>
                  <option value="ADMIN" className="text-gray-900">Admin</option>
                  <option value="FINANCE" className="text-gray-900">Finance</option>
                  <option value="SUPPORT" className="text-gray-900">Support</option>
                  <option value="VIEWER" className="text-gray-900">Viewer</option>
                </select>
              </div>
            )}
            <button type="submit" disabled={loading} className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-blue-500 to-cyan-400 text-white py-3.5 rounded-xl font-semibold hover:opacity-90 transition shadow-lg shadow-blue-500/25 disabled:opacity-50">
              {loading ? 'Processing...' : <>{mode === 'login' ? 'Sign In' : 'Create Account'} <ArrowRight className="w-4 h-4" /></>}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
