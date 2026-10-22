import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut, Settings, UserRound } from 'lucide-react';
import { useBackofficeAuth } from '../auth/BackofficeAuthContext';

/**
 * Header admin chip as a real dropdown menu. Identity comes from the
 * backoffice auth state (BackofficeAdmin: email + role — there is no
 * separate display-name field; the name shown is the email's local part,
 * matching the rest of the backoffice).
 */
export function AdminMenu() {
  const navigate = useNavigate();
  const location = useLocation();
  const { admin, logout } = useBackofficeAuth();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close whenever the route changes (e.g. after picking a menu item).
  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open ]);

  if (!admin) return null;

  const displayName = admin.email.split('@')[0];

  const handleLogout = async () => {
    setOpen(false);
    await logout();
    navigate('/backoffice/login', { replace: true });
  };

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center gap-3 sm:pl-2 rounded-lg p-1 -m-1 hover:bg-gray-100 transition"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Admin menu"
      >
        <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-full flex items-center justify-center text-white font-semibold text-sm shadow-lg shadow-blue-500/25">
          {admin.email.charAt(0).toUpperCase()}
        </div>
        <div className="hidden md:block text-left">
          <p className="text-sm font-semibold text-gray-900 leading-tight">{displayName}</p>
          <p className="text-xs text-gray-500 leading-tight">{admin.role}</p>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-gray-400 hidden sm:block transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-72 max-w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-xl shadow-gray-900/5 border border-gray-200/80 z-50 overflow-hidden"
          role="menu"
        >
          <div className="flex items-center gap-3 px-4 py-3.5 border-b border-gray-100 bg-gray-50/60">
            <div className="w-11 h-11 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-full flex items-center justify-center text-white font-semibold shadow-lg shadow-blue-500/25 flex-shrink-0">
              {admin.email.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{displayName}</p>
              <p className="text-xs text-gray-500 truncate">{admin.email}</p>
              <span className="inline-block mt-1 px-2 py-0.5 text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-100 rounded-full">
                {admin.role}
              </span>
            </div>
          </div>

          <div className="py-1.5">
            <button
              onClick={() => go('/backoffice/profile')}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition"
              role="menuitem"
            >
              <UserRound className="w-4 h-4 text-gray-400" />
              Profile
            </button>
            <button
              onClick={() => go('/backoffice/settings')}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition"
              role="menuitem"
            >
              <Settings className="w-4 h-4 text-gray-400" />
              Settings
            </button>
          </div>

          <div className="border-t border-gray-100 py-1.5">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition"
              role="menuitem"
            >
              <LogOut className="w-4 h-4 text-red-400" />
              Log Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
