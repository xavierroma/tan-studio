import type { CompanionDatabase } from "../db/database"
import type {
  RoastLibraryQuery as ApplicationRoastLibraryQuery,
  RoastLibraryReadModel,
  RoastLibraryResult,
} from "@tan-studio/application"
import { isoInstant } from "../api/http"
import { ApiError } from "../api/problem"
import type { RoastLibraryField, RoastLibraryQuery } from "../api/schemas"
import type { CursorService } from "./cursor"

type FilterNode =
  | { op: "and"; clauses: FilterNode[] }
  | { op: "or"; clauses: FilterNode[] }
  | { op: "not"; clause: FilterNode }
  | { op: "search"; query: string }
  | { op: "field"; field: RoastLibraryField; operator: string; value?: unknown }

type LibraryRow = Record<string, string | number | null>

const fieldColumns: Record<RoastLibraryField, string> = {
  roastId: "roast_id",
  roastedAt: "roasted_at_ms",
  coffeeId: "coffee_id",
  coffeeName: "coffee_name",
  providerId: "provider_id",
  providerName: "provider_name",
  purchaseId: "purchase_id",
  purchaseReference: "purchase_reference",
  greenLotId: "green_lot_id",
  lotCode: "lot_code",
  countryCode: "country_code",
  region: "region",
  farmProducer: "farm_producer",
  process: "process",
  varieties: "varieties_json",
  profileRevisionId: "profile_revision_id",
  profileName: "profile_name",
  profileRevisionNumber: "profile_revision_number",
  roastLevelThousandths: "roast_level_thousandths",
  greenInputMassMg: "green_input_mass_mg",
  roastedYieldMassMg: "roasted_yield_mass_mg",
  roastLossBasisPoints: "roast_loss_basis_points",
  developmentBasisPoints: "development_basis_points",
  tastingScoreBasisPoints: "tasting_score_basis_points",
  tastingDescriptors: "tasting_descriptors_json",
  tastingNotes: "tasting_notes",
  tastingConclusion: "tasting_conclusion",
  tags: "tags_json",
  result: "result",
  status: "status",
  needsTasting: "needs_tasting",
  readyPlanStatus: "ready_plan_status",
}

const arrayFields = new Set<RoastLibraryField>([
  "varieties",
  "tastingDescriptors",
  "tags",
])
const instantFields = new Set<RoastLibraryField>(["roastedAt"])
const booleanFields = new Set<RoastLibraryField>(["needsTasting"])
const numericAggregateFields = new Set<RoastLibraryField>([
  "profileRevisionNumber",
  "roastLevelThousandths",
  "greenInputMassMg",
  "roastedYieldMassMg",
  "roastLossBasisPoints",
  "developmentBasisPoints",
  "tastingScoreBasisPoints",
])
const groupLabelColumns: Partial<Record<RoastLibraryField, string>> = {
  coffeeId: "coffee_name",
  providerId: "provider_name",
  purchaseId: "purchase_reference",
  greenLotId: "lot_code",
  profileRevisionId: "profile_name",
}

function inputValue(field: RoastLibraryField, value: unknown): unknown {
  if (instantFields.has(field) && typeof value === "string") {
    const parsed = Date.parse(value)
    if (!Number.isFinite(parsed))
      throw unsupported("The instant filter value is invalid.")
    return parsed
  }
  if (booleanFields.has(field) && typeof value === "boolean")
    return value ? 1 : 0
  return value
}

function unsupported(detail: string): ApiError {
  return new ApiError({
    status: 422,
    code: "unsupported_roast_query",
    title: "Unsupported roast query",
    detail,
  })
}

function escapeLike(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_")
}

function safeFtsQuery(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 32)
    .map((token) => `"${token.replaceAll('"', '""')}"*`)
    .join(" AND ")
}

