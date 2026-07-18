export type DomainErrorDetails = Readonly<
  Record<string, string | number | boolean | null>
>

export class DomainRuleError extends Error {
  readonly name = "DomainRuleError"

  constructor(
    readonly code: string,
    message: string,
    readonly field: string | null = null,
    readonly details: DomainErrorDetails = {}
  ) {
    super(message)
  }
}

export function invariant(
  condition: unknown,
  code: string,
  message: string,
  field: string | null = null,
  details: DomainErrorDetails = {}
): asserts condition {
  if (!condition) {
    throw new DomainRuleError(code, message, field, details)
  }
}
