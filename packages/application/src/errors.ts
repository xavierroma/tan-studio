import { DomainRuleError } from "@tan-studio/domain"

export type ApplicationErrorCategory =
  | "validation"
  | "not_found"
  | "conflict"
  | "capability_denied"
  | "resource_busy"
  | "external_unavailable"
  | "integrity_failure"
  | "unsafe_target"
  | "internal"

export type ApplicationErrorOptions = Readonly<{
  retryable?: boolean
  field?: string | null
  details?: Readonly<Record<string, string | number | boolean | null>>
  cause?: unknown
}>

export class ApplicationError extends Error {
  readonly name = "ApplicationError"
  readonly retryable: boolean
  readonly field: string | null
  readonly details: Readonly<Record<string, string | number | boolean | null>>
  override readonly cause: unknown

  constructor(
    readonly category: ApplicationErrorCategory,
    readonly code: string,
    message: string,
    options: ApplicationErrorOptions = {}
  ) {
    super(message)
    this.retryable = options.retryable ?? false
    this.field = options.field ?? null
    this.details = options.details ?? {}
    this.cause = options.cause
  }
}

export function mapDomainError(error: unknown): never {
  if (error instanceof DomainRuleError) {
    throw new ApplicationError("validation", error.code, error.message, {
      field: error.field,
      details: error.details,
      cause: error,
    })
  }
  throw error
}

export function notFound(
  code: string,
  message: string,
  field: string
): ApplicationError {
  return new ApplicationError("not_found", code, message, { field })
}

export function conflict(
  code: string,
  message: string,
  field: string
): ApplicationError {
  return new ApplicationError("conflict", code, message, { field })
}
