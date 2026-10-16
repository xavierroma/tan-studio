import { createHostedHandler, productionOptions, BODY_LIMIT } from "./http"

const socket = process.env.TAN_STUDIO_MCP_AUTH_SOCKET
if (
  process.env.TAN_STUDIO_MCP_ENABLED !== "1" ||
  !socket?.startsWith("/") ||
  process.env.TAN_STUDIO_API_TOKEN ||
  process.env.TAN_STUDIO_TOKEN_FILE ||
  process.env.TAN_STUDIO_URL
)
  throw new Error(
    "Hosted MCP requires explicit enablement and its private auth socket; global API credentials are forbidden"
  )
const options = productionOptions(socket),
  handle = createHostedHandler(options)
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 8082,
  maxRequestBodySize: BODY_LIMIT,
  idleTimeout: 25,
  async fetch(request, server) {
    const path = new URL(request.url).pathname
    if (request.method === "GET" && path === "/healthz")
      return Response.json({ status: "ok" })
    if (request.method === "GET" && path === "/readyz")
      return new Response(null, { status: (await options.ready()) ? 204 : 503 })
    // Only Caddy connects in production. Its trusted replacement IP header is
    // accepted only on this private listener; public header stripping is required.
    return handle(
      request,
      request.headers.get("x-tan-client-ip") ??
        server.requestIP(request)?.address ??
        "unknown"
    )
  },
})
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    void server.stop(false)
  })
