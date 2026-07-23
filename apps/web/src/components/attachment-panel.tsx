import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Badge } from "@tan-studio/ui/components/badge"
import { Button } from "@tan-studio/ui/components/button"
import {
  Field,
  FieldDescription,
  FieldLabel,
} from "@tan-studio/ui/components/field"
import { Input } from "@tan-studio/ui/components/input"
import {
  ExternalLinkIcon,
  FileIcon,
  ImageIcon,
  PaperclipIcon,
  UploadIcon,
  StarIcon,
  VideoIcon,
} from "lucide-react"
import type { FormEvent } from "react"
import { toast } from "sonner"

import {
  getAttachmentContent,
  listAttachments,
  queryKeys,
  setEntityProfileImage,
  uploadAttachment,
  type Attachment,
} from "@/lib/api"
import { EntityImage } from "@/components/entity-image"

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
  description = "Photos, videos, PDFs, and source documents stay in Tan Studio’s local file store.",
  compact = false,
}: AttachmentPanelProps) {
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
    <section className={compact ? "" : "bg-card rounded-xl border p-5"}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        <Badge variant="secondary">{attachments.data?.length ?? 0}</Badge>
      </div>
      {!compact ? (
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      ) : null}

      {attachments.data?.length ? (
        <div className="mt-4 flex flex-col gap-2">
          {attachments.data.map((attachment) => (
            <div
              key={attachment.id}
              className="bg-muted/40 flex items-center gap-3 rounded-lg border p-3"
            >
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
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {attachment.title}
                </p>
                <p className="text-muted-foreground truncate text-xs">
                  #{attachment.id} · {bytes(attachment.byteLength)}
                </p>
              </div>
              {attachment.sha256 ? (
                <div className="flex items-center gap-1">
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
                    onClick={() => open.mutate(attachment)}
                  >
                    <ExternalLinkIcon data-icon="inline-start" />
                    Open
                  </Button>
                </div>
              ) : (
                <Badge variant="warning">Pending</Badge>
              )}
            </div>
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
    </section>
  )
}
