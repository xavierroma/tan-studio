import { EntityImage } from "@/components/entity-image"
import type { Brew, Note, RoastSummary } from "@/lib/api"
import {
  brewListSearch,
  coffeeListSearch,
  dateText,
  latestTasting,
  levelText,
  massText,
  roastListSearch,
  roastNotes,
} from "@/lib/notebook"
import { Badge } from "@tan-studio/ui/components/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@tan-studio/ui/components/breadcrumb"
import { Button } from "@tan-studio/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@tan-studio/ui/components/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
} from "@tan-studio/ui/components/empty"
import {
  Item,
  ItemContent,
  ItemFooter,
  ItemHeader,
} from "@tan-studio/ui/components/item"
import { Separator } from "@tan-studio/ui/components/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@tan-studio/ui/components/table"
import { Link, useRouter } from "@tanstack/react-router"
import { Fragment, isValidElement, type ReactNode } from "react"

export function ResourceLink({
  type,
  id,
  children,
  className,
}: {
  type: string
  id: number
  children?: ReactNode
  className?: string
}) {
  const props = {
    className: className ?? "notebook-link",
    children: children ?? `${type} #${id}`,
  }
  switch (type) {
    case "coffee":
      return (
        <Link
          to="/coffees/$coffeeId"
          params={{ coffeeId: String(id) }}
          {...props}
        />
      )
    case "roast":
      return (
        <Link
          to="/roasts/$roastId"
          params={{ roastId: String(id) }}
          {...props}
        />
      )
    case "brew":
      return (
        <Link to="/brews/$brewId" params={{ brewId: String(id) }} {...props} />
      )
    case "profile":
      return (
        <Link
          to="/profiles"
          search={{ profileId: id, compare: undefined }}
          {...props}
        />
      )
    default:
      return <span>{children ?? `${type} #${id}`}</span>
  }
}
export function NotebookBreadcrumbs({ items }: { items: ReactNode[] }) {
  const router = useRouter()
  return (
    <div className="notebook-breadcrumbs">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          if (window.history.length > 1) router.history.back()
          else
            void router.navigate({ to: "/coffees", search: coffeeListSearch })
        }}
      >
        ← Back
      </Button>
      <Separator orientation="vertical" />
      <Breadcrumb>
        <BreadcrumbList>
          {items.map((item, i) => (
            <Fragment key={i}>
              {i > 0 ? <BreadcrumbSeparator>/</BreadcrumbSeparator> : null}
              <BreadcrumbItem>
                {i === items.length - 1 ? (
                  <BreadcrumbPage>{item}</BreadcrumbPage>
                ) : isValidElement(item) ? (
                  <BreadcrumbLink render={item} />
                ) : (
                  item
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  )
}
export function CollectionLink({
  type,
}: {
  type: "coffee" | "roast" | "brew" | "profile"
}) {
  if (type === "coffee")
    return (
      <Link to="/coffees" search={coffeeListSearch}>
        Coffees
      </Link>
    )
  if (type === "roast")
    return (
      <Link to="/roasts" search={roastListSearch}>
        Roasts
      </Link>
    )
  if (type === "brew")
    return (
      <Link to="/brews" search={brewListSearch}>
        Brews
      </Link>
    )
  return (
    <Link to="/profiles" search={{ profileId: undefined, compare: undefined }}>
      Profiles
    </Link>
  )
}
export function NotebookSection({
  title,
  count,
  actions,
  children,
  id,
  className = "",
}: {
  title: string
  count?: number
  actions?: ReactNode
  children: ReactNode
  id?: string
  className?: string
}) {
  return (
    <Card id={id} className={`notebook-section ${className}`}>
      <CardHeader className="notebook-section-head">
        <CardTitle>
          <h2>
            {title}
            {count != null ? <Badge variant="secondary">{count}</Badge> : null}
          </h2>
        </CardTitle>
        {actions ? <CardAction>{actions}</CardAction> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}
export function NoteLinks({ note }: { note: Note }) {
  return (
    <div className="notebook-note-links">
      {note.links.map((l) => (
        <ResourceLink
          key={`${l.resourceType}:${l.resourceId}`}
          type={l.resourceType}
          id={l.resourceId}
        />
      ))}
    </div>
  )
}
export function NoteBody({
  note,
  actions,
}: {
  note: Note
  actions?: ReactNode
}) {
  return (
    <Item className="notebook-note">
      <ItemContent>
        <ItemHeader className="notebook-note-meta">
          <span>
            {note.kind === "tasting" ? "Tasting note" : "Notebook note"} ·{" "}
            {dateText(note.createdAt)}
          </span>
          {note.ratingBasisPoints != null ? (
            <strong>{note.ratingBasisPoints / 100} / 100</strong>
          ) : null}
        </ItemHeader>
        <p>{note.body}</p>
        <ItemFooter className="notebook-note-bottom">
          <NoteLinks note={note} />
          {actions}
        </ItemFooter>
      </ItemContent>
    </Item>
  )
}
export function BrewHistory({
  brews,
  roasts,
  showCoffee = false,
}: {
  brews: Brew[]
  roasts: RoastSummary[]
  showCoffee?: boolean
}) {
  if (!brews.length)
    return (
      <Empty className="notebook-empty">
        <EmptyHeader>
          <EmptyDescription>No brews recorded.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  return (
    <div className="notebook-history-wrap">
      <Table className="notebook-history">
        <TableHeader>
          <TableRow>
            <TableHead>Brew</TableHead>
            <TableHead>{showCoffee ? "Coffee · roast" : "Roast"}</TableHead>
            <TableHead>Recipe</TableHead>
            <TableHead>Tasting notes</TableHead>
            <TableHead>Score</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {brews.map((b) => {
            const r = roasts.find((r) => r.id === b.roastId),
              n = latestTasting(b)
            return (
              <TableRow key={b.id}>
                <TableCell data-label="Brew">
                  <div className="notebook-row-image">
                    <EntityImage
                      attachmentId={b.profileImageAttachmentId}
                      entityType="brew"
                    />
                    <div>
                      <ResourceLink type="brew" id={b.id}>
                        #{b.id} · {b.method}
                      </ResourceLink>
                      <small>{dateText(b.brewedAt)}</small>
                    </div>
                  </div>
                </TableCell>
                <TableCell data-label={showCoffee ? "Coffee · roast" : "Roast"}>
                  {showCoffee && r?.coffee ? (
                    <>
                      <ResourceLink type="coffee" id={r.coffee.id}>
                        {r.coffee.name}
                      </ResourceLink>
                      <br />
                    </>
                  ) : null}
                  <ResourceLink type="roast" id={b.roastId}>
                    #{b.roastId}
                  </ResourceLink>
                  {r?.roastedAt ? (
                    <small>
                      {Math.floor(
                        (new Date(b.brewedAt).getTime() -
                          new Date(r.roastedAt).getTime()) /
                          86400000
                      )}{" "}
                      days rest
                    </small>
                  ) : null}
                </TableCell>
                <TableCell data-label="Recipe">
                  {massText(b.coffeeMassMg)} / {massText(b.waterMassMg)} water
                  <small>
                    {b.waterTemperatureMilliC == null
                      ? "Temperature —"
                      : `${b.waterTemperatureMilliC / 1000}°C`}{" "}
                    · {b.grinderSetting}
                  </small>
                </TableCell>
                <TableCell data-label="Tasting notes">
                  {n ? (
                    <p className="notebook-excerpt">{n.body}</p>
                  ) : (
                    "No tasting note."
                  )}
                </TableCell>
                <TableCell data-label="Score">
                  {n?.ratingBasisPoints == null
                    ? "—"
                    : `${n.ratingBasisPoints / 100} / 100`}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
export function RoastHistory({
  roasts,
  brews,
  notes,
  showCoffee = false,
}: {
  roasts: RoastSummary[]
  brews: Brew[]
  notes: Note[]
  showCoffee?: boolean
}) {
  if (!roasts.length)
    return (
      <Empty className="notebook-empty">
        <EmptyHeader>
          <EmptyDescription>No roasts recorded.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  return (
    <div className="notebook-history-wrap">
      <Table className="notebook-history roast-history">
        <TableHeader>
          <TableRow>
            <TableHead>Roast</TableHead>
            <TableHead>
              {showCoffee ? "Coffee · profile" : "Profile & level"}
            </TableHead>
            <TableHead>Batch</TableHead>
            <TableHead>Roast note</TableHead>
            <TableHead>Brews & tasting</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {roasts.map((r) => {
            const bs = brews.filter((b) => b.roastId === r.id),
              ns = roastNotes(notes, r.id)
            return (
              <TableRow key={r.id}>
                <TableCell data-label="Roast">
                  <div className="notebook-row-image">
                    <EntityImage
                      attachmentId={r.profileImageAttachmentId}
                      entityType="roast"
                    />
                    <div>
                      <ResourceLink type="roast" id={r.id}>
                        #{r.id}
                      </ResourceLink>
                      <small>
                        {dateText(r.roastedAt)}
                        {r.archivedAt ? " · archived" : ""}
                      </small>
                    </div>
                  </div>
                </TableCell>
                <TableCell data-label="Profile & level">
                  {showCoffee && r.coffee ? (
                    <>
                      <ResourceLink type="coffee" id={r.coffee.id}>
                        {r.coffee.name}
                      </ResourceLink>
                      <br />
                    </>
                  ) : null}
                  {r.profile ? (
                    <ResourceLink type="profile" id={r.profile.id}>
                      {r.profile.name}
                    </ResourceLink>
                  ) : (
                    "Profile —"
                  )}
                  <small>Level {levelText(r.levelThousandths)}</small>
                </TableCell>
                <TableCell data-label="Batch">
                  {massText(r.greenInputMassMg)} →{" "}
                  {massText(r.roastedYieldMassMg)}
                  <small>
                    {r.greenInputMassMg && r.roastedYieldMassMg != null
                      ? `${(100 * (1 - r.roastedYieldMassMg / r.greenInputMassMg)).toFixed(1)}% loss`
                      : r.status}
                  </small>
                </TableCell>
                <TableCell data-label="Roast note">
                  {ns.length
                    ? ns.map((n) => (
                        <p className="notebook-excerpt" key={n.id}>
                          {n.body}
                        </p>
                      ))
                    : "No note."}
                </TableCell>
                <TableCell data-label="Brews & tasting">
                  {bs.length
                    ? bs.map((b) => (
                        <div className="notebook-brew-excerpt" key={b.id}>
                          <ResourceLink type="brew" id={b.id}>
                            #{b.id} · {b.method}
                          </ResourceLink>
                          <p>{latestTasting(b)?.body ?? "No tasting note."}</p>
                        </div>
                      ))
                    : "No brews."}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
