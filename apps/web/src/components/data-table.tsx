import {
  type ColumnDef,
  type RowData,
  type SortingState,
  type VisibilityState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Button } from "@tan-studio/ui/components/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@tan-studio/ui/components/dropdown-menu"
import { Field, FieldLabel } from "@tan-studio/ui/components/field"
import { Input } from "@tan-studio/ui/components/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@tan-studio/ui/components/table"
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ListIcon,
  Rows3Icon,
  SearchIcon,
  Settings2Icon,
} from "lucide-react"
import type { ReactNode } from "react"
import { useMemo } from "react"
import { toast } from "sonner"

import {
  getUiPreferences,
  queryKeys,
  updateUiPreferences,
  type UiPreferences,
} from "@/lib/api"
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@tan-studio/ui/components/toggle-group"

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    label?: string
    mobile?: "image" | "primary" | "detail" | "hidden"
  }
}

export type DataTableViewState = {
  sort: string | undefined
  hidden: string | undefined
  density: "compact" | "expanded" | undefined
}

type SearchControl = {
  id: string
  label: string
  placeholder: string
  value: string | undefined
  onChange: (value: string | undefined) => void
}

type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  state: DataTableViewState
  updateState: (patch: Partial<DataTableViewState>) => void
  defaultSorting: SortingState
  noun: string
  search?: SearchControl
  filters?: ReactNode
  getRowId?: (row: TData) => string
  preferenceKey: string
  defaultHidden?: string[]
}

type TablePreference = {
  density?: "compact" | "expanded"
  hidden?: string[]
}

function preferenceRecord(value: unknown): Record<string, TablePreference> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, TablePreference>
}

function sortingState(
  value: string | undefined,
  columns: readonly ColumnDef<unknown, unknown>[],
  fallback: SortingState
): SortingState {
  const [id, direction] = value?.split(".") ?? []
  const allowed = new Set(
    columns
      .map(
        (column) =>
          column.id ?? ("accessorKey" in column ? column.accessorKey : null)
      )
      .filter((columnId): columnId is string => typeof columnId === "string")
  )
  return id && allowed.has(id) && (direction === "asc" || direction === "desc")
    ? [{ id, desc: direction === "desc" }]
    : fallback
}

function sortingValue(value: SortingState, fallback: SortingState) {
  const first = value[0]
  const defaultFirst = fallback[0]
  if (
    !first ||
    (defaultFirst &&
      first.id === defaultFirst.id &&
      first.desc === defaultFirst.desc)
  ) {
    return undefined
  }
  return `${first.id}.${first.desc ? "desc" : "asc"}`
}

function visibilityState(value?: string): VisibilityState {
  return Object.fromEntries(
    (value?.split(",") ?? []).filter(Boolean).map((id) => [id, false])
  )
}

function visibilityValue(value: VisibilityState) {
  const hidden = Object.entries(value)
    .filter(([, visible]) => visible === false)
    .map(([id]) => id)
    .toSorted()
  return hidden.length ? hidden.join(",") : undefined
}

export function DataTableSortHeader({
  label,
  sorted,
  onClick,
}: {
  label: string
  sorted: false | "asc" | "desc"
  onClick: () => void
}) {
  return (
    <Button type="button" variant="ghost" size="sm" onClick={onClick}>
      {label}
      {sorted === "asc" ? (
        <ArrowUpIcon data-icon="inline-end" />
      ) : sorted === "desc" ? (
        <ArrowDownIcon data-icon="inline-end" />
      ) : (
        <ArrowUpDownIcon data-icon="inline-end" />
      )}
    </Button>
  )
}

