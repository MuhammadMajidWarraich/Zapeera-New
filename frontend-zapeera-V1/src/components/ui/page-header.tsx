import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * PageHeader — the one page-title pattern for workspace screens.
 *
 * Standardizes what used to be hand-rolled per page (title sizes ranged
 * 20–30px, weights and colors varied): a token-colored title, an optional
 * muted description, and an actions slot that wraps under the title on
 * small screens instead of squeezing it.
 */
interface PageHeaderProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  titleClassName?: string
}

const PageHeader = React.forwardRef<HTMLDivElement, PageHeaderProps>(
  ({ title, description, actions, className, titleClassName, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "flex flex-col justify-between gap-4 sm:flex-row sm:items-start",
        className
      )}
      {...props}
    >
      <div className="min-w-0">
        <h1
          className={cn(
            "text-2xl font-bold leading-tight tracking-tight text-foreground sm:text-[26px]",
            titleClassName
          )}
        >
          {title}
        </h1>
        {description ? (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2.5">{actions}</div>
      ) : null}
    </div>
  )
)
PageHeader.displayName = "PageHeader"

export { PageHeader }
