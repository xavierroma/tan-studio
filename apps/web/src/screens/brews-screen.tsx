import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { buttonVariants } from "@tan-studio/ui/components/button"
import { PlusIcon } from "lucide-react"

import { AttachmentPanel } from "@/components/attachment-panel"
import { BrewDataTable } from "@/components/brew-data-table"
import { PageHeader } from "@/components/page-header"
import { listBrews, queryKeys } from "@/lib/api"

export function BrewsScreen() {
  const search = useSearch({ from: "/brews" })
  const navigate = useNavigate({ from: "/brews" })
  const brews = useQuery({
    queryKey: queryKeys.brews(search.roastId),
    queryFn: ({ signal }) => listBrews(search.roastId, signal),
  })
  if (brews.error) throw brews.error
  const selectedBrew = brews.data?.find((brew) => brew.id === search.brewId)
  const updateSearch = (patch: Partial<typeof search>, replace = true) =>
    void navigate({
      search: (current) => ({ ...current, ...patch }),
      replace,
    })

  return (
    <div className="min-h-screen">
      <PageHeader
        title="Brews"
        actions={
          <>
            {search.roastId ? (
              <Link
                to="/roasts/$roastId"
                params={{ roastId: String(search.roastId) }}
                className={buttonVariants({ variant: "outline" })}
              >
                Roast #{search.roastId}
              </Link>
            ) : null}
            <Link
              to="/brews/new"
              search={{ roastId: search.roastId }}
              className={buttonVariants()}
            >
              <PlusIcon data-icon="inline-start" />
              Log brew
            </Link>
          </>
        }
      />
      <div className="flex flex-col gap-5 px-3 py-4 sm:px-7 sm:py-6">
        <BrewDataTable
          data={brews.data ?? []}
          search={{
            q: search.q,
            method: search.method,
            sort: search.sort,
            hidden: search.hidden,
            density: search.density,
          }}
          updateSearch={updateSearch}
          onAttach={(brew) => updateSearch({ brewId: brew.id }, false)}
        />
        {selectedBrew ? (
          <AttachmentPanel
            resourceType="brew"
            resourceId={selectedBrew.id}
            title={`Brew #${selectedBrew.id} images and files`}
          />
        ) : null}
      </div>
    </div>
  )
}
