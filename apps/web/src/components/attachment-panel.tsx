import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@tan-studio/ui/components/dialog"
import { Item, ItemContent, ItemActions } from "@tan-studio/ui/components/item"
import {
  Card,
  CardHeader,
  CardTitle,
  CardAction,
  CardContent,
} from "@tan-studio/ui/components/card"
import { Badge } from "@tan-studio/ui/components/badge"
import { Button } from "@tan-studio/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@tan-studio/ui/components/field"
import { Input } from "@tan-studio/ui/components/input"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ExternalLinkIcon,
  FileIcon,
  ImageIcon,
  PaperclipIcon,
  StarIcon,
  UploadIcon,
  VideoIcon,
} from "lucide-react"
import type { FormEvent } from "react"
import { toast } from "sonner"

import { EntityImage } from "@/components/entity-image"
import {
  getAttachmentContent,
  listAttachments,
  queryKeys,
  setEntityProfileImage,
  uploadAttachment,
  type Attachment,
} from "@/lib/api"

type AttachmentPanelProps = {
  resourceType: "profile" | "coffee" | "roast" | "brew"
  resourceId: number
  title?: string
  description?: string
  compact?: boolean
}

function bytes(value?: number | null) {
  if (value == null) return "Awaiting file"
  if (value < 1_024) return `${value} B`
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`
  return `${(value / 1_048_576).toFixed(1)} MB`
}

function MediaIcon({ mediaType }: { mediaType: string }) {
  if (mediaType.startsWith("image/")) return <ImageIcon />
  if (mediaType.startsWith("video/")) return <VideoIcon />
  return <FileIcon />
}

async function openAttachment(attachment: Attachment) {
  const blob = await getAttachmentContent(attachment)
  const url = URL.createObjectURL(blob)
  window.open(url, "_blank", "noopener,noreferrer")
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function AttachmentPanel({
  resourceType,
  resourceId,
  title = "Attachments",
  description = "",
  compact = false,
}: AttachmentPanelProps) {
  const [selected, setSelected] = useState<Attachment | null>(null)
  const queryClient = useQueryClient()
  const attachments = useQuery({
    queryKey: queryKeys.attachments(resourceType, resourceId),
    queryFn: ({ signal }) => listAttachments(resourceType, resourceId, signal),
  })
  const upload = useMutation({
    mutationFn: async (files: File[]) => {
      const created: Attachment[] = []
      for (const file of files) {
        created.push(
          await uploadAttachment(
            {
              title: file.name,
              sourceUrl: null,
              description: "",
              capturedAt:
                file.lastModified > 0
                  ? new Date(file.lastModified).toISOString()
                  : null,
              links: [{ resourceType, resourceId, role: "gallery" }],
            },
            file
          )
        )
      }
      const alreadyHasProfile = attachments.data?.some((attachment) =>
        attachment.links.some(
          (link) =>
            link.resourceType === resourceType &&
            link.resourceId === resourceId &&
            link.role === "profile"
        )
      )
      const firstImage = created.find((attachment) =>
        attachment.mediaType.startsWith("image/")
      )
      if (!alreadyHasProfile && firstImage) {
        await setEntityProfileImage(resourceType, resourceId, firstImage.id)
      }
      return created.length
    },
    onSuccess: (count) => {
      toast.success(`${count} attachment${count === 1 ? "" : "s"} saved`)
      void queryClient.invalidateQueries({
        queryKey: queryKeys.attachments(resourceType, resourceId),
      })
      void queryClient.invalidateQueries({ queryKey: [resourceType] })
      if (resourceType === "coffee")
        void queryClient.invalidateQueries({ queryKey: ["coffees"] })
      if (resourceType === "roast")
        void queryClient.invalidateQueries({ queryKey: ["roasts"] })
      if (resourceType === "brew")
        void queryClient.invalidateQueries({ queryKey: ["brews"] })
    },
    onError: (error) => toast.error(error.message),
  })
  const open = useMutation({
    mutationFn: openAttachment,
    onError: (error) => toast.error(error.message),
  })
  const profileImage = useMutation({
    mutationFn: (attachmentId: number) =>
      setEntityProfileImage(resourceType, resourceId, attachmentId),
    onSuccess: () => {
      toast.success("Profile image updated")
      void queryClient.invalidateQueries({
        queryKey: queryKeys.attachments(resourceType, resourceId),
      })
      void queryClient.invalidateQueries({ queryKey: [resourceType] })
      void queryClient.invalidateQueries({ queryKey: [`${resourceType}s`] })
    },
    onError: (error) => toast.error(error.message),
  })
  if (attachments.error) throw attachments.error

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const input = event.currentTarget.elements.namedItem("files")
    if (!(input instanceof HTMLInputElement) || !input.files?.length) return
    upload.mutate(Array.from(input.files))
  }

  return (
    <Card className={compact ? "border-0" : ""}>
      <CardHeader className="p-0">
        <CardTitle>
          <h2>{title}</h2>
        </CardTitle>
        <CardAction>
          <Badge variant="secondary">{attachments.data?.length ?? 0}</Badge>
        </CardAction>
        {!compact && description ? (
          <p className="text-muted-foreground mt-1 text-sm">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {attachments.data?.length ? (
          <div className="mt-4 flex flex-col gap-2">
            {attachments.data.map((attachment) => (
              <Item key={attachment.id} className="border-b p-3">
                {attachment.mediaType.startsWith("image/") ? (
                  <EntityImage
                    attachmentId={attachment.id}
                    entityType={resourceType}
                    alt=""
                    className={compact ? "size-12" : "size-16"}
                  />
                ) : (
                  <span className="text-muted-foreground [&_svg]:size-4">
                    <MediaIcon mediaType={attachment.mediaType} />
                  </span>
                )}
                <ItemContent className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {attachment.title}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    #{attachment.id} · {bytes(attachment.byteLength)}
                  </p>
                </ItemContent>
                {attachment.sha256 ? (
                  <ItemActions className="flex-wrap">
                    {attachment.mediaType.startsWith("image/") ? (
                      <Button
                        type="button"
                        variant={
                          attachment.links.some(
                            (link) =>
                              link.resourceType === resourceType &&
                              link.resourceId === resourceId &&
                              link.role === "profile"
                          )
                            ? "secondary"
                            : "ghost"
                        }
                        size="sm"
                        disabled={profileImage.isPending}
                        onClick={() => profileImage.mutate(attachment.id)}
                      >
                        <StarIcon data-icon="inline-start" />
                        {attachment.links.some(
                          (link) =>
                            link.resourceType === resourceType &&
                            link.resourceId === resourceId &&
                            link.role === "profile"
                        )
                          ? "Profile image"
                          : "Use as profile"}
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={open.isPending}
                      onClick={() =>
                        attachment.mediaType.startsWith("image/")
                          ? setSelected(attachment)
                          : open.mutate(attachment)
                      }
                    >
                      <ExternalLinkIcon data-icon="inline-start" />
                      Open
                    </Button>
                  </ItemActions>
                ) : (
                  <Badge variant="warning">Pending</Badge>
                )}
              </Item>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground mt-4 flex items-center gap-2 text-sm">
            <PaperclipIcon />
            Nothing attached yet.
          </p>
        )}

        <form onSubmit={submit} className="mt-4 flex items-end gap-2">
          <Field className="min-w-0 flex-1">
            <FieldLabel htmlFor={`attachments-${resourceType}-${resourceId}`}>
              Add files
            </FieldLabel>
            <Input
              id={`attachments-${resourceType}-${resourceId}`}
              name="files"
              type="file"
              multiple
              accept="image/*,video/*,application/pdf,text/plain,text/csv"
            />
            {!compact ? (
              <FieldDescription>Up to 512 MiB per file.</FieldDescription>
            ) : null}
          </Field>
          <Button type="submit" variant="outline" disabled={upload.isPending}>
            <UploadIcon data-icon="inline-start" />
            {upload.isPending ? "Saving…" : "Attach"}
          </Button>
        </form>
      </CardContent>
      <Dialog
        open={selected != null}
        onOpenChange={(value) => {
          if (!value) setSelected(null)
        }}
      >
        <DialogContent className="max-h-[90svh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {selected?.title || selected?.filename || "Attachment"}
            </DialogTitle>
          </DialogHeader>
          {selected ? (
            <>
              <EntityImage
                attachmentId={selected.id}
                entityType={resourceType}
                alt={selected.title || selected.filename}
                className="h-[60vh] w-full border-0"
                imageClassName="object-contain"
              />
              <p className="text-muted-foreground text-xs">
                #{selected.id} · {selected.filename} · {selected.mediaType} ·{" "}
                {bytes(selected.byteLength)}
              </p>
              {selected.description ? (
                <p className="text-sm whitespace-pre-wrap">
                  {selected.description}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={
                    !attachments.data?.some(
                      (a, i, all) => all[i + 1]?.id === selected.id
                    )
                  }
                  onClick={() => {
                    const i = attachments.data!.findIndex(
                      (a) => a.id === selected.id
                    )
                    setSelected(attachments.data![i - 1]!)
                  }}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  disabled={attachments.data?.at(-1)?.id === selected.id}
                  onClick={() => {
                    const i = attachments.data!.findIndex(
                      (a) => a.id === selected.id
                    )
                    setSelected(attachments.data![i + 1]!)
                  }}
                >
                  Next
                </Button>
                <Button variant="outline" onClick={() => open.mutate(selected)}>
                  Open original ↗
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  )
}