function compileFilter(node: FilterNode, params: unknown[], depth = 0): string {
  if (depth > 5)
    throw unsupported("Filter trees may be at most five levels deep.")
  if (node.op === "and" || node.op === "or") {
    if (node.clauses.length === 0) return node.op === "and" ? "1" : "0"
    return `(${node.clauses.map((clause) => compileFilter(clause, params, depth + 1)).join(` ${node.op.toUpperCase()} `)})`
  }
  if (node.op === "not")
    return `(NOT ${compileFilter(node.clause, params, depth + 1)})`
  if (node.op === "search") {
    const value = safeFtsQuery(node.query)
    if (!value) return "1"
    params.push(value)
    return `roast_id IN (
      SELECT roast_id FROM roast_library_fts
      WHERE roast_library_fts MATCH ?
    )`
  }

  const column = fieldColumns[node.field]
  const operator = node.operator
  if (operator === "is_null") return `${column} IS NULL`
  if (operator === "is_not_null") return `${column} IS NOT NULL`
  if (operator === "is_empty" && arrayFields.has(node.field))
    return `json_array_length(${column}) = 0`
  if (operator === "is_not_empty" && arrayFields.has(node.field))
    return `json_array_length(${column}) > 0`

  if (arrayFields.has(node.field)) {
    const values = Array.isArray(node.value) ? node.value : [node.value]
    if (values.some((value) => typeof value !== "string"))
      throw unsupported("Set filters require text values.")
    if (["contains_any", "contains_all", "contains_none"].includes(operator)) {
      if (values.length === 0)
        return operator === "contains_all" || operator === "contains_none"
          ? "1"
          : "0"
      const expressions = values.map(
        () =>
          `EXISTS (SELECT 1 FROM json_each(${column}) j WHERE lower(j.value) = lower(?))`
      )
      params.push(...values)
      if (operator === "contains_any") return `(${expressions.join(" OR ")})`
      if (operator === "contains_all") return `(${expressions.join(" AND ")})`
      return `(NOT (${expressions.join(" OR ")}))`
    }
    throw unsupported(`Operator ${operator} is not valid for ${node.field}.`)
  }

  const value = inputValue(node.field, node.value)
  if (["eq", "neq", "lt", "lte", "gt", "gte"].includes(operator)) {
    if (value === undefined)
      throw unsupported(`Operator ${operator} requires a value.`)
    params.push(value)
    const symbol = (
      { eq: "=", neq: "!=", lt: "<", lte: "<=", gt: ">", gte: ">=" } as Record<
        string,
        string
      >
    )[operator]!
    return `${column} ${symbol} ?`
  }
  if (operator === "between") {
    if (!Array.isArray(value) || value.length !== 2)
      throw unsupported("between requires exactly two values.")
    params.push(
      inputValue(node.field, value[0]),
      inputValue(node.field, value[1])
    )
    return `${column} BETWEEN ? AND ?`
  }
  if (operator === "in" || operator === "not_in") {
    if (!Array.isArray(value) || value.length === 0)
      throw unsupported(`${operator} requires a non-empty list.`)
    params.push(...value.map((item) => inputValue(node.field, item)))
    return `${column} ${operator === "not_in" ? "NOT " : ""}IN (${value.map(() => "?").join(",")})`
  }
  if (["contains", "not_contains", "starts_with"].includes(operator)) {
    if (typeof value !== "string")
      throw unsupported(`${operator} requires text.`)
    params.push(
      `${operator === "starts_with" ? "" : "%"}${escapeLike(value.toLocaleLowerCase("en-US"))}%`
    )
    return `${operator === "not_contains" ? "NOT " : ""}(lower(coalesce(${column},'')) LIKE ? ESCAPE '\\')`
  }
  throw unsupported(`Operator ${operator} is not supported.`)
}

function validateFilterComplexity(node: FilterNode, depth = 0): number {
  if (depth > 5)
    throw unsupported("Filter trees may be at most five levels deep.")
  if (node.op === "and" || node.op === "or") {
    const leaves = node.clauses.reduce(
      (total, clause) => total + validateFilterComplexity(clause, depth + 1),
      0
    )
    if (leaves > 100)
      throw unsupported("Filter trees may contain at most 100 leaves.")
    return leaves
  }
  if (node.op === "not") return validateFilterComplexity(node.clause, depth + 1)
  return 1
}

