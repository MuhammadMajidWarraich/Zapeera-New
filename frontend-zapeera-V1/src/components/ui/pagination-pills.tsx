import * as React from "react";
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react";

import { cn } from "@/lib/utils";

type PaginationItem = number | "ellipsis";

function range(start: number, end: number): number[] {
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}

function getPaginationItems(
  page: number,
  totalPages: number,
  siblingCount: number,
  boundaryCount: number
): PaginationItem[] {
  if (totalPages <= 0) return [];
  if (totalPages === 1) return [1];

  const startPages = range(1, Math.min(boundaryCount, totalPages));
  const endPages = range(
    Math.max(totalPages - boundaryCount + 1, boundaryCount + 1),
    totalPages
  );

  const siblingsStart = Math.max(
    Math.min(
      page - siblingCount,
      totalPages - boundaryCount - siblingCount * 2 - 1
    ),
    boundaryCount + 2
  );
  const siblingsEnd = Math.min(
    Math.max(page + siblingCount, boundaryCount + siblingCount * 2 + 2),
    endPages.length > 0 ? endPages[0] - 2 : totalPages - 1
  );

  const items: PaginationItem[] = [];
  items.push(...startPages);

  if (siblingsStart > boundaryCount + 2) {
    items.push("ellipsis");
  } else if (boundaryCount + 1 < totalPages - boundaryCount) {
    items.push(boundaryCount + 1);
  }

  items.push(...range(siblingsStart, siblingsEnd));

  if (siblingsEnd < totalPages - boundaryCount - 1) {
    items.push("ellipsis");
  } else if (totalPages - boundaryCount > boundaryCount) {
    items.push(totalPages - boundaryCount);
  }

  items.push(...endPages);

  // De-dupe while preserving order
  const seen = new Set<string>();
  return items.filter((it) => {
    const key = String(it);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type PaginationPillsProps = {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
  siblingCount?: number;
  boundaryCount?: number;
  disabled?: boolean;
  /** Matches zapeera-branch-management table footer (flat buttons + gradient active). */
  variant?: "default" | "v3";
};

export function PaginationPills({
  page,
  totalPages,
  onPageChange,
  className,
  siblingCount = 1,
  boundaryCount = 1,
  disabled = false,
  variant = "default",
}: PaginationPillsProps) {
  const safeTotal = Math.max(1, totalPages || 1);
  const safePage = Math.min(Math.max(1, page || 1), safeTotal);

  const items = React.useMemo(
    () => getPaginationItems(safePage, safeTotal, siblingCount, boundaryCount),
    [safePage, safeTotal, siblingCount, boundaryCount]
  );

  // Always show pagination, even if only 1 page
  const go = (p: number) => {
    if (disabled) return;
    const next = Math.min(Math.max(1, p), safeTotal);
    if (next === safePage) return;
    onPageChange(next);
  };

  const isV3 = variant === "v3";

  const baseBtn = isV3
    ? "h-9 w-9 rounded-[10px] border border-[rgba(15,23,60,0.06)] bg-transparent text-sm font-semibold text-[#8c95b0] transition-colors hover:bg-[#f0f2f7] hover:text-[#0a1128]"
    : "h-10 w-10 rounded-full border text-sm font-semibold transition-all duration-200";
  const inactive = isV3
    ? ""
    : "border-blue-100 bg-white text-[#0C2C8A] hover:bg-blue-50 hover:border-blue-200";
  const active = isV3
    ? "border-transparent bg-gradient-to-br from-[#1a52c5] to-[#28c2ce] text-white shadow-[0_3px_12px_rgba(26,82,197,0.2)] hover:text-white hover:opacity-95"
    : "border-[#0C2C8A] bg-[#0C2C8A] text-white shadow-md hover:bg-[#0a2470] hover:border-[#0a2470]";
  const disabledCls = isV3
    ? "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-[#8c95b0]"
    : "cursor-not-allowed opacity-40 hover:bg-white";

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        isV3
          ? "flex w-full items-center justify-center gap-1.5 border-t border-[rgba(15,23,60,0.06)] px-8 py-5"
          : "mx-auto mt-6 flex w-fit items-center gap-2 rounded-full bg-white px-4 py-2 shadow-xl",
        className
      )}
    >
      <button
        type="button"
        aria-label="Previous page"
        onClick={() => go(safePage - 1)}
        disabled={disabled || safePage <= 1}
        className={cn(
          baseBtn,
          !isV3 && inactive,
          (disabled || safePage <= 1) && disabledCls
        )}
      >
        <ChevronLeft className={cn("mx-auto", isV3 ? "h-4 w-4" : "h-5 w-5")} />
      </button>

      {items.map((it, idx) => {
        if (it === "ellipsis") {
          return (
            <span
              key={`e-${idx}`}
              className={cn(
                "flex items-center justify-center",
                isV3 ? "h-9 w-9 text-[#8c95b0]/70" : "h-10 w-10 text-[#0C2C8A]/60"
              )}
              aria-hidden
            >
              <MoreHorizontal className={isV3 ? "h-4 w-4" : "h-5 w-5"} />
            </span>
          );
        }

        const isActive = it === safePage;
        return (
          <button
            key={it}
            type="button"
            aria-current={isActive ? "page" : undefined}
            onClick={() => go(it)}
            disabled={disabled}
            className={cn(
              baseBtn,
              isActive ? active : !isV3 && inactive,
              disabled && disabledCls
            )}
          >
            {it}
          </button>
        );
      })}

      <button
        type="button"
        aria-label="Next page"
        onClick={() => go(safePage + 1)}
        disabled={disabled || safePage >= safeTotal}
        className={cn(
          baseBtn,
          !isV3 && inactive,
          (disabled || safePage >= safeTotal) && disabledCls
        )}
      >
        <ChevronRight className={cn("mx-auto", isV3 ? "h-4 w-4" : "h-5 w-5")} />
      </button>
    </nav>
  );
}

