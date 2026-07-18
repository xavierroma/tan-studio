import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Badge } from "@tan-studio/ui/components/badge"
import { Button } from "@tan-studio/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@tan-studio/ui/components/field"
import { Input } from "@tan-studio/ui/components/input"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@tan-studio/ui/components/sheet"
import { toast } from "sonner"
import {
  ArrowUpRightIcon,
  BoxesIcon,
  PackagePlusIcon,
  SearchIcon,
  SproutIcon,
  TrendingUpIcon,
} from "lucide-react"
import { useMemo, useState } from "react"

import { Metric } from "@/components/metric"
import { PageHeader } from "@/components/page-header"
import { listCoffeeLots, queryKeys } from "@/lib/api"
import { formatMass, formatScore } from "@/lib/format"

export function CoffeeCatalogScreen() {
  const { data } = useQuery({
    queryKey: queryKeys.coffeeLots(),
    queryFn: listCoffeeLots,
  })
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState("lot-hamasho")
  const [sheetOpen, setSheetOpen] = useState(false)
  const [coffeeName, setCoffeeName] = useState("")
  const [providerName, setProviderName] = useState("")
  const lots = data?.data ?? []
  const visibleLots = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    if (!query) return lots
    return lots.filter((lot) =>
      [
        lot.coffeeName,
        lot.providerName,
        lot.country,
        lot.region,
        lot.farm,
        lot.process,
        lot.lotCode,
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query)
    )
  }, [lots, search])
  const selected = lots.find((lot) => lot.id === selectedId) ?? lots[0]
  const totalOnHand = lots.reduce((total, lot) => total + lot.onHandKg, 0)

  return (
    <div className="min-h-screen">
      <PageHeader
        title="Green coffee catalog"
        description="Provider → purchase → coffee lot · inventory, roast history and tasting feedback in one lineage"
        actions={
          <Button onClick={() => setSheetOpen(true)}>
            <PackagePlusIcon data-icon="inline-start" />
            Add purchase
          </Button>
        }
      />

      <div className="px-5 py-6 sm:px-7">
        <section
          className="grid gap-4 sm:grid-cols-3"
          aria-label="Green coffee inventory summary"
        >
          <div className="bg-card rounded-xl border p-5">
            <Metric
              label="Active lots"
              value={lots.length}
              detail="Across 4 providers"
            />
          </div>
          <div className="bg-card rounded-xl border p-5">
            <Metric
              label="Green on hand"
              value={formatMass(totalOnHand)}
              detail="Estimated from roast allocations"
            />
          </div>
          <div className="bg-card rounded-xl border p-5">
            <Metric
              label="Learning coverage"
              value="88%"
              detail="Lots with a tasting-derived next action"
            />
          </div>
        </section>

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1fr)_23rem]">
          <section
            className="bg-card min-w-0 overflow-hidden rounded-xl border"
            aria-labelledby="coffee-lots-heading"
          >
            <div className="flex flex-col gap-4 border-b p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 id="coffee-lots-heading" className="font-semibold">
                  Coffee lots
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  Physical green lots with procurement and storage context
                </p>
              </div>
              <label className="relative block sm:w-80">
                <span className="sr-only">Search coffee lots</span>
                <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="bg-background pl-9"
                  placeholder="Search coffee, origin, provider…"
                />
              </label>
            </div>

            <div className="overflow-x-auto">
              <div className="min-w-[860px]">
                <div className="bg-muted text-muted-foreground grid grid-cols-[minmax(190px,1.3fr)_145px_170px_110px_100px_90px] gap-4 border-b px-5 py-3 text-[0.6875rem] font-semibold tracking-[0.08em] uppercase">
                  <span>Coffee · lot</span>
                  <span>Provider</span>
                  <span>Origin · process</span>
                  <span>On hand</span>
                  <span>Roasts</span>
                  <span>Best</span>
                </div>
                <div className="divide-y">
                  {visibleLots.map((lot) => (
                    <button
                      key={lot.id}
                      type="button"
                      onClick={() => setSelectedId(lot.id)}
                      aria-pressed={selected?.id === lot.id}
                      className="hover:bg-secondary/40 aria-pressed:bg-accent/30 grid w-full grid-cols-[minmax(190px,1.3fr)_145px_170px_110px_100px_90px] items-center gap-4 px-5 py-4 text-left text-sm transition-colors"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold">
                          {lot.coffeeName}
                        </span>
                        <span className="text-muted-foreground mt-1 block truncate text-xs">
                          Lot {lot.lotCode} · {lot.harvest}
                        </span>
                      </span>
                      <span className="truncate text-xs">
                        {lot.providerName}
                      </span>
                      <span className="min-w-0 text-xs">
                        <span className="block truncate font-medium">
                          {lot.country} · {lot.region}
                        </span>
                        <span className="text-muted-foreground block truncate">
                          {lot.process}
                        </span>
                      </span>
                      <span className="font-mono font-medium tabular-nums">
                        {formatMass(lot.onHandKg)}
                      </span>
                      <span className="font-mono tabular-nums">
                        {lot.roastCount}
                      </span>
                      <span className="text-primary font-mono text-lg font-semibold tabular-nums">
                        {formatScore(lot.bestScore)}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {selected ? (
            <aside className="min-w-0">
              <section
                className="bg-card rounded-xl border p-5"
                aria-labelledby="selected-lot-heading"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="bg-success flex size-10 items-center justify-center rounded-full">
                    <SproutIcon className="size-5" />
                  </span>
                  <Badge variant="success">Active lot</Badge>
                </div>
                <h2
                  id="selected-lot-heading"
                  className="mt-4 text-lg font-semibold"
                >
                  {selected.coffeeName}
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  {selected.farm} · {selected.region}, {selected.country}
                </p>

                <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 border-t pt-5 text-sm">
                  <div>
                    <dt className="text-muted-foreground text-xs">Provider</dt>
                    <dd className="mt-1 font-medium">
                      {selected.providerName}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Purchase</dt>
                    <dd className="mt-1 font-mono text-xs">
                      {selected.providerReference}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Variety</dt>
                    <dd className="mt-1 font-medium">{selected.variety}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Altitude</dt>
                    <dd className="mt-1 font-medium">{selected.altitude}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Received</dt>
                    <dd className="mt-1 font-mono">
                      {formatMass(selected.receivedKg)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">On hand</dt>
                    <dd className="mt-1 font-mono">
                      {formatMass(selected.onHandKg)}
                    </dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-muted-foreground text-xs">Storage</dt>
                    <dd className="mt-1 font-medium">{selected.storage}</dd>
                  </div>
                </dl>

                <Button
                  nativeButton={false}
                  className="mt-5 w-full"
                  render={
                    <Link to="/preflight" search={{ lotId: selected.id }} />
                  }
                >
                  Plan next roast
                  <ArrowUpRightIcon data-icon="inline-end" />
                </Button>
                <Button
                  nativeButton={false}
                  variant="outline"
                  className="mt-2 w-full"
                  render={
                    <Link
                      to="/coffees/$lotId"
                      params={{ lotId: selected.id }}
                    />
                  }
                >
                  Open lot notebook
                </Button>
              </section>

              <section
                className="bg-success mt-5 rounded-xl border p-5"
                aria-labelledby="lot-learning-heading"
              >
                <TrendingUpIcon className="text-primary size-5" />
                <h2 id="lot-learning-heading" className="mt-3 font-semibold">
                  Next-roast conclusion
                </h2>
                <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                  {selected.nextAction}
                </p>
                <Button
                  nativeButton={false}
                  variant="outline"
                  className="bg-card mt-4 w-full"
                  render={<Link to="/compare" />}
                >
                  View lot history
                </Button>
              </section>
            </aside>
          ) : null}
        </div>
      </div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Add a green coffee purchase</SheetTitle>
            <SheetDescription>
              Record the provider and coffee identity first. Purchase lines can
              then allocate physical lots and inventory.
            </SheetDescription>
          </SheetHeader>
          <FieldGroup className="overflow-y-auto px-4">
            <Field>
              <FieldLabel htmlFor="new-provider">Provider</FieldLabel>
              <Input
                id="new-provider"
                value={providerName}
                onChange={(event) => setProviderName(event.target.value)}
                placeholder="Provider name"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="new-coffee">Coffee</FieldLabel>
              <Input
                id="new-coffee"
                value={coffeeName}
                onChange={(event) => setCoffeeName(event.target.value)}
                placeholder="Coffee display name"
              />
              <FieldDescription>
                Use the name you expect to search for when planning future
                roasts.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="new-reference">
                Supplier reference
              </FieldLabel>
              <Input
                id="new-reference"
                placeholder="Invoice or order reference"
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="new-mass">Received mass</FieldLabel>
                <Input id="new-mass" type="number" placeholder="5.00 kg" />
              </Field>
              <Field>
                <FieldLabel htmlFor="new-cost">Cost per kg</FieldLabel>
                <Input id="new-cost" type="number" placeholder="Optional" />
              </Field>
            </div>
          </FieldGroup>
          <SheetFooter>
            <Button
              disabled={!providerName.trim() || !coffeeName.trim()}
              onClick={() => {
                toast.success("Purchase draft added to the local catalog")
                setSheetOpen(false)
                setCoffeeName("")
                setProviderName("")
              }}
            >
              <BoxesIcon data-icon="inline-start" />
              Add purchase draft
            </Button>
            <Button variant="outline" onClick={() => setSheetOpen(false)}>
              Cancel
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}
