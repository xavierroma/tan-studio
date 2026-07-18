import type { Context, ErrorHandler, NotFoundHandler } from "hono"
import { ZodError } from "zod"

export type FieldError = {
  path: string
  code: string
  message: string
}

export type ApiProblemBody = {
  type: string
  title: string
  status: number
  detail: string
  instance: string
  code: string
  correlationId: string
  retryable: boolean
  fieldErrors?: FieldError[]
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly title: string
  readonly retryable: boolean
  readonly fieldErrors: FieldError[] | undefined

  constructor(options: {
    status: number
    code: string
    title: string
    detail: string
    retryable?: boolean
    fieldErrors?: FieldError[]
  }) {
    super(options.detail)
    this.name = "ApiError"
    this.status = options.status
    this.code = options.code
    this.title = options.title
    this.retryable = options.retryable ?? false
    this.fieldErrors = options.fieldErrors
  }
}

function pointerSegment(value: PropertyKey): string {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1")
}

export function validationError(error: ZodError): ApiError {
  return new ApiError({
    status: 422,
    code: "validation_failed",
    title: "Validation failed",
    detail: "The request contains invalid values.",
    fieldErrors: error.issues.map((issue) => ({
      path:
        issue.path.length === 0
          ? ""
          : `/${issue.path.map(pointerSegment).join("/")}`,
      code: issue.code,
      message: issue.message,
    })),
  })
}

export function notFound(kind: string, id: string): ApiError {
  return new ApiError({
    status: 404,
    code: `${kind}_not_found`,
    title: "Resource not found",
    detail: `The requested ${kind} does not exist: ${id}`,
  })
}

export function revisionConflict(
  expected: string,
  received: string | undefined
): ApiError {
  return new ApiError({
    status: 412,
    code: "revision_precondition_failed",
    title: "Revision precondition failed",
    detail: received
      ? `The resource changed. Expected ${expected}, received ${received}.`
      : "This mutation requires an If-Match revision header.",
  })
}

function problemResponse(c: Context, error: ApiError): Response {
  const correlationId = c.get("correlationId") as string | undefined
  const body: ApiProblemBody = {
    type: `https://tan.studio/problems/${error.code.replaceAll("_", "-")}`,
    title: error.title,
    status: error.status,
    detail: error.message,
    instance: c.req.path,
    code: error.code,
    correlationId: correlationId ?? "unknown",
    retryable: error.retryable,
    ...(error.fieldErrors
      ? { fieldErrors: error.fieldErrors }
      : error.status === 422
        ? {
            fieldErrors: [
              { path: "", code: error.code, message: error.message },
            ],
          }
        : {}),
  }

  return new Response(JSON.stringify(body), {
    status: error.status,
    headers: {
      "content-type": "application/problem+json",
      "cache-control": "no-store",
      "x-correlation-id": body.correlationId,
    },
  })
}

export const apiErrorHandler: ErrorHandler = (error, c) => {
  if (error instanceof ApiError) return problemResponse(c, error)

  if (error instanceof SyntaxError) {
    return problemResponse(
      c,
      new ApiError({
        status: 400,
        code: "malformed_json",
        title: "Malformed JSON",
        detail: "The request body is not valid JSON.",
      })
    )
  }

  console.error("Unexpected companion error", {
    correlationId: c.get("correlationId"),
    name: error.name,
    message: error.message,
  })
  return problemResponse(
    c,
    new ApiError({
      status: 500,
      code: "internal_error",
      title: "Unexpected error",
      detail: "Tan Studio could not complete the request.",
      retryable: false,
    })
  )
}

export const apiNotFoundHandler: NotFoundHandler = (c) =>
  problemResponse(
    c,
    new ApiError({
      status: 404,
      code: "route_not_found",
      title: "Route not found",
      detail: "The requested API route does not exist.",
    })
  )
