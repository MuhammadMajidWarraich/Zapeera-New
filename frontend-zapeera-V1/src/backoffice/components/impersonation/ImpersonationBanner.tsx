import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, X, Eye, LogOut } from 'lucide-react';

interface ImpersonationSession {
  businessId: string;
  businessName: string;
  startedAt: string;
  expiresAt: string;
  token: string;
}

export function ImpersonationBanner() {
  const [session, setSession] = useState<ImpersonationSession | null>(null);
  const [remaining, setRemaining] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    try {
      const data = sessionStorage.getItem('impersonationSession');
      if (data) {
        const parsed = JSON.parse(data) as ImpersonationSession;
        setSession(parsed);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!session) return;
    const interval = setInterval(() => {
      const now = Date.now();
      const expires = new Date(session.expiresAt).getTime();
      const diff = expires - now;
      if (diff <= 0) {
        setSession(null);
        sessionStorage.removeItem('impersonationSession');
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setRemaining(`${mins}:${secs.toString().padStart(2, '0')}`);
    }, 1000);
    return () => clearInterval(interval);
  }, [session]);

  const handleExit = () => {
    sessionStorage.removeItem('impersonationSession');
    setSession(null);
    navigate('/backoffice/dashboard');
  };

  if (!session) return null;

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5">
      <div className="flex items-center justify-between max-w-7xl mx-auto">
        <div className="flex items-center gap-3">
          <div className="p-1.5 bg-amber-100 rounded-lg">
            <Eye className="w-4 h-4 text-amber-600" />
          </div>
          <div>
            <p className="text-sm font-medium text-amber-900">
              You are viewing <span className="font-semibold">{session.businessName}</span> as Support
            </p>
            <p className="text-xs text-amber-600">
              Read-only mode &middot; Session expires in {remaining}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleExit}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            Exit Support Mode
          </button>
        </div>
      </div>
    </div>
  );
}
