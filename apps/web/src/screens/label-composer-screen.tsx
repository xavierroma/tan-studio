import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@tan-studio/ui/components/collapsible"
import {
  CollectionLink,
  NotebookBreadcrumbs,
  NotebookSection,
  ResourceLink,
} from "@/components/notebook"
import { PageHeader } from "@/components/page-header"
import {
  createLabel,
  getCoffee,
  getRoast,
  listLabels,
  queryKeys,
} from "@/lib/api"
import { buildLabel, type LabelCopy } from "@/lib/labels/artwork"
import {
  proDownload,
  proExportArtwork,
  proPdf,
  type PrintInput,
} from "@/lib/labels/export"
import { useNotebookHistory } from "@/lib/notebook-queries"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@tan-studio/ui/components/alert"
import { Badge } from "@tan-studio/ui/components/badge"
import { Button } from "@tan-studio/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@tan-studio/ui/components/dialog"
import { Field, FieldGroup, FieldLabel } from "@tan-studio/ui/components/field"
import { Input } from "@tan-studio/ui/components/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tan-studio/ui/components/select"
import { Skeleton } from "@tan-studio/ui/components/skeleton"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { toast } from "sonner"

export function LabelComposerScreen() {
  const search = useSearch({ from: "/labels" }),
    navigate = useNavigate({ from: "/labels" }),
    cache = useQueryClient(),
    history = useNotebookHistory()
  const roast = useQuery({
    queryKey: queryKeys.roast(search.roastId ?? 0),
    queryFn: ({ signal }) => getRoast(search.roastId!, signal),
    enabled: search.roastId != null,
  })
  const coffeeId = roast.data?.coffee?.id
  const coffee = useQuery({
    queryKey: queryKeys.coffee(coffeeId ?? 0),
    queryFn: ({ signal }) => getCoffee(coffeeId!, signal),
    enabled: coffeeId != null,
  })
  const labels = useQuery({
    queryKey: queryKeys.labels(search.roastId),
    queryFn: ({ signal }) => listLabels(search.roastId, signal),
    enabled: search.roastId != null,
  })
  const [copy, setCopy] = useState<Record<number, Partial<LabelCopy>>>({})
  const [format, setFormat] = useState("50x80"),
    [note, setNote] = useState<Record<number, string>>({}),
    [grams, setGrams] = useState<Record<number, string>>({}),
    [copies, setCopies] = useState(1),
    [guide, setGuide] = useState(false),
    [exporting, setExporting] = useState(false)
  const width = 50,
    height = format === "50x80" ? 80 : 30,
    paper = height === 80 ? "dual-white" : "white"
  const sourceNote = history.notes
    .filter(
      (n) =>
        n.kind === "tasting" &&
        n.links.some(
          (l) => l.resourceType === "roast" && l.resourceId === search.roastId
        )
    )
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const source = useMemo<LabelCopy | null>(() => {
    const r = roast.data,
      c = coffee.data
    if (!r || (r.coffee && !c)) return null
    return {
      roastId: r.id,
      coffee: c?.name || r.coffee?.name || "Not recorded",
      country: c?.country || "Not recorded",
      region: c?.region || "",
      altitude:
        c?.altitudeMinM != null && c.altitudeMaxM != null
          ? `${c.altitudeMinM.toLocaleString("en-US")}–${c.altitudeMaxM.toLocaleString("en-US")} m`
          : "—",
      variety: c?.variety || "—",
      process: c?.process || "—",
      profile: r.profile?.name || "—",
      level:
        r.levelThousandths == null ? "" : String(r.levelThousandths / 1000),
      tasting: note[r.id] ?? sourceNote?.body ?? "—",
      grams:
        grams[r.id] ??
        (r.roastedYieldMassMg == null
          ? "—"
          : String(r.roastedYieldMassMg / 1000)),
      ...copy[r.id],
      date: r.roastedAt
        ? new Intl.DateTimeFormat("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          }).format(new Date(r.roastedAt))
        : "—",
    }
  }, [roast.data, coffee.data, note, grams, sourceNote, copy])
  const artwork = useMemo(() => {
    if (!source) return null
    try {
      const main = buildLabel(source, "field", width, height, "front", paper),
        companion = main.small
          ? buildLabel(source, "field", width, height, "details", paper)
          : undefined
      return {
        ...main,
        widthMicrometers: width * 1000,
        heightMicrometers: height * 1000,
        companionSvg: companion?.svg,
        warnings: [...main.warnings, ...(companion?.warnings ?? [])],
      }
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) }
    }
  }, [source, height, paper])
  const printable: PrintInput | null =
    artwork && !("error" in artwork) ? artwork : null
  const save = useMutation({
    mutationFn: createLabel,
    onSuccess: (label) => {
      void cache.invalidateQueries({
        queryKey: queryKeys.labels(search.roastId),
      })
      toast.success(`Label #${label.id} generated`)
    },
    onError: (e) => toast.error(e.message),
  })
  const download = async (kind: "svg" | "png" | "pdf", side = "front") => {
    if (!printable || !source) return
    setExporting(true)
    try {
      if (printable.warnings.length)
        throw Error("Shorten the highlighted copy before export.")
      const name = `Tan-B21-Pro-Roast-${source.roastId}-${width}x${height}-${side}`
      if (kind === "svg") {
        proDownload(
          side === "details" ? printable.companionSvg! : printable.svg,
          "image/svg+xml",
          `${name}.svg`
        )
      } else {
        const raster = await proExportArtwork(printable, side)
        proDownload(
          kind === "pdf" ? await proPdf(raster) : raster.png,
          kind === "pdf" ? "application/pdf" : "image/png",
          `${name}.${kind}`
        )
      }
      toast.success(`${kind.toUpperCase()} exported`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setExporting(false)
    }
  }
  if (roast.error) throw roast.error
  if (coffee.error) throw coffee.error
  return (
    <div>
      <NotebookBreadcrumbs
        items={[<CollectionLink type="roast" />, "Jar label"]}
      />
      <PageHeader
        title="Jar label"
        description={`NIIMBOT B21 Pro · 300dpi · ${height === 80 ? "red + black" : "black"} on white`}
        actions={
          search.roastId ? (
            <Button
              nativeButton={false}
              role="link"
              variant="outline"
              render={
                <Link
                  to="/roasts/$roastId"
                  params={{ roastId: String(search.roastId) }}
                />
              }
            >
              Back to roast
            </Button>
          ) : null
        }
      />
      <div className="notebook-label-layout">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!source || !printable || printable.warnings.length) return
            save.mutate({
              roastId: source.roastId,
              widthMicrometers: printable.widthMicrometers,
              heightMicrometers: printable.heightMicrometers,
              copies,
              printer: "NIIMBOT B21 Pro",
              content: {
                schemaVersion: 2,
                layout: "field",
                paper,
                dpi: 300,
                ...source,
                svg: printable.svg,
                companionSvg: printable.companionSvg ?? null,
              },
            })
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="label-roast">Roast</FieldLabel>
              <Select
                value={search.roastId ? String(search.roastId) : null}
                items={history.roasts.map((r) => ({
                  value: String(r.id),
                  label: `#${r.id} · ${r.coffee?.name ?? "Coffee —"}`,
                }))}
                onValueChange={(v) =>
                  v && void navigate({ search: { roastId: Number(v) } })
                }
              >
                <SelectTrigger id="label-roast">
                  <SelectValue placeholder="Choose a roast" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {history.roasts.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        #{r.id} · {r.coffee?.name ?? "Coffee —"}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="label-format">Paper</FieldLabel>
              <Select
                value={format}
                onValueChange={(v) => v && setFormat(v)}
                items={[
                  { value: "50x80", label: "50 × 80 mm · red/black white" },
                  {
                    value: "50x30",
                    label: "50 × 30 mm · black · front + details",
                  },
                ]}
              >
                <SelectTrigger id="label-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="50x80">
                      50 × 80 mm · red/black white
                    </SelectItem>
                    <SelectItem value="50x30">
                      50 × 30 mm · black · front + details
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            {source ? (
              <>
                <Collapsible>
                  <CollapsibleTrigger
                    render={<Button variant="outline" type="button" />}
                  >
                    Edit label copy
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-4">
                    <FieldGroup>
                      {(
                        [
                          "coffee",
                          "country",
                          "region",
                          "altitude",
                          "variety",
                          "process",
                          "profile",
                          "level",
                        ] as const
                      ).map((key) => (
                        <Field key={key}>
                          <FieldLabel htmlFor={`label-copy-${key}`}>
                            {
                              {
                                coffee: "Coffee",
                                country: "Country",
                                region: "Region",
                                altitude: "Altitude",
                                variety: "Variety",
                                process: "Process",
                                profile: "Profile",
                                level: "Level",
                              }[key]
                            }
                          </FieldLabel>
                          <Input
                            id={`label-copy-${key}`}
                            value={source[key]}
                            onChange={(e) =>
                              setCopy((s) => ({
                                ...s,
                                [source.roastId]: {
                                  ...s[source.roastId],
                                  [key]: e.target.value,
                                },
                              }))
                            }
                          />
                        </Field>
                      ))}
                    </FieldGroup>
                  </CollapsibleContent>
                </Collapsible>
                <Field>
                  <FieldLabel htmlFor="label-tasting">
                    Concise tasting note
                  </FieldLabel>
                  <Input
                    id="label-tasting"
                    value={source.tasting}
                    maxLength={240}
                    onChange={(e) =>
                      setNote((s) => ({
                        ...s,
                        [source.roastId]: e.target.value,
                      }))
                    }
                  />
                  {sourceNote ? (
                    <span className="text-muted-foreground text-xs">
                      Note #{sourceNote.id}
                    </span>
                  ) : null}
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field>
                    <FieldLabel htmlFor="label-grams">Total · g</FieldLabel>
                    <Input
                      id="label-grams"
                      type="number"
                      min="0"
                      step="0.1"
                      value={source.grams === "—" ? "" : source.grams}
                      onChange={(e) =>
                        setGrams((s) => ({
                          ...s,
                          [source.roastId]: e.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="label-copies">Copies</FieldLabel>
                    <Input
                      id="label-copies"
                      type="number"
                      min="1"
                      max="100"
                      required
                      value={copies}
                      onChange={(e) => setCopies(Number(e.target.value))}
                    />
                  </Field>
                </div>
              </>
            ) : null}
            <Button
              type="submit"
              disabled={
                !printable || !!printable.warnings.length || save.isPending
              }
            >
              Generate label
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setGuide(true)}
            >
              How to print
            </Button>
          </FieldGroup>
        </form>
        <div>
          <NotebookSection
            title="Print preview"
            actions={
              <Badge variant="secondary">
                {labels.data?.length ?? 0} generated
              </Badge>
            }
          >
            {artwork && "error" in artwork ? (
              <Alert variant="destructive">
                <AlertTitle>Check label copy</AlertTitle>
                <AlertDescription>{artwork.error}</AlertDescription>
              </Alert>
            ) : null}
            {printable ? (
              <>
                <div className="notebook-label-preview">
                  <img
                    src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(printable.svg)}`}
                    alt={`Roast ${source?.roastId} label`}
                    width={295}
                    height={height * 5.9}
                  />
                  {printable.companionSvg ? (
                    <img
                      src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(printable.companionSvg)}`}
                      alt="Companion details label"
                      width={295}
                      height={177}
                    />
                  ) : null}
                </div>
                {printable.warnings.length ? (
                  <Alert variant="destructive">
                    <AlertTitle>Shorten label copy</AlertTitle>
                    <AlertDescription>
                      {printable.warnings.map((w, i) => (
                        <p key={i}>{w}</p>
                      ))}
                    </AlertDescription>
                  </Alert>
                ) : null}
                {["front", ...(printable.companionSvg ? ["details"] : [])].map(
                  (side) => (
                    <div className="flex flex-wrap gap-2 py-3" key={side}>
                      {(["pdf", "png", "svg"] as const).map((kind) => (
                        <Button
                          key={kind}
                          type="button"
                          variant="outline"
                          disabled={exporting || !!printable.warnings.length}
                          onClick={() => void download(kind, side)}
                        >
                          {kind.toUpperCase()}
                          {side === "details" ? " · details" : ""}
                        </Button>
                      ))}
                    </div>
                  )
                )}
              </>
            ) : search.roastId ? (
              <Skeleton className="h-96" />
            ) : (
              <p className="notebook-empty">Choose a roast.</p>
            )}
          </NotebookSection>
          {source ? (
            <NotebookSection title="Label values">
              <dl className="notebook-details">
                {Object.entries(source).map(([key, value]) => (
                  <div key={key}>
                    <dt>
                      {(
                        {
                          roastId: "Roast",
                          coffee: "Coffee",
                          country: "Country",
                          region: "Region",
                          altitude: "Altitude",
                          variety: "Variety",
                          process: "Process",
                          profile: "Profile",
                          level: "Level",
                          tasting: "Tasting",
                          grams: "Total · g",
                          date: "Roasted",
                        } as Record<string, string>
                      )[key] ?? key}
                    </dt>
                    <dd>
                      {key === "roastId" ? (
                        <ResourceLink type="roast" id={Number(value)} />
                      ) : (
                        value || "—"
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </NotebookSection>
          ) : null}
        </div>
      </div>
      <Dialog open={guide} onOpenChange={setGuide}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Print with B21 Pro</DialogTitle>
          </DialogHeader>
          <ol className="list-decimal space-y-3 pl-5 text-sm">
            <li>
              Export PDF at {width} × {height} mm.
            </li>
            <li>
              Open NIIMBOT and connect B21 Pro with the matching roll loaded.
            </li>
            <li>
              Import at actual size. Disable crop and fit-to-page. Check that
              the preview preserves red; image import can convert it to black.
            </li>
            <li>
              Print one proof and check color, edges and feed direction before
              printing copies.
            </li>
          </ol>
          <p className="text-muted-foreground text-xs">
            Exports are ready; the printer connection and physical output are
            untested.
          </p>
          <a
            href="https://www.niimbot.com/au/downloadCenter"
            target="_blank"
            rel="noopener noreferrer"
            className="notebook-link text-sm"
          >
            NIIMBOT apps ↗
          </a>
        </DialogContent>
      </Dialog>
    </div>
  )
}
