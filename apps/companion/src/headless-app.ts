import { extname, join, resolve, sep } from "node:path"

type ApiFetcher = {
  fetch(request: Request): Response | Promise<Response>
}

export type HeadlessHandlerOptions = {
  api: ApiFetcher
  webRoot: string
  token: string
  allowedHosts: readonly string[]
  applicationVersion: string
  health: () => Record<string, unknown>
}

const textEncoder = new TextEncoder()

export function createHeadlessHandler(options: HeadlessHandlerOptions) {
  const webRoot = resolve(options.webRoot)
  const allowedHosts = new Set(
    options.allowedHosts.map((authority) => authority.toLowerCase())
  )
  const indexHtml = loadIndexHtml(webRoot, options.token)

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)
    if (!allowedHosts.has(url.host.toLowerCase())) {
      return jsonResponse(
        {
          status: 403,
          code: "host_not_allowed",
          title: "Host not allowed",
        },
        403
      )
    }

    if (url.pathname === "/healthz") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response(null, {
          status: 405,
          headers: { Allow: "GET, HEAD" },
        })
      }
      const body = {
        status: "ok",
        applicationVersion: options.applicationVersion,
        ...options.health(),
      }
      return request.method === "HEAD"
        ? new Response(null, { headers: healthHeaders() })
        : jsonResponse(body, 200)
    }

    if (url.pathname === "/api/v1" || url.pathname.startsWith("/api/v1/")) {
      return options.api.fetch(request)
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, {
        status: 405,
        headers: { Allow: "GET, HEAD" },
      })
    }

    const relativePath = safeRelativePath(url.pathname)
    if (relativePath === undefined)
      return new Response("Not found", { status: 404 })

    if (relativePath.length > 0) {
      const candidate = resolve(webRoot, relativePath)
      if (candidate.startsWith(`${webRoot}${sep}`)) {
        const file = Bun.file(candidate)
        if (await file.exists()) {
          const headers = staticHeaders(file.type, relativePath)
          return request.method === "HEAD"
            ? new Response(null, { headers })
            : new Response(file, { headers })
        }
      }
      if (extname(relativePath) !== "") {
        return new Response("Not found", {
          status: 404,
          headers: baseSecurityHeaders(),
        })
      }
    }

    const html = await indexHtml
    const headers = new Headers(baseSecurityHeaders())
    headers.set("Content-Type", "text/html; charset=utf-8")
    headers.set("Cache-Control", "no-store")
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'none'; connect-src 'self' ws: wss:; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'"
    )
    return request.method === "HEAD"
      ? new Response(null, { headers })
      : new Response(html, { headers })
  }
}

async function loadIndexHtml(webRoot: string, token: string): Promise<string> {
  const indexPath = join(webRoot, "index.html")
  const file = Bun.file(indexPath)
  if (!(await file.exists())) {
    throw new Error(`Tan Studio web index is missing at ${indexPath}`)
  }
  const source = await file.text()
  const closingHead = source.indexOf("</head>")
  if (closingHead < 0)
    throw new Error("Tan Studio web index has no closing head")
  const bootstrap = `<script>Object.defineProperty(window,"__TAN_STUDIO_BOOTSTRAP__",{value:Object.freeze({apiOrigin:window.location.origin,token:${JSON.stringify(token)},clientId:"tan-studio-lan-v1"}),enumerable:false,configurable:false,writable:false});</script>`
  return `${source.slice(0, closingHead)}${bootstrap}${source.slice(closingHead)}`
}

function safeRelativePath(pathname: string): string | undefined {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return undefined
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return undefined
  const segments = decoded.split("/").filter(Boolean)
  if (segments.some((segment) => segment === "." || segment === "..")) {
    return undefined
  }
  return segments.join("/")
}

function staticHeaders(contentType: string, relativePath: string): Headers {
  const headers = new Headers(baseSecurityHeaders())
  headers.set("Content-Type", contentType || "application/octet-stream")
  headers.set(
    "Cache-Control",
    relativePath.startsWith("assets/")
      ? "public, max-age=31536000, immutable"
      : "no-cache"
  )
  return headers
}

function baseSecurityHeaders(): HeadersInit {
  return {
    "Cross-Origin-Resource-Policy": "same-origin",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
  }
}

function healthHeaders(): HeadersInit {
  return {
    ...baseSecurityHeaders(),
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  }
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(textEncoder.encode(JSON.stringify(body)), {
    status,
    headers: healthHeaders(),
  })
}
