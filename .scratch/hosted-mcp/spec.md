# Tan Studio hosted MCP — implementation specification

Status: implemented for review after Xavier’s explicit implementation approval. Deployment, public enablement and real credential creation remain separate action-time approvals.

Implementation notes: ADR 0008 and deploy/hosted/MCP.md record the final decisions. Delegation signing keys are ephemeral Rust process state. Schema-14 binaries cannot reopen schema 15; ordinary rollback disables MCP while retaining compatible Rust. The release uses native Docker builds with Linux-amd64 cross compilation.
Authoring date: 2026-10-16. Repository: https://github.com/xavierroma/tan-studio.
Inspected checkout: `/Users/xavi/projects/tan-studio`, tracked HEAD `6c4af91`.

## 1. Decision and scope

Host the existing TypeScript/Bun MCP adapter on the same VM as the Rust service, using Streamable HTTP at **`https://studio.tan.coffee/mcp` (PROPOSED, not deployed)**. Continue calling the generated REST client and existing Rust handlers. Rust remains the only owner of notebook persistence, validation, transactions, authorization policy, attachment storage, device behavior, and label creation.

The first release supports explicitly configured, per-agent bearer credentials and both MCP 2026-07-28 and 2025-11-25 clients through the official SDK's supported compatibility mechanisms. Browser OAuth onboarding is a separate milestone. Do not call the first release a universally compatible OAuth MCP integration.

First-release scope: authenticated discovery, eight read tools, eight notebook write tools, existing JSON resources, per-agent read/write grants, revocation, bounded execution, audit attribution, and isolated deployment. Remote file upload and physical-device synchronization are explicitly excluded from its advertised tool set. Local stdio remains supported.

### Alternatives

| Option | Reuse and cost | Decision |
| --- | --- | --- |
| Existing Bun controller → generated API → Rust | Reuses tool schemas, units, results, gateway port, tests, and all backend behavior. Adds a supervised process and an explicit credential boundary. | Recommended smallest appropriate change. |
| Rust MCP endpoint → shared application services | One runtime and simpler credential boundary. Requires extracting orchestration currently in `core_api.rs`/`api.rs`, implementing the MCP interface in Rust, and maintaining parity with the existing TypeScript interface. | Reasonable later if runtime overhead proves material; not a prerequisite for hosting MCP. |
| Rust MCP endpoint with copied handler/SQL logic | Creates a second implementation of notebook behavior. | Reject. |

If Rust is chosen later, both REST and MCP controllers must invoke the same extracted use-case functions. Never call HTTP handler functions with fabricated request contexts or copy their business logic.

## 2. Verified starting point

The existing MCP starts from `plugins/tan-studio/src/server.ts` using `StdioServerTransport`. Its `.mcp.json` launches `bun run ./dist/server.js`. `createTanStudioServer(api)` in `src/mcp.ts` accepts the `TanStudioGateway` port; `src/api.ts` implements that port using OpenAPI-generated types. The controller has an architecture boundary against importing HTTP/storage implementations.

