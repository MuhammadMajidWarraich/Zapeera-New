import React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface DateRangeFilterProps {
  startDate: string;
  endDate: string;
  onStartDateChange: (date: string) => void;
  onEndDateChange: (date: string) => void;
  onClear: () => void;
  className?: string;
}

const dateInputClass = cn(
  "h-11 w-full max-w-[200px] min-w-[10.5rem] rounded-[10px] border-[1.5px] border-black/[0.08] bg-[#f0f2f7] px-3 text-sm font-medium text-[#0a1128] shadow-none",
  "transition-colors [color-scheme:light]",
  "focus-visible:border-[#1a52c5] focus-visible:bg-white focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[rgba(26,82,197,0.08)]",
);

const DateRangeFilter: React.FC<DateRangeFilterProps> = ({
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  onClear,
  className = "",
}) => {
  const hasActiveFilter = Boolean(startDate || endDate);

  const rangeSummary =
    startDate && endDate
      ? `${new Date(startDate).toLocaleDateString()} — ${new Date(endDate).toLocaleDateString()}`
      : startDate
        ? `From ${new Date(startDate).toLocaleDateString()}`
        : endDate
          ? `Until ${new Date(endDate).toLocaleDateString()}`
          : "";

  return (
    <Card
      className={cn(
        "overflow-hidden p-0 shadow-none",
        className?.trim()
          ? className
          : "rounded-[22px] border border-[rgba(15,23,60,0.06)] bg-white",
      )}
    >
      <div className="h-full px-5 py-5 sm:px-6 sm:py-5">
        <div className="flex h-full flex-col gap-5">
          <div className="flex flex-wrap items-center justify-end gap-3">
            {hasActiveFilter ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onClear}
                className="h-9 shrink-0 gap-1.5 rounded-[10px] border border-[rgba(15,23,60,0.08)] px-3 text-xs font-semibold text-[#4a5578] hover:bg-[#f0f2f7] hover:text-[#0a1128]"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2} />
                Clear dates
              </Button>
            ) : null}
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="flex w-full max-w-[200px] flex-col gap-2">
              <Label htmlFor="startDate" className="text-xs font-semibold text-[#8c95b0]">
                Start date
              </Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => onStartDateChange(e.target.value)}
                className={dateInputClass}
              />
            </div>

            <div
              className="hidden h-11 shrink-0 items-center pb-0.5 text-sm font-medium text-[#c5cad8] sm:flex"
              aria-hidden
            >
              →
            </div>

            <div className="flex w-full max-w-[200px] flex-col gap-2">
              <Label htmlFor="endDate" className="text-xs font-semibold text-[#8c95b0]">
                End date
              </Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => onEndDateChange(e.target.value)}
                className={dateInputClass}
              />
            </div>
          </div>

          {hasActiveFilter ? (
            <div className="flex items-start gap-2.5 rounded-[12px] border border-[rgba(26,82,197,0.12)] bg-[rgba(26,82,197,0.04)] px-3.5 py-2.5">
              <Calendar className="mt-0.5 h-4 w-4 shrink-0 text-[#1a52c5]" strokeWidth={2} />
              <p className="text-[13px] leading-snug text-[#4a5578]">
                <span className="font-semibold text-[#0a1128]">Active: </span>
                {rangeSummary}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
};

export default DateRangeFilter;
