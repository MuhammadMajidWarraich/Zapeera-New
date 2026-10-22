import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BedDouble,
  CalendarCheck,
  CalendarClock,
  DoorOpen,
  Receipt,
  Wallet,
  Sparkles,
  Wrench,
  LogIn,
  LogOut,
  Activity,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { apiService } from "@/services/api";
import { withBusinessSlug } from "@/utils/business-routes";
import { useWorkspaceCompany } from "./useWorkspaceCompany";
import {
  DashboardShell,
  DashboardHeader,
  DashboardSkeleton,
  DashboardError,
  StatGrid,
  StatCard,
  Panel,
  ListRow,
  formatCurrency,
  formatDateShort,
  formatTimeShort,
} from "./primitives";

// ─── HOTEL workspace dashboard ───────────────────────────────────────
// A hotel runs on reservations → check-in → folio → checkout, so this
// dashboard shows ONLY that world: occupancy, arrivals/departures,
// in-house guests, open folios and folio money. There are deliberately
// NO product/stock/selling widgets here — the folio engine's internal
// "Room Night" service product is not a product the hotel sells.
const HotelDashboard = () => {
  const navigate = useNavigate();
  const { displayCompany, businessSlug, effectiveCompanyId } = useWorkspaceCompany();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!effectiveCompanyId) return;
    setLoading(true);
    setError(null);
    try {
      const res: any = await (apiService as any).getHotelDashboard();
      if (res?.success && res.data) {
        setData(res.data);
      } else {
        setError(res?.message || "Failed to load hotel dashboard");
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load hotel dashboard");
    } finally {
      setLoading(false);
    }
  }, [effectiveCompanyId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!effectiveCompanyId) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Loading business context…</p>
      </div>
    );
  }
  if (loading && !data) return <DashboardSkeleton />;
  if (error && !data) return <DashboardError message={error} onRetry={load} />;

  const stats = data?.stats || {};
  const roomStatus = data?.roomStatus || { AVAILABLE: 0, OCCUPIED: 0, DIRTY: 0, MAINTENANCE: 0 };
  const arrivals: any[] = data?.arrivals || [];
  const departures: any[] = data?.departuresDue || [];
  const upcoming: any[] = data?.upcoming || [];
  const activity: any[] = data?.recentActivity || [];

  const go = (path: string) => navigate(withBusinessSlug(businessSlug, path));
  const roomMeta = (r: any) =>
    `Room ${r.room?.number || "—"}${r.room?.roomType ? ` · ${r.room.roomType}` : ""} · ${formatDateShort(r.checkInDate)} → ${formatDateShort(r.checkOutDate)}`;

  return (
    <DashboardShell>
      <DashboardHeader
        title={displayCompany ? `${displayCompany.name} Dashboard` : "Hotel Dashboard"}
        subtitle="Front desk overview — occupancy, arrivals, departures and open folios"
      />

      <StatGrid cols={4}>
        <StatCard
          title="Occupancy Tonight"
          value={`${stats.occupiedTonight ?? 0} / ${stats.roomsTotal ?? 0}`}
          sub={`${stats.occupancyPct ?? 0}% of rooms occupied`}
        />
        <StatCard title="Arrivals Today" value={stats.arrivalsToday ?? 0} hint="Guests checking in today" />
        <StatCard
          title="Departures Today"
          value={stats.departuresDueToday ?? 0}
          sub={`${stats.checkedOutToday ?? 0} already checked out`}
        />
        <StatCard
          title="In-House Now"
          value={stats.inHouseStays ?? 0}
          sub={`${stats.guestsInHouse ?? 0} guests staying`}
        />
      </StatGrid>

      <StatGrid cols={3}>
        <StatCard
          title="Open Folios"
          value={stats.openFolios ?? 0}
          sub={`Outstanding ${formatCurrency(stats.outstandingBalance ?? 0)}`}
        />
        <StatCard title="Charges Posted Today" value={formatCurrency(stats.chargesToday ?? 0)} />
        <StatCard title="Payments Received Today" value={formatCurrency(stats.paymentsToday ?? 0)} />
      </StatGrid>

      <div className="zv3-settings-block grid grid-cols-1 gap-[18px] lg:grid-cols-2">
        <Panel
          icon={<LogIn className="h-[19px] w-[19px] text-[#1a52c5]" strokeWidth={2} />}
          title="Arrivals Today"
          actionLabel="Front Desk"
          onAction={() => go("/front-desk")}
          isEmpty={arrivals.length === 0}
          emptyIcon={<CalendarCheck className="h-6 w-6 text-[#8c95b0]" strokeWidth={2} />}
          emptyTitle="No arrivals today"
          emptyText="Guests checking in today will appear here."
        >
          <div className="space-y-2">
            {arrivals.map((r) => (
              <ListRow
                key={r.id}
                title={r.guestName}
                meta={roomMeta(r)}
                badge={
                  <Badge variant="outline" className="shrink-0 border-[rgba(15,23,60,0.08)] text-xs font-semibold">
                    {r.status === "CHECKED_IN" ? "Checked in" : r.status === "COMPLETED" ? "Arrived" : "Expected"}
                  </Badge>
                }
              />
            ))}
          </div>
        </Panel>

        <Panel
          icon={<LogOut className="h-[19px] w-[19px] text-[#1a52c5]" strokeWidth={2} />}
          title="Departures Due Today"
          actionLabel="Folios"
          onAction={() => go("/folios")}
          isEmpty={departures.length === 0}
          emptyIcon={<DoorOpen className="h-6 w-6 text-[#8c95b0]" strokeWidth={2} />}
          emptyTitle="No departures due today"
          emptyText="Guests due to check out today will appear here."
        >
          <div className="space-y-2">
            {departures.map((r) => (
              <ListRow key={r.id} title={r.guestName} meta={roomMeta(r)} tone="amber" />
            ))}
          </div>
        </Panel>
      </div>

      <div className="zv3-settings-block grid grid-cols-1 gap-[18px] lg:grid-cols-2">
        <Panel
          icon={<BedDouble className="h-[19px] w-[19px] text-[#1a52c5]" strokeWidth={2} />}
          title="Room Status"
          actionLabel="Rooms"
          onAction={() => go("/rooms")}
        >
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: "Clean / Available", count: roomStatus.AVAILABLE, icon: <Sparkles className="h-4 w-4 text-green-600" /> },
              { label: "Occupied", count: roomStatus.OCCUPIED, icon: <BedDouble className="h-4 w-4 text-[#1a52c5]" /> },
              { label: "Dirty (to clean)", count: roomStatus.DIRTY, icon: <DoorOpen className="h-4 w-4 text-amber-600" /> },
              { label: "Maintenance", count: roomStatus.MAINTENANCE, icon: <Wrench className="h-4 w-4 text-[#8c95b0]" /> },
            ].map((s) => (
              <div key={s.label} className="rounded-[8px] border border-[rgba(15,23,60,0.08)] bg-black/[0.02] p-3">
                <div className="flex items-center gap-2 text-[13px] font-medium text-[#8c95b0]">
                  {s.icon}
                  {s.label}
                </div>
                <p className="mt-1 text-[22px] font-extrabold leading-none text-[#0a1128]">{s.count}</p>
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          icon={<CalendarClock className="h-[19px] w-[19px] text-[#1a52c5]" strokeWidth={2} />}
          title="Upcoming Reservations"
          actionLabel="Reservations"
          onAction={() => go("/reservations")}
          isEmpty={upcoming.length === 0}
          emptyIcon={<CalendarClock className="h-6 w-6 text-[#8c95b0]" strokeWidth={2} />}
          emptyTitle="No upcoming reservations"
          emptyText="Future bookings will appear here."
        >
          <div className="space-y-2">
            {upcoming.map((r) => (
              <ListRow key={r.id} title={r.guestName} meta={roomMeta(r)} tone="neutral" />
            ))}
          </div>
        </Panel>
      </div>

      <Panel
        icon={<Activity className="h-[19px] w-[19px] text-[#1a52c5]" strokeWidth={2} />}
        title="Recent Folio Activity"
        actionLabel="Folios"
        onAction={() => go("/folios")}
        isEmpty={activity.length === 0}
        emptyIcon={<Receipt className="h-6 w-6 text-[#8c95b0]" strokeWidth={2} />}
        emptyTitle="No folio activity yet"
        emptyText="Charges and payments posted to guest folios will appear here."
      >
        <div className="space-y-2">
          {activity.map((a, i) => (
            <ListRow
              key={i}
              title={a.description}
              meta={`${a.guestName || "Guest"}${a.roomNumber ? ` · Room ${a.roomNumber}` : ""} · ${formatTimeShort(a.at)}`}
              tone={a.kind === "PAYMENT" ? "green" : "neutral"}
              badge={
                <Badge
                  variant="outline"
                  className="shrink-0 border-[rgba(15,23,60,0.08)] text-xs font-semibold"
                >
                  {a.kind === "PAYMENT" ? <Wallet className="mr-1 inline h-3 w-3" /> : <Receipt className="mr-1 inline h-3 w-3" />}
                  {formatCurrency(a.amount)}
                </Badge>
              }
            />
          ))}
        </div>
      </Panel>
    </DashboardShell>
  );
};

export default HotelDashboard;
