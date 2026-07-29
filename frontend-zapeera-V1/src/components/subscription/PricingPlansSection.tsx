import { CheckCircle2, Edit, Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PricingPlan } from "@/lib/pricing-plans";

interface PricingPlansSectionProps {
  title: string;
  description: string;
  plans: PricingPlan[];
  currentPlanId?: string | null;
  billingCycle?: "monthly" | "annually";
  onBillingCycleChange?: (cycle: "monthly" | "annually") => void;
  annualDiscountPercent?: number;
  primaryActionLabel?: string;
  onPrimaryAction?: (plan: PricingPlan) => void;
  selectedPlanId?: string | null;
  manageMode?: boolean;
  onAddPlan?: () => void;
  onEditPlan?: (plan: PricingPlan) => void;
  onDeletePlan?: (plan: PricingPlan) => void;
}

const PricingPlansSection = ({
  title,
  description,
  plans,
  currentPlanId,
  billingCycle = "monthly",
  onBillingCycleChange,
  annualDiscountPercent = 20,
  primaryActionLabel,
  onPrimaryAction,
  selectedPlanId,
  manageMode = false,
  onAddPlan,
  onEditPlan,
  onDeletePlan,
}: PricingPlansSectionProps) => {
  const appliedAnnualDiscount = Math.max(0, Math.min(100, Math.floor(annualDiscountPercent)));
  const discountMultiplier = billingCycle === "annually" ? (100 - appliedAnnualDiscount) / 100 : 1;
  const annualMultiplier = billingCycle === "annually" ? 12 : 1;

  return (
    <div className="space-y-8">
      <div className="flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
        <div>
          <h2 className="mb-2 text-2xl font-bold text-slate-900 md:text-3xl">{title}</h2>
          <p className="text-sm text-slate-500">{description}</p>
        </div>
        <div className="flex w-full flex-col items-stretch gap-3 sm:w-auto sm:flex-row sm:items-center">
          <div className="flex items-center rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => onBillingCycleChange?.("monthly")}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                billingCycle === "monthly"
                  ? "bg-white text-slate-900 shadow-sm"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => onBillingCycleChange?.("annually")}
              className={`flex items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium shadow-sm ${
                billingCycle === "annually"
                  ? "bg-white text-slate-900"
                  : "text-slate-500 hover:text-slate-900"
              }`}
            >
              Annually
              <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-green-700">
                Save {appliedAnnualDiscount}%
              </span>
            </button>
          </div>
          {manageMode && onAddPlan && (
            <Button
              onClick={() => onAddPlan()}
              className="bg-[#1565C0] text-white shadow-md shadow-blue-500/20 transition-colors hover:bg-blue-700"
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Plan
            </Button>
          )}
        </div>
      </div>



      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => {
          const highlighted = Boolean(plan.badge);
          const isSelected = selectedPlanId === plan.id;
          const isCurrent = Boolean(currentPlanId) && currentPlanId === plan.id;
          const displayedPrice = Math.max(0, Math.floor(plan.price * annualMultiplier * discountMultiplier));
          const displayedPriceUnit = billingCycle === "annually" ? "per year" : plan.priceUnit;

          return (
            <div
              key={plan.id}
              className={`relative flex h-full flex-col rounded-xl bg-white p-6 shadow-sm ${
                highlighted
                  ? "border-2 border-[#1565C0] shadow-lg md:-translate-y-2"
                  : "border border-slate-200"
              } ${isSelected ? "ring-2 ring-blue-200 ring-offset-2" : ""}`}
            >
              {isCurrent && (
                <div className="absolute right-4 top-4 rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-800">
                  Current Plan
                </div>
              )}
              {plan.badge && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#1565C0] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm">
                  {plan.badge}
                </div>
              )}

              <div className={`mb-4 ${plan.badge ? "mt-2" : ""}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">{plan.name}</h3>
                    {plan.subtitle && <p className="mt-1 text-xs text-slate-500">{plan.subtitle}</p>}
                  </div>
                  {!plan.badge && manageMode && <Badge className="bg-slate-100 text-slate-600">Plan</Badge>}
                </div>
              </div>

              <div className="mb-6">
                <div className="flex flex-wrap items-baseline">
                  <span className="mr-1 text-lg font-semibold text-slate-500">Rs</span>
                  <span className={`font-bold text-slate-900 ${highlighted ? "text-4xl" : "text-3xl"}`}>
                    {displayedPrice.toLocaleString()}
                  </span>
                  <div className="mt-1 w-full text-xs text-slate-500">{displayedPriceUnit}</div>
                </div>
              </div>

              <ul className={`mb-8 flex-grow space-y-3 text-sm ${highlighted ? "font-medium" : ""} text-slate-600`}>
                {plan.features.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-500" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              {onPrimaryAction && (
                <button
                  type="button"
                  className={
                    highlighted
                      ? "w-full rounded-lg bg-[#1565C0] px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-500/20 transition-colors hover:bg-blue-700"
                      : "w-full rounded-lg border border-[#1565C0] px-4 py-2.5 text-sm font-semibold text-[#1565C0] transition-colors hover:bg-blue-50"
                  }
                  onClick={() => onPrimaryAction(plan)}
                >
                  {primaryActionLabel || plan.ctaLabel}
                </button>
              )}

              {manageMode && (
                <div className="mt-3 flex items-center gap-2">
                  {onEditPlan && (
                    <Button
                      type="button"
                      onClick={() => onEditPlan(plan)}
                      className="flex-1 bg-[#1565C0] text-white hover:bg-blue-700"
                    >
                      <Edit className="mr-2 h-4 w-4" />
                      Edit
                    </Button>
                  )}
                  {onDeletePlan && (
                    <Button
                      type="button"
                      onClick={() => onDeletePlan(plan)}
                      className="flex-1 bg-red-600 text-white hover:bg-red-700"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PricingPlansSection;