export function DataTable<TData, TValue>({
  columns,
  data,
  state,
  updateState,
  defaultSorting,
  noun,
  search,
  filters,
  getRowId,
  preferenceKey,
  defaultHidden = [],
}: DataTableProps<TData, TValue>) {
  const queryClient = useQueryClient()
  const preferences = useQuery({
    queryKey: queryKeys.uiPreferences(),
    queryFn: ({ signal }) => getUiPreferences(signal),
  })
  const persistPreference = useMutation({
    scope: { id: "ui-preferences" },
    mutationFn: async (patch: TablePreference) => {
      const current = await queryClient.fetchQuery({
        queryKey: queryKeys.uiPreferences(),
        queryFn: ({ signal }) => getUiPreferences(signal),
      })
      const tables = preferenceRecord(current.tablePreferences)
      return updateUiPreferences(current.revision, {
        tablePreferences: {
          ...tables,
          [preferenceKey]: {
            ...tables[preferenceKey],
            ...patch,
          },
        },
      })
    },
    onSuccess: (updated) =>
      queryClient.setQueryData<UiPreferences>(
        queryKeys.uiPreferences(),
        updated
      ),
    onError: () => toast.error("Table preferences could not be saved"),
  })
  const stored = preferenceRecord(preferences.data?.tablePreferences)[
    preferenceKey
  ]
  const effectiveHidden =
    state.hidden ??
    (stored?.hidden !== undefined
      ? stored.hidden.join(",") || undefined
      : defaultHidden.join(",") || undefined)
  const sorting = useMemo(
    () =>
      sortingState(
        state.sort,
        columns as ColumnDef<unknown, unknown>[],
        defaultSorting
      ),
    [columns, defaultSorting, state.sort]
  )
  const columnVisibility = useMemo(
    () => visibilityState(effectiveHidden),
    [effectiveHidden]
  )
  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater
      updateState({ sort: sortingValue(next, defaultSorting) })
    },
    onColumnVisibilityChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(columnVisibility) : updater
      const hidden = visibilityValue(next)
      updateState({ hidden })
      persistPreference.mutate({
        hidden: hidden?.split(",").filter(Boolean) ?? [],
      })
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(getRowId ? { getRowId } : {}),
  })
  const density =
    state.density ??
    stored?.density ??
    (preferences.data?.defaultTableDensity === "compact"
      ? "compact"
      : "expanded")
  const rows = table.getRowModel().rows

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
        {search ? (
          <Field className="min-w-64 flex-1">
            <FieldLabel htmlFor={search.id} className="sr-only">
              {search.label}
            </FieldLabel>
            <div className="relative">
              <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                id={search.id}
                value={search.value ?? ""}
                onChange={(event) =>
                  search.onChange(event.target.value || undefined)
                }
                className="pl-9"
                placeholder={search.placeholder}
              />
            </div>
          </Field>
        ) : (
          <div className="flex-1" />
        )}
        {filters ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:flex">{filters}</div>
        ) : null}
        <div className="flex items-center gap-2">
          <ToggleGroup
            value={[density]}
            onValueChange={(values) => {
              const value = values.at(-1)
              if (value === "compact" || value === "expanded") {
                updateState({
                  density: value,
                })
                persistPreference.mutate({ density: value })
              }
            }}
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Row density"
          >
            <ToggleGroupItem value="compact" aria-label="Compact rows">
              <ListIcon />
            </ToggleGroupItem>
            <ToggleGroupItem value="expanded" aria-label="Expanded rows">
              <Rows3Icon />
            </ToggleGroupItem>
          </ToggleGroup>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button type="button" variant="outline" size="sm">
                  <Settings2Icon data-icon="inline-start" />
                  Columns
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {table
                  .getAllColumns()
                  .filter((column) => column.getCanHide())
                  .map((column) => (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) =>
                        column.toggleVisibility(Boolean(value))
                      }
                    >
                      {column.columnDef.meta?.label ?? column.id}
                    </DropdownMenuCheckboxItem>
                  ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="bg-card overflow-hidden rounded-xl border">
        <div className="hidden overflow-x-auto md:block">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} colSpan={header.colSpan}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      className={density === "expanded" ? "py-4" : undefined}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="divide-y md:hidden">
          {rows.map((row) => {
            const cells = row
              .getVisibleCells()
              .filter((cell) => cell.column.columnDef.meta?.mobile !== "hidden")
            const primary =
              cells.find(
                (cell) => cell.column.columnDef.meta?.mobile === "primary"
              ) ??
              cells.find(
                (cell) => cell.column.columnDef.meta?.mobile !== "image"
              )
            const image = cells.find(
              (cell) => cell.column.columnDef.meta?.mobile === "image"
            )
            const details = cells.filter(
              (cell) => cell !== primary && cell !== image
            )
            return (
              <article
                key={row.id}
                className={density === "expanded" ? "p-5" : "p-4"}
              >
                <div className="flex items-start gap-4">
                  {image
                    ? flexRender(
                        image.column.columnDef.cell,
                        image.getContext()
                      )
                    : null}
                  <div className="min-w-0 flex-1">
                    {primary ? (
                      <div className="text-base font-semibold">
                        {flexRender(
                          primary.column.columnDef.cell,
                          primary.getContext()
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
                <dl
                  className={`grid grid-cols-2 gap-x-4 ${density === "expanded" ? "mt-4 gap-y-4" : "mt-3 gap-y-2"}`}
                >
                  {details.map((cell) => (
                    <div key={cell.id} className="min-w-0">
                      <dt className="text-muted-foreground text-xs">
                        {cell.column.columnDef.meta?.label ?? cell.column.id}
                      </dt>
                      <dd className="mt-0.5 min-w-0 text-sm">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </article>
            )
          })}
        </div>

        <div className="text-muted-foreground border-t px-4 py-3 text-xs">
          {rows.length.toLocaleString()} {noun}
          {rows.length === 1 ? "" : "s"}
        </div>
      </div>
    </div>
  )
}
