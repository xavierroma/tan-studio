import { ApplicationError } from "../errors"
import type {
  RoastFilterExpression,
  RoastLibraryQuery,
  RoastLibraryReadModel,
  RoastLibraryResult,
} from "../ports/roast-library"

function filterStats(
  filter: RoastFilterExpression,
  depth = 1
): { depth: number; leaves: number } {
  if (filter.op === "and" || filter.op === "or") {
    return filter.clauses.reduce(
      (stats, clause) => {
        const nested = filterStats(clause, depth + 1)
        return {
          depth: Math.max(stats.depth, nested.depth),
          leaves: stats.leaves + nested.leaves,
        }
      },
      { depth, leaves: 0 }
    )
  }
  if (filter.op === "not") return filterStats(filter.clause, depth + 1)
  if (filter.op === "search" && [...filter.query].length > 512) {
    throw new ApplicationError(
      "validation",
      "search_too_long",
      "Search query exceeds 512 code points",
      { field: "filters/query" }
    )
  }
  if (filter.op === "field") {
    const values = Array.isArray(filter.value) ? filter.value : [filter.value]
    if (values.length > 200) {
      throw new ApplicationError(
        "validation",
        "filter_list_too_long",
        "A filter list may contain at most 200 values",
        { field: "filters/value" }
      )
    }
    for (const value of values) {
      if (typeof value === "string" && [...value].length > 256) {
        throw new ApplicationError(
          "validation",
          "filter_value_too_long",
          "A filter value exceeds 256 code points",
          { field: "filters/value" }
        )
      }
    }
  }
  return { depth, leaves: 1 }
}

export class QueryRoastLibrary {
  constructor(private readonly readModel: RoastLibraryReadModel) {}

  async execute(
    query: RoastLibraryQuery,
    signal?: AbortSignal
  ): Promise<RoastLibraryResult> {
    if (
      !Number.isSafeInteger(query.page.first) ||
      query.page.first < 1 ||
      query.page.first > 200
    ) {
      throw new ApplicationError(
        "validation",
        "invalid_page_size",
        "Page size must be between 1 and 200",
        { field: "page/first" }
      )
    }
    if (query.groups.length > 3) {
      throw new ApplicationError(
        "validation",
        "too_many_groups",
        "At most three grouping levels are supported",
        { field: "groups" }
      )
    }
    if (query.sorts.length > 5) {
      throw new ApplicationError(
        "validation",
        "too_many_sorts",
        "At most five sort fields are supported",
        { field: "sorts" }
      )
    }
    if (query.columns.length === 0 || query.columns.length > 50) {
      throw new ApplicationError(
        "validation",
        "invalid_columns",
        "Between one and fifty columns are required",
        { field: "columns" }
      )
    }
    if (query.aggregates.length > 20) {
      throw new ApplicationError(
        "validation",
        "too_many_aggregates",
        "At most twenty aggregates are supported",
        { field: "aggregates" }
      )
    }
    const stats = filterStats(query.filters)
    if (stats.depth > 5) {
      throw new ApplicationError(
        "validation",
        "filter_too_deep",
        "Filter depth may not exceed five",
        { field: "filters" }
      )
    }
    if (stats.leaves > 100) {
      throw new ApplicationError(
        "validation",
        "too_many_filter_leaves",
        "A filter may have at most one hundred leaves",
        { field: "filters" }
      )
    }
    if (signal?.aborted === true) {
      throw new ApplicationError(
        "conflict",
        "query_cancelled",
        "Roast library query was cancelled",
        { retryable: true }
      )
    }
    return this.readModel.query(query, signal)
  }
}
