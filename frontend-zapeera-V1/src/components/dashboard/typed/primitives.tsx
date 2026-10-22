import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Shared primitives for the type-specific workspace dashboards ────
// Visual language copied 1:1 from BusinessDashboard (the zv3 stat cards
// and icon-headed panels on the #f0f2f7 shell) so every business type's
// dashboard looks like the same product — only the CONTENT differs.

export const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-PK", {
    style: "currency",
    currency: "PKR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(amount) || 0);

export const formatDateShort = (value: string | Date | null | undefined) => {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-PK", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

export const formatTimeShort = (value: string | Date | null | undefined) => {
  if (!value) return "";
  return new Date(value).toLocaleTimeString("en-PK", { hour: "numeric", minute: "2-digit" });
};

/** Page shell: same backdrop + paddings as BusinessDashboard. */
export const DashboardShell = ({ children }: { children: ReactNode }) => (
  <div className="relative min-h-full bg-[#f0f2f7]">
    <div
      className="pointer-events-none fixed right-[-100px] top-[-100px] z-0 h-[500px] w-[500px] rounded-full blur-[100px]"
      style={{ background: "rgba(40,194,206,0.06)" }}
    />
    <div
      className="pointer-events-none fixed bottom-[100px] left-[350px] z-0 h-[400px] w-[400px] rounded-full blur-[100px]"
      style={{ background: "rgba(26,82,197,0.04)" }}
    />
    <div className="relative z-[1] space-y-6 px-6 pb-14 pt-9 md:px-11">{children}</div>
  </div>
);

/** Header with company name + live clock, mirroring BusinessDashboard. */
export const DashboardHeader = ({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) => {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="zv3-animate-fadeUp flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-[26px] font-extrabold tracking-[-0.6px] text-[#0a1128]">{title}</h1>
        <p className="mt-1 text-sm text-[#8c95b0]">{subtitle}</p>
      </div>
      <div className="text-left sm:text-right">
        <p className="text-[13px] font-medium text-[#8c95b0]">
          {now.toLocaleDateString("en-PK", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
        </p>
        <p className="mt-0.5 bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] bg-clip-text text-[20px] font-extrabold tracking-tight text-transparent">
          {now.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </p>
      </div>
    </div>
  );
};

/** Stat card — the BusinessDashboard zv3 card, as a reusable primitive. */
export const StatCard = ({
  title,
  value,
  sub,
  hint,
}: {
  title: string;
  value: ReactNode;
  sub?: ReactNode;
  hint?: string;
}) => (
  <div className="border border-[rgba(15,23,60,0.06)] bg-white p-6 shadow-[0_1px_4px_rgba(0,0,0,0.02)]">
    <p className="mb-2 text-[13px] font-medium text-[#8c95b0]">{title}</p>
    <p className="mb-2 break-words text-[28px] font-extrabold leading-none tracking-tight text-[#0a1128]">
      {value}
    </p>
    {sub ? <p className="text-[13px] font-semibold text-[#0a1128]">{sub}</p> : null}
    {hint ? <p className="mt-1 text-xs text-[#8c95b0]">{hint}</p> : null}
  </div>
);

export const StatGrid = ({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 | 4 }) => (
  <div
    className={cn(
      "zv3-settings-block grid grid-cols-1 gap-4 sm:grid-cols-2",
      cols === 3 && "lg:grid-cols-3",
      cols === 4 && "lg:grid-cols-4",
      cols === 2 && "lg:grid-cols-2"
    )}
  >
    {children}
  </div>
);

/** Panel with icon header, optional "view all" action, empty state. */
export const Panel = ({
  icon,
  title,
  actionLabel,
  onAction,
  isEmpty,
  emptyIcon,
  emptyTitle,
  emptyText,
  children,
}: {
  icon: ReactNode;
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  isEmpty?: boolean;
  emptyIcon?: ReactNode;
  emptyTitle?: string;
  emptyText?: string;
  children?: ReactNode;
}) => (
  <div className="overflow-hidden border border-[rgba(15,23,60,0.06)] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.02)]">
    <div className="flex items-center justify-between px-7 pt-4 pb-0">
      <div className="flex items-center gap-2.5 text-base font-bold tracking-tight text-[#0a1128]">
        {icon}
        {title}
      </div>
      {actionLabel && onAction ? (
        <Button
          type="button"
          variant="outline"
          className="h-9 rounded-[10px] border-[#1a52c5]/20 px-3 text-xs font-semibold text-[#1a52c5] hover:bg-[#1a52c5]/10"
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      ) : null}
    </div>
    <div className="px-7 pt-4 pb-8">
      {isEmpty ? (
        <div className="flex flex-col items-center px-5 py-8 text-center">
          <div className="mb-3.5 grid h-[52px] w-[52px] place-items-center rounded-[14px] bg-[#1a52c5]/10">
            {emptyIcon}
          </div>
          <h4 className="mb-1 text-sm font-bold text-[#0a1128]">{emptyTitle}</h4>
          {emptyText ? <p className="max-w-[300px] text-[13px] text-[#8c95b0]">{emptyText}</p> : null}
        </div>
      ) : (
        children
      )}
    </div>
  </div>
);

/** One list row inside a panel (green-tinted entry, like Recent Sales). */
export const ListRow = ({
  title,
  meta,
  badge,
  tone = "green",
}: {
  title: ReactNode;
  meta?: ReactNode;
  badge?: ReactNode;
  tone?: "green" | "amber" | "neutral";
}) => (
  <div
    className={cn(
      "rounded-[8px] border p-2.5 transition-colors",
      tone === "green" && "border-green-600/15 bg-green-600/[0.06] hover:bg-green-600/[0.08]",
      tone === "amber" && "border-amber-500/20 bg-amber-500/[0.06] hover:bg-amber-500/[0.08]",
      tone === "neutral" && "border-[rgba(15,23,60,0.08)] bg-black/[0.02] hover:bg-black/[0.04]"
    )}
  >
    <div className="flex items-center justify-between gap-2">
      <p className="min-w-0 truncate text-sm font-semibold text-[#0a1128]">{title}</p>
      {badge}
    </div>
    {meta ? <div className="mt-1 text-xs text-[#8c95b0]">{meta}</div> : null}
  </div>
);

export const DashboardSkeleton = () => (
  <DashboardShell>
    <div className="animate-pulse space-y-6">
      <div className="h-14 w-2/3 rounded bg-white/70" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[110px] rounded bg-white/70" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-[18px] lg:grid-cols-2">
        <div className="h-[260px] rounded bg-white/70" />
        <div className="h-[260px] rounded bg-white/70" />
      </div>
    </div>
  </DashboardShell>
);

export const DashboardError = ({ message, onRetry }: { message: string; onRetry: () => void }) => (
  <DashboardShell>
    <div className="flex flex-col items-center px-5 py-16 text-center">
      <h4 className="mb-1 text-base font-bold text-red-600">{message}</h4>
      <p className="mb-4 text-[13px] text-[#8c95b0]">The dashboard data could not be loaded.</p>
      <Button
        onClick={onRetry}
        className="rounded-[10px] bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white"
      >
        Retry
      </Button>
    </div>
  </DashboardShell>
);
