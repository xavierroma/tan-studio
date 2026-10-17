import type { ReactNode } from "react"
type PageHeaderProps = {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
  image?: ReactNode
}
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  image,
}: PageHeaderProps) {
  return (
    <header className="notebook-page-header">
      <div className="notebook-title">
        {image}
        <div>
          {eyebrow ? <p className="notebook-record-id">{eyebrow}</p> : null}
          <h1>{title}</h1>
          {description ? (
            <p className="notebook-subtitle">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="notebook-page-actions">{actions}</div> : null}
    </header>
  )
}
