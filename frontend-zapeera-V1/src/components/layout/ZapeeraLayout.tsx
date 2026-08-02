import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Home,
  MessageCircle,
  LogOut,
  User,
  ArrowLeft,
  ChevronDown,
  Zap,
  UserPlus,
  CreditCard,
  BellRing,
  ShieldCheck,
  Search,
  Sparkles,
  Menu,
  X,
  HelpCircle,
  Laptop,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAdmin } from "@/contexts/useAdmin";
import { useRuntime } from "@/lib/runtime";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { whatsappUrl } from "@/lib/support-links";

interface ZapeeraLayoutProps {
  children: React.ReactNode;
}

type NavItem = {
  key: string;
  label: string;
  icon: React.ElementType;
  to?: string;
  onClick?: () => void;
  external?: string;
  badge?: number;
};

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

const ZapeeraLayout = ({ children }: ZapeeraLayoutProps) => {
  const { user, logout } = useAuth();
  const { allCompanies } = useAdmin();
  const runtime = useRuntime();
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const searchRef = useRef<HTMLDivElement>(null);

  const greeting = getGreeting();

  // Pending invitation count from memberships (status != ACTIVE/DOWNLOADED)
  const pendingInvites = useMemo(() => {
    if (!Array.isArray(user?.memberships)) return 0;
    return user.memberships.filter((m: any) => m.status && !["ACTIVE", "DOWNLOADED", "OUT_OF_SYNC"].includes(m.status)).length;
  }, [user]);

  useEffect(() => {
    const path = location.pathname;
    if (path === "/" || path === "/dashboard" || path === "/zapeera") {
      setActiveTab("dashboard");
    } else if (path.startsWith("/zapeera/my-businesses") || path.startsWith("/my-businesses")) {
      setActiveTab("businesses");
    } else if (path.startsWith("/zapeera/invitations") || path.startsWith("/invitations")) {
      setActiveTab("invitations");
    } else if (path.startsWith("/zapeera/support") || path.startsWith("/support")) {
      setActiveTab("support");
    } else if (path.startsWith("/settings")) {
      setActiveTab("settings");
    } else if (path.startsWith("/zapeera/billing")) {
      setActiveTab("billing");
    } else if (path.startsWith("/zapeera/notifications")) {
      setActiveTab("notifications");
    } else if (path.startsWith("/downloads")) {
      setActiveTab("downloads");
    }
  }, [location.pathname]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const go = (path: string) => {
    setMobileOpen(false);
    setSearchOpen(false);
    setSearchQuery("");
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

  // ---- Search ----
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const businesses = (allCompanies || [])
      .filter((c: any) => c?.name && c.name.toLowerCase().includes(q))
      .slice(0, 5)
      .map((c: any) => ({
        type: "Business",
        title: c.name,
        subtitle: c.businessType || "Business",
        action: () => go(c.slug ? `/business/${encodeURIComponent(c.slug)}/dashboard` : "/zapeera/my-businesses"),
      }));
    const links = [
      { keywords: "invitation invite pending join", type: "Invitation", title: "Invitations", subtitle: "Review pending invitations", to: "/zapeera/invitations" },
      { keywords: "support help center faq contact", type: "Support", title: "Support Center", subtitle: "Help, guides & contact", to: "/zapeera/support" },
      { keywords: "billing payment invoice subscription plans", type: "Account", title: "Billing & Payments", subtitle: "Invoices and payment methods", to: "/zapeera/billing" },
      { keywords: "profile security password 2fa account", type: "Account", title: "Profile & Security", subtitle: "Personal info and security", to: "/settings" },
      { keywords: "notification alert settings", type: "Account", title: "Notification Settings", subtitle: "Email, desktop & push", to: "/zapeera/notifications" },
      { keywords: "create new business", type: "Action", title: "Create a Business", subtitle: "Start a new business", to: "/zapeera?create=1" },
    ];
    const linkResults = links
      .filter((l) => (l.keywords + " " + l.title).toLowerCase().includes(q))
      .map((l) => ({ type: l.type, title: l.title, subtitle: l.subtitle, action: () => go(l.to) }));
    return [...businesses, ...linkResults].slice(0, 8);
  }, [searchQuery, allCompanies]);

  // ---- Notifications (derived from real local/cloud data) ----
  const notifications = useMemo(() => {
    const list: Array<{ id: string; icon: React.ElementType; iconClass: string; title: string; body: string; action?: () => void; time?: string }> = [];

    if (pendingInvites > 0) {
      list.push({
        id: "invites",
        icon: UserPlus,
        iconClass: "bg-amber-500/15 text-amber-600",
        title: `${pendingInvites} pending invitation${pendingInvites > 1 ? "s" : ""}`,
        body: "Review who invited you to their business.",
        action: () => go("/zapeera/invitations"),
      });
    }

    const syncedBusinesses = (runtime.desktopBusinessStates || []).filter((b) => b.availableOffline).length;
    if (runtime.isDesktop && syncedBusinesses > 0) {
      list.push({
        id: "sync",
        icon: RefreshCw,
        iconClass: "bg-sky-500/15 text-sky-600",
        title: `${syncedBusinesses} business${syncedBusinesses > 1 ? "es" : ""} available offline`,
        body: runtime.lastSyncAt ? `Last sync: ${new Date(runtime.lastSyncAt).toLocaleTimeString()}` : "Data is ready for offline use.",
        action: () => go("/zapeera"),
      });
    }

    list.push({
      id: "welcome",
      icon: Sparkles,
      iconClass: "bg-gradient-to-br from-[#1a52c5]/15 to-[#28c2ce]/15 text-[#1a52c5]",
      title: `Welcome to Zapeera, ${user?.name?.split(" ")[0] || ""}`,
      body: "Everything in your account is in one place.",
    });

    return list;
  }, [pendingInvites, runtime.isDesktop, runtime.desktopBusinessStates, runtime.lastSyncAt, user]);

  const navBtn = (active: boolean) =>
    cn(
      "relative mb-0.5 flex w-full items-center gap-3 rounded-[10px] px-3.5 py-2.5 text-left text-sm font-medium transition-all duration-200",
      active
        ? "bg-gradient-to-br from-[#1a52c5]/[0.18] to-[#28c2ce]/[0.08] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
        : "text-white/80 hover:bg-white/[0.04] hover:text-white"
    );

  const activeIndicator = (
    <span
      className="absolute left-0 top-1/2 h-[20px] w-0.5 -translate-y-1/2 rounded-r bg-gradient-to-b from-[#1a52c5] to-[#28c2ce] shadow-[0_0_12px_rgba(40,194,206,0.5)]"
      aria-hidden
    />
  );

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    const active = activeTab === item.key;
    return (
      <button
        key={item.key}
        type="button"
        onClick={() => {
          if (item.onClick) item.onClick();
          else if (item.external) openExternal(item.external);
          else if (item.to) go(item.to);
        }}
        aria-current={active ? "page" : undefined}
        className={navBtn(active)}
      >
        {active && activeIndicator}
        <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} />
        <span className="flex-1">{item.label}</span>
        {item.badge ? (
          <span className="grid min-w-[18px] place-items-center rounded-full bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-1.5 py-0.5 text-[10px] font-bold text-white">
            {item.badge}
          </span>
        ) : null}
      </button>
    );
  };

  const sidebar = (
    <aside className="fixed left-0 top-0 z-[100] flex h-screen w-[272px] flex-col overflow-hidden bg-[#060d1f]">
      <div
        className="pointer-events-none absolute bottom-[-100px] left-[-60px] h-[260px] w-[260px] rounded-full blur-[40px]"
        style={{ background: "radial-gradient(circle, rgba(26,82,197,0.12) 0%, transparent 70%)" }}
      />
      <div
        className="pointer-events-none absolute right-0 top-0 z-[1] h-full w-px opacity-35"
        style={{ background: "linear-gradient(180deg, #1a52c5 0%, #28c2ce 40%, transparent 80%)" }}
      />

      {/* Brand */}
      <div className="relative z-[2] flex w-full shrink-0 items-center justify-between px-5 pb-6 pt-8">
        <div className="flex min-w-0 items-center gap-3" aria-label="Zapeera">
          <div className="grid h-[40px] w-[40px] shrink-0 place-items-center rounded-[13px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] shadow-[0_0_24px_rgba(26,82,197,0.4)]">
            <Zap className="h-[21px] w-[21px] fill-white text-white" aria-hidden />
          </div>
          <span className="truncate text-[21px] font-extrabold tracking-tight text-white">
            Zap
            <span className="bg-gradient-to-br from-[#7eb3ff] to-[#28c2ce] bg-clip-text text-transparent">eera</span>
          </span>
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
      <nav className="sidebar-menu relative z-[2] flex-1 space-y-1 overflow-y-auto px-3.5 pb-4">
        <div>
          <div className="px-3.5 pb-2 pt-2 text-[10px] font-bold uppercase tracking-[1.8px] text-white/40">Main</div>
          {renderNavItem({ key: "dashboard", label: "Dashboard", icon: LayoutDashboard, to: "/zapeera" })}
          {renderNavItem({ key: "businesses", label: "My Businesses", icon: Home, to: "/zapeera/my-businesses" })}
          {renderNavItem({ key: "invitations", label: "Invitations", icon: UserPlus, to: "/zapeera/invitations", badge: pendingInvites || undefined })}
        </div>
        <div>
          <div className="px-3.5 pb-2 pt-4 text-[10px] font-bold uppercase tracking-[1.8px] text-white/40">Account</div>
          {renderNavItem({ key: "settings", label: "Profile & Security", icon: ShieldCheck, to: "/settings" })}
          {renderNavItem({ key: "billing", label: "Billing & Payments", icon: CreditCard, to: "/zapeera/billing" })}
          {renderNavItem({ key: "notifications", label: "Notification Settings", icon: BellRing, to: "/zapeera/notifications" })}
          {renderNavItem({ key: "downloads", label: "Downloads", icon: Laptop, to: "/downloads" })}
        </div>
        <div>
          <div className="px-3.5 pb-2 pt-4 text-[10px] font-bold uppercase tracking-[1.8px] text-white/40">Support</div>
          {renderNavItem({ key: "support", label: "Support Center", icon: HelpCircle, to: "/zapeera/support" })}
        </div>
      </nav>

      {/* Promo card */}
      <div className="relative z-[2] px-3.5">
        <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-br from-[#1a52c5]/[0.14] to-[#28c2ce]/[0.07] px-4 py-4">
          <div
            className="pointer-events-none absolute -right-5 -top-5 h-20 w-20 blur-xl"
            style={{ background: "radial-gradient(circle, rgba(40,194,206,0.18), transparent)" }}
          />
          <div className="relative flex items-start justify-between gap-2">
            <div>
              <h4 className="text-[13px] font-semibold leading-snug text-white">Grow Your Business</h4>
              <p className="text-[13px] font-semibold leading-snug text-white">With Zapeera</p>
            </div>
            <Sparkles className="h-4 w-4 shrink-0 text-[#28c2ce]" />
          </div>
          <p className="relative mb-3 mt-1.5 text-[11px] leading-relaxed text-white/40">
            Unlock more branches, staff and smarter tools with a premium plan.
          </p>
          <button
            type="button"
            onClick={() => go("/zapeera/billing")}
            className="relative inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-3.5 py-1.5 text-[11px] font-semibold text-white shadow-[0_2px_12px_rgba(26,82,197,0.35)] transition-all hover:-translate-y-px hover:shadow-[0_4px_20px_rgba(26,82,197,0.45)]"
          >
            <Sparkles className="h-3 w-3" strokeWidth={2.2} />
            Explore Plans
          </button>
        </div>
      </div>

      {/* User card */}
      <div className="relative z-[2] shrink-0 px-3.5 pb-5 pt-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 text-left transition-colors hover:bg-white/[0.06]"
            >
              <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-sm font-bold text-white">
                {user?.profileImage ? (
                  <img src={user.profileImage} alt="" className="h-full w-full object-cover" />
                ) : (
                  user?.name ? user.name.charAt(0).toUpperCase() : "U"
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-bold text-white">{user?.name || "User"}</p>
                <p className="truncate text-[11px] text-white/40">{user?.email || ""}</p>
              </div>
              <ChevronDown className="h-3.5 w-3.5 shrink-0 text-white/40" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-[240px] rounded-2xl border border-[rgba(15,23,60,0.06)] p-2 shadow-[0_12px_48px_rgba(0,0,0,0.12)]">
            <DropdownMenuItem onClick={() => go("/settings")} className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium text-[#4a5578]">
              <User className="h-[18px] w-[18px] opacity-60" />
              Edit Profile
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => go("/zapeera")} className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium text-[#4a5578]">
              <ArrowLeft className="h-[18px] w-[18px] opacity-60" />
              Back to Dashboard
            </DropdownMenuItem>
            <DropdownMenuSeparator className="mx-2.5" />
            <DropdownMenuItem onClick={handleLogout} className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium text-red-600 focus:text-red-600">
              <LogOut className="h-[18px] w-[18px] text-red-600 opacity-70" />
              Logout
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </aside>
  );

  return (
    <div
      className="zv3-app flex min-h-screen bg-[#f0f2f7] font-['Outfit',system-ui,sans-serif] text-[#0a1128] antialiased"
      style={{ fontFamily: "'Outfit', system-ui, sans-serif" }}
    >
      <div className="pointer-events-none fixed z-0 h-[500px] w-[500px] rounded-full bg-[rgba(40,194,206,0.06)] blur-[100px]" style={{ top: -100, right: -100 }} />
      <div className="pointer-events-none fixed z-0 h-[400px] w-[400px] rounded-full bg-[rgba(26,82,197,0.04)] blur-[100px]" style={{ bottom: 100, left: 350 }} />

      {/* Desktop sidebar */}
      <div className="hidden lg:block">{sidebar}</div>
      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-[150] lg:hidden">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 h-full">{sidebar}</div>
        </div>
      )}

      <div className="ml-0 flex min-h-screen flex-1 flex-col lg:ml-[272px]">
        <header className="sticky top-0 z-[90] flex h-[72px] shrink-0 items-center justify-between gap-3 border-b border-black/[0.04] bg-white/70 px-4 backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/70 sm:px-8 lg:px-11">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] border border-black/[0.06] bg-white text-[#4a5578] lg:hidden"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="hidden min-w-0 sm:block">
              <p className="truncate text-sm font-semibold text-[#0a1128]">
                {greeting}, <span className="font-extrabold">{user?.name?.split(" ")[0] || "there"}</span> <span aria-hidden>👋</span>
              </p>
              <p className="truncate text-xs text-[#8c95b0]">This is your Zapeera control center — manage your businesses, invitations, subscriptions and account settings</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Global search */}
            <div ref={searchRef} className="relative hidden md:block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8c95b0]" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                placeholder="Search businesses, invitations, support…"
                aria-label="Search"
                className="h-10 w-56 rounded-[10px] border border-black/[0.06] bg-white pl-9 pr-3 text-[13px] text-[#0a1128] outline-none transition-all focus:w-72 focus:border-[#1a52c5]/40 focus:ring-2 focus:ring-[#1a52c5]/10 lg:w-64"
              />
              {searchOpen && searchQuery.trim() && (
                <div className="absolute right-0 top-11 z-[120] w-[340px] overflow-hidden rounded-2xl border border-[rgba(15,23,60,0.08)] bg-white p-2 shadow-[0_16px_48px_rgba(0,0,0,0.12)]">
                  {searchResults.length === 0 ? (
                    <p className="px-3 py-4 text-center text-sm text-[#8c95b0]">No results for “{searchQuery}”</p>
                  ) : (
                    searchResults.map((r, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={r.action}
                        className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[#f0f2f7]"
                      >
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[#1a52c5]/10 to-[#28c2ce]/10 text-[#1a52c5]">
                          {r.type === "Business" ? <Home className="h-4 w-4" /> : <Search className="h-4 w-4" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-[#0a1128]">{r.title}</span>
                          <span className="block truncate text-xs text-[#8c95b0]">{r.subtitle}</span>
                        </span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Notifications */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="relative grid h-10 w-10 place-items-center rounded-[10px] border border-black/[0.06] bg-white text-[#4a5578] transition-colors hover:border-black/10"
                  aria-label={`Notifications${notifications.length ? ` (${notifications.length} new)` : ""}`}
                >
                  <BellRing className="h-[18px] w-[18px]" />
                  {notifications.length > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-1 text-[10px] font-bold text-white">
                      {notifications.length}
                    </span>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[340px] rounded-2xl border border-[rgba(15,23,60,0.06)] p-2 shadow-[0_16px_48px_rgba(0,0,0,0.12)]">
                <div className="flex items-center justify-between px-3 py-2">
                  <p className="text-sm font-bold text-[#0a1128]">Notifications</p>
                  <button type="button" onClick={() => go("/zapeera/notifications")} className="text-xs font-semibold text-[#1a52c5] hover:underline">
                    View All
                  </button>
                </div>
                <div className="max-h-[340px] space-y-1 overflow-y-auto">
                  {notifications.map((n) => {
                    const Icon = n.icon;
                    return (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => n.action?.()}
                        className="flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-[#f0f2f7]"
                      >
                        <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-lg", n.iconClass)}>
                          <Icon className="h-[18px] w-[18px]" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[13px] font-semibold text-[#0a1128]">{n.title}</span>
                          <span className="block text-xs text-[#8c95b0]">{n.body}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Profile dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-10 min-w-10 items-center gap-1.5 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] pl-3.5 pr-2 text-[15px] font-bold text-white shadow-[0_2px_10px_rgba(26,82,197,0.25)] transition-transform hover:scale-105"
                  aria-label="Account menu"
                >
                  {user?.profileImage ? (
                    <img src={user.profileImage} alt="" className="-ml-1 h-6 w-6 rounded-full object-cover" />
                  ) : (
                    user?.name ? user.name.charAt(0).toUpperCase() : "U"
                  )}
                  <ChevronDown className="h-3.5 w-3.5 opacity-80" strokeWidth={2.5} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[260px] rounded-2xl border border-[rgba(15,23,60,0.06)] p-2 shadow-[0_12px_48px_rgba(0,0,0,0.1)]">
                <div className="flex items-center gap-3 px-2.5 py-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-[15px] font-bold text-white shadow-[0_2px_10px_rgba(26,82,197,0.25)]">
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
                <DropdownMenuItem onClick={() => go("/zapeera")} className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium text-[#4a5578]">
                  <ArrowLeft className="h-[18px] w-[18px] opacity-60" />
                  Back to Dashboard
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openExternal(whatsappUrl("Hello! I need support with Zapeera."))} className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium text-[#4a5578]">
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

        <div className="relative z-[1] flex-1">{children}</div>
      </div>
    </div>
  );
};

export default ZapeeraLayout;
