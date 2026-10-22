import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays,
  Hourglass,
  Stethoscope,
  UserPlus,
  Wallet,
  ClipboardList,
  CheckCircle,
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
} from "./primitives";

// ─── CLINIC workspace dashboard ──────────────────────────────────────
// A clinic runs on the OPD day: appointments, the token queue, visits
// completed and doctor-share money. This dashboard shows exactly that —
// no product/stock/selling widgets (consultation fees are service
// lines on visit invoices, not products on a shelf).
const ClinicDashboard = () => {
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
      const res: any = await (apiService as any).getClinicDashboard();
      if (res?.success && res.data) {
        setData(res.data);
      } else {
        setError(res?.message || "Failed to load clinic dashboard");
      }
    } catch (e: any) {
      setError(e?.message || "Failed to load clinic dashboard");
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
  const next: any[] = data?.nextAppointments || [];
  const go = (path: string) => navigate(withBusinessSlug(businessSlug, path));

  const statusLabel = (s: string) =>
    s === "CHECKED_IN" ? "Waiting" : s === "IN_VISIT" ? "In consultation" : s === "BOOKED" ? "Booked" : s;

  return (
    <DashboardShell>
      <DashboardHeader
        title={displayCompany ? `${displayCompany.name} Dashboard` : "Clinic Dashboard"}
        subtitle="OPD overview — today's appointments, the token queue and visit revenue"
      />

      <StatGrid cols={4}>
        <StatCard title="Appointments Today" value={stats.appointmentsToday ?? 0} hint="Scheduled for today" />
        <StatCard
          title="OPD Queue Now"
          value={(stats.waitingNow ?? 0) + (stats.inConsultationNow ?? 0)}
          sub={`${stats.waitingNow ?? 0} waiting · ${stats.inConsultationNow ?? 0} in consultation`}
        />
        <StatCard title="Visits Completed Today" value={stats.completedVisitsToday ?? 0} />
        <StatCard title="Patients Registered Today" value={stats.patientsRegisteredToday ?? 0} />
      </StatGrid>

      <StatGrid cols={2}>
        <StatCard title="Consultation Revenue Today" value={formatCurrency(stats.visitRevenueToday ?? 0)} />
        <StatCard
          title="Doctor Share Outstanding"
          value={formatCurrency(stats.doctorShareOutstanding ?? 0)}
          hint="Share earned on completed visits, not yet settled"
        />
      </StatGrid>

      <Panel
        icon={<ClipboardList className="h-[19px] w-[19px] text-[#1a52c5]" strokeWidth={2} />}
        title="Up Next — OPD Queue & Appointments"
        actionLabel="Appointments"
        onAction={() => go("/appointments")}
        isEmpty={next.length === 0}
        emptyIcon={<CalendarDays className="h-6 w-6 text-[#8c95b0]" strokeWidth={2} />}
        emptyTitle="No upcoming appointments"
        emptyText="Booked appointments and the live token queue will appear here."
      >
        <div className="space-y-2">
          {next.map((a) => (
            <ListRow
              key={a.id}
              title={`${a.patient?.name || "Patient"} · Token ${a.tokenNumber}`}
              meta={`${a.doctor?.name || "Doctor"}${a.doctor?.specialization ? ` (${a.doctor.specialization})` : ""} · ${formatDateShort(a.appointmentDate)}${a.reason ? ` · ${a.reason}` : ""}`}
              tone={a.status === "IN_VISIT" ? "amber" : "neutral"}
              badge={
                <Badge variant="outline" className="shrink-0 border-[rgba(15,23,60,0.08)] text-xs font-semibold">
                  {a.status === "IN_VISIT" ? (
                    <Stethoscope className="mr-1 inline h-3 w-3" />
                  ) : a.status === "CHECKED_IN" ? (
                    <Hourglass className="mr-1 inline h-3 w-3" />
                  ) : (
                    <CheckCircle className="mr-1 inline h-3 w-3" />
                  )}
                  {statusLabel(a.status)}
                </Badge>
              }
            />
          ))}
        </div>
      </Panel>
    </DashboardShell>
  );
};

export default ClinicDashboard;
