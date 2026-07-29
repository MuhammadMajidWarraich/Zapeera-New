import { useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import {
  Zap,
  ChevronDown,
  Bell,
  ChevronLeft,
  ChevronRight,
  Search,
  LogOut,
  Menu,
  Moon,
  Sun,
} from 'lucide-react';
import { useBackofficeAuth } from '../auth/BackofficeAuthContext';
import { getNavigation } from '../navigation';
import { GlobalSearch } from '../components/search/GlobalSearch';
import { ImpersonationBanner } from '../components/impersonation/ImpersonationBanner';

interface BackofficeLayoutProps {
  children: React.ReactNode;
}

export function BackofficeLayout({ children }: BackofficeLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { admin, logout } = useBackofficeAuth();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  const navigation = admin ? getNavigation(admin.role) : [];

  const NavItem = ({ item }: { item: any }) => {
    const isActive = location.pathname === item.path;
    const Icon = item.icon;
    return (
      <Link
        to={item.path}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group ${
          isActive
            ? 'bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-700 border border-blue-200 shadow-sm'
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
        }`}
        title={!sidebarOpen ? item.label : ''}
      >
        <Icon className={`w-5 h-5 flex-shrink-0 transition-colors ${
          isActive ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-600'
        }`} />
        {sidebarOpen && (
          <span className="font-medium text-sm truncate">{item.label}</span>
        )}
        {sidebarOpen && isActive && (
          <ChevronRight className="w-4 h-4 text-blue-600 ml-auto flex-shrink-0" />
        )}
        {sidebarOpen && item.badge && (
          <span className="ml-auto px-2 py-0.5 text-xs font-medium bg-red-100 text-red-600 rounded-full">{item.badge}</span>
        )}
      </Link>
    );
  };

  if (!admin) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-500 text-sm">Loading admin portal...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-gray-50 to-blue-50/30 flex">
      <aside className={`bg-white border-r border-gray-200/60 flex flex-col fixed h-full transition-all duration-300 ease-in-out z-50 ${
        sidebarOpen ? 'w-64' : 'w-20'
      }`}>
        <div className="h-16 flex items-center px-4 border-b border-gray-100">
          <Link to="/backoffice/dashboard" className={`flex items-center gap-3 ${!sidebarOpen && 'justify-center w-full'}`}>
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25 flex-shrink-0">
              <Zap className="w-5 h-5 text-white" />
            </div>
            {sidebarOpen && (
              <div>
                <span className="text-lg font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">Zapeera</span>
                <span className="block text-[10px] text-gray-400 font-medium leading-tight">Admin Portal</span>
              </div>
            )}
          </Link>
          {sidebarOpen && (
            <button onClick={() => setSidebarOpen(false)} className="p-2 rounded-lg hover:bg-gray-100 transition ml-auto">
              <ChevronLeft className="w-4 h-4 text-gray-500" />
            </button>
          )}
        </div>

        {!sidebarOpen && (
          <button onClick={() => setSidebarOpen(true)} className="mx-auto mt-4 p-2 rounded-lg hover:bg-gray-100 transition">
            <ChevronRight className="w-4 h-4 text-gray-500" />
          </button>
        )}

        <nav className="flex-1 px-3 py-4 overflow-y-auto overflow-x-hidden">
          {navigation.map((section) => (
            <div key={section.title} className="mb-5">
              {sidebarOpen && (
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-3 mb-2">
                  {section.title}
                </p>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavItem key={item.path} item={item} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="p-3 border-t border-gray-100 space-y-1">
          <Link
            to="/backoffice/profile"
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group ${
              location.pathname === '/backoffice/profile' ? 'bg-gray-100' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <div className="w-7 h-7 bg-gradient-to-br from-gray-600 to-gray-700 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
              {admin.email.charAt(0).toUpperCase()}
            </div>
            {sidebarOpen && (
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{admin.email}</p>
                <p className="text-[10px] text-gray-400">{admin.role}</p>
              </div>
            )}
          </Link>
          <button
            onClick={logout}
            className="flex items-center gap-3 px-3 py-2.5 text-red-600 hover:bg-red-50 rounded-xl transition-all w-full group"
            title="Logout"
          >
            <LogOut className="w-5 h-5 text-red-400 group-hover:text-red-600 flex-shrink-0" />
            {sidebarOpen && <span className="font-medium text-sm">Logout</span>}
          </button>
        </div>
      </aside>

      <main className={`flex-1 transition-all duration-300 ease-in-out ${sidebarOpen ? 'ml-64' : 'ml-20'}`}>
        <header className="bg-white/80 backdrop-blur-xl border-b border-gray-200/50 px-6 py-3 sticky top-0 z-40 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {!sidebarOpen && (
                <button onClick={() => setSidebarOpen(true)} className="p-2 hover:bg-gray-100 rounded-lg transition">
                  <Menu className="w-5 h-5 text-gray-600" />
                </button>
              )}
              <button
                onClick={() => setSearchOpen(true)}
                className="flex items-center gap-2 px-4 py-2 border border-gray-200 rounded-lg hover:border-gray-300 transition text-sm text-gray-500 w-64 bg-white/50"
              >
                <Search className="w-4 h-4 text-gray-400" />
                <span>Search...</span>
                <kbd className="ml-auto px-1.5 py-0.5 bg-gray-100 text-gray-400 text-[10px] rounded">
                  Ctrl+K
                </kbd>
              </button>
            </div>

            <div className="flex items-center gap-3">
              <button className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition relative">
                <Bell className="w-5 h-5" />
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
              </button>
              <button
                onClick={() => setTheme(t => t === 'light' ? 'dark' : 'light')}
                className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition"
              >
                {theme === 'light' ? <Moon className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
              </button>
              <div className="w-px h-8 bg-gray-200" />
              <div className="flex items-center gap-3 pl-2">
                <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-full flex items-center justify-center text-white font-semibold text-sm shadow-lg shadow-blue-500/25">
                  {admin.email.charAt(0).toUpperCase()}
                </div>
                <div className="hidden md:block">
                  <p className="text-sm font-semibold text-gray-900">{admin.email.split('@')[0]}</p>
                  <p className="text-xs text-gray-500">{admin.role}</p>
                </div>
                <ChevronDown className="w-4 h-4 text-gray-400" />
              </div>
            </div>
          </div>
        </header>

        <ImpersonationBanner />

        <div className="p-6">
          {children}
        </div>
      </main>

      {searchOpen && <GlobalSearch />}
    </div>
  );
}
