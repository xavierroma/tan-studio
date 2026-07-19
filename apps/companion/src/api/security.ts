import { timingSafeEqual } from "node:crypto"
import type { MiddlewareHandler } from "hono"
import { ApiError } from "./problem"

export type SecurityOptions = {
  launchToken: string
  allowedOrigins: string[]
  allowedHosts: string[]
  allowedClientIds?: string[]
  allowOriginlessRequests?: boolean
  development?: boolean
}

function tokenMatches(received: string, expected: string): boolean {
  const left = Buffer.from(received)
  const right = Buffer.from(expected)
  return left.length === right.length && timingSafeEqual(left, right)
}

function unauthorized(
  detail = "A valid companion launch token is required."
): ApiError {
  return new ApiError({
    status: 401,
    code: "unauthenticated",
    title: "Authentication required",
    detail,
  })
}

export function securityMiddleware(
  options: SecurityOptions
): MiddlewareHandler {
  return async (c, next) => {
    const host = (c.req.header("host") ?? new URL(c.req.url).host).toLowerCase()
    if (
      !host ||
      !options.allowedHosts.some((allowed) => allowed.toLowerCase() === host)
    ) {
      throw new ApiError({
        status: 403,
        code: "host_not_allowed",
        title: "Host not allowed",
        detail: "The request Host is not an assigned Tan Studio authority.",
      })
    }

    const origin = c.req.header("origin")
    if (
      (origin && !options.allowedOrigins.includes(origin)) ||
      (!origin && !options.allowOriginlessRequests)
    ) {
      throw new ApiError({
        status: 403,
        code: "origin_not_allowed",
        title: "Origin not allowed",
        detail:
          "The request Origin is not authorized for this companion session.",
      })
    }

    if (c.req.method === "OPTIONS") {
      if (!origin) {
        throw new ApiError({
          status: 403,
          code: "origin_not_allowed",
          title: "Origin not allowed",
          detail: "CORS preflight requires an authorized Origin.",
        })
      }
      c.header("Access-Control-Allow-Origin", origin)
      c.header("Vary", "Origin")
      c.header(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, X-Tan-Studio-Client, If-Match, Idempotency-Key, X-Correlation-Id"
      )
      c.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PATCH, DELETE, OPTIONS"
      )
      c.header("Access-Control-Max-Age", "600")
      return c.body(null, 204)
    }

    const allowedClientIds =
      options.allowedClientIds ??
      (options.development
        ? ["desktop-v1", "tan-studio-browser-dev"]
        : ["desktop-v1"])
    if (!allowedClientIds.includes(c.req.header("x-tan-studio-client") ?? "")) {
      throw unauthorized(
        "The Tan Studio client identity header is missing or invalid."
      )
    }
    const authorization = c.req.header("authorization")
    if (!authorization?.startsWith("Bearer ")) throw unauthorized()
    const receivedToken = authorization.slice("Bearer ".length)
    if (!tokenMatches(receivedToken, options.launchToken)) throw unauthorized()

    if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
      const contentType = c.req
        .header("content-type")
        ?.split(";", 1)[0]
        ?.trim()
        .toLowerCase()
      if (contentType !== "application/json") {
        throw new ApiError({
          status: 400,
          code: "unsupported_content_type",
          title: "Unsupported content type",
          detail: "This mutation endpoint accepts application/json only.",
        })
      }
    }

    if (origin) {
      c.header("Access-Control-Allow-Origin", origin)
      c.header("Vary", "Origin")
    }
    await next()
  }
}
