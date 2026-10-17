# ADR 0009 — Hosted MCP with per-agent authority

Status: Accepted and deployed with operator approval on 2026-10-17.

## Context

The existing stdio MCP adapter already translates curated notebook tools to the generated Rust REST API. The hosted notebook has Google operator sessions and general REST API tokens (ADR 0004), but neither is a suitable scoped credential for a remote agent. A network adapter must not acquire a shared operator token or filesystem access.

Upstream ADR 0008 and migration 15 remain unchanged: the authenticated hosted bridge WebSocket, operator-only bridge enrollment/revocation, and TLS compatibility settings coexist with MCP. MCP uses migration 16.

## Decision

Serve Streamable HTTP at `https://studio.tan.coffee/mcp` through Caddy and a separate, loopback-only Bun service. Keep one shared MCP controller and generated gateway. Keep filesystem attachment upload in the stdio entrypoint only. Device synchronization and local file attachment are absent from the hosted catalog.

The first milestone uses custom bearer credentials, not OAuth. Clients must support an explicitly configured Authorization header. Official SDK 2.3.1 implements MCP 2026-07-28 and stateless compatibility for 2025-11-25. JSON and finite request-scoped SSE responses are supported; no sessions, resumable streams, background notifications, subscriptions, or GET stream are exposed.

Only an authenticated operator session can create, list, or revoke MCP credentials. Each is audience-bound to the MCP URL, hashed at rest, read-only by default, and expires after 1–90 days (default 30), or an explicitly selected five calendar years. Calendar expiry preserves the UTC time and clamps February 29 to February 28 when needed. The operator approved this longer term on 2026-10-17; request, delegation, rate and concurrency limits remain unchanged. Write permission enables eight additional notebook tools. ADR 0004 tokens keep their REST behavior; they are not accepted by the hosted MCP service.

Rust owns authentication and authorization. A private Unix socket exchanges a validated MCP credential and parsed operation for a delegation valid for at most 60 seconds, addressed to the REST API, and restricted to exact HTTP method/path pairs. Rust REST checks the parent credential and version on every request. Revocation blocks subsequent authorizations immediately; work already authorized may finish. Note attribution comes from the authenticated principal, overriding caller-supplied attribution.

The delegation signing key is generated in Rust memory on each service start. This intentionally avoids provisioning another persistent secret: restart invalidates only in-flight delegations, while persisted MCP credentials survive. Bun receives neither this key nor operator credentials, database files or backup keys. Socket permissions give only the dedicated MCP Unix group access.

Deployment packages both adapters, a pinned Bun binary, systemd unit and optional Caddy route. A normal installation leaves public MCP disabled. Enabling the route is a separate explicit operator action; creation of each credential is another explicit operator action.

## Consequences and limits

- OAuth-only agent platforms require a later authorization-server milestone. Google operator login is not MCP OAuth.
- Request/body/result/concurrency limits protect this small VM. Oversized successful mutations return a compact success receipt. Network failures after writes report an unknown outcome; callers must reconcile before retrying. No automatic mutation retry or durable idempotency is added.
- Credentials cover the single operator notebook, not tenant or row-level grants.
- A process restart rotates delegations and can interrupt requests. Agent credentials remain valid until revoked or expired.
- Schema migration 16 is additive but old binaries reject future schemas. Disable MCP while retaining schema-16-capable Rust for the ordinary rollback. The installer refuses automatic binary downgrade after a schema change; snapshot restoration requires an explicitly planned, stopped-service recovery and may discard later writes.
- e2-micro memory/load verification and an actual intended agent client smoke test remain launch gates.
