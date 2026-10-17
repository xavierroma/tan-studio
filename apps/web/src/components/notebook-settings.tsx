import { NotebookSection } from "@/components/notebook"
import {
  getSettings,
  getUiPreferences,
  queryKeys,
  updateSettings,
  updateUiPreferences,
} from "@/lib/api"
import { Button } from "@tan-studio/ui/components/button"
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
import { toast } from "sonner"

export function NotebookSettings() {
  const cache = useQueryClient(),
    settings = useQuery({
      queryKey: queryKeys.settings(),
      queryFn: ({ signal }) => getSettings(signal),
    }),
    prefs = useQuery({
      queryKey: queryKeys.uiPreferences(),
      queryFn: ({ signal }) => getUiPreferences(signal),
    })
  const save = useMutation({
    mutationFn: async (form: FormData) => {
      if (!settings.data || !prefs.data)
        throw Error("Settings are still loading.")
      await updateSettings(settings.data.revision, {
        defaultLabelWidthMicrometers: Math.round(
          Number(form.get("width")) * 1000
        ),
        defaultLabelHeightMicrometers: Math.round(
          Number(form.get("height")) * 1000
        ),
      })
      await updateUiPreferences(prefs.data.revision, {
        defaultTableDensity: String(form.get("density")),
      })
    },
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: queryKeys.settings() })
      void cache.invalidateQueries({ queryKey: queryKeys.uiPreferences() })
      toast.success("Settings saved")
    },
    onError: (e) => {
      void cache.invalidateQueries({ queryKey: queryKeys.settings() })
      void cache.invalidateQueries({ queryKey: queryKeys.uiPreferences() })
      toast.error(e.message)
    },
  })
  if (settings.error) throw settings.error
  if (prefs.error) throw prefs.error
  if (!settings.data || !prefs.data) return <Skeleton className="h-64" />
  return (
    <NotebookSection title="Labels & tables">
      <form
        key={`${settings.data.revision}:${prefs.data.revision}`}
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate(new FormData(e.currentTarget))
        }}
        className="max-w-xl py-6"
      >
        <FieldGroup>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="default-label-width">
                Label width · mm
              </FieldLabel>
              <Input
                id="default-label-width"
                name="width"
                type="number"
                min="20"
                max="200"
                step="1"
                required
                defaultValue={settings.data.defaultLabelWidthMicrometers / 1000}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="default-label-height">
                Label height · mm
              </FieldLabel>
              <Input
                id="default-label-height"
                name="height"
                type="number"
                min="20"
                max="200"
                step="1"
                required
                defaultValue={
                  settings.data.defaultLabelHeightMicrometers / 1000
                }
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="default-density">
              Default table density
            </FieldLabel>
            <Select
              name="density"
              defaultValue={prefs.data.defaultTableDensity}
              items={[
                { value: "compact", label: "Compact" },
                { value: "expanded", label: "Expanded" },
              ]}
            >
              <SelectTrigger id="default-density">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="compact">Compact</SelectItem>
                  <SelectItem value="expanded">Expanded</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Button type="submit" disabled={save.isPending}>
            Save preferences
          </Button>
        </FieldGroup>
      </form>
    </NotebookSection>
  )
}
