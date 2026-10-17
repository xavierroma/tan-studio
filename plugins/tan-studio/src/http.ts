import { createMcpHandler } from "@modelcontextprotocol/server"
import { OpenApiTanStudioGateway } from "./api"
import { createTanStudioServer } from "./mcp"
import type { TanStudioGateway } from "./gateway"
import { apiOperations } from "./operations"

export const BODY_LIMIT = 256 * 1024
const RESPONSE_LIMIT = 1024 * 1024
const READ_TOOLS = new Set([
  ...apiOperations.filter((op) => op.method === "GET").map((op) => op.name),
  "tan_status",
  "tan_list_pantry",
  "tan_search_profiles",
  "tan_search_coffees",
  "tan_search_roasts",
  "tan_get_context",
  "tan_get_roast",
  "tan_list_attachments",
])
const WRITE_TOOLS = new Set([
  ...apiOperations.filter((op) => op.method !== "GET").map((op) => op.name),
  "tan_create_coffee",
  "tan_update_coffee",
  "tan_update_roast",
  "tan_record_brew",
  "tan_update_brew",
  "tan_add_note",
  "tan_set_profile_image",
  "tan_create_label",
])
const METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "server/discover",
  "ping",
  "tools/list",
  "tools/call",
  "resources/list",
  "resources/templates/list",
  "resources/read",
])
export interface Principal {
  agentId: number
  write: boolean
  token: string | null
}
export interface Rpc {
  jsonrpc: "2.0"
  id?: string | number
  method: string
  params?: {
    name?: string
    uri?: string
    arguments?: unknown
    [key: string]: unknown
  }
}
export interface HttpOptions {
  delegate: (token: string, rpc: Rpc, signal: AbortSignal) => Promise<Principal>
  gateway: (
    principal: Principal,
    signal: AbortSignal,
    correlationId: string
  ) => TanStudioGateway
  ready: () => Promise<boolean>
  log?: (event: Record<string, unknown>) => void
}
export class HttpFailure extends Error {
  constructor(
    public status: number,
    public code: string
  ) {
    super(code)
  }
}
function problem(
  status: number,
  code: string,
  correlationId: string
): Response {
  return Response.json(
    { error: code, correlationId },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "X-Correlation-Id": correlationId,
        ...(status === 401
          ? { "WWW-Authenticate": 'Bearer realm="tan-studio-mcp"' }
          : {}),
        ...(status === 429 ? { "Retry-After": "60" } : {}),
        ...(status === 405 ? { Allow: "POST, OPTIONS" } : {}),
      },
    }
  )
}
async function bounded(
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
  signal?: AbortSignal
): Promise<Uint8Array> {
  if (!stream) return new Uint8Array()
  const reader = stream.getReader()
  const parts: Uint8Array[] = []
  let length = 0
  const abort = () => {
    void reader.cancel()
  }
  signal?.addEventListener("abort", abort, { once: true })
  try {
    for (;;) {
      if (signal?.aborted)
        throw new HttpFailure(504, "request_timeout_outcome_unknown")
      const part = await reader.read()
      if (part.done) break
      length += part.value.byteLength
      if (length > limit) {
        await reader.cancel()
        throw new HttpFailure(413, "body_too_large")
      }
      parts.push(part.value)
    }
  } finally {
    signal?.removeEventListener("abort", abort)
    reader.releaseLock()
  }
  if (signal?.aborted)
    throw new HttpFailure(504, "request_timeout_outcome_unknown")
  const output = new Uint8Array(length)
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}
function checkDepth(value: unknown, depth = 0): void {
  if (depth > 32) throw new HttpFailure(400, "json_too_deep")
  if (value && typeof value === "object")
    for (const child of Object.values(value)) checkDepth(child, depth + 1)
}
class Admission {
  private counts = new Map<string, { time: number; tokens: number }>()
  constructor(
    private capacity: number,
    private perMinute: number
  ) {}
  accept(key: string): boolean {
    const time = Date.now()
    const prior = this.counts.get(key) ?? { time, tokens: this.capacity }
    prior.tokens = Math.min(
      this.capacity,
      prior.tokens + ((time - prior.time) * this.perMinute) / 60000
    )
    prior.time = time
    for (const [id, v] of this.counts)
      if (time - v.time > 120000) this.counts.delete(id)
    if (this.counts.size >= 4096 && !this.counts.has(key)) return false
    this.counts.set(key, prior)
    if (prior.tokens < 1) return false
    prior.tokens--
    return true
  }
}
export function createHostedHandler(options: HttpOptions) {
  let active = 0
  const perAgent = new Map<number, number>()
  const ips = new Admission(30, 30),
    agents = new Admission(10, 60)
  return async (request: Request, peer = "unknown"): Promise<Response> => {
    const correlationId = crypto.randomUUID(),
      started = Date.now()
    const url = new URL(request.url)
    // These checks are also applied behind Caddy; incoming forwarding headers are never identity.
    if (request.headers.get("host") !== "studio.tan.coffee")
      return problem(403, "host_not_allowed", correlationId)
    const origin = request.headers.get("origin")
    if (origin !== null && origin !== "https://studio.tan.coffee")
      return problem(403, "origin_not_allowed", correlationId)
    if (url.pathname !== "/mcp" || url.search)
      return problem(404, "not_found", correlationId)
    if (request.method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: origin
          ? {
              "Access-Control-Allow-Origin": origin,
              "Access-Control-Allow-Methods": "POST, OPTIONS",
              "Access-Control-Allow-Headers":
                "Authorization, Content-Type, Accept, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
              Vary: "Origin",
            }
          : {},
      })
    if (!ips.accept(peer) || active >= 16)
      return problem(429, "capacity_exceeded", correlationId)
    const bearer = request.headers.get("authorization")
    if (!bearer || !/^Bearer tsmcp_[a-fA-F0-9]{64}$/.test(bearer))
      return problem(401, "invalid_agent_credential", correlationId)
    if (request.method !== "POST")
      return problem(405, "method_not_allowed", correlationId)
    if (
      request.headers.get("content-type")?.split(";")[0]?.trim() !==
      "application/json"
    )
      return problem(415, "json_required", correlationId)
    const accept = request.headers.get("accept") ?? ""
    if (
      !accept.includes("application/json") ||
      !accept.includes("text/event-stream")
    )
      return problem(406, "accept_json_and_sse", correlationId)
    active++
    let principal: Principal | undefined,
      admitted = false,
      handler: ReturnType<typeof createMcpHandler> | undefined
    const controller = new AbortController(),
      signal = AbortSignal.any([request.signal, controller.signal])
    const timer = setTimeout(() => controller.abort(), 20000)
    let status = 500,
      method = "unknown"
    try {
      const bytes = await Promise.race([
        bounded(request.body, BODY_LIMIT, signal),
        new Promise<never>((_, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new HttpFailure(504, "request_timeout")),
            { once: true }
          )
        ),
      ])
      let body: unknown
      try {
        body = JSON.parse(new TextDecoder().decode(bytes))
      } catch {
        throw new HttpFailure(400, "invalid_json")
      }
      checkDepth(body)
      if (!body || typeof body !== "object" || Array.isArray(body))
        throw new HttpFailure(400, "single_rpc_required")
      const rpc = body as Rpc
      if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string")
        throw new HttpFailure(400, "invalid_rpc")
      method = rpc.method
      // The SDK owns protocol metadata validation. Its factory is only invoked after
      // successful modern classification/header validation. Legacy grants are also
      // based on parsed body, never unverified MCP-name headers.
      handler = createMcpHandler(
        async () => {
          if (!principal) throw new HttpFailure(401, "invalid_agent_credential")
          return createTanStudioServer(
            options.gateway(principal, signal, correlationId),
            { hosted: true, write: principal.write }
          )
        },
        {
          legacy: "stateless",
          responseMode: "auto",
          maxSubscriptions: 0,
          maxRequestBodySize: BODY_LIMIT,
          onerror: () => {},
        }
      )
      // SDK factory exceptions may become protocol errors. Authenticate before
      // entering the transport, so auth failures remain HTTP 401/403.
      if (!METHODS.has(rpc.method))
        throw new HttpFailure(403, "unsupported_operation")
      if (
        rpc.method === "tools/call" &&
        !READ_TOOLS.has(rpc.params?.name ?? "") &&
        !WRITE_TOOLS.has(rpc.params?.name ?? "")
      )
        throw new HttpFailure(403, "unsupported_tool")
      principal = await options.delegate(bearer.slice(7), rpc, signal)
      if (
        !Number.isSafeInteger(principal.agentId) ||
        typeof principal.write !== "boolean"
      )
        throw new HttpFailure(503, "invalid_authority_response")
      if (
        rpc.method === "tools/call" &&
        WRITE_TOOLS.has(rpc.params?.name ?? "") &&
        !principal.write
      )
        throw new HttpFailure(403, "insufficient_scope")
      if (
        !agents.accept(String(principal.agentId)) ||
        (perAgent.get(principal.agentId) ?? 0) >= 4
      )
        throw new HttpFailure(429, "agent_capacity_exceeded")
      perAgent.set(
        principal.agentId,
        (perAgent.get(principal.agentId) ?? 0) + 1
      )
      admitted = true
      const response = await handler.fetch(request, { parsedBody: body })
      if (signal.aborted)
        throw new HttpFailure(504, "request_timeout_outcome_unknown")
      const output = await bounded(response.body, RESPONSE_LIMIT, signal).catch(
        (error: unknown) => {
          if (
            rpc.method === "tools/call" &&
            WRITE_TOOLS.has(rpc.params?.name ?? "")
          )
            throw new HttpFailure(
              502,
              "response_unavailable_write_outcome_unknown"
            )
          throw error
        }
      )
      status = response.status
      const headers = new Headers(response.headers)
      headers.set("Cache-Control", "no-store")
      headers.set("X-Correlation-Id", correlationId)
      if (origin) {
        headers.set("Access-Control-Allow-Origin", origin)
        headers.set("Vary", "Origin")
      }
      return new Response(
        response.status === 202 ? null : (output.buffer as ArrayBuffer),
        { status: response.status, headers }
      )
    } catch (error) {
      status =
        error instanceof HttpFailure ? error.status : signal.aborted ? 504 : 503
      return problem(
        status,
        error instanceof HttpFailure
          ? error.code
          : signal.aborted
            ? "request_timeout_outcome_unknown"
            : "mcp_unavailable",
        correlationId
      )
    } finally {
      clearTimeout(timer)
      controller.abort()
      await handler?.close()
      active--
      if (admitted && principal) {
        const n = (perAgent.get(principal.agentId) ?? 1) - 1
        if (n === 0) perAgent.delete(principal.agentId)
        else perAgent.set(principal.agentId, n)
      }
      options.log?.({
        event: "mcp_request",
        correlationId,
        agentId: principal?.agentId,
        method,
        status,
        durationMs: Date.now() - started,
      })
    }
  }
}
export function productionOptions(socket: string): HttpOptions {
  return {
    async delegate(token, rpc, signal) {
      const response = await fetch("http://localhost/internal/mcp/delegate", {
        unix: socket,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          method: rpc.method,
          name: rpc.params?.name ?? null,
          uri: rpc.params?.uri ?? null,
          arguments: rpc.params?.arguments ?? null,
        }),
        signal,
        redirect: "error",
      })
      if (!response.ok)
        throw new HttpFailure(
          response.status === 401 ? 401 : response.status === 403 ? 403 : 503,
          response.status === 401
            ? "invalid_agent_credential"
            : response.status === 403
              ? "insufficient_scope"
              : "authority_unavailable"
        )
      return (await response.json()) as Principal
    },
    gateway(principal, signal, correlationId) {
      return new OpenApiTanStudioGateway(
        {
          baseUrl: "http://127.0.0.1:8080",
          token: principal.token ?? "no-data-delegation",
          timeoutMs: 15000,
        },
        fetch,
        { signal, correlationId, host: "studio.tan.coffee" }
      )
    },
    async ready() {
      try {
        const probes = await Promise.all([
          fetch("http://localhost/readyz", {
            unix: socket,
            signal: AbortSignal.timeout(1000),
            redirect: "error",
          }),
          fetch("http://127.0.0.1:8080/healthz", {
            headers: { Host: "studio.tan.coffee" },
            signal: AbortSignal.timeout(1000),
            redirect: "error",
          }),
        ])
        return probes.every((response) => response.ok)
      } catch {
        return false
      }
    },
    log: (event) => console.info(JSON.stringify(event)),
  }
}
