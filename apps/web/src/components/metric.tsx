import type { ReactNode } from "react"

type MetricProps = {
  label: string
  value: ReactNode
  detail?: ReactNode
  emphasis?: boolean
}

export function Metric({
  label,
  value,
  detail,
  emphasis = false,
}: MetricProps) {
  return (
    <div className="min-w-0">
      <p className="text-muted-foreground text-[0.6875rem] font-semibold tracking-[0.12em] uppercase">
        {label}
      </p>
      <p
        className={
          emphasis
            ? "text-primary mt-1 font-mono text-3xl font-semibold tracking-[-0.04em] tabular-nums"
            : "mt-1 font-mono text-xl font-semibold tracking-[-0.03em] tabular-nums"
        }
      >
        {value}
      </p>
      {detail ? (
        <p className="text-muted-foreground mt-1 text-xs">{detail}</p>
      ) : null}
    </div>
  )
}
