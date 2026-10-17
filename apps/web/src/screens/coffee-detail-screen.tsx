import { AttachmentPanel } from "@/components/attachment-panel"
import { CoffeeSpecCharts } from "@/components/coffee-spec-charts"
import { EntityImage } from "@/components/entity-image"
import {
  BrewHistory,
  CollectionLink,
  NotebookBreadcrumbs,
  NotebookSection,
  RoastHistory,
} from "@/components/notebook"
import { NotebookNotes } from "@/components/notebook-notes"
import { PageHeader } from "@/components/page-header"
import { getCoffee, queryKeys } from "@/lib/api"
import { brewsForCoffee, dateText, linkedNotes, massText } from "@/lib/notebook"
import { useNotebookHistory } from "@/lib/notebook-queries"
import { Button } from "@tan-studio/ui/components/button"
import { Skeleton } from "@tan-studio/ui/components/skeleton"
import { useQuery } from "@tanstack/react-query"
import { Link, useParams } from "@tanstack/react-router"
import { useState } from "react"

export function CoffeeDetailScreen() {
  const { coffeeId } = useParams({ from: "/coffees/$coffeeId" }),
    id = Number(coffeeId)
  const [addingNote, setAddingNote] = useState(false)
  const query = useQuery({
    queryKey: queryKeys.coffee(id),
    queryFn: ({ signal }) => getCoffee(id, signal),
  })
  const history = useNotebookHistory()
  if (query.error) throw query.error
  if (!query.data) return <Skeleton className="h-80" />
  const c = query.data,
    roasts = history.roasts.filter((r) => r.coffee?.id === id),
    brews = brewsForCoffee(history.brews, roasts, id),
    notes = linkedNotes(history.notes, "coffee", id)
  const price =
    c.priceMinor == null
      ? "—"
      : c.currencyCode
        ? new Intl.NumberFormat(undefined, {
            style: "currency",
            currency: c.currencyCode,
          }).format(c.priceMinor / 100)
        : (c.priceMinor / 100).toFixed(2)
  return (
    <div>
      <NotebookBreadcrumbs items={[<CollectionLink type="coffee" />, c.name]} />
      <PageHeader
        eyebrow={`Coffee #${id}`}
        title={c.name}
        description={[c.country, c.region, c.process]
          .filter(Boolean)
          .join(" · ")}
        image={
          <EntityImage
            attachmentId={c.profileImageAttachmentId}
            entityType="coffee"
            alt={c.name}
          />
        }
        actions={
          <Button variant="outline" onClick={() => setAddingNote(true)}>
            Add note
          </Button>
        }
      />
      <div className="flex flex-wrap items-center gap-3 pb-6">
        <Button
          nativeButton={false}
          role="link"
          variant={"outline"}
          render={<Link to="/coffees/$coffeeId/edit" params={{ coffeeId }} />}
        >
          Edit coffee
        </Button>
        <Button
          nativeButton={false}
          role="link"
          variant={"outline"}
          render={
            <Link to="/roast" search={{ coffeeId: id, profileId: undefined }} />
          }
        >
          Prepare a roast
        </Button>
        <a href="#coffee-media" className="notebook-link text-xs">
          Images & files ↓
        </a>
      </div>
      <dl className="notebook-facts">
        {[
          ["Green remaining", massText(c.remainingMassMg)],
          ["Variety", c.variety || "—"],
          ["Harvest", c.harvest || "—"],
          ["Provider", c.provider || "—"],
        ].map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <nav className="notebook-jump-links" aria-label="Coffee sections">
        <a href="#coffee-roasts">Roasts ({roasts.length}) ↓</a>
        <a href="#coffee-brews">Brews ({brews.length}) ↓</a>
        <a href="#coffee-notes">Coffee notes ({notes.length}) ↓</a>
        <a href="#coffee-details">Details ↓</a>
      </nav>
      <NotebookSection
        title="Roast history"
        count={roasts.length}
        id="coffee-roasts"
      >
        {history.isPending ? (
          <p className="notebook-empty" role="status">
            Loading history…
          </p>
        ) : (
          <RoastHistory roasts={roasts} brews={brews} notes={history.notes} />
        )}
      </NotebookSection>
      <NotebookSection
        title="Brews & tasting"
        count={brews.length}
        id="coffee-brews"
      >
        <BrewHistory brews={brews} roasts={roasts} />
      </NotebookSection>
      <div className="notebook-columns">
        <div id="coffee-notes">
          <NotebookNotes
            type="coffee"
            id={id}
            notes={notes}
            title="Coffee notes"
            createOpen={addingNote}
            onCreateOpenChange={setAddingNote}
          />
        </div>
        <NotebookSection title="Coffee details" id="coffee-details">
          <dl className="notebook-details">
            {[
              ["Producer", c.producer],
              ["Farm", c.farm],
              ["Washing station", c.washingStation],
              [
                "Altitude",
                c.altitudeMinM == null && c.altitudeMaxM == null
                  ? "—"
                  : `${c.altitudeMinM?.toLocaleString() ?? "—"}–${c.altitudeMaxM?.toLocaleString() ?? "—"} m`,
              ],
              ["Provider product", c.providerProductId],
              ["Purchase reference", c.purchaseReference],
              ["Purchased", dateText(c.purchasedAt)],
              ["Purchased mass", massText(c.purchasedMassMg)],
              ["Purchase price", price],
              ["Storage", c.storageLocation],
            ].map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v || "—"}</dd>
              </div>
            ))}
            {c.providerUrl ? (
              <div>
                <dt>Store page</dt>
                <dd>
                  <a
                    className="notebook-link"
                    href={c.providerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open ↗
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>
        </NotebookSection>
      </div>
      <CoffeeSpecCharts coffeeName={c.name} metadata={c.metadata} />
      <div id="coffee-media" className="notebook-section">
        <AttachmentPanel
          resourceType="coffee"
          resourceId={id}
          title="Images & files"
        />
      </div>
    </div>
  )
}
