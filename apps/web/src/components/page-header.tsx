import type { ReactNode } from "react"

type PageHeaderProps = {
  eyebrow?: string
  title: string
  description: string
  actions?: ReactNode
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: PageHeaderProps) {
  return (
    <header className="bg-background flex min-h-20 flex-col justify-between gap-4 border-b px-5 py-4 sm:px-7 lg:flex-row lg:items-center lg:py-3">
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-muted-foreground mb-1 text-[0.6875rem] font-semibold tracking-[0.16em] uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="truncate text-xl font-semibold tracking-[-0.02em] sm:text-2xl">
          {title}
        </h1>
        <p className="text-muted-foreground mt-1 max-w-3xl text-sm">
          {description}
        </p>
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  )
}
