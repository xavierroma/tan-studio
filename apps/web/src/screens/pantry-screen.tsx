import { useQuery } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@tan-studio/ui/components/empty"
import { Skeleton } from "@tan-studio/ui/components/skeleton"
import { ArchiveIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { PantryDataTable } from "@/components/pantry-data-table"
import { getPantry, queryKeys } from "@/lib/api"

export function PantryScreen() {
  const search = useSearch({ from: "/pantry" })
  const navigate = useNavigate({ from: "/pantry" })
  const pantry = useQuery({
    queryKey: queryKeys.pantry(),
    queryFn: ({ signal }) => getPantry(signal),
  })
  if (pantry.error) throw pantry.error
  const items = pantry.data?.items ?? []

  return (
    <div className="min-h-screen">
      <PageHeader title="Pantry" />
      <div className="flex flex-col gap-5 px-3 py-4 sm:px-7 sm:py-6">
        {pantry.isPending ? <Skeleton className="h-72 rounded-xl" /> : null}
        {!pantry.isPending && items.length === 0 ? (
          <Empty className="min-h-72 border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ArchiveIcon />
              </EmptyMedia>
              <EmptyTitle>Your pantry is empty</EmptyTitle>
              <EmptyDescription>
                Completed roasts with coffee remaining appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        {items.length > 0 ? (
          <PantryDataTable
            data={items}
            search={search}
            updateSearch={(patch) =>
              void navigate({
                search: (current) => ({ ...current, ...patch }),
                replace: true,
              })
            }
          />
        ) : null}
      </div>
    </div>
  )
}
