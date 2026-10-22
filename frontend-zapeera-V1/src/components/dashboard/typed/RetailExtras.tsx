import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Shapes, ClipboardCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { apiService } from "@/services/api";
import { withBusinessSlug } from "@/utils/business-routes";
import { useWorkspaceCompany } from "./useWorkspaceCompany";
import { Panel, ListRow, formatCurrency, formatDateShort } from "./primitives";

// ─── RETAIL extras ───────────────────────────────────────────────────
// Rendered UNDER the sales core (BusinessDashboard) for retail stores:
// the variant-level and stock-take figures the product widgets cannot
// express (top variants come from SaleItem variant snapshots; the last
// stock take carries its frozen variance). Renders nothing if the
// typed endpoint declines.
const RetailExtras = () => {
  const navigate = useNavigate();
  const { businessSlug, effectiveCompanyId } = useWorkspaceCompany();
  const [data, setData] = useState<any>(null);

  const load = useCallback(async () => {
    if (!effectiveCompanyId) return;
    try {
      const res: any = await (apiService as any).getRetailDashboard();
      if (res?.success && res.data) setData(res.data);
    } catch {
      // Extras are additive — never break the core dashboard.
    }
  }, [effectiveCompanyId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data) return null;

  const variants: any[] = data.topVariants || [];
  const last = data.stockTakes?.last || null;
  const openCount = data.stockTakes?.openCount || 0;
  const go = (path: string) => navigate(withBusinessSlug(businessSlug, path));

  return (
    <div className="relative bg-[#f0f2f7]">
      <div className="relative z-[1] space-y-6 px-6 pb-14 md:px-11">
        <div className="zv3-settings-block grid grid-cols-1 gap-[18px] lg:grid-cols-2">
          <Panel
            icon={<Shapes className="h-[19px] w-[19px] text-[#1a52c5]" strokeWidth={2} />}
            title="Top Selling Variants"
            actionLabel="Inventory"
            onAction={() => go("/inventory")}
            isEmpty={variants.length === 0}
            emptyIcon={<Shapes className="h-6 w-6 text-[#8c95b0]" strokeWidth={2} />}
            emptyTitle="No variant sales yet"
            emptyText="When products with variants (size, colour…) sell, the best movers will appear here."
          >
            <div className="space-y-2">
              {variants.map((v) => (
                <ListRow
                  key={v.variantId}
                  title={`${v.productName} — ${v.variantName}`}
                  meta={`Revenue: ${formatCurrency(v.revenue)}`}
                  badge={
                    <Badge variant="outline" className="shrink-0 border-green-600/20 bg-green-600/10 text-xs font-semibold text-green-800">
                      {v.unitsSold} sold
                    </Badge>
                  }
                />
              ))}
            </div>
          </Panel>

          <Panel
            icon={<ClipboardCheck className="h-[19px] w-[19px] text-[#1a52c5]" strokeWidth={2} />}
            title="Stock Takes"
            actionLabel="Stock Takes"
            onAction={() => go("/stock-takes")}
            isEmpty={!last}
            emptyIcon={<ClipboardCheck className="h-6 w-6 text-[#8c95b0]" strokeWidth={2} />}
            emptyTitle="No stock takes yet"
            emptyText="Stock counts and their variances will appear here."
          >
            {/* JSX children evaluate eagerly — the null guard must live
                here, not only in the Panel's isEmpty switch. */}
            {last ? (
            <div className="space-y-2">
              <ListRow
                title={`Last stock take — ${last.branchName || "Branch"}`}
                meta={`${formatDateShort(last.startedAt)} · ${last.linesCount} lines counted`}
                tone={last.varianceLines > 0 ? "amber" : "green"}
                badge={
                  <Badge variant="outline" className="shrink-0 border-[rgba(15,23,60,0.08)] text-xs font-semibold">
                    {last.status}
                  </Badge>
                }
              />
              <p className="px-1 text-[13px] text-[#8c95b0]">
                {last.varianceLines > 0
                  ? `${last.varianceLines} line${last.varianceLines === 1 ? "" : "s"} with variance (${last.totalVarianceUnits > 0 ? "+" : ""}${last.totalVarianceUnits} units net).`
                  : "No variance on the counted lines."}
                {openCount > 0 ? ` ${openCount} stock take${openCount === 1 ? "" : "s"} currently open.` : ""}
              </p>
            </div>
            ) : null}
          </Panel>
        </div>
      </div>
    </div>
  );
};

export default RetailExtras;
