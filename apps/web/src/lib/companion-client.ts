import createClient from "openapi-fetch"

import type { paths } from "@/generated/api"

declare global {
  interface Window {
    __TAN_STUDIO_BOOTSTRAP__?: {
      apiOrigin: string
      /** `null` in hosted mode, where the operator session is an HttpOnly cookie. */
      token?: string | null
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

/**
 * Hosted mode serves the SPA with no token in the HTML: the operator authenticates
 * with Sign in with Google and the browser carries the session cookie instead.
 */
export const usesOperatorSession =
  Boolean(browserBootstrap) && !browserBootstrap?.token

const companionToken = browserBootstrap
  ? (browserBootstrap.token ?? undefined)
  : (import.meta.env.VITE_COMPANION_TOKEN ??
    (import.meta.env.DEV ? "tan-studio-development-only" : undefined))

const clientHeaders: Record<string, string> = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "X-Tan-Studio-Client":
    browserBootstrap?.clientId ??
    (usesOperatorSession ? "tan-studio-hosted-v1" : "tan-studio-browser-dev"),
}
if (companionToken) {
  clientHeaders.Authorization = `Bearer ${companionToken}`
}

export const companionClient = createClient<paths>({
  baseUrl: companionOrigin,
  credentials: "same-origin",
  fetch: (request) => globalThis.fetch(request),
  headers: clientHeaders,
})

type ApiResponse<T> = {
  data?: T
  error?: unknown
  response: Response
}

export function requireCompanion(): void {
  if (!companionOrigin || (!companionToken && !usesOperatorSession)) {
    throw new Error("Companion bootstrap is unavailable")
  }
}

/**
 * Whether the operator session cookie is currently accepted. The cookie is HttpOnly,
 * so the only honest answer comes from asking the canonical backend.
 */
export async function fetchOperatorSignedIn(): Promise<boolean> {
  const { response } = await companionClient.GET("/api/v1/system/bootstrap")
  return response.ok
}

export function unwrapResponse<T>(result: ApiResponse<T>): T {
  if (result.data !== undefined) return result.data
  if (result.response.status === 204) return undefined as T

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
