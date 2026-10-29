/**
 * WelcomeLayout — the welcome-screen clone shell, used ONLY by the
 * /zapeera account home (ZapeeraDashboard). Every other route keeps
 * ZapeeraLayout untouched.
 *
 * Faithful to Muhammad's reference mockup: deep-navy sidebar (~250px)
 * with MAIN / MANAGE / ACCOUNT / SUPPORT sections, the violet promo
 * card and the user card; a white header with the time-aware greeting,
 * search, Online pill, notification bell and avatar.
 *
 * Data is all real: invitation badge from memberships (same derivation
 * as ZapeeraLayout), bell badge from NotificationContext, Online state
 * from the desktop runtime (desktop) or the fresh profile fetch (web —
 * the same honest signal the Cloud panel uses). The header search is
 * the business filter for the page below: query state lives here and
 * the business section consumes it via useWelcomeSearch().
 */
import { createContext, useContext, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Bell,
  Briefcase,
  ChevronDown,
  CreditCard,
  Home,
  LogOut,
  Mail,
  Menu,
  MessageCircle,
  Plus,
  Rocket,
  Search,
  Settings,
  ShieldCheck,
  User,
  UserPlus,
  Users,
  X,
  Zap,
  LifeBuoy,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useBranding } from "@/contexts/BrandingContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { useRuntime } from "@/lib/runtime";
import { useAccountStatus } from "@/lib/account-status";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { whatsappUrl } from "@/lib/support-links";
import { SidebarUserWidget } from "@/components/layout/SidebarUserWidget";

/* ------------------------------------------------------------------ */
/* Search context — header input filters the business grid below.      */
/* ------------------------------------------------------------------ */
const WelcomeSearchContext = createContext<{ query: string; setQuery: (q: string) => void }>({
  query: "",
  setQuery: () => {},
});

