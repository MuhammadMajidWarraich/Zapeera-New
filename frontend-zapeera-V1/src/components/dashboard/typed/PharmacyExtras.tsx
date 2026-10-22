import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Pill, CalendarClock, ClipboardList, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { apiService } from "@/services/api";
import { withBusinessSlug } from "@/utils/business-routes";
import { useWorkspaceCompany } from "./useWorkspaceCompany";
import { Panel, ListRow, formatDateShort } from "./primitives";

// ─── PHARMACY extras ─────────────────────────────────────────────────
// Rendered UNDER the proven sales core (BusinessDashboard) for pharmacy
// businesses only: the pharmacy-specific figures the generic widgets
// don't carry — today's prescriptions, batches expiring soon (the core
// dashboard shows only already-expired ones) and reorder suggestions.
// If the typed endpoint declines (e.g. modules off), renders nothing.
const PharmacyExtras = () => {
  const navigate = useNavigate();
  const { businessSlug, effectiveCompanyId } = useWorkspaceCompany();
  const [data, setData] = useState<any>(null);

  const load = useCallback(async () => {
    if (!effectiveCompanyId) return;
    try {
      const res: any = await (apiService as any).getPharmacyDashboard();
      if (res?.success && res.data) setData(res.data);
    } catch {
      // Extras are additive — never break the core dashboard.
    }
  }, [effectiveCompanyId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) return null;

  const stats = data.stats || {};
  const prescriptions: any[] = data.recentPrescriptions || [];
  const expiring: any[] = data.expiringSoon || [];
  const reorder: any[] = data.reorderSuggestions || [];
  const go = (path: string) => navigate(withBusinessSlug(businessSlug, path));

  return (
    <div className="relative bg-[#f0f2f7]">
      <div className="relative z-[1] space-y-6 px-6 pb-14 md:px-11">
        <div className="zv3-settings-block grid grid-cols-1 gap-[18px] lg:grid-cols-3">
          <div className="border border-[rgba(15,23,60,0.06)] bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.02)]">
            <p className="mb-2 text-[13px] font-medium text-[#8c95b0]">Prescriptions Today</p>
            <p className="mb-2 text-[28px] font-extrabold leading-none tracking-tight text-[#0a1128]">
              {stats.prescriptionsToday ?? 0}
            </p>
            <p className="text-[13px] font-semibold text-[#0a1128]">
              {stats.prescriptionsAwaiting ?? 0} awaiting dispensing
            </p>
          </div>
          <div className="border border-[rgba(15,23,60,0.06)] bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.02)]">
            <p className="mb-2 text-[13px] font-medium text-[#8c95b0]">Batches Expiring Soon (30 days)</p>
            <p className="mb-2 text-[28px] font-extrabold leading-none tracking-tight text-[#0a1128]">
              {stats.expiringSoonCount ?? 0}
            </p>
            <p className="text-[13px] font-semibold text-[#0a1128]">
              {stats.expiredCount ?? 0} already expired
            </p>
          </div>
          <div className="border border-[rgba(15,23,60,0.06)] bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.02)]">
            <p className="mb-2 text-[13px] font-medium text-[#8c95b0]">Reorder Suggestions</p>
            <p className="mb-2 text-[28px] font-extrabold leading-none tracking-tight text-[#0a1128]">
              {stats.reorderCount ?? 0}
            </p>
            <p className="text-[13px] font-semibold text-[#0a1128]">Medicines at or below their reorder level</p>
          </div>
        </div>

        <div className="zv3-settings-block grid grid-cols-1 gap-[18px] lg:grid-cols-2">
          <Panel
            icon={<FileText className="h-[19px] w-[19px] text-[#1a52c5]" strokeWidth={2} />}
            title="Recent Prescriptions"
            actionLabel="Prescriptions"
            onAction={() => go("/prescriptions")}
            isEmpty={prescriptions.length === 0}
            emptyIcon={<Pill className="h-6 w-6 text-[#8c95b0]" strokeWidth={2} />}
            emptyTitle="No prescriptions registered yet"
            emptyText="Prescriptions recorded at the counter will appear here."
          >
            <div className="space-y-2">
              {prescriptions.map((p) => (
                <ListRow
                  key={p.id}
                  title={p.patientName}
                  meta={`${p.doctorName ? `Dr. ${p.doctorName} · ` : ""}${p.itemsCount} item${p.itemsCount === 1 ? "" : "s"} · ${formatDateShort(p.createdAt)}`}
                  tone="neutral"
                />
              ))}
            </div>
          </Panel>

          <Panel
            icon={<CalendarClock className="h-[19px] w-[19px] text-amber-600" strokeWidth={2} />}
            title="Expiring Soon — Nearest First"
            actionLabel="Inventory"
            onAction={() => go("/inventory")}
            isEmpty={expiring.length === 0}
            emptyIcon={<CalendarClock className="h-6 w-6 text-green-600" strokeWidth={2} />}
            emptyTitle="Nothing expiring in the next 30 days"
            emptyText="Batches nearing their expiry date will appear here."
          >
            <div className="space-y-2">
              {expiring.map((b) => (
                <ListRow
                  key={b.id}
                  title={b.productName}
                  meta={`Batch ${b.batchNo || "—"} · ${b.quantity} units in stock`}
                  tone="amber"
                  badge={
                    <Badge variant="outline" className="shrink-0 border-amber-500/25 bg-amber-500/10 text-xs font-semibold text-amber-800">
                      {b.daysToExpiry !== null && b.daysToExpiry !== undefined
                        ? `${b.daysToExpiry}d · ${formatDateShort(b.expireDate)}`
                        : formatDateShort(b.expireDate)}
                    </Badge>
                  }
                />
              ))}
            </div>
          </Panel>
        </div>

        <Panel
          icon={<ClipboardList className="h-[19px] w-[19px] text-[#1a52c5]" strokeWidth={2} />}
          title="Reorder Suggestions"
          actionLabel="Reorder Suggestions"
          onAction={() => go("/reorder-suggestions")}
          isEmpty={reorder.length === 0}
          emptyIcon={<ClipboardList className="h-6 w-6 text-green-600" strokeWidth={2} />}
          emptyTitle="No reorder suggestions"
          emptyText="Medicines that reach their reorder level will appear here with a suggested quantity."
        >
          <div className="space-y-2">
            {reorder.map((r) => (
              <ListRow
                key={r.id}
                title={r.name}
                meta={`In stock ${r.currentStock} · reorder level ${r.reorderLevel}`}
                tone="neutral"
                badge={
                  <Badge variant="outline" className="shrink-0 border-[rgba(15,23,60,0.08)] text-xs font-semibold">
                    Suggest {r.suggestedQty}
                  </Badge>
                }
              />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
};

export default PharmacyExtras;