function toPublicValue(
  field: RoastLibraryField,
  value: string | number | null
) {
  if (field === "roastedAt" && typeof value === "number")
    return isoInstant(value)
  if (arrayFields.has(field))
    return JSON.parse(typeof value === "string" ? value : "[]") as string[]
  if (field === "needsTasting") return value === 1
  return value
}

type AggregateSpec = RoastLibraryQuery["aggregates"][number]
type GroupSpec = RoastLibraryQuery["groups"][number]
type GroupPathEntry = NonNullable<RoastLibraryQuery["groupPath"]>[number]

function compileAggregates(aggregates: AggregateSpec[]) {
  const selections: string[] = []
  const readers: Array<{
    key: string
    alias: string
    instant: boolean
  }> = []

  aggregates.forEach((aggregate, index) => {
    const alias = `_aggregate_${index}`
    if (aggregate.op === "count") {
      selections.push(`count(*) AS ${alias}`)
      readers.push({ key: aggregate.key, alias, instant: false })
      return
    }

    const field = aggregate.field
    if (arrayFields.has(field)) {
      throw unsupported(`Aggregate ${aggregate.op} is not valid for ${field}.`)
    }
    if (
      (aggregate.op === "sum" || aggregate.op === "avg") &&
      !numericAggregateFields.has(field)
    ) {
      throw unsupported(`Aggregate ${aggregate.op} requires a numeric field.`)
    }
    const functionName =
      aggregate.op === "count_distinct" ? "count" : aggregate.op
    const distinct = aggregate.op === "count_distinct" ? "DISTINCT " : ""
    selections.push(
      `${functionName}(${distinct}${fieldColumns[field]}) AS ${alias}`
    )
    readers.push({
      key: aggregate.key,
      alias,
      instant:
        field === "roastedAt" &&
        (aggregate.op === "min" || aggregate.op === "max"),
    })
  })

  return {
    selections,
    read(row: LibraryRow): Record<string, number | string | null> {
      return Object.fromEntries(
        readers.map(({ key, alias, instant }) => {
          const value = row[alias] ?? null
          return [
            key,
            instant && typeof value === "number" ? isoInstant(value) : value,
          ]
        })
      )
    },
  }
}

function compileGroupPath(
  groups: GroupSpec[],
  groupPath: GroupPathEntry[],
  params: unknown[]
): string[] {
  return groupPath.map((entry, index) => {
    const spec = groups[index]
    if (!spec || spec.field !== entry.field) {
      throw unsupported("The group path does not match the group definition.")
    }
    const column = fieldColumns[entry.field]
    if (entry.key.kind === "value") {
      if ("bucket" in spec && entry.key.value !== null) {
        throw unsupported("A bucketed group path requires a range key.")
      }
      if (entry.key.value === null) return `${column} IS NULL`
      params.push(inputValue(entry.field, entry.key.value))
      return `${column} = ?`
    }
    if (!("bucket" in spec)) {
      throw unsupported("A value group path cannot use a range key.")
    }
    const start = inputValue(entry.field, entry.key.startInclusive)
    const end = inputValue(entry.field, entry.key.endExclusive)
    params.push(start, end)
    return `${column} >= ? AND ${column} < ?`
  })
}

function localMidnightEpoch(date: string, timezone: string): number {
  if (timezone === "UTC") return Date.parse(`${date}T00:00:00.000Z`)
  const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (timezone !== systemTimezone) {
    throw unsupported(
      `Time grouping currently supports UTC or the system timezone (${systemTimezone}).`
    )
  }
  return new Date(`${date}T00:00:00`).getTime()
}