export function useWelcomeSearch() {
  return useContext(WelcomeSearchContext);
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

type NavItem = {
  key: string;
  label: string;
  icon: React.ElementType;
  to?: string;
  onClick?: () => void;
  badge?: number;
};

const WelcomeLayout = ({ children }: { children: React.ReactNode }) => {
  const { user, logout } = useAuth();
  const { branding, viewer } = useBranding();
  const { unreadCount } = useNotifications();
  const runtime = useRuntime();
  const { profile, loading: profileLoading } = useAccountStatus();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Pending invitation count from memberships (status != ACTIVE/DOWNLOADED)
  const pendingInvites = useMemo(() => {
    if (!Array.isArray(user?.memberships)) return 0;
    return user.memberships.filter(
      (m: any) => m.status && !["ACTIVE", "DOWNLOADED", "OUT_OF_SYNC"].includes(m.status)
    ).length;
  }, [user]);

  // Online truth: desktop reads the runtime cloud state; on web the sync
  // engine does not run, so the honest signal is that the cloud API
  // answered the fresh profile fetch in this session.
  const online = runtime.isDesktop
    ? runtime.cloudState === "online"
    : profileLoading
      ? typeof navigator !== "undefined"
        ? navigator.onLine
        : true
      : profile !== null;

  const go = (path: string) => {
    setMobileOpen(false);
    navigate(path);
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate("/login");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const openExternal = (url: string) => {
    if ((window as any).electronAPI?.openExternal) {
      (window as any).electronAPI.openExternal(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  const activeKey = location.pathname.startsWith("/zapeera/my-businesses")
    ? "businesses"
    : location.pathname.startsWith("/zapeera/invitations")
      ? "invitations"
      : "dashboard";

  const navBtn = (active: boolean) =>
    cn(
      "relative mb-0.5 flex w-full items-center gap-3 rounded-[10px] px-3.5 py-2.5 text-left text-sm font-medium transition-all duration-200",
      active
        ? "bg-gradient-to-r from-[#2f7df6] to-[#2563eb] font-semibold text-white shadow-[0_6px_20px_rgba(37,99,235,0.45)]"
        : "text-white/75 hover:bg-white/[0.05] hover:text-white"
    );

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    const active = activeKey === item.key;
    return (
      <button
        key={item.key}
        type="button"
        onClick={() => {
          if (item.onClick) item.onClick();
          else if (item.to) go(item.to);
        }}
        aria-current={active ? "page" : undefined}
        className={navBtn(active)}
      >
        <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} />
        <span className="flex-1">{item.label}</span>
        {item.badge ? (
          <span className="grid min-w-[20px] place-items-center rounded-full bg-[#7c3aed] px-1.5 py-0.5 text-[10px] font-bold text-white">
            {item.badge}
          </span>
        ) : null}
      </button>
    );
  };

  const sectionLabel = (text: string) => (
    <div className="px-3.5 pb-2 pt-5 text-[10px] font-bold uppercase tracking-[1.8px] text-white/35 first:pt-1">
      {text}
    </div>
  );

  const sidebar = (
    <aside className="fixed left-0 top-0 z-[100] flex h-screen w-[250px] flex-col overflow-hidden bg-[#0a1128] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div
        className="pointer-events-none absolute bottom-[-100px] left-[-60px] h-[260px] w-[260px] rounded-full blur-[40px]"
        style={{ background: "radial-gradient(circle, rgba(37,99,235,0.16) 0%, transparent 70%)" }}
      />

      {/* Brand */}
      <div className="relative z-[2] flex w-full shrink-0 items-center justify-between px-5 pb-5 pt-6">
        <div className="flex min-w-0 items-center gap-2.5" aria-label={branding.productName}>
          {branding.partnerSlug ? (
            <>
              {branding.logoUrl ? (
                <img src={branding.logoUrl} alt={branding.productName} className="h-[38px] w-[38px] shrink-0 rounded-[11px] bg-white object-contain" />
              ) : (
                <div className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] text-white shadow" style={{ background: branding.primaryColor || "#2563eb" }}>
                  <span className="text-base font-extrabold">{branding.productName.charAt(0)}</span>
                </div>
              )}
              <span className="truncate text-[20px] font-extrabold tracking-tight text-white">{branding.productName}</span>
            </>
          ) : (
            <>
              <div className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[11px] bg-gradient-to-br from-[#2563eb] to-[#7c3aed] shadow-[0_0_24px_rgba(37,99,235,0.45)]">
                <Zap className="h-[20px] w-[20px] fill-white text-white" aria-hidden />
              </div>
              <span className="truncate text-[20px] font-extrabold tracking-tight text-white">
                Zap<span className="bg-gradient-to-br from-[#7eb3ff] to-[#a78bfa] bg-clip-text text-transparent">eera</span>
              </span>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="grid h-9 w-9 place-items-center rounded-[10px] text-white/60 hover:bg-white/[0.06] hover:text-white lg:hidden"
          aria-label="Close menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Nav */}
      <nav className="sidebar-menu relative z-[2] flex-1 overflow-y-auto px-3 pb-4">
        <div>
          {sectionLabel("Main")}
          {renderNavItem({ key: "dashboard", label: "Dashboard", icon: Home, to: "/zapeera" })}
          {renderNavItem({ key: "businesses", label: "My Businesses", icon: Briefcase, to: "/zapeera/my-businesses" })}
        </div>
        <div>
          {sectionLabel("Manage")}
          {renderNavItem({
            key: "invitations",
            label: "Invitations",
            icon: Users,
            to: "/zapeera/invitations",
            badge: pendingInvites || undefined,
          })}
          {renderNavItem({
            key: "create",
            label: "Create Business",
            icon: Plus,
            onClick: () => go("/zapeera?create=1"),
          })}
        </div>
        <div>
          {sectionLabel("Account")}
          {renderNavItem({ key: "settings", label: "Profile & Security", icon: ShieldCheck, to: "/settings" })}
          {renderNavItem({ key: "billing", label: "Billing & Payments", icon: CreditCard, to: "/zapeera/billing" })}
          {renderNavItem({ key: "notification-settings", label: "Notification Settings", icon: Settings, to: "/zapeera/notification-settings" })}
        </div>
        <div>
          {sectionLabel("Support")}
          {renderNavItem({ key: "support", label: "Support Center", icon: LifeBuoy, to: "/zapeera/support" })}
          {renderNavItem({
            key: "contact",
            label: "Contact Us",
            icon: Mail,
            onClick: () => openExternal(whatsappUrl("Hello! I need support with Zapeera.")),
          })}
        </div>

      </nav>

      {/* Promo card — violet gradient, pinned above the user card like
          the reference; Explore Plans → the account billing page (it
          carries the plans callout). */}
      <div className="relative z-[2] shrink-0 px-3 pb-1 pt-2">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#7c3aed] via-[#6d28d9] to-[#4338ca] p-4">
          <div className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full bg-white/10" />
          <div className="pointer-events-none absolute -bottom-10 -left-4 h-24 w-24 rounded-full bg-white/[0.07]" />
          <div className="relative">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white">
              <Rocket className="h-5 w-5" />
            </span>
            <p className="mt-3 text-[15px] font-bold leading-snug text-white">Bring your business to the next level</p>
            <p className="mt-1 text-[12.5px] leading-snug text-white/75">Discover powerful tools to grow with Zapeera.</p>
            <button
              type="button"
              onClick={() => go("/zapeera/billing")}
              className="mt-3.5 rounded-lg bg-white px-4 py-2 text-[13px] font-bold text-[#6d28d9] shadow-sm transition-transform hover:-translate-y-px"
            >
              Explore Plans
            </button>
          </div>
        </div>
      </div>

      {/* User card — same shared widget as the other shells */}
      <div className="relative z-[2] shrink-0 px-3 pb-4 pt-2">
        <SidebarUserWidget user={user} onNavigate={go} onLogout={handleLogout} />
      </div>
    </aside>
  );

  return (
    <WelcomeSearchContext.Provider value={{ query: searchQuery, setQuery: setSearchQuery }}>
      <div
        className="zv3-app flex min-h-screen bg-white pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-[#0a1128] antialiased"
        style={{ fontFamily: "'Outfit', system-ui, sans-serif" }}
      >
        {/* Desktop sidebar */}
        <div className="hidden lg:block">{sidebar}</div>
        {/* Mobile sidebar */}
        {mobileOpen && (
          <div className="fixed inset-0 z-[150] lg:hidden">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
            <div className="absolute left-0 top-0 h-full">{sidebar}</div>
          </div>
        )}

        <div className="flex min-h-screen min-w-0 flex-1 flex-col lg:ml-[250px]">
          <header className="sticky top-0 z-[90] flex items-center gap-3 bg-white px-4 py-4 sm:px-6 lg:px-7">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-[rgba(15,23,60,0.08)] bg-white text-[#4a5578] lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <h1 className="truncate text-[19px] font-extrabold leading-tight tracking-tight text-[#0a1128]">
                {getGreeting()}, {user?.name?.split(" ")[0] || "there"} <span aria-hidden>👋</span>
              </h1>
              <p className="truncate text-[13px] text-[#8c95b0]">Here&apos;s an overview of your businesses and account.</p>
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-2.5 sm:gap-3">
              {/* Search — filters the business grid on this page */}
              <div className="relative hidden md:block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8c95b0]" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setSearchQuery("");
                  }}
                  placeholder="Search anything..."
                  aria-label="Search businesses"
                  className="h-10 w-[220px] rounded-[10px] border border-[rgba(15,23,60,0.1)] bg-white pl-9 pr-3 text-[13px] text-[#0a1128] outline-none transition-all placeholder:text-[#8c95b0] focus:border-[#2563eb]/50 focus:ring-2 focus:ring-[#2563eb]/10 xl:w-[264px]"
                />
              </div>

              {/* Online pill */}
              <span
                className="hidden h-10 items-center gap-2 rounded-full border border-[rgba(15,23,60,0.1)] bg-white px-3.5 text-[13px] font-semibold text-[#0a1128] sm:inline-flex"
                role="status"
              >
                <span className={cn("h-2 w-2 rounded-full", online ? "bg-green-500" : "bg-gray-300")} />
                {online ? "Online" : "Offline"}
              </span>

              {/* Notifications */}
              <button
                type="button"
                onClick={() => go("/zapeera/notifications")}
                className="relative grid h-10 w-10 place-items-center rounded-full text-[#4a5578] transition-colors hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
              >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                  <span className="absolute right-0.5 top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                    {unreadCount}
                  </span>
                )}
              </button>

              {/* Profile dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-full transition-transform hover:scale-[1.03]"
                    aria-label="Account menu"
                  >
                    <span className="grid h-10 w-10 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#2563eb] to-[#1d4ed8] text-[13px] font-bold text-white shadow-[0_2px_10px_rgba(37,99,235,0.3)]">
                      {user?.profileImage ? (
                        <img src={user.profileImage} alt="" className="h-full w-full object-cover" />
                      ) : (
                        (user?.name || "U")
                          .split(" ")
                          .filter(Boolean)
                          .slice(0, 2)
                          .map((p) => p.charAt(0).toUpperCase())
                          .join("") || "U"
                      )}
                    </span>
                    <ChevronDown className="h-4 w-4 text-[#4a5578]" strokeWidth={2.5} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[260px] rounded-2xl border border-[rgba(15,23,60,0.06)] p-2 shadow-[0_12px_48px_rgba(0,0,0,0.1)]">
                  <div className="flex items-center gap-3 px-2.5 py-3">
                    <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#2563eb] to-[#1d4ed8] text-sm font-bold text-white">
                      {user?.profileImage ? (
                        <img src={user.profileImage} alt="" className="h-full w-full object-cover" />
                      ) : (
                        user?.name ? user.name.charAt(0).toUpperCase() : "U"
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold tracking-tight text-[#0a1128]">{user?.name || "User"}</p>
                      <p className="truncate text-xs text-[#8c95b0]">{user?.email || ""}</p>
                    </div>
                  </div>
                  <DropdownMenuSeparator className="mx-2.5" />
                  <DropdownMenuItem onClick={() => go("/settings")} className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium text-[#4a5578]">
                    <User className="h-[18px] w-[18px] opacity-60" />
                    Edit Profile
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => openExternal(whatsappUrl("Hello! I need support with Zapeera."))}
                    className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium text-[#4a5578]"
                  >
                    <MessageCircle className="h-[18px] w-[18px] opacity-60" />
                    WhatsApp Support
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="mx-2.5" />
                  <DropdownMenuItem onClick={handleLogout} className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium text-red-600 focus:text-red-600">
                    <LogOut className="h-[18px] w-[18px] text-red-600 opacity-70" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <div className="relative min-w-0 flex-1 px-4 pb-12 sm:px-6 lg:px-7">{children}</div>
        </div>
      </div>
    </WelcomeSearchContext.Provider>
  );
};

export default WelcomeLayout;
