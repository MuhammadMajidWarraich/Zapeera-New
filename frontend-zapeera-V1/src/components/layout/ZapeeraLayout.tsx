import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Home,
  Settings,
  MessageCircle,
  Calendar,
  CreditCard,
  LogOut,
  User,
  ArrowLeft,
  ChevronDown,
  Zap,
} from "lucide-react";
import { config } from "@/lib/config";
import { useAuth } from "@/contexts/AuthContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface ZapeeraLayoutProps {
  children: React.ReactNode;
}

const ZapeeraLayout = ({ children }: ZapeeraLayoutProps) => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState("dashboard");

  useEffect(() => {
    const path = location.pathname;
    if (path === "/" || path === "/dashboard" || path === "/zapeera") {
      setActiveTab("dashboard");
    } else if (path.startsWith("/pos")) {
      setActiveTab("pos");
    } else if (path.startsWith("/zapeera/my-businesses") || path.startsWith("/my-businesses")) {
      setActiveTab("businesses");
    } else if (path.startsWith("/settings")) {
      setActiveTab("settings");
    }
  }, [location.pathname]);

  const handleNavigation = (tab: string) => {
    setActiveTab(tab);
    switch (tab) {
      case "dashboard":
        navigate("/zapeera");
        break;
      case "pos":
        navigate("/pos");
        break;
      case "businesses":
        navigate("/zapeera/my-businesses");
        break;
      case "subscription":
        // Fallback in case a user manually triggers this
        break;
      case "settings":
        navigate("/settings");
        break;
      default:
        break;
    }
  };

  const handleChatSupport = () => {
    const phoneNumber = config.support.phoneNumber;
    const message = "Hello! I need support with Zapeera.";
    const whatsappUrl = `https://wa.me/${phoneNumber.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(message)}`;
    window.open(whatsappUrl, "_blank");
  };

  const handleScheduleDemo = () => {
    window.open(config.support.contactUrl, "_blank");
  };

  const handleLogout = async () => {
    try {
      await logout();
      navigate("/login");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const handleEditProfile = () => {
    navigate("/settings");
  };

  const handleBackToProfile = () => {
    navigate("/zapeera");
  };

  const navBtn = (tab: string, active: boolean) =>
    cn(
      "relative mb-0.5 flex w-full items-center gap-[13px] rounded-[10px] px-3.5 py-3 text-left text-sm font-medium transition-all duration-[250ms]",
      active
        ? "bg-gradient-to-br from-[#1a52c5]/[0.18] to-[#28c2ce]/[0.08] text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
        : "text-white/85 hover:bg-white/[0.04] hover:text-white"
    );

  return (
    <div
      className="zv3-app flex min-h-screen bg-[#f0f2f7] font-['Outfit',system-ui,sans-serif] text-[#0a1128] antialiased"
      style={{ fontFamily: "'Outfit', system-ui, sans-serif" }}
    >
      <div
        className="pointer-events-none fixed z-0 h-[500px] w-[500px] rounded-full bg-[rgba(40,194,206,0.06)] blur-[100px]"
        style={{ top: -100, right: -100 }}
      />
      <div
        className="pointer-events-none fixed z-0 h-[400px] w-[400px] rounded-full bg-[rgba(26,82,197,0.04)] blur-[100px]"
        style={{ bottom: 100, left: 350 }}
      />

      <aside className="fixed left-0 top-0 z-[100] flex h-screen w-[272px] flex-col overflow-hidden bg-[#060d1f]">
        <div
          className="pointer-events-none absolute bottom-[-100px] left-[-60px] h-[260px] w-[260px] rounded-full blur-[40px]"
          style={{
            background: "radial-gradient(circle, rgba(26,82,197,0.12) 0%, transparent 70%)",
          }}
        />
        <div
          className="pointer-events-none absolute right-0 top-0 z-[1] h-full w-px opacity-35"
          style={{
            background: "linear-gradient(180deg, #1a52c5 0%, #28c2ce 40%, transparent 80%)",
          }}
        />

        <div className="relative z-[2] w-full shrink-0 px-5 pb-8 pt-10">
          {/* Same brand mark as RoleBasedSidebar (business app) */}
          <div className="flex min-w-0 items-center gap-3.5" aria-label="Zapeera">
            <div className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[13px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] shadow-[0_0_24px_rgba(26,82,197,0.4)]">
              <Zap className="h-[22px] w-[22px] fill-white text-white" aria-hidden />
            </div>
            <span className="truncate text-[22px] font-extrabold tracking-tight text-white">
              Zap
              <span className="bg-gradient-to-br from-[#7eb3ff] to-[#28c2ce] bg-clip-text text-transparent">
                eera
              </span>
            </span>
          </div>
        </div>

        <nav className="sidebar-menu relative z-[2] flex-1 space-y-2 px-3.5">
          <div>
            <div className="px-3.5 pb-2.5 pt-[18px] text-[10px] font-bold uppercase tracking-[1.8px] text-white">
              Main
            </div>
            <button type="button" onClick={() => handleNavigation("dashboard")} className={navBtn("dashboard", activeTab === "dashboard")}>
              {activeTab === "dashboard" && (
                <span
                  className="absolute left-0 top-1/2 h-[22px] w-0.5 -translate-y-1/2 rounded-r bg-gradient-to-b from-[#1a52c5] to-[#28c2ce] shadow-[0_0_12px_rgba(40,194,206,0.5)]"
                  aria-hidden
                />
              )}
              <LayoutDashboard className="h-5 w-5 shrink-0" strokeWidth={1.8} />
              Dashboard
            </button>
            <button type="button" onClick={() => handleNavigation("businesses")} className={navBtn("businesses", activeTab === "businesses")}>
              {activeTab === "businesses" && (
                <span
                  className="absolute left-0 top-1/2 h-[22px] w-0.5 -translate-y-1/2 rounded-r bg-gradient-to-b from-[#1a52c5] to-[#28c2ce] shadow-[0_0_12px_rgba(40,194,206,0.5)]"
                  aria-hidden
                />
              )}
              <Home className="h-5 w-5 shrink-0" strokeWidth={1.8} />
              My Businesses
            </button>
            {/* Global Subscription link removed - now per-business */}
          </div>
          <div>
            <div className="px-3.5 pb-2.5 pt-2 text-[10px] font-bold uppercase tracking-[1.8px] text-white">
              System
            </div>
            <button type="button" onClick={() => handleNavigation("settings")} className={navBtn("settings", activeTab === "settings")}>
              {activeTab === "settings" && (
                <span
                  className="absolute left-0 top-1/2 h-[22px] w-0.5 -translate-y-1/2 rounded-r bg-gradient-to-b from-[#1a52c5] to-[#28c2ce] shadow-[0_0_12px_rgba(40,194,206,0.5)]"
                  aria-hidden
                />
              )}
              <Settings className="h-5 w-5 shrink-0" strokeWidth={1.8} />
              Settings
            </button>
          </div>
        </nav>

        <div className="relative z-[2] px-3.5 pb-6 pt-4">
          <div className="relative overflow-hidden rounded-2xl border border-white/5 bg-gradient-to-br from-[#1a52c5]/10 to-[#28c2ce]/[0.06] px-[18px] py-5">
            <div
              className="pointer-events-none absolute -right-5 -top-5 h-20 w-20 blur-xl"
              style={{ background: "radial-gradient(circle, rgba(40,194,206,0.15), transparent)" }}
            />
            <h4 className="relative text-[13px] font-semibold text-white/80">Need Help?</h4>
            <p className="relative mb-3.5 mt-1 text-xs leading-relaxed text-white/30">
              Get guidance from our team to maximize your workflow.
            </p>
            <div className="relative flex gap-2">
              <button
                type="button"
                onClick={handleChatSupport}
                className="inline-flex items-center gap-1.5 rounded-lg border-0 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] px-3.5 py-1.5 text-[11px] font-semibold text-white shadow-[0_2px_12px_rgba(26,82,197,0.3)] transition-all hover:-translate-y-px hover:shadow-[0_4px_20px_rgba(26,82,197,0.45)]"
              >
                <MessageCircle className="h-3 w-3" strokeWidth={2} />
                Chat
              </button>
              <button
                type="button"
                onClick={handleScheduleDemo}
                className="inline-flex items-center gap-1.5 rounded-lg border-0 bg-white/[0.06] px-3.5 py-1.5 text-[11px] font-semibold text-white/50 transition-all hover:bg-white/10 hover:text-white/70"
              >
                <Calendar className="h-3 w-3" strokeWidth={2} />
                Demo
              </button>
            </div>
          </div>
        </div>
      </aside>

      <div className="ml-[272px] flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-50 flex h-[72px] items-center justify-between border-b border-black/[0.04] bg-white/70 px-11 backdrop-blur-xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/70">
          <div className="flex items-center gap-2.5">
            <span className="text-sm tracking-wide text-[#8c95b0]">
              <b className="font-bold text-[#0a1128]">Smart.</b> Seamless. Scalable. That&apos;s Zapeera.
            </span>
          </div>
          <div className="flex items-center gap-2">

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-10 min-w-10 items-center gap-1.5 rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] pl-3.5 pr-2 text-[15px] font-bold text-white shadow-[0_2px_10px_rgba(26,82,197,0.25)] transition-transform hover:scale-105 overflow-hidden"
                >
                  {user?.profileImage ? (
                    <img src={user.profileImage} alt="" className="h-6 w-6 rounded-full object-cover -ml-1" />
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
                <DropdownMenuItem onClick={handleEditProfile} className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium text-[#4a5578]">
                  <User className="h-[18px] w-[18px] opacity-60" />
                  Edit Profile
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleBackToProfile} className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium text-[#4a5578]">
                  <ArrowLeft className="h-[18px] w-[18px] opacity-60" />
                  Back to Dashboard
                </DropdownMenuItem>
                <DropdownMenuSeparator className="mx-2.5" />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium text-red-600 focus:text-red-600"
                >
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
