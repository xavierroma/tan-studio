import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link, useSearch } from "@tanstack/react-router"
import {
  renderLabelToSvg,
  type LabelDocument,
} from "@tan-studio/printing-adapters"
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@tan-studio/ui/components/alert"
import { Badge } from "@tan-studio/ui/components/badge"
import { Button, buttonVariants } from "@tan-studio/ui/components/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@tan-studio/ui/components/empty"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@tan-studio/ui/components/field"
import { Input } from "@tan-studio/ui/components/input"
import { Textarea } from "@tan-studio/ui/components/textarea"
import { ArrowLeftIcon, PrinterIcon, QrCodeIcon, SaveIcon } from "lucide-react"
import type { FormEvent } from "react"
import { useMemo, useState } from "react"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import {
  createLabel,
  getRoast,
  getSettings,
  listLabels,
  queryKeys,
} from "@/lib/api"

function documentFor(
  widthUm: number,
  heightUm: number,
  roastId: number,
  coffee: string,
  profile: string,
  note: string
): LabelDocument {
  const qrSize = Math.min(heightUm - 6_000, 15_000)
  return {
    schemaVersion: 1,
    widthUm,
    heightUm,
    bleedUm: 0,
    safeInsetUm: 2_000,
    background: "paper",
    elements: [
      {
        id: "coffee",
        kind: "text",
        frame: {
          xUm: 2_500,
          yUm: 2_000,
          widthUm: widthUm - qrSize - 7_000,
          heightUm: 6_000,
        },
        rotationMdeg: 0,
        opacityBasisPoints: 10_000,
        content: coffee,
        font: { family: "geist_sans", style: "normal" },
        sizeUm: 3_200,
        weight: 700,
        lineHeightBasisPoints: 12_000,
        horizontalAlign: "start",
        verticalAlign: "center",
        maxLines: 1,
        overflow: "ellipsis",
      },
      {
        id: "roast",
        kind: "text",
        frame: {
          xUm: 2_500,
          yUm: 8_500,
          widthUm: widthUm - qrSize - 7_000,
          heightUm: 4_500,
        },
        rotationMdeg: 0,
        opacityBasisPoints: 10_000,
        content: `ROAST #${roastId}`,
        font: { family: "geist_sans", style: "normal" },
        sizeUm: 2_600,
        weight: 700,
        lineHeightBasisPoints: 12_000,
        horizontalAlign: "start",
        verticalAlign: "center",
        maxLines: 1,
        overflow: "ellipsis",
      },
      {
        id: "profile",
        kind: "text",
        frame: {
          xUm: 2_500,
          yUm: 13_000,
          widthUm: widthUm - qrSize - 7_000,
          heightUm: 3_500,
        },
        rotationMdeg: 0,
        opacityBasisPoints: 10_000,
        content: profile,
        font: { family: "geist_sans", style: "normal" },
        sizeUm: 1_800,
        weight: 500,
        lineHeightBasisPoints: 12_000,
        horizontalAlign: "start",
        verticalAlign: "center",
        maxLines: 1,
        overflow: "ellipsis",
      },
      {
        id: "note",
        kind: "text",
        frame: {
          xUm: 2_500,
          yUm: 17_000,
          widthUm: widthUm - qrSize - 7_000,
          heightUm: heightUm - 19_000,
        },
        rotationMdeg: 0,
        opacityBasisPoints: 10_000,
        content: note,
        font: { family: "geist_sans", style: "normal" },
        sizeUm: 1_500,
        weight: 400,
        lineHeightBasisPoints: 13_000,
        horizontalAlign: "start",
        verticalAlign: "start",
        maxLines: 2,
        overflow: "ellipsis",
      },
      {
        id: "qr",
        kind: "qr",
        frame: {
          xUm: widthUm - qrSize - 2_500,
          yUm: Math.round((heightUm - qrSize) / 2),
          widthUm: qrSize,
          heightUm: qrSize,
        },
        rotationMdeg: 0,
        opacityBasisPoints: 10_000,
        data: `tan:roast:${roastId}`,
        correction: "M",
        quietModules: 4,
      },
    ],
  }
}

