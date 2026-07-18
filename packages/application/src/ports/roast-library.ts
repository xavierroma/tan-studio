export type RoastLibraryField =
  | "roastId"
  | "roastedAt"
  | "coffeeId"
  | "coffeeName"
  | "providerId"
  | "providerName"
  | "purchaseId"
  | "purchaseReference"
  | "greenLotId"
  | "lotCode"
  | "countryCode"
  | "region"
  | "farmProducer"
  | "process"
  | "varieties"
  | "profileRevisionId"
  | "profileName"
  | "profileRevisionNumber"
  | "roastLevelThousandths"
  | "greenInputMassMg"
  | "roastedYieldMassMg"
  | "roastLossBasisPoints"
  | "developmentBasisPoints"
  | "tastingScoreBasisPoints"
  | "tastingDescriptors"
  | "tastingNotes"
  | "tastingConclusion"
  | "tags"
  | "result"
  | "status"
  | "needsTasting"
  | "readyPlanStatus"

export type FilterScalar = string | number | boolean

export type RoastFilterExpression =
  | Readonly<{ op: "and" | "or"; clauses: readonly RoastFilterExpression[] }>
  | Readonly<{ op: "not"; clause: RoastFilterExpression }>
  | Readonly<{ op: "search"; query: string }>
  | Readonly<{
      op: "field"
      field: RoastLibraryField
      operator: string
      value?: FilterScalar | readonly FilterScalar[] | undefined
    }>

export type GroupKey =
  | Readonly<{ kind: "value"; value: FilterScalar | null }>
  | Readonly<{
      kind: "range"
      startInclusive: number | string
      endExclusive: number | string
    }>

export type GroupPathEntry = Readonly<{
  field: RoastLibraryField
  key: GroupKey
}>

export type RoastGroupSpec = Readonly<{
  field: RoastLibraryField
  direction: "asc" | "desc"
  bucket?:
    | "day"
    | "week"
    | "month"
    | "year"
    | Readonly<{ size: number; origin: number }>
    | undefined
  timezone?: string | undefined
}>

export type RoastSortSpec = Readonly<{
  field: RoastLibraryField
  direction: "asc" | "desc"
  nulls: "first" | "last"
}>

export type RoastAggregateSpec = Readonly<{
  key: string
  field?: RoastLibraryField | undefined
  op: "count" | "count_distinct" | "sum" | "avg" | "min" | "max"
}>

export type RoastLibraryQuery = Readonly<{
  viewVersion: 1
  filters: RoastFilterExpression
  groups: readonly RoastGroupSpec[]
  groupPath?: readonly GroupPathEntry[] | undefined
  sorts: readonly RoastSortSpec[]
  columns: readonly RoastLibraryField[]
  aggregates: readonly RoastAggregateSpec[]
  page: Readonly<{ first: number; after?: string | undefined }>
}>

export type PageInfo = Readonly<{ endCursor?: string; hasNextPage: boolean }>

export type RoastLibraryRow = Readonly<{
  roastId: string
  revision: number
  values: Partial<
    Record<RoastLibraryField, FilterScalar | null | readonly string[]>
  >
}>

export type RoastLibraryGroup = Readonly<{
  path: readonly GroupPathEntry[]
  key: GroupKey
  label: string
  count: number
  aggregates: Readonly<Record<string, number | string | null>>
}>

export type RoastLibraryResult =
  | Readonly<{
      kind: "groups"
      scope: readonly GroupPathEntry[]
      groups: readonly RoastLibraryGroup[]
      pageInfo: PageInfo
    }>
  | Readonly<{
      kind: "rows"
      scope: readonly GroupPathEntry[]
      rows: readonly RoastLibraryRow[]
      aggregates: Readonly<Record<string, number | string | null>>
      pageInfo: PageInfo
    }>

export interface RoastLibraryReadModel {
  query(
    query: RoastLibraryQuery,
    signal?: AbortSignal
  ): Promise<RoastLibraryResult>
}
