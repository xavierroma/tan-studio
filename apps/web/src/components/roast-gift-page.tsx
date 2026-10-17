import { NotebookSection } from "@/components/notebook"
import { updateRoast, type Roast } from "@/lib/api"
import { Button } from "@tan-studio/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@tan-studio/ui/components/dialog"
import { Field, FieldLabel } from "@tan-studio/ui/components/field"
import { Input } from "@tan-studio/ui/components/input"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"

export function RoastGiftPage({ roast }: { roast: Roast }) {
  const [open, setOpen] = useState(false),
    cache = useQueryClient()
  const save = useMutation({
    mutationFn: (url: string) => {
      if (url) {
        const parsed = new URL(url)
        if (parsed.protocol !== "https:" || parsed.username || parsed.password)
          throw Error("Use an HTTPS URL without credentials.")
      }
      return updateRoast(roast.id, roast.revision, {
        deployedPageUrl: url || null,
      })
    },
    onSuccess: () => {
      setOpen(false)
      void cache.invalidateQueries({ queryKey: ["roast", roast.id] })
      void cache.invalidateQueries({ queryKey: ["roast-context", roast.id] })
      toast.success("Gift page link saved")
    },
    onError: (e) => toast.error(e.message),
  })
  return (
    <NotebookSection
      title="Gift page"
      actions={
        <Button variant="outline" onClick={() => setOpen(true)}>
          {roast.deployedPageUrl ? "Edit link" : "Link page"}
        </Button>
      }
    >
      {roast.deployedPageUrl ? (
        <a
          href={roast.deployedPageUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="notebook-link inline-block py-5"
        >
          Open gift page ↗
        </a>
      ) : (
        <p className="notebook-empty">No page linked.</p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link gift page</DialogTitle>
          </DialogHeader>
          <form
            key={roast.revision}
            onSubmit={(e) => {
              e.preventDefault()
              save.mutate(
                String(new FormData(e.currentTarget).get("url") ?? "").trim()
              )
            }}
            className="grid gap-5"
          >
            <Field>
              <FieldLabel htmlFor="gift-page-url">Deployed page URL</FieldLabel>
              <Input
                id="gift-page-url"
                name="url"
                type="url"
                maxLength={2048}
                defaultValue={roast.deployedPageUrl ?? ""}
                placeholder="https://…"
              />
            </Field>
            <Button type="submit" disabled={save.isPending}>
              Save link
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </NotebookSection>
  )
}
