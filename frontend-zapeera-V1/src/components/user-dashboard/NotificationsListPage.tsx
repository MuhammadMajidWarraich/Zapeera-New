import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Bell,
  BellRing,
  CheckCheck,
  ChevronRight,
  Filter,
  Trash2,
  Settings,
  Package,
  ShoppingCart,
  CreditCard,
  Users,
  UserPlus,
  Inbox,
  Megaphone,
  RefreshCw,
} from "lucide-react";
import { apiService } from "@/services/api";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useNotifications } from "@/contexts/NotificationContext";

type NotificationItem = {
  id: string;
  businessId: string | null;
  type: string;
  title: string;
  body: string;
  actionUrl: string | null;
  metadata: any;
  read: boolean;
  createdAt: string;
};

const TYPE_ICONS: Record<string, { icon: React.ElementType; tint: string }> = {
  sale: { icon: ShoppingCart, tint: "bg-green-500/12 text-green-600" },
  sale_created: { icon: ShoppingCart, tint: "bg-green-500/12 text-green-600" },
  inventory: { icon: Package, tint: "bg-amber-500/12 text-amber-600" },
  inventory_low: { icon: Package, tint: "bg-amber-500/12 text-amber-600" },
  subscription: { icon: CreditCard, tint: "bg-violet-500/12 text-violet-600" },
  subscription_expiry: { icon: CreditCard, tint: "bg-violet-500/12 text-violet-600" },
  invitation: { icon: UserPlus, tint: "bg-blue-500/12 text-blue-600" },
  invitation_received: { icon: UserPlus, tint: "bg-blue-500/12 text-blue-600" },
  staff: { icon: Users, tint: "bg-teal-500/12 text-teal-600" },
  staff_added: { icon: Users, tint: "bg-teal-500/12 text-teal-600" },
  billing: { icon: CreditCard, tint: "bg-pink-500/12 text-pink-600" },
  payment_approved: { icon: CreditCard, tint: "bg-green-500/12 text-green-600" },
  system: { icon: Megaphone, tint: "bg-gradient-to-br from-[#1a52c5]/15 to-[#28c2ce]/15 text-[#1a52c5]" },
};

