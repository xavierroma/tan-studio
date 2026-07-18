import { useMutation, useQuery } from "@tanstack/react-query"
import { useSearch } from "@tanstack/react-router"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@tan-studio/ui/components/alert"
import { Badge } from "@tan-studio/ui/components/badge"
import { Button } from "@tan-studio/ui/components/button"
import { Checkbox } from "@tan-studio/ui/components/checkbox"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@tan-studio/ui/components/field"
import { Input } from "@tan-studio/ui/components/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@tan-studio/ui/components/select"
import { toast } from "sonner"
import {
  CheckCircle2Icon,
  FileDownIcon,
  InfoIcon,
  PrinterIcon,
  QrCodeIcon,
  ShieldCheckIcon,
} from "lucide-react"
import { useState } from "react"

import { PageHeader } from "@/components/page-header"
import {
  getSystemCapabilities,
  isDemoResult,
  queryKeys,
  submitPrintJob,
} from "@/lib/api"

export function LabelComposerScreen() {
  const search = useSearch({ strict: false }) as { roastId?: string }
  const [widthMm, setWidthMm] = useState(50)
  const [heightMm, setHeightMm] = useState(30)
  const [copies, setCopies] = useState(1)
  const [showScore, setShowScore] = useState(true)
  const [showOrigin, setShowOrigin] = useState(true)
  const [printerId, setPrinterId] = useState("pdf")
  const capabilities = useQuery({
    queryKey: queryKeys.capabilities(),
    queryFn: getSystemCapabilities,
  })
  const printing = capabilities.data?.data.adapters.printing
  const printingReady =
    isDemoResult(capabilities.data) ||
    (capabilities.data?.data.features.printing === true &&
      printing?.state === "ready")
  const printJob = useMutation({
    mutationFn: submitPrintJob,
    onSuccess: (receipt) => {
      toast.success(
        receipt.source === "companion"
          ? "Print job submitted to the local companion"
          : "Sample print job submitted; no physical printer was contacted"
      )
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "The print job could not be submitted"
      )
    },
  })

  const submit = (artifact: "pdf" | "queue") => {
    if (!printingReady) {
      toast.error("Printing is unavailable; no job was submitted")
      return
    }
    printJob.mutate({
      ...(search.roastId ? { roastId: search.roastId } : {}),
      printerId,
      widthMm,
      heightMm,
      copies,
      artifact,
    })
  }

  return (
    <div className="min-h-screen">
      <PageHeader
        eyebrow="Label design · physical units"
        title="Label composer"
        description="Exact-size preview with deterministic rendering and capability-aware output"
        actions={
          <>
            <Button
              variant="outline"
              disabled={printJob.isPending || !printingReady}
              onClick={() => submit("pdf")}
            >
              <FileDownIcon data-icon="inline-start" />
              Print-ready PDF
            </Button>
            <Button
              disabled={
                printJob.isPending || !printingReady || printerId === "pdf"
              }
              onClick={() => submit("queue")}
            >
              <PrinterIcon data-icon="inline-start" />
              Submit {copies} {copies === 1 ? "copy" : "copies"}
            </Button>
          </>
        }
      />

      <div className="grid gap-6 px-5 py-6 sm:px-7 xl:grid-cols-[20rem_minmax(0,1fr)_20rem]">
        <aside className="min-w-0">
          <section
            className="bg-card rounded-xl border p-5"
            aria-labelledby="label-content-heading"
          >
            <h2 id="label-content-heading" className="font-semibold">
              Content
            </h2>
            <FieldGroup className="mt-5">
              <Field>
                <FieldLabel htmlFor="label-coffee">Coffee name</FieldLabel>
                <Input id="label-coffee" defaultValue="Ethiopia Hamasho" />
              </Field>
              <Field>
                <FieldLabel htmlFor="label-roast-date">Roasted</FieldLabel>
                <Input
                  id="label-roast-date"
                  type="date"
                  defaultValue="2026-07-17"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="label-net">Package net</FieldLabel>
                  <Input id="label-net" type="number" defaultValue={87.4} />
                </Field>
                <Field>
                  <FieldLabel htmlFor="label-load">Green load</FieldLabel>
                  <Input id="label-load" type="number" defaultValue={100} />
                </Field>
              </div>
              <Field orientation="horizontal">
                <Checkbox
                  id="label-origin"
                  checked={showOrigin}
                  onCheckedChange={(checked) => setShowOrigin(checked === true)}
                />
                <FieldLabel htmlFor="label-origin">
                  Origin and process
                </FieldLabel>
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id="label-score"
                  checked={showScore}
                  onCheckedChange={(checked) => setShowScore(checked === true)}
                />
                <FieldLabel htmlFor="label-score">
                  Promoted tasting score
                </FieldLabel>
              </Field>
            </FieldGroup>
          </section>

          <section
            className="bg-card mt-5 rounded-xl border p-5"
            aria-labelledby="label-size-heading"
          >
            <h2 id="label-size-heading" className="font-semibold">
              Physical label
            </h2>
            <FieldGroup className="mt-4">
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="label-width">Width · mm</FieldLabel>
                  <Input
                    id="label-width"
                    type="number"
                    min={20}
                    max={210}
                    value={widthMm}
                    onChange={(event) => setWidthMm(event.target.valueAsNumber)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="label-height">Height · mm</FieldLabel>
                  <Input
                    id="label-height"
                    type="number"
                    min={15}
                    max={297}
                    value={heightMm}
                    onChange={(event) =>
                      setHeightMm(event.target.valueAsNumber)
                    }
                  />
                </Field>
              </div>
              <FieldDescription>
                Layout is stored in micrometres; CSS pixels are preview-only.
              </FieldDescription>
            </FieldGroup>
          </section>
        </aside>

        <main className="min-w-0">
          <section
            className="bg-secondary flex min-h-[38rem] flex-col rounded-xl border p-5"
            aria-labelledby="label-preview-heading"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="label-preview-heading" className="font-semibold">
                  Exact-size preview
                </h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  {widthMm} × {heightMm} mm · 203 DPI reference
                </p>
              </div>
              <Badge variant="success">
                <CheckCircle2Icon data-icon="inline-start" />
                No overflow
              </Badge>
            </div>

            <div className="flex flex-1 items-center justify-center overflow-auto py-10">
              <article
                className="bg-card grid max-w-full grid-cols-[1fr_auto] gap-4 overflow-hidden rounded-sm border p-5 shadow-md"
                style={{
                  width: `${Math.max(280, widthMm * 8)}px`,
                  aspectRatio: `${widthMm} / ${heightMm}`,
                }}
                aria-label="Coffee bag label preview"
              >
                <div className="flex min-w-0 flex-col">
                  <p className="text-muted-foreground text-[0.625rem] font-semibold tracking-[0.18em] uppercase">
                    Tan Studio · Roast 02418
                  </p>
                  <h3 className="mt-2 text-xl leading-tight font-bold tracking-[-0.03em]">
                    Ethiopia Hamasho
                  </h3>
                  {showOrigin ? (
                    <p className="text-muted-foreground mt-1 text-xs">
                      Bensa, Sidama · Washed · 74158
                    </p>
                  ) : null}
                  <div className="mt-auto flex items-end gap-5 pt-4">
                    <div>
                      <p className="text-muted-foreground text-[0.5625rem] font-semibold uppercase">
                        Roasted
                      </p>
                      <p className="mt-1 font-mono text-xs font-semibold">
                        17 JUL 2026
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-[0.5625rem] font-semibold uppercase">
                        Net
                      </p>
                      <p className="mt-1 font-mono text-xs font-semibold">
                        87.4 g
                      </p>
                    </div>
                    {showScore ? (
                      <div>
                        <p className="text-muted-foreground text-[0.5625rem] font-semibold uppercase">
                          Cup
                        </p>
                        <p className="mt-1 font-mono text-xs font-semibold">
                          88.25
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-col items-center justify-center border-l pl-4">
                  <QrCodeIcon className="size-16" strokeWidth={1.3} />
                  <p className="text-muted-foreground mt-2 max-w-20 text-center font-mono text-[0.5rem]">
                    opaque local roast ID
                  </p>
                </div>
              </article>
            </div>
          </section>

          <Alert className="bg-info mt-5">
            <ShieldCheckIcon />
            <AlertTitle>Privacy check</AlertTitle>
            <AlertDescription>
              The QR code contains an opaque roast identifier—not tasting notes,
              a local path, the device serial, or personal information.
            </AlertDescription>
          </Alert>
        </main>

        <aside className="min-w-0">
          <section
            className="bg-card rounded-xl border p-5"
            aria-labelledby="printer-heading"
          >
            <h2 id="printer-heading" className="font-semibold">
              Output
            </h2>
            <FieldGroup className="mt-5">
              <Field>
                <FieldLabel>Printer</FieldLabel>
                <Select
                  value={printerId}
                  onValueChange={(value) => setPrinterId(value ?? "pdf")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pdf">PDF · manual print</SelectItem>
                    <SelectItem value="system" disabled>
                      System queue · none found
                    </SelectItem>
                    <SelectItem value="zebra" disabled>
                      Zebra ZD421 · not connected
                    </SelectItem>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  Capabilities are discovered or explicitly calibrated—never
                  guessed from a manufacturer name.
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="label-copies">Copies</FieldLabel>
                <Input
                  id="label-copies"
                  type="number"
                  min={1}
                  max={99}
                  value={copies}
                  onChange={(event) => setCopies(event.target.valueAsNumber)}
                />
              </Field>
            </FieldGroup>
          </section>

          <Alert className="bg-warning mt-5">
            <InfoIcon />
            <AlertTitle>
              {capabilities.isPending
                ? "Checking printing capability"
                : printingReady
                  ? capabilities.data?.source === "demo"
                    ? "Development-only print simulation"
                    : "Status fidelity"
                  : "Printing unavailable"}
            </AlertTitle>
            <AlertDescription>
              {printingReady
                ? capabilities.data?.source === "demo"
                  ? "A submitted result is simulated and cannot represent a physical print."
                  : "Tan Studio distinguishes submitted, spooled and device-accepted jobs. It will never claim a physical label printed without proof from the adapter."
                : capabilities.isError
                  ? "The local companion could not be reached. No print job can be submitted."
                  : `The printing adapter is not ready${printing?.reason ? ` (${printing.reason})` : ""}. No success state will be fabricated.`}
            </AlertDescription>
          </Alert>

          <section
            className="bg-card mt-5 rounded-xl border p-5"
            aria-labelledby="rendering-heading"
          >
            <h2 id="rendering-heading" className="font-semibold">
              Rendering checks
            </h2>
            <ul className="mt-4 flex flex-col gap-3 text-sm">
              <li className="flex items-center gap-2">
                <CheckCircle2Icon className="text-primary size-4" />
                Margins valid
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2Icon className="text-primary size-4" />
                Text fits
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2Icon className="text-primary size-4" />
                QR quiet zone valid
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2Icon className="text-primary size-4" />
                Bundled font available
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}
