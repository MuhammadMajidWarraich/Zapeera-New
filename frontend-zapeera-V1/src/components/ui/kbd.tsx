import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Small <kbd> hint chip shown on buttons and in the shortcuts help table.
 * Keeps its own light chip + dark text so it reads on both light pages
 * and the dark POS header bar.
 */
export function Kbd({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-[5px] border border-black/10 bg-black/[0.05] px-1.5 font-mono text-[10px] font-bold leading-none text-[#4a5578]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