function advanceLocalDate(
  date: string,
  bucket: "day" | "week" | "month" | "year"
): string {
  const [year, month, day] = date.split("-").map(Number) as [
    number,
    number,
    number,
  ]
  const next = new Date(Date.UTC(year, month - 1, day))
  if (bucket === "day") next.setUTCDate(next.getUTCDate() + 1)
  if (bucket === "week") next.setUTCDate(next.getUTCDate() + 7)
  if (bucket === "month") next.setUTCMonth(next.getUTCMonth() + 1)
  if (bucket === "year") next.setUTCFullYear(next.getUTCFullYear() + 1)
  return next.toISOString().slice(0, 10)
}

function timeBucketExpression(
  bucket: "day" | "week" | "month" | "year",
  timezone: string
): string {
  const systemTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (timezone !== "UTC" && timezone !== systemTimezone) {
    throw unsupported(
      `Time grouping currently supports UTC or the system timezone (${systemTimezone}).`
    )
  }
  const modifier = timezone === "UTC" ? "" : ", 'localtime'"
  const base = `roasted_at_ms / 1000, 'unixepoch'${modifier}`
  if (bucket === "day") return `strftime('%Y-%m-%d', ${base})`
  if (bucket === "month") return `strftime('%Y-%m-01', ${base})`
  if (bucket === "year") return `strftime('%Y-01-01', ${base})`
  return `date(roasted_at_ms / 1000, 'unixepoch'${modifier}, '-' || ((CAST(strftime('%w', ${base}) AS INTEGER) + 6) % 7) || ' days')`
}

function groupDefinition(spec: GroupSpec) {
  const column = fieldColumns[spec.field]
  if (!("bucket" in spec)) {
    return {
      expression: column,
      labelExpression: groupLabelColumns[spec.field] ?? column,
      key(value: string | number | null) {
        return {
          kind: "value" as const,
          value:
            spec.field === "needsTasting" && typeof value === "number"
              ? value === 1
              : value,
        }
      },
      label(value: string | number | null, rawLabel: string | number | null) {
        if (value === null) return "Unassigned"
        if (spec.field === "needsTasting")
          return value === 1 ? "Tasting due" : "Tasted"
        return String(rawLabel ?? value)
      },
    }
  }

  if (spec.field === "roastedAt") {
    const expression = timeBucketExpression(spec.bucket, spec.timezone)
    return {
      expression,
      labelExpression: expression,
      key(value: string | number | null) {
        if (typeof value !== "string")
          return { kind: "value" as const, value: null }
        return {
          kind: "range" as const,
          startInclusive: isoInstant(localMidnightEpoch(value, spec.timezone)),
          endExclusive: isoInstant(
            localMidnightEpoch(
              advanceLocalDate(value, spec.bucket),
              spec.timezone
            )
          ),
        }
      },
      label(value: string | number | null) {
        return value === null ? "Unknown date" : String(value)
      },
    }
  }

  const { size, origin } = spec.bucket
  const expression = `floor((${column} - ${origin}) / ${size}) * ${size} + ${origin}`
  return {
    expression,
    labelExpression: expression,
    key(value: string | number | null) {
      if (typeof value !== "number")
        return { kind: "value" as const, value: null }
      return {
        kind: "range" as const,
        startInclusive: value,
        endExclusive: value + size,
      }
    },
    label(value: string | number | null) {
      return typeof value === "number"
        ? `${value}–${value + size}`
        : "Unassigned"
    },
  }
}

export class RoastLibraryQueryService implements RoastLibraryReadModel {
  constructor(
    readonly database: CompanionDatabase,
    readonly cursors: CursorService
  ) {}

  async query(
    query: ApplicationRoastLibraryQuery,
    signal?: AbortSignal
  ): Promise<RoastLibraryResult> {
    if (signal?.aborted) throw signal.reason
    return this.execute(query as RoastLibraryQuery) as RoastLibraryResult
  }