The repository currently declares `@modelcontextprotocol/sdk ^1.29.0`; the installed SDK advertises 2025-11-25 as its latest protocol version. Older project prose calling v2 pre-alpha is stale: the official upstream now describes v2 as stable and supporting 2026-07-28. Pin tested releases and the lockfile during implementation; do not upgrade dependencies as part of writing this spec. [Official SDK](https://github.com/modelcontextprotocol/typescript-sdk)

The deployment is a GCP e2-micro VM in `us-west1-a`; Caddy terminates HTTPS and forwards to Rust on `127.0.0.1:8080`. systemd runs the notebook. SQLite resides on the VM, with Litestream replication and attachment objects in GCS. The release pipeline builds immutable release directories and switches `/opt/tan-studio/current`.

Unauthenticated checks on 2026-10-16 confirmed:

| Address | Observation |
| --- | --- |
| `studio.tan.coffee` DNS | `136.67.36.35`, matching the deployment guide |
| `GET /healthz` | 200; status `ok`, database `ready`, device `disconnected` |
| Reported application version | `6c4af912173d-dirty-20260831002234` |
| `GET /api/v1/system/bootstrap` and `/api/v1/coffees` | 401 without credentials |
| `GET /mcp` | Google sign-in/UI fallback; no working MCP transport demonstrated |

The dirty deployment suffix means source inspection does not prove byte-for-byte production parity. No authenticated notebook calls or server administration were performed for this investigation.

Existing API tokens are per-client, hashed, revocable, and managed only from the operator's signed-in session. They have no audience, expiry, or granular scope fields in the inspected model. They allow notebook writes and cannot list/mint/revoke API tokens. The browser's Google login is operator authentication; it is not an OAuth authorization server for arbitrary MCP clients.

Hosted mode has no bridge listener. ADR-0005 explicitly corrects an earlier, unimplemented WebSocket design. Remote MCP must not imply remote roasting is available.

## 3. Deployment and routing

```text
Remote agent
  HTTPS /mcp, MCP credential
    Caddy
      127.0.0.1:8082 — tan-studio-mcp (Bun)
        shared MCP definitions → request-bound gateway
          REST /api/v1 on 127.0.0.1:8080
            Rust handlers → existing notebook behavior

MCP authentication only:
  Bun → restricted Unix socket → Rust agent credential service
        validates MCP audience and grants
        returns short-lived API delegation credential
```

Proposed routing is exact, before the current UI catch-all:

| Route | Destination / behavior |
| --- | --- |
| `/mcp` | Bun on loopback port 8082; all methods reach its protocol/method handling |
| `/mcp/` and `/mcp/*` | 404; no implicit UI fallback or authenticated redirect |
| `/api/v1/*`, `/auth/*`, `/healthz`, other UI paths | Existing Rust service |
| `/internal/*` | Explicit public rejection; the internal auth route is not registered on the public listener |
| `/.well-known/oauth-protected-resource/mcp` | Absent in the static-token milestone; reserved for the later OAuth milestone |

Bun must bind only to loopback. Do not open a VM firewall port for MCP. Keep the existing public HTTPS port and certificate. Caddy forwards the canonical host and strips/replaces client-supplied forwarded and internal identity headers. The internal REST client sets the existing allowed `Host: studio.tan.coffee` and `X-Tan-Studio-Client: tan-studio-api-v1`; loopback access is not an authentication bypass.

Add `tan-studio-mcp.service` under a separate non-login Unix user. Give it read access to its release bundle and runtime, and permission to connect to the internal auth socket. It must not read the SQLite database, operator OAuth/session secrets, GCS credentials, user home directories, or raw attachment cache. Use a read-only filesystem, private temp directory, no new privileges, a restrictive umask, and systemd credentials only for secrets it actually needs.

Package a pinned Bun runtime and built HTTP bundle in the immutable hosted release; the VM must not install packages or build at startup. Extend the existing Docker release build, installer, and deployment tests. Keep the stdio bundle as a separate artifact. Add local-only `/healthz` (process liveness) and `/readyz` (Rust/auth dependency ready) on the Bun listener; do not publicly expose diagnostics containing configuration or credentials.

## 4. Credential and authorization design

### 4.1 First release: explicit per-agent provisioning

Add a dedicated `agent_credentials` table managed by Rust, rather than silently changing the meaning of existing `api_tokens`. Fields: ID, operator/notebook owner ID, agent label, SHA-256 token digest, canonical audience, permission profile, created/expiry/revocation timestamps, last-used timestamp, and credential version. Use 32 cryptographically random secret bytes with a distinct `tsmcp_` prefix. Show the secret once; never store recoverable plaintext.

Audience is exactly the configured canonical MCP resource `https://studio.tan.coffee/mcp`. Store this value on the credential record and validate it through a server-controlled expected audience. Never derive the expected audience from a caller's Host, forwarded header, request body, or tool argument. Old API tokens, Google access/ID tokens, browser cookies, LAN tokens, and API delegation credentials must fail MCP authentication.

Proposed operator-session-only management routes are `GET/POST /api/v1/agent-credentials` and `POST /api/v1/agent-credentials/{id}/revoke`. Add an “Agent connections” section to Settings → Access showing label, permission profile, expiry, last use, and revoke. Default to read-only, 30-day expiry; operator may choose a shorter expiry or at most 90 days. Rotation creates a new credential and explicitly revokes the old one after client cutover. No token is created by this spec.

Profiles are `notebook:read` and `notebook:write`; write is additive and requires read. They cover the one operator-owned notebook, not per-row or per-coffee sharing. There is no admin, arbitrary HTTP, SQL, filesystem, or credential-management grant. Requests carry `Authorization: Bearer …` on every call. Missing/invalid/revoked/expired credentials return 401 with a Bearer challenge; insufficient grants return 403. Never redirect `/mcp` to Google or accept credentials in a URL.

This milestone is a documented custom static-token authorization scheme for clients that can supply a bearer header. It is not a claim of conformance to the complete MCP OAuth discovery/authorization flow. The SDK explicitly supports non-OAuth bearer providers. [SDK migration/auth interfaces](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2)

### 4.2 Separate inbound and downstream credentials

Do not forward the client's MCP bearer token into the ordinary REST API. Do not replace it with one shared, unrestricted operator API token. MCP audience validation and downstream delegation are distinct operations. MCP's authorization guidance requires tokens intended for the MCP resource, and its security guidance rejects token passthrough. [Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization), [security guidance](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices)

Implement a narrowly scoped Rust auth listener at `/run/tan-studio/mcp-auth.sock`. Its containing directory is writable only by the Rust service; socket mode 0660 permits a dedicated connector group. Caddy has no route to this socket. The sole proposed endpoint, `POST /internal/mcp/delegate`, accepts the inbound MCP token for validation plus the parsed MCP operation identity. Its expected audience is fixed server-side. This is the authentication authority within the logical MCP resource boundary, not an arbitrary downstream data API.

Rust validates the token, ownership, expiry, revocation and requested operation; it returns a principal and a separate signed API delegation credential valid for at most 60 seconds, never beyond the MCP credential expiry. The delegation contains issuer, audience `https://studio.tan.coffee/api/v1`, actor/owner IDs, parent credential ID/version, allowed operation set, issued-at, expiry, and request correlation ID. Use a vetted token library with one pinned signing algorithm and Rust-only signing key; do not implement cryptography or let Bun choose claims.

The gateway uses this delegation credential only for the existing API requests needed for that operation. REST middleware verifies signature, issuer, API audience, lifetime, parent credential status/version, owner and method/route permissions on each call. Deny unlisted routes, including all token management, raw file upload, device writes and synchronization. A `tan_status` delegation can cover its specific bootstrap/device/bridge reads, not all GET endpoints. Multiple API calls for one MCP operation share the immutable principal and correlation ID.

The parent credential is checked again at the API boundary so revocation takes effect on the next request even before the 60-second delegation expires. No positive revocation cache in v1. In-flight work already committed cannot be retroactively revoked. Credentials and delegation values stay only in request memory; they are never returned in MCP results, logged, or written to disk.

Centralize operation→allowed API routes→required grant policy in a Rust module with contract tests against the MCP catalog. Bun may use the returned capabilities to filter discovery and fail fast, but Rust authoritatively enforces them. Reject forged actor headers. Model-supplied clientInfo/agent names are descriptive only. Fix the current hardcoded note attribution `agent: codex` for hosted calls by having Rust stamp the verified actor into audit/attribution fields.

Request order is: cheap size/host/origin/admission checks; bounded JSON parsing and SDK protocol/header consistency validation; credential validation and operation authorization; dispatch. Discovery and protocol housekeeping require a valid principal but receive no data-API delegation. The auth listener derives its permission set from a known operation ID; it never accepts a caller-provided route allowlist. An authenticated unknown operation receives the appropriate protocol error without a downstream credential.

### 4.3 Later OAuth milestone

If the chosen agent platform requires OAuth, that milestone becomes a prerequisite for that platform's launch. Use a maintained authorization-server product/library; retain the same principal, grant and downstream delegation interfaces. Google can remain the upstream operator login, but Google tokens are never accepted directly as Tan MCP access tokens.

Serve protected-resource metadata at `/.well-known/oauth-protected-resource/mcp`, identifying resource `https://studio.tan.coffee/mcp` and the real authorization-server issuer. Implement discovery, authorization-code + PKCE, exact redirect validation, client registration policy, explicit per-agent consent, resource indicators, expiry/revocation and audience validation. Publish metadata only when the advertised issuer/endpoints work. A 401 challenge points to that metadata. Follow the current OAuth requirements and test actual target clients; do not invent a nominal `/oauth` endpoint or advertise an unfinished authorization server. [MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)

## 5. Transport and client compatibility

Use the official TypeScript SDK v2, with its modern handler entry point and an explicit legacy-compatibility configuration; migrate the shared tool registration once. The SDK's modern protocol is opt-in: importing v2 alone does not switch wire semantics. Retain the local stdio entry point and verify its existing clients. [Modern SDK migration](https://ts.sdk.modelcontextprotocol.io/v2/migration/support-2026-07-28.html)

Target 2026-07-28 plus 2025-11-25. Use SDK parsing, codecs and version selection, not a handwritten JSON-RPC server. Modern requests are independently authenticated, use POST, and have no protocol session. Implement `server/discover`. Validate required version/method/name headers against body metadata; unknown versions return the supported-version error. The legacy path handles initialization and initialized notifications without confusing them with modern requests. [Versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning)

Prefer JSON responses for these bounded tools. Support the SDK's request-scoped SSE behavior where necessary. Authenticated GET/DELETE return 405 when no legacy session/stream capability is enabled. No old `/sse` endpoint, resumable streams, subscriptions, sampling, elicitation, or long-running task extension in v1. If the SDK requires legacy session state, isolate it by principal, cap it, expire it after 15 minutes idle, and discard it on restart; never use a session ID as authentication.

Require JSON content type and supported Accept values; reject batch bodies. Validate Origin when present (initial allowlist only `https://studio.tan.coffee`); originless authenticated agents are permitted. Invalid origins return 403. Auth and limits run before tool dispatch. CORS preflight returns only the explicit methods/headers for an allowed origin, with no wildcard credentials. Check canonical Host independently. Propagate client cancellation into outbound fetch; report uncertain write outcomes without assuming rollback. [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)

Create immutable request-bound gateway/auth context. Never mutate a singleton gateway's bearer token or share response caches across agents. SDK lifecycle/transport objects must be closed after their response completes; SSE responses must not be closed early.

| Client capability | Supported path |
| --- | --- |
| Streamable HTTP + configured bearer header + either target protocol | First-release remote endpoint after interoperability test |
| OAuth-only remote connector | OAuth milestone required; static token cannot be assumed usable |
| Existing stdio client | Existing local adapter and REST credential configuration |
| Deprecated HTTP+SSE-only client | Unsupported; upgrade the client |

Release documentation must name the actual tested client applications and versions. No application-specific compatibility was verified during this read-only specification work.

## 6. Tool and resource contract

Reuse `mcp.ts`, `gateway.ts`, `units.ts`, generated API types, and structured result formatting. Add an explicit capability/policy input to registration; do not fork the business implementation for each transport. Keep tool names, human units, input validation, result meanings, optimistic revision checks and annotations consistent for common tools.

| Grant / placement | Tools |
| --- | --- |
| Read, local and hosted | `tan_status`, `tan_list_pantry`, `tan_search_profiles`, `tan_search_coffees`, `tan_search_roasts`, `tan_get_context`, `tan_get_roast`, `tan_list_attachments` |
| Write, local and hosted | `tan_create_coffee`, `tan_update_coffee`, `tan_update_roast`, `tan_record_brew`, `tan_update_brew`, `tan_add_note`, `tan_set_profile_image`, `tan_create_label` |
| Local only | `tan_attach_file`, `tan_sync_device` |

Hosted read-only agents see eight tools; read/write agents see sixteen. Manually calling hidden/disabled tools must also fail. `tan_create_label` creates the existing label artifact; it must not claim physical printing. `tan_status` reports the hosted device capability honestly. Do not expose `tan_sync_device` until a separately designed remote hardware path exists.

Initial delegation policy is derived from these existing gateway calls. All paths below are relative to `/api/v1`; route matching must use parsed route templates and validated parameters, never permissive string-prefix matching.

| MCP operation | Allowed REST calls |
| --- | --- |
| `tan_status` | GET `/system/bootstrap`, `/device`, `/bridges` |
| `tan_list_pantry` | GET `/pantry` |
| `tan_search_profiles` / `tan_search_coffees` / `tan_search_roasts` | GET `/profiles` / `/coffees` / `/roasts`, respectively |
| `tan_get_context` | GET `/profiles/{id}/context`, `/coffees/{id}/context`, `/roasts/{id}/context`, or `/brews/{id}`, selected by validated resource type |
| `tan_get_roast` | GET `/roasts/{id}` and optional `/roasts/{id}/series` |
| `tan_list_attachments` | GET `/attachments` with validated resource filters |
| `tan_create_coffee` / `tan_update_coffee` | POST `/coffees` / PATCH `/coffees/{id}`, respectively |
| `tan_update_roast` | PATCH `/roasts/{id}` |
| `tan_record_brew` / `tan_update_brew` | POST `/brews` / PATCH `/brews/{id}`, respectively |
| `tan_add_note` / `tan_create_label` | POST `/notes` / `/labels`, respectively |
| `tan_set_profile_image` | PUT `/entity-profile-images/{resource_type}/{resource_id}` |

Resource reads delegate only their corresponding context, pantry or device GET operation. Bind concrete target IDs/resource types in delegation where present; link and object validation remain in Rust. Authorize returned nested context under the same single-notebook grant. The catalog and allowlist are tested together whenever a gateway gains another API call.

Resources remain `tan://pantry`, `tan://device`, and templates `tan://profiles/{id}`, `tan://coffees/{id}`, `tan://roasts/{id}`, `tan://brews/{id}`. All require read permission. Validate numeric IDs and allow only these URI patterns. Resource reads must never become generic URL/file fetches. No prompts or resource subscriptions are added. Read-only annotations describe behavior; they do not substitute for authorization.

### Attachments

The existing `tan_attach_file(filePath)` calls `Bun.file()` and permits up to 512 MiB locally. It MUST NOT be registered in hosted mode, even for trusted agents. Exclude the local filesystem implementation from the hosted composition root and make unsupported calls fail closed. The server cannot read a file located on the agent's machine by pathname.

V1 supports listing attachments and choosing an already attached profile image. Upload continues through the existing signed-in UI or the local adapter; a remote MCP token cannot be reused as a REST upload token. These are explicit parity exceptions, not silently broken tools.

A later remote-upload milestone may add a separate `tan_attach_bytes` tool with a 2 MiB decoded-byte ceiling, strict base64 validation, filename/metadata/links, and an explicit attachment-write grant. It must call the existing Rust attachment services through typed API operations. Before launch, specify idempotent metadata creation, interrupted-upload cleanup/resume and ownership checks. Do not use arbitrary server file paths, arbitrary URL fetches, public permanent links, unbounded base64 bodies, or cloud-provider credentials. `sourceUrl` remains metadata and is never fetched.

## 7. Error semantics, limits and observability

Transport/auth failures use HTTP statuses: 400 malformed/protocol mismatch, 401 invalid credential, 403 forbidden operation/origin, 405 method, 413 body too large, 415 media type, 429 capacity, and 503 unavailable dependency. Use the selected SDK revision's JSON-RPC envelope/status behavior for protocol errors. Never return HTML to an MCP request. Authentication is not converted to a successful tool result.

Domain failures preserve existing `TanStudioGatewayError` code, HTTP status, retryability, correlation ID and field errors as MCP tool errors (`isError: true`). Preserve 412 revision conflicts; instruct a fresh read instead of overwriting. Unexpected errors expose a stable generic code/correlation ID, not raw exception messages, stack traces, paths or secrets. Handle resource errors through SDK resource-error semantics, not tool envelopes.

Do not automatically retry mutations. An MCP request ID is not an idempotency key. On network timeout after a write, return an outcome-unknown error and recommend reconciling current data. Where the backend already supports idempotency, preserve its contract. Adding durable idempotency is a Rust concern and must cover both API and MCP consumers, not an in-memory MCP response cache.

Proposed initial operational limits (measure on the existing VM before enabling writes):

| Limit | Initial value |
| --- | --- |
| Request body | 256 KiB, enforced while streaming, including chunked requests |
| Response | 1 MiB; bounded/paginated results or explicit result-too-large error |
| API timeout / total request budget | 15 seconds / 20 seconds, including delegation |
| In-flight work | 4 per agent, 16 globally; no unbounded queue |
| Per-agent admission | 60 requests/minute with burst 10 |
| Pre-auth admission | 30 attempts/minute per trusted source IP; global concurrency ceiling |
| Results | Existing validated search limits; roast telemetry capped at 2,000 points |
| MCP process memory | Start at 192 MiB high-water / 256 MiB hard cap; load-test before release |

Return Retry-After for throttling. Do not rate-limit from an untrusted X-Forwarded-For header. Bound JSON depth, header/token lengths and parsing time. Avoid compression/buffering that undermines body limits or SSE. When a mutation succeeds but its result cannot fit the response ceiling, return a small success receipt with resource ID/revision rather than falsely reporting the mutation failed; enforce required read-result bounds before serialization.

Log structured events: release version, request/correlation IDs, verified agent ID, operation, allowed/denied outcome, latency, downstream status and bounded error code. Record mutations in Rust with authenticated actor attribution. Never log Authorization, cookie/token/delegation values, tool arguments, full resource results, note bodies or attachment content. Expose local metrics for request rate, auth failures, scope denials, latency, API errors, memory, in-flight work and cancellations. Alert on restart loops, sustained 5xx, memory pressure and API/MCP version mismatch.

## 8. Implementation map

| Area | Required change |
| --- | --- |
| `plugins/tan-studio/src/server.ts` | Preserve stdio composition and existing configuration |
| New `src/http-server.ts`, transport/auth modules | Bind loopback, SDK transport, per-request principal/gateway, limits and shutdown |
| `src/mcp.ts`, `gateway.ts` | Shared capability-aware registration; explicit local attachment capability |
| `src/api.ts`, `results.ts` | Request-bound delegation, cancellation/correlation support, safe errors; no global hosted token discovery |
| Plugin package/build script | Pinned SDK migration; separate stdio and HTTP bundles; tested Bun version |
| Rust auth module + migration | Agent credentials, permission policy, private delegation listener, API delegation validation |
| `apps/service/src/api.rs` | Operator-only management routes and centralized authorization integration |
| `apps/web/src/components/api-token-settings.tsx` or adjacent component | Explicit agent credentials, grants, expiry, rotation/revocation UI |
| Hosted Dockerfile/install/systemd/Caddy | Package and supervise Bun service; exact routing; health/rollback |
| `scripts/check-boundaries.ts` and generated contract checks | Keep controller decoupled; prevent local file adapter in hosted bundle |

A shared HMAC/API delegation key belongs only to Rust's protected credential environment; Bun receives only expiring request credentials. Additive database migrations must preserve current `api_tokens` and existing stdio clients. The HTTP entry point must refuse startup if configured with `TAN_STUDIO_API_TOKEN` as a global hosted backend credential or if the expected audience/internal auth endpoint is missing.

## 9. Acceptance tests and release gates

1. **Architecture:** Boundary checks prove the MCP controller cannot import SQLite, storage, USB or raw HTTP implementations. Hosted bundle/composition cannot instantiate `attachLocalFile`. No copied notebook SQL/business rules.
2. **Protocol:** Official SDK clients for both target revisions discover, list tools/resources and read fixtures. Test initialization compatibility, modern header/body mismatch, unsupported versions, malformed JSON, batch rejection, Accept/content type, 405 handling, cancellation and clean shutdown.
3. **Identity isolation:** Parallel agents with different grants and deliberately reused JSON-RPC IDs cannot share principals, results or credentials. Legacy session reuse across principals is rejected if sessions exist.
4. **Audience:** API, LAN, Google and delegation tokens fail at MCP. MCP tokens fail at ordinary REST endpoints. Invalid signatures, wrong issuer/audience, expired grants and revoked/version-mismatched parents fail downstream. The internal auth socket is unreachable through public Caddy routes and inaccessible to unrelated local users.
5. **Authorization:** Read grants cannot invoke any write through tools, hidden calls, resources or forged downstream requests. Token management is operator-session-only. All catalog operations map to explicit backend allowlists. Unknown routes fail closed.
6. **Parity:** Run common workflow fixtures through stdio, remote MCP and REST; compare persisted records, human-unit conversion, revision conflicts, linked notes, labels and structured errors. Execute writes only against an isolated temporary database.
7. **Resources/attachments:** Verify two static resources and four templates. Path traversal, `file://`, arbitrary HTTPS URI, injected filePath, URL-fetch attempts and hidden attachment-tool calls cannot read server files or perform fetches. Existing attachment listing/profile images still work.
8. **Abuse and failure:** Oversized/chunked/deep JSON, origin/host spoofing, rate/concurrency limits, slow API, auth outage, mid-write timeout, restart and memory pressure remain bounded. No automatic mutation replay. Verify logs with synthetic secrets and private fixture text to prove redaction.
9. **Deployment:** Caddy config validates; MCP only listens on loopback; health/readiness and restart policy work; Rust/UI stay available when Bun fails. Test upgrade and rollback of both bundles against additive schema. Check memory/load on an e2-micro with backup jobs active.
10. **Real client:** Record the exact intended agent platform/version and its header/token setup. Demonstrate one read-only connection before enabling writes. OAuth-only clients block their own launch until the OAuth milestone passes discovery/consent/PKCE/audience/revocation tests.

Run the repository's boundary, type, unit, contract and build checks plus dedicated HTTP/auth integration tests. Do not use the current live-write test program against production by default. Production smoke tests are read-only: authenticated discovery/status and a known safe read, plus unauthenticated 401 checks.

## 10. Rollout, rollback and connection instructions

Implement behind a disabled hosted-MCP flag. First add credential/schema/authorization support and test it locally; then add the shared SDK migration, HTTP composition and isolated integration tests; finally package the service and routing. Deploy only with separate authorization. Preserve the existing stdio/REST path throughout.

After deployment approval, enable the endpoint for one explicitly provisioned read-only agent, observe errors/latency/memory and revocation behavior, then separately provision write access if wanted. Creating a credential and enabling write grants are distinct operator decisions. No automatic migration or copying of existing API secrets.

Rollback disables the exact Caddy MCP route and stops Bun while leaving UI/REST running. Keep additive credential tables; never downgrade/delete notebook data. If reverting Rust to a build without delegation support, stop MCP first. On re-enable, require readiness and recheck credential validity. Document old and new protocol support in the release notes; do not silently break local stdio configuration.

Once implemented, a compatible agent's configuration is conceptually:

```yaml
transport: streamable-http
url: https://studio.tan.coffee/mcp  # proposed; usable only after rollout
authorization: Bearer <MCP-specific credential from the client's secret store>
```

Use the client's documented secret/environment mechanism; this is a conceptual configuration, not a claim that every client accepts these YAML keys. Do not paste secrets into prompts, checked-in configuration or URLs. The client no longer needs a local Bun process for remote access. Existing local stdio clients can continue unchanged.

Unresolved release inputs are the intended agent application's tested version/auth support, the pinned SDK/Bun versions after a compatibility spike, and VM resource headroom. They do not change the architectural decision; they are explicit gates before publishing a connection recipe or enabling production writes.

## 11. Evidence and specification references

Repository files inspected: `AGENTS.md`; `CONTEXT.md`; `README.md`; `plugins/tan-studio/.mcp.json`, `package.json`, `src/{server,mcp,gateway,api,config,results,units}.ts`, `scripts/build.ts`; `apps/service/src/{api,api_token,core_api,config}.rs`; `deploy/hosted/{README.md,Caddyfile,Dockerfile,tan-studio.service,install.sh}`; `script/deploy_hosted.sh`; `docs/07-codex-mcp-test-plan.md`; ADRs 0003–0005; installed SDK version constants and transport interfaces.

Official protocol references were checked on 2026-10-16. Their requirements are distinguished above from Tan Studio's proposed product limits and credential design. Protocol descriptions intentionally avoid relying on the project's outdated 17-tool count or v2-pre-alpha note.

This document is the sole deliverable of the specification task. No runtime files, deployments, credentials, permissions or notebook records were changed.
