import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { BellRing, UserPlus, Laptop, RefreshCw, Sparkles, ChevronRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useRuntime } from "@/lib/runtime";
import { cn } from "@/lib/utils";

const NotificationsPage = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const runtime = useRuntime();

  const items = useMemo(() => {
    const list: Array<{ id: string; icon: React.ElementType; tint: string; title: string; body: string; time: string; to?: string }> = [];

    const pendingInvites = Array.isArray(user?.memberships)
      ? user.memberships.filter((m: any) => m.status && !["ACTIVE", "DOWNLOADED", "OUT_OF_SYNC"].includes(m.status)).length
      : 0;
    if (pendingInvites > 0) {
      list.push({
        id: "invites",
        icon: UserPlus,
        tint: "bg-amber-500/12 text-amber-600",
        title: `${pendingInvites} pending invitation${pendingInvites > 1 ? "s" : ""}`,
        body: "Businesses have invited you to join. Review them before they expire.",
        time: "Now",
        to: "/zapeera/invitations",
      });
    }

    const desktopCount = (runtime.desktopBusinessStates || []).filter((b) => b.availableOffline).length;
    if (runtime.isDesktop && desktopCount > 0) {
      list.push({
        id: "desktop",
        icon: Laptop,
        tint: "bg-violet-500/12 text-violet-600",
        title: `${desktopCount} business${desktopCount > 1 ? "es" : ""} available offline`,
        body: runtime.lastSyncAt
          ? `Last sync was ${new Date(runtime.lastSyncAt).toLocaleString()}.`
          : "Your desktop has data ready for offline use.",
        time: runtime.lastSyncAt ? "Last sync" : "Ready",
        to: "/zapeera",
      });
    }

    list.push({
      id: "welcome",
      icon: Sparkles,
      tint: "bg-gradient-to-br from-[#1a52c5]/15 to-[#28c2ce]/15 text-[#1a52c5]",
      title: "Welcome to Zapeera",
      body: "Your account is set up. Create or join a business to get started.",
      time: "Sign up",
    });

    return list;
  }, [user, runtime.isDesktop, runtime.desktopBusinessStates, runtime.lastSyncAt]);

  return (
    <main className="mx-auto w-full max-w-[1000px] px-4 py-7 sm:px-8 lg:px-11 lg:py-9">
      <div className="mb-7">
        <div className="mb-1.5 inline-flex items-center gap-2 rounded-full border border-[#1a52c5]/10 bg-gradient-to-br from-[#1a52c5]/[0.06] to-[#28c2ce]/[0.06] px-3 py-1 text-xs font-semibold text-[#1a52c5]">
          <BellRing className="h-3.5 w-3.5" />
          Account
        </div>
        <h1 className="text-[28px] font-extrabold tracking-[-0.7px] text-[#0a1128]">Notifications</h1>
        <p className="mt-1 text-sm text-[#8c95b0]">Updates about your account, invitations and desktop sync.</p>
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[rgba(15,23,60,0.12)] bg-white/60 p-12 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#1a52c5]/10 to-[#28c2ce]/10 text-[#1a52c5]">
            <BellRing className="h-7 w-7" />
          </div>
          <h3 className="text-lg font-bold text-[#0a1128]">You're all caught up</h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-[#8c95b0]">
            No notifications right now. We'll let you know when something needs your attention.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((n) => {
            const Icon = n.icon;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => n.to && navigate(n.to)}
                className={cn(
                  "flex w-full items-start gap-4 rounded-2xl border border-[rgba(15,23,60,0.06)] bg-white p-5 text-left shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)] transition-all",
                  n.to && "hover:-translate-y-0.5 hover:shadow-[0_12px_40px_rgba(0,0,0,0.08)]"
                )}
              >
                <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl", n.tint)}>
                  <Icon className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-bold text-[#0a1128]">{n.title}</span>
                  <span className="mt-0.5 block text-[13px] leading-relaxed text-[#4a5578]">{n.body}</span>
                  <span className="mt-1 block text-xs font-medium text-[#8c95b0]">{n.time}</span>
                </span>
                {n.to && <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[#8c95b0]" />}
              </button>
            );
          })}
        </div>
      )}
    </main>
  );
};

export default NotificationsPage;
