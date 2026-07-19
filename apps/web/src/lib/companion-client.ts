import createClient from "openapi-fetch"

import type { paths } from "@/generated/api"

declare global {
  interface Window {
    __TAN_STUDIO_BOOTSTRAP__?: {
      apiOrigin: string
      token: string
      clientId: string
    }
  }
}

const browserBootstrap =
  typeof window === "undefined" ? undefined : window.__TAN_STUDIO_BOOTSTRAP__

export const companionOrigin =
  browserBootstrap?.apiOrigin ??
  import.meta.env.VITE_COMPANION_ORIGIN ??
  (import.meta.env.DEV ? "http://127.0.0.1:4317" : undefined)

const companionToken =
  browserBootstrap?.token ??
  import.meta.env.VITE_COMPANION_TOKEN ??
  (import.meta.env.DEV ? "tan-studio-development-only" : undefined)

export const companionClient = createClient<paths>({
  baseUrl: companionOrigin,
  fetch: (request) => globalThis.fetch(request),
  ...(companionToken
    ? {
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${companionToken}`,
          "Content-Type": "application/json",
          "X-Tan-Studio-Client":
            browserBootstrap?.clientId ?? "tan-studio-browser-dev",
        },
      }
    : {}),
})

type ApiResponse<T> = {
  data?: T
  error?: unknown
  response: Response
}

export function requireCompanion(): void {
  if (!companionOrigin || !companionToken) {
    throw new Error("Companion bootstrap is unavailable")
  }
}

export function unwrapResponse<T>(result: ApiResponse<T>): T {
  if (result.data !== undefined) return result.data

  const problem = record(result.error)
  throw new Error(
    optionalText(problem.detail) ??
      optionalText(problem.title) ??
      `Companion request failed (${result.response.status})`
  )
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}