function getIconForType(type: string) {
  if (TYPE_ICONS[type]) return TYPE_ICONS[type];
  const prefix = type.split("_")[0];
  if (TYPE_ICONS[prefix]) return TYPE_ICONS[prefix];
  return { icon: Bell, tint: "bg-gray-500/12 text-gray-600" };
}

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const NotificationsListPage = () => {
  const navigate = useNavigate();
  const { refreshUnreadCount } = useNotifications();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const loadNotifications = useCallback(async (p: number, unreadOnly: boolean) => {
    setLoading(true);
    try {
      const res = await apiService.getNotifications({ page: p, limit: 20, unreadOnly });
      if (res.success && res.data) {
        setNotifications(res.data.notifications);
        setTotal(res.data.total);
        setUnreadCount(res.data.unreadCount);
        setTotalPages(res.data.totalPages);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadNotifications(page, filter === "unread");
  }, [page, filter, loadNotifications]);

  const handleMarkAllRead = async () => {
    try {
      await apiService.markAllNotificationsAsRead();
      await loadNotifications(page, filter === "unread");
      await refreshUnreadCount();
      toast({ title: "Done", description: "All notifications marked as read." });
    } catch {
      toast({ title: "Error", description: "Could not mark all as read.", variant: "destructive" });
    }
  };

  const handleMarkRead = async (id: string) => {
    try {
      await apiService.markNotificationAsRead(id);
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setUnreadCount((c) => Math.max(0, c - 1));
      await refreshUnreadCount();
    } catch {
      // ignore
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiService.deleteNotification(id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      setTotal((t) => t - 1);
      await refreshUnreadCount();
    } catch {
      // ignore
    }
  };

  return (
    <main className="mx-auto w-full max-w-[1000px] px-4 py-7 sm:px-8 lg:px-11 lg:py-9">
      <div className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="mb-1.5 inline-flex items-center gap-2 rounded-full border border-[#1a52c5]/10 bg-gradient-to-br from-[#1a52c5]/[0.06] to-[#28c2ce]/[0.06] px-3 py-1 text-xs font-semibold text-[#1a52c5]">
            <BellRing className="h-3.5 w-3.5" />
            Notifications
          </div>
          <h1 className="text-[28px] font-extrabold tracking-[-0.7px] text-[#0a1128]">Notifications</h1>
          <p className="mt-1 text-sm text-[#8c95b0]">
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}` : "You're all caught up"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate("/zapeera/notifications")}
            className="h-9 gap-1.5 rounded-[10px] border-[rgba(15,23,60,0.06)] text-sm font-semibold text-[#4a5578]"
          >
            <Settings className="h-3.5 w-3.5" />
            Settings
          </Button>
          {unreadCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleMarkAllRead}
              className="h-9 gap-1.5 rounded-[10px] border-[rgba(15,23,60,0.06)] text-sm font-semibold text-[#4a5578]"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Mark all read
            </Button>
          )}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="mb-4 flex gap-2">
        {(["all", "unread"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => { setFilter(f); setPage(1); }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13px] font-semibold transition-colors",
              filter === f
                ? "bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white shadow-[0_2px_8px_rgba(26,82,197,0.25)]"
                : "bg-white text-[#4a5578] border border-[rgba(15,23,60,0.06)] hover:bg-[#f0f2f7]"
            )}
          >
            <Filter className="h-3 w-3" />
            {f === "all" ? "All" : `Unread (${unreadCount})`}
          </button>
        ))}
      </div>

      {/* Notifications list */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-[#f0f2f7]" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[rgba(15,23,60,0.12)] bg-white/60 p-12 text-center">
          <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-[#1a52c5]/10 to-[#28c2ce]/10 text-[#1a52c5]">
            <Inbox className="h-7 w-7" />
          </div>
          <h3 className="text-lg font-bold text-[#0a1128]">
            {filter === "unread" ? "No unread notifications" : "No notifications yet"}
          </h3>
          <p className="mx-auto mt-1 max-w-sm text-sm text-[#8c95b0]">
            {filter === "unread"
              ? "All caught up! Check back later for new notifications."
              : "When something happens, we'll let you know here."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {notifications.map((n) => {
            const { icon: Icon, tint } = getIconForType(n.type);
            return (
              <div
                key={n.id}
                className={cn(
                  "group flex items-start gap-4 rounded-2xl border bg-white p-5 shadow-[0_1px_4px_rgba(0,0,0,0.03),0_8px_32px_rgba(0,0,0,0.04)] transition-all",
                  n.read ? "border-[rgba(15,23,60,0.04)]" : "border-[rgba(15,23,60,0.08)] border-l-[3px] border-l-[#1a52c5]"
                )}
              >
                <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl", tint)}>
                  <Icon className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className={cn("text-[15px] font-bold", n.read ? "text-[#4a5578]" : "text-[#0a1128]")}>{n.title}</p>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-[#4a5578]">{n.body}</p>
                  <div className="mt-2 flex items-center gap-3">
                    <span className="text-xs font-medium text-[#8c95b0]">{timeAgo(n.createdAt)}</span>
                    {n.actionUrl && (
                      <button
                        type="button"
                        onClick={() => navigate(n.actionUrl!)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-[#1a52c5] hover:underline"
                      >
                        View <ChevronRight className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                  {!n.read && (
                    <button
                      type="button"
                      onClick={() => handleMarkRead(n.id)}
                      title="Mark as read"
                      className="grid h-7 w-7 place-items-center rounded-lg text-[#8c95b0] hover:bg-[#f0f2f7] hover:text-[#0a1128]"
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDelete(n.id)}
                    title="Delete"
                    className="grid h-7 w-7 place-items-center rounded-lg text-[#8c95b0] hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="h-8 rounded-lg text-xs font-semibold"
              >
                Previous
              </Button>
              <span className="text-sm font-semibold text-[#4a5578]">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="h-8 rounded-lg text-xs font-semibold"
              >
                Next
              </Button>
            </div>
          )}
        </div>
      )}
    </main>
  );
};

export default NotificationsListPage;