  execute(query: RoastLibraryQuery) {
    const queryIdentity = { ...query, page: { first: query.page.first } }
    const queryHash = this.cursors.queryHash(queryIdentity)
    const offset = this.cursors.read(
      query.page.after,
      "roast-library",
      queryHash
    )
    const params: unknown[] = []
    const filter = query.filters as FilterNode
    validateFilterComplexity(filter)
    const whereParts = [compileFilter(filter, params)]
    const groupPath = query.groupPath ?? []
    whereParts.push(...compileGroupPath(query.groups, groupPath, params))
    const where = whereParts.map((part) => `(${part})`).join(" AND ")
    const aggregatePlan = compileAggregates(query.aggregates)

    if (groupPath.length < query.groups.length) {
      const spec = query.groups[groupPath.length]!
      const group = groupDefinition(spec)
      const aggregateSql = aggregatePlan.selections.length
        ? `, ${aggregatePlan.selections.join(", ")}`
        : ""
      const rows = this.database
        .query(
          `SELECT ${group.expression} AS group_value,
                  ${group.labelExpression} AS group_label,
                  count(*) AS group_count${aggregateSql}
             FROM roast_library_rows
            WHERE ${where}
            GROUP BY group_value, group_label
            ORDER BY group_value ${spec.direction.toUpperCase()} NULLS LAST
            LIMIT ? OFFSET ?`
        )
        .all(
          ...(params as Array<string | number>),
          query.page.first + 1,
          offset
        ) as LibraryRow[]
      const hasNextPage = rows.length > query.page.first
      const pageRows = rows.slice(0, query.page.first)
      return {
        kind: "groups" as const,
        scope: groupPath,
        groups: pageRows.map((row) => {
          const value = row.group_value ?? null
          const key = group.key(value)
          return {
            path: [...groupPath, { field: spec.field, key }],
            key,
            label: group.label(value, row.group_label ?? null),
            count: Number(row.group_count),
            aggregates: aggregatePlan.read(row),
          }
        }),
        pageInfo: {
          hasNextPage,
          ...(hasNextPage
            ? {
                endCursor: this.cursors.issue(
                  "roast-library",
                  queryHash,
                  offset + query.page.first
                ),
              }
            : {}),
        },
      }
    }

    const sorts = query.sorts.length
      ? query.sorts
      : [
          {
            field: "roastedAt" as const,
            direction: "desc" as const,
            nulls: "last" as const,
          },
        ]
    const orderParts = sorts.map((sort) => {
      const column = fieldColumns[sort.field]
      return `${column} ${sort.direction.toUpperCase()} NULLS ${sort.nulls.toUpperCase()}`
    })
    if (!sorts.some((sort) => sort.field === "roastId"))
      orderParts.push("roast_id ASC")

    const selectColumns = new Set<RoastLibraryField>([
      "roastId",
      ...query.columns,
    ])
    const sqlColumns = [...selectColumns].map(
      (field) => `${fieldColumns[field]} AS ${fieldColumns[field]}`
    )
    const rows = this.database
      .query(
        `SELECT revision, ${sqlColumns.join(", ")} FROM roast_library_rows
              WHERE ${where} ORDER BY ${orderParts.join(", ")} LIMIT ? OFFSET ?`
      )
      .all(
        ...(params as Array<string | number>),
        query.page.first + 1,
        offset
      ) as LibraryRow[]

    const hasNextPage = rows.length > query.page.first
    const pageRows = rows.slice(0, query.page.first)
    const aggregates = aggregatePlan.selections.length
      ? aggregatePlan.read(
          this.database
            .query(
              `SELECT ${aggregatePlan.selections.join(", ")}
                 FROM roast_library_rows WHERE ${where}`
            )
            .get(...(params as Array<string | number>)) as LibraryRow
        )
      : {}

    return {
      kind: "rows" as const,
      scope: groupPath,
      rows: pageRows.map((row) => ({
        roastId: String(row.roast_id),
        revision: Number(row.revision),
        values: Object.fromEntries(
          query.columns.map((field) => [
            field,
            toPublicValue(field, row[fieldColumns[field]] ?? null),
          ])
        ),
      })),
      aggregates,
      pageInfo: {
        hasNextPage,
        ...(hasNextPage
          ? {
              endCursor: this.cursors.issue(
                "roast-library",
                queryHash,
                offset + query.page.first
              ),
            }
          : {}),
      },
    }
  }
}
