import { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import {
  Zap,
  ChevronLeft,
  ChevronRight,
  Search,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { useBackofficeAuth } from '../auth/BackofficeAuthContext';
import { getNavigation } from '../navigation';
import { GlobalSearch } from '../components/search/GlobalSearch';
import { ImpersonationBanner } from '../components/impersonation/ImpersonationBanner';
import { NotificationsBell } from '../components/NotificationsBell';
import { AdminMenu } from '../components/AdminMenu';

interface BackofficeLayoutProps {
  children: React.ReactNode;
}

export function BackofficeLayout({ children }: BackofficeLayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { admin, logout } = useBackofficeAuth();
  // Desktop (lg+) collapse state — expanded w-64 / collapsed w-20 rail.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Mobile (<lg) drawer state — sidebar is off-canvas on small screens,
  // mirroring the tenant app's MainLayout pattern.
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const navigation = admin ? getNavigation(admin.role) : [];

  // Labels render when the desktop sidebar is expanded, and always
  // inside the mobile drawer (which only exists in expanded form).
  const labelsVisible = sidebarOpen || mobileOpen;

  const NavItem = ({ item }: { item: any }) => {
    const isActive = location.pathname === item.path;
    const Icon = item.icon;
    return (
      <Link
        to={item.path}
        onClick={() => setMobileOpen(false)}
        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group ${
          isActive
            ? 'bg-gradient-to-r from-blue-50 to-indigo-50 text-blue-700 border border-blue-200 shadow-sm'
            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
        }`}
        title={!labelsVisible ? item.label : ''}
      >
        <Icon className={`w-5 h-5 flex-shrink-0 transition-colors ${
          isActive ? 'text-blue-600' : 'text-gray-400 group-hover:text-gray-600'
        }`} />
        {labelsVisible && (
          <span className="font-medium text-sm truncate">{item.label}</span>
        )}
        {labelsVisible && isActive && (
          <ChevronRight className="w-4 h-4 text-blue-600 ml-auto flex-shrink-0" />
        )}
        {labelsVisible && item.badge && (
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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-gray-50 to-blue-50/30 flex pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      {/* Mobile drawer backdrop (below lg only) */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside className={`bg-white border-r border-gray-200/60 flex flex-col fixed inset-y-0 left-0 h-full w-64 transition-all duration-300 ease-in-out z-50 ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      } lg:translate-x-0 ${sidebarOpen ? 'lg:w-64' : 'lg:w-20'}`}>
        <div className="h-16 flex items-center px-4 border-b border-gray-100">
          <Link to="/backoffice/dashboard" className={`flex items-center gap-3 ${!labelsVisible && 'justify-center w-full'}`}>
            <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/25 flex-shrink-0">
              <Zap className="w-5 h-5 text-white" />
            </div>
            {labelsVisible && (
              <div>
                <span className="text-lg font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent">Zapeera</span>
                <span className="block text-[10px] text-gray-400 font-medium leading-tight">Admin Portal</span>
              </div>
            )}
          </Link>
          {labelsVisible && (
            <>
              {/* Desktop: collapse to the icon rail */}
              <button onClick={() => setSidebarOpen(false)} className="p-2 rounded-lg hover:bg-gray-100 transition ml-auto hidden lg:block" aria-label="Collapse sidebar">
                <ChevronLeft className="w-4 h-4 text-gray-500" />
              </button>
              {/* Mobile: close the drawer */}
              <button onClick={() => setMobileOpen(false)} className="p-2.5 rounded-lg hover:bg-gray-100 transition ml-auto lg:hidden" aria-label="Close menu">
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </>
          )}
        </div>

        {!sidebarOpen && (
          <button onClick={() => setSidebarOpen(true)} className="mx-auto mt-4 p-2 rounded-lg hover:bg-gray-100 transition max-lg:hidden">
            <ChevronRight className="w-4 h-4 text-gray-500" />
          </button>
        )}

        <nav className="flex-1 px-3 py-4 overflow-y-auto overflow-x-hidden">
          {navigation.map((section) => (
            <div key={section.title} className="mb-5">
              {labelsVisible && (
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
            onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all group ${
              location.pathname === '/backoffice/profile' ? 'bg-gray-100' : 'text-gray-600 hover:bg-gray-50'
            }`}
          >
            <div className="w-7 h-7 bg-gradient-to-br from-gray-600 to-gray-700 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
              {admin.email.charAt(0).toUpperCase()}
            </div>
            {labelsVisible && (
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
            {labelsVisible && <span className="font-medium text-sm">Logout</span>}
          </button>
        </div>
      </aside>

      <main className={`flex-1 min-w-0 transition-all duration-300 ease-in-out ${sidebarOpen ? 'lg:ml-64' : 'lg:ml-20'}`}>
        <header className="bg-white/80 backdrop-blur-xl border-b border-gray-200/50 px-4 sm:px-6 py-3 sticky top-0 z-40 shadow-sm">
          <div className="flex items-center justify-between gap-2 sm:gap-4">
            <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0 sm:flex-none">
              {/* Mobile: hamburger opens the drawer */}
              <button onClick={() => setMobileOpen(true)} className="p-2.5 hover:bg-gray-100 rounded-lg transition lg:hidden flex-shrink-0" aria-label="Open menu">
                <Menu className="w-5 h-5 text-gray-600" />
              </button>
              {/* Desktop: expand the collapsed rail */}
              {!sidebarOpen && (
                <button onClick={() => setSidebarOpen(true)} className="p-2.5 hover:bg-gray-100 rounded-lg transition hidden lg:block flex-shrink-0" aria-label="Expand sidebar">
                  <Menu className="w-5 h-5 text-gray-600" />
                </button>
              )}
              <button
                onClick={() => setSearchOpen(true)}
                className="flex items-center gap-2 px-3 sm:px-4 py-2.5 border border-gray-200 rounded-lg hover:border-gray-300 transition text-sm text-gray-500 flex-1 min-w-0 sm:flex-none sm:w-64 bg-white/50"
              >
                <Search className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <span className="truncate">Search...</span>
                <kbd className="ml-auto px-1.5 py-0.5 bg-gray-100 text-gray-400 text-[10px] rounded hidden sm:block flex-shrink-0">
                  Ctrl+K
                </kbd>
              </button>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-3 flex-shrink-0">
              <NotificationsBell />
              <div className="w-px h-8 bg-gray-200 hidden sm:block" />
              <AdminMenu />
            </div>
          </div>
        </header>

        <ImpersonationBanner />

        <div className="p-4 sm:p-6">
          {children}
        </div>
      </main>

      {searchOpen && <GlobalSearch />}
    </div>
  );
}
