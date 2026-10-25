/**
 * SidebarUserWidget — the sidebar-footer user card + account dropdown.
 *
 * Single source for the widget that first shipped in ZapeeraLayout
 * (account dashboard, /zapeera). RoleBasedSidebar (business workspace)
 * renders the same widget so both sidebars carry an identical user card:
 * avatar (profileImage if set, else the name initial), name, email and a
 * chevron opening a menu with Edit Profile / Back to Dashboard / Logout.
 *
 * Navigation and logout are injected by the host layout — each shell has
 * its own chrome to close on the way out (mobile drawer, search, …) — so
 * this component owns only the card, the menu and its open state.
 *
 * `collapsed` renders the avatar-only variant used by the workspace
 * sidebar's 72px icon rail; the dropdown (and its targets) is unchanged.
 */
import { useState } from "react";
import { ArrowLeft, ChevronDown, LogOut, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface SidebarUserWidgetUser {
  name?: string | null;
  email?: string | null;
  profileImage?: string | null;
}

interface SidebarUserWidgetProps {
  user: SidebarUserWidgetUser | null | undefined;
  onNavigate: (path: string) => void;
  onLogout: () => void;
  collapsed?: boolean;
}

export function SidebarUserWidget({ user, onNavigate, onLogout, collapsed = false }: SidebarUserWidgetProps) {
  const [menuOpen, setMenuOpen] = useState(false);

  const avatar = (
    <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-sm font-bold text-white">
      {user?.profileImage ? (
        <img src={user.profileImage} alt="" className="h-full w-full object-cover" />
      ) : (
        user?.name ? user.name.charAt(0).toUpperCase() : "U"
      )}
    </div>
  );

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        {collapsed ? (
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Account menu"
            title="Account menu"
            className="flex w-full items-center justify-center rounded-xl p-1.5 transition-colors hover:bg-white/[0.06] data-[state=open]:bg-white/[0.08]"
          >
            {avatar}
          </button>
        ) : (
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Account menu"
            className="flex w-full items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 text-left transition-colors hover:bg-white/[0.06] data-[state=open]:bg-white/[0.08]"
          >
            {avatar}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-bold text-white">{user?.name || "User"}</p>
              <p className="truncate text-[11px] text-white/40">{user?.email || ""}</p>
            </div>
            <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-white/40 transition-transform duration-200", menuOpen && "rotate-180")} />
          </button>
        )}
      </DropdownMenuTrigger>
      {/* z-index must beat the host sidebar (ZapeeraLayout's aside is fixed
          at z-[100]; RoleBasedSidebar is fixed at z-50): the shared
          DropdownMenuContent default is z-50 and this menu opens upward
          OVER the sidebar, so at z-50 it rendered underneath the
          ZapeeraLayout sidebar — invisible and unclickable, which is why
          the chip looked dead in the installed app. */}
      <DropdownMenuContent side="top" align="start" className="z-[200] w-[240px] rounded-2xl border border-[rgba(15,23,60,0.06)] p-2 shadow-[0_12px_48px_rgba(0,0,0,0.12)]">
        <DropdownMenuItem onClick={() => onNavigate("/settings")} className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium text-[#4a5578]">
          <User className="h-[18px] w-[18px] opacity-60" />
          Edit Profile
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onNavigate("/zapeera")} className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium text-[#4a5578]">
          <ArrowLeft className="h-[18px] w-[18px] opacity-60" />
          Back to Dashboard
        </DropdownMenuItem>
        <DropdownMenuSeparator className="mx-2.5" />
        <DropdownMenuItem onClick={onLogout} className="cursor-pointer gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium text-red-600 focus:text-red-600">
          <LogOut className="h-[18px] w-[18px] text-red-600 opacity-70" />
          Logout
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default SidebarUserWidget;