export function LabelComposerScreen() {
  const search = useSearch({ from: "/labels" })
  const queryClient = useQueryClient()
  const roast = useQuery({
    queryKey: queryKeys.roast(search.roastId ?? 0),
    queryFn: ({ signal }) => getRoast(search.roastId!, signal),
    enabled: search.roastId != null,
  })
  const settings = useQuery({
    queryKey: queryKeys.settings(),
    queryFn: ({ signal }) => getSettings(signal),
  })
  const labels = useQuery({
    queryKey: queryKeys.labels(search.roastId),
    queryFn: ({ signal }) => listLabels(search.roastId, signal),
    enabled: search.roastId != null,
  })
  const [note, setNote] = useState("")
  const [widthMm, setWidthMm] = useState<number | null>(null)
  const [heightMm, setHeightMm] = useState<number | null>(null)
  const width =
    widthMm ?? (settings.data?.defaultLabelWidthMicrometers ?? 50_000) / 1_000
  const height =
    heightMm ?? (settings.data?.defaultLabelHeightMicrometers ?? 30_000) / 1_000
  const document = useMemo(
    () =>
      search.roastId && roast.data
        ? documentFor(
            Math.round(width * 1_000),
            Math.round(height * 1_000),
            search.roastId,
            roast.data.coffee?.name ?? "Roasted coffee",
            roast.data.profile?.name ?? "Tan Studio",
            note
          )
        : null,
    [height, note, roast.data, search.roastId, width]
  )
  const svg = useMemo(() => {
    try {
      return document ? renderLabelToSvg(document) : null
    } catch {
      return null
    }
  }, [document])
  const createMutation = useMutation({
    mutationFn: createLabel,
    onSuccess: (label) => {
      toast.success(`Label #${label.id} generated`)
      void queryClient.invalidateQueries({
        queryKey: queryKeys.labels(search.roastId),
      })
    },
    onError: (error) => toast.error(error.message),
  })
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!search.roastId || !document) return
    const form = new FormData(event.currentTarget)
    createMutation.mutate({
      roastId: search.roastId,
      copies: Number(form.get("copies")),
      widthMicrometers: document.widthUm,
      heightMicrometers: document.heightUm,
      printer: "",
      content: {
        schemaVersion: 1,
        qrPayload: `tan:roast:${search.roastId}`,
        coffee: roast.data?.coffee?.name ?? "",
        profile: roast.data?.profile?.name ?? "",
        note,
        document,
      },
    })
  }

  if (!search.roastId)
    return (
      <div className="min-h-screen">
        <PageHeader
          title="Labels"
          description="Labels are created from a roast."
        />
        <Empty className="m-7 min-h-80 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <QrCodeIcon />
            </EmptyMedia>
            <EmptyTitle>Choose a roast first</EmptyTitle>
            <EmptyDescription>
              Open a roast and choose Create label. The label record and QR code
              will point back to it.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  if (roast.error) throw roast.error

  return (
    <div className="min-h-screen">
      <PageHeader
        eyebrow={`Roast #${search.roastId}`}
        title="Jar label"
        description="The short roast number and QR payload both resolve to the same API resource."
        actions={
          <Link
            to="/roasts/$roastId"
            params={{ roastId: String(search.roastId) }}
            className={buttonVariants({ variant: "outline" })}
          >
            <ArrowLeftIcon data-icon="inline-start" />
            Back to roast
          </Link>
        }
      />
      <div className="grid gap-6 px-5 py-6 sm:px-7 xl:grid-cols-[minmax(22rem,0.8fr)_minmax(28rem,1.2fr)]">
        <form onSubmit={submit} className="bg-card rounded-xl border p-5">
          <FieldGroup>
            <div className="grid grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="label-width">Width · mm</FieldLabel>
                <Input
                  id="label-width"
                  type="number"
                  min="20"
                  max="200"
                  step="1"
                  value={width}
                  onChange={(event) => setWidthMm(Number(event.target.value))}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="label-height">Height · mm</FieldLabel>
                <Input
                  id="label-height"
                  type="number"
                  min="20"
                  max="200"
                  step="1"
                  value={height}
                  onChange={(event) => setHeightMm(Number(event.target.value))}
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="label-note">Optional label note</FieldLabel>
              <Textarea
                id="label-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Rest through 26 July · floral filter roast"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="label-copies">Copies</FieldLabel>
              <Input
                id="label-copies"
                name="copies"
                type="number"
                min="1"
                max="100"
                defaultValue="1"
              />
              <FieldDescription>
                Generation is recorded now. Printer submission remains a
                separate, truthful status.
              </FieldDescription>
            </Field>
            <Button type="submit" disabled={!svg || createMutation.isPending}>
              <SaveIcon data-icon="inline-start" />
              Generate label record
            </Button>
          </FieldGroup>
        </form>
        <section className="bg-card flex min-h-80 flex-col items-center justify-center gap-5 rounded-xl border p-6">
          <div className="flex w-full items-center justify-between">
            <div>
              <h2 className="font-semibold">Exact preview</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {width} × {height} mm · deterministic SVG
              </p>
            </div>
            <Badge variant="secondary">
              {labels.data?.length ?? 0} generated
            </Badge>
          </div>
          {svg ? (
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
              alt={`Label preview for roast ${search.roastId}`}
              className="max-h-96 max-w-full border shadow-sm"
            />
          ) : (
            <p className="text-muted-foreground text-sm">
              The selected geometry cannot fit the QR code safely.
            </p>
          )}
          <AlertMessage />
        </section>
      </div>
    </div>
  )
}

function AlertMessage() {
  return (
    <Alert>
      <PrinterIcon />
      <AlertTitle>Truthful print status</AlertTitle>
      <AlertDescription>
        Tan Studio records generated, not “printed.” Physical confirmation will
        appear only when a printer adapter can prove it.
      </AlertDescription>
    </Alert>
  )
}
