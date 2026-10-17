import { NoteBody, NotebookSection, NoteLinks } from "@/components/notebook"
import {
  createNote,
  listNotes,
  queryKeys,
  updateNote,
  type Note,
} from "@/lib/api"
import { Button } from "@tan-studio/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@tan-studio/ui/components/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
} from "@tan-studio/ui/components/empty"
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
import { Textarea } from "@tan-studio/ui/components/textarea"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState, type FormEvent } from "react"
import { toast } from "sonner"

type ResourceType = "coffee" | "roast" | "brew" | "profile"
export function NotebookNotes({
  type,
  id,
  notes: supplied,
  title = "Notes",
  roastId,
  createOpen = false,
  onCreateOpenChange,
}: {
  type: ResourceType
  id: number
  notes?: Note[] | undefined
  title?: string
  roastId?: number
  createOpen?: boolean
  onCreateOpenChange?: (open: boolean) => void
}) {
  const cache = useQueryClient(),
    [open, setOpen] = useState(false),
    [editing, setEditing] = useState<Note | null>(null)
  const query = useQuery({
    queryKey: queryKeys.notes(type, id),
    queryFn: ({ signal }) => listNotes(type, id, signal),
    enabled: supplied === undefined,
  })
  const save = useMutation({
    mutationFn: async (form: FormData) => {
      const body = String(form.get("body") ?? "").trim()
      if (!body) throw Error("Enter a note.")
      const rating = String(form.get("rating") ?? "").trim()
      const values = {
        kind: String(form.get("kind")),
        body,
        ratingBasisPoints:
          rating === "" ? null : Math.round(Number(rating) * 100),
      }
      return editing
        ? updateNote(editing.id, editing.revision, values)
        : createNote({
            ...values,
            attributes: {},
            source: "user",
            links: [
              { resourceType: type, resourceId: id },
              ...(type === "brew" && roastId
                ? [{ resourceType: "roast", resourceId: roastId! }]
                : []),
            ],
          })
    },
    onSuccess: () => {
      setOpen(false)
      onCreateOpenChange?.(false)
      setEditing(null)
      toast.success("Note saved")
      for (const key of [
        "notes",
        "roast-context",
        "roast",
        "brew",
        "brews",
        "pantry",
      ])
        void cache.invalidateQueries({ queryKey: [key] })
    },
    onError: (e) => toast.error(e.message),
  })
  if (query.error) throw query.error
  const notes = supplied ?? query.data ?? []
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    save.mutate(new FormData(e.currentTarget))
  }
  return (
    <NotebookSection
      title={title}
      count={notes.length}
      actions={
        <Button
          variant="outline"
          onClick={() => {
            setEditing(null)
            setOpen(true)
          }}
        >
          Add note
        </Button>
      }
    >
      {notes.length ? (
        notes
          .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map((n) => (
            <NoteBody
              key={n.id}
              note={n}
              actions={
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => {
                    setEditing(n)
                    setOpen(true)
                  }}
                >
                  Edit note #{n.id}
                </Button>
              }
            />
          ))
      ) : query.isPending && supplied === undefined ? (
        <Skeleton className="h-20" />
      ) : (
        <Empty className="notebook-empty">
          <EmptyHeader>
            <EmptyDescription>No notes.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      <Dialog
        open={open || createOpen}
        onOpenChange={(value) => {
          setOpen(value)
          onCreateOpenChange?.(value)
          if (!value) setEditing(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? `Edit note #${editing.id}` : "Add note"}
            </DialogTitle>
          </DialogHeader>
          {editing ? <NoteLinks note={editing} /> : null}
          <form
            onSubmit={submit}
            className="notebook-note-form"
            key={editing?.id ?? "new"}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="notebook-note-kind">Type</FieldLabel>
                <Select
                  name="kind"
                  defaultValue={
                    editing?.kind ??
                    (type === "brew" ? "tasting" : "observation")
                  }
                  items={[
                    ...new Set(
                      [
                        editing?.kind,
                        "observation",
                        "tasting",
                        "recommendation",
                        "conclusion",
                      ].filter((x): x is string => !!x)
                    ),
                  ].map((value) => ({ value, label: value }))}
                >
                  <SelectTrigger id="notebook-note-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {[
                        ...new Set(
                          [
                            editing?.kind,
                            "observation",
                            "tasting",
                            "recommendation",
                            "conclusion",
                          ].filter((x): x is string => !!x)
                        ),
                      ].map((kind) => (
                        <SelectItem key={kind} value={kind}>
                          {kind}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="notebook-note-body">Body</FieldLabel>
                <Textarea
                  id="notebook-note-body"
                  name="body"
                  required
                  defaultValue={editing?.body ?? ""}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="notebook-note-rating">
                  Score / 100
                </FieldLabel>
                <Input
                  id="notebook-note-rating"
                  name="rating"
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  defaultValue={
                    editing?.ratingBasisPoints == null
                      ? ""
                      : editing.ratingBasisPoints / 100
                  }
                />
              </Field>
            </FieldGroup>
            <div className="flex gap-2">
              <Button type="submit" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save note"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setOpen(false)
                  onCreateOpenChange?.(false)
                  setEditing(null)
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </NotebookSection>
  )
}
