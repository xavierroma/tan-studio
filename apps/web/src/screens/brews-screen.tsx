import { Button } from "@tan-studio/ui/components/button"
import { useQuery } from "@tanstack/react-query"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { PlusIcon } from "lucide-react"

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
              <Button
                nativeButton={false}
                role="link"
                variant={"outline"}
                render={
                  <Link
                    to="/roasts/$roastId"
                    params={{ roastId: String(search.roastId) }}
                  />
                }
              >
                Roast #{search.roastId}
              </Button>
            ) : null}
            <Button
              nativeButton={false}
              role="link"
              render={
                <Link to="/brews/new" search={{ roastId: search.roastId }} />
              }
            >
              <PlusIcon data-icon="inline-start" />
              Log brew
            </Button>
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
        />
      </div>
    </div>
  )
}
